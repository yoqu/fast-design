import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribeProjectEvents } from '../lib/api';
import type { FileEntry } from '../lib/types';

const PREVIEWABLE = /\.(html?|svg|pdf|png|jpe?g|gif|webp)$/i;

export default function PreviewPanel({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [entry, setEntry] = useState('index.html');
  const [reloadKey, setReloadKey] = useState(0);
  const entryRef = useRef(entry);
  entryRef.current = entry;

  const refreshFiles = useCallback(async () => {
    try {
      const list = await api.files(projectId);
      setFiles(list);
      const previewable = list.filter((f) => PREVIEWABLE.test(f.path));
      // If the chosen entry vanished, fall back to index.html or the first page.
      if (!previewable.some((f) => f.path === entryRef.current)) {
        const fallback =
          previewable.find((f) => f.path === 'index.html') ?? previewable[0];
        if (fallback) setEntry(fallback.path);
      }
    } catch {
      setFiles([]);
    }
  }, [projectId]);

  useEffect(() => {
    setEntry('index.html');
    void refreshFiles();
    const unsubscribe = subscribeProjectEvents(projectId, () => {
      void refreshFiles();
      setReloadKey((k) => k + 1);
    });
    return unsubscribe;
  }, [projectId, refreshFiles]);

  const previewable = useMemo(() => files.filter((f) => PREVIEWABLE.test(f.path)), [files]);
  const src = `${api.previewUrl(projectId, entry)}?r=${reloadKey}`;

  return (
    <div className="flex h-full w-[46%] min-w-[380px] shrink-0 flex-col border-l border-zinc-200 bg-zinc-100">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
        <select
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          className="max-w-48 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs outline-none"
        >
          {previewable.length === 0 && <option value="index.html">index.html</option>}
          {previewable.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          title="刷新预览"
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50"
        >
          ⟳ 刷新
        </button>
        <a
          href={api.previewUrl(projectId, entry)}
          target="_blank"
          rel="noreferrer"
          title="在新窗口打开"
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50"
        >
          ↗ 新窗口
        </a>
        <span className="ml-auto text-xs text-zinc-400">{files.length} 个文件</span>
        <a
          href={api.exportUrl(projectId)}
          download
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-white hover:bg-zinc-700"
        >
          ⬇ 导出 ZIP
        </a>
      </div>
      <div className="flex-1 p-3">
        <iframe
          key={`${projectId}:${reloadKey}:${entry}`}
          src={src}
          title="预览"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          className="h-full w-full rounded-lg border border-zinc-200 bg-white shadow-sm"
        />
      </div>
    </div>
  );
}
