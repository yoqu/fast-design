import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ProjectArtifact } from '../lib/artifacts';
import { api } from '../lib/api';
import { DownloadIcon } from './icons';
import {
  exportAsHtml,
  exportAsPdf,
  exportProjectAsZip,
  imageDataUrlToBlob,
  prepareImageExportTarget,
  requestPreviewSnapshotResult,
  type ImageExportFormat,
} from '../lib/exports';

type Props = {
  projectId: string;
  file: string;
  artifact: ProjectArtifact | null;
  files: string[];
  iframeRef: RefObject<HTMLIFrameElement | null>;
};

const IMAGE_FORMATS: { format: ImageExportFormat; label: string }[] = [
  { format: 'png', label: 'PNG' },
  { format: 'jpeg', label: 'JPEG' },
  { format: 'webp', label: 'WebP' },
];

/**
 * Export popover for the active artifact, mirroring open-design's share menu
 * Export / Image sections: formats come from the artifact manifest's
 * `exports`, plus snapshot-based image capture and the whole-project archive.
 */
export function ExportMenu({ projectId, file, artifact, files, iframeRef }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const title = artifact?.manifest.title || file;
  const exports = artifact?.manifest.exports ?? ['html', 'pdf', 'zip'];

  async function run(label: string, action: () => Promise<void> | void): Promise<void> {
    setStatus(`${label}…`);
    try {
      await action();
      setStatus(null);
      setOpen(false);
    } catch (err) {
      setStatus(`${label}失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function exportImage(format: ImageExportFormat): Promise<void> {
    const iframe = iframeRef.current;
    if (!iframe) throw new Error('预览尚未就绪');
    const target = await prepareImageExportTarget(title, format);
    if (!target) return; // user cancelled the picker
    const result = await requestPreviewSnapshotResult(iframe);
    if (!result.ok) throw new Error(`截图失败 (${result.reason})`);
    const blob = await imageDataUrlToBlob(result.snapshot.dataUrl, format);
    await target.save(blob);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
        aria-expanded={open}
      >
        <DownloadIcon size={13} />
        导出
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">导出</p>
          {exports.includes('html') ? (
            <MenuItem
              label="HTML 文件"
              onClick={() => run('导出 HTML', async () => exportAsHtml(await api.readFile(projectId, file), title))}
            />
          ) : null}
          {exports.includes('pdf') ? (
            <MenuItem
              label="PDF(打印)"
              onClick={() => run('导出 PDF', async () => exportAsPdf(await api.readFile(projectId, file), title))}
            />
          ) : null}
          {exports.includes('zip') ? (
            <MenuItem
              label="ZIP(含实现交接文档)"
              onClick={() =>
                run('导出 ZIP', async () =>
                  exportProjectAsZip({
                    projectId,
                    filePath: file,
                    fallbackHtml: await api.readFile(projectId, file),
                    fallbackTitle: title,
                  }),
                )
              }
            />
          ) : null}
          <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">图片</p>
          {IMAGE_FORMATS.map(({ format, label }) => (
            <MenuItem key={format} label={label} onClick={() => run(`导出 ${label}`, () => exportImage(format))} />
          ))}
          <div className="my-1 border-t border-zinc-100" />
          <MenuItem
            label="导出整个项目 ZIP"
            onClick={() =>
              run('导出项目', () => {
                const a = document.createElement('a');
                a.href = api.exportUrl(projectId);
                a.download = '';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              })
            }
          />
          {status ? <p className="px-2 py-1 text-[11px] text-zinc-500">{status}</p> : null}
          <span className="sr-only">{files.length} 个文件</span>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100"
    >
      {label}
    </button>
  );
}
