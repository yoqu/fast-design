# 原型技术栈内置与 skill 库补全 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 原型生成默认 React 18 + Babel + Tailwind CDN 技术栈（系统提示词硬契约 + react-prototype 核心 skill 双层），11 个 stub skill 从上游拉取补全。

**Architecture:** 系统提示词层新增 `tech-stack.ts`（注入顺序 locale → discovery → tech-stack → metadata），承载固定版本 CDN、组件共享、交互真实性等硬契约；新建 `skills/react-prototype/` 承载 seed 模板、动效原语、设备框架、屏幕骨架与 P0 自查单；11 个 stub 由子 agent 并行从 `od.upstream` 拉取覆盖。

**Tech Stack:** TypeScript (server, vitest)、React 18.3.1 / ReactDOM 18.3.1 / @babel/standalone 7.29.0（unpkg 固定版本 + integrity）、Tailwind Play CDN 3.4.16。

**Spec:** `docs/superpowers/specs/2026-06-12-prototype-tech-stack-design.md`

**并行执行约定（重要）:**
- Wave 1 并行任务文件集互不相交：Task 1（prompts/tech-stack.ts + compose.ts + compose.test.ts）、Task 2（prompts/discovery.ts，**不得改 compose.test.ts**）、Task 3（skills/react-prototype/ + server/src/bundled-skills.test.ts）、Task 4（skills/frontend-design/SKILL.md）、Task 5.1–5.11（各自 stub 目录）。
- **子 agent 一律不执行 git commit**（避免并行 index.lock 竞争与交叉提交）；主会话在每个 wave 结束后统一验证 + 提交。
- Wave 2（Task 6 集成）在 Wave 1 全部完成后串行执行。

---

### Task 1: 系统提示词层 — tech-stack.ts + compose.ts 栈序与措辞修订

**Files:**
- Create: `server/src/prompts/tech-stack.ts`
- Modify: `server/src/prompts/compose.ts`
- Test: `server/src/prompts/compose.test.ts`

- [ ] **Step 1: 在 compose.test.ts 中先写失败测试**

修改现有 `designAppendPrompts` describe 并新增 tech-stack describe（替换原"栈序对齐参照"两个用例，新增内容断言）：

```ts
// 顶部 import 增加：
import { TECH_STACK_PROMPT } from './tech-stack.js';

describe('tech-stack prompt', () => {
  it('固定版本 CDN 与组件共享硬契约', () => {
    expect(TECH_STACK_PROMPT).toContain('react@18.3.1/umd/react.development.js');
    expect(TECH_STACK_PROMPT).toContain('react-dom@18.3.1/umd/react-dom.development.js');
    expect(TECH_STACK_PROMPT).toContain('@babel/standalone@7.29.0/babel.min.js');
    expect(TECH_STACK_PROMPT).toContain('cdn.tailwindcss.com/3.4.16');
    expect(TECH_STACK_PROMPT).toContain('Object.assign(window, {');
    expect(TECH_STACK_PROMPT).toContain('scrollIntoView');
    expect(TECH_STACK_PROMPT).toContain('css/tokens.css');
    // 降级条款存在
    expect(TECH_STACK_PROMPT).toContain('single-file / offline');
  });
});

describe('designAppendPrompts', () => {
  it('栈序：locale → discovery → tech-stack → metadata', () => {
    const parts = designAppendPrompts(META);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(UI_LOCALE_PROMPT);
    expect(parts[1]).toBe(DISCOVERY_AND_PHILOSOPHY);
    expect(parts[2]).toBe(TECH_STACK_PROMPT);
    expect(parts[3]).toContain('## Project metadata');
  });

  it('无 metadata 时省略元数据块（仍含 tech-stack）', () => {
    const parts = designAppendPrompts(undefined);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe(TECH_STACK_PROMPT);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/prompts/compose.test.ts`
Expected: FAIL — `tech-stack.js` 模块不存在 / 长度断言失败。

- [ ] **Step 3: 创建 server/src/prompts/tech-stack.ts**

完整内容（CDN 行与 integrity 哈希照抄参照 `open-design-slim/packages/contracts/src/prompts/official-system.ts:73-75`，不得改动）：

```ts
/**
 * 原型默认技术栈硬契约 — 采自 Anthropic Claude Design 系统提示词
 * （参照 open-design-slim packages/contracts/src/prompts/official-system.ts
 * 的 React+Babel 段），扩展为本应用默认栈：React 默认（而非用户点名才用），
 * Tailwind 固定版本工具类，token 走 css/tokens.css。
 * 注入位置：designAppendPrompts 的 locale → discovery → 本段 → metadata。
 */
export const TECH_STACK_PROMPT = `# Default tech stack (hard contract — applies to every prototype artifact)

Build product/app prototypes as **React prototypes by default**, not plain HTML. Entry files stay \`.html\` shells (the preview pane and exports key off HTML entries); all interactive logic lives in JSX loaded through Babel standalone.

## Pinned runtime (copy exactly — versions and integrity hashes are non-negotiable)

\`\`\`html
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
\`\`\`

Never use floating CDN URLs (\`@latest\`, unversioned). Never add \`type="module"\` to Babel scripts — it breaks transpilation.

## File layout

- One \`.html\` shell per screen (screen-file-first rule still applies). Components live in \`.jsx\` files in the project root or \`js/\`, loaded with \`<script type="text/babel" data-presets="react" src="js/components.jsx"></script>\` (same-origin XHR — works in the studio preview).
- **CRITICAL — multiple Babel files don't share scope.** Each \`<script type="text/babel">\` gets its own scope. To share components, export them at the end of the file: \`Object.assign(window, { BookingForm, StepNav, Summary });\` and read them from \`window\` in consumers.
- **CRITICAL — style-object naming.** Name style objects by component (\`const bookingStyles = { ... }\`). NEVER a bare \`const styles = { ... }\` — colliding names across files break the page. Inline styles are fine.
- Keep individual files under ~1000 lines; split into more \`.jsx\` files when approaching that.

## Styling

- Brand/design tokens live in \`css/tokens.css\` as CSS custom properties in oklch (\`--bg\`, \`--surface\`, \`--fg\`, \`--muted\`, \`--border\`, \`--accent\`). Every color in JSX/Tailwind classes must reference tokens (\`text-[color:var(--fg)]\`, \`bg-[color:var(--surface)]\`) or semantic CSS classes — never hard-coded hex scattered in components.
- Tailwind is for layout/spacing/typography utilities only; it never replaces the token system.

## Interaction reality (what "high fidelity" means here)

- Every screen containing input, generation, copying, validation, login, checkout, filtering, or any action verb MUST be built from real controlled React components — \`useState\` + handlers, working validation, real state transitions. No static rows pretending to be inputs, no prefilled-only mockups.
- Cross-screen or persistent state (current step, cart, playback position, form drafts) persists to \`localStorage\` so refreshes don't lose the user's place.
- Don't use \`scrollIntoView\` — it breaks the embedded preview. Use other DOM scroll methods.
- Mobile hit targets ≥ 44px. Slide text on a 1920×1080 canvas ≥ 24px.

## Fallback (the only exception)

Only when the user explicitly asks for a **single-file / offline** artifact, fall back to a self-contained plain HTML+CSS+JS file — all design-quality rules above still apply. Never silently downgrade to plain HTML because it feels simpler.`;
```

- [ ] **Step 4: 修改 compose.ts**

(a) import 与注入顺序：

```ts
// import 区新增：
import { TECH_STACK_PROMPT } from './tech-stack.js';

// designAppendPrompts 改为：
export function designAppendPrompts(metadata: ProjectMetadata | undefined): string[] {
  const parts = [UI_LOCALE_PROMPT, DISCOVERY_AND_PHILOSOPHY, TECH_STACK_PROMPT];
  const metaBlock = renderMetadataBlock(metadata);
  if (metaBlock) parts.push(metaBlock);
  return parts;
}
```

(b) implementation-ready UX rule 措辞 React 化 — 将 `renderMetadataBlock` 中以 `'- **implementation-ready UX rule**:` 开头的整行替换为：

```ts
  lines.push(
    '- **implementation-ready UX rule**: the artifact must be implementation-ready, not a static screenshot. Follow the default React stack contract: `.html` shells per screen, interactive logic in `.jsx` components (Babel standalone), shared tokens in `css/tokens.css`. Meaningful UX such as tabs, dialogs, drawers, filters, generation/copy actions, validation, playback controls, or state transitions must be real React state + handlers, not decorative markup.',
  );
```

(c) interaction-fidelity rule 整行替换为：

```ts
  lines.push(
    '- **interaction-fidelity rule**: when the requested screen includes user input, generation, copying, validation, login, checkout, filtering, or any action verb, build real controlled React components for that screen (useState + handlers + working state transitions). Do not substitute static text rows, prefilled-only mockups, screenshot-like device frames, or decorative state cards for editable inputs and working actions.',
  );
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && npx vitest run src/prompts/compose.test.ts`
Expected: PASS（全部用例，含既有 discovery/metadata 用例）。

- [ ] **Step 6:（主会话）提交**

```bash
git add server/src/prompts/tech-stack.ts server/src/prompts/compose.ts server/src/prompts/compose.test.ts
git commit -m "feat(prompts): 技术栈硬契约注入——React+Babel+Tailwind 固定版本默认栈"
```

---

### Task 2: discovery.ts 联动修订（React 语义）

**Files:**
- Modify: `server/src/prompts/discovery.ts`（仅此一个文件；**不得改 compose.test.ts**，避免与 Task 1 冲突）

讨论上下文：`DISCOVERY_AND_PHILOSOPHY` 是一个大模板字符串。三处修订，全部用 Edit 精确替换。注意现有测试断言文本中不得出现 `/frames/` 与 `<artifact>` 字面量——修订措辞要避开这两个字符串。

- [ ] **Step 1: "Never paste full HTML" 不变量扩展 .jsx**

将这一段：

```
## Never paste full HTML into chat (dominant-layer invariant)

Deliverables are **files written into the project directory** — the studio's preview pane picks up written HTML files automatically. Never paste a complete \`<!doctype html>\` document (or any near-complete page source) into your chat reply. After building, summarize what you wrote and changed in a few short lines instead.
```

替换为：

```
## Never paste full HTML or JSX into chat (dominant-layer invariant)

Deliverables are **files written into the project directory** — the studio's preview pane picks up written HTML files automatically. Never paste a complete \`<!doctype html>\` document, a full \`.jsx\` component file, or any near-complete page source into your chat reply. After building, summarize what you wrote and changed in a few short lines instead.
```

- [ ] **Step 2: B 节资产指向 react-prototype skill**

将 B 节中这一段：

```
Every prototype / mobile / deck skill ships:
- \`assets/template.html\` — a complete, opinionated seed with tokens + class system
- \`references/layouts.md\` — paste-ready section/screen/slide skeletons
- \`references/checklist.md\` — P0/P1/P2 self-review
```

替换为：

```
The \`react-prototype\` skill ships the canonical seed for every prototype:
- \`assets/template.html\` — a complete React shell seed (pinned CDN runtime, tokens.css link, Babel loader)
- \`assets/tokens.css\` — oklch token skeleton to copy into \`css/tokens.css\`
- \`assets/animations.jsx\` + \`assets/frames/*.jsx\` — motion primitives and device-frame components
- \`references/layouts.md\` — paste-ready React screen skeletons with state/interaction notes
- \`references/checklist.md\` — P0/P1/P2 self-review
```

- [ ] **Step 3: H 节多屏 pattern React 化**

将 H 节末尾从 `When the brief calls for showing the SAME product across multiple devices` 开始到该节结束（`side by side` 段落为止）的两段与目录树，替换为：

```
When the brief calls for showing the SAME product across multiple devices (desktop + tablet + phone) or showing MULTIPLE screens of the same app side-by-side (onboarding 1 → 2 → 3, or feed → detail → checkout), use the device-frame components from the \`react-prototype\` skill (\`assets/frames/ios-frame.jsx\`, \`android-frame.jsx\`, \`browser-window.jsx\`) — copy them into the project once and reuse per screen via \`window\`-shared components. The recommended pattern for a multi-screen prototype:

\`\`\`
project/
├── index.html             ← gallery: composes 3+ framed screens in a row
├── css/tokens.css         ← shared oklch tokens (copied from the skill seed)
├── js/
│   ├── frames.jsx         ← device-frame components (from the skill), window-shared
│   └── components.jsx     ← shared product components, window-shared
├── screens/
│   ├── 01-onboarding.html ← screen shell mounting its own root component
│   ├── 02-paywall.html
│   └── 03-home.html
\`\`\`

For cross-platform projects, keep shared tokens and components in the root \`css/\` + \`js/\` system, then create platform-specific screen shells (for example \`screens/desktop-home.html\`, \`screens/ios-home.html\`, \`screens/android-home.html\`) so reviewers can compare native adaptations side by side.
```

- [ ] **Step 4: 验证测试仍绿（不改测试文件）**

Run: `cd server && npx vitest run src/prompts/compose.test.ts`
Expected: PASS——尤其"范围裁剪"用例（措辞中不得出现 `/frames/` 字面量；上面用的是 `assets/frames/`，注意 `(\`assets/frames/ios-frame.jsx\`` 不含独立的 `/frames/`——**实际包含子串 `/frames/`！** 规避：该用例断言的是 `not.toContain('/frames/')`，而 `assets/frames/` 包含该子串，会挂）。

**修正（必须执行）**：Step 2/3 中所有 `assets/frames/` 写作 `assets » frames » ios-frame.jsx` 不可取——改为引用文件名不带路径分隔：`the frame components (\`ios-frame.jsx\`, \`android-frame.jsx\`, \`browser-window.jsx\`) under the skill's \`assets\` directory`；目录树中 `js/frames.jsx` 不受影响（无 `/frames/` 子串）。Step 2 的列表行改为：

```
- \`assets/animations.jsx\` plus the device-frame components (\`ios-frame.jsx\`, \`android-frame.jsx\`, \`browser-window.jsx\`) under the skill's assets directory — motion primitives and device frames
```

Step 3 的开头句改为：

```
... use the device-frame components from the \`react-prototype\` skill (\`ios-frame.jsx\`, \`android-frame.jsx\`, \`browser-window.jsx\`, under the skill's assets directory) — copy them into the project once ...
```

Expected: PASS。

---

### Task 3: 新建 skills/react-prototype + 资产测试

**Files:**
- Create: `skills/react-prototype/SKILL.md`
- Create: `skills/react-prototype/assets/template.html`
- Create: `skills/react-prototype/assets/tokens.css`
- Create: `skills/react-prototype/assets/animations.jsx`
- Create: `skills/react-prototype/assets/frames/ios-frame.jsx`
- Create: `skills/react-prototype/assets/frames/android-frame.jsx`
- Create: `skills/react-prototype/assets/frames/browser-window.jsx`
- Create: `skills/react-prototype/references/layouts.md`
- Create: `skills/react-prototype/references/checklist.md`
- Test: `server/src/bundled-skills.test.ts`（新建）

- [ ] **Step 1: 写失败测试 server/src/bundled-skills.test.ts**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILLS_ROOT = path.resolve(import.meta.dirname, '../../skills');

describe('bundled react-prototype skill', () => {
  const root = path.join(SKILLS_ROOT, 'react-prototype');
  it.each([
    'SKILL.md',
    'assets/template.html',
    'assets/tokens.css',
    'assets/animations.jsx',
    'assets/frames/ios-frame.jsx',
    'assets/frames/android-frame.jsx',
    'assets/frames/browser-window.jsx',
    'references/layouts.md',
    'references/checklist.md',
  ])('携带 %s', (rel) => {
    expect(fs.existsSync(path.join(root, rel))).toBe(true);
  });

  it('seed 模板使用固定版本 CDN 且组件经 window 暴露', () => {
    const html = fs.readFileSync(path.join(root, 'assets/template.html'), 'utf8');
    expect(html).toContain('react@18.3.1/umd/react.development.js');
    expect(html).toContain('@babel/standalone@7.29.0/babel.min.js');
    expect(html).toContain('cdn.tailwindcss.com/3.4.16');
    expect(html).not.toContain('type="module"');
    const anims = fs.readFileSync(path.join(root, 'assets/animations.jsx'), 'utf8');
    expect(anims).toContain('Object.assign(window,');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/bundled-skills.test.ts`
Expected: FAIL（文件不存在）。

- [ ] **Step 3: 写 SKILL.md**

```markdown
---
name: react-prototype
description: |
  Default tech-stack skill for every product/app prototype: React 18 + Babel
  standalone + Tailwind CDN (pinned versions), html-shell-per-screen with
  window-shared JSX components, oklch token system, motion primitives, and
  iOS/Android/browser device frames. Read this skill's seed, layouts, and
  checklist before writing any prototype code.
triggers:
  - "react prototype"
  - "app prototype"
  - "multi-screen prototype"
  - "interactive prototype"
od:
  mode: prototype
  category: web-artifacts
---

# react-prototype

每个产品/应用原型的默认技术栈承载者。**阅读顺序（不可跳过）**：
`assets/template.html` → `references/layouts.md` → `references/checklist.md`。
不要从零写壳与 CSS——拷贝 seed、替换 token、粘贴骨架。

## 组件拆分模式

- 屏 = `.html` 壳（screen-file-first），组件 = `.jsx` 文件（项目根或 `js/`）。
- 每个 `<script type="text/babel">` 作用域独立：共享组件文件末尾必须
  `Object.assign(window, { ComponentA, ComponentB })`，消费方从 `window` 读取。
- 样式对象按组件命名（`const bookingStyles = {...}`），禁止裸 `const styles`。
- 单文件接近 1000 行就拆。`data-presets="react"`，禁 `type="module"`。

## 状态约定

- 受控输入优先：表单/筛选/搜索一律 `useState` + onChange + 校验。
- 状态尽量局部；跨屏与持久状态（当前步骤、购物车、播放位置、表单草稿）
  写 `localStorage`，刷新不丢。
- 列表/详情/结算等流转用真实条件渲染表达，不做假跳转截图。

## 变体探索

- 用户在探索期：给 3 个差异化变体（混合"按规范"与突破方向），
  **单文件 + 顶部开关切换**，不要复制多份文件。
- 原型迭代期：在现有页面上 tweak，优先于新开文件。

## 动效

- 先用 `assets/animations.jsx` 原语（Stage/Sprite/useTime/Easing/interpolate）。
- 复杂时间线/滚动联动升级 gsap-core skill。
- 动画只用 transform/opacity；禁 `scrollIntoView`。

## 设备框架

- 移动端原型必须套 `assets/frames/` 组件（iOS/Android），桌面演示可用
  browser-window。外框 `transform: scale()` 自适应视口，内容固定逻辑尺寸
  （iPhone 393×852、Pixel 412×915）。
- 拷贝 frames 文件进项目 `js/` 后经 `window` 共享，不要内联重写。

## 降级条款

仅当用户明确要求"单文件 / 离线可用"时退回自包含纯 HTML；设计质量规则不变。
```

- [ ] **Step 4: 写 assets/tokens.css**

```css
/* oklch token 骨架 — 拷贝到项目 css/tokens.css 后按 brand-spec/direction 重绑。
   六色契约：bg/surface/fg/muted/border/accent。颜色只能从这里引用。 */
:root {
  --bg: oklch(98% 0.005 250);
  --surface: oklch(100% 0 0);
  --fg: oklch(22% 0.02 250);
  --muted: oklch(55% 0.02 250);
  --border: oklch(90% 0.01 250);
  --accent: oklch(58% 0.16 250);
  --accent-fg: oklch(99% 0.01 250);
  --radius: 10px;
  --shadow: 0 1px 2px oklch(20% 0.02 250 / 0.06), 0 8px 24px oklch(20% 0.02 250 / 0.08);
  --font-display: ui-serif, Georgia, serif;   /* [REPLACE] direction 的 display 字体 */
  --font-body: ui-sans-serif, system-ui, sans-serif; /* [REPLACE] body 字体 */
  --font-mono: ui-monospace, SFMono-Regular, monospace;
}
```

- [ ] **Step 5: 写 assets/template.html**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>[REPLACE] 屏幕标题</title>
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
<link rel="stylesheet" href="css/tokens.css" />
<style>
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-body); }
  .boot-fallback { display: grid; place-items: center; min-height: 100vh; color: var(--muted); font-size: 14px; }
</style>
</head>
<body>
<div id="root"><div class="boot-fallback">正在加载 React 运行时…（需要网络访问 unpkg.com）</div></div>
<noscript><div class="boot-fallback">此原型需要启用 JavaScript。</div></noscript>

<!-- 共享组件文件：消费前先加载；文件末尾 Object.assign(window, {...}) 暴露 -->
<!-- <script type="text/babel" data-presets="react" src="js/components.jsx"></script> -->

<script type="text/babel" data-presets="react">
const { useState, useEffect } = React;

function App() {
  // [REPLACE] 真实受控状态：表单/步骤/筛选…… 持久状态写 localStorage
  const [step, setStep] = useState(() => Number(localStorage.getItem('demo:step') || 0));
  useEffect(() => { localStorage.setItem('demo:step', String(step)); }, [step]);
  const appStyles = { wrap: { maxWidth: 960, margin: '0 auto', padding: 24 } };
  return (
    <main style={appStyles.wrap}>
      {/* [REPLACE] 从 references/layouts.md 粘贴屏幕骨架 */}
      <h1 className="text-2xl" style={{ fontFamily: 'var(--font-display)' }}>[REPLACE]</h1>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>
```

- [ ] **Step 6: 写 assets/animations.jsx**

```jsx
/* 动效原语 — Stage / Sprite / useTime / useSprite / Easing / interpolate
   用法：<Stage duration={6}><Sprite start={0} end={2}>…</Sprite></Stage>
   消费方从 window 读取。仅 transform/opacity 动画。 */
const { useState, useEffect, useRef, useContext, createContext } = React;

const TimeContext = createContext({ t: 0, duration: 0, playing: false });

function useTime() { return useContext(TimeContext); }

const Easing = {
  linear: (x) => x,
  easeIn: (x) => x * x,
  easeOut: (x) => 1 - (1 - x) * (1 - x),
  easeInOut: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  spring: (x) => 1 - Math.cos(x * Math.PI * 2.5) * Math.exp(-x * 5),
};

function interpolate(t, [t0, t1], [v0, v1], ease = Easing.linear) {
  if (t1 === t0) return v1;
  const p = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return v0 + (v1 - v0) * ease(p);
}

/** 固定逻辑画布 + scale-to-fit + 播放/暂停 + 拖动条。 */
function Stage({ width = 1280, height = 720, duration = 8, loop = true, children, style }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scale, setScale] = useState(1);
  const hostRef = useRef(null);
  const raf = useRef(0);
  const last = useRef(0);

  useEffect(() => {
    const fit = () => {
      const el = hostRef.current;
      if (el) setScale(Math.min(el.clientWidth / width, el.clientHeight / height));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [width, height]);

  useEffect(() => {
    if (!playing) return undefined;
    const tick = (now) => {
      if (!last.current) last.current = now;
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        return next > duration ? (loop ? next % duration : duration) : next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); last.current = 0; };
  }, [playing, duration, loop]);

  const stageStyles = {
    host: { position: 'relative', width: '100%', height: '100%', minHeight: 320, overflow: 'hidden', ...style },
    canvas: { position: 'absolute', left: '50%', top: '50%', width, height, transform: `translate(-50%, -50%) scale(${scale})` },
    bar: { position: 'absolute', left: 12, right: 12, bottom: 10, display: 'flex', gap: 8, alignItems: 'center', opacity: 0.85 },
  };
  return (
    <TimeContext.Provider value={{ t, duration, playing }}>
      <div ref={hostRef} style={stageStyles.host}>
        <div style={stageStyles.canvas}>{children}</div>
        <div style={stageStyles.bar}>
          <button type="button" aria-label={playing ? '暂停' : '播放'} onClick={() => setPlaying((p) => !p)}
            style={{ minWidth: 44, minHeight: 44, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
            {playing ? '⏸' : '▶'}
          </button>
          <input type="range" min={0} max={duration} step={0.01} value={t} aria-label="时间轴"
            onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} style={{ flex: 1 }} />
        </div>
      </div>
    </TimeContext.Provider>
  );
}

/** 帧范围内渲染子节点；progress 0→1。enter/exit 用 opacity+transform。 */
function Sprite({ start = 0, end = Infinity, fade = 0.25, children, style }) {
  const { t } = useTime();
  if (t < start || t >= end) return null;
  const fin = interpolate(t, [start, start + fade], [0, 1], Easing.easeOut);
  const fout = end === Infinity ? 1 : interpolate(t, [end - fade, end], [1, 0], Easing.easeIn);
  const opacity = Math.min(fin, fout);
  return <div style={{ opacity, transform: `translateY(${(1 - opacity) * 8}px)`, ...style }}>{children}</div>;
}

function useSprite(start, end) {
  const { t } = useTime();
  const active = t >= start && t < end;
  const progress = interpolate(t, [start, end], [0, 1]);
  return { active, progress, t };
}

Object.assign(window, { Stage, Sprite, useTime, useSprite, Easing, interpolate });
```

- [ ] **Step 7: 写 assets/frames/ios-frame.jsx**

```jsx
/* iPhone 外框（Dynamic Island / 状态栏 / Home indicator）。
   内容逻辑尺寸 393×852，外框 transform:scale() 自适应。 */
const { useState: useStateIos, useEffect: useEffectIos, useRef: useRefIos } = React;

function IosFrame({ children, label, time = '9:41' }) {
  const W = 393, H = 852, BEZEL = 12;
  const hostRef = useRefIos(null);
  const [scale, setScale] = useStateIos(1);
  useEffectIos(() => {
    const fit = () => {
      const el = hostRef.current;
      if (el) setScale(Math.min(1, el.clientWidth / (W + BEZEL * 2)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const iosStyles = {
    host: { width: '100%', display: 'grid', justifyItems: 'center', gap: 8 },
    device: {
      width: W + BEZEL * 2, height: H + BEZEL * 2, borderRadius: 56, background: '#0c0c0e',
      boxShadow: 'var(--shadow)', transform: `scale(${scale})`, transformOrigin: 'top center',
    },
    screen: {
      position: 'relative', width: W, height: H, margin: BEZEL, borderRadius: 46,
      overflow: 'hidden', background: 'var(--bg)',
    },
    statusBar: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 54, zIndex: 50,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0 28px', fontSize: 15, fontWeight: 600, color: 'var(--fg)', pointerEvents: 'none',
    },
    island: {
      position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
      width: 122, height: 36, borderRadius: 20, background: '#000', zIndex: 60,
    },
    content: { position: 'absolute', inset: 0, paddingTop: 54, paddingBottom: 34, overflowY: 'auto' },
    homeBar: {
      position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
      width: 140, height: 5, borderRadius: 3, background: 'var(--fg)', opacity: 0.9, zIndex: 50,
    },
  };
  return (
    <figure ref={hostRef} style={iosStyles.host}>
      <div style={iosStyles.device}>
        <div style={iosStyles.screen}>
          <div style={iosStyles.island} />
          <div style={iosStyles.statusBar}>
            <span>{time}</span>
            <svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true">
              <rect x="0" y="3" width="3" height="8" rx="1" fill="currentColor" />
              <rect x="5" y="2" width="3" height="9" rx="1" fill="currentColor" />
              <rect x="10" y="1" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="15" y="0" width="3" height="11" rx="1" fill="currentColor" />
              <path d="M26 4c2.8-2.7 7.2-2.7 10 0l-1.6 1.7a5.6 5.6 0 0 0-6.8 0L26 4z" fill="currentColor" />
              <rect x="42" y="1" width="18" height="11" rx="3" fill="none" stroke="currentColor" />
              <rect x="44" y="3" width="11" height="7" rx="1.5" fill="currentColor" />
              <rect x="60.5" y="4.5" width="1.5" height="4" rx="0.7" fill="currentColor" />
            </svg>
          </div>
          <div style={iosStyles.content}>{children}</div>
          <div style={iosStyles.homeBar} />
        </div>
      </div>
      {label ? <figcaption style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</figcaption> : null}
    </figure>
  );
}

Object.assign(window, { IosFrame });
```

- [ ] **Step 8: 写 assets/frames/android-frame.jsx**

与 IosFrame 同构（hook 别名 useStateAnd/useEffectAnd/useRefAnd 防作用域冲突）：逻辑尺寸 412×915、`borderRadius: 36/28`、顶部打孔摄像头（居中 12px 圆）、状态栏左时间右图标、底部手势条（宽 108、高 4）、Material 字重 500。文件末尾 `Object.assign(window, { AndroidFrame });`。完整结构照 Step 7 改写，样式对象命名 `androidStyles`。

```jsx
/* Pixel 外框（打孔摄像头 / 状态栏 / 手势条）。逻辑尺寸 412×915。 */
const { useState: useStateAnd, useEffect: useEffectAnd, useRef: useRefAnd } = React;

function AndroidFrame({ children, label, time = '10:08' }) {
  const W = 412, H = 915, BEZEL = 10;
  const hostRef = useRefAnd(null);
  const [scale, setScale] = useStateAnd(1);
  useEffectAnd(() => {
    const fit = () => {
      const el = hostRef.current;
      if (el) setScale(Math.min(1, el.clientWidth / (W + BEZEL * 2)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const androidStyles = {
    host: { width: '100%', display: 'grid', justifyItems: 'center', gap: 8 },
    device: {
      width: W + BEZEL * 2, height: H + BEZEL * 2, borderRadius: 36, background: '#101013',
      boxShadow: 'var(--shadow)', transform: `scale(${scale})`, transformOrigin: 'top center',
    },
    screen: {
      position: 'relative', width: W, height: H, margin: BEZEL, borderRadius: 28,
      overflow: 'hidden', background: 'var(--bg)',
    },
    camera: {
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      width: 12, height: 12, borderRadius: '50%', background: '#000', zIndex: 60,
    },
    statusBar: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 40, zIndex: 50,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0 18px', fontSize: 14, fontWeight: 500, color: 'var(--fg)', pointerEvents: 'none',
    },
    content: { position: 'absolute', inset: 0, paddingTop: 40, paddingBottom: 28, overflowY: 'auto' },
    gestureBar: {
      position: 'absolute', bottom: 9, left: '50%', transform: 'translateX(-50%)',
      width: 108, height: 4, borderRadius: 2, background: 'var(--fg)', opacity: 0.85, zIndex: 50,
    },
  };
  return (
    <figure ref={hostRef} style={androidStyles.host}>
      <div style={androidStyles.device}>
        <div style={androidStyles.screen}>
          <div style={androidStyles.camera} />
          <div style={androidStyles.statusBar}>
            <span>{time}</span>
            <svg width="50" height="14" viewBox="0 0 50 14" aria-hidden="true">
              <path d="M1 13 L11 13 L11 1 Z" fill="currentColor" />
              <path d="M16 6c2.4-2.3 6.2-2.3 8.6 0l-1.4 1.5a4.8 4.8 0 0 0-5.8 0L16 6z" fill="currentColor" />
              <rect x="30" y="2" width="7" height="11" rx="1.5" fill="none" stroke="currentColor" />
              <rect x="31.5" y="6" width="4" height="6" fill="currentColor" />
            </svg>
          </div>
          <div style={androidStyles.content}>{children}</div>
          <div style={androidStyles.gestureBar} />
        </div>
      </div>
      {label ? <figcaption style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</figcaption> : null}
    </figure>
  );
}

Object.assign(window, { AndroidFrame });
```

- [ ] **Step 9: 写 assets/frames/browser-window.jsx**

```jsx
/* 桌面浏览器窗口铬（红绿灯 / 地址栏）。内容自适应宽度。 */
function BrowserWindow({ children, url = 'example.com', label }) {
  const browserStyles = {
    host: { width: '100%', display: 'grid', gap: 8 },
    window: {
      borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)',
      background: 'var(--surface)', boxShadow: 'var(--shadow)',
    },
    chrome: {
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      borderBottom: '1px solid var(--border)', background: 'var(--bg)',
    },
    lights: { display: 'flex', gap: 7 },
    light: (c) => ({ width: 12, height: 12, borderRadius: '50%', background: c }),
    address: {
      flex: 1, maxWidth: 480, margin: '0 auto', padding: '5px 14px', borderRadius: 8,
      background: 'var(--surface)', border: '1px solid var(--border)',
      color: 'var(--muted)', fontSize: 13, textAlign: 'center',
      fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden',
    },
    body: { minHeight: 360, background: 'var(--bg)' },
  };
  return (
    <figure style={browserStyles.host}>
      <div style={browserStyles.window}>
        <div style={browserStyles.chrome}>
          <div style={browserStyles.lights}>
            <span style={browserStyles.light('#ff5f57')} />
            <span style={browserStyles.light('#febc2e')} />
            <span style={browserStyles.light('#28c840')} />
          </div>
          <div style={browserStyles.address}>{url}</div>
          <div style={{ width: 54 }} />
        </div>
        <div style={browserStyles.body}>{children}</div>
      </div>
      {label ? <figcaption style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</figcaption> : null}
    </figure>
  );
}

Object.assign(window, { BrowserWindow });
```

- [ ] **Step 10: 写 references/layouts.md**

内容为 paste-ready React 骨架，至少含以下 6 个骨架（每个一段代码 + 状态注记）。骨架代码风格与 template.html 一致（受控状态 + localStorage 持久 + token 引用）：

1. **预约/结算分步流**（步骤指示、表单校验、提交确认；`useState` step + `localStorage` 草稿）
2. **Feed → 详情**（列表筛选、条件渲染详情、返回保持滚动位）
3. **仪表盘**（指标卡 + 表格 + 时间范围筛选，monospace 数字）
4. **Onboarding 序列**（3 屏轮播、跳过/下一步、完成态写 localStorage）
5. **设置页**（开关/单选受控组、危险操作确认对话框）
6. **营销落地页 hero + 定价**（CTA 表单真实校验）

每个骨架以 `### 骨架 N：<名称>` 开头、含"适用/状态/交互注记"三行说明 + 完整 JSX 代码块。落地时由执行 agent 按上述规格撰写（每个 40-80 行，受控逻辑必须真实可运行，不得用 `// TODO` 占位）。

- [ ] **Step 11: 写 references/checklist.md**

```markdown
# react-prototype 自查单

## P0（任一不过不得交付）
- [ ] 所有共享组件文件末尾 `Object.assign(window, {...})`；消费方无裸引用未暴露组件
- [ ] 无 `scrollIntoView` 调用
- [ ] 含动作动词的屏幕全部为真实受控组件（输入可打字、校验可触发、状态可流转）
- [ ] 360px 视口无横向滚动
- [ ] CDN 四件套版本与 integrity 与契约完全一致；无 `@latest`、无 `type="module"`
- [ ] 样式对象按组件命名，无 `const styles = {`
- [ ] 颜色全部引用 css/tokens.css 的 token；无散落硬编码 hex
- [ ] 触控目标 ≥ 44px；移动屏套设备框架组件

## P1
- [ ] 跨屏/持久状态写 localStorage，刷新不丢
- [ ] hover/focus/active/disabled 四态齐全
- [ ] 单文件 < 1000 行
- [ ] 动画仅 transform/opacity
- [ ] 空/加载/错误态有真实呈现

## P2
- [ ] `text-wrap: pretty`、container queries 等现代 CSS 用在该用的地方
- [ ] 键盘可达：对话框 Esc 关闭、表单 Enter 提交
- [ ] 诚实占位（`—`/灰块/标注 stub）而非编造数据
```

- [ ] **Step 12: 运行测试确认通过**

Run: `cd server && npx vitest run src/bundled-skills.test.ts`
Expected: PASS。

- [ ] **Step 13:（主会话）提交**

```bash
git add skills/react-prototype server/src/bundled-skills.test.ts
git commit -m "feat(skills): react-prototype 核心技术栈 skill——seed/动效/设备框架/骨架/自查单"
```

---

### Task 4: frontend-design 默认栈条款修订

**Files:**
- Modify: `skills/frontend-design/SKILL.md`

- [ ] **Step 1: 替换第 4 条的纯 HTML 默认条款**

将：

```
   - For standalone artifacts, create self-contained HTML/CSS/JS unless the user asked for a framework.
```

替换为：

```
   - For standalone artifacts, follow the default React prototype stack (see the `react-prototype` skill: html shell per screen, JSX components via pinned Babel CDN, tokens in css/tokens.css). Only fall back to a self-contained plain HTML/CSS/JS file when the user explicitly asks for a single-file or offline artifact.
```

- [ ] **Step 2: 验证替换生效**

Run: `grep -n "react-prototype" skills/frontend-design/SKILL.md`
Expected: 输出第 4 条所在行。

- [ ] **Step 3:（主会话）提交**

```bash
git add skills/frontend-design/SKILL.md
git commit -m "docs(skills): frontend-design 默认栈改为 React 原型栈"
```

---

### Task 5（×11 并行子任务）: stub skill 上游补全

**目标 stub 与上游（每个为一个独立子 agent，文件集 = 各自目录）：**

| # | 目录 | 上游 |
|---|------|------|
| 5.1 | `skills/web-artifacts-builder` | https://github.com/anthropics/skills → `skills/web-artifacts-builder` |
| 5.2 | `skills/brand-guidelines` | https://github.com/anthropics/skills → `skills/brand-guidelines` |
| 5.3 | `skills/theme-factory` | https://github.com/anthropics/skills → `skills/theme-factory` |
| 5.4 | `skills/web-design-guidelines` | https://github.com/vercel-labs/skills（仓内查同名 skill 目录） |
| 5.5 | `skills/frontend-dev` | https://github.com/MiniMax-AI/skills（仓内查同名） |
| 5.6 | `skills/enhance-prompt` | https://github.com/google-labs-code/skills（仓内查同名） |
| 5.7 | `skills/artifacts-builder` | https://github.com/ComposioHQ/awesome-claude-skills → `artifacts-builder` |
| 5.8 | `skills/ui-skills` | https://github.com/ibelick/ui-skills |
| 5.9 | `skills/ui-ux-pro-max` | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| 5.10 | `skills/color-expert` | https://github.com/meodai/skill.color-expert |
| 5.11 | `skills/design-review` | https://github.com/garrytan/gstack（仓内查 design-review skill） |

**每个子任务的统一步骤（以 5.1 为模板，其余替换目录/上游）：**

- [ ] **Step 1: 记录本地 od: frontmatter**

Run: `sed -n '1,20p' skills/web-artifacts-builder/SKILL.md`
记下 `od:` 块（mode/category/upstream）与 frontmatter 的 `name`。

- [ ] **Step 2: 浅克隆上游到临时目录**

```bash
T=$(mktemp -d) && git clone --depth 1 https://github.com/anthropics/skills "$T/repo"
```

若克隆失败（仓库不存在/网络不可达），重试一次；仍失败 → 走 Step 6 删除分支。

- [ ] **Step 3: 定位 skill 目录**

upstream URL 含 `tree/main/<path>` 的直接用该 path；指仓库根的，在仓内查找：

```bash
find "$T/repo" -iname "SKILL.md" | xargs grep -li "<stub 名或同义词>" 
```

人工判断最匹配目录（对照 stub 的 description）。找不到含 SKILL.md 的匹配目录 → 走 Step 6。

- [ ] **Step 4: 整目录覆盖 + frontmatter 合并**

```bash
SRC="$T/repo/skills/web-artifacts-builder"   # Step 3 定位结果
DST="skills/web-artifacts-builder"
find "$DST" -mindepth 1 -delete
cp -R "$SRC/." "$DST/"
```

然后编辑 `DST/SKILL.md` frontmatter：`name` 改回与目录名一致；若上游 frontmatter 无 `od:` 块，把 Step 1 记录的 `od:` 块（mode/category/upstream 三键）追加到 frontmatter 末尾（`---` 之前）。上游正文不动。

- [ ] **Step 5: 轻量适配（只修坏的部分）**

通读 SKILL.md，仅替换以下两类硬指令（不重写、不删减工艺内容）：
- claude.ai/Claude Code 专属工具调用指令（如 `repl` 工具、artifacts 上传指令、`window.claude.complete` 教程）→ 改为本应用语义（"写入项目目录的 HTML/JSX 文件，预览自动拾取"）或删除该单句。
- 指向上游仓内不存在于本目录的相对路径 → 修正或删除该引用。

记录适配点清单（之后汇总进 commit message）。

- [ ] **Step 6:（仅拉取失败时）删除并记录**

```bash
git rm -r skills/<目录名>
```

在最终报告中记录：目录、上游 URL、失败原因。

- [ ] **Step 7: 验证非空壳**

Run: `grep -c "catalogue entry" skills/web-artifacts-builder/SKILL.md`
Expected: `0`（grep 退出码 1）。且 `wc -l` 显著大于 42。

**（主会话）Wave 1 结束后统一提交全部 11 个目录：**

```bash
git add skills/
git commit -m "feat(skills): 11 个 stub skill 从上游拉取补全（失败名单见正文）"
```

---

### Task 6: 集成验证（Wave 2，串行）

**Files:**
- Modify: `server/src/bundled-skills.test.ts`（追加 no-stub 断言）
- Modify: 记忆文件 `bundled-design-skills.md`（更新 skill 库描述）

- [ ] **Step 1: 追加 no-stub 测试**

在 `server/src/bundled-skills.test.ts` 追加：

```ts
describe('bundled skills 不含空壳', () => {
  it('所有 SKILL.md 均无 catalogue-entry 正文', () => {
    const dirs = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dirs) {
      const p = path.join(SKILLS_ROOT, d.name, 'SKILL.md');
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, 'utf8');
      expect(text, `${d.name} 仍是空壳目录卡片`).not.toContain('This catalogue entry advertises');
    }
  });
});
```

- [ ] **Step 2: 全量测试**

Run: `cd server && npx vitest run`
Expected: 全部 PASS（含既有 pi-skills、claude-design-import 等套件——确认 stub 覆盖没有破坏 listSkills 解析：上游 frontmatter 必须仍可被 `parseFrontmatter` 读出 name/description）。

- [ ] **Step 3: template.html 冒烟（手动级）**

```bash
cd /tmp && mkdir -p smoke/css && cp <repo>/skills/react-prototype/assets/template.html smoke/index.html && cp <repo>/skills/react-prototype/assets/tokens.css smoke/css/tokens.css && cd smoke && python3 -m http.server 8765
```

浏览器/headless 打开 `http://localhost:8765`，确认 root 挂载（出现 `[REPLACE]` 标题而非 loading 文案）、console 无错误。

- [ ] **Step 4: pi-skills 边界验证**

Run: `cd server && npx vitest run src/pi-skills.test.ts`
Expected: PASS。另人工确认 `webui-settings.json` 中 `bundledSkillsDisabled` 含已删除目录名时 listSkills 不抛错（如有 stub 被删）。

- [ ] **Step 5: 更新记忆文件 bundled-design-skills.md**

更新 `~/.claude/projects/.../memory/bundled-design-skills.md`：skill 数量与构成（17→补全后实际数 + react-prototype）、双层架构（tech-stack.ts 契约 + react-prototype skill）、stub 已补全的事实。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "test: bundled skills 空壳防回归 + 集成验证收尾"
```

---

## 验收（对照 spec）

- [ ] `designAppendPrompts` 四段栈序，tech-stack 契约含固定版本 CDN 全家桶
- [ ] react-prototype skill 9 个文件齐全且测试覆盖
- [ ] `skills/` 无 catalogue-entry 空壳；拉取失败的（如有）已删除并记录名单
- [ ] template.html 冒烟通过（root 挂载、console 干净）
- [ ] 全量 vitest 绿
