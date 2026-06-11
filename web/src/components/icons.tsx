// 统一图标库：lucide 线性图标（经 better-icons 取自 Iconify），接近
// macOS/SF Symbols 的细线条质感（stroke 1.75、currentColor、圆角端点）。
// 全站 UI 图标一律从这里取，不再使用 emoji/字符替代。
import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function createIcon(markup: string, displayName: string) {
  function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: markup }}
        {...props}
      />
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

// lucide:pencil-line
export const PencilLineIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M13 21h8M15 5l4 4m2.174-2.188a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>', 'PencilLineIcon');

// lucide:pencil
export const PencilIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4"/>', 'PencilIcon');

// lucide:monitor
export const MonitorIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><rect fill="currentColor" width="20" height="14" x="2" y="3" rx="2"/><path fill="currentColor" d="M8 21h8m-4-4v4"/></g>', 'MonitorIcon');

// lucide:tablet
export const TabletIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><rect fill="currentColor" width="16" height="20" x="4" y="2" rx="2" ry="2"/><path fill="currentColor" d="M12 18h.01"/></g>', 'TabletIcon');

// lucide:smartphone
export const SmartphoneIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><rect fill="currentColor" width="14" height="20" x="5" y="2" rx="2" ry="2"/><path fill="currentColor" d="M12 18h.01"/></g>', 'SmartphoneIcon');

// lucide:rotate-cw
export const RefreshIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><path fill="currentColor" d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path fill="currentColor" d="M21 3v5h-5"/></g>', 'RefreshIcon');

// lucide:external-link
export const ExternalLinkIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 'ExternalLinkIcon');

// lucide:undo-2
export const UndoIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><path fill="currentColor" d="M9 14L4 9l5-5"/><path fill="currentColor" d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></g>', 'UndoIcon');

// lucide:download
export const DownloadIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><path fill="currentColor" d="M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path fill="currentColor" d="m7 10l5 5l5-5"/></g>', 'DownloadIcon');

// lucide:x
export const XIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M18 6L6 18M6 6l12 12"/>', 'XIcon');

// lucide:plus
export const PlusIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M5 12h14m-7-7v14"/>', 'PlusIcon');

// lucide:settings
export const SettingsIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><path fill="currentColor" d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle fill="currentColor" cx="12" cy="12" r="3"/></g>', 'SettingsIcon');

// lucide:folder
export const FolderIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>', 'FolderIcon');

// lucide:chevron-down
export const ChevronDownIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m6 9l6 6l6-6"/>', 'ChevronDownIcon');

// lucide:chevron-right
export const ChevronRightIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m9 18l6-6l-6-6"/>', 'ChevronRightIcon');

// lucide:panel-left-close
export const PanelLeftCloseIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><rect fill="currentColor" width="18" height="18" x="3" y="3" rx="2"/><path fill="currentColor" d="M9 3v18m7-6l-3-3l3-3"/></g>', 'PanelLeftCloseIcon');

// lucide:panel-left-open
export const PanelLeftOpenIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><rect fill="currentColor" width="18" height="18" x="3" y="3" rx="2"/><path fill="currentColor" d="M9 3v18m5-12l3 3l-3 3"/></g>', 'PanelLeftOpenIcon');

// lucide:arrow-left
export const ArrowLeftIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m12 19l-7-7l7-7m7 7H5"/>', 'ArrowLeftIcon');

// lucide:arrow-right
export const ArrowRightIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M5 12h14m-7-7l7 7l-7 7"/>', 'ArrowRightIcon');

// lucide:arrow-up
export const ArrowUpIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m5 12l7-7l7 7m-7 7V5"/>', 'ArrowUpIcon');

// lucide:upload
export const UploadIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 3v12m5-7l-5-5l-5 5m14 7v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>', 'UploadIcon');

// lucide:check
export const CheckIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M20 6L9 17l-5-5"/>', 'CheckIcon');

// lucide:ellipsis
export const EllipsisIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><circle fill="currentColor" cx="12" cy="12" r="1"/><circle fill="currentColor" cx="19" cy="12" r="1"/><circle fill="currentColor" cx="5" cy="12" r="1"/></g>', 'EllipsisIcon');

// lucide:menu
export const MenuIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M4 5h16M4 12h16M4 19h16"/>', 'MenuIcon');

// lucide:house
export const HouseIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><path fill="currentColor" d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path fill="currentColor" d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></g>', 'HouseIcon');

// lucide:layout-grid
export const LayoutGridIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><rect fill="currentColor" width="7" height="7" x="3" y="3" rx="1"/><rect fill="currentColor" width="7" height="7" x="14" y="3" rx="1"/><rect fill="currentColor" width="7" height="7" x="14" y="14" rx="1"/><rect fill="currentColor" width="7" height="7" x="3" y="14" rx="1"/></g>', 'LayoutGridIcon');

// lucide:loader-circle
export const LoaderIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M21 12a9 9 0 1 1-6.219-8.56"/>', 'LoaderIcon');

// lucide:circle-check
export const CircleCheckIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><circle fill="currentColor" cx="12" cy="12" r="10"/><path fill="currentColor" d="m9 12l2 2l4-4"/></g>', 'CircleCheckIcon');

// lucide:circle-x
export const CircleXIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><circle fill="currentColor" cx="12" cy="12" r="10"/><path fill="currentColor" d="m15 9l-6 6m0-6l6 6"/></g>', 'CircleXIcon');

// lucide:triangle-alert
export const TriangleAlertIcon = createIcon('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/>', 'TriangleAlertIcon');

// lucide:square
export const SquareIcon = createIcon('<rect width="18" height="18" x="3" y="3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" rx="2"/>', 'SquareIcon');

// lucide:sparkles
export const SparklesIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><path fill="currentColor" d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4m2-2h-4"/><circle fill="currentColor" cx="4" cy="20" r="2"/></g>', 'SparklesIcon');

// lucide:brain
export const BrainIcon = createIcon('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"><path fill="currentColor" d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path fill="currentColor" d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path fill="currentColor" d="M18 18a4 4 0 0 0 2-7.464"/><path fill="currentColor" d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path fill="currentColor" d="M6 18a4 4 0 0 1-2-7.464"/><path fill="currentColor" d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/></g>', 'BrainIcon');

