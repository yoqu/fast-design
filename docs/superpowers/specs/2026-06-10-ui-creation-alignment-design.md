# 界面创作对齐 open-design 设计（新建项目 / 导入 Claude Design / 首页 / Skill 体系）

日期：2026-06-10
参照：`/Users/yoqu/Documents/code/ai/open-design-slim`（下称「参照」）
基线：本项目已完成「原型链路」复刻（见 `2026-06-10-prototype-flow-design.md`：manifest / 文件面板 / FileViewer / 生成舞台 / scoped 预览 / 导出全家桶均已落地）。本轮把**创作入口侧**对齐参照：新建项目、导入 Claude Design 设计、首页项目管理、skill 选择与注入。规则细节按参照一比一等效还原。

## 0. 业务梳理结论：open-design 界面创作功能项全景

| # | 功能域 | 参照位置 | 本项目状态 |
|---|--------|---------|-----------|
| 1 | 新建项目面板（选项卡/平台/保真度/默认 skill/autoName/pendingPrompt） | `apps/web/src/components/NewProjectPanel.tsx`，`apps/daemon/src/project-routes.ts:1056-1301` | ❌ 本轮范围 |
| 2 | Claude Design ZIP 导入 | `apps/daemon/src/import-export-routes.ts:38-96` + `claude-design-import.ts` | ❌ 本轮范围 |
| 3 | 本地文件夹导入（in-place baseDir） | `import-export-routes.ts:215-357`，`projects.ts:214-225` | ❌ 本轮范围（二期段） |
| 4 | 替换项目工作目录 | `import-export-routes.ts:106-213` | ❌ 本轮范围（二期段） |
| 5 | 首页/项目列表（卡片、搜索、排序、状态、重命名/复制/删除） | `project-routes.ts:1007-1399`，HomeView | ⚠️ 现状仅极简 Sidebar，本轮范围 |
| 6 | pendingPrompt（创建/导入后预填 composer 一次性消费） | `ProjectView.tsx:4939-4987` | ❌ 本轮范围 |
| 7 | Skill 发现/解析/注入 system prompt | `apps/daemon/src/skills.ts:145-314`，`prompts/system.ts:494-685`，`server.ts:10461-10523` | ⚠️ 仅有 pi 原生 skills 管理，无项目级绑定与注入，本轮范围 |
| 8 | Craft 规则注入（按 skill 声明 requires） | `server.ts:10557-10608`，`craft/` 目录 | ❌ 本轮范围 |
| 9 | 生成流程（消息→agent→流式事件→生成舞台→artifact 登记） | `runtime/generation-preview.ts` 等 | ✅ 已复刻 |
| 10 | 文件管理/预览/视口/缩放/导出全家桶/归档 | FileViewer / DesignFilesPanel / exports.ts | ✅ 已复刻 |
| 11 | 项目内多 Conversation / Side chat / Terminal / fork 重生成 | project-routes 多处 | 🚫 范围外 |
| 12 | Live Artifacts、评论标注（selection/draw bridge）、部署分享 | — | 🚫 范围外（沿用既有排除） |
| 13 | deck / media（image/video/audio）/ template 选项卡及其 skill 簇 | NewProjectPanel CreateTab | 🚫 范围外 |
| 14 | 设计系统库（DS picker、design-systems 目录、finalize 流程） | design-systems.ts、finalize 路由 | 🚫 范围外（用户既有明确排除） |
| 15 | 项目模板库（design-templates）、提示词模板（prompt-templates，仅 media 用） | — | 🚫 范围外 |
| 16 | 桌面端信任门（desktop import HMAC token）、sandbox mode、analytics 埋点、i18n、connectors、插件系统 | — | 🚫 范围外（环境不存在） |

## 决策记录（用户离线，以参照实现为规范）

- 沿用上一轮**行为级复刻**策略：不搬运参照组件（NewProjectPanel 2900+ 行，耦合 media/DS/analytics/i18n），在本项目栈内重写；但**规则、默认值、命名格式、校验链、错误文案逐项对齐**；`claude-design-import.ts` 为纯 Node 模块，**原样移植**（含 design-canvas.jsx 归一化）。
- 参照用 SQLite 存项目行，本项目用 `meta.json`——字段语义一一对应，存储介质不复刻。
- 参照的初始 tab 状态存 DB（`setTabs`）；本项目 tab 状态在 localStorage——导入响应携带 `entryFile`，**前端在跳转前写入 localStorage** 达成等效（Claude 导入 → `[entryFile]` 激活；文件夹导入 → 空 tab 落文件面板）。
- 参照「每项目多 Conversation」不复刻：本项目单会话/项目，创建项目时无需建会话行，等效语义由 `history.json` 承担。
- skill 注入走 pi 的 `--append-system-prompt`（参照走 composeSystemPrompt 直拼）；栈序按参照裁剪后保持相对顺序。pi 原生 skills 机制保留不动，od-skill 是 system prompt 级注入，二者互不干扰。
- 设计系统库范围外 ⇒ 移植 skill 时**移除/忽略 `od.design_system.requires` 强制项**，skill body 中引用 design system 的段落按「无激活设计系统」自然降级（参照本身允许 designSystemId 为 null）。

## 1. 数据模型扩展

`.webui/meta.json`（`server/src/projects.ts`）新增字段：

```jsonc
{
  "id": "…", "name": "…", "createdAt": 0, "model": "…",
  "skillId": null,                  // 绑定的 od-skill id，可 null
  "pendingPrompt": null,            // 一次性 composer 预填文本，消费后置 null
  "updatedAt": 0,                   // 列表排序用；聊天回合结束/文件变更/PATCH 时刷新
  "metadata": {
    "kind": "prototype",            // 本项目恒为 prototype
    "platformTargets": ["responsive"],
    "fidelity": "high-fidelity",    // 'wireframe' | 'high-fidelity'
    "includeLandingPage": false,
    "includeOsWidgets": false,
    "nameSource": "user",           // 'user' | 'generated'
    "importedFrom": null,           // 'claude-design' | 'folder' | null
    "entryFile": null,              // 导入时探测的入口文件
    "sourceFileName": null,         // claude-design 导入的原始 zip 名
    "baseDir": null                 // 文件夹导入的 in-place 工作目录（canonical realpath）
  }
}
```

- `PATCH /api/projects/:id` 扩展接受 `{ name?, skillId?, pendingPrompt?: string|null, instructions?, model?, thinking? }`；`pendingPrompt: null` 即清除（对齐参照 `patchProject`）。
- `GET /api/projects` 返回上述全部字段，按 `updatedAt ?? createdAt` 倒序（对齐参照列表排序）。

## 2. 新建项目面板（对齐 NewProjectPanel，裁剪至 prototype）

入口：首页与侧栏「新建项目」按钮 → 模态面板 `web/src/components/NewProjectPanel.tsx`。参照的六个选项卡（`prototype | live-artifact | deck | template | media | other`，NewProjectPanel.tsx:111）只保留 **prototype**，面板底部保留两个导入入口（§3、§4）。

字段与规则（默认值与参照逐项一致）：

| 字段 | 规则 | 参照 |
|------|------|------|
| 名称 | 单行输入，可空；提交时 `name.trim()`，空 → `autoName`：`` `${tab 标签} · ${new Date().toLocaleDateString()}` ``（即「Prototype · 2026/6/10」），并记 `nameSource:'generated'`，否则 `'user'` | NewProjectPanel.tsx:696-703, 2918-2929 |
| 初始提示词 | 多行 textarea，可空；非空 → 存为 `pendingPrompt`（不自动发送，见 §6） | project-routes.ts:1056+ |
| 目标平台 | 多选，6 项：`responsive / web-desktop / mobile-ios / mobile-android / tablet / desktop-app`，默认 `['responsive']`；UI 为下拉多选（主选项 + 计数） | NewProjectPanel.tsx:74-109, 316, 1082-1114 |
| 保真度 | 二选一 `wireframe / high-fidelity`，默认 `high-fidelity` | NewProjectPanel.tsx:313 |
| 包含 Landing Page | 开关，默认 false | :317 |
| 包含 OS Widgets | 开关，默认 false | :318 |
| Skill | **自动默认**：`skills.filter(mode==='prototype')` 中 `defaultFor` 含 `'prototype'` 的第一个，否则第一个 prototype skill，否则 null；提供下拉允许改选（含「无」） | NewProjectPanel.tsx:445-452 |

提交：`POST /api/projects`，body `{ name, skillId, pendingPrompt?, metadata }`。服务端：

- `name.trim()`；id 沿用现有随机 hex 生成；校验 id 安全（对齐参照 `isSafeId`，本项目生成端可控、仅防御性校验）。
- 创建 `data/projects/<id>/` + `.webui/meta.json`；**不预置任何文件**（对齐参照：空项目落在文件面板/聊天）。
- 响应 `{ project }`；前端跳转项目页。

## 3. Claude Design ZIP 导入（一比一移植）

### 3.1 服务端

新模块 `server/src/claude-design-import.ts`：**从参照 `apps/daemon/src/claude-design-import.ts` 原样移植**（零依赖纯 Node：自写 ZIP central-directory 解析 + `inflateRawSync`）。完整规则：

- 限额：`MAX_FILES=5000`、`MAX_TOTAL_BYTES=100MiB`、`MAX_FILE_BYTES=25MiB`（解压后逐项与总量校验，central directory 报 0 的 streaming zip 以 `MAX_FILE_BYTES` 为 inflate 上限解码后实测）。
- 拒绝：加密 entry（flags&1）、压缩方法非 0/8、绝对路径/盘符路径、含 `\0` 的文件名、路径逃逸（`sanitizeZipPath`→`validateProjectPath` + 落盘前 `safeJoin` 双保险）、entry 越界、解码尺寸与 central directory 不符。
- 空包/无 HTML：`zip contains no files` / `zip does not contain an HTML file` 报错。
- 入口选择 `chooseEntryFile`：忽略大小写的 `index.html` → 第一个根目录（不含 `/`）HTML → 第一个 HTML（claude-design-import.ts:264-274）。
- **design-canvas.jsx 归一化**：`normalizeImportedClaudeDesignFile` 整段移植——重写 Claude Design 导出画布的 wheel/gesture 处理（普通滚轮改平移、Cmd/ctrl+wheel 缩放、notched wheel 按 `exp(-sign*0.18)` 档位、Safari gesture 抑制）；任一 regex 未命中时输出 `[claude-design-import]` console.warn（:83-181）。

路由 `POST /api/import/claude-design`（multipart 单文件字段 `file`，multer 临时目录）：

1. 无文件 → 400 `zip file required`；文件名非 `/\.zip$/i` → 删除临时文件，400 `expected a .zip file`。
2. `baseName = originalname 去 .zip 后 trim()`，空则 `'Claude Design import'`。
3. `importClaudeDesignZip(tmpPath, data/projects/<id>)` 落盘 → 删除临时文件（成功失败都删）。
4. 写 meta：`name=baseName`、`skillId:null`、`pendingPrompt = "Imported from Claude Design ZIP: ${originalName}. Continue editing ${entryFile}."`、`metadata = { kind:'prototype', importedFrom:'claude-design', entryFile, sourceFileName: originalName }`。
5. 响应 `{ project, entryFile, files }`（files 为相对路径数组）。任何异常 → 400 `{ error: String(err) }` 并清理临时文件与半成品项目目录。

（对齐 import-export-routes.ts:38-96；desktop token 门/sandbox 检查不存在于本环境，省略。）

### 3.2 前端

新建面板内「Import from Claude Design」入口：`<input type=file accept=".zip">` 单选；导入中按钮置 `importing` 态；失败显示错误条（`Import failed: ${message}` + 可折叠 details，对齐 NewProjectPanel.tsx:708-729）；成功后：写 localStorage tab 状态为 `[entryFile]`/激活 `entryFile` → 关闭面板 → 跳转项目页（pendingPrompt 自动预填，见 §6）。

## 4. 文件夹导入与工作目录替换（二期段）

`POST /api/import/folder` body `{ baseDir, name? }`，校验链与参照逐项一致（import-export-routes.ts:215-357）：

1. `baseDir` 必须为字符串且 trim 非空，`path.isAbsolute(normalize(...))` 必须为绝对路径。
2. `realpath()` 折叠符号链接，失败 → `folder not found`；再 `lstat` 确认 isDirectory（防双层 symlink）。
3. 拒绝文件系统根（`path.parse(p).root === p`）与 data 目录自身/子路径（与 **canonical** data 路径比较，macOS `/var→/private/var` 场景）。
4. `projectName = name?.trim() || path.basename(realpath)`；`detectEntryFile`：根 `index.html` → 根下第一个 `*.html?` → null（projects.ts:214-225）。
5. 项目**不拷贝文件**，`metadata.baseDir` 指向该目录（in-place 工作区，Cursor/Claude Code 模式）；`importedFrom:'folder'`；初始 tab 置空（落文件面板）。
6. 响应 `{ project, entryFile }`。

`POST /api/projects/:id/working-dir` body `{ baseDir }`：同校验链，原地更新 `metadata.baseDir / importedFrom / entryFile`，tab 置空。

**配套改造（本段的真实成本）**：`server` 内所有以 `data/projects/<id>` 为根的逻辑（files CRUD、preview、watch、export、artifacts 扫描）统一改为 `projectRoot(meta) = meta.metadata.baseDir ?? join(PROJECTS_DIR, id)`；`safeResolve` 以该根做穿越校验；`.webui/.pi` 元数据仍存内置目录（baseDir 内不污染用户文件夹）。删除带 `baseDir` 的项目只删内置元数据目录，不动用户文件夹。

## 5. 首页 / 项目列表对齐

现状 Sidebar 极简列表升级为参照式首页（路由 `/` 显示项目网格 + 新建入口；项目页保留三栏）：

- **卡片**：项目名、kind 徽章（prototype / 导入来源徽章 `claude-design`/`folder`）、相对时间（updatedAt）、运行状态点（generating / failed / idle，来源于现有 pi 会话状态 + 最近回合结果）。缩略图一期用首字母色块占位；后续若做实时缩略图需复核参照实现再立项（参照从 artifact 渲染态提取，依赖截图链路）。
- **搜索**：按名称子串过滤（前端过滤即可，对齐参照行为）。
- **排序**：`updatedAt ?? createdAt` 倒序。
- **操作菜单**：打开 / 重命名（行内或弹窗，PATCH name）/ 复制 / 删除（确认后 DELETE，级联停掉 pi 会话——已有）。
- **复制**：`POST /api/projects/:id/duplicate` → 新 id，拷贝项目目录（排除 `.pi`、`.webui/history.json`、`.webui/pi-sessions`，保留生成文件与 sidecar），meta 拷贝后 `name = "<原名> copy"`、时间戳重置、`pendingPrompt:null`。带 `baseDir` 的项目不允许复制（in-place 语义无法安全复制用户目录），返回 400。

## 6. pendingPrompt 语义（对齐 ProjectView.tsx:4939-4987）

- 项目页挂载时若 `project.pendingPrompt` 非空：**预填 composer**（initialDraft，一次性、以 projectId 为粒度），随即 `PATCH { pendingPrompt: null }` 清除持久值——刷新/再次进入不重复预填。
- **不自动发送**（参照仅在 plugin auto-send 旗标下才直接发送，该链路范围外）。
- 来源：新建面板的初始提示词、Claude 导入的固定文案。

## 7. Skill 体系

### 7.1 资产移植（skills/ 目录）

新建 `skills/` 目录，从参照拷贝**画原型直接相关**的 skill（含其 `assets/`、`references/` side files），首批核心集：

| skill | mode | 角色 |
|-------|------|------|
| `frontend-design` | prototype | 默认 skill（defaultFor: prototype），高质量界面生成主链路 |
| `artifacts-builder` | prototype | 多组件 HTML artifact 构建 |
| `web-artifacts-builder` | prototype | Anthropic 官方 artifact 工作流 |
| `image-to-code-skill` | prototype | 先视觉参考图后实现 |
| `login-flow` | prototype | 移动端登录/认证界面 |
| `theme-factory` | design-system | 预设主题应用（不依赖 DS 库，可独立工作） |

可选增强（二批，按需拷贝）：`design-taste-frontend`、`impeccable-design-polish`、`redesign-existing-projects`、`design-review`、`frontend-skill`、`platform-design`、`web-design-guidelines`、`ui-skills`、`ui-ux-pro-max`、`shadcn-ui`、`apple-hig`、`enhance-prompt`。
明确不移植：deck/media（image/video/audio）/template/utility 簇、`design-md`（DS 库范围外）。

同时拷贝 `craft/` 中被上述 skill `od.craft.requires` 引用到的 sections（至少 `typography`、`color`、`anti-ai-slop`）。

### 7.2 加载机制（server/src/od-skills.ts，对齐 daemon skills.ts:145-314）

- `listSkills(roots)`：扫描 `[data/skills（用户，优先覆盖同 id）, <repo>/skills（内置）]` 下各目录的 `SKILL.md`。
- frontmatter 解析字段：`name`、`description`、`triggers`、`od.mode`、`od.category`、`od.default_for`、`od.craft.requires`；忽略 `od.design_system.requires`（DS 范围外）与 `od.critique.policy`。
- `GET /api/skills` → `SkillSummary[] { id, name, description, mode, triggers, defaultFor }`，仅返回 `mode === 'prototype' || 'design-system'`（其余 mode 即使被放进目录也过滤，本项目只有 prototype 面）。
- 保留参照的 ID 别名表机制位（空表起步）。

### 7.3 注入（对齐 composeSystemPrompt 栈序，server.ts:10461-10523 / prompts/system.ts:532-685 裁剪）

pi 会话 spawn 时 `--append-system-prompt` 拼接顺序（保持参照相对顺序）：

1. 现有静态站点约定（SYSTEM_PROMPT_SUFFIX）
2. 全局 instructions → 项目 instructions（已有）
3. `## Active craft references`：按 skill 的 `craftRequires` 读取 `craft/<section>.md` 去重合并
4. `## Active skill — <name>`：skill body，前缀 **skill root preamble**——spawn 前把 skill 目录同步拷贝到项目 `.od-skills/<folder>/`（列入 watch/export 忽略名单），preamble 给出相对路径 `.od-skills/<folder>/` 与绝对路径 fallback（对齐 skills.ts:418-454），使 body 中引用 side files 可寻址。

- `project.skillId` 变更（PATCH）→ dispose 现有 pi 会话，下次消息以新 prompt 重启（`--continue` 续接历史，机制已有）。
- 多 skill 组合（`adHocSkillIds`，`## Composed skill — <name>` 追加）暂不做，预留参数位。

## 8. API 一览（新增/变更）

| 路由 | 变更 |
|------|------|
| `POST /api/projects` | + `skillId`、`pendingPrompt`、`metadata`（平台/保真度/开关/nameSource） |
| `PATCH /api/projects/:id` | + `name`、`skillId`、`pendingPrompt:null` 清除 |
| `GET /api/projects` | + 新字段、updatedAt 倒序 |
| `POST /api/import/claude-design` | 新增，multipart `file` |
| `POST /api/import/folder` | 新增（二期段） |
| `POST /api/projects/:id/working-dir` | 新增（二期段） |
| `POST /api/projects/:id/duplicate` | 新增 |
| `GET /api/skills` | 新增（od-skill 列表；与现有 `/api/pi/skills` 并存不混用） |

## 9. 错误处理与安全

- ZIP 解析全部限额/拒绝规则见 §3.1；解析异常统一 400 `{error}`，临时文件与半成品目录清理。
- 文件夹导入：realpath+lstat+根目录+data 目录四重校验（§4），存储 canonical 路径杜绝 symlink 逃逸写。
- `.od-skills/`、`.webui`、`.pi` 加入 watch 忽略与导出排除清单。
- pendingPrompt 仅作 composer 预填文本，渲染走现有输入框路径，无注入面。

## 10. 测试

- `claude-design-import.test.ts`：程序化构造小 zip（正常多文件 / index.html 缺失但有其他 html / 无 html 报错 / 加密 entry / 超 MAX_FILE_BYTES / 路径穿越 `../` / 绝对路径 / streaming zip size=0 / design-canvas.jsx 归一化命中与未命中 warn）。
- `detectEntryFile`、`chooseEntryFile`、`autoName`（generated/user nameSource）、od-skills frontmatter 解析与用户目录覆盖、craft 合并去重、prompt 栈序快照、folder import 校验链（root/data-dir/symlink）、duplicate 排除清单、pendingPrompt PATCH 清除。
- web：导入成功后 tab localStorage 写入、pendingPrompt 一次性预填。
- 完成门槛：`pnpm test` + `pnpm build`。

## 11. 实施阶段

1. **P1 数据模型 + 新建项目面板 + pendingPrompt**（§1/§2/§6）——独立可交付。
2. **P2 Claude Design ZIP 导入**（§3）——依赖 P1 的 meta 字段。
3. **P3 首页项目列表 + duplicate**（§5）。
4. **P4 Skill 体系**（§7）——资产拷贝 → 加载 → 注入 → 面板接入选择器。
5. **P5 文件夹导入 / working-dir**（§4）——含 projectRoot(baseDir) 全链路改造，单独成段降险。

每阶段按 superpowers 流程出 plan 后实施。
