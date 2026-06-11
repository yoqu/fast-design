# 布局导航全量对齐 open-design 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页改为 EntryShell 项目列表,详情页去项目侧栏并支持拖拽分栏与预览 focus 模式,引入 URL 路由,顶栏/对话菜单/Questions 面板按 open-design 全量对齐。

**Architecture:** 自研轻量路由(history API + useSyncExternalStore,照抄参照 router.ts)驱动两大视图:EntryShell(导航 rail + Home/Projects)与 ProjectView(ChatPanel | 8px 拖拽手柄 | Workspace)。逻辑全部下沉到带单测的 lib 纯函数;组件无测试基建(无 testing-library),组件任务以 `tsc -b` 类型检查 + 手动验证代替组件测试。server 新增 running 标志与 handoff(目录/编辑器)端点。

**Tech Stack:** React 18 + TypeScript + Tailwind 4 + Vite 6 + vitest;server: Express + tsx。

**参照库:** `/Users/yoqu/Documents/code/ai/open-design-slim`(下称"参照")。
**Spec:** `docs/superpowers/specs/2026-06-11-layout-navigation-alignment-design.md`(含修正记录)。

**验证命令速查:**
- web 测试: `cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run`
- server 测试: `cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx vitest run`
- web 类型+构建: `cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b && npx vite build`
- server 类型: `cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx tsc --noEmit`

---

### Task 0: git 仓库初始化

本项目目前**不是 git 仓库**,先初始化以支持后续每任务提交。

**Files:**
- Create: `/Users/yoqu/Documents/code/self/agent-webui-master/.gitignore`

- [ ] **Step 1: 写 .gitignore**

```gitignore
node_modules/
data/
dist/
*.log
.DS_Store
```

- [ ] **Step 2: 初始化并提交基线**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master
git init
git add -A
git commit -m "chore: baseline before layout-navigation alignment"
```

预期:`git log --oneline` 显示 1 条提交。

---

### Task 1: 路由层 router.ts

**Files:**
- Create: `web/src/router.ts`
- Test: `web/src/router.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/router.test.ts
import { describe, expect, it } from 'vitest';
import { buildPath, parseRoute } from './router';

describe('parseRoute', () => {
  it('/ 默认落项目列表', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home', view: 'projects' });
  });
  it('/home 是 Home 视图', () => {
    expect(parseRoute('/home')).toEqual({ kind: 'home', view: 'home' });
  });
  it('/projects 是项目列表', () => {
    expect(parseRoute('/projects')).toEqual({ kind: 'home', view: 'projects' });
  });
  it('/projects/:id', () => {
    expect(parseRoute('/projects/abc')).toEqual({
      kind: 'project', projectId: 'abc', conversationId: null, fileName: null,
    });
  });
  it('/projects/:id/conversations/:cid', () => {
    expect(parseRoute('/projects/abc/conversations/c1')).toEqual({
      kind: 'project', projectId: 'abc', conversationId: 'c1', fileName: null,
    });
  });
  it('会话+文件深链,文件路径可含子目录', () => {
    expect(parseRoute('/projects/abc/conversations/c1/files/sub/page%20a.html')).toEqual({
      kind: 'project', projectId: 'abc', conversationId: 'c1', fileName: 'sub/page a.html',
    });
  });
  it('无会话的文件深链', () => {
    expect(parseRoute('/projects/abc/files/index.html')).toEqual({
      kind: 'project', projectId: 'abc', conversationId: null, fileName: 'index.html',
    });
  });
  it('未知路径回落项目列表', () => {
    expect(parseRoute('/whatever/x')).toEqual({ kind: 'home', view: 'projects' });
  });
});

describe('buildPath', () => {
  it('home 视图', () => {
    expect(buildPath({ kind: 'home', view: 'home' })).toBe('/home');
    expect(buildPath({ kind: 'home', view: 'projects' })).toBe('/projects');
  });
  it('project 各形态与 parseRoute 互逆', () => {
    const routes = [
      { kind: 'project', projectId: 'abc', conversationId: null, fileName: null },
      { kind: 'project', projectId: 'abc', conversationId: 'c1', fileName: null },
      { kind: 'project', projectId: 'abc', conversationId: 'c1', fileName: 'sub/page a.html' },
      { kind: 'project', projectId: 'abc', conversationId: null, fileName: 'index.html' },
    ] as const;
    for (const r of routes) expect(parseRoute(buildPath(r))).toEqual(r);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run src/router.test.ts
```
预期:FAIL,`Cannot find module './router'`。

- [ ] **Step 3: 实现 router.ts**

照参照 `apps/web/src/router.ts` 裁剪(去掉 design-systems/marketplace/tasks 等排除路径;`/` 默认 projects 为有意偏离):

```ts
// web/src/router.ts
// 自研轻量路由(行为照抄参照 open-design router.ts):URL 是
// "当前视图/打开文件"的唯一真值来源,pushState + popstate 驱动
// useSyncExternalStore,避免引入 react-router。
import { useSyncExternalStore } from 'react';

export type EntryHomeView = 'home' | 'projects';

export type Route =
  | { kind: 'home'; view: EntryHomeView }
  | {
      kind: 'project';
      projectId: string;
      /** 会话深链;不存在时由 ProjectView 回落 list[0]。 */
      conversationId?: string | null;
      fileName: string | null;
    };

export function parseRoute(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'home', view: 'projects' };
  if (parts[0] === 'home') return { kind: 'home', view: 'home' };
  if (parts[0] === 'projects') {
    if (parts[1]) {
      const projectId = decodeURIComponent(parts[1]);
      if (parts[2] === 'conversations' && parts[3]) {
        const conversationId = decodeURIComponent(parts[3]);
        if (parts[4] === 'files' && parts[5]) {
          return { kind: 'project', projectId, conversationId, fileName: decodeURIComponent(parts.slice(5).join('/')) };
        }
        return { kind: 'project', projectId, conversationId, fileName: null };
      }
      if (parts[2] === 'files' && parts[3]) {
        return { kind: 'project', projectId, conversationId: null, fileName: decodeURIComponent(parts.slice(3).join('/')) };
      }
      return { kind: 'project', projectId, conversationId: null, fileName: null };
    }
    return { kind: 'home', view: 'projects' };
  }
  return { kind: 'home', view: 'projects' };
}

export function buildPath(route: Route): string {
  if (route.kind === 'home') return route.view === 'home' ? '/home' : '/projects';
  const id = encodeURIComponent(route.projectId);
  const file = route.fileName
    ? route.fileName.split('/').map((s) => encodeURIComponent(s)).join('/')
    : null;
  if (route.conversationId) {
    const cid = encodeURIComponent(route.conversationId);
    return file
      ? `/projects/${id}/conversations/${cid}/files/${file}`
      : `/projects/${id}/conversations/${cid}`;
  }
  return file ? `/projects/${id}/files/${file}` : `/projects/${id}`;
}

// popstate 派发推迟到微任务,允许在 render/setState 中安全调用(同参照)。
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const target = buildPath(route);
  if (target === window.location.pathname) return;
  if (opts.replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  queueMicrotask(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

let cachedPathname: string | null = null;
let cachedRoute: Route | null = null;

function getRouteSnapshot(): Route {
  const pathname = window.location.pathname;
  if (cachedPathname !== pathname || cachedRoute === null) {
    cachedPathname = pathname;
    cachedRoute = parseRoute(pathname);
  }
  return cachedRoute;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRouteSnapshot, getRouteSnapshot);
}
```

- [ ] **Step 4: 测试通过**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run src/router.test.ts
```
预期:PASS 全绿。

- [ ] **Step 5: Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/router.ts web/src/router.test.ts
git commit -m "feat(web): 自研轻量 URL 路由(对齐参照 router.ts)"
```

---

### Task 2: server 项目运行状态 running 标志

项目卡片"运行中"状态点的数据来源。session key 形如 `${projectId}:${cid}`(server/src/index.ts:66),PiSession 有 `isBusy` getter(pi-session.ts:77)。

**Files:**
- Create: `server/src/running.ts`
- Test: `server/src/running.test.ts`
- Modify: `server/src/index.ts:111-113`(GET /api/projects)
- Modify: `web/src/lib/types.ts`(ProjectMeta 加 running)

- [ ] **Step 1: 写失败测试**

```ts
// server/src/running.test.ts
import { describe, expect, it } from 'vitest';
import { runningProjectIds } from './running.js';

describe('runningProjectIds', () => {
  it('从 busy session 中提取项目 id', () => {
    const sessions = new Map([
      ['p1:c1', { isBusy: true }],
      ['p1:c2', { isBusy: false }],
      ['p2:c9', { isBusy: false }],
      ['p3:c0', { isBusy: true }],
    ]);
    expect(runningProjectIds(sessions)).toEqual(new Set(['p1', 'p3']));
  });
  it('空 sessions 返回空集', () => {
    expect(runningProjectIds(new Map())).toEqual(new Set());
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx vitest run src/running.test.ts
```
预期:FAIL,模块不存在。

- [ ] **Step 3: 实现 running.ts**

```ts
// server/src/running.ts
/** 从 session 表(key 为 `${projectId}:${cid}`)提取仍在生成中的项目 id 集。 */
export function runningProjectIds(sessions: Iterable<[string, { isBusy: boolean }]>): Set<string> {
  const out = new Set<string>();
  for (const [key, session] of sessions) {
    if (!session.isBusy) continue;
    const sep = key.indexOf(':');
    if (sep > 0) out.add(key.slice(0, sep));
  }
  return out;
}
```

- [ ] **Step 4: 测试通过**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx vitest run src/running.test.ts
```
预期:PASS。

- [ ] **Step 5: 接入 GET /api/projects**

`server/src/index.ts` 顶部 import 区加:

```ts
import { runningProjectIds } from './running.js';
```

把 111 行附近的:

```ts
app.get('/api/projects', (_req, res) => {
  res.json(listProjects());
});
```

改为:

```ts
app.get('/api/projects', (_req, res) => {
  const running = runningProjectIds(sessions);
  res.json(listProjects().map((p) => ({ ...p, running: running.has(p.id) })));
});
```

(若原文不完全一致,保持原有 listProjects() 调用,仅包一层 map。)

- [ ] **Step 6: web 类型补字段**

`web/src/lib/types.ts` 的 `ProjectMeta` 末尾加一个字段:

```ts
  metadata?: ProjectMetadata;
  /** server 派生:该项目是否有正在生成的会话。 */
  running?: boolean;
```

- [ ] **Step 7: 类型检查 + server 全量测试**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx tsc --noEmit && npx vitest run
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
```
预期:无错误,测试全绿。

- [ ] **Step 8: Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add server/src/running.ts server/src/running.test.ts server/src/index.ts web/src/lib/types.ts
git commit -m "feat(server): GET /api/projects 返回 running 状态标志"
```

---

### Task 3: server handoff 端点(目录/编辑器探测/Finder/打开编辑器)

支撑 WorkingDirPill 与 HandoffButton。spec 修正:无「替换工作目录」(本项目无外部工作目录概念)。

**Files:**
- Create: `server/src/handoff.ts`
- Test: `server/src/handoff.test.ts`
- Modify: `server/src/index.ts`(三个新路由,加在 `app.get('/api/projects/:id/export', ...)` 之前)
- Modify: `web/src/lib/api.ts`(api 对象加 3 个方法)
- Modify: `web/src/lib/types.ts`(DetectedEditor 类型)

- [ ] **Step 1: 写失败测试**

```ts
// server/src/handoff.test.ts
import { describe, expect, it } from 'vitest';
import { detectEditors, EDITOR_CANDIDATES } from './handoff.js';

describe('detectEditors', () => {
  it('darwin 下 /Applications 命中即 installed', () => {
    const out = detectEditors({
      platform: 'darwin',
      exists: (p) => p === '/Applications/Cursor.app',
      hasBin: () => false,
    });
    expect(out.find((e) => e.id === 'cursor')?.installed).toBe(true);
    expect(out.find((e) => e.id === 'vscode')?.installed).toBe(false);
  });
  it('PATH 上有 bin 也算 installed(非 darwin)', () => {
    const out = detectEditors({
      platform: 'linux',
      exists: () => false,
      hasBin: (bin) => bin === 'code',
    });
    expect(out.find((e) => e.id === 'vscode')?.installed).toBe(true);
  });
  it('返回全部候选且顺序稳定', () => {
    const out = detectEditors({ platform: 'linux', exists: () => false, hasBin: () => false });
    expect(out.map((e) => e.id)).toEqual(EDITOR_CANDIDATES.map((c) => c.id));
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx vitest run src/handoff.test.ts
```
预期:FAIL,模块不存在。

- [ ] **Step 3: 实现 handoff.ts**

```ts
// server/src/handoff.ts
// 编辑器探测与本机交接动作(Finder/编辑器打开)。
// 探测依赖可注入,便于单测;真实调用走 fs/PATH。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type EditorCandidate = { id: string; name: string; app?: string; bin: string };

export const EDITOR_CANDIDATES: EditorCandidate[] = [
  { id: 'vscode', name: 'VS Code', app: 'Visual Studio Code.app', bin: 'code' },
  { id: 'cursor', name: 'Cursor', app: 'Cursor.app', bin: 'cursor' },
  { id: 'zed', name: 'Zed', app: 'Zed.app', bin: 'zed' },
  { id: 'webstorm', name: 'WebStorm', app: 'WebStorm.app', bin: 'webstorm' },
];

export type DetectedEditor = { id: string; name: string; installed: boolean };

function binOnPath(bin: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

export function detectEditors(
  opts: {
    platform?: NodeJS.Platform;
    exists?: (p: string) => boolean;
    hasBin?: (bin: string) => boolean;
  } = {},
): DetectedEditor[] {
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? fs.existsSync;
  const hasBin = opts.hasBin ?? binOnPath;
  return EDITOR_CANDIDATES.map((c) => {
    const appInstalled =
      platform === 'darwin' &&
      !!c.app &&
      (exists(`/Applications/${c.app}`) || exists(`${process.env.HOME ?? ''}/Applications/${c.app}`));
    return { id: c.id, name: c.name, installed: appInstalled || hasBin(c.bin) };
  });
}

function spawnDetached(cmd: string, args: string[]): void {
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

/** 在系统文件管理器中显示目录。 */
export function revealDir(dir: string): void {
  if (process.platform === 'darwin') spawnDetached('open', [dir]);
  else if (process.platform === 'win32') spawnDetached('explorer', [dir]);
  else spawnDetached('xdg-open', [dir]);
}

/** 用指定编辑器打开目录;未知编辑器返回 false。 */
export function openInEditor(editorId: string, dir: string): boolean {
  const c = EDITOR_CANDIDATES.find((e) => e.id === editorId);
  if (!c) return false;
  if (process.platform === 'darwin' && c.app) {
    spawnDetached('open', ['-a', c.app.replace(/\.app$/, ''), dir]);
  } else {
    spawnDetached(c.bin, [dir]);
  }
  return true;
}
```

- [ ] **Step 4: 测试通过**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx vitest run src/handoff.test.ts
```
预期:PASS。

- [ ] **Step 5: index.ts 加 3 个路由**

import 区加:

```ts
import { detectEditors, openInEditor, revealDir } from './handoff.js';
```

在 `app.get('/api/projects/:id/export', ...)` 之前插入(沿用现有 404 模式,`projectDir` 已在 import 列表里):

```ts
app.get('/api/projects/:id/handoff', (req, res) => {
  const meta = getProject(req.params.id);
  if (!meta) return res.status(404).json({ error: 'project not found' });
  res.json({ dir: projectDir(req.params.id), editors: detectEditors() });
});

app.post('/api/projects/:id/reveal', (req, res) => {
  const meta = getProject(req.params.id);
  if (!meta) return res.status(404).json({ error: 'project not found' });
  revealDir(projectDir(req.params.id));
  res.json({ ok: true });
});

app.post('/api/projects/:id/open-in-editor', (req, res) => {
  const meta = getProject(req.params.id);
  if (!meta) return res.status(404).json({ error: 'project not found' });
  const editor = typeof req.body?.editor === 'string' ? req.body.editor : '';
  if (!openInEditor(editor, projectDir(req.params.id))) {
    return res.status(400).json({ error: 'unknown editor' });
  }
  res.json({ ok: true });
});
```

- [ ] **Step 6: web 类型与 api 方法**

`web/src/lib/types.ts` 末尾加:

```ts
export type DetectedEditor = { id: string; name: string; installed: boolean };
export type HandoffInfo = { dir: string; editors: DetectedEditor[] };
```

`web/src/lib/api.ts` 的 `api` 对象(`renameFile` 之后)加:

```ts
  handoffInfo: (id: string) =>
    fetch(`/api/projects/${id}/handoff`).then((r) => json<HandoffInfo>(r)),
  revealProject: (id: string) =>
    fetch(`/api/projects/${id}/reveal`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  openInEditor: (id: string, editor: string) =>
    fetch(`/api/projects/${id}/open-in-editor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editor }),
    }).then((r) => json<{ ok: boolean }>(r)),
```

并在文件第 1 行的 type import 里补 `HandoffInfo`。

- [ ] **Step 7: 类型检查 + 全量测试**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx tsc --noEmit && npx vitest run
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
```
预期:全绿。

- [ ] **Step 8: Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add server/src/handoff.ts server/src/handoff.test.ts server/src/index.ts web/src/lib/api.ts web/src/lib/types.ts
git commit -m "feat(server): handoff 端点(编辑器探测/Finder/编辑器打开)"
```

---

### Task 4: lib 纯函数 — relativeTime + 项目列表过滤排序

**Files:**
- Create: `web/src/lib/relativeTime.ts` / Test: `web/src/lib/relativeTime.test.ts`
- Create: `web/src/lib/projectsList.ts` / Test: `web/src/lib/projectsList.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/lib/relativeTime.test.ts
import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime';

const NOW = 1_750_000_000_000;

describe('relativeTime', () => {
  it('1 分钟内 → 刚才', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('刚才');
  });
  it('分钟', () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前');
  });
  it('小时', () => {
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前');
  });
  it('天', () => {
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2 天前');
  });
  it('超过 30 天显示日期', () => {
    const ts = NOW - 40 * 86_400_000;
    expect(relativeTime(ts, NOW)).toBe(new Date(ts).toLocaleDateString());
  });
});
```

```ts
// web/src/lib/projectsList.test.ts
import { describe, expect, it } from 'vitest';
import type { ProjectMeta } from './types';
import { filterProjects, sortProjects } from './projectsList';

const p = (id: string, name: string, createdAt: number, updatedAt?: number): ProjectMeta =>
  ({ id, name, createdAt, updatedAt }) as ProjectMeta;

describe('filterProjects', () => {
  const list = [p('1', 'Coffee Shop', 1), p('2', '咖啡店落地页', 2), p('3', 'Dashboard', 3)];
  it('空查询返回原列表', () => {
    expect(filterProjects(list, '  ')).toEqual(list);
  });
  it('大小写不敏感匹配名称', () => {
    expect(filterProjects(list, 'coffee').map((x) => x.id)).toEqual(['1']);
    expect(filterProjects(list, '咖啡').map((x) => x.id)).toEqual(['2']);
  });
});

describe('sortProjects', () => {
  const list = [p('a', 'A', 100, 500), p('b', 'B', 300), p('c', 'C', 200, 900)];
  it('recent 按 updatedAt(缺省回落 createdAt)降序', () => {
    expect(sortProjects(list, 'recent').map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
  it('created 按 createdAt 降序', () => {
    expect(sortProjects(list, 'created').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('不改原数组', () => {
    const copy = [...list];
    sortProjects(list, 'recent');
    expect(list).toEqual(copy);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run src/lib/relativeTime.test.ts src/lib/projectsList.test.ts
```
预期:FAIL,模块不存在。

- [ ] **Step 3: 实现**

```ts
// web/src/lib/relativeTime.ts
/** 项目卡片相对时间(对齐参照 RecentProjectsStrip 文案粒度)。 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚才';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString();
}
```

```ts
// web/src/lib/projectsList.ts
import type { ProjectMeta } from './types';

/** Projects 视图子标签:recent=最近修改优先(参照 Recent),created=创建时间优先(参照 Yours)。 */
export type ProjectsSubTab = 'recent' | 'created';

export function filterProjects(list: ProjectMeta[], query: string): ProjectMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) => p.name.toLowerCase().includes(q));
}

export function sortProjects(list: ProjectMeta[], tab: ProjectsSubTab): ProjectMeta[] {
  return [...list].sort((a, b) =>
    tab === 'recent'
      ? (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)
      : b.createdAt - a.createdAt,
  );
}
```

- [ ] **Step 4: 测试通过**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run src/lib/relativeTime.test.ts src/lib/projectsList.test.ts
```
预期:PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/lib/relativeTime.ts web/src/lib/relativeTime.test.ts web/src/lib/projectsList.ts web/src/lib/projectsList.test.ts
git commit -m "feat(web): relativeTime 与项目列表过滤/排序纯函数"
```

---

### Task 5: lib — 聊天面板宽度(clamp/持久化)

**Files:**
- Create: `web/src/lib/chatPanelWidth.ts`
- Test: `web/src/lib/chatPanelWidth.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/lib/chatPanelWidth.test.ts
import { describe, expect, it } from 'vitest';
import {
  CHAT_PANEL_WIDTH_KEY,
  DEFAULT_CHAT_PANEL_WIDTH,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  clampChatPanelWidth,
  readSavedChatPanelWidth,
  saveChatPanelWidth,
} from './chatPanelWidth';

function memStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('clampChatPanelWidth', () => {
  it('限制在 [345, 720]', () => {
    expect(clampChatPanelWidth(100)).toBe(MIN_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(9999)).toBe(MAX_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(500)).toBe(500);
  });
  it('非法值回落默认 460', () => {
    expect(clampChatPanelWidth(Number.NaN)).toBe(DEFAULT_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(Infinity)).toBe(MAX_CHAT_PANEL_WIDTH);
  });
});

describe('read/save', () => {
  it('无存储回落默认', () => {
    expect(readSavedChatPanelWidth(memStorage())).toBe(DEFAULT_CHAT_PANEL_WIDTH);
  });
  it('读取时 clamp 越界存量', () => {
    expect(readSavedChatPanelWidth(memStorage({ [CHAT_PANEL_WIDTH_KEY]: '50' }))).toBe(MIN_CHAT_PANEL_WIDTH);
  });
  it('save 后可 read 回', () => {
    const s = memStorage();
    saveChatPanelWidth(512, s);
    expect(readSavedChatPanelWidth(s)).toBe(512);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run src/lib/chatPanelWidth.test.ts
```
预期:FAIL。

- [ ] **Step 3: 实现**

```ts
// web/src/lib/chatPanelWidth.ts
// 常量对齐参照 ProjectView.tsx:295-309。
export const DEFAULT_CHAT_PANEL_WIDTH = 460;
export const MIN_CHAT_PANEL_WIDTH = 345;
export const MAX_CHAT_PANEL_WIDTH = 720;
export const CHAT_PANEL_KEYBOARD_STEP = 16;
export const CHAT_PANEL_WIDTH_KEY = 'webui:project.chatPanelWidth';

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function clampChatPanelWidth(width: number): number {
  if (Number.isNaN(width)) return DEFAULT_CHAT_PANEL_WIDTH;
  return Math.min(MAX_CHAT_PANEL_WIDTH, Math.max(MIN_CHAT_PANEL_WIDTH, Math.round(width)));
}

export function readSavedChatPanelWidth(storage: StorageLike = localStorage): number {
  try {
    const raw = storage.getItem(CHAT_PANEL_WIDTH_KEY);
    if (!raw) return DEFAULT_CHAT_PANEL_WIDTH;
    return clampChatPanelWidth(Number(raw));
  } catch {
    return DEFAULT_CHAT_PANEL_WIDTH;
  }
}

export function saveChatPanelWidth(width: number, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(CHAT_PANEL_WIDTH_KEY, String(clampChatPanelWidth(width)));
  } catch {
    // localStorage 不可用时仅失去记忆,无碍。
  }
}
```

- [ ] **Step 4: 测试通过 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run src/lib/chatPanelWidth.test.ts
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/lib/chatPanelWidth.ts web/src/lib/chatPanelWidth.test.ts
git commit -m "feat(web): 聊天面板宽度 clamp/持久化(345-720,默认 460)"
```

---

### Task 6: lib — question-form 解析

参照 `apps/web/src/artifacts/question-form.ts`,裁剪:只取最后一个表单、direction-cards 降级 radio、不做 partial-json(只解析完整 JSON)。

**Files:**
- Create: `web/src/lib/questionForm.ts`
- Test: `web/src/lib/questionForm.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/src/lib/questionForm.test.ts
import { describe, expect, it } from 'vitest';
import { extractQuestionForm } from './questionForm';

const SAMPLE = `先确认两个问题。

<question-form id="discovery" title="快速确认">
{
  "questions": [
    { "id": "platform", "label": "平台", "type": "radio",
      "options": ["移动端", "桌面 Web"], "required": true },
    { "id": "audience", "label": "目标用户", "type": "text", "placeholder": "如 SaaS 买家" }
  ]
}
</question-form>

回答后我继续。`;

describe('extractQuestionForm', () => {
  it('解析表单与属性', () => {
    const form = extractQuestionForm(SAMPLE);
    expect(form?.id).toBe('discovery');
    expect(form?.title).toBe('快速确认');
    expect(form?.questions).toHaveLength(2);
    expect(form?.questions[0].options).toEqual([
      { label: '移动端', value: '移动端' },
      { label: '桌面 Web', value: '桌面 Web' },
    ]);
  });
  it('支持 ask-question 别名', () => {
    const text = '<ask-question>{"questions":[{"id":"q","label":"Q","type":"text"}]}</ask-question>';
    expect(extractQuestionForm(text)?.questions).toHaveLength(1);
  });
  it('direction-cards 降级为 radio', () => {
    const text = '<question-form>{"questions":[{"id":"d","label":"方向","type":"direction-cards","options":["A","B"]}]}</question-form>';
    expect(extractQuestionForm(text)?.questions[0].type).toBe('radio');
  });
  it('无表单/坏 JSON 返回 null', () => {
    expect(extractQuestionForm('普通回复')).toBeNull();
    expect(extractQuestionForm('<question-form>{bad json</question-form>')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run src/lib/questionForm.test.ts
```
预期:FAIL。

- [ ] **Step 3: 实现**

```ts
// web/src/lib/questionForm.ts
// 解析助手消息里的 <question-form>…</question-form>(别名 <ask-question>)。
// 对齐参照 artifacts/question-form.ts 的数据结构,裁剪:只取最后一个
// 表单、要求完整 JSON、direction-cards 降级 radio。
export type QuestionType = 'radio' | 'checkbox' | 'select' | 'text' | 'textarea';

export type FormOption = { label: string; value: string; description?: string };

export type FormQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  options?: FormOption[];
  placeholder?: string;
  required?: boolean;
  help?: string;
};

export type QuestionForm = { id: string | null; title: string | null; questions: FormQuestion[] };

const FORM_RE = /<(question-form|ask-question)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

function normalizeOption(raw: unknown): FormOption | null {
  if (typeof raw === 'string') return { label: raw, value: raw };
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label : typeof o.value === 'string' ? o.value : null;
    if (!label) return null;
    return {
      label,
      value: typeof o.value === 'string' ? o.value : label,
      ...(typeof o.description === 'string' ? { description: o.description } : {}),
    };
  }
  return null;
}

function normalizeQuestion(raw: unknown): FormQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.id !== 'string' || typeof q.label !== 'string') return null;
  const declared = typeof q.type === 'string' ? q.type : 'text';
  const type: QuestionType =
    declared === 'direction-cards'
      ? 'radio'
      : (['radio', 'checkbox', 'select', 'text', 'textarea'] as const).includes(declared as QuestionType)
        ? (declared as QuestionType)
        : 'text';
  const options = Array.isArray(q.options)
    ? q.options.map(normalizeOption).filter((o): o is FormOption => o !== null)
    : undefined;
  return {
    id: q.id,
    label: q.label,
    type,
    ...(options && options.length > 0 ? { options } : {}),
    ...(typeof q.placeholder === 'string' ? { placeholder: q.placeholder } : {}),
    ...(typeof q.required === 'boolean' ? { required: q.required } : {}),
    ...(typeof q.help === 'string' ? { help: q.help } : {}),
  };
}

/** 取文本中最后一个合法表单;无表单或 JSON 不合法返回 null。 */
export function extractQuestionForm(text: string): QuestionForm | null {
  let last: QuestionForm | null = null;
  for (const m of text.matchAll(FORM_RE)) {
    try {
      const body = JSON.parse(m[3]) as { questions?: unknown[] };
      if (!Array.isArray(body.questions)) continue;
      const questions = body.questions
        .map(normalizeQuestion)
        .filter((q): q is FormQuestion => q !== null);
      if (questions.length === 0) continue;
      last = { id: attr(m[2], 'id'), title: attr(m[2], 'title'), questions };
    } catch {
      // 坏 JSON 跳过
    }
  }
  return last;
}
```

- [ ] **Step 4: 测试通过 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run src/lib/questionForm.test.ts
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/lib/questionForm.ts web/src/lib/questionForm.test.ts
git commit -m "feat(web): question-form 解析(对齐参照,direction-cards 降级 radio)"
```

---

### Task 7: ProjectCard 组件

**Files:**
- Create: `web/src/components/ProjectCard.tsx`

无组件测试基建,本任务以类型检查验证;交互在 Task 17 手动验证。

- [ ] **Step 1: 实现组件**

```tsx
// web/src/components/ProjectCard.tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { relativeTime } from '../lib/relativeTime';
import type { ProjectMeta } from '../lib/types';

type Props = {
  project: ProjectMeta;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** 批量选择模式:显示勾选框,点击卡片切换选中而非打开。 */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
};

/**
 * 项目卡片,对齐参照 RecentProjectsStrip.tsx:157-218 + DesignsTab 卡片:
 * 缩略图(入口 HTML iframe / 首字母渐变)、名称、类型标签、运行状态点、
 * 相对时间、hover ⋯ 菜单(打开/重命名/删除)、双击重命名。
 */
export default function ProjectCard({ project, onOpen, onRename, onDelete, selectMode, selected, onToggleSelect }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const entry = project.metadata?.entryFile ?? null;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const commitRename = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== project.name) onRename(project.id, name);
    else setDraft(project.name);
  };

  const handleCardClick = () => {
    if (editing) return;
    if (selectMode) onToggleSelect?.(project.id);
    else onOpen(project.id);
  };

  return (
    <div
      className={`group relative cursor-pointer rounded-xl border bg-white transition-shadow hover:shadow-md ${
        selected ? 'border-zinc-900' : 'border-zinc-200'
      }`}
      onClick={handleCardClick}
    >
      <div className="pointer-events-none relative h-36 overflow-hidden rounded-t-xl border-b border-zinc-100 bg-zinc-50">
        {entry ? (
          <iframe
            src={api.fileUrl(project.id, entry)}
            sandbox="allow-scripts"
            tabIndex={-1}
            title={`${project.name} 预览`}
            className="h-[576px] w-[400%] origin-top-left scale-[0.25] border-0 bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-3xl font-semibold text-zinc-400">
            {(project.name[0] ?? 'π').toUpperCase()}
          </div>
        )}
        {selectMode && (
          <span
            className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
              selected ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-transparent'
            }`}
          >
            ✓
          </span>
        )}
      </div>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Prototype</span>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setDraft(project.name);
                  setEditing(false);
                }
              }}
              className="block w-full rounded border border-zinc-300 px-1 py-0.5 text-sm"
            />
          ) : (
            <p
              className="truncate text-sm font-medium text-zinc-800"
              title={project.name}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setDraft(project.name);
                setEditing(true);
              }}
            >
              {project.name}
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
            {project.running && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" title="生成中" />
            )}
            {relativeTime(project.updatedAt ?? project.createdAt)}
          </p>
        </div>
        {!selectMode && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="项目操作"
              className="rounded-md px-1.5 py-0.5 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-zinc-200 bg-white p-1 text-xs shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <button type="button" role="menuitem" className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50" onClick={() => onOpen(project.id)}>
                  打开
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50"
                  onClick={() => {
                    setMenuOpen(false);
                    setDraft(project.name);
                    setEditing(true);
                  }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded-md px-2 py-1.5 text-left text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setMenuOpen(false);
                    if (confirm(`删除项目「${project.name}」？此操作不可恢复。`)) onDelete(project.id);
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
```
预期:无错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/ProjectCard.tsx
git commit -m "feat(web): ProjectCard 卡片(缩略图/状态点/hover 菜单/双击重命名)"
```

---

### Task 8: ProjectsView 组件(完整列表)

**Files:**
- Create: `web/src/components/ProjectsView.tsx`

- [ ] **Step 1: 实现组件**

spec 修正:无 Kanban(本项目无任务状态体系),仅 Grid。

```tsx
// web/src/components/ProjectsView.tsx
import { useMemo, useState } from 'react';
import { filterProjects, sortProjects, type ProjectsSubTab } from '../lib/projectsList';
import type { ProjectMeta } from '../lib/types';
import ProjectCard from './ProjectCard';

type Props = {
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onNewProject: () => void;
};

/**
 * Projects 完整列表视图,对齐参照 DesignsTab:搜索、Recent/Yours 子标签
 * (排序差异)、Select 批量删除、卡片网格。Kanban 因无任务状态体系裁剪。
 */
export default function ProjectsView({ projects, onOpen, onRename, onDelete, onNewProject }: Props) {
  const [query, setQuery] = useState('');
  const [subTab, setSubTab] = useState<ProjectsSubTab>('recent');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => sortProjects(filterProjects(projects, query), subTab),
    [projects, query, subTab],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const deleteSelected = () => {
    if (selected.size === 0) return;
    if (!confirm(`删除选中的 ${selected.size} 个项目？此操作不可恢复。`)) return;
    for (const id of selected) onDelete(id);
    exitSelectMode();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-6 py-3">
        <div className="flex rounded-lg bg-zinc-100 p-0.5 text-xs">
          {(
            [
              ['recent', '最近'],
              ['created', '按创建时间'],
            ] as Array<[ProjectsSubTab, string]>
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSubTab(tab)}
              className={`rounded-md px-2.5 py-1 ${subTab === tab ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索项目…"
          className="w-56 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs outline-none focus:border-zinc-400"
        />
        <div className="flex-1" />
        {selectMode ? (
          <>
            <span className="text-xs text-zinc-500">已选 {selected.size} 项</span>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selected.size === 0}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
            >
              删除所选
            </button>
            <button type="button" onClick={exitSelectMode} className="rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">
              取消
            </button>
          </>
        ) : (
          projects.length > 0 && (
            <button type="button" onClick={() => setSelectMode(true)} className="rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">
              选择
            </button>
          )
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-zinc-400">
            <span className="text-5xl">π</span>
            {projects.length === 0 ? (
              <>
                <p className="mt-4 text-sm">还没有项目</p>
                <button
                  type="button"
                  onClick={onNewProject}
                  className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
                >
                  ＋ 新建项目
                </button>
              </>
            ) : (
              <p className="mt-4 text-sm">没有匹配「{query}」的项目</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {visible.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={onOpen}
                onRename={onRename}
                onDelete={onDelete}
                selectMode={selectMode}
                selected={selected.has(p.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/ProjectsView.tsx
git commit -m "feat(web): Projects 完整列表视图(搜索/排序/批量删除)"
```

---

### Task 9: HomeView 组件

**Files:**
- Create: `web/src/components/HomeView.tsx`

- [ ] **Step 1: 实现组件**

```tsx
// web/src/components/HomeView.tsx
import { useState } from 'react';
import { sortProjects } from '../lib/projectsList';
import type { ProjectMeta } from '../lib/types';
import ProjectCard from './ProjectCard';

type Props = {
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Hero 提交:用 prompt 建项目(pendingPrompt 语义,预填不自动发)。 */
  onCreateFromPrompt: (prompt: string) => Promise<void>;
  /** 打开新建/导入面板。 */
  onNewProject: () => void;
  onViewAll: () => void;
};

/**
 * Home 视图,对齐参照 HomeView:Hero 大输入框 + 导入入口 +
 * RecentProjectsStrip(最近 6 个 + View all)。插件/模板区块为排除项。
 */
export default function HomeView({ projects, onOpen, onRename, onDelete, onCreateFromPrompt, onNewProject, onViewAll }: Props) {
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const recent = sortProjects(projects, 'recent').slice(0, 6);

  const submit = async () => {
    const text = prompt.trim();
    if (!text || creating) return;
    setCreating(true);
    try {
      await onCreateFromPrompt(text);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-center text-2xl font-semibold text-zinc-800">今天想做个什么?</h1>
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm focus-within:border-zinc-400">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={3}
            placeholder="描述你想做的网页,比如「做一个咖啡店落地页」…"
            className="w-full resize-none bg-transparent px-1 text-sm outline-none"
          />
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={onNewProject} className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100">
              更多选项 / 导入现有项目
            </button>
            <button
              type="button"
              disabled={!prompt.trim() || creating}
              onClick={() => void submit()}
              className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {creating ? '创建中…' : '开始'}
            </button>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="mt-12">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-700">最近项目</h2>
              <button type="button" onClick={onViewAll} className="text-xs text-zinc-500 hover:text-zinc-800">
                查看全部 →
              </button>
            </div>
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {recent.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/HomeView.tsx
git commit -m "feat(web): Home 视图(Hero 输入/导入入口/最近项目条)"
```

---

### Task 10: EntryNavRail + EntryShell

**Files:**
- Create: `web/src/components/EntryNavRail.tsx`
- Create: `web/src/components/EntryShell.tsx`

- [ ] **Step 1: 实现 EntryNavRail**

```tsx
// web/src/components/EntryNavRail.tsx
import type { EntryHomeView } from '../router';

type Props = {
  open: boolean;
  view: EntryHomeView;
  onClose: () => void;
  onNavigate: (view: EntryHomeView) => void;
  onNewProject: () => void;
  onOpenSettings: () => void;
};

const NAV_ITEMS: Array<{ view: EntryHomeView; label: string; icon: string }> = [
  { view: 'home', label: 'Home', icon: '⌂' },
  { view: 'projects', label: 'Projects', icon: '▦' },
];

/**
 * 入口导航 rail,对齐参照 EntryNavRail.tsx:89-193(manus 式停靠:
 * 打开后点导航不自动收起,仅折叠按钮关闭;状态不持久化)。
 * Tasks/Design Systems/Plugins/Integrations 为排除项,不放。
 */
export default function EntryNavRail({ open, view, onClose, onNavigate, onNewProject, onOpenSettings }: Props) {
  if (!open) return null;
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50" aria-label="主导航">
      <div className="flex items-center gap-2 px-4 py-3.5">
        <button type="button" className="flex items-center gap-2" onClick={() => onNavigate('projects')}>
          <span className="text-lg">π</span>
          <span className="text-sm font-semibold text-zinc-800">Pi Web Studio</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          title="收起导航"
          aria-label="收起导航"
          onClick={onClose}
          className="rounded-md px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          ⟨
        </button>
      </div>
      <div className="px-2">
        <button
          type="button"
          onClick={onNewProject}
          className="w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
        >
          ＋ 新建项目
        </button>
      </div>
      <nav className="mt-2 flex-1 space-y-0.5 px-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              view === item.view ? 'bg-zinc-200/80 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="border-t border-zinc-200 p-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
        >
          ⚙ 设置
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: 实现 EntryShell**

项目列表数据与项目级操作(新建/导入/重命名/删除)从旧 App.tsx 迁来。

```tsx
// web/src/components/EntryShell.tsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { buildCreateRequest } from '../lib/newProject';
import type { CreateProjectRequest } from '../lib/newProject';
import type { EntryHomeView } from '../router';
import { navigate } from '../router';
import type { ProjectMeta } from '../lib/types';
import EntryNavRail from './EntryNavRail';
import HomeView from './HomeView';
import ProjectsView from './ProjectsView';
import NewProjectPanel from './NewProjectPanel';
import SettingsDialog from './settings/SettingsDialog';
import { tabStorageKey } from './Workspace';

type Props = { view: EntryHomeView };

/** 入口壳:导航 rail + Home/Projects 视图,对齐参照 EntryShell。 */
export default function EntryShell({ view }: Props) {
  const [railOpen, setRailOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法连接服务端');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openProject = (id: string) =>
    navigate({ kind: 'project', projectId: id, conversationId: null, fileName: null });

  const createProject = async (input: CreateProjectRequest) => {
    const meta = await api.createProject(input);
    openProject(meta.id);
  };

  const createFromPrompt = async (prompt: string) => {
    await createProject(
      buildCreateRequest({
        name: '',
        prompt,
        model: null,
        platformTargets: ['responsive'],
        fidelity: 'high-fidelity',
        includeLandingPage: false,
        includeOsWidgets: false,
      }),
    );
  };

  const importClaudeDesign = async (file: File) => {
    const { project, entryFile } = await api.importClaudeDesign(file);
    try {
      // 等效参照:导入项目首开即预览入口文件。
      localStorage.setItem(tabStorageKey(project.id), JSON.stringify({ tabs: [entryFile], active: entryFile }));
    } catch {
      // localStorage 不可用时仅失去初始 tab,无碍。
    }
    openProject(project.id);
  };

  const renameProject = async (id: string, name: string) => {
    try {
      await api.updateProject(id, { name });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名失败');
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await api.deleteProject(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="flex h-full bg-white text-zinc-900">
      <EntryNavRail
        open={railOpen}
        view={view}
        onClose={() => setRailOpen(false)}
        onNavigate={(v) => navigate({ kind: 'home', view: v })}
        onNewProject={() => setShowNewProject(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          {!railOpen && (
            <button
              type="button"
              title="展开导航"
              aria-label="展开导航"
              onClick={() => setRailOpen(true)}
              className="rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100"
            >
              ☰
            </button>
          )}
          <span className="text-sm font-semibold text-zinc-800">{view === 'home' ? 'Home' : 'Projects'}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowNewProject(true)}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700"
          >
            ＋ 新建项目
          </button>
        </header>
        {error && <p className="px-6 pt-2 text-xs text-red-500">{error}</p>}
        {view === 'home' ? (
          <HomeView
            projects={projects}
            onOpen={openProject}
            onRename={renameProject}
            onDelete={deleteProject}
            onCreateFromPrompt={createFromPrompt}
            onNewProject={() => setShowNewProject(true)}
            onViewAll={() => navigate({ kind: 'home', view: 'projects' })}
          />
        ) : (
          <ProjectsView
            projects={projects}
            onOpen={openProject}
            onRename={renameProject}
            onDelete={deleteProject}
            onNewProject={() => setShowNewProject(true)}
          />
        )}
      </main>
      {showSettings && <SettingsDialog projectId={null} onClose={() => setShowSettings(false)} />}
      {showNewProject && (
        <NewProjectPanel
          onClose={() => setShowNewProject(false)}
          onCreate={createProject}
          onImportClaudeDesign={importClaudeDesign}
        />
      )}
    </div>
  );
}
```

注意:`SettingsDialog` 的 `projectId` prop 若类型为 `string | null` 以外,按实际签名调整传参。

- [ ] **Step 3: 类型检查 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/EntryNavRail.tsx web/src/components/EntryShell.tsx
git commit -m "feat(web): EntryShell 入口壳与导航 rail"
```

---

### Task 11: ConversationsMenu + api.renameConversation

server 已有 `PATCH /api/projects/:id/conversations/:cid`(index.ts:176),只补 web api 与组件。

**Files:**
- Create: `web/src/components/ConversationsMenu.tsx`
- Modify: `web/src/lib/api.ts`(api 对象加 renameConversation)

- [ ] **Step 1: api 方法**

`web/src/lib/api.ts` 的 `deleteConversation` 之后加:

```ts
  renameConversation: (id: string, cid: string, title: string) =>
    fetch(`/api/projects/${id}/conversations/${cid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
      .then((r) => json<{ conversation: ConversationMeta }>(r))
      .then((b) => b.conversation),
```

- [ ] **Step 2: 实现组件**

```tsx
// web/src/components/ConversationsMenu.tsx
import { useEffect, useRef, useState } from 'react';
import type { ConversationSummary } from '../lib/types';

type Props = {
  conversations: ConversationSummary[];
  activeId: string;
  onSelect: (cid: string) => void;
  onCreate: () => void;
  onRename: (cid: string, title: string) => void;
  onDelete: (cid: string) => void;
};

/**
 * 对话历史菜单,对齐参照 ConversationsMenu.tsx:pill(当前标题+计数)+
 * 下拉(New/列表最近优先/双击重命名/✕删除确认/当前高亮/空状态)。
 */
export default function ConversationsMenu({ conversations, activeId, onSelect, onCreate, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const current = conversations.find((c) => c.id === activeId);

  const commitRename = (cid: string) => {
    setEditingId(null);
    const title = draft.trim();
    if (title) onRename(cid, title);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex max-w-56 items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
          open ? 'border-zinc-400 bg-zinc-100' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
        }`}
      >
        <span className="truncate">{current?.title ?? '对话'}</span>
        <span className="shrink-0 rounded-full bg-zinc-200 px-1.5 text-[10px] text-zinc-600">{conversations.length}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-medium text-zinc-500">对话</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
              className="rounded-md px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100"
            >
              ＋ 新建
            </button>
          </div>
          {sorted.length === 0 && <p className="px-2 py-3 text-center text-xs text-zinc-400">还没有对话</p>}
          {sorted.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                c.id === activeId ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(c.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5"
                />
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => {
                    setOpen(false);
                    if (c.id !== activeId) onSelect(c.id);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setDraft(c.title ?? '');
                    setEditingId(c.id);
                  }}
                >
                  <span className="block truncate">{c.title ?? '未命名对话'}</span>
                  <span className="text-[10px] text-zinc-400">{c.messageCount} 条消息</span>
                </button>
              )}
              <button
                type="button"
                aria-label="删除对话"
                className="rounded px-1 text-zinc-300 opacity-0 hover:bg-zinc-200 hover:text-red-500 group-hover:opacity-100"
                onClick={() => {
                  if (confirm(`删除对话「${c.title ?? '未命名对话'}」？此操作不可恢复。`)) {
                    setOpen(false);
                    onDelete(c.id);
                  }
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 类型检查 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/ConversationsMenu.tsx web/src/lib/api.ts
git commit -m "feat(web): ConversationsMenu 对话历史菜单 + renameConversation API"
```

---

### Task 12: ChatPanel 改造(顶栏重构 + sendRef + onAssistantText)

**Files:**
- Modify: `web/src/components/ChatPanel.tsx`

- [ ] **Step 1: Props 变更**

Props type 增改(`onSelectConversation` 等保留):

```ts
type Props = {
  projectId: string;
  conversationId: string;
  conversations: ConversationSummary[];
  /** 详情页顶部展示的项目名。 */
  projectName: string;
  /** 返回项目列表。 */
  onBack: () => void;
  onSelectConversation: (cid: string) => void;
  onCreateConversation: () => void;
  onRenameConversation: (cid: string, title: string) => void;
  onDeleteConversation: (cid: string) => void;
  onGeneration?: (model: GenerationModel) => void;
  retryRef?: MutableRefObject<(() => void) | null>;
  /** 注册外部发送函数(QuestionsPanel 提交答案用)。 */
  sendRef?: MutableRefObject<((text: string) => void) | null>;
  /** 回合结束/历史加载后,把最后一条助手消息全文回调给上层(派生 question-form)。 */
  onAssistantText?: (text: string) => void;
  pendingPrompt?: string | null;
  onConsumePendingPrompt?: () => void;
};
```

函数签名解构同步加 `projectName, onBack, onRenameConversation, sendRef, onAssistantText`。
顶部 import 加:

```ts
import ConversationsMenu from './ConversationsMenu';
```

- [ ] **Step 2: 删除旧历史菜单状态**

删除 `historyOpen`/`historyMenuRef` 两个声明(原 55-56 行)及"外点关闭历史菜单"的 useEffect(原 223-231 行)。

- [ ] **Step 3: 历史加载回调 onAssistantText**

把历史加载行(原 93 行):

```ts
    api.history(projectId, conversationId).then(setMessages).catch(() => setMessages([]));
```

改为:

```ts
    api.history(projectId, conversationId).then((msgs) => {
      setMessages(msgs);
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant) onAssistantText?.(lastAssistant.content);
    }).catch(() => setMessages([]));
```

并把该 useEffect 的依赖数组改为 `[projectId, conversationId, onGeneration, onAssistantText]`。

- [ ] **Step 4: send finally 回调 onAssistantText**

`send` 的 finally 中,把:

```ts
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          );
```

改为:

```ts
          setMessages((prev) => {
            const next = prev.map((m) => (m.streaming ? { ...m, streaming: false } : m));
            const lastAssistant = [...next].reverse().find((m) => m.role === 'assistant');
            if (lastAssistant) {
              const text = lastAssistant.content;
              queueMicrotask(() => onAssistantText?.(text));
            }
            return next;
          });
```

`send` 的 useCallback 依赖加 `onAssistantText`。

- [ ] **Step 5: 注册 sendRef**

retryRef 注册 effect(原 197-205 行)之后加:

```ts
  useEffect(() => {
    if (!sendRef) return;
    sendRef.current = (text: string) => {
      if (!generationInput.current.busy) void send(text);
    };
    return () => {
      sendRef.current = null;
    };
  }, [sendRef, send]);
```

- [ ] **Step 6: 重写顶栏 JSX**

把 header 块(原 235-296 行,`<div className="flex items-center gap-1 border-b ...">` 整块)替换为:

```tsx
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <button
          type="button"
          title="返回项目列表"
          aria-label="返回项目列表"
          onClick={onBack}
          className="rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          ←
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800" title={projectName}>
          {projectName}
        </span>
        <ConversationsMenu
          conversations={conversations}
          activeId={conversationId}
          onSelect={onSelectConversation}
          onCreate={onCreateConversation}
          onRename={onRenameConversation}
          onDelete={onDeleteConversation}
        />
      </div>
```

- [ ] **Step 7: 类型检查**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
```
预期:**App.tsx 会报错**(缺新 props)——这是预期中间态,App.tsx 在 Task 17 重写。若希望本步全绿,可在 App.tsx 的 ChatPanel 调用处临时补 `projectName={activeMeta?.name ?? ''} onBack={() => {}} onRenameConversation={() => {}}`。

- [ ] **Step 8: web 测试 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/ChatPanel.tsx web/src/App.tsx
git commit -m "refactor(web): ChatPanel 顶栏重构(返回/项目名/ConversationsMenu)+sendRef"
```

---

### Task 13: WorkingDirPill + HandoffButton

**Files:**
- Create: `web/src/components/WorkingDirPill.tsx`
- Create: `web/src/components/HandoffButton.tsx`

- [ ] **Step 1: WorkingDirPill**

spec 修正:无「替换工作目录」,菜单仅「在文件管理器中显示」+ 错误展示。

```tsx
// web/src/components/WorkingDirPill.tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

type Props = { projectId: string; dir: string | null };

/** 工作目录 pill,对齐参照 WorkingDirPill(裁剪 Replace:无外部工作目录概念)。 */
export default function WorkingDirPill({ projectId, dir }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!dir) return null;
  const lastSegment = dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        title={dir}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-48 items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
      >
        <span>📁</span>
        <span className="truncate">{lastSegment}</span>
        <span className="text-zinc-400">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 text-xs shadow-lg">
          <p className="break-all px-2 py-1.5 text-[10px] text-zinc-400">{dir}</p>
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50"
            onClick={async () => {
              setOpen(false);
              try {
                await api.revealProject(projectId);
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : '打开失败');
              }
            }}
          >
            在文件管理器中显示
          </button>
          {error && <p className="px-2 py-1 text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: HandoffButton**

spec 修正:CLI 标签不做参照的框架选择,提供 claude/codex 两条继续开发命令的复制。

```tsx
// web/src/components/HandoffButton.tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { DetectedEditor } from '../lib/types';

type Props = { projectId: string; dir: string | null; editors: DetectedEditor[] };

const PREFERRED_EDITOR_KEY = 'webui:handoff.editor';

function cliCommands(dir: string): Array<{ label: string; command: string }> {
  return [
    { label: 'Claude Code', command: `cd ${dir} && claude "继续开发这个项目"` },
    { label: 'Codex', command: `cd ${dir} && codex "继续开发这个项目"` },
  ];
}

/**
 * Handoff 分体按钮,对齐参照 HandoffButton:左半键用首选编辑器打开项目,
 * 右半键下拉 Editors/CLI 两个标签。
 */
export default function HandoffButton({ projectId, dir, editors }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'editors' | 'cli'>('editors');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const installed = editors.filter((e) => e.installed);
  const [preferredId, setPreferredId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PREFERRED_EDITOR_KEY);
    } catch {
      return null;
    }
  });
  const preferred = installed.find((e) => e.id === preferredId) ?? installed[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openWith = async (editorId: string) => {
    try {
      setPreferredId(editorId);
      try {
        localStorage.setItem(PREFERRED_EDITOR_KEY, editorId);
      } catch {
        // 仅失去记忆
      }
      await api.openInEditor(projectId, editorId);
      setError(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开失败');
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex overflow-hidden rounded-lg border border-zinc-200">
        <button
          type="button"
          disabled={!preferred}
          title={preferred ? `用 ${preferred.name} 打开` : '未检测到已安装编辑器'}
          onClick={() => preferred && void openWith(preferred.id)}
          className="px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
        >
          {preferred ? `用 ${preferred.name} 打开` : 'Handoff'}
        </button>
        <button
          type="button"
          aria-label="Handoff 选项"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="border-l border-zinc-200 px-1.5 text-xs text-zinc-500 hover:bg-zinc-50"
        >
          ▾
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-2 text-xs shadow-lg">
          <div className="mb-2 flex rounded-lg bg-zinc-100 p-0.5">
            {(
              [
                ['editors', '编辑器'],
                ['cli', 'CLI'],
              ] as Array<['editors' | 'cli', string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 rounded-md px-2 py-1 ${tab === key ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'editors' ? (
            <div className="space-y-0.5">
              {editors.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  disabled={!e.installed}
                  onClick={() => void openWith(e.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-zinc-50 disabled:cursor-default disabled:text-zinc-300 disabled:hover:bg-transparent"
                >
                  <span>{e.name}</span>
                  {!e.installed && <span className="text-[10px]">未安装</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {dir ? (
                cliCommands(dir).map((c) => (
                  <div key={c.label} className="rounded-md border border-zinc-100 p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-600">{c.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(c.command).then(() => {
                            setCopied(c.label);
                            setTimeout(() => setCopied(null), 1500);
                          });
                        }}
                        className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100"
                      >
                        {copied === c.label ? '已复制' : '复制'}
                      </button>
                    </div>
                    <code className="mt-1 block break-all text-[10px] text-zinc-400">{c.command}</code>
                  </div>
                ))
              ) : (
                <p className="px-2 py-1 text-zinc-400">目录信息不可用</p>
              )}
            </div>
          )}
          {error && <p className="mt-1 px-2 text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 类型检查 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/WorkingDirPill.tsx web/src/components/HandoffButton.tsx
git commit -m "feat(web): WorkingDirPill 与 HandoffButton 顶栏组件"
```

---

### Task 14: QuestionsPanel 组件

**Files:**
- Create: `web/src/components/QuestionsPanel.tsx`

- [ ] **Step 1: 实现组件**

```tsx
// web/src/components/QuestionsPanel.tsx
import { useState } from 'react';
import type { FormQuestion, QuestionForm } from '../lib/questionForm';

type Props = {
  form: QuestionForm;
  /** 把答案组合为一条消息发送到对话。 */
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

type Answers = Record<string, string | string[]>;

function answerText(q: FormQuestion, value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  const text = Array.isArray(value) ? value.join('、') : value;
  if (!text.trim()) return null;
  return `**${q.label}**:${text}`;
}

/** Questions 面板,对齐参照 QuestionsPanel(题型裁剪到 5 种基础类型)。 */
export default function QuestionsPanel({ form, onSubmit, disabled }: Props) {
  const [answers, setAnswers] = useState<Answers>({});

  const set = (id: string, value: string | string[]) => setAnswers((prev) => ({ ...prev, [id]: value }));

  const missingRequired = form.questions.some(
    (q) => q.required && !answerText(q, answers[q.id]),
  );

  const submit = () => {
    const lines = form.questions
      .map((q) => answerText(q, answers[q.id]))
      .filter((l): l is string => l !== null);
    if (lines.length === 0) return;
    onSubmit(lines.join('\n'));
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <h2 className="text-sm font-semibold text-zinc-800">{form.title ?? '请确认几个问题'}</h2>
      <div className="mt-4 space-y-5">
        {form.questions.map((q) => (
          <fieldset key={q.id}>
            <legend className="text-xs font-medium text-zinc-700">
              {q.label}
              {q.required && <span className="ml-0.5 text-red-500">*</span>}
            </legend>
            {q.help && <p className="mt-0.5 text-[10px] text-zinc-400">{q.help}</p>}
            <div className="mt-1.5">
              {(q.type === 'radio' || q.type === 'checkbox') && (
                <div className="flex flex-wrap gap-1.5">
                  {(q.options ?? []).map((o) => {
                    const cur = answers[q.id];
                    const checked =
                      q.type === 'radio' ? cur === o.value : Array.isArray(cur) && cur.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        title={o.description}
                        onClick={() => {
                          if (q.type === 'radio') set(q.id, o.value);
                          else {
                            const list = Array.isArray(cur) ? cur : [];
                            set(q.id, checked ? list.filter((v) => v !== o.value) : [...list, o.value]);
                          }
                        }}
                        className={`rounded-full border px-3 py-1 text-xs ${
                          checked ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {q.type === 'select' && (
                <select
                  value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                  onChange={(e) => set(q.id, e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
                >
                  <option value="">请选择…</option>
                  {(q.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {q.type === 'text' && (
                <input
                  value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                  onChange={(e) => set(q.id, e.target.value)}
                  placeholder={q.placeholder}
                  className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400"
                />
              )}
              {q.type === 'textarea' && (
                <textarea
                  value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                  onChange={(e) => set(q.id, e.target.value)}
                  placeholder={q.placeholder}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400"
                />
              )}
            </div>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || missingRequired}
        onClick={submit}
        className="mt-6 rounded-lg bg-zinc-900 px-4 py-1.5 text-xs text-white disabled:opacity-40"
      >
        提交回答
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/QuestionsPanel.tsx
git commit -m "feat(web): QuestionsPanel 表单面板(5 种基础题型)"
```

---

### Task 15: Workspace 改造(顶栏/focus 切换/路由文件同步/Questions 标签)

**Files:**
- Modify: `web/src/components/Workspace.tsx`

- [ ] **Step 1: Props 与 import 变更**

import 区加:

```ts
import type { HandoffInfo } from '../lib/types';
import type { QuestionForm } from '../lib/questionForm';
import HandoffButton from './HandoffButton';
import QuestionsPanel from './QuestionsPanel';
import WorkingDirPill from './WorkingDirPill';
```

Props type 改为:

```ts
type Props = {
  projectId: string;
  generation: GenerationModel;
  onRetry?: () => void;
  meta?: ProjectMeta;
  onMetaUpdated?: (meta: ProjectMeta) => void;
  /** focus 模式(隐藏聊天面板,工作区全宽)。 */
  focusMode: boolean;
  onFocusModeChange: (next: boolean) => void;
  /** 拖拽分栏进行中:禁用 iframe 指针事件防止吞掉 pointermove。 */
  interactionDisabled?: boolean;
  /** URL 深链的目标文件;变化时打开对应标签。 */
  routeFileName: string | null;
  /** 活动预览文件变化 → 上层同步进 URL。 */
  onActiveFileChange?: (file: string | null) => void;
  /** 最后一条助手消息派生的问题表单;非空时显示 Questions 标签。 */
  questionForm?: QuestionForm | null;
  /** Questions 提交 → 发送到对话。 */
  onSubmitQuestions?: (text: string) => void;
};
```

函数签名解构同步:`focusMode, onFocusModeChange, interactionDisabled, routeFileName, onActiveFileChange, questionForm, onSubmitQuestions`。

- [ ] **Step 2: handoff 信息获取 + Questions/路由同步状态**

组件内 `const [showSettings...]` 之后加:

```ts
  const [showQuestions, setShowQuestions] = useState(false);
  const [handoff, setHandoff] = useState<HandoffInfo | null>(null);

  useEffect(() => {
    api.handoffInfo(projectId).then(setHandoff).catch(() => setHandoff(null));
  }, [projectId]);

  // URL → 标签:深链/前进后退把目标文件打开为活动标签。
  useEffect(() => {
    if (routeFileName) openTab(routeFileName);
  }, [routeFileName, openTab]);

  // 标签 → URL:活动文件变化回调上层(上层负责 navigate replace)。
  useEffect(() => {
    onActiveFileChange?.(showFiles || showQuestions ? null : active);
  }, [active, showFiles, showQuestions, onActiveFileChange]);

  // 新表单出现自动切到 Questions 标签(对齐参照行为)。
  useEffect(() => {
    if (questionForm) setShowQuestions(true);
    else setShowQuestions(false);
  }, [questionForm]);
```

注意:`useEffect(... openTab)` 必须放在 `openTab` 的 useCallback 定义之后。`openTab` 内已有 `setShowFiles(false)`,再补一行 `setShowQuestions(false)`(打开文件时离开 Questions 视图);同样在 tab 点击的 onClick 里把 `setShowFiles(false)` 后追加 `setShowQuestions(false)`。

- [ ] **Step 3: 外层宽度类与顶栏行**

最外层 div 从:

```tsx
    <div className="flex h-full w-[46%] min-w-[420px] flex-col border-l border-zinc-200">
```

改为(宽度交给父级 flex 控制):

```tsx
    <div className="flex h-full min-w-0 flex-1 flex-col border-l border-zinc-200">
```

在 tab strip(`<div className="flex items-center gap-0.5 border-b ...">`)**之前**插入顶栏行:

```tsx
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-2 py-1.5">
        <button
          type="button"
          title={focusMode ? '显示聊天' : '隐藏聊天'}
          aria-label={focusMode ? '显示聊天' : '隐藏聊天'}
          aria-pressed={focusMode}
          onClick={() => onFocusModeChange(!focusMode)}
          className="rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        >
          {focusMode ? '⟩' : '⟨'}
        </button>
        <WorkingDirPill projectId={projectId} dir={handoff?.dir ?? null} />
        <div className="flex-1" />
        <HandoffButton projectId={projectId} dir={handoff?.dir ?? null} editors={handoff?.editors ?? []} />
      </div>
```

(参照中退出按钮是 chevron-right「显示聊天」,FileWorkspace.tsx:1794-1807;进入按钮为参照缺失触发器的有意补全。)

- [ ] **Step 4: Questions 标签按钮**

tab strip 中「文件」按钮之前加:

```tsx
        {questionForm && (
          <button
            type="button"
            onClick={() => {
              setShowQuestions(true);
              setShowFiles(false);
            }}
            className={`mb-1 shrink-0 rounded-md px-2 py-1 text-xs ${
              showQuestions ? 'bg-zinc-900 text-white' : 'text-amber-600 hover:bg-zinc-100'
            }`}
          >
            问题
          </button>
        )}
```

「文件」按钮 onClick 改为 `() => { setShowFiles((v) => !v); setShowQuestions(false); }`。

- [ ] **Step 5: 主体区渲染分支 + 拖拽禁用**

主体容器:

```tsx
      <div className="relative min-h-0 flex-1 bg-white">
```

改为:

```tsx
      <div className={`relative min-h-0 flex-1 bg-white ${interactionDisabled ? 'pointer-events-none select-none' : ''}`}>
```

渲染分支把原 `{showFiles ? ... : active ? ... : ...}` 改为:

```tsx
        {showQuestions && questionForm ? (
          <QuestionsPanel form={questionForm} onSubmit={(text) => onSubmitQuestions?.(text)} />
        ) : showFiles ? (
          <FilesPanel
            projectId={projectId}
            files={files}
            artifacts={artifacts}
            onOpenFile={openTab}
            onChanged={() => void refresh()}
          />
        ) : active ? (
```

(后续 FileViewer / 空状态分支不变。)

- [ ] **Step 6: 类型检查**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b
```
预期:App.tsx 报缺新必填 props(focusMode 等)——同 Task 12,可在 App.tsx 调用处临时补 `focusMode={false} onFocusModeChange={() => {}} routeFileName={null}` 保持绿色。

- [ ] **Step 7: web 测试 + Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx vitest run
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/Workspace.tsx web/src/App.tsx
git commit -m "feat(web): Workspace 顶栏/focus 切换/路由文件同步/Questions 标签"
```

---

### Task 16: ProjectView 组件(split + 拖拽 + focus + URL 同步)

**Files:**
- Create: `web/src/components/ProjectView.tsx`

- [ ] **Step 1: 实现组件**

```tsx
// web/src/components/ProjectView.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../lib/api';
import {
  CHAT_PANEL_KEYBOARD_STEP,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  clampChatPanelWidth,
  readSavedChatPanelWidth,
  saveChatPanelWidth,
} from '../lib/chatPanelWidth';
import { deriveGenerationModel, type GenerationModel } from '../lib/generation';
import { extractQuestionForm, type QuestionForm } from '../lib/questionForm';
import { navigate } from '../router';
import type { ConversationSummary, ProjectMeta } from '../lib/types';
import ChatPanel from './ChatPanel';
import { Workspace } from './Workspace';

type Props = {
  projectId: string;
  routeConversationId: string | null;
  routeFileName: string | null;
};

const IDLE_GENERATION = deriveGenerationModel({
  busy: false,
  aborted: false,
  error: null,
  sawDelta: false,
  lastActivity: null,
  lastWrite: null,
  turnEnded: false,
});

/**
 * 项目详情页,对齐参照 ProjectView.tsx:5232-5557 的 split 布局:
 * ChatPanel(可拖拽 345-720px)| 8px 手柄 | Workspace。
 * focus 模式隐藏聊天与手柄(不持久化,同参照 useState(false))。
 */
export default function ProjectView({ projectId, routeConversationId, routeFileName }: Props) {
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [generation, setGeneration] = useState<GenerationModel>(IDLE_GENERATION);
  const [questionForm, setQuestionForm] = useState<QuestionForm | null>(null);
  const [workspaceFocused, setWorkspaceFocused] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  const sendRef = useRef<((text: string) => void) | null>(null);

  // ---- 拖拽分栏(对齐参照 ProjectView.tsx:4843-4937) ----
  const [chatWidth, setChatWidth] = useState<number>(() => readSavedChatPanelWidth());
  const [resizing, setResizing] = useState(false);
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;

  // ---- URL 同步辅助 refs(避免 effect 闭包过期/循环导航) ----
  const activeFileRef = useRef<string | null>(routeFileName);
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  // 项目元数据;不存在则回项目列表。
  useEffect(() => {
    let cancelled = false;
    api
      .listProjects()
      .then((list) => {
        if (cancelled) return;
        const found = list.find((p) => p.id === projectId);
        if (!found) {
          navigate({ kind: 'home', view: 'projects' }, { replace: true });
          return;
        }
        setMeta(found);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '无法连接服务端');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const loadConversations = useCallback(
    async (preferredId?: string | null) => {
      const list = await api.conversations(projectId);
      setConversations(list);
      setActiveConversationId((current) => {
        const wanted = preferredId ?? current;
        if (wanted && list.some((c) => c.id === wanted)) return wanted;
        return list[0]?.id ?? null;
      });
      return list;
    },
    [projectId],
  );

  // 首载:优先路由里的会话 id。
  useEffect(() => {
    void loadConversations(routeConversationId).catch(() => {});
    // 仅首载,路由 cid 后续变化由下一个 effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversations]);

  // 前进后退把 URL 的会话 id 带回来 → 切换活动会话。
  useEffect(() => {
    if (
      routeConversationId &&
      routeConversationId !== activeConversationIdRef.current &&
      conversations.some((c) => c.id === routeConversationId)
    ) {
      setActiveConversationId(routeConversationId);
    }
  }, [routeConversationId, conversations]);

  // 活动会话变化 → 同步 URL(replace,同参照 ProjectView.tsx:4293-4301)。
  useEffect(() => {
    if (!activeConversationId) return;
    navigate(
      { kind: 'project', projectId, conversationId: activeConversationId, fileName: activeFileRef.current },
      { replace: true },
    );
  }, [activeConversationId, projectId]);

  const handleActiveFileChange = useCallback(
    (file: string | null) => {
      if (file === activeFileRef.current) return;
      activeFileRef.current = file;
      navigate(
        { kind: 'project', projectId, conversationId: activeConversationIdRef.current, fileName: file },
        { replace: true },
      );
    },
    [projectId],
  );

  const createConversation = useCallback(async () => {
    const conv = await api.createConversation(projectId);
    setQuestionForm(null);
    await loadConversations(conv.id);
  }, [projectId, loadConversations]);

  const renameConversation = useCallback(
    async (cid: string, title: string) => {
      await api.renameConversation(projectId, cid, title);
      await loadConversations();
    },
    [projectId, loadConversations],
  );

  const deleteConversation = useCallback(
    async (cid: string) => {
      await api.deleteConversation(projectId, cid);
      const list = await api.conversations(projectId);
      if (list.length === 0) {
        const conv = await api.createConversation(projectId);
        await loadConversations(conv.id);
        return;
      }
      setConversations(list);
      setActiveConversationId((current) => (current === cid ? list[0].id : current));
    },
    [projectId, loadConversations],
  );

  const consumePendingPrompt = useCallback(async () => {
    setMeta((m) => (m ? { ...m, pendingPrompt: null } : m));
    try {
      await api.updateProject(projectId, { pendingPrompt: null });
    } catch {
      // 忽略:下次进入最多再预填一次,无害。
    }
  }, [projectId]);

  const handleAssistantText = useCallback((text: string) => {
    setQuestionForm(extractQuestionForm(text));
  }, []);

  // ---- 拖拽手柄事件 ----
  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = chatWidthRef.current;
    setResizing(true);

    let frame: number | null = null;
    let pendingX: number | null = null;

    const apply = (clientX: number) => {
      setChatWidth(clampChatPanelWidth(startWidth + clientX - startX));
    };
    const flush = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (pendingX !== null) {
        apply(pendingX);
        pendingX = null;
      }
    };
    const onMove = (ev: PointerEvent) => {
      pendingX = ev.clientX;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (pendingX !== null) {
          apply(pendingX);
          pendingX = null;
        }
      });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      setResizing(false);
    };
    const onUp = () => {
      flush();
      saveChatPanelWidth(chatWidthRef.current);
      cleanup();
    };
    const onCancel = () => {
      // 中断回滚到拖拽前宽度,不持久化(同参照 pointercancel/blur 行为)。
      if (frame !== null) cancelAnimationFrame(frame);
      setChatWidth(startWidth);
      cleanup();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
  }, []);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = chatWidthRef.current - CHAT_PANEL_KEYBOARD_STEP;
    else if (event.key === 'ArrowRight') next = chatWidthRef.current + CHAT_PANEL_KEYBOARD_STEP;
    else if (event.key === 'Home') next = MIN_CHAT_PANEL_WIDTH;
    else if (event.key === 'End') next = MAX_CHAT_PANEL_WIDTH;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampChatPanelWidth(next);
    setChatWidth(clamped);
    saveChatPanelWidth(clamped);
  }, []);

  const onBack = useCallback(() => navigate({ kind: 'home', view: 'projects' }), []);

  const workspaceProps = useMemo(
    () => ({
      focusMode: workspaceFocused,
      onFocusModeChange: setWorkspaceFocused,
      interactionDisabled: resizing,
      routeFileName,
      onActiveFileChange: handleActiveFileChange,
      questionForm,
      onSubmitQuestions: (text: string) => sendRef.current?.(text),
    }),
    [workspaceFocused, resizing, routeFileName, handleActiveFileChange, questionForm],
  );

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-zinc-400">
        <p className="text-sm text-red-500">{error}</p>
        <button type="button" onClick={onBack} className="mt-3 rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100">
          ← 返回项目列表
        </button>
      </div>
    );
  }

  return (
    <div className={`flex h-full bg-white text-zinc-900 ${resizing ? 'cursor-col-resize select-none' : ''}`}>
      {!workspaceFocused && (
        <div style={{ width: chatWidth }} className="flex h-full shrink-0 flex-col">
          {activeConversationId ? (
            <ChatPanel
              key={`${projectId}:${activeConversationId}`}
              projectId={projectId}
              conversationId={activeConversationId}
              conversations={conversations}
              projectName={meta?.name ?? ''}
              onBack={onBack}
              onSelectConversation={setActiveConversationId}
              onCreateConversation={() => void createConversation()}
              onRenameConversation={(cid, title) => void renameConversation(cid, title)}
              onDeleteConversation={(cid) => void deleteConversation(cid)}
              onGeneration={setGeneration}
              retryRef={retryRef}
              sendRef={sendRef}
              onAssistantText={handleAssistantText}
              pendingPrompt={meta?.pendingPrompt ?? null}
              onConsumePendingPrompt={consumePendingPrompt}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">加载对话…</div>
          )}
        </div>
      )}
      {!workspaceFocused && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整聊天面板宽度"
          aria-valuemin={MIN_CHAT_PANEL_WIDTH}
          aria-valuemax={MAX_CHAT_PANEL_WIDTH}
          aria-valuenow={chatWidth}
          tabIndex={0}
          title="拖拽调整聊天面板宽度(←/→ 微调,Home/End 到极值)"
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
          className={`h-full w-2 shrink-0 cursor-col-resize outline-none transition-colors focus-visible:bg-zinc-300 ${
            resizing ? 'bg-zinc-300' : 'bg-transparent hover:bg-zinc-200'
          }`}
        />
      )}
      <Workspace
        key={`workspace-${projectId}`}
        projectId={projectId}
        generation={generation}
        onRetry={() => retryRef.current?.()}
        meta={meta ?? undefined}
        onMetaUpdated={(m) => setMeta(m)}
        {...workspaceProps}
      />
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + 全量 web 测试**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b && npx vitest run
```
预期:全绿(App.tsx 若仍有临时补丁,保持编译通过即可)。

- [ ] **Step 3: Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add web/src/components/ProjectView.tsx
git commit -m "feat(web): ProjectView 详情页(拖拽分栏/focus 模式/URL 同步)"
```

---

### Task 17: App.tsx 路由分发壳 + 退役 Sidebar + 全量验证

**Files:**
- Modify: `web/src/App.tsx`(整体重写)
- Delete: `web/src/components/Sidebar.tsx`

- [ ] **Step 1: 重写 App.tsx**

```tsx
// web/src/App.tsx
import { useCallback, useEffect, useState } from 'react';
import { piApi } from './lib/api';
import { navigate, useRoute } from './router';
import EntryShell from './components/EntryShell';
import ProjectView from './components/ProjectView';
import InstallGuide from './components/InstallGuide';

/** 路由分发壳:home → EntryShell,project → ProjectView。 */
export default function App() {
  const route = useRoute();
  const [piInstalled, setPiInstalled] = useState<boolean | null>(null);

  const checkPi = useCallback(async (): Promise<boolean> => {
    try {
      const status = await piApi.status();
      setPiInstalled(status.installed);
      return status.installed;
    } catch {
      setPiInstalled(true); // server 不可达时不阻塞主界面,由各视图错误流程提示
      return true;
    }
  }, []);

  useEffect(() => {
    void checkPi();
  }, [checkPi]);

  // `/` 规范化为 `/projects`(默认落项目列表)。
  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      navigate({ kind: 'home', view: 'projects' }, { replace: true });
    }
  }, []);

  if (piInstalled === false) return <InstallGuide onRecheck={checkPi} />;

  if (route.kind === 'project') {
    return (
      <ProjectView
        key={route.projectId}
        projectId={route.projectId}
        routeConversationId={route.conversationId ?? null}
        routeFileName={route.fileName}
      />
    );
  }
  return <EntryShell view={route.view} />;
}
```

- [ ] **Step 2: 删除 Sidebar**

```bash
rm /Users/yoqu/Documents/code/self/agent-webui-master/web/src/components/Sidebar.tsx
grep -rn "Sidebar" /Users/yoqu/Documents/code/self/agent-webui-master/web/src
```
预期:grep 无任何引用残留。

- [ ] **Step 3: 类型 + 全量测试 + 构建**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master/web && npx tsc -b && npx vitest run && npx vite build
cd /Users/yoqu/Documents/code/self/agent-webui-master/server && npx tsc --noEmit && npx vitest run
```
预期:全部通过、构建成功。

- [ ] **Step 4: 手动冒烟验证**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master && pnpm dev
```
(若根 package.json 无 dev 脚本,分别起 `pnpm -C server dev` 与 `pnpm -C web dev`。)

浏览器 `http://localhost:5173` 逐项核对:

1. 打开 `/` → URL 变为 `/projects`,显示项目卡片网格(或空态+新建按钮)。
2. ☰ 展开导航 rail → 点 Home → `/home`,Hero 输入框 + 最近项目条;浏览器后退回 `/projects`。
3. Hero 输入「做一个测试页」回车 → 进入 `/projects/:id`,composer 预填该提示且不自动发送。
4. 详情页:左侧无项目列表;顶部 ← 返回 `/projects`。
5. 拖拽 8px 手柄:宽度在 345-720 内变化;刷新后保持;手柄聚焦后 ←/→/Home/End 可调。
6. 工作区顶栏 ⟨ 隐藏聊天 → 预览全宽,URL 不变;⟩ 恢复。
7. ConversationsMenu:新建/切换会话 → URL 中 conversationId 变化;双击重命名、✕ 删除生效;刷新后停在同一会话。
8. 打开文件标签 → URL 出现 `/files/...`;复制 URL 新标签页打开 → 恢复同一文件。
9. WorkingDirPill 菜单「在文件管理器中显示」→ Finder 打开项目目录;HandoffButton 列出已安装编辑器,CLI 标签可复制命令。
10. 项目卡片:hover ⋯ 菜单重命名/删除;双击名称重命名;搜索过滤;「选择」批量删除。

- [ ] **Step 5: Commit**

```bash
cd /Users/yoqu/Documents/code/self/agent-webui-master
git add -A
git commit -m "feat(web): App 路由分发壳,退役 Sidebar,完成布局导航对齐"
```

---

## Self-Review 结论(已检查)

- **Spec 覆盖**:路由(T1/T17)、EntryShell/rail/Home/Projects/卡片(T7-T10)、详情页 split/拖拽/focus(T15/T16)、ConversationsMenu(T11/T12)、顶栏 WorkingDirPill/Handoff(T3/T13/T15)、Questions(T6/T14/T15)、server running/handoff(T2/T3)、错误处理与测试(各任务内)。spec 中「在 Finder 中显示/替换工作目录」已按修正记录裁剪为仅显示。
- **类型一致性**:`HandoffInfo`/`DetectedEditor`(T3 定义,T13/T15 消费)、`QuestionForm`(T6 定义,T14/T15/T16 消费)、`ProjectsSubTab`('recent'|'created',T4/T8)、ChatPanel 新 props(T12 定义,T16 传入)、Workspace 新 props(T15 定义,T16 传入)已逐一核对。
- **无占位符**:全部步骤含完整代码/命令/预期输出。
