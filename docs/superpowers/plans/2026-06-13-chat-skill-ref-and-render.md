# 对话区 + 菜单 / Skill 引用 / 模型常显 / 渲染重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目详情页对话区加入 `+` 下拉（附件 + 引用 Skill）、把引用的 skill 经 `--skill` 注入并加 prompt 指令送达 agent、模型名常显、并按参照截图重构助手消息的精细渲染。

**Architecture:** 前后端分离（Vite/React `web` + Express/tsx `server`），pi 以每会话长生命周期 `pi --mode rpc` 子进程运行，skill 在 spawn 时经 `--skill <dir>` 注入；引用 skill 通过「模块级 referencedSkillPaths 集合 + 按需重启空闲会话」并入注入集合，并在该回合 prompt 前缀指令。渲染层是纯逻辑（`messageParts.ts`）+ 展示组件（`MessageView.tsx`）。

**Tech Stack:** TypeScript, React 18, Vite, Express, vitest, react-markdown, Tailwind v4。

参照设计文档：`docs/superpowers/specs/2026-06-13-chat-skill-ref-and-render-design.md`

---

## 文件结构总览

**server（先做，纯逻辑可 TDD）**
- 改 `server/src/pi-skills.ts`：新增 `SkillRef` 类型、`sanitizeSkillRefs`、`resolveSkills`、`skillReferenceDirective`。
- 改 `server/src/pi-skills.test.ts`：上述三者单测。
- 改 `server/src/types.ts`：`ChatMessage` 增 `skills?: string[]`。
- 改 `server/src/index.ts`：`referencedSkillPaths` 集合、`launchConfigFor` 并集、chat 路由解析/重启/落盘/指令。

**web 数据层**
- 改 `web/src/lib/types.ts`：新增 `SkillRef`、`ChatMessage.skills?`。
- 改 `web/src/lib/api.ts`：`streamChat` 增 `skills` 参数并入 body。

**web 纯逻辑（可 TDD）**
- 改 `web/src/lib/messageParts.ts`：新增 `summarizeTools`、`writtenFilePath`。
- 改 `web/src/lib/messageParts.test.ts`：上述单测。

**web UI**
- 改 `web/src/components/Composer.tsx`：`+` 下拉、skill 选择器、已选 tag、模型名常显，`onSend` 增 skills 参。
- 改 `web/src/components/ChatPanel.tsx`：`send`/retry/streamChat 透传 skills；复用 `writtenFilePath`。
- 改 `web/src/components/MessageView.tsx`：活动摘要枚举、`TodoCard`、`FileChip`、用户消息 skill tag。

---

## Task 1: server — `sanitizeSkillRefs`（校验入参）

**Files:**
- Modify: `server/src/pi-skills.ts`
- Test: `server/src/pi-skills.test.ts`

- [ ] **Step 1: 在 pi-skills.test.ts 顶部 import 增补，并追加失败测试**

在现有 import 块加入 `sanitizeSkillRefs`（与 `enabledSkillPaths` 同 import 列表）。文件末尾追加：

```ts
describe('sanitizeSkillRefs', () => {
  it('保留合法 ref、按 scope+rel 去重、丢弃非法项', () => {
    const out = sanitizeSkillRefs([
      { scope: 'bundled', rel: 'a' },
      { scope: 'bundled', rel: 'a' }, // 重复
      { scope: 'project', rel: ' b ' }, // trim
      { scope: 'nope', rel: 'c' }, // 非法 scope
      { scope: 'global', rel: '' }, // 空 rel
      'garbage',
      null,
    ]);
    expect(out).toEqual([
      { scope: 'bundled', rel: 'a' },
      { scope: 'project', rel: 'b' },
    ]);
  });

  it('非数组返回空', () => {
    expect(sanitizeSkillRefs(undefined)).toEqual([]);
    expect(sanitizeSkillRefs({})).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter server test -- pi-skills`
Expected: FAIL，`sanitizeSkillRefs is not a function` / 未导出。

- [ ] **Step 3: 在 pi-skills.ts 实现**

在 `export type SkillScope` 之后新增类型，并在文件靠近 `enabledSkillPaths` 处新增函数：

```ts
export type SkillRef = { scope: SkillScope; rel: string };

const SKILL_SCOPES: SkillScope[] = ['global', 'project', 'bundled'];

/** 校验客户端传来的 skill 引用：保留合法项，按 scope+rel 去重。 */
export function sanitizeSkillRefs(input: unknown): SkillRef[] {
  if (!Array.isArray(input)) return [];
  const out: SkillRef[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const scope = rec.scope as SkillScope;
    const rel = typeof rec.rel === 'string' ? rec.rel.trim() : '';
    if (!SKILL_SCOPES.includes(scope) || !rel) continue;
    const key = `${scope}:${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ scope, rel });
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter server test -- pi-skills`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/pi-skills.ts server/src/pi-skills.test.ts
git commit -m "feat(server): sanitizeSkillRefs 校验对话引用的 skill"
```

---

## Task 2: server — `resolveSkills` + `skillReferenceDirective`

**Files:**
- Modify: `server/src/pi-skills.ts`
- Test: `server/src/pi-skills.test.ts`

- [ ] **Step 1: 追加失败测试**

import 列表加 `resolveSkills, skillReferenceDirective`。追加（沿用本测试文件已有的 `writeSkill`、`bundledDir`、`projDir`、`PI_WEBUI_SKILLS_DIR` 环境隔离约定）：

```ts
describe('resolveSkills', () => {
  it('把 ref 解析为技能目录绝对路径并带回 name/description，缺失项跳过', () => {
    writeSkill(bundledDir, 'hero'); // name=hero, description=技能 hero
    writeSkill(path.join(projDir, '.pi', 'skills'), 'local');
    const out = resolveSkills(
      [
        { scope: 'bundled', rel: 'hero' },
        { scope: 'project', rel: 'local' },
        { scope: 'bundled', rel: 'missing' },
      ],
      projDir,
    );
    expect(out).toEqual([
      { path: path.join(bundledDir, 'hero'), name: 'hero', description: '技能 hero' },
      { path: path.join(projDir, '.pi', 'skills', 'local'), name: 'local', description: '技能 local' },
    ]);
  });

  it('空输入返回空', () => {
    expect(resolveSkills([], projDir)).toEqual([]);
  });
});

describe('skillReferenceDirective', () => {
  it('拼接成引导指令', () => {
    const text = skillReferenceDirective([{ name: 'hero', description: '英雄区' }]);
    expect(text).toContain('hero');
    expect(text).toContain('英雄区');
  });
  it('空列表返回空串', () => {
    expect(skillReferenceDirective([])).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter server test -- pi-skills`
Expected: FAIL，未导出函数。

- [ ] **Step 3: 在 pi-skills.ts 实现**

`skillsRoot` 已是模块内私有函数，`resolveSkills` 同模块可直接调用。新增：

```ts
export type ResolvedSkill = { path: string; name: string; description: string };

/** 把 SkillRef[] 解析为技能目录绝对路径（含 name/description），缺失项静默跳过。 */
export function resolveSkills(refs: SkillRef[], projectDir: string | null): ResolvedSkill[] {
  if (refs.length === 0) return [];
  const all = listSkills(projectDir);
  const out: ResolvedSkill[] = [];
  for (const ref of refs) {
    const info = all.find((s) => s.scope === ref.scope && s.rel === ref.rel);
    if (!info) continue;
    let root: string;
    try {
      root = skillsRoot(ref.scope, projectDir);
    } catch {
      continue;
    }
    out.push({ path: path.join(root, info.rel), name: info.name, description: info.description });
  }
  return out;
}

/** 本回合引用的 skill → 注入 agent 的引导指令；空列表返回空串。 */
export function skillReferenceDirective(skills: { name: string; description: string }[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- ${s.name}：${s.description}`);
  return `本回合请优先使用以下 skill（已为你加载，可直接调用）：\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter server test -- pi-skills`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/pi-skills.ts server/src/pi-skills.test.ts
git commit -m "feat(server): resolveSkills 定位引用技能 + skillReferenceDirective 引导指令"
```

---

## Task 3: server — `ChatMessage.skills` 类型字段

**Files:**
- Modify: `server/src/types.ts:46-56`

- [ ] **Step 1: 给 ChatMessage 增字段**

把 `ChatMessage` 的 `attachments?: ChatAttachment[];` 下方加入：

```ts
  /** 本条用户消息引用的 skill 名（每条消息一次性，仅作 transcript 回显）。 */
  skills?: string[];
```

- [ ] **Step 2: 类型检查通过**

Run: `pnpm --filter server build`
Expected: 无错误（`tsc --noEmit`）。

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(server): ChatMessage 增 skills 字段（引用技能名回显）"
```

---

## Task 4: server — chat 路由接入 skill 引用

**Files:**
- Modify: `server/src/index.ts`（`launchConfigFor` ~81、chat 路由 ~252、import 区）

整合任务（Express 胶水层，无既有路由单测，按 build + 现有测试 + 手动冒烟验证）。

- [ ] **Step 1: 扩展 import**

`import { enabledSkillPaths } from './pi-skills.js';` 改为：

```ts
import { enabledSkillPaths, resolveSkills, sanitizeSkillRefs, skillReferenceDirective } from './pi-skills.js';
```

- [ ] **Step 2: 新增模块级引用集合（放在 `const sessions = new Map…` 附近）**

```ts
/** 每会话经对话引用过的 skill 目录路径并集；只增不减，作为「已注入哪些 skill」缓存。 */
const referencedSkillPaths = new Map<string, Set<string>>();
```

- [ ] **Step 3: `launchConfigFor` 并入引用集合**

把 `const skillPaths = enabledSkillPaths(projectDir(id));` 改为：

```ts
  const referenced = referencedSkillPaths.get(sessionKey(id, cid));
  const baseSkillPaths = enabledSkillPaths(projectDir(id));
  const skillPaths = referenced
    ? Array.from(new Set([...baseSkillPaths, ...referenced]))
    : baseSkillPaths;
```

- [ ] **Step 4: chat 路由解析 + 按需重启 + 落盘 + 指令**

把 `app.post('/api/projects/:id/conversations/:cid/chat', …)` 路由体改为（在 busy 检查之后、autoTitle 之前插入 skill 处理；并改写 appendConversationHistory 与 prompt 组装）：

```ts
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const attachments = sanitizeAttachments(req.body?.attachments);
  if (!message && attachments.length === 0) return res.status(400).json({ error: 'message is required' });

  const session = sessionFor(id, cid);
  if (session.isBusy || activeTurn(id, cid)) {
    return res.status(409).json({ error: 'agent 正忙，请先停止当前回合' });
  }

  // 解析本回合引用的 skill：并入会话注入集合；有新增则重启（空闲）会话使其按新 --skill 重 spawn。
  const resolvedSkills = resolveSkills(sanitizeSkillRefs(req.body?.skills), projectDir(id));
  if (resolvedSkills.length > 0) {
    const key = sessionKey(id, cid);
    let set = referencedSkillPaths.get(key);
    if (!set) {
      set = new Set();
      referencedSkillPaths.set(key, set);
    }
    let changed = false;
    for (const r of resolvedSkills) {
      if (!set.has(r.path)) {
        set.add(r.path);
        changed = true;
      }
    }
    if (changed) {
      session.dispose();
      sessions.delete(key);
    }
  }
  // 重启后用新配置取回会话（未重启则同一实例）。
  const liveSession = sessionFor(id, cid);

  // 首条消息且对话未命名：与回合并行跑一次性 AI 总结生成对话标题。
  const conv = getConversation(id, cid);
  if (conv && !conv.title && message && readConversationHistory(id, cid).length === 0) {
    void autoTitleConversation({
      projectId: id,
      cid,
      message,
      model: conv.model ?? getProject(id)?.model ?? null,
    });
  }

  const skillNames = resolvedSkills.map((s) => s.name);
  appendConversationHistory(id, cid, {
    role: 'user',
    content: message,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(skillNames.length > 0 ? { skills: skillNames } : {}),
    createdAt: Date.now(),
  });

  const directive = skillReferenceDirective(resolvedSkills);
  const base = composePromptWithAttachments(message, attachments);
  const prompt = directive ? `${directive}\n\n${base}` : base;

  const { turn } = startTurn(id, cid, (emit) => liveSession.prompt(prompt, emit));
  pipeTurnToResponse(turn, res);
```

- [ ] **Step 5: 类型检查 + 现有测试**

Run: `pnpm --filter server build && pnpm --filter server test`
Expected: build 无错误；测试全绿（含 Task 1/2 新增）。

- [ ] **Step 6: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): chat 路由接入引用 skill——按需重启注入 --skill + prompt 指令 + 历史落盘"
```

---

## Task 5: web — 数据层类型与 streamChat

**Files:**
- Modify: `web/src/lib/types.ts`（`SkillInfo` 附近、`ChatMessage`）
- Modify: `web/src/lib/api.ts:182`（`streamChat`）

- [ ] **Step 1: types.ts 增类型字段**

在 `export type SkillInfo` 之后新增：

```ts
/** 对话区引用的 skill（每条消息一次性）。scope/rel 用于送达后端，name 用于本地回显。 */
export type SkillRef = { scope: SkillInfo['scope']; rel: string; name: string };
```

并在 `ChatMessage` 的 `attachments?: ChatAttachment[];` 下加：

```ts
  /** 本条用户消息引用的 skill 名（仅展示）。 */
  skills?: string[];
```

- [ ] **Step 2: api.ts streamChat 增 skills 参数**

把 `streamChat` 签名与 body 改为：

```ts
export async function streamChat(
  projectId: string,
  conversationId: string,
  message: string,
  onEvent: (ev: UiEvent) => void,
  signal?: AbortSignal,
  attachments?: ChatAttachment[],
  skills?: { scope: string; rel: string }[],
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/conversations/${conversationId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      ...(attachments?.length ? { attachments } : {}),
      ...(skills?.length ? { skills } : {}),
    }),
    signal,
  });
```

（函数其余部分不变。）

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter web exec tsc -b`
Expected: 无错误（ChatPanel 暂未用到新参，可选参不报错）。

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/api.ts
git commit -m "feat(web): SkillRef 类型 + streamChat 透传引用 skill"
```

---

## Task 6: web — `summarizeTools` 与 `writtenFilePath`（纯逻辑）

**Files:**
- Modify: `web/src/lib/messageParts.ts`
- Test: `web/src/lib/messageParts.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `messageParts.test.ts` import 区加 `summarizeTools, writtenFilePath`，并追加：

```ts
describe('summarizeTools', () => {
  it('按工具类型映射动词并计数，保持首次出现顺序', () => {
    const t = (name: string) => ({ id: null, name, input: {} });
    const out = summarizeTools([
      t('Read'), t('Read'), t('Grep'), t('Write'), t('Read'), t('TodoWrite'), t('Edit'),
    ]);
    expect(out).toEqual([
      { verb: '读取', count: 3 },
      { verb: '搜索', count: 1 },
      { verb: '写入', count: 1 },
      { verb: '更新待办', count: 1 },
      { verb: '编辑', count: 1 },
    ]);
  });
  it('未知工具名原样作为动词', () => {
    expect(summarizeTools([{ id: null, name: 'Frobnicate', input: {} }])).toEqual([
      { verb: 'Frobnicate', count: 1 },
    ]);
  });
});

describe('writtenFilePath', () => {
  it('写类工具取 path/file_path，非写类返回 null', () => {
    expect(writtenFilePath('Write', { path: 'a/b.html' })).toBe('a/b.html');
    expect(writtenFilePath('Edit', { file_path: 'c.css' })).toBe('c.css');
    expect(writtenFilePath('Read', { path: 'a/b.html' })).toBeNull();
    expect(writtenFilePath(null, { path: 'x' })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter web test -- messageParts`
Expected: FAIL，未导出。

- [ ] **Step 3: 在 messageParts.ts 实现**

文件末尾追加：

```ts
/** 写类工具（含 path 字段）→ 项目内相对路径；非写类或无路径返回 null。 */
const WRITE_TOOL_RE = /write|edit|patch|create/i;
export function writtenFilePath(name: string | null, input: unknown): string | null {
  if (!name || !WRITE_TOOL_RE.test(name)) return null;
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  const candidate = rec.path ?? rec.file_path ?? rec.filename ?? rec.file;
  return typeof candidate === 'string' && candidate ? candidate : null;
}

/** 工具名 → 中文动词（按序匹配，todo 须先于 write）。 */
const TOOL_VERBS: Array<[RegExp, string]> = [
  [/todo/i, '更新待办'],
  [/multi.?edit|edit|patch/i, '编辑'],
  [/write|create/i, '写入'],
  [/read/i, '读取'],
  [/glob|grep|search|find/i, '搜索'],
  [/copy/i, '复制'],
  [/delete|remove|\brm\b/i, '删除'],
  [/bash|shell|exec|\brun\b/i, '运行'],
];

function toolVerb(name: string | null): string {
  if (!name) return '操作';
  for (const [re, verb] of TOOL_VERBS) if (re.test(name)) return verb;
  return name;
}

/** 把一组工具按动词归并计数，保持首次出现顺序（活动块折叠摘要用）。 */
export function summarizeTools(tools: ToolCall[]): Array<{ verb: string; count: number }> {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const t of tools) {
    const verb = toolVerb(t.name);
    if (!counts.has(verb)) order.push(verb);
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
  }
  return order.map((verb) => ({ verb, count: counts.get(verb)! }));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter web test -- messageParts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/messageParts.ts web/src/lib/messageParts.test.ts
git commit -m "feat(web): summarizeTools 工具类型计数 + writtenFilePath 写文件路径"
```

---

## Task 7: web — ChatPanel 复用 writtenFilePath 并预备 skills 透传

**Files:**
- Modify: `web/src/components/ChatPanel.tsx`

- [ ] **Step 1: 删除本地 writtenFileFrom，改用共享 writtenFilePath**

import 区加入 `writtenFilePath`：把
`import { appendPartText, rollbackParts } from '../lib/messageParts';`
改为
`import { appendPartText, rollbackParts, writtenFilePath } from '../lib/messageParts';`

删除文件内 `const WRITE_TOOL_RE` 与 `function writtenFileFrom(...)` 整段，并把 `tool_use` 分支里：

```ts
            const written = writtenFileFrom(ev.name, ev.input);
```

改为：

```ts
            const written = writtenFilePath(ev.name, ev.input)?.split('/').pop() ?? null;
```

- [ ] **Step 2: send 增 skills 形参并透传**

`lastUserInput` ref 的类型改为带 skills：

```ts
  const lastUserInput = useRef<{ text: string; attachments: ChatAttachment[]; skills: SkillRef[] } | null>(null);
```

import 类型：把 types import 行补上 `SkillRef`（与 `ChatAttachment` 同行）。

`send` 改为：

```ts
  const send = useCallback(
    async (text: string, attachments: ChatAttachment[] = [], skills: SkillRef[] = []) => {
      lastUserInput.current = { text, attachments, skills };
      setMessages((prev) => [
        ...prev,
        {
          role: 'user',
          content: text,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(skills.length > 0 ? { skills: skills.map((s) => s.name) } : {}),
          createdAt: Date.now(),
        },
        { role: 'assistant', content: '', createdAt: Date.now(), streaming: true },
      ]);
      const controller = new AbortController();
      await consumeTurn(
        (onEvent) =>
          streamChat(
            projectId,
            conversationId,
            text,
            onEvent,
            controller.signal,
            attachments,
            skills.map((s) => ({ scope: s.scope, rel: s.rel })),
          ),
        controller,
      );
    },
    [projectId, conversationId, consumeTurn],
  );
```

retry 分支保持调用 `send(last.text, last.attachments, last.skills)`：

```ts
      if (last && !generationInput.current.busy) void send(last.text, last.attachments, last.skills);
```

（`sendRef` 的 `send(text)` 调用不变——QuestionsPanel 答案无 skills。）

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter web exec tsc -b`
Expected: 无错误（Composer 的 onSend 仍为旧签名，下一 Task 更新；此处 send 多出的可选参不影响 `onSend={send}` 赋值——若 tsc 报 onSend 类型不符，继续 Task 8 一并修）。

> 注：若此步因 `onSend={send}` 签名不匹配报错，先完成 Task 8 再统一 `tsc -b`，两 Task 合并提交亦可。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ChatPanel.tsx
git commit -m "refactor(web): ChatPanel 复用 writtenFilePath，send 透传引用 skill"
```

---

## Task 8: web — Composer 的 `+` 下拉、skill 选择器、已选 tag、模型名常显

**Files:**
- Modify: `web/src/components/Composer.tsx`

- [ ] **Step 1: import 增补**

把 icons import 改为：

```ts
import { CheckIcon, ChevronDownIcon, FileIcon, LoaderIcon, PaperclipIcon, PlusIcon, SparklesIcon, XIcon } from './icons';
```

types import 加 `SkillInfo, SkillRef`：

```ts
import type { ChatAttachment, PiModel, SkillInfo, SkillRef } from '../lib/types';
```

api import 已有 `api`；加 `piApi`：

```ts
import { api, piApi } from '../lib/api';
```

- [ ] **Step 2: 修改 Props.onSend 签名**

把 `onSend: (message: string, attachments: ChatAttachment[]) => void;` 改为：

```ts
  onSend: (message: string, attachments: ChatAttachment[], skills: SkillRef[]) => void;
```

- [ ] **Step 3: 新增 state（在组件顶部 state 区，紧随 `modelMenuOpen`）**

```ts
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillList, setSkillList] = useState<SkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<SkillRef[]>([]);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const skillsLoaded = useRef(false);
```

- [ ] **Step 4: 外部点击关闭 + 懒加载技能（在 model 菜单的 useEffect 之后追加）**

```ts
  useEffect(() => {
    if (!plusMenuOpen && !skillPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!plusMenuRef.current?.contains(e.target as Node)) {
        setPlusMenuOpen(false);
        setSkillPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [plusMenuOpen, skillPickerOpen]);

  const openSkillPicker = useCallback(() => {
    setPlusMenuOpen(false);
    setSkillPickerOpen(true);
    if (!skillsLoaded.current) {
      skillsLoaded.current = true;
      piApi.skills(projectId).then(setSkillList).catch(() => setSkillList([]));
    }
  }, [projectId]);

  const toggleSkill = useCallback((s: SkillInfo) => {
    setSelectedSkills((prev) => {
      const exists = prev.some((p) => p.scope === s.scope && p.rel === s.rel);
      return exists
        ? prev.filter((p) => !(p.scope === s.scope && p.rel === s.rel))
        : [...prev, { scope: s.scope, rel: s.rel, name: s.name }];
    });
  }, []);
```

- [ ] **Step 5: send() 带上 skills 并清空**

把 `send` 函数体内 `onSend(message, sent);` 改为：

```ts
    const sentSkills = selectedSkills;
    setSelectedSkills([]);
    onSend(message, sent, sentSkills);
```

（`canSend` 不变——引用 skill 不单独触发可发送；与现有「有文字或附件」一致。）

- [ ] **Step 6: 渲染已选 skill tag（在 attachments chip 块之后插入）**

在 `{attachments.length > 0 && ( … )}` 整块之后追加：

```tsx
        {selectedSkills.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {selectedSkills.map((s) => (
              <span
                key={`${s.scope}:${s.rel}`}
                className="group flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-700"
              >
                <SparklesIcon size={13} className="shrink-0 text-violet-400" />
                <span className="max-w-36 truncate font-medium">{s.name}</span>
                <button
                  type="button"
                  title="移除 skill"
                  aria-label={`移除 skill ${s.name}`}
                  onClick={() => setSelectedSkills((prev) => prev.filter((p) => !(p.scope === s.scope && p.rel === s.rel)))}
                  className="rounded p-0.5 text-violet-400 hover:bg-violet-200 hover:text-violet-700"
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
```

- [ ] **Step 7: 把回形针按钮替换为 `+` 下拉（底部工具栏）**

在底部工具栏，把原来的「添加附件」`<button>`（含 `PaperclipIcon`）整段替换为：

```tsx
            <div className="relative" ref={plusMenuRef}>
              <button
                type="button"
                title="添加内容"
                aria-label="添加内容"
                aria-haspopup="menu"
                aria-expanded={plusMenuOpen || skillPickerOpen}
                onClick={() => {
                  setSkillPickerOpen(false);
                  setPlusMenuOpen((v) => !v);
                }}
                className={`rounded-lg p-2 ${
                  plusMenuOpen || skillPickerOpen ? 'bg-zinc-100 text-zinc-700' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
                }`}
              >
                <PlusIcon size={16} />
              </button>
              {plusMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-20 mb-1.5 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <PaperclipIcon size={15} className="shrink-0 text-zinc-400" />
                    添加附件
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openSkillPicker}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <SparklesIcon size={15} className="shrink-0 text-zinc-400" />
                    引用 Skill
                  </button>
                </div>
              )}
              {skillPickerOpen && (
                <div className="absolute bottom-full left-0 z-20 mb-1.5 flex max-h-80 w-80 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
                  <div className="border-b border-zinc-100 p-2">
                    <input
                      autoFocus
                      value={skillQuery}
                      onChange={(e) => setSkillQuery(e.target.value)}
                      placeholder="搜索 skill…"
                      className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto py-1">
                    {(() => {
                      const q = skillQuery.trim().toLowerCase();
                      const list = q
                        ? skillList.filter(
                            (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
                          )
                        : skillList;
                      const scopeLabel: Record<string, string> = { bundled: '内置设计', project: '项目', global: '全局' };
                      if (list.length === 0) {
                        return <p className="px-3 py-4 text-center text-xs text-zinc-400">无匹配 skill</p>;
                      }
                      return list.map((s) => {
                        const checked = selectedSkills.some((p) => p.scope === s.scope && p.rel === s.rel);
                        return (
                          <button
                            key={`${s.scope}:${s.rel}`}
                            type="button"
                            onClick={() => toggleSkill(s)}
                            className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-zinc-50"
                          >
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                              {checked && <CheckIcon size={13} className="text-violet-600" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-sm text-zinc-800">{s.name}</span>
                                <span className="shrink-0 rounded bg-zinc-100 px-1 text-[10px] text-zinc-400">
                                  {scopeLabel[s.scope] ?? s.scope}
                                </span>
                              </span>
                              <span className="block truncate text-[11px] text-zinc-400">{s.description}</span>
                            </span>
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
```

- [ ] **Step 8: 模型名常显（同一工具栏的模型按钮）**

把模型按钮里 `<span className="truncate">{model ? modelShortName(model) : '默认'}</span>` 替换为：

```tsx
                <span className="truncate">
                  {model ? modelShortName(model) : projectModel ? modelShortName(projectModel) : '全局默认'}
                </span>
                {!model && projectModel && <span className="shrink-0 text-[10px] text-zinc-300">跟随</span>}
```

- [ ] **Step 9: 类型检查 + 构建**

Run: `pnpm --filter web exec tsc -b`
Expected: 无错误（含 Task 7 的 `onSend={send}` 现已对齐三参）。

- [ ] **Step 10: Commit**

```bash
git add web/src/components/Composer.tsx
git commit -m "feat(web): Composer + 下拉(附件/引用Skill)、已选 tag、模型名常显"
```

---

## Task 9: web — MessageView 精细渲染（活动摘要 / 待办卡 / 文件 chip / 用户 skill tag）

**Files:**
- Modify: `web/src/components/MessageView.tsx`

- [ ] **Step 1: import 增补**

icons import 增 `ExternalLinkIcon, SparklesIcon`；helper import 增 `summarizeTools, writtenFilePath`：

```ts
import { activityToolCount, groupMessageParts, messageParts, summarizeTools, toolSummary, writtenFilePath } from '../lib/messageParts';
import { BrainIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, CircleXIcon, CopyIcon, ExternalLinkIcon, FileIcon, ListTodoIcon, LoaderIcon, SparklesIcon, TriangleAlertIcon, WrenchIcon } from './icons';
```

- [ ] **Step 2: 新增 TodoCard 与 FileChip 组件（放在 ToolCallCard 之后）**

```tsx
type TodoItem = { content: string; status?: string };

function parseTodos(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== 'object') return null;
  const todos = (input as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const t of todos) {
    if (!t || typeof t !== 'object') continue;
    const rec = t as Record<string, unknown>;
    const content = typeof rec.content === 'string' ? rec.content : typeof rec.text === 'string' ? rec.text : '';
    if (!content) continue;
    const status = typeof rec.status === 'string' ? rec.status : typeof rec.state === 'string' ? rec.state : undefined;
    out.push({ content, status });
  }
  return out.length > 0 ? out : null;
}

function TodoCard({ tool }: { tool: ToolCall }) {
  const todos = parseTodos(tool.input);
  if (!todos) return <ToolCallCard tool={tool} />;
  const done = (s?: string) => s === 'completed' || s === 'done';
  const active = (s?: string) => s === 'in_progress' || s === 'active' || s === 'doing';
  return (
    <div className="my-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
        <ListTodoIcon size={13} className="text-zinc-400" />
        待办清单
      </div>
      <ul className="space-y-1">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-1.5">
            {done(t.status) ? (
              <CircleCheckIcon size={13} className="mt-0.5 shrink-0 text-emerald-600" />
            ) : active(t.status) ? (
              <LoaderIcon size={13} className="mt-0.5 shrink-0 animate-spin text-zinc-400" />
            ) : (
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-zinc-300" />
            )}
            <span className={done(t.status) ? 'text-zinc-400 line-through' : 'text-zinc-700'}>{t.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileChip({ tool, projectId }: { tool: ToolCall; projectId: string }) {
  const full = writtenFilePath(tool.name, tool.input);
  if (!full) return <ToolCallCard tool={tool} />;
  const base = full.split('/').pop() ?? full;
  const pending = tool.result === undefined;
  return (
    <a
      href={api.fileUrl(projectId, full)}
      target="_blank"
      rel="noreferrer"
      title={full}
      className="my-1 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 hover:border-zinc-400"
    >
      {pending ? (
        <LoaderIcon size={13} className="shrink-0 animate-spin text-zinc-400" />
      ) : tool.isError ? (
        <CircleXIcon size={13} className="shrink-0 text-red-500" />
      ) : (
        <FileIcon size={14} className="shrink-0 text-zinc-400" />
      )}
      <span className="min-w-0 truncate font-medium">{base}</span>
      <ExternalLinkIcon size={12} className="ml-auto shrink-0 text-zinc-300" />
    </a>
  );
}

/** 单个工具按类型选渲染形态：待办→清单卡，写文件→文档 chip，其余→通用卡。 */
function ToolCell({ tool, projectId, defaultOpen }: { tool: ToolCall; projectId: string; defaultOpen?: boolean }) {
  if (tool.name && /todo/i.test(tool.name) && parseTodos(tool.input)) return <TodoCard tool={tool} />;
  if (writtenFilePath(tool.name, tool.input)) return <FileChip tool={tool} projectId={projectId} />;
  return <ToolCallCard tool={tool} defaultOpen={defaultOpen} />;
}
```

- [ ] **Step 3: ActivityBlock 接 projectId、用 summarizeTools 摘要、用 ToolCell 渲染**

`ActivityBlock` 增 `projectId` prop：

```tsx
function ActivityBlock({
  parts,
  tools,
  streaming,
  isLast,
  projectId,
}: {
  parts: MessagePart[];
  tools: ToolCall[];
  streaming?: boolean;
  isLast?: boolean;
  projectId: string;
}) {
```

单工具直铺分支改用 ToolCell：

```tsx
  if (parts.length === 1 && parts[0].kind === 'tool') {
    const tool = tools[parts[0].toolIndex];
    return tool ? <ToolCell tool={tool} projectId={projectId} /> : null;
  }
```

折叠摘要：在 `const errors = …` 之后、`return` 之前，计算块内工具的类型摘要：

```tsx
  const blockTools = parts
    .map(toolOf)
    .filter((t): t is ToolCall => !!t);
  const summary = summarizeTools(blockTools)
    .map((s) => (s.count > 1 ? `${s.verb} ×${s.count}` : s.verb))
    .join(' · ');
```

把折叠行标题那段：

```tsx
        <span className="shrink-0 font-medium text-zinc-700">
          {running ? `执行中 · ${toolCount} 步` : `执行了 ${toolCount} 步操作`}
        </span>
        <span className="truncate font-mono text-zinc-400">{hint}</span>
```

改为：

```tsx
        <span className="shrink-0 font-medium text-zinc-700">{running ? '执行中' : '已执行'}</span>
        <span className="truncate text-zinc-400">{running && hint ? hint : summary}</span>
```

展开区里工具片段渲染从 `ToolCallCard … defaultOpen` 改为 ToolCell：

```tsx
            if (p.kind === 'tool') {
              const tool = tools[p.toolIndex];
              return tool ? <ToolCell key={`tool-${p.toolIndex}`} tool={tool} projectId={projectId} defaultOpen /> : null;
            }
```

- [ ] **Step 4: MessageView 主体把 projectId 传给 ActivityBlock**

在助手分支的 `<ActivityBlock … />` 调用加 `projectId={projectId}`：

```tsx
          <ActivityBlock
            key={`activity-${block.index}`}
            parts={block.parts}
            tools={tools}
            streaming={message.streaming}
            isLast={i === blocks.length - 1}
            projectId={projectId}
          />
```

- [ ] **Step 5: 用户消息渲染引用的 skill tag**

在 `MessageView` 的 user 分支，`AttachmentList` 之后、`CopyButton` 之前插入：

```tsx
        {message.skills && message.skills.length > 0 && (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
            {message.skills.map((name, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700"
              >
                <SparklesIcon size={11} className="text-violet-400" />
                {name}
              </span>
            ))}
          </div>
        )}
```

- [ ] **Step 6: 类型检查 + 构建 + 全量测试**

Run: `pnpm --filter web exec tsc -b && pnpm --filter web test`
Expected: 无类型错误；测试全绿。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/MessageView.tsx
git commit -m "feat(web): 对话渲染重构——工具类型摘要/待办清单卡/写文件 chip/用户引用 skill tag"
```

---

## Task 10: 端到端冒烟验证

**Files:** 无（手动验证）

- [ ] **Step 1: 全量类型 + 测试**

Run: `pnpm -r test && pnpm --filter web build && pnpm --filter server build`
Expected: 全绿、构建成功。

- [ ] **Step 2: 启动并人工核对**

Run: `pnpm dev`，浏览器进入任一项目详情页，验证：
1. 底部 `+` 展开 → 「添加附件」走原上传；「引用 Skill」弹出搜索选择器，含 内置/项目/全局 分组标签。
2. 勾选两个 skill → composer 出现可移除 violet tag；逐个移除生效。
3. 发送一条带引用 skill 的消息 → tag 清空；用户气泡下出现引用 skill 名；agent 回合正常流式（首次引用某 skill 会触发一次进程重启，略慢属预期）。
4. 模型按钮在「跟随项目设置」时直接显示项目模型短名 + 灰色「跟随」；切换会话级模型后显示覆盖名。
5. 助手消息活动块折叠行显示「已执行 + 读取 ×N · 搜索 ×N…」；展开后写文件呈文档 chip（可点开预览）、TodoWrite 呈待办清单（绿勾/转圈/空圈）。

- [ ] **Step 3: 最终提交（如冒烟中有微调）**

```bash
git add -A
git commit -m "chore: 对话区 skill 引用与渲染重构联调收尾"
```

---

## Self-Review 记录

- **Spec 覆盖**：A=Task 8；B=Task 1/2/4（+Task 5 协议、Task 7 透传）；C=Task 8 Step 8；D1=Task 6+9 Step 3；D2/D3=Task 9 Step 2-3；D4=`.md` 样式已完备（Task 10 Step 2 目视核对）；引用名落盘=Task 3/4/5/7/9 Step 5。
- **类型一致**：`SkillRef`（web `{scope,rel,name}` / 后端 body `{scope,rel}`）、`ResolvedSkill {path,name,description}`、`summarizeTools→{verb,count}`、`writtenFilePath` 返回完整相对路径，全程一致。
- **占位符**：无 TBD/TODO，纯逻辑步均含完整测试码与实现码；UI/胶水步给 build+手动验证。
- **风险点**：Task 7 与 Task 8 的 `onSend` 签名跨任务更改——已在 Task 7 Step 3 注明可合并 `tsc` 验证；TodoWrite/工具名字段形态对 pi 实际输出做了防御性解析（解析失败回退 ToolCallCard）。
