# Pi Web Studio

基于 [pi agent 框架](https://pi.dev) 的 Web 对话开发工具：在浏览器里和 pi agent 对话，agent 在项目目录中开发网页，右侧工作区实时预览，多格式导出。

原型（prototype）这一条链路——artifact 体系、文件管理、预览界面、导出调整——行为级一比一复刻 open-design；插件市场、设计系统库、Live Artifacts、评论标注等其他子系统不在范围内。

## 功能

- **多项目管理** — 每个项目一个独立工作区目录，agent 以该目录为 cwd 进行开发
- **pi agent 对话** — 通过 `pi --mode rpc` 长驻进程通信，流式输出文本 / 思考过程 / 工具调用，多轮对话上下文连续
- **Artifact 体系（对齐 open-design）** — `<entry>.artifact.json` sidecar manifest（schema v1），无 sidecar 的 HTML 自动按 legacy 规则推断；新 artifact 生成后自动打开预览标签页
- **工作区标签页 + 预览器** — 多 tab 打开项目文件（localStorage 持久化）；预览器带视口预设（桌面满幅 / 平板 820×1180 / 手机 390×844）、缩放（50–200%）、刷新、新窗口打开；scoped 预览 URL（临时 token + CSP + `sandbox="allow-scripts allow-forms"`），文件变更（fs.watch + SSE）自动刷新
- **生成过程舞台** — agent 回合进行中预览区显示 理解需求 → 生成页面 → 准备预览 三步进度、实时活动与写文件子状态，失败可重试
- **文件管理面板** — 语义分区（HTML / 样式表 / 代码 / 文档 / 图片）、面包屑目录导航、行内重命名（联动迁移 sidecar）、多选批量删除、按钮 / 拖拽上传
- **导出调整（对齐 open-design）** — 按 manifest exports 提供：HTML 单文件、PDF（打印握手：等待字体 / 图片 / CSS 背景就绪后再打印）、ZIP（含 DESIGN-HANDOFF.md + DESIGN-MANIFEST.json 实现交接产物）、PNG / JPEG / WebP 快照（iframe 注入 SVG foreignObject 快照桥）、项目归档 ZIP（支持 `?root=` 子目录限定）
- **历史持久化** — 对话历史保存在项目目录下，刷新页面不丢失

## 前置条件

- Node.js ≥ 20、pnpm
- 已安装并配置好 [pi CLI](https://pi.dev)（`pi` 在 PATH 中，provider API key 已配置）

## 启动

```bash
pnpm install
pnpm dev        # 同时启动 server(4400) 和 web(5173)
```

打开 http://localhost:5173 （若 5173 被占用 Vite 会自动换端口，看终端输出）。

## 架构

```
web/      Vite + React 18 + Tailwind v4
  src/components/   Sidebar / ChatPanel / MessageView / Composer /
                    Workspace(标签页) / FileViewer(视口+缩放+导出) /
                    FilesPanel(文件管理) / GenerationStage / ExportMenu
  src/lib/          API 封装、NDJSON 流解析、artifact 类型、
                    exports(HTML/PDF/ZIP/快照导出,移植自 open-design) /
                    zip(存储型 ZIP 编码器) / srcdoc / generation(生成模型)
server/   Express + TypeScript
  src/pi-session.ts 每项目一个长驻 pi RPC 子进程（崩溃自动 --continue 恢复）
  src/pi-events.ts  pi RPC 事件 → UI 事件映射（纯函数，已测）
  src/projects.ts   项目 CRUD、历史、文件列表、路径安全
  src/artifacts.ts  artifact manifest 解析/推断/列举（移植自 open-design）
  src/files.ts      文件 CRUD + sidecar 联动（重命名迁移 manifest）
  src/preview-scopes.ts  预览 scope token 铸造/校验
  src/bridges.ts    快照 bridge 注入（移植自 open-design）
  src/watch.ts      文件变更监听（防抖 + 引用计数）
  src/index.ts      HTTP 路由：chat(NDJSON 流) / events(SSE) / artifacts /
                    file CRUD / preview-url + scoped preview / export(?root)
data/projects/<id>/ 项目工作区（agent 的 cwd），.webui/ 下存元数据与历史
```

## 测试

```bash
pnpm test     # server + web vitest：事件映射、项目/文件 CRUD、manifest、
              # scope token、bridge 注入、导出构建器、生成模型
pnpm build    # 类型检查 + 前端构建
```

设计文档见 `docs/superpowers/specs/2026-06-10-pi-web-studio-design.md` 与 `docs/superpowers/specs/2026-06-10-prototype-flow-design.md`。
