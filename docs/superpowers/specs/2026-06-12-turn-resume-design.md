# 进行中回合的刷新/重启恢复设计

日期：2026-06-12
状态：已确认

## 问题

聊天流绑定在 `POST /chat` 请求上：回合事件直接写进该请求的响应，`req.on('close')`
还会主动 abort 回合。刷新项目详情页 = 断开请求 = 回合被杀，半截回复落历史，
进行中的会话无法恢复。server 进程重启则连半截内容都会丢（assistant 消息只在
回合结束时落盘）。

## 决策（已与用户确认）

1. **回合与连接解耦**：回合一旦开始就跑到结束为止，与浏览器连接无关。
   关闭页面不再省 token，靠停止按钮兜底。
2. **重连机制**：服务端内存 Turn 注册表（事件缓冲 + 订阅者）+ GET 续接流
   （回放缓冲 + 实时续流，空闲 204）。
3. **落盘**：回合事件日志写穿到磁盘，server 重启后必须能恢复已生成内容。
4. **重启恢复语义**：恢复已生成内容 + 标记中断（`服务重启，回合已中断`），
   用户用现有重试入口一键重发。**不**自动续跑（pi 是子进程，LLM 生成现场
   无法接续；合成续跑提示不可预期且可能批量烧 token）。

## 架构

### 新模块 `server/src/turns.ts`

把散在 `POST /chat` 路由里的回合概念抽成实体：

- **`Turn`**：`UiEvent` 缓冲数组 + 订阅者集合 + done 标志。
  - `emit(ev)`：先追加写 journal（见下），再进内存缓冲、推给全部订阅者。
  - `subscribe(write)`：同步回放缓冲后加入订阅者集合（Node 单线程同步段内
    完成，无丢失/重复窗口），返回退订函数。
  - 结束时向订阅者发 `done` 并清空。
- **注册表**：`Map<`projectId:cid`, Turn>`，一个会话同时最多一个回合。
- **事件折叠函数**（在线与恢复路径共用）：现有累积器逻辑整体搬入——
  content/thinking 增量、tools 配对、`turn_start` 检查点 + `retry` 回滚、
  error 标记，折叠为一条 assistant `ChatMessage`。
- **turn 运行器**：落用户消息 → 建 Turn → `session.prompt(msg, ev => {折叠; turn.emit(ev)})`
  → 结束后 assistant 落 history → 删 journal → Turn 出注册表。
  回合结束落盘**不依赖有没有客户端连着**。

### 事件日志（journal）

- 路径：`<项目>/.webui/turns/<cid>.ndjson`，每事件一行 JSON。
- WriteStream append 模式，靠 OS 缓冲，不逐条 fsync——目标是进程重启可恢复，
  不追求断电级持久化。
- 回合正常结束即删除。日志写失败不杀回合（降级纯内存，console 告警）。

### 启动恢复

server 启动时扫描所有项目的 `.webui/turns/*.ndjson`。文件存在即上次进程死于
回合中途：解析事件 → 共用折叠函数重建 assistant 消息 → 标记
`error: '服务重启，回合已中断'` → 追加进会话历史 → 删 journal。
对应会话已被删除的孤儿 journal 直接清理；`deleteConversation` 同步删 journal。

### 接口变化

- `POST /chat`：对外行为不变（409 防并发、NDJSON 流），内部改为
  「创建 Turn → 自己作为第一个订阅者」。**删除 `req.on('close') → abort`**。
- 新增 `GET /api/projects/:id/conversations/:cid/chat/stream`：
  有进行中回合 → 回放 + 续流（与 POST 流格式一致，结尾 `done`）；空闲 → 204。
  多订阅者天然支持多标签页。

### 前端（ChatPanel）

- 进入会话拉取 history 后发续接请求：204 照旧；200 则补一条
  `streaming: true` 的 assistant 占位消息、置 busy，复用现有 `handleEvent`
  归约器消费回放 + 续流（用户消息在回合开始时已落历史，不用补）。
- 把 `send()` 的事件消费/收尾逻辑抽成共享函数，发送与恢复走同一套。
- 停止按钮、状态条、composer 禁用已挂在 busy 上，自动生效；
  重启中断标记复用现有 error 展示与重试入口，无新 UI。
- `api.ts` 新增 `attachTurn(projectId, cid, onEvent, signal)`：
  204 返回 false，200 消费流到结束返回 true。

## 边界

- 服务重启：journal 折叠进历史 + 中断标记；续接自然 204。pi 子进程随父进程
  死亡，pi 自身 session jsonl（`--continue`）只含已完成消息，不受影响。
- 停止按钮：abort → pi 收尾 → Turn 正常结束并落盘部分内容。
- 删除会话/切模型 dispose pi 的现有路径触发 failTurn → Turn 以 error+done
  收尾并清理。收尾落盘前检查会话仍存在（`getConversation`），已删除则跳过
  持久化，避免复活已删会话的历史文件。
- 多标签页：多订阅者各自独立退订。

## 测试

`turns.test.ts` 单测（持久化函数/目录注入）：

1. 迟到订阅者收到完整回放；订阅期间新事件不丢不重。
2. done 后订阅者收尾、注册表清空。
3. 折叠语义：文本/思考增量、工具配对、`turn_start`+`retry` 回滚、error 标记。
4. journal 生命周期：事件追加成行、回合结束删除。
5. 启动恢复：构造 journal → 跑恢复 → 历史出现带中断标记的 assistant 消息、
   journal 被清；孤儿 journal 清理。

前端无组件测试基建，手动验证：发长任务 → 中途刷新 → 内容回放并继续逐字流 →
结束正常落历史；跑长任务时重启 server → 打开会话见半截内容 + 中断标记 → 重发成功。
