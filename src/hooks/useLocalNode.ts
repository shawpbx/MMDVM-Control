import { useCallback, useEffect, useRef, useState } from 'react';
import { MmdvmConfiguration } from '../types/mmdvmConfig';

export interface MmdvmUserActivity {
  id: string;
  timestamp: string;
  callsign: string;
  dmrId: string;
  mode: string;
  modeGroup: string;
  source: 'RF' | 'Net';
  target: string;
  duration: string;
  loss: string;
  ber: string;
  active: boolean;
}

export interface InstalledStatus {
  mmdvmhost: boolean;
  dmrgateway: boolean;
  configWritten: boolean;
}

export interface JobState {
  mode: 'idle' | 'install' | 'apply';
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  step: string;
  stepIndex: number;
  totalSteps: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logs: string[];
}

export interface LiveTelemetry {
  timestamp: string;
  hostname: string;
  uptimeSeconds: number | null;
  cpuTempC: number | null;
  detectedSerialPorts: string[];
  installed: InstalledStatus;
  services: Record<string, string>;
  dmrMasterConnected: boolean;
  mmdvmhostLastError: string | null;
  dmrgatewayLastError: string | null;
  activeTransmissions: MmdvmUserActivity[];
  recentUsers: MmdvmUserActivity[];
}

export type ServiceUnit = 'mmdvmhost' | 'dmrgateway';
export type ServiceAction = 'start' | 'stop' | 'restart';

const EMPTY_JOB: JobState = {
  mode: 'idle',
  status: 'idle',
  step: '',
  stepIndex: 0,
  totalSteps: 4,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  logs: [],
};

export interface LocalNodeController {
  checking: boolean;
  hostAvailable: boolean;
  hostname: string;
  isRoot: boolean;
  authConfigured: boolean;
  envManaged: boolean;
  usernameHint: string;
  authenticated: boolean;
  username: string;
  authBusy: boolean;
  authError: string | null;
  installed: InstalledStatus;
  detectedSerialPorts: string[];
  services: Record<string, string>;
  savedConfig: MmdvmConfiguration | null;
  live: LiveTelemetry | null;
  autoRefresh: boolean;
  setAutoRefresh: (next: boolean) => void;
  job: JobState;
  serviceBusy: string | null;
  serviceMessage: string | null;
  logsUnit: ServiceUnit;
  setLogsUnit: (unit: ServiceUnit) => void;
  serviceLogs: string[];
  logsLoading: boolean;
  setupAdmin: (username: string, password: string) => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  refreshAll: () => Promise<void>;
  refreshLogs: (unit?: ServiceUnit) => Promise<void>;
  startInstall: (config: MmdvmConfiguration) => Promise<boolean>;
  applyConfigOnly: (config: MmdvmConfiguration) => Promise<boolean>;
  controlService: (unit: ServiceUnit, action: ServiceAction) => Promise<boolean>;
}

export function useLocalNode(
  onSavedConfigLoaded?: (cfg: MmdvmConfiguration) => void
): LocalNodeController {
  const [checking, setChecking] = useState(true);
  const [hostAvailable, setHostAvailable] = useState(false);
  const [hostname, setHostname] = useState('mmdvm-hotspot');
  const [isRoot, setIsRoot] = useState(false);

  const [authConfigured, setAuthConfigured] = useState(false);
  const [envManaged, setEnvManaged] = useState(false);
  const [usernameHint, setUsernameHint] = useState('admin');
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('admin');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Kept strictly in React state / ref memory (never localStorage/sessionStorage)
  const tokenRef = useRef<string | null>(null);
  const previewAccountRef = useRef<{ username: string; password: string } | null>(null);
  const loadedConfigOnceRef = useRef(false);

  const [installed, setInstalled] = useState<InstalledStatus>({
    mmdvmhost: false,
    dmrgateway: false,
    configWritten: false,
  });
  const [detectedSerialPorts, setDetectedSerialPorts] = useState<string[]>([]);
  const [services, setServices] = useState<Record<string, string>>({
    mmdvmhost: 'inactive',
    dmrgateway: 'inactive',
  });
  const [savedConfig, setSavedConfig] = useState<MmdvmConfiguration | null>(null);
  const [live, setLive] = useState<LiveTelemetry | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [job, setJob] = useState<JobState>(EMPTY_JOB);
  const [serviceBusy, setServiceBusy] = useState<string | null>(null);
  const [serviceMessage, setServiceMessage] = useState<string | null>(null);
  const [logsUnit, setLogsUnit] = useState<ServiceUnit>('mmdvmhost');
  const [serviceLogs, setServiceLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tokenRef.current) {
      h['Authorization'] = `Bearer ${tokenRef.current}`;
    }
    return h;
  }, []);

  const handleUnauthorized = useCallback(() => {
    tokenRef.current = null;
    setAuthenticated(false);
    setAuthError('Your session expired. Sign in again to continue.');
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!hostAvailable || !tokenRef.current) return;
    try {
      const res = await fetch('/api/status', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.hostname === 'string') setHostname(data.hostname);
      setIsRoot(Boolean(data.isRoot));
      if (Array.isArray(data.detectedSerialPorts)) {
        setDetectedSerialPorts(data.detectedSerialPorts);
      }
      if (data.installed) setInstalled(data.installed);
      if (data.services) setServices(data.services);
      if (data.job) setJob(data.job);
      if (data.savedConfig && typeof data.savedConfig === 'object') {
        setSavedConfig(data.savedConfig);
        if (!loadedConfigOnceRef.current && onSavedConfigLoaded) {
          loadedConfigOnceRef.current = true;
          onSavedConfigLoaded(data.savedConfig);
        }
      }
    } catch {
      // Ignore transient network errors
    }
  }, [authHeaders, handleUnauthorized, hostAvailable, onSavedConfigLoaded]);

  const fetchLive = useCallback(async () => {
    if (!hostAvailable || !tokenRef.current) return;
    try {
      const res = await fetch('/api/live', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) return;
      const data: LiveTelemetry = await res.json();
      setLive(data);
      if (data.hostname) setHostname(data.hostname);
      if (Array.isArray(data.detectedSerialPorts)) {
        setDetectedSerialPorts(data.detectedSerialPorts);
      }
      if (data.installed) setInstalled(data.installed);
      if (data.services) setServices(data.services);
    } catch {
      // Ignore transient poll errors
    }
  }, [authHeaders, handleUnauthorized, hostAvailable]);

  const refreshLogs = useCallback(
    async (unitOverride?: ServiceUnit) => {
      const target = unitOverride || logsUnit;
      if (!hostAvailable || !tokenRef.current) {
        setServiceLogs([
          `Preview Mode: Live journalctl -u ${target} output appears when running on your Raspberry Pi or Debian host.`,
        ]);
        return;
      }
      setLogsLoading(true);
      try {
        const res = await fetch(`/api/logs?unit=${encodeURIComponent(target)}&lines=90`, {
          headers: authHeaders(),
          cache: 'no-store',
        });
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setServiceLogs(Array.isArray(data.lines) ? data.lines : []);
        }
      } catch {
        // Ignore transient errors
      } finally {
        setLogsLoading(false);
      }
    },
    [authHeaders, handleUnauthorized, hostAvailable, logsUnit]
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchStatus(), fetchLive(), refreshLogs()]);
  }, [fetchLive, fetchStatus, refreshLogs]);

  // Initial host & auth status probe
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/status', { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = await res.json();
          if (active && data.hostAvailable) {
            setHostAvailable(true);
            setHostname(data.hostname || 'mmdvm-hotspot');
            setIsRoot(Boolean(data.isRoot));
            setAuthConfigured(Boolean(data.authConfigured));
            setEnvManaged(Boolean(data.envManaged));
            setUsernameHint(data.usernameHint || 'admin');
            setAuthenticated(Boolean(data.authenticated));
            if (data.username) setUsername(data.username);
          }
        }
      } catch {
        if (active) setHostAvailable(false);
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load initial host data upon authentication
  useEffect(() => {
    if (!authenticated || !hostAvailable) return;
    fetchStatus();
    fetchLive();
    refreshLogs();
  }, [authenticated, hostAvailable, fetchStatus, fetchLive, refreshLogs]);

  // Periodic live telemetry polling (5s)
  useEffect(() => {
    if (!authenticated || !hostAvailable || !autoRefresh) return;
    const timer = window.setInterval(() => {
      fetchLive();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, hostAvailable, autoRefresh, fetchLive]);

  // Poll active install/apply job logs (1.2s)
  useEffect(() => {
    if (!authenticated || !hostAvailable || job.status !== 'running') return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch('/api/job', {
          headers: authHeaders(),
          cache: 'no-store',
        });
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (res.ok) {
          const snap: JobState = await res.json();
          setJob(snap);
          if (snap.status !== 'running') {
            fetchStatus();
            fetchLive();
            refreshLogs();
          }
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [authenticated, hostAvailable, job.status, authHeaders, handleUnauthorized, fetchStatus, fetchLive, refreshLogs]);

  // Refresh logs when switching unit tab
  useEffect(() => {
    if (!authenticated) return;
    refreshLogs(logsUnit);
  }, [authenticated, logsUnit, refreshLogs]);

  const setupAdmin = useCallback(
    async (user: string, password: string): Promise<boolean> => {
      setAuthBusy(true);
      setAuthError(null);
      const cleanUser = user.trim() || 'admin';
      if (!hostAvailable) {
        previewAccountRef.current = { username: cleanUser, password };
        setUsername(cleanUser);
        setUsernameHint(cleanUser);
        setAuthConfigured(true);
        setAuthenticated(true);
        setAuthBusy(false);
        return true;
      }
      try {
        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUser, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAuthError(data.error || 'Could not create administrator account.');
          return false;
        }
        tokenRef.current = data.token;
        setUsername(data.username || cleanUser);
        setUsernameHint(data.username || cleanUser);
        setAuthConfigured(true);
        setAuthenticated(true);
        return true;
      } catch {
        setAuthError('Unable to reach the local MMDVM WebGUI server.');
        return false;
      } finally {
        setAuthBusy(false);
      }
    },
    [hostAvailable]
  );

  const login = useCallback(
    async (user: string, password: string): Promise<boolean> => {
      setAuthBusy(true);
      setAuthError(null);
      const cleanUser = user.trim() || usernameHint;
      if (!hostAvailable) {
        const stored = previewAccountRef.current;
        if (stored && (stored.username.toLowerCase() !== cleanUser.toLowerCase() || stored.password !== password)) {
          setAuthError('Invalid username or password.');
          setAuthBusy(false);
          return false;
        }
        setUsername(cleanUser);
        setAuthenticated(true);
        setAuthBusy(false);
        return true;
      }
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUser, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAuthError(data.error || 'Invalid username or password.');
          return false;
        }
        tokenRef.current = data.token;
        setUsername(data.username || cleanUser);
        setAuthenticated(true);
        return true;
      } catch {
        setAuthError('Unable to reach the local MMDVM WebGUI server.');
        return false;
      } finally {
        setAuthBusy(false);
      }
    },
    [hostAvailable, usernameHint]
  );

  const logout = useCallback(async () => {
    if (hostAvailable && tokenRef.current) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: authHeaders(),
        });
      } catch {
        // Best-effort server session revocation
      }
    }
    tokenRef.current = null;
    loadedConfigOnceRef.current = false;
    setAuthenticated(false);
    setAuthError(null);
  }, [authHeaders, hostAvailable]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<string | null> => {
      if (!hostAvailable) {
        if (previewAccountRef.current && previewAccountRef.current.password !== currentPassword) {
          return 'Current password is incorrect.';
        }
        previewAccountRef.current = { username, password: newPassword };
        return null;
      }
      try {
        const res = await fetch('/api/auth/password', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return data.error || 'Failed to update password.';
        }
        return null;
      } catch {
        return 'Unable to reach the local MMDVM WebGUI server.';
      }
    },
    [authHeaders, hostAvailable, username]
  );

  const startInstall = useCallback(
    async (config: MmdvmConfiguration): Promise<boolean> => {
      if (!hostAvailable) {
        setJob({
          mode: 'install',
          status: 'succeeded',
          step: 'Preview Mode — Download install-mmdvm.sh or run on Raspberry Pi / Debian',
          stepIndex: 4,
          totalSteps: 4,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          exitCode: 0,
          error: null,
          logs: [
            '[PREVIEW] On your Raspberry Pi / Debian host, clicking Install MMDVM Stack runs:',
            '=== [1/4] Install Build Dependencies, Configure Host & MMDVM User ===',
            '=== [2/4] Clone, Compile & Install g4klx/MMDVMHost ===',
            '=== [3/4] Clone, Compile & Install g4klx/DMRGateway ===',
            '=== [4/4] Write /etc/mmdvm/MMDVM.ini & DMRGateway.ini, Enable & Start Services ===',
            '[PREVIEW] Use "Download install-mmdvm.sh" or deploy this WebGUI via install.sh on your Pi.',
          ],
        });
        setInstalled({ mmdvmhost: true, dmrgateway: true, configWritten: true });
        setServices({ mmdvmhost: 'active', dmrgateway: config.networks.dmrEnable ? 'active' : 'inactive' });
        setSavedConfig(config);
        return true;
      }
      try {
        const res = await fetch('/api/install', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(config),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          return false;
        }
        if (!res.ok) {
          setJob((prev) => ({
            ...prev,
            mode: 'install',
            status: 'failed',
            error: data.error || 'Failed to start installation.',
          }));
          return false;
        }
        setJob({
          mode: 'install',
          status: 'running',
          step: 'Starting MMDVM installer...',
          stepIndex: 0,
          totalSteps: 4,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          exitCode: null,
          error: null,
          logs: ['Starting full MMDVMHost + DMRGateway installation...'],
        });
        return true;
      } catch {
        setJob((prev) => ({
          ...prev,
          mode: 'install',
          status: 'failed',
          error: 'Could not reach /api/install on local server.',
        }));
        return false;
      }
    },
    [authHeaders, handleUnauthorized, hostAvailable]
  );

  const applyConfigOnly = useCallback(
    async (config: MmdvmConfiguration): Promise<boolean> => {
      if (!hostAvailable) {
        setSavedConfig(config);
        setJob({
          mode: 'apply',
          status: 'succeeded',
          step: 'Preview Mode — Config files validated & preview updated',
          stepIndex: 3,
          totalSteps: 3,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          exitCode: 0,
          error: null,
          logs: [
            '[PREVIEW] Config-only update (no package reinstall):',
            '=== [1/3] Save Configuration & Update Host Settings ===',
            '=== [2/3] Write /etc/mmdvm/MMDVM.ini & /etc/mmdvm/DMRGateway.ini ===',
            '=== [3/3] Reload & Restart dmrgateway.service + mmdvmhost.service ===',
          ],
        });
        setServiceMessage('Configuration saved in Preview Mode. Deploy on your Pi to write /etc/mmdvm/*.ini directly.');
        return true;
      }
      try {
        const res = await fetch('/api/apply-config', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(config),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          return false;
        }
        if (!res.ok) {
          setJob((prev) => ({
            ...prev,
            mode: 'apply',
            status: 'failed',
            error: data.error || 'Failed to apply configuration changes.',
          }));
          return false;
        }
        setJob({
          mode: 'apply',
          status: 'running',
          step: 'Writing /etc/mmdvm/MMDVM.ini and DMRGateway.ini...',
          stepIndex: 0,
          totalSteps: 3,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          exitCode: null,
          error: null,
          logs: ['Applying edited MMDVM configuration files (no reinstall)...'],
        });
        return true;
      } catch {
        setJob((prev) => ({
          ...prev,
          mode: 'apply',
          status: 'failed',
          error: 'Could not reach /api/apply-config on local server.',
        }));
        return false;
      }
    },
    [authHeaders, handleUnauthorized, hostAvailable]
  );

  const controlService = useCallback(
    async (unit: ServiceUnit, action: ServiceAction): Promise<boolean> => {
      setServiceBusy(`${unit}:${action}`);
      setServiceMessage(null);
      if (!hostAvailable) {
        setServices((prev) => ({
          ...prev,
          [unit]: action === 'stop' ? 'inactive' : 'active',
        }));
        setServiceMessage(`Preview Mode: simulated systemctl ${action} ${unit}.service.`);
        setServiceBusy(null);
        return true;
      }
      try {
        const res = await fetch('/api/service', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ unit, action }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          return false;
        }
        if (!res.ok) {
          setServiceMessage(data.error || `Failed to ${action} ${unit}.service.`);
          await fetchLive();
          await refreshLogs(unit);
          return false;
        }
        setServiceMessage(`${unit}.service ${action} completed (${data.state || 'ok'}).`);
        await fetchLive();
        await refreshLogs(unit);
        return true;
      } catch {
        setServiceMessage(`Unable to reach /api/service to ${action} ${unit}.`);
        return false;
      } finally {
        setServiceBusy(null);
      }
    },
    [authHeaders, fetchLive, handleUnauthorized, hostAvailable, refreshLogs]
  );

  return {
    checking,
    hostAvailable,
    hostname,
    isRoot,
    authConfigured,
    envManaged,
    usernameHint,
    authenticated,
    username,
    authBusy,
    authError,
    installed,
    detectedSerialPorts,
    services,
    savedConfig,
    live,
    autoRefresh,
    setAutoRefresh,
    job,
    serviceBusy,
    serviceMessage,
    logsUnit,
    setLogsUnit,
    serviceLogs,
    logsLoading,
    setupAdmin,
    login,
    logout,
    changePassword,
    refreshAll,
    refreshLogs,
    startInstall,
    applyConfigOnly,
    controlService,
  };
}
