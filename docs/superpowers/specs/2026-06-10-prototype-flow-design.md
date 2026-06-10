# 原型流程一比一复刻设计(对齐 open-design)

日期:2026-06-10
参照:`/Users/yoqu/Documents/code/ai/open-design-slim`
目标:把 Pi Web Studio 中过于简单的"预览 + 整包 ZIP"替换为 open-design 原型(prototype)流程的行为级一比一复刻:文件管理、预览界面、导出调整。只复刻原型这一条链路,不引入 open-design 的其他子系统。

## 决策记录(用户离线,以参照实现为规范)

- **方案选择**:行为级复刻(方案 B)。不直接搬运 open-design 组件代码(其 FileViewer 3000+ 行,耦合 renderer registry / i18n / Electron bridge / live-artifact),而是在本项目 React + Express 栈内重写,但 manifest schema、路由形态、视口尺寸、导出产物与参照逐项对齐;`exports.ts` 中 DESIGN-HANDOFF / DESIGN-MANIFEST 构建器等纯函数原样移植。
- **范围内**(原型链路):artifact manifest 体系、文件管理面板、工作区标签页、FileViewer 预览器(视口预设/缩放平移/刷新/新窗口)、生成过程舞台、scoped 预览服务、导出菜单(HTML / ZIP+handoff / 图片快照 / PDF 打印)、项目归档(支持 ?root)。
- **范围外**:Live Artifacts(SQLite/connector/refresh)、评论与标注(selection bridge / draw overlay)、部署分享(Vercel/CF)、deck / react-component / markdown 等其他 renderer、设计系统库、插件文件夹动作、终端、side chat、Electron 桥、i18n。

## 1. Artifact Manifest 体系

与参照 `apps/web/src/artifacts/manifest.ts` 同构,限定 `kind: 'html'` 路径:

- Sidecar 文件 `<entry>.artifact.json` 与入口文件同目录,schema v1:`{ version: 1, kind, title, entry, renderer, status?, exports, primary?, createdAt?, updatedAt?, metadata? }`。
- `exportsForKind('html') = ['html', 'pdf', 'zip']`(图片快照为预览器能力,不进 manifest,与参照一致)。
- **legacy 推断**:没有 sidecar 的 `.html` 文件按参照 `inferLegacyManifest` 推断出 manifest(kind/renderer 由扩展名推得,title 取文件名),保证 agent 直接写文件也能成为 artifact。
- 服务端新模块 `server/src/artifacts.ts`:解析/校验/推断/列出项目 artifacts;`GET /api/projects/:id/artifacts` 返回列表。

## 2. 文件管理(对齐 DesignFilesPanel)

新组件 `web/src/components/FilesPanel.tsx`:

- 按语义分区展示当前目录:文件夹、HTML、样式表、代码、文档、图片、其他(参照 `SECTION_ORDER`)。
- 面包屑目录导航 + 上一级按钮;点击文件夹进入。
- 行内重命名(Enter 保存 / Escape 取消)、悬停复选框多选 + 批量删除、上传(按钮 + 拖拽到面板)。
- 点击文件 → 在工作区打开标签页预览。
- 服务端文件路由(对齐参照 project-routes 的文件 CRUD):
  - `GET /api/projects/:id/file?path=` 读取内容;
  - `PUT /api/projects/:id/file?path=` 写入/上传(body 原始字节,`?overwrite=`);
  - `DELETE /api/projects/:id/file?path=`(同时清理同名 sidecar);
  - `POST /api/projects/:id/file/rename` `{from, to}`(同步迁移 sidecar 及其 entry 字段)。
  - 全部经 `safeResolve` 防穿越;变更触发现有 watch → SSE。

## 3. 预览界面(对齐 FileViewer + FileWorkspace + GenerationPreviewStage)

- **工作区标签页**:右栏改为工作区,顶部标签条(打开的文件各一个 tab,可关闭,记忆每项目的打开集与激活 tab 于 localStorage),无 tab 时显示空态/文件面板。
- **FileViewer 工具栏**:
  - 视口预设(与参照逐像素一致):desktop(满幅)/ tablet 820×1180 / mobile 390×844;非满幅时画布居中、深色衬底、可滚动。
  - 缩放:适应窗口 / 50% / 100% / 150%,缩放后拖拽平移;
  - 刷新按钮、新窗口打开、导出菜单(见 §4)。
- **生成过程舞台**:agent 回合进行中在预览区显示覆盖层:三步进度 Understand → Generate → Prepare、最近活动文本(取流式 thinking/text 末行)、失败时错误卡片 + 重试按钮;预览可用且未失败时自动隐藏(对齐 GenerationPreviewStage 行为)。
- **预览服务(scoped)**:对齐参照 `preview-url` 设计:
  - `GET /api/projects/:id/preview-url?file=` → `{ url, file, iframeSandbox }`,服务端铸造临时 scope token;
  - `GET /api/projects/:id/preview/:scope/*` 校验 token 后回源文件;HTML 注入快照 bridge(`?bridge=snapshot`);
  - iframe `sandbox="allow-scripts allow-forms"`(移除现状的 allow-same-origin;与参照 URL 预览路径的 `projectPreviewIframeSandbox` 逐字一致),HTML 响应带参照完整 CSP 列表(`sandbox …; default-src 'self' data: blob:; … object-src 'none'`);
  - SSE files-changed 自动刷新保留。

## 4. 导出调整(对齐 runtime/exports.ts)

预览器工具栏导出菜单,按 manifest `exports` 提供:

- **HTML**:下载入口文件文档(srcdoc 包装,文件名经 `safeFilename` 清洗,逻辑原样移植)。
- **ZIP(artifact 包)**:`<slug>/index.html` + `<slug>/DESIGN-HANDOFF.md` + `<slug>/DESIGN-MANIFEST.json`;两份产物的构建器从参照 `exports.ts` 移植(源文件映射、9 档响应式视口矩阵、screens 角色识别、实施清单等),客户端打包(store 模式 zip,移植参照 `runtime/zip.ts` 思路)。
- **图片快照**:PNG / JPEG / WebP——通过注入 iframe 的快照 bridge(SVG foreignObject 渲染,postMessage 握手)截取当前视口,移植参照 bridge 脚本。
- **PDF**:打印握手(nonce + 等待 fonts.ready / 图片 / CSS 背景加载 → `OD_PRINT_READY` → 触发 iframe print),移植参照逻辑;无 Electron 桥,仅浏览器打印路径。
- **项目 ZIP**:保留现有 `GET /api/projects/:id/export`,增加 `?root=` 子目录限定(对齐参照 archive 路由)。

## 5. 布局

`Sidebar(项目) | ChatPanel | Workspace`。Workspace = 标签条 + (FileViewer | FilesPanel);文件面板以工具栏按钮切换显示(参照中文件面板与查看器同属项目工作区)。聊天中 agent 写出/更新 HTML 入口文件后,工作区自动打开/激活对应 tab(对齐"artifact 出现即打开"的流程)。

## 6. 错误处理与安全

- 所有文件路由复用 `safeResolve`,拒绝穿越;scope token 随机、限项目、进程内存级(重启失效即可,与本地工具定位一致)。
- manifest 解析失败 → 按 legacy 推断兜底,不抛错。
- 导出在浏览器侧失败(快照超时、打印握手超时)→ toast 提示,超时兜底直接触发(对齐参照超时策略)。

## 7. 测试

- server(vitest):manifest 解析/推断/序列化;文件 CRUD 与 rename 的 sidecar 联动;scope token 校验与穿越拒绝;archive `?root`。
- web:为 `lib/exports`(handoff/manifest 构建器、safeFilename)与 zip 打包器补 vitest 单测(新增 web 测试配置)。
- `pnpm build` 全量类型检查 + 构建作为完成门槛。
