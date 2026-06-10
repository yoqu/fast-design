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
