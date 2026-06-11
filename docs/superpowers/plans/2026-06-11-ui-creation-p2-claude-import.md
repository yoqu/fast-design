# P2：Claude Design ZIP 导入 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `docs/superpowers/specs/2026-06-10-ui-creation-alignment-design.md` §3——Claude Design ZIP 导入，解析器从参照 `/Users/yoqu/Documents/code/ai/open-design-slim/apps/daemon/src/claude-design-import.ts` 一比一移植。

**Architecture:** server 新增 `claude-design-import.ts`（零依赖 ZIP 解析 + design-canvas.jsx 归一化，整段移植）、`projects.ts` 补 `validateProjectPath`/`decodeMultipartFilename`/`createProject` 支持预定 id、multer 上传路由 `POST /api/import/claude-design`；web 在 NewProjectPanel 增导入入口，成功后写 tab localStorage 并跳转，pendingPrompt 走 P1 已有预填链路。

**Tech Stack:** Express + multer + tsx（server）、React 18 + Vite（web）、vitest。**本项目不是 git 仓库，省略提交步骤，以测试通过为完成判据。**

**真实测试包（E2E 用）：** `~/Downloads/麓客+志愿者系统.zip` —— 19 个文件、全部 deflate、条目名为 UTF-8 中文（部分 entry 未设 UTF-8 flag bit，参照解析器无条件按 utf8 解码即正确）、无根级 index.html（唯一 HTML 为 `volunteer/麓客志愿者系统.html`，应被 chooseEntryFile 选中）、含根级点文件 `.thumbnail`、无 design-canvas.jsx。

**关键参照（实施者可直接读）：**
- 解析器：`/Users/yoqu/Documents/code/ai/open-design-slim/apps/daemon/src/claude-design-import.ts`（283 行，整文件移植）
- 路由：`…/apps/daemon/src/import-export-routes.ts:38-96`
- validateProjectPath：`…/apps/daemon/src/projects.ts:1312-1328`；decodeMultipartFilename：同文件 1359-1371
- multer 配置：`…/apps/daemon/src/server.ts:3780-3791`

---

### Task 1: server 基础设施（validateProjectPath / decodeMultipartFilename / createProject 预定 id / listFiles 点文件对齐）

**Files:**
- Modify: `server/src/projects.ts`
- Test: `server/src/projects.test.ts`（追加 describe）

- [x] **Step 1: 写失败测试** —— `server/src/projects.test.ts` 末尾追加（import 行合并补 `validateProjectPath, decodeMultipartFilename, listFiles`；`fs`/`path` 已有则复用，没有则补 `import fs from 'node:fs'; import path from 'node:path';`）：

```ts
describe('validateProjectPath', () => {
  it('normalizes backslashes and collapses empty segments', () => {
    expect(validateProjectPath('a\\b\\c.txt')).toBe('a/b/c.txt');
    expect(validateProjectPath('a//b.txt')).toBe('a/b.txt');
  });

  it('rejects traversal, absolute, drive-letter and NUL paths', () => {
    expect(() => validateProjectPath('../evil.txt')).toThrow('invalid file name');
    expect(() => validateProjectPath('a/../b.txt')).toThrow('invalid file name');
    expect(() => validateProjectPath('/etc/passwd')).toThrow('invalid file name');
    expect(() => validateProjectPath('C:/windows.txt')).toThrow('invalid file name');
    expect(() => validateProjectPath('a\0b')).toThrow('invalid file name');
    expect(() => validateProjectPath('   ')).toThrow('invalid file name');
  });

  it('rejects reserved segments (.webui / .pi)', () => {
    expect(() => validateProjectPath('.webui/meta.json')).toThrow('reserved project path');
    expect(() => validateProjectPath('a/.pi/x')).toThrow('reserved project path');
  });
});

describe('decodeMultipartFilename', () => {
  it('repairs latin1-mojibake utf8 names', () => {
    const mojibake = Buffer.from('麓客+志愿者系统.zip', 'utf8').toString('latin1');
    expect(decodeMultipartFilename(mojibake)).toBe('麓客+志愿者系统.zip');
  });

  it('passes through already-unicode names and empty input', () => {
    expect(decodeMultipartFilename('麓客.zip')).toBe('麓客.zip');
    expect(decodeMultipartFilename('plain.zip')).toBe('plain.zip');
    expect(decodeMultipartFilename('')).toBe('');
  });
});

describe('createProject with reserved id', () => {
  it('uses extra.id when provided', () => {
    const meta = createProject('p2-fixed-id', null, { id: 'p2fixedid001' });
    created.push(meta.id);
    expect(meta.id).toBe('p2fixedid001');
    expect(getProject('p2fixedid001')!.name).toBe('p2-fixed-id');
  });
});

describe('listFiles dotfile alignment', () => {
  it('skips dotfiles like open-design collectFiles', () => {
    const meta = createProject('p2-dotfiles');
    created.push(meta.id);
    const root = projectDir(meta.id);
    fs.writeFileSync(path.join(root, '.thumbnail'), 'x');
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    const names = listFiles(meta.id).map((f) => f.path);
    expect(names).toContain('index.html');
    expect(names).not.toContain('.thumbnail');
  });
});
```

- [x] **Step 2: 跑测试确认失败** —— `pnpm --filter server test -- projects`，FAIL（函数不存在 / extra.id 不支持 / 点文件出现在列表）。

- [x] **Step 3: 实现** —— `server/src/projects.ts`：

(a) 文件顶部常量区（HIDDEN_DIRS 附近）追加：

```ts
const FORBIDDEN_SEGMENT = /^$|^\.\.?$/;
/** 导入/写入禁止触碰的元数据目录（等效参照的 .live-artifacts 保留段）。 */
const RESERVED_PROJECT_FILE_SEGMENTS = new Set(['.webui', '.pi']);
```

(b) 新增两个导出函数（放在 safeResolve 附近，移植自参照 projects.ts:1312-1328 与 1359-1371）：

```ts
/** 校验并归一化 zip/上传里的相对路径（移植参照 validateProjectPath）。 */
export function validateProjectPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('invalid file name');
  }
  const normalized = raw.replace(/\\/g, '/');
  if (raw.includes('\0') || /^[A-Za-z]:/.test(normalized) || normalized.startsWith('/')) {
    throw new Error('invalid file name');
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => FORBIDDEN_SEGMENT.test(p))) {
    throw new Error('invalid file name');
  }
  if (parts.some((part) => RESERVED_PROJECT_FILE_SEGMENTS.has(part))) {
    throw new Error('reserved project path');
  }
  return parts.join('/');
}

/**
 * multer/busboy 把非 ASCII 文件名按 latin1 解码；若字节序列实为 UTF-8 则修复。
 * 已是正确 Unicode（含 >0xFF 码点）的输入原样返回（移植参照 decodeMultipartFilename）。
 */
export function decodeMultipartFilename(name: string): string {
  if (!name || typeof name !== 'string') return name ?? '';
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 0xff) return name;
  }
  const buf = Buffer.from(name, 'latin1');
  const utf8 = buf.toString('utf8');
  return Buffer.from(utf8, 'utf8').equals(buf) ? utf8 : name;
}
```

(c) `CreateProjectExtra` 增加 `id?: string;`；`createProject` 中 `const id = crypto.randomBytes(6).toString('hex');` 改为：

```ts
  const id = extra.id ?? crypto.randomBytes(6).toString('hex');
```

（`projectDir(id)` 已做 id 字符校验，非法 id 会抛错。）

(d) `listFiles` 的 walk 循环里，把 `if (entry.name.startsWith('.DS_Store')) continue;` 替换为（对齐参照 collectFiles 跳过全部点文件）：

```ts
      if (entry.name.startsWith('.')) continue;
```

（HIDDEN_DIRS 的目录判断保留不动——node_modules 等非点目录仍需它。）

- [x] **Step 4: 跑测试确认通过** —— `pnpm --filter server test`，全部 PASS；`pnpm --filter server build` 零错误。

---

### Task 2: 解析器移植 claude-design-import.ts + 测试

**Files:**
- Create: `server/src/claude-design-import.ts`（从参照整文件移植）
- Create: `server/src/claude-design-import.test.ts`

- [x] **Step 1: 移植解析器** —— 读取参照 `/Users/yoqu/Documents/code/ai/open-design-slim/apps/daemon/src/claude-design-import.ts`（283 行），**逐字拷贝**为 `server/src/claude-design-import.ts`。唯一允许的改动：无（其 `import { validateProjectPath } from './projects.js';` 在本项目同样成立——Task 1 已提供该导出）。保留全部常量（MAX_FILES=5000 / MAX_TOTAL_BYTES=100MiB / MAX_FILE_BYTES=25MiB）、EOCD/中央目录解析、`normalizeImportedClaudeDesignFile`（design-canvas.jsx wheel/gesture 归一化与 `[claude-design-import]` console.warn）、`chooseEntryFile`、`safeJoin`。

- [x] **Step 2: 写测试** —— `server/src/claude-design-import.test.ts`（新文件，完整内容）：

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { importClaudeDesignZip } from './claude-design-import.js';

// ---- 手工 ZIP 构造器：完全控制 flag/method/size 字段（解析器不校验 CRC，置 0 即可） ----

type TestEntry = {
  name: string;
  body?: string | Buffer;
  method?: 0 | 8;
  flags?: number; // bit0 = encrypted
  uncompressedSizeOverride?: number;
};

function buildTestZip(entries: TestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const body = Buffer.isBuffer(e.body) ? e.body : Buffer.from(e.body ?? '', 'utf8');
    const method = e.method ?? 8;
    const data = method === 8 ? deflateRawSync(body) : body;
    const flags = e.flags ?? 0;
    const uncompressedSize = e.uncompressedSizeOverride ?? body.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const tmpRoots: string[] = [];

function makeTmp(): { zipPath: string; projectDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdi-test-'));
  tmpRoots.push(root);
  return { zipPath: path.join(root, 'in.zip'), projectDir: path.join(root, 'proj') };
}

async function runImport(entries: TestEntry[]) {
  const { zipPath, projectDir } = makeTmp();
  fs.writeFileSync(zipPath, buildTestZip(entries));
  const result = await importClaudeDesignZip(zipPath, projectDir);
  return { result, projectDir };
}

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe('importClaudeDesignZip', () => {
  it('imports nested utf-8 named files and picks root index.html', async () => {
    const { result, projectDir } = await runImport([
      { name: 'index.html', body: '<html>root</html>' },
      { name: 'volunteer/麓客志愿者系统.html', body: '<html>sub</html>' },
      { name: 'volunteer/vol.css', body: 'body{}' },
      { name: 'assets/', body: '' }, // 目录条目被忽略
    ]);
    expect(result.entryFile).toBe('index.html');
    expect(result.files.sort()).toEqual(['index.html', 'volunteer/vol.css', 'volunteer/麓客志愿者系统.html']);
    expect(fs.readFileSync(path.join(projectDir, 'volunteer/麓客志愿者系统.html'), 'utf8')).toBe('<html>sub</html>');
  });

  it('falls back to root-level html, then first html (subdir, 真实包形态)', async () => {
    const a = await runImport([
      { name: 'sub/x.html', body: '<p/>' },
      { name: 'main.html', body: '<p/>' },
    ]);
    expect(a.result.entryFile).toBe('main.html');
    const b = await runImport([
      { name: '.thumbnail', body: 'png' },
      { name: 'volunteer/麓客志愿者系统.html', body: '<p/>' },
      { name: 'volunteer/kit.css', body: '' },
    ]);
    expect(b.result.entryFile).toBe('volunteer/麓客志愿者系统.html');
  });

  it('rejects zips without html and empty zips', async () => {
    await expect(runImport([{ name: 'a.css', body: 'x' }])).rejects.toThrow('zip does not contain an HTML file');
    await expect(runImport([])).rejects.toThrow('zip contains no files');
  });

  it('rejects encrypted entries', async () => {
    await expect(runImport([{ name: 'index.html', body: '<p/>', flags: 1 }])).rejects.toThrow(
      'encrypted zip entries are not supported',
    );
  });

  it('rejects oversized entries via central directory size (early, pre-decode)', async () => {
    await expect(
      runImport([{ name: 'index.html', body: '<p/>', uncompressedSizeOverride: 26 * 1024 * 1024 }]),
    ).rejects.toThrow('zip file too large');
  });

  it('rejects traversal / absolute / reserved paths', async () => {
    await expect(runImport([{ name: '../evil.html', body: '<p/>' }])).rejects.toThrow('invalid file name');
    await expect(runImport([{ name: '/abs.html', body: '<p/>' }])).rejects.toThrow(
      'absolute zip paths are not allowed',
    );
    await expect(runImport([{ name: '.webui/meta.json', body: '{}' }])).rejects.toThrow('reserved project path');
  });

  it('decodes streaming entries whose central size reads 0', async () => {
    const { result, projectDir } = await runImport([
      { name: 'index.html', body: '<html>stream</html>', uncompressedSizeOverride: 0 },
    ]);
    expect(result.entryFile).toBe('index.html');
    expect(fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8')).toBe('<html>stream</html>');
  });
});

describe('design-canvas.jsx normalization', () => {
  const wheelBlock = [
    '    // Mouse-wheel vs trackpad-scroll heuristic.',
    '    const onWheel = (e) => {',
    '      zoomAt(e.clientX, e.clientY, 1);',
    '    };',
    '',
  ].join('\n');
  const gestureBlock = [
    '    // Safari sends native gesture* events for trackpad pinch with a smooth',
    '    // momentum curve.',
    '    const onGestureEnd = (e) => { e.preventDefault(); isGesturing = false; };',
  ].join('\n');

  it('rewrites matching wheel/gesture handlers without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = `function Canvas() {\n${wheelBlock}${gestureBlock}\n}\n`;
    const { projectDir } = await runImport([
      { name: 'index.html', body: '<p/>' },
      { name: 'design-canvas.jsx', body: source },
    ]);
    const out = fs.readFileSync(path.join(projectDir, 'design-canvas.jsx'), 'utf8');
    expect(out).toContain('panByWheel');
    expect(out).not.toContain('Mouse-wheel vs trackpad-scroll heuristic');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns and keeps source when handlers do not match the template', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = 'export const nothingToRewrite = true;\n';
    const { projectDir } = await runImport([
      { name: 'index.html', body: '<p/>' },
      { name: 'design-canvas.jsx', body: source },
    ]);
    expect(fs.readFileSync(path.join(projectDir, 'design-canvas.jsx'), 'utf8')).toBe(source);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[claude-design-import]'));
    warn.mockRestore();
  });
});
```

- [x] **Step 3: 跑测试** —— `pnpm --filter server test -- claude-design-import`，全部 PASS（解析器为已验证的参照代码，测试主要验证移植保真度；若有 FAIL 先怀疑移植偏差而非测试）。

- [x] **Step 4: 类型检查** —— `pnpm --filter server build` 零错误（参照文件是 TS，应直接通过；唯一可能的报错是未使用导出，忽略级别问题不出现于 tsc --noEmit）。

---

### Task 3: 导入路由 + multer

**Files:**
- Modify: `server/package.json`（multer 依赖）
- Modify: `server/src/index.ts`（上传配置 + POST /api/import/claude-design）

- [x] **Step 1: 安装依赖** —— 仓库根执行：`pnpm --filter server add multer && pnpm --filter server add -D @types/multer`

- [x] **Step 2: 路由实现** —— `server/src/index.ts`：

(a) import 区追加：

```ts
import crypto from 'node:crypto';
import multer from 'multer';
import { importClaudeDesignZip } from './claude-design-import.js';
```

并在 `./projects.js` 的 import 列表中追加 `DATA_ROOT, decodeMultipartFilename`（`projectDir, createProject, getProject…` 已有）。

(b) `fs.mkdirSync(PROJECTS_ROOT, { recursive: true });` 之后追加（multer 配置对齐参照 server.ts:3780-3791）：

```ts
const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const importUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      // busboy 把非 ASCII 文件名按 latin1 给出；先修复再落临时名。
      file.originalname = decodeMultipartFilename(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});
```

(c) 在 `// ---- Projects ----` 路由组之后（DELETE 路由后面即可）追加（对齐参照 import-export-routes.ts:38-96；本项目无 conversation 概念，省略会话行创建；tab 初始状态由前端写 localStorage 等效实现）：

```ts
// ---- Import ----

app.post('/api/import/claude-design', importUpload.single('file'), async (req, res) => {
  let createdDir: string | null = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'zip file required' });
    const originalName = req.file.originalname || 'Claude Design export.zip';
    if (!/\.zip$/i.test(originalName)) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'expected a .zip file' });
    }
    const id = crypto.randomBytes(6).toString('hex');
    const baseName = originalName.replace(/\.zip$/i, '').trim() || 'Claude Design import';
    createdDir = projectDir(id);
    const imported = await importClaudeDesignZip(req.file.path, createdDir);
    await fs.promises.unlink(req.file.path).catch(() => {});
    const project = createProject(baseName, null, {
      id,
      pendingPrompt: `Imported from Claude Design ZIP: ${originalName}. Continue editing ${imported.entryFile}.`,
      metadata: {
        kind: 'prototype',
        importedFrom: 'claude-design',
        entryFile: imported.entryFile,
        sourceFileName: originalName,
      },
    });
    res.json({ project, entryFile: imported.entryFile, files: imported.files });
  } catch (err) {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
    if (createdDir) fs.rmSync(createdDir, { recursive: true, force: true });
    res.status(400).json({ error: String(err) });
  }
});
```

- [x] **Step 3: 构建与回归** —— `pnpm --filter server build && pnpm --filter server test` 全绿。

- [x] **Step 4: 路由冒烟（合成 zip）** —— 临时数据目录起服并用 curl 验证：

```bash
cd server && TMPDATA=$(mktemp -d) && PORT=4498 PI_WEBUI_DATA="$TMPDATA" npx tsx src/index.ts & sleep 2
python3 -c "
import zipfile
z = zipfile.ZipFile('/tmp/p2-smoke.zip','w')
z.writestr('index.html','<html>ok</html>')
z.writestr('css/a.css','body{}')
z.close()"
curl -s -F 'file=@/tmp/p2-smoke.zip' localhost:4498/api/import/claude-design
# 期望：{"project":{...importedFrom claude-design, pendingPrompt 含 Continue editing index.html...},"entryFile":"index.html","files":[...]}
curl -s -F 'file=@/tmp/p2-smoke.zip;filename=not-a-zip.txt' localhost:4498/api/import/claude-design
# 期望：{"error":"expected a .zip file"}
kill %1
```

---

### Task 4: web 导入入口（api + NewProjectPanel + App）

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/Workspace.tsx`（导出 tabStorageKey）
- Modify: `web/src/components/NewProjectPanel.tsx`
- Modify: `web/src/App.tsx`

UI 接线，无单测；以 `pnpm --filter web build` + Task 5 E2E 为判据。

- [x] **Step 1: api.ts** —— `api` 对象追加：

```ts
  importClaudeDesign: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return fetch('/api/import/claude-design', { method: 'POST', body: form }).then((r) =>
      json<{ project: ProjectMeta; entryFile: string; files: string[] }>(r),
    );
  },
```

- [x] **Step 2: Workspace.tsx** —— `function tabStorageKey` 改为导出：`export function tabStorageKey(projectId: string): string { … }`（实现不变）。

- [x] **Step 3: NewProjectPanel.tsx** ——

(a) Props 增加：`onImportClaudeDesign?: (file: File) => Promise<void>;`，组件签名解构加 `onImportClaudeDesign`。

(b) 状态区追加：

```ts
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
```

（import 行补 `useRef`。）

(c) 处理函数（放在 `submit` 之后，对齐参照 handleImportPicked NewProjectPanel.tsx:708-729）：

```ts
  const handleImportPicked = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !onImportClaudeDesign) return;
    setImporting(true);
    setImportError(null);
    try {
      await onImportClaudeDesign(file);
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? `导入失败：${err.message}` : '导入失败');
    } finally {
      setImporting(false);
    }
  };
```

(d) JSX：在「取消/创建」按钮行 `<div className="mt-5 flex justify-end gap-2">` **之前**插入导入区：

```tsx
        {onImportClaudeDesign && (
          <div className="mt-4 border-t border-zinc-200 pt-3">
            <label className="block text-xs font-medium text-zinc-500">或导入已有设计</label>
            <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportPicked} />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-40"
            >
              {importing ? '导入中…' : '导入 Claude Design 设计包（.zip）'}
            </button>
            {importError && <p className="mt-2 text-xs text-red-500">{importError}</p>}
          </div>
        )}
```

- [x] **Step 4: App.tsx** ——

(a) import 区追加：`import { tabStorageKey } from './components/Workspace';`

(b) `createProject` 之后追加：

```ts
  const importClaudeDesign = async (file: File) => {
    const { project, entryFile } = await api.importClaudeDesign(file);
    try {
      // 等效参照 setTabs(db, id, [entryFile], entryFile)：导入项目首开即预览入口文件。
      localStorage.setItem(tabStorageKey(project.id), JSON.stringify({ tabs: [entryFile], active: entryFile }));
    } catch {
      // localStorage 不可用时仅失去初始 tab，无碍。
    }
    await refresh();
    setActiveId(project.id);
  };
```

(c) `<NewProjectPanel …>` 增加 prop：`onImportClaudeDesign={importClaudeDesign}`。

- [x] **Step 5: 构建** —— `pnpm --filter web build && pnpm --filter web test` 全绿。

---

### Task 5: 真实包 E2E + 全量回归

- [x] **Step 1: 真实包 API E2E** —— 临时数据目录起服，用用户提供的真实包验证：

```bash
cd server && TMPDATA=$(mktemp -d) && PORT=4497 PI_WEBUI_DATA="$TMPDATA" npx tsx src/index.ts & sleep 2
curl -s -F 'file=@/Users/yoqu/Downloads/麓客+志愿者系统.zip' localhost:4497/api/import/claude-design > /tmp/p2-e2e.json
python3 - <<'EOF'
import json
d = json.load(open('/tmp/p2-e2e.json'))
assert d['entryFile'] == 'volunteer/麓客志愿者系统.html', d['entryFile']
assert len(d['files']) == 19, len(d['files'])
assert d['project']['name'] == '麓客+志愿者系统', d['project']['name']
assert d['project']['metadata']['importedFrom'] == 'claude-design'
assert d['project']['pendingPrompt'].startswith('Imported from Claude Design ZIP: 麓客+志愿者系统.zip')
print('E2E OK:', d['project']['id'], d['entryFile'])
EOF
# 文件列表接口应隐藏 .thumbnail：
PID=$(python3 -c "import json;print(json.load(open('/tmp/p2-e2e.json'))['project']['id'])")
curl -s localhost:4497/api/projects/$PID/files | python3 -c "import json,sys; names=[f['path'] for f in json.load(sys.stdin)]; assert '.thumbnail' not in names; assert 'volunteer/vol.css' in names; print('files OK', len(names))"
# 预览路由可回源中文路径入口：
curl -s "localhost:4497/api/projects/$PID/preview-url?file=volunteer/%E9%BA%93%E5%AE%A2%E5%BF%97%E6%84%BF%E8%80%85%E7%B3%BB%E7%BB%9F.html" | head -c 200
kill %1
```

预期：三段断言全过；preview-url 返回 `{ url, file… }` 而非错误。

- [x] **Step 2: 全量回归** —— 仓库根 `pnpm test && pnpm build` 全绿。

- [x] **Step 3: 浏览器手动冒烟（推荐）** —— `pnpm dev`：新建项目面板 →「导入 Claude Design 设计包」选择真实包 → 自动进入项目：工作区已打开 `volunteer/麓客志愿者系统.html` 预览 tab，输入框预填 "Imported from Claude Design ZIP…"，文件面板无 `.thumbnail`。

---

**完成记录（2026-06-11）**：5 个任务全部实施并审查通过。解析器与参照 diff 零差异；server 95 + web 22 测试全绿、双包构建零错误；真实包（麓客+志愿者系统.zip）E2E 通过：入口 volunteer/麓客志愿者系统.html、中文名/19 文件/.thumbnail 隐藏/preview 200。终审 Ready；追加修复 multer 超限错误中间件（400 JSON）。已知取舍：listFiles 现隐藏全部点文件（对齐参照），老项目中 .env 等点文件不再出现在文件面板（仍可直接路径读写、导出不受影响）。
