import { useState } from 'react';
import ProvidersSection from './ProvidersSection';
import InstructionsSection from './InstructionsSection';
import SkillsSection from './SkillsSection';
import ExtensionsSection from './ExtensionsSection';
import AboutSection from './AboutSection';
import { XIcon } from '../icons';

type SectionId = 'providers' | 'instructions' | 'skills' | 'extensions' | 'about';

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'providers', label: 'Provider 与模型' },
  { id: 'instructions', label: '自定义指令' },
  { id: 'skills', label: 'Skills' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'about', label: '关于' },
];

type Props = { projectId: string | null; onClose: () => void };

export default function SettingsDialog({ projectId, onClose }: Props) {
  const [active, setActive] = useState<SectionId>('providers');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="flex h-[600px] w-[840px] overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="w-44 shrink-0 border-r border-zinc-100 bg-zinc-50 p-3">
          <h2 className="px-2 pb-2 text-sm font-semibold text-zinc-900">设置</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`mb-0.5 block w-full rounded-lg px-3 py-2 text-left text-sm ${
                active === s.id ? 'bg-zinc-200/80 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="relative min-w-0 flex-1">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            title="关闭"
            aria-label="关闭"
          >
            <XIcon size={15} />
          </button>
          <div className="h-full overflow-y-auto p-5">
            {active === 'providers' && <ProvidersSection />}
            {active === 'instructions' && <InstructionsSection />}
            {active === 'skills' && <SkillsSection projectId={projectId} />}
            {active === 'extensions' && <ExtensionsSection />}
            {active === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
