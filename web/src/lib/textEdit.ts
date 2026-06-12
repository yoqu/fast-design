// 预览可视化文案编辑的纯函数层（设计见
// docs/superpowers/specs/2026-06-11-visual-text-edit-design.md），与
// FileViewer 的 React 状态/副作用解耦，便于测试（仿 tweaks.ts 分层）。
//
// 回写思路：bridge 上报 DOM 文本节点的 {oldText,newText,occurrence}（occurrence
// 为文档顺序中同值文本节点的序号），宿主在源码里用「文本区域掩码 + 宽松正则」
// 找到第 occurrence 个匹配并替换。掩码保证属性值/脚本字符串里的同名文本不参与
// 计数；宽松正则同时涵盖 raw 与实体编码形态，避免多策略在混合编码下选错序号。

/**
 * Babel 浏览器内插桩（spec 附录 B）上报的精确源码位置：source 为
 * state.file.opts.filename（外部脚本 = script.src 绝对 URL，内联 =
 * "Inline Babel script (N)"），line 1-based / column 0-based 指向最近
 * 宿主元素 JSX 开标签，occurrence 为该祖先子树内同值文本节点序号。
 */
export interface TextEditLoc {
  source: string;
  line: number;
  column: number;
  occurrence: number;
}

export interface TextEditOp {
  oldText: string;
  newText: string;
  occurrence: number;
  loc?: TextEditLoc;
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

/** 校验 loc 字段；畸形 loc 按缺失处理（op 仍有效，回落文本匹配链路）。 */
function parseTextEditLoc(value: unknown): TextEditLoc | null {
  if (!value || typeof value !== 'object') return null;
  const { source, line, column, occurrence } = value as Record<string, unknown>;
  if (typeof source !== 'string' || !source) return null;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return null;
  if (typeof column !== 'number' || !Number.isInteger(column) || column < 0) return null;
  if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 0) return null;
  return { source, line, column, occurrence };
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
      const { oldText, newText, occurrence, loc } = item as Record<string, unknown>;
      if (typeof oldText !== 'string' || typeof newText !== 'string') return null;
      if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 0) return null;
      const validLoc = parseTextEditLoc(loc);
      ops.push(validLoc ? { oldText, newText, occurrence, loc: validLoc } : { oldText, newText, occurrence });
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
  if (ch === '\u00a0') return '(?:&nbsp;|&#160;|&#[xX]0*[aA]0;|\u00a0)';
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

export interface HtmlScriptInfo {
  /** 无 src 的内联脚本原始内容区间（含 text/babel），type 为小写 type 属性值（无则空串）。 */
  inline: Array<{ start: number; end: number; type: string }>;
  /** 外部脚本的原始 src 属性值（未解析，可能是外链）。 */
  srcs: string[];
}

/**
 * 扫出源码中的脚本来源：内联脚本内容区间 + 外部 src。复用 htmlTextRegions
 * 的轻量扫描口径（跳过注释/声明、引号感知的标签解析、RAW_TEXT_TAGS 原始
 * 内容整体跳过），供脚本渲染文本的降级定位使用。
 */
/** 在开始标签文本里解析指定属性值（引号/裸值），无则返回 null。 */
function scriptTagAttr(tagText: string, name: string): string | null {
  const attrRe = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(tagText)) !== null) {
    if (m[1].toLowerCase() === name) return m[2] ?? m[3] ?? m[4] ?? '';
  }
  return null;
}

export function htmlScriptSources(source: string): HtmlScriptInfo {
  const inline: Array<{ start: number; end: number; type: string }> = [];
  const srcs: string[] = [];
  const len = source.length;
  let i = 0;
  while (i < len) {
    if (source[i] !== '<') {
      i++;
      continue;
    }
    if ((source[i + 1] ?? '') === '!') {
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        i = end === -1 ? len : end + 3;
      } else {
        const gt = source.indexOf('>', i);
        i = gt === -1 ? len : gt + 1;
      }
      continue;
    }
    const tagMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(source.slice(i, i + 64));
    if (!tagMatch) {
      i++;
      continue;
    }
    const tagStart = i;
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
      const contentEnd = close ? i + close.index : len;
      if (tagName === 'script') {
        // 标签文本去掉标签名前缀，避免 "script" 自身被当作属性名。
        const tagText = source.slice(tagStart + 1 + tagMatch[1].length + tagMatch[2].length, j);
        const src = scriptTagAttr(tagText, 'src');
        if (src !== null) {
          if (src) srcs.push(src);
        } else {
          const type = (scriptTagAttr(tagText, 'type') ?? '').trim().toLowerCase();
          inline.push({ start: i, end: contentEnd, type });
        }
      }
      i = contentEnd;
    }
  }
  return { inline, srcs };
}

/**
 * 把脚本 src 解析为项目相对路径：相对 src 以 HTML 所在目录为基准，"/" 开头
 * 以项目根为基准；外链（scheme/协议相对/data:）与越出项目根的路径返回 null。
 */
export function resolveScriptPath(htmlPath: string, src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) return null;
  const clean = trimmed.split(/[?#]/)[0];
  if (!clean) return null;
  const out = clean.startsWith('/') ? [] : htmlPath.split('/').slice(0, -1);
  for (const seg of clean.replace(/^\/+/, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length ? out.join('/') : null;
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

export interface ScriptFileContent {
  path: string;
  content: string;
}

export type TextEditPlan =
  | { ok: true; html: string; files: ScriptFileContent[] }
  | { ok: false; reason: 'not-found' | 'ambiguous' | 'unsafe' };

export type LocSource = { kind: 'file'; path: string } | { kind: 'inline'; index: number } | null;

/**
 * 把插桩 filename 还原为编辑目标：preview URL → 项目相对路径；
 * Babel standalone 的内联脚本标签 → 1-based 内联 babel 脚本序号。
 */
export function resolveLocSource(source: string): LocSource {
  const inline = /^Inline Babel script(?: \((\d+)\))?$/.exec(source);
  if (inline) return { kind: 'inline', index: inline[1] ? Number(inline[1]) : 1 };
  const preview = /\/preview\/[a-z0-9]{24,64}\/(.+)$/.exec(source.split(/[?#]/)[0]);
  if (preview) {
    try {
      const path = preview[1].split('/').map(decodeURIComponent).join('/');
      if (path) return { kind: 'file', path };
    } catch {
      // 非法编码按无法识别处理。
    }
  }
  return null;
}

/**
 * 按插桩 loc 写回：line/column（babel 1-based 行 / 0-based 列，指向元素开
 * 标签）折算偏移，从偏移起取第 occurrence+1 个 oldText 精确匹配替换。
 * 行越界或 loc 之后无足够匹配返回 null（交由调用方回落文本匹配链路）。
 */
export function applyTextEditAtLoc(content: string, op: TextEditOp): string | null {
  const offset = locOffset(content, op);
  if (offset === null) return null;
  return content.slice(0, offset) + op.newText + content.slice(offset + op.oldText.length);
}

function locOffset(content: string, op: TextEditOp): number | null {
  if (!op.loc || !op.oldText) return null;
  let lineStart = 0;
  for (let line = 1; line < op.loc.line; line++) {
    const nl = content.indexOf('\n', lineStart);
    if (nl === -1) return null;
    lineStart = nl + 1;
  }
  let idx = content.indexOf(op.oldText, lineStart + op.loc.column);
  for (let skip = 0; skip < op.loc.occurrence && idx !== -1; skip++) {
    idx = content.indexOf(op.oldText, idx + 1);
  }
  return idx === -1 ? null : idx;
}

/** [from, to) 区间内 text 的全部精确匹配起点。 */
function matchesInRange(content: string, text: string, from: number, to: number): number[] {
  const out: number[] = [];
  let idx = content.indexOf(text, from);
  while (idx !== -1 && idx + text.length <= to) {
    out.push(idx);
    idx = content.indexOf(text, idx + 1);
  }
  return out;
}

// 脚本源码里替换是原文写回（无实体编码兜底），newText 引入 oldText 没有的
// 这些字符就可能破坏字符串字面量 / JSX / 模板语法，保守拒绝。
const SCRIPT_RISKY_CHARS = /['"`\\<>{}\r\n]/g;

function isSafeScriptReplacement(oldText: string, newText: string): boolean {
  if (/<\/script/i.test(newText)) return false;
  const allowed = new Set(oldText.match(SCRIPT_RISKY_CHARS) ?? []);
  for (const ch of newText.match(SCRIPT_RISKY_CHARS) ?? []) {
    if (!allowed.has(ch)) return false;
  }
  return true;
}

function spliceText(text: string, offset: number, op: TextEditOp): string {
  return text.slice(0, offset) + op.newText + text.slice(offset + op.oldText.length);
}

/** Babel standalone 口径的内联 jsx 脚本区间（type.split(';')[0] ∈ text/babel|text/jsx）。 */
function inlineBabelRanges(html: string): Array<{ start: number; end: number }> {
  return htmlScriptSources(html).inline.filter((r) => {
    const t = r.type.split(';')[0].trim();
    return t === 'text/babel' || t === 'text/jsx';
  });
}

/**
 * 整体编辑规划，两阶段（spec 附录 A/B）：
 *
 * 1. 带插桩 loc 的 op 优先按精确位置落位（外部脚本文件 / 第 N 个内联 babel
 *    脚本），偏移基于原始内容计算、同目标降序替换避免漂移；解析或命中失败
 *    回落阶段二。
 * 2. 其余 op 先试 HTML 文本区域，未命中则要求在所有脚本源码中恰好出现一次
 *    （脚本渲染常把一处源码渲染成多个 DOM 节点，DOM occurrence 与源码顺序
 *    无对应关系，多处命中宁可报 ambiguous 也不猜）。
 *
 * 任一 op 失败整体失败；成功返回新 HTML 与发生变更的脚本文件。
 */
export function planTextEdits(
  html: string,
  scripts: ScriptFileContent[],
  edits: TextEditOp[],
): TextEditPlan {
  const contents = new Map(scripts.map((s) => [s.path, s.content]));
  const changed = new Set<string>();
  let nextHtml = html;

  // —— 阶段一：loc 精确落位 ——
  const fallback: TextEditOp[] = [];
  const filePlacements = new Map<string, Array<{ offset: number; op: TextEditOp }>>();
  const inlinePlacements: Array<{ offset: number; op: TextEditOp }> = [];
  for (const op of edits) {
    const target = op.loc ? resolveLocSource(op.loc.source) : null;
    let offset: number | null = null;
    let filePath: string | null = null;
    if (target?.kind === 'file' && contents.has(target.path)) {
      offset = locOffset(contents.get(target.path) ?? '', op);
      filePath = target.path;
    } else if (target?.kind === 'inline') {
      const range = inlineBabelRanges(html)[target.index - 1];
      if (range) {
        const local = locOffset(html.slice(range.start, range.end), op);
        if (local !== null) offset = range.start + local;
      }
    }
    if (offset === null) {
      fallback.push(op);
      continue;
    }
    if (!isSafeScriptReplacement(op.oldText, op.newText)) return { ok: false, reason: 'unsafe' };
    if (filePath !== null) {
      const list = filePlacements.get(filePath) ?? [];
      list.push({ offset, op });
      filePlacements.set(filePath, list);
    } else {
      inlinePlacements.push({ offset, op });
    }
  }
  for (const [path, list] of filePlacements) {
    let content = contents.get(path) ?? '';
    for (const item of list.sort((a, b) => b.offset - a.offset)) {
      content = spliceText(content, item.offset, item.op);
    }
    contents.set(path, content);
    changed.add(path);
  }
  for (const item of inlinePlacements.sort((a, b) => b.offset - a.offset)) {
    nextHtml = spliceText(nextHtml, item.offset, item.op);
  }

  // —— 阶段二：文本匹配链路 ——
  if (fallback.length) {
    const direct = applyTextEdits(nextHtml, fallback);
    if (direct !== null) {
      nextHtml = direct;
    } else {
      const htmlOps: TextEditOp[] = [];
      const scriptOps: TextEditOp[] = [];
      for (const op of fallback) {
        (applyTextEditToSource(nextHtml, op) !== null ? htmlOps : scriptOps).push(op);
      }
      const applied = htmlOps.length ? applyTextEdits(nextHtml, htmlOps) : nextHtml;
      if (applied === null || !scriptOps.length) return { ok: false, reason: 'not-found' };
      nextHtml = applied;
      for (const op of scriptOps) {
        if (!op.oldText) return { ok: false, reason: 'not-found' };
        const hits: Array<{ path: string | null; index: number }> = [];
        for (const region of htmlScriptSources(nextHtml).inline) {
          for (const index of matchesInRange(nextHtml, op.oldText, region.start, region.end)) {
            hits.push({ path: null, index });
          }
        }
        for (const [path, content] of contents) {
          for (const index of matchesInRange(content, op.oldText, 0, content.length)) {
            hits.push({ path, index });
          }
        }
        if (hits.length === 0) return { ok: false, reason: 'not-found' };
        if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
        if (!isSafeScriptReplacement(op.oldText, op.newText)) return { ok: false, reason: 'unsafe' };
        const [hit] = hits;
        if (hit.path === null) {
          nextHtml = spliceText(nextHtml, hit.index, op);
        } else {
          contents.set(hit.path, spliceText(contents.get(hit.path) ?? '', hit.index, op));
          changed.add(hit.path);
        }
      }
    }
  }
  return {
    ok: true,
    html: nextHtml,
    files: scripts
      .filter((s) => changed.has(s.path))
      .map((s) => ({ path: s.path, content: contents.get(s.path) ?? s.content })),
  };
}
