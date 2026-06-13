---
name: react-prototype
description: |
  Default tech-stack skill for every product/app prototype: React 18 + Babel
  standalone + Tailwind CDN (pinned versions), html-shell-per-screen with
  window-shared JSX components, oklch token system, motion primitives, and
  iOS/Android/browser device frames. Read this skill's seed, layouts, and
  checklist before writing any prototype code.
triggers:
  - "react prototype"
  - "app prototype"
  - "multi-screen prototype"
  - "interactive prototype"
od:
  mode: prototype
  category: web-artifacts
---

# react-prototype

每个产品/应用原型的默认技术栈承载者。**阅读顺序（不可跳过）**：
`assets/template.html` → `references/layouts.md` → `references/checklist.md`。
不要从零写壳与 CSS——拷贝 seed、替换 token、粘贴骨架。

## 运行时与网络（固定版本 · 国内镜像，恒须生效）

- 固定版本运行时，**版本号与 integrity 哈希不可改**；seed `assets/template.html` 已写好，直接拷贝：
  `registry.npmmirror.com/react/18.3.1` + `react-dom/18.3.1` + `@babel/standalone/7.29.0`
  （阿里 npm 镜像，字节级一致，SRI 仍匹配）+ `cdn.tailwindcss.com/3.4.16`。
- 禁浮动 CDN（`@latest` / 不带版本）；`<script type="text/babel">` 禁加 `type="module"`（破坏转译）。
- **禁引境外中央 CDN**：`unpkg.com` / `cdn.jsdelivr.net` / `cdnjs.cloudflare.com` / `esm.sh` /
  `skypack.dev` / `fonts.googleapis.com` / `fonts.gstatic.com`——国内慢或被墙，原型会显得坏掉。
- 额外 JS/CSS 库一律走国内镜像，首选 `https://registry.npmmirror.com/<pkg>/<version>/files/<path>`
  （字节级一致，SRI 不变），必带显式版本；备选 `cdn.staticfile.net` / `lib.baomitu.com` / `cdn.bootcdn.net`。
- 字体首选系统栈（`-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif`），
  尽量不抓取；确需 web 字体走 `https://fonts.loli.net/css2?...`，绝不直连 `fonts.googleapis.com`。

## 样式与 token

- 品牌/设计 token 落 `css/tokens.css`，oklch CSS 变量（`--bg` / `--surface` / `--fg` / `--muted` / `--border` / `--accent`）。
- JSX / Tailwind 里每个颜色都引 token（`text-[color:var(--fg)]`、`bg-[color:var(--surface)]`）或语义类，**禁散落 hex**。
- Tailwind 只管布局/间距/排版工具类，不替代 token 系统。

## 组件拆分模式

- 屏 = `.html` 壳（screen-file-first），组件 = `.jsx` 文件（项目根或 `js/`）。
- 每个 `<script type="text/babel">` 作用域独立：共享组件文件末尾必须
  `Object.assign(window, { ComponentA, ComponentB })`，消费方从 `window` 读取。
- 样式对象按组件命名（`const bookingStyles = {...}`），禁止裸 `const styles`。
- 单文件接近 1000 行就拆。`data-presets="react"`，禁 `type="module"`。

## 状态约定

- 受控输入优先：表单/筛选/搜索一律 `useState` + onChange + 校验。
- 状态尽量局部；跨屏与持久状态（当前步骤、购物车、播放位置、表单草稿）
  写 `localStorage`，刷新不丢。
- 列表/详情/结算等流转用真实条件渲染表达，不做假跳转截图。

## 变体探索

- 用户在探索期：给 3 个差异化变体（混合"按规范"与突破方向），
  **单文件 + 顶部开关切换**，不要复制多份文件。
- 原型迭代期：在现有页面上 tweak，优先于新开文件。

## 动效

- 先用 `assets/animations.jsx` 原语（Stage/Sprite/useTime/Easing/interpolate）。
- 复杂时间线/滚动联动升级 gsap-core skill。
- 动画只用 transform/opacity；禁 `scrollIntoView`。

## 设备框架（移动端外壳是固定窗口，内容只在内层滚）

- 移动端原型**必须**套 `assets/frames/` 组件（iOS/Android），桌面演示可用
  browser-window。外框 `transform: scale()` 自适应视口，内容固定逻辑尺寸
  （iPhone 393×852、Pixel 412×915）。
- 拷贝 frames 文件进项目 `js/` 后经 `window` 共享，**不要手搓一个手机形状的边框 div 直接包内容**。
- **最常见的坑——外壳被内容撑高**：外框 `screen` 是固定高度 + `overflow:hidden`，
  长内容只在 `content`（`overflowY:auto`）内层滚动，绝不能把外壳顶高。若看到手机壳随
  内容变高/整壳跟随滚动，是把内容当成了壳的兄弟节点——必须作为 `<IosFrame>{屏幕}</IosFrame>`
  的 `children` 传入。
- 套进设备框架的屏幕内容里**禁用** `100vh` / `min-h-screen` / `height:100vh`——`vh` 指真实浏览器
  视口而非模拟设备，会撑破固定外壳。用 `height:100%` 或让其自然流动并滚动。
- 屏幕内容要**铺满设备宽度**：`references/layouts.md` 的骨架用了桌面向的 `maxWidth: 480/760/920`，
  放进手机框时去掉这些上限（改 `width:100%`），否则屏幕会缩在窄列里。
- 状态栏 / 灵动岛 / Home 指示条由外框 `position:absolute` 固定，滚动时不动——不要另写成会滚的兄弟节点。

## 降级条款

仅当用户明确要求"单文件 / 离线可用"时退回自包含纯 HTML；设计质量规则不变。
