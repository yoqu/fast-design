import { describe, expect, it } from 'vitest';
import {
  applyTextEditAtLoc,
  applyTextEdits,
  applyTextEditToSource,
  encodeHtmlText,
  htmlScriptSources,
  htmlTextRegions,
  planTextEdits,
  reduceTextEditMessage,
  resolveLocSource,
  resolveScriptPath,
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

describe('htmlScriptSources', () => {
  it('提取内联脚本内容区间与外部 src', () => {
    const source =
      '<script src="Icon.jsx" type="text/babel"></script>' +
      '<script type="text/babel">render("内联文案");</script>' +
      '<p>正文</p>';
    const info = htmlScriptSources(source);
    expect(info.srcs).toEqual(['Icon.jsx']);
    expect(info.inline.map((r) => source.slice(r.start, r.end))).toEqual(['render("内联文案");']);
  });

  it('注释中的 script 不计入，data-src 不当作 src', () => {
    const source = '<!-- <script src="a.js"></script> --><script data-src="b.js">x();</script>';
    const info = htmlScriptSources(source);
    expect(info.srcs).toEqual([]);
    expect(info.inline.map((r) => source.slice(r.start, r.end))).toEqual(['x();']);
  });

  it('脚本原始内容中的标签字面量不打断区间', () => {
    const source = '<script>var s = "<p>不是标签</p>";</script>';
    const info = htmlScriptSources(source);
    expect(info.inline.map((r) => source.slice(r.start, r.end))).toEqual([
      'var s = "<p>不是标签</p>";',
    ]);
  });
});

describe('resolveScriptPath', () => {
  it('相对路径按 HTML 所在目录解析', () => {
    expect(resolveScriptPath('volunteer/page.html', 'Icon.jsx')).toBe('volunteer/Icon.jsx');
    expect(resolveScriptPath('volunteer/page.html', 'assets/icons.js')).toBe(
      'volunteer/assets/icons.js',
    );
    expect(resolveScriptPath('a/b.html', '../c.js')).toBe('c.js');
    expect(resolveScriptPath('page.html', 'app.jsx')).toBe('app.jsx');
  });

  it('根路径相对项目根，query/hash 剥离', () => {
    expect(resolveScriptPath('a/b.html', '/lib/x.js')).toBe('lib/x.js');
    expect(resolveScriptPath('a/b.html', 'x.js?v=1#top')).toBe('a/x.js');
  });

  it('外部 URL 与越界路径返回 null', () => {
    expect(resolveScriptPath('a/b.html', 'https://unpkg.com/react.js')).toBeNull();
    expect(resolveScriptPath('a/b.html', '//cdn.example.com/x.js')).toBeNull();
    expect(resolveScriptPath('a/b.html', 'data:text/javascript,1')).toBeNull();
    expect(resolveScriptPath('a/b.html', '../../x.js')).toBeNull();
  });
});

describe('planTextEdits', () => {
  const op = (oldText: string, newText: string, occurrence = 0) => ({
    oldText,
    newText,
    occurrence,
  });

  it('HTML 文本区域命中时与 applyTextEdits 等价，不动脚本', () => {
    const plan = planTextEdits('<p>标题</p>', [{ path: 'a.jsx', content: 'x("标题")' }], [
      op('标题', '新标题'),
    ]);
    expect(plan).toEqual({ ok: true, html: '<p>新标题</p>', files: [] });
  });

  it('HTML 未命中时在外部脚本中唯一定位并替换（occurrence 不参与）', () => {
    const plan = planTextEdits(
      '<div id="root"></div>',
      [{ path: 'a.jsx', content: '<h1>社区探访活动</h1>' }],
      [op('社区探访活动', '社区探访·五月', 2)],
    );
    expect(plan).toEqual({
      ok: true,
      html: '<div id="root"></div>',
      files: [{ path: 'a.jsx', content: '<h1>社区探访·五月</h1>' }],
    });
  });

  it('内联 babel 脚本中唯一定位并替换，原文写回不做实体编码', () => {
    const html = '<div id="root"></div><script type="text/babel">title("志愿者 A 队");</script>';
    const plan = planTextEdits(html, [], [op('志愿者 A 队', '志愿者 A & B 队')]);
    expect(plan).toEqual({
      ok: true,
      html: '<div id="root"></div><script type="text/babel">title("志愿者 A & B 队");</script>',
      files: [],
    });
  });

  it('混合提交：HTML op 与脚本 op 各归其位且原子成功', () => {
    const plan = planTextEdits(
      '<h1>静态标题</h1><div id="root"></div>',
      [{ path: 'a.jsx', content: 'label("动态文案")' }],
      [op('静态标题', '新静态标题'), op('动态文案', '新动态文案')],
    );
    expect(plan).toEqual({
      ok: true,
      html: '<h1>新静态标题</h1><div id="root"></div>',
      files: [{ path: 'a.jsx', content: 'label("新动态文案")' }],
    });
  });

  it('全部未命中报 not-found', () => {
    const plan = planTextEdits('<div></div>', [{ path: 'a.jsx', content: 'x()' }], [
      op('不存在', '新'),
    ]);
    expect(plan).toEqual({ ok: false, reason: 'not-found' });
  });

  it('脚本中多处命中报 ambiguous', () => {
    const plan = planTextEdits(
      '<div></div>',
      [
        { path: 'a.jsx', content: 'x("报名")' },
        { path: 'b.jsx', content: 'y("报名")' },
      ],
      [op('报名', '立即报名')],
    );
    expect(plan).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('newText 引入脚本危险字符报 unsafe', () => {
    const plan = planTextEdits('<div></div>', [{ path: 'a.jsx', content: 'x("文案")' }], [
      op('文案', "文'案"),
    ]);
    expect(plan).toEqual({ ok: false, reason: 'unsafe' });
  });

  it('oldText 已含同类字符时 newText 可沿用', () => {
    const plan = planTextEdits('<div></div>', [{ path: 'a.jsx', content: "x(\"A 'B' C\")" }], [
      op("A 'B' C", "A 'BB' C"),
    ]);
    expect(plan).toEqual({
      ok: true,
      html: '<div></div>',
      files: [{ path: 'a.jsx', content: "x(\"A 'BB' C\")" }],
    });
  });
});

describe('reduceTextEditMessage loc 字段', () => {
  const commitWith = (loc: unknown) => ({
    type: 'pi:edit:commit',
    id: 'x',
    edits: [{ oldText: 'a', newText: 'b', occurrence: 0, loc }],
  });

  it('合法 loc 透传', () => {
    const loc = { source: 'http://h/preview/s/a.jsx', line: 3, column: 2, occurrence: 0 };
    expect(reduceTextEditMessage(commitWith(loc))).toEqual({
      commit: { id: 'x', edits: [{ oldText: 'a', newText: 'b', occurrence: 0, loc }] },
    });
  });

  it('畸形 loc 丢弃但保留 op', () => {
    for (const bad of [
      { source: 'a.jsx', line: 0, column: 0, occurrence: 0 },
      { source: 42, line: 1, column: 0, occurrence: 0 },
      { source: 'a.jsx', line: 1, column: -1, occurrence: 0 },
      'nonsense',
    ]) {
      expect(reduceTextEditMessage(commitWith(bad))).toEqual({
        commit: { id: 'x', edits: [{ oldText: 'a', newText: 'b', occurrence: 0 }] },
      });
    }
  });
});

describe('resolveLocSource', () => {
  const scope = 'abcdef0123456789abcdef0123456789';

  it('preview URL 还原为项目相对路径（含中文解码与 query 剥离）', () => {
    expect(
      resolveLocSource(`http://localhost:4400/api/projects/p1/preview/${scope}/volunteer/Icon.jsx`),
    ).toEqual({ kind: 'file', path: 'volunteer/Icon.jsx' });
    expect(
      resolveLocSource(`http://h/api/projects/p1/preview/${scope}/v/%E9%BA%93.jsx?bridge=edit`),
    ).toEqual({ kind: 'file', path: 'v/麓.jsx' });
  });

  it('内联 babel 脚本按编号解析（首个无编号）', () => {
    expect(resolveLocSource('Inline Babel script')).toEqual({ kind: 'inline', index: 1 });
    expect(resolveLocSource('Inline Babel script (3)')).toEqual({ kind: 'inline', index: 3 });
  });

  it('无法识别的 source 返回 null', () => {
    expect(resolveLocSource('whatever.js')).toBeNull();
    expect(resolveLocSource('')).toBeNull();
  });
});

describe('htmlScriptSources inline type', () => {
  it('内联条目带 type（小写，无则空串）', () => {
    const source = '<script type="text/babel">a()</script><script>b()</script>';
    expect(htmlScriptSources(source).inline.map((r) => r.type)).toEqual(['text/babel', '']);
  });
});

describe('applyTextEditAtLoc', () => {
  const at = (line: number, column: number, occurrence = 0) => ({
    source: 'x',
    line,
    column,
    occurrence,
  });

  it('从 loc 偏移起替换第一个匹配，loc 之前的同名文本不受影响', () => {
    const content = 'x("报名")\nrender(<button>报名</button>)';
    expect(
      applyTextEditAtLoc(content, { oldText: '报名', newText: '立即报名', occurrence: 0, loc: at(2, 7) }),
    ).toBe('x("报名")\nrender(<button>立即报名</button>)');
  });

  it('occurrence 在 loc 之后的匹配序列里对位', () => {
    const content = '<li>报名</li>\n<ul><li>报名</li><li>报名</li></ul>';
    expect(
      applyTextEditAtLoc(content, { oldText: '报名', newText: '改', occurrence: 1, loc: at(2, 0, 1) }),
    ).toBe('<li>报名</li>\n<ul><li>报名</li><li>改</li></ul>');
  });

  it('行越界 / loc 后无匹配返回 null', () => {
    expect(
      applyTextEditAtLoc('a\nb', { oldText: 'a', newText: 'c', occurrence: 0, loc: at(9, 0) }),
    ).toBeNull();
    expect(
      applyTextEditAtLoc('报名\nx', { oldText: '报名', newText: 'c', occurrence: 0, loc: at(2, 0) }),
    ).toBeNull();
  });
});

describe('planTextEdits with loc', () => {
  const scope = 'abcdef0123456789abcdef0123456789';
  const fileSource = (path: string) =>
    `http://localhost:4400/api/projects/p1/preview/${scope}/${path}`;
  const op = (
    oldText: string,
    newText: string,
    loc?: { source: string; line: number; column: number; occurrence: number },
  ) => ({ oldText, newText, occurrence: 0, ...(loc ? { loc } : {}) });
  const loc = (source: string, line: number, column: number, occurrence = 0) => ({
    source,
    line,
    column,
    occurrence,
  });

  it('多文件重复文案靠 loc 精确落位（附录 A 的 ambiguous 场景）', () => {
    const plan = planTextEdits(
      '<div id="root"></div>',
      [
        { path: 'a.jsx', content: '<h1>社区环保</h1>' },
        { path: 'b.jsx', content: '<h2>社区环保</h2>' },
      ],
      [op('社区环保', '环保行动', loc(fileSource('b.jsx'), 1, 0))],
    );
    expect(plan).toEqual({
      ok: true,
      html: '<div id="root"></div>',
      files: [{ path: 'b.jsx', content: '<h2>环保行动</h2>' }],
    });
  });

  it('loc 指向第 N 个内联 babel 脚本（经典脚本不计数）', () => {
    const html =
      '<script>classic()</script>' +
      '<script type="text/babel">one("文案")</script>' +
      '<script type="text/babel">two("文案")</script>';
    const plan = planTextEdits(html, [], [
      op('文案', '新文案', loc('Inline Babel script (2)', 1, 0)),
    ]);
    expect(plan).toEqual({
      ok: true,
      html:
        '<script>classic()</script>' +
        '<script type="text/babel">one("文案")</script>' +
        '<script type="text/babel">two("新文案")</script>',
      files: [],
    });
  });

  it('loc 优先于 HTML 文本区域的同名静态文本', () => {
    const plan = planTextEdits(
      '<p>报名</p><div id="root"></div>',
      [{ path: 'a.jsx', content: 'x("报名")' }],
      [op('报名', '立即报名', loc(fileSource('a.jsx'), 1, 0))],
    );
    expect(plan).toEqual({
      ok: true,
      html: '<p>报名</p><div id="root"></div>',
      files: [{ path: 'a.jsx', content: 'x("立即报名")' }],
    });
  });

  it('loc 解析失败回落唯一匹配链路', () => {
    const plan = planTextEdits('<div></div>', [{ path: 'a.jsx', content: 'x("文案")' }], [
      op('文案', '新文案', loc('unknown-source', 1, 0)),
    ]);
    expect(plan).toEqual({
      ok: true,
      html: '<div></div>',
      files: [{ path: 'a.jsx', content: 'x("新文案")' }],
    });
  });

  it('同文件多个 loc op 按偏移降序应用不漂移', () => {
    const content = '<h1>标题甲</h1>\n<h2>标题乙</h2>';
    const plan = planTextEdits(
      '<div></div>',
      [{ path: 'a.jsx', content }],
      [
        op('标题甲', '很长很长的新标题甲', loc(fileSource('a.jsx'), 1, 0)),
        op('标题乙', '新标题乙', loc(fileSource('a.jsx'), 2, 0)),
      ],
    );
    expect(plan).toEqual({
      ok: true,
      html: '<div></div>',
      files: [{ path: 'a.jsx', content: '<h1>很长很长的新标题甲</h1>\n<h2>新标题乙</h2>' }],
    });
  });

  it('loc 命中但 newText 危险字符报 unsafe', () => {
    const plan = planTextEdits('<div></div>', [{ path: 'a.jsx', content: 'x("文案")' }], [
      op('文案', '文"案', loc(fileSource('a.jsx'), 1, 0)),
    ]);
    expect(plan).toEqual({ ok: false, reason: 'unsafe' });
  });
});
