import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { relativeTime } from '../lib/relativeTime';
import type { ProjectMeta } from '../lib/types';

type Props = {
  project: ProjectMeta;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** 批量选择模式:显示勾选框,点击卡片切换选中而非打开。 */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
};

/**
 * 项目卡片,对齐参照 RecentProjectsStrip.tsx:157-218 + DesignsTab 卡片:
 * 缩略图(入口 HTML iframe / 首字母渐变)、名称、类型标签、运行状态点、
 * 相对时间、hover ⋯ 菜单(打开/重命名/删除)、双击重命名。
 */
export default function ProjectCard({ project, onOpen, onRename, onDelete, selectMode, selected, onToggleSelect }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const entry = project.metadata?.entryFile ?? null;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const commitRename = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== project.name) onRename(project.id, name);
    else setDraft(project.name);
  };

  const handleCardClick = () => {
    if (editing) return;
    if (selectMode) onToggleSelect?.(project.id);
    else onOpen(project.id);
  };

  return (
    <div
      className={`group relative cursor-pointer rounded-xl border bg-white transition-shadow hover:shadow-md ${
        selected ? 'border-zinc-900' : 'border-zinc-200'
      }`}
      onClick={handleCardClick}
    >
      <div className="pointer-events-none relative h-36 overflow-hidden rounded-t-xl border-b border-zinc-100 bg-zinc-50">
        {entry ? (
          <iframe
            src={api.fileUrl(project.id, entry)}
            sandbox="allow-scripts"
            tabIndex={-1}
            title={`${project.name} 预览`}
            className="h-[576px] w-[400%] origin-top-left scale-[0.25] border-0 bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-3xl font-semibold text-zinc-400">
            {(project.name[0] ?? 'π').toUpperCase()}
          </div>
        )}
        {selectMode && (
          <span
            className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
              selected ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-transparent'
            }`}
          >
            ✓
          </span>
        )}
      </div>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Prototype</span>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setDraft(project.name);
                  setEditing(false);
                }
              }}
              className="block w-full rounded border border-zinc-300 px-1 py-0.5 text-sm"
            />
          ) : (
            <p
              className="truncate text-sm font-medium text-zinc-800"
              title={project.name}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setDraft(project.name);
                setEditing(true);
              }}
            >
              {project.name}
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
            {project.running && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" title="生成中" />
            )}
            {relativeTime(project.updatedAt ?? project.createdAt)}
          </p>
        </div>
        {!selectMode && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="项目操作"
              className="rounded-md px-1.5 py-0.5 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-zinc-200 bg-white p-1 text-xs shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <button type="button" role="menuitem" className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50" onClick={() => onOpen(project.id)}>
                  打开
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50"
                  onClick={() => {
                    setMenuOpen(false);
                    setDraft(project.name);
                    setEditing(true);
                  }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-md px-2 py-1.5 text-left text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setMenuOpen(false);
                    if (confirm(`删除项目「${project.name}」？此操作不可恢复。`)) onDelete(project.id);
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
