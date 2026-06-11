import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { api, streamChat } from '../lib/api';
import type { ChatMessage, ConversationSummary, ToolCall, UiEvent } from '../lib/types';
import { deriveGenerationModel, type GenerationInput, type GenerationModel } from '../lib/generation';
import Composer from './Composer';
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
  /** Receives the derived generation model on every streaming event. */
  onGeneration?: (model: GenerationModel) => void;
  /** Registers a retry function (re-sends the last user message). */
  retryRef?: MutableRefObject<(() => void) | null>;
  /** 注册外部发送函数(QuestionsPanel 提交答案用)。 */
  sendRef?: MutableRefObject<((text: string) => void) | null>;
  /**
   * 回合结束/历史加载后,把最后一条助手消息全文回调给上层(派生 question-form)。
   * 必须传稳定引用(useCallback),否则历史加载 effect 会反复重跑。
   */
  onAssistantText?: (text: string) => void;
  /** 项目的待发提示词；非空时预填 composer 并触发 onConsumePendingPrompt。 */
  pendingPrompt?: string | null;
  /** 预填后清除持久化 pendingPrompt（PATCH null）。 */
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

export default function ChatPanel({ projectId, conversationId, conversations, projectName, onBack, onSelectConversation, onCreateConversation, onRenameConversation, onDeleteConversation, onGeneration, retryRef, sendRef, onAssistantText, pendingPrompt, onConsumePendingPrompt }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
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
  const lastUserText = useRef<string | null>(null);
  // 本回合流式累积的助手正文;turn 结束后回调 onAssistantText(不能在
  // setMessages updater 内做——updater 必须纯,StrictMode 会双执行。
  const liveAssistantText = useRef('');
  // 当前回合的流式请求控制器：卸载（切换会话/项目）时中断读流，
  // 防止旧回合的 finally 把共享的 generation 状态写给新会话。
  const streamAbort = useRef<AbortController | null>(null);

  // 一次性预填触发器：本挂载周期内只从 pendingPrompt 设值一次，之后保持不变
  // （Composer 的 seed effect 不会重跑，不会覆盖用户后续输入）。
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  const consumedPendingPrompt = useRef(false);

  useEffect(() => {
    if (consumedPendingPrompt.current) return;
    if (!pendingPrompt?.trim()) return;
    consumedPendingPrompt.current = true;
    setComposerSeed(pendingPrompt);
    onConsumePendingPrompt?.();
  }, [pendingPrompt, onConsumePendingPrompt]);

  const pushGeneration = useCallback(
    (patch: Partial<GenerationInput>) => {
      generationInput.current = { ...generationInput.current, ...patch };
      onGeneration?.(deriveGenerationModel(generationInput.current));
    },
    [onGeneration],
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
    api.history(projectId, conversationId).then((msgs) => {
      setMessages(msgs);
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant) onAssistantText?.(lastAssistant.content);
    }).catch(() => setMessages([]));
  }, [projectId, conversationId, onGeneration, onAssistantText]);

  useEffect(() => {
    if (stickToBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  const updateLast = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const last = prev.at(-1);
      if (!last || last.role !== 'assistant' || !last.streaming) return prev;
      return [...prev.slice(0, -1), fn(last)];
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      setStatus('连接中');
      lastUserText.current = text;
      liveAssistantText.current = '';
      pushGeneration({
        busy: true,
        aborted: false,
        error: null,
        sawDelta: false,
        lastActivity: null,
        lastWrite: null,
        turnEnded: false,
      });
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text, createdAt: Date.now() },
        { role: 'assistant', content: '', createdAt: Date.now(), streaming: true },
      ]);

      const handleEvent = (ev: UiEvent) => {
        switch (ev.type) {
          case 'status':
            setStatus(ev.label);
            break;
          case 'text_delta':
            liveAssistantText.current += ev.delta;
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

      const controller = new AbortController();
      streamAbort.current = controller;
      try {
        await streamChat(projectId, conversationId, text, handleEvent, controller.signal);
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
          if (liveAssistantText.current) onAssistantText?.(liveAssistantText.current);
          setBusy(false);
          setStatus(null);
          pushGeneration({ busy: false, turnEnded: true });
        }
        if (streamAbort.current === controller) streamAbort.current = null;
      }
    },
    [projectId, conversationId, updateLast, pushGeneration, onAssistantText],
  );

  useEffect(() => {
    if (!retryRef) return;
    retryRef.current = () => {
      if (lastUserText.current && !generationInput.current.busy) void send(lastUserText.current);
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

  // 卸载时若 busy，中止当前回合（切换会话/项目）：先断客户端读流（避免
  // finally 写共享 generation 状态），再请求服务端 abort。
  useEffect(() => {
    return () => {
      if (generationInput.current.busy) {
        streamAbort.current?.abort();
        void api.abort(projectId, conversationId);
      }
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
          <MessageView key={i} message={m} />
        ))}
      </div>
      {status && (
        <div className="px-5 pb-1 text-xs text-zinc-400">
          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 align-middle" />
          {status}
        </div>
      )}
      <Composer busy={busy} seed={composerSeed} onSend={send} onStop={stop} />
    </div>
  );
}
