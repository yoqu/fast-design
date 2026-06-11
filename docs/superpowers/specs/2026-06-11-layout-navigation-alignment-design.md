# 布局导航全量对齐 open-design 设计

日期:2026-06-11

> **修正记录(2026-06-11,写实施计划时核实后定稿):**
> 1. **「替换工作目录」裁剪**——本项目项目目录托管在 data root,无外部工作目录链接概念;WorkingDirPill 菜单仅保留「在文件管理器中显示」。server 端点定稿为:`GET /api/projects/:id/handoff`(目录+编辑器探测)、`POST /api/projects/:id/reveal`、`POST /api/projects/:id/open-in-editor`。
> 2. **Kanban 视图裁剪**——参照按任务状态分组,本项目无任务状态体系,Projects 视图仅保留 Grid。
> 3. **QuestionsPanel 题型裁剪**——支持 radio/checkbox/select/text/textarea 五种基础题型,direction-cards 降级为 radio;只解析完整 JSON(不做参照的 partial-json)。
> 4. **项目运行状态**——`GET /api/projects` 增加 `running` 字段(由 PiSession.isBusy 派生),驱动卡片状态点。
> 5. **HandoffButton CLI 标签简化**——不做参照的框架选择,提供 Claude Code / Codex 两条继续开发命令的复制。
参照库:`/Users/yoqu/Documents/code/ai/open-design-slim`(下称"参照")
方针:行为级一比一复刻参照的页面流与布局机制,业务接线用本项目现有 server API。

## 目标

1. 首页默认进入项目列表页(EntryShell · Projects 视图)。
2. 项目详情页去掉项目列表侧栏,主体为「对话 + 预览」双栏。
3. 对话/预览分栏宽度可拖拽,带键盘调整与持久化。
4. 预览区可扩大化(focus 模式,一键隐藏聊天面板)。
5. 引入 URL 路由,刷新/前进后退/深链可恢复。
6. 详情页与首页的可见功能按参照全量对齐(排除项见"范围外")。

## 范围外

- 历史排除项:Live Artifacts、评论标注、部署分享、deck/react renderer、设计系统库、插件市场。
- 本轮新确认排除:工作区 Terminal 标签、Browser 标签、Side Chat 标签(依赖 PTY 终端运行时、内嵌浏览器代理、并行会话引擎,本项目 server 无,属独立后端工程,另起一轮)。
- 导航 rail 中 Tasks / Design Systems / Plugins / Integrations 项(均属排除功能)。

## 1. 路由层

复刻参照自研轻量路由(参照 `apps/web/src/router.ts`:`history.pushState` + `popstate` + `useSyncExternalStore`),**不引入 react-router**,保持零依赖。

新文件 `web/src/router.ts`,导出 `parseRoute` / `buildPath` / `navigate` / `useRoute`。

| 路径 | 视图 |
|---|---|
| `/` | 重定向(replace)到 `/projects` — 有意偏离参照(参照 `/` 是 Home),按用户要求默认落项目列表 |
| `/home` | EntryShell · Home 视图 |
| `/projects` | EntryShell · Projects 完整列表 |
| `/projects/:id` | 项目详情 |
| `/projects/:id/conversations/:cid` | 会话级深链 |
| `/projects/:id/conversations/:cid/files/:fileName` 与 `/projects/:id/files/:fileName` | 文件级深链 |

- 活动预览文件名编码进 URL,成为"当前预览文件"的真值来源(参照 router.ts:108-135)。
- 打开的标签集合仍存 localStorage(现状 `webui:tabs:{projectId}`)。
- 新建对话后将新 cid 以 `replace` 方式推入 URL(参照 ProjectView.tsx:4293-4301)。
- 未知路径/不存在的项目 id:重定向回 `/projects`。

## 2. EntryShell 首页

### 2.1 EntryNavRail(参照 EntryNavRail.tsx:89-193)

- 内容:logo(点击 → `/projects`)、＋新建项目、Home、Projects、折叠按钮(panel-left 图标)。
- manus 式停靠:打开后点导航项不自动收起,仅点折叠按钮关闭;折叠态 `inert` + `aria-hidden`。
- 折叠状态不持久化(刷新重置,与参照一致,EntryShell.tsx:423)。

### 2.2 Home 视图(`/home`,参照 HomeView.tsx:1437-1589,剔除插件区块)

- HomeHero:大输入框,提交 → 创建项目并带 pendingPrompt 语义(预填不自动发、一次性,沿用现有实现)。
- 「导入现有项目」入口(接现有导入能力)。
- RecentProjectsStrip:最近 6 个项目卡片(按 updatedAt 排序)+ View all → `/projects`(参照 RecentProjectsStrip.tsx:38-223)。
- 不做:插件推荐区、模板区、插件详情弹窗(排除项)。

### 2.3 Projects 视图(`/projects`,默认落点,参照 DesignsTab.tsx)

- 搜索框:按项目名过滤。
- 子标签:Recent(最近修改优先)/ Yours(创建时间优先)——纯排序差异(参照 DesignsTab.tsx:291-296)。
- 视图切换:Grid / Kanban,持久化 localStorage(参照 DesignsTab.tsx:40,119-128);Kanban 按运行状态分组。
- Select 模式:批量选择删除(参照 DesignsTab.tsx:106-107,474-510)。
- 空状态:无项目时提示 + 新建/导入入口。

### 2.4 项目卡片(参照 RecentProjectsStrip.tsx:157-218 + DesignsTab)

- 缩略图:入口 HTML 文件 iframe 预览(走现有 raw 预览路由,**不加 CSP**,见记忆勘误);无入口文件时首字母渐变占位。
- 信息:名称、类型标签、运行状态点(generation 进行中显示动画点)、相对时间(刚才/N 分钟前/N 小时前…)。
- 操作:点卡片打开;hover 菜单(打开/重命名/删除带确认);双击名称重命名(参照 DesignsTab.tsx:334-345)。

### 2.5 新建项目

rail 的＋按钮打开现有 NewProjectPanel,以 modal 呈现(参照 NewProjectModal 模式)。创建成功 → `navigate(/projects/:id)`。

## 3. 项目详情页(核心改造)

去掉项目 Sidebar(`Sidebar.tsx` 退役)。结构照参照 ProjectView.tsx:5232-5557:

```
<div class="split">                          // focus 时 "split split-focus"
  <div class="split-chat-slot">ChatPane</div> // focus 时 hidden
  <div class="split-resize-handle" />          // 8px,focus 时不渲染
  <FileWorkspace />                            // flex 占满剩余
</div>
```

### 3.1 ChatPane 顶部

- 返回按钮 → `/projects`。
- 项目名展示。
- **ConversationsMenu** pill(参照 ConversationsMenu.tsx):显示当前对话标题(无题则"对话")+ 对话总数;下拉含:New 新建按钮、对话列表(最近优先、当前项高亮、双击重命名、✕ 删除带确认)、空状态文案。现有 ChatPanel「历史」下拉按此重构。

### 3.2 拖拽分栏(参照 ProjectView.tsx:295-309,451-474,4843-4937)

- 常量:默认 460px、min 345px、max 720px、手柄 8px、键盘步长 16px。
- 持久化:localStorage `webui:project.chatPanelWidth`,读取时 clamp 到 [345,720]。
- 指针:pointerdown 设 pointer capture;pointermove 经 requestAnimationFrame 节流;pointerup 提交并持久化;pointercancel / window blur 回滚到拖拽前宽度。
- 键盘:←/→ ±16px,Home → 最小,End → 最大;立即持久化。
- 无障碍:`role="separator"`、`aria-orientation="vertical"`、`aria-valuemin/max/now`、`tabIndex=0`。
- 拖拽中容器加 `is-resizing-chat` 类(禁用 iframe 指针事件、加视觉反馈)。

### 3.3 Focus 模式(预览扩大化)

- `workspaceFocused` useState,不持久化(与参照 ProjectView.tsx:869 一致)。
- 进入:工作区标签栏最左侧补「隐藏聊天」按钮(chevron-left 图标)。**参照勘误:slim 参照里 `onFocusModeChange(true)` 无任何调用方**(进入触发器随被裁功能丢失),仅存退出按钮;本项目补一个与退出对称的进入按钮,这是对参照的有意补全。
- 退出:focus 时标签栏最左侧 chevron-right「显示聊天」按钮(参照 FileWorkspace.tsx:1794-1807 原样,含 tooltip/aria-pressed)。
- focus 时:chat slot `hidden`、手柄不渲染、工作区占满全宽。

## 4. 工作区与顶栏

### 4.1 顶栏(参照 ProjectView.tsx:5509-5543)

- **WorkingDirPill**(参照 WorkingDirPill.tsx):文件夹图标 + 目录末级名 + 下拉箭头;菜单:「在文件管理器中显示」「替换工作目录」、错误信息展示。
- 设置齿轮:打开现有 ProjectSettingsDialog / settings。
- **HandoffButton**(参照 HandoffButton.tsx:533-762):分体按钮——左半键用首选编辑器打开项目;右半键下拉,两个标签页:Editors(已装/未装编辑器列表)、CLI(框架选择 + CLI 提示复制)。与现有 ExportMenu 并存。

### 4.2 server 新增端点(本地 Express,均为本机操作)

1. `POST /api/projects/:id/reveal` — 在 Finder/文件管理器中显示项目目录。
2. `POST /api/projects/:id/working-dir` — 替换工作目录(校验沿用参照 import-export-routes 的 realpath+lstat 四重校验思路)。
3. `POST /api/projects/:id/open-in-editor` — 用指定编辑器打开(body 带 editor id;server 探测已安装编辑器,提供 `GET /api/editors` 列表)。

### 4.3 标签栏

- Design Files 主标签 + 打开的文件标签:沿用现有体系。
- Questions 标签:条件显示,仅当最后一条助手消息含 `<question-form>` 块时出现(参照 FileWorkspace.tsx:434,1865-1881)。本项目后端目前不产生该块,实现后自然隐藏——行为对齐、成本低。

## 5. 组件与文件变更

新增:`router.ts`、`EntryShell.tsx`、`EntryNavRail.tsx`、`HomeView.tsx`、`ProjectsView.tsx`、`ProjectCard.tsx`、`ConversationsMenu.tsx`、`WorkingDirPill.tsx`、`HandoffButton.tsx`、`QuestionsPanel.tsx`。
改造:`App.tsx`(变为路由分发壳)、`ChatPanel.tsx`(顶部区重构)、`Workspace.tsx`(focus 按钮、顶栏接入)、`NewProjectPanel.tsx`(modal 化)。
退役:`Sidebar.tsx`。
server:`index.ts` 或新文件加 3 个端点 + 编辑器探测。

## 6. 错误处理

- 路由指向不存在的项目/对话:重定向 `/projects` 并提示。
- 拖拽中断(pointercancel/blur):回滚拖拽前宽度,不持久化。
- localStorage 读取异常/越界值:回落默认 460。
- reveal/open-in-editor 失败:WorkingDirPill / HandoffButton 内联错误提示(参照 WorkingDirPill.tsx:183-220 的错误展示位)。
- 缩略图 iframe 加载失败:回落首字母渐变占位。

## 7. 测试

- `router.test.ts`:parseRoute/buildPath 全路径表 + 未知路径回落。
- 宽度逻辑单测:clamp、持久化读写、键盘步进边界。
- Projects 视图单测:搜索过滤、Recent/Yours 排序、批量删除选择集。
- ConversationsMenu 单测:排序、重命名、删除确认流。
- server 端点单测:working-dir 校验拒绝路径逃逸。
- 现有测试全部保持绿。
