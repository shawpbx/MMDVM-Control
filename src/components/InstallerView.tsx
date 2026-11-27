import { useEffect, useRef } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { ConfigTab, MmdvmConfiguration, ValidationIssue, WorkspaceView } from '../types/mmdvmConfig';
import { generateInstallScript, getFullDmrId } from '../utils/generators';
import { downloadTextFile } from '../utils/download';
import { LocalNodeController } from '../hooks/useLocalNode';

interface InstallerViewProps {
  config: MmdvmConfiguration;
  issues: ValidationIssue[];
  localNode: LocalNodeController;
  onStartInstall: () => Promise<void>;
  onApplyConfig: () => Promise<void>;
  onNavigate: (view: WorkspaceView, tab?: ConfigTab) => void;
}

const INSTALL_STEPS = [
  { index: 1, title: 'System Dependencies & mmdvm User', detail: 'Installs build-essential, libmosquitto-dev, nlohmann-json3-dev, creates mmdvm user in dialout, configures Pi UART.' },
  { index: 2, title: 'Compile & Install g4klx/MMDVMHost', detail: 'Clones upstream g4klx/MMDVMHost, compiles with all CPU cores, installs /usr/local/bin/MMDVMHost.' },
  { index: 3, title: 'Compile & Install g4klx/DMRGateway', detail: 'Clones upstream g4klx/DMRGateway, compiles binary, installs /usr/local/bin/DMRGateway.' },
  { index: 4, title: 'Write Configs & Start Services', detail: 'Downloads DMRIds.dat, writes /etc/mmdvm/MMDVM.ini & DMRGateway.ini, enables and starts systemd units.' },
];

export function InstallerView({
  config,
  issues,
  localNode,
  onStartInstall,
  onApplyConfig,
  onNavigate,
}: InstallerViewProps) {
  const logRef = useRef<HTMLPreElement | null>(null);
  const errors = issues.filter((i) => i.severity === 'error');
  const job = localNode.job;
  const running = job.status === 'running';

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [job.logs.length]);

  const handleDownloadScript = () => {
    downloadTextFile('install-mmdvm.sh', generateInstallScript(config), 'text/x-shellscript');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            MMDVM Automated Installer
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Review your pre-install settings and install MMDVMHost + DMRGateway directly on this host—or export a standalone bash installer.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadScript}
          className="min-h-[40px] px-3.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap self-start"
        >
          <Download className="w-4 h-4" />
          <span>Download install-mmdvm.sh</span>
        </button>
      </div>

      {/* Pre-Install Summary Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Pre-Install Configuration Summary
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('configurator', 'station')}
            className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Edit Settings</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="space-y-1">
            <p className="text-slate-500 dark:text-slate-400">Station Identity</p>
            <p className="font-mono font-semibold text-slate-900 dark:text-white">
              {config.station.callsign} · ID {getFullDmrId(config)}
            </p>
            <p className="text-slate-500 dark:text-slate-400 font-mono">
              {config.station.rxFrequencyMhz} / {config.station.txFrequencyMhz} MHz
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-slate-500 dark:text-slate-400">RF Modem Hardware</p>
            <p className="font-mono font-semibold text-slate-900 dark:text-white">
              {config.modem.protocol === 'null' ? 'null (Test Mode)' : config.modem.uartPort}
            </p>
            <p className="text-slate-500 dark:text-slate-400 font-mono">
              {config.modem.uartSpeed} baud · {config.station.duplex ? 'Duplex' : 'Simplex'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-slate-500 dark:text-slate-400">DMR Master Bridge</p>
            <p className="font-mono font-semibold text-slate-900 dark:text-white">
              {config.networks.dmrEnable ? `${config.networks.dmrMasterHost}:${config.networks.dmrMasterPort}` : 'Disabled'}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              Color Code {config.networks.dmrColorCode} · {config.networks.dmrMasterPassword ? 'Password set' : 'Password blank'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-slate-500 dark:text-slate-400">Target Host Binaries</p>
            <p className="font-mono font-semibold text-slate-900 dark:text-white">
              MMDVMHost: {localNode.installed.mmdvmhost ? 'Installed' : 'Not installed'}
            </p>
            <p className="text-slate-500 dark:text-slate-400 font-mono">
              DMRGateway: {localNode.installed.dmrgateway ? 'Installed' : 'Not installed'}
            </p>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="p-3 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/25 text-xs text-red-800 dark:text-red-300 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              <span>Resolve {errors.length} configuration error{errors.length === 1 ? '' : 's'} before installing:</span>
            </p>
            {errors.map((e) => (
              <p key={e.id}>· {e.message}</p>
            ))}
          </div>
        )}

        <div className="pt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={errors.length > 0 || running}
            onClick={onStartInstall}
            className="min-h-[44px] px-5 py-2.5 rounded-md bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
          >
            {running && job.mode === 'install' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            <span>
              {localNode.installed.mmdvmhost ? 'Reinstall / Upgrade MMDVM Stack' : 'Install MMDVMHost & DMRGateway'}
            </span>
          </button>

          {localNode.installed.mmdvmhost && (
            <button
              type="button"
              disabled={errors.length > 0 || running}
              onClick={onApplyConfig}
              className="min-h-[44px] px-4 py-2.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-900 dark:text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            >
              {running && job.mode === 'apply' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Apply Edited Configs Only (Skip Reinstall)</span>
            </button>
          )}
        </div>
      </div>

      {/* 4-Step Progress & Live Console Output */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Installation Pipeline
          </h2>
          <ol className="space-y-4">
            {INSTALL_STEPS.map((s) => {
              const isDone = job.mode === 'install' && (job.status === 'succeeded' || job.stepIndex > s.index);
              const isActive = job.mode === 'install' && job.status === 'running' && job.stepIndex === s.index;
              return (
                <li key={s.index} className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : isActive ? (
                      <Loader2 className="w-4 h-4 text-sky-600 dark:text-sky-400 animate-spin" />
                    ) : (
                      <span className="inline-flex items-center justify-center w-4 h-4 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                        {s.index}.
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{s.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Execution Output
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {job.step || 'Ready to run installer or apply config files.'}
              </p>
            </div>
            <span
              className={`text-xs font-mono font-semibold ${
                job.status === 'succeeded'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : job.status === 'failed'
                    ? 'text-red-700 dark:text-red-400'
                    : job.status === 'running'
                      ? 'text-sky-700 dark:text-sky-400'
                      : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {job.status === 'idle' ? 'Idle' : job.status.toUpperCase()}
            </span>
          </div>

          {job.error && (
            <div className="p-2.5 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
              {job.error}
            </div>
          )}

          <pre
            ref={logRef}
            className="h-80 overflow-auto rounded-md bg-slate-950 text-slate-200 p-3.5 text-xs leading-relaxed font-mono"
          >
            {job.logs.length > 0
              ? job.logs.join('\n')
              : 'Click "Install MMDVMHost & DMRGateway" to compile and configure the stack, or "Apply Edited Configs Only" to write updated .ini files without reinstalling.'}
          </pre>
        </div>
      </div>
    </div>
  );
}
