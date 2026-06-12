// Ephemeral preview scope tokens, mirroring open-design's projectPreviewScopes:
// the preview iframe never gets a raw file route; it gets a minted scope that
// only validates for its own project. Tokens persist under the data root —
// the dev server runs via `tsx watch` and restarts on every server-side edit,
// and a long-lived preview iframe never re-mounts, so in-memory-only tokens
// would leave it stuck on "preview scope not found" until a manual refresh.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT } from './projects.js';

const MAX_PER_PROJECT = 32;

export const previewScopeRe = /^[a-z0-9]{24,64}$/;

function scopesPath(): string {
  // 调用时读 env（而非 import 期冻结的 DATA_ROOT），让测试可经 PI_WEBUI_DATA
  // 隔离（同 webui-settings.ts）。
  const root = process.env.PI_WEBUI_DATA ? path.resolve(process.env.PI_WEBUI_DATA) : DATA_ROOT;
  return path.join(root, 'preview-scopes.json');
}

let cache: Map<string, string[]> | null = null;
let cacheFile: string | null = null;

function load(): Map<string, string[]> {
  const file = scopesPath();
  if (cache && cacheFile === file) return cache;
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // 首次运行 / 文件损坏：按空表处理。
  }
  cache = new Map(
    Object.entries((parsed ?? {}) as Record<string, unknown>)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
      .map(([id, tokens]) => [id, tokens.filter((t) => typeof t === 'string')]),
  );
  cacheFile = file;
  return cache;
}

function persist(map: Map<string, string[]>): void {
  try {
    fs.mkdirSync(path.dirname(scopesPath()), { recursive: true });
    fs.writeFileSync(scopesPath(), JSON.stringify(Object.fromEntries(map)));
  } catch {
    // 持久化失败只影响重启后的有效性，本进程内仍可用。
  }
}

export function mintPreviewScope(projectId: string): string {
  const token = randomBytes(16).toString('hex');
  const map = load();
  const list = map.get(projectId) ?? [];
  list.push(token);
  if (list.length > MAX_PER_PROJECT) list.splice(0, list.length - MAX_PER_PROJECT);
  map.set(projectId, list);
  persist(map);
  return token;
}

export function validatePreviewScope(projectId: string, scope: string): boolean {
  return (load().get(projectId) ?? []).includes(scope);
}
