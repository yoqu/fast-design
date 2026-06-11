// web/src/components/WorkingDirPill.tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ChevronDownIcon, FolderIcon } from './icons';

type Props = { projectId: string; dir: string | null };

/** 工作目录 pill,对齐参照 WorkingDirPill(裁剪 Replace:无外部工作目录概念)。 */
export default function WorkingDirPill({ projectId, dir }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!dir) return null;
  const lastSegment = dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        title={dir}
        onClick={() => { setOpen((v) => !v); setError(null); }}
        className="flex max-w-48 items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
      >
        <FolderIcon size={13} className="shrink-0" />
        <span className="truncate">{lastSegment}</span>
        <ChevronDownIcon size={12} className="shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 text-xs shadow-lg">
          <p className="break-all px-2 py-1.5 text-[10px] text-zinc-400">{dir}</p>
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50"
            onClick={async () => {
              setOpen(false);
              try {
                await api.revealProject(projectId);
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : '打开失败');
              }
            }}
          >
            在文件管理器中显示
          </button>
        </div>
      )}
      {error && <p className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded bg-red-50 px-2 py-1 text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
