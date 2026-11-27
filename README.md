# AllStarLink Guided Install WebGUI

Interactive dashboard, configuration wizard, and automated node installer for **AllStarLink 3 (ASL3)**, **DVSwitch Server**, and **MMDVMHost** on fresh **Raspberry Pi OS** (Bookworm / Trixie 64-bit) and **Debian 13 (Trixie)** nodes.

## GitHub Installation (Raspberry Pi / Debian 13)

### Option 1: One-Line GitHub Install

```bash
curl -fsSL https://raw.githubusercontent.com/shawpbx/AllStarLink-Guided-Install-WebGUI/main/install.sh | sudo bash
```

Custom port example (`--port 8080`):

```bash
curl -fsSL https://raw.githubusercontent.com/shawpbx/AllStarLink-Guided-Install-WebGUI/main/install.sh | sudo bash -s -- --port 8080
```

### Option 2: Git Clone & Install

```bash
git clone https://github.com/shawpbx/AllStarLink-Guided-Install-WebGUI.git
cd AllStarLink-Guided-Install-WebGUI
sudo bash install.sh
```

Once installed, open the WebGUI in your browser at:

```text
http://<node-ip>:8080
```

## Direct On-Node Installation

When running the WebGUI directly on your Raspberry Pi or Debian 13 node:

1. Configure your AllStarLink 3, DVSwitch Server, and MMDVMHost settings in the **Configure** tab.
2. Click **Install on This Node** (or finish Step 5).
3. On first use, set a local admin password (stored as a salted scrypt hash in `/etc/allstarlink-webgui/admin.hash`, or override via `ASL_WEBGUI_ADMIN_PASSWORD`).
4. Click **Run Install Now** to execute the full installation directly on the node with live progress and log streaming—no script download or `scp` required.

## Official Raspberry Pi ASL3 Appliance Image

If starting from a blank SD card on Raspberry Pi 5, 4, 3, or Zero 2 W, you can flash the official **AllStarLink 3 (Trixie)** appliance image first:

1. Open **Raspberry Pi Imager** → **App Options** → **Content Repository** → **Use custom URL**.
2. Enter `https://rpi.allstarlink.org/latest.json` and click **Apply & Restart**.
3. Select your Raspberry Pi model and flash **AllStarLink (Trixie)**.
4. Boot the Pi, run the GitHub one-line install above, and use **Install on This Node** (existing ASL3 packages are detected automatically while writing your node configs and installing optional DVSwitch / MMDVMHost).

## Updating from GitHub

```bash
cd /opt/allstarlink-webgui
sudo git pull
sudo bash install.sh
```

## Uninstalling the WebGUI Service

```bash
sudo bash /opt/allstarlink-webgui/install.sh --uninstall
```

## What the Node Installer Configures

- **AllStarLink 3 (`asl3`, `asl3-asterisk`, `asl3-menu`)**: Generates `/etc/asterisk/rpt.conf`, `iax.conf`, `extensions.conf`, `simpleusb.conf`, and `manager.conf` with clean operator-supplied node numbers and secrets.
- **DVSwitch Server (`mmdvm-bridge`, `analog-bridge`, `md380-emu`)**: Optional private-node (`chan_usrp`) or direct USRP bridging to DMR, YSF, P25, NXDN, and D-Star networks.
- **MMDVMHost (`g4klx/MMDVMHost`)**: Optional source build from GitHub with Raspberry Pi GPIO UART configuration (`/dev/ttyAMA0`), `/etc/mmdvm/MMDVM.ini`, `DMRIds.dat`, and `mmdvmhost.service`.
- **On-Node HTML Dashboard & Security**: Deploys `asl-dashboard.service` along with optional Allmon3, Cockpit, UFW firewall rules, and Fail2Ban.

## Local Development

```bash
npm install
npm run dev
```
