import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { PiSession } from './pi-session.js';
import type { SessionLaunchConfig } from './pi-session.js';
import {
  DATA_ROOT,
  HIDDEN_DIRS,
  PROJECTS_ROOT,
  createProject,
  decodeMultipartFilename,
  deleteProject,
  getProject,
  listFiles,
  listProjects,
  projectDir,
  safeResolve,
  touchProject,
  updateProject,
} from './projects.js';
import {
  appendConversationHistory,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  piSessionDirFor,
  readConversationHistory,
  updateConversation,
} from './conversations.js';
import { composePromptWithAttachments, parsePendingAttachmentsPatch, sanitizeAttachments } from './attachments.js';
import { importClaudeDesignZip } from './claude-design-import.js';
import { parseCreateProjectBody } from './project-create.js';
import { designAppendPrompts } from './prompts/compose.js';
import { enabledSkillPaths } from './pi-skills.js';
import { runningProjectIds } from './running.js';
import { activeTurn, recoverInterruptedTurns, removeTurnJournal, startTurn } from './turns.js';
import { registerPiRoutes } from './pi-routes.js';
import { readWebuiSettings } from './webui-settings.js';
import { closeProjectWatcher, watchProject } from './watch.js';
import { listArtifacts } from './artifacts.js';
import { deleteProjectFile, readProjectFile, renameProjectFile, writeProjectFile } from './files.js';
import { mintPreviewScope, previewScopeRe, validatePreviewScope } from './preview-scopes.js';
import {
  injectSnapshotBridge,
  injectTextEditBridge,
  wantsSnapshotBridge,
  wantsTextEditBridge,
} from './bridges.js';
import { detectEditors, openInEditor, revealDir } from './handoff.js';

const PORT = Number(process.env.PORT) || 4400;
const app = express();
app.use(express.json({ limit: '2mb' }));

fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

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

const sessions = new Map<string, PiSession>();

const sessionKey = (projectId: string, cid: string) => `${projectId}:${cid}`;

function launchConfigFor(id: string, cid: string): SessionLaunchConfig {
  const meta = getProject(id);
  // 设计链路提示栈（locale → discovery 主导层 → 技术栈契约 → 项目元数据块），
  // 对齐参照 composeSystemPrompt 的栈序；全局/项目自定义指令拼在其后。
  const appendPrompts: string[] = designAppendPrompts(meta?.metadata);
  const globalInstructions = readWebuiSettings().instructions?.trim();
  if (globalInstructions) appendPrompts.push(globalInstructions);
  const projectInstructions = meta?.instructions?.trim();
  if (projectInstructions) appendPrompts.push(projectInstructions);
  // 启用中的内置/项目设计 skill 的绝对路径，spawn 时经 pi --skill 显式注入。
  const skillPaths = enabledSkillPaths(projectDir(id));
  // 模型取值：会话覆盖 > 项目设置 > null（跟随全局默认）。
  const model = getConversation(id, cid)?.model ?? meta?.model ?? null;
  return { model, thinking: meta?.thinking ?? null, appendPrompts, skillPaths };
}

function sessionFor(id: string, cid: string): PiSession {
  const key = sessionKey(id, cid);
  let session = sessions.get(key);
  if (!session) {
    session = new PiSession(projectDir(id), () => launchConfigFor(id, cid), piSessionDirFor(id, cid));
    sessions.set(key, session);
  }
  return session;
}

/** dispose 项目下全部（或仅空闲）pi 会话。 */
function disposeProjectSessions(id: string, onlyIdle = false): void {
  const prefix = `${id}:`;
  for (const [key, session] of sessions) {
    if (!key.startsWith(prefix)) continue;
    if (onlyIdle && session.isBusy) continue;
    session.dispose();
    sessions.delete(key);
  }
}

function disposeIdleSessions(): void {
  for (const [key, session] of sessions) {
    if (!session.isBusy) {
      session.dispose();
      sessions.delete(key);
    }
  }
}

// ---- Projects ----

app.get('/api/projects', (_req, res) => {
  const running = runningProjectIds(sessions);
  res.json(listProjects().map((p) => ({ ...p, running: running.has(p.id) })));
});

app.post('/api/projects', (req, res) => {
  const input = parseCreateProjectBody(req.body);
  res.json(
    createProject(input.name, input.model, {
      skillId: input.skillId,
      pendingPrompt: input.pendingPrompt,
      metadata: input.metadata,
    }),
  );
});

app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  disposeProjectSessions(id);
  closeProjectWatcher(id);
  deleteProject(id);
  res.json({ ok: true });
});

app.patch('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const pick = (k: string): string | null | undefined => {
    const v = body[k];
    if (v === undefined) return undefined;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const updated = updateProject(id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    model: pick('model'),
    thinking: pick('thinking'),
    instructions: pick('instructions'),
    skillId: pick('skillId'),
    pendingPrompt: pick('pendingPrompt'),
    pendingAttachments: parsePendingAttachmentsPatch(body.pendingAttachments),
  });
  // 字段出现即视为有修改意图（含 null 清除；非字符串值经 pick 归一化为 null）。
  // pendingPrompt/pendingAttachments 不在列表内：清除待发预填不应重启 pi 进程。
  const affectsSession = ['model', 'thinking', 'instructions', 'skillId'].some((k) => body[k] !== undefined);
  if (affectsSession) {
    disposeProjectSessions(id, true);
  }
  res.json(updated);
});

// ---- Conversations ----

app.get('/api/projects/:id/conversations', async (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  res.json({ conversations: await listConversations(id) });
});

app.post('/api/projects/:id/conversations', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const title = typeof req.body?.title === 'string' ? req.body.title : null;
  res.json({ conversation: createConversation(id, title) });
});

app.patch('/api/projects/:id/conversations/:cid', (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const title = req.body?.title;
  const model = req.body?.model;
  const updated = updateConversation(id, cid, {
    title: title === undefined ? undefined : typeof title === 'string' ? title : null,
    model: model === undefined ? undefined : typeof model === 'string' ? model : null,
  });
  if (!updated) return res.status(404).json({ error: 'conversation not found' });
  // 模型字段出现即视为切换意图：dispose 该会话的空闲 pi 进程，下一条消息
  // 用新模型 --continue 重启（对齐项目设置 PATCH 的处理；busy 时由前端禁用切换）。
  if (model !== undefined) {
    const key = sessionKey(id, cid);
    const session = sessions.get(key);
    if (session && !session.isBusy) {
      session.dispose();
      sessions.delete(key);
    }
  }
  res.json({ conversation: updated });
});

app.delete('/api/projects/:id/conversations/:cid', (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const key = sessionKey(id, cid);
  sessions.get(key)?.dispose();
  sessions.delete(key);
  removeTurnJournal(id, cid);
  if (!deleteConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  res.json({ ok: true });
});

app.get('/api/projects/:id/conversations/:cid/history', (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  if (!getConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  res.json(readConversationHistory(id, cid));
});

app.post('/api/projects/:id/conversations/:cid/abort', (req, res) => {
  sessions.get(sessionKey(req.params.id, req.params.cid))?.abort();
  res.json({ ok: true });
});

app.post('/api/projects/:id/conversations/:cid/chat', async (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  if (!getConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const attachments = sanitizeAttachments(req.body?.attachments);
  if (!message && attachments.length === 0) return res.status(400).json({ error: 'message is required' });

  const session = sessionFor(id, cid);
  if (session.isBusy || activeTurn(id, cid)) {
    return res.status(409).json({ error: 'agent 正忙，请先停止当前回合' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  appendConversationHistory(id, cid, {
    role: 'user',
    content: message,
    ...(attachments.length > 0 ? { attachments } : {}),
    createdAt: Date.now(),
  });

  // 回合与连接解耦：本响应只是第一个订阅者。客户端断开仅退订、不再 abort，
  // 回合后台跑完并由 startTurn 统一折叠落盘（spec: 2026-06-12-turn-resume）。
  const { turn, finished } = startTurn(id, cid, (emit) =>
    session.prompt(composePromptWithAttachments(message, attachments), emit),
  );
  const unsubscribe = turn.subscribe((ev) => {
    res.write(`${JSON.stringify(ev)}\n`);
  });
  req.on('close', unsubscribe);
  await finished;
  res.end();
});

// 续接进行中的回合：回放已缓冲事件并实时续流，结尾 done；空闲返回 204。
// 多订阅者互不影响（多标签页可同时观看）。
app.get('/api/projects/:id/conversations/:cid/chat/stream', (req, res) => {
  const { id, cid } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  if (!getConversation(id, cid)) return res.status(404).json({ error: 'conversation not found' });
  const turn = activeTurn(id, cid);
  if (!turn) return res.status(204).end();

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const unsubscribe = turn.subscribe((ev) => {
    res.write(`${JSON.stringify(ev)}\n`);
    if (ev.type === 'done') res.end();
  });
  req.on('close', unsubscribe);
});

app.get('/api/projects/:id/files', (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  res.json(listFiles(req.params.id));
});

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

// multer 自身的错误（如超过 100MB 限制）发生在进入上方 handler 之前，
// 不兜住会落到 Express 默认错误页（500 + HTML）。这里转成结构化 400。
app.use('/api/import/claude-design', (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'zip exceeds the 100MB upload limit' : err.message;
    return res.status(400).json({ error: message });
  }
  next(err);
});

// ---- Artifacts ----

app.get('/api/projects/:id/artifacts', async (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ artifacts: await listArtifacts(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- File CRUD ----

function fileErrorStatus(err: unknown): number {
  const msg = String(err);
  if (msg.includes('FILE_EXISTS')) return 409;
  if (msg.includes('BAD_PATH')) return 400;
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 404;
  return 500;
}

function queryPath(req: express.Request): string | null {
  const value = req.query.path;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

app.get('/api/projects/:id/file', async (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  const rel = queryPath(req);
  if (!rel) return res.status(400).json({ error: 'path is required' });
  try {
    const buffer = await readProjectFile(req.params.id, rel);
    res.setHeader('Cache-Control', 'no-store');
    res.type(path.extname(rel) || 'text/plain').send(buffer);
  } catch (err) {
    res.status(fileErrorStatus(err)).json({ error: String(err) });
  }
});

app.put(
  '/api/projects/:id/file',
  express.raw({ type: '*/*', limit: '50mb' }),
  async (req, res) => {
    if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
    const rel = queryPath(req);
    if (!rel) return res.status(400).json({ error: 'path is required' });
    const overwrite = req.query.overwrite !== 'false';
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      await writeProjectFile(req.params.id, rel, body, { overwrite });
      touchProject(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(fileErrorStatus(err)).json({ error: String(err) });
    }
  },
);

app.delete('/api/projects/:id/file', async (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  const rel = queryPath(req);
  if (!rel) return res.status(400).json({ error: 'path is required' });
  try {
    await deleteProjectFile(req.params.id, rel);
    touchProject(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(fileErrorStatus(err)).json({ error: String(err) });
  }
});

app.post('/api/projects/:id/file/rename', async (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  const from = typeof req.body?.from === 'string' ? req.body.from : '';
  const to = typeof req.body?.to === 'string' ? req.body.to : '';
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  try {
    await renameProjectFile(req.params.id, from, to);
    touchProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(fileErrorStatus(err)).json({ error: String(err) });
  }
});

// ---- File change events (SSE) ----

app.get('/api/projects/:id/events', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  const unsubscribe = watchProject(id, () => {
    res.write(`data: ${JSON.stringify({ type: 'files-changed' })}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

// ---- Preview (scoped URL serving, ported from open-design project-routes) ----

// 对齐参照 FileViewer 实际使用的 raw 路由语义（open-design
// project-routes.ts:2205-2257 + FileViewer.tsx sandbox="allow-scripts
// allow-downloads"）：预览响应不带 CSP——Claude Design 导出的页面依赖
// unpkg 等 CDN 脚本与 Babel 对同目录 .jsx 的 XHR，严格 CSP（script-src
// 'self' / connect-src 'none'）会让页面整体失效。隔离仍由 iframe sandbox
// 的 opaque origin + scope token 提供；opaque origin 的 fetch 经下方
// Origin:null → ACAO:* 放行（同参照）。
const projectPreviewIframeSandbox = 'allow-scripts allow-downloads';

function setProjectPreviewHeaders(res: express.Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function encodeProjectPathForUrl(filePath: string): string {
  return filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

app.get('/api/projects/:id/preview-url', async (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  try {
    const requested =
      typeof req.query.file === 'string' && req.query.file.trim().length > 0
        ? req.query.file
        : (await listArtifacts(id))[0]?.manifest.entry ?? 'index.html';
    const abs = safeResolve(id, requested);
    if (!abs) return res.status(400).json({ error: 'bad path' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file not found' });
    const scope = mintPreviewScope(id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      url: `/api/projects/${encodeURIComponent(id)}/preview/${scope}/${encodeProjectPathForUrl(requested)}`,
      file: requested,
      iframeSandbox: projectPreviewIframeSandbox,
      opaqueOrigin: true,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get(/^\/api\/projects\/([^/]+)\/preview\/([^/]+)\/(.+)$/u, (req, res) => {
  const params = req.params as unknown as Record<string, string>;
  const id = String(params['0'] ?? '');
  const scope = String(params['1'] ?? '');
  const rel = decodeURIComponent(String(params['2'] ?? ''));
  if (!previewScopeRe.test(scope)) return res.status(400).send('invalid preview scope');
  if (!getProject(id)) return res.status(404).send('project not found');
  if (!validatePreviewScope(id, scope)) return res.status(404).send('preview scope not found');
  if (rel.split('/').some((seg) => HIDDEN_DIRS.has(seg))) return res.status(404).send('not found');
  const target = safeResolve(id, rel);
  if (!target) return res.status(400).send('bad path');
  if (req.headers.origin === 'null') res.header('Access-Control-Allow-Origin', '*');
  setProjectPreviewHeaders(res);
  const isHtml = /\.html?$/i.test(rel);
  const wantsSnapshot = wantsSnapshotBridge(req.query.bridge);
  const wantsEdit = wantsTextEditBridge(req.query.bridge);
  if (isHtml && (wantsSnapshot || wantsEdit)) {
    try {
      let html = fs.readFileSync(target, 'utf8');
      if (wantsSnapshot) html = injectSnapshotBridge(html);
      if (wantsEdit) html = injectTextEditBridge(html);
      return res.type('html').send(html);
    } catch {
      return res.status(404).send('not found');
    }
  }
  res.sendFile(target, (err) => {
    if (err && !res.headersSent) res.status(404).send('not found');
  });
});

// ---- Handoff (editor detection / Finder / open in editor) ----

app.get('/api/projects/:id/handoff', (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  res.json({ dir: projectDir(req.params.id), editors: detectEditors() });
});

app.post('/api/projects/:id/reveal', (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  revealDir(projectDir(req.params.id));
  res.json({ ok: true });
});

app.post('/api/projects/:id/open-in-editor', (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  const editor = typeof req.body?.editor === 'string' ? req.body.editor : '';
  if (!openInEditor(editor, projectDir(req.params.id))) {
    return res.status(400).json({ error: 'unknown editor' });
  }
  res.json({ ok: true });
});

// ---- Export (ZIP download) ----

app.get('/api/projects/:id/export', (req, res) => {
  const { id } = req.params;
  const meta = getProject(id);
  if (!meta) return res.status(404).json({ error: 'project not found' });
  // Optional ?root=<top-level dir> scopes the archive to a subdirectory,
  // mirroring open-design's /archive route.
  const root = typeof req.query.root === 'string' ? req.query.root.replace(/^\/+|\/+$/g, '') : '';
  let cwd = projectDir(id);
  if (root) {
    const abs = safeResolve(id, root);
    if (!abs) return res.status(400).json({ error: 'bad root' });
    try {
      if (!fs.statSync(abs).isDirectory()) return res.status(400).json({ error: 'root is not a directory' });
    } catch {
      return res.status(404).json({ error: 'root not found' });
    }
    cwd = abs;
  }
  const base = root ? root.split('/').pop()! : meta.name;
  const filename = `${base.replace(/[^\w一-龥-]+/g, '_') || 'project'}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('export failed:', err);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  archive.pipe(res);
  archive.glob('**/*', {
    cwd,
    ignore: [...HIDDEN_DIRS].map((d) => `${d}/**`),
    dot: true,
  });
  void archive.finalize();
});

registerPiRoutes(app, { disposeIdleSessions });

// server 重启后：把上次进程死于中途的回合折叠进历史并标记中断。
recoverInterruptedTurns();

app.listen(PORT, () => {
  console.log(`pi-web-studio server: http://localhost:${PORT}`);
  console.log(`projects root: ${PROJECTS_ROOT}`);
});
