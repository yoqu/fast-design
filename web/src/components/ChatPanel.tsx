import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { api, streamChat } from '../lib/api';
import type { ChatMessage, ToolCall, UiEvent } from '../lib/types';
import { deriveGenerationModel, type GenerationInput, type GenerationModel } from '../lib/generation';
import Composer from './Composer';
import MessageView from './MessageView';

type Props = {
  projectId: string;
  /** Receives the derived generation model on every streaming event. */
  onGeneration?: (model: GenerationModel) => void;
  /** Registers a retry function (re-sends the last user message). */
  retryRef?: MutableRefObject<(() => void) | null>;
};

const WRITE_TOOL_RE = /write|edit|patch|create/i;

function writtenFileFrom(name: string | null, input: unknown): string | null {
  if (!name || !WRITE_TOOL_RE.test(name)) return null;
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const candidate = record.path ?? record.file_path ?? record.filename ?? record.file;
  return typeof candidate === 'string' && candidate ? candidate.split('/').pop() ?? null : null;
}

export default function ChatPanel({ projectId, onGeneration, retryRef }: Props) {
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
    api.history(projectId).then(setMessages).catch(() => setMessages([]));
  }, [projectId, onGeneration]);

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

      try {
        await streamChat(projectId, text, handleEvent);
      } catch (err) {
        const message = err instanceof Error ? err.message : '请求失败';
        updateLast((m) => ({ ...m, error: message }));
        pushGeneration({ error: message });
      } finally {
        setMessages((prev) =>
          prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        );
        setBusy(false);
        setStatus(null);
        pushGeneration({ busy: false, turnEnded: true });
      }
    },
    [projectId, updateLast, pushGeneration],
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

  const stop = useCallback(() => {
    pushGeneration({ aborted: true });
    void api.abort(projectId);
  }, [projectId, pushGeneration]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
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
      <Composer busy={busy} onSend={send} onStop={stop} />
    </div>
  );
}
