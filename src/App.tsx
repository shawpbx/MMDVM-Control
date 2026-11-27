import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  FileCode2,
  HardDriveDownload,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Radio,
  Save,
  SlidersHorizontal,
  Sun,
  X,
} from 'lucide-react';
import { DEFAULT_MMDVM_CONFIG } from './data/presets';
import { ConfigTab, MmdvmConfiguration, WorkspaceView } from './types/mmdvmConfig';
import { validateMmdvmConfig } from './utils/validation';
import { useLocalNode } from './hooks/useLocalNode';
import { LoginView } from './components/LoginView';
import { DashboardView } from './components/DashboardView';
import { ConfiguratorView } from './components/ConfiguratorView';
import { InstallerView } from './components/InstallerView';
import { ConfigFilesView } from './components/ConfigFilesView';

function deepMergeConfig(saved: Partial<MmdvmConfiguration>): MmdvmConfiguration {
  return {
    station: { ...DEFAULT_MMDVM_CONFIG.station, ...(saved.station || {}) },
    modem: { ...DEFAULT_MMDVM_CONFIG.modem, ...(saved.modem || {}) },
    networks: { ...DEFAULT_MMDVM_CONFIG.networks, ...(saved.networks || {}) },
    system: { ...DEFAULT_MMDVM_CONFIG.system, ...(saved.system || {}) },
  };
}

const NAV_ITEMS: {
  id: WorkspaceView;
  label: string;
  icon: typeof Activity;
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'configurator', label: 'Configurator', icon: SlidersHorizontal },
  { id: 'installer', label: 'Installer', icon: HardDriveDownload },
  { id: 'files', label: 'Config Files', icon: FileCode2 },
];

const VIEW_TITLES: Record<WorkspaceView, string> = {
  dashboard: 'Dashboard',
  configurator: 'Configurator',
  installer: 'Installer',
  files: 'Config Files',
};

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('mmdvm_webgui_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  const [config, setConfig] = useState<MmdvmConfiguration>(DEFAULT_MMDVM_CONFIG);
  const [view, setView] = useState<WorkspaceView>('configurator');
  const [configTab, setConfigTab] = useState<ConfigTab>('station');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [didAutoRoute, setDidAutoRoute] = useState(false);

  const handleSavedConfigLoaded = useCallback((saved: MmdvmConfiguration) => {
    setConfig(deepMergeConfig(saved));
  }, []);

  const localNode = useLocalNode(handleSavedConfigLoaded);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem('mmdvm_webgui_theme', darkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [darkMode]);

  // Route to Dashboard automatically once authenticated if MMDVMHost is already installed
  useEffect(() => {
    if (!localNode.authenticated) {
      setDidAutoRoute(false);
      return;
    }
    if (!didAutoRoute && (localNode.installed.mmdvmhost || !localNode.hostAvailable)) {
      setView(localNode.installed.mmdvmhost ? 'dashboard' : 'configurator');
      setDidAutoRoute(true);
    }
  }, [localNode.authenticated, localNode.installed.mmdvmhost, localNode.hostAvailable, didAutoRoute]);

  const issues = useMemo(
    () =>
      validateMmdvmConfig(
        config,
        localNode.hostAvailable ? localNode.detectedSerialPorts : undefined
      ),
    [config, localNode.hostAvailable, localNode.detectedSerialPorts]
  );

  const hasErrors = issues.some((i) => i.severity === 'error');

  const hasUnsavedChanges = useMemo(() => {
    if (!localNode.savedConfig) return false;
    const baseline = deepMergeConfig(localNode.savedConfig);
    return JSON.stringify(config) !== JSON.stringify(baseline);
  }, [config, localNode.savedConfig]);

  const handleNavigate = useCallback((nextView: WorkspaceView, nextTab?: ConfigTab) => {
    setView(nextView);
    if (nextTab) setConfigTab(nextTab);
    setMobileMenuOpen(false);
  }, []);

  const handleApplyConfig = useCallback(async () => {
    if (hasErrors) return;
    const started = await localNode.applyConfigOnly(config);
    if (started) {
      setView('installer');
    }
  }, [config, hasErrors, localNode]);

  const handleStartInstall = useCallback(async () => {
    if (hasErrors) return;
    await localNode.startInstall(config);
  }, [config, hasErrors, localNode]);

  if (localNode.checking) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-2.5 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-sky-600 dark:text-sky-400" />
          <span>Connecting to MMDVM Control...</span>
        </div>
      </div>
    );
  }

  if (!localNode.authenticated) {
    return (
      <LoginView
        localNode={localNode}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
      />
    );
  }

  const isRunningJob = localNode.job.status === 'running';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
        <div className="h-16 px-6 flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800">
          <Radio className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
          <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            MMDVM Control
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="font-mono truncate text-slate-800 dark:text-slate-200">
            {config.station.callsign} · {localNode.hostname}
          </div>
          <div className="flex items-center justify-between">
            <span>Signed in: {localNode.username}</span>
            <button
              type="button"
              onClick={() => localNode.logout()}
              className="text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 font-medium inline-flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-50 w-64 max-w-[80vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span className="font-display text-sm font-bold">MMDVM Control</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium ${
                      active
                        ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => localNode.logout()}
                className="w-full min-h-[40px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out ({localNode.username})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb Left / Primary Action Right */}
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">MMDVM Control</span>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 dark:text-white truncate">
                {VIEW_TITLES[view]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {localNode.installed.mmdvmhost ? (
              <button
                type="button"
                disabled={hasErrors || isRunningJob}
                onClick={handleApplyConfig}
                className="min-h-[38px] px-3.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {isRunningJob ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Apply Config</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleNavigate('installer')}
                className="min-h-[38px] px-3.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Install MMDVM
              </button>
            )}
          </div>
        </header>

        {/* Active Job Progress Strip (visible across tabs while applying/installing) */}
        {isRunningJob && view !== 'installer' && (
          <div className="bg-sky-600 text-white px-4 sm:px-6 lg:px-8 py-2 text-xs flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span className="truncate font-medium">
                {localNode.job.step || 'Running background task...'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleNavigate('installer')}
              className="underline font-semibold whitespace-nowrap shrink-0"
            >
              View Live Logs
            </button>
          </div>
        )}

        {/* Workspace Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          {view === 'dashboard' && (
            <DashboardView
              config={config}
              hasUnsavedChanges={hasUnsavedChanges}
              hasErrors={hasErrors}
              localNode={localNode}
              onApplyConfig={handleApplyConfig}
              onNavigate={handleNavigate}
            />
          )}

          {view === 'configurator' && (
            <ConfiguratorView
              config={config}
              activeTab={configTab}
              issues={issues}
              hasUnsavedChanges={hasUnsavedChanges}
              localNode={localNode}
              onChange={setConfig}
              onTabChange={setConfigTab}
              onApplyConfig={handleApplyConfig}
              onNavigate={handleNavigate}
            />
          )}

          {view === 'installer' && (
            <InstallerView
              config={config}
              issues={issues}
              localNode={localNode}
              onStartInstall={handleStartInstall}
              onApplyConfig={handleApplyConfig}
              onNavigate={handleNavigate}
            />
          )}

          {view === 'files' && <ConfigFilesView config={config} />}
        </main>
      </div>
    </div>
  );
}
