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
import ProjectSettingsMenu from './ProjectSettingsDialog';
import QuestionsPanel from './QuestionsPanel';
import WorkingDirPill from './WorkingDirPill';
import { FolderIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, XIcon } from './icons';

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
  /** 活动问题表单（最终或流式预览）;非空时显示 Questions 标签。 */
  questionForm?: QuestionForm | null;
  /** 表单 occurrence 稳定 key（逐题 reveal 只播一次）。 */
  questionFormKey?: string | null;
  /** 表单是否可交互（最新且未回答）。 */
  questionFormInteractive?: boolean;
  /** 回合进行中:表单保持可编辑但禁止提交。 */
  questionFormSubmitDisabled?: boolean;
  /** 已提交答案（锁定态回填）。 */
  questionFormSubmittedAnswers?: Record<string, string | string[]>;
  /** 表单仍在流式生成中。 */
  questionsGenerating?: boolean;
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
export function Workspace({ projectId, generation, onRetry, meta, onMetaUpdated, focusMode, onFocusModeChange, interactionDisabled, routeFileName, onActiveFileChange, questionForm, questionFormKey, questionFormInteractive, questionFormSubmitDisabled, questionFormSubmittedAnswers, questionsGenerating, onSubmitQuestions }: Props) {
  const [{ tabs, active }, setTabState] = useState<TabState>(() => loadTabState(projectId));
  // 「设计文件」是固定的默认 tab：无恢复的文件标签时它就是活动 tab。
  const [showFiles, setShowFiles] = useState(() => loadTabState(projectId).active == null);
  const [showQuestions, setShowQuestions] = useState(false);
  const [handoff, setHandoff] = useState<HandoffInfo | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const knownEntries = useRef<Set<string> | null>(null);

  useEffect(() => {
    const state = loadTabState(projectId);
    setTabState(state);
    knownEntries.current = null;
    setShowFiles(state.active == null);
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

  // 新表单 occurrence 出现自动切到 Questions 标签(对齐参照行为);表单消失
  // (已回答/新回合)自动退出。按 questionFormKey 触发——key 在整个流式期间
  // 稳定,用户中途切走不会被反复拉回。
  useEffect(() => {
    setShowQuestions(Boolean(questionFormKey && questionForm));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionFormKey]);

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
          {focusMode ? <PanelLeftOpenIcon size={15} /> : <PanelLeftCloseIcon size={15} />}
        </button>
        <WorkingDirPill projectId={projectId} dir={handoff?.dir ?? null} />
        <div className="flex-1" />
      </div>
      <div className="flex items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-1.5 pt-1.5">
        <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
          {/* 固定的默认 tab：设计文件（文件树），不可关闭。 */}
          <button
            type="button"
            onClick={() => {
              setShowFiles(true);
              setShowQuestions(false);
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-xs ${
              !showQuestions && (showFiles || !active)
                ? 'border-zinc-200 bg-white text-zinc-900'
                : 'border-transparent text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            <FolderIcon size={13} className="shrink-0" />
            设计文件
          </button>
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
                  <XIcon size={12} />
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
        {meta && onMetaUpdated && (
          <div className="mb-1 shrink-0">
            <ProjectSettingsMenu meta={meta} onSaved={onMetaUpdated} />
          </div>
        )}
      </div>
      <div className={`relative min-h-0 flex-1 bg-white ${interactionDisabled ? 'pointer-events-none select-none' : ''}`}>
        {showQuestions && questionForm ? (
          <QuestionsPanel
            form={questionForm}
            formKey={questionFormKey ?? null}
            interactive={questionFormInteractive ?? false}
            submitDisabled={questionFormSubmitDisabled ?? false}
            submittedAnswers={questionFormSubmittedAnswers}
            generating={questionsGenerating ?? false}
            onSubmit={(text) => onSubmitQuestions?.(text)}
          />
        ) : !showFiles && active ? (
          <FileViewer
            projectId={projectId}
            file={active}
            artifact={activeArtifact}
            files={filePaths}
            reloadKey={reloadKey}
            generation={generation}
            onRetry={onRetry}
          />
        ) : stageVisible && tabs.length === 0 ? (
          // 首次生成尚无任何文件标签：默认 tab 区域整体作为生成舞台。
          <div className="relative flex h-full flex-col items-center justify-center text-zinc-400">
            <GenerationStage model={generation} onRetry={onRetry} />
          </div>
        ) : (
          <FilesPanel
            projectId={projectId}
            files={files}
            artifacts={artifacts}
            onOpenFile={openTab}
            onChanged={() => void refresh()}
          />
        )}
      </div>
    </div>
  );
}
