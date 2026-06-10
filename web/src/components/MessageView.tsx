import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage, ToolCall } from '../lib/types';

function ToolCallCard({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);
  const summary = (() => {
    const input = tool.input as Record<string, unknown> | null;
    if (input && typeof input === 'object') {
      const hint = input.path ?? input.file_path ?? input.command ?? input.cmd;
      if (typeof hint === 'string') return hint.length > 80 ? `${hint.slice(0, 80)}…` : hint;
    }
    return '';
  })();
  const pending = tool.result === undefined;

  return (
    <div className="my-1 rounded-lg border border-zinc-200 bg-zinc-50 text-xs">
      <button
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setOpen(!open)}
      >
        <span>{pending ? '⏳' : tool.isError ? '❌' : '✅'}</span>
        <span className="font-mono font-medium text-zinc-700">{tool.name ?? 'tool'}</span>
        <span className="truncate font-mono text-zinc-400">{summary}</span>
        <span className="ml-auto text-zinc-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-2.5 py-1.5">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-zinc-500">
            {JSON.stringify(tool.input, null, 2)}
          </pre>
          {tool.result !== undefined && (
            <pre
              className={`mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-zinc-100 pt-1.5 ${
                tool.isError ? 'text-red-500' : 'text-zinc-600'
              }`}
            >
              {tool.result || '(无输出)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        className="text-xs text-zinc-400 hover:text-zinc-600"
        onClick={() => setOpen(!open)}
      >
        {streaming && !open ? '💭 思考中…' : `💭 思考过程 ${open ? '▾' : '▸'}`}
      </button>
      {open && (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-xs text-zinc-500">
          {text}
        </pre>
      )}
    </div>
  );
}

export default function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-800 px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full text-sm text-zinc-800">
      {message.thinking && <ThinkingBlock text={message.thinking} streaming={message.streaming} />}
      {message.tools?.map((tool, i) => <ToolCallCard key={tool.id ?? i} tool={tool} />)}
      {message.content && (
        <div className="md">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      )}
      {message.streaming && !message.content && !message.thinking && (
        <p className="animate-pulse text-zinc-400">思考中…</p>
      )}
      {message.error && (
        <p className="mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">⚠ {message.error}</p>
      )}
    </div>
  );
}
