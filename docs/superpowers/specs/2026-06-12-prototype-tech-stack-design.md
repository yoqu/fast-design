# 原型技术栈内置与创建流程重设计

日期：2026-06-12
状态：已与用户逐段确认

## 背景与问题

用本应用生成"剪头发预约网站"原型时，产出为纯 HTML/CSS/JS，交互质量远低于此前的小程序原型。调研确认三个根因：

1. **技术栈没有规定**。系统提示词（`server/src/prompts/compose.ts`）只要求 implementation-ready 的 HTML + 真实 JS 行为；`skills/frontend-design/SKILL.md` 第 4 条甚至明确"独立产物默认自包含 HTML/CSS/JS，除非用户要求框架"。纯 HTML 产出是规范使然。
2. **内置 skill 库有 11/17 个是空壳**。`skills/` 下 artifacts-builder、brand-guidelines、color-expert、design-review、enhance-prompt、frontend-dev、theme-factory、ui-skills、ui-ux-pro-max、web-artifacts-builder、web-design-guidelines 仅为"去上游看"的目录卡片，注入上下文却无实质内容，误导 agent。
3. **提示词引用不存在的资产**。`discovery.ts` B 节（"Use the skill's seed + layouts"）与计划模板第 1/4 步要求读取/拷贝 `assets/template.html`、`references/layouts.md`、`references/checklist.md`，但现存 skill 没有一个真的带这些文件。

同时，运行时已支持 React：Claude Design ZIP 导入链路依赖 unpkg React 18 + Babel standalone CDN + 同目录 `.jsx` XHR 加载，预览路由为 raw 语义、无 CSP（红线：不要加回 CSP），已验证可跑。

参考资料：Anthropic Claude Design 系统提示词（github.com/elder-plinius/CL4R1T4S → ANTHROPIC/Claude-Design-Sys-Prompt.txt），规定 React 18.3.1 + Babel CDN、`Object.assign(window, {...})` 跨文件组件共享、样式对象唯一命名、文件 <1000 行拆分、禁 `scrollIntoView`、动效/设备框架 starter 等。

## 用户决策（已确认）

- 默认技术栈：**React 18 + Babel standalone + Tailwind CDN**，全局默认，不在创建面板暴露选项，创建流程 UI 不动。
- stub 处置：**从上游拉取真实内容补全 11 个空壳**（2026-06-12 修订，替代最初的"直接删除"决定），同时新建技术栈核心 skill；仅当上游确实拉取不到时才删除该 stub。保留 6 个已有内容的 skill。
- Anthropic 提示词采纳范围：设计质量原则 + 动效 starter 资产 + 设备框架 starter + 变体探索工作流（全部四项）。
- 架构：**方案 A 双层架构**——系统提示词放硬契约（恒在场），skill 放工艺细节与 starter 资产文件（可拷贝）。

## 第 1 段：系统提示词层（技术栈硬契约）

`server/src/prompts/` 新增 `tech-stack.ts`，导出 `TECH_STACK_PROMPT`；`compose.ts` 的 `designAppendPrompts` 注入顺序改为 **locale → discovery → tech-stack → metadata**。

### 默认栈（固定版本，对齐 Claude Design 导入链路）

- React 18.3.1 + ReactDOM 18.3.1 + @babel/standalone（unpkg 固定版本 URL）+ Tailwind CDN（同样固定到具体版本，禁用 latest 浮动地址）。
- 入口保持 `.html` 壳（manifest 推断、预览、导出全兼容——`artifacts.ts` 本就支持 `react-component`/`mini-app` kind）；交互逻辑写同目录或 `js/` 下的 `.jsx`，由 Babel XHR 加载。
- 每个 `<script type="text/babel">` 独立作用域：跨文件组件必须 `Object.assign(window, { ComponentA, ... })` 暴露；样式对象按组件唯一命名（禁通用 `const styles`）。
- 品牌色 token 走 `css/tokens.css`（oklch）；Tailwind 只做布局/间距工具类，颜色一律引用 token。

### 硬规则（采自 Anthropic 提示词）

- 禁 `scrollIntoView()`（破坏内嵌预览），用其他 DOM 滚动方法。
- 移动端触控目标最小 44px；幻灯片文字最小 24px。
- 单文件超约 1000 行必须拆分为多 `.jsx` 聚合。
- 凡含输入/生成/复制/校验/登录/结算/筛选等动作动词的屏幕，必须是真实受控组件（React state + handlers），不许静态假交互。
- 降级条款：仅当用户明确要求"单文件 / 离线可用"时，才退回自包含纯 HTML，并沿用全部设计质量规则。

### 联动修订（同轮完成，避免两层措辞冲突）

- `compose.ts`：implementation-ready UX rule、interaction-fidelity rule 从"css/ js/ 文件"措辞改写为 React 语义（组件/状态/受控输入）。
- `discovery.ts`："Never paste full HTML" 不变量扩展为含 `.jsx`；H 节多屏 `screens/` 目录结构保留、设备框架部分改为引用 skill 的 frames 组件并按 React 组件复用改写；B 节资产阅读顺序保留、指向新 skill 的实际文件。

## 第 2 段：新建核心 skill `react-prototype`

位置 `skills/react-prototype/`，bundled scope 自动注入（`createSkill`/`listSkills` 现有机制，无服务端代码改动）。结构履行 discovery B 节既有契约：

```
skills/react-prototype/
├── SKILL.md                    ← 工艺规范主文档
├── assets/
│   ├── template.html           ← React 壳 seed：固定版本 CDN 引入、tokens.css 链接、
│   │                              root 挂载点、Babel XHR 加载器、[REPLACE] 占位、
│   │                              noscript/静态兜底文案
│   ├── tokens.css              ← oklch 六色 token 骨架（--bg/--surface/--fg/--muted/--border/--accent）
│   ├── animations.jsx          ← 动效原语：Stage/Sprite/useTime/Easing/interpolate、入出场
│   └── frames/
│       ├── ios-frame.jsx       ← iPhone 外框（Dynamic Island/状态栏/Home indicator）
│       ├── android-frame.jsx   ← Pixel 外框（状态栏/导航栏，Material 语义）
│       └── browser-window.jsx  ← 桌面浏览器窗口铬（红绿灯/地址栏）
└── references/
    ├── layouts.md              ← paste-ready React 屏幕骨架（feed/详情/结算/仪表盘/
    │                              onboarding 序列/设置页等），每个含状态与交互注记
    └── checklist.md            ← P0/P1/P2 自查单
```

### SKILL.md 要点（改编自 Anthropic 提示词工艺部分）

- 组件拆分模式：屏 = `.html` 壳，组件 = `.jsx`；共享组件经 `Object.assign(window)` 注册；拆文件时机。
- 状态约定：受控输入、局部 `useState` 优先、跨屏/持久状态走 `localStorage`（播放位置、表单草稿）。
- 变体探索：默认单文件 + 开关切换变体而非复制多份文件；探索期给 3 个变体，混合"按规范"与突破方向。
- 动效指南：优先 `animations.jsx` 原语，复杂时间线升级 gsap-core skill；动画限 transform/opacity。
- 设备框架：移动端原型必须套 `frames/` 组件，外框 `transform: scale()` 自适应视口，内容固定逻辑尺寸。

### checklist.md 的 P0（节选）

组件全部经 window 暴露、无 `scrollIntoView`、可输入控件全部真实受控、360px 无横向滚动、CDN 版本与契约一致、样式对象无命名碰撞、颜色来自 tokens.css 而非硬编码 hex。

### 与现存 skill 的分工

`react-prototype` 承载技术栈；`gsap-core`（复杂动效）、`taste-skill`/`impeccable-design-polish`（品味打磨）、`image-to-code-skill`/`redesign-skill`（视觉还原）独立互补；`frontend-design` 修订后保留为设计工艺总纲。上游补全后的 11 个 skill 按各自领域（品牌规范/主题/配色/设计评审/提示词增强等）与之并存——技术栈契约由系统提示词层恒置顶，skill 内容与之冲突时以契约为准。

## 第 3 段：清理、错误处理、测试与验收

### skill 库补全（替代删除）

11 个 stub 全部带 `od.upstream` 地址，已核实可公网访问，来源：

- anthropics/skills 官方：brand-guidelines、theme-factory、web-artifacts-builder
- 厂商官方仓：web-design-guidelines（vercel-labs/skills）、frontend-dev（MiniMax-AI/skills）、enhance-prompt（google-labs-code/skills）
- 社区仓：artifacts-builder（ComposioHQ/awesome-claude-skills）、ui-skills（ibelick）、ui-ux-pro-max（nextlevelbuilder）、color-expert（meodai）、design-review（garrytan/gstack）

补全流程（**每个 stub 一个子 agent 并行执行**）：

1. 读取本地 stub 的 `od.upstream`，定位上游仓里该 skill 的实际目录（URL 可能指仓库根，需在仓内按名字/SKILL.md 查找）。
2. 浅克隆或按文件清单拉取该 skill 的**全部文件**（SKILL.md + references/ + assets/ + scripts/ 等），整目录覆盖本地 stub。
3. frontmatter 合并：上游正文为准，但保留/回填本地 `od:` 块（mode/category/upstream），name 与目录名保持一致。
4. 轻量适配，只修"坏掉的部分"：指向 claude.ai 专属工具或不存在路径的硬指令改为本应用语义；不重写、不删减上游工艺内容。与 tech-stack 契约冲突的条款无需逐条改——discovery 顶部已声明 OD core directives 覆盖后续一切内容。
5. 拉取失败（仓库消失/路径不存在/无实质内容）的 stub 才删除，并在实施记录里列出名单与原因。

其余清理：

- 修订 `frontend-design/SKILL.md` 第 4 条：默认栈改为"React 原型栈（见 react-prototype skill）"，自包含纯 HTML 降为用户显式要求时的例外（注意：若上游补全也覆盖 frontend-design，此修订在覆盖后的版本上做）。
- 边界验证：`pi-skills.ts` 的 `bundledSkillsDisabled` 按目录扫描合并，个别 skill 目录若被删除，配置中的残留名字应被自然忽略——实现时验证，不写迁移代码。

### 错误处理 / 降级

- CDN 不可达 → template.html 内置 `<noscript>` 与 root 静态兜底文案（"需要网络加载 React 运行时"）；SKILL.md 注明离线场景走纯 HTML 降级条款。
- `.jsx` 经 Babel XHR 同源加载依赖 raw 预览路由——已验证；**预览响应不得加 CSP**（既有红线，重申）。

### 测试

- `compose.test.ts` 扩展：断言 `designAppendPrompts` 含 tech-stack 段且顺序为 locale → discovery → tech-stack → metadata。
- 新增 bundled skill 资产测试：列表含 `react-prototype` 且 assets/references 文件齐全；`skills/` 下不再存在 catalogue-entry 空壳（任何 SKILL.md 不得只含"去上游看"的目录卡片正文）。
- `template.html` 冒烟：静态服务 + headless 加载，断言 root 挂载、console 无错误（实现阶段视成本可降为手动验收）。

### 验收标准

- 重建"剪头发预约网站"类 brief：产出为 React 多屏原型，预约流程为真实受控表单 + 状态流转，交互水准对齐既有小程序原型。
- agent 计划第 1 步能真实读到 seed/layouts/checklist 三件套。

## 范围外

- 创建面板（NewProjectPanel）UI 不动，技术栈不暴露为用户选项。
- Tweaks 编辑协议不引入（与现有 pi:edit 可视化文案编辑体系冲突）。
- deck_stage / 幻灯片增强、Claude 集成（window.claude.complete）不在本轮。
