import { useEffect, useMemo, useRef, useState } from 'react';
import { api, piApi } from '../lib/api';
import { THINKING_LEVELS, type PiModel, type ProjectMeta } from '../lib/types';
import { SettingsIcon } from './icons';

type Props = {
  meta: ProjectMeta;
  onSaved: (meta: ProjectMeta) => void;
};

/**
 * 项目设置：齿轮按钮 + 锚定 Popover（右对齐下拉，点击外部关闭），
 * 取代全局居中弹窗——改完即走，不打断工作区。
 */
export default function ProjectSettingsMenu({ meta, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(meta.model ?? '');
  const [thinking, setThinking] = useState(meta.thinking ?? '');
  const [instructions, setInstructions] = useState(meta.instructions ?? '');
  const [models, setModels] = useState<PiModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    piApi.models().then(setModels).catch(() => setModels([]));
    // 每次打开回填最新 meta，丢弃上次未保存的草稿。
    setModel(meta.model ?? '');
    setThinking(meta.thinking ?? '');
    setInstructions(meta.instructions ?? '');
    setError(null);
  }, [open, meta]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const select = 'w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="项目设置"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`shrink-0 rounded-md px-2 py-1 ${
          open ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
        }`}
      >
        <SettingsIcon size={15} />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg">
          <h2 className="text-sm font-semibold text-zinc-900">项目设置</h2>
          <p className="mt-1 text-xs text-zinc-400">覆盖全局默认，对新启动的会话生效。</p>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <div className="mt-3 space-y-3">
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
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              取消
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
