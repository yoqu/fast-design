import { describe, expect, it } from 'vitest';
import { applyMention, filterMentionFiles, getMentionContext } from './mention';

describe('getMentionContext', () => {
  it('行首的 @ 触发', () => {
    expect(getMentionContext('@', 1)).toEqual({ start: 0, query: '' });
    expect(getMentionContext('@ind', 4)).toEqual({ start: 0, query: 'ind' });
  });

  it('空白后的 @ 触发', () => {
    expect(getMentionContext('看下 @sty', 7)).toEqual({ start: 3, query: 'sty' });
    expect(getMentionContext('a\n@x', 4)).toEqual({ start: 2, query: 'x' });
  });

  it('紧贴文字的 @ 不触发（如邮箱）', () => {
    expect(getMentionContext('a@b', 3)).toBeNull();
  });

  it('token 内出现空白后不再触发', () => {
    expect(getMentionContext('@foo bar', 8)).toBeNull();
  });

  it('光标不在 token 内不触发', () => {
    expect(getMentionContext('hello', 5)).toBeNull();
    expect(getMentionContext('@foo', 0)).toBeNull();
  });
});

describe('filterMentionFiles', () => {
  const files = ['index.html', 'src/app.tsx', 'src/index.css', 'docs/readme.md', 'uploads/logo.png'];

  it('空查询返回前 limit 条', () => {
    expect(filterMentionFiles(files, '', 3)).toEqual(files.slice(0, 3));
  });

  it('文件名前缀优先于路径包含', () => {
    expect(filterMentionFiles(files, 'index')).toEqual(['index.html', 'src/index.css']);
  });

  it('支持全路径包含与大小写不敏感', () => {
    expect(filterMentionFiles(files, 'SRC')).toEqual(['src/app.tsx', 'src/index.css']);
  });

  it('支持子序列兜底匹配', () => {
    expect(filterMentionFiles(files, 'dcrm')).toEqual(['docs/readme.md']);
  });

  it('无匹配返回空', () => {
    expect(filterMentionFiles(files, 'zzz')).toEqual([]);
  });
});

describe('applyMention', () => {
  it('替换 @token 为 @path 并补尾随空格', () => {
    const result = applyMention('看下 @sty 的问题', { start: 3, query: 'sty' }, 7, 'src/style.css');
    expect(result.text).toBe('看下 @src/style.css  的问题');
    expect(result.caret).toBe(3 + '@src/style.css '.length);
  });

  it('空 query 直接插入', () => {
    const result = applyMention('@', { start: 0, query: '' }, 1, 'index.html');
    expect(result.text).toBe('@index.html ');
    expect(result.caret).toBe(12);
  });
});
