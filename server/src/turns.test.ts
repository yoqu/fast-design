import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createProject, deleteProject, projectDir } from './projects.js';
import { deleteConversation, listConversations, readConversationHistory } from './conversations.js';
import { Turn, activeTurn, createTurnFold, finishTurnFold, foldTurnEvent, recoverInterruptedTurns, removeTurnJournal, startTurn, turnJournalPath, turnsDir } from './turns.js';
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

describe('Turn', () => {
  it('迟到订阅者收到完整回放，退订后不再接收', () => {
    const turn = new Turn(null);
    turn.emit({ type: 'text_delta', delta: 'a' });
    turn.emit({ type: 'text_delta', delta: 'b' });
    const seen: UiEvent[] = [];
    const unsub = turn.subscribe((ev) => seen.push(ev));
    expect(seen).toEqual([
      { type: 'text_delta', delta: 'a' },
      { type: 'text_delta', delta: 'b' },
    ]);
    turn.emit({ type: 'text_delta', delta: 'c' });
    expect(seen).toHaveLength(3);
    unsub();
    turn.emit({ type: 'text_delta', delta: 'd' });
    expect(seen).toHaveLength(3);
  });

  it('end 通知订阅者 done 并返回折叠消息；结束后订阅回放 + 立即补 done', () => {
    const turn = new Turn(null);
    turn.emit({ type: 'text_delta', delta: 'x' });
    const live: UiEvent[] = [];
    turn.subscribe((ev) => live.push(ev));
    const msg = turn.end();
    expect(msg.content).toBe('x');
    expect(live.at(-1)).toEqual({ type: 'done' });
    expect(turn.isDone).toBe(true);
    const late: UiEvent[] = [];
    turn.subscribe((ev) => late.push(ev));
    expect(late).toEqual([{ type: 'text_delta', delta: 'x' }, { type: 'done' }]);
    // end 幂等
    expect(turn.end().content).toBe('x');
  });

  it('journal 写穿成 NDJSON 行，end 后删除', async () => {
    const id = makeProject('turn-journal');
    const cid = (await listConversations(id))[0].id;
    const jp = turnJournalPath(id, cid);
    const turn = new Turn(jp);
    turn.emit({ type: 'text_delta', delta: '你好' });
    turn.emit({ type: 'error', message: 'boom' });
    const lines = fs
      .readFileSync(jp, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: 'text_delta', delta: '你好' },
      { type: 'error', message: 'boom' },
    ]);
    turn.end();
    expect(fs.existsSync(jp)).toBe(false);
  });
});

describe('startTurn / activeTurn', () => {
  it('回合结束后 assistant 落历史、journal 删除、注册表清空', async () => {
    const id = makeProject('turn-run');
    const cid = (await listConversations(id))[0].id;
    const { turn, finished } = startTurn(id, cid, async (emit) => {
      emit({ type: 'turn_start' });
      emit({ type: 'text_delta', delta: '答案' });
    });
    expect(activeTurn(id, cid)).toBe(turn);
    await finished;
    expect(activeTurn(id, cid)).toBeUndefined();
    expect(fs.existsSync(turnJournalPath(id, cid))).toBe(false);
    const history = readConversationHistory(id, cid);
    expect(history.at(-1)).toMatchObject({ role: 'assistant', content: '答案' });
  });

  it('run 抛错折叠为 error 事件并正常收尾', async () => {
    const id = makeProject('turn-fail');
    const cid = (await listConversations(id))[0].id;
    const { finished } = startTurn(id, cid, async () => {
      throw new Error('pi 启动失败');
    });
    await finished;
    expect(readConversationHistory(id, cid).at(-1)).toMatchObject({
      role: 'assistant',
      error: 'pi 启动失败',
    });
  });

  it('回合进行中会话被删除则跳过持久化，不复活历史文件', async () => {
    const id = makeProject('turn-deleted');
    const cid = (await listConversations(id))[0].id;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { finished } = startTurn(id, cid, async (emit) => {
      emit({ type: 'text_delta', delta: 'x' });
      await gate;
    });
    deleteConversation(id, cid);
    release();
    await finished;
    expect(fs.existsSync(path.join(projectDir(id), '.webui', 'conversations', `${cid}.json`))).toBe(false);
  });

  it('removeTurnJournal 清理残留 journal', async () => {
    const id = makeProject('turn-rmj');
    const cid = (await listConversations(id))[0].id;
    const jp = turnJournalPath(id, cid);
    fs.mkdirSync(path.dirname(jp), { recursive: true });
    fs.writeFileSync(jp, '{}\n');
    removeTurnJournal(id, cid);
    expect(fs.existsSync(jp)).toBe(false);
  });
});

describe('recoverInterruptedTurns', () => {
  it('残留 journal 折叠进历史并标记中断，journal 清除', async () => {
    const id = makeProject('turn-recover');
    const cid = (await listConversations(id))[0].id;
    const jp = turnJournalPath(id, cid);
    fs.mkdirSync(path.dirname(jp), { recursive: true });
    fs.writeFileSync(
      jp,
      [
        JSON.stringify({ type: 'turn_start' }),
        JSON.stringify({ type: 'text_delta', delta: '写到一半' }),
        '{"type":"text_del', // 进程死于半行写入：跳过尾部残行
      ].join('\n'),
    );
    recoverInterruptedTurns();
    const last = readConversationHistory(id, cid).at(-1);
    expect(last).toMatchObject({
      role: 'assistant',
      content: '写到一半',
      error: '服务重启，回合已中断',
    });
    expect(fs.existsSync(jp)).toBe(false);
  });

  it('孤儿 journal（会话已删）直接清理且不写历史', async () => {
    const id = makeProject('turn-orphan');
    await listConversations(id); // 初始化会话索引
    const jp = turnJournalPath(id, 'deadbeef0000');
    fs.mkdirSync(path.dirname(jp), { recursive: true });
    fs.writeFileSync(jp, `${JSON.stringify({ type: 'text_delta', delta: 'x' })}\n`);
    const before = await listConversations(id);
    recoverInterruptedTurns();
    expect(fs.existsSync(jp)).toBe(false);
    const after = await listConversations(id);
    expect(after.map((c) => c.messageCount)).toEqual(before.map((c) => c.messageCount));
  });
});
