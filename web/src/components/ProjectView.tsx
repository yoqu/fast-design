// web/src/components/ProjectView.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../lib/api';
import {
  CHAT_PANEL_KEYBOARD_STEP,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  clampChatPanelWidth,
  readSavedChatPanelWidth,
  saveChatPanelWidth,
} from '../lib/chatPanelWidth';
import { deriveGenerationModel, type GenerationModel } from '../lib/generation';
import { extractQuestionForm, type QuestionForm } from '../lib/questionForm';
import { navigate } from '../router';
import type { ConversationSummary, ProjectMeta } from '../lib/types';
import ChatPanel from './ChatPanel';
import { Workspace } from './Workspace';
import { ArrowLeftIcon } from './icons';

type Props = {
  projectId: string;
  routeConversationId: string | null;
  routeFileName: string | null;
};

const IDLE_GENERATION = deriveGenerationModel({
  busy: false,
  aborted: false,
  error: null,
  sawDelta: false,
  lastActivity: null,
  lastWrite: null,
  turnEnded: false,
});

/**
 * 项目详情页,对齐参照 ProjectView.tsx:5232-5557 的 split 布局:
 * ChatPanel(可拖拽 345-720px)| 8px 手柄 | Workspace。
 * focus 模式隐藏聊天与手柄(不持久化,同参照 useState(false))。
 */
export default function ProjectView({ projectId, routeConversationId, routeFileName }: Props) {
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [generation, setGeneration] = useState<GenerationModel>(IDLE_GENERATION);
  const [questionForm, setQuestionForm] = useState<QuestionForm | null>(null);
  const [workspaceFocused, setWorkspaceFocused] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  const sendRef = useRef<((text: string) => void) | null>(null);

  // ---- 拖拽分栏(对齐参照 ProjectView.tsx:4843-4937) ----
  const [chatWidth, setChatWidth] = useState<number>(() => readSavedChatPanelWidth());
  const [resizing, setResizing] = useState(false);
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;

  // ---- URL 同步辅助 refs(避免 effect 闭包过期/循环导航) ----
  const activeFileRef = useRef<string | null>(routeFileName);
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  // 项目元数据;不存在则回项目列表。
  useEffect(() => {
    let cancelled = false;
    api
      .listProjects()
      .then((list) => {
        if (cancelled) return;
        const found = list.find((p) => p.id === projectId);
        if (!found) {
          navigate({ kind: 'home', view: 'projects' }, { replace: true });
          return;
        }
        setMeta(found);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '无法连接服务端');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const loadConversations = useCallback(
    async (preferredId?: string | null) => {
      const list = await api.conversations(projectId);
      setConversations(list);
      setActiveConversationId((current) => {
        const wanted = preferredId ?? current;
        if (wanted && list.some((c) => c.id === wanted)) return wanted;
        return list[0]?.id ?? null;
      });
      return list;
    },
    [projectId],
  );

  // 首载:优先路由里的会话 id。
  useEffect(() => {
    void loadConversations(routeConversationId).catch(() => {});
    // 仅首载;路由 cid 后续变化由下一个 effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversations]);

  // 前进后退把 URL 的会话 id 带回来 → 切换活动会话。
  useEffect(() => {
    if (
      routeConversationId &&
      routeConversationId !== activeConversationIdRef.current &&
      conversations.some((c) => c.id === routeConversationId)
    ) {
      setActiveConversationId(routeConversationId);
    }
  }, [routeConversationId, conversations]);

  // 活动会话变化 → 同步 URL(replace,同参照 ProjectView.tsx:4293-4301)。
  useEffect(() => {
    if (!activeConversationId) return;
    navigate(
      { kind: 'project', projectId, conversationId: activeConversationId, fileName: activeFileRef.current },
      { replace: true },
    );
  }, [activeConversationId, projectId]);

  const handleActiveFileChange = useCallback(
    (file: string | null) => {
      if (file === activeFileRef.current) return;
      activeFileRef.current = file;
      navigate(
        { kind: 'project', projectId, conversationId: activeConversationIdRef.current, fileName: file },
        { replace: true },
      );
    },
    [projectId],
  );

  const createConversation = useCallback(async () => {
    const conv = await api.createConversation(projectId);
    setQuestionForm(null);
    await loadConversations(conv.id);
  }, [projectId, loadConversations]);

  const renameConversation = useCallback(
    async (cid: string, title: string) => {
      await api.renameConversation(projectId, cid, title);
      await loadConversations();
    },
    [projectId, loadConversations],
  );

  const deleteConversation = useCallback(
    async (cid: string) => {
      await api.deleteConversation(projectId, cid);
      const list = await api.conversations(projectId);
      if (list.length === 0) {
        const conv = await api.createConversation(projectId);
        await loadConversations(conv.id);
        return;
      }
      setConversations(list);
      setActiveConversationId((current) => (current === cid ? list[0].id : current));
    },
    [projectId, loadConversations],
  );

  const consumePendingPrompt = useCallback(async () => {
    setMeta((m) => (m ? { ...m, pendingPrompt: null } : m));
    try {
      await api.updateProject(projectId, { pendingPrompt: null });
    } catch {
      // 忽略:下次进入最多再预填一次,无害。
    }
  }, [projectId]);

  const handleAssistantText = useCallback((text: string) => {
    setQuestionForm(extractQuestionForm(text));
  }, []);

  // ---- 拖拽手柄事件 ----
  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = chatWidthRef.current;
    setResizing(true);

    let frame: number | null = null;
    let pendingX: number | null = null;

    const apply = (clientX: number) => {
      setChatWidth(clampChatPanelWidth(startWidth + clientX - startX));
    };
    const onMove = (ev: PointerEvent) => {
      pendingX = ev.clientX;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (pendingX !== null) {
          apply(pendingX);
          pendingX = null;
        }
      });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      setResizing(false);
    };
    const onUp = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (pendingX !== null) {
        // setState 在本事件内不会同步重渲,chatWidthRef 还停在上一帧;
        // 用刚算出的终值持久化,避免存入差一帧的宽度。
        const finalWidth = clampChatPanelWidth(startWidth + pendingX - startX);
        pendingX = null;
        setChatWidth(finalWidth);
        saveChatPanelWidth(finalWidth);
      } else {
        saveChatPanelWidth(chatWidthRef.current);
      }
      cleanup();
    };
    const onCancel = () => {
      // 中断回滚到拖拽前宽度,不持久化(同参照 pointercancel/blur 行为)。
      if (frame !== null) cancelAnimationFrame(frame);
      setChatWidth(startWidth);
      cleanup();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
  }, []);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = chatWidthRef.current - CHAT_PANEL_KEYBOARD_STEP;
    else if (event.key === 'ArrowRight') next = chatWidthRef.current + CHAT_PANEL_KEYBOARD_STEP;
    else if (event.key === 'Home') next = MIN_CHAT_PANEL_WIDTH;
    else if (event.key === 'End') next = MAX_CHAT_PANEL_WIDTH;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampChatPanelWidth(next);
    setChatWidth(clamped);
    saveChatPanelWidth(clamped);
  }, []);

  const onBack = useCallback(() => navigate({ kind: 'home', view: 'projects' }), []);

  const handleSubmitQuestions = useCallback((text: string) => {
    sendRef.current?.(text);
  }, []);

  const workspaceProps = useMemo(
    () => ({
      focusMode: workspaceFocused,
      onFocusModeChange: setWorkspaceFocused,
      interactionDisabled: resizing,
      routeFileName,
      onActiveFileChange: handleActiveFileChange,
      questionForm,
      onSubmitQuestions: handleSubmitQuestions,
    }),
    [workspaceFocused, resizing, routeFileName, handleActiveFileChange, questionForm, handleSubmitQuestions],
  );

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-zinc-400">
        <p className="text-sm text-red-500">{error}</p>
        <button type="button" onClick={onBack} className="mt-3 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">
          <ArrowLeftIcon size={13} />
          返回项目列表
        </button>
      </div>
    );
  }

  return (
    <div className={`flex h-full bg-white text-zinc-900 ${resizing ? 'cursor-col-resize select-none' : ''}`}>
      {!workspaceFocused && (
        <div style={{ width: chatWidth }} className="flex h-full shrink-0 flex-col">
          {activeConversationId ? (
            <ChatPanel
              key={`${projectId}:${activeConversationId}`}
              projectId={projectId}
              conversationId={activeConversationId}
              conversations={conversations}
              projectName={meta?.name ?? ''}
              onBack={onBack}
              onSelectConversation={setActiveConversationId}
              onCreateConversation={() => void createConversation()}
              onRenameConversation={(cid, title) => void renameConversation(cid, title)}
              onDeleteConversation={(cid) => void deleteConversation(cid)}
              onGeneration={setGeneration}
              retryRef={retryRef}
              sendRef={sendRef}
              onAssistantText={handleAssistantText}
              pendingPrompt={meta?.pendingPrompt ?? null}
              onConsumePendingPrompt={consumePendingPrompt}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">加载对话…</div>
          )}
        </div>
      )}
      {!workspaceFocused && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整聊天面板宽度"
          aria-valuemin={MIN_CHAT_PANEL_WIDTH}
          aria-valuemax={MAX_CHAT_PANEL_WIDTH}
          aria-valuenow={chatWidth}
          tabIndex={0}
          title="拖拽调整聊天面板宽度(←/→ 微调,Home/End 到极值)"
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
          className={`h-full w-2 shrink-0 cursor-col-resize outline-none transition-colors focus-visible:bg-zinc-300 ${
            resizing ? 'bg-zinc-300' : 'bg-transparent hover:bg-zinc-200'
          }`}
        />
      )}
      <Workspace
        key={`workspace-${projectId}`}
        projectId={projectId}
        generation={generation}
        onRetry={() => retryRef.current?.()}
        meta={meta ?? undefined}
        onMetaUpdated={(m) => setMeta(m)}
        {...workspaceProps}
      />
    </div>
  );
}
