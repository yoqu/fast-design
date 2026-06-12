// 聊天附件：校验客户端上报的附件元数据，并把附件清单拼进发给 pi 的 prompt。
// 附件文件本身由前端经 PUT /api/projects/:id/file 先行写入项目目录
// （约定放在 uploads/ 下），这里只处理元数据与提示词。
import type { ChatAttachment } from './types.js';

const MAX_ATTACHMENTS = 20;

/** 项目内禁止作为附件路径出现的目录段（与 HIDDEN_DIRS 中的元数据目录一致）。 */
const FORBIDDEN_SEGMENTS = new Set(['.webui', '.pi', '..', '']);

function isSafeRelPath(rel: string): boolean {
  if (rel.startsWith('/') || rel.includes('\\')) return false;
  return rel.split('/').every((seg) => !FORBIDDEN_SEGMENTS.has(seg));
}

/**
 * 把请求体里的 attachments 归一化成受信的 ChatAttachment 列表。
 * 非法条目（缺字段/越权路径）直接丢弃，数量截断到 MAX_ATTACHMENTS。
 */
export function sanitizeAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ChatAttachment[] = [];
  for (const item of input) {
    if (out.length >= MAX_ATTACHMENTS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const path = typeof rec.path === 'string' ? rec.path.trim() : '';
    if (!name || !path || !isSafeRelPath(path)) continue;
    const mimeType = typeof rec.mimeType === 'string' ? rec.mimeType : '';
    const size = typeof rec.size === 'number' && Number.isFinite(rec.size) && rec.size >= 0 ? rec.size : 0;
    out.push({ name, path, mimeType, size });
  }
  return out;
}

/**
 * 解析 PATCH project 里的 pendingAttachments 字段：
 * 字段缺省 → undefined（不动）；非数组或清洗后为空 → null（清除）；否则为清洗后的列表。
 */
export function parsePendingAttachmentsPatch(value: unknown): ChatAttachment[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const list = sanitizeAttachments(value);
  return list.length > 0 ? list : null;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 在用户原文后追加附件清单，引导 agent 用读取工具按需查看。
 * 纯文字消息原样返回；只有附件没有文字时给一句默认引导。
 */
export function composePromptWithAttachments(message: string, attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return message;
  const lines = attachments.map(
    (a) => `- ${a.path}（${a.name}${a.mimeType ? `, ${a.mimeType}` : ''}, ${formatSize(a.size)}）`,
  );
  const head = message || '请查看用户上传的附件。';
  return `${head}\n\n[用户上传的附件]（路径相对项目根目录，请用读取工具按需查看内容）\n${lines.join('\n')}`;
}
