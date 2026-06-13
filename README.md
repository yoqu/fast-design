<div align="center">

<img src="docs/images/banner.png" alt="fast-design" width="100%" />

# fast-design

**用对话做产品原型 —— 描述你想要的产品，AI agent 在浏览器里实时设计并生成可交互的高保真原型。**

**Design product prototypes by chatting — describe the product you want and an AI agent builds a clickable, high-fidelity prototype in your browser in real time.**

[English](#english) · [中文](#中文)

</div>

---

<a name="english"></a>

## English

**fast-design** is an AI product-prototyping tool. Instead of dragging boxes around in a design editor, you describe the product you want in plain language, and an AI agent designs and builds a real, clickable, high-fidelity prototype for you — pages, layout, styling, and interactions included. The result renders live in a preview pane as it's written, you refine it by continuing the conversation, and when it's ready you export or hand it off to engineering.

**Who it's for:** product managers, designers, and founders who need to turn an idea into something clickable and reviewable — fast — without writing code or learning a design tool.

**What you get:** not a static mockup, but a working HTML prototype you can click through, preview at phone / tablet / desktop sizes, and export as HTML, PDF, ZIP (with a developer hand-off package), or an image snapshot.

It's powered by the [pi agent framework](https://pi.dev): each project runs a long-lived agent in its own isolated workspace, and the agent writes real files you can inspect, edit, and ship.

<img src="docs/images/hero.png" alt="fast-design UI" width="100%" />

### How it works

<img src="docs/images/workflow.png" alt="workflow" width="100%" />

```
Describe  ──▶  Generate  ──▶  Preview & iterate  ──▶  Hand off
   │             │                  │                     │
 tell the      the agent        click through the     export HTML / PDF /
 agent your    designs &        prototype, resize     ZIP (+ dev handoff) /
 product       writes files     to phone/tablet,      image — or keep
 idea                           refine by chatting    chatting to refine
```

### Features

- **Multi-project management** — every prototype gets its own isolated workspace directory; the agent works inside it as its current directory, so projects never bleed into each other.
- **Conversational design** — talk to a long-lived `pi --mode rpc` agent that streams its text, thinking, and tool calls; context carries across turns, so "make the header sticky" or "try a darker palette" just works.
- **Interactive, multi-device preview** — the prototype renders live in a sandboxed preview as the agent writes it, with viewport presets (desktop full-width / tablet 820×1180 / phone 390×844), zoom (50–200%), refresh, and open-in-new-window. The preview auto-refreshes on every file change (fs.watch + SSE) behind a scoped, ephemeral-token URL with CSP and `sandbox="allow-scripts allow-forms"`.
- **Artifact system** — each prototype screen is described by an `<entry>.artifact.json` sidecar manifest (schema v1); HTML without a sidecar is inferred via legacy rules; newly generated screens auto-open as a preview tab.
- **Workspace tabs** — open multiple prototype files as tabs (persisted to localStorage) alongside the fixed file-tree tab.
- **Generation stage** — while the agent works, the preview area shows a three-step progress (understand → generate → prepare preview) with live activity and per-file write states; failed turns are retryable.
- **File management panel** — semantic sections (HTML / stylesheets / code / docs / images), breadcrumb navigation, inline rename (with linked sidecar migration), multi-select bulk delete, and button / drag-and-drop upload.
- **Export & developer hand-off** — per manifest exports: single-file HTML; PDF (print handshake — waits for fonts / images / CSS backgrounds before printing); ZIP including `DESIGN-HANDOFF.md` + `DESIGN-MANIFEST.json` hand-off artifacts for engineering; PNG / JPEG / WebP snapshots (iframe-injected SVG foreignObject snapshot bridge); and a full project-archive ZIP (with `?root=` subdirectory scoping).
- **Persistent history** — conversation history is saved under the project directory and survives page reloads, so you can pick a prototype back up where you left off.

### Prerequisites

- Node.js ≥ 20, pnpm
- [pi CLI](https://pi.dev) installed and configured (`pi` on `PATH`, provider API key set)

### Getting started

```bash
pnpm install
pnpm dev        # starts server (4400) and web (5173) together
```

Open http://localhost:5173 (if 5173 is taken, Vite picks another port — check the terminal output).

### Architecture

```
web/      Vite + React 18 + Tailwind v4
  src/components/   Sidebar / ChatPanel / MessageView / Composer /
                    Workspace (tabs) / FileViewer (viewport + zoom + export) /
                    FilesPanel (file management) / GenerationStage / ExportMenu
  src/lib/          API wrappers, NDJSON stream parsing, artifact types,
                    exports (HTML/PDF/ZIP/snapshot) / zip (store-mode ZIP encoder) /
                    srcdoc / generation model
server/   Express + TypeScript
  src/pi-session.ts      one long-lived pi RPC child process per project
                         (auto --continue recovery on crash)
  src/pi-events.ts       pi RPC events → UI events mapping (pure, tested)
  src/projects.ts        project CRUD, history, file listing, path safety
  src/artifacts.ts       artifact manifest parse / infer / list
  src/files.ts           file CRUD + sidecar linkage (rename migrates manifest)
  src/preview-scopes.ts  preview scope token minting / verification
  src/bridges.ts         snapshot bridge injection
  src/watch.ts           file-change watcher (debounce + refcount)
  src/index.ts           HTTP routes: chat (NDJSON stream) / events (SSE) /
                         artifacts / file CRUD / preview-url + scoped preview /
                         export (?root)
data/projects/<id>/      project workspace (agent's cwd); .webui/ holds metadata + history
skills/   Bundled design-skill library (17): the frontend-design /
          artifacts-builder / ui-skills / taste-skill chain that gives the
          agent its prototyping craft. On session start, pi runs with
          `--no-skills` (disables global ~/.pi/agent/skills auto-discovery)
          plus `--skill <dir>` to inject only these design skills and any
          project-level skills enabled in data/webui-settings.json.
```

> The prototype flow — artifact system, file management, preview surface, export tweaks — is a behavior-level 1:1 re-creation of `open-design`. Other subsystems (plugin marketplace, design-system library, Live Artifacts, comment annotations) are intentionally out of scope.

### Testing

```bash
pnpm test     # server + web vitest: event mapping, project/file CRUD, manifest,
              # scope token, bridge injection, export builders, generation model
pnpm build    # type-check + frontend build
```

Design docs live under `docs/superpowers/specs/`.

---

<a name="中文"></a>

## 中文

**fast-design** 是一个 AI 产品原型设计工具。你不用在设计软件里拖拽控件，而是用大白话描述想要的产品，AI agent 替你把一个**真实、可点击、高保真的交互原型**设计并生成出来——页面、布局、样式、交互一应俱全。生成过程在右侧预览区实时渲染，你通过继续对话来打磨它，满意后导出或交接给研发。

**适合谁：** 产品经理、设计师、创业者——任何需要把一个想法**快速**变成可点击、可评审的原型，又不想写代码、不想学设计工具的人。

**你得到的是什么：** 不是一张静态稿，而是一个能真正点进去的 HTML 原型，可以在手机 / 平板 / 桌面尺寸下预览，并导出为 HTML、PDF、ZIP（含研发交接包）或图片快照。

底层由 [pi agent 框架](https://pi.dev) 驱动：每个项目在独立工作区里跑一个长驻 agent，agent 写出的是你可以查看、编辑、交付的真实文件。

### 工作流程

```
描述需求  ──▶  生成原型  ──▶  预览 & 迭代  ──▶  交接
   │            │                │                │
 告诉 agent    agent 设计并     点进原型试用、     导出 HTML / PDF /
 你的产品      写出文件         切换手机/平板尺寸、  ZIP（含研发交接）/
 想法                          继续对话打磨        图片，或继续对话迭代
```

### 功能

- **多项目管理** — 每个原型一个独立工作区目录，agent 以该目录为 cwd 进行设计，项目之间互不干扰
- **对话式设计** — 通过 `pi --mode rpc` 长驻 agent 通信，流式输出文本 / 思考过程 / 工具调用；多轮上下文连续，"把顶栏改成吸顶""换个深色配色"这类追加指令都能接得上
- **可交互的多端预览** — 原型在沙箱预览区随生成实时渲染，带视口预设（桌面满幅 / 平板 820×1180 / 手机 390×844）、缩放（50–200%）、刷新、新窗口打开；文件每次变更（fs.watch + SSE）自动刷新，预览走 scoped 临时 token URL（带 CSP 与 `sandbox="allow-scripts allow-forms"`）
- **Artifact 体系** — 每个原型页面由 `<entry>.artifact.json` sidecar manifest 描述（schema v1），无 sidecar 的 HTML 自动按 legacy 规则推断；新生成的页面自动打开预览标签页
- **工作区标签页** — 多 tab 打开原型文件（localStorage 持久化），与固定的文件树 tab 并列
- **生成过程舞台** — agent 工作时预览区显示 理解需求 → 生成页面 → 准备预览 三步进度、实时活动与写文件子状态，失败可重试
- **文件管理面板** — 语义分区（HTML / 样式表 / 代码 / 文档 / 图片）、面包屑目录导航、行内重命名（联动迁移 sidecar）、多选批量删除、按钮 / 拖拽上传
- **导出与研发交接** — 按 manifest exports 提供：HTML 单文件、PDF（打印握手：等待字体 / 图片 / CSS 背景就绪后再打印）、ZIP（含 DESIGN-HANDOFF.md + DESIGN-MANIFEST.json 研发交接产物）、PNG / JPEG / WebP 快照（iframe 注入 SVG foreignObject 快照桥）、项目归档 ZIP（支持 `?root=` 子目录限定）
- **历史持久化** — 对话历史保存在项目目录下，刷新页面不丢失，原型随时接着上次继续做

### 前置条件

- Node.js ≥ 20、pnpm
- 已安装并配置好 [pi CLI](https://pi.dev)（`pi` 在 PATH 中，provider API key 已配置）

### 启动

```bash
pnpm install
pnpm dev        # 同时启动 server(4400) 和 web(5173)
```

打开 http://localhost:5173 （若 5173 被占用 Vite 会自动换端口，看终端输出）。

### 架构

见上方英文 *Architecture* 一节的目录树（`web/` 前端、`server/` 后端、`data/` 工作区、`skills/` 内置设计 skill 库）。设计文档见 `docs/superpowers/specs/`。

> 原型（prototype）这一条链路——artifact 体系、文件管理、预览界面、导出调整——行为级一比一复刻 `open-design`；插件市场、设计系统库、Live Artifacts、评论标注等其他子系统不在范围内。

### 测试

```bash
pnpm test     # server + web vitest：事件映射、项目/文件 CRUD、manifest、
              # scope token、bridge 注入、导出构建器、生成模型
pnpm build    # 类型检查 + 前端构建
```

---

## License

[MIT](LICENSE) © 2026 yoqu

> The bundled design skills under `skills/` are sourced from `open-design`; their respective upstream licenses apply.
> `skills/` 下的内置设计 skill 源自 `open-design`，其各自的上游许可继续适用。
