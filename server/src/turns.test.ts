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

  it('parts 按到达顺序记录 text/thinking/tool 交错时间线', () => {
    const fold = createTurnFold();
    const events: UiEvent[] = [
      { type: 'turn_start' },
      { type: 'thinking_delta', delta: '想' },
      { type: 'text_delta', delta: '先看' },
      { type: 'text_delta', delta: '文件' },
      { type: 'tool_use', id: 't1', name: 'read', input: { path: 'a' } },
      { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      { type: 'text_delta', delta: '改好了' },
    ];
    for (const ev of events) foldTurnEvent(fold, ev);
    const msg = finishTurnFold(fold);
    expect(msg.parts).toEqual([
      { kind: 'thinking', text: '想' },
      { kind: 'text', text: '先看文件' },
      { kind: 'tool', toolIndex: 0 },
      { kind: 'text', text: '改好了' },
    ]);
    // 聚合字段保持原语义不变
    expect(msg.content).toBe('先看文件改好了');
    expect(msg.tools![0].result).toBe('ok');
  });

  it('retry 同步回滚 parts：截掉检查点后的片段与文本增量，tool 片段消失', () => {
    const fold = createTurnFold();
    const events: UiEvent[] = [
      { type: 'turn_start' },
      { type: 'text_delta', delta: '第一回合。' },
      { type: 'turn_start' },
      { type: 'text_delta', delta: '半截' },
      { type: 'tool_use', id: 't1', name: 'bash', input: null },
      { type: 'error', message: 'boom' },
      { type: 'retry' },
      { type: 'text_delta', delta: '第二回合。' },
    ];
    for (const ev of events) foldTurnEvent(fold, ev);
    const msg = finishTurnFold(fold);
    expect(msg.parts).toEqual([{ kind: 'text', text: '第一回合。第二回合。' }]);
    expect(msg.content).toBe('第一回合。第二回合。');
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

  // Fix 7: end 后 emit 是空操作
  it('end 后 emit 是空操作，缓冲不变，订阅者不再被调用', () => {
    const turn = new Turn(null);
    turn.emit({ type: 'text_delta', delta: 'a' });
    turn.end();
    // end 后的 emit 不应进入缓冲
    turn.emit({ type: 'text_delta', delta: 'b' });
    // 回放缓冲只含 'a'，没有 'b'，并且立即补 done
    const late: UiEvent[] = [];
    turn.subscribe((ev) => late.push(ev));
    expect(late).toEqual([
      { type: 'text_delta', delta: 'a' },
      { type: 'done' },
    ]);
  });

  // Fix 3: end 在 journal 路径被目录占用时不抛错（EISDIR 模拟）
  it('end 在 journal 路径被目录占用时不抛错（Fix 3 EISDIR）', () => {
    const id = makeProject('turn-eisdir');
    const jp = path.join(turnsDir(id), 'eisdir-test.ndjson');
    fs.mkdirSync(path.dirname(jp), { recursive: true });
    const turn = new Turn(jp);
    turn.emit({ type: 'text_delta', delta: 'x' });
    // 把 journal 文件替换成同名目录（含子文件），触发 EISDIR
    fs.rmSync(jp, { force: true });
    fs.mkdirSync(jp);
    fs.writeFileSync(path.join(jp, 'trap'), 'x');
    // end() 不应抛错
    expect(() => turn.end()).not.toThrow();
    // 幂等再调也安全，返回值正确
    expect(turn.end().content).toBe('x');
    // 清理陷阱目录
    fs.rmSync(jp, { recursive: true, force: true });
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

  // Fix 1: 抛错订阅者被自动退订，不影响其他订阅者与回合正常收尾
  it('抛错订阅者被自动退订，不影响其他订阅者与 startTurn 正常收尾', async () => {
    const id = makeProject('turn-throw-sub');
    const cid = (await listConversations(id))[0].id;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const eventsB: UiEvent[] = [];
    let throwerCallCount = 0;

    const { turn, finished } = startTurn(id, cid, async (emit) => {
      await gate; // 等订阅者注册后再发事件
      emit({ type: 'text_delta', delta: 'hello' });
      emit({ type: 'text_delta', delta: ' world' });
    });

    // 第一个订阅者：每次都抛错
    turn.subscribe(() => {
      throwerCallCount++;
      throw new Error('subscriber boom');
    });
    // 第二个订阅者：正常收集事件
    turn.subscribe((ev) => eventsB.push(ev));

    release();
    await finished;

    // 第一个事件触发抛错，退订后不再调用
    expect(throwerCallCount).toBe(1);
    // B 收到所有 text_delta 事件 + done
    expect(eventsB.filter((e) => e.type === 'text_delta')).toHaveLength(2);
    expect(eventsB.at(-1)).toEqual({ type: 'done' });
    // 回合正常写历史
    expect(readConversationHistory(id, cid).at(-1)).toMatchObject({ role: 'assistant', content: 'hello world' });
  });

  // Fix 2: 同 key 二次 startTurn 同步抛错，首次回合继续正常完成
  it('同 key 二次 startTurn 同步抛错，首次回合继续正常完成', async () => {
    const id = makeProject('turn-double');
    const cid = (await listConversations(id))[0].id;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });

    const { turn, finished } = startTurn(id, cid, async (emit) => {
      emit({ type: 'text_delta', delta: '正常' });
      await gate;
    });
    expect(activeTurn(id, cid)).toBe(turn);

    // 第二次 startTurn 应同步抛错，且不影响第一次回合
    expect(() => startTurn(id, cid, async () => {})).toThrow('该会话已有进行中的回合');

    // 第一次回合仍然注册
    expect(activeTurn(id, cid)).toBe(turn);

    release();
    await finished;

    // 第一次回合正常完成并写历史
    expect(readConversationHistory(id, cid).at(-1)).toMatchObject({ role: 'assistant', content: '正常' });
    expect(activeTurn(id, cid)).toBeUndefined();
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
