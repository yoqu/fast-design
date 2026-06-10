import { useEffect, useState } from 'react';
import { piApi } from '../../lib/api';
import type { PiStatus } from '../../lib/types';

export default function AboutSection() {
  const [status, setStatus] = useState<PiStatus | null>(null);

  useEffect(() => {
    piApi.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <div className="space-y-3 text-sm text-zinc-700">
      <h3 className="text-sm font-semibold text-zinc-800">关于</h3>
      <dl className="space-y-2">
        <div className="flex gap-2">
          <dt className="w-28 text-zinc-400">pi 状态</dt>
          <dd>{status ? (status.installed ? `已安装 v${status.version ?? '未知'}` : '未检测到') : '检测中…'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 text-zinc-400">配置目录</dt>
          <dd className="font-mono text-xs">{status?.piDir ?? '—'}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-400">
        Provider key 写入 auth.json，默认模型写入 settings.json，自定义 provider 写入 models.json——与终端里的 pi 共享同一份配置。
      </p>
    </div>
  );
}
