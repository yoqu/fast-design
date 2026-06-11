// web/src/components/EntryShell.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { buildCreateRequest } from '../lib/newProject';
import type { CreateProjectRequest } from '../lib/newProject';
import type { EntryHomeView } from '../router';
import { navigate } from '../router';
import type { ProjectMeta } from '../lib/types';
import EntryNavRail from './EntryNavRail';
import HomeView from './HomeView';
import ProjectsView from './ProjectsView';
import NewProjectPanel from './NewProjectPanel';
import SettingsDialog from './settings/SettingsDialog';
import { tabStorageKey } from './Workspace';

type Props = { view: EntryHomeView };

/** 入口壳:导航 rail + Home/Projects 视图,对齐参照 EntryShell。 */
export default function EntryShell({ view }: Props) {
  const [railOpen, setRailOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  // 组件卸载(如请求飞行中跳转详情页)后丢弃结果,避免 no-op setState。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listProjects();
      if (!mountedRef.current) return;
      setProjects(list);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '无法连接服务端');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openProject = (id: string) =>
    navigate({ kind: 'project', projectId: id, conversationId: null, fileName: null });

  const createProject = async (input: CreateProjectRequest) => {
    const meta = await api.createProject(input);
    openProject(meta.id);
  };

  const createFromPrompt = async (prompt: string) => {
    await createProject(
      buildCreateRequest({
        name: '',
        prompt,
        model: null,
        platformTargets: ['responsive'],
        fidelity: 'high-fidelity',
        includeLandingPage: false,
        includeOsWidgets: false,
      }),
    );
  };

  const importClaudeDesign = async (file: File) => {
    const { project, entryFile } = await api.importClaudeDesign(file);
    try {
      // 等效参照:导入项目首开即预览入口文件。
      localStorage.setItem(tabStorageKey(project.id), JSON.stringify({ tabs: [entryFile], active: entryFile }));
    } catch {
      // localStorage 不可用时仅失去初始 tab,无碍。
    }
    openProject(project.id);
  };

  const renameProject = async (id: string, name: string) => {
    try {
      await api.updateProject(id, { name });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名失败');
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
      <EntryNavRail
        open={railOpen}
        view={view}
        onClose={() => setRailOpen(false)}
        onNavigate={(v) => navigate({ kind: 'home', view: v })}
        onNewProject={() => setShowNewProject(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          {!railOpen && (
            <button
              type="button"
              title="展开导航"
              aria-label="展开导航"
              onClick={() => setRailOpen(true)}
              className="rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100"
            >
              ☰
            </button>
          )}
          <span className="text-sm font-semibold text-zinc-800">{view === 'home' ? 'Home' : 'Projects'}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowNewProject(true)}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700"
          >
            ＋ 新建项目
          </button>
        </header>
        {error && <p className="px-6 pt-2 text-xs text-red-500">{error}</p>}
        {view === 'home' ? (
          <HomeView
            projects={projects}
            onOpen={openProject}
            onRename={renameProject}
            onDelete={deleteProject}
            onCreateFromPrompt={createFromPrompt}
            onNewProject={() => setShowNewProject(true)}
            onViewAll={() => navigate({ kind: 'home', view: 'projects' })}
          />
        ) : (
          <ProjectsView
            projects={projects}
            onOpen={openProject}
            onRename={renameProject}
            onDelete={deleteProject}
            onNewProject={() => setShowNewProject(true)}
          />
        )}
      </main>
      {showSettings && <SettingsDialog projectId={null} onClose={() => setShowSettings(false)} />}
      {showNewProject && (
        <NewProjectPanel
          onClose={() => setShowNewProject(false)}
          onCreate={createProject}
          onImportClaudeDesign={importClaudeDesign}
        />
      )}
    </div>
  );
}
