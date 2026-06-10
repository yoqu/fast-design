import { useCallback, useEffect, useRef, useState } from 'react';
import { api, piApi } from './lib/api';
import type { ProjectMeta } from './lib/types';
import { deriveGenerationModel, type GenerationModel } from './lib/generation';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import { Workspace } from './components/Workspace';
import InstallGuide from './components/InstallGuide';
import SettingsDialog from './components/settings/SettingsDialog';

const IDLE_GENERATION = deriveGenerationModel({
  busy: false,
  aborted: false,
  error: null,
  sawDelta: false,
  lastActivity: null,
  lastWrite: null,
  turnEnded: false,
});

export default function App() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<GenerationModel>(IDLE_GENERATION);
  const retryRef = useRef<(() => void) | null>(null);
  const [piInstalled, setPiInstalled] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const checkPi = useCallback(async (): Promise<boolean> => {
    try {
      const status = await piApi.status();
      setPiInstalled(status.installed);
      return status.installed;
    } catch {
      setPiInstalled(true); // server 不可达时不阻塞主界面，由现有 error 流程提示
      return true;
    }
  }, []);

  useEffect(() => {
    void checkPi();
  }, [checkPi]);

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

  const createProject = async (name: string, model?: string | null) => {
    try {
      const meta = await api.createProject(name, model);
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

  const activeMeta = projects.find((p) => p.id === activeId);

  const onMetaUpdated = (meta: ProjectMeta) => {
    setProjects((list) => list.map((p) => (p.id === meta.id ? meta : p)));
  };

  if (piInstalled === false) return <InstallGuide onRecheck={checkPi} />;

  return (
    <div className="flex h-full bg-white text-zinc-900">
      <Sidebar
        projects={projects}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={createProject}
        onDelete={deleteProject}
        onOpenSettings={() => setShowSettings(true)}
      />
      {activeId ? (
        <>
          <ChatPanel key={activeId} projectId={activeId} onGeneration={setGeneration} retryRef={retryRef} />
          <Workspace
            key={`workspace-${activeId}`}
            projectId={activeId}
            generation={generation}
            onRetry={() => retryRef.current?.()}
            meta={activeMeta}
            onMetaUpdated={onMetaUpdated}
          />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center text-zinc-400">
          <span className="text-5xl">π</span>
          <p className="mt-4 text-sm">新建一个项目，开始和 pi agent 一起开发网页</p>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>
      )}
      {showSettings && <SettingsDialog projectId={activeId} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
