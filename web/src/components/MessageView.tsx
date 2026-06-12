import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../lib/api';
import type { ChatAttachment, ChatMessage, ToolCall } from '../lib/types';
import { splitOnQuestionForms, stripTrailingOpenQuestionForm } from '../lib/questionForm';
import { BrainIcon, ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, CircleXIcon, FileIcon, ListTodoIcon, LoaderIcon, TriangleAlertIcon } from './icons';

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentList({ attachments, projectId }: { attachments: ChatAttachment[]; projectId: string }) {
  return (
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      {attachments.map((a) =>
        a.mimeType.startsWith('image/') ? (
          <a key={a.path} href={api.fileUrl(projectId, a.path)} target="_blank" rel="noreferrer" title={a.name}>
            <img
              src={api.fileUrl(projectId, a.path)}
              alt={a.name}
              className="max-h-40 max-w-60 rounded-xl border border-zinc-200 object-cover"
            />
          </a>
        ) : (
          <a
            key={a.path}
            href={api.fileUrl(projectId, a.path)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 hover:border-zinc-400"
          >
            <FileIcon size={15} className="shrink-0 text-zinc-400" />
            <span className="max-w-44 truncate font-medium">{a.name}</span>
            <span className="shrink-0 text-zinc-400">{formatSize(a.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

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
        <span className="flex items-center">
          {pending ? (
            <LoaderIcon size={13} className="animate-spin text-zinc-400" />
          ) : tool.isError ? (
            <CircleXIcon size={13} className="text-red-500" />
          ) : (
            <CircleCheckIcon size={13} className="text-emerald-600" />
          )}
        </span>
        <span className="font-mono font-medium text-zinc-700">{tool.name ?? 'tool'}</span>
        <span className="truncate font-mono text-zinc-400">{summary}</span>
        <span className="ml-auto text-zinc-400">{open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}</span>
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
        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
        onClick={() => setOpen(!open)}
      >
        <BrainIcon size={12} />
        {streaming && !open ? '思考中…' : '思考过程'}
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      {open && (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-xs text-zinc-500">
          {text}
        </pre>
      )}
    </div>
  );
}

// 聊天里不直接渲染 <question-form> 原始标记（对齐参照：表单在 Questions 面板
// 作答）：完整表单块替换为紧凑占位卡；流式中未闭合的表单截掉避免闪 JSON。
function AssistantContent({ content, streaming }: { content: string; streaming?: boolean }) {
  const { text, hadOpenForm } = stripTrailingOpenQuestionForm(content);
  const segments = splitOnQuestionForms(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          seg.text.trim() ? (
            <div key={i} className="md">
              <ReactMarkdown>{seg.text}</ReactMarkdown>
            </div>
          ) : null
        ) : (
          <div
            key={i}
            className="my-1.5 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
          >
            <ListTodoIcon size={14} className="shrink-0 text-zinc-400" />
            <span className="min-w-0 truncate font-medium">{seg.form.title}</span>
            <span className="ml-auto shrink-0 text-zinc-400">在右侧「问题」面板作答</span>
          </div>
        ),
      )}
      {hadOpenForm && streaming && (
        <div className="my-1.5 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-400">
          <LoaderIcon size={13} className="animate-spin" />
          正在生成问题…
        </div>
      )}
    </>
  );
}

export default function MessageView({ message, projectId }: { message: ChatMessage; projectId: string }) {
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end">
        {message.content && (
          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-800 px-4 py-2.5 text-sm text-white">
            {message.content}
          </div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentList attachments={message.attachments} projectId={projectId} />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-full text-sm text-zinc-800">
      {message.thinking && <ThinkingBlock text={message.thinking} streaming={message.streaming} />}
      {message.tools?.map((tool, i) => <ToolCallCard key={tool.id ?? i} tool={tool} />)}
      {message.content && <AssistantContent content={message.content} streaming={message.streaming} />}
      {message.streaming && !message.content && !message.thinking && (
        <p className="animate-pulse text-zinc-400">思考中…</p>
      )}
      {message.error && (
        <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          <TriangleAlertIcon size={13} className="mt-0.5 shrink-0" />
          {message.error}
        </p>
      )}
    </div>
  );
}
