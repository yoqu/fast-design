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

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  model?: string | null;
};

export type FileEntry = { path: string; size: number };
