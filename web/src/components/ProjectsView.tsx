// web/src/components/ProjectsView.tsx
import { useMemo, useState } from 'react';
import { filterProjects, sortProjects, type ProjectsSubTab } from '../lib/projectsList';
import type { ProjectMeta } from '../lib/types';
import ProjectCard from './ProjectCard';

type Props = {
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onNewProject: () => void;
};

/**
 * Projects 完整列表视图,对齐参照 DesignsTab:搜索、Recent/Yours 子标签
 * (排序差异)、Select 批量删除、卡片网格。Kanban 因无任务状态体系裁剪。
 */
export default function ProjectsView({ projects, onOpen, onRename, onDelete, onNewProject }: Props) {
  const [query, setQuery] = useState('');
  const [subTab, setSubTab] = useState<ProjectsSubTab>('recent');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => sortProjects(filterProjects(projects, query), subTab),
    [projects, query, subTab],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const deleteSelected = () => {
    if (selected.size === 0) return;
    if (!confirm(`删除选中的 ${selected.size} 个项目？此操作不可恢复。`)) return;
    for (const id of selected) onDelete(id);
    exitSelectMode();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-6 py-3">
        <div className="flex rounded-lg bg-zinc-100 p-0.5 text-xs">
          {(
            [
              ['recent', '最近'],
              ['created', '按创建时间'],
            ] as Array<[ProjectsSubTab, string]>
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSubTab(tab)}
              className={`rounded-md px-2.5 py-1 ${subTab === tab ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索项目…"
          className="w-56 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs outline-none focus:border-zinc-400"
        />
        <div className="flex-1" />
        {selectMode ? (
          <>
            <span className="text-xs text-zinc-500">已选 {selected.size} 项</span>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selected.size === 0}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
            >
              删除所选
            </button>
            <button type="button" onClick={exitSelectMode} className="rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">
              取消
            </button>
          </>
        ) : (
          projects.length > 0 && (
            <button type="button" onClick={() => setSelectMode(true)} className="rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">
              选择
            </button>
          )
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-zinc-400">
            <span className="text-5xl">π</span>
            {projects.length === 0 ? (
              <>
                <p className="mt-4 text-sm">还没有项目</p>
                <button
                  type="button"
                  onClick={onNewProject}
                  className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
                >
                  ＋ 新建项目
                </button>
              </>
            ) : (
              <p className="mt-4 text-sm">没有匹配「{query}」的项目</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {visible.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={onOpen}
                onRename={onRename}
                onDelete={onDelete}
                selectMode={selectMode}
                selected={selected.has(p.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
