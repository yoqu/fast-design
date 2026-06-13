import type { ChatMessage, MessagePart, ToolCall } from './types';

/**
 * Codex transcript 式时间线（参照 openai/codex CLI 的展示规范）：
 * - 严格按事件到达顺序渲染，工具调用不脱离上下文集中展示；
 * - 连续的「工作」片段（工具调用 + 思考 + 夹在中间的短叙述）聚合为一个
 *   可折叠的活动块，默认收起成一行摘要；
 * - 展开活动块时按原始顺序铺平全部步骤。
 * 本模块是纯逻辑层：从消息还原有序片段，并切分成渲染块。
 */

/** 夹在两段工具调用之间、可被吸收进活动块的叙述文本长度上限。 */
export const ABSORB_MAX_CHARS = 160;

/**
 * 取消息的有序片段。旧历史（无 parts）按 thinking → tools → content 合成，
 * 与旧版渲染顺序一致。
 */
export function messageParts(message: ChatMessage): MessagePart[] {
  if (message.parts && message.parts.length > 0) return message.parts;
  const parts: MessagePart[] = [];
  if (message.thinking) parts.push({ kind: 'thinking', text: message.thinking });
  (message.tools ?? []).forEach((_t, i) => parts.push({ kind: 'tool', toolIndex: i }));
  if (message.content) parts.push({ kind: 'text', text: message.content });
  return parts;
}

/** 流式 reducer 用：在末尾追加文本增量（同 kind 合并），返回新数组。 */
export function appendPartText(
  parts: MessagePart[] | undefined,
  kind: 'text' | 'thinking',
  delta: string,
): MessagePart[] {
  const prev = parts ?? [];
  const last = prev.at(-1);
  if (last && last.kind === kind) {
    return [...prev.slice(0, -1), { kind, text: last.text + delta }];
  }
  return [...prev, { kind, text: delta }];
}

/** 流式 reducer 用：retry 回滚到检查点（片段数 + 末位文本片段长度），返回新数组。 */
export function rollbackParts(
  parts: MessagePart[] | undefined,
  partsLen: number,
  partTextLen: number,
): MessagePart[] {
  const next = (parts ?? []).slice(0, partsLen);
  const last = next.at(-1);
  if (last && last.kind !== 'tool') {
    next[next.length - 1] = { kind: last.kind, text: last.text.slice(0, partTextLen) };
  }
  return next;
}

export type RenderBlock =
  | { kind: 'text'; index: number; text: string }
  | { kind: 'activity'; index: number; parts: MessagePart[] };

/**
 * 把有序片段切分为渲染块：
 * - tool / thinking 片段开启或延续一个活动块；
 * - 文本片段默认结束活动块、独立成段（保持时间线位置）；仅当它很短
 *   （≤ ABSORB_MAX_CHARS）、活动块已开启、且后面还有工具调用时，视为
 *   步骤间的过渡叙述吸收进活动块（Codex work log 语义）；
 * - 块的 index 取首片段下标，流式追加期间稳定，可作 React key。
 */
export function groupMessageParts(parts: MessagePart[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let activity: { index: number; parts: MessagePart[] } | null = null;
  parts.forEach((part, i) => {
    if (part.kind === 'tool' || part.kind === 'thinking') {
      if (!activity) {
        activity = { index: i, parts: [] };
        blocks.push({ kind: 'activity', ...activity });
      }
      activity.parts.push(part);
      return;
    }
    const short = part.text.trim().length <= ABSORB_MAX_CHARS;
    const hasLaterTool = parts.slice(i + 1).some((p) => p.kind === 'tool');
    if (activity && short && hasLaterTool) {
      activity.parts.push(part);
      return;
    }
    activity = null;
    if (part.text.trim()) blocks.push({ kind: 'text', index: i, text: part.text });
  });
  return blocks;
}

/** 活动块里的工具调用数。 */
export function activityToolCount(parts: MessagePart[]): number {
  return parts.filter((p) => p.kind === 'tool').length;
}

/** 工具调用的一行式摘要（动作目标：路径/命令等）。 */
export function toolSummary(tool: ToolCall): string {
  const input = tool.input as Record<string, unknown> | null;
  if (input && typeof input === 'object') {
    const hint = input.path ?? input.file_path ?? input.command ?? input.cmd;
    if (typeof hint === 'string') return hint.length > 80 ? `${hint.slice(0, 80)}…` : hint;
  }
  return '';
}
