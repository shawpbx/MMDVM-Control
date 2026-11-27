import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { MmdvmConfiguration } from '../types/mmdvmConfig';
import { generateAllFiles } from '../utils/generators';
import { downloadTextFile } from '../utils/download';

interface ConfigFilesViewProps {
  config: MmdvmConfiguration;
}

export function ConfigFilesView({ config }: ConfigFilesViewProps) {
  const files = useMemo(() => generateAllFiles(config), [config]);
  const [selectedId, setSelectedId] = useState(files[0]?.id || 'mmdvm-ini');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeFile = files.find((f) => f.id === selectedId) || files[0];

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopiedId(activeFile.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownload = () => {
    if (!activeFile) return;
    downloadTextFile(activeFile.filename, activeFile.content);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Generated Configuration Files
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Inspect the exact INI files, systemd units, and standalone bash installer generated from your current configuration.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* File List */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
          {files.map((f) => {
            const isSelected = f.id === activeFile?.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={`w-full text-left p-4 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                  isSelected
                    ? 'bg-sky-50/70 dark:bg-sky-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <p
                  className={`text-sm font-mono font-semibold ${
                    isSelected ? 'text-sky-700 dark:text-sky-400' : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {f.filename}
                </p>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {f.targetPath}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {f.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Code Preview */}
        {activeFile && (
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-mono font-semibold text-slate-900 dark:text-white">
                  {activeFile.targetPath}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {activeFile.content.split('\n').length} lines
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="min-h-[36px] px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {copiedId === activeFile.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedId === activeFile.id ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="min-h-[36px] px-3 py-1.5 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:bg-slate-800 dark:hover:bg-white inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              </div>
            </div>
            <pre className="p-4 max-h-[620px] overflow-auto bg-slate-950 text-slate-200 text-xs leading-relaxed font-mono">
              {activeFile.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
