import { useCallback, useEffect, useState } from 'react';
import { piApi } from '../../lib/api';
import type { ExtensionInfo } from '../../lib/types';

export default function ExtensionsSection() {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setExtensions(await piApi.extensions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async () => {
    const s = source.trim();
    if (!s || busy) return;
    setBusy(true);
    setOutput(null);
    setError(null);
    try {
      const result = await piApi.installExtension(s);
      setOutput(result.output);
      if (result.ok) {
        setSource('');
        await load();
      } else {
        setError('安装失败，详见输出');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: string) => {
    if (busy || !confirm(`卸载扩展「${s}」？`)) return;
    setBusy(true);
    setOutput(null);
    setError(null);
    try {
      const result = await piApi.removeExtension(s);
      setOutput(result.output);
      if (!result.ok) setError('卸载失败，详见输出');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '卸载失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-zinc-800">Extensions（pi 扩展包）</h3>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void install()}
          placeholder="npm 包名或 git:github.com/user/repo"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <button onClick={() => void install()} disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50">
          {busy ? '执行中…' : '安装'}
        </button>
      </div>
      {extensions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400">尚未安装任何扩展</p>
      ) : (
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {extensions.map((e) => (
            <div key={e.source} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 truncate font-mono text-zinc-700">{e.source}</span>
              <button onClick={() => void remove(e.source)} disabled={busy} className="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-50">
                卸载
              </button>
            </div>
          ))}
        </div>
      )}
      {output && (
        <details open className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
          <summary className="cursor-pointer text-xs text-zinc-500">命令输出</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-600">{output}</pre>
        </details>
      )}
    </div>
  );
}
