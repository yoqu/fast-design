// 输入框 @ 提及的纯逻辑：从光标位置识别 @token、过滤项目文件列表、
// 选中后回写文本。UI（弹层/键盘导航）在 Composer 内实现。

export type MentionContext = {
  /** @ 字符在文本中的下标。 */
  start: number;
  /** @ 与光标之间的查询串（不含 @）。 */
  query: string;
};

const MAX_QUERY_LENGTH = 80;

/**
 * 光标处于一个 @token 内时返回其上下文，否则返回 null。
 * @ 必须位于行首或空白之后，token 内不允许空白。
 */
export function getMentionContext(text: string, caret: number): MentionContext | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      if (i > 0 && !/\s/.test(text[i - 1])) return null;
      const query = text.slice(i + 1, caret);
      if (query.length > MAX_QUERY_LENGTH) return null;
      return { start: i, query };
    }
    if (/\s/.test(ch)) return null;
    if (caret - i > MAX_QUERY_LENGTH + 1) return null;
  }
  return null;
}

function isSubsequence(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/**
 * 按查询串过滤文件路径：文件名前缀 > 文件名包含 > 全路径包含 > 子序列，
 * 同档按路径长度与字典序排，最多返回 limit 条。
 */
export function filterMentionFiles(paths: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  if (!q) return paths.slice(0, limit);
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    let score: number;
    if (base.startsWith(q)) score = 0;
    else if (base.includes(q)) score = 1;
    else if (lower.includes(q)) score = 2;
    else if (isSubsequence(q, lower)) score = 3;
    else continue;
    scored.push({ path, score });
  }
  scored.sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((s) => s.path);
}

/** 把 [start, caret) 的 @token 替换为 `@path `，返回新文本与新光标位置。 */
export function applyMention(
  text: string,
  ctx: MentionContext,
  caret: number,
  path: string,
): { text: string; caret: number } {
  const inserted = `@${path} `;
  return {
    text: text.slice(0, ctx.start) + inserted + text.slice(caret),
    caret: ctx.start + inserted.length,
  };
}
