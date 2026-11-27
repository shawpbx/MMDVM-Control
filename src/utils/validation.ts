import { MmdvmConfiguration, ValidationIssue } from '../types/mmdvmConfig';

export function mhzToHz(mhzRaw: string): number | null {
  const cleaned = mhzRaw.trim();
  if (!cleaned) return null;
  const val = Number(cleaned);
  if (!Number.isFinite(val) || val <= 0) return null;
  return Math.round(val * 1_000_000);
}

export function validateMmdvmConfig(
  config: MmdvmConfiguration,
  detectedPorts?: string[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { station, modem, networks, system } = config;

  // Station validation
  const call = station.callsign.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,10}$/.test(call)) {
    issues.push({
      id: 'callsign-invalid',
      tab: 'station',
      field: 'callsign',
      severity: 'error',
      message: 'Callsign must be 3–10 alphanumeric characters (for example, W7ABC).',
    });
  } else if (call === 'N0CALL') {
    issues.push({
      id: 'callsign-placeholder',
      tab: 'station',
      field: 'callsign',
      severity: 'warning',
      message: 'Replace the placeholder callsign N0CALL with your licensed callsign before transmitting.',
    });
  }

  if (networks.dmrEnable && !/^\d{6,7}$/.test(station.dmrId.trim())) {
    issues.push({
      id: 'dmr-id-invalid',
      tab: 'station',
      field: 'dmrId',
      severity: 'error',
      message: 'DMR ID must be a 6- or 7-digit RadioID number when DMR is enabled.',
    });
  }

  if (station.essidSuffix.trim() && !/^\d{2}$/.test(station.essidSuffix.trim())) {
    issues.push({
      id: 'essid-invalid',
      tab: 'station',
      field: 'essidSuffix',
      severity: 'error',
      message: 'ESSID suffix must be 2 digits (for example, 01) or blank.',
    });
  }

  const rxHz = mhzToHz(station.rxFrequencyMhz);
  const txHz = mhzToHz(station.txFrequencyMhz);
  if (rxHz == null || rxHz < 144_000_000 || rxHz > 450_000_000) {
    issues.push({
      id: 'rx-freq-invalid',
      tab: 'station',
      field: 'rxFrequencyMhz',
      severity: 'error',
      message: 'RX Frequency must be within VHF/UHF amateur range (144.0000 – 450.0000 MHz).',
    });
  }
  if (txHz == null || txHz < 144_000_000 || txHz > 450_000_000) {
    issues.push({
      id: 'tx-freq-invalid',
      tab: 'station',
      field: 'txFrequencyMhz',
      severity: 'error',
      message: 'TX Frequency must be within VHF/UHF amateur range (144.0000 – 450.0000 MHz).',
    });
  }
  if (!station.duplex && rxHz != null && txHz != null && rxHz !== txHz) {
    issues.push({
      id: 'simplex-split-warning',
      tab: 'station',
      field: 'txFrequencyMhz',
      severity: 'warning',
      message: 'Simplex mode normally uses identical RX and TX frequencies. Enable Duplex for split operation.',
    });
  }

  if (station.rfPower < 1 || station.rfPower > 100) {
    issues.push({
      id: 'rf-power-invalid',
      tab: 'station',
      field: 'rfPower',
      severity: 'error',
      message: 'RF Level must be between 1% and 100%.',
    });
  }

  // Modem validation
  const port = modem.uartPort.trim();
  if (modem.protocol === 'uart') {
    if (!/^\/dev\/[A-Za-z0-9._-]+$/.test(port)) {
      issues.push({
        id: 'uart-port-invalid',
        tab: 'modem',
        field: 'uartPort',
        severity: 'error',
        message: 'Serial UART port must be a valid /dev/ device path (for example, /dev/ttyAMA0 or /dev/ttyACM0).',
      });
    } else if (detectedPorts && detectedPorts.length > 0 && !detectedPorts.includes(port)) {
      issues.push({
        id: 'uart-port-missing',
        tab: 'modem',
        field: 'uartPort',
        severity: 'warning',
        message: `${port} was not detected on this host. Detected ports: ${detectedPorts.join(', ')}.`,
      });
    } else if (detectedPorts && detectedPorts.length === 0) {
      issues.push({
        id: 'no-ports-detected',
        tab: 'modem',
        field: 'uartPort',
        severity: 'warning',
        message: `No serial devices were detected yet. Enable Raspberry Pi GPIO UART or choose Null Modem to test without hardware.`,
      });
    }
  }

  if (![115200, 230400, 460800].includes(modem.uartSpeed)) {
    issues.push({
      id: 'uart-speed-invalid',
      tab: 'modem',
      field: 'uartSpeed',
      severity: 'error',
      message: 'UART baud rate must be 115200, 230400, or 460800.',
    });
  }

  // Networks validation
  const anyMode =
    networks.dmrEnable ||
    networks.ysfEnable ||
    networks.dstarEnable ||
    networks.p25Enable ||
    networks.nxdnEnable;

  if (!anyMode) {
    issues.push({
      id: 'no-modes-enabled',
      tab: 'networks',
      field: 'dmrEnable',
      severity: 'error',
      message: 'Enable at least one digital voice mode (DMR, YSF, D-Star, P25, or NXDN).',
    });
  }

  if (networks.dmrEnable) {
    if (!/^[a-zA-Z0-9.-]+$/.test(networks.dmrMasterHost.trim())) {
      issues.push({
        id: 'dmr-host-invalid',
        tab: 'networks',
        field: 'dmrMasterHost',
        severity: 'error',
        message: 'Enter a valid DMR master hostname or IP address (for example, 3102.repeater.net).',
      });
    }
    if (networks.dmrMasterPort < 1024 || networks.dmrMasterPort > 65535) {
      issues.push({
        id: 'dmr-port-invalid',
        tab: 'networks',
        field: 'dmrMasterPort',
        severity: 'error',
        message: 'DMR master port must be between 1024 and 65535 (usually 62031).',
      });
    }
    if (!networks.dmrMasterPassword.trim()) {
      issues.push({
        id: 'dmr-pass-missing',
        tab: 'networks',
        field: 'dmrMasterPassword',
        severity: 'warning',
        message: 'Enter your BrandMeister Hotspot Security password (or network password) so DMRGateway can authenticate.',
      });
    }
    if (networks.dmrColorCode < 0 || networks.dmrColorCode > 15) {
      issues.push({
        id: 'dmr-cc-invalid',
        tab: 'networks',
        field: 'dmrColorCode',
        severity: 'error',
        message: 'DMR Color Code must be between 0 and 15.',
      });
    }
  }

  if (networks.p25Enable && !/^[0-9A-Fa-f]{1,3}$/.test(networks.p25Nac.trim())) {
    issues.push({
      id: 'p25-nac-invalid',
      tab: 'networks',
      field: 'p25Nac',
      severity: 'error',
      message: 'P25 NAC must be a valid hex value (default 293).',
    });
  }

  // System validation
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(system.hostname.trim())) {
    issues.push({
      id: 'hostname-invalid',
      tab: 'system',
      field: 'hostname',
      severity: 'error',
      message: 'Hostname may only contain letters, digits, and hyphens.',
    });
  }
  if (system.webguiPort < 1024 || system.webguiPort > 65535) {
    issues.push({
      id: 'webgui-port-invalid',
      tab: 'system',
      field: 'webguiPort',
      severity: 'error',
      message: 'WebGUI port must be between 1024 and 65535.',
    });
  }
  if (system.sshPort < 1 || system.sshPort > 65535) {
    issues.push({
      id: 'ssh-port-invalid',
      tab: 'system',
      field: 'sshPort',
      severity: 'error',
      message: 'SSH port must be between 1 and 65535.',
    });
  }

  return issues;
}
