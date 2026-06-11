export type JsonRecord = Record<string, unknown>;

/** Events streamed to the web UI as NDJSON lines. */
export type UiEvent =
  | { type: 'status'; label: string; model?: string | null }
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

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  tools?: ToolCall[];
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
  metadata?: ProjectMetadata;
};
