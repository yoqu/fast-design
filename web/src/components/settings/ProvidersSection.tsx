import { useCallback, useEffect, useMemo, useState } from 'react';
import { piApi } from '../../lib/api';
import { PlusIcon, XIcon } from '../icons';
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
            <button onClick={() => setDraft(EMPTY_DRAFT)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"><PlusIcon size={12} />新增</button>
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
                    className="text-zinc-400 hover:text-red-500"><XIcon size={13} /></button>
                </div>
              ))}
              <button onClick={() => setDraft({ ...draft, models: [...draft.models, { id: '' }] })}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"><PlusIcon size={12} />添加模型</button>
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
