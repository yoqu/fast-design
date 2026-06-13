<div align="center">

<img src="docs/images/banner.png" alt="fast-design" width="100%" />

# fast-design

**Chat with an AI agent in your browser — and watch it design and build web pages in real time.**

基于 [pi agent 框架](https://pi.dev) 的 Web 对话式建站工具：在浏览器里和 agent 对话，它在项目目录中开发网页，右侧工作区实时预览，支持多格式导出。

[English](#english) · [中文](#中文)

</div>

---

<a name="english"></a>

## English

**fast-design** is a web-based studio where you talk to an AI agent and it builds web pages for you. The agent develops inside an isolated per-project workspace; a live preview pane renders the result as it's written, and you can export the result as HTML, PDF, ZIP, or an image snapshot.

The prototype flow — artifact system, file management, preview surface, export tweaks — is a behavior-level 1:1 re-creation of `open-design`. Other subsystems (plugin marketplace, design-system library, Live Artifacts, comment annotations) are out of scope.

<img src="docs/images/hero.png" alt="fast-design UI" width="100%" />

### Features

- **Multi-project management** — each project gets its own isolated workspace directory; the agent runs with that directory as its cwd.
- **AI agent conversation** — communicates with a long-lived `pi --mode rpc` process; streams text / thinking / tool calls, with continuous multi-turn context.
- **Artifact system** (aligned with open-design) — `<entry>.artifact.json` sidecar manifest (schema v1); HTML without a sidecar is inferred via legacy rules; newly generated artifacts auto-open a preview tab.
- **Workspace tabs + previewer** — open multiple project files as tabs (persisted to localStorage); the previewer offers viewport presets (desktop full-width / tablet 820×1180 / phone 390×844), zoom (50–200%), refresh, and open-in-new-window. Scoped preview URLs (ephemeral token + CSP + `sandbox="allow-scripts allow-forms"`) auto-refresh on file change (fs.watch + SSE).
- **Generation stage** — during an agent turn the preview area shows a three-step progress (understand → generate → prepare preview) with live activity and write-file sub-states; failures are retryable.
- **File management panel** — semantic sections (HTML / stylesheets / code / docs / images), breadcrumb navigation, inline rename (with linked sidecar migration), multi-select bulk delete, button / drag-and-drop upload.
- **Export tweaks** (aligned with open-design) — per manifest exports: single-file HTML; PDF (print handshake — waits for fonts / images / CSS backgrounds before printing); ZIP (includes `DESIGN-HANDOFF.md` + `DESIGN-MANIFEST.json` handoff artifacts); PNG / JPEG / WebP snapshots (iframe-injected SVG foreignObject snapshot bridge); full project archive ZIP (with `?root=` subdirectory scoping).
- **Persistent history** — conversation history is saved under the project directory and survives page reloads.

### How it works

<img src="docs/images/workflow.png" alt="workflow" width="100%" />

```
Chat  ──▶  Generate  ──▶  Live preview  ──▶  Export
 │            │                │                │
 talk to     pi agent        scoped iframe    HTML / PDF /
 the agent   writes files    auto-refreshes   ZIP / image
```

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
                    exports (HTML/PDF/ZIP/snapshot, ported from open-design) /
                    zip (store-mode ZIP encoder) / srcdoc / generation model
server/   Express + TypeScript
  src/pi-session.ts      one long-lived pi RPC child process per project
                         (auto --continue recovery on crash)
  src/pi-events.ts       pi RPC events → UI events mapping (pure, tested)
  src/projects.ts        project CRUD, history, file listing, path safety
  src/artifacts.ts       artifact manifest parse / infer / list (from open-design)
  src/files.ts           file CRUD + sidecar linkage (rename migrates manifest)
  src/preview-scopes.ts  preview scope token minting / verification
  src/bridges.ts         snapshot bridge injection (from open-design)
  src/watch.ts           file-change watcher (debounce + refcount)
  src/index.ts           HTTP routes: chat (NDJSON stream) / events (SSE) /
                         artifacts / file CRUD / preview-url + scoped preview /
                         export (?root)
data/projects/<id>/      project workspace (agent's cwd); .webui/ holds metadata + history
skills/   Bundled design-skill library (17, sourced from open-design): the
          frontend-design / artifacts-builder / ui-skills / taste-skill chain
          for the prototype/web-design flow. On session start, pi runs with
          `--no-skills` (disables global ~/.pi/agent/skills auto-discovery)
          plus `--skill <dir>` to inject only these design skills and any
          project-level skills enabled in data/webui-settings.json.
```

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

**fast-design** 是一个 Web 对话式建站工作台：你在浏览器里和 AI agent 对话，它替你开发网页。agent 在每个项目独立的工作区目录中以该目录为 cwd 进行开发，右侧工作区实时渲染预览，结果可导出为 HTML、PDF、ZIP 或图片快照。

原型（prototype）这一条链路——artifact 体系、文件管理、预览界面、导出调整——行为级一比一复刻 `open-design`；插件市场、设计系统库、Live Artifacts、评论标注等其他子系统不在范围内。

### 功能

- **多项目管理** — 每个项目一个独立工作区目录，agent 以该目录为 cwd 进行开发
- **AI agent 对话** — 通过 `pi --mode rpc` 长驻进程通信，流式输出文本 / 思考过程 / 工具调用，多轮对话上下文连续
- **Artifact 体系（对齐 open-design）** — `<entry>.artifact.json` sidecar manifest（schema v1），无 sidecar 的 HTML 自动按 legacy 规则推断；新 artifact 生成后自动打开预览标签页
- **工作区标签页 + 预览器** — 多 tab 打开项目文件（localStorage 持久化）；预览器带视口预设（桌面满幅 / 平板 820×1180 / 手机 390×844）、缩放（50–200%）、刷新、新窗口打开；scoped 预览 URL（临时 token + CSP + `sandbox="allow-scripts allow-forms"`），文件变更（fs.watch + SSE）自动刷新
- **生成过程舞台** — agent 回合进行中预览区显示 理解需求 → 生成页面 → 准备预览 三步进度、实时活动与写文件子状态，失败可重试
- **文件管理面板** — 语义分区（HTML / 样式表 / 代码 / 文档 / 图片）、面包屑目录导航、行内重命名（联动迁移 sidecar）、多选批量删除、按钮 / 拖拽上传
- **导出调整（对齐 open-design）** — 按 manifest exports 提供：HTML 单文件、PDF（打印握手：等待字体 / 图片 / CSS 背景就绪后再打印）、ZIP（含 DESIGN-HANDOFF.md + DESIGN-MANIFEST.json 实现交接产物）、PNG / JPEG / WebP 快照（iframe 注入 SVG foreignObject 快照桥）、项目归档 ZIP（支持 `?root=` 子目录限定）
- **历史持久化** — 对话历史保存在项目目录下，刷新页面不丢失

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
