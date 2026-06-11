# 预览可视化文案编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在右侧 HTML 预览 iframe 中点选文本就地编辑文案，并写回源 HTML 文件（含撤销、错误还原、reload 冻结）。

**Architecture:** daemon 在预览 HTML 响应中按 `?bridge=edit` 注入文案编辑 bridge（与 snapshot bridge 同机制）；bridge 上报 `{oldText,newText,occurrence}`；web 端纯逻辑层 `textEdit.ts` 用「HTML 文本区域掩码 + 宽松正则」在源码中定位第 n 处并替换；FileViewer 串行提交队列调用既有 `readFile/putFile`，编辑期间冻结 SSE 触发的 iframe 重载，撤销用整文件快照。

**Tech Stack:** Express + TS（server）、React 19 + Tailwind v4 + Vite（web）、vitest。

Spec: `docs/superpowers/specs/2026-06-11-visual-text-edit-design.md`

---

### Task 1: server 端文案编辑 bridge（TDD）

**Files:**
- Modify: `server/src/bridges.ts`（文件末尾追加）
- Modify: `server/src/index.ts:484-495`（预览路由 HTML 分支）
- Test: `server/src/bridges.test.ts`

- [x] **Step 1: 写失败测试**（追加到 `server/src/bridges.test.ts`，import 行同步加 `injectTextEditBridge, wantsTextEditBridge`）

```ts
describe('wantsTextEditBridge', () => {
  it('accepts edit/text-edit/text tokens in comma or space separated lists', () => {
    expect(wantsTextEditBridge('edit')).toBe(true);
    expect(wantsTextEditBridge('text-edit')).toBe(true);
    expect(wantsTextEditBridge('snapshot,edit')).toBe(true);
    expect(wantsTextEditBridge(['snapshot', 'text'])).toBe(true);
    expect(wantsTextEditBridge('snapshot')).toBe(false);
    expect(wantsTextEditBridge(undefined)).toBe(false);
  });
});

describe('injectTextEditBridge', () => {
  it('injects before </body> when present', () => {
    const out = injectTextEditBridge('<html><body><h1>hi</h1></body></html>');
    expect(out).toContain('data-pi-text-edit-bridge');
    expect(out.indexOf('data-pi-text-edit-bridge')).toBeLessThan(out.indexOf('</body>'));
  });

  it('is idempotent and coexists with the snapshot bridge', () => {
    const once = injectTextEditBridge(injectSnapshotBridge('<body></body>'));
    expect(injectTextEditBridge(once)).toBe(once);
    expect(once).toContain('data-od-url-snapshot-bridge');
    expect(once).toContain('data-pi-text-edit-bridge');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm -C server exec vitest run src/bridges.test.ts`
Expected: FAIL（`wantsTextEditBridge` 未导出）

- [x] **Step 3: 实现 bridge 脚本与 helpers**（追加到 `server/src/bridges.ts` 末尾；注意：TS 模板字符串内正则反斜杠需双写）

```ts
// 文案编辑 bridge（本项目自研，协议见
// docs/superpowers/specs/2026-06-11-visual-text-edit-design.md）：
// 宿主 postMessage pi:edit:activate/deactivate 控制；点选含直接文本的元素
// 进入 plaintext-only 就地编辑；提交时上报各文本节点的
// {oldText,newText,occurrence}，occurrence 为文档顺序中同值文本节点的序号；
// 宿主回 pi:edit:result {id,ok}，失败则还原 DOM。
const URL_PREVIEW_TEXT_EDIT_BRIDGE = `<script data-pi-text-edit-bridge>
(function(){
  if (window.__piTextEditBridge) return;
  window.__piTextEditBridge = true;
  var active = false;
  var hoverEl = null;
  var session = null;
  var pending = {};
  var seq = 0;
  function isSkippable(el){
    var tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    return tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'textarea';
  }
  function hasText(value){ return /\\S/.test(value || ''); }
  function hasDirectText(el){
    for (var n = el.firstChild; n; n = n.nextSibling){
      if (n.nodeType === 3 && hasText(n.nodeValue)) return true;
    }
    return false;
  }
  function editableFrom(target){
    var el = target && target.nodeType === 3 ? target.parentElement : target;
    while (el && el.nodeType === 1){
      if (isSkippable(el)) return null;
      if (hasDirectText(el)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function walkTextNodes(fn){
    var walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())){
      var p = n.parentElement;
      if (!p || isSkippable(p)) continue;
      if (!hasText(n.nodeValue)) continue;
      fn(n);
    }
  }
  function snapshotRecords(el){
    var targets = [];
    var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var t;
    while ((t = tw.nextNode())){
      var p = t.parentElement;
      if (!p || isSkippable(p)) continue;
      if (!hasText(t.nodeValue)) continue;
      targets.push(t);
    }
    var records = [];
    var counts = Object.create(null);
    walkTextNodes(function(n){
      var key = n.nodeValue;
      var idx = counts[key] || 0;
      counts[key] = idx + 1;
      if (targets.indexOf(n) !== -1) records.push({ node: n, value: n.nodeValue, occurrence: idx });
    });
    return records;
  }
  function ensureStyle(){
    if (document.querySelector('style[data-pi-text-edit-style]')) return;
    var st = document.createElement('style');
    st.setAttribute('data-pi-text-edit-style', '');
    st.textContent = '[data-pi-edit-hover]{outline:2px dashed #3b82f6 !important;outline-offset:2px;cursor:text}' +
      '[data-pi-edit-active]{outline:2px solid #2563eb !important;outline-offset:2px}';
    (document.head || document.documentElement).appendChild(st);
  }
  function clearHover(){
    if (hoverEl){ hoverEl.removeAttribute('data-pi-edit-hover'); hoverEl = null; }
  }
  function restoreRecords(records){
    for (var i = 0; i < records.length; i++){
      try { records[i].node.nodeValue = records[i].value; } catch (_) {}
    }
  }
  function finishEdit(commit){
    if (!session) return;
    var s = session;
    session = null;
    s.el.removeEventListener('keydown', onKeydown);
    s.el.removeEventListener('blur', onBlur);
    if (s.prevEditable === null) s.el.removeAttribute('contenteditable');
    else s.el.setAttribute('contenteditable', s.prevEditable);
    if (s.prevSpellcheck === null) s.el.removeAttribute('spellcheck');
    else s.el.setAttribute('spellcheck', s.prevSpellcheck);
    s.el.removeAttribute('data-pi-edit-active');
    if (!commit){
      restoreRecords(s.records);
      return;
    }
    var edits = [];
    for (var i = 0; i < s.records.length; i++){
      var r = s.records[i];
      var current = r.node.parentNode ? r.node.nodeValue : '';
      if (current !== r.value) edits.push({ oldText: r.value, newText: current, occurrence: r.occurrence });
    }
    if (!edits.length) return;
    var id = 'pi-edit-' + (++seq);
    pending[id] = s.records;
    window.parent.postMessage({ type: 'pi:edit:commit', id: id, edits: edits }, '*');
  }
  function onKeydown(ev){
    if (!session) return;
    if (ev.key === 'Enter' && !ev.shiftKey){
      ev.preventDefault();
      var el = session.el;
      finishEdit(true);
      try { el.blur(); } catch (_) {}
    } else if (ev.key === 'Escape'){
      ev.preventDefault();
      var el2 = session.el;
      finishEdit(false);
      try { el2.blur(); } catch (_) {}
    }
  }
  function onBlur(){ finishEdit(true); }
  function beginEdit(el, ev){
    var records = snapshotRecords(el);
    if (!records.length) return;
    clearHover();
    session = {
      el: el,
      records: records,
      prevEditable: el.getAttribute('contenteditable'),
      prevSpellcheck: el.getAttribute('spellcheck')
    };
    el.setAttribute('data-pi-edit-active', '');
    try { el.setAttribute('contenteditable', 'plaintext-only'); } catch (_) {}
    if (!el.isContentEditable) el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('blur', onBlur);
    el.focus();
    try {
      var range = null;
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
      else if (document.caretPositionFromPoint){
        var pos = document.caretPositionFromPoint(ev.clientX, ev.clientY);
        if (pos){
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
      if (range){
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) {}
  }
  function onOver(ev){
    var el = editableFrom(ev.target);
    if (hoverEl === el) return;
    clearHover();
    if (el && (!session || session.el !== el)){
      el.setAttribute('data-pi-edit-hover', '');
      hoverEl = el;
    }
  }
  function onOut(){ clearHover(); }
  function onClick(ev){
    if (session && session.el.contains(ev.target)) return;
    var el = editableFrom(ev.target);
    if (!el){
      if (session) finishEdit(true);
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (session) finishEdit(true);
    beginEdit(el, ev);
  }
  function activate(){
    if (active) return;
    active = true;
    ensureStyle();
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('click', onClick, true);
    window.parent.postMessage({ type: 'pi:edit:state', active: true }, '*');
  }
  function deactivate(){
    if (!active) return;
    active = false;
    finishEdit(true);
    clearHover();
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('click', onClick, true);
    window.parent.postMessage({ type: 'pi:edit:state', active: false }, '*');
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'pi:edit:activate') activate();
    else if (data.type === 'pi:edit:deactivate') deactivate();
    else if (data.type === 'pi:edit:result' && data.id){
      var records = pending[data.id];
      delete pending[data.id];
      if (records && data.ok !== true) restoreRecords(records);
    }
  });
  window.parent.postMessage({ type: 'pi:edit:ready' }, '*');
})();
</script>`;

export function wantsTextEditBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some(
    (token) => token === 'edit' || token === 'text-edit' || token === 'text',
  );
}

export function injectTextEditBridge(html: string): string {
  return injectBeforeBodyClose(html, 'data-pi-text-edit-bridge', URL_PREVIEW_TEXT_EDIT_BRIDGE);
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm -C server exec vitest run src/bridges.test.ts`
Expected: PASS（全部用例）

- [x] **Step 5: 接入预览路由**（`server/src/index.ts` 预览正则路由内，替换现有 `const isHtml ...` 起的 HTML 分支；import 行加 `injectTextEditBridge, wantsTextEditBridge`）

```ts
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
```

- [x] **Step 6: server 全量测试 + 提交**

Run: `pnpm -C server test && pnpm -C server build`
Expected: PASS / 无类型错误

```bash
git add server/src/bridges.ts server/src/bridges.test.ts server/src/index.ts
git commit -m "feat(server): 预览文案编辑 bridge 注入（?bridge=edit）"
```

---

### Task 2: web 纯逻辑层 textEdit.ts（TDD）

**Files:**
- Create: `web/src/lib/textEdit.ts`
- Test: `web/src/lib/textEdit.test.ts`

- [x] **Step 1: 写失败测试**（新建 `web/src/lib/textEdit.test.ts`）

```ts
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
      reduceTextEditMessage({ type: 'pi:edit:commit', id: 'x', edits: [{ oldText: 'a', newText: 'b', occurrence: -1 }] }),
    ).toBeNull();
    expect(reduceTextEditMessage({ type: 'other' })).toBeNull();
    expect(reduceTextEditMessage(null)).toBeNull();
  });
});

describe('htmlTextRegions', () => {
  const text = (source: string) =>
    htmlTextRegions(source).map((r) => source.slice(r.start, r.end));

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
      applyTextEditToSource('<p>A&nbsp;B</p>', { oldText: 'A B', newText: 'AB', occurrence: 0 }),
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
    const once = applyTextEditToSource('<p>x</p>', { oldText: 'x', newText: 'a & b', occurrence: 0 })!;
    expect(once).toBe('<p>a &amp; b</p>');
    expect(applyTextEditToSource(once, { oldText: 'a & b', newText: 'done', occurrence: 0 })).toBe(
      '<p>done</p>',
    );
  });

  it('定位失败返回 null（脚本渲染文本/空 oldText/occurrence 越界）', () => {
    expect(applyTextEditToSource('<div id="app"></div>', { oldText: 'Hi', newText: 'Yo', occurrence: 0 })).toBeNull();
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
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm -C web exec vitest run src/lib/textEdit.test.ts`
Expected: FAIL（模块不存在）

- [x] **Step 3: 实现**（新建 `web/src/lib/textEdit.ts`）

```ts
// 预览可视化文案编辑的纯函数层（设计见
// docs/superpowers/specs/2026-06-11-visual-text-edit-design.md），与
// FileViewer 的 React 状态/副作用解耦，便于测试（仿 tweaks.ts 分层）。
//
// 回写思路：bridge 上报 DOM 文本节点的 {oldText,newText,occurrence}（occurrence
// 为文档顺序中同值文本节点的序号），宿主在源码里用「文本区域掩码 + 宽松正则」
// 找到第 occurrence 个匹配并替换。掩码保证属性值/脚本字符串里的同名文本不参与
// 计数；宽松正则同时涵盖 raw 与实体编码形态，避免多策略在混合编码下选错序号。

export interface TextEditOp {
  oldText: string;
  newText: string;
  occurrence: number;
}

export interface TextEditCommit {
  id: string;
  edits: TextEditOp[];
}

export interface TextEditAction {
  ready?: true;
  active?: boolean;
  commit?: TextEditCommit;
}

/** 把 bridge → 宿主的 postMessage 折算成动作；非本协议消息返回 null。 */
export function reduceTextEditMessage(data: unknown): TextEditAction | null {
  if (!data || typeof data !== 'object') return null;
  const type = (data as { type?: unknown }).type;
  if (type === 'pi:edit:ready') return { ready: true };
  if (type === 'pi:edit:state') return { active: (data as { active?: unknown }).active === true };
  if (type === 'pi:edit:commit') {
    const { id, edits } = data as { id?: unknown; edits?: unknown };
    if (typeof id !== 'string' || !Array.isArray(edits) || edits.length === 0) return null;
    const ops: TextEditOp[] = [];
    for (const item of edits) {
      if (!item || typeof item !== 'object') return null;
      const { oldText, newText, occurrence } = item as Record<string, unknown>;
      if (typeof oldText !== 'string' || typeof newText !== 'string') return null;
      if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 0) return null;
      ops.push({ oldText, newText, occurrence });
    }
    return { commit: { id, edits: ops } };
  }
  return null;
}

/** 写回源码时的最小实体编码，保证替换文本不破坏 HTML 结构。 */
export function encodeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 原始文本元素：内容不会成为可编辑文本节点（noscript 在启用脚本的预览里
// 同样按原始文本解析），与 bridge 的 isSkippable 口径一致。
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'noscript']);

/**
 * 扫出源码中「元素文本内容」区间：跳过标签内部（含引号属性值）、注释、
 * <!doctype> 声明与 RAW_TEXT_TAGS 的原始内容；title 内容保留（DOM 里它是
 * 文本节点，与 bridge 的 occurrence 计数口径一致）。'<' 后面不是字母/'!'/'/'
 * 时按浏览器容错语义视为普通文本。
 */
export function htmlTextRegions(source: string): Array<{ start: number; end: number }> {
  const regions: Array<{ start: number; end: number }> = [];
  const len = source.length;
  let i = 0;
  let textStart = 0;
  const closeText = (end: number) => {
    if (end > textStart) regions.push({ start: textStart, end });
  };
  while (i < len) {
    if (source[i] !== '<') {
      i++;
      continue;
    }
    const next = source[i + 1] ?? '';
    if (next === '!') {
      closeText(i);
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        i = end === -1 ? len : end + 3;
      } else {
        const gt = source.indexOf('>', i);
        i = gt === -1 ? len : gt + 1;
      }
      textStart = i;
      continue;
    }
    const tagMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(source.slice(i, i + 64));
    if (!tagMatch) {
      i++; // 字面 '<'
      continue;
    }
    closeText(i);
    let j = i + 1;
    let quote: '"' | "'" | null = null;
    while (j < len) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    i = j >= len ? len : j + 1;
    const tagName = tagMatch[2].toLowerCase();
    if (!tagMatch[1] && RAW_TEXT_TAGS.has(tagName)) {
      const close = new RegExp(`</${tagName}[\\s/>]`, 'i').exec(source.slice(i));
      i = close ? i + close.index : len;
    }
    textStart = i;
  }
  closeText(len);
  return regions;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 十六进制数字实体的大小写容忍模式，如 0xa0 → "[aA]0"。 */
function hexPattern(cp: number): string {
  let out = '';
  for (const c of cp.toString(16)) out += /[a-f]/.test(c) ? `[${c}${c.toUpperCase()}]` : c;
  return out;
}

function charPattern(ch: string): string {
  if (ch === '&') return '(?:&amp;|&#38;|&)';
  if (ch === '<') return '(?:&lt;|&#60;|<)';
  if (ch === '>') return '(?:&gt;|&#62;|>)';
  if (ch === '"') return '(?:&quot;|&#34;|")';
  if (ch === "'") return "(?:&#39;|&apos;|')";
  if (ch === ' ') return '(?:&nbsp;|&#160;|&#[xX]0*[aA]0;| )';
  if (ch === '\n') return '(?:\\r?\\n|&#10;|&#[xX]0*[aA];)';
  const cp = ch.codePointAt(0) ?? 0;
  if (cp > 127) return `(?:${escapeRegExp(ch)}|&#${cp};|&#[xX]0*${hexPattern(cp)};)`;
  return escapeRegExp(ch);
}

/** 同时匹配 raw 与实体编码形态的宽松正则。 */
function buildTolerantPattern(oldText: string): RegExp {
  let pattern = '';
  for (const ch of oldText) pattern += charPattern(ch);
  return new RegExp(pattern, 'g');
}

/**
 * 在源码文本区间内找 oldText 的第 occurrence 个匹配并替换为编码后的
 * newText；定位失败（脚本渲染文本、序号越界等）返回 null。
 */
export function applyTextEditToSource(source: string, op: TextEditOp): string | null {
  if (!op.oldText) return null;
  const regions = htmlTextRegions(source);
  const re = buildTolerantPattern(op.oldText);
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    if (!regions.some((r) => start >= r.start && end <= r.end)) continue;
    if (index === op.occurrence) {
      return source.slice(0, start) + encodeHtmlText(op.newText) + source.slice(end);
    }
    index++;
  }
  return null;
}

/**
 * 原子地应用一组编辑：任一失败返回 null。同 oldText 的 op 按 occurrence
 * 降序应用，先替换靠后的匹配，避免前面的替换使后续序号偏移。
 */
export function applyTextEdits(source: string, edits: TextEditOp[]): string | null {
  const ordered = edits
    .map((op, order) => ({ op, order }))
    .sort((a, b) =>
      a.op.oldText === b.op.oldText ? b.op.occurrence - a.op.occurrence : a.order - b.order,
    )
    .map((item) => item.op);
  let current = source;
  for (const op of ordered) {
    const next = applyTextEditToSource(current, op);
    if (next === null) return null;
    current = next;
  }
  return current;
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm -C web exec vitest run src/lib/textEdit.test.ts`
Expected: PASS（全部用例）

- [x] **Step 5: 提交**

```bash
git add web/src/lib/textEdit.ts web/src/lib/textEdit.test.ts
git commit -m "feat(web): 文案编辑纯逻辑层（消息折算 + 文本区域掩码 + 宽松正则回写）"
```

---

### Task 3: FileViewer 宿主集成

**Files:**
- Modify: `web/src/components/FileViewer.tsx`

无组件单测先例，本任务靠 tsc/build + Task 4 手动验证。

- [x] **Step 1: 引入依赖与状态**

import 区加：

```ts
import { applyTextEdits, reduceTextEditMessage, type TextEditCommit } from '../lib/textEdit';
```

组件内（tweaks 状态之后）加：

```ts
  // 可视化文案编辑（设计 docs/superpowers/specs/2026-06-11-visual-text-edit-design.md）：
  // 开关控制 iframe 内 bridge；提交经串行队列 readFile→applyTextEdits→putFile；
  // 编辑期间冻结外部 reloadKey（保存触发的 SSE 重载会丢滚动位置），退出时再同步；
  // 撤销用提交前整文件快照 + localReload 重载。
  const isHtmlFile = /\.html?$/i.test(file);
  const [textEditOn, setTextEditOn] = useState(false);
  const [textEditStatus, setTextEditStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });
  const [undoCount, setUndoCount] = useState(0);
  const [frozenReloadKey, setFrozenReloadKey] = useState(reloadKey);
  const textEditOnRef = useRef(false);
  const undoStackRef = useRef<string[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
```

- [x] **Step 2: reload 冻结 + 文件切换重置**

```ts
  useEffect(() => {
    textEditOnRef.current = textEditOn;
  }, [textEditOn]);

  // 编辑模式下不透传外部 reloadKey（保存自身会触发 SSE 重载），退出时同步。
  useEffect(() => {
    if (!textEditOn) setFrozenReloadKey(reloadKey);
  }, [reloadKey, textEditOn]);

  // 切文件/项目退出编辑态并清撤销栈（快照只对当前文件有效）。
  useEffect(() => {
    setTextEditOn(false);
    setTextEditStatus({ kind: 'idle' });
    undoStackRef.current = [];
    setUndoCount(0);
  }, [projectId, file]);

  useEffect(() => {
    if (textEditStatus.kind !== 'saved') return;
    const timer = setTimeout(() => setTextEditStatus({ kind: 'idle' }), 2500);
    return () => clearTimeout(timer);
  }, [textEditStatus]);
```

previewUrl effect 的依赖里 `reloadKey` 改为 `frozenReloadKey`，URL 改带 edit token：

```ts
        setPreviewUrl(`${data.url}?bridge=${isHtmlFile ? 'snapshot,edit' : 'snapshot'}`);
```

（依赖数组：`[projectId, file, frozenReloadKey, localReload, isHtmlFile]`）

`iframeKey` 同步改：

```ts
  const iframeKey = `${previewUrl ?? ''}:${frozenReloadKey}:${localReload}`;
```

- [x] **Step 3: 提交管道与撤销**

```ts
  const handleTextEditCommit = useCallback(
    (frame: Window, commit: TextEditCommit) => {
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        setTextEditStatus({ kind: 'saving' });
        try {
          const source = await api.readFile(projectId, file);
          const next = applyTextEdits(source, commit.edits);
          if (next === null) {
            frame.postMessage({ type: 'pi:edit:result', id: commit.id, ok: false }, '*');
            setTextEditStatus({ kind: 'error', message: '无法在源码中定位该文本（可能由脚本生成）' });
            return;
          }
          await api.putFile(projectId, file, next);
          undoStackRef.current.push(source);
          if (undoStackRef.current.length > 50) undoStackRef.current.shift();
          setUndoCount(undoStackRef.current.length);
          frame.postMessage({ type: 'pi:edit:result', id: commit.id, ok: true }, '*');
          setTextEditStatus({ kind: 'saved' });
        } catch (err) {
          frame.postMessage({ type: 'pi:edit:result', id: commit.id, ok: false }, '*');
          setTextEditStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    },
    [projectId, file],
  );

  const undoTextEdit = useCallback(() => {
    const snapshot = undoStackRef.current.pop();
    if (snapshot === undefined) return;
    setUndoCount(undoStackRef.current.length);
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      setTextEditStatus({ kind: 'saving' });
      try {
        await api.putFile(projectId, file, snapshot);
        setTextEditStatus({ kind: 'saved' });
        setLocalReload((v) => v + 1);
      } catch (err) {
        setTextEditStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
  }, [projectId, file]);

  const toggleTextEdit = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    setTextEditOn((prev) => {
      const next = !prev;
      frame.postMessage({ type: next ? 'pi:edit:activate' : 'pi:edit:deactivate' }, '*');
      return next;
    });
  }, []);
```

- [x] **Step 4: 消息处理**

现有 `onMessage` effect 中、`reduceTweaksMessage` 之前插入（effect 依赖数组改为 `[handleTextEditCommit]`）：

```ts
      const editAction = reduceTextEditMessage(ev.data);
      if (editAction) {
        // iframe（重新）加载后 bridge 就绪：编辑开关仍开则重新激活。
        if (editAction.ready && textEditOnRef.current) {
          (ev.source as Window).postMessage({ type: 'pi:edit:activate' }, '*');
        }
        if (editAction.commit) handleTextEditCommit(ev.source as Window, editAction.commit);
        return;
      }
```

- [x] **Step 5: 工具栏 UI**（Tweaks 按钮之后、⟳ 之前插入）

```tsx
        {textEditStatus.kind !== 'idle' ? (
          <span
            className={`max-w-40 truncate text-xs ${textEditStatus.kind === 'error' ? 'text-red-500' : 'text-zinc-400'}`}
            title={textEditStatus.message}
          >
            {textEditStatus.kind === 'saving' ? '保存中…' : textEditStatus.kind === 'saved' ? '已保存' : textEditStatus.message ?? '保存失败'}
          </span>
        ) : null}
        {textEditOn && undoCount > 0 ? (
          <button
            type="button"
            onClick={undoTextEdit}
            title="撤销上一次文案修改"
            className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            撤销
          </button>
        ) : null}
        {isHtmlFile ? (
          <button
            type="button"
            onClick={toggleTextEdit}
            title="可视化编辑文案"
            aria-pressed={textEditOn}
            className={`rounded-md px-2 py-1 text-xs ${
              textEditOn ? 'bg-blue-600 text-white' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            文案
          </button>
        ) : null}
```

- [x] **Step 6: 类型检查 + web 测试 + 提交**

Run: `pnpm -C web build && pnpm -C web test`
Expected: 构建通过、测试全绿

```bash
git add web/src/components/FileViewer.tsx
git commit -m "feat(web): FileViewer 接入可视化文案编辑（开关/提交队列/撤销/reload 冻结）"
```

---

### Task 4: 全量验证

- [x] **Step 1: 全仓测试与构建**

Run: `pnpm test && pnpm build`
Expected: server + web 测试全绿、构建通过

- [x] **Step 2: 手动 e2e（pnpm dev）**

按 spec 第 6 节验收：静态 HTML 编辑写回、`<p>Hello <b>world</b></p>` 混排、`&amp;` 实体、撤销、JSX 渲染页报错还原、编辑模式中 agent 改文件不打断。

- [x] **Step 3: 收尾提交（如有验证产生的修正）**

```bash
git add -A && git commit -m "fix: 文案编辑手动验证修正"
```
