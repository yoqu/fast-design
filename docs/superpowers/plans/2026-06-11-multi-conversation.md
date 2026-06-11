# 多对话（Conversation）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `docs/superpowers/specs/2026-06-11-multi-conversation-design.md`：每项目多对话、主聊天面板切换/新建/删除、pi 会话按对话隔离、旧单对话数据无损迁移。

**Architecture:** server 新增 `conversations.ts` 存储层（conversations.json 索引 + 每对话历史文件 + 惰性迁移），`PiSession` 增加 sessionDir 参数、会话 Map 键改 `pid:cid`，chat/abort/history 路由迁到 `/conversations/:cid/*`；web 在 ChatPanel 顶部加会话 header（标题 + 历史下拉 + 新建），App 持有 activeConversationId。

**Tech Stack:** 同前（Express/tsx/vitest + React/Vite）。**非 git 仓库，无提交步骤，以测试为完成判据。**

**现状锚点：**
- pi session dir 现为 `<project>/.webui/pi-sessions`（`pi-session.ts:79-81`），`--continue` 依据目录内 `.jsonl`。
- 旧路由：`GET /:id/history`(index.ts:144)、`POST /:id/chat`(:286-341)、`POST /:id/abort`(:343)。chat 路由内 `appendHistory` 两次（user/assistant）。
- `sessions: Map<string, PiSession>` 键为项目 id；`launchConfigFor(id)`/`sessionFor(id)`/`disposeIdleSessions` 在 index.ts:57-85。
- web：`ChatPanel` 以 `key={activeId}` remount；`api.history/streamChat/abort` 在 `web/src/lib/api.ts`。

---

### Task 1: server 对话存储层 + 迁移（conversations.ts）

**Files:**
- Create: `server/src/conversations.ts`
- Create: `server/src/conversations.test.ts`

- [x] **Step 1: 写失败测试** —— `server/src/conversations.test.ts`（新文件，完整内容）：

```ts
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createProject, deleteProject, getProject, projectDir } from './projects.js';
import {
  appendConversationHistory,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  piSessionDirFor,
  readConversationHistory,
  updateConversation,
} from './conversations.js';

const created: string[] = [];
afterAll(() => {
  for (const id of created) deleteProject(id);
});

function makeProject(name: string): string {
  const meta = createProject(name);
  created.push(meta.id);
  return meta.id;
}

describe('migration', () => {
  it('migrates legacy history.json + pi-sessions into a default conversation, idempotently', async () => {
    const id = makeProject('conv-migrate');
    const webui = path.join(projectDir(id), '.webui');
    // 构造旧形态：history.json + pi-sessions/*.jsonl，且无 conversations.json
    fs.writeFileSync(
      path.join(webui, 'history.json'),
      JSON.stringify([{ role: 'user', content: 'hi', createdAt: 1 }]),
    );
    fs.mkdirSync(path.join(webui, 'pi-sessions'), { recursive: true });
    fs.writeFileSync(path.join(webui, 'pi-sessions', 'abc.jsonl'), '{}\n');

    const list = await listConversations(id);
    expect(list).toHaveLength(1);
    const conv = list[0];
    expect(conv.title).toBeNull();
    expect(conv.createdAt).toBe(getProject(id)!.createdAt);
    expect(conv.messageCount).toBe(1);
    // 旧历史并入对话文件，旧文件删除
    expect(readConversationHistory(id, conv.id)).toEqual([{ role: 'user', content: 'hi', createdAt: 1 }]);
    expect(fs.existsSync(path.join(webui, 'history.json'))).toBe(false);
    // 旧 session jsonl 移入该对话的 session dir
    expect(fs.existsSync(path.join(piSessionDirFor(id, conv.id), 'abc.jsonl'))).toBe(true);
    // 幂等：再次列出不重复迁移
    const again = await listConversations(id);
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(conv.id);
  });

  it('creates an empty default conversation when no legacy data exists', async () => {
    const id = makeProject('conv-fresh');
    const list = await listConversations(id);
    expect(list).toHaveLength(1);
    expect(list[0].messageCount).toBe(0);
    expect(readConversationHistory(id, list[0].id)).toEqual([]);
  });
});

describe('CRUD + ordering', () => {
  it('creates, retitles, sorts by updatedAt desc, and reports messageCount', async () => {
    const id = makeProject('conv-crud');
    const [first] = await listConversations(id);
    const second = createConversation(id, '  方案B  ');
    expect(second.title).toBe('方案B');
    expect(createConversation(id, '   ').title).toBeNull();

    appendConversationHistory(id, first.id, { role: 'user', content: 'x', createdAt: Date.now() });
    const list = await listConversations(id);
    expect(list[0].id).toBe(first.id); // append bump 了 updatedAt，排最前
    expect(list[0].messageCount).toBe(1);

    const renamed = updateConversation(id, second.id, { title: '正式稿' })!;
    expect(renamed.title).toBe('正式稿');
    expect(getConversation(id, second.id)!.title).toBe('正式稿');
  });

  it('append bumps conversation and project updatedAt', async () => {
    const id = makeProject('conv-bump');
    const [conv] = await listConversations(id);
    const beforeProject = getProject(id)!.updatedAt!;
    await new Promise((r) => setTimeout(r, 5));
    appendConversationHistory(id, conv.id, { role: 'assistant', content: 'ok', createdAt: Date.now() });
    expect(getConversation(id, conv.id)!.updatedAt).toBeGreaterThan(conv.updatedAt);
    expect(getProject(id)!.updatedAt!).toBeGreaterThan(beforeProject);
  });

  it('delete removes index entry, history file and session dir', async () => {
    const id = makeProject('conv-del');
    const [conv] = await listConversations(id);
    fs.mkdirSync(piSessionDirFor(id, conv.id), { recursive: true });
    deleteConversation(id, conv.id);
    expect(getConversation(id, conv.id)).toBeNull();
    expect(fs.existsSync(piSessionDirFor(id, conv.id))).toBe(false);
    // 删空后列表为空（服务端不自动补建，由客户端兜底）
    expect(await listConversations(id)).toEqual([]);
  });
});
```

- [x] **Step 2: 跑测试确认失败** —— `pnpm --filter server test -- conversations`，FAIL（模块不存在）。

- [x] **Step 3: 实现** —— `server/src/conversations.ts`（新文件，完整内容）：

```ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getProject, projectDir, touchProject } from './projects.js';
import type { ChatMessage } from './types.js';

/** 对齐 open-design conversations 表（db.ts:76-84），sessionMode 裁剪。 */
export type ConversationMeta = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationSummary = ConversationMeta & { messageCount: number };

function webuiDir(projectId: string): string {
  return path.join(projectDir(projectId), '.webui');
}

function indexPath(projectId: string): string {
  return path.join(webuiDir(projectId), 'conversations.json');
}

function historyDir(projectId: string): string {
  return path.join(webuiDir(projectId), 'conversations');
}

function historyPath(projectId: string, cid: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(cid)) throw new Error(`invalid conversation id: ${cid}`);
  return path.join(historyDir(projectId), `${cid}.json`);
}

function legacyHistoryPath(projectId: string): string {
  return path.join(webuiDir(projectId), 'history.json');
}

function piSessionsRoot(projectId: string): string {
  return path.join(webuiDir(projectId), 'pi-sessions');
}

/** 每对话独立的 pi --session-dir（等效参照 agent_sessions 按 conversation 隔离）。 */
export function piSessionDirFor(projectId: string, cid: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(cid)) throw new Error(`invalid conversation id: ${cid}`);
  return path.join(piSessionsRoot(projectId), cid);
}

function readIndex(projectId: string): ConversationMeta[] | null {
  try {
    return JSON.parse(fs.readFileSync(indexPath(projectId), 'utf8')) as ConversationMeta[];
  } catch {
    return null;
  }
}

function writeIndex(projectId: string, list: ConversationMeta[]): void {
  fs.writeFileSync(indexPath(projectId), JSON.stringify(list, null, 2));
}

/**
 * 惰性迁移 + 兜底：无 conversations.json 时创建默认对话（title:null，
 * 对齐参照 project-routes.ts:1198-1210）。存在旧版单对话数据
 * （history.json / pi-sessions/*.jsonl）则无损并入默认对话——session
 * jsonl 移入 pi-sessions/<cid>/ 保住 --continue 上下文。幂等。
 */
function ensureConversations(projectId: string): ConversationMeta[] {
  const existing = readIndex(projectId);
  if (existing) return existing;

  const meta = getProject(projectId);
  const now = Date.now();
  const cid = crypto.randomBytes(6).toString('hex');
  const conv: ConversationMeta = {
    id: cid,
    title: null,
    createdAt: meta?.createdAt ?? now,
    updatedAt: meta?.updatedAt ?? meta?.createdAt ?? now,
  };

  fs.mkdirSync(historyDir(projectId), { recursive: true });

  let legacyMessages: ChatMessage[] = [];
  try {
    legacyMessages = JSON.parse(fs.readFileSync(legacyHistoryPath(projectId), 'utf8')) as ChatMessage[];
  } catch {
    // 没有旧历史——全新项目。
  }
  fs.writeFileSync(historyPath(projectId, cid), JSON.stringify(legacyMessages, null, 2));
  fs.rmSync(legacyHistoryPath(projectId), { force: true });

  // 旧 session jsonl 平铺在 pi-sessions/ 下，移入默认对话子目录。
  try {
    const root = piSessionsRoot(projectId);
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const jsonl = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
    if (jsonl.length > 0) {
      fs.mkdirSync(piSessionDirFor(projectId, cid), { recursive: true });
      for (const f of jsonl) {
        fs.renameSync(path.join(root, f.name), path.join(piSessionDirFor(projectId, cid), f.name));
      }
    }
  } catch {
    // 无旧 session 目录。
  }

  writeIndex(projectId, [conv]);
  return [conv];
}

function countMessages(projectId: string, cid: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath(projectId, cid), 'utf8')) as unknown[];
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/** 列表按 updatedAt DESC（对齐参照 listConversations），附 messageCount。 */
export async function listConversations(projectId: string): Promise<ConversationSummary[]> {
  return ensureConversations(projectId)
    .map((c) => ({ ...c, messageCount: countMessages(projectId, c.id) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(projectId: string, cid: string): ConversationMeta | null {
  return readIndex(projectId)?.find((c) => c.id === cid) ?? null;
}

export function createConversation(projectId: string, title?: string | null): ConversationMeta {
  const list = ensureConversations(projectId);
  const now = Date.now();
  const conv: ConversationMeta = {
    id: crypto.randomBytes(6).toString('hex'),
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
    createdAt: now,
    updatedAt: now,
  };
  fs.mkdirSync(historyDir(projectId), { recursive: true });
  fs.writeFileSync(historyPath(projectId, conv.id), '[]');
  writeIndex(projectId, [...list, conv]);
  return conv;
}

export function updateConversation(
  projectId: string,
  cid: string,
  patch: { title?: string | null },
): ConversationMeta | null {
  const list = ensureConversations(projectId);
  const idx = list.findIndex((c) => c.id === cid);
  if (idx < 0) return null;
  const next = { ...list[idx], updatedAt: Date.now() };
  if (patch.title !== undefined) {
    next.title = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : null;
  }
  list[idx] = next;
  writeIndex(projectId, list);
  return next;
}

export function deleteConversation(projectId: string, cid: string): boolean {
  const list = ensureConversations(projectId);
  const next = list.filter((c) => c.id !== cid);
  if (next.length === list.length) return false;
  writeIndex(projectId, next);
  fs.rmSync(historyPath(projectId, cid), { force: true });
  fs.rmSync(piSessionDirFor(projectId, cid), { recursive: true, force: true });
  return true;
}

export function readConversationHistory(projectId: string, cid: string): ChatMessage[] {
  try {
    return JSON.parse(fs.readFileSync(historyPath(projectId, cid), 'utf8')) as ChatMessage[];
  } catch {
    return [];
  }
}

/** 落一条消息并 bump 对话与项目的 updatedAt（对齐参照消息写入逻辑）。 */
export function appendConversationHistory(projectId: string, cid: string, message: ChatMessage): void {
  const history = readConversationHistory(projectId, cid);
  history.push(message);
  fs.mkdirSync(historyDir(projectId), { recursive: true });
  fs.writeFileSync(historyPath(projectId, cid), JSON.stringify(history, null, 2));
  const list = readIndex(projectId);
  if (list) {
    const idx = list.findIndex((c) => c.id === cid);
    if (idx >= 0) {
      list[idx] = { ...list[idx], updatedAt: Date.now() };
      writeIndex(projectId, list);
    }
  }
  touchProject(projectId);
}
```

- [x] **Step 4:** `pnpm --filter server test` 全 PASS + `pnpm --filter server build` 零错误。

---

### Task 2: PiSession sessionDir 参数 + 路由改造

**Files:**
- Modify: `server/src/pi-session.ts`
- Modify: `server/src/index.ts`

- [x] **Step 1: PiSession 改造** —— `server/src/pi-session.ts`：

(a) 构造函数与 sessionDir 方法替换为：

```ts
  constructor(
    private readonly cwd: string,
    private readonly getConfig: () => SessionLaunchConfig,
    /** 本会话（conversation）专属的 pi --session-dir，互不串上下文。 */
    private readonly sessionDirPath: string,
  ) {}
```

```ts
  private sessionDir(): string {
    return this.sessionDirPath;
  }
```

（类注释中「One long-lived `pi --mode rpc` process per project」改为「per conversation」。其余逻辑不变——`hasPriorSessions`/`ensureChild` 均走 `sessionDir()`。）

(b) 同步更新 `server/src/index.ts` 中会话管理段（index.ts:57-85 一带）整体替换为：

```ts
const sessions = new Map<string, PiSession>();

const sessionKey = (projectId: string, cid: string) => `${projectId}:${cid}`;

function launchConfigFor(id: string): SessionLaunchConfig {
  const meta = getProject(id);
  const appendPrompts: string[] = [];
  const globalInstructions = readWebuiSettings().instructions?.trim();
  if (globalInstructions) appendPrompts.push(globalInstructions);
  const projectInstructions = meta?.instructions?.trim();
  if (projectInstructions) appendPrompts.push(projectInstructions);
  return { model: meta?.model ?? null, thinking: meta?.thinking ?? null, appendPrompts };
}

function sessionFor(id: string, cid: string): PiSession {
  const key = sessionKey(id, cid);
  let session = sessions.get(key);
  if (!session) {
    session = new PiSession(projectDir(id), () => launchConfigFor(id), piSessionDirFor(id, cid));
    sessions.set(key, session);
  }
  return session;
}

/** dispose 项目下全部（或仅空闲）pi 会话。 */
function disposeProjectSessions(id: string, onlyIdle = false): void {
  const prefix = `${id}:`;
  for (const [key, session] of sessions) {
    if (!key.startsWith(prefix)) continue;
    if (onlyIdle && session.isBusy) continue;
    session.dispose();
    sessions.delete(key);
  }
}

function disposeIdleSessions(): void {
  for (const [key, session] of sessions) {
    if (!session.isBusy) {
      session.dispose();
      sessions.delete(key);
    }
  }
}
```

(c) import 区追加：`import { appendConversationHistory, createConversation, deleteConversation, getConversation, listConversations, piSessionDirFor, readConversationHistory, updateConversation } from './conversations.js';`；`appendHistory`、`readHistory` 从 `./projects.js` import 列表移除（如有其它使用处先确认；chat 路由是唯一消费方）。

(d) 既有路由调用点替换：
- `DELETE /api/projects/:id`：`sessions.get(id)?.dispose(); sessions.delete(id);` 替换为 `disposeProjectSessions(id);`
- `PATCH /api/projects/:id` 的 affectsSession 块：`const session = sessions.get(id); if (session && !session.isBusy) { session.dispose(); sessions.delete(id); }` 替换为 `disposeProjectSessions(id, true);`

(e) **删除**旧路由 `GET /api/projects/:id/history`、`POST /api/projects/:id/chat`、`POST /api/projects/:id/abort`，在 Import 路由段之前新增对话路由段：

```ts
// ---- Conversations ----

app.get('/api/projects/:id/conversations', async (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  res.json({ conversations: await listConversations(id) });
});

app.post('/api/projects/:id/conversations', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const title = typeof req.body?.title === 'string' ? req.body.title : null;
  res.json({ conversation: createConversation(id, title) });
});

app.patch('/api/projects/:id/conversations/:cid', (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const title = req.body?.title;
  const updated = updateConversation(id, cid, {
    title: title === undefined ? undefined : typeof title === 'string' ? title : null,
  });
  if (!updated) return res.status(404).json({ error: 'conversation not found' });
  res.json({ conversation: updated });
});

app.delete('/api/projects/:id/conversations/:cid', (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const key = sessionKey(id, cid);
  sessions.get(key)?.dispose();
  sessions.delete(key);
  if (!deleteConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  res.json({ ok: true });
});

app.get('/api/projects/:id/conversations/:cid/history', (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  if (!getConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  res.json(readConversationHistory(id, cid));
});

app.post('/api/projects/:id/conversations/:cid/abort', (req, res) => {
  sessions.get(sessionKey(req.params.id, req.params.cid))?.abort();
  res.json({ ok: true });
});

app.post('/api/projects/:id/conversations/:cid/chat', async (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  if (!getConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required' });

  const session = sessionFor(id, cid);
  if (session.isBusy) return res.status(409).json({ error: 'agent 正忙，请先停止当前回合' });

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  appendConversationHistory(id, cid, { role: 'user', content: message, createdAt: Date.now() });

  // Accumulate the assistant turn so it can be persisted once finished.
  const assistant: ChatMessage = { role: 'assistant', content: '', createdAt: Date.now() };
  const tools: ToolCall[] = [];

  const emit = (ev: UiEvent) => {
    switch (ev.type) {
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
    res.write(`${JSON.stringify(ev)}\n`);
  };

  req.on('close', () => {
    // Client went away mid-turn: stop the agent so it doesn't burn tokens.
    if (session.isBusy) session.abort();
  });

  await session.prompt(message, emit);
  if (tools.length > 0) assistant.tools = tools;
  appendConversationHistory(id, cid, assistant);
  res.write(`${JSON.stringify({ type: 'done' } satisfies UiEvent)}\n`);
  res.end();
});
```

(f) `server/src/projects.ts`：`appendHistory`/`readHistory`/`historyPath` 不再被路由使用——保留 `readHistory`（迁移测试可能用）？**删除 `appendHistory` 与 `readHistory` 及 historyPath**（conversations.ts 自带 legacy 读取），同时 `createProject` 中 `fs.writeFileSync(historyPath(id), '[]')` 一行删除（新项目首次 GET conversations 时由 ensureConversations 建默认对话）。检查 `projects.test.ts` 若有引用这两个函数的用例一并删除/迁移。

- [x] **Step 2:** `pnpm --filter server build && pnpm --filter server test` 全绿（修复因删除函数引发的编译/测试残留）。

---

### Task 3: web api 与类型

**Files:**
- Modify: `web/src/lib/types.ts`（+ConversationMeta/ConversationSummary）
- Modify: `web/src/lib/api.ts`

- [x] **Step 1: types.ts** —— `ProjectMeta` 之后追加：

```ts
export type ConversationMeta = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationSummary = ConversationMeta & { messageCount: number };
```

- [x] **Step 2: api.ts** ——

(a) 类型 import 行追加 `ConversationMeta, ConversationSummary`。

(b) `api` 对象追加：

```ts
  conversations: (id: string) =>
    fetch(`/api/projects/${id}/conversations`)
      .then((r) => json<{ conversations: ConversationSummary[] }>(r))
      .then((b) => b.conversations),
  createConversation: (id: string, title?: string | null) =>
    fetch(`/api/projects/${id}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title ?? null }),
    })
      .then((r) => json<{ conversation: ConversationMeta }>(r))
      .then((b) => b.conversation),
  deleteConversation: (id: string, cid: string) =>
    fetch(`/api/projects/${id}/conversations/${cid}`, { method: 'DELETE' }).then((r) =>
      json<{ ok: boolean }>(r),
    ),
```

(c) 旧方法签名改造：

```ts
  history: (id: string, cid: string) =>
    fetch(`/api/projects/${id}/conversations/${cid}/history`).then((r) => json<ChatMessage[]>(r)),
  abort: (id: string, cid: string) =>
    fetch(`/api/projects/${id}/conversations/${cid}/abort`, { method: 'POST' }),
```

(d) `streamChat` 第一行 fetch 路径改为：

```ts
export async function streamChat(
  projectId: string,
  conversationId: string,
  message: string,
  onEvent: (ev: UiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/conversations/${conversationId}/chat`, {
```

（函数体其余不变。）

- [x] **Step 3:** `pnpm --filter web build` 此时会因 ChatPanel/App 调用旧签名报错——属预期，Task 4 修复；本任务以 `tsc` 仅报这些调用点错误为通过判据（或与 Task 4 连续执行后统一验证）。

---

### Task 4: ChatPanel 会话 header + App 接线

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/ChatPanel.tsx`

- [x] **Step 1: App.tsx** ——

(a) import 追加 `ConversationSummary` 类型；状态区追加：

```ts
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
```

(b) `activeMeta` 附近追加（项目切换时加载会话列表并选中第一个；列表已按 updatedAt 倒序）：

```ts
  const loadConversations = useCallback(async (projectId: string, preferredId?: string | null) => {
    const list = await api.conversations(projectId);
    setConversations(list);
    setActiveConversationId((current) => {
      const wanted = preferredId ?? current;
      if (wanted && list.some((c) => c.id === wanted)) return wanted;
      return list[0]?.id ?? null;
    });
    return list;
  }, []);

  useEffect(() => {
    setConversations([]);
    setActiveConversationId(null);
    if (activeId) void loadConversations(activeId, null).catch(() => {});
  }, [activeId, loadConversations]);

  const createConversation = useCallback(async () => {
    if (!activeId) return;
    const conv = await api.createConversation(activeId);
    await loadConversations(activeId, conv.id);
  }, [activeId, loadConversations]);

  const deleteConversation = useCallback(
    async (cid: string) => {
      if (!activeId) return;
      await api.deleteConversation(activeId, cid);
      const list = await api.conversations(activeId);
      if (list.length === 0) {
        // 最后一个被删：对齐参照（ProjectView.tsx:4358-4366）客户端自动补建空对话。
        const conv = await api.createConversation(activeId);
        await loadConversations(activeId, conv.id);
        return;
      }
      setConversations(list);
      setActiveConversationId((current) => (current === cid ? list[0].id : current));
    },
    [activeId, loadConversations],
  );
```

(c) JSX：`<ChatPanel …>` 调整为（key 含会话 id，沿用 remount 模式；无会话时不渲染 ChatPanel，渲染加载占位）：

```tsx
          {activeConversationId ? (
            <ChatPanel
              key={`${activeId}:${activeConversationId}`}
              projectId={activeId}
              conversationId={activeConversationId}
              conversations={conversations}
              onSelectConversation={setActiveConversationId}
              onCreateConversation={createConversation}
              onDeleteConversation={deleteConversation}
              onGeneration={setGeneration}
              retryRef={retryRef}
              pendingPrompt={activeMeta?.pendingPrompt ?? null}
              onConsumePendingPrompt={consumePendingPrompt}
            />
          ) : (
            <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-white text-sm text-zinc-400">
              加载对话…
            </div>
          )}
```

- [x] **Step 2: ChatPanel.tsx** ——

(a) Props 增加：

```ts
  conversationId: string;
  conversations: ConversationSummary[];
  onSelectConversation: (cid: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (cid: string) => void;
```

（import type 行加 `ConversationSummary`；组件签名解构同步。）

(b) 历史加载与发送/中止改为会话级：`api.history(projectId)` → `api.history(projectId, conversationId)`；`streamChat(projectId, text, handleEvent)` → `streamChat(projectId, conversationId, text, handleEvent)`；`api.abort(projectId)` → `api.abort(projectId, conversationId)`；首个 useEffect 依赖数组追加 `conversationId`。

(c) 卸载中止（切换会话时若回合进行中，对齐参照「切换立即中止」）——组件内追加：

```ts
  useEffect(() => {
    return () => {
      if (generationInput.current.busy) void api.abort(projectId, conversationId);
    };
  }, [projectId, conversationId]);
```

(d) 顶部 header（JSX 最外层 div 内、消息滚动区之前插入）：

```tsx
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
          {conversations.find((c) => c.id === conversationId)?.title ?? '未命名对话'}
        </span>
        <button
          type="button"
          title="新对话"
          onClick={onCreateConversation}
          className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
        >
          ＋ 新对话
        </button>
        <div className="relative" ref={historyMenuRef}>
          <button
            type="button"
            title="对话历史"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
            className={`rounded-md px-2 py-1 text-xs ${historyOpen ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
          >
            历史
          </button>
          {historyOpen ? (
            <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                    c.id === conversationId ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => {
                      setHistoryOpen(false);
                      if (c.id !== conversationId) onSelectConversation(c.id);
                    }}
                  >
                    <span className="block truncate">{c.title ?? '未命名对话'}</span>
                    <span className="text-[10px] text-zinc-400">{c.messageCount} 条消息</span>
                  </button>
                  <button
                    type="button"
                    aria-label="删除对话"
                    className="rounded px-1 text-zinc-300 opacity-0 hover:bg-zinc-200 hover:text-red-500 group-hover:opacity-100"
                    onClick={() => {
                      if (confirm(`删除对话「${c.title ?? '未命名对话'}」？此操作不可恢复。`)) {
                        setHistoryOpen(false);
                        onDeleteConversation(c.id);
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
```

配套 state（组件 state 区追加）与外点关闭：

```ts
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!historyMenuRef.current?.contains(e.target as Node)) setHistoryOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [historyOpen]);
```

- [x] **Step 3:** `pnpm --filter web build && pnpm --filter web test` 全绿。

---

### Task 5: E2E 冒烟 + 全量回归

- [x] **Step 1: CRUD/迁移 E2E（临时服）**：

```bash
cd server && TMPDATA=$(mktemp -d) && PORT=4495 PI_WEBUI_DATA="$TMPDATA" npx tsx src/index.ts & sleep 2.5
PID=$(curl -s -X POST localhost:4495/api/projects -H 'Content-Type: application/json' -d '{"name":"conv-e2e"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
# 默认对话自动出现
curl -s localhost:4495/api/projects/$PID/conversations | python3 -c 'import json,sys;l=json.load(sys.stdin)["conversations"];assert len(l)==1 and l[0]["title"] is None;print("default OK",l[0]["id"])'
# 新建 + 改名 + 列表排序
CID2=$(curl -s -X POST localhost:4495/api/projects/$PID/conversations -H 'Content-Type: application/json' -d '{"title":"方案B"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["conversation"]["id"])')
curl -s -X PATCH localhost:4495/api/projects/$PID/conversations/$CID2 -H 'Content-Type: application/json' -d '{"title":"正式稿"}' | python3 -c 'import json,sys;assert json.load(sys.stdin)["conversation"]["title"]=="正式稿";print("patch OK")'
curl -s localhost:4495/api/projects/$PID/conversations | python3 -c 'import json,sys;l=json.load(sys.stdin)["conversations"];assert len(l)==2;print("list OK", [c["title"] for c in l])'
# 历史隔离（空）+ 删除
curl -s localhost:4495/api/projects/$PID/conversations/$CID2/history | python3 -c 'import json,sys;assert json.load(sys.stdin)==[];print("history OK")'
curl -s -X DELETE localhost:4495/api/projects/$PID/conversations/$CID2 | python3 -c 'import json,sys;assert json.load(sys.stdin)["ok"];print("delete OK")'
kill %1
```

- [x] **Step 2:** 仓库根 `pnpm test && pnpm build` 全绿。

- [x] **Step 3: 手动验证（浏览器）**：旧项目打开 → 历史完整迁移为「未命名对话」；新建对话 → 面板清空；两个对话各发消息互不串台（pi 上下文隔离）；删除当前对话切到下一个；删光自动补建。

---

**完成记录（2026-06-11）**：5 任务全部实施，终审 Ready。server 99 + web 22 全绿；E2E（默认对话/CRUD/排序/历史隔离/删除/旧项目迁移含 session jsonl 搬移）通过。追加修复：streamChat 卸载 AbortSignal（防生成态串台）、ensureConversations 同步不变式注释。已知可接受边界：PATCH 时 busy 会话的配置变更延迟到进程自然退出后生效。
