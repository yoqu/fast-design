import fs from 'node:fs';
import path from 'node:path';
import { appendConversationHistory, getConversation } from './conversations.js';
import { listProjects, projectDir } from './projects.js';
import type { ChatMessage, ToolCall, UiEvent } from './types.js';

/** 进行中回合的事件日志目录（journal 写穿落盘，server 重启后恢复用）。 */
export function turnsDir(projectId: string): string {
  return path.join(projectDir(projectId), '.webui', 'turns');
}

export function turnJournalPath(projectId: string, cid: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(cid)) throw new Error(`invalid conversation id: ${cid}`);
  return path.join(turnsDir(projectId), `${cid}.ndjson`);
}

/**
 * 事件折叠状态。检查点 + retry 回滚与 ChatPanel 的归约器同语义：
 * pi 自动重试会把出错回合整个重发，必须丢弃半截输出（见 pi-events.ts）。
 */
export type TurnFold = {
  assistant: ChatMessage;
  tools: ToolCall[];
  checkpoint: { content: number; thinking: number };
};

export function createTurnFold(): TurnFold {
  return {
    assistant: { role: 'assistant', content: '', createdAt: Date.now() },
    tools: [],
    checkpoint: { content: 0, thinking: 0 },
  };
}

/** 在线流式与重启恢复共用的折叠函数（自 chat 路由的累积器搬入）。 */
export function foldTurnEvent(fold: TurnFold, ev: UiEvent): void {
  const { assistant, tools, checkpoint } = fold;
  switch (ev.type) {
    case 'turn_start':
      checkpoint.content = assistant.content.length;
      checkpoint.thinking = assistant.thinking?.length ?? 0;
      break;
    case 'retry':
      assistant.content = assistant.content.slice(0, checkpoint.content);
      if (assistant.thinking !== undefined) {
        assistant.thinking = assistant.thinking.slice(0, checkpoint.thinking);
      }
      delete assistant.error;
      break;
    case 'text_delta':
      assistant.content += ev.delta;
      break;
    case 'thinking_delta':
      assistant.thinking = (assistant.thinking ?? '') + ev.delta;
      break;
    case 'tool_use':
      tools.push({ id: ev.id, name: ev.name, input: ev.input });
      break;
    case 'tool_result': {
      const call = tools.find((t) => t.id === ev.toolUseId && t.result === undefined) ?? tools.at(-1);
      if (call) {
        call.result = ev.content.length > 4000 ? `${ev.content.slice(0, 4000)}\n…(截断)` : ev.content;
        call.isError = ev.isError;
      }
      break;
    }
    case 'error':
      assistant.error = ev.message;
      break;
  }
}

export function finishTurnFold(fold: TurnFold): ChatMessage {
  if (fold.tools.length > 0) fold.assistant.tools = fold.tools;
  return fold.assistant;
}

/**
 * 一个进行中的回合：事件缓冲 + 订阅者 + 写穿磁盘 journal。
 * 回合生命周期与 HTTP 连接解耦——订阅者只是观察者，断开即退订。
 * journal 用 appendFileSync 写穿（进 OS 页缓存即可，目标是进程重启可恢复，
 * 不追求断电级持久化）；写失败降级纯内存并告警，不杀回合。
 */
export class Turn {
  private buffer: UiEvent[] = [];
  private subscribers = new Set<(ev: UiEvent) => void>();
  private journalPath: string | null;
  private finished = false;
  private fold = createTurnFold();

  constructor(journalPath: string | null) {
    this.journalPath = journalPath;
    if (!journalPath) return;
    try {
      fs.mkdirSync(path.dirname(journalPath), { recursive: true });
      fs.rmSync(journalPath, { force: true });
    } catch (err) {
      console.error(`[turns] journal 初始化失败，降级纯内存: ${err instanceof Error ? err.message : err}`);
      this.journalPath = null;
    }
  }

  get isDone(): boolean {
    return this.finished;
  }

  emit(ev: UiEvent): void {
    if (this.finished) return;
    if (this.journalPath) {
      try {
        fs.appendFileSync(this.journalPath, `${JSON.stringify(ev)}\n`);
      } catch (err) {
        console.error(`[turns] journal 写入失败，降级纯内存: ${err instanceof Error ? err.message : err}`);
        this.journalPath = null;
      }
    }
    this.buffer.push(ev);
    foldTurnEvent(this.fold, ev);
    // Fix 1: 快照扇出——隔离抛错订阅者，防止传播进 pi stdout 处理器；
    // Fix 4: 快照也消除了扇出期间新增订阅者导致的重复投递。
    for (const fn of [...this.subscribers]) {
      try {
        fn(ev);
      } catch (err) {
        this.subscribers.delete(fn);
        console.error(`[turns] 订阅者回调异常，已退订: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /**
   * 同步回放缓冲并订阅后续事件；返回退订函数。
   * 回放与登记在同一同步段完成，无丢失/重复窗口；已结束的回合回放后立即补 done。
   */
  subscribe(fn: (ev: UiEvent) => void): () => void {
    for (const ev of this.buffer) fn(ev);
    if (this.finished) {
      fn({ type: 'done' });
      return () => {};
    }
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** 结束回合：通知订阅者 done、删除 journal，返回折叠出的 assistant 消息。幂等。 */
  end(): ChatMessage {
    if (!this.finished) {
      this.finished = true;
      // Fix 1: 快照扇出隔离抛错订阅者（与 emit 保持一致）。
      for (const fn of [...this.subscribers]) {
        try {
          fn({ type: 'done' });
        } catch (err) {
          console.error(`[turns] 订阅者回调异常，已退订: ${err instanceof Error ? err.message : err}`);
        }
      }
      this.subscribers.clear();
      // Fix 3: journal 清理失败不杀回合（如 EISDIR 路径被目录占用时）。
      if (this.journalPath) {
        try {
          fs.rmSync(this.journalPath, { force: true });
        } catch (err) {
          console.error(`[turns] journal 清理失败: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    return finishTurnFold(this.fold);
  }
}

const turns = new Map<string, Turn>();

function turnKey(projectId: string, cid: string): string {
  return `${projectId}:${cid}`;
}

/** 该会话当前进行中的回合（无则 undefined）。 */
export function activeTurn(projectId: string, cid: string): Turn | undefined {
  return turns.get(turnKey(projectId, cid));
}

/**
 * 启动一个回合：注册 Turn，把 run 的事件写穿 journal 并广播；结束后把折叠
 * 出的 assistant 消息落历史——不依赖是否有客户端连着（回合与连接解耦）。
 * Fix 2: 同一 key 已有进行中回合时同步抛错，防止新 Turn 构造器 rmSync 踩踏 live journal。
 * finished 永不 reject，调用方可安全 fire-and-forget。
 */
export function startTurn(
  projectId: string,
  cid: string,
  run: (emit: (ev: UiEvent) => void) => Promise<void>,
): { turn: Turn; finished: Promise<void> } {
  const key = turnKey(projectId, cid);
  // Fix 2: 同 key 防重入——先检查再构造，避免新 Turn 的 rmSync 误删 live journal。
  if (turns.get(key)) throw new Error('该会话已有进行中的回合');
  const turn = new Turn(turnJournalPath(projectId, cid));
  turns.set(key, turn);
  const finished = run((ev) => turn.emit(ev))
    .catch((err) => {
      turn.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    })
    .then(() => {
      // Fix 3: 收尾整体捕获——finished 永不 reject。
      try {
        const assistant = turn.end();
        // Fix 2: 身份校验删除，防止二次 startTurn 竞态（理论上前面已拦截，双保险）。
        if (turns.get(key) === turn) turns.delete(key);
        // 回合进行中会话可能已被删除：跳过持久化，避免复活已删历史文件。
        if (getConversation(projectId, cid)) {
          appendConversationHistory(projectId, cid, assistant);
        }
      } catch (err) {
        if (turns.get(key) === turn) turns.delete(key);
        console.error(`[turns] 回合收尾失败: ${err instanceof Error ? err.message : err}`);
      }
    });
  return { turn, finished };
}

/** 删除会话时同步清理可能残留的 journal。 */
export function removeTurnJournal(projectId: string, cid: string): void {
  fs.rmSync(turnJournalPath(projectId, cid), { force: true });
}

const INTERRUPTED_MESSAGE = '服务重启，回合已中断';

/**
 * 启动恢复：扫描所有项目的 .webui/turns/*.ndjson。journal 存在即上次进程
 * 死于回合中途——折叠已流出的事件归档进历史并标记中断，删除 journal。
 * 不自动续跑（设计决策：LLM 生成现场无法接续，用户用重试入口一键重发）。
 */
export function recoverInterruptedTurns(): void {
  for (const project of listProjects()) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(turnsDir(project.id)).filter((f) => f.endsWith('.ndjson'));
    } catch {
      continue; // 无 turns 目录：该项目没有中断回合
    }
    for (const file of files) {
      const cid = file.slice(0, -'.ndjson'.length);
      const full = path.join(turnsDir(project.id), file);
      try {
        const events = fs
          .readFileSync(full, 'utf8')
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as UiEvent];
            } catch {
              return []; // 进程死于半行写入：跳过残行
            }
          });
        if (getConversation(project.id, cid)) {
          const fold = createTurnFold();
          for (const ev of events) foldTurnEvent(fold, ev);
          const assistant = finishTurnFold(fold);
          assistant.error = INTERRUPTED_MESSAGE;
          appendConversationHistory(project.id, cid, assistant);
          console.error(`[turns] 恢复中断回合: ${project.id}/${cid}（${events.length} 事件）`);
        }
        // Fix 5: rmSync 移入 try，EPERM 等清理错误只影响当前文件，不中断其余恢复。
        fs.rmSync(full, { force: true });
      } catch (err) {
        console.error(`[turns] 恢复 ${project.id}/${cid} 失败: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
