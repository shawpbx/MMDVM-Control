#!/usr/bin/env python3
"""
MMDVM WebGUI Installer & Post-Install Configurator Server
Provides authenticated login, pre-install MMDVMHost + DMRGateway build & setup,
fast post-install config-only updates (no reinstall), live service/user telemetry,
and journal log inspection for Raspberry Pi OS & Debian 12/13.
"""

import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

DIST_DIR = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist"))
PORT = int(os.environ.get("MMDVM_WEBGUI_PORT") or os.environ.get("ASL_WEBGUI_PORT") or "8080")
ENV_ADMIN_USER = os.environ.get("MMDVM_WEBGUI_ADMIN_USER", "admin").strip() or "admin"
ENV_ADMIN_PASSWORD = (
    os.environ.get("MMDVM_WEBGUI_ADMIN_PASSWORD")
    or os.environ.get("ASL_WEBGUI_ADMIN_PASSWORD")
    or ""
).strip()

STATE_DIR = "/etc/mmdvm-webgui"
ADMIN_FILE = os.path.join(STATE_DIR, "admin.json")
SAVED_CONFIG_FILE = os.path.join(STATE_DIR, "config.json")
INSTALL_LOG_FILE = "/var/log/mmdvm-webgui-install.log"
MAX_BODY_BYTES = 131072
SESSION_TTL_SECONDS = 8 * 3600
MAX_LOGIN_FAILURES = 5
LOGIN_WINDOW_SECONDS = 60

ALLOWED_SERVICES = ("mmdvmhost", "dmrgateway")
ALLOWED_ACTIONS = ("start", "stop", "restart")

auth_lock = threading.Lock()
# token -> {"username": str, "expires": float}
sessions: dict[str, dict] = {}
# ip -> list[float] timestamps of failed logins
login_failures: dict[str, list[float]] = {}

job_lock = threading.Lock()
job_state: dict = {
    "mode": "idle",  # idle | install | apply
    "status": "idle",  # idle | running | succeeded | failed
    "step": "",
    "stepIndex": 0,
    "totalSteps": 4,
    "startedAt": None,
    "finishedAt": None,
    "exitCode": None,
    "error": None,
    "logs": [],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_log(line: str) -> None:
    clean = line.rstrip("\r\n")
    with job_lock:
        job_state["logs"].append(clean)
        if len(job_state["logs"]) > 2500:
            job_state["logs"] = job_state["logs"][-2000:]
    try:
        with open(INSTALL_LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(clean + "\n")
    except OSError:
        pass


def _set_step(index: int, title: str) -> None:
    with job_lock:
        job_state["stepIndex"] = index
        job_state["step"] = title
        total = job_state["totalSteps"]
    _append_log(f"=== [{index}/{total}] {title} ===")


def _hash_password(password: str, salt: bytes | None = None) -> str:
    if salt is None:
        salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def _verify_hash(password: str, stored: str) -> bool:
    parts = stored.strip().split("$")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False
    try:
        salt = bytes.fromhex(parts[1])
        expected = bytes.fromhex(parts[2])
    except ValueError:
        return False
    candidate = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return hmac.compare_digest(candidate, expected)


def _load_admin_record() -> dict | None:
    if not os.path.isfile(ADMIN_FILE):
        return None
    try:
        with open(ADMIN_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and data.get("passwordHash"):
            return data
    except Exception:
        pass
    return None


def _save_admin_record(username: str, password: str) -> None:
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    record = {
        "username": username,
        "passwordHash": _hash_password(password),
        "updatedAt": _now_iso(),
    }
    tmp_path = ADMIN_FILE + ".tmp"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
    os.replace(tmp_path, ADMIN_FILE)


def _is_auth_configured() -> bool:
    if ENV_ADMIN_PASSWORD:
        return True
    return _load_admin_record() is not None


def _get_username_hint() -> str:
    if ENV_ADMIN_PASSWORD:
        return ENV_ADMIN_USER
    rec = _load_admin_record()
    if rec and isinstance(rec.get("username"), str):
        return rec["username"]
    return "admin"


def _verify_credentials(username: str, password: str) -> tuple[bool, str]:
    if not isinstance(password, str) or not password:
        return False, ""
    clean_user = (username or "").strip() or _get_username_hint()
    if ENV_ADMIN_PASSWORD:
        user_ok = hmac.compare_digest(clean_user.lower(), ENV_ADMIN_USER.lower())
        pass_ok = hmac.compare_digest(password.encode("utf-8"), ENV_ADMIN_PASSWORD.encode("utf-8"))
        return (user_ok and pass_ok), ENV_ADMIN_USER
    rec = _load_admin_record()
    if not rec:
        return False, ""
    stored_user = str(rec.get("username", "admin"))
    user_ok = hmac.compare_digest(clean_user.lower(), stored_user.lower())
    pass_ok = _verify_hash(password, str(rec.get("passwordHash", "")))
    return (user_ok and pass_ok), stored_user


def _is_rate_limited(client_ip: str) -> bool:
    now = time.time()
    with auth_lock:
        recent = [ts for ts in login_failures.get(client_ip, []) if now - ts < LOGIN_WINDOW_SECONDS]
        login_failures[client_ip] = recent
        return len(recent) >= MAX_LOGIN_FAILURES


def _record_login_failure(client_ip: str) -> None:
    now = time.time()
    with auth_lock:
        recent = [ts for ts in login_failures.get(client_ip, []) if now - ts < LOGIN_WINDOW_SECONDS]
        recent.append(now)
        login_failures[client_ip] = recent


def _clear_login_failures(client_ip: str) -> None:
    with auth_lock:
        login_failures.pop(client_ip, None)


def _issue_session_token(username: str) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with auth_lock:
        expired = [k for k, info in sessions.items() if info["expires"] < now]
        for k in expired:
            sessions.pop(k, None)
        sessions[token] = {"username": username, "expires": now + SESSION_TTL_SECONDS}
    return token


def _validate_bearer(auth_header: str | None) -> tuple[str | None, str | None]:
    if not auth_header or not auth_header.startswith("Bearer "):
        return None, None
    candidate = auth_header[7:].strip()
    if not candidate:
        return None, None
    now = time.time()
    with auth_lock:
        for stored_token, info in list(sessions.items()):
            if info["expires"] < now:
                sessions.pop(stored_token, None)
                continue
            if hmac.compare_digest(candidate, stored_token):
                return stored_token, str(info["username"])
    return None, None


def _run_cmd(args: list[str], check: bool = True, env: dict | None = None) -> int:
    _append_log(f"$ {' '.join(args)}")
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        _append_log(line)
    rc = proc.wait()
    if check and rc != 0:
        raise RuntimeError(f"Command failed (exit {rc}): {' '.join(args)}")
    return rc


def _clean_line(val: object, default: str = "") -> str:
    if not isinstance(val, str):
        return default
    return val.replace("\r", "").replace("\n", "").strip()


def _mhz_to_hz(mhz_raw: str) -> int:
    try:
        val = float(mhz_raw.strip())
    except ValueError as exc:
        raise ValueError(f"Invalid frequency: {mhz_raw}") from exc
    hz = int(round(val * 1_000_000))
    if hz < 144_000_000 or hz > 450_000_000:
        raise ValueError("Frequency must be within 144.0000 – 450.0000 MHz.")
    return hz


def _validate_config(cfg: dict) -> dict:
    if not isinstance(cfg, dict):
        raise ValueError("Configuration must be a JSON object.")

    st = cfg.get("station")
    md = cfg.get("modem")
    nw = cfg.get("networks")
    sy = cfg.get("system")
    if not all(isinstance(x, dict) for x in (st, md, nw, sy)):
        raise ValueError("Missing required sections: station, modem, networks, system.")

    callsign = _clean_line(st.get("callsign", "")).upper()
    if not re.fullmatch(r"[A-Z0-9]{3,10}", callsign):
        raise ValueError("Callsign must be 3–10 alphanumeric characters.")

    dmr_id = _clean_line(st.get("dmrId", ""))
    dmr_enable = bool(nw.get("dmrEnable", True))
    if dmr_enable and not re.fullmatch(r"\d{6,7}", dmr_id):
        raise ValueError("DMR ID must be 6–7 digits when DMR is enabled.")
    if dmr_id and not re.fullmatch(r"\d{6,7}", dmr_id):
        raise ValueError("DMR ID must be 6–7 digits.")

    essid = _clean_line(st.get("essidSuffix", ""))
    if essid and not re.fullmatch(r"\d{2}", essid):
        raise ValueError("ESSID suffix must be 2 digits (e.g. 01) or blank.")

    rx_mhz = _clean_line(st.get("rxFrequencyMhz", "446.8000"))
    tx_mhz = _clean_line(st.get("txFrequencyMhz", "446.8000"))
    rx_hz = _mhz_to_hz(rx_mhz)
    tx_hz = _mhz_to_hz(tx_mhz)

    rx_offset = int(st.get("rxOffset", 0))
    tx_offset = int(st.get("txOffset", 0))
    if not (-5000 <= rx_offset <= 5000) or not (-5000 <= tx_offset <= 5000):
        raise ValueError("RX/TX offsets must be between -5000 and 5000 Hz.")

    rf_power = int(st.get("rfPower", 100))
    if not (1 <= rf_power <= 100):
        raise ValueError("RF Power must be between 1 and 100%.")

    cw_time = int(st.get("cwIdTimeMinutes", 10))
    if not (1 <= cw_time <= 60):
        raise ValueError("CW ID interval must be between 1 and 60 minutes.")

    lat = _clean_line(st.get("latitude", "0.0")) or "0.0"
    lon = _clean_line(st.get("longitude", "0.0")) or "0.0"
    if not re.fullmatch(r"-?\d{1,3}(\.\d+)?", lat) or not re.fullmatch(r"-?\d{1,3}(\.\d+)?", lon):
        raise ValueError("Latitude and Longitude must be valid decimal numbers.")

    protocol = _clean_line(md.get("protocol", "uart"))
    uart_port = _clean_line(md.get("uartPort", "/dev/ttyAMA0"))
    if protocol == "null" or uart_port == "null":
        protocol = "null"
        uart_port = "null"
    else:
        protocol = "uart"
        if not re.fullmatch(r"/dev/[A-Za-z0-9._-]+", uart_port):
            raise ValueError("Modem UARTPort must be a valid /dev/ device path or 'null'.")

    uart_speed = int(md.get("uartSpeed", 115200))
    if uart_speed not in (115200, 230400, 460800):
        raise ValueError("UART baud rate must be 115200, 230400, or 460800.")

    tx_delay = int(md.get("txDelay", 100))
    dmr_delay = int(md.get("dmrDelay", 0))
    rx_level = int(md.get("rxLevel", 50))
    tx_level = int(md.get("txLevel", 50))
    if not (0 <= tx_delay <= 500) or not (0 <= dmr_delay <= 500):
        raise ValueError("TXDelay and DMRDelay must be between 0 and 500.")
    if not (0 <= rx_level <= 100) or not (0 <= tx_level <= 100):
        raise ValueError("RXLevel and TXLevel must be between 0 and 100.")

    ysf_enable = bool(nw.get("ysfEnable", False))
    dstar_enable = bool(nw.get("dstarEnable", False))
    p25_enable = bool(nw.get("p25Enable", False))
    nxdn_enable = bool(nw.get("nxdnEnable", False))
    if not any((dmr_enable, ysf_enable, dstar_enable, p25_enable, nxdn_enable)):
        raise ValueError("Enable at least one digital voice mode.")

    dmr_cc = int(nw.get("dmrColorCode", 1))
    if not (0 <= dmr_cc <= 15):
        raise ValueError("DMR Color Code must be between 0 and 15.")

    dmr_host = _clean_line(nw.get("dmrMasterHost", "3102.repeater.net"))
    dmr_port = int(nw.get("dmrMasterPort", 62031))
    dmr_pass = _clean_line(nw.get("dmrMasterPassword", ""))
    dmr_name = _clean_line(nw.get("dmrMasterName", "BrandMeister")) or "BrandMeister"
    if dmr_enable:
        if not re.fullmatch(r"[a-zA-Z0-9.-]+", dmr_host):
            raise ValueError("Invalid DMR master hostname.")
        if not (1024 <= dmr_port <= 65535):
            raise ValueError("DMR master port must be between 1024 and 65535.")

    ysf_host = _clean_line(nw.get("ysfGatewayHost", "127.0.0.1")) or "127.0.0.1"
    if not re.fullmatch(r"[a-zA-Z0-9.-]+", ysf_host):
        raise ValueError("Invalid YSF gateway host.")
    ysf_port = int(nw.get("ysfGatewayPort", 4200))
    if not (1024 <= ysf_port <= 65535):
        raise ValueError("YSF gateway port must be between 1024 and 65535.")

    dstar_mod = _clean_line(nw.get("dstarModule", "B")).upper()
    if dstar_mod not in ("A", "B", "C", "D"):
        dstar_mod = "B"

    p25_nac = _clean_line(nw.get("p25Nac", "293")).upper() or "293"
    if not re.fullmatch(r"[0-9A-F]{1,3}", p25_nac):
        raise ValueError("P25 NAC must be a valid hex code (e.g. 293).")

    nxdn_ran = int(nw.get("nxdnRan", 1))
    if not (0 <= nxdn_ran <= 63):
        raise ValueError("NXDN RAN must be between 0 and 63.")

    hostname = _clean_line(sy.get("hostname", "mmdvm-hotspot"))
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{0,62}", hostname):
        raise ValueError("Hostname may only contain letters, digits, and hyphens.")

    timezone_str = _clean_line(sy.get("timezone", "UTC")) or "UTC"
    if not re.fullmatch(r"[A-Za-z0-9_/+:-]+", timezone_str):
        raise ValueError("Invalid timezone string.")

    webgui_port = int(sy.get("webguiPort", 8080))
    ssh_port = int(sy.get("sshPort", 22))
    if not (1024 <= webgui_port <= 65535) or not (1 <= ssh_port <= 65535):
        raise ValueError("Invalid WebGUI or SSH port.")

    return {
        "station": {
            "callsign": callsign,
            "dmrId": dmr_id or "3100000",
            "essidSuffix": essid,
            "duplex": bool(st.get("duplex", False)),
            "rxFrequencyMhz": rx_mhz,
            "txFrequencyMhz": tx_mhz,
            "_rxHz": rx_hz,
            "_txHz": tx_hz,
            "rxOffset": rx_offset,
            "txOffset": tx_offset,
            "rfPower": rf_power,
            "cwIdEnable": bool(st.get("cwIdEnable", False)),
            "cwIdTimeMinutes": cw_time,
            "latitude": lat,
            "longitude": lon,
            "heightMeters": max(0, min(9000, int(st.get("heightMeters", 0)))),
            "location": _clean_line(st.get("location", "Local Hotspot"))[:64] or "Local Hotspot",
            "description": _clean_line(st.get("description", f"{callsign} MMDVM Hotspot"))[:64],
            "url": _clean_line(st.get("url", "https://www.qrz.com"))[:96] or "https://www.qrz.com",
        },
        "modem": {
            "modemModel": _clean_line(md.get("modemModel", "custom"))[:64],
            "protocol": protocol,
            "uartPort": uart_port,
            "uartSpeed": uart_speed,
            "rxInvert": bool(md.get("rxInvert", False)),
            "txInvert": bool(md.get("txInvert", False)),
            "pttInvert": bool(md.get("pttInvert", False)),
            "txDelay": tx_delay,
            "dmrDelay": dmr_delay,
            "rxLevel": rx_level,
            "txLevel": tx_level,
            "configurePiUart": bool(md.get("configurePiUart", False)),
        },
        "networks": {
            "dmrEnable": dmr_enable,
            "dmrColorCode": dmr_cc,
            "dmrMasterName": dmr_name[:32],
            "dmrMasterHost": dmr_host,
            "dmrMasterPort": dmr_port,
            "dmrMasterPassword": dmr_pass,
            "dmrSlot1": bool(nw.get("dmrSlot1", False)),
            "dmrSlot2": bool(nw.get("dmrSlot2", True)),
            "ysfEnable": ysf_enable,
            "ysfGatewayHost": ysf_host,
            "ysfGatewayPort": ysf_port,
            "dstarEnable": dstar_enable,
            "dstarModule": dstar_mod,
            "p25Enable": p25_enable,
            "p25Nac": p25_nac,
            "nxdnEnable": nxdn_enable,
            "nxdnRan": nxdn_ran,
        },
        "system": {
            "hostname": hostname,
            "timezone": timezone_str,
            "webguiPort": webgui_port,
            "enableUfw": bool(sy.get("enableUfw", False)),
            "sshPort": ssh_port,
        },
    }


def _strip_internal_fields(cfg: dict) -> dict:
    clean = json.loads(json.dumps(cfg))
    if isinstance(clean.get("station"), dict):
        clean["station"].pop("_rxHz", None)
        clean["station"].pop("_txHz", None)
    return clean


def _save_config(cfg: dict) -> None:
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    tmp = SAVED_CONFIG_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(_strip_internal_fields(cfg), fh, indent=2)
    os.replace(tmp, SAVED_CONFIG_FILE)
    _append_log(f"[INFO] Saved configuration to {SAVED_CONFIG_FILE}")


def _load_saved_config() -> dict | None:
    if not os.path.isfile(SAVED_CONFIG_FILE):
        return None
    try:
        with open(SAVED_CONFIG_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _ensure_mmdvm_user_and_dirs() -> None:
    os.makedirs("/etc/mmdvm", exist_ok=True)
    os.makedirs("/var/log/mmdvm", exist_ok=True)
    if subprocess.run(["id", "-u", "mmdvm"], capture_output=True).returncode != 0:
        _run_cmd(["useradd", "--user-group", "-M", "--system", "mmdvm", "--shell", "/bin/false"], check=False)
    _run_cmd(["usermod", "-aG", "dialout", "mmdvm"], check=False)


def _write_mmdvm_files(cfg: dict, backup_existing: bool = True) -> None:
    st = cfg["station"]
    md = cfg["modem"]
    nw = cfg["networks"]
    full_id = f"{st['dmrId']}{st['essidSuffix']}" if st["essidSuffix"] else st["dmrId"]

    _ensure_mmdvm_user_and_dirs()

    if backup_existing and (os.path.isfile("/etc/mmdvm/MMDVM.ini") or os.path.isfile("/etc/mmdvm/DMRGateway.ini")):
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bdir = f"/etc/mmdvm/backup.{ts}"
        os.makedirs(bdir, exist_ok=True)
        for name in ("MMDVM.ini", "DMRGateway.ini"):
            src = os.path.join("/etc/mmdvm", name)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(bdir, name))
        _append_log(f"[INFO] Backed up previous INI files to {bdir}")

    mmdvm_ini = f"""; /etc/mmdvm/MMDVM.ini — Generated by MMDVM WebGUI Configurator
; Compatible with upstream g4klx/MMDVMHost (MMDVM-Host)

[General]
Callsign={st['callsign']}
Id={full_id}
Timeout=180
Duplex={'1' if st['duplex'] else '0'}
RFModeHang=10
NetModeHang=3
Daemon=0

[Log]
; 0=No logging, 1=Debug, 2=Message, 3=Info, 4=Warning, 5=Error, 6=Fatal
MQTTLevel=0
DisplayLevel=1

[MQTT]
Host=127.0.0.1
Port=1883
Auth=0
Username=mmdvm
Password=mmdvm
Keepalive=60
Name=host

[CW Id]
Enable={'1' if st['cwIdEnable'] else '0'}
Time={st['cwIdTimeMinutes']}
Callsign={st['callsign']}

[DMR Id Lookup]
File=/etc/mmdvm/DMRIds.dat
Time=24

[NXDN Id Lookup]
File=/etc/mmdvm/NXDN.csv
Time=24

[Modem]
Protocol={md['protocol']}
UARTPort={md['uartPort']}
UARTSpeed={md['uartSpeed']}
RXFrequency={st['_rxHz']}
TXFrequency={st['_txHz']}
RXInvert={'1' if md['rxInvert'] else '0'}
TXInvert={'1' if md['txInvert'] else '0'}
PTTInvert={'1' if md['pttInvert'] else '0'}
TXDelay={md['txDelay']}
RXOffset={st['rxOffset']}
TXOffset={st['txOffset']}
DMRDelay={md['dmrDelay']}
RXLevel={md['rxLevel']}
TXLevel={md['txLevel']}
RXDCOffset=0
TXDCOffset=0
RFLevel={st['rfPower']}
CWIdTXLevel=50
D-StarTXLevel=50
DMRTXLevel=50
YSFTXLevel=50
P25TXLevel=50
NXDNTXLevel=50
RSSIMappingFile=/etc/mmdvm/RSSI.dat
UseCOSAsLockout=0
Trace=0
Debug=0

[D-Star]
Enable={'1' if nw['dstarEnable'] else '0'}
Module={nw['dstarModule']}
SelfOnly=0
AckReply=1
AckTime=750
ErrorReply=1
RemoteGateway=0
ModeHang=10

[DMR]
Enable={'1' if nw['dmrEnable'] else '0'}
Beacons=0
ColorCode={nw['dmrColorCode']}
SelfOnly=0
EmbeddedLCOnly=0
DumpTAData=1
CallHang=3
TXHang=4
ModeHang=10
OVCM=0

[System Fusion]
Enable={'1' if nw['ysfEnable'] else '0'}
LowDeviation=0
RemoteGateway=0
SelfOnly=0
TXHang=4
ModeHang=10

[P25]
Enable={'1' if nw['p25Enable'] else '0'}
NAC={nw['p25Nac']}
OverrideUIDCheck=0
SelfOnly=0
RemoteGateway=0
ModeHang=10

[NXDN]
Enable={'1' if nw['nxdnEnable'] else '0'}
RAN={nw['nxdnRan']}
SelfOnly=0
RemoteGateway=0
ModeHang=10

[D-Star Network]
Enable={'1' if nw['dstarEnable'] else '0'}
LocalAddress=127.0.0.1
LocalPort=20011
GatewayAddress=127.0.0.1
GatewayPort=20010
ModeHang=3
Debug=0

[DMR Network]
Enable={'1' if nw['dmrEnable'] else '0'}
LocalAddress=127.0.0.1
LocalPort=62033
GatewayAddress=127.0.0.1
GatewayPort=62031
Jitter=360
Slot1={'1' if (st['duplex'] and nw['dmrSlot1']) else '0'}
Slot2={'1' if nw['dmrSlot2'] else '0'}
ModeHang=3
Debug=0

[System Fusion Network]
Enable={'1' if nw['ysfEnable'] else '0'}
LocalAddress=127.0.0.1
LocalPort=3200
GatewayAddress={nw['ysfGatewayHost']}
GatewayPort={nw['ysfGatewayPort']}
ModeHang=3
Debug=0

[P25 Network]
Enable={'1' if nw['p25Enable'] else '0'}
LocalAddress=127.0.0.1
LocalPort=32010
GatewayAddress=127.0.0.1
GatewayPort=42020
ModeHang=3
Debug=0

[NXDN Network]
Enable={'1' if nw['nxdnEnable'] else '0'}
Protocol=Icom
LocalAddress=127.0.0.1
LocalPort=14021
GatewayAddress=127.0.0.1
GatewayPort=14020
ModeHang=3
Debug=0

[Lock File]
Enable=0
File=/tmp/MMDVM_Active.lck

[Remote Control]
Enable=0
"""

    dmr_net_enabled = "1" if (nw["dmrEnable"] and nw["dmrMasterHost"]) else "0"
    dmrgw_ini = f"""; /etc/mmdvm/DMRGateway.ini — Generated by MMDVM WebGUI Configurator
[General]
Id={full_id}
Timeout=10
RptAddress=127.0.0.1
RptPort=62033
LocalAddress=127.0.0.1
LocalPort=62031
RuleTrace=0
Daemon=0
TrunkingEnabled=0
Debug=0

[Log]
DisplayLevel=1
MQTTLevel=0

[Voice]
Enabled=0
Language=en_GB
Directory=/etc/mmdvm/Audio

[Info]
Callsign={st['callsign']}
TXFrequency={st['_txHz']}
RXFrequency={st['_rxHz']}
Power=1
ColorCode={nw['dmrColorCode']}
Duplex={'1' if st['duplex'] else '0'}
Slot1={'1' if (st['duplex'] and nw['dmrSlot1']) else '0'}
Slot2={'1' if nw['dmrSlot2'] else '0'}
Latitude={st['latitude']}
Longitude={st['longitude']}
Height={st['heightMeters']}
Location={st['location']}
Description={st['description']}
URL={st['url']}

[XLX Network]
Enabled=0
File=/etc/mmdvm/XLXHosts.txt
Port=62030
Password=passw0rd
ReloadTime=60
Slot=1
TG=6
Base=64000
Startup=950
Relink=10
Debug=0
UserControl=1

[DMR Network 1]
Enabled={dmr_net_enabled}
Name={nw['dmrMasterName']}
Address={nw['dmrMasterHost']}
Port={nw['dmrMasterPort']}
Password={nw['dmrMasterPassword']}
PassAllTG=1
PassAllTG=2
PassAllPC=1
PassAllPC=2
Location=0
Debug=0

[GPSD]
Enable=0
Address=127.0.0.1
Port=2947

[APRS]
Enable=0

[MQTT]
Address=127.0.0.1
Port=1883
Keepalive=60
Auth=0
Username=mmdvm
Password=mmdvm
Name=dmr-gateway

[Dynamic TG Control]
Enable=0

[Remote Commands]
Enable=0
"""

    with open("/etc/mmdvm/MMDVM.ini", "w", encoding="utf-8") as fh:
        fh.write(mmdvm_ini)
    with open("/etc/mmdvm/DMRGateway.ini", "w", encoding="utf-8") as fh:
        fh.write(dmrgw_ini)

    for data_file in ("DMRIds.dat", "NXDN.csv", "RSSI.dat"):
        dst = os.path.join("/etc/mmdvm", data_file)
        src = os.path.join("/usr/local/src/MMDVMHost", data_file)
        if not os.path.exists(dst):
            if os.path.isfile(src):
                shutil.copy2(src, dst)
            else:
                Path(dst).touch()

    _run_cmd(["chown", "-R", "mmdvm:mmdvm", "/etc/mmdvm", "/var/log/mmdvm"], check=False)
    try:
        os.chmod("/etc/mmdvm/DMRGateway.ini", 0o640)
    except OSError:
        pass
    _append_log("[INFO] Wrote /etc/mmdvm/MMDVM.ini and /etc/mmdvm/DMRGateway.ini")

    dmrgw_svc = """[Unit]
Description=DMRGateway Digital Voice Network Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mmdvm
Group=mmdvm
ExecStart=/usr/local/bin/DMRGateway /etc/mmdvm/DMRGateway.ini
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
"""
    mmdvm_svc = """[Unit]
Description=MMDVMHost Digital Voice RF Modem Service
After=network-online.target dmrgateway.service
Wants=network-online.target dmrgateway.service

[Service]
Type=simple
User=mmdvm
Group=mmdvm
SupplementaryGroups=dialout
ExecStart=/usr/local/bin/MMDVMHost /etc/mmdvm/MMDVM.ini
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
"""
    with open("/etc/systemd/system/dmrgateway.service", "w", encoding="utf-8") as fh:
        fh.write(dmrgw_svc)
    with open("/etc/systemd/system/mmdvmhost.service", "w", encoding="utf-8") as fh:
        fh.write(mmdvm_svc)
    _append_log("[INFO] Wrote dmrgateway.service and mmdvmhost.service")


def _log_service_health_snapshot() -> None:
    time.sleep(2)
    for unit in ("dmrgateway", "mmdvmhost"):
        st = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True).stdout.strip() or "inactive"
        _append_log(f"[STATUS] {unit}.service -> {st}")
        if st != "active":
            j = subprocess.run(
                ["journalctl", "-u", unit, "-n", "8", "--no-pager", "-o", "cat"],
                capture_output=True,
                text=True,
            )
            for line in j.stdout.splitlines():
                if line.strip():
                    _append_log(f"  [{unit}] {line.strip()}")


def _run_install_worker(cfg: dict) -> None:
    md = cfg["modem"]
    nw = cfg["networks"]
    sy = cfg["system"]
    env = dict(os.environ)
    env["DEBIAN_FRONTEND"] = "noninteractive"
    nproc = str(os.cpu_count() or 2)

    try:
        # 1. System Dependencies & MMDVM User
        _set_step(1, "Install Build Dependencies, Configure Host & MMDVM User")
        _save_config(cfg)
        _run_cmd(["hostnamectl", "set-hostname", sy["hostname"]], check=False)
        _run_cmd(["timedatectl", "set-timezone", sy["timezone"]], check=False)
        _run_cmd(["apt-get", "update", "-y"], env=env)
        _run_cmd(
            [
                "apt-get",
                "install",
                "-y",
                "--no-install-recommends",
                "git",
                "curl",
                "ca-certificates",
                "build-essential",
                "g++",
                "make",
                "nlohmann-json3-dev",
                "libmosquitto-dev",
                "libsamplerate0-dev",
            ],
            env=env,
        )
        _ensure_mmdvm_user_and_dirs()
        if md["configurePiUart"] and shutil.which("raspi-config"):
            _append_log("[INFO] Configuring Raspberry Pi hardware UART via raspi-config...")
            _run_cmd(["raspi-config", "nonint", "do_serial_hw", "0"], check=False)
            _run_cmd(["raspi-config", "nonint", "do_serial_cons", "1"], check=False)

        # 2. Build & Install MMDVMHost
        _set_step(2, "Clone, Compile & Install g4klx/MMDVMHost")
        host_src = "/usr/local/src/MMDVMHost"
        if os.path.isdir(host_src):
            shutil.rmtree(host_src)
        _run_cmd(["git", "clone", "--depth", "1", "https://github.com/g4klx/MMDVMHost.git", host_src])
        _run_cmd(["make", "-C", host_src, f"-j{nproc}"])
        built_bin = f"{host_src}/MMDVM-Host" if os.path.isfile(f"{host_src}/MMDVM-Host") else f"{host_src}/MMDVMHost"
        _run_cmd(["install", "-m", "0755", built_bin, "/usr/local/bin/MMDVMHost"])

        # 3. Build & Install DMRGateway
        _set_step(3, "Clone, Compile & Install g4klx/DMRGateway")
        gw_src = "/usr/local/src/DMRGateway"
        if os.path.isdir(gw_src):
            shutil.rmtree(gw_src)
        _run_cmd(["git", "clone", "--depth", "1", "https://github.com/g4klx/DMRGateway.git", gw_src])
        _run_cmd(["make", "-C", gw_src, f"-j{nproc}"])
        _run_cmd(["install", "-m", "0755", f"{gw_src}/DMRGateway", "/usr/local/bin/DMRGateway"])

        # 4. Write Config Files, Lookup Data, Firewall & Start Services
        _set_step(4, "Write Configs, Download DMR IDs & Start Services")
        _run_cmd(["curl", "-fsSL", "https://radioid.net/static/user.csv", "-o", "/etc/mmdvm/DMRIds.dat"], check=False)
        _write_mmdvm_files(cfg, backup_existing=True)

        if sy["enableUfw"]:
            _run_cmd(["apt-get", "install", "-y", "ufw"], env=env, check=False)
            _run_cmd(["ufw", "default", "deny", "incoming"], check=False)
            _run_cmd(["ufw", "default", "allow", "outgoing"], check=False)
            _run_cmd(["ufw", "allow", f"{sy['sshPort']}/tcp", "comment", "SSH"], check=False)
            _run_cmd(["ufw", "allow", f"{PORT}/tcp", "comment", "MMDVM WebGUI"], check=False)
            if nw["dmrEnable"]:
                _run_cmd(["ufw", "allow", f"{nw['dmrMasterPort']}/udp", "comment", "DMR Master"], check=False)
            _run_cmd(["ufw", "--force", "enable"], check=False)

        _run_cmd(["systemctl", "daemon-reload"])
        if nw["dmrEnable"]:
            _run_cmd(["systemctl", "enable", "--now", "dmrgateway.service"], check=False)
            _run_cmd(["systemctl", "restart", "dmrgateway.service"], check=False)
        else:
            _run_cmd(["systemctl", "disable", "--now", "dmrgateway.service"], check=False)

        _run_cmd(["systemctl", "enable", "--now", "mmdvmhost.service"], check=False)
        _run_cmd(["systemctl", "restart", "mmdvmhost.service"], check=False)
        _log_service_health_snapshot()

        _append_log("========================================================================")
        _append_log(f" MMDVM Installation Complete — {cfg['station']['callsign']}")
        _append_log("========================================================================")

        with job_lock:
            job_state["status"] = "succeeded"
            job_state["exitCode"] = 0
            job_state["finishedAt"] = _now_iso()
    except Exception as exc:
        _append_log(f"[ERROR] {exc}")
        with job_lock:
            job_state["status"] = "failed"
            job_state["exitCode"] = 1
            job_state["error"] = str(exc)
            job_state["finishedAt"] = _now_iso()


def _run_apply_config_worker(cfg: dict) -> None:
    nw = cfg["networks"]
    sy = cfg["system"]
    md = cfg["modem"]

    try:
        # 1. Save config & update host settings (NO apt/compile!)
        _set_step(1, "Save Configuration & Update Host Settings")
        _save_config(cfg)
        _run_cmd(["hostnamectl", "set-hostname", sy["hostname"]], check=False)
        _run_cmd(["timedatectl", "set-timezone", sy["timezone"]], check=False)
        if md["protocol"] == "uart" and not os.path.exists(md["uartPort"]):
            _append_log(
                f"[WARN] Serial device {md['uartPort']} does not currently exist on this host. "
                "MMDVMHost will fail to open the modem until the port exists or Null Modem is selected."
            )

        # 2. Write /etc/mmdvm/MMDVM.ini & /etc/mmdvm/DMRGateway.ini (no reinstall)
        _set_step(2, "Write MMDVM.ini, DMRGateway.ini & Systemd Units")
        _write_mmdvm_files(cfg, backup_existing=True)

        # 3. Reload systemd & restart services
        _set_step(3, "Reload & Restart MMDVM Services")
        _run_cmd(["systemctl", "daemon-reload"], check=False)
        if nw["dmrEnable"]:
            if os.path.isfile("/usr/local/bin/DMRGateway"):
                _run_cmd(["systemctl", "enable", "--now", "dmrgateway.service"], check=False)
                _run_cmd(["systemctl", "restart", "dmrgateway.service"], check=False)
            else:
                _append_log("[WARN] /usr/local/bin/DMRGateway is not installed yet — run the Installer tab once to compile binaries.")
        else:
            _run_cmd(["systemctl", "stop", "dmrgateway.service"], check=False)

        if os.path.isfile("/usr/local/bin/MMDVMHost"):
            _run_cmd(["systemctl", "enable", "--now", "mmdvmhost.service"], check=False)
            _run_cmd(["systemctl", "restart", "mmdvmhost.service"], check=False)
        else:
            _append_log("[WARN] /usr/local/bin/MMDVMHost is not installed yet — run the Installer tab once to compile binaries.")

        _log_service_health_snapshot()

        _append_log("========================================================================")
        _append_log(" Config Files Applied & Services Reloaded (No Reinstall)")
        _append_log("========================================================================")

        with job_lock:
            job_state["status"] = "succeeded"
            job_state["exitCode"] = 0
            job_state["finishedAt"] = _now_iso()
    except Exception as exc:
        _append_log(f"[ERROR] {exc}")
        with job_lock:
            job_state["status"] = "failed"
            job_state["exitCode"] = 1
            job_state["error"] = str(exc)
            job_state["finishedAt"] = _now_iso()


def _detect_serial_ports() -> list[str]:
    ports: list[str] = []
    dev_dir = Path("/dev")
    for pattern in ("ttyAMA*", "serial0", "ttyACM*", "ttyUSB*"):
        for candidate in sorted(dev_dir.glob(pattern)):
            s = str(candidate)
            if s not in ports:
                ports.append(s)
    return ports


def _get_service_states() -> dict[str, str]:
    result: dict[str, str] = {}
    for svc in ALLOWED_SERVICES:
        try:
            proc = subprocess.run(["systemctl", "is-active", svc], capture_output=True, text=True, timeout=3)
            result[svc] = proc.stdout.strip() or "inactive"
        except Exception:
            result[svc] = "unknown"
    return result


def _read_host_metrics() -> tuple[int | None, float | None]:
    uptime_s: int | None = None
    cpu_temp_c: float | None = None
    try:
        raw = Path("/proc/uptime").read_text(encoding="utf-8").split()[0]
        uptime_s = int(float(raw))
    except Exception:
        pass
    try:
        raw_t = Path("/sys/class/thermal/thermal_zone0/temp").read_text(encoding="utf-8").strip()
        cpu_temp_c = round(int(raw_t) / 1000.0, 1)
    except Exception:
        pass
    return uptime_s, cpu_temp_c


_dmr_id_cache: dict[str, str] = {}
_dmr_id_mtime: float = 0.0


def _load_dmr_id_map() -> dict[str, str]:
    global _dmr_id_cache, _dmr_id_mtime
    path = "/etc/mmdvm/DMRIds.dat"
    if not os.path.isfile(path):
        return _dmr_id_cache
    try:
        mtime = os.path.getmtime(path)
        if mtime == _dmr_id_mtime and _dmr_id_cache:
            return _dmr_id_cache
        mapping: dict[str, str] = {}
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith("RADIO_ID"):
                    continue
                parts = re.split(r"[\t, ]+", line)
                if len(parts) >= 2 and parts[0].isdigit():
                    mapping[parts[0]] = parts[1].strip()
        _dmr_id_cache = mapping
        _dmr_id_mtime = mtime
    except OSError:
        pass
    return _dmr_id_cache


def _resolve_callsign(raw: str, dmr_map: dict[str, str]) -> tuple[str, str]:
    cleaned = raw.strip()
    if cleaned.isdigit():
        return dmr_map.get(cleaned, cleaned), cleaned
    return cleaned, ""


def _parse_log_timestamp(line: str) -> tuple[str, float]:
    m = re.search(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})", line)
    if m:
        ts_str = f"{m.group(1)} {m.group(2)}"
        try:
            dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            return m.group(2), dt.timestamp()
        except ValueError:
            return m.group(2), time.time()
    return "—", time.time()


def _get_journal_lines(unit: str, count: int = 120) -> list[str]:
    try:
        proc = subprocess.run(
            ["journalctl", "-u", unit, "-n", str(count), "--no-pager", "-o", "short-iso"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return proc.stdout.splitlines() if proc.stdout else []
    except Exception:
        return []


def _collect_live_telemetry() -> dict:
    services = _get_service_states()
    uptime_s, cpu_temp_c = _read_host_metrics()
    dmr_map = _load_dmr_id_map()

    host_lines = _get_journal_lines("mmdvmhost", 200)
    gw_lines = _get_journal_lines("dmrgateway", 100)

    re_dmr_start = re.compile(
        r"DMR Slot (\d), received (RF|network) voice header from (\S+) to (TG \S+|\S+)",
        re.IGNORECASE,
    )
    re_dmr_end = re.compile(
        r"DMR Slot (\d), (?:received (RF|network) end of voice transmission|(RF|network) voice transmission) from (\S+) to (TG \S+|\S+),\s*([0-9.]+)\s*seconds(?:,\s*([0-9.]+)%\s*packet loss)?(?:,\s*BER:\s*([0-9.]+)%)?",
        re.IGNORECASE,
    )
    re_ysf_start = re.compile(r"YSF, received (RF|network) data from ([A-Z0-9/_ -]+?) to ([A-Z0-9/_ -]+)", re.IGNORECASE)
    re_ysf_end = re.compile(
        r"YSF, received (RF|network) end of transmission from ([A-Z0-9/_ -]+?) to ([A-Z0-9/_ -]+),\s*([0-9.]+)\s*seconds(?:,\s*([0-9.]+)%\s*packet loss)?(?:,\s*BER:\s*([0-9.]+)%)?",
        re.IGNORECASE,
    )
    re_dstar_start = re.compile(r"D-Star, received (RF|network) header from ([A-Z0-9/ ]+?)\s+to\s+([A-Z0-9/ ]+)", re.IGNORECASE)
    re_dstar_end = re.compile(
        r"D-Star, received (RF|network) end of transmission from ([A-Z0-9/ ]+?)\s+to\s+([A-Z0-9/ ]+?),\s*([0-9.]+)\s*seconds(?:,\s*([0-9.]+)%\s*packet loss)?(?:,\s*BER:\s*([0-9.]+)%)?",
        re.IGNORECASE,
    )
    re_err = re.compile(r"\b(?:E:|F:|Cannot open|Unable to|socket error|Error returned|Failed)\b", re.IGNORECASE)

    active_slots: dict[str, dict] = {}
    recent: list[dict] = []
    host_last_err: str | None = None
    now_ts = time.time()

    for idx, line in enumerate(host_lines):
        if re_err.search(line):
            cleaned = re.sub(r"^\S+\s+\S+\s+\S+?:\s*", "", line).strip()
            if cleaned:
                host_last_err = cleaned[:240]

        ts_label, ts_epoch = _parse_log_timestamp(line)

        m = re_dmr_start.search(line)
        if m:
            slot, src, who, target = m.group(1), m.group(2), m.group(3), m.group(4).rstrip(",")
            call, dmr_id = _resolve_callsign(who, dmr_map)
            key = f"DMR Slot {slot}"
            active_slots[key] = {
                "id": f"dmr-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": call,
                "dmrId": dmr_id,
                "mode": key,
                "modeGroup": "DMR",
                "source": "RF" if src.upper() == "RF" else "Net",
                "target": target,
                "duration": "Live",
                "loss": "—",
                "ber": "—",
                "active": True,
            }
            continue

        m = re_dmr_end.search(line)
        if m:
            slot = m.group(1)
            src = m.group(2) or m.group(3) or "Net"
            who, target = m.group(4), m.group(5).rstrip(",")
            call, dmr_id = _resolve_callsign(who, dmr_map)
            key = f"DMR Slot {slot}"
            active_slots.pop(key, None)
            recent.append(
                {
                    "id": f"dmr-end-{idx}",
                    "timestamp": ts_label,
                    "_epoch": ts_epoch,
                    "callsign": call,
                    "dmrId": dmr_id,
                    "mode": key,
                    "modeGroup": "DMR",
                    "source": "RF" if src.upper() == "RF" else "Net",
                    "target": target,
                    "duration": f"{m.group(6)}s" if m.group(6) else "—",
                    "loss": f"{m.group(7)}%" if m.group(7) else "—",
                    "ber": f"{m.group(8)}%" if m.group(8) else "—",
                    "active": False,
                }
            )
            continue

        m = re_ysf_end.search(line)
        if m:
            active_slots.pop("YSF", None)
            recent.append(
                {
                    "id": f"ysf-end-{idx}",
                    "timestamp": ts_label,
                    "_epoch": ts_epoch,
                    "callsign": m.group(2).strip(),
                    "dmrId": "",
                    "mode": "YSF",
                    "modeGroup": "YSF",
                    "source": "RF" if m.group(1).upper() == "RF" else "Net",
                    "target": m.group(3).strip(),
                    "duration": f"{m.group(4)}s" if m.group(4) else "—",
                    "loss": f"{m.group(5)}%" if m.group(5) else "—",
                    "ber": f"{m.group(6)}%" if m.group(6) else "—",
                    "active": False,
                }
            )
            continue

        m = re_ysf_start.search(line)
        if m:
            active_slots["YSF"] = {
                "id": f"ysf-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": m.group(2).strip(),
                "dmrId": "",
                "mode": "YSF",
                "modeGroup": "YSF",
                "source": "RF" if m.group(1).upper() == "RF" else "Net",
                "target": m.group(3).strip(),
                "duration": "Live",
                "loss": "—",
                "ber": "—",
                "active": True,
            }
            continue

        m = re_dstar_end.search(line)
        if m:
            active_slots.pop("D-Star", None)
            recent.append(
                {
                    "id": f"dstar-end-{idx}",
                    "timestamp": ts_label,
                    "_epoch": ts_epoch,
                    "callsign": " ".join(m.group(2).split()),
                    "dmrId": "",
                    "mode": "D-Star",
                    "modeGroup": "D-Star",
                    "source": "RF" if m.group(1).upper() == "RF" else "Net",
                    "target": " ".join(m.group(3).split()),
                    "duration": f"{m.group(4)}s" if m.group(4) else "—",
                    "loss": f"{m.group(5)}%" if m.group(5) else "—",
                    "ber": f"{m.group(6)}%" if m.group(6) else "—",
                    "active": False,
                }
            )
            continue

        m = re_dstar_start.search(line)
        if m:
            active_slots["D-Star"] = {
                "id": f"dstar-{idx}",
                "timestamp": ts_label,
                "_epoch": ts_epoch,
                "callsign": " ".join(m.group(2).split()),
                "dmrId": "",
                "mode": "D-Star",
                "modeGroup": "D-Star",
                "source": "RF" if m.group(1).upper() == "RF" else "Net",
                "target": " ".join(m.group(3).split()),
                "duration": "Live",
                "loss": "—",
                "ber": "—",
                "active": True,
            }

    gw_last_err: str | None = None
    dmr_logged_in = False
    for line in gw_lines:
        if "Logged into the master successfully" in line:
            dmr_logged_in = True
        if "Connection to the master has timed out" in line or "Closing DMR Network" in line:
            dmr_logged_in = False
        if re_err.search(line):
            cleaned = re.sub(r"^\S+\s+\S+\s+\S+?:\s*", "", line).strip()
            if cleaned:
                gw_last_err = cleaned[:240]

    active_out = []
    for item in active_slots.values():
        if now_ts - item.get("_epoch", now_ts) <= 180:
            active_out.append({k: v for k, v in item.items() if not k.startswith("_")})
    recent.sort(key=lambda x: x.get("_epoch", 0), reverse=True)
    recent_out = [{k: v for k, v in item.items() if not k.startswith("_")} for item in recent[:40]]

    return {
        "timestamp": _now_iso(),
        "hostname": socket.gethostname(),
        "uptimeSeconds": uptime_s,
        "cpuTempC": cpu_temp_c,
        "detectedSerialPorts": _detect_serial_ports(),
        "installed": {
            "mmdvmhost": os.path.isfile("/usr/local/bin/MMDVMHost"),
            "dmrgateway": os.path.isfile("/usr/local/bin/DMRGateway"),
            "configWritten": os.path.isfile("/etc/mmdvm/MMDVM.ini"),
        },
        "services": services,
        "dmrMasterConnected": dmr_logged_in and services.get("dmrgateway") == "active",
        "mmdvmhostLastError": host_last_err,
        "dmrgatewayLastError": gw_last_err,
        "activeTransmissions": active_out,
        "recentUsers": recent_out,
    }


class WebGuiHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def _send_json(self, code: int, data: dict) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length.") from exc
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("Request body too large.")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise ValueError("Malformed JSON body.") from exc
        if not isinstance(parsed, dict):
            raise ValueError("Expected JSON object.")
        return parsed

    def _require_auth(self) -> tuple[str | None, str | None]:
        tok, user = _validate_bearer(self.headers.get("Authorization"))
        if not tok:
            self._send_json(401, {"error": "Authentication required. Please sign in."})
            return None, None
        return tok, user

    def _resolve_static_path(self, raw_path: str) -> str:
        rel = raw_path.split("?", 1)[0].lstrip("/")
        candidate = os.path.realpath(os.path.join(DIST_DIR, rel))
        if rel and (candidate == DIST_DIR or candidate.startswith(DIST_DIR + os.sep)) and os.path.isfile(candidate):
            return "/" + os.path.relpath(candidate, DIST_DIR)
        return "/index.html"

    def do_HEAD(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/"):
            self.send_response(405)
            self.end_headers()
            return
        self.path = self._resolve_static_path(self.path)
        return super().do_HEAD()

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path

        if path == "/api/auth/status":
            tok, user = _validate_bearer(self.headers.get("Authorization"))
            self._send_json(
                200,
                {
                    "hostAvailable": True,
                    "hostname": socket.gethostname(),
                    "isRoot": os.geteuid() == 0,
                    "authConfigured": _is_auth_configured(),
                    "envManaged": bool(ENV_ADMIN_PASSWORD),
                    "usernameHint": _get_username_hint(),
                    "authenticated": bool(tok),
                    "username": user,
                },
            )
            return

        if path == "/api/status":
            tok, _ = self._require_auth()
            if not tok:
                return
            with job_lock:
                job_snap = dict(job_state)
                job_snap["logs"] = list(job_state["logs"])
            self._send_json(
                200,
                {
                    "hostname": socket.gethostname(),
                    "isRoot": os.geteuid() == 0,
                    "detectedSerialPorts": _detect_serial_ports(),
                    "installed": {
                        "mmdvmhost": os.path.isfile("/usr/local/bin/MMDVMHost"),
                        "dmrgateway": os.path.isfile("/usr/local/bin/DMRGateway"),
                        "configWritten": os.path.isfile("/etc/mmdvm/MMDVM.ini"),
                    },
                    "services": _get_service_states(),
                    "savedConfig": _load_saved_config(),
                    "job": job_snap,
                },
            )
            return

        if path == "/api/live":
            tok, _ = self._require_auth()
            if not tok:
                return
            self._send_json(200, _collect_live_telemetry())
            return

        if path == "/api/job":
            tok, _ = self._require_auth()
            if not tok:
                return
            with job_lock:
                job_snap = dict(job_state)
                job_snap["logs"] = list(job_state["logs"])
            self._send_json(200, job_snap)
            return

        if path == "/api/logs":
            tok, _ = self._require_auth()
            if not tok:
                return
            qs = urllib.parse.parse_qs(parsed.query)
            unit = (qs.get("unit", ["mmdvmhost"])[0] or "mmdvmhost").strip()
            if unit not in ALLOWED_SERVICES:
                self._send_json(400, {"error": "Invalid service unit requested."})
                return
            try:
                lines_n = max(10, min(250, int(qs.get("lines", ["80"])[0])))
            except ValueError:
                lines_n = 80
            self._send_json(
                200,
                {
                    "unit": unit,
                    "lines": _get_journal_lines(unit, lines_n),
                },
            )
            return

        self.path = self._resolve_static_path(self.path)
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        client_ip = self.client_address[0] if self.client_address else "unknown"

        if path == "/api/auth/setup":
            if _is_auth_configured():
                self._send_json(409, {"error": "Administrator account is already configured. Please sign in."})
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            username = _clean_line(body.get("username", "admin")) or "admin"
            password = body.get("password")
            if not re.fullmatch(r"[a-zA-Z0-9._-]{3,32}", username):
                self._send_json(400, {"error": "Username must be 3–32 letters, numbers, dots, underscores, or hyphens."})
                return
            if not isinstance(password, str) or len(password) < 8:
                self._send_json(400, {"error": "Password must be at least 8 characters long."})
                return
            try:
                _save_admin_record(username, password)
            except OSError as exc:
                self._send_json(500, {"error": f"Failed to save administrator credentials: {exc}"})
                return
            token = _issue_session_token(username)
            self._send_json(200, {"token": token, "username": username})
            return

        if path == "/api/auth/login":
            if _is_rate_limited(client_ip):
                self._send_json(429, {"error": "Too many failed sign-in attempts. Wait 60 seconds and try again."})
                return
            if not _is_auth_configured():
                self._send_json(409, {"error": "Admin account is not set up yet. Create your admin account first."})
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            username = _clean_line(body.get("username", ""))
            password = body.get("password", "")
            ok, resolved_user = _verify_credentials(username, password)
            if not ok:
                _record_login_failure(client_ip)
                self._send_json(401, {"error": "Invalid username or password."})
                return
            _clear_login_failures(client_ip)
            token = _issue_session_token(resolved_user)
            self._send_json(200, {"token": token, "username": resolved_user})
            return

        if path == "/api/auth/logout":
            tok, _ = self._require_auth()
            if not tok:
                return
            with auth_lock:
                sessions.pop(tok, None)
            self._send_json(200, {"ok": True})
            return

        if path == "/api/auth/password":
            tok, user = self._require_auth()
            if not tok or not user:
                return
            if ENV_ADMIN_PASSWORD:
                self._send_json(409, {"error": "Password is managed by MMDVM_WEBGUI_ADMIN_PASSWORD environment variable."})
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            current_pw = body.get("currentPassword", "")
            new_pw = body.get("newPassword", "")
            ok, resolved_user = _verify_credentials(user, current_pw)
            if not ok:
                self._send_json(401, {"error": "Current password is incorrect."})
                return
            if not isinstance(new_pw, str) or len(new_pw) < 8:
                self._send_json(400, {"error": "New password must be at least 8 characters long."})
                return
            _save_admin_record(resolved_user, new_pw)
            self._send_json(200, {"ok": True})
            return

        if path in ("/api/install", "/api/apply-config"):
            tok, _ = self._require_auth()
            if not tok:
                return
            if os.geteuid() != 0:
                self._send_json(403, {"error": "Server must run as root to write /etc/mmdvm files and manage services."})
                return
            try:
                body = self._read_json_body()
                cfg = _validate_config(body)
            except (ValueError, TypeError) as exc:
                self._send_json(400, {"error": str(exc)})
                return

            is_install = path == "/api/install"
            with job_lock:
                if job_state["status"] == "running":
                    self._send_json(409, {"error": "An installation or config update is already running."})
                    return
                job_state.update(
                    {
                        "mode": "install" if is_install else "apply",
                        "status": "running",
                        "step": "Starting MMDVM installer..." if is_install else "Applying configuration files...",
                        "stepIndex": 0,
                        "totalSteps": 4 if is_install else 3,
                        "startedAt": _now_iso(),
                        "finishedAt": None,
                        "exitCode": None,
                        "error": None,
                        "logs": [
                            f"[{_now_iso()}] {'Starting full MMDVMHost + DMRGateway install' if is_install else 'Applying edited MMDVM configuration (no reinstall)'} on {socket.gethostname()}..."
                        ],
                    }
                )

            worker = _run_install_worker if is_install else _run_apply_config_worker
            threading.Thread(target=worker, args=(cfg,), daemon=True).start()
            self._send_json(202, {"status": "running", "mode": "install" if is_install else "apply"})
            return

        if path == "/api/service":
            tok, _ = self._require_auth()
            if not tok:
                return
            if os.geteuid() != 0:
                self._send_json(403, {"error": "Server must run as root to control systemd services."})
                return
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            unit = _clean_line(body.get("unit", ""))
            action = _clean_line(body.get("action", ""))
            if unit not in ALLOWED_SERVICES or action not in ALLOWED_ACTIONS:
                self._send_json(400, {"error": "Invalid service unit or action."})
                return
            proc = subprocess.run(
                ["systemctl", action, f"{unit}.service"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            state = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True, timeout=3).stdout.strip() or "inactive"
            if proc.returncode != 0:
                self._send_json(500, {"error": (proc.stderr or proc.stdout).strip() or f"Failed to {action} {unit}.", "state": state})
                return
            self._send_json(200, {"ok": True, "unit": unit, "action": action, "state": state})
            return

        self._send_json(404, {"error": "Unknown API endpoint."})


def main() -> None:
    if not os.path.isdir(DIST_DIR):
        raise SystemExit(f"Build directory not found: {DIST_DIR}. Run 'npm run build' first.")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), WebGuiHandler)
    print(f"MMDVM WebGUI listening on http://0.0.0.0:{PORT} (serving {DIST_DIR})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
