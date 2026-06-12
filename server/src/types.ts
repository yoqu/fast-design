export type JsonRecord = Record<string, unknown>;

/** Events streamed to the web UI as NDJSON lines. */
export type UiEvent =
  | { type: 'status'; label: string; model?: string | null }
  /** 一个 LLM 回合开始：消费方记录检查点，供 retry 回滚半截输出。 */
  | { type: 'turn_start' }
  /** pi 自动重试即将续跑：丢弃当前回合的残留输出与错误标记。 */
  | { type: 'retry' }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'tool_use'; id: string | null; name: string | null; input: unknown }
  | { type: 'tool_result'; toolUseId: string | null; content: string; isError: boolean }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number | null }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type ToolCall = {
  id: string | null;
  name: string | null;
  input: unknown;
  result?: string;
  isError?: boolean;
};

/** 随用户消息一起发送的附件（已上传到项目目录，path 相对项目根）。 */
export type ChatAttachment = {
  name: string;
  path: string;
  mimeType: string;
  size: number;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  tools?: ToolCall[];
  attachments?: ChatAttachment[];
  error?: string;
  createdAt: number;
};

export type ProjectPlatform =
  | 'responsive'
  | 'web-desktop'
  | 'mobile-ios'
  | 'mobile-android'
  | 'tablet'
  | 'desktop-app';

export type ProjectFidelity = 'wireframe' | 'high-fidelity';

/** 对齐 open-design ProjectMetadata（裁剪到 prototype 链路）。 */
export type ProjectMetadata = {
  kind: 'prototype';
  platformTargets?: ProjectPlatform[];
  fidelity?: ProjectFidelity;
  includeLandingPage?: boolean;
  includeOsWidgets?: boolean;
  nameSource?: 'user' | 'generated';
  importedFrom?: 'claude-design' | 'folder' | null;
  entryFile?: string | null;
  sourceFileName?: string | null;
  baseDir?: string | null;
};

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  model?: string | null;
  thinking?: string | null;
  instructions?: string | null;
  skillId?: string | null;
  pendingPrompt?: string | null;
  /** 随 pendingPrompt 一起预填的附件（快速简报里选的文件，已上传到项目目录）。 */
  pendingAttachments?: ChatAttachment[] | null;
  metadata?: ProjectMetadata;
  /** GET /api/projects 派生字段(由 session isBusy 计算),不持久化。 */
  running?: boolean;
};
