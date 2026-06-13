import { defaultPiRunner, type PiRunner } from './pi-cli.js';
import { getConversation, updateConversation } from './conversations.js';

const MAX_TITLE_LENGTH = 24;

function titlePrompt(message: string): string {
  return [
    '请用一个简短标题（不超过 12 个字）概括下面这条需求在做什么，用于对话列表展示。',
    '只输出标题本身：不要引号、句号、前缀或任何解释，输出语言与需求一致。',
    '',
    '需求：',
    message.slice(0, 2000),
  ].join('\n');
}

/** 清洗模型输出：取最后一个非空行，剥引号/括号/句尾标点，限长。 */
export function cleanTitle(raw: string): string | null {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  const title = line
    .replace(/^["'“”‘’「」《》【】\s]+|["'“”‘’「」《》【】\s]+$/g, '')
    .replace(/[。．.！!？?，,；;:：]+$/g, '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  return title || null;
}

/**
 * 对话自动命名：首条用户消息送入一次性 `pi --print`（无会话/工具/skill，
 * 不污染对话上下文），总结成短标题写回对话元数据。与回合并行跑——回合通常
 * 远慢于标题生成，回合结束前端刷新列表时标题已就位。失败静默（保持未命名，
 * 用户仍可手动重命名），绝不影响聊天回合。
 */
export async function autoTitleConversation(opts: {
  projectId: string;
  cid: string;
  message: string;
  /** 跟随会话/项目的模型设置（null = pi 默认模型）。 */
  model: string | null;
  run?: PiRunner;
}): Promise<void> {
  const run = opts.run ?? defaultPiRunner;
  const args = [
    '--print',
    '--no-session',
    '--no-tools',
    '--no-skills',
    '--no-extensions',
    '--no-prompt-templates',
    '--no-context-files',
    '--thinking',
    'off',
  ];
  if (opts.model && opts.model !== 'default') args.push('--model', opts.model);
  args.push(titlePrompt(opts.message));
  try {
    const { code, stdout } = await run(args, { timeoutMs: 45_000 });
    if (code !== 0) return;
    const title = cleanTitle(stdout);
    if (!title) return;
    const conv = getConversation(opts.projectId, opts.cid);
    // 对话已删除或用户已手动命名：不覆盖。
    if (!conv || conv.title) return;
    updateConversation(opts.projectId, opts.cid, { title });
  } catch (err) {
    console.error(`[auto-title] ${opts.projectId}/${opts.cid} 失败: ${err instanceof Error ? err.message : err}`);
  }
}
