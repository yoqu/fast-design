import { describe, expect, it } from 'vitest';
import {
  applyTextEdits,
  applyTextEditToSource,
  encodeHtmlText,
  htmlTextRegions,
  reduceTextEditMessage,
} from './textEdit';

describe('reduceTextEditMessage', () => {
  it('折算 ready / state 消息', () => {
    expect(reduceTextEditMessage({ type: 'pi:edit:ready' })).toEqual({ ready: true });
    expect(reduceTextEditMessage({ type: 'pi:edit:state', active: true })).toEqual({ active: true });
    expect(reduceTextEditMessage({ type: 'pi:edit:state' })).toEqual({ active: false });
  });

  it('折算合法 commit，拒绝畸形 payload', () => {
    const commit = {
      type: 'pi:edit:commit',
      id: 'pi-edit-1',
      edits: [{ oldText: 'a', newText: 'b', occurrence: 0 }],
    };
    expect(reduceTextEditMessage(commit)).toEqual({
      commit: { id: 'pi-edit-1', edits: [{ oldText: 'a', newText: 'b', occurrence: 0 }] },
    });
    expect(reduceTextEditMessage({ type: 'pi:edit:commit', id: 'x', edits: [] })).toBeNull();
    expect(
      reduceTextEditMessage({
        type: 'pi:edit:commit',
        id: 'x',
        edits: [{ oldText: 'a', newText: 'b', occurrence: -1 }],
      }),
    ).toBeNull();
    expect(reduceTextEditMessage({ type: 'other' })).toBeNull();
    expect(reduceTextEditMessage(null)).toBeNull();
  });
});

describe('htmlTextRegions', () => {
  const text = (source: string) => htmlTextRegions(source).map((r) => source.slice(r.start, r.end));

  it('只保留元素文本内容，跳过标签与属性值', () => {
    expect(text('<p class="Hello">Hello</p>')).toEqual(['Hello']);
  });

  it('跳过注释与 script/style/textarea 原始文本，title 保留', () => {
    const source =
      '<title>Hello</title><!-- Hello --><script>var a="Hello";</script>' +
      '<style>.x{content:"Hello"}</style><textarea>Hello</textarea><p>Hello</p>';
    expect(text(source)).toEqual(['Hello', 'Hello']);
  });

  it('字面 < 按文本处理', () => {
    expect(text('<p>a < b</p>')).toEqual(['a < b']);
  });
});

describe('applyTextEditToSource', () => {
  it('raw 文本按 occurrence 替换', () => {
    const src = '<p>Hi</p><p>Hi</p>';
    expect(applyTextEditToSource(src, { oldText: 'Hi', newText: 'Yo', occurrence: 1 })).toBe(
      '<p>Hi</p><p>Yo</p>',
    );
  });

  it('属性值中的同名文本不计入 occurrence', () => {
    const src = '<img alt="Hi"><p>Hi</p>';
    expect(applyTextEditToSource(src, { oldText: 'Hi', newText: 'Yo', occurrence: 0 })).toBe(
      '<img alt="Hi"><p>Yo</p>',
    );
  });

  it('命中实体形态（&amp; / &nbsp; / 数字实体）', () => {
    expect(
      applyTextEditToSource('<p>A &amp; B</p>', { oldText: 'A & B', newText: 'A + B', occurrence: 0 }),
    ).toBe('<p>A + B</p>');
    expect(
      applyTextEditToSource('<p>A&nbsp;B</p>', { oldText: 'A\u00a0B', newText: 'AB', occurrence: 0 }),
    ).toBe('<p>AB</p>');
    expect(
      applyTextEditToSource('<p>&#20013;文</p>', { oldText: '中文', newText: '中文版', occurrence: 0 }),
    ).toBe('<p>中文版</p>');
  });

  it('newText 写入前做最小实体编码', () => {
    expect(
      applyTextEditToSource('<p>plain</p>', { oldText: 'plain', newText: 'a < b & c', occurrence: 0 }),
    ).toBe('<p>a &lt; b &amp; c</p>');
  });

  it('连续编辑：上次写入的实体形态可再次命中', () => {
    const once = applyTextEditToSource('<p>x</p>', { oldText: 'x', newText: 'a & b', occurrence: 0 });
    expect(once).toBe('<p>a &amp; b</p>');
    expect(applyTextEditToSource(once!, { oldText: 'a & b', newText: 'done', occurrence: 0 })).toBe(
      '<p>done</p>',
    );
  });

  it('定位失败返回 null（脚本渲染文本/空 oldText/occurrence 越界）', () => {
    expect(
      applyTextEditToSource('<div id="app"></div>', { oldText: 'Hi', newText: 'Yo', occurrence: 0 }),
    ).toBeNull();
    expect(applyTextEditToSource('<p>Hi</p>', { oldText: '', newText: 'Yo', occurrence: 0 })).toBeNull();
    expect(applyTextEditToSource('<p>Hi</p>', { oldText: 'Hi', newText: 'Yo', occurrence: 1 })).toBeNull();
  });
});

describe('applyTextEdits', () => {
  it('原子：任一 op 失败整体返回 null', () => {
    expect(
      applyTextEdits('<p>a</p>', [
        { oldText: 'a', newText: 'b', occurrence: 0 },
        { oldText: 'missing', newText: 'x', occurrence: 0 },
      ]),
    ).toBeNull();
  });

  it('同文案多 op 按 occurrence 降序应用，序号不漂移', () => {
    expect(
      applyTextEdits('<li>x</li><li>x</li><li>x</li>', [
        { oldText: 'x', newText: 'first', occurrence: 0 },
        { oldText: 'x', newText: 'third', occurrence: 2 },
      ]),
    ).toBe('<li>first</li><li>x</li><li>third</li>');
  });
});

describe('encodeHtmlText', () => {
  it('编码 & < >', () => {
    expect(encodeHtmlText('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });
});
