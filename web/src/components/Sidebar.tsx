import { useEffect, useState } from 'react';
import { piApi } from '../lib/api';
import type { PiModel, ProjectMeta } from '../lib/types';

type Props = {
  projects: ProjectMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, model?: string | null) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
};

export default function Sidebar({ projects, activeId, onSelect, onCreate, onDelete, onOpenSettings }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<PiModel[]>([]);

  useEffect(() => {
    if (creating) piApi.models().then(setModels).catch(() => setModels([]));
  }, [creating]);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed, model || null);
    setName('');
    setModel('');
    setCreating(false);
  };

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-zinc-200">
        <span className="text-lg">π</span>
        <span className="text-sm font-semibold text-zinc-800">Pi Web Studio</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {projects.map((p) => (
          <div
            key={p.id}
            className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm ${
              p.id === activeId ? 'bg-zinc-200/80 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
            onClick={() => onSelect(p.id)}
          >
            <span className="truncate">{p.name}</span>
            <button
              className="hidden text-zinc-400 hover:text-red-500 group-hover:block"
              title="删除项目"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`删除项目「${p.name}」？此操作不可恢复。`)) onDelete(p.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {projects.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-zinc-400">还没有项目，点击下方新建</p>
        )}
      </div>

      <div className="border-t border-zinc-200 p-2">
        {creating ? (
          <div className="space-y-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') setCreating(false);
              }}
              placeholder="项目名称"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            />
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 outline-none focus:border-zinc-500"
            >
              <option value="">模型：跟随全局默认</option>
              {models.map((m) => (
                <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.provider}/{m.id}</option>
              ))}
            </select>
            <div className="flex gap-1.5">
              <button onClick={submit} className="flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">创建</button>
              <button onClick={() => setCreating(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50">取消</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
          >
            ＋ 新建项目
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
        >
          ⚙ 设置
        </button>
      </div>
    </aside>
  );
}
