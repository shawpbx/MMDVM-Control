import { FormEvent, useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, Moon, Radio, ShieldCheck, Sun } from 'lucide-react';
import { LocalNodeController } from '../hooks/useLocalNode';

interface LoginViewProps {
  localNode: LocalNodeController;
  darkMode: boolean;
  onToggleDark: () => void;
}

export function LoginView({ localNode, darkMode, onToggleDark }: LoginViewProps) {
  const isFirstRunSetup = !localNode.authConfigured;
  const [username, setUsername] = useState(localNode.usernameHint || 'admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (isFirstRunSetup) {
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username.trim())) {
        setLocalError('Username must be 3–32 characters (letters, numbers, dot, underscore, hyphen).');
        return;
      }
      if (password.length < 8) {
        setLocalError('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match.');
        return;
      }
      await localNode.setupAdmin(username.trim(), password);
      return;
    }

    if (!password) {
      setLocalError('Enter your administrator password.');
      return;
    }
    await localNode.login(username.trim(), password);
  };

  const errorMessage = localError || localNode.authError;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 grid lg:grid-cols-12">
      {/* Left Architectural Brand & Capabilities Panel */}
      <aside className="lg:col-span-5 bg-slate-900 text-slate-100 px-8 py-10 lg:px-12 lg:py-14 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800">
        <div className="space-y-10">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Radio className="w-5 h-5 text-sky-400 shrink-0" aria-hidden="true" />
              <span className="font-display text-lg font-semibold tracking-tight text-white whitespace-nowrap">
                MMDVM Control
              </span>
            </div>
            <button
              type="button"
              onClick={onToggleDark}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-md border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          <div className="space-y-4">
            <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
              Digital Voice Hotspot Installer &amp; Configurator
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed max-w-md">
              Configure your station callsign, RF modem hardware, and DMR/YSF/D-Star/P25/NXDN networks before installation—then edit and apply configuration files anytime without reinstalling binaries.
            </p>
          </div>

          <div className="pt-6 border-t border-slate-800 space-y-5">
            <div>
              <p className="text-xs font-semibold text-sky-400">01. Pre-Install Configurator</p>
              <p className="text-sm text-slate-300 mt-1">
                Pick from 13 GPIO and USB MMDVM modem presets, auto-detected Raspberry Pi serial ports, and verified DMR master servers.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-sky-400">02. Automated MMDVMHost &amp; DMRGateway Build</p>
              <p className="text-sm text-slate-300 mt-1">
                Compiles upstream g4klx/MMDVMHost and DMRGateway cleanly on Debian 12/13 with the mmdvm system user, dialout access, and systemd services.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-sky-400">03. Post-Install Config Updates Without Reinstalling</p>
              <p className="text-sm text-slate-300 mt-1">
                Change frequencies, offsets, modem ports, or DMR passwords and apply directly to /etc/mmdvm/*.ini with automatic backups and instant service reload.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-8 mt-8 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
          <span>Host: {localNode.hostname}</span>
          <span>{localNode.hostAvailable ? 'Local Node Mode' : 'Preview Mode'}</span>
        </div>
      </aside>

      {/* Right Authentication Form Panel */}
      <main className="lg:col-span-7 flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              {isFirstRunSetup ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <span>Initial Administrator Setup</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <span>Operator Authentication</span>
                </>
              )}
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {isFirstRunSetup ? 'Create Admin Login' : 'Sign in to MMDVM Control'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {isFirstRunSetup
                ? 'Set the administrator username and password to protect installation, configuration writes, and service restarts on this host.'
                : 'Enter your administrator credentials to manage MMDVMHost, DMRGateway, and configuration files.'}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5"
          >
            {errorMessage && (
              <div
                role="alert"
                className="p-3 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300"
              >
                {errorMessage}
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="login-username"
                className="block text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                Username
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full min-h-[42px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isFirstRunSetup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isFirstRunSetup ? 'Minimum 8 characters' : 'Enter password'}
                  required
                  className="w-full min-h-[42px] pl-3 pr-10 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {isFirstRunSetup && (
              <div className="space-y-1.5">
                <label
                  htmlFor="login-confirm"
                  className="block text-sm font-medium text-slate-800 dark:text-slate-200"
                >
                  Confirm Password
                </label>
                <input
                  id="login-confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  className="w-full min-h-[42px] px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={localNode.authBusy}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-md bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {localNode.authBusy && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{isFirstRunSetup ? 'Create Admin Account & Sign In' : 'Sign In'}</span>
            </button>
          </form>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {localNode.hostAvailable
              ? localNode.envManaged
                ? 'Administrator login is configured via the server environment variable.'
                : 'Credentials are stored as a salted scrypt hash in /etc/mmdvm-webgui/admin.json (0600). Sessions stay in memory only.'
              : 'Preview Mode: Create a temporary local session password to explore the pre-install configurator, installer, and post-install dashboard.'}
          </p>
        </div>
      </main>
    </div>
  );
}
