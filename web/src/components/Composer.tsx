import { useEffect, useRef, useState } from 'react';

type Props = {
  busy: boolean;
  /** 一次性预填文本（pendingPrompt）；变为非空时填入输入框并聚焦。 */
  seed?: string | null;
  onSend: (message: string) => void;
  onStop: () => void;
};

export default function Composer({ busy, seed, onSend, onStop }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!seed) return;
    setValue(seed);
    textareaRef.current?.focus();
  }, [seed]);

  const send = () => {
    const message = value.trim();
    if (!message || busy) return;
    setValue('');
    onSend(message);
  };

  return (
    <div className="border-t border-zinc-200 p-3">
      <div className="flex items-end gap-2 rounded-xl border border-zinc-300 bg-white p-2 focus-within:border-zinc-500">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={Math.min(6, Math.max(1, value.split('\n').length))}
          placeholder="描述你想开发的页面…（Enter 发送，Shift+Enter 换行）"
          className="max-h-40 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none"
        />
        {busy ? (
          <button
            onClick={onStop}
            className="rounded-lg bg-red-500 px-3.5 py-1.5 text-sm text-white hover:bg-red-600"
          >
            停止
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!value.trim()}
            className="rounded-lg bg-zinc-800 px-3.5 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
