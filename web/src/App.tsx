import { useCallback, useEffect, useRef, useState } from 'react';
import { api, piApi } from './lib/api';
import type { ConversationSummary, ProjectMeta } from './lib/types';
import { deriveGenerationModel, type GenerationModel } from './lib/generation';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import { Workspace, tabStorageKey } from './components/Workspace';
import InstallGuide from './components/InstallGuide';
import SettingsDialog from './components/settings/SettingsDialog';
import NewProjectPanel from './components/NewProjectPanel';
import type { CreateProjectRequest } from './lib/newProject';

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
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const [piInstalled, setPiInstalled] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

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

  const createProject = async (input: CreateProjectRequest) => {
    const meta = await api.createProject(input);
    await refresh();
    setActiveId(meta.id);
  };

  const importClaudeDesign = async (file: File) => {
    const { project, entryFile } = await api.importClaudeDesign(file);
    try {
      // 等效参照 setTabs(db, id, [entryFile], entryFile)：导入项目首开即预览入口文件。
      localStorage.setItem(tabStorageKey(project.id), JSON.stringify({ tabs: [entryFile], active: entryFile }));
    } catch {
      // localStorage 不可用时仅失去初始 tab，无碍。
    }
    await refresh();
    setActiveId(project.id);
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

  const loadConversations = useCallback(async (projectId: string, preferredId?: string | null) => {
    const list = await api.conversations(projectId);
    setConversations(list);
    setActiveConversationId((current) => {
      const wanted = preferredId ?? current;
      if (wanted && list.some((c) => c.id === wanted)) return wanted;
      return list[0]?.id ?? null;
    });
    return list;
  }, []);

  useEffect(() => {
    setConversations([]);
    setActiveConversationId(null);
    if (activeId) void loadConversations(activeId, null).catch(() => {});
  }, [activeId, loadConversations]);

  const createConversation = useCallback(async () => {
    if (!activeId) return;
    const conv = await api.createConversation(activeId);
    await loadConversations(activeId, conv.id);
  }, [activeId, loadConversations]);

  const deleteConversation = useCallback(
    async (cid: string) => {
      if (!activeId) return;
      await api.deleteConversation(activeId, cid);
      const list = await api.conversations(activeId);
      if (list.length === 0) {
        // 最后一个被删：客户端自动补建空对话。
        const conv = await api.createConversation(activeId);
        await loadConversations(activeId, conv.id);
        return;
      }
      setConversations(list);
      setActiveConversationId((current) => (current === cid ? list[0].id : current));
    },
    [activeId, loadConversations],
  );

  const consumePendingPrompt = useCallback(async () => {
    const id = activeId;
    if (!id) return;
    // 先更新本地（避免重复触发），再持久化清除；失败不影响输入框预填。
    setProjects((list) => list.map((p) => (p.id === id ? { ...p, pendingPrompt: null } : p)));
    try {
      await api.updateProject(id, { pendingPrompt: null });
    } catch {
      // 忽略：下次进入项目最多再预填一次，无害。
    }
  }, [activeId]);

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
        onNewProject={() => setShowNewProject(true)}
        onDelete={deleteProject}
        onOpenSettings={() => setShowSettings(true)}
      />
      {activeId ? (
        <>
          {activeConversationId ? (
            <ChatPanel
              key={`${activeId}:${activeConversationId}`}
              projectId={activeId}
              conversationId={activeConversationId}
              conversations={conversations}
              onSelectConversation={setActiveConversationId}
              onCreateConversation={createConversation}
              onDeleteConversation={deleteConversation}
              onGeneration={setGeneration}
              retryRef={retryRef}
              pendingPrompt={activeMeta?.pendingPrompt ?? null}
              onConsumePendingPrompt={consumePendingPrompt}
            />
          ) : (
            <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-white text-sm text-zinc-400">
              加载对话…
            </div>
          )}
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
      {showNewProject && (
        <NewProjectPanel onClose={() => setShowNewProject(false)} onCreate={createProject} onImportClaudeDesign={importClaudeDesign} />
      )}
    </div>
  );
}
