import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../lib/api';
import type { ChatAttachment, ChatMessage, MessagePart, ToolCall } from '../lib/types';
import { activityToolCount, groupMessageParts, messageParts, summarizeTools, toolSummary, writtenFilePath } from '../lib/messageParts';
import { splitOnQuestionForms, stripTrailingOpenQuestionForm } from '../lib/questionForm';
import { BrainIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, CircleXIcon, CopyIcon, ExternalLinkIcon, FileIcon, ListTodoIcon, LoaderIcon, SparklesIcon, TriangleAlertIcon, WrenchIcon } from './icons';

/** 取消息可复制的纯文本：用户取原文，助手拼接全部文本片段（不含工具/思考）。 */
function messagePlainText(message: ChatMessage): string {
  if (message.role === 'user') return message.content ?? '';
  const text = messageParts(message)
    .filter((p) => p.kind === 'text')
    .map((p) => (p.kind === 'text' ? p.text : ''))
    .join('\n\n')
    .trim();
  return text || (message.content ?? '');
}

/** 单条消息的复制按钮：点击复制文本，短暂显示「已复制」反馈；hover 时显现。 */
function CopyButton({ text, align = 'left' }: { text: string; align?: 'left' | 'right' }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 回退：非安全上下文 / 旧浏览器无 navigator.clipboard
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        // 忽略：复制失败时不反馈
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      title="复制文本"
      aria-label="复制文本"
      onClick={copy}
      className={`mt-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-600 focus-visible:opacity-100 group-hover:opacity-100 ${
        align === 'right' ? 'self-end' : 'self-start'
      }`}
    >
      {copied ? <CheckIcon size={12} className="text-emerald-600" /> : <CopyIcon size={12} />}
      {copied ? '已复制' : '复制'}
    </button>
  );
}

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

function ToolCallCard({ tool, defaultOpen = false }: { tool: ToolCall; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const summary = toolSummary(tool);
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

type TodoItem = { content: string; status?: string };

function parseTodos(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== 'object') return null;
  const todos = (input as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const t of todos) {
    if (!t || typeof t !== 'object') continue;
    const rec = t as Record<string, unknown>;
    const content = typeof rec.content === 'string' ? rec.content : typeof rec.text === 'string' ? rec.text : '';
    if (!content) continue;
    const status = typeof rec.status === 'string' ? rec.status : typeof rec.state === 'string' ? rec.state : undefined;
    out.push({ content, status });
  }
  return out.length > 0 ? out : null;
}

function TodoCard({ tool }: { tool: ToolCall }) {
  const todos = parseTodos(tool.input);
  if (!todos) return <ToolCallCard tool={tool} />;
  const done = (s?: string) => s === 'completed' || s === 'done';
  const active = (s?: string) => s === 'in_progress' || s === 'active' || s === 'doing';
  return (
    <div className="my-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
        <ListTodoIcon size={13} className="text-zinc-400" />
        待办清单
      </div>
      <ul className="space-y-1">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-1.5">
            {done(t.status) ? (
              <CircleCheckIcon size={13} className="mt-0.5 shrink-0 text-emerald-600" />
            ) : active(t.status) ? (
              <LoaderIcon size={13} className="mt-0.5 shrink-0 animate-spin text-zinc-400" />
            ) : (
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-zinc-300" />
            )}
            <span className={done(t.status) ? 'text-zinc-400 line-through' : 'text-zinc-700'}>{t.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileChip({ tool, projectId }: { tool: ToolCall; projectId: string }) {
  const full = writtenFilePath(tool.name, tool.input);
  if (!full) return <ToolCallCard tool={tool} />;
  const base = full.split('/').pop() ?? full;
  const pending = tool.result === undefined;
  return (
    <a
      href={api.fileUrl(projectId, full)}
      target="_blank"
      rel="noreferrer"
      title={full}
      className="my-1 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 hover:border-zinc-400"
    >
      {pending ? (
        <LoaderIcon size={13} className="shrink-0 animate-spin text-zinc-400" />
      ) : tool.isError ? (
        <CircleXIcon size={13} className="shrink-0 text-red-500" />
      ) : (
        <FileIcon size={14} className="shrink-0 text-zinc-400" />
      )}
      <span className="min-w-0 truncate font-medium">{base}</span>
      <ExternalLinkIcon size={12} className="ml-auto shrink-0 text-zinc-300" />
    </a>
  );
}

/** 单个工具按类型选渲染形态：待办→清单卡，写文件→文档 chip，其余→通用卡。 */
function ToolCell({ tool, projectId, defaultOpen }: { tool: ToolCall; projectId: string; defaultOpen?: boolean }) {
  if (tool.name && /todo/i.test(tool.name) && parseTodos(tool.input)) return <TodoCard tool={tool} />;
  if (writtenFilePath(tool.name, tool.input)) return <FileChip tool={tool} projectId={projectId} />;
  return <ToolCallCard tool={tool} defaultOpen={defaultOpen} />;
}

/**
 * 活动块（Codex work log 语义）：一段连续的工作片段（工具调用 + 思考 +
 * 步骤间短叙述）默认收起成一行摘要——进行中显示当前动作，结束后显示步数；
 * 展开时按原始顺序铺平全部步骤，工具卡默认展开细节。位置保持在时间线
 * 原处，不打乱消息顺序。
 */
function ActivityBlock({
  parts,
  tools,
  streaming,
  isLast,
  projectId,
}: {
  parts: MessagePart[];
  tools: ToolCall[];
  streaming?: boolean;
  /** 是否消息的最后一个块（思考中提示只对最新块显示）。 */
  isLast?: boolean;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const toolCount = activityToolCount(parts);

  // 纯思考块：沿用轻量的「思考过程」折叠行。
  if (toolCount === 0) {
    const text = parts.map((p) => (p.kind === 'tool' ? '' : p.text)).join('\n\n');
    return <ThinkingBlock text={text} streaming={streaming && isLast} />;
  }
  // 单个工具、无伴随叙述：直接平铺一张卡（Codex 单 cell 形态）。
  if (parts.length === 1 && parts[0].kind === 'tool') {
    const tool = tools[parts[0].toolIndex];
    return tool ? <ToolCell tool={tool} projectId={projectId} /> : null;
  }

  const toolOf = (p: MessagePart) => (p.kind === 'tool' ? tools[p.toolIndex] : undefined);
  const pendingTool = streaming ? parts.map(toolOf).find((t) => t && t.result === undefined) : undefined;
  const thinkingLive = streaming && isLast && parts.at(-1)?.kind === 'thinking';
  const running = Boolean(streaming && (pendingTool || thinkingLive));
  const errors = parts.map(toolOf).filter((t) => t?.isError).length;
  const hint = pendingTool
    ? `正在运行 ${pendingTool.name ?? 'tool'} ${toolSummary(pendingTool)}`.trim()
    : thinkingLive
      ? '思考中…'
      : errors > 0
        ? `${errors} 步失败`
        : '';
  const blockTools = parts.map(toolOf).filter((t): t is ToolCall => !!t);
  const summary = summarizeTools(blockTools)
    .map((s) => (s.count > 1 ? `${s.verb} ×${s.count}` : s.verb))
    .join(' · ');

  return (
    <div className="my-1 rounded-lg border border-zinc-200 bg-zinc-50 text-xs">
      <button
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="flex items-center">
          {running ? (
            <LoaderIcon size={13} className="animate-spin text-zinc-400" />
          ) : errors > 0 ? (
            <CircleXIcon size={13} className="text-red-500" />
          ) : (
            <CircleCheckIcon size={13} className="text-emerald-600" />
          )}
        </span>
        <WrenchIcon size={12} className="text-zinc-400" />
        <span className="shrink-0 font-medium text-zinc-700">{running ? '执行中' : '已执行'}</span>
        <span className="truncate text-zinc-400">{running && hint ? hint : summary}</span>
        <span className="ml-auto text-zinc-400">{open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-zinc-200 px-1.5 py-1.5">
          {parts.map((p, i) => {
            if (p.kind === 'tool') {
              const tool = tools[p.toolIndex];
              return tool ? <ToolCell key={`tool-${p.toolIndex}`} tool={tool} projectId={projectId} defaultOpen /> : null;
            }
            if (p.kind === 'thinking') {
              return (
                <div key={`th-${i}`} className="rounded-md bg-zinc-100/70 px-2 py-1.5">
                  <span className="mb-1 flex items-center gap-1 text-[11px] text-zinc-400">
                    <BrainIcon size={11} />
                    思考
                  </span>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-zinc-500">{p.text}</pre>
                </div>
              );
            }
            return (
              <div key={`tx-${i}`} className="md px-1 text-zinc-600">
                <ReactMarkdown>{p.text}</ReactMarkdown>
              </div>
            );
          })}
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
      <div className="group flex flex-col items-end">
        {message.content && (
          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-800 px-4 py-2.5 text-sm text-white">
            {message.content}
          </div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentList attachments={message.attachments} projectId={projectId} />
        )}
        {message.skills && message.skills.length > 0 && (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
            {message.skills.map((name, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700"
              >
                <SparklesIcon size={11} className="text-violet-400" />
                {name}
              </span>
            ))}
          </div>
        )}
        <CopyButton text={messagePlainText(message)} align="right" />
      </div>
    );
  }

  // Codex transcript 式时间线：按事件原始顺序渲染文本段与活动块，
  // 工具调用不再脱离上下文集中展示。
  const parts = messageParts(message);
  const blocks = groupMessageParts(parts);
  const tools = message.tools ?? [];

  return (
    <div className="group max-w-full text-sm text-zinc-800">
      {blocks.map((block, i) =>
        block.kind === 'text' ? (
          <AssistantContent
            key={`text-${block.index}`}
            content={block.text}
            streaming={message.streaming && i === blocks.length - 1}
          />
        ) : (
          <ActivityBlock
            key={`activity-${block.index}`}
            parts={block.parts}
            tools={tools}
            streaming={message.streaming}
            isLast={i === blocks.length - 1}
            projectId={projectId}
          />
        ),
      )}
      {message.streaming && parts.length === 0 && (
        <p className="animate-pulse text-zinc-400">思考中…</p>
      )}
      {message.error && (
        <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          <TriangleAlertIcon size={13} className="mt-0.5 shrink-0" />
          {message.error}
        </p>
      )}
      {!message.streaming && <CopyButton text={messagePlainText(message)} align="left" />}
    </div>
  );
}
