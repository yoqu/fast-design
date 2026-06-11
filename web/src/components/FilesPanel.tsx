import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { ProjectArtifact } from '../lib/artifacts';
import type { FileEntry } from '../lib/types';
import { api } from '../lib/api';
import { ArrowUpIcon, FolderIcon, PencilIcon } from './icons';

// Semantic sections mirroring open-design DesignFilesPanel's SECTION_ORDER
// (folders pinned first; empty sections are skipped).
type FileCategory = 'html' | 'stylesheet' | 'code' | 'document' | 'image' | 'other';

const SECTION_ORDER: FileCategory[] = ['html', 'stylesheet', 'code', 'document', 'image', 'other'];

const SECTION_LABELS: Record<FileCategory, string> = {
  html: 'HTML',
  stylesheet: '样式表',
  code: '代码',
  document: '文档',
  image: '图片',
  other: '其他',
};

const STYLESHEET_EXTENSIONS = new Set(['css', 'scss', 'sass', 'less']);
const CODE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'json']);
const DOCUMENT_EXTENSIONS = new Set(['md', 'txt', 'pdf']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif']);

function fileCategory(name: string): FileCategory {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (STYLESHEET_EXTENSIONS.has(ext)) return 'stylesheet';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'other';
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

type Props = {
  projectId: string;
  files: FileEntry[];
  artifacts: ProjectArtifact[];
  onOpenFile: (path: string) => void;
  onChanged: () => void;
};

/**
 * Project file browser, mirroring open-design's DesignFilesPanel behavior
 * subset: breadcrumb directory navigation, semantic sections, inline rename,
 * multi-select batch delete, and upload via button or drag-drop.
 */
export function FilesPanel({ projectId, files, artifacts, onOpenFile, onChanged }: Props) {
  const [currentDir, setCurrentDir] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ path: string; draft: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const artifactEntries = useMemo(() => new Set(artifacts.map((a) => a.manifest.entry)), [artifacts]);

  const { dirs, entries } = useMemo(() => {
    const prefix = currentDir ? `${currentDir}/` : '';
    const dirSet = new Set<string>();
    const list: FileEntry[] = [];
    for (const file of files) {
      if (!file.path.startsWith(prefix)) continue;
      const rest = file.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) dirSet.add(rest.slice(0, slash));
      else list.push(file);
    }
    return { dirs: Array.from(dirSet).sort(), entries: list };
  }, [files, currentDir]);

  const sections = useMemo(() => {
    const grouped = new Map<FileCategory, FileEntry[]>();
    for (const file of entries) {
      const name = file.path.slice(currentDir ? currentDir.length + 1 : 0);
      const cat = fileCategory(name);
      const list = grouped.get(cat) ?? [];
      list.push(file);
      grouped.set(cat, list);
    }
    return SECTION_ORDER.filter((cat) => grouped.has(cat)).map((cat) => ({
      category: cat,
      files: grouped.get(cat)!,
    }));
  }, [entries, currentDir]);

  const breadcrumbs = currentDir ? currentDir.split('/') : [];

  function baseName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  async function withErrorHandling(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function commitRename(): Promise<void> {
    if (!renaming) return;
    const { path, draft } = renaming;
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === baseName(path)) return;
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    await withErrorHandling(() => api.renameFile(projectId, path, `${dir}${name}`).then(() => undefined));
  }

  async function deleteSelected(): Promise<void> {
    const targets = Array.from(selected);
    if (targets.length === 0) return;
    if (!window.confirm(`删除选中的 ${targets.length} 个文件?`)) return;
    setSelected(new Set());
    await withErrorHandling(async () => {
      for (const path of targets) await api.deleteFile(projectId, path);
    });
  }

  async function uploadFiles(list: FileList | File[]): Promise<void> {
    await withErrorHandling(async () => {
      for (const file of Array.from(list)) {
        const target = currentDir ? `${currentDir}/${file.name}` : file.name;
        await api.putFile(projectId, target, file, true);
      }
    });
  }

  function onUploadChange(e: ChangeEvent<HTMLInputElement>): void {
    if (e.target.files?.length) void uploadFiles(e.target.files);
    e.target.value = '';
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  }

  function toggleSelected(path: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div
      className={`flex h-full flex-col ${dragOver ? 'bg-zinc-50 ring-2 ring-inset ring-zinc-400' : 'bg-white'}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2">
        <button
          type="button"
          disabled={!currentDir}
          onClick={() => setCurrentDir(breadcrumbs.slice(0, -1).join('/'))}
          title="上一级"
          className="rounded-md px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
        >
          <ArrowUpIcon size={13} />
        </button>
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-xs text-zinc-500">
          <button type="button" onClick={() => setCurrentDir('')} className="hover:text-zinc-900">
            根目录
          </button>
          {breadcrumbs.map((seg, i) => (
            <span key={`${seg}-${i}`} className="flex min-w-0 items-center gap-1">
              <span className="text-zinc-300">/</span>
              <button
                type="button"
                onClick={() => setCurrentDir(breadcrumbs.slice(0, i + 1).join('/'))}
                className="truncate hover:text-zinc-900"
              >
                {seg}
              </button>
            </span>
          ))}
        </nav>
        {selected.size > 0 ? (
          <button
            type="button"
            onClick={() => void deleteSelected()}
            className="rounded-md px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
          >
            删除 ({selected.size})
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-md px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100"
        >
          上传
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={onUploadChange} />
      </div>
      {error ? <p className="border-b border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-600">{error}</p> : null}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {dirs.length > 0 ? (
          <section className="mb-3">
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">文件夹</p>
            {dirs.map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setCurrentDir(currentDir ? `${currentDir}/${dir}` : dir)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100"
              >
                <FolderIcon size={15} className="shrink-0 text-zinc-400" />
                <span className="truncate">{dir}</span>
              </button>
            ))}
          </section>
        ) : null}
        {sections.map(({ category, files: sectionFiles }) => (
          <section key={category} className="mb-3">
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              {SECTION_LABELS[category]}
            </p>
            {sectionFiles.map((file) => {
              const name = baseName(file.path);
              const isRenaming = renaming?.path === file.path;
              return (
                <div
                  key={file.path}
                  className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(file.path)}
                    onChange={() => toggleSelected(file.path)}
                    className={`${selected.has(file.path) ? '' : 'opacity-0 group-hover:opacity-100'}`}
                  />
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renaming.draft}
                      onChange={(e) => setRenaming({ path: file.path, draft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={() => void commitRename()}
                      className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 text-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenFile(file.path)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      title={file.path}
                    >
                      <span className="truncate">{name}</span>
                      {artifactEntries.has(file.path) ? (
                        <span className="rounded bg-zinc-900 px-1 text-[10px] uppercase text-white">artifact</span>
                      ) : null}
                    </button>
                  )}
                  <span className="text-[11px] text-zinc-400">{formatSize(file.size)}</span>
                  {!isRenaming ? (
                    <button
                      type="button"
                      title="重命名"
                      onClick={() => setRenaming({ path: file.path, draft: name })}
                      className="rounded px-1 text-xs text-zinc-400 opacity-0 hover:bg-zinc-200 group-hover:opacity-100"
                    >
                      <PencilIcon size={12} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
        {dirs.length === 0 && sections.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-zinc-400">此目录暂无文件,可拖拽上传</p>
        ) : null}
      </div>
    </div>
  );
}
