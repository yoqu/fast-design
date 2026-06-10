import { describe, expect, it } from 'vitest';
import { createJsonLineParser, mapPiEvent } from './pi-events.js';
import type { UiEvent } from './types.js';

function collect(raw: Record<string, unknown>): { events: UiEvent[]; end: boolean } {
  const events: UiEvent[] = [];
  const result = mapPiEvent(raw, (ev) => events.push(ev));
  return { events, end: result === 'agent_end' };
}

describe('mapPiEvent', () => {
  it('maps text deltas', () => {
    const { events } = collect({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    });
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }]);
  });

  it('maps thinking lifecycle', () => {
    expect(collect({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } }).events)
      .toEqual([{ type: 'thinking_start' }]);
    expect(
      collect({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hm' } })
        .events,
    ).toEqual([{ type: 'thinking_delta', delta: 'hm' }]);
  });

  it('maps tool execution start/end', () => {
    const start = collect({
      type: 'tool_execution_start',
      toolCallId: 't1',
      toolName: 'write',
      args: { path: 'index.html' },
    });
    expect(start.events).toEqual([
      { type: 'tool_use', id: 't1', name: 'write', input: { path: 'index.html' } },
    ]);

    const end = collect({
      type: 'tool_execution_end',
      toolCallId: 't1',
      isError: false,
      result: { content: [{ type: 'text', text: 'ok' }] },
    });
    expect(end.events).toEqual([
      { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
    ]);
  });

  it('emits usage and error from turn_end', () => {
    const { events } = collect({
      type: 'turn_end',
      message: {
        usage: { input: 10, output: 5, cost: { total: 0.01 } },
        stopReason: 'error',
        errorMessage: 'boom',
      },
    });
    expect(events).toEqual([
      { type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
      { type: 'error', message: 'boom' },
    ]);
  });

  it('signals agent_end', () => {
    expect(collect({ type: 'agent_end' }).end).toBe(true);
    expect(collect({ type: 'turn_start' }).end).toBe(false);
  });
});

describe('createJsonLineParser', () => {
  it('parses lines across chunk boundaries and skips noise', () => {
    const seen: unknown[] = [];
    const parser = createJsonLineParser((v) => seen.push(v));
    parser.feed('{"a":1}\n{"b"');
    parser.feed(':2}\nnot json\n');
    parser.feed('{"c":3}');
    parser.flush();
    expect(seen).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});
