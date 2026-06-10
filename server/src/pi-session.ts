import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { createJsonLineParser, mapPiEvent } from './pi-events.js';
import type { JsonRecord, UiEvent } from './types.js';

const SYSTEM_PROMPT_SUFFIX = `
You are working inside a web studio: the user chats with you in a browser and a
preview pane renders the project directory over plain static file serving.
When building web pages:
- Make index.html the entry point of the site.
- Use only relative paths between files; no build step, no dev server —
  plain HTML/CSS/JS that works when opened directly.
- Prefer self-contained pages; CDN links are fine for libraries.
Respond in the same language the user writes in.`;

// pi auto-resolves UI dialogs it can't show: these methods expect no response.
const FIRE_AND_FORGET_METHODS = new Set([
  'setStatus',
  'setWidget',
  'notify',
  'setTitle',
  'set_editor_text',
]);

function replyExtensionUi(stdin: Writable, raw: JsonRecord): void {
  if (raw.id == null) return;
  if (typeof raw.method === 'string' && FIRE_AND_FORGET_METHODS.has(raw.method)) return;
  let result: JsonRecord;
  if (raw.method === 'confirm') {
    result = { confirmed: true };
  } else {
    const params = raw.params as JsonRecord | undefined;
    const opts = params?.options ?? raw.options;
    if (Array.isArray(opts) && opts.length > 0) {
      const first = opts[0];
      result =
        typeof first === 'string'
          ? { value: first }
          : { value: (first as JsonRecord)?.label ?? (first as JsonRecord)?.value ?? '' };
    } else {
      result = { cancelled: true };
    }
  }
  stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id: raw.id, ...result })}\n`);
}

/**
 * One long-lived `pi --mode rpc` process per project. pi keeps the RPC
 * process alive across prompts, so consecutive turns share conversation
 * context naturally. If the process dies, the next prompt respawns it with
 * --continue so history (stored under <cwd>/.pi-webui-sessions) is restored.
 */
export class PiSession {
  private child: ChildProcess | null = null;
  private busy = false;
  private currentEmit: ((ev: UiEvent) => void) | null = null;
  private finishTurn: (() => void) | null = null;
  private nextRpcId = 1;
  private promptRpcId: number | null = null;

  constructor(
    private readonly cwd: string,
    private readonly model: string | null = null,
  ) {}

  get isBusy(): boolean {
    return this.busy;
  }

  private sessionDir(): string {
    return path.join(this.cwd, '.webui', 'pi-sessions');
  }

  private hasPriorSessions(): boolean {
    try {
      return fs.readdirSync(this.sessionDir()).some((f) => f.endsWith('.jsonl'));
    } catch {
      return false;
    }
  }

  private ensureChild(): ChildProcess {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return this.child;
    }
    fs.mkdirSync(this.sessionDir(), { recursive: true });
    const args = [
      '--mode', 'rpc',
      '--session-dir', this.sessionDir(),
      '--append-system-prompt', SYSTEM_PROMPT_SUFFIX,
    ];
    if (this.hasPriorSessions()) args.push('--continue');
    if (this.model && this.model !== 'default') args.push('--model', this.model);

    const child = spawn('pi', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child = child;
    this.nextRpcId = 1;

    const parser = createJsonLineParser((raw) => this.handleEvent(raw));
    child.stdout!.on('data', (chunk: Buffer) => parser.feed(chunk.toString('utf8')));
    child.stdout!.on('close', () => parser.flush());
    child.stderr!.on('data', (chunk: Buffer) => {
      console.error(`[pi:${path.basename(this.cwd)}]`, chunk.toString('utf8').trimEnd());
    });
    child.on('error', (err) => this.failTurn(`pi 进程启动失败: ${err.message}`));
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (this.busy) this.failTurn(`pi 进程退出 (code ${code})`);
    });
    return child;
  }

  private handleEvent(raw: JsonRecord): void {
    const stdin = this.child?.stdin;
    if (raw.type === 'extension_ui_request' && stdin) {
      replyExtensionUi(stdin, raw);
      return;
    }
    if (raw.type === 'response') {
      if (raw.id === this.promptRpcId && raw.success === false) {
        this.failTurn(`prompt 被拒绝: ${String(raw.error ?? 'unknown')}`);
      }
      return;
    }
    const emit = this.currentEmit;
    if (!emit) return;
    const result = mapPiEvent(raw, emit);
    if (result === 'agent_end') {
      const finish = this.finishTurn;
      this.endTurn();
      finish?.();
    }
  }

  private failTurn(message: string): void {
    const emit = this.currentEmit;
    const finish = this.finishTurn;
    this.endTurn();
    emit?.({ type: 'error', message });
    finish?.();
  }

  private endTurn(): void {
    this.busy = false;
    this.currentEmit = null;
    this.finishTurn = null;
    this.promptRpcId = null;
  }

  /** Send one prompt; resolves when the agent finishes the turn. */
  prompt(message: string, emit: (ev: UiEvent) => void): Promise<void> {
    if (this.busy) {
      return Promise.reject(new Error('agent 正忙，请等待当前回合结束'));
    }
    this.busy = true;
    this.currentEmit = emit;
    return new Promise<void>((resolve) => {
      this.finishTurn = resolve;
      let child: ChildProcess;
      try {
        child = this.ensureChild();
      } catch (err) {
        this.failTurn(`pi 启动失败: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      const id = this.nextRpcId++;
      this.promptRpcId = id;
      child.stdin!.write(`${JSON.stringify({ id, type: 'prompt', message })}\n`);
    });
  }

  abort(): void {
    const child = this.child;
    if (!child || !this.busy) return;
    const id = this.nextRpcId++;
    try {
      child.stdin!.write(`${JSON.stringify({ id, type: 'abort' })}\n`);
    } catch {
      child.kill('SIGTERM');
    }
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    this.endTurn();
    if (child && !child.killed) {
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM');
      }, 1000).unref();
    }
  }
}
