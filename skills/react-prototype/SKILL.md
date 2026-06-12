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

## 设备框架

- 移动端原型必须套 `assets/frames/` 组件（iOS/Android），桌面演示可用
  browser-window。外框 `transform: scale()` 自适应视口，内容固定逻辑尺寸
  （iPhone 393×852、Pixel 412×915）。
- 拷贝 frames 文件进项目 `js/` 后经 `window` 共享，不要内联重写。

## 降级条款

仅当用户明确要求"单文件 / 离线可用"时退回自包含纯 HTML；设计质量规则不变。
