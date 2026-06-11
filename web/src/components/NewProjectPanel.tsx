import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { piApi } from '../lib/api';
import type { PiModel, ProjectFidelity, ProjectPlatform } from '../lib/types';
import { autoName, buildCreateRequest, DESIGN_PLATFORMS, type CreateProjectRequest } from '../lib/newProject';

type Props = {
  onClose: () => void;
  onCreate: (input: CreateProjectRequest) => Promise<void>;
  onImportClaudeDesign?: (file: File) => Promise<void>;
};

/**
 * 新建项目模态面板，对齐 open-design NewProjectPanel 的 prototype 选项卡：
 * 名称（空→autoName）、初始提示词（→pendingPrompt 预填）、目标平台多选
 * （默认 responsive）、保真度（默认 high-fidelity）、Landing Page / OS
 * Widgets 开关（默认关）。模型选择为本项目既有能力，保留。
 */
export default function NewProjectPanel({ onClose, onCreate, onImportClaudeDesign }: Props) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<PiModel[]>([]);
  const [platforms, setPlatforms] = useState<ProjectPlatform[]>(['responsive']);
  const [fidelity, setFidelity] = useState<ProjectFidelity>('high-fidelity');
  const [includeLandingPage, setIncludeLandingPage] = useState(false);
  const [includeOsWidgets, setIncludeOsWidgets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 占位名在面板打开期间保持稳定，避免每次渲染重建 Date。
  const [namePlaceholder] = useState(() => autoName());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    piApi.models().then(setModels).catch(() => setModels([]));
  }, []);

  const togglePlatform = (value: ProjectPlatform) => {
    setPlatforms((prev) => {
      const next = prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value];
      return next.length > 0 ? next : prev; // 至少保留一个平台
    });
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(
        buildCreateRequest({
          name,
          prompt,
          model: model || null,
          platformTargets: platforms,
          fidelity,
          includeLandingPage,
          includeOsWidgets,
        }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      setSubmitting(false);
    }
  };

  const handleImportPicked = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !onImportClaudeDesign) return;
    setImporting(true);
    setImportError(null);
    try {
      await onImportClaudeDesign(file);
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? `导入失败：${err.message}` : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-[480px] max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-900">新建项目</h2>

        <label className="mt-4 block text-xs font-medium text-zinc-500">项目名称</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={namePlaceholder}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />

        <label className="mt-3 block text-xs font-medium text-zinc-500">初始提示词（可选，创建后自动填入输入框）</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="描述你想做的界面，比如「做一个咖啡店落地页」"
          className="mt-1 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />

        <label className="mt-3 block text-xs font-medium text-zinc-500">目标平台</label>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {DESIGN_PLATFORMS.map((p) => (
            <button
              key={p.value}
              type="button"
              title={p.hint}
              onClick={() => togglePlatform(p.value)}
              className={`rounded-lg border px-2 py-1.5 text-xs ${
                platforms.includes(p.value)
                  ? 'border-zinc-800 bg-zinc-900 text-white'
                  : 'border-zinc-300 text-zinc-600 hover:border-zinc-400'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-medium text-zinc-500">保真度</label>
        <div className="mt-1 flex gap-1.5">
          {(
            [
              { value: 'high-fidelity', label: '高保真' },
              { value: 'wireframe', label: '线框图' },
            ] as Array<{ value: ProjectFidelity; label: string }>
          ).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFidelity(f.value)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${
                fidelity === f.value
                  ? 'border-zinc-800 bg-zinc-900 text-white'
                  : 'border-zinc-300 text-zinc-600 hover:border-zinc-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-1.5">
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={includeLandingPage} onChange={(e) => setIncludeLandingPage(e.target.checked)} />
            包含 Landing Page
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={includeOsWidgets} onChange={(e) => setIncludeOsWidgets(e.target.checked)} />
            包含 OS Widgets
          </label>
        </div>

        <label className="mt-3 block text-xs font-medium text-zinc-500">模型</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 outline-none focus:border-zinc-500"
        >
          <option value="">跟随全局默认</option>
          {models.map((m) => (
            <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
              {m.provider}/{m.id}
            </option>
          ))}
        </select>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        {onImportClaudeDesign && (
          <div className="mt-4 border-t border-zinc-200 pt-3">
            <label className="block text-xs font-medium text-zinc-500">或导入已有设计</label>
            <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportPicked} />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-40"
            >
              {importing ? '导入中…' : '导入 Claude Design 设计包（.zip）'}
            </button>
            {importError && <p className="mt-2 text-xs text-red-500">{importError}</p>}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-500 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
