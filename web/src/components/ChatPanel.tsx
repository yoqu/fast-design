import { useCallback, useEffect, useRef, useState } from 'react';
import { api, streamChat } from '../lib/api';
import type { ChatMessage, ToolCall, UiEvent } from '../lib/types';
import Composer from './Composer';
import MessageView from './MessageView';

export default function ChatPanel({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    setMessages([]);
    setBusy(false);
    setStatus(null);
    api.history(projectId).then(setMessages).catch(() => setMessages([]));
  }, [projectId]);

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
            break;
          case 'thinking_delta':
            updateLast((m) => ({ ...m, thinking: (m.thinking ?? '') + ev.delta }));
            break;
          case 'tool_use':
            updateLast((m) => ({
              ...m,
              tools: [...(m.tools ?? []), { id: ev.id, name: ev.name, input: ev.input }],
            }));
            break;
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
            break;
        }
      };

      try {
        await streamChat(projectId, text, handleEvent);
      } catch (err) {
        updateLast((m) => ({
          ...m,
          error: err instanceof Error ? err.message : '请求失败',
        }));
      } finally {
        setMessages((prev) =>
          prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        );
        setBusy(false);
        setStatus(null);
      }
    },
    [projectId, updateLast],
  );

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
      <Composer busy={busy} onSend={send} onStop={() => api.abort(projectId)} />
    </div>
  );
}
