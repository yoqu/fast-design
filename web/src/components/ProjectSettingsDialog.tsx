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
