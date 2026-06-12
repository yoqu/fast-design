import { describe, expect, it } from 'vitest';
import { composePromptWithAttachments, parsePendingAttachmentsPatch, sanitizeAttachments } from './attachments.js';

const valid = { name: 'logo.png', path: 'uploads/123-logo.png', mimeType: 'image/png', size: 2048 };

describe('sanitizeAttachments', () => {
  it('接受合法附件并归一化字段', () => {
    expect(sanitizeAttachments([valid])).toEqual([valid]);
  });

  it('非数组输入返回空列表', () => {
    expect(sanitizeAttachments(undefined)).toEqual([]);
    expect(sanitizeAttachments('x')).toEqual([]);
    expect(sanitizeAttachments({})).toEqual([]);
  });

  it('丢弃缺 name/path 的条目', () => {
    expect(sanitizeAttachments([{ ...valid, name: '' }])).toEqual([]);
    expect(sanitizeAttachments([{ ...valid, path: '  ' }])).toEqual([]);
    expect(sanitizeAttachments([null, 42, 'a'])).toEqual([]);
  });

  it('丢弃越权路径（绝对路径 / .. / 元数据目录 / 反斜杠）', () => {
    for (const path of ['/etc/passwd', '../outside.txt', 'a/../../b', '.webui/meta.json', '.pi/x', 'a\\b']) {
      expect(sanitizeAttachments([{ ...valid, path }])).toEqual([]);
    }
  });

  it('mimeType/size 非法时回退默认值', () => {
    const [a] = sanitizeAttachments([{ name: 'f', path: 'f.bin', mimeType: 7, size: 'big' }]);
    expect(a).toEqual({ name: 'f', path: 'f.bin', mimeType: '', size: 0 });
  });

  it('数量截断到 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...valid, path: `uploads/${i}.png` }));
    expect(sanitizeAttachments(many)).toHaveLength(20);
  });
});

describe('parsePendingAttachmentsPatch', () => {
  it('字段缺省返回 undefined（不动）', () => {
    expect(parsePendingAttachmentsPatch(undefined)).toBeUndefined();
  });

  it('null/非数组/清洗后为空均归一化为 null（清除）', () => {
    expect(parsePendingAttachmentsPatch(null)).toBeNull();
    expect(parsePendingAttachmentsPatch('x')).toBeNull();
    expect(parsePendingAttachmentsPatch([{ name: '', path: '' }])).toBeNull();
  });

  it('合法列表清洗后原样返回', () => {
    expect(parsePendingAttachmentsPatch([valid])).toEqual([valid]);
  });
});

describe('composePromptWithAttachments', () => {
  it('无附件时原样返回消息', () => {
    expect(composePromptWithAttachments('hi', [])).toBe('hi');
  });

  it('有附件时追加清单段落', () => {
    const prompt = composePromptWithAttachments('帮我看下这张图', [valid]);
    expect(prompt).toContain('帮我看下这张图');
    expect(prompt).toContain('uploads/123-logo.png');
    expect(prompt).toContain('image/png');
    expect(prompt).toContain('2.0 KB');
  });

  it('只有附件没有文字时给默认引导语', () => {
    const prompt = composePromptWithAttachments('', [valid]);
    expect(prompt).toContain('请查看用户上传的附件。');
    expect(prompt).toContain('uploads/123-logo.png');
  });
});
