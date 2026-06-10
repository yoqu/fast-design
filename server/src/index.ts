import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import archiver from 'archiver';
import { PiSession } from './pi-session.js';
import {
  HIDDEN_DIRS,
  PROJECTS_ROOT,
  appendHistory,
  createProject,
  deleteProject,
  getProject,
  listFiles,
  listProjects,
  projectDir,
  readHistory,
  safeResolve,
} from './projects.js';
import { closeProjectWatcher, watchProject } from './watch.js';
import type { ChatMessage, ToolCall, UiEvent } from './types.js';

const PORT = Number(process.env.PORT) || 4400;
const app = express();
app.use(express.json({ limit: '2mb' }));

fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

const sessions = new Map<string, PiSession>();

function sessionFor(id: string): PiSession {
  let session = sessions.get(id);
  if (!session) {
    const meta = getProject(id);
    session = new PiSession(projectDir(id), meta?.model ?? null);
    sessions.set(id, session);
  }
  return session;
}

// ---- Projects ----

app.get('/api/projects', (_req, res) => {
  res.json(listProjects());
});

app.post('/api/projects', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const model = typeof req.body?.model === 'string' ? req.body.model : null;
  res.json(createProject(name, model));
});

app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  sessions.get(id)?.dispose();
  sessions.delete(id);
  closeProjectWatcher(id);
  deleteProject(id);
  res.json({ ok: true });
});

app.get('/api/projects/:id/history', (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  res.json(readHistory(req.params.id));
});

app.get('/api/projects/:id/files', (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'project not found' });
  res.json(listFiles(req.params.id));
});

// ---- Chat (streaming NDJSON) ----

app.post('/api/projects/:id/chat', async (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required' });

  const session = sessionFor(id);
  if (session.isBusy) return res.status(409).json({ error: 'agent 正忙，请先停止当前回合' });

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  appendHistory(id, { role: 'user', content: message, createdAt: Date.now() });

  // Accumulate the assistant turn so it can be persisted once finished.
  const assistant: ChatMessage = { role: 'assistant', content: '', createdAt: Date.now() };
  const tools: ToolCall[] = [];

  const emit = (ev: UiEvent) => {
    switch (ev.type) {
      case 'text_delta':
        assistant.content += ev.delta;
        break;
      case 'thinking_delta':
        assistant.thinking = (assistant.thinking ?? '') + ev.delta;
        break;
      case 'tool_use':
        tools.push({ id: ev.id, name: ev.name, input: ev.input });
        break;
      case 'tool_result': {
        const call = tools.find((t) => t.id === ev.toolUseId && t.result === undefined) ?? tools.at(-1);
        if (call) {
          call.result = ev.content.length > 4000 ? `${ev.content.slice(0, 4000)}\n…(截断)` : ev.content;
          call.isError = ev.isError;
        }
        break;
      }
      case 'error':
        assistant.error = ev.message;
        break;
    }
    res.write(`${JSON.stringify(ev)}\n`);
  };

  req.on('close', () => {
    // Client went away mid-turn: stop the agent so it doesn't burn tokens.
    if (session.isBusy) session.abort();
  });

  await session.prompt(message, emit);
  if (tools.length > 0) assistant.tools = tools;
  appendHistory(id, assistant);
  res.write(`${JSON.stringify({ type: 'done' } satisfies UiEvent)}\n`);
  res.end();
});

app.post('/api/projects/:id/abort', (req, res) => {
  sessions.get(req.params.id)?.abort();
  res.json({ ok: true });
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

// ---- Preview (static serving of the project dir) ----

app.get('/preview/:id/*', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).send('project not found');
  const rel = decodeURIComponent((req.params as Record<string, string>)['0'] || '') || 'index.html';
  if (rel.split('/').some((seg) => HIDDEN_DIRS.has(seg))) return res.status(404).send('not found');
  let target = safeResolve(id, rel);
  if (!target) return res.status(400).send('bad path');
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  } catch {
    // fall through to sendFile 404 handling
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(target, (err) => {
    if (err && !res.headersSent) {
      res.status(404).send(`<!doctype html><meta charset="utf-8">
<body style="font-family:system-ui;color:#888;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:40px">🛠️</div>
<p>还没有 <code>${rel}</code> — 让 agent 先生成页面吧</p></div></body>`);
    }
  });
});

app.get('/preview/:id', (req, res) => {
  res.redirect(`/preview/${req.params.id}/index.html`);
});

// ---- Export (ZIP download) ----

app.get('/api/projects/:id/export', (req, res) => {
  const { id } = req.params;
  const meta = getProject(id);
  if (!meta) return res.status(404).json({ error: 'project not found' });
  const filename = `${meta.name.replace(/[^\w一-龥-]+/g, '_') || 'project'}.zip`;
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
    cwd: projectDir(id),
    ignore: [...HIDDEN_DIRS].map((d) => `${d}/**`),
    dot: true,
  });
  void archive.finalize();
});

app.listen(PORT, () => {
  console.log(`pi-web-studio server: http://localhost:${PORT}`);
  console.log(`projects root: ${PROJECTS_ROOT}`);
});
