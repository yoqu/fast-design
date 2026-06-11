// 编辑器探测与本机交接动作(Finder/编辑器打开)。
// 探测依赖可注入,便于单测;真实调用走 fs/PATH。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type EditorCandidate = { id: string; name: string; app?: string; bin: string };

export const EDITOR_CANDIDATES: EditorCandidate[] = [
  { id: 'vscode', name: 'VS Code', app: 'Visual Studio Code.app', bin: 'code' },
  { id: 'cursor', name: 'Cursor', app: 'Cursor.app', bin: 'cursor' },
  { id: 'zed', name: 'Zed', app: 'Zed.app', bin: 'zed' },
  { id: 'webstorm', name: 'WebStorm', app: 'WebStorm.app', bin: 'webstorm' },
];

export type DetectedEditor = { id: string; name: string; installed: boolean };

function binOnPath(bin: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

export function detectEditors(
  opts: {
    platform?: NodeJS.Platform;
    exists?: (p: string) => boolean;
    hasBin?: (bin: string) => boolean;
  } = {},
): DetectedEditor[] {
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? fs.existsSync;
  const hasBin = opts.hasBin ?? binOnPath;
  return EDITOR_CANDIDATES.map((c) => {
    const appInstalled =
      platform === 'darwin' &&
      !!c.app &&
      (exists(`/Applications/${c.app}`) || exists(`${process.env.HOME ?? ''}/Applications/${c.app}`));
    return { id: c.id, name: c.name, installed: appInstalled || hasBin(c.bin) };
  });
}

function spawnDetached(cmd: string, args: string[]): void {
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => {
      // fire-and-forget:命令不存在等失败静默忽略,不能炸掉 server。
    })
    .unref();
}

/** 在系统文件管理器中显示目录。 */
export function revealDir(dir: string): void {
  if (process.platform === 'darwin') spawnDetached('open', [dir]);
  else if (process.platform === 'win32') spawnDetached('explorer', [dir]);
  else spawnDetached('xdg-open', [dir]);
}

/** 用指定编辑器打开目录;未知编辑器返回 false。 */
export function openInEditor(editorId: string, dir: string): boolean {
  const c = EDITOR_CANDIDATES.find((e) => e.id === editorId);
  if (!c) return false;
  const appPath = c.app ? `/Applications/${c.app}` : null;
  const homeAppPath = c.app ? `${process.env.HOME ?? ''}/Applications/${c.app}` : null;
  const appInstalled =
    process.platform === 'darwin' &&
    !!c.app &&
    ((appPath !== null && fs.existsSync(appPath)) || (homeAppPath !== null && fs.existsSync(homeAppPath)));
  if (appInstalled && c.app) {
    // open -a 接受去掉 .app 的显示名(macOS 约定)。
    spawnDetached('open', ['-a', c.app.replace(/\.app$/, ''), dir]);
  } else {
    spawnDetached(c.bin, [dir]);
  }
  return true;
}
