import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectArtifact } from '../lib/artifacts';
import type { FileEntry, ProjectMeta } from '../lib/types';
import type { GenerationModel } from '../lib/generation';
import { api, subscribeProjectEvents } from '../lib/api';
import { FileViewer } from './FileViewer';
import { FilesPanel } from './FilesPanel';
import { GenerationStage } from './GenerationStage';
import ProjectSettingsDialog from './ProjectSettingsDialog';

type Props = {
  projectId: string;
  generation: GenerationModel;
  onRetry?: () => void;
  meta?: ProjectMeta;
  onMetaUpdated?: (meta: ProjectMeta) => void;
};

type TabState = { tabs: string[]; active: string | null };

function tabStorageKey(projectId: string): string {
  return `webui:tabs:${projectId}`;
}

function loadTabState(projectId: string): TabState {
  try {
    const raw = localStorage.getItem(tabStorageKey(projectId));
    if (!raw) return { tabs: [], active: null };
    const parsed = JSON.parse(raw) as TabState;
    if (!Array.isArray(parsed.tabs)) return { tabs: [], active: null };
    return { tabs: parsed.tabs.filter((t) => typeof t === 'string'), active: parsed.active ?? null };
  } catch {
    return { tabs: [], active: null };
  }
}

/**
 * Right-hand workspace, mirroring open-design's FileWorkspace: a tab strip of
 * open files above the FileViewer, a files-panel toggle, live-reload via SSE,
 * and "artifact appears → its tab opens" behavior.
 */
export function Workspace({ projectId, generation, onRetry, meta, onMetaUpdated }: Props) {
  const [{ tabs, active }, setTabState] = useState<TabState>(() => loadTabState(projectId));
  const [showFiles, setShowFiles] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const knownEntries = useRef<Set<string> | null>(null);

  useEffect(() => {
    setTabState(loadTabState(projectId));
    knownEntries.current = null;
    setShowFiles(false);
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem(tabStorageKey(projectId), JSON.stringify({ tabs, active }));
  }, [projectId, tabs, active]);

  const openTab = useCallback((path: string) => {
    setTabState((prev) => ({
      tabs: prev.tabs.includes(path) ? prev.tabs : [...prev.tabs, path],
      active: path,
    }));
    setShowFiles(false);
  }, []);

  const closeTab = useCallback((path: string) => {
    setTabState((prev) => {
      const nextTabs = prev.tabs.filter((t) => t !== path);
      const nextActive =
        prev.active === path ? nextTabs[Math.max(0, prev.tabs.indexOf(path) - 1)] ?? null : prev.active;
      return { tabs: nextTabs, active: nextActive };
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [fileList, artifactList] = await Promise.all([api.files(projectId), api.artifacts(projectId)]);
      setFiles(fileList);
      setArtifacts(artifactList);
      // Drop tabs whose file disappeared (delete/rename).
      const paths = new Set(fileList.map((f) => f.path));
      setTabState((prev) => {
        const nextTabs = prev.tabs.filter((t) => paths.has(t));
        if (nextTabs.length === prev.tabs.length) return prev;
        return {
          tabs: nextTabs,
          active: prev.active && paths.has(prev.active) ? prev.active : nextTabs[0] ?? null,
        };
      });
      // Artifact auto-open: a brand-new artifact entry opens (and activates)
      // its tab, mirroring open-design's behavior when a generation lands.
      const entries = new Set(artifactList.map((a) => a.manifest.entry));
      if (knownEntries.current === null) {
        knownEntries.current = entries;
        // First load with no restored tabs: open the first artifact.
        const first = artifactList[0]?.manifest.entry;
        if (first) {
          setTabState((prev) => (prev.tabs.length === 0 ? { tabs: [first], active: first } : prev));
        }
      } else {
        for (const entry of entries) {
          if (!knownEntries.current.has(entry)) openTab(entry);
        }
        knownEntries.current = entries;
      }
    } catch {
      // server unreachable — keep current state
    }
  }, [projectId, openTab]);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeProjectEvents(projectId, () => {
      setReloadKey((v) => v + 1);
      void refresh();
    });
    return unsubscribe;
  }, [projectId, refresh]);

  const activeArtifact = active ? artifacts.find((a) => a.manifest.entry === active) ?? null : null;
  const filePaths = files.map((f) => f.path);
  const stageVisible = generation.phase !== 'idle' && generation.phase !== 'done';

  return (
    <div className="flex h-full w-[46%] min-w-[420px] flex-col border-l border-zinc-200">
      <div className="flex items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-1.5 pt-1.5">
        <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const name = tab.slice(tab.lastIndexOf('/') + 1);
            const isActive = !showFiles && tab === active;
            return (
              <div
                key={tab}
                className={`group flex max-w-44 shrink-0 items-center gap-1 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-xs ${
                  isActive
                    ? 'border-zinc-200 bg-white text-zinc-900'
                    : 'border-transparent text-zinc-500 hover:bg-zinc-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setTabState((prev) => ({ ...prev, active: tab }));
                    setShowFiles(false);
                  }}
                  className="truncate"
                  title={tab}
                >
                  {name}
                </button>
                <button
                  type="button"
                  aria-label={`关闭 ${name}`}
                  onClick={() => closeTab(tab)}
                  className="rounded px-0.5 text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setShowFiles((v) => !v)}
          className={`mb-1 shrink-0 rounded-md px-2 py-1 text-xs ${
            showFiles ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          文件
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          title="项目设置"
          className="mb-1 shrink-0 rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          ⚙
        </button>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {showFiles ? (
          <FilesPanel
            projectId={projectId}
            files={files}
            artifacts={artifacts}
            onOpenFile={openTab}
            onChanged={() => void refresh()}
          />
        ) : active ? (
          <FileViewer
            projectId={projectId}
            file={active}
            artifact={activeArtifact}
            files={filePaths}
            reloadKey={reloadKey}
            generation={generation}
            onRetry={onRetry}
          />
        ) : (
          <div className="relative flex h-full flex-col items-center justify-center text-zinc-400">
            {stageVisible ? (
              <GenerationStage model={generation} onRetry={onRetry} />
            ) : (
              <>
                <span className="text-4xl">▦</span>
                <p className="mt-3 text-sm">在左侧对话生成原型,完成后会自动在这里打开预览</p>
              </>
            )}
          </div>
        )}
      </div>
      {showSettings && meta && onMetaUpdated && (
        <ProjectSettingsDialog meta={meta} onClose={() => setShowSettings(false)} onSaved={onMetaUpdated} />
      )}
    </div>
  );
}
