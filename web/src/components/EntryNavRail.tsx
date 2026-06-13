// web/src/components/EntryNavRail.tsx
import type { EntryHomeView } from '../router';
import { HouseIcon, LayoutGridIcon, PanelLeftCloseIcon, PlusIcon, SettingsIcon, type IconProps } from './icons';
import type { ReactElement } from 'react';

type Props = {
  open: boolean;
  view: EntryHomeView;
  onClose: () => void;
  onNavigate: (view: EntryHomeView) => void;
  onNewProject: () => void;
  onOpenSettings: () => void;
};

const NAV_ITEMS: Array<{ view: EntryHomeView; label: string; icon: (props: IconProps) => ReactElement }> = [
  { view: 'home', label: 'Home', icon: HouseIcon },
  { view: 'projects', label: 'Projects', icon: LayoutGridIcon },
];

/**
 * 入口导航 rail,对齐参照 EntryNavRail.tsx:89-193(manus 式停靠:
 * 打开后点导航不自动收起,仅折叠按钮关闭;状态不持久化)。
 * Tasks/Design Systems/Plugins/Integrations 为排除项,不放。
 */
export default function EntryNavRail({ open, view, onClose, onNavigate, onNewProject, onOpenSettings }: Props) {
  if (!open) return null;
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50" aria-label="主导航">
      <div className="flex items-center gap-2 px-4 py-3.5">
        <button type="button" className="flex items-center gap-2" onClick={() => onNavigate('projects')}>
          <span className="text-lg">π</span>
          <span className="text-sm font-semibold text-zinc-800">fast-design</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          title="收起导航"
          aria-label="收起导航"
          onClick={onClose}
          className="rounded-md px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <PanelLeftCloseIcon size={15} />
        </button>
      </div>
      <div className="px-2">
        <button
          type="button"
          onClick={onNewProject}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
        >
          <PlusIcon size={14} />
          新建项目
        </button>
      </div>
      <nav className="mt-2 flex-1 space-y-0.5 px-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              view === item.view ? 'bg-zinc-200/80 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <item.icon size={15} className="text-zinc-500" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="border-t border-zinc-200 p-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <SettingsIcon size={15} />
          设置
        </button>
      </div>
    </aside>
  );
}
