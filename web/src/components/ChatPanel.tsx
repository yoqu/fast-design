import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { api, piApi, streamChat, attachTurn } from '../lib/api';
import type { ChatAttachment, ChatMessage, ConversationSummary, PiModel, ToolCall, UiEvent } from '../lib/types';
import { deriveGenerationModel, type GenerationInput, type GenerationModel } from '../lib/generation';
import Composer, { type ComposerSeed } from './Composer';
import MessageView from './MessageView';
import ConversationsMenu from './ConversationsMenu';
import { ArrowLeftIcon } from './icons';

type Props = {
  projectId: string;
  conversationId: string;
  conversations: ConversationSummary[];
  /** 详情页顶部展示的项目名。 */
  projectName: string;
  /** 返回项目列表。 */
  onBack: () => void;
  onSelectConversation: (cid: string) => void;
  onCreateConversation: () => void;
  onRenameConversation: (cid: string, title: string) => void;
  onDeleteConversation: (cid: string) => void;
  /** 项目设置里的默认模型（会话未覆盖时跟随它）。 */
  projectModel: string | null;
  /** 设置会话级模型覆盖（null = 恢复跟随项目设置）。 */
  onSetConversationModel: (cid: string, model: string | null) => void;
  /** Receives the derived generation model on every streaming event. */
  onGeneration?: (model: GenerationModel) => void;
  /** Registers a retry function (re-sends the last user message). */
  retryRef?: MutableRefObject<(() => void) | null>;
  /** 注册外部发送函数(QuestionsPanel 提交答案用)。 */
  sendRef?: MutableRefObject<((text: string) => void) | null>;
  /**
   * 消息列表变化回调（含流式逐 delta 更新），上层据此派生 question-form
   * 状态（活动表单/已提交答案/流式预览，对齐参照 ProjectView 的派生方式）。
   * 必须传稳定引用(useCallback)。
   */
  onMessages?: (messages: ChatMessage[]) => void;
  /** 项目的待发提示词；非空时预填 composer 并触发 onConsumePendingPrompt。 */
  pendingPrompt?: string | null;
  /** 随 pendingPrompt 一起预填的附件（快速简报里上传的文件）。 */
  pendingAttachments?: ChatAttachment[] | null;
  /** 预填后清除持久化 pendingPrompt/pendingAttachments（PATCH null）。 */
  onConsumePendingPrompt?: () => void;
};

const WRITE_TOOL_RE = /write|edit|patch|create/i;

function writtenFileFrom(name: string | null, input: unknown): string | null {
  if (!name || !WRITE_TOOL_RE.test(name)) return null;
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const candidate = record.path ?? record.file_path ?? record.filename ?? record.file;
  return typeof candidate === 'string' && candidate ? candidate.split('/').pop() ?? null : null;
}

export default function ChatPanel({ projectId, conversationId, conversations, projectName, onBack, onSelectConversation, onCreateConversation, onRenameConversation, onDeleteConversation, projectModel, onSetConversationModel, onGeneration, retryRef, sendRef, onMessages, pendingPrompt, pendingAttachments, onConsumePendingPrompt }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [models, setModels] = useState<PiModel[]>([]);
  const conversationModel = conversations.find((c) => c.id === conversationId)?.model ?? null;

  useEffect(() => {
    piApi.models().then(setModels).catch(() => setModels([]));
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const generationInput = useRef<GenerationInput>({
    busy: false,
    aborted: false,
    error: null,
    sawDelta: false,
    lastActivity: null,
    lastWrite: null,
    turnEnded: false,
  });
  const lastUserInput = useRef<{ text: string; attachments: ChatAttachment[] } | null>(null);
  // 当前回合的流式请求控制器：卸载（切换会话/项目）时中断读流，
  // 防止旧回合的 finally 把共享的 generation 状态写给新会话。
  const streamAbort = useRef<AbortController | null>(null);

  // 一次性预填触发器：本挂载周期内只从 pendingPrompt/pendingAttachments 设值
  // 一次，之后保持不变（Composer 的 seed effect 不会重跑，不会覆盖用户后续输入）。
  const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null);
  const consumedPendingPrompt = useRef(false);

  useEffect(() => {
    if (consumedPendingPrompt.current) return;
    if (!pendingPrompt?.trim() && !pendingAttachments?.length) return;
    consumedPendingPrompt.current = true;
    setComposerSeed({ text: pendingPrompt ?? '', attachments: pendingAttachments ?? [] });
    onConsumePendingPrompt?.();
  }, [pendingPrompt, pendingAttachments, onConsumePendingPrompt]);

  const pushGeneration = useCallback(
    (patch: Partial<GenerationInput>) => {
      generationInput.current = { ...generationInput.current, ...patch };
      onGeneration?.(deriveGenerationModel(generationInput.current));
    },
    [onGeneration],
  );

  const updateLast = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const last = prev.at(-1);
      if (!last || last.role !== 'assistant' || !last.streaming) return prev;
      return [...prev.slice(0, -1), fn(last)];
    });
  }, []);

  // 消费一个回合的事件流（发送与刷新续接共用）：busy/状态初始化、事件归约、
  // catch/finally 收尾一体。controller 中断（切会话/卸载）时跳过全部收尾状态写。
  const consumeTurn = useCallback(
    async (
      run: (onEvent: (ev: UiEvent) => void) => Promise<void>,
      controller: AbortController,
    ) => {
      setBusy(true);
      setStatus('连接中');
      pushGeneration({
        busy: true,
        aborted: false,
        error: null,
        sawDelta: false,
        lastActivity: null,
        lastWrite: null,
        turnEnded: false,
      });

      // 回合检查点：pi 自动重试会把出错回合整个重发（见 server 端同名逻辑），
      // 收到 retry 事件时回滚半截输出并清掉错误标记。
      const checkpoint = { content: 0, thinking: 0 };

      const handleEvent = (ev: UiEvent) => {
        switch (ev.type) {
          case 'status':
            setStatus(ev.label);
            break;
          case 'turn_start':
            updateLast((m) => {
              checkpoint.content = m.content.length;
              checkpoint.thinking = m.thinking?.length ?? 0;
              return m;
            });
            break;
          case 'retry':
            updateLast((m) => ({
              ...m,
              content: m.content.slice(0, checkpoint.content),
              ...(m.thinking !== undefined
                ? { thinking: m.thinking.slice(0, checkpoint.thinking) }
                : {}),
              error: undefined,
            }));
            pushGeneration({ error: null });
            break;
          case 'text_delta':
            updateLast((m) => ({ ...m, content: m.content + ev.delta }));
            pushGeneration({ sawDelta: true, lastActivity: ev.delta });
            break;
          case 'thinking_delta':
            updateLast((m) => ({ ...m, thinking: (m.thinking ?? '') + ev.delta }));
            pushGeneration({ sawDelta: true, lastActivity: ev.delta });
            break;
          case 'tool_use': {
            updateLast((m) => ({
              ...m,
              tools: [...(m.tools ?? []), { id: ev.id, name: ev.name, input: ev.input }],
            }));
            const written = writtenFileFrom(ev.name, ev.input);
            pushGeneration({ sawDelta: true, ...(written ? { lastWrite: written } : {}) });
            break;
          }
          case 'tool_result':
            updateLast((m) => {
              const tools: ToolCall[] = [...(m.tools ?? [])];
              const idx = tools.findIndex((t) => t.id === ev.toolUseId && t.result === undefined);
              const target = idx >= 0 ? idx : tools.length - 1;
              if (target >= 0) {
                tools[target] = { ...tools[target], result: ev.content, isError: ev.isError };
              }
              return { ...m, tools };
            });
            break;
          case 'error':
            updateLast((m) => ({ ...m, error: ev.message }));
            pushGeneration({ error: ev.message });
            break;
        }
      };

      streamAbort.current = controller;
      try {
        await run(handleEvent);
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : '请求失败';
          updateLast((m) => ({ ...m, error: message }));
          pushGeneration({ error: message });
        }
      } finally {
        // 卸载中断（signal aborted）时组件已销毁，跳过全部状态更新，
        // 避免旧回合的收尾写到共享 generation / 新会话的 UI 上。
        if (!controller.signal.aborted) {
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          );
          setBusy(false);
          setStatus(null);
          pushGeneration({ busy: false, turnEnded: true });
        }
        if (streamAbort.current === controller) streamAbort.current = null;
      }
    },
    [updateLast, pushGeneration],
  );

  useEffect(() => {
    setMessages([]);
    setBusy(false);
    setStatus(null);
    generationInput.current = {
      busy: false,
      aborted: false,
      error: null,
      sawDelta: false,
      lastActivity: null,
      lastWrite: null,
      turnEnded: false,
    };
    onGeneration?.(deriveGenerationModel(generationInput.current));
    let cancelled = false;
    const controller = new AbortController();
    api
      .history(projectId, conversationId)
      .then(async (msgs) => {
        if (cancelled) return;
        setMessages(msgs);
        // 刷新/切回会话时续接进行中的回合：204 即空闲，照旧浏览。
        const consume = await attachTurn(projectId, conversationId, controller.signal).catch(
          () => null,
        );
        if (!consume || cancelled) return;
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '', createdAt: Date.now(), streaming: true },
        ]);
        await consumeTurn(consume, controller);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectId, conversationId, onGeneration, consumeTurn]);

  // 消息变化（含流式逐 delta）上报给上层派生问卷状态。
  useEffect(() => {
    onMessages?.(messages);
  }, [messages, onMessages]);

  useEffect(() => {
    if (stickToBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  const send = useCallback(
    async (text: string, attachments: ChatAttachment[] = []) => {
      lastUserInput.current = { text, attachments };
      setMessages((prev) => [
        ...prev,
        {
          role: 'user',
          content: text,
          ...(attachments.length > 0 ? { attachments } : {}),
          createdAt: Date.now(),
        },
        { role: 'assistant', content: '', createdAt: Date.now(), streaming: true },
      ]);
      const controller = new AbortController();
      await consumeTurn(
        (onEvent) => streamChat(projectId, conversationId, text, onEvent, controller.signal, attachments),
        controller,
      );
    },
    [projectId, conversationId, consumeTurn],
  );

  useEffect(() => {
    if (!retryRef) return;
    retryRef.current = () => {
      const last = lastUserInput.current;
      if (last && !generationInput.current.busy) void send(last.text, last.attachments);
    };
    return () => {
      retryRef.current = null;
    };
  }, [retryRef, send]);

  useEffect(() => {
    if (!sendRef) return;
    sendRef.current = (text: string) => {
      if (!generationInput.current.busy) void send(text);
    };
    return () => {
      sendRef.current = null;
    };
  }, [sendRef, send]);

  const stop = useCallback(() => {
    pushGeneration({ aborted: true });
    void api.abort(projectId, conversationId);
  }, [projectId, conversationId, pushGeneration]);

  // 卸载/切换会话时只断本地读流（避免 finally 写共享 generation 状态）。
  // 回合与连接已解耦：服务端继续跑完并落盘，切回来可续接；
  // 主动停止只走停止按钮（stop → api.abort）。
  useEffect(() => {
    return () => {
      streamAbort.current?.abort();
    };
  }, [projectId, conversationId]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <button
          type="button"
          title="返回项目列表"
          aria-label="返回项目列表"
          onClick={onBack}
          className="rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          <ArrowLeftIcon size={15} />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800" title={projectName}>
          {projectName}
        </span>
        <ConversationsMenu
          conversations={conversations}
          activeId={conversationId}
          onSelect={onSelectConversation}
          onCreate={onCreateConversation}
          onRename={onRenameConversation}
          onDelete={onDeleteConversation}
        />
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
      >
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-zinc-400">
            <span className="text-4xl">π</span>
            <p className="mt-3 text-sm">告诉 agent 你想做什么，比如「做一个咖啡店落地页」</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView key={i} message={m} projectId={projectId} />
        ))}
      </div>
      {status && (
        <div className="px-5 pb-1 text-xs text-zinc-400">
          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 align-middle" />
          {status}
        </div>
      )}
      <Composer
        projectId={projectId}
        busy={busy}
        seed={composerSeed}
        models={models}
        model={conversationModel}
        projectModel={projectModel}
        onModelChange={(m) => onSetConversationModel(conversationId, m)}
        onSend={send}
        onStop={stop}
      />
    </div>
  );
}
