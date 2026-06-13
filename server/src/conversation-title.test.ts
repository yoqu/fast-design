import { afterAll, describe, expect, it } from 'vitest';
import { autoTitleConversation, cleanTitle } from './conversation-title.js';
import { createConversation, getConversation, updateConversation } from './conversations.js';
import { createProject, deleteProject } from './projects.js';
import type { PiRunner } from './pi-cli.js';

const created: string[] = [];
afterAll(() => {
  for (const id of created) deleteProject(id);
});

function makeProject(name: string): string {
  const meta = createProject(name);
  created.push(meta.id);
  return meta.id;
}

describe('cleanTitle', () => {
  it('剥引号/句尾标点并限长', () => {
    expect(cleanTitle('「咖啡店落地页」\n')).toBe('咖啡店落地页');
    expect(cleanTitle('"Coffee landing page."')).toBe('Coffee landing page');
    expect(cleanTitle('咖啡店落地页设计。')).toBe('咖啡店落地页设计');
    expect(cleanTitle('一'.repeat(40))).toHaveLength(24);
  });

  it('多行输出取最后一个非空行（跳过模型前导废话）', () => {
    expect(cleanTitle('好的，标题如下：\n\n咖啡店落地页\n')).toBe('咖啡店落地页');
  });

  it('空输出返回 null', () => {
    expect(cleanTitle('')).toBeNull();
    expect(cleanTitle('  \n  ')).toBeNull();
  });
});

describe('autoTitleConversation', () => {
  it('用 runner 输出命名未命名对话，并带 --print/--no-session 与模型参数', async () => {
    const id = makeProject('title-basic');
    const conv = createConversation(id);
    let seenArgs: string[] = [];
    const run: PiRunner = async (args) => {
      seenArgs = args;
      return { code: 0, stdout: '咖啡店落地页\n', stderr: '' };
    };
    await autoTitleConversation({ projectId: id, cid: conv.id, message: '做一个咖啡店落地页', model: 'a/b', run });
    expect(getConversation(id, conv.id)?.title).toBe('咖啡店落地页');
    expect(seenArgs).toContain('--print');
    expect(seenArgs).toContain('--no-session');
    expect(seenArgs).toContain('--no-tools');
    expect(seenArgs.slice(seenArgs.indexOf('--model'))[1]).toBe('a/b');
  });

  it('用户已手动命名则不覆盖', async () => {
    const id = makeProject('title-manual');
    const conv = createConversation(id);
    updateConversation(id, conv.id, { title: '我的标题' });
    const run: PiRunner = async () => ({ code: 0, stdout: 'AI 标题', stderr: '' });
    await autoTitleConversation({ projectId: id, cid: conv.id, message: 'hi', model: null, run });
    expect(getConversation(id, conv.id)?.title).toBe('我的标题');
  });

  it('runner 失败/非零退出/抛错均静默保持未命名', async () => {
    const id = makeProject('title-fail');
    const conv = createConversation(id);
    await autoTitleConversation({
      projectId: id,
      cid: conv.id,
      message: 'hi',
      model: null,
      run: async () => ({ code: 1, stdout: '', stderr: 'boom' }),
    });
    expect(getConversation(id, conv.id)?.title).toBeNull();
    await autoTitleConversation({
      projectId: id,
      cid: conv.id,
      message: 'hi',
      model: null,
      run: async () => {
        throw new Error('spawn ENOENT');
      },
    });
    expect(getConversation(id, conv.id)?.title).toBeNull();
  });
});
