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

  it('rejects deleting unknown provider ids', () => {
    expect(() => deleteProviderKey('not-a-provider')).toThrow(/UNKNOWN_PROVIDER/);
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
