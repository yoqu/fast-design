import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getProject, projectDir, touchProject } from './projects.js';
import type { ChatMessage } from './types.js';

/** 对齐 open-design conversations 表（db.ts:76-84），sessionMode 裁剪。 */
export type ConversationMeta = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationSummary = ConversationMeta & { messageCount: number };

function webuiDir(projectId: string): string {
  return path.join(projectDir(projectId), '.webui');
}

function indexPath(projectId: string): string {
  return path.join(webuiDir(projectId), 'conversations.json');
}

function historyDir(projectId: string): string {
  return path.join(webuiDir(projectId), 'conversations');
}

function historyPath(projectId: string, cid: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(cid)) throw new Error(`invalid conversation id: ${cid}`);
  return path.join(historyDir(projectId), `${cid}.json`);
}

function legacyHistoryPath(projectId: string): string {
  return path.join(webuiDir(projectId), 'history.json');
}

function piSessionsRoot(projectId: string): string {
  return path.join(webuiDir(projectId), 'pi-sessions');
}

/** 每对话独立的 pi --session-dir（等效参照 agent_sessions 按 conversation 隔离）。 */
export function piSessionDirFor(projectId: string, cid: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(cid)) throw new Error(`invalid conversation id: ${cid}`);
  return path.join(piSessionsRoot(projectId), cid);
}

function readIndex(projectId: string): ConversationMeta[] | null {
  try {
    return JSON.parse(fs.readFileSync(indexPath(projectId), 'utf8')) as ConversationMeta[];
  } catch {
    return null;
  }
}

function writeIndex(projectId: string, list: ConversationMeta[]): void {
  fs.writeFileSync(indexPath(projectId), JSON.stringify(list, null, 2));
}

/**
 * 惰性迁移 + 兜底：无 conversations.json 时创建默认对话（title:null，
 * 对齐参照 project-routes.ts:1198-1210）。存在旧版单对话数据
 * （history.json / pi-sessions/*.jsonl）则无损并入默认对话——session
 * jsonl 移入 pi-sessions/<cid>/ 保住 --continue 上下文。幂等。
 *
 * 注意：本函数必须保持全同步 fs——单线程下两个并发首次请求才不会同时进入
 * 迁移分支；任何一步改成 await 都会重新引入「双迁移丢历史」竞态。
 */
function ensureConversations(projectId: string): ConversationMeta[] {
  const existing = readIndex(projectId);
  if (existing) return existing;

  const meta = getProject(projectId);
  const now = Date.now();
  const cid = crypto.randomBytes(6).toString('hex');
  const conv: ConversationMeta = {
    id: cid,
    title: null,
    createdAt: meta?.createdAt ?? now,
    updatedAt: meta?.updatedAt ?? meta?.createdAt ?? now,
  };

  fs.mkdirSync(historyDir(projectId), { recursive: true });

  let legacyMessages: ChatMessage[] = [];
  try {
    legacyMessages = JSON.parse(fs.readFileSync(legacyHistoryPath(projectId), 'utf8')) as ChatMessage[];
  } catch {
    // 没有旧历史——全新项目。
  }
  fs.writeFileSync(historyPath(projectId, cid), JSON.stringify(legacyMessages, null, 2));
  fs.rmSync(legacyHistoryPath(projectId), { force: true });

  // 旧 session jsonl 平铺在 pi-sessions/ 下，移入默认对话子目录。
  try {
    const root = piSessionsRoot(projectId);
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const jsonl = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
    if (jsonl.length > 0) {
      fs.mkdirSync(piSessionDirFor(projectId, cid), { recursive: true });
      for (const f of jsonl) {
        fs.renameSync(path.join(root, f.name), path.join(piSessionDirFor(projectId, cid), f.name));
      }
    }
  } catch {
    // 无旧 session 目录。
  }

  writeIndex(projectId, [conv]);
  return [conv];
}

function countMessages(projectId: string, cid: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath(projectId, cid), 'utf8')) as unknown[];
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/** 列表按 updatedAt DESC（对齐参照 listConversations），附 messageCount。 */
export async function listConversations(projectId: string): Promise<ConversationSummary[]> {
  return ensureConversations(projectId)
    .map((c) => ({ ...c, messageCount: countMessages(projectId, c.id) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(projectId: string, cid: string): ConversationMeta | null {
  return readIndex(projectId)?.find((c) => c.id === cid) ?? null;
}

export function createConversation(projectId: string, title?: string | null): ConversationMeta {
  const list = ensureConversations(projectId);
  const now = Date.now();
  const conv: ConversationMeta = {
    id: crypto.randomBytes(6).toString('hex'),
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
    createdAt: now,
    updatedAt: now,
  };
  fs.mkdirSync(historyDir(projectId), { recursive: true });
  fs.writeFileSync(historyPath(projectId, conv.id), '[]');
  writeIndex(projectId, [...list, conv]);
  return conv;
}

export function updateConversation(
  projectId: string,
  cid: string,
  patch: { title?: string | null },
): ConversationMeta | null {
  const list = ensureConversations(projectId);
  const idx = list.findIndex((c) => c.id === cid);
  if (idx < 0) return null;
  const next = { ...list[idx], updatedAt: Date.now() };
  if (patch.title !== undefined) {
    next.title = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : null;
  }
  list[idx] = next;
  writeIndex(projectId, list);
  return next;
}

export function deleteConversation(projectId: string, cid: string): boolean {
  const list = ensureConversations(projectId);
  const next = list.filter((c) => c.id !== cid);
  if (next.length === list.length) return false;
  writeIndex(projectId, next);
  fs.rmSync(historyPath(projectId, cid), { force: true });
  fs.rmSync(piSessionDirFor(projectId, cid), { recursive: true, force: true });
  return true;
}

export function readConversationHistory(projectId: string, cid: string): ChatMessage[] {
  try {
    return JSON.parse(fs.readFileSync(historyPath(projectId, cid), 'utf8')) as ChatMessage[];
  } catch {
    return [];
  }
}

/** 落一条消息并 bump 对话与项目的 updatedAt（对齐参照消息写入逻辑）。 */
export function appendConversationHistory(projectId: string, cid: string, message: ChatMessage): void {
  const history = readConversationHistory(projectId, cid);
  history.push(message);
  fs.mkdirSync(historyDir(projectId), { recursive: true });
  fs.writeFileSync(historyPath(projectId, cid), JSON.stringify(history, null, 2));
  const list = readIndex(projectId);
  if (list) {
    const idx = list.findIndex((c) => c.id === cid);
    if (idx >= 0) {
      list[idx] = { ...list[idx], updatedAt: Date.now() };
      writeIndex(projectId, list);
    }
  }
  touchProject(projectId);
}
