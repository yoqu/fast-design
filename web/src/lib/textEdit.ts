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
