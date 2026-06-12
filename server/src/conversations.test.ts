import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createProject, deleteProject, getProject, projectDir } from './projects.js';
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

const created: string[] = [];
afterAll(() => {
  for (const id of created) deleteProject(id);
});

function makeProject(name: string): string {
  const meta = createProject(name);
  created.push(meta.id);
  return meta.id;
}

describe('migration', () => {
  it('migrates legacy history.json + pi-sessions into a default conversation, idempotently', async () => {
    const id = makeProject('conv-migrate');
    const webui = path.join(projectDir(id), '.webui');
    // 构造旧形态：history.json + pi-sessions/*.jsonl，且无 conversations.json
    fs.writeFileSync(
      path.join(webui, 'history.json'),
      JSON.stringify([{ role: 'user', content: 'hi', createdAt: 1 }]),
    );
    fs.mkdirSync(path.join(webui, 'pi-sessions'), { recursive: true });
    fs.writeFileSync(path.join(webui, 'pi-sessions', 'abc.jsonl'), '{}\n');

    const list = await listConversations(id);
    expect(list).toHaveLength(1);
    const conv = list[0];
    expect(conv.title).toBeNull();
    expect(conv.createdAt).toBe(getProject(id)!.createdAt);
    expect(conv.messageCount).toBe(1);
    // 旧历史并入对话文件，旧文件删除
    expect(readConversationHistory(id, conv.id)).toEqual([{ role: 'user', content: 'hi', createdAt: 1 }]);
    expect(fs.existsSync(path.join(webui, 'history.json'))).toBe(false);
    // 旧 session jsonl 移入该对话的 session dir
    expect(fs.existsSync(path.join(piSessionDirFor(id, conv.id), 'abc.jsonl'))).toBe(true);
    // 幂等：再次列出不重复迁移
    const again = await listConversations(id);
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(conv.id);
  });

  it('creates an empty default conversation when no legacy data exists', async () => {
    const id = makeProject('conv-fresh');
    const list = await listConversations(id);
    expect(list).toHaveLength(1);
    expect(list[0].messageCount).toBe(0);
    expect(readConversationHistory(id, list[0].id)).toEqual([]);
  });
});

describe('CRUD + ordering', () => {
  it('creates, retitles, sorts by updatedAt desc, and reports messageCount', async () => {
    const id = makeProject('conv-crud');
    const [first] = await listConversations(id);
    const second = createConversation(id, '  方案B  ');
    expect(second.title).toBe('方案B');
    expect(createConversation(id, '   ').title).toBeNull();

    appendConversationHistory(id, first.id, { role: 'user', content: 'x', createdAt: Date.now() });
    const list = await listConversations(id);
    expect(list[0].id).toBe(first.id); // append bump 了 updatedAt，排最前
    expect(list[0].messageCount).toBe(1);

    const renamed = updateConversation(id, second.id, { title: '正式稿' })!;
    expect(renamed.title).toBe('正式稿');
    expect(getConversation(id, second.id)!.title).toBe('正式稿');
  });

  it('sets, persists and clears the per-conversation model override', async () => {
    const id = makeProject('conv-model');
    const [conv] = await listConversations(id);
    expect(conv.model ?? null).toBeNull();

    const set = updateConversation(id, conv.id, { model: '  anthropic/claude-sonnet-4-6  ' })!;
    expect(set.model).toBe('anthropic/claude-sonnet-4-6');
    expect(getConversation(id, conv.id)!.model).toBe('anthropic/claude-sonnet-4-6');

    // 只改 title 不动 model
    updateConversation(id, conv.id, { title: '改名' });
    expect(getConversation(id, conv.id)!.model).toBe('anthropic/claude-sonnet-4-6');

    // null/空串 = 清除覆盖，恢复跟随项目设置
    const cleared = updateConversation(id, conv.id, { model: null })!;
    expect(cleared.model).toBeNull();
    expect(updateConversation(id, conv.id, { model: '   ' })!.model).toBeNull();
  });

  it('append bumps conversation and project updatedAt', async () => {
    const id = makeProject('conv-bump');
    const [conv] = await listConversations(id);
    const beforeProject = getProject(id)!.updatedAt!;
    await new Promise((r) => setTimeout(r, 5));
    appendConversationHistory(id, conv.id, { role: 'assistant', content: 'ok', createdAt: Date.now() });
    expect(getConversation(id, conv.id)!.updatedAt).toBeGreaterThan(conv.updatedAt);
    expect(getProject(id)!.updatedAt!).toBeGreaterThan(beforeProject);
  });

  it('delete removes index entry, history file and session dir', async () => {
    const id = makeProject('conv-del');
    const [conv] = await listConversations(id);
    fs.mkdirSync(piSessionDirFor(id, conv.id), { recursive: true });
    deleteConversation(id, conv.id);
    expect(getConversation(id, conv.id)).toBeNull();
    expect(fs.existsSync(piSessionDirFor(id, conv.id))).toBe(false);
    // 删空后列表为空（服务端不自动补建，由客户端兜底）
    expect(await listConversations(id)).toEqual([]);
  });
});
