# 原型流程复刻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Pi Web Studio 内行为级一比一复刻 open-design 的原型流程:artifact manifest 体系、文件管理面板、工作区标签页 + FileViewer(视口预设/缩放/导出菜单)、生成过程舞台、scoped 预览服务、多格式导出(HTML / ZIP+handoff / 图片快照 / PDF 打印 / 项目归档 ?root)。

**Architecture:** 服务端(Express)新增 artifacts / preview-scopes / bridges / files 四个模块并在 index.ts 挂路由;前端(React+Tailwind v4)用 Workspace(标签条)+ FileViewer + FilesPanel + GenerationStage 替换 PreviewPanel,lib 下移植 open-design 的 zip / exports / srcdoc 纯函数。参照代码 `/Users/yoqu/Documents/code/ai/open-design-slim`(下称 OD)是移植权威,标注 `PORT: <file>:<lines>` 的步骤要求先读该段再逐字移植(仅去掉 i18n / analytics / Electron host / deck 分支)。

**Tech Stack:** Express + tsx + vitest(server);Vite + React 18 + Tailwind v4 + vitest(web,新增);零新增运行时依赖(zip 为纯 TS 实现)。

**参照速查(已核实):**
- manifest schema/解析/推断:OD `apps/web/src/artifacts/manifest.ts:1-189`、`types.ts:1-60`
- 存储型 ZIP 编码器:OD `apps/web/src/runtime/zip.ts:1-127`
- 导出全家桶(safeFilename / handoff / manifest / 快照 / PDF 握手 / archive 文件名):OD `apps/web/src/runtime/exports.ts:1-1063`
- 快照 bridge 脚本:OD `apps/daemon/src/project-routes.ts:536-712`;注入工具 `injectBeforeBodyClose`/`injectUrlPreviewBridge`:同文件 `:714-749`
- preview-url + scoped serve 路由:OD `apps/daemon/src/project-routes.ts:2115-2185`
- 视口预设:OD `apps/web/src/components/FileViewer.tsx:218-240`(desktop 满幅 / tablet 820×1180 / mobile 390×844);zoom 状态与菜单 `:1093-1111,1255,1440-1470`
- 生成舞台:OD `apps/web/src/components/GenerationPreviewStage.tsx:1-222` + `runtime/generation-preview.ts`
- 文件面板分区:OD `apps/web/src/components/DesignFilesPanel.tsx:88`(SECTION_ORDER)及 `:260-280`

---

### Task 1: server/src/artifacts.ts — manifest 解析/推断/列举

**Files:**
- Create: `server/src/artifacts.ts`
- Test: `server/src/artifacts.test.ts`

- [ ] **Step 1: 写失败测试**(parse 合法/非法 manifest、inferLegacyManifest 对 html/svg/md/jsx/css 的推断与 deck 文件名启发、listArtifacts 扫描 sidecar+legacy 去重)
- [ ] **Step 2: `pnpm --filter server test` 确认失败**
- [ ] **Step 3: 实现** — PORT: OD `apps/web/src/artifacts/types.ts:1-60` + `manifest.ts:1-189` 全量(类型 + ALLOWED_* 常量 + parseArtifactManifest + serializeArtifactManifest + createHtmlArtifactManifest + inferLegacyManifest + artifactManifestNameFor)。新增服务端专属:

```ts
export interface ProjectArtifact { manifest: ArtifactManifest; manifestPath: string | null; legacy: boolean }
// listArtifacts(id): 用 projects.ts 的 listFiles 结果:
//  1) 所有 *.artifact.json → 读文件 parseArtifactManifest;entry 不存在于文件列表则跳过
//  2) 其余 .html/.htm 且无对应 sidecar 且未被任何 manifest 引用为 entry → inferLegacyManifest
//  按 entry 排序返回
export async function listArtifacts(projectId: string): Promise<ProjectArtifact[]>
```

- [ ] **Step 4: 测试通过**

### Task 2: server/src/preview-scopes.ts — scope token

**Files:**
- Create: `server/src/preview-scopes.ts`
- Test: `server/src/preview-scopes.test.ts`

- [ ] **Step 1: 写失败测试**(mint 返回 `[a-z0-9]{24,}`;validate 仅对同项目+已铸 token 通过;每项目保留最近 32 个,旧 token 逐出)
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**(对齐 OD `projectPreviewScopes` 语义,进程内存级):

```ts
import { randomBytes } from 'node:crypto';
const scopes = new Map<string, string[]>(); // projectId -> tokens (newest last)
const MAX_PER_PROJECT = 32;
export const previewScopeRe = /^[a-z0-9]{24,64}$/;
export function mintPreviewScope(projectId: string): string {
  const token = randomBytes(16).toString('hex');
  const list = scopes.get(projectId) ?? [];
  list.push(token);
  if (list.length > MAX_PER_PROJECT) list.splice(0, list.length - MAX_PER_PROJECT);
  scopes.set(projectId, list);
  return token;
}
export function validatePreviewScope(projectId: string, scope: string): boolean {
  return (scopes.get(projectId) ?? []).includes(scope);
}
```

- [ ] **Step 4: 测试通过**

### Task 3: server/src/bridges.ts — 快照 bridge 注入

**Files:**
- Create: `server/src/bridges.ts`
- Test: `server/src/bridges.test.ts`

- [ ] **Step 1: 写失败测试**(injectSnapshotBridge:有 `</body>` 时注入其前;无则追加;已含 marker 时幂等;wantsSnapshotBridge 解析 `snapshot,image,capture` token)
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现** — PORT: OD `apps/daemon/src/project-routes.ts:536-712`(`URL_PREVIEW_SNAPSHOT_BRIDGE` 整段脚本逐字,含 SNAPSHOT_STYLE_PROPS 前缀段——从 536 行起完整复制到 712 行)+ `:714-749` 的 `previewBridgeTokens` / `wantsUrlPreviewSnapshotBridge` / `injectBeforeBodyClose`。导出 `injectSnapshotBridge(html)` 与 `wantsSnapshotBridge(value)`。scroll/selection bridge 不移植(范围外)。
- [ ] **Step 4: 测试通过**

### Task 4: server/src/files.ts — 文件 CRUD + sidecar 联动

**Files:**
- Create: `server/src/files.ts`
- Test: `server/src/files.test.ts`
- Modify: `server/src/projects.ts`(导出 `safeResolve` 供复用,如未导出)

- [ ] **Step 1: 写失败测试**:
  - writeProjectFile 创建嵌套目录文件;`overwrite=false` 且已存在 → 抛 `FILE_EXISTS`
  - deleteProjectFile 删除文件并连带删除 `<file>.artifact.json` sidecar
  - renameProjectFile:同步重命名 sidecar 为 `<to>.artifact.json` 并把 manifest.entry 改为新名、updatedAt 刷新;目标已存在 → 抛;穿越路径 → 抛
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**:

```ts
export async function readProjectFile(id: string, rel: string): Promise<Buffer>
export async function writeProjectFile(id: string, rel: string, data: Buffer, opts: { overwrite: boolean }): Promise<void>
export async function deleteProjectFile(id: string, rel: string): Promise<void>   // + sidecar
export async function renameProjectFile(id: string, from: string, to: string): Promise<void> // + sidecar 迁移、entry 更新
```

全部经 `safeResolve`;rename 用 `fs.rename`,sidecar 存在时读 → parseArtifactManifest → 改 entry/updatedAt → 写到新 sidecar 路径 → 删旧。
- [ ] **Step 4: 测试通过**

### Task 5: server 路由挂载

**Files:**
- Modify: `server/src/index.ts`(现有路由区,约 42-208 行)
- Test: `server/src/files.test.ts` 已覆盖核心;路由层薄壳不另测

- [ ] **Step 1: 新增路由**:

```
GET    /api/projects/:id/artifacts            → { artifacts: ProjectArtifact[] }
GET    /api/projects/:id/file?path=           → 文件原始内容(mime 按扩展名)
PUT    /api/projects/:id/file?path=&overwrite= → express.raw({limit:'50mb'}) 写入;409 on FILE_EXISTS
DELETE /api/projects/:id/file?path=           → 204
POST   /api/projects/:id/file/rename {from,to} → 200/409
GET    /api/projects/:id/preview-url?file=    → { url:`/api/projects/:id/preview/<scope>/<encPath>`, file, csp, iframeSandbox:'allow-scripts allow-modals', opaqueOrigin:true }(对齐 OD :2115-2148;file 缺省取首个 artifact entry,再缺省 index.html)
GET    /api/projects/:id/preview/:scope/*     → validatePreviewScope;HTML 响应设 CSP 头 `script-src 'unsafe-inline' 'self' data: blob:; object-src 'none'`、`Cache-Control:no-store`;`?bridge=snapshot` 时 injectSnapshotBridge;origin==='null' 时 `Access-Control-Allow-Origin:*`(对齐 OD :2150-2185)
GET    /api/projects/:id/export?root=         → 现有 archiver 路由加 root 子目录限定(safeResolve 校验,glob cwd 切到子目录,Content-Disposition 用 RFC5987 UTF-8 文件名)
```

- [ ] **Step 2: 删除旧 `/preview/:id` 与 `/preview/:id/*` 路由**(被 scoped 路由取代)
- [ ] **Step 3: `pnpm --filter server test` + `pnpm --filter server build` 通过**

### Task 6: web/src/lib/zip.ts

**Files:**
- Create: `web/src/lib/zip.ts`
- Create: `web/vitest.config.ts` + `web/package.json` 加 `"test":"vitest run"`、devDep `vitest`
- Test: `web/src/lib/zip.test.ts`

- [ ] **Step 1: 配置 web vitest(node 环境即可),写失败测试**(buildZip 输出以 `PK\x03\x04` 开头、含 EOCD 签名 0x06054b50、entry 数正确;Blob → arrayBuffer 校验)
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现** — PORT: OD `apps/web/src/runtime/zip.ts:1-127` 逐字。
- [ ] **Step 4: `pnpm --filter web test` 通过**

### Task 7: web/src/lib/artifacts.ts + srcdoc.ts + exports.ts

**Files:**
- Create: `web/src/lib/artifacts.ts`(ArtifactManifest 类型,与 server 同构)
- Create: `web/src/lib/srcdoc.ts`
- Create: `web/src/lib/exports.ts`
- Test: `web/src/lib/exports.test.ts`

- [ ] **Step 1: 写失败测试**(纯函数:safeFilename 截断/清洗/回退;archiveRootFromFilePath('a/b.html')==='a'、顶层文件→'';archiveFilenameFrom 的 UTF-8→quoted→slug 回退链;buildDesignManifestContent 解析回 JSON 后 schema/sourceFiles 分类/screens 角色/9 档 responsiveViewports 与 OD 一致;buildDesignHandoffContent 含 Source map 与视口矩阵)
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: srcdoc.ts**:html 原型路径不需 OD 2259 行 srcdoc 框架,实现 `buildSrcdoc(html: string): string`(原样返回,仅保证有 `<!doctype html>` 前缀,无则补)+ PORT OD `exports.ts:844-877` 的 `escapeHtmlAttribute` + `buildSandboxedPreviewDocument`。
- [ ] **Step 4: exports.ts** — PORT: OD `apps/web/src/runtime/exports.ts` 以下段落逐字(去掉 `@open-design/host` 与 react-component 分支):
  - `:28-57` safeFilename / triggerHrefDownload / triggerDownload / exportAsHtml
  - `:64-91` FRAME_WRAPPER_FILE_RE / designFileMap
  - `:93-182` buildDesignManifestContent;`:184-293` buildDesignHandoffContent
  - `:295-318` exportAsZip(签名扩为 `(html, title, files?: string[])`,files 透传给 handoff/manifest 的 `files` 字段,默认 `['index.html']`)
  - `:339-395` PreviewSnapshot 类型 + requestPreviewSnapshotResult + requestPreviewSnapshot
  - `:451-465` dataUrlToBlob;`:509-705` 图片导出全套(IMAGE_EXPORT_SPECS / imageDataUrlToBlob / prepareImageExportTarget / downloadImageDataUrl / exportAsImage;showSaveFilePicker 类型一并)
  - `:793-842` exportProjectAsZip + archiveRootFromFilePath + archiveFilenameFrom(URL 改为本项目 `/api/projects/:id/export?root=`)
  - `:906-1017` exportAsPdf 浏览器路径(去 host 分支与 deck 分支)+ injectPrintScript + injectPrintReadyHandshake + injectParentPrintReadyCache;`randomUUID` 用 `crypto.randomUUID()`
- [ ] **Step 5: 测试通过**

### Task 8: web/src/lib/api.ts + types 扩展

**Files:**
- Modify: `web/src/lib/api.ts`、`web/src/lib/types.ts`

- [ ] **Step 1: 新增 API 封装**:`listArtifacts(id)`、`previewUrl(id, file)`(fetch preview-url)、`fileUrl(id, path)`、`putFile(id, path, body, overwrite)`、`deleteFile(id, path)`、`renameFile(id, from, to)`、`exportUrl(id, root?)`;types 增加 `ArtifactManifest`/`ProjectArtifact`/`PreviewUrlResponse`。
- [ ] **Step 2: `pnpm --filter web build` 类型通过**

### Task 9: GenerationStage 组件 + 模型推导

**Files:**
- Create: `web/src/lib/generation.ts`
- Create: `web/src/components/GenerationStage.tsx`
- Test: `web/src/lib/generation.test.ts`

- [ ] **Step 1: 写失败测试**(deriveGenerationModel:空闲→phase 'idle';发送后→'generating' 且 understand running;出现首个 text/thinking delta→understand succeeded、generate running;出现工具调用写文件→detailLabel='Writing <file>';turn 结束无错→'done';abort→'stopped';error→'failed' 携带 message;步骤序列 understand→generate→prepare 与 OD 一致)
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现 generation.ts**(对齐 OD `runtime/generation-preview.ts` 的模型形状):

```ts
export type GenerationPhase = 'idle' | 'generating' | 'stopped' | 'failed' | 'done';
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export interface GenerationModel {
  phase: GenerationPhase;
  steps: { id: 'understand' | 'generate' | 'prepare'; status: StepStatus }[];
  activityLabel: string | null;   // 最近 thinking/text 片段末行,截断 120 字符
  detailLabel: string | null;     // 最近写文件工具调用 'Writing xxx.html'
  errorMessage: string | null;
}
export function deriveGenerationModel(input: { busy: boolean; aborted: boolean; error: string | null;
  sawDelta: boolean; lastActivity: string | null; lastWrite: string | null; turnEnded: boolean }): GenerationModel
```

- [ ] **Step 4: GenerationStage.tsx** — 对齐 OD `GenerationPreviewStage.tsx` 渲染结构(去 i18n/AMR/analytics):居中舞台卡片,`data-phase` 属性;标题(生成中/已停止/失败);lead 行(activityLabel 或错误文案);步骤列表(仅渲染非 pending,running 显示脉冲圆点、succeeded ✓、failed ✕);generating 且有 detailLabel 时显示 substatus 行;failed 时 Retry 按钮(`onRetry`)。Tailwind 实现样式。
- [ ] **Step 5: 测试 + build 通过**

### Task 10: FileViewer + ExportMenu

**Files:**
- Create: `web/src/components/FileViewer.tsx`
- Create: `web/src/components/ExportMenu.tsx`

- [ ] **Step 1: FileViewer 实现**,对齐 OD FileViewer 原型路径:
  - props:`{ projectId, file, artifact: ProjectArtifact | null, reloadKey, generation, onRetry }`
  - 挂载/file 变化时 fetch `previewUrl(projectId, file)` 得 scoped url(带 `&bridge=snapshot` 由 url query `?bridge=snapshot` 追加),iframe `sandbox="allow-scripts allow-modals"`,`key=url+reloadKey` 强制重载
  - 视口预设(PORT OD `FileViewer.tsx:218-240` 数据):desktop(null×null 满幅)/ tablet 820×1180 / mobile 390×844;非 desktop 时画布:深色衬底容器内居中固定尺寸 iframe,容器 overflow:auto
  - zoom:状态 `zoom`(50/75/100/125/150,'fit');非满幅时 `transform: scale()` + transform-origin top center,'fit' 用容器尺寸/预设尺寸计算(对齐 OD :628-640 fitScale 逻辑,min(1, availW/w, availH/h));zoom 菜单 popover,点击外部关闭(对齐 :1337-1351)
  - 工具栏:视口三按钮(active 高亮)| zoom 菜单 | ⟳ 刷新(reloadKey+1)| ↗ 新窗口(window.open(scopedUrl))| 导出菜单
  - `generation.phase !== 'idle' && phase !== 'done'` 时渲染 GenerationStage 覆盖层于预览区(absolute inset-0),preview 在 done/idle 显示
- [ ] **Step 2: ExportMenu 实现**(对齐 OD share menu 的 Export/Image 两节):
  - Export 节按 `artifact.manifest.exports` 渲染:HTML(fetch 入口文件文本 → exportAsHtml)、PDF(fetch → exportAsPdf)、ZIP(exportProjectAsZip({projectId, filePath, fallbackHtml, fallbackTitle}))
  - Image 节:PNG/JPEG/WebP——`requestPreviewSnapshotResult(iframeRef)` → 失败 toast,成功 `imageDataUrlToBlob` + `prepareImageExportTarget().save(blob)`
  - 菜单底部 "导出整个项目 ZIP"(无 root)
- [ ] **Step 3: `pnpm --filter web build` 通过**

### Task 11: FilesPanel

**Files:**
- Create: `web/src/components/FilesPanel.tsx`

- [ ] **Step 1: 实现**,对齐 OD DesignFilesPanel 行为子集:
  - props:`{ projectId, files, onOpenFile, onChanged }`(files 为现有 `/files` 平铺列表)
  - 状态 `currentDir`;由平铺列表派生当前目录的子目录与文件
  - 分区(对齐 SECTION_ORDER 语义):Folders / HTML / Stylesheets / Code / Documents / Images / Other;HTML 节内 artifact entry 标记徽章(依 listArtifacts)
  - 面包屑 + 上级按钮;点文件夹进入;点文件 onOpenFile(path)
  - 行悬停操作:重命名(行内 input,Enter 提交 api.renameFile / Escape 取消)、删除(确认后 api.deleteFile);多选 checkbox + 批量删除
  - 上传按钮 + 拖拽到面板:`api.putFile(projectId, `${currentDir}/${file.name}`, file, true)`
  - 变更后调用 onChanged()(刷新文件列表;SSE 也会触发)
- [ ] **Step 2: build 通过**

### Task 12: Workspace 标签页 + App 装配 + 清理

**Files:**
- Create: `web/src/components/Workspace.tsx`
- Modify: `web/src/App.tsx`、`web/src/components/ChatPanel.tsx`
- Delete: `web/src/components/PreviewPanel.tsx`
- Modify: `README.md`

- [ ] **Step 1: Workspace.tsx**:
  - 状态:`tabs: string[]`(打开的文件路径)、`active: string | null`、`showFiles: boolean`;持久化 localStorage key `webui:tabs:<projectId>`
  - 标签条:每 tab 文件名 + 关闭 ×;尾部 "文件" 切换按钮;无 tab 且非生成中显示空态(提示在左侧对话生成原型)
  - 订阅 SSE files-changed:reloadKey+1 并刷新 files/artifacts
  - **artifact 自动打开**(对齐 OD"artifact 出现即打开"):artifacts 列表 diff,出现新 entry → openTab(entry) 并激活
  - 内容区:showFiles ? FilesPanel : FileViewer(active 对应 artifact 查找自 artifacts)
- [ ] **Step 2: App.tsx / ChatPanel.tsx**:generation 状态提升——ChatPanel 接受 `onGeneration(g: GenerationModel)` 回调(内部由流事件驱动 deriveGenerationModel),App 持有并传给 Workspace;Retry = 重发最后一条用户消息。右栏由 PreviewPanel 换为 Workspace。
- [ ] **Step 3: 删除 PreviewPanel.tsx 及引用;README 功能/架构小节同步更新**
- [ ] **Step 4: 全量验证**:`pnpm test`(server+web)、`pnpm build` 通过;`pnpm dev` 手动冒烟:建项目→让 agent 生成原型→生成舞台出现→自动开 tab→切视口/缩放→文件面板重命名→导出 HTML/ZIP/图片/PDF/项目 ZIP

---

## Self-Review

- 规格覆盖:manifest(T1)、文件管理(T4/T5/T11)、预览(T5/T10)、生成舞台(T9)、导出(T7/T10)、布局与自动开 tab(T12)、测试(各 task + T12 全量)✓
- 占位符:无 TBD;PORT 步骤均给出权威行号 ✓
- 类型一致:ProjectArtifact(T1)被 T8/T10/T11 引用;GenerationModel(T9)被 T10/T12 引用;previewUrl(T8)被 T10 使用 ✓
