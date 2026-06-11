// web/src/components/HandoffButton.tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { DetectedEditor } from '../lib/types';

type Props = { projectId: string; dir: string | null; editors: DetectedEditor[] };

const PREFERRED_EDITOR_KEY = 'webui:handoff.editor';

function cliCommands(dir: string): Array<{ label: string; command: string }> {
  return [
    { label: 'Claude Code', command: `cd "${dir}" && claude "继续开发这个项目"` },
    { label: 'Codex', command: `cd "${dir}" && codex "继续开发这个项目"` },
  ];
}

/**
 * Handoff 分体按钮,对齐参照 HandoffButton:左半键用首选编辑器打开项目,
 * 右半键下拉 Editors/CLI 两个标签。
 */
export default function HandoffButton({ projectId, dir, editors }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'editors' | 'cli'>('editors');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  const installed = editors.filter((e) => e.installed);
  const [preferredId, setPreferredId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PREFERRED_EDITOR_KEY);
    } catch {
      return null;
    }
  });
  const preferred = installed.find((e) => e.id === preferredId) ?? installed[0] ?? null;

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openWith = async (editorId: string) => {
    try {
      setPreferredId(editorId);
      try {
        localStorage.setItem(PREFERRED_EDITOR_KEY, editorId);
      } catch {
        // 仅失去记忆
      }
      await api.openInEditor(projectId, editorId);
      setError(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开失败');
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex overflow-hidden rounded-lg border border-zinc-200">
        <button
          type="button"
          disabled={!preferred}
          title={preferred ? `用 ${preferred.name} 打开` : '未检测到已安装编辑器'}
          onClick={() => preferred && void openWith(preferred.id)}
          className="px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
        >
          {preferred ? `用 ${preferred.name} 打开` : 'Handoff'}
        </button>
        <button
          type="button"
          aria-label="Handoff 选项"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
          className="border-l border-zinc-200 px-1.5 text-xs text-zinc-500 hover:bg-zinc-50"
        >
          ▾
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-2 text-xs shadow-lg">
          <div className="mb-2 flex rounded-lg bg-zinc-100 p-0.5">
            {(
              [
                ['editors', '编辑器'],
                ['cli', 'CLI'],
              ] as Array<['editors' | 'cli', string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 rounded-md px-2 py-1 ${tab === key ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'editors' ? (
            <div className="space-y-0.5">
              {editors.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  disabled={!e.installed}
                  onClick={() => void openWith(e.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-zinc-50 disabled:cursor-default disabled:text-zinc-300 disabled:hover:bg-transparent"
                >
                  <span>{e.name}</span>
                  {!e.installed && <span className="text-[10px]">未安装</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {dir ? (
                cliCommands(dir).map((c) => (
                  <div key={c.label} className="rounded-md border border-zinc-100 p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-600">{c.label}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(c.command);
                            setCopied(c.label);
                            if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
                            copyTimerRef.current = window.setTimeout(() => setCopied(null), 1500);
                          } catch {
                            setError('复制失败:浏览器不支持或非安全上下文');
                          }
                        }}
                        className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100"
                      >
                        {copied === c.label ? '已复制' : '复制'}
                      </button>
                    </div>
                    <code className="mt-1 block break-all text-[10px] text-zinc-400">{c.command}</code>
                  </div>
                ))
              ) : (
                <p className="px-2 py-1 text-zinc-400">目录信息不可用</p>
              )}
            </div>
          )}
          {error && <p className="mt-1 px-2 text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
