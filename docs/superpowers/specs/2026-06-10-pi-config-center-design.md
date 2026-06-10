# Pi Agent 配置中心设计

日期：2026-06-10
状态：已确认（用户逐项批准）

## 背景与目标

Pi Web Studio 目前没有任何配置界面：provider/API key 完全依赖用户在终端预先配好 pi CLI，系统提示词硬编码在 `server/src/pi-session.ts`，项目级 `model` 字段后端支持但前端未暴露。

本设计补齐配置能力：**直接读写 pi 的全局配置文件**（`~/.pi/agent/` 下的 `settings.json` / `auth.json` / `models.json`），加上 pi 安装检测与引导。webui 不另存一份 provider 配置（自定义指令除外，见下）。

### 范围

- ✅ pi 安装检测 + 安装引导（不做一键安装）
- ✅ AI Provider 配置：内置 28 个 provider 的 API key 管理 + models.json 自定义 provider CRUD
- ✅ 全局默认 provider / model / thinking level
- ✅ Skills 管理：列出、启用/禁用、创建、编辑、删除
- ✅ Extensions 管理：列出、安装、卸载（server 执行 `pi install/remove`）
- ✅ 自定义指令：全局 + 项目级（webui 侧存储，经 `--append-system-prompt` 注入）
- ✅ 项目级配置：model / thinking 覆盖、项目指令（写 `.webui/meta.json`）

### 非目标

- ❌ MCP 配置（pi 原生不支持 MCP，明确砍掉）
- ❌ 一键安装 pi（环境差异风险大，只做指导）
- ❌ pi 的其余 settings 字段（compaction、retry、UI 等）的可视化编辑
- ❌ OAuth 登录流程（订阅型凭证只读展示，引导去终端 `pi /login`）

## pi 配置面事实（v0.78.0 核实）

| 载体 | 内容 | 本设计的用法 |
|---|---|---|
| `~/.pi/agent/settings.json` | `defaultProvider` / `defaultModel` / `defaultThinkingLevel`、`skills` 数组（支持 glob、`+path` 强包含、`-path` 强排除）及几十个其他字段 | 读写默认模型三项 + skills 排除项；**读-改-写，保留未知字段** |
| `~/.pi/agent/auth.json` | 按 provider 键存 API key（字符串）或 OAuth token（对象） | key 的写入/删除；OAuth 条目只读 |
| `~/.pi/agent/models.json` | 自定义 provider/模型（Ollama、vLLM、任意 OpenAI/Anthropic 兼容端点） | 自定义 provider CRUD |
| `~/.pi/agent/skills/` | 全局技能目录（SKILL.md per 目录，根级 .md 也算技能） | 扫描列出 + 创建/编辑/删除 |
| 项目 `.pi/skills/` | 项目级技能 | 扫描列出（分组展示） |
| `pi --version` | 版本号 | 安装检测 |
| `pi --list-models` | 内置模型全列表 | 模型下拉数据源 |
| `pi list` / `pi install <source>` / `pi remove <source>` | 扩展包管理 | Extensions 分区 |
| `--model` / `--thinking` / `--append-system-prompt`（可重复） | 启动参数 | 会话启动时注入项目级覆盖与自定义指令 |

关键限制：pi 全局配置中**没有自定义系统提示词字段**，故自定义指令存 webui 侧：全局存 `data/webui-settings.json`，项目级存 `data/projects/<id>/.webui/meta.json`，启动时拼 `--append-system-prompt`。

## 架构

### server：pi-config 模块

新增 `server/src/pi-config.ts`（必要时拆 `pi-skills.ts` / `pi-cli.ts`），职责：

- pi 全局配置文件的读写层（settings.json / auth.json / models.json）
- 技能目录扫描与 SKILL.md frontmatter 解析
- pi CLI 子进程调用（version / list-models / list / install / remove）
- pi 主目录定位：`~/.pi/agent`（支持测试时用环境变量覆盖 HOME 或目录）

### web：SettingsDialog

仿 open-design 形态：左侧分区导航 + 右侧内容面板的弹窗，入口为 Sidebar 底部齿轮按钮。分区：

1. **Provider 与模型**（execution）
2. **自定义指令**（instructions）
3. **Skills**
4. **Extensions**
5. **关于**（pi 版本、配置文件路径、状态）

## 后端 API

全部挂 `/api/pi/*`；项目级配置走已有 projects 路由。

| 端点 | 方法 | 功能 |
|---|---|---|
| `/api/pi/status` | GET | `pi --version` 检测；返回 `{installed, version?, piDir?}`；ENOENT → `installed: false` |
| `/api/pi/settings` | GET/PUT | settings.json 的 `defaultProvider` / `defaultModel` / `defaultThinkingLevel` |
| `/api/pi/providers` | GET | 内置 provider 列表（硬编码 pi 文档 28 项对照表：id、名称、env var、auth.json 键名）+ 每项的 key 状态（`configured` + 尾 4 位 mask）+ OAuth 标记 + models.json 自定义 provider |
| `/api/pi/providers/:id/key` | PUT/DELETE | 写/删 auth.json 中对应 key；OAuth 条目拒绝写删（409） |
| `/api/pi/custom-providers` | GET/POST | models.json 条目列表/新增 |
| `/api/pi/custom-providers/:id` | PUT/DELETE | models.json 条目改/删 |
| `/api/pi/models` | GET | `pi --list-models` 解析为 `{provider, id, name}[]` |
| `/api/pi/skills` | GET | 全局 + 当前项目技能：`{name, description, path, scope: 'global'\|'project', enabled}` |
| `/api/pi/skills/toggles` | PUT | 启用/禁用 → 维护 settings.json `skills` 数组中的 `-path` 排除项 |
| `/api/pi/skills` | POST | 创建：`{name, description}` → 生成 `~/.pi/agent/skills/<name>/SKILL.md` 模板 |
| `/api/pi/skills/content?path=` | GET/PUT | 读/写 SKILL.md 全文；PUT 时校验 frontmatter 含 name、description |
| `/api/pi/skills?path=` | DELETE | 删除技能目录（路径校验，见安全节） |
| `/api/pi/extensions` | GET | `pi list` 解析 |
| `/api/pi/extensions` | POST | `{source}` → `pi install <source>`；返回 `{ok, output}` |
| `/api/pi/extensions/:source` | DELETE | `pi remove <source>`；返回 `{ok, output}` |
| `/api/pi/instructions` | GET/PUT | 全局自定义指令（`data/webui-settings.json`） |
| `/api/projects/:id` | PATCH | 新增：更新 `model` / `thinking` / `instructions` |

## 前端行为

### 未安装 pi

应用启动先查 `GET /api/pi/status`。未安装 → 整个应用替换为全屏引导页：前置要求（Node ≥ 20）、`npm install -g @earendil-works/pi-coding-agent`（一键复制按钮）、「重新检测」按钮。检测通过自动进入正常界面。

### Provider 与模型分区

- 顶部三个全局默认下拉：provider（内置+自定义合并）、model（来自 `/api/pi/models`，按所选 provider 过滤；自定义 provider 则列其 models.json 模型）、thinking level（off/minimal/low/medium/high/xhigh）。
- Provider 列表：已配 key 的排前、带状态点；每项展开可输入/更新/删除 API key。
- OAuth 型凭证（auth.json 值为对象）：显示「已通过 OAuth 登录」，只读，文案提示用终端 `pi /login` 管理。
- 自定义 provider 表单：name、baseUrl、API 类型（`openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai` 四选一）、API key（可选）、模型条目数组（id、名称、contextWindow、maxTokens 等，可多条）。

### Skills 分区

- 按全局/项目分组列表：名称 + 描述（frontmatter）+ 启用开关。
- 「新建技能」：输入名称（kebab-case 校验）→ 生成模板 SKILL.md → 进编辑器。
- 编辑器：纯文本 textarea 全文编辑，保存时 frontmatter 校验失败则报错不写入。
- 删除需二次确认。

### Extensions 分区

- 已装列表 + source 输入框安装。
- 安装/卸载期间按钮 loading；命令 stdout/stderr 展示在折叠面板，失败原样透出。

### 自定义指令分区

全局多行文本框，文案注明「将追加到 pi 的系统提示词，新会话生效」。

### 项目级配置

项目工作区顶栏设置图标 → 小弹窗：model 覆盖（默认「跟随全局」）、thinking 覆盖、项目指令文本框。写 `.webui/meta.json`。创建项目表单同步加可选 model 下拉。

## pi 启动注入（pi-session.ts 改造）

优先级：项目级 → 全局（pi 自己读 settings.json）→ pi 默认。

- `--model`：项目 meta 有则传；无则不传该参数
- `--thinking`：同上
- `--append-system-prompt`：依次为独立参数——现有硬编码段（保留）、全局自定义指令（非空时）、项目指令（非空时）

配置改动只对**新启动的会话**生效；设置界面保存时提示这一点。

## 边界与安全

- auth.json / models.json 不存在 → 视为空配置，首次写入时创建。
- 任一配置文件 JSON parse 失败 → 报「配置文件损坏」（500 + 文件路径），**拒绝写入，绝不覆盖**。
- settings.json 写入必须读-改-写保留所有未知字段。
- API key 全链路不回显明文：GET 仅 `configured` + 尾 4 位；PUT 仅在用户提交新值时发生。
- 技能路径操作（读/写/删）必须解析后校验落在 `~/.pi/agent/skills/` 或项目 `.pi/skills/` 内，防目录穿越。
- `pi install` 的 source 校验为 npm 包名或 `git:` 前缀格式，参数数组传递（不拼 shell 字符串）。
- `pi install/remove` 为长耗时命令，设超时（如 5 分钟），并发互斥（同一时间只允许一个安装任务）。

## 测试

server 为重点：

- pi-config 模块单测：临时目录模拟 `~/.pi/agent`（fixture），覆盖读-改-写保字段、key mask、OAuth 只读、skills 排除逻辑、frontmatter 校验、路径穿越拒绝、损坏 JSON 拒写。
- API 集成测试：含 pi 未安装（spawn ENOENT mock）路径。
- pi CLI 调用封装可注入（便于 mock）。

前端沿用项目现状，以手测为主。

## 实现影响面

- `server/src/pi-config.ts`（新）、`server/src/index.ts`（挂路由）、`server/src/projects.ts`（PATCH + meta 字段）、`server/src/pi-session.ts`（启动参数）、`server/src/types.ts`
- `web/src/components/SettingsDialog.tsx`（新，含各分区子组件）、`web/src/components/Sidebar.tsx`（齿轮入口 + 创建表单 model 下拉）、`web/src/components/Workspace.tsx`（项目设置入口）、`web/src/lib/api.ts`、`web/src/lib/types.ts`、`web/src/App.tsx`（安装引导门控）
