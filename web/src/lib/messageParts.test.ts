import { describe, expect, it } from 'vitest';
import {
  ABSORB_MAX_CHARS,
  appendPartText,
  groupMessageParts,
  messageParts,
  rollbackParts,
  summarizeTools,
  writtenFilePath,
} from './messageParts';
import type { ChatMessage, MessagePart } from './types';

function msg(partial: Partial<ChatMessage>): ChatMessage {
  return { role: 'assistant', content: '', createdAt: 0, ...partial };
}

describe('messageParts', () => {
  it('优先使用 parts，缺省按 thinking→tools→content 合成旧序', () => {
    const parts: MessagePart[] = [{ kind: 'text', text: 'a' }];
    expect(messageParts(msg({ parts }))).toBe(parts);
    expect(
      messageParts(
        msg({
          content: '答案',
          thinking: '想',
          tools: [{ id: 't1', name: 'read', input: null }],
        }),
      ),
    ).toEqual([
      { kind: 'thinking', text: '想' },
      { kind: 'tool', toolIndex: 0 },
      { kind: 'text', text: '答案' },
    ]);
  });
});

describe('appendPartText / rollbackParts', () => {
  it('同 kind 合并、异 kind 新开片段，且不改原数组', () => {
    const p1 = appendPartText(undefined, 'text', 'he');
    const p2 = appendPartText(p1, 'text', 'llo');
    const p3 = appendPartText(p2, 'thinking', 'hmm');
    expect(p3).toEqual([
      { kind: 'text', text: 'hello' },
      { kind: 'thinking', text: 'hmm' },
    ]);
    expect(p1).toEqual([{ kind: 'text', text: 'he' }]);
  });

  it('rollback 截到检查点：丢多余片段并截末位文本', () => {
    const parts: MessagePart[] = [
      { kind: 'text', text: '第一回合。半截' },
      { kind: 'tool', toolIndex: 0 },
    ];
    expect(rollbackParts(parts, 1, 5)).toEqual([{ kind: 'text', text: '第一回合。' }]);
  });
});

describe('groupMessageParts', () => {
  it('保持时间线：text 与 activity 交错，顺序不被打乱', () => {
    const parts: MessagePart[] = [
      { kind: 'text', text: '长'.repeat(ABSORB_MAX_CHARS + 1) },
      { kind: 'tool', toolIndex: 0 },
      { kind: 'tool', toolIndex: 1 },
      { kind: 'text', text: '长'.repeat(ABSORB_MAX_CHARS + 1) },
      { kind: 'tool', toolIndex: 2 },
      { kind: 'text', text: '结尾答案' },
    ];
    const blocks = groupMessageParts(parts);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'activity', 'text', 'activity', 'text']);
    expect(blocks[1]).toMatchObject({ index: 1, parts: [parts[1], parts[2]] });
  });

  it('夹在工具之间的短叙述吸收进活动块；结尾短文本不吸收', () => {
    const parts: MessagePart[] = [
      { kind: 'tool', toolIndex: 0 },
      { kind: 'text', text: '接着改样式' },
      { kind: 'tool', toolIndex: 1 },
      { kind: 'text', text: '完成了' },
    ];
    const blocks = groupMessageParts(parts);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'activity', parts: parts.slice(0, 3) });
    expect(blocks[1]).toMatchObject({ kind: 'text', text: '完成了' });
  });

  it('结尾短文本独立成段（最终回答不进折叠块）', () => {
    const parts: MessagePart[] = [
      { kind: 'tool', toolIndex: 0 },
      { kind: 'text', text: '完成了' },
    ];
    const blocks = groupMessageParts(parts);
    expect(blocks.map((b) => b.kind)).toEqual(['activity', 'text']);
  });

  it('thinking 开启活动块并与后续工具同组', () => {
    const parts: MessagePart[] = [
      { kind: 'thinking', text: '想想' },
      { kind: 'tool', toolIndex: 0 },
    ];
    const blocks = groupMessageParts(parts);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'activity', index: 0 });
  });

  it('空白文本不产生空段', () => {
    expect(groupMessageParts([{ kind: 'text', text: '  \n ' }])).toEqual([]);
  });
});

describe('summarizeTools', () => {
  it('按工具类型映射动词并计数，保持首次出现顺序', () => {
    const t = (name: string) => ({ id: null, name, input: {} });
    const out = summarizeTools([
      t('Read'), t('Read'), t('Grep'), t('Write'), t('Read'), t('TodoWrite'), t('Edit'),
    ]);
    expect(out).toEqual([
      { verb: '读取', count: 3 },
      { verb: '搜索', count: 1 },
      { verb: '写入', count: 1 },
      { verb: '更新待办', count: 1 },
      { verb: '编辑', count: 1 },
    ]);
  });
  it('未知工具名原样作为动词', () => {
    expect(summarizeTools([{ id: null, name: 'Frobnicate', input: {} }])).toEqual([
      { verb: 'Frobnicate', count: 1 },
    ]);
  });
});

describe('writtenFilePath', () => {
  it('写类工具取 path/file_path，非写类返回 null', () => {
    expect(writtenFilePath('Write', { path: 'a/b.html' })).toBe('a/b.html');
    expect(writtenFilePath('Edit', { file_path: 'c.css' })).toBe('c.css');
    expect(writtenFilePath('Read', { path: 'a/b.html' })).toBeNull();
    expect(writtenFilePath(null, { path: 'x' })).toBeNull();
  });
});
