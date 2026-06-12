// web/src/components/HomeView.tsx
import { useState } from 'react';
import { sortProjects } from '../lib/projectsList';
import type { ProjectMeta } from '../lib/types';
import ProjectCard from './ProjectCard';
import AttachmentPicker from './AttachmentPicker';
import { ArrowRightIcon } from './icons';

type Props = {
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Hero 提交:用 prompt + 附件建项目(pendingPrompt 语义,预填不自动发)。 */
  onCreateFromPrompt: (prompt: string, files: File[]) => Promise<void>;
  /** 打开新建/导入面板。 */
  onNewProject: () => void;
  onViewAll: () => void;
};

/**
 * Home 视图,对齐参照 HomeView:Hero 大输入框 + 导入入口 +
 * RecentProjectsStrip(最近 6 个 + View all)。插件/模板区块为排除项。
 */
export default function HomeView({ projects, onOpen, onRename, onDelete, onCreateFromPrompt, onNewProject, onViewAll }: Props) {
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = sortProjects(projects, 'recent').slice(0, 6);

  const submit = async () => {
    const text = prompt.trim();
    if ((!text && files.length === 0) || creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreateFromPrompt(text, files);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-center text-2xl font-semibold text-zinc-800">今天想做个什么?</h1>
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm focus-within:border-zinc-400">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.items)
                .filter((item) => item.kind === 'file')
                .map((item) => item.getAsFile())
                .filter((f): f is File => !!f);
              if (pasted.length > 0) {
                e.preventDefault();
                setFiles((prev) => [...prev, ...pasted]);
              }
            }}
            rows={3}
            placeholder="描述你想做的网页,比如「做一个咖啡店落地页」…"
            className="w-full resize-none bg-transparent px-1 text-sm outline-none"
            aria-label="项目需求描述"
          />
          {files.length > 0 && (
            <div className="px-1 pb-1">
              <AttachmentPicker files={files} onChange={setFiles} disabled={creating} addLabel="继续添加" />
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1">
              {files.length === 0 && (
                <AttachmentPicker files={files} onChange={setFiles} disabled={creating} addLabel="附件" />
              )}
              <button type="button" onClick={onNewProject} className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100">
                更多选项 / 导入现有项目
              </button>
            </div>
            <button
              type="button"
              disabled={(!prompt.trim() && files.length === 0) || creating}
              onClick={() => void submit()}
              className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {creating ? '创建中…' : '开始'}
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-center text-xs text-red-500">{error}</p>}

        {recent.length > 0 && (
          <div className="mt-12">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-700">最近项目</h2>
              <button type="button" onClick={onViewAll} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800">
                查看全部
                <ArrowRightIcon size={12} />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {recent.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
