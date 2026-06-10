# Pi Web Studio

基于 [pi agent 框架](https://pi.dev) 的 Web 对话开发工具：在浏览器里和 pi agent 对话，agent 在项目目录中开发网页，右侧 iframe 实时预览，一键导出 ZIP。

整体布局参考 open-design，但保持极简：项目列表 / 对话 / 预览三栏，没有插件市场、设计系统库等重型功能。

## 功能

- **多项目管理** — 每个项目一个独立工作区目录，agent 以该目录为 cwd 进行开发
- **pi agent 对话** — 通过 `pi --mode rpc` 长驻进程通信，流式输出文本 / 思考过程 / 工具调用，多轮对话上下文连续
- **实时预览** — 静态服务项目目录到 iframe，文件变更（fs.watch + SSE）自动刷新，可切换预览入口文件、新窗口打开
- **导出下载** — 项目打包为 ZIP 下载（自动排除 `.webui` / `node_modules` 等）
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
  src/components/   Sidebar / ChatPanel / MessageView / Composer / PreviewPanel
  src/lib/          API 封装、NDJSON 流解析、类型
server/   Express + TypeScript
  src/pi-session.ts 每项目一个长驻 pi RPC 子进程（崩溃自动 --continue 恢复）
  src/pi-events.ts  pi RPC 事件 → UI 事件映射（纯函数，已测）
  src/projects.ts   项目 CRUD、历史、文件列表、路径安全
  src/watch.ts      文件变更监听（防抖 + 引用计数）
  src/index.ts      HTTP 路由：chat(NDJSON 流) / events(SSE) / preview / export
data/projects/<id>/ 项目工作区（agent 的 cwd），.webui/ 下存元数据与历史
```

## 测试

```bash
pnpm --filter server test    # vitest：事件映射、项目 CRUD、路径安全
pnpm build                   # 类型检查 + 前端构建
```

设计文档见 `docs/superpowers/specs/2026-06-10-pi-web-studio-design.md`。
