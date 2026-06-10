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
