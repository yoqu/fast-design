# P1：数据模型 + 新建项目面板 + pendingPrompt 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `docs/superpowers/specs/2026-06-10-ui-creation-alignment-design.md` 的 §1（数据模型扩展）、§2（新建项目面板）、§6（pendingPrompt 语义），对齐 open-design 的创建链路规则。

**Architecture:** server 侧扩展 `ProjectMeta`（skillId / pendingPrompt / updatedAt / metadata）与 POST/PATCH 路由（净化器纯函数 + 薄路由）；web 侧新增 `NewProjectPanel` 模态面板替换 Sidebar 行内创建，新增 `lib/newProject.ts` 纯函数（autoName / 默认值 / 请求构造），pendingPrompt 走「预填 composer 一次性消费」。

**Tech Stack:** Express + tsx（server）、React 18 + Vite + Tailwind v4（web）、vitest（双包）。pnpm workspace；包名 `server` / `web`。

**注意：本项目当前不是 git 仓库，所有「提交」步骤省略，以测试通过为每个任务的完成判据。**

**约定：**
- 测试命令：`pnpm --filter server test`、`pnpm --filter web test`；全量门槛 `pnpm test && pnpm build`（在仓库根 `/Users/yoqu/Documents/code/self/agent-webui-master` 执行）。
- server 测试直接读写真实 `data/projects`，afterAll 清理（沿用 `files.test.ts` 模式）。
- 所有新增 UI 文案用中文，与现有组件一致。

---

### Task 1: server 数据模型扩展（types + projects.ts）

**Files:**
- Modify: `server/src/types.ts`（ProjectMeta 扩展 + 新类型）
- Modify: `server/src/projects.ts`（createProject / updateProject / touchProject / listProjects 排序）
- Test: `server/src/projects.test.ts`（追加 describe 块）

- [x] **Step 1: 写失败测试**

在 `server/src/projects.test.ts` 现有文件**末尾追加**（保留现有内容；若该文件没有 `getProject`/`updateProject`/`listProjects` 的 import 则补上）：

```ts
import { createProject, deleteProject, getProject, listProjects, touchProject, updateProject } from './projects.js';

describe('createProject extras', () => {
  it('persists skillId, pendingPrompt, metadata and updatedAt', () => {
    const meta = createProject('p1-extras', null, {
      skillId: 'frontend-design',
      pendingPrompt: 'make a coffee landing page',
      metadata: {
        kind: 'prototype',
        platformTargets: ['responsive', 'mobile-ios'],
        fidelity: 'wireframe',
        includeLandingPage: true,
        includeOsWidgets: false,
        nameSource: 'generated',
      },
    });
    created.push(meta.id);
    const loaded = getProject(meta.id)!;
    expect(loaded.skillId).toBe('frontend-design');
    expect(loaded.pendingPrompt).toBe('make a coffee landing page');
    expect(loaded.updatedAt).toBe(loaded.createdAt);
    expect(loaded.metadata).toEqual({
      kind: 'prototype',
      platformTargets: ['responsive', 'mobile-ios'],
      fidelity: 'wireframe',
      includeLandingPage: true,
      includeOsWidgets: false,
      nameSource: 'generated',
    });
  });

  it('defaults metadata to { kind: prototype } when omitted (legacy callers)', () => {
    const meta = createProject('p1-legacy');
    created.push(meta.id);
    expect(meta.metadata).toEqual({ kind: 'prototype' });
    expect(meta.skillId).toBeNull();
    expect(meta.pendingPrompt).toBeNull();
  });
});

describe('updateProject extras', () => {
  it('updates name/skillId, clears pendingPrompt with null, bumps updatedAt', async () => {
    const meta = createProject('p1-update', null, { pendingPrompt: 'seed' });
    created.push(meta.id);
    await new Promise((r) => setTimeout(r, 5));
    const next = updateProject(meta.id, { name: 'renamed', skillId: 'frontend-design', pendingPrompt: null })!;
    expect(next.name).toBe('renamed');
    expect(next.skillId).toBe('frontend-design');
    expect(next.pendingPrompt).toBeNull();
    expect(next.updatedAt!).toBeGreaterThan(meta.createdAt);
  });

  it('ignores undefined fields and empty name', () => {
    const meta = createProject('p1-noop', null, { pendingPrompt: 'keep' });
    created.push(meta.id);
    const next = updateProject(meta.id, { name: '   ' })!;
    expect(next.name).toBe('p1-noop');
    expect(next.pendingPrompt).toBe('keep');
  });
});

describe('touchProject + list ordering', () => {
  it('touch bumps updatedAt and listProjects sorts by updatedAt desc', async () => {
    const a = createProject('p1-order-a');
    const b = createProject('p1-order-b');
    created.push(a.id, b.id);
    await new Promise((r) => setTimeout(r, 5));
    touchProject(a.id);
    const list = listProjects();
    const ia = list.findIndex((p) => p.id === a.id);
    const ib = list.findIndex((p) => p.id === b.id);
    expect(ia).toBeLessThan(ib);
  });
});
```

注意：`created` 数组与 `afterAll` 清理在该测试文件中已存在，直接复用；若 import 行已有部分符号，合并即可。

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter server test -- projects`
Expected: FAIL —— `touchProject` 不存在 / metadata 断言失败。

- [x] **Step 3: 实现**

`server/src/types.ts` 中 `ProjectMeta` 之前插入，并替换 `ProjectMeta`：

```ts
export type ProjectPlatform =
  | 'responsive'
  | 'web-desktop'
  | 'mobile-ios'
  | 'mobile-android'
  | 'tablet'
  | 'desktop-app';

export type ProjectFidelity = 'wireframe' | 'high-fidelity';

/** 对齐 open-design ProjectMetadata（裁剪到 prototype 链路）。 */
export type ProjectMetadata = {
  kind: 'prototype';
  platformTargets?: ProjectPlatform[];
  fidelity?: ProjectFidelity;
  includeLandingPage?: boolean;
  includeOsWidgets?: boolean;
  nameSource?: 'user' | 'generated';
  importedFrom?: 'claude-design' | 'folder' | null;
  entryFile?: string | null;
  sourceFileName?: string | null;
  baseDir?: string | null;
};

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  model?: string | null;
  thinking?: string | null;
  instructions?: string | null;
  skillId?: string | null;
  pendingPrompt?: string | null;
  metadata?: ProjectMetadata;
};
```

`server/src/projects.ts`：

```ts
// import 区追加：
import type { ChatMessage, ProjectMeta, ProjectMetadata } from './types.js';

// createProject 替换为：
export type CreateProjectExtra = {
  skillId?: string | null;
  pendingPrompt?: string | null;
  metadata?: ProjectMetadata;
};

export function createProject(
  name: string,
  model: string | null = null,
  extra: CreateProjectExtra = {},
): ProjectMeta {
  const id = crypto.randomBytes(6).toString('hex');
  const now = Date.now();
  const meta: ProjectMeta = {
    id,
    name: name.trim() || '未命名项目',
    createdAt: now,
    updatedAt: now,
    model,
    skillId: extra.skillId ?? null,
    pendingPrompt: extra.pendingPrompt ?? null,
    metadata: extra.metadata ?? { kind: 'prototype' },
  };
  fs.mkdirSync(path.join(projectDir(id), '.webui'), { recursive: true });
  fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
  fs.writeFileSync(historyPath(id), '[]');
  return meta;
}

// ProjectMetaPatch / updateProject 替换为：
export type ProjectMetaPatch = {
  name?: string;
  model?: string | null;
  thinking?: string | null;
  instructions?: string | null;
  skillId?: string | null;
  pendingPrompt?: string | null;
};

/** 部分更新项目 meta；undefined 字段不动，null 表示清除；name 仅接受非空字符串。 */
export function updateProject(id: string, patch: ProjectMetaPatch): ProjectMeta | null {
  const meta = getProject(id);
  if (!meta) return null;
  const next: ProjectMeta = { ...meta };
  for (const key of ['model', 'thinking', 'instructions', 'skillId', 'pendingPrompt'] as const) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
  next.updatedAt = Date.now();
  fs.writeFileSync(metaPath(id), JSON.stringify(next, null, 2));
  return next;
}

// 新增（updateProject 之后）：
/** 仅刷新 updatedAt（聊天回合落盘 / 文件变更时调用）。项目不存在时静默忽略。 */
export function touchProject(id: string): void {
  const meta = getProject(id);
  if (!meta) return;
  meta.updatedAt = Date.now();
  fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
}

// listProjects 的 sort 行替换为：
  return projects.sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
  );

// appendHistory 末尾追加一行（写完 history 后）：
export function appendHistory(id: string, message: ChatMessage): void {
  const history = readHistory(id);
  history.push(message);
  fs.writeFileSync(historyPath(id), JSON.stringify(history, null, 2));
  touchProject(id);
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter server test`
Expected: 全部 PASS（包括既有用例——`createProject('x')` 旧签名仍兼容）。

---

### Task 2: 创建请求净化器 + POST/PATCH 路由扩展

**Files:**
- Create: `server/src/project-create.ts`
- Create: `server/src/project-create.test.ts`
- Modify: `server/src/index.ts`（POST/PATCH `/api/projects` 路由；文件 CRUD 路由接 touch）

- [x] **Step 1: 写失败测试**

`server/src/project-create.test.ts`（新文件）：

```ts
import { describe, expect, it } from 'vitest';
import { parseCreateProjectBody } from './project-create.js';

describe('parseCreateProjectBody', () => {
  it('parses a full valid body', () => {
    const input = parseCreateProjectBody({
      name: '  My App  ',
      model: 'anthropic/claude',
      skillId: 'frontend-design',
      pendingPrompt: '  build a dashboard ',
      metadata: {
        kind: 'prototype',
        platformTargets: ['mobile-ios', 'tablet'],
        fidelity: 'wireframe',
        includeLandingPage: true,
        includeOsWidgets: true,
        nameSource: 'user',
      },
    });
    expect(input).toEqual({
      name: 'My App',
      model: 'anthropic/claude',
      skillId: 'frontend-design',
      pendingPrompt: 'build a dashboard',
      metadata: {
        kind: 'prototype',
        platformTargets: ['mobile-ios', 'tablet'],
        fidelity: 'wireframe',
        includeLandingPage: true,
        includeOsWidgets: true,
        nameSource: 'user',
      },
    });
  });

  it('falls back to defaults on missing/invalid values', () => {
    const input = parseCreateProjectBody({
      name: 42,
      metadata: {
        kind: 'deck',
        platformTargets: ['responsive', 'nonsense', 'mobile-ios', 'mobile-ios'],
        fidelity: 'ultra',
        includeLandingPage: 'yes',
        nameSource: 'agent',
      },
    });
    expect(input).toEqual({
      name: '',
      model: null,
      skillId: null,
      pendingPrompt: null,
      metadata: {
        kind: 'prototype',
        platformTargets: ['responsive', 'mobile-ios'],
        fidelity: 'high-fidelity',
        includeLandingPage: false,
        includeOsWidgets: false,
        nameSource: 'user',
      },
    });
  });

  it('defaults platformTargets to [responsive] when empty or absent', () => {
    expect(parseCreateProjectBody({}).metadata.platformTargets).toEqual(['responsive']);
    expect(
      parseCreateProjectBody({ metadata: { platformTargets: [] } }).metadata.platformTargets,
    ).toEqual(['responsive']);
  });

  it('treats empty pendingPrompt as null', () => {
    expect(parseCreateProjectBody({ pendingPrompt: '   ' }).pendingPrompt).toBeNull();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter server test -- project-create`
Expected: FAIL —— 模块不存在。

- [x] **Step 3: 实现净化器**

`server/src/project-create.ts`（新文件）：

```ts
import type { ProjectFidelity, ProjectMetadata, ProjectPlatform } from './types.js';

export const PROJECT_PLATFORMS: ProjectPlatform[] = [
  'responsive',
  'web-desktop',
  'mobile-ios',
  'mobile-android',
  'tablet',
  'desktop-app',
];

const FIDELITIES: ProjectFidelity[] = ['wireframe', 'high-fidelity'];

export type CreateProjectInput = {
  name: string;
  model: string | null;
  skillId: string | null;
  pendingPrompt: string | null;
  metadata: ProjectMetadata;
};

function optionalTrimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 宽容净化创建请求体（对齐 open-design：客户端可信度有限，非法值回落默认而非报错）。
 * 默认值与参照 NewProjectPanel 一致：platformTargets=['responsive']、
 * fidelity='high-fidelity'、开关 false、nameSource='user'。
 */
export function parseCreateProjectBody(body: unknown): CreateProjectInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawMeta = (typeof b.metadata === 'object' && b.metadata !== null ? b.metadata : {}) as Record<string, unknown>;

  const platformTargets = Array.isArray(rawMeta.platformTargets)
    ? [...new Set(rawMeta.platformTargets.filter((p): p is ProjectPlatform => PROJECT_PLATFORMS.includes(p as ProjectPlatform)))]
    : [];

  return {
    name: typeof b.name === 'string' ? b.name.trim() : '',
    model: optionalTrimmed(b.model),
    skillId: optionalTrimmed(b.skillId),
    pendingPrompt: optionalTrimmed(b.pendingPrompt),
    metadata: {
      kind: 'prototype',
      platformTargets: platformTargets.length > 0 ? platformTargets : ['responsive'],
      fidelity: FIDELITIES.includes(rawMeta.fidelity as ProjectFidelity)
        ? (rawMeta.fidelity as ProjectFidelity)
        : 'high-fidelity',
      includeLandingPage: rawMeta.includeLandingPage === true,
      includeOsWidgets: rawMeta.includeOsWidgets === true,
      nameSource: rawMeta.nameSource === 'generated' ? 'generated' : 'user',
    },
  };
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter server test -- project-create`
Expected: PASS。

- [x] **Step 5: 接线路由（index.ts）**

`server/src/index.ts`：

(a) import 区：`projects.js` 的 import 列表中追加 `touchProject`；新增一行 `import { parseCreateProjectBody } from './project-create.js';`

(b) POST `/api/projects` 替换为：

```ts
app.post('/api/projects', (req, res) => {
  const input = parseCreateProjectBody(req.body);
  res.json(
    createProject(input.name, input.model, {
      skillId: input.skillId,
      pendingPrompt: input.pendingPrompt,
      metadata: input.metadata,
    }),
  );
});
```

(c) PATCH `/api/projects/:id` 替换为（语义变化：①新增 name/skillId/pendingPrompt；②仅当影响 pi 启动参数的字段出现时才 dispose 会话——pendingPrompt 清除不应重启进程）：

```ts
app.patch('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const pick = (k: string): string | null | undefined => {
    const v = body[k];
    if (v === undefined) return undefined;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const updated = updateProject(id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    model: pick('model'),
    thinking: pick('thinking'),
    instructions: pick('instructions'),
    skillId: pick('skillId'),
    pendingPrompt: pick('pendingPrompt'),
  });
  const affectsSession = ['model', 'thinking', 'instructions', 'skillId'].some((k) => body[k] !== undefined);
  if (affectsSession) {
    const session = sessions.get(id);
    if (session && !session.isBusy) {
      session.dispose();
      sessions.delete(id);
    }
  }
  res.json(updated);
});
```

(d) 文件 CRUD 路由接 touch：在 `index.ts` 中现有三个文件写路由（`PUT /api/projects/:id/file`、`DELETE /api/projects/:id/file`、`POST /api/projects/:id/file/rename`）各自的成功响应（`res.json(...)` / `res.status(204)` 等）**之前**加一行 `touchProject(id);`（以路由内实际项目 id 变量名为准；找不到精确锚点时，原则是「文件成功变更后、响应前 touch」）。

- [x] **Step 6: 类型检查 + 全量测试**

Run: `pnpm --filter server build && pnpm --filter server test`
Expected: tsc 无错误，全部 PASS。

---

### Task 3: web 纯函数层（newProject.ts + 类型同步）

**Files:**
- Modify: `web/src/lib/types.ts`（ProjectMeta/ProjectMetadata 同步 server）
- Create: `web/src/lib/newProject.ts`
- Create: `web/src/lib/newProject.test.ts`

- [x] **Step 1: 写失败测试**

`web/src/lib/newProject.test.ts`（新文件）：

```ts
import { describe, expect, it } from 'vitest';
import { autoName, buildCreateRequest, DESIGN_PLATFORMS } from './newProject';

describe('autoName', () => {
  it('formats as "Prototype · <localeDateString>"', () => {
    const now = new Date(2026, 5, 10);
    expect(autoName(now)).toBe(`Prototype · ${now.toLocaleDateString()}`);
  });
});

describe('DESIGN_PLATFORMS', () => {
  it('lists the six open-design platforms in order', () => {
    expect(DESIGN_PLATFORMS.map((p) => p.value)).toEqual([
      'responsive',
      'web-desktop',
      'mobile-ios',
      'mobile-android',
      'tablet',
      'desktop-app',
    ]);
  });
});

describe('buildCreateRequest', () => {
  it('uses trimmed user name with nameSource user', () => {
    const req = buildCreateRequest({
      name: '  我的应用 ',
      prompt: ' 做一个登录页 ',
      model: 'anthropic/claude',
      platformTargets: ['mobile-ios'],
      fidelity: 'wireframe',
      includeLandingPage: true,
      includeOsWidgets: false,
    });
    expect(req).toEqual({
      name: '我的应用',
      model: 'anthropic/claude',
      skillId: null,
      pendingPrompt: '做一个登录页',
      metadata: {
        kind: 'prototype',
        platformTargets: ['mobile-ios'],
        fidelity: 'wireframe',
        includeLandingPage: true,
        includeOsWidgets: false,
        nameSource: 'user',
      },
    });
  });

  it('falls back to autoName + nameSource generated, empty prompt → null', () => {
    const req = buildCreateRequest({
      name: '   ',
      prompt: '',
      model: null,
      platformTargets: ['responsive'],
      fidelity: 'high-fidelity',
      includeLandingPage: false,
      includeOsWidgets: false,
    });
    expect(req.name).toBe(autoName());
    expect(req.metadata.nameSource).toBe('generated');
    expect(req.pendingPrompt).toBeNull();
    expect(req.model).toBeNull();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web test -- newProject`
Expected: FAIL —— 模块不存在。

- [x] **Step 3: 实现**

(a) `web/src/lib/types.ts`：把 `ProjectMeta` 替换为与 server 完全一致的版本（含新类型）：

```ts
export type ProjectPlatform =
  | 'responsive'
  | 'web-desktop'
  | 'mobile-ios'
  | 'mobile-android'
  | 'tablet'
  | 'desktop-app';

export type ProjectFidelity = 'wireframe' | 'high-fidelity';

export type ProjectMetadata = {
  kind: 'prototype';
  platformTargets?: ProjectPlatform[];
  fidelity?: ProjectFidelity;
  includeLandingPage?: boolean;
  includeOsWidgets?: boolean;
  nameSource?: 'user' | 'generated';
  importedFrom?: 'claude-design' | 'folder' | null;
  entryFile?: string | null;
  sourceFileName?: string | null;
  baseDir?: string | null;
};

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  model?: string | null;
  thinking?: string | null;
  instructions?: string | null;
  skillId?: string | null;
  pendingPrompt?: string | null;
  metadata?: ProjectMetadata;
};
```

(b) `web/src/lib/newProject.ts`（新文件）：

```ts
import type { ProjectFidelity, ProjectMetadata, ProjectPlatform } from './types';

/** 对齐 open-design NewProjectPanel 的 6 个目标平台（顺序一致）。 */
export const DESIGN_PLATFORMS: Array<{ value: ProjectPlatform; label: string; hint: string }> = [
  { value: 'responsive', label: '响应式', hint: '自适应桌面与移动端' },
  { value: 'web-desktop', label: '桌面 Web', hint: '面向宽屏浏览器' },
  { value: 'mobile-ios', label: 'iOS', hint: 'iPhone 移动端界面' },
  { value: 'mobile-android', label: 'Android', hint: 'Android 移动端界面' },
  { value: 'tablet', label: '平板', hint: 'iPad / 平板尺寸' },
  { value: 'desktop-app', label: '桌面应用', hint: '桌面客户端窗口' },
];

/** 对齐参照 autoName：`Prototype · {toLocaleDateString()}`。 */
export function autoName(now: Date = new Date()): string {
  return `Prototype · ${now.toLocaleDateString()}`;
}

export type NewProjectForm = {
  name: string;
  prompt: string;
  model: string | null;
  platformTargets: ProjectPlatform[];
  fidelity: ProjectFidelity;
  includeLandingPage: boolean;
  includeOsWidgets: boolean;
};

export type CreateProjectRequest = {
  name: string;
  model: string | null;
  skillId: string | null;
  pendingPrompt: string | null;
  metadata: ProjectMetadata;
};

/** 表单 → POST /api/projects 请求体。空名回落 autoName 并标记 nameSource:'generated'。 */
export function buildCreateRequest(form: NewProjectForm): CreateProjectRequest {
  const trimmedName = form.name.trim();
  const trimmedPrompt = form.prompt.trim();
  return {
    name: trimmedName || autoName(),
    model: form.model,
    skillId: null,
    pendingPrompt: trimmedPrompt || null,
    metadata: {
      kind: 'prototype',
      platformTargets: form.platformTargets,
      fidelity: form.fidelity,
      includeLandingPage: form.includeLandingPage,
      includeOsWidgets: form.includeOsWidgets,
      nameSource: trimmedName ? 'user' : 'generated',
    },
  };
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter web test`
Expected: 全部 PASS（含既有 exports/generation/zip 测试）。

---

### Task 4: NewProjectPanel 组件 + App/Sidebar/api 接线

**Files:**
- Create: `web/src/components/NewProjectPanel.tsx`
- Modify: `web/src/lib/api.ts`（createProject / updateProject 签名）
- Modify: `web/src/components/Sidebar.tsx`（移除行内创建，改为回调按钮）
- Modify: `web/src/App.tsx`（面板状态与创建流程）

本任务为 UI 接线，无单测（逻辑已在 Task 3 覆盖）；以 `pnpm --filter web build` 类型检查 + 手动验证为判据。

- [x] **Step 1: api.ts 更新**

`web/src/lib/api.ts`：

(a) 文件头部追加 import：`import type { CreateProjectRequest } from './newProject';`

(b) `createProject` 替换为：

```ts
  createProject: (input: CreateProjectRequest) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => json<ProjectMeta>(r)),
```

(c) `updateProject` 的 patch 参数类型扩展为：

```ts
  updateProject: (
    id: string,
    patch: {
      name?: string;
      model?: string | null;
      thinking?: string | null;
      instructions?: string | null;
      skillId?: string | null;
      pendingPrompt?: string | null;
    },
  ) =>
```

（函数体不变。）

- [x] **Step 2: NewProjectPanel 组件**

`web/src/components/NewProjectPanel.tsx`（新文件，完整内容）：

```tsx
import { useEffect, useState } from 'react';
import { piApi } from '../lib/api';
import type { PiModel, ProjectFidelity, ProjectPlatform } from '../lib/types';
import { autoName, buildCreateRequest, DESIGN_PLATFORMS, type CreateProjectRequest } from '../lib/newProject';

type Props = {
  onClose: () => void;
  onCreate: (input: CreateProjectRequest) => Promise<void>;
};

/**
 * 新建项目模态面板，对齐 open-design NewProjectPanel 的 prototype 选项卡：
 * 名称（空→autoName）、初始提示词（→pendingPrompt 预填）、目标平台多选
 * （默认 responsive）、保真度（默认 high-fidelity）、Landing Page / OS
 * Widgets 开关（默认关）。模型选择为本项目既有能力，保留。
 */
export default function NewProjectPanel({ onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<PiModel[]>([]);
  const [platforms, setPlatforms] = useState<ProjectPlatform[]>(['responsive']);
  const [fidelity, setFidelity] = useState<ProjectFidelity>('high-fidelity');
  const [includeLandingPage, setIncludeLandingPage] = useState(false);
  const [includeOsWidgets, setIncludeOsWidgets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    piApi.models().then(setModels).catch(() => setModels([]));
  }, []);

  const togglePlatform = (value: ProjectPlatform) => {
    setPlatforms((prev) => {
      const next = prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value];
      return next.length > 0 ? next : prev; // 至少保留一个平台
    });
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(
        buildCreateRequest({
          name,
          prompt,
          model: model || null,
          platformTargets: platforms,
          fidelity,
          includeLandingPage,
          includeOsWidgets,
        }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-[480px] max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-900">新建项目</h2>

        <label className="mt-4 block text-xs font-medium text-zinc-500">项目名称</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={autoName()}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />

        <label className="mt-3 block text-xs font-medium text-zinc-500">初始提示词（可选，创建后自动填入输入框）</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="描述你想做的界面，比如「做一个咖啡店落地页」"
          className="mt-1 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />

        <label className="mt-3 block text-xs font-medium text-zinc-500">目标平台</label>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {DESIGN_PLATFORMS.map((p) => (
            <button
              key={p.value}
              type="button"
              title={p.hint}
              onClick={() => togglePlatform(p.value)}
              className={`rounded-lg border px-2 py-1.5 text-xs ${
                platforms.includes(p.value)
                  ? 'border-zinc-800 bg-zinc-900 text-white'
                  : 'border-zinc-300 text-zinc-600 hover:border-zinc-400'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-medium text-zinc-500">保真度</label>
        <div className="mt-1 flex gap-1.5">
          {(
            [
              { value: 'high-fidelity', label: '高保真' },
              { value: 'wireframe', label: '线框图' },
            ] as Array<{ value: ProjectFidelity; label: string }>
          ).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFidelity(f.value)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${
                fidelity === f.value
                  ? 'border-zinc-800 bg-zinc-900 text-white'
                  : 'border-zinc-300 text-zinc-600 hover:border-zinc-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-1.5">
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={includeLandingPage} onChange={(e) => setIncludeLandingPage(e.target.checked)} />
            包含 Landing Page
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={includeOsWidgets} onChange={(e) => setIncludeOsWidgets(e.target.checked)} />
            包含 OS Widgets
          </label>
        </div>

        <label className="mt-3 block text-xs font-medium text-zinc-500">模型</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 outline-none focus:border-zinc-500"
        >
          <option value="">跟随全局默认</option>
          {models.map((m) => (
            <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
              {m.provider}/{m.id}
            </option>
          ))}
        </select>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [x] **Step 3: Sidebar 简化**

`web/src/components/Sidebar.tsx` 整体替换为（移除行内创建态/模型加载，新建按钮回调给 App）：

```tsx
import type { ProjectMeta } from '../lib/types';

type Props = {
  projects: ProjectMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewProject: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
};

export default function Sidebar({ projects, activeId, onSelect, onNewProject, onDelete, onOpenSettings }: Props) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-zinc-200">
        <span className="text-lg">π</span>
        <span className="text-sm font-semibold text-zinc-800">Pi Web Studio</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {projects.map((p) => (
          <div
            key={p.id}
            className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm ${
              p.id === activeId ? 'bg-zinc-200/80 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
            onClick={() => onSelect(p.id)}
          >
            <span className="truncate">{p.name}</span>
            <button
              className="hidden text-zinc-400 hover:text-red-500 group-hover:block"
              title="删除项目"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`删除项目「${p.name}」？此操作不可恢复。`)) onDelete(p.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {projects.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-zinc-400">还没有项目，点击下方新建</p>
        )}
      </div>

      <div className="border-t border-zinc-200 p-2">
        <button
          onClick={onNewProject}
          className="w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
        >
          ＋ 新建项目
        </button>
        <button
          onClick={onOpenSettings}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
        >
          ⚙ 设置
        </button>
      </div>
    </aside>
  );
}
```

- [x] **Step 4: App 接线**

`web/src/App.tsx` 修改：

(a) import 区追加：

```ts
import NewProjectPanel from './components/NewProjectPanel';
import type { CreateProjectRequest } from './lib/newProject';
```

(b) 状态区追加：`const [showNewProject, setShowNewProject] = useState(false);`

(c) `createProject` 函数替换为（抛错给面板展示，不再吞错）：

```ts
  const createProject = async (input: CreateProjectRequest) => {
    const meta = await api.createProject(input);
    await refresh();
    setActiveId(meta.id);
  };
```

(d) JSX 中 `<Sidebar … onCreate={createProject} …>` 改为 `onNewProject={() => setShowNewProject(true)}`（其余 props 不变）；在 `{showSettings && …}` 之后追加：

```tsx
      {showNewProject && (
        <NewProjectPanel onClose={() => setShowNewProject(false)} onCreate={createProject} />
      )}
```

- [x] **Step 5: 类型检查与构建**

Run: `pnpm --filter web build`
Expected: tsc + vite build 通过，无类型错误。

- [x] **Step 6: 手动冒烟（可选但推荐）**

Run: `pnpm dev`，浏览器打开 web 端口：点击「新建项目」→ 面板展示全部字段 → 不填名称直接创建 → 项目名为「Prototype · 日期」；填提示词创建 → 进入项目后输入框预填该提示词（依赖 Task 5，若未实施则只验证创建与命名）。

---

### Task 5: pendingPrompt 消费（预填 composer，一次性）

**Files:**
- Modify: `web/src/components/Composer.tsx`（seed prop）
- Modify: `web/src/components/ChatPanel.tsx`（pendingPrompt props 透传）
- Modify: `web/src/App.tsx`（传入 pendingPrompt + 清除回调）

语义对齐参照 `ProjectView.tsx:4939-4987`：挂载时若有 pendingPrompt → 预填输入框（**不自动发送**）→ 立即 PATCH 清除持久值，刷新/切换项目不重复预填。

- [x] **Step 1: Composer 加 seed**

`web/src/components/Composer.tsx`：

(a) import 行改为：`import { useEffect, useRef, useState } from 'react';`

(b) Props 与组件头部改为：

```tsx
type Props = {
  busy: boolean;
  /** 一次性预填文本（pendingPrompt）；变为非空时填入输入框并聚焦。 */
  seed?: string | null;
  onSend: (message: string) => void;
  onStop: () => void;
};

export default function Composer({ busy, seed, onSend, onStop }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!seed) return;
    setValue(seed);
    textareaRef.current?.focus();
  }, [seed]);
```

（其余保持不变。）

- [x] **Step 2: ChatPanel 透传**

`web/src/components/ChatPanel.tsx`：

(a) `Props` 增加两个字段：

```ts
  /** 项目的待发提示词；非空时预填 composer 并触发 onConsumePendingPrompt。 */
  pendingPrompt?: string | null;
  /** 预填后清除持久化 pendingPrompt（PATCH null）。 */
  onConsumePendingPrompt?: () => void;
```

(b) 组件签名改为 `export default function ChatPanel({ projectId, onGeneration, retryRef, pendingPrompt, onConsumePendingPrompt }: Props)`。

(c) 组件内追加（放在现有 state 声明之后）——用 ref 保证每次挂载只消费一次：

```ts
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  const consumedPendingPrompt = useRef(false);

  useEffect(() => {
    if (consumedPendingPrompt.current) return;
    if (!pendingPrompt?.trim()) return;
    consumedPendingPrompt.current = true;
    setComposerSeed(pendingPrompt);
    onConsumePendingPrompt?.();
  }, [pendingPrompt, onConsumePendingPrompt]);
```

(d) JSX 中 `<Composer busy={busy} onSend={send} onStop={stop} />` 改为 `<Composer busy={busy} seed={composerSeed} onSend={send} onStop={stop} />`。

- [x] **Step 3: App 接线**

`web/src/App.tsx`：

(a) 组件内追加（`activeMeta` 声明之后）：

```ts
  const consumePendingPrompt = useCallback(async () => {
    const id = activeId;
    if (!id) return;
    // 先更新本地（避免重复触发），再持久化清除；失败不影响输入框预填。
    setProjects((list) => list.map((p) => (p.id === id ? { ...p, pendingPrompt: null } : p)));
    try {
      await api.updateProject(id, { pendingPrompt: null });
    } catch {
      // 忽略：下次进入项目最多再预填一次，无害。
    }
  }, [activeId]);
```

(b) `<ChatPanel key={activeId} projectId={activeId} …>` 增加 props：

```tsx
          <ChatPanel
            key={activeId}
            projectId={activeId}
            onGeneration={setGeneration}
            retryRef={retryRef}
            pendingPrompt={activeMeta?.pendingPrompt ?? null}
            onConsumePendingPrompt={consumePendingPrompt}
          />
```

- [x] **Step 4: 类型检查 + 全部测试**

Run: `pnpm --filter web build && pnpm --filter web test`
Expected: 通过。

- [x] **Step 5: 手动验证**

`pnpm dev`：新建项目时填初始提示词 → 创建后自动进入项目，输入框已预填该文本且未自动发送；刷新页面 → 不再重复预填（meta.json 中 pendingPrompt 已为 null）。

---

### Task 6: 全量回归

- [x] **Step 1: 全量测试与构建**

Run（仓库根）: `pnpm test && pnpm build`
Expected: server + web 测试全部 PASS；两包构建（tsc/vite）通过。

- [x] **Step 2: 行为对照检查**

逐条核对 spec §2 表格：空名 → `Prototype · 日期` + `nameSource:'generated'`；平台默认 `['responsive']` 且至少选一个；保真度默认 `high-fidelity`；两开关默认 false；POST 后 meta.json 含全部新字段且 `updatedAt === createdAt`；PATCH `pendingPrompt:null` 不重启 pi 会话；列表按 updatedAt 倒序。

---

**完成记录（2026-06-10）**：全部 6 个任务经子 agent 实施 + 规格/质量双审查通过。`pnpm test`（server 79 + web 22）与 `pnpm build` 全绿；API 冒烟（创建净化/PATCH 清除 pendingPrompt/updatedAt 排序/空名忽略）符合 spec。终审结论 Ready。Skill 选择器与 /api/skills 按 spec §11 留待 P4。
