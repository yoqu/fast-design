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
  /** Client-only: this message is still streaming. */
  streaming?: boolean;
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

export type ConversationMeta = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationSummary = ConversationMeta & { messageCount: number };

export type FileEntry = { path: string; size: number };

// ---- Pi 配置 ----

export type PiStatus = { installed: boolean; version: string | null; piDir: string };

export type PiSettings = {
  defaultProvider: string | null;
  defaultModel: string | null;
  defaultThinkingLevel: string | null;
};

export type ProviderStatus = {
  id: string;
  label: string;
  envVar: string;
  configured: boolean;
  keyTail: string | null;
  oauth: boolean;
};

export type CustomModel = { id: string; name?: string; contextWindow?: number; maxTokens?: number };

export type CustomProvider = {
  id: string;
  baseUrl: string;
  api: string;
  apiKeyTail: string | null;
  models: CustomModel[];
};

export type ProvidersResponse = {
  builtin: ProviderStatus[];
  extraAuth: string[];
  custom: CustomProvider[];
  apis: string[];
};

export type PiModel = { provider: string; id: string };

export type SkillInfo = {
  name: string;
  description: string;
  rel: string;
  scope: 'global' | 'project';
  enabled: boolean;
};

export type ExtensionInfo = { source: string };
export type ExtensionOpResult = { ok: boolean; output: string };

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
