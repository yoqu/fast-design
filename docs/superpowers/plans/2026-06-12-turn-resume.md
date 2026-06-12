# 进行中回合的刷新/重启恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 回合与 HTTP 连接解耦——刷新页面续接进行中的回合，server 重启后恢复已生成内容并标记中断。

**Architecture:** 新模块 `server/src/turns.ts` 承载回合实体：事件折叠器（在线与恢复共用）、Turn（内存缓冲 + 订阅者 + 写穿磁盘 journal）、注册表 `startTurn`/`activeTurn`、启动恢复 `recoverInterruptedTurns`。`POST /chat` 改为「创建 Turn → 自己只是第一个订阅者」，新增 `GET /chat/stream` 续接（回放 + 实时，空闲 204）。前端把 `send()` 的事件消费抽成 `consumeTurn`，进会话时先试续接。

**Tech Stack:** Node + Express + 同步 fs（仓库既有风格），vitest，React。

**Spec:** `docs/superpowers/specs/2026-06-12-turn-resume-design.md`
（实现偏差说明：① journal 用每事件 `fs.appendFileSync` 而非 WriteStream——写入 OS 页缓存不 fsync，性能等价，但行为同步、测试确定，且与仓库全同步 fs 风格一致；② `attachTurn` 不取 spec 的 `(…, onEvent) => boolean` 形态，而是两步返回消费函数或 null——调用方需在确认有回合后、消费前先补 streaming 占位消息；③ 用户消息落盘留在 chat 路由，`startTurn` 只管 assistant 收尾；④ 已知边界：进程死于回合开始后、首个事件流出前时无 journal，恢复后只剩孤立用户消息（spec 只承诺恢复已生成内容）。）

**约定：** 所有命令在仓库根执行。server 测试 `cd server && npx vitest run src/turns.test.ts`；提交信息用中文，遵循仓库 `类型(范围): 说明` 风格。

---

### Task 1: 事件折叠器与 journal 路径（turns.ts 地基）

**Files:**
- Create: `server/src/turns.ts`
- Create: `server/src/turns.test.ts`

**背景：** 现在 `server/src/index.ts` 的 `POST /chat` 路由里有一段 assistant 累积器（`emit` 闭包的 switch，约 264-310 行，含 `turn_start` 检查点 + `retry` 回滚——这是 pi 自动重试时丢弃半截输出用的，语义必须原样保留）。本任务把它抽成纯函数，供在线流式与重启恢复共用。**本任务只建新文件，不改 index.ts**（Task 5 再接线）。

- [ ] **Step 1: 写失败测试**

创建 `server/src/turns.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/turns.test.ts`
Expected: FAIL —— `Cannot find module './turns.js'`

- [ ] **Step 3: 实现**

创建 `server/src/turns.ts`：

```ts
import fs from 'node:fs';
import path from 'node:path';
import { appendConversationHistory, getConversation } from './conversations.js';
import { listProjects, projectDir } from './projects.js';
import type { ChatMessage, ToolCall, UiEvent } from './types.js';

/** 进行中回合的事件日志目录（journal 写穿落盘，server 重启后恢复用）。 */
export function turnsDir(projectId: string): string {
  return path.join(projectDir(projectId), '.webui', 'turns');
}

export function turnJournalPath(projectId: string, cid: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(cid)) throw new Error(`invalid conversation id: ${cid}`);
  return path.join(turnsDir(projectId), `${cid}.ndjson`);
}

/**
 * 事件折叠状态。检查点 + retry 回滚与 ChatPanel 的归约器同语义：
 * pi 自动重试会把出错回合整个重发，必须丢弃半截输出（见 pi-events.ts）。
 */
export type TurnFold = {
  assistant: ChatMessage;
  tools: ToolCall[];
  checkpoint: { content: number; thinking: number };
};

export function createTurnFold(): TurnFold {
  return {
    assistant: { role: 'assistant', content: '', createdAt: Date.now() },
    tools: [],
    checkpoint: { content: 0, thinking: 0 },
  };
}

/** 在线流式与重启恢复共用的折叠函数（自 chat 路由的累积器搬入）。 */
export function foldTurnEvent(fold: TurnFold, ev: UiEvent): void {
  const { assistant, tools, checkpoint } = fold;
  switch (ev.type) {
    case 'turn_start':
      checkpoint.content = assistant.content.length;
      checkpoint.thinking = assistant.thinking?.length ?? 0;
      break;
    case 'retry':
      assistant.content = assistant.content.slice(0, checkpoint.content);
      if (assistant.thinking !== undefined) {
        assistant.thinking = assistant.thinking.slice(0, checkpoint.thinking);
      }
      delete assistant.error;
      break;
    case 'text_delta':
      assistant.content += ev.delta;
      break;
    case 'thinking_delta':
      assistant.thinking = (assistant.thinking ?? '') + ev.delta;
      break;
    case 'tool_use':
      tools.push({ id: ev.id, name: ev.name, input: ev.input });
      break;
    case 'tool_result': {
      const call = tools.find((t) => t.id === ev.toolUseId && t.result === undefined) ?? tools.at(-1);
      if (call) {
        call.result = ev.content.length > 4000 ? `${ev.content.slice(0, 4000)}\n…(截断)` : ev.content;
        call.isError = ev.isError;
      }
      break;
    }
    case 'error':
      assistant.error = ev.message;
      break;
  }
}

export function finishTurnFold(fold: TurnFold): ChatMessage {
  if (fold.tools.length > 0) fold.assistant.tools = fold.tools;
  return fold.assistant;
}
```

（`listProjects` 本任务暂未使用，Task 4 的恢复函数会用到；若 lint 报 unused 可先不引入、Task 4 再加。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/turns.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit**

```bash
git add server/src/turns.ts server/src/turns.test.ts
git commit -m "feat(turns): 回合事件折叠器与 journal 路径——在线流式与重启恢复共用"
```

---

### Task 2: Turn 实体（缓冲 + 订阅 + journal 写穿）

**Files:**
- Modify: `server/src/turns.ts`（追加）
- Modify: `server/src/turns.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `server/src/turns.test.ts` 追加（import 行同步加 `Turn`）：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/turns.test.ts`
Expected: FAIL —— `Turn` is not exported

- [ ] **Step 3: 实现**

在 `server/src/turns.ts` 末尾追加：

```ts
/**
 * 一个进行中的回合：事件缓冲 + 订阅者 + 写穿磁盘 journal。
 * 回合生命周期与 HTTP 连接解耦——订阅者只是观察者，断开即退订。
 * journal 用 appendFileSync 写穿（进 OS 页缓存即可，目标是进程重启可恢复，
 * 不追求断电级持久化）；写失败降级纯内存并告警，不杀回合。
 */
export class Turn {
  private buffer: UiEvent[] = [];
  private subscribers = new Set<(ev: UiEvent) => void>();
  private journalPath: string | null;
  private finished = false;
  readonly fold = createTurnFold();

  constructor(journalPath: string | null) {
    this.journalPath = journalPath;
    if (!journalPath) return;
    try {
      fs.mkdirSync(path.dirname(journalPath), { recursive: true });
      fs.rmSync(journalPath, { force: true });
    } catch (err) {
      console.error(`[turns] journal 初始化失败，降级纯内存: ${err instanceof Error ? err.message : err}`);
      this.journalPath = null;
    }
  }

  get isDone(): boolean {
    return this.finished;
  }

  emit(ev: UiEvent): void {
    if (this.finished) return;
    if (this.journalPath) {
      try {
        fs.appendFileSync(this.journalPath, `${JSON.stringify(ev)}\n`);
      } catch (err) {
        console.error(`[turns] journal 写入失败，降级纯内存: ${err instanceof Error ? err.message : err}`);
        this.journalPath = null;
      }
    }
    this.buffer.push(ev);
    foldTurnEvent(this.fold, ev);
    for (const fn of this.subscribers) fn(ev);
  }

  /**
   * 同步回放缓冲并订阅后续事件；返回退订函数。
   * 回放与登记在同一同步段完成，无丢失/重复窗口；已结束的回合回放后立即补 done。
   */
  subscribe(fn: (ev: UiEvent) => void): () => void {
    for (const ev of this.buffer) fn(ev);
    if (this.finished) {
      fn({ type: 'done' });
      return () => {};
    }
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** 结束回合：通知订阅者 done、删除 journal，返回折叠出的 assistant 消息。幂等。 */
  end(): ChatMessage {
    if (!this.finished) {
      this.finished = true;
      for (const fn of this.subscribers) fn({ type: 'done' });
      this.subscribers.clear();
      if (this.journalPath) fs.rmSync(this.journalPath, { force: true });
    }
    return finishTurnFold(this.fold);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/turns.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 5: Commit**

```bash
git add server/src/turns.ts server/src/turns.test.ts
git commit -m "feat(turns): Turn 实体——事件缓冲/订阅回放/journal 写穿落盘"
```

---

### Task 3: 回合注册表 startTurn / activeTurn

**Files:**
- Modify: `server/src/turns.ts`（追加）
- Modify: `server/src/turns.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `server/src/turns.test.ts` 追加（import 行同步加 `activeTurn, removeTurnJournal, startTurn`）：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/turns.test.ts`
Expected: FAIL —— `startTurn` is not exported

- [ ] **Step 3: 实现**

在 `server/src/turns.ts` 末尾追加：

```ts
const turns = new Map<string, Turn>();

function turnKey(projectId: string, cid: string): string {
  return `${projectId}:${cid}`;
}

/** 该会话当前进行中的回合（无则 undefined）。 */
export function activeTurn(projectId: string, cid: string): Turn | undefined {
  return turns.get(turnKey(projectId, cid));
}

/**
 * 启动一个回合：注册 Turn，把 run 的事件写穿 journal 并广播；结束后把折叠
 * 出的 assistant 消息落历史——不依赖是否有客户端连着（回合与连接解耦）。
 */
export function startTurn(
  projectId: string,
  cid: string,
  run: (emit: (ev: UiEvent) => void) => Promise<void>,
): { turn: Turn; finished: Promise<void> } {
  const key = turnKey(projectId, cid);
  const turn = new Turn(turnJournalPath(projectId, cid));
  turns.set(key, turn);
  const finished = run((ev) => turn.emit(ev))
    .catch((err) => {
      turn.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    })
    .then(() => {
      turns.delete(key);
      const assistant = turn.end();
      // 回合进行中会话可能已被删除：跳过持久化，避免复活已删历史文件。
      if (getConversation(projectId, cid)) {
        appendConversationHistory(projectId, cid, assistant);
      }
    });
  return { turn, finished };
}

/** 删除会话时同步清理可能残留的 journal。 */
export function removeTurnJournal(projectId: string, cid: string): void {
  fs.rmSync(turnJournalPath(projectId, cid), { force: true });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/turns.test.ts`
Expected: PASS（12 个用例）

- [ ] **Step 5: Commit**

```bash
git add server/src/turns.ts server/src/turns.test.ts
git commit -m "feat(turns): startTurn 注册表——回合收尾落盘与连接解耦"
```

---

### Task 4: 启动恢复 recoverInterruptedTurns

**Files:**
- Modify: `server/src/turns.ts`（追加）
- Modify: `server/src/turns.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `server/src/turns.test.ts` 追加（import 行同步加 `recoverInterruptedTurns`）：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/turns.test.ts`
Expected: FAIL —— `recoverInterruptedTurns` is not exported

- [ ] **Step 3: 实现**

在 `server/src/turns.ts` 末尾追加（此时 import 里需要 `listProjects`，若 Task 1 未引入则补上）：

```ts
const INTERRUPTED_MESSAGE = '服务重启，回合已中断';

/**
 * 启动恢复：扫描所有项目的 .webui/turns/*.ndjson。journal 存在即上次进程
 * 死于回合中途——折叠已流出的事件归档进历史并标记中断，删除 journal。
 * 不自动续跑（设计决策：LLM 生成现场无法接续，用户用重试入口一键重发）。
 */
export function recoverInterruptedTurns(): void {
  for (const project of listProjects()) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(turnsDir(project.id)).filter((f) => f.endsWith('.ndjson'));
    } catch {
      continue; // 无 turns 目录：该项目没有中断回合
    }
    for (const file of files) {
      const cid = file.slice(0, -'.ndjson'.length);
      const full = path.join(turnsDir(project.id), file);
      try {
        const events = fs
          .readFileSync(full, 'utf8')
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as UiEvent];
            } catch {
              return []; // 进程死于半行写入：跳过残行
            }
          });
        if (getConversation(project.id, cid)) {
          const fold = createTurnFold();
          for (const ev of events) foldTurnEvent(fold, ev);
          const assistant = finishTurnFold(fold);
          assistant.error = INTERRUPTED_MESSAGE;
          appendConversationHistory(project.id, cid, assistant);
          console.error(`[turns] 恢复中断回合: ${project.id}/${cid}（${events.length} 事件）`);
        }
      } catch (err) {
        console.error(`[turns] 恢复 ${project.id}/${cid} 失败: ${err instanceof Error ? err.message : err}`);
      }
      fs.rmSync(full, { force: true });
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/turns.test.ts`
Expected: PASS（14 个用例）

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS、tsc 无输出

- [ ] **Step 6: Commit**

```bash
git add server/src/turns.ts server/src/turns.test.ts
git commit -m "feat(turns): 启动恢复——残留 journal 折叠进历史并标记「服务重启，回合已中断」"
```

---

### Task 5: index.ts 接线（POST 重构 / GET 续接 / 启动恢复 / 删除清理）

**Files:**
- Modify: `server/src/index.ts`

无新增单测（路由层薄壳，逻辑都在已测的 turns.ts）；验收靠全量回归 + tsc + Task 8 端到端。

- [ ] **Step 1: 加 import**

在 `server/src/index.ts` 的 import 区（`import { runningProjectIds } from './running.js';` 附近）加：

```ts
import { activeTurn, recoverInterruptedTurns, removeTurnJournal, startTurn } from './turns.js';
```

- [ ] **Step 2: 重写 POST /chat 路由**

整段替换 `app.post('/api/projects/:id/conversations/:cid/chat', ...)`（现约 239-315 行，含 emit 累积器、`req.on('close') → abort`、收尾落盘——这些职责全部移交 turns.ts）为：

```ts
app.post('/api/projects/:id/conversations/:cid/chat', async (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  if (!getConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const attachments = sanitizeAttachments(req.body?.attachments);
  if (!message && attachments.length === 0) return res.status(400).json({ error: 'message is required' });

  const session = sessionFor(id, cid);
  if (session.isBusy || activeTurn(id, cid)) {
    return res.status(409).json({ error: 'agent 正忙，请先停止当前回合' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  appendConversationHistory(id, cid, {
    role: 'user',
    content: message,
    ...(attachments.length > 0 ? { attachments } : {}),
    createdAt: Date.now(),
  });

  // 回合与连接解耦：本响应只是第一个订阅者。客户端断开仅退订、不再 abort，
  // 回合后台跑完并由 startTurn 统一折叠落盘（spec: 2026-06-12-turn-resume）。
  const { turn, finished } = startTurn(id, cid, (emit) =>
    session.prompt(composePromptWithAttachments(message, attachments), emit),
  );
  const unsubscribe = turn.subscribe((ev) => {
    res.write(`${JSON.stringify(ev)}\n`);
  });
  req.on('close', unsubscribe);
  await finished;
  res.end();
});
```

注意：`done` 事件由 `turn.end()` 经订阅回调写出，路由不再手写 `done` 行；原 emit 闭包、`assistant`/`tools`/`checkpoint` 局部变量、`appendConversationHistory(id, cid, assistant)` 收尾全部删除。删完后检查 `ChatMessage`/`ToolCall`/`UiEvent` 等 import 是否仍被其他路由使用，不用则移除。

- [ ] **Step 3: 新增 GET 续接路由**

紧跟 POST /chat 之后加：

```ts
// 续接进行中的回合：回放已缓冲事件并实时续流，结尾 done；空闲返回 204。
// 多订阅者互不影响（多标签页可同时观看）。
app.get('/api/projects/:id/conversations/:cid/chat/stream', (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  if (!getConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  const turn = activeTurn(id, cid);
  if (!turn) return res.status(204).end();

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const unsubscribe = turn.subscribe((ev) => {
    res.write(`${JSON.stringify(ev)}\n`);
    if (ev.type === 'done') res.end();
  });
  req.on('close', unsubscribe);
});
```

- [ ] **Step 4: 删除会话时清理 journal**

在 `app.delete('/api/projects/:id/conversations/:cid', ...)` 路由里 `sessions.delete(key);` 之后加一行：

```ts
  removeTurnJournal(id, cid);
```

- [ ] **Step 5: 启动时跑恢复**

在文件末尾 `app.listen(PORT, ...)` 之前加：

```ts
// server 重启后：把上次进程死于中途的回合折叠进历史并标记中断。
recoverInterruptedTurns();
```

- [ ] **Step 6: 回归 + 类型检查**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS、tsc 无输出

- [ ] **Step 7: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): 回合与连接解耦——POST /chat 走 Turn 注册表，新增 GET /chat/stream 续接，启动恢复中断回合"
```

---

### Task 6: web api.ts —— consumeNdjson 抽取与 attachTurn

**Files:**
- Modify: `web/src/lib/api.ts`

前端 lib 无该模块测试基建，验收靠 tsc + Task 8 端到端。

- [ ] **Step 1: 抽取 NDJSON 消费循环**

`web/src/lib/api.ts` 中 `streamChat`（约 159-202 行）的 reader 循环抽成模块级私有函数，`streamChat` 改为调用它：

```ts
/** 逐行消费 NDJSON 响应流，对每行事件调用 onEvent。 */
async function consumeNdjson(res: Response, onEvent: (ev: UiEvent) => void): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as UiEvent);
      } catch {
        // skip malformed line
      }
    }
  }
}

/**
 * POST a chat message and invoke onEvent for each NDJSON line of the
 * streamed response. Resolves when the stream ends.
 */
export async function streamChat(
  projectId: string,
  conversationId: string,
  message: string,
  onEvent: (ev: UiEvent) => void,
  signal?: AbortSignal,
  attachments?: ChatAttachment[],
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/conversations/${conversationId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...(attachments?.length ? { attachments } : {}) }),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // keep statusText
    }
    throw new Error(detail || '请求失败');
  }
  await consumeNdjson(res, onEvent);
}
```

- [ ] **Step 2: 新增 attachTurn**

紧跟 `streamChat` 之后加：

```ts
/**
 * 续接进行中的回合（刷新/切回会话时调用）。空闲（204）返回 null；
 * 进行中返回消费函数——调用后回放已缓冲事件并实时续流直到回合结束。
 * 拆成两步是为了让调用方在确认有回合后、消费前先补 streaming 占位消息。
 */
export async function attachTurn(
  projectId: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<((onEvent: (ev: UiEvent) => void) => Promise<void>) | null> {
  const res = await fetch(`/api/projects/${projectId}/conversations/${conversationId}/chat/stream`, {
    signal,
  });
  if (res.status === 204) return null;
  if (!res.ok || !res.body) throw new Error(res.statusText || '续接失败');
  return (onEvent) => consumeNdjson(res, onEvent);
}
```

注意：本文件已有的 `api` 聚合对象若存在（`export const api = {...}`），把 `attachTurn` 一并挂上去，跟随 `streamChat` 的暴露方式——先看文件现状再决定，保持一致。

- [ ] **Step 3: 类型检查**

Run: `cd web && npx tsc -b --force`
Expected: 无输出（exit 0）

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web/api): attachTurn 续接接口与 NDJSON 消费循环抽取"
```

---

### Task 7: ChatPanel —— consumeTurn 抽取与进会话续接

**Files:**
- Modify: `web/src/components/ChatPanel.tsx`

**背景：** 现在 `send()`（约 142-254 行）一体包含：busy/状态初始化 → checkpoint + handleEvent 归约器 → streamChat → catch/finally 收尾。要把「消费一个回合」抽成 `consumeTurn`，发送与续接共用。另外组件卸载 effect（约 284-291 行）目前会 `api.abort` 杀回合——与「回合跑到结束」的新策略冲突，要改成只断本地读流。

- [ ] **Step 1: 抽取 consumeTurn 并重写 send**

在 `updateLast` 定义之后加 `consumeTurn`（内容即原 send 的事件消费段，**checkpoint/handleEvent 的 switch 原样搬入**，包括 turn_start/retry 检查点回滚分支）：

```ts
  // 消费一个回合的事件流（发送与刷新续接共用）：busy/状态初始化、事件归约、
  // catch/finally 收尾一体。controller 中断（切会话/卸载）时跳过全部收尾状态写。
  const consumeTurn = useCallback(
    async (
      run: (onEvent: (ev: UiEvent) => void) => Promise<void>,
      controller: AbortController,
    ) => {
      setBusy(true);
      setStatus('连接中');
      pushGeneration({
        busy: true,
        aborted: false,
        error: null,
        sawDelta: false,
        lastActivity: null,
        lastWrite: null,
        turnEnded: false,
      });

      // 回合检查点：pi 自动重试会把出错回合整个重发（见 server 端同名逻辑），
      // 收到 retry 事件时回滚半截输出并清掉错误标记。
      const checkpoint = { content: 0, thinking: 0 };

      const handleEvent = (ev: UiEvent) => {
        switch (ev.type) {
          case 'status':
            setStatus(ev.label);
            break;
          case 'turn_start':
            updateLast((m) => {
              checkpoint.content = m.content.length;
              checkpoint.thinking = m.thinking?.length ?? 0;
              return m;
            });
            break;
          case 'retry':
            updateLast((m) => ({
              ...m,
              content: m.content.slice(0, checkpoint.content),
              ...(m.thinking !== undefined
                ? { thinking: m.thinking.slice(0, checkpoint.thinking) }
                : {}),
              error: undefined,
            }));
            pushGeneration({ error: null });
            break;
          case 'text_delta':
            updateLast((m) => ({ ...m, content: m.content + ev.delta }));
            pushGeneration({ sawDelta: true, lastActivity: ev.delta });
            break;
          case 'thinking_delta':
            updateLast((m) => ({ ...m, thinking: (m.thinking ?? '') + ev.delta }));
            pushGeneration({ sawDelta: true, lastActivity: ev.delta });
            break;
          case 'tool_use': {
            updateLast((m) => ({
              ...m,
              tools: [...(m.tools ?? []), { id: ev.id, name: ev.name, input: ev.input }],
            }));
            const written = writtenFileFrom(ev.name, ev.input);
            pushGeneration({ sawDelta: true, ...(written ? { lastWrite: written } : {}) });
            break;
          }
          case 'tool_result':
            updateLast((m) => {
              const tools: ToolCall[] = [...(m.tools ?? [])];
              const idx = tools.findIndex((t) => t.id === ev.toolUseId && t.result === undefined);
              const target = idx >= 0 ? idx : tools.length - 1;
              if (target >= 0) {
                tools[target] = { ...tools[target], result: ev.content, isError: ev.isError };
              }
              return { ...m, tools };
            });
            break;
          case 'error':
            updateLast((m) => ({ ...m, error: ev.message }));
            pushGeneration({ error: ev.message });
            break;
        }
      };

      streamAbort.current = controller;
      try {
        await run(handleEvent);
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : '请求失败';
          updateLast((m) => ({ ...m, error: message }));
          pushGeneration({ error: message });
        }
      } finally {
        // 卸载中断（signal aborted）时组件已销毁，跳过全部状态更新，
        // 避免旧回合的收尾写到共享 generation / 新会话的 UI 上。
        if (!controller.signal.aborted) {
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          );
          setBusy(false);
          setStatus(null);
          pushGeneration({ busy: false, turnEnded: true });
        }
        if (streamAbort.current === controller) streamAbort.current = null;
      }
    },
    [updateLast, pushGeneration],
  );
```

`send` 缩成（替换原实现，依赖数组改为 `[projectId, conversationId, consumeTurn]`）：

```ts
  const send = useCallback(
    async (text: string, attachments: ChatAttachment[] = []) => {
      lastUserInput.current = { text, attachments };
      setMessages((prev) => [
        ...prev,
        {
          role: 'user',
          content: text,
          ...(attachments.length > 0 ? { attachments } : {}),
          createdAt: Date.now(),
        },
        { role: 'assistant', content: '', createdAt: Date.now(), streaming: true },
      ]);
      const controller = new AbortController();
      await consumeTurn(
        (onEvent) => streamChat(projectId, conversationId, text, onEvent, controller.signal, attachments),
        controller,
      );
    },
    [projectId, conversationId, consumeTurn],
  );
```

注意：`streamChat`/`attachTurn` 的引入方式跟随文件现有 import 风格（具名或经 `api` 聚合对象）。

- [ ] **Step 2: 进会话时续接进行中的回合**

把组件顶部的重置 effect（`useEffect` 内 `api.history(...).then(...)`，约 104-121 行）改为：

```ts
  useEffect(() => {
    setMessages([]);
    setBusy(false);
    setStatus(null);
    generationInput.current = {
      busy: false,
      aborted: false,
      error: null,
      sawDelta: false,
      lastActivity: null,
      lastWrite: null,
      turnEnded: false,
    };
    onGeneration?.(deriveGenerationModel(generationInput.current));
    let cancelled = false;
    const controller = new AbortController();
    api
      .history(projectId, conversationId)
      .then(async (msgs) => {
        if (cancelled) return;
        setMessages(msgs);
        // 刷新/切回会话时续接进行中的回合：204 即空闲，照旧浏览。
        const consume = await attachTurn(projectId, conversationId, controller.signal).catch(
          () => null,
        );
        if (!consume || cancelled) return;
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '', createdAt: Date.now(), streaming: true },
        ]);
        await consumeTurn(consume, controller);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectId, conversationId, onGeneration, consumeTurn]);
```

- [ ] **Step 3: 卸载不再杀回合**

把卸载 effect（约 284-291 行）改为只断本地读流、**删掉 `api.abort` 调用**：

```ts
  // 卸载/切换会话时只断本地读流（避免 finally 写共享 generation 状态）。
  // 回合与连接已解耦：服务端继续跑完并落盘，切回来可续接；
  // 主动停止只走停止按钮（stop → api.abort）。
  useEffect(() => {
    return () => {
      streamAbort.current?.abort();
    };
  }, [projectId, conversationId]);
```

（`stop` 回调即约 277-280 行的 `api.abort` 调用保持不动。）

- [ ] **Step 4: 回归 + 类型检查**

Run: `cd web && npx vitest run && npx tsc -b --force`
Expected: 全部 PASS、tsc 无输出

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatPanel.tsx
git commit -m "feat(web): 进会话续接进行中回合——consumeTurn 抽取，卸载不再杀回合"
```

---

### Task 8: 端到端验证（真实 pi 回合）

**Files:** 无代码改动。需要本机 pi 已配置可用模型（本仓库开发环境默认满足）。

- [ ] **Step 1: 起 server**

Run: `cd server && npx tsx src/index.ts &`（记下 PID；默认端口见启动日志，下文以 3000 计）
Expected: 打印 `pi-web-studio server: http://localhost:3000`

- [ ] **Step 2: 刷新续接场景**

```bash
# 取一个项目与会话 id
PROJECT=$(curl -s localhost:3000/api/projects | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
CID=$(curl -s localhost:3000/api/projects/$PROJECT/conversations | python3 -c 'import sys,json;print(json.load(sys.stdin)["conversations"][0]["id"])')
# 发一个慢任务，2 秒后掐断客户端（模拟刷新）
curl -sN localhost:3000/api/projects/$PROJECT/conversations/$CID/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"从 1 数到 30，每个数字单独一行，不要解释"}' --max-time 2 || true
# 立刻续接：应回放已缓冲行并继续流到 done
curl -sN localhost:3000/api/projects/$PROJECT/conversations/$CID/chat/stream | tail -3
```

Expected: 续接输出含 `text_delta` 行且最后一行是 `{"type":"done"}`；之后 `curl -s .../history` 末条为完整 assistant 消息（无 error）。
（conversations 列表接口返回形状若与上面解析不符，先 `curl -s` 看一眼再调整解析。）

- [ ] **Step 3: 重启恢复场景**

```bash
# 再发一个慢任务，2 秒后直接 kill server（回合进行中）
curl -sN localhost:3000/api/projects/$PROJECT/conversations/$CID/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"从 1 数到 50，每个数字单独一行，不要解释"}' --max-time 2 || true
kill <server-pid>
# 确认 journal 残留
ls <项目目录>/.webui/turns/
# 重启
cd server && npx tsx src/index.ts &
```

Expected: 启动日志含 `[turns] 恢复中断回合`；`curl -s .../history` 末条 assistant 带部分内容且 `error` 为 `服务重启，回合已中断`；`.webui/turns/` 已空；`GET .../chat/stream` 返回 204。

- [ ] **Step 4: 收尾**

杀掉测试 server 进程。如测试期间在真实项目会话里留下了计数消息，告知用户即可（属验证产物，不强行清理）。

---

## Self-Review 记录

- Spec 覆盖：解耦（Task 3/5）、续接（Task 5/6/7）、journal 落盘（Task 2）、启动恢复（Task 4/5）、删除清理（Task 3 跳过持久化 + Task 5 journal 清理）、卸载策略（Task 7）——齐。
- 偏差两处已注明：journal 用 appendFileSync（性能等价、测试确定）；用户消息落盘留在路由（startTurn 只管 assistant 收尾，职责更窄）。
- 类型一致性：`startTurn(projectId, cid, run)` 返回 `{ turn, finished }`、`attachTurn` 返回消费函数或 null、`consumeTurn(run, controller)`——各任务间已核对。
