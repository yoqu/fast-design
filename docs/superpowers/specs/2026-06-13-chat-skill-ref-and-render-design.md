# 项目详情页对话区：+ 菜单、Skill 引用、模型常显、渲染重构

状态：已通过设计评审，待写实现计划
日期：2026-06-13
作者：协作（用户 + agent）

## 背景与目标

项目详情页左侧对话区（`web/src/components/Composer.tsx` + `ChatPanel.tsx` +
`MessageView.tsx`）当前：

- 底部工具栏只有一个孤立的回形针「添加附件」按钮，无统一的 `+` 菜单；
- 无法在对话里临时「引用」某个 skill 让 agent 本回合使用；
- 模型按钮在「跟随项目设置」时只显示 `默认`，真实模型名只有点开菜单才看得到，
  不优雅；
- 助手消息的工具活动块只折叠成「执行了 N 步操作」，缺少截图里那种按工具类型
  计数的摘要（读取 ×11、搜索 ×3…）、待办清单卡、写文件文档 chip 等精细渲染。

本次目标，四部分：

- **A** 对话区底部新增 `+` dropdown，含「添加附件」与「引用 Skill」。
- **B** 引用的 skill 真正送达 agent（`--skill` 注入 + prompt 指令）。
- **C** 模型名常显（不再只在「默认」时藏起来）。
- **D** 重构对话区渲染逻辑，对齐参照截图的内容展示精度（样式仍沿用现有 zinc 极简）。

## 关键决策（已与用户确认）

1. **Skill 选择作用范围**：每条消息一次性 —— 选中的 skill 以 tag 显示在 composer，
   发送后自动清空 tag。
2. **选择器列出范围**：内置设计（bundled）+ 项目（project）+ 全局（global，
   `~/.pi/agent/skills`，含 lark/上传等）。即 `piApi.skills` 返回的全部 scope。
3. **送达方式**：`--skill` 注入 + 每回合 prompt 前缀指令。
4. 用户消息记录引用过的 skill 名（`skills?: string[]`），让 transcript 能回显本条
   引用了什么（非纯瞬态）。
5. Part D 渲染重构范围按本文 §Part D 全量实施。

## 现状速查（实现锚点）

- 技能注入：`enabledSkillPaths(projectDir)`（`server/src/pi-skills.ts:175`）→
  `launchConfigFor(id, cid)`（`server/src/index.ts:81`）组装 `skillPaths` →
  `PiSession` spawn 时 `--no-skills` + 逐个 `--skill <path>`
  （`server/src/pi-session.ts:101-110`）。
- 会话长生命周期：每会话一个 `pi --mode rpc` 进程；换模型会 dispose 空闲会话使其
  按新配置重启（`--continue` 恢复历史）。
- 发送链路：`Composer.onSend` → `streamChat(projectId, cid, message, …, attachments)`
  （`web/src/lib/api.ts:182`）→ `POST /api/projects/:id/conversations/:cid/chat`
  （`server/src/index.ts:252`）→ `composePromptWithAttachments(message, attachments)`
  → `session.prompt(...)`。
- 技能列表：`piApi.skills(projectId)` → `listSkills(projectDir)` 返回 global +
  project + bundled 全部 scope；`SkillsSection` 仅展示 bundled+project。
- 渲染：`MessageView.tsx` 用 `messageParts()` / `groupMessageParts()`（
  `web/src/lib/messageParts.ts`）把助手消息切成 text 段与 activity 块；
  `ActivityBlock` 折叠摘要、`ToolCallCard` 展开单卡、`toolSummary()` 取单工具路径。

## Part A — Composer 的 `+` dropdown

把底部工具栏左侧的回形针按钮替换为 `+`（`PlusIcon`）dropdown 触发器。菜单两项：

- **添加附件** → 触发现有隐藏 `<input type=file>`，附件流程不变。
- **引用 Skill** → 打开技能选择器 popover。

**技能选择器 popover**（视觉沿用模型菜单：`rounded-xl border border-zinc-200
bg-white shadow-lg`）：

- 数据源：`piApi.skills(projectId)`（已含全部 scope），首次打开时拉取并缓存于
  Composer 本地 state。
- 顶部一个搜索框，按 name/description 过滤。
- 列表按 scope 分组或加 scope 标签（`内置设计` / `项目` / `全局`），每项展示
  name + 一行描述，已选项打勾。
- 点击切换选中；选中集合存 `selectedSkills: SkillRef[]`，`SkillRef = { scope, rel,
  name }`。

**已选 tag**：在 composer 内（附件 chip 行附近、工具栏上方）渲染 chip：
`SparklesIcon` + skill 名 + `X`，可逐个移除。

**发送**：`send()` 把 `selectedSkills` 映射为 `{ scope, rel }[]` 透传给
`onSend`；发送后清空 `selectedSkills`（每条消息一次性）。

### 接口形态变化（前端）

- `Composer` `onSend` 签名：`(message, attachments, skills: SkillRef[]) => void`。
- `ChatPanel.send`：透传 skills 给 `streamChat`，并写入本地 user 消息的
  `skills`（names）用于即时回显。

## Part B — 引用 skill 送达 agent

### 协议

- `streamChat(...)` 增参 `skills?: { scope: string; rel: string }[]`，并入 POST body。
- `POST …/chat` 解析 `req.body.skills`（用 `pi-skills` 里新增的校验/解析）。

### 解析与注入

- 新增 `resolveSkillPaths(refs, projectDir): string[]`（`pi-skills.ts`）：把
  `{scope, rel}` 解析为该 skill 目录的绝对路径（与 `enabledSkillPaths` 同形态，复用
  `resolveSkillFile` 同款定位逻辑），对不存在的 ref 静默跳过。
- 模块级 `referencedSkillPaths: Map<sessionKey, Set<string>>`（`index.ts`）。chat 路由
  在 `startTurn` 前：
  1. `const paths = resolveSkillPaths(skills, projectDir(id))`；
  2. 若 `paths` 有任意一项不在该 session 的集合里 → 加入集合，并 dispose 该（空闲）
     session（从 `sessions` map 删除），使下一次 `session.prompt` 按新配置重启；
  3. 集合只增不减 —— 移除 skill 不触发重启（仅前端 tag 消失）。
- `launchConfigFor` 的 `skillPaths` 改为 `enabledSkillPaths(...)` 与
  `referencedSkillPaths.get(sessionKey) ?? []` 的并集（去重）。

### prompt 指令

- 扩展 compose 链路：当本回合有引用 skill 时，在
  `composePromptWithAttachments(...)` 结果前再加一段指令，例如：

  ```
  本回合请优先使用以下 skill：
  - <name>：<description>
  …
  ```

  实现方式：新增 `composePromptWithSkills(prompt, skillInfos)` 或在 chat 路由里把
  指令拼到 message 前再交给现有 compose。skill 的 name/description 用 `listSkills`
  查得（避免重复读盘）。

### 历史落盘

- `appendConversationHistory` 写 user 消息时带上 `skills?: string[]`（names）。
- `ChatMessage` 类型（前后端各一份）增可选 `skills?: string[]`。

## Part C — 模型名常显

`Composer` 模型按钮文案改为始终显示**已解析**的模型短名：

- 会话有覆盖 `model` → `modelShortName(model)`；
- `model === null` 且 `projectModel` 有值 → `modelShortName(projectModel)` + 一个
  低饱和「跟随」标记（如灰字小字 `跟随` 或淡色点），表明来自项目设置；
- 两者皆空 → `全局默认`。

`title`/菜单内副标题逻辑保持，仅按钮可见文案变化。

## Part D — 对话区渲染重构

保留现有可折叠 transcript 结构与 zinc 极简样式，增强**内容逻辑**对齐截图：

### D1 按工具类型计数的活动摘要

- 新增 `summarizeTools(tools: ToolCall[]): { verb: string; count: number }[]`
  （`messageParts.ts`）：工具名 → 中文动词映射，统计各动词出现次数。映射表（大小写
  不敏感、含常见别名）：
  - `Read` → 读取；`Write` → 写入；`Edit`/`MultiEdit`/`patch` → 编辑；
    `Glob`/`Grep`/`Search` → 搜索；`Bash`/`shell` → 运行；
    `Copy` → 复制；`TodoWrite`/`todo` → 更新待办；`Delete`/`rm` → 删除；
    其余 → 取原名。
- `ActivityBlock` 折叠行的摘要由「执行了 N 步操作」改为枚举：
  `读取 ×11 · 搜索 ×3 · 编辑 ×4`（`×1` 省略数字）。进行中仍显示当前动作 hint。
  展开时维持现有逐卡铺平。

### D2 待办清单卡

- 特判 `TodoWrite`/todo 工具：解析 `input.todos`（数组，元素含
  `content`/`status` 之类字段，按实际 pi 输出适配）。
- 渲染为清单：每项一行，done → 绿 `CircleCheckIcon`，进行中/未完成 → 对应态图标 +
  文案。替代原始 JSON 展示。`TodoCard` 组件。
- 解析失败时回退到现有 `ToolCallCard`（鲁棒）。

### D3 写文件文档 chip

- write/edit/create 类工具：在活动块里（或单工具形态）渲染紧凑 chip：
  `FileIcon` + 文件名 + `ExternalLinkIcon`，点击打开文件查看器/预览（复用
  `api.fileUrl` 或现有 FileViewer 路由）。文件名取 `input.path|file_path|…` 的
  basename（复用 `ChatPanel.writtenFileFrom` 同款逻辑，抽到共享处）。

### D4 markdown 渲染增强

- 核对/补强全局 `.md` 样式（标题层级、加粗、有序/无序列表、行内/块 code、引用），
  使助手正文渲染接近截图层次。若样式缺失则在样式表补齐；不引入新依赖。

## 数据流（汇总）

```
Composer(selectedSkills) --onSend(msg, atts, skills)--> ChatPanel.send
  --streamChat(body: {message, attachments, skills})--> POST /chat
    -> resolveSkillPaths + 更新 referencedSkillPaths(+按需 dispose 空闲 session)
    -> appendConversationHistory(user, {skills: names})
    -> composePromptWithSkills(composePromptWithAttachments(msg, atts), skillInfos)
    -> startTurn -> session.prompt(prompt)   // 重启时 --skill 注入引用集合并集
```

## 测试

- `pi-skills`：`resolveSkillPaths` 对 bundled/project/global ref 正确定位，缺失 ref
  跳过（新增单测）。
- compose：`composePromptWithSkills` 拼接指令、空 skills 时不改 prompt（单测）。
- `messageParts`：`summarizeTools` 计数与动词映射、`×1` 省略（单测）。
- 渲染：`MessageView` 对 TodoWrite 输出渲染清单、对 write 工具渲染 chip（组件测，
  若项目已有渲染测则跟随其范式）。
- 回归：现有 `messageParts.test`、`attachments` 相关测试保持绿。

## 取舍与边界

- 引用未加载过的 skill 会给该回合带来一次进程重启延迟（每会话每新 skill 仅首次），
  与换模型同量级，可接受。
- 全局 `~/.pi` skill 现在可被引用注入，突破了「默认不把全局 skill 注入 agent」的边界
  —— 这是用户明确要求的按需引用，不影响未引用时的默认行为。
- 每条消息一次性：tag 发送后清空；后端 `referencedSkillPaths` 集合只增，仅作为
  「进程已加载哪些 skill」的缓存，不代表当前选择。

## 非目标（YAGNI）

- 不做会话级/项目级持久的 skill 绑定（本次明确每条消息一次性）。
- 不改 `SkillsSection` 的启用/编辑/新建逻辑。
- 不复刻截图的配色/品牌样式，仅对齐内容展示逻辑。
