# 每项目多对话（Conversation）设计——对齐 open-design

日期：2026-06-11
参照：`/Users/yoqu/Documents/code/ai/open-design-slim`（daemon db.ts:76-84/831-1120、project-routes.ts:1480-1619、web ChatPane.tsx:3090-3179、ProjectView.tsx:4313-4404）

## 目标与决策

- 一个项目支持多个对话，主聊天面板可切换/新建/删除对话，行为对齐参照 ChatPane 的会话历史菜单。
- 参照用 SQLite conversations 表；本项目用文件存储等效（`.webui/` 下 JSON）。
- **裁剪**：`sessionMode`（恒 design）、seed/fork 复制、预览评论、Side chat workspace tab（范围外清单沿用）；重命名 UI 不做（参照 ChatPane 注释明确无内联重命名，PATCH title 仅保留 API 能力）。
- pi 会话按 conversation 隔离（等效参照 agent_sessions 复合键 (conversation_id, agent_id)）：每个对话独立 `--session-dir`，互不串上下文。

## 数据模型（文件等效）

```
data/projects/<pid>/.webui/
  conversations.json            # ConversationMeta[]，无则按迁移规则生成
  conversations/<cid>.json      # 该对话的 ChatMessage[]
  history.json                  # 旧版单对话历史（迁移后删除）
data/projects/<pid>/.pi/sessions/<cid>/   # 每对话 pi session dir
```

```ts
type ConversationMeta = {
  id: string;           // 随机 hex（同项目 id 生成方式）
  title: string | null; // null → UI 显示「未命名对话」（对齐参照 Untitled）
  createdAt: number;
  updatedAt: number;
};
```

- 列表排序：`updatedAt DESC`（对齐参照 listConversations）。
- 列表响应附带衍生字段 `messageCount`（读各会话文件计数；项目体量小，可接受）。
- 项目创建时自动建一个默认对话（`title: null`，对齐参照 project-routes.ts:1198-1210）。
- **迁移**（访问会话列表时惰性执行，幂等）：存在旧 `history.json` 且无 `conversations.json` → 生成默认对话（id 随机、title null、createdAt=meta.createdAt、updatedAt=meta.updatedAt??createdAt），旧历史内容写入 `conversations/<cid>.json`，旧 `.pi/sessions` 目录整体 `rename` 为 `.pi/sessions/<cid>`（保住 `--continue` 上下文），删除旧 `history.json`。无任何旧数据 → 创建空默认对话。
- 消息落盘（每条 user/assistant）：bump 该对话 `updatedAt` + 项目 `updatedAt`（touchProject 既有）。

## API（对齐参照形态，路径裁剪）

| 方法 | 路径 | 请求/响应 |
|------|------|----------|
| GET | `/api/projects/:id/conversations` | → `{ conversations: (ConversationMeta & { messageCount: number })[] }`，惰性迁移在此触发 |
| POST | `/api/projects/:id/conversations` | `{ title? }` → `{ conversation }`（title trim 空→null） |
| PATCH | `/api/projects/:id/conversations/:cid` | `{ title }` → `{ conversation }`（自动 bump updatedAt） |
| DELETE | `/api/projects/:id/conversations/:cid` | → `{ ok: true }`；级联删除历史文件与该对话 pi session dir，dispose 其 pi 会话。服务端**不**自动补建（对齐参照：最后一个删除后由客户端自动新建空对话，ProjectView.tsx:4358-4366） |
| GET | `/api/projects/:id/conversations/:cid/history` | → `ChatMessage[]` |
| POST | `/api/projects/:id/conversations/:cid/chat` | `{ message }` → 流式 NDJSON（替代旧 `/chat`） |
| POST | `/api/projects/:id/conversations/:cid/abort` | → 中断该对话回合 |

旧路由 `GET /:id/history`、`POST /:id/chat`、`POST /:id/abort` 删除（前端同步切换，无外部消费方）。

## pi 会话管理变更（server/src/index.ts + pi-session.ts）

- `sessions` Map 键改为 `"<pid>:<cid>"`；`PiSession` 增加 sessionDir 参数（`<project>/.pi/sessions/<cid>`），cwd 仍为项目根（多个对话共享同一工作区文件，对齐参照——会话隔离的是上下文不是文件）。
- 项目 DELETE / PATCH（影响启动参数时）：dispose 该项目前缀的全部会话。
- 删除对话：dispose 对应会话 + 删 session dir。
- 并发：不同对话可并行回合（busy 互不影响），同对话沿用现有单回合限制。

## Web UI（对齐 ChatPane 会话历史菜单）

- **ChatPanel 顶部新增 header**：
  - 左：当前对话标题（`title || '未命名对话'`）。
  - 右：「⊕ 新对话」按钮 + 「历史」菜单按钮（下拉，列出全部对话：标题、消息数、相对更新时间；当前项高亮；行尾 hover 删除按钮，confirm 后删）。
- **切换行为**（对齐 ProjectView.tsx:4313-4343）：清空消息区 → 若当前对话回合进行中先 abort → 设置 activeConversationId → 加载该对话 history。预览区不动（Workspace 与对话解耦，文件是项目级的）。
- **删除行为**：删除非当前对话→仅刷新列表；删除当前对话→切到列表第一个；删除最后一个→自动 POST 新建空对话并切入（对齐参照客户端兜底）。
- **App 状态**：`activeConversationId` per project（项目切换时取该项目会话列表第一个）；`ChatPanel key={projectId}:{conversationId}` 复用现有 remount 模式。
- pendingPrompt 消费链路不变（预填当前激活对话的 composer）。

## 测试

- server：conversations CRUD + 迁移（旧 history.json → 默认对话 + sessions 目录 rename + 幂等）、删除级联、消息落盘 bump updatedAt、列表排序与 messageCount。
- web：会话列表渲染/切换清空加载/最后一个删除自动新建（lib 层可测部分）；`pnpm build` 门槛。
- E2E 冒烟：临时服起两个对话各发一条消息（不依赖 pi 时跳过 chat，仅验证 CRUD/历史读写隔离）。
