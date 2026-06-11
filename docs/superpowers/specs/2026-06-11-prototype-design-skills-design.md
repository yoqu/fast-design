# 原型设计 skill 库（仓库内置 + 加载注入）设计

日期：2026-06-11
参照：`/Users/yoqu/Documents/code/ai/open-design-slim`（skill 源），见 [[open-design-reference]]

## 背景与问题

Pi Web Studio 是 open-design「原型（prototype）」这条链路的行为级一比一复刻：浏览器里和 pi agent
对话生成网页，右侧实时预览、多格式导出。agent 的设计能力来自 **skill**。

当前 skill 来源有问题：

- `server/src/pi-skills.ts` 只读取两个 scope：全局 `~/.pi/agent/skills` 与项目 `<projectDir>/.pi/skills`。
- 用户全局目录里全是无关 skill（lark-*、douyin/bilibili/xiaohongshu-upload、website-to-hyperframes 等），
  没有任何网页设计 skill。
- `server/src/index.ts` 的 `launchConfigFor` **根本没有把 skill 注入 agent**——agent 之所以「有」skill，
  完全依赖 pi CLI 对全局目录的自动发现。项目 metadata 里的 `skillId` 当前是死字段（存了不用）。

目标：为本工具**重新定义** skill 集——一套版本化、随仓库走、聚焦网页原型设计的 skill 库，
让 agent 只加载这套设计 skill，不被全局无关 skill 干扰；全局目录不删不改。

## 决策记录（已与用户确认）

1. **安装位置**：仓库内置 `skills/` + 加载器读取（不污染全局；最贴近 open-design 把 `skills/` 随仓库走）。
2. **范围**：prototype 核心 + 关键设计支撑，共 **17 个**（不含 shadcn-ui）。
3. **内容处理**：从 open-design-slim **原样拷贝** SKILL.md 及其子文件，保留 `od:` frontmatter（本应用忽略，无害）；全局 lark 等不动。
4. **agent 加载范围**：spawn 时 `--no-skills` 关掉自动发现 + 显式 `--skill <path>` 只加载启用的内置（及项目）设计 skill。

## 架构

三层，互相通过明确接口解耦：

```
内容层   <repoRoot>/skills/<name>/SKILL.md          ← 版本化的 17 个设计 skill（cp -R 自 open-design-slim）
加载器层 server/src/pi-skills.ts  bundled scope      ← 列表/读取/开关，供设置 UI
注入层   server/src/index.ts launchConfigFor + pi-session spawn  ← --no-skills + --skill 真正喂给 agent
```

### 1. 内容层 — `<repoRoot>/skills/`

新建仓库根目录 `skills/`，原样拷贝以下 17 个（含各自 `references/`、`scripts/`、`LICENSE` 等子文件）：

**Web artifacts 核心 (5)**：`frontend-design`、`frontend-dev`、`artifacts-builder`、
`web-artifacts-builder`、`image-to-code-skill`

**设计系统 / UX 支撑 (8)**：`ui-skills`、`ui-ux-pro-max`、`web-design-guidelines`、
`color-expert`、`brand-guidelines`、`theme-factory`、`enhance-prompt`、`design-review`

**创意方向 / taste + 动效 (4)**：`impeccable-design-polish`、`taste-skill`、`redesign-skill`、`gsap-core`

刻意排除：deck/PPT、fal-*/图像/视频/音频、figma、social/card、文档(docx/pdf)、8 个 gsap 子包、shadcn-ui
——均超出「网页原型预览+导出」范围或会让列表臃肿。

### 2. 加载器层 — `pi-skills.ts` 新增 `'bundled'` scope

- `SkillScope` 类型扩展为 `'global' | 'project' | 'bundled'`。
- `bundledSkillsRoot() = path.resolve(import.meta.dirname, '../../skills')`，与 `projects.ts` 的
  `DATA_ROOT`（`../../data`）同源解析方式，保证 dev(`tsx`)/build 路径一致。
- `listSkills(projectDir)` 顺序调整为 **bundled → global → project**，bundled 设计 skill 排在最前。
- **开关状态**存 `data/webui-settings.json` 新增字段 `bundledSkillsDisabled?: string[]`（存被禁用的 rel），
  不写全局 `~/.pi/agent/settings.json`（那是给 pi 自动发现用的，本场景 pi 已被 `--no-skills` 关掉发现）。
  - `setSkillEnabled('bundled', rel, enabled, …)` 改写该数组。
  - `listSkills` 中 bundled 项 `enabled = !bundledSkillsDisabled.includes(rel)`。
- `resolveSkillFile` / `readSkillContent` / `writeSkillContent` / `deleteSkill` 支持 bundled scope
  （root 指向 `bundledSkillsRoot()`，越界校验同 global）。`createSkill` **改为落 bundled**（返回 scope:'bundled'）——
  全局目录已对用户隐藏，新建技能须落入内置库才可见且会被注入。
- 测试覆盖：bundled 扫描、enabled 计算、越界校验、toggle 读写。

### 3. 注入层 — `launchConfigFor` + `pi-session` spawn

这是让 agent 真正用上的关键改动。

- 在 `server/src/index.ts` 的 `SessionLaunchConfig` 增加 `skillPaths: string[]`。
- `launchConfigFor(id)` 计算 `skillPaths`：取 **bundled 启用** + **project 启用** 两类 skill 的
  **绝对目录路径**（`bundledSkillsRoot()/<rel>`、`<projectDir>/.pi/skills/<rel>`）。
  - 复用 `listSkills(projectDir)`，过滤 `enabled && (scope==='bundled' || scope==='project')`，
    映射成各自 scope root 下的绝对路径。
- `server/src/pi-session.ts` spawn 参数（`buildArgs`/`args` 数组）追加：
  - `--no-skills`（关掉对全局 `~/.pi/agent/skills` 的自动发现——lark 等不再进 agent 上下文）。
  - 对每个 `cfg.skillPaths` 追加 `--skill <abs>`（pi 0.79 原生支持，可重复）。
  - 因 `--no-skills` 也会关掉项目 `.pi/skills` 的自动发现，所以注入层显式把启用的 project skill
    也用 `--skill` 带上，保证项目级 skill 仍生效。
- `skillId` 仍只作为创建流程的「默认高亮 skill」语义（见下），不再期望它单独驱动加载——
  加载由 enabled 开关 + `--skill` 统一决定。

### 4. 创建流程默认 skill

- `web/src/components/NewProjectPanel.tsx`：项目创建时默认 `skillId = 'frontend-design'`
  （原型链路的旗舰 skill），用户可改。
- `server/src/project-create.ts` 的 `skillId` 净化逻辑不变（非法回落 null）。
- 注：skillId 当前不影响实际加载（加载看 enabled 开关），仅作 UI 默认与未来路由预留。本期不强绑。

### 5. 设置 UI — `SkillsSection.tsx`

- 渲染时把 skill 按 scope 分组：「内置设计 skill（bundled）」分组置顶，project 分组其次，可开关、可查看内容。
- **global 分组（lark/上传等）完全不展示**——`listSkills` 仍返回 global（API 不变），但 UI groups 不含 global，
  且 `enabledSkillPaths` 本就排除 global，故既不显示也不注入 agent，全局目录不删不改。
- API 层 `pi-routes.ts` 的 `skillScope()` 接受 `'bundled'`。

## 数据流

```
创建项目 → skillId=frontend-design 存 metadata
对话发起 → sessionFor → launchConfigFor:
            listSkills(projectDir) → 过滤 enabled bundled+project → skillPaths[]
          → PiSession spawn: pi --mode rpc --no-skills --skill A --skill B … --append-system-prompt …
设置面板 → GET /api/pi/skills 列 bundled+global+project
          → PUT toggles(scope=bundled) → 写 data/webui-settings.json.bundledSkillsDisabled
          → 改 toggle 触发 disposeProjectSessions（沿用现有 affectsSession 机制，下回合重启生效）
```

注：toggle bundled 后需让会话重启才生效。现有 `affectsSession` 仅监听 model/thinking/instructions/skillId；
toggle 走的是 `/api/pi/skills/toggles` 路由，需在该路由成功后对相关项目 `disposeProjectSessions(id, true)`，
让下一回合用新 skillPaths 重启 pi。

## 错误处理

- `bundledSkillsRoot()` 不存在（未拷贝）：`listSkills` 的 `scanRoot` 已对 readdir 失败返回空数组，UI 空列表，不崩。
- `--skill` 指向不存在路径：仅传 enabled 项的真实绝对路径，路径来自扫描结果，天然存在；spawn 前可选 `fs.existsSync` 兜底过滤。
- bundled 越界 rel：`resolveSkillFile` 现有 `startsWith(root+sep)` 校验覆盖。
- pi 不支持 `--skill`/`--no-skills`（老版本）：本机 pi 0.79.1 已确认支持；spec 假定 ≥0.79。

## 测试策略

- `pi-skills.test.ts`：bundled 扫描出 17 项、enabled 受 `bundledSkillsDisabled` 影响、bundled 越界拒绝、
  toggle 写入 `data/webui-settings.json`（用 `PI_WEBUI_DATA` 临时目录隔离）。
- 新增 `launchConfigFor` 的 skillPaths 计算单测（或在 index 测试中）：给定 enabled 集，输出绝对路径数组、
  排除 disabled、排除 global scope。
- `pi-session` 的 args 构造若可纯函数化则单测 `--no-skills` + `--skill` 注入；否则人工验证 spawn 命令行。
- `pnpm build` 通过类型检查。

## 范围外（本期不做）

- 不删/改全局 `~/.pi/agent/skills`。
- 不引入 open-design 的 `od.mode`/category/defaultFor 完整 skill 元数据体系（仅原样保留 frontmatter）。
- 不做 skill 市场、design-system 库、Live Artifacts。
- shadcn-ui、deck、图像/视频/音频/figma skill 不纳入。
