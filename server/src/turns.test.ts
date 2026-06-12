import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createProject, deleteProject, projectDir } from './projects.js';
import { deleteConversation, listConversations, readConversationHistory } from './conversations.js';
import { createTurnFold, finishTurnFold, foldTurnEvent, turnJournalPath, turnsDir } from './turns.js';
import type { UiEvent } from './types.js';

const created: string[] = [];
afterAll(() => {
  for (const id of created) deleteProject(id);
});

function makeProject(name: string): string {
  const meta = createProject(name);
  created.push(meta.id);
  return meta.id;
}

describe('turnJournalPath', () => {
  it('位于项目 .webui/turns 下并校验 cid', () => {
    const id = makeProject('turn-path');
    expect(turnJournalPath(id, 'abc123')).toBe(path.join(turnsDir(id), 'abc123.ndjson'));
    expect(() => turnJournalPath(id, '../evil')).toThrow();
  });
});

describe('foldTurnEvent', () => {
  it('折叠文本/思考增量与工具配对', () => {
    const fold = createTurnFold();
    const events: UiEvent[] = [
      { type: 'turn_start' },
      { type: 'text_delta', delta: 'he' },
      { type: 'text_delta', delta: 'llo' },
      { type: 'thinking_delta', delta: 'hmm' },
      { type: 'tool_use', id: 't1', name: 'write', input: { path: 'a' } },
      { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
    ];
    for (const ev of events) foldTurnEvent(fold, ev);
    const msg = finishTurnFold(fold);
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('hello');
    expect(msg.thinking).toBe('hmm');
    expect(msg.tools).toEqual([
      { id: 't1', name: 'write', input: { path: 'a' }, result: 'ok', isError: false },
    ]);
  });

  it('超长工具结果截断到 4000 字符', () => {
    const fold = createTurnFold();
    foldTurnEvent(fold, { type: 'tool_use', id: 't1', name: 'bash', input: null });
    foldTurnEvent(fold, { type: 'tool_result', toolUseId: 't1', content: 'x'.repeat(5000), isError: false });
    const msg = finishTurnFold(fold);
    expect(msg.tools![0].result).toBe(`${'x'.repeat(4000)}\n…(截断)`);
  });

  it('retry 回滚到回合检查点并清除错误标记', () => {
    const fold = createTurnFold();
    const events: UiEvent[] = [
      { type: 'turn_start' },
      { type: 'text_delta', delta: '第一回合。' },
      { type: 'turn_start' },
      { type: 'text_delta', delta: '半截' },
      { type: 'error', message: 'Stream ended without finish_reason' },
      { type: 'retry' },
      { type: 'text_delta', delta: '完整第二回合。' },
    ];
    for (const ev of events) foldTurnEvent(fold, ev);
    const msg = finishTurnFold(fold);
    expect(msg.content).toBe('第一回合。完整第二回合。');
    expect(msg.error).toBeUndefined();
  });

  it('error 事件落到 assistant.error', () => {
    const fold = createTurnFold();
    foldTurnEvent(fold, { type: 'error', message: 'boom' });
    expect(finishTurnFold(fold).error).toBe('boom');
  });
});
