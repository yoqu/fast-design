import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectArtifact } from '../lib/artifacts';
import type { FileEntry, ProjectMeta } from '../lib/types';
import type { GenerationModel } from '../lib/generation';
import type { HandoffInfo } from '../lib/types';
import type { QuestionForm } from '../lib/questionForm';
import { api, subscribeProjectEvents } from '../lib/api';
import { FileViewer } from './FileViewer';
import { FilesPanel } from './FilesPanel';
import { GenerationStage } from './GenerationStage';
import ProjectSettingsDialog from './ProjectSettingsDialog';
import HandoffButton from './HandoffButton';
import QuestionsPanel from './QuestionsPanel';
import WorkingDirPill from './WorkingDirPill';

type Props = {
  projectId: string;
  generation: GenerationModel;
  onRetry?: () => void;
  meta?: ProjectMeta;
  onMetaUpdated?: (meta: ProjectMeta) => void;
  /** focus 模式(隐藏聊天面板,工作区全宽)。 */
  focusMode: boolean;
  onFocusModeChange: (next: boolean) => void;
  /** 拖拽分栏进行中:禁用 iframe 指针事件防止吞掉 pointermove。 */
  interactionDisabled?: boolean;
  /** URL 深链的目标文件;变化时打开对应标签。 */
  routeFileName: string | null;
  /** 活动预览文件变化 → 上层同步进 URL(必须传稳定引用 useCallback)。 */
  onActiveFileChange?: (file: string | null) => void;
  /** 最后一条助手消息派生的问题表单;非空时显示 Questions 标签。 */
  questionForm?: QuestionForm | null;
  /** Questions 提交 → 发送到对话。 */
  onSubmitQuestions?: (text: string) => void;
};

type TabState = { tabs: string[]; active: string | null };

export function tabStorageKey(projectId: string): string {
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
export function Workspace({ projectId, generation, onRetry, meta, onMetaUpdated, focusMode, onFocusModeChange, interactionDisabled, routeFileName, onActiveFileChange, questionForm, onSubmitQuestions }: Props) {
  const [{ tabs, active }, setTabState] = useState<TabState>(() => loadTabState(projectId));
  const [showFiles, setShowFiles] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [handoff, setHandoff] = useState<HandoffInfo | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const knownEntries = useRef<Set<string> | null>(null);

  useEffect(() => {
    setTabState(loadTabState(projectId));
    knownEntries.current = null;
    setShowFiles(false);
    // 清掉上个项目的 handoff 信息,避免新项目顶栏短暂显示旧目录。
    setHandoff(null);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    api.handoffInfo(projectId).then((info) => {
      if (!cancelled) setHandoff(info);
    }).catch(() => {
      if (!cancelled) setHandoff(null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem(tabStorageKey(projectId), JSON.stringify({ tabs, active }));
  }, [projectId, tabs, active]);

  const openTab = useCallback((path: string) => {
    setTabState((prev) => {
      // 同文件重复打开(如 URL 回馈)直接复用,省一次无意义 re-render。
      if (prev.active === path && prev.tabs.includes(path)) return prev;
      return {
        tabs: prev.tabs.includes(path) ? prev.tabs : [...prev.tabs, path],
        active: path,
      };
    });
    setShowFiles(false);
    setShowQuestions(false);
  }, []);

  // URL → 标签:深链/前进后退把目标文件打开为活动标签。
  useEffect(() => {
    if (routeFileName) openTab(routeFileName);
  }, [routeFileName, openTab]);

  // 标签 → URL:活动文件变化回调上层(上层负责 navigate replace)。
  useEffect(() => {
    onActiveFileChange?.(showFiles || showQuestions ? null : active);
  }, [active, showFiles, showQuestions, onActiveFileChange]);

  // 新表单出现自动切到 Questions 标签(对齐参照行为);表单消失自动退出。
  useEffect(() => {
    setShowQuestions(!!questionForm);
  }, [questionForm]);

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
    <div className="flex h-full min-w-0 flex-1 flex-col border-l border-zinc-200">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-2 py-1.5">
        <button
          type="button"
          title={focusMode ? '显示聊天' : '隐藏聊天'}
          aria-label="专注模式"
          aria-pressed={focusMode}
          onClick={() => onFocusModeChange(!focusMode)}
          className="rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          {focusMode ? '⟩' : '⟨'}
        </button>
        <WorkingDirPill projectId={projectId} dir={handoff?.dir ?? null} />
        <div className="flex-1" />
        <HandoffButton projectId={projectId} dir={handoff?.dir ?? null} editors={handoff?.editors ?? []} />
      </div>
      <div className="flex items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-1.5 pt-1.5">
        <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const name = tab.slice(tab.lastIndexOf('/') + 1);
            const isActive = !showFiles && !showQuestions && tab === active;
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
                    setShowQuestions(false);
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
        {questionForm && (
          <button
            type="button"
            onClick={() => {
              setShowQuestions(true);
              setShowFiles(false);
            }}
            className={`mb-1 shrink-0 rounded-md px-2 py-1 text-xs ${
              showQuestions ? 'bg-zinc-900 text-white' : 'text-amber-600 hover:bg-zinc-100'
            }`}
          >
            问题
          </button>
        )}
        <button
          type="button"
          onClick={() => { setShowFiles((v) => !v); setShowQuestions(false); }}
          className={`mb-1 shrink-0 rounded-md px-2 py-1 text-xs ${
            showFiles ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          文件
        </button>
        {meta && onMetaUpdated && (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title="项目设置"
            className="mb-1 shrink-0 rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            ⚙
          </button>
        )}
      </div>
      <div className={`relative min-h-0 flex-1 bg-white ${interactionDisabled ? 'pointer-events-none select-none' : ''}`}>
        {showQuestions && questionForm ? (
          <QuestionsPanel form={questionForm} onSubmit={(text) => onSubmitQuestions?.(text)} />
        ) : showFiles ? (
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
