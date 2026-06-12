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

  // turn_start 同时发显式事件：消费方以此记录回合检查点，自动重试时
  // 回滚失败回合的残留半截输出。
  it('emits an explicit turn_start alongside the status', () => {
    expect(collect({ type: 'turn_start' }).events).toEqual([
      { type: 'status', label: 'thinking' },
      { type: 'turn_start' },
    ]);
  });

  it('emits an explicit retry alongside the retrying status', () => {
    expect(collect({ type: 'auto_retry_start' }).events).toEqual([
      { type: 'status', label: 'retrying' },
      { type: 'retry' },
    ]);
  });

  // pi 对可重试错误（如 Stream ended without finish_reason）会先发
  // agent_end(willRetry:true) 再退避后自动续跑：此时回合并未结束，
  // 提前结束会造成 webui 空闲/pi 仍在流式的状态分叉（prompt 全被拒）。
  it('keeps the turn open when agent_end announces an auto-retry', () => {
    expect(collect({ type: 'agent_end', willRetry: true }).end).toBe(false);
    expect(collect({ type: 'agent_end', willRetry: false }).end).toBe(true);
  });

  // 自动重试失败（含退避中被 abort 取消）后 pi 不会再发 agent_end，
  // auto_retry_end(success:false) 就是回合的终点。
  it('ends the turn when auto-retry fails for good', () => {
    const failed = collect({ type: 'auto_retry_end', success: false, finalError: 'Retry cancelled' });
    expect(failed.events).toEqual([{ type: 'error', message: 'Retry cancelled' }]);
    expect(failed.end).toBe(true);
  });

  it('does not end the turn when auto-retry succeeds', () => {
    const ok = collect({ type: 'auto_retry_end', success: true });
    expect(ok.events).toEqual([]);
    expect(ok.end).toBe(false);
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
