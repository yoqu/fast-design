# Pi Web Studio — 设计文档

日期：2026-06-10
状态：已采纳（自主目标模式下确定）

## 目标

基于 pi agent 框架（https://pi.dev）开发一款 Web 对话应用：

1. 在网页上通过 pi agent 协议（`pi --mode rpc`）进行对话，agent 基于"项目"目录进行开发。
2. 右侧带实时预览面板（iframe），能实时浏览 agent 开发出来的网页，文件变更自动刷新。
3. 参考 open-design 的整体框架（左侧对话 / 右侧预览），但保持极简。
4. 支持把项目导出为 ZIP 下载。

## 非目标（明确砍掉）

- 插件市场 / 插件运行时、设计系统库、设计模板库
- PPTX / 视频 / 图片导出，桌面端（Electron）
- 多 agent 协议支持（只支持 pi）、MCP 配置界面
- 用户系统 / 鉴权（本地单用户工具）
- 数据库（文件系统 + JSON 元数据即可）

## 架构

两个包，pnpm workspace：

```
web/      Vite + React 18 + TypeScript + Tailwind CSS v4
server/   Express + TypeScript（tsx 运行）
data/     运行时数据（gitignore）
  └─ projects/<projectId>/        项目工作区（agent 的 cwd）
       ├─ ... agent 生成的网页文件（index.html 等）
       ├─ .pi/                    pi 会话数据（session-dir）
       └─ .webui/
            ├─ meta.json          项目元数据（名称、创建时间、模型）
            └─ history.json       对话历史（持久化展示用）
```

### 后端（server）

| 路由 | 说明 |
|------|------|
| `GET  /api/projects` | 项目列表 |
| `POST /api/projects` | 新建项目 `{name}` |
| `DELETE /api/projects/:id` | 删除项目 |
| `GET  /api/projects/:id/history` | 对话历史 |
| `POST /api/projects/:id/chat` | 发送消息，**流式 NDJSON** 响应 agent 事件 |
| `POST /api/projects/:id/abort` | 中断当前回合 |
| `GET  /api/projects/:id/events` | SSE：`files-changed` 文件变更通知 |
| `GET  /api/projects/:id/files` | 项目文件树（用于选择预览入口） |
| `GET  /preview/:id/*` | 静态服务项目目录（iframe src），禁缓存 |
| `GET  /api/projects/:id/export` | ZIP 下载（排除 `.pi` `.webui` `node_modules`） |

**Pi 会话管理（pi-session.ts）**：每个项目一个长驻 `pi --mode rpc` 子进程（pi RPC 设计为多 prompt 会话）。
- spawn：`pi --mode rpc --session-dir <project>/.pi/sessions`，cwd = 项目目录；可选 `--model`。
- 通过 `--append-system-prompt` 注入项目约定：生成纯静态站点（index.html 入口、相对路径引用），保证 iframe 可直接预览。
- stdin 写入 `{id, type:"prompt", message}`；stdout 按行解析 JSON 事件并映射为统一 UI 事件：
  `status / text_delta / thinking_delta / thinking_start|end / tool_use / tool_result / usage / error / agent_end`
  （事件映射参考 open-design-slim 的 `apps/daemon/src/pi-rpc.ts`）。
- `extension_ui_request` 自动应答（confirm→true，select→第一项），fire-and-forget 方法静默消费。
- 进程崩溃后下次发消息自动重启（用 `--continue` 续接历史会话）。
- abort：发 `{type:"abort"}` RPC 命令。

**实时预览**：`fs.watch(projectDir, {recursive:true})`（macOS 原生支持），忽略 `.pi/.webui`，300ms 防抖后向 SSE 推 `files-changed`。前端收到后刷新 iframe 与文件列表。

### 前端（web）

三栏布局（参考 open-design 大框架，极简化）：

```
┌──────────┬─────────────────────┬──────────────────────┐
│ 项目列表  │  对话区              │  预览区               │
│ + 新建    │  消息流（markdown、  │  工具条：入口文件选择、 │
│          │  思考折叠块、工具卡片）│  刷新、新窗口打开、    │
│          │  输入框 + 发送/停止   │  导出 ZIP            │
│          │                     │  iframe (sandbox)    │
└──────────┴─────────────────────┴──────────────────────┘
```

组件拆分（每个 <300 行）：
- `App.tsx` — 布局、项目状态
- `Sidebar.tsx` — 项目列表/新建/删除
- `ChatPanel.tsx` — 历史加载、流式状态机
- `MessageView.tsx` — markdown 渲染（react-markdown）、thinking 折叠、工具调用卡片
- `Composer.tsx` — 输入框（Enter 发送，Shift+Enter 换行）、停止按钮
- `PreviewPanel.tsx` — iframe + 工具条 + SSE 自动刷新
- `lib/api.ts` — fetch 封装 + NDJSON 流解析器
- `lib/types.ts` — 事件/消息类型

**流式协议**：前端 `fetch POST /chat`，读 `ReadableStream` 按行解析 NDJSON 事件，增量更新最后一条 assistant 消息。EventSource 仅用于文件变更（GET）。

### 错误处理

- pi 进程 spawn 失败 / 崩溃 → chat 流返回 `{type:"error"}` 事件，前端在消息流中显示错误条。
- 流中断（网络/服务重启）→ 前端把进行中消息标记为中断，可重发。
- 路径安全：preview/files/export 路由全部 resolve 后校验仍在项目目录内。

### 测试

- server：vitest 单测覆盖 pi 事件映射（纯函数）、路径安全校验、项目 CRUD。
- 端到端：手动验证（启动 server+web，真实 pi 对话生成页面并预览、导出）。

## 验收标准（对应 goal）

1. ✅ React Web 界面，可与 pi agent 对话（流式输出、工具调用可见）
2. ✅ 对话基于项目目录开发，多项目管理
3. ✅ iframe 预览面板，agent 写文件后自动实时刷新
4. ✅ 整体布局参考 open-design 且极简
5. ✅ 一键导出 ZIP 下载
