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
        <button onClick={() => void save()} disabled={!loaded} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50">
          保存
        </button>
      </div>
    </div>
  );
}
