import { FormEvent, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Save,
  ArrowRight,
  KeyRound,
} from 'lucide-react';
import {
  COMMON_TIMEZONES,
  DMR_MASTER_PRESETS,
  MODEM_PRESETS,
  STANDARD_SERIAL_PORTS,
} from '../data/presets';
import {
  ConfigTab,
  MmdvmConfiguration,
  ValidationIssue,
  WorkspaceView,
} from '../types/mmdvmConfig';
import { mhzToHz } from '../utils/validation';
import { getFullDmrId } from '../utils/generators';
import { LocalNodeController } from '../hooks/useLocalNode';

interface ConfiguratorViewProps {
  config: MmdvmConfiguration;
  activeTab: ConfigTab;
  issues: ValidationIssue[];
  hasUnsavedChanges: boolean;
  localNode: LocalNodeController;
  onChange: (next: MmdvmConfiguration) => void;
  onTabChange: (tab: ConfigTab) => void;
  onApplyConfig: () => Promise<void>;
  onNavigate: (view: WorkspaceView) => void;
}

const TABS: { id: ConfigTab; label: string }[] = [
  { id: 'station', label: 'Station & RF' },
  { id: 'modem', label: 'Modem Hardware' },
  { id: 'networks', label: 'Modes & Networks' },
  { id: 'system', label: 'System & Account' },
];

export function ConfiguratorView({
  config,
  activeTab,
  issues,
  hasUnsavedChanges,
  localNode,
  onChange,
  onTabChange,
  onApplyConfig,
  onNavigate,
}: ConfiguratorViewProps) {
  const [showDmrPass, setShowDmrPass] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwStatus, setPwStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const { station, modem, networks, system } = config;
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const tabIssues = issues.filter((i) => i.tab === activeTab);

  const rxHz = mhzToHz(station.rxFrequencyMhz);
  const txHz = mhzToHz(station.txFrequencyMhz);
  const fullDmrId = getFullDmrId(config);

  const updateStation = (patch: Partial<MmdvmConfiguration['station']>) => {
    const nextStation = { ...station, ...patch };
    if (!nextStation.duplex && patch.rxFrequencyMhz !== undefined) {
      nextStation.txFrequencyMhz = patch.rxFrequencyMhz;
    }
    onChange({ ...config, station: nextStation });
  };

  const updateModem = (patch: Partial<MmdvmConfiguration['modem']>) => {
    onChange({ ...config, modem: { ...modem, ...patch } });
  };

  const updateNetworks = (patch: Partial<MmdvmConfiguration['networks']>) => {
    onChange({ ...config, networks: { ...networks, ...patch } });
  };

  const updateSystem = (patch: Partial<MmdvmConfiguration['system']>) => {
    onChange({ ...config, system: { ...system, ...patch } });
  };

  const handlePresetChange = (presetId: string) => {
    const preset = MODEM_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onChange({
      ...config,
      station: {
        ...station,
        duplex: preset.duplex,
        txFrequencyMhz: preset.duplex ? station.txFrequencyMhz : station.rxFrequencyMhz,
      },
      modem: {
        ...modem,
        modemModel: preset.id,
        protocol: preset.protocol,
        uartPort: preset.uartPort,
        uartSpeed: preset.uartSpeed,
        rxInvert: preset.rxInvert,
        txInvert: preset.txInvert,
        pttInvert: preset.pttInvert,
        txDelay: preset.txDelay,
        dmrDelay: preset.dmrDelay,
        rxLevel: preset.rxLevel,
        txLevel: preset.txLevel,
        configurePiUart: preset.configurePiUart,
      },
      networks: {
        ...networks,
        dmrSlot1: preset.duplex,
      },
    });
  };

  const handleMasterPresetChange = (presetId: string) => {
    const preset = DMR_MASTER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    if (preset.id === 'custom') return;
    updateNetworks({
      dmrMasterName: preset.label.split(' ')[0] || 'DMR_Master',
      dmrMasterHost: preset.host,
      dmrMasterPort: preset.port,
    });
  };

  const selectedModemPreset = MODEM_PRESETS.find((p) => p.id === modem.modemModel);
  const selectedMasterPreset =
    DMR_MASTER_PRESETS.find((p) => p.host && p.host === networks.dmrMasterHost.trim())?.id ||
    'custom';

  const serialPortOptions = Array.from(
    new Set([...localNode.detectedSerialPorts, ...STANDARD_SERIAL_PORTS, modem.uartPort].filter(Boolean))
  );

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    setPwStatus(null);
    if (newPw.length < 8) {
      setPwStatus({ ok: false, text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPw !== confirmPw) {
      setPwStatus({ ok: false, text: 'New passwords do not match.' });
      return;
    }
    setPwBusy(true);
    const err = await localNode.changePassword(curPw, newPw);
    setPwBusy(false);
    if (err) {
      setPwStatus({ ok: false, text: err });
    } else {
      setCurPw('');
      setNewPw('');
      setConfirmPw('');
      setPwStatus({ ok: true, text: 'Administrator password updated.' });
    }
  };

  const isRunningJob = localNode.job.status === 'running';
  const binariesInstalled = localNode.installed.mmdvmhost;

  return (
    <div className="space-y-6">
      {/* Header & Segmented Tab Bar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            MMDVM Configurator
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Configure settings before installation or edit any parameter post-install and apply directly to /etc/mmdvm/*.ini without reinstalling.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          {TABS.map((t) => {
            const tabErrCount = issues.filter((i) => i.tab === t.id && i.severity === 'error').length;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  activeTab === t.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span>{t.label}</span>
                {tabErrCount > 0 && (
                  <span className="font-mono text-[11px] font-semibold text-red-600 dark:text-red-400">
                    ({tabErrCount})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab-specific validation messages */}
      {tabIssues.length > 0 && (
        <div className="space-y-2">
          {tabIssues.map((issue) => (
            <div
              key={issue.id}
              className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                issue.severity === 'error'
                  ? 'border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/25 text-red-800 dark:text-red-300'
                  : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/25 text-amber-900 dark:text-amber-300'
              }`}
            >
              {issue.severity === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Active Tab Form Surface */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        {activeTab === 'station' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="space-y-1.5">
                <label htmlFor="cfg-callsign" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  Station Callsign
                </label>
                <input
                  id="cfg-callsign"
                  type="text"
                  value={station.callsign}
                  onChange={(e) => updateStation({ callsign: e.target.value.toUpperCase() })}
                  placeholder="W7ABC"
                  className="w-full min-h-[40px] px-3 py-2 text-sm font-mono uppercase rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="cfg-dmrid" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  RadioID DMR ID (7 digits)
                </label>
                <input
                  id="cfg-dmrid"
                  type="text"
                  inputMode="numeric"
                  value={station.dmrId}
                  onChange={(e) => updateStation({ dmrId: e.target.value.replace(/\D/g, '').slice(0, 7) })}
                  placeholder="3101234"
                  className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="cfg-essid" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  ESSID Suffix (optional 2 digits)
                </label>
                <input
                  id="cfg-essid"
                  type="text"
                  inputMode="numeric"
                  value={station.essidSuffix}
                  onChange={(e) => updateStation({ essidSuffix: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                  placeholder="01"
                  className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  Active MMDVM Id={fullDmrId}
                </p>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    RF Frequencies &amp; Calibration
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Enter frequencies in MHz; MMDVM.ini automatically writes exact Hz values.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md self-start">
                  <button
                    type="button"
                    onClick={() => updateStation({ duplex: false, txFrequencyMhz: station.rxFrequencyMhz })}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      !station.duplex
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Simplex
                  </button>
                  <button
                    type="button"
                    onClick={() => updateStation({ duplex: true })}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      station.duplex
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Duplex / Repeater
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                <div className="space-y-1.5">
                  <label htmlFor="cfg-rxfreq" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    RX Frequency (MHz)
                  </label>
                  <input
                    id="cfg-rxfreq"
                    type="text"
                    value={station.rxFrequencyMhz}
                    onChange={(e) => updateStation({ rxFrequencyMhz: e.target.value })}
                    placeholder="446.8000"
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {rxHz ? `${rxHz.toLocaleString()} Hz` : 'Invalid MHz'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-txfreq" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    TX Frequency (MHz)
                  </label>
                  <input
                    id="cfg-txfreq"
                    type="text"
                    disabled={!station.duplex}
                    value={station.duplex ? station.txFrequencyMhz : station.rxFrequencyMhz}
                    onChange={(e) => updateStation({ txFrequencyMhz: e.target.value })}
                    placeholder="446.8000"
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {txHz ? `${txHz.toLocaleString()} Hz` : 'Invalid MHz'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-rxoff" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    RX Offset (Hz)
                  </label>
                  <input
                    id="cfg-rxoff"
                    type="number"
                    min={-5000}
                    max={5000}
                    value={station.rxOffset}
                    onChange={(e) => updateStation({ rxOffset: Number(e.target.value) || 0 })}
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-txoff" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    TX Offset (Hz)
                  </label>
                  <input
                    id="cfg-txoff"
                    type="number"
                    min={-5000}
                    max={5000}
                    value={station.txOffset}
                    onChange={(e) => updateStation({ txOffset: Number(e.target.value) || 0 })}
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="space-y-1.5">
                  <label htmlFor="cfg-rfpower" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    RF Level ({station.rfPower}%)
                  </label>
                  <input
                    id="cfg-rfpower"
                    type="range"
                    min={1}
                    max={100}
                    value={station.rfPower}
                    onChange={(e) => updateStation({ rfPower: Number(e.target.value) })}
                    className="w-full accent-sky-600"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-location" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    Station Location
                  </label>
                  <input
                    id="cfg-location"
                    type="text"
                    value={station.location}
                    onChange={(e) => updateStation({ location: e.target.value })}
                    placeholder="Seattle, WA"
                    className="w-full min-h-[40px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-desc" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    Description
                  </label>
                  <input
                    id="cfg-desc"
                    type="text"
                    value={station.description}
                    onChange={(e) => updateStation({ description: e.target.value })}
                    placeholder="MMDVM Digital Voice Hotspot"
                    className="w-full min-h-[40px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-2">
                <label className="inline-flex items-center gap-2.5 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={station.cwIdEnable}
                    onChange={(e) => updateStation({ cwIdEnable: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 accent-sky-600"
                  />
                  <span>Enable Periodic CW Station ID</span>
                </label>

                {station.cwIdEnable && (
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor="cfg-cwtime" className="text-slate-600 dark:text-slate-400">
                      Interval (min):
                    </label>
                    <input
                      id="cfg-cwtime"
                      type="number"
                      min={1}
                      max={60}
                      value={station.cwIdTimeMinutes}
                      onChange={(e) => updateStation({ cwIdTimeMinutes: Math.max(1, Number(e.target.value) || 10) })}
                      className="w-20 min-h-[36px] px-2.5 py-1 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'modem' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label htmlFor="cfg-modem-preset" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  Modem Hardware Preset
                </label>
                <select
                  id="cfg-modem-preset"
                  value={modem.modemModel}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  {(['GPIO Hotspot', 'USB Hotspot', 'Repeater Board', 'Testing / Custom'] as const).map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {MODEM_PRESETS.filter((p) => p.category === cat).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedModemPreset && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{selectedModemPreset.notes}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="cfg-uart-port" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  Serial / UART Device Port
                </label>
                <select
                  id="cfg-uart-port"
                  value={modem.protocol === 'null' ? 'null' : modem.uartPort}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateModem({
                      protocol: val === 'null' ? 'null' : 'uart',
                      uartPort: val,
                    });
                  }}
                  className="w-full min-h-[42px] px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  {serialPortOptions.map((port) => {
                    const detected = localNode.detectedSerialPorts.includes(port);
                    return (
                      <option key={port} value={port}>
                        {port === 'null'
                          ? 'null (Null Modem — no physical RF hardware)'
                          : detected
                            ? `${port} (detected on host)`
                            : port}
                      </option>
                    );
                  })}
                </select>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {localNode.detectedSerialPorts.length > 0
                      ? `Detected on host: ${localNode.detectedSerialPorts.join(', ')}`
                      : 'No /dev/ttyAMA*, ttyACM*, or ttyUSB* devices detected yet.'}
                  </span>
                  {modem.protocol !== 'null' && (
                    <button
                      type="button"
                      onClick={() => handlePresetChange('null_modem')}
                      className="text-sky-600 dark:text-sky-400 font-medium hover:underline whitespace-nowrap shrink-0"
                    >
                      Use Null Modem
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Serial Speed, Polarity &amp; Modulation Levels
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="cfg-baud" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    UART Baud Rate
                  </label>
                  <select
                    id="cfg-baud"
                    value={modem.uartSpeed}
                    onChange={(e) => updateModem({ uartSpeed: Number(e.target.value) })}
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  >
                    <option value={115200}>115200</option>
                    <option value={230400}>230400</option>
                    <option value={460800}>460800</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-txdelay" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    TXDelay (ms)
                  </label>
                  <input
                    id="cfg-txdelay"
                    type="number"
                    min={0}
                    max={500}
                    value={modem.txDelay}
                    onChange={(e) => updateModem({ txDelay: Number(e.target.value) || 0 })}
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-dmrdelay" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    DMRDelay
                  </label>
                  <input
                    id="cfg-dmrdelay"
                    type="number"
                    min={0}
                    max={500}
                    value={modem.dmrDelay}
                    onChange={(e) => updateModem({ dmrDelay: Number(e.target.value) || 0 })}
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-rxlevel" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    RXLevel (%)
                  </label>
                  <input
                    id="cfg-rxlevel"
                    type="number"
                    min={0}
                    max={100}
                    value={modem.rxLevel}
                    onChange={(e) => updateModem({ rxLevel: Number(e.target.value) || 0 })}
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cfg-txlevel" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    TXLevel (%)
                  </label>
                  <input
                    id="cfg-txlevel"
                    type="number"
                    min={0}
                    max={100}
                    value={modem.txLevel}
                    onChange={(e) => updateModem({ txLevel: Number(e.target.value) || 0 })}
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-2">
                <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modem.rxInvert}
                    onChange={(e) => updateModem({ rxInvert: e.target.checked })}
                    className="w-4 h-4 rounded accent-sky-600"
                  />
                  <span>RXInvert</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modem.txInvert}
                    onChange={(e) => updateModem({ txInvert: e.target.checked })}
                    className="w-4 h-4 rounded accent-sky-600"
                  />
                  <span>TXInvert</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modem.pttInvert}
                    onChange={(e) => updateModem({ pttInvert: e.target.checked })}
                    className="w-4 h-4 rounded accent-sky-600"
                  />
                  <span>PTTInvert</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modem.configurePiUart}
                    onChange={(e) => updateModem({ configurePiUart: e.target.checked })}
                    className="w-4 h-4 rounded accent-sky-600"
                  />
                  <span>Auto-enable Raspberry Pi GPIO UART during install</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'networks' && (
          <div className="space-y-8">
            {/* DMR Section */}
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    DMR Mode &amp; DMRGateway Master Connection
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    MMDVMHost links locally on 127.0.0.1:62033 ↔ 62031 to DMRGateway, which authenticates to your DMR master server.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={networks.dmrEnable}
                    onChange={(e) => updateNetworks({ dmrEnable: e.target.checked })}
                    className="w-4 h-4 rounded accent-sky-600"
                  />
                  <span>Enable DMR</span>
                </label>
              </div>

              {networks.dmrEnable && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="cfg-dmr-preset" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                        Master Server Preset
                      </label>
                      <select
                        id="cfg-dmr-preset"
                        value={selectedMasterPreset}
                        onChange={(e) => handleMasterPresetChange(e.target.value)}
                        className="w-full min-h-[40px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      >
                        {DMR_MASTER_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="cfg-dmr-host" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                        DMR Master Host
                      </label>
                      <input
                        id="cfg-dmr-host"
                        type="text"
                        value={networks.dmrMasterHost}
                        onChange={(e) => updateNetworks({ dmrMasterHost: e.target.value })}
                        placeholder="3102.repeater.net"
                        className="w-full min-h-[40px] px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="cfg-dmr-port" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                        Master UDP Port
                      </label>
                      <input
                        id="cfg-dmr-port"
                        type="number"
                        min={1024}
                        max={65535}
                        value={networks.dmrMasterPort}
                        onChange={(e) => updateNetworks({ dmrMasterPort: Number(e.target.value) || 62031 })}
                        className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="cfg-dmr-cc" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                        Color Code (0–15)
                      </label>
                      <input
                        id="cfg-dmr-cc"
                        type="number"
                        min={0}
                        max={15}
                        value={networks.dmrColorCode}
                        onChange={(e) => updateNetworks({ dmrColorCode: Number(e.target.value) || 0 })}
                        className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <div className="space-y-1.5">
                      <label htmlFor="cfg-dmr-pass" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                        Hotspot Security Password
                      </label>
                      <div className="relative">
                        <input
                          id="cfg-dmr-pass"
                          type={showDmrPass ? 'text' : 'password'}
                          value={networks.dmrMasterPassword}
                          onChange={(e) => updateNetworks({ dmrMasterPassword: e.target.value })}
                          placeholder="BrandMeister SelfCare Hotspot Security password"
                          className="w-full min-h-[40px] pl-3 pr-10 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => setShowDmrPass((v) => !v)}
                          aria-label={showDmrPass ? 'Hide DMR password' : 'Show DMR password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          {showDmrPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6 pb-2">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={!station.duplex}
                          checked={station.duplex && networks.dmrSlot1}
                          onChange={(e) => updateNetworks({ dmrSlot1: e.target.checked })}
                          className="w-4 h-4 rounded accent-sky-600 disabled:opacity-50"
                        />
                        <span>Time Slot 1 {station.duplex ? '' : '(Duplex only)'}</span>
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={networks.dmrSlot2}
                          onChange={(e) => updateNetworks({ dmrSlot2: e.target.checked })}
                          className="w-4 h-4 rounded accent-sky-600"
                        />
                        <span>Time Slot 2</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Additional Digital Modes */}
            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Additional Digital Voice Modes
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
                  <label className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-900 dark:text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={networks.ysfEnable}
                      onChange={(e) => updateNetworks({ ysfEnable: e.target.checked })}
                      className="w-4 h-4 rounded accent-sky-600"
                    />
                    <span>Yaesu System Fusion (YSF)</span>
                  </label>
                  {networks.ysfEnable && (
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={networks.ysfGatewayHost}
                        onChange={(e) => updateNetworks({ ysfGatewayHost: e.target.value })}
                        placeholder="127.0.0.1"
                        aria-label="YSF Gateway Host"
                        className="min-h-[38px] px-2.5 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                      <input
                        type="number"
                        value={networks.ysfGatewayPort}
                        onChange={(e) => updateNetworks({ ysfGatewayPort: Number(e.target.value) || 4200 })}
                        aria-label="YSF Gateway Port"
                        className="min-h-[38px] px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
                  <label className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-900 dark:text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={networks.dstarEnable}
                      onChange={(e) => updateNetworks({ dstarEnable: e.target.checked })}
                      className="w-4 h-4 rounded accent-sky-600"
                    />
                    <span>D-Star</span>
                  </label>
                  {networks.dstarEnable && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Module:</span>
                      <select
                        value={networks.dstarModule}
                        onChange={(e) => updateNetworks({ dstarModule: e.target.value as 'A' | 'B' | 'C' | 'D' })}
                        aria-label="D-Star Module"
                        className="min-h-[36px] px-2.5 py-1 font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="A">A (23cm)</option>
                        <option value="B">B (70cm)</option>
                        <option value="C">C (2m)</option>
                        <option value="D">D (Data)</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
                  <label className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-900 dark:text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={networks.p25Enable}
                      onChange={(e) => updateNetworks({ p25Enable: e.target.checked })}
                      className="w-4 h-4 rounded accent-sky-600"
                    />
                    <span>P25 Digital</span>
                  </label>
                  {networks.p25Enable && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">NAC (Hex):</span>
                      <input
                        type="text"
                        value={networks.p25Nac}
                        onChange={(e) => updateNetworks({ p25Nac: e.target.value.toUpperCase().slice(0, 3) })}
                        aria-label="P25 NAC"
                        className="w-24 min-h-[36px] px-2.5 py-1 font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
                  <label className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-900 dark:text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={networks.nxdnEnable}
                      onChange={(e) => updateNetworks({ nxdnEnable: e.target.checked })}
                      className="w-4 h-4 rounded accent-sky-600"
                    />
                    <span>NXDN</span>
                  </label>
                  {networks.nxdnEnable && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">RAN (0–63):</span>
                      <input
                        type="number"
                        min={0}
                        max={63}
                        value={networks.nxdnRan}
                        onChange={(e) => updateNetworks({ nxdnRan: Number(e.target.value) || 1 })}
                        aria-label="NXDN RAN"
                        className="w-24 min-h-[36px] px-2.5 py-1 font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="space-y-1.5">
                <label htmlFor="cfg-hostname" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  Linux Hostname
                </label>
                <input
                  id="cfg-hostname"
                  type="text"
                  value={system.hostname}
                  onChange={(e) => updateSystem({ hostname: e.target.value })}
                  className="w-full min-h-[40px] px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="cfg-tz" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  Timezone
                </label>
                <select
                  id="cfg-tz"
                  value={system.timezone}
                  onChange={(e) => updateSystem({ timezone: e.target.value })}
                  className="w-full min-h-[40px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  {Array.from(new Set([...COMMON_TIMEZONES, system.timezone])).map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="cfg-webport" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  WebGUI Port
                </label>
                <input
                  id="cfg-webport"
                  type="number"
                  min={1024}
                  max={65535}
                  value={system.webguiPort}
                  onChange={(e) => updateSystem({ webguiPort: Number(e.target.value) || 8080 })}
                  className="w-full min-h-[40px] px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-6">
              <label className="inline-flex items-center gap-2.5 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={system.enableUfw}
                  onChange={(e) => updateSystem({ enableUfw: e.target.checked })}
                  className="w-4 h-4 rounded accent-sky-600"
                />
                <span>Configure UFW Firewall during full install</span>
              </label>

              {system.enableUfw && (
                <div className="flex items-center gap-2 text-sm">
                  <label htmlFor="cfg-sshport" className="text-slate-600 dark:text-slate-400">
                    SSH Port:
                  </label>
                  <input
                    id="cfg-sshport"
                    type="number"
                    min={1}
                    max={65535}
                    value={system.sshPort}
                    onChange={(e) => updateSystem({ sshPort: Number(e.target.value) || 22 })}
                    className="w-24 min-h-[36px] px-2.5 py-1 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              )}
            </div>

            {/* Change Admin Password Section */}
            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Administrator Login Password ({localNode.username})
                </h2>
              </div>

              {localNode.envManaged ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Password is managed by the server&apos;s <span className="font-mono">MMDVM_WEBGUI_ADMIN_PASSWORD</span> environment variable.
                </p>
              ) : (
                <form onSubmit={handlePasswordChange} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1">
                    <label htmlFor="pw-cur" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Current Password
                    </label>
                    <input
                      id="pw-cur"
                      type="password"
                      value={curPw}
                      onChange={(e) => setCurPw(e.target.value)}
                      required
                      className="w-full min-h-[38px] px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="pw-new" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      New Password (min 8)
                    </label>
                    <input
                      id="pw-new"
                      type="password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      required
                      className="w-full min-h-[38px] px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="pw-conf" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Confirm New Password
                    </label>
                    <input
                      id="pw-conf"
                      type="password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      required
                      className="w-full min-h-[38px] px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={pwBusy}
                    className="min-h-[38px] px-4 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white whitespace-nowrap"
                  >
                    {pwBusy ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              )}

              {pwStatus && (
                <p
                  className={`text-xs ${
                    pwStatus.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {pwStatus.text}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action Footer: Post-Install Apply (No Reinstall) vs Pre-Install Installer */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {errors.length > 0
              ? `${errors.length} validation error${errors.length === 1 ? '' : 's'} must be fixed before applying.`
              : hasUnsavedChanges
                ? 'Unsaved edits ready to apply to /etc/mmdvm/MMDVM.ini & DMRGateway.ini.'
                : warnings.length > 0
                  ? `Configuration valid with ${warnings.length} advisory note${warnings.length === 1 ? '' : 's'}.`
                  : 'Configuration validated and ready.'}
          </p>
          <p>
            Applying edits backs up existing INI files and restarts services without reinstalling packages.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={errors.length > 0 || isRunningJob}
            onClick={onApplyConfig}
            className="min-h-[42px] px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            {isRunningJob ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : hasUnsavedChanges ? (
              <Save className="w-4 h-4" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span>Apply Config Files (No Reinstall)</span>
          </button>

          {!binariesInstalled && (
            <button
              type="button"
              onClick={() => onNavigate('installer')}
              className="min-h-[42px] px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              <span>Go to Installer</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
