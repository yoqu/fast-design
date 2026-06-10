# Pi Agent 配置中心实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Pi Web Studio 增加完整的 pi agent 配置能力：直接读写 pi 全局配置（provider/key/模型/thinking、skills、extensions、自定义 provider），加自定义指令（webui 侧）、项目级覆盖、pi 安装检测与引导。

**Architecture:** server 端新增四个模块（pi-config / pi-skills / pi-cli / webui-settings）+ 一个路由文件 pi-routes，全部直接读写 `~/.pi/agent/` 下的 settings.json / auth.json / models.json（读-改-写保留未知字段，损坏拒写）。web 端新增 SettingsDialog（5 个分区，各分区自取数据）、InstallGuide 全屏门控、ProjectSettingsDialog。pi 启动注入经 PiSession 的 lazy config provider 实现。

**Tech Stack:** Express + tsx + vitest（server）；React 18 + Tailwind v4 + Vite（web）。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-06-10-pi-config-center-design.md`

---

## 已核实的 pi 事实（实现必须遵守）

- pi 全局目录 `~/.pi/agent/`：`settings.json`（含 `defaultProvider`/`defaultModel`/`defaultThinkingLevel`/`skills`/`packages` 及几十个其他字段，**写入必须读-改-写保留未知字段**）、`auth.json`（键=provider id，值=字符串 API key 或 OAuth token 对象）、`models.json`（`{providers: {<id>: {baseUrl, api, apiKey, models: [{id, name?, contextWindow?, maxTokens?}]}}}`）、`skills/` 目录。
- 技能发现：skills 根目录下「直接子 `.md` 文件」与「含 SKILL.md 的目录（递归）」。项目级在 `<project>/.pi/skills/`。
- 技能启用/禁用（与 `pi config` TUI 行为一致）：settings.json 的 `skills` 数组写 `-<pattern>`（禁用）/ `+<pattern>`（启用），pattern 为 SKILL.md 相对 skills 根目录的路径（如 `lark-doc/SKILL.md`），根级 .md 技能 pattern 即文件名。项目级技能写项目 `.pi/settings.json`。pi 的匹配逻辑对 SKILL.md 同时接受目录路径（`lark-doc`）。
- `pi --version` → 版本号；命令不存在 = 未安装（spawn ENOENT）。
- `pi --list-models` 输出在 **stderr**，表格格式（header 行 `provider model context max-out thinking images`），**只列已配置凭证的 provider**。
- 已装扩展记录在 settings.json 的 `packages` 数组（字符串或 `{source, ...}` 对象）。安装/卸载用 `pi install <source>` / `pi remove <source>`（argv 传参，不拼 shell）。
- thinking levels：`off` `minimal` `low` `medium` `high` `xhigh`。
- 内置 provider → env var 对照表见 Task 2 代码（来自 pi docs/providers.md）。

## 文件结构

| 文件 | 职责 |
|---|---|
| `server/src/pi-config.ts`（新） | pi 目录定位、JSON 安全读写、settings 三字段、内置 provider 表 + auth.json key 管理、models.json 自定义 provider CRUD |
| `server/src/pi-skills.ts`（新） | 技能扫描、frontmatter 解析、启用/禁用、创建/读/写/删（含路径约束） |
| `server/src/pi-cli.ts`（新） | pi 子进程封装（可注入 runner）：status、list-models 解析、extensions 列表/安装/卸载 |
| `server/src/webui-settings.ts`（新） | 全局自定义指令（`data/webui-settings.json`） |
| `server/src/pi-routes.ts`（新） | 所有 `/api/pi/*` 路由 |
| `server/src/projects.ts`（改） | `updateProject`；meta 增 `thinking`/`instructions` |
| `server/src/types.ts`（改） | `ProjectMeta` 扩展 |
| `server/src/pi-session.ts`（改） | 启动参数从 lazy config 注入 |
| `server/src/index.ts`（改） | 挂 pi-routes、PATCH projects、launchConfigFor |
| `web/src/lib/types.ts`（改） | Pi 配置相关 DTO |
| `web/src/lib/api.ts`（改） | `piApi` |
| `web/src/components/InstallGuide.tsx`（新） | 未安装全屏引导 |
| `web/src/components/settings/ProvidersSection.tsx`（新） | Provider 与模型分区 |
| `web/src/components/settings/SkillsSection.tsx`（新） | Skills 分区 |
| `web/src/components/settings/ExtensionsSection.tsx`（新） | Extensions 分区 |
| `web/src/components/settings/InstructionsSection.tsx`（新） | 自定义指令分区 |
| `web/src/components/settings/AboutSection.tsx`（新） | 关于分区 |
| `web/src/components/settings/SettingsDialog.tsx`（新） | 设置弹窗壳 + 分区导航 |
| `web/src/components/ProjectSettingsDialog.tsx`（新） | 项目级配置弹窗 |
| `web/src/components/Sidebar.tsx`（改） | 齿轮入口 + 新建项目 model 下拉 |
| `web/src/components/Workspace.tsx`（改） | 顶栏项目设置入口 |
| `web/src/App.tsx`（改） | 安装门控 + 弹窗装配 |

## 并行波次（subagent 派发用）

- **Wave 1（4 个并行 agent，互不碰同一文件）**：Task 1（pi-config）、Task 2（pi-skills）、Task 3（pi-cli)、Task 4（webui-settings + projects/types）
- **Wave 2（1 个 agent）**：Task 5（pi-session + pi-routes + index 集成）
- **Wave 3（1 个 agent）**：Task 6（web lib + InstallGuide + App 门控）
- **Wave 4（4 个并行 agent）**：Task 7（ProvidersSection）、Task 8（SkillsSection）、Task 9（ExtensionsSection+InstructionsSection+AboutSection）、Task 10（ProjectSettingsDialog + Workspace）
- **Wave 5（1 个 agent）**：Task 11（SettingsDialog 装配 + Sidebar + App 接线 + 全量验证）

各分区组件 **props 契约**（Wave 4 各 agent 必须遵守，全部自行 fetch 数据）：

```ts
ProvidersSection: 无 props
SkillsSection: { projectId: string | null }
ExtensionsSection / InstructionsSection / AboutSection: 无 props
ProjectSettingsDialog: { meta: ProjectMeta; onClose: () => void; onSaved: (meta: ProjectMeta) => void }
SettingsDialog: { projectId: string | null; onClose: () => void }
```

通用约定：

- 测试命令：`pnpm --filter server test`（vitest run）；类型检查 `pnpm --filter server build` / `pnpm --filter web build`。
- server 模块用 ESM `.js` 后缀导入（现有惯例）。
- 错误约定：配置文件损坏抛 `ConfigCorruptError`（路由层 → 500）；路径越界抛含 `BAD_PATH` 的 Error（→400）；OAuth 凭证写删 → 409。
- 中文 UI 文案、zinc 色系 Tailwind（与现有组件一致）。

---

### Task 1: pi-config 模块（settings / auth / models.json）

**Files:**
- Create: `server/src/pi-config.ts`
- Test: `server/src/pi-config.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// server/src/pi-config.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigCorruptError,
  deleteCustomProvider,
  deleteProviderKey,
  getPiSettings,
  listCustomProviders,
  listProviders,
  piAgentDir,
  setProviderKey,
  updatePiSettings,
  upsertCustomProvider,
} from './pi-config.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-config-test-'));
  process.env.PI_WEBUI_PI_DIR = dir;
});

afterEach(() => {
  delete process.env.PI_WEBUI_PI_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('piAgentDir', () => {
  it('uses env override', () => {
    expect(piAgentDir()).toBe(dir);
  });
});

describe('settings', () => {
  it('returns nulls when settings.json missing', () => {
    expect(getPiSettings()).toEqual({
      defaultProvider: null,
      defaultModel: null,
      defaultThinkingLevel: null,
    });
  });

  it('updates known fields and preserves unknown fields', () => {
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ defaultProvider: 'openai', compaction: { enabled: true }, theme: 'dark' }),
    );
    updatePiSettings({ defaultProvider: 'anthropic', defaultModel: 'claude-x' });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect(raw.defaultProvider).toBe('anthropic');
    expect(raw.defaultModel).toBe('claude-x');
    expect(raw.compaction).toEqual({ enabled: true });
    expect(raw.theme).toBe('dark');
  });

  it('clears a field when given null', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ defaultModel: 'x' }));
    updatePiSettings({ defaultModel: null });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect('defaultModel' in raw).toBe(false);
  });

  it('throws ConfigCorruptError on broken json and never writes', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{broken');
    expect(() => getPiSettings()).toThrow(ConfigCorruptError);
    expect(() => updatePiSettings({ defaultModel: 'x' })).toThrow(ConfigCorruptError);
    expect(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).toBe('{broken');
  });
});

describe('providers / auth.json', () => {
  it('lists builtin providers with configured state and masked tail', () => {
    fs.writeFileSync(
      path.join(dir, 'auth.json'),
      JSON.stringify({ 'minimax-cn': 'sk-abcdef1234', anthropic: { type: 'oauth', access: 't' } }),
    );
    const { builtin, extraAuth } = listProviders();
    const mm = builtin.find((p) => p.id === 'minimax-cn')!;
    expect(mm.configured).toBe(true);
    expect(mm.keyTail).toBe('1234');
    expect(mm.oauth).toBe(false);
    const anthropic = builtin.find((p) => p.id === 'anthropic')!;
    expect(anthropic.configured).toBe(true);
    expect(anthropic.oauth).toBe(true);
    expect(anthropic.keyTail).toBeNull();
    const openai = builtin.find((p) => p.id === 'openai')!;
    expect(openai.configured).toBe(false);
    expect(extraAuth).toEqual([]);
  });

  it('reports unknown auth.json entries as extraAuth', () => {
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ 'github-copilot': { t: 1 } }));
    expect(listProviders().extraAuth).toEqual(['github-copilot']);
  });

  it('sets and deletes keys, creating auth.json on demand', () => {
    setProviderKey('openai', 'sk-test9999');
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'), 'utf8'));
    expect(raw.openai).toBe('sk-test9999');
    deleteProviderKey('openai');
    expect('openai' in JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'), 'utf8'))).toBe(false);
  });

  it('refuses to overwrite or delete oauth credentials', () => {
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ anthropic: { type: 'oauth' } }));
    expect(() => setProviderKey('anthropic', 'sk-x')).toThrow(/OAUTH_READONLY/);
    expect(() => deleteProviderKey('anthropic')).toThrow(/OAUTH_READONLY/);
  });

  it('rejects unknown provider ids', () => {
    expect(() => setProviderKey('not-a-provider', 'k')).toThrow(/UNKNOWN_PROVIDER/);
  });
});

describe('custom providers / models.json', () => {
  it('round-trips create, list (masked), update, delete', () => {
    upsertCustomProvider('ollama', {
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKey: 'ollama-key',
      models: [{ id: 'llama3.1:8b' }, { id: 'qwen3', name: 'Qwen 3', contextWindow: 32768 }],
    });
    const list = listCustomProviders();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('ollama');
    expect(list[0].apiKeyTail).toBe('-key');
    expect((list[0] as Record<string, unknown>).apiKey).toBeUndefined();
    expect(list[0].models[1]).toEqual({ id: 'qwen3', name: 'Qwen 3', contextWindow: 32768 });

    // update without apiKey keeps the stored key
    upsertCustomProvider('ollama', {
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      models: [{ id: 'llama3.1:8b' }],
    });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8'));
    expect(raw.providers.ollama.apiKey).toBe('ollama-key');

    deleteCustomProvider('ollama');
    expect(listCustomProviders()).toEqual([]);
  });

  it('preserves unknown fields in models.json', () => {
    fs.writeFileSync(
      path.join(dir, 'models.json'),
      JSON.stringify({ providers: { keep: { baseUrl: 'x', api: 'openai-completions', apiKey: 'k', models: [], compat: { supportsDeveloperRole: false } } } }),
    );
    upsertCustomProvider('other', { baseUrl: 'y', api: 'anthropic-messages', apiKey: 'k2', models: [] });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8'));
    expect(raw.providers.keep.compat).toEqual({ supportsDeveloperRole: false });
  });

  it('validates custom provider id format', () => {
    expect(() => upsertCustomProvider('Bad Id!', { baseUrl: 'x', api: 'openai-completions', models: [] })).toThrow(/BAD_ID/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter server test -- pi-config`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `server/src/pi-config.ts`**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** pi 的全局配置目录；测试经 PI_WEBUI_PI_DIR 覆盖。 */
export function piAgentDir(): string {
  return process.env.PI_WEBUI_PI_DIR ?? path.join(os.homedir(), '.pi', 'agent');
}

export class ConfigCorruptError extends Error {
  constructor(public readonly file: string) {
    super(`配置文件损坏: ${file}`);
  }
}

/** 读 JSON：文件缺失 → fallback；解析失败 → ConfigCorruptError（绝不覆盖用户文件）。 */
export function readJsonConfig<T>(file: string, fallback: T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ConfigCorruptError(file);
  }
}

/** 读-改-写：mutate 收到解析后的对象（含未知字段），返回值整体写回。 */
function updateJsonConfig<T extends object>(file: string, fallback: T, mutate: (current: T) => T): void {
  const current = readJsonConfig(file, fallback);
  const next = mutate(current);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

// ---- settings.json ----

export type PiSettingsView = {
  defaultProvider: string | null;
  defaultModel: string | null;
  defaultThinkingLevel: string | null;
};

type RawSettings = Record<string, unknown>;

function settingsPath(): string {
  return path.join(piAgentDir(), 'settings.json');
}

export function readRawPiSettings(): RawSettings {
  return readJsonConfig<RawSettings>(settingsPath(), {});
}

export function getPiSettings(): PiSettingsView {
  const raw = readRawPiSettings();
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    defaultProvider: str(raw.defaultProvider),
    defaultModel: str(raw.defaultModel),
    defaultThinkingLevel: str(raw.defaultThinkingLevel),
  };
}

/** patch 里 undefined = 不动；null = 删除该字段；字符串 = 设置。 */
export function updatePiSettings(patch: Partial<PiSettingsView>): PiSettingsView {
  updateJsonConfig<RawSettings>(settingsPath(), {}, (raw) => {
    for (const key of ['defaultProvider', 'defaultModel', 'defaultThinkingLevel'] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value === null) delete raw[key];
      else raw[key] = value;
    }
    return raw;
  });
  return getPiSettings();
}

// ---- 内置 provider 对照表（pi docs/providers.md，pi v0.78.0）----

export type BuiltinProviderDef = { id: string; label: string; envVar: string };

export const BUILTIN_PROVIDERS: BuiltinProviderDef[] = [
  { id: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
  { id: 'azure-openai-responses', label: 'Azure OpenAI', envVar: 'AZURE_OPENAI_API_KEY' },
  { id: 'google', label: 'Google Gemini', envVar: 'GEMINI_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
  { id: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY' },
  { id: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY' },
  { id: 'cerebras', label: 'Cerebras', envVar: 'CEREBRAS_API_KEY' },
  { id: 'cloudflare-ai-gateway', label: 'Cloudflare AI Gateway', envVar: 'CLOUDFLARE_API_KEY' },
  { id: 'cloudflare-workers-ai', label: 'Cloudflare Workers AI', envVar: 'CLOUDFLARE_API_KEY' },
  { id: 'xai', label: 'xAI', envVar: 'XAI_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
  { id: 'vercel-ai-gateway', label: 'Vercel AI Gateway', envVar: 'AI_GATEWAY_API_KEY' },
  { id: 'zai', label: 'ZAI', envVar: 'ZAI_API_KEY' },
  { id: 'opencode', label: 'OpenCode Zen', envVar: 'OPENCODE_API_KEY' },
  { id: 'opencode-go', label: 'OpenCode Go', envVar: 'OPENCODE_API_KEY' },
  { id: 'huggingface', label: 'Hugging Face', envVar: 'HF_TOKEN' },
  { id: 'fireworks', label: 'Fireworks', envVar: 'FIREWORKS_API_KEY' },
  { id: 'together', label: 'Together AI', envVar: 'TOGETHER_API_KEY' },
  { id: 'kimi-coding', label: 'Kimi For Coding', envVar: 'KIMI_API_KEY' },
  { id: 'minimax', label: 'MiniMax', envVar: 'MINIMAX_API_KEY' },
  { id: 'minimax-cn', label: 'MiniMax (China)', envVar: 'MINIMAX_CN_API_KEY' },
  { id: 'xiaomi', label: 'Xiaomi MiMo', envVar: 'XIAOMI_API_KEY' },
  { id: 'xiaomi-token-plan-cn', label: 'Xiaomi Token Plan (CN)', envVar: 'XIAOMI_TOKEN_PLAN_CN_API_KEY' },
  { id: 'xiaomi-token-plan-ams', label: 'Xiaomi Token Plan (AMS)', envVar: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY' },
  { id: 'xiaomi-token-plan-sgp', label: 'Xiaomi Token Plan (SGP)', envVar: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY' },
];

// ---- auth.json ----

type AuthFile = Record<string, unknown>;

function authPath(): string {
  return path.join(piAgentDir(), 'auth.json');
}

export type ProviderStatus = BuiltinProviderDef & {
  configured: boolean;
  /** 字符串 key 的尾 4 位；OAuth 凭证为 null。 */
  keyTail: string | null;
  oauth: boolean;
};

export function listProviders(): { builtin: ProviderStatus[]; extraAuth: string[] } {
  const auth = readJsonConfig<AuthFile>(authPath(), {});
  const builtin = BUILTIN_PROVIDERS.map((def) => {
    const value = auth[def.id];
    const oauth = typeof value === 'object' && value !== null;
    const key = typeof value === 'string' ? value : null;
    return {
      ...def,
      configured: value !== undefined,
      keyTail: key ? key.slice(-4) : null,
      oauth,
    };
  });
  const known = new Set(BUILTIN_PROVIDERS.map((d) => d.id));
  const extraAuth = Object.keys(auth).filter((k) => !known.has(k));
  return { builtin, extraAuth };
}

function assertWritableAuthEntry(auth: AuthFile, providerId: string): void {
  const value = auth[providerId];
  if (typeof value === 'object' && value !== null) {
    throw new Error(`OAUTH_READONLY: ${providerId} 使用 OAuth 凭证，请在终端用 pi /login 管理`);
  }
}

export function setProviderKey(providerId: string, key: string): void {
  if (!BUILTIN_PROVIDERS.some((d) => d.id === providerId)) {
    throw new Error(`UNKNOWN_PROVIDER: ${providerId}`);
  }
  updateJsonConfig<AuthFile>(authPath(), {}, (auth) => {
    assertWritableAuthEntry(auth, providerId);
    auth[providerId] = key;
    return auth;
  });
}

export function deleteProviderKey(providerId: string): void {
  updateJsonConfig<AuthFile>(authPath(), {}, (auth) => {
    assertWritableAuthEntry(auth, providerId);
    delete auth[providerId];
    return auth;
  });
}

// ---- models.json（自定义 provider）----

export type CustomModel = { id: string; name?: string; contextWindow?: number; maxTokens?: number };
export type CustomProviderInput = {
  baseUrl: string;
  api: string;
  apiKey?: string;
  models: CustomModel[];
};
export type CustomProviderView = {
  id: string;
  baseUrl: string;
  api: string;
  apiKeyTail: string | null;
  models: CustomModel[];
};

export const CUSTOM_PROVIDER_APIS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const;

type ModelsFile = { providers?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

function modelsPath(): string {
  return path.join(piAgentDir(), 'models.json');
}

const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function listCustomProviders(): CustomProviderView[] {
  const file = readJsonConfig<ModelsFile>(modelsPath(), {});
  const providers = file.providers ?? {};
  return Object.entries(providers).map(([id, p]) => {
    const apiKey = typeof p.apiKey === 'string' ? p.apiKey : null;
    return {
      id,
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
      api: typeof p.api === 'string' ? p.api : '',
      apiKeyTail: apiKey ? apiKey.slice(-4) : null,
      models: Array.isArray(p.models) ? (p.models as CustomModel[]) : [],
    };
  });
}

export function upsertCustomProvider(id: string, input: CustomProviderInput): void {
  if (!CUSTOM_ID_RE.test(id)) throw new Error(`BAD_ID: ${id}（仅小写字母/数字/-/_）`);
  updateJsonConfig<ModelsFile>(modelsPath(), {}, (file) => {
    const providers = (file.providers ??= {});
    const existing = providers[id] ?? {};
    const next: Record<string, unknown> = {
      ...existing,
      baseUrl: input.baseUrl,
      api: input.api,
      models: input.models,
    };
    if (input.apiKey !== undefined && input.apiKey !== '') next.apiKey = input.apiKey;
    providers[id] = next;
    return file;
  });
}

export function deleteCustomProvider(id: string): void {
  updateJsonConfig<ModelsFile>(modelsPath(), {}, (file) => {
    if (file.providers) delete file.providers[id];
    return file;
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter server test -- pi-config` → PASS；`pnpm --filter server build` → 无类型错误

- [ ] **Step 5: Commit**

```bash
git add server/src/pi-config.ts server/src/pi-config.test.ts
git commit -m "feat(server): pi-config 模块——settings/auth/models.json 读写"
```

---

### Task 2: pi-skills 模块

**Files:**
- Create: `server/src/pi-skills.ts`
- Test: `server/src/pi-skills.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// server/src/pi-skills.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSkill,
  deleteSkill,
  listSkills,
  readSkillContent,
  setSkillEnabled,
  writeSkillContent,
} from './pi-skills.js';

let piDir: string;
let projDir: string;

function writeSkill(root: string, name: string, frontmatter = `---\nname: ${name}\ndescription: 技能 ${name}\n---\n\n正文`) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), frontmatter);
}

beforeEach(() => {
  piDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skills-pi-'));
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skills-proj-'));
  process.env.PI_WEBUI_PI_DIR = piDir;
});

afterEach(() => {
  delete process.env.PI_WEBUI_PI_DIR;
  fs.rmSync(piDir, { recursive: true, force: true });
  fs.rmSync(projDir, { recursive: true, force: true });
});

describe('listSkills', () => {
  it('discovers dir skills, root md skills, and project skills', () => {
    const root = path.join(piDir, 'skills');
    writeSkill(root, 'alpha');
    fs.writeFileSync(path.join(root, 'solo.md'), '---\nname: solo\ndescription: 单文件\n---\n');
    fs.mkdirSync(path.join(root, 'nested', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'nested', 'deep', 'SKILL.md'), '---\nname: deep\ndescription: 嵌套\n---\n');
    writeSkill(path.join(projDir, '.pi', 'skills'), 'proj-skill');

    const skills = listSkills(projDir);
    const rels = skills.map((s) => `${s.scope}:${s.rel}`).sort();
    expect(rels).toEqual(['global:alpha', 'global:nested/deep', 'global:solo.md', 'project:proj-skill']);
    expect(skills.find((s) => s.rel === 'alpha')!.description).toBe('技能 alpha');
    expect(skills.every((s) => s.enabled)).toBe(true);
  });

  it('reflects disabled state from settings.json patterns (both dir and SKILL.md forms)', () => {
    const root = path.join(piDir, 'skills');
    writeSkill(root, 'alpha');
    writeSkill(root, 'beta');
    fs.writeFileSync(
      path.join(piDir, 'settings.json'),
      JSON.stringify({ skills: ['-alpha/SKILL.md', '-beta'] }),
    );
    const skills = listSkills(null);
    expect(skills.find((s) => s.rel === 'alpha')!.enabled).toBe(false);
    expect(skills.find((s) => s.rel === 'beta')!.enabled).toBe(false);
  });
});

describe('setSkillEnabled', () => {
  it('writes -pattern to global settings and removes it on re-enable, preserving other entries', () => {
    writeSkill(path.join(piDir, 'skills'), 'alpha');
    fs.writeFileSync(path.join(piDir, 'settings.json'), JSON.stringify({ theme: 'dark', skills: ['~/extra'] }));
    setSkillEnabled('global', 'alpha', false, null);
    let raw = JSON.parse(fs.readFileSync(path.join(piDir, 'settings.json'), 'utf8'));
    expect(raw.skills).toEqual(['~/extra', '-alpha/SKILL.md']);
    expect(raw.theme).toBe('dark');
    setSkillEnabled('global', 'alpha', true, null);
    raw = JSON.parse(fs.readFileSync(path.join(piDir, 'settings.json'), 'utf8'));
    expect(raw.skills).toEqual(['~/extra', '+alpha/SKILL.md']);
  });

  it('writes project toggles to <project>/.pi/settings.json', () => {
    writeSkill(path.join(projDir, '.pi', 'skills'), 'p1');
    setSkillEnabled('project', 'p1', false, projDir);
    const raw = JSON.parse(fs.readFileSync(path.join(projDir, '.pi', 'settings.json'), 'utf8'));
    expect(raw.skills).toEqual(['-p1/SKILL.md']);
  });
});

describe('create / read / write / delete', () => {
  it('creates a skill with template and validates names', () => {
    const skill = createSkill('my-skill', '我的技能');
    expect(skill.rel).toBe('my-skill');
    const content = readSkillContent('global', 'my-skill', null);
    expect(content).toContain('name: my-skill');
    expect(content).toContain('description: 我的技能');
    expect(() => createSkill('Bad Name', 'x')).toThrow(/BAD_NAME/);
    expect(() => createSkill('my-skill', 'dup')).toThrow(/SKILL_EXISTS/);
  });

  it('writes content only with valid frontmatter', () => {
    createSkill('w1', 'desc');
    expect(() => writeSkillContent('global', 'w1', '没有 frontmatter', null)).toThrow(/BAD_FRONTMATTER/);
    writeSkillContent('global', 'w1', '---\nname: w1\ndescription: 新描述\n---\n\n新正文', null);
    expect(readSkillContent('global', 'w1', null)).toContain('新描述');
  });

  it('deletes skill directories and root md skills', () => {
    createSkill('gone', 'x');
    deleteSkill('global', 'gone', null);
    expect(listSkills(null)).toEqual([]);
  });

  it('rejects path traversal', () => {
    expect(() => readSkillContent('global', '../../../etc/passwd', null)).toThrow(/BAD_PATH/);
    expect(() => deleteSkill('global', '..', null)).toThrow(/BAD_PATH/);
    expect(() => writeSkillContent('project', '../x', '---\nname: a\ndescription: b\n---\n', projDir)).toThrow(/BAD_PATH/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter server test -- pi-skills` → FAIL

- [ ] **Step 3: 实现 `server/src/pi-skills.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { piAgentDir, readJsonConfig } from './pi-config.js';

export type SkillScope = 'global' | 'project';

export type SkillInfo = {
  name: string;
  description: string;
  /** 相对 skills 根目录：目录技能为目录相对路径，根级 .md 技能为文件名。 */
  rel: string;
  scope: SkillScope;
  enabled: boolean;
};

function globalSkillsRoot(): string {
  return path.join(piAgentDir(), 'skills');
}

function projectSkillsRoot(projectDir: string): string {
  return path.join(projectDir, '.pi', 'skills');
}

function skillsRoot(scope: SkillScope, projectDir: string | null): string {
  if (scope === 'global') return globalSkillsRoot();
  if (!projectDir) throw new Error('BAD_PATH: project scope 需要 projectDir');
  return projectSkillsRoot(projectDir);
}

/** rel → 技能内容文件绝对路径（含越界校验）。根级 .md 技能 rel 以 .md 结尾。 */
function resolveSkillFile(scope: SkillScope, rel: string, projectDir: string | null): string {
  const root = skillsRoot(scope, projectDir);
  const target = rel.endsWith('.md') ? rel : path.join(rel, 'SKILL.md');
  const abs = path.resolve(root, target);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`BAD_PATH: ${rel}`);
  if (abs === root) throw new Error(`BAD_PATH: ${rel}`);
  return abs;
}

/** 与 pi config TUI 一致的开关 pattern：SKILL.md 相对 skills 根目录的路径。 */
function togglePattern(rel: string): string {
  return rel.endsWith('.md') ? rel : `${rel}/SKILL.md`;
}

// ---- frontmatter ----

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export function parseFrontmatter(content: string): { name: string | null; description: string | null } {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return { name: null, description: null };
  const get = (key: string): string | null => {
    const line = match[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    if (!line) return null;
    return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') || null;
  };
  return { name: get('name'), description: get('description') };
}

// ---- 扫描 ----

function disabledPatterns(scope: SkillScope, projectDir: string | null): Set<string> {
  const file =
    scope === 'global'
      ? path.join(piAgentDir(), 'settings.json')
      : path.join(projectDir ?? '', '.pi', 'settings.json');
  const raw = readJsonConfig<Record<string, unknown>>(file, {});
  const entries = Array.isArray(raw.skills) ? (raw.skills as string[]) : [];
  const out = new Set<string>();
  for (const e of entries) {
    if (typeof e === 'string' && e.startsWith('-')) out.add(e.slice(1));
  }
  return out;
}

function isDisabled(rel: string, disabled: Set<string>): boolean {
  // pi 对 SKILL.md 的 exact-pattern 同时匹配文件路径与父目录路径。
  if (rel.endsWith('.md') && !rel.endsWith('/SKILL.md') && rel !== 'SKILL.md') return disabled.has(rel);
  return disabled.has(togglePattern(rel)) || disabled.has(rel);
}

function scanRoot(root: string, scope: SkillScope, disabled: Set<string>): SkillInfo[] {
  const out: SkillInfo[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  const pushSkill = (rel: string, contentFile: string) => {
    let content = '';
    try {
      content = fs.readFileSync(contentFile, 'utf8');
    } catch {
      return;
    }
    const fm = parseFrontmatter(content);
    const fallback = rel.endsWith('.md') ? path.basename(rel, '.md') : path.basename(rel);
    out.push({
      name: fm.name ?? fallback,
      description: fm.description ?? '',
      rel,
      scope,
      enabled: !isDisabled(rel, disabled),
    });
  };
  const walk = (dir: string) => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const skillMd = dirents.find((d) => d.isFile() && d.name === 'SKILL.md');
    if (skillMd) {
      pushSkill(path.relative(root, dir).split(path.sep).join('/'), path.join(dir, 'SKILL.md'));
      return; // 技能目录不再向下递归
    }
    for (const d of dirents) if (d.isDirectory()) walk(path.join(dir, d.name));
  };
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) pushSkill(entry.name, path.join(root, entry.name));
    else if (entry.isDirectory()) walk(path.join(root, entry.name));
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function listSkills(projectDir: string | null): SkillInfo[] {
  const out = scanRoot(globalSkillsRoot(), 'global', disabledPatterns('global', null));
  if (projectDir) {
    out.push(...scanRoot(projectSkillsRoot(projectDir), 'project', disabledPatterns('project', projectDir)));
  }
  return out;
}

// ---- 启用/禁用 ----

export function setSkillEnabled(scope: SkillScope, rel: string, enabled: boolean, projectDir: string | null): void {
  resolveSkillFile(scope, rel, projectDir); // 路径校验
  const file =
    scope === 'global'
      ? path.join(piAgentDir(), 'settings.json')
      : path.join(projectDir!, '.pi', 'settings.json');
  const raw = readJsonConfig<Record<string, unknown>>(file, {});
  const pattern = togglePattern(rel);
  const current = Array.isArray(raw.skills) ? (raw.skills as string[]) : [];
  // 与 pi config TUI 一致：清掉该资源的既有 ± 条目，再追加新状态。
  const updated = current.filter((p) => {
    const stripped = p.startsWith('!') || p.startsWith('+') || p.startsWith('-') ? p.slice(1) : p;
    return stripped !== pattern && stripped !== rel;
  });
  updated.push(enabled ? `+${pattern}` : `-${pattern}`);
  raw.skills = updated;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
}

// ---- CRUD ----

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function createSkill(name: string, description: string): SkillInfo {
  if (!SKILL_NAME_RE.test(name)) throw new Error(`BAD_NAME: ${name}（仅小写字母/数字/连字符）`);
  const dir = path.join(globalSkillsRoot(), name);
  if (fs.existsSync(dir)) throw new Error(`SKILL_EXISTS: ${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const desc = description.trim() || name;
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n在这里编写技能说明。\n`,
  );
  return { name, description: desc, rel: name, scope: 'global', enabled: true };
}

export function readSkillContent(scope: SkillScope, rel: string, projectDir: string | null): string {
  return fs.readFileSync(resolveSkillFile(scope, rel, projectDir), 'utf8');
}

export function writeSkillContent(scope: SkillScope, rel: string, content: string, projectDir: string | null): void {
  const file = resolveSkillFile(scope, rel, projectDir);
  const fm = parseFrontmatter(content);
  if (!fm.name || !fm.description) {
    throw new Error('BAD_FRONTMATTER: SKILL.md 必须以 frontmatter 开头且包含 name 与 description');
  }
  fs.writeFileSync(file, content);
}

export function deleteSkill(scope: SkillScope, rel: string, projectDir: string | null): void {
  const file = resolveSkillFile(scope, rel, projectDir);
  if (rel.endsWith('.md')) fs.rmSync(file, { force: true });
  else fs.rmSync(path.dirname(file), { recursive: true, force: true });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter server test -- pi-skills` → PASS；`pnpm --filter server build` → 通过

- [ ] **Step 5: Commit**

```bash
git add server/src/pi-skills.ts server/src/pi-skills.test.ts
git commit -m "feat(server): pi-skills 模块——技能扫描/开关/CRUD"
```

---

### Task 3: pi-cli 模块（status / list-models / extensions）

**Files:**
- Create: `server/src/pi-cli.ts`
- Test: `server/src/pi-cli.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// server/src/pi-cli.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type PiRunner,
  getPiStatus,
  installExtension,
  listExtensions,
  listModels,
  removeExtension,
  validateExtensionSource,
} from './pi-cli.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cli-test-'));
  process.env.PI_WEBUI_PI_DIR = dir;
});

afterEach(() => {
  delete process.env.PI_WEBUI_PI_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const ok = (stdout: string, stderr = ''): ReturnType<PiRunner> =>
  Promise.resolve({ code: 0, stdout, stderr });

describe('getPiStatus', () => {
  it('reports installed with version', async () => {
    const runner: PiRunner = () => ok('0.78.0\n');
    expect(await getPiStatus(runner)).toEqual({ installed: true, version: '0.78.0', piDir: dir });
  });

  it('reports not installed on ENOENT', async () => {
    const runner: PiRunner = () => Promise.reject(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    expect(await getPiStatus(runner)).toEqual({ installed: false, version: null, piDir: dir });
  });
});

describe('listModels', () => {
  it('parses the table from stderr, skipping the header', async () => {
    const table = [
      'provider    model                   context  max-out  thinking  images',
      'minimax-cn  MiniMax-M2.7            204.8K   131.1K   yes       no',
      'minimax-cn  MiniMax-M2.7-highspeed  204.8K   131.1K   yes       no',
      '',
    ].join('\n');
    const runner: PiRunner = () => ok('', table);
    expect(await listModels(runner)).toEqual([
      { provider: 'minimax-cn', id: 'MiniMax-M2.7' },
      { provider: 'minimax-cn', id: 'MiniMax-M2.7-highspeed' },
    ]);
  });
});

describe('extensions', () => {
  it('lists packages from settings.json (string and object form)', () => {
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ packages: ['pi-skills', { source: 'git:github.com/u/repo', skills: [] }] }),
    );
    expect(listExtensions()).toEqual([{ source: 'pi-skills' }, { source: 'git:github.com/u/repo' }]);
  });

  it('validates sources', () => {
    expect(validateExtensionSource('pi-skills')).toBe(true);
    expect(validateExtensionSource('@org/pkg')).toBe(true);
    expect(validateExtensionSource('git:github.com/u/repo@v1')).toBe(true);
    expect(validateExtensionSource('pkg; rm -rf /')).toBe(false);
    expect(validateExtensionSource('a b')).toBe(false);
    expect(validateExtensionSource('')).toBe(false);
  });

  it('install/remove run pi with argv and serialize concurrent installs', async () => {
    const calls: string[][] = [];
    const runner: PiRunner = (args) => {
      calls.push(args);
      return ok('installed\n');
    };
    const r = await installExtension('pi-skills', runner);
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['install', 'pi-skills']);
    await removeExtension('pi-skills', runner);
    expect(calls[1]).toEqual(['remove', 'pi-skills']);
    await expect(installExtension('bad source!', runner)).rejects.toThrow(/BAD_SOURCE/);
  });

  it('reports failure output when pi exits non-zero', async () => {
    const runner: PiRunner = () => Promise.resolve({ code: 1, stdout: '', stderr: 'not found' });
    const r = await installExtension('nope-pkg', runner);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('not found');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter server test -- pi-cli` → FAIL

- [ ] **Step 3: 实现 `server/src/pi-cli.ts`**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter server test -- pi-cli` → PASS；`pnpm --filter server build` → 通过

- [ ] **Step 5: Commit**

```bash
git add server/src/pi-cli.ts server/src/pi-cli.test.ts
git commit -m "feat(server): pi-cli 模块——安装检测/模型列表/扩展管理"
```

---

### Task 4: webui-settings + projects 项目级字段

**Files:**
- Create: `server/src/webui-settings.ts`
- Modify: `server/src/projects.ts`（新增 `updateProject`）
- Modify: `server/src/types.ts`（`ProjectMeta` 增 `thinking`/`instructions`）
- Test: `server/src/webui-settings.test.ts`、`server/src/projects.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

```ts
// server/src/webui-settings.test.ts
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readWebuiSettings, webuiSettingsPath, writeWebuiSettings } from './webui-settings.js';

let original: string | null = null;

beforeAll(() => {
  try {
    original = fs.readFileSync(webuiSettingsPath(), 'utf8');
  } catch {
    original = null;
  }
});

afterAll(() => {
  if (original === null) fs.rmSync(webuiSettingsPath(), { force: true });
  else fs.writeFileSync(webuiSettingsPath(), original);
});

describe('webui-settings', () => {
  it('returns empty settings when file missing', () => {
    fs.rmSync(webuiSettingsPath(), { force: true });
    expect(readWebuiSettings()).toEqual({});
  });

  it('round-trips instructions', () => {
    writeWebuiSettings({ instructions: '全局指令' });
    expect(readWebuiSettings().instructions).toBe('全局指令');
  });
});
```

在 `server/src/projects.test.ts` 末尾（`describe('projects', ...)` 内）追加：

```ts
  it('updates project meta fields partially', () => {
    const meta = createProject('patch-me');
    created.push(meta.id);
    const updated = updateProject(meta.id, { model: 'minimax-cn/MiniMax-M2.7', thinking: 'high' });
    expect(updated?.model).toBe('minimax-cn/MiniMax-M2.7');
    expect(updated?.thinking).toBe('high');
    expect(updated?.name).toBe('patch-me');
    const cleared = updateProject(meta.id, { model: null, instructions: '项目指令' });
    expect(cleared?.model).toBeNull();
    expect(cleared?.thinking).toBe('high');
    expect(cleared?.instructions).toBe('项目指令');
  });
```

同时把 `updateProject` 加进该文件顶部的 import。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter server test -- webui-settings projects` → FAIL

- [ ] **Step 3: 实现**

`server/src/webui-settings.ts`：

```ts
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT } from './projects.js';

export type WebuiSettings = { instructions?: string };

export function webuiSettingsPath(): string {
  return path.join(DATA_ROOT, 'webui-settings.json');
}

export function readWebuiSettings(): WebuiSettings {
  try {
    return JSON.parse(fs.readFileSync(webuiSettingsPath(), 'utf8')) as WebuiSettings;
  } catch {
    return {};
  }
}

export function writeWebuiSettings(patch: WebuiSettings): WebuiSettings {
  const next = { ...readWebuiSettings(), ...patch };
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(webuiSettingsPath(), JSON.stringify(next, null, 2));
  return next;
}
```

`server/src/types.ts` 中 `ProjectMeta` 改为（保持其余类型不动）：

```ts
export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  model?: string | null;
  thinking?: string | null;
  instructions?: string | null;
};
```

`server/src/projects.ts` 追加（`createProject` 之后）：

```ts
export type ProjectMetaPatch = {
  model?: string | null;
  thinking?: string | null;
  instructions?: string | null;
};

/** 部分更新项目 meta；undefined 字段不动，null 表示清除。 */
export function updateProject(id: string, patch: ProjectMetaPatch): ProjectMeta | null {
  const meta = getProject(id);
  if (!meta) return null;
  const next: ProjectMeta = { ...meta };
  for (const key of ['model', 'thinking', 'instructions'] as const) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  fs.writeFileSync(metaPath(id), JSON.stringify(next, null, 2));
  return next;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter server test` → 全部 PASS；`pnpm --filter server build` → 通过

- [ ] **Step 5: Commit**

```bash
git add server/src/webui-settings.ts server/src/webui-settings.test.ts server/src/projects.ts server/src/projects.test.ts server/src/types.ts
git commit -m "feat(server): 全局自定义指令存储与项目 meta 部分更新"
```

---

### Task 5: 路由集成 + pi-session 启动注入（依赖 Task 1-4）

**Files:**
- Create: `server/src/pi-routes.ts`
- Modify: `server/src/pi-session.ts`、`server/src/index.ts`

- [ ] **Step 1: 改造 `server/src/pi-session.ts`**

仅改构造函数与 `ensureChild` 的 args 组装，其余不动：

```ts
// 顶部新增导出类型
export type SessionLaunchConfig = {
  model: string | null;
  thinking: string | null;
  /** 追加在内置 SYSTEM_PROMPT_SUFFIX 之后的系统提示段（全局指令、项目指令）。 */
  appendPrompts: string[];
};
```

构造函数改为：

```ts
  constructor(
    private readonly cwd: string,
    private readonly getConfig: () => SessionLaunchConfig,
  ) {}
```

`ensureChild()` 中 args 组装段替换为：

```ts
    const cfg = this.getConfig();
    const args = ['--mode', 'rpc', '--session-dir', this.sessionDir()];
    for (const prompt of [SYSTEM_PROMPT_SUFFIX, ...cfg.appendPrompts]) {
      args.push('--append-system-prompt', prompt);
    }
    if (this.hasPriorSessions()) args.push('--continue');
    if (cfg.model && cfg.model !== 'default') args.push('--model', cfg.model);
    if (cfg.thinking) args.push('--thinking', cfg.thinking);
```

- [ ] **Step 2: 实现 `server/src/pi-routes.ts`**

```ts
import express from 'express';
import { projectDir, getProject } from './projects.js';
import {
  CUSTOM_PROVIDER_APIS,
  ConfigCorruptError,
  deleteCustomProvider,
  deleteProviderKey,
  getPiSettings,
  listCustomProviders,
  listProviders,
  setProviderKey,
  updatePiSettings,
  upsertCustomProvider,
} from './pi-config.js';
import {
  createSkill,
  deleteSkill,
  listSkills,
  readSkillContent,
  setSkillEnabled,
  writeSkillContent,
  type SkillScope,
} from './pi-skills.js';
import { getPiStatus, installExtension, listExtensions, listModels, removeExtension } from './pi-cli.js';
import { readWebuiSettings, writeWebuiSettings } from './webui-settings.js';

function errStatus(err: unknown): number {
  if (err instanceof ConfigCorruptError) return 500;
  const msg = String(err);
  if (msg.includes('OAUTH_READONLY')) return 409;
  if (msg.includes('SKILL_EXISTS')) return 409;
  if (msg.includes('BAD_')) return 400;
  if (msg.includes('UNKNOWN_PROVIDER')) return 400;
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 404;
  return 500;
}

function handle(res: express.Response, fn: () => unknown): void {
  try {
    const result = fn();
    res.json(result ?? { ok: true });
  } catch (err) {
    res.status(errStatus(err)).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAsync(res: express.Response, fn: () => Promise<unknown>): Promise<void> {
  try {
    res.json((await fn()) ?? { ok: true });
  } catch (err) {
    res.status(errStatus(err)).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

/** projectId（可选）→ 项目目录，用于项目级技能。 */
function projectDirOf(req: express.Request): string | null {
  const id = typeof req.query.projectId === 'string' ? req.query.projectId : '';
  if (!id) return null;
  if (!getProject(id)) return null;
  return projectDir(id);
}

function skillScope(value: unknown): SkillScope {
  return value === 'project' ? 'project' : 'global';
}

export type PiRoutesDeps = {
  /** 配置变更后让空闲会话下次以新参数重启。 */
  disposeIdleSessions: () => void;
};

export function registerPiRoutes(app: express.Express, deps: PiRoutesDeps): void {
  app.get('/api/pi/status', (_req, res) => void handleAsync(res, () => getPiStatus()));

  app.get('/api/pi/settings', (_req, res) => handle(res, () => getPiSettings()));
  app.put('/api/pi/settings', (req, res) =>
    handle(res, () => {
      const pick = (k: string) => {
        const v = (req.body ?? {})[k];
        return v === undefined ? undefined : typeof v === 'string' && v ? v : null;
      };
      const result = updatePiSettings({
        defaultProvider: pick('defaultProvider'),
        defaultModel: pick('defaultModel'),
        defaultThinkingLevel: pick('defaultThinkingLevel'),
      });
      deps.disposeIdleSessions();
      return result;
    }),
  );

  app.get('/api/pi/providers', (_req, res) =>
    handle(res, () => ({ ...listProviders(), custom: listCustomProviders(), apis: CUSTOM_PROVIDER_APIS })),
  );
  app.put('/api/pi/providers/:id/key', (req, res) =>
    handle(res, () => {
      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      if (!key) throw new Error('BAD_REQUEST: key 不能为空');
      setProviderKey(req.params.id, key);
    }),
  );
  app.delete('/api/pi/providers/:id/key', (req, res) => handle(res, () => deleteProviderKey(req.params.id)));

  app.post('/api/pi/custom-providers', (req, res) =>
    handle(res, () => {
      const { id, baseUrl, api, apiKey, models } = req.body ?? {};
      if (typeof id !== 'string' || typeof baseUrl !== 'string' || typeof api !== 'string') {
        throw new Error('BAD_REQUEST: 需要 id/baseUrl/api');
      }
      upsertCustomProvider(id, { baseUrl, api, apiKey, models: Array.isArray(models) ? models : [] });
      return listCustomProviders();
    }),
  );
  app.put('/api/pi/custom-providers/:id', (req, res) =>
    handle(res, () => {
      const { baseUrl, api, apiKey, models } = req.body ?? {};
      if (typeof baseUrl !== 'string' || typeof api !== 'string') throw new Error('BAD_REQUEST: 需要 baseUrl/api');
      upsertCustomProvider(req.params.id, { baseUrl, api, apiKey, models: Array.isArray(models) ? models : [] });
      return listCustomProviders();
    }),
  );
  app.delete('/api/pi/custom-providers/:id', (req, res) =>
    handle(res, () => {
      deleteCustomProvider(req.params.id);
      return listCustomProviders();
    }),
  );

  app.get('/api/pi/models', (_req, res) => void handleAsync(res, async () => ({ models: await listModels() })));

  app.get('/api/pi/skills', (req, res) => handle(res, () => ({ skills: listSkills(projectDirOf(req)) })));
  app.put('/api/pi/skills/toggles', (req, res) =>
    handle(res, () => {
      const { scope, rel, enabled } = req.body ?? {};
      if (typeof rel !== 'string' || typeof enabled !== 'boolean') throw new Error('BAD_REQUEST: 需要 rel/enabled');
      setSkillEnabled(skillScope(scope), rel, enabled, projectDirOf(req));
      deps.disposeIdleSessions();
    }),
  );
  app.post('/api/pi/skills', (req, res) =>
    handle(res, () => {
      const { name, description } = req.body ?? {};
      if (typeof name !== 'string') throw new Error('BAD_REQUEST: 需要 name');
      return createSkill(name, typeof description === 'string' ? description : '');
    }),
  );
  app.get('/api/pi/skills/content', (req, res) =>
    handle(res, () => {
      const rel = typeof req.query.rel === 'string' ? req.query.rel : '';
      if (!rel) throw new Error('BAD_REQUEST: 需要 rel');
      return { content: readSkillContent(skillScope(req.query.scope), rel, projectDirOf(req)) };
    }),
  );
  app.put('/api/pi/skills/content', (req, res) =>
    handle(res, () => {
      const { scope, rel, content } = req.body ?? {};
      if (typeof rel !== 'string' || typeof content !== 'string') throw new Error('BAD_REQUEST: 需要 rel/content');
      writeSkillContent(skillScope(scope), rel, content, projectDirOf(req));
    }),
  );
  app.delete('/api/pi/skills', (req, res) =>
    handle(res, () => {
      const rel = typeof req.query.rel === 'string' ? req.query.rel : '';
      if (!rel) throw new Error('BAD_REQUEST: 需要 rel');
      deleteSkill(skillScope(req.query.scope), rel, projectDirOf(req));
    }),
  );

  app.get('/api/pi/extensions', (_req, res) => handle(res, () => ({ extensions: listExtensions() })));
  app.post('/api/pi/extensions', (req, res) =>
    void handleAsync(res, async () => {
      const source = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
      return installExtension(source);
    }),
  );
  app.delete('/api/pi/extensions', (req, res) =>
    void handleAsync(res, async () => {
      const source = typeof req.query.source === 'string' ? req.query.source : '';
      return removeExtension(source);
    }),
  );

  app.get('/api/pi/instructions', (_req, res) =>
    handle(res, () => ({ instructions: readWebuiSettings().instructions ?? '' })),
  );
  app.put('/api/pi/instructions', (req, res) =>
    handle(res, () => {
      const instructions = typeof req.body?.instructions === 'string' ? req.body.instructions : '';
      writeWebuiSettings({ instructions });
      deps.disposeIdleSessions();
      return { instructions };
    }),
  );
}
```

- [ ] **Step 3: 改造 `server/src/index.ts`**

新增 import：

```ts
import { registerPiRoutes } from './pi-routes.js';
import { readWebuiSettings } from './webui-settings.js';
import type { SessionLaunchConfig } from './pi-session.js';
import { updateProject } from './projects.js'; // 加入既有 projects import
```

`sessionFor` 替换为：

```ts
function launchConfigFor(id: string): SessionLaunchConfig {
  const meta = getProject(id);
  const appendPrompts: string[] = [];
  const globalInstructions = readWebuiSettings().instructions?.trim();
  if (globalInstructions) appendPrompts.push(globalInstructions);
  const projectInstructions = meta?.instructions?.trim();
  if (projectInstructions) appendPrompts.push(projectInstructions);
  return { model: meta?.model ?? null, thinking: meta?.thinking ?? null, appendPrompts };
}

function sessionFor(id: string): PiSession {
  let session = sessions.get(id);
  if (!session) {
    session = new PiSession(projectDir(id), () => launchConfigFor(id));
    sessions.set(id, session);
  }
  return session;
}

function disposeIdleSessions(): void {
  for (const [id, session] of sessions) {
    if (!session.isBusy) {
      session.dispose();
      sessions.delete(id);
    }
  }
}
```

Projects 区新增 PATCH 路由（放在 DELETE `/api/projects/:id` 之后）：

```ts
app.patch('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  if (!getProject(id)) return res.status(404).json({ error: 'project not found' });
  const pick = (k: string): string | null | undefined => {
    const v = (req.body ?? {})[k];
    if (v === undefined) return undefined;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const updated = updateProject(id, {
    model: pick('model'),
    thinking: pick('thinking'),
    instructions: pick('instructions'),
  });
  const session = sessions.get(id);
  if (session && !session.isBusy) {
    session.dispose();
    sessions.delete(id);
  }
  res.json(updated);
});
```

`app.listen` 之前挂载：

```ts
registerPiRoutes(app, { disposeIdleSessions });
```

注意：`sessionFor` 原来接受 `meta?.model`，`new PiSession(projectDir(id), meta?.model ?? null)` 的旧调用点全部消除。

- [ ] **Step 4: 验证**

Run: `pnpm --filter server build && pnpm --filter server test` → 全部通过。
手动冒烟：`pnpm --filter server dev` 后

```bash
curl -s localhost:4400/api/pi/status            # {"installed":true,"version":"0.78.0",...}
curl -s localhost:4400/api/pi/settings          # 当前默认 provider/model/thinking
curl -s localhost:4400/api/pi/providers | head -c 400
curl -s localhost:4400/api/pi/skills | head -c 400
curl -s localhost:4400/api/pi/models
```

- [ ] **Step 5: Commit**

```bash
git add server/src/pi-routes.ts server/src/index.ts server/src/pi-session.ts
git commit -m "feat(server): /api/pi 路由与 pi 启动参数注入"
```

---

### Task 6: web lib + 安装引导门控

**Files:**
- Modify: `web/src/lib/types.ts`、`web/src/lib/api.ts`、`web/src/App.tsx`
- Create: `web/src/components/InstallGuide.tsx`

- [ ] **Step 1: `web/src/lib/types.ts` 追加**

```ts
// ---- Pi 配置 ----

export type PiStatus = { installed: boolean; version: string | null; piDir: string };

export type PiSettings = {
  defaultProvider: string | null;
  defaultModel: string | null;
  defaultThinkingLevel: string | null;
};

export type ProviderStatus = {
  id: string;
  label: string;
  envVar: string;
  configured: boolean;
  keyTail: string | null;
  oauth: boolean;
};

export type CustomModel = { id: string; name?: string; contextWindow?: number };

export type CustomProvider = {
  id: string;
  baseUrl: string;
  api: string;
  apiKeyTail: string | null;
  models: CustomModel[];
};

export type ProvidersResponse = {
  builtin: ProviderStatus[];
  extraAuth: string[];
  custom: CustomProvider[];
  apis: string[];
};

export type PiModel = { provider: string; id: string };

export type SkillInfo = {
  name: string;
  description: string;
  rel: string;
  scope: 'global' | 'project';
  enabled: boolean;
};

export type ExtensionInfo = { source: string };
export type ExtensionOpResult = { ok: boolean; output: string };

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
```

同文件 `ProjectMeta` 增加 `thinking?: string | null; instructions?: string | null;`。

- [ ] **Step 2: `web/src/lib/api.ts` 追加 `piApi` 与项目 PATCH**

`api` 对象内追加：

```ts
  updateProject: (id: string, patch: { model?: string | null; thinking?: string | null; instructions?: string | null }) =>
    fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<ProjectMeta>(r)),
```

`createProject` 改为接受可选 model：

```ts
  createProject: (name: string, model?: string | null) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, model: model ?? null }),
    }).then((r) => json<ProjectMeta>(r)),
```

文件末尾新增（import 相应类型）：

```ts
const jsonHeaders = { 'Content-Type': 'application/json' };

export const piApi = {
  status: () => fetch('/api/pi/status').then((r) => json<PiStatus>(r)),
  settings: () => fetch('/api/pi/settings').then((r) => json<PiSettings>(r)),
  saveSettings: (patch: Partial<PiSettings>) =>
    fetch('/api/pi/settings', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      json<PiSettings>(r),
    ),
  providers: () => fetch('/api/pi/providers').then((r) => json<ProvidersResponse>(r)),
  setProviderKey: (id: string, key: string) =>
    fetch(`/api/pi/providers/${encodeURIComponent(id)}/key`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ key }),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteProviderKey: (id: string) =>
    fetch(`/api/pi/providers/${encodeURIComponent(id)}/key`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  saveCustomProvider: (id: string, body: { baseUrl: string; api: string; apiKey?: string; models: CustomModel[] }, isNew: boolean) =>
    fetch(isNew ? '/api/pi/custom-providers' : `/api/pi/custom-providers/${encodeURIComponent(id)}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(isNew ? { id, ...body } : body),
    }).then((r) => json<CustomProvider[]>(r)),
  deleteCustomProvider: (id: string) =>
    fetch(`/api/pi/custom-providers/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => json<CustomProvider[]>(r)),
  models: () => fetch('/api/pi/models').then((r) => json<{ models: PiModel[] }>(r)).then((b) => b.models),
  skills: (projectId?: string | null) =>
    fetch(`/api/pi/skills${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`)
      .then((r) => json<{ skills: SkillInfo[] }>(r))
      .then((b) => b.skills),
  toggleSkill: (scope: string, rel: string, enabled: boolean, projectId?: string | null) =>
    fetch(`/api/pi/skills/toggles${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ scope, rel, enabled }),
    }).then((r) => json<{ ok: boolean }>(r)),
  createSkill: (name: string, description: string) =>
    fetch('/api/pi/skills', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name, description }) }).then(
      (r) => json<SkillInfo>(r),
    ),
  skillContent: (scope: string, rel: string, projectId?: string | null) =>
    fetch(
      `/api/pi/skills/content?scope=${scope}&rel=${encodeURIComponent(rel)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`,
    )
      .then((r) => json<{ content: string }>(r))
      .then((b) => b.content),
  saveSkillContent: (scope: string, rel: string, content: string, projectId?: string | null) =>
    fetch(`/api/pi/skills/content${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ scope, rel, content }),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteSkill: (scope: string, rel: string, projectId?: string | null) =>
    fetch(
      `/api/pi/skills?scope=${scope}&rel=${encodeURIComponent(rel)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`,
      { method: 'DELETE' },
    ).then((r) => json<{ ok: boolean }>(r)),
  extensions: () => fetch('/api/pi/extensions').then((r) => json<{ extensions: ExtensionInfo[] }>(r)).then((b) => b.extensions),
  installExtension: (source: string) =>
    fetch('/api/pi/extensions', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ source }) }).then((r) =>
      json<ExtensionOpResult>(r),
    ),
  removeExtension: (source: string) =>
    fetch(`/api/pi/extensions?source=${encodeURIComponent(source)}`, { method: 'DELETE' }).then((r) =>
      json<ExtensionOpResult>(r),
    ),
  instructions: () => fetch('/api/pi/instructions').then((r) => json<{ instructions: string }>(r)).then((b) => b.instructions),
  saveInstructions: (instructions: string) =>
    fetch('/api/pi/instructions', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ instructions }) }).then(
      (r) => json<{ instructions: string }>(r),
    ),
};
```

- [ ] **Step 3: 创建 `web/src/components/InstallGuide.tsx`**

```tsx
import { useState } from 'react';

const INSTALL_CMD = 'npm install -g @earendil-works/pi-coding-agent';

type Props = { onRecheck: () => Promise<boolean> };

export default function InstallGuide({ onRecheck }: Props) {
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const recheck = async () => {
    setChecking(true);
    setFailed(false);
    const ok = await onRecheck();
    setChecking(false);
    if (!ok) setFailed(true);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-white text-zinc-700">
      <span className="text-5xl">π</span>
      <h1 className="mt-4 text-lg font-semibold text-zinc-900">未检测到 pi CLI</h1>
      <p className="mt-2 max-w-md text-center text-sm text-zinc-500">
        Pi Web Studio 依赖本机安装的 pi coding agent。请先安装（需要 Node.js ≥ 20），然后点击重新检测。
      </p>
      <div className="mt-6 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-sm">
        <code>{INSTALL_CMD}</code>
        <button onClick={copy} className="ml-2 rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <button
        onClick={recheck}
        disabled={checking}
        className="mt-6 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {checking ? '检测中…' : '重新检测'}
      </button>
      {failed && <p className="mt-3 text-xs text-red-500">仍未检测到 pi，请确认安装成功且 pi 在 PATH 中。</p>}
    </div>
  );
}
```

- [ ] **Step 4: `web/src/App.tsx` 加门控**

新增 state 与检测（`refresh` 定义之前）：

```tsx
const [piInstalled, setPiInstalled] = useState<boolean | null>(null);

const checkPi = useCallback(async (): Promise<boolean> => {
  try {
    const status = await piApi.status();
    setPiInstalled(status.installed);
    return status.installed;
  } catch {
    setPiInstalled(true); // server 不可达时不阻塞主界面，由现有 error 流程提示
    return true;
  }
}, []);

useEffect(() => {
  void checkPi();
}, [checkPi]);
```

return 顶部加门控（在现有 `<div className="flex h-full ...">` 之前）：

```tsx
if (piInstalled === false) return <InstallGuide onRecheck={checkPi} />;
```

import `piApi`、`InstallGuide`。

- [ ] **Step 5: 验证 + Commit**

Run: `pnpm --filter web build` → 通过。

```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/src/components/InstallGuide.tsx web/src/App.tsx
git commit -m "feat(web): piApi 客户端、pi 安装检测门控与引导页"
```

---

### Task 7: ProvidersSection 组件

**Files:**
- Create: `web/src/components/settings/ProvidersSection.tsx`

无 props，自行 fetch。包含三块：全局默认（provider/model/thinking 三下拉 + 保存）、内置 provider key 管理、自定义 provider 表单。

- [ ] **Step 1: 实现组件**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { piApi } from '../../lib/api';
import {
  THINKING_LEVELS,
  type CustomModel,
  type CustomProvider,
  type PiModel,
  type PiSettings,
  type ProvidersResponse,
} from '../../lib/types';

type CustomDraft = {
  id: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  models: CustomModel[];
  isNew: boolean;
};

const EMPTY_DRAFT: CustomDraft = {
  id: '',
  baseUrl: '',
  api: 'openai-completions',
  apiKey: '',
  models: [{ id: '' }],
  isNew: true,
};

export default function ProvidersSection() {
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [models, setModels] = useState<PiModel[]>([]);
  const [settings, setSettings] = useState<PiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keyEditing, setKeyEditing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [draft, setDraft] = useState<CustomDraft | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s, m] = await Promise.all([piApi.providers(), piApi.settings(), piApi.models()]);
      setProviders(p);
      setSettings(s);
      setModels(m);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providerOptions = useMemo(() => {
    if (!providers) return [];
    const builtin = providers.builtin.filter((p) => p.configured).map((p) => p.id);
    const custom = providers.custom.map((c) => c.id);
    return [...builtin, ...custom];
  }, [providers]);

  const modelOptions = useMemo(() => {
    const provider = settings?.defaultProvider;
    const fromCli = models.filter((m) => !provider || m.provider === provider).map((m) => m.id);
    const fromCustom = (providers?.custom ?? [])
      .filter((c) => !provider || c.id === provider)
      .flatMap((c) => c.models.map((m) => m.id));
    return [...new Set([...fromCli, ...fromCustom])];
  }, [models, providers, settings?.defaultProvider]);

  const saveDefaults = async () => {
    if (!settings) return;
    try {
      setSettings(await piApi.saveSettings(settings));
      setNotice('已保存。对新启动的会话生效。');
      setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const submitKey = async (id: string) => {
    const key = keyInput.trim();
    if (!key) return;
    try {
      await piApi.setProviderKey(id, key);
      setKeyEditing(null);
      setKeyInput('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const removeKey = async (id: string) => {
    if (!confirm('删除该 provider 的 API key？')) return;
    try {
      await piApi.deleteProviderKey(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const cleanModels = draft.models.filter((m) => m.id.trim());
    if (!draft.id.trim() || !draft.baseUrl.trim() || cleanModels.length === 0) {
      setError('自定义 provider 需要 id、baseUrl 和至少一个模型');
      return;
    }
    try {
      await piApi.saveCustomProvider(
        draft.id.trim(),
        { baseUrl: draft.baseUrl.trim(), api: draft.api, apiKey: draft.apiKey.trim() || undefined, models: cleanModels },
        draft.isNew,
      );
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const editCustom = (c: CustomProvider) => {
    setDraft({ id: c.id, baseUrl: c.baseUrl, api: c.api, apiKey: '', models: c.models.length ? c.models : [{ id: '' }], isNew: false });
  };

  const removeCustom = async (id: string) => {
    if (!confirm(`删除自定义 provider「${id}」？`)) return;
    try {
      await piApi.deleteCustomProvider(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (!providers || !settings) {
    return <p className="p-4 text-sm text-zinc-400">{error ?? '加载中…'}</p>;
  }

  const sortedBuiltin = [...providers.builtin].sort((a, b) => Number(b.configured) - Number(a.configured));
  const select = 'rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500';
  const input = 'rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500';

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-red-500">{error}</p>}
      {notice && <p className="text-xs text-emerald-600">{notice}</p>}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-800">全局默认</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={select}
            value={settings.defaultProvider ?? ''}
            onChange={(e) => setSettings({ ...settings, defaultProvider: e.target.value || null, defaultModel: null })}
          >
            <option value="">（pi 默认）</option>
            {providerOptions.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          <select
            className={select}
            value={settings.defaultModel ?? ''}
            onChange={(e) => setSettings({ ...settings, defaultModel: e.target.value || null })}
          >
            <option value="">（默认模型）</option>
            {modelOptions.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          <select
            className={select}
            value={settings.defaultThinkingLevel ?? ''}
            onChange={(e) => setSettings({ ...settings, defaultThinkingLevel: e.target.value || null })}
          >
            <option value="">（thinking 默认）</option>
            {THINKING_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <button onClick={saveDefaults} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">
            保存
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-400">模型列表只包含已配置凭证的 provider；配置 key 后自动刷新。</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-800">内置 Provider</h3>
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {sortedBuiltin.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${p.configured ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
              <span className="w-44 truncate text-zinc-800">{p.label}</span>
              <span className="flex-1 truncate font-mono text-xs text-zinc-400">{p.id}</span>
              {p.oauth ? (
                <span className="text-xs text-zinc-400">OAuth 已登录（终端 pi /login 管理）</span>
              ) : keyEditing === p.id ? (
                <span className="flex items-center gap-1">
                  <input
                    autoFocus
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void submitKey(p.id)}
                    placeholder="API key"
                    className={`${input} w-52`}
                  />
                  <button onClick={() => void submitKey(p.id)} className="text-xs text-zinc-600 hover:text-zinc-900">保存</button>
                  <button onClick={() => setKeyEditing(null)} className="text-xs text-zinc-400 hover:text-zinc-600">取消</button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {p.configured && <span className="font-mono text-xs text-zinc-400">…{p.keyTail}</span>}
                  <button
                    onClick={() => { setKeyEditing(p.id); setKeyInput(''); }}
                    className="text-xs text-zinc-500 hover:text-zinc-800"
                  >
                    {p.configured ? '更新' : '配置 key'}
                  </button>
                  {p.configured && (
                    <button onClick={() => void removeKey(p.id)} className="text-xs text-zinc-400 hover:text-red-500">删除</button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
        {providers.extraAuth.length > 0 && (
          <p className="mt-1 text-xs text-zinc-400">其他已登录凭证：{providers.extraAuth.join('、')}（请在终端管理）</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">自定义 Provider（Ollama / vLLM / 代理）</h3>
          {!draft && (
            <button onClick={() => setDraft(EMPTY_DRAFT)} className="text-xs text-zinc-500 hover:text-zinc-800">＋ 新增</button>
          )}
        </div>
        {providers.custom.length > 0 && (
          <div className="mb-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {providers.custom.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-32 truncate font-mono text-zinc-800">{c.id}</span>
                <span className="flex-1 truncate text-xs text-zinc-400">{c.baseUrl} · {c.api} · {c.models.length} 个模型</span>
                <button onClick={() => editCustom(c)} className="text-xs text-zinc-500 hover:text-zinc-800">编辑</button>
                <button onClick={() => void removeCustom(c.id)} className="text-xs text-zinc-400 hover:text-red-500">删除</button>
              </div>
            ))}
          </div>
        )}
        {draft && (
          <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap gap-2">
              <input className={`${input} w-36`} placeholder="id（如 ollama）" value={draft.id} disabled={!draft.isNew}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
              <input className={`${input} flex-1`} placeholder="baseUrl（如 http://localhost:11434/v1）" value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
              <select className={select} value={draft.api} onChange={(e) => setDraft({ ...draft, api: e.target.value })}>
                {(providers.apis ?? []).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <input className={`${input} w-44`} type="password" placeholder={draft.isNew ? 'API key（可选）' : 'API key（留空保持不变）'}
                value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} />
            </div>
            <div className="space-y-1">
              {draft.models.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <input className={`${input} w-48`} placeholder="模型 id（必填）" value={m.id}
                    onChange={(e) => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} />
                  <input className={`${input} w-40`} placeholder="显示名（可选）" value={m.name ?? ''}
                    onChange={(e) => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, name: e.target.value || undefined } : x)) })} />
                  <input className={`${input} w-36`} type="number" placeholder="上下文窗口（可选）" value={m.contextWindow ?? ''}
                    onChange={(e) => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, contextWindow: e.target.value ? Number(e.target.value) : undefined } : x)) })} />
                  <button onClick={() => setDraft({ ...draft, models: draft.models.filter((_, j) => j !== i) })}
                    className="text-xs text-zinc-400 hover:text-red-500">✕</button>
                </div>
              ))}
              <button onClick={() => setDraft({ ...draft, models: [...draft.models, { id: '' }] })}
                className="text-xs text-zinc-500 hover:text-zinc-800">＋ 添加模型</button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void saveDraft()} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">保存</button>
              <button onClick={() => setDraft(null)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">取消</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 验证 + Commit**

Run: `pnpm --filter web build` → 通过（组件尚未被引用，仅编译检查）。

```bash
git add web/src/components/settings/ProvidersSection.tsx
git commit -m "feat(web): Provider 与模型设置分区"
```

---

### Task 8: SkillsSection 组件

**Files:**
- Create: `web/src/components/settings/SkillsSection.tsx`

Props: `{ projectId: string | null }`。

- [ ] **Step 1: 实现组件**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { piApi } from '../../lib/api';
import type { SkillInfo } from '../../lib/types';

type Props = { projectId: string | null };

type EditorState = { skill: SkillInfo; content: string } | null;

export default function SkillsSection({ projectId }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSkills(await piApi.skills(projectId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (s: SkillInfo) => {
    try {
      await piApi.toggleSkill(s.scope, s.rel, !s.enabled, projectId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const openEditor = async (s: SkillInfo) => {
    try {
      setEditor({ skill: s, content: await piApi.skillContent(s.scope, s.rel, projectId) });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    }
  };

  const saveEditor = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await piApi.saveSkillContent(editor.skill.scope, editor.skill.rel, editor.content, projectId);
      setEditor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const skill = await piApi.createSkill(name, newDesc.trim());
      setCreating(false);
      setNewName('');
      setNewDesc('');
      await load();
      await openEditor(skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  const remove = async (s: SkillInfo) => {
    if (!confirm(`删除技能「${s.name}」？此操作不可恢复。`)) return;
    try {
      await piApi.deleteSkill(s.scope, s.rel, projectId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (editor) {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">编辑 {editor.skill.name}</h3>
          <div className="flex gap-2">
            <button onClick={() => void saveEditor()} disabled={saving}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50">
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={() => setEditor(null)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">
              返回
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <textarea
          value={editor.content}
          onChange={(e) => setEditor({ ...editor, content: e.target.value })}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-300 p-3 font-mono text-xs outline-none focus:border-zinc-500"
        />
        <p className="text-xs text-zinc-400">SKILL.md 必须以 frontmatter 开头并包含 name 与 description。</p>
      </div>
    );
  }

  const groups: Array<{ title: string; scope: 'global' | 'project' }> = [
    { title: '全局技能（~/.pi/agent/skills）', scope: 'global' },
    ...(projectId ? [{ title: '项目技能（.pi/skills）', scope: 'project' as const }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">Skills</h3>
        {!creating && (
          <button onClick={() => setCreating(true)} className="text-xs text-zinc-500 hover:text-zinc-800">＋ 新建技能</button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {creating && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 p-3">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="技能名（kebab-case）"
            className="w-44 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500" />
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="一句话描述"
            className="flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500" />
          <button onClick={() => void create()} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">创建</button>
          <button onClick={() => setCreating(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">取消</button>
        </div>
      )}
      {groups.map((g) => {
        const list = skills.filter((s) => s.scope === g.scope);
        return (
          <section key={g.scope}>
            <h4 className="mb-1 text-xs font-medium text-zinc-500">{g.title}</h4>
            {list.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400">暂无技能</p>
            ) : (
              <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {list.map((s) => (
                  <div key={`${s.scope}:${s.rel}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <button
                      role="switch"
                      aria-checked={s.enabled}
                      onClick={() => void toggle(s)}
                      className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${s.enabled ? 'bg-emerald-500' : 'bg-zinc-300'}`}
                      title={s.enabled ? '点击禁用' : '点击启用'}
                    >
                      <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${s.enabled ? 'translate-x-4' : ''}`} />
                    </button>
                    <span className="w-44 truncate font-medium text-zinc-800">{s.name}</span>
                    <span className="flex-1 truncate text-xs text-zinc-400" title={s.description}>{s.description}</span>
                    <button onClick={() => void openEditor(s)} className="text-xs text-zinc-500 hover:text-zinc-800">编辑</button>
                    <button onClick={() => void remove(s)} className="text-xs text-zinc-400 hover:text-red-500">删除</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <p className="text-xs text-zinc-400">启用/禁用写入 pi 的 settings.json，对新启动的会话生效。</p>
    </div>
  );
}
```

- [ ] **Step 2: 验证 + Commit**

Run: `pnpm --filter web build` → 通过。

```bash
git add web/src/components/settings/SkillsSection.tsx
git commit -m "feat(web): Skills 设置分区——列表/开关/编辑器"
```

---

### Task 9: Extensions / Instructions / About 三个分区

**Files:**
- Create: `web/src/components/settings/ExtensionsSection.tsx`
- Create: `web/src/components/settings/InstructionsSection.tsx`
- Create: `web/src/components/settings/AboutSection.tsx`

- [ ] **Step 1: `ExtensionsSection.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { piApi } from '../../lib/api';
import type { ExtensionInfo } from '../../lib/types';

export default function ExtensionsSection() {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setExtensions(await piApi.extensions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async () => {
    const s = source.trim();
    if (!s || busy) return;
    setBusy(true);
    setOutput(null);
    try {
      const result = await piApi.installExtension(s);
      setOutput(result.output);
      if (result.ok) {
        setSource('');
        await load();
      } else {
        setError('安装失败，详见输出');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: string) => {
    if (busy || !confirm(`卸载扩展「${s}」？`)) return;
    setBusy(true);
    setOutput(null);
    try {
      const result = await piApi.removeExtension(s);
      setOutput(result.output);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '卸载失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-zinc-800">Extensions（pi 扩展包）</h3>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void install()}
          placeholder="npm 包名或 git:github.com/user/repo"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <button onClick={() => void install()} disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50">
          {busy ? '执行中…' : '安装'}
        </button>
      </div>
      {extensions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400">尚未安装任何扩展</p>
      ) : (
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {extensions.map((e) => (
            <div key={e.source} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 truncate font-mono text-zinc-700">{e.source}</span>
              <button onClick={() => void remove(e.source)} disabled={busy} className="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-50">
                卸载
              </button>
            </div>
          ))}
        </div>
      )}
      {output && (
        <details open className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
          <summary className="cursor-pointer text-xs text-zinc-500">命令输出</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-600">{output}</pre>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `InstructionsSection.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { piApi } from '../../lib/api';

export default function InstructionsSection() {
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    piApi
      .instructions()
      .then((v) => {
        setValue(v);
        setLoaded(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, []);

  const save = async () => {
    try {
      await piApi.saveInstructions(value);
      setNotice('已保存。对新启动的会话生效。');
      setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <h3 className="text-sm font-semibold text-zinc-800">自定义指令</h3>
      <p className="text-xs text-zinc-400">将以 --append-system-prompt 追加到 pi 的系统提示词，作用于所有项目。</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {notice && <p className="text-xs text-emerald-600">{notice}</p>}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!loaded}
        placeholder="例如：所有页面默认使用深色主题；文案使用简体中文。"
        className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-300 p-3 text-sm outline-none focus:border-zinc-500"
      />
      <div>
        <button onClick={() => void save()} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700">
          保存
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `AboutSection.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { piApi } from '../../lib/api';
import type { PiStatus } from '../../lib/types';

export default function AboutSection() {
  const [status, setStatus] = useState<PiStatus | null>(null);

  useEffect(() => {
    piApi.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <div className="space-y-3 text-sm text-zinc-700">
      <h3 className="text-sm font-semibold text-zinc-800">关于</h3>
      <dl className="space-y-2">
        <div className="flex gap-2">
          <dt className="w-28 text-zinc-400">pi 状态</dt>
          <dd>{status ? (status.installed ? `已安装 v${status.version ?? '未知'}` : '未检测到') : '检测中…'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 text-zinc-400">配置目录</dt>
          <dd className="font-mono text-xs">{status?.piDir ?? '—'}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-400">
        Provider key 写入 auth.json，默认模型写入 settings.json，自定义 provider 写入 models.json——与终端里的 pi 共享同一份配置。
      </p>
    </div>
  );
}
```

- [ ] **Step 4: 验证 + Commit**

Run: `pnpm --filter web build` → 通过。

```bash
git add web/src/components/settings/ExtensionsSection.tsx web/src/components/settings/InstructionsSection.tsx web/src/components/settings/AboutSection.tsx
git commit -m "feat(web): Extensions/自定义指令/关于 设置分区"
```

---

### Task 10: ProjectSettingsDialog + Workspace 入口

**Files:**
- Create: `web/src/components/ProjectSettingsDialog.tsx`
- Modify: `web/src/components/Workspace.tsx`

- [ ] **Step 1: 实现 `ProjectSettingsDialog.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { api, piApi } from '../lib/api';
import { THINKING_LEVELS, type PiModel, type ProjectMeta } from '../lib/types';

type Props = {
  meta: ProjectMeta;
  onClose: () => void;
  onSaved: (meta: ProjectMeta) => void;
};

export default function ProjectSettingsDialog({ meta, onClose, onSaved }: Props) {
  const [model, setModel] = useState(meta.model ?? '');
  const [thinking, setThinking] = useState(meta.thinking ?? '');
  const [instructions, setInstructions] = useState(meta.instructions ?? '');
  const [models, setModels] = useState<PiModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    piApi.models().then(setModels).catch(() => setModels([]));
  }, []);

  const modelOptions = useMemo(() => models.map((m) => `${m.provider}/${m.id}`), [models]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateProject(meta.id, {
        model: model || null,
        thinking: thinking || null,
        instructions: instructions.trim() || null,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const select = 'w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[480px] rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-zinc-900">项目设置 · {meta.name}</h2>
        <p className="mt-1 text-xs text-zinc-400">覆盖全局默认，对新启动的会话生效。</p>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-zinc-500">
            模型
            <select className={`${select} mt-1`} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">跟随全局默认</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-500">
            Thinking
            <select className={`${select} mt-1`} value={thinking} onChange={(e) => setThinking(e.target.value)}>
              <option value="">跟随全局默认</option>
              {THINKING_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-500">
            项目指令（追加到系统提示词）
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              placeholder="例如：本项目是给儿童看的科普站点，配色明快、文案口语化。"
              className="mt-1 w-full resize-none rounded-lg border border-zinc-300 p-2 text-sm outline-none focus:border-zinc-500"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">取消</button>
          <button onClick={() => void save()} disabled={saving}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

注意 `pi --model` 接受 `provider/id` 形式，故选项值用 `${provider}/${id}`。

- [ ] **Step 2: Workspace 加入口**

`Workspace.tsx` 的 Props 扩展：

```ts
type Props = {
  projectId: string;
  generation: GenerationModel;
  onRetry?: () => void;
  meta?: ProjectMeta;
  onMetaUpdated?: (meta: ProjectMeta) => void;
};
```

组件内加 state `const [showSettings, setShowSettings] = useState(false);`，在顶部工具条（文件面板开关按钮所在的位置旁）加齿轮按钮：

```tsx
<button
  onClick={() => setShowSettings(true)}
  title="项目设置"
  className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
>
  ⚙
</button>
```

组件 return 的根元素内末尾渲染：

```tsx
{showSettings && meta && onMetaUpdated && (
  <ProjectSettingsDialog meta={meta} onClose={() => setShowSettings(false)} onSaved={onMetaUpdated} />
)}
```

import `ProjectSettingsDialog` 与 `ProjectMeta`。具体插入位置由实现者按 Workspace 现有工具条结构选最自然的位置（与 FilesPanel 开关同排）。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm --filter web build` → 通过（App 还没传 meta，prop 为可选不破坏现有调用）。

```bash
git add web/src/components/ProjectSettingsDialog.tsx web/src/components/Workspace.tsx
git commit -m "feat(web): 项目级配置弹窗与 Workspace 设置入口"
```

---

### Task 11: SettingsDialog 装配 + Sidebar + App 接线 + 全量验证

**Files:**
- Create: `web/src/components/settings/SettingsDialog.tsx`
- Modify: `web/src/components/Sidebar.tsx`、`web/src/App.tsx`

- [ ] **Step 1: 实现 `SettingsDialog.tsx`**

```tsx
import { useState } from 'react';
import ProvidersSection from './ProvidersSection';
import InstructionsSection from './InstructionsSection';
import SkillsSection from './SkillsSection';
import ExtensionsSection from './ExtensionsSection';
import AboutSection from './AboutSection';

type SectionId = 'providers' | 'instructions' | 'skills' | 'extensions' | 'about';

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'providers', label: 'Provider 与模型' },
  { id: 'instructions', label: '自定义指令' },
  { id: 'skills', label: 'Skills' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'about', label: '关于' },
];

type Props = { projectId: string | null; onClose: () => void };

export default function SettingsDialog({ projectId, onClose }: Props) {
  const [active, setActive] = useState<SectionId>('providers');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="flex h-[600px] w-[840px] overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="w-44 shrink-0 border-r border-zinc-100 bg-zinc-50 p-3">
          <h2 className="px-2 pb-2 text-sm font-semibold text-zinc-900">设置</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`mb-0.5 block w-full rounded-lg px-3 py-2 text-left text-sm ${
                active === s.id ? 'bg-zinc-200/80 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="relative min-w-0 flex-1">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            title="关闭"
          >
            ✕
          </button>
          <div className="h-full overflow-y-auto p-5">
            {active === 'providers' && <ProvidersSection />}
            {active === 'instructions' && <InstructionsSection />}
            {active === 'skills' && <SkillsSection projectId={projectId} />}
            {active === 'extensions' && <ExtensionsSection />}
            {active === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Sidebar 加齿轮 + 新建项目 model 下拉**

`Sidebar.tsx` Props 扩展：`onCreate: (name: string, model?: string | null) => void;` 与新增 `onOpenSettings: () => void;`。

创建表单部分：进入 creating 态时拉取模型列表，在名称输入框下加 model 下拉：

```tsx
const [model, setModel] = useState('');
const [models, setModels] = useState<PiModel[]>([]);

useEffect(() => {
  if (creating) piApi.models().then(setModels).catch(() => setModels([]));
}, [creating]);

const submit = () => {
  const trimmed = name.trim();
  if (trimmed) onCreate(trimmed, model || null);
  setName('');
  setModel('');
  setCreating(false);
};
```

creating 分支 JSX 改为（input 的 `onBlur={submit}` 移除，避免点下拉时误提交；改为 Escape/Enter/确认按钮）：

```tsx
<div className="space-y-1.5">
  <input
    autoFocus
    value={name}
    onChange={(e) => setName(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') setCreating(false);
    }}
    placeholder="项目名称"
    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
  />
  <select
    value={model}
    onChange={(e) => setModel(e.target.value)}
    className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 outline-none focus:border-zinc-500"
  >
    <option value="">模型：跟随全局默认</option>
    {models.map((m) => (
      <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.provider}/{m.id}</option>
    ))}
  </select>
  <div className="flex gap-1.5">
    <button onClick={submit} className="flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">创建</button>
    <button onClick={() => setCreating(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50">取消</button>
  </div>
</div>
```

底部（新建项目按钮下方）加设置入口：

```tsx
<button
  onClick={onOpenSettings}
  className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
>
  ⚙ 设置
</button>
```

import `useEffect`、`piApi`、`PiModel`。

- [ ] **Step 3: App 接线**

`App.tsx`：

```tsx
const [showSettings, setShowSettings] = useState(false);

const createProject = async (name: string, model?: string | null) => {
  try {
    const meta = await api.createProject(name, model);
    await refresh();
    setActiveId(meta.id);
  } catch (err) {
    setError(err instanceof Error ? err.message : '创建失败');
  }
};

const activeMeta = projects.find((p) => p.id === activeId);

const onMetaUpdated = (meta: ProjectMeta) => {
  setProjects((list) => list.map((p) => (p.id === meta.id ? meta : p)));
};
```

JSX：`<Sidebar ... onOpenSettings={() => setShowSettings(true)} />`；`<Workspace ... meta={activeMeta} onMetaUpdated={onMetaUpdated} />`；根 div 末尾：

```tsx
{showSettings && <SettingsDialog projectId={activeId} onClose={() => setShowSettings(false)} />}
```

import `SettingsDialog`。

- [ ] **Step 4: 全量验证**

```bash
pnpm --filter server build && pnpm --filter server test
pnpm --filter web build
```

Expected: 全部通过。

手动冒烟（`pnpm dev` 起前后端）确认：

1. 设置弹窗五个分区都能打开、加载真实数据（本机 minimax-cn 已配 key，应显示绿点和尾 4 位）。
2. Provider 配 key → 模型下拉出现该 provider 模型。
3. Skills 列表显示本机全局技能，开关写入 `~/.pi/agent/settings.json`（手动 cat 验证产生 `-xxx/SKILL.md` 条目后恢复）。
4. 新建项目时可选模型；项目设置弹窗能改 thinking 并保存。
5. 临时把 PATH 里 pi 改名（或改 server 端 mock）验证 InstallGuide 出现——可选。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/settings/SettingsDialog.tsx web/src/components/Sidebar.tsx web/src/App.tsx
git commit -m "feat(web): 设置弹窗装配、Sidebar 入口与项目创建模型选择"
```

---

## Self-Review 结论

- spec 各需求 → 任务映射：安装检测/引导（T3/T6）、settings 三字段（T1/T5/T7）、内置 provider key（T1/T5/T7）、自定义 provider（T1/T5/T7）、模型列表（T3/T5/T7）、skills 全功能（T2/T5/T8）、extensions（T3/T5/T9）、全局指令（T4/T5/T9）、项目级覆盖 + PATCH（T4/T5/T10/T11）、pi 启动注入（T5）、安全边界（T1/T2/T3 测试覆盖）。无缺口。
- 类型一致性：`SessionLaunchConfig`、`SkillInfo`、`ProvidersResponse` 等在 server/web 两侧字段对齐；`pi --model` 用 `provider/id` 形式在 T10/T11 一致。
- 无占位符。
