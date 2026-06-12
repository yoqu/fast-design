# 预览可视化文案编辑（Visual Text Edit）设计

日期：2026-06-11
状态：已定稿（自治模式下按项目既有模式自答澄清问题）

## 1. 目标

在右侧 HTML 预览 iframe 中支持「可视化编辑文案」：

- 工具栏开关进入编辑模式 → iframe 内悬停高亮可编辑文本 → 点击就地编辑（plaintext-only）→ Enter/失焦提交，Esc 取消；
- 提交后把改动**写回源 HTML 文件**（复用 `PUT /api/projects/:id/file`），无需整页刷新即可继续编辑；
- 提供逐步撤销；定位失败（如脚本渲染文本）时明确报错并还原 DOM。

### 非目标（YAGNI）

- 属性文案（alt/placeholder/title）、富文本/结构编辑、样式编辑；
- ~~JS 渲染文本的跨文件溯源（.jsx 等）——检测到无法定位时报错即可~~（2026-06-11 已实现，见附录 A）；
- 多人协同/冲突合并。

## 2. 方案选型

| 方案 | 思路 | 取舍 |
|---|---|---|
| A. 整页 DOM 序列化写回 | `documentElement.outerHTML` 覆盖源文件 | 脚本已执行、DOM 已变异，会摧毁 JS 驱动页面的源码。**弃** |
| B. 文本节点级编辑 + 宿主端源文本匹配回写（**选定**） | bridge 只上报 `{oldText,newText,occurrence}`，宿主在源码字符串里按匹配策略替换第 n 处 | 零新依赖、不动源码其余部分、失败模式优雅（报错+还原）；对静态原型 HTML 覆盖率高 |
| C. daemon 用 parse5 标注源码偏移 | 服务 HTML 时生成 text node → offset 映射注入页面 | 精确但引入解析依赖与 DOM/解析器对齐假设，JS 变异页面同样失效，复杂度不成比例。**弃** |

## 3. 架构与数据流

```
FileViewer 工具栏「文案」开关
   │ postMessage pi:edit:activate / deactivate
   ▼
预览 iframe（daemon 注入 TEXT_EDIT_BRIDGE，?bridge=snapshot,edit）
   │ 悬停高亮 → 点击 → contenteditable=plaintext-only → 提交
   │ postMessage pi:edit:commit {id, edits:[{oldText,newText,occurrence}]}
   ▼
FileViewer 提交队列（串行）
   readFile(file) → applyTextEdits(source, edits)（全部成功才落盘）
   → putFile → undo 栈入栈 → 回送 pi:edit:result {id, ok}
   失败：回送 {ok:false, reason} → bridge 还原文本节点值
```

写盘触发 SSE `files-changed` → Workspace `reloadKey+1`；FileViewer 在编辑模式下**冻结 reload**（记 pending，退出编辑/手动刷新时再应用），否则每次保存都重挂 iframe、丢滚动位置。

## 4. 组件设计

### 4.1 server/src/bridges.ts —— 文案编辑 bridge

- 新增 `URL_PREVIEW_TEXT_EDIT_BRIDGE`（标记 `data-pi-text-edit-bridge`，防重 `window.__piTextEditBridge`），风格与 snapshot bridge 一致（IIFE、无依赖）。
- `wantsTextEditBridge(value)`：token `edit` / `text-edit` / `text`；`injectTextEditBridge(html)` 复用 `injectBeforeBodyClose`。
- 预览路由（server/src/index.ts:489 附近）：HTML 响应按需分别注入两个 bridge；FileViewer 请求 `?bridge=snapshot,edit`（仅 .html 预览）。

bridge 行为：

- **激活**：注入高亮样式 `<style data-pi-text-edit-style>`；document 捕获阶段挂 `mouseover/mouseout/click`；回 `pi:edit:state {active:true}`。
- **可编辑判定**：从 `event.target` 向上找最近的、含**直接非空白文本节点**的元素；`script/style/noscript`、bridge 自身节点排除。
- **进入编辑**：click 捕获阶段 `preventDefault+stopPropagation`（压制链接/按钮）；
  1. 对目标元素子树内每个非空白文本节点记录 `{node, value, occurrence}`——occurrence = 文档顺序 TreeWalker 中 `nodeValue` 与之相等的文本节点里的 0-based 序号（**进入编辑前**快照，保证基于未修改的 DOM）；
  2. `contenteditable=plaintext-only`（不支持则 `true`）+ `spellcheck=false`，按点击位置落 caret；
  3. Enter=提交（preventDefault）、Esc=取消还原、blur=提交。
- **提交**：逐节点 diff（节点被浏览器移除视为 `newText:''`），有变化则发 `pi:edit:commit`；等待 `pi:edit:result`，失败把各节点 `nodeValue` 还原为旧值。
- **撤销不经 bridge**：宿主撤销直接写回快照并重载 iframe（见 4.3），bridge 无需 undo 协议。
- **load 即发 `pi:edit:ready`**：宿主若开关仍开，重发 activate（覆盖手动刷新场景）。

### 4.2 web/src/lib/textEdit.ts —— 纯逻辑层（仿 tweaks.ts，便于测试）

消息类型 + 折算器：

```ts
type TextEditCommit = { id: string; edits: TextEditOp[] };
type TextEditOp = { oldText: string; newText: string; occurrence: number };
reduceTextEditMessage(data): { ready?: true; active?: boolean; commit?: TextEditCommit } | null
```

源码回写核心：

```ts
applyTextEdits(source: string, edits: TextEditOp[]): string | null  // 任一失败返回 null（原子）
applyTextEditToSource(source, op): string | null
encodeHtmlText(text): string
htmlTextRegions(source): Array<{ start: number; end: number }>
```

同一 commit 内若多个 op 的 `oldText` 相同，按 `occurrence` 降序应用，避免前一次替换使后续序号偏移。

`applyTextEditToSource` 用**单一宽松正则**在源码中枚举匹配并取第 `occurrence` 个（宽松正则天然涵盖 raw 与实体编码两种形态，避免多策略在「混合编码的相同文案」场景下选错序号）：

- 逐字符构造：可实体化字符用替代选（`&→(?:&amp;|&)`、`<`、`>`、`"`、`'` 同理），不换行空格用 `(?:&nbsp;|&#160;|&#[xX]a0;|\u00a0)`，其余非 ASCII 字符附加数字实体替代选（`&#十进制;|&#[xX]十六进制;`，十六进制按字符类大小写容忍），`\n` 用 `(?:\r?\n|&#10;)`，其余 regex-escape。

**文本区域掩码（关键正确性约束）**：`htmlTextRegions(source)` 用轻量状态机扫出「元素文本内容」区间——跳过标签内部（含属性值）、注释、`script/style/textarea/noscript` 原始文本内容（`title` 保留，与 DOM TreeWalker 口径一致）。只有完全落在文本区间内的匹配才参与 occurrence 计数，防止把属性值或脚本字符串里的同名文本当成第 n 处替换掉。bridge 侧的可编辑判定与 occurrence 计数同样跳过 `script/style/noscript/textarea`。

替换文本统一最小实体编码（`& < >`）后写入，保证源码合法；DOM 解码后仍等于 `newText`，连续二次编辑仍可由宽松正则命中实体形态。文本区间内匹配数 ≤ occurrence 则返回 null（典型场景：脚本渲染文本）。

### 4.3 FileViewer.tsx —— 宿主集成

- 状态：`textEditOn`、`textEditStatus: {kind:'idle'|'saving'|'saved'|'error', message?}`、`undoStack: string[]`（提交前整文件源码快照，上限 50，切文件清空）、`frozenReloadKey`（冻结期沿用的 reloadKey）。
- 工具栏：Tweaks 旁新增「文案」toggle（仅 `/\.html?$/i` 文件显示，`aria-pressed`，样式同 Tweaks 按钮）；undo 栈非空时显示「撤销」；右侧小字状态（保存中…/已保存/错误信息）。
- previewUrl 改为 `?bridge=snapshot,edit`（仅 html 时带 edit）。
- 消息处理沿用现有 `onMessage`（校验 `ev.source === iframe.contentWindow`）：
  - `ready` → 若 `textEditOn` 重发 activate；
  - `commit` → 入串行队列：`api.readFile` → `applyTextEdits` → `api.putFile` → 入 undo 栈 → 回 `pi:edit:result {ok:true}`；任一步失败回 `{ok:false, reason}` 并置 error 状态。
- **reload 冻结**：`textEditOn` 期间外部 `reloadKey` 变化不透传（`frozenReloadKey` 不更新），不重建 previewUrl/iframe；退出编辑模式时同步到最新值（若有变化即重挂 iframe）。手动刷新（`localReload`）不冻结——用户显式操作。文档化副作用：编辑模式下 agent 改文件不会即时反映，退出后刷新。
- **撤销**：弹出栈顶源码快照 → `putFile(快照)` → `localReload+1` 重载 iframe（bridge `ready` 后自动重新激活）。比逐 op 反演简单且无序号漂移风险；代价仅撤销时丢滚动位置。
- 切换文件/项目时强制退出编辑模式并清空栈。

### 4.4 错误处理

| 场景 | 行为 |
|---|---|
| 文本区间内未命中（脚本渲染文本等） | 不写盘；回 `{ok:false}`，bridge 还原 DOM；状态栏「无法在源码中定位该文本（可能由脚本生成）」 |
| readFile/putFile 网络错误 | 同上，展示错误信息 |
| 多节点提交部分失败 | 原子：全部成功才写盘，否则整体还原 |
| 撤销写盘失败 | 状态栏报错；该快照已弹栈不恢复（用户可重试编辑） |

## 5. 测试策略

- `server/src/bridges.test.ts`：`wantsTextEditBridge` token 解析；`injectTextEditBridge` 注入位置/防重/无 `</body>` 兜底；与 snapshot 双注入共存。
- `web/src/lib/textEdit.test.ts`：消息折算；raw/实体/`&nbsp;`/非 ASCII 实体命中与 occurrence 选择；`htmlTextRegions`（属性值/注释/script/style/textarea 不计入，title 计入）；newText 实体编码；连续编辑（写后再改）；原子多 op 与同文案 occurrence 降序应用；定位失败返回 null。
- bridge 脚本与 FileViewer 集成为手动验证（`pnpm dev`），与项目现状一致（组件无单测先例）。

## 6. 验收标准

1. 打开任一 HTML 预览 → 点「文案」→ 悬停出现高亮 → 点击标题改字 → Enter → 文件内容已更新（文件面板/重新打开可见），iframe 不整页刷新；
2. 编辑 `<p>Hello <b>world</b></p>` 中任意片段均能正确回写；含 `&amp;` 实体的文案编辑正确；
3. 撤销逐步还原文件与画面；
4. 对 Babel/JSX 渲染页面的文本编辑给出明确错误且页面文本还原；
5. `pnpm test`、`pnpm build` 全绿。

## 附录 A：脚本源码降级定位（2026-06-11 追加）

实测中用户预览的全是 React/Babel JSX 页面（body 仅 `<div id="root">`），原"定位失败报错"
的边界使编辑模式完全不可用，故补齐脚本源码降级定位：

- `textEdit.ts` 新增 `htmlScriptSources`（扫内联脚本内容区间 + 外部 src，引号感知、跳注释）、
  `resolveScriptPath`（相对 HTML 目录 / 项目根解析，外链与越界返回 null）、
  `planTextEdits`（每 op 先试 HTML 文本区域，未命中则要求在「内联脚本 + 本地脚本文件」全集
  中**恰好出现一次**才替换——JS 渲染下 DOM occurrence 与源码顺序无对应关系，多处命中报
  ambiguous 而不猜）。
- 脚本侧替换是精确原文匹配 + 原文写回（无实体编码）；newText 引入 oldText 没有的
  `' " \` \\ < > { }` 换行或含 `</script` 时报 unsafe 拒绝，防破坏 JS/JSX 语法。
- FileViewer：HTML 直接命中仍走原路径（不读脚本）；降级时并发拉取本地脚本、按 plan 多文件
  写回；undo 栈由整文件字符串改为受影响文件快照组 `{path, content}[]`。
- 错误文案三分：定位失败「可能由脚本动态拼接」/「出现多处，无法唯一定位」/「含可能破坏
  脚本语法的字符」。
- 已知边界：同一文案在多个源文件重复（如 C 端/B 端各写一份数据）时报 ambiguous，需在源码
  中改；动态拼接文本（变量插值）仍无法定位。

## 附录 B：Babel 浏览器内插桩精确定位（2026-06-11 三期）

附录 A 的唯一匹配在真实项目里大量报 ambiguous（C 端/B 端各写一份数据，长标题都重复）。
利用「页面用 @babel/standalone 在浏览器内编译」的特点做零构建链路插桩：

- **时机**：text-edit bridge 注入在 `</body>` 前同步执行，早于 Babel standalone 的
  DOMContentLoaded 编译钩子（实测 7.29.0：`window.addEventListener('DOMContentLoaded',
  transformScriptTags)`）。
- **插桩**：bridge 启动时 `Babel.registerPlugin('pi-loc', ...)`——JSXOpeningElement 且
  名字为小写 JSXIdentifier（宿主元素，组件名会变 props 不落 DOM）时 push 属性
  `data-pi-loc="<fileIdx>:<line>:<column>"`（loc 为 babel 1-based line / 0-based column）；
  文件表存 `window.__piLocFiles`（`state.file.opts.filename`：外部脚本 = script.src 绝对
  URL，内联 = "Inline Babel script (N)"）。再给每个 `text/babel|text/jsx` script 补
  `data-plugins`：**无则必须带默认三件套**（transform-class-properties,
  transform-object-rest-spread,transform-flow-strip-types——data-plugins 会整体覆盖默认），
  有则追加 `,pi-loc`。无 window.Babel 的纯 HTML 页面静默跳过。
- **采集**：snapshotRecords 时从文本节点父链找最近 `data-pi-loc` 祖先，occurrence = 该
  祖先子树内同值文本节点序号；commit edits 项新增可选
  `loc: { source, line, column, occurrence }`。
- **宿主写回**（textEdit.ts）：`resolveLocSource` 把 source 还原为项目文件
  （URL 取 `/preview/<scope>/(.+)` 解码）或第 N 个内联 babel 脚本（htmlScriptSources
  inline 条目带 type）；`applyTextEditAtLoc` 由 line/column 算 offset，从 offset 起取第
  occurrence+1 个 oldText 精确匹配替换（安全校验同附录 A）。planTextEdits 中**带 loc 的
  op 优先走 loc**（同文件多 op 按 offset 降序替换防偏移），loc 解析/命中失败回落附录 A
  链路。组件 children 文本（`<Button>报名</Button>`）的最近宿主祖先 loc 指向组件定义处、
  搜不到字面量 → 自然回落 unique 匹配。
- **不泄漏**：snapshot bridge 输出 PNG（canvas），data-pi-loc 只活在预览 DOM。
- 协议向后兼容：无 loc 字段的 commit 行为与附录 A 一致。
