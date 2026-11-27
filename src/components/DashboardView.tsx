import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Square,
} from 'lucide-react';
import { ConfigTab, MmdvmConfiguration, WorkspaceView } from '../types/mmdvmConfig';
import { LocalNodeController, ServiceAction, ServiceUnit } from '../hooks/useLocalNode';

interface DashboardViewProps {
  config: MmdvmConfiguration;
  hasUnsavedChanges: boolean;
  hasErrors: boolean;
  localNode: LocalNodeController;
  onApplyConfig: () => Promise<void>;
  onNavigate: (view: WorkspaceView, tab?: ConfigTab) => void;
}

type ModeFilter = 'ALL' | 'DMR' | 'YSF' | 'D-Star';

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function statusMeta(state: string | undefined): { label: string; color: string } {
  if (state === 'active') return { label: 'Running', color: 'text-emerald-700 dark:text-emerald-400' };
  if (state === 'activating') return { label: 'Starting', color: 'text-amber-700 dark:text-amber-400' };
  if (state === 'failed') return { label: 'Failed', color: 'text-red-700 dark:text-red-400' };
  return { label: 'Stopped', color: 'text-slate-500 dark:text-slate-400' };
}

export function DashboardView({
  config,
  hasUnsavedChanges,
  hasErrors,
  localNode,
  onApplyConfig,
  onNavigate,
}: DashboardViewProps) {
  const [modeFilter, setModeFilter] = useState<ModeFilter>('ALL');
  const [search, setSearch] = useState('');

  const mmdvmState = localNode.services.mmdvmhost || 'inactive';
  const gwState = localNode.services.dmrgateway || 'inactive';
  const mmdvmStatus = statusMeta(mmdvmState);
  const gwStatus = statusMeta(gwState);

  const activeUsers = localNode.live?.activeTransmissions || [];
  const recentUsers = localNode.live?.recentUsers || [];

  const filteredActivity = useMemo(() => {
    const combined = [...activeUsers, ...recentUsers];
    const q = search.trim().toLowerCase();
    return combined.filter((row) => {
      if (modeFilter !== 'ALL' && row.modeGroup !== modeFilter) return false;
      if (!q) return true;
      return (
        row.callsign.toLowerCase().includes(q) ||
        row.dmrId.toLowerCase().includes(q) ||
        row.target.toLowerCase().includes(q) ||
        row.mode.toLowerCase().includes(q)
      );
    });
  }, [activeUsers, recentUsers, modeFilter, search]);

  const handleServiceAction = async (unit: ServiceUnit, action: ServiceAction) => {
    await localNode.controlService(unit, action);
  };

  const notInstalledYet = localNode.hostAvailable && !localNode.installed.mmdvmhost;
  const hostErr = mmdvmState !== 'active' ? localNode.live?.mmdvmhostLastError : null;
  const gwErr = config.networks.dmrEnable && gwState !== 'active' ? localNode.live?.dmrgatewayLastError : null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            MMDVM Live Dashboard
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
            {config.station.callsign} · {config.station.rxFrequencyMhz} MHz · {config.modem.protocol === 'null' ? 'null modem' : config.modem.uartPort}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => localNode.setAutoRefresh(!localNode.autoRefresh)}
            className="min-h-[38px] px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {localNode.autoRefresh ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{localNode.autoRefresh ? 'Pause Poll' : 'Resume Poll'}</span>
          </button>
          <button
            type="button"
            onClick={() => localNode.refreshAll()}
            className="min-h-[38px] px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* First-Time Pre-Install Callout */}
      {notInstalledYet && (
        <div className="p-4 rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-sky-950 dark:text-sky-200">
              MMDVMHost is not installed on {localNode.hostname} yet
            </p>
            <p className="text-xs text-sky-800 dark:text-sky-300">
              Review your callsign, modem hardware, and DMR master in the Configurator, then run the 4-step Installer.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('configurator', 'station')}
              className="min-h-[38px] px-3.5 py-1.5 rounded-md border border-sky-300 dark:border-sky-800 text-xs font-semibold text-sky-900 dark:text-sky-200 hover:bg-sky-100/70 dark:hover:bg-sky-900/40 whitespace-nowrap"
            >
              Open Configurator
            </button>
            <button
              type="button"
              onClick={() => onNavigate('installer')}
              className="min-h-[38px] px-3.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-700 text-xs font-semibold text-white whitespace-nowrap"
            >
              Run Installer
            </button>
          </div>
        </div>
      )}

      {/* Unsaved Config Changes Banner (Post-Install Apply without Reinstalling) */}
      {hasUnsavedChanges && (
        <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-xs text-amber-950 dark:text-amber-200">
            <p className="font-semibold text-sm">You have unapplied configuration edits</p>
            <p className="mt-0.5">
              Apply them directly to /etc/mmdvm/MMDVM.ini and DMRGateway.ini and reload services without reinstalling packages.
            </p>
          </div>
          <button
            type="button"
            disabled={hasErrors || localNode.job.status === 'running'}
            onClick={onApplyConfig}
            className="min-h-[38px] px-4 py-1.5 rounded-md bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            {localNode.job.status === 'running' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Apply Config Now</span>
          </button>
        </div>
      )}

      {/* Service Error Diagnostics Banner */}
      {(hostErr || gwErr) && (
        <div className="p-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/25 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-2.5 text-xs text-red-900 dark:text-red-300 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              <p className="font-semibold text-sm">Service Startup Diagnostic</p>
              {hostErr && (
                <p className="font-mono break-all">
                  MMDVMHost: {hostErr}
                </p>
              )}
              {gwErr && (
                <p className="font-mono break-all">
                  DMRGateway: {gwErr}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('configurator', hostErr ? 'modem' : 'networks')}
            className="min-h-[36px] px-3 py-1.5 rounded-md border border-red-300 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-200 hover:bg-red-100/60 dark:hover:bg-red-900/30 whitespace-nowrap shrink-0"
          >
            {hostErr ? 'Configure Modem Port' : 'Configure DMR Master'}
          </button>
        </div>
      )}

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">MMDVMHost Modem</p>
          <p className={`text-lg font-bold font-display ${mmdvmStatus.color}`}>{mmdvmStatus.label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
            {config.modem.protocol === 'null' ? 'Protocol=null' : `${config.modem.uartPort} @ ${config.modem.uartSpeed}`}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">DMRGateway Network</p>
          <p
            className={`text-lg font-bold font-display ${
              localNode.live?.dmrMasterConnected ? 'text-emerald-700 dark:text-emerald-400' : gwStatus.color
            }`}
          >
            {!config.networks.dmrEnable
              ? 'Disabled'
              : localNode.live?.dmrMasterConnected
                ? 'Master Linked'
                : gwStatus.label}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
            {config.networks.dmrEnable ? `${config.networks.dmrMasterHost}:${config.networks.dmrMasterPort}` : 'DMR off'}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Active / Last Heard</p>
          <p className="text-lg font-bold font-display font-mono tabular-nums text-slate-900 dark:text-white">
            {activeUsers.length} live · {recentUsers.length} heard
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            CC {config.networks.dmrColorCode} · {config.station.duplex ? 'Duplex' : 'Simplex'}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-1">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Host Telemetry</p>
          <p className="text-lg font-bold font-display font-mono tabular-nums text-slate-900 dark:text-white">
            {formatUptime(localNode.live?.uptimeSeconds)}
            {localNode.live?.cpuTempC != null ? ` · ${localNode.live.cpuTempC}°C` : ''}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            {localNode.detectedSerialPorts.length > 0
              ? `Ports: ${localNode.detectedSerialPorts.join(', ')}`
              : 'No UART/USB ports detected'}
          </p>
        </div>
      </div>

      {/* Main 2-Column Operations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: MMDVM Active & Last Heard Users */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Active &amp; Last Heard Users
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real-time RF and network transmissions parsed from MMDVMHost.
              </p>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search callsign or TG..."
                aria-label="Search MMDVM activity"
                className="min-h-[36px] w-48 pl-8 pr-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-md w-fit">
            {(['ALL', 'DMR', 'YSF', 'D-Star'] as ModeFilter[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setModeFilter(tab)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  modeFilter === tab
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab === 'ALL' ? 'All Modes' : tab}
              </button>
            ))}
          </div>

          {filteredActivity.length === 0 ? (
            <div className="py-12 text-center space-y-2 border-t border-slate-100 dark:border-slate-800">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {localNode.hostAvailable
                  ? 'No recent digital voice transmissions logged yet'
                  : 'Preview Mode — Live traffic appears when running on your Pi or Debian host'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Key up on {config.station.rxFrequencyMhz} MHz (CC {config.networks.dmrColorCode}) or wait for incoming network talkgroup traffic to see live callsigns here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-3 font-medium">Time</th>
                    <th className="py-2.5 pr-3 font-medium">Callsign</th>
                    <th className="py-2.5 pr-3 font-medium">Mode</th>
                    <th className="py-2.5 pr-3 font-medium">Target</th>
                    <th className="py-2.5 pr-3 font-medium text-right">Duration</th>
                    <th className="py-2.5 font-medium text-right">BER / Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {filteredActivity.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {row.timestamp}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="font-mono font-semibold text-slate-900 dark:text-white">
                          {row.callsign}
                        </span>
                        {row.active && (
                          <span className="ml-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            TX Live
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {row.mode} · {row.source}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {row.target}
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {row.duration}
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {row.ber} / {row.loss}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right: Service Controls + Live Journal Log Viewer */}
        <section className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Service Controls
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('configurator', 'modem')}
                className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
              >
                Edit Config
              </button>
            </div>

            {localNode.serviceMessage && (
              <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-md border border-slate-200 dark:border-slate-700">
                {localNode.serviceMessage}
              </p>
            )}

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {(
                [
                  {
                    unit: 'mmdvmhost' as ServiceUnit,
                    label: 'mmdvmhost.service',
                    desc: 'RF Modem & Multi-Mode Host',
                    state: mmdvmState,
                  },
                  {
                    unit: 'dmrgateway' as ServiceUnit,
                    label: 'dmrgateway.service',
                    desc: 'DMR Master Authentication Bridge',
                    state: gwState,
                  },
                ]
              ).map((svc) => {
                const st = statusMeta(svc.state);
                return (
                  <div key={svc.unit} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-medium text-slate-900 dark:text-white truncate">
                        {svc.label}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className={`font-semibold ${st.color}`}>{st.label}</span> · {svc.desc}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={localNode.serviceBusy !== null}
                        onClick={() => handleServiceAction(svc.unit, 'start')}
                        title={`Start ${svc.label}`}
                        aria-label={`Start ${svc.label}`}
                        className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={localNode.serviceBusy !== null}
                        onClick={() => handleServiceAction(svc.unit, 'restart')}
                        title={`Restart ${svc.label}`}
                        aria-label={`Restart ${svc.label}`}
                        className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/30 disabled:opacity-50"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={localNode.serviceBusy !== null}
                        onClick={() => handleServiceAction(svc.unit, 'stop')}
                        title={`Stop ${svc.label}`}
                        aria-label={`Stop ${svc.label}`}
                        className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                      >
                        <Square className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Journal Log Viewer */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
                {(['mmdvmhost', 'dmrgateway'] as ServiceUnit[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => localNode.setLogsUnit(u)}
                    className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap ${
                      localNode.logsUnit === u
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={localNode.logsLoading}
                onClick={() => localNode.refreshLogs()}
                className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${localNode.logsLoading ? 'animate-spin' : ''}`} />
                <span>Reload Logs</span>
              </button>
            </div>

            <pre className="h-64 overflow-auto rounded-md bg-slate-950 text-slate-200 p-3 text-[11px] leading-relaxed font-mono">
              {localNode.serviceLogs.length > 0
                ? localNode.serviceLogs.join('\n')
                : `No log lines returned for ${localNode.logsUnit}.service yet.`}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
