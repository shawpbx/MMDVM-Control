export type WorkspaceView = 'dashboard' | 'configurator' | 'installer' | 'files';

export type ConfigTab = 'station' | 'modem' | 'networks' | 'system';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  id: string;
  tab: ConfigTab;
  field: string;
  severity: ValidationSeverity;
  message: string;
}

export interface StationConfig {
  callsign: string;
  dmrId: string;
  essidSuffix: string;
  duplex: boolean;
  rxFrequencyMhz: string;
  txFrequencyMhz: string;
  rxOffset: number;
  txOffset: number;
  rfPower: number;
  cwIdEnable: boolean;
  cwIdTimeMinutes: number;
  latitude: string;
  longitude: string;
  heightMeters: number;
  location: string;
  description: string;
  url: string;
}

export interface ModemConfig {
  modemModel: string;
  protocol: 'uart' | 'null';
  uartPort: string;
  uartSpeed: number;
  rxInvert: boolean;
  txInvert: boolean;
  pttInvert: boolean;
  txDelay: number;
  dmrDelay: number;
  rxLevel: number;
  txLevel: number;
  configurePiUart: boolean;
}

export interface NetworksConfig {
  dmrEnable: boolean;
  dmrColorCode: number;
  dmrMasterName: string;
  dmrMasterHost: string;
  dmrMasterPort: number;
  dmrMasterPassword: string;
  dmrSlot1: boolean;
  dmrSlot2: boolean;
  ysfEnable: boolean;
  ysfGatewayHost: string;
  ysfGatewayPort: number;
  dstarEnable: boolean;
  dstarModule: 'A' | 'B' | 'C' | 'D';
  p25Enable: boolean;
  p25Nac: string;
  nxdnEnable: boolean;
  nxdnRan: number;
}

export interface SystemConfig {
  hostname: string;
  timezone: string;
  webguiPort: number;
  enableUfw: boolean;
  sshPort: number;
}

export interface MmdvmConfiguration {
  station: StationConfig;
  modem: ModemConfig;
  networks: NetworksConfig;
  system: SystemConfig;
}

export interface ModemPreset {
  id: string;
  label: string;
  category: 'GPIO Hotspot' | 'USB Hotspot' | 'Repeater Board' | 'Testing / Custom';
  protocol: 'uart' | 'null';
  uartPort: string;
  uartSpeed: number;
  duplex: boolean;
  rxInvert: boolean;
  txInvert: boolean;
  pttInvert: boolean;
  txDelay: number;
  dmrDelay: number;
  rxLevel: number;
  txLevel: number;
  configurePiUart: boolean;
  notes: string;
}

export interface DmrMasterPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  region: string;
}

export interface GeneratedFile {
  id: string;
  filename: string;
  targetPath: string;
  language: 'ini' | 'bash' | 'systemd';
  description: string;
  content: string;
}
