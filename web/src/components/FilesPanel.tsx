import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import type { ProjectArtifact } from '../lib/artifacts';
import type { FileEntry } from '../lib/types';
import { api } from '../lib/api';
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, PencilIcon } from './icons';

// Semantic ordering mirroring open-design DesignFilesPanel's SECTION_ORDER —
// HTML always sorts first so entry pages sit at the top of the tree.
type FileCategory = 'html' | 'stylesheet' | 'code' | 'document' | 'image' | 'other';

const CATEGORY_RANK: Record<FileCategory, number> = {
  html: 0,
  stylesheet: 1,
  code: 2,
  document: 3,
  image: 4,
  other: 5,
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

type TreeDir = {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: FileEntry[];
};

function buildTree(files: FileEntry[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [] };
  const dirMap = new Map<string, TreeDir>([['', root]]);
  const dirFor = (dirPath: string): TreeDir => {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;
    const slash = dirPath.lastIndexOf('/');
    const parent = dirFor(slash >= 0 ? dirPath.slice(0, slash) : '');
    const node: TreeDir = { name: dirPath.slice(slash + 1), path: dirPath, dirs: [], files: [] };
    parent.dirs.push(node);
    dirMap.set(dirPath, node);
    return node;
  };
  for (const file of files) {
    const slash = file.path.lastIndexOf('/');
    dirFor(slash >= 0 ? file.path.slice(0, slash) : '').files.push(file);
  }
  const sortDir = (dir: TreeDir): void => {
    dir.files.sort((a, b) => {
      const ra = CATEGORY_RANK[fileCategory(a.path)];
      const rb = CATEGORY_RANK[fileCategory(b.path)];
      if (ra !== rb) return ra - rb;
      return a.path.localeCompare(b.path);
    });
    dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
    dir.dirs.forEach(sortDir);
  };
  sortDir(root);
  return root;
}

type Props = {
  projectId: string;
  files: FileEntry[];
  artifacts: ProjectArtifact[];
  onOpenFile: (path: string) => void;
  onChanged: () => void;
};

/**
 * Project file browser rendered as a fully-expanded tree (no breadcrumb
 * drilling): HTML files pinned to the top of each level, folders collapsible
 * but open by default. Keeps inline rename, multi-select batch delete, and
 * upload via button or drag-drop.
 */
export function FilesPanel({ projectId, files, artifacts, onOpenFile, onChanged }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ path: string; draft: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const artifactEntries = useMemo(() => new Set(artifacts.map((a) => a.manifest.entry)), [artifacts]);
  const tree = useMemo(() => buildTree(files), [files]);

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
        await api.putFile(projectId, file.name, file, true);
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

  function toggleCollapsed(path: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderFile(file: FileEntry, depth: number) {
    const name = baseName(file.path);
    const isRenaming = renaming?.path === file.path;
    return (
      <div
        key={file.path}
        style={{ paddingLeft: depth * 16 + 8 }}
        className="group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-sm text-zinc-700 hover:bg-zinc-100"
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
  }

  function renderDir(dir: TreeDir, depth: number): ReactNode {
    const isCollapsed = collapsed.has(dir.path);
    return (
      <div key={dir.path}>
        <button
          type="button"
          onClick={() => toggleCollapsed(dir.path)}
          style={{ paddingLeft: depth * 16 + 8 }}
          className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
          aria-expanded={!isCollapsed}
        >
          <span className="text-zinc-400">
            {isCollapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
          </span>
          <FolderIcon size={15} className="shrink-0 text-zinc-400" />
          <span className="truncate">{dir.name}</span>
        </button>
        {!isCollapsed ? renderChildren(dir, depth + 1) : null}
      </div>
    );
  }

  function renderChildren(dir: TreeDir, depth: number): ReactNode {
    return (
      <>
        {dir.files.map((file) => renderFile(file, depth))}
        {dir.dirs.map((sub) => renderDir(sub, depth))}
      </>
    );
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
        <span className="min-w-0 flex-1 text-xs font-medium text-zinc-500">文件</span>
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
        {renderChildren(tree, 0)}
        {tree.files.length === 0 && tree.dirs.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-zinc-400">暂无文件,可拖拽上传</p>
        ) : null}
      </div>
    </div>
  );
}
