import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import type { ProjectMeta } from './lib/types';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import PreviewPanel from './components/PreviewPanel';

export default function App() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
      setError(null);
      setActiveId((current) => {
        if (current && list.some((p) => p.id === current)) return current;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法连接服务端');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProject = async (name: string) => {
    try {
      const meta = await api.createProject(name);
      await refresh();
      setActiveId(meta.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await api.deleteProject(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="flex h-full bg-white text-zinc-900">
      <Sidebar
        projects={projects}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={createProject}
        onDelete={deleteProject}
      />
      {activeId ? (
        <>
          <ChatPanel key={activeId} projectId={activeId} />
          <PreviewPanel key={`preview-${activeId}`} projectId={activeId} />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center text-zinc-400">
          <span className="text-5xl">π</span>
          <p className="mt-4 text-sm">新建一个项目，开始和 pi agent 一起开发网页</p>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
