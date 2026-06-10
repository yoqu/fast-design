import { execFile } from 'node:child_process';
import path from 'node:path';
import { piAgentDir, readJsonConfig } from './pi-config.js';

export type PiRunResult = { code: number | null; stdout: string; stderr: string };
export type PiRunner = (args: string[], opts?: { timeoutMs?: number }) => Promise<PiRunResult>;

/** 默认 runner：argv 直传 execFile，不经 shell。 */
export const defaultPiRunner: PiRunner = (args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      'pi',
      args,
      { timeout: opts?.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        if (err && code === 'ENOENT') return reject(err);
        if (err && typeof code !== 'number' && !('killed' in err)) return reject(err);
        const exit = err ? ((err as unknown as { code?: number }).code ?? 1) : 0;
        resolve({ code: typeof exit === 'number' ? exit : 1, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

// ---- status ----

export type PiStatus = { installed: boolean; version: string | null; piDir: string };

export async function getPiStatus(run: PiRunner = defaultPiRunner): Promise<PiStatus> {
  try {
    const { stdout, stderr } = await run(['--version'], { timeoutMs: 15_000 });
    const version = `${stdout}\n${stderr}`.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
    return { installed: true, version, piDir: piAgentDir() };
  } catch {
    return { installed: false, version: null, piDir: piAgentDir() };
  }
}

// ---- list-models ----

export type PiModel = { provider: string; id: string };

/** `pi --list-models` 表格输出在 stderr，只含已配置凭证的 provider。 */
export async function listModels(run: PiRunner = defaultPiRunner): Promise<PiModel[]> {
  const { stdout, stderr } = await run(['--list-models'], { timeoutMs: 30_000 });
  const out: PiModel[] = [];
  for (const line of `${stdout}\n${stderr}`.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2) continue;
    if (cols[0] === 'provider' && cols[1] === 'model') continue; // header
    if (cols[0] === 'No') continue; // "No models matching ..."
    out.push({ provider: cols[0], id: cols[1] });
  }
  return out;
}

// ---- extensions ----

export type ExtensionInfo = { source: string };

export function listExtensions(): ExtensionInfo[] {
  const settings = readJsonConfig<Record<string, unknown>>(path.join(piAgentDir(), 'settings.json'), {});
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  return packages
    .map((p) => (typeof p === 'string' ? p : typeof (p as { source?: string }).source === 'string' ? (p as { source: string }).source : null))
    .filter((s): s is string => Boolean(s))
    .map((source) => ({ source }));
}

const SOURCE_RE = /^(git:[\w./@:-]+|https:\/\/[\w./@:-]+|@?[a-z0-9][\w.-]*(\/[\w.-]+)?(@[\w.-]+)?)$/;

export function validateExtensionSource(source: string): boolean {
  return source.length > 0 && source.length < 300 && SOURCE_RE.test(source);
}

export type ExtensionOpResult = { ok: boolean; output: string };

let extensionOpRunning: Promise<unknown> = Promise.resolve();

async function runExtensionOp(args: string[], run: PiRunner): Promise<ExtensionOpResult> {
  // 互斥：同一时间只跑一个 install/remove。
  const op = extensionOpRunning.then(async () => {
    const { code, stdout, stderr } = await run(args, { timeoutMs: 300_000 });
    return { ok: code === 0, output: `${stdout}\n${stderr}`.trim() };
  });
  extensionOpRunning = op.catch(() => undefined);
  return op;
}

export function installExtension(source: string, run: PiRunner = defaultPiRunner): Promise<ExtensionOpResult> {
  if (!validateExtensionSource(source)) return Promise.reject(new Error(`BAD_SOURCE: ${source}`));
  return runExtensionOp(['install', source], run);
}

export function removeExtension(source: string, run: PiRunner = defaultPiRunner): Promise<ExtensionOpResult> {
  if (!validateExtensionSource(source)) return Promise.reject(new Error(`BAD_SOURCE: ${source}`));
  return runExtensionOp(['remove', source], run);
}
