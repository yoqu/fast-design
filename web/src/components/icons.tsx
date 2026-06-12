// 统一图标库：手绘 lucide 风格线性 SVG 图标，接近 macOS/SF Symbols 的
// 细线条质感（stroke 1.75、currentColor、圆角端点）。
// 全部为纯 JSX 绘制：根 <svg> 统一 fill="none" + stroke="currentColor"，
// 子元素只描述几何路径，杜绝实心填充盖住描边的问题。
// 全站 UI 图标一律从这里取，不再使用 emoji/字符替代。
import type { ReactNode, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function createIcon(children: ReactNode, displayName: string) {
  function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {children}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

// 待办清单：左侧勾选框 + 右侧三行文字
export const ListTodoIcon = createIcon(
  <>
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="m3 17 2 2 4-4" />
    <path d="M13 6h8M13 12h8M13 18h8" />
  </>,
  'ListTodoIcon',
);

// 铅笔 + 底部横线
export const PencilLineIcon = createIcon(
  <>
    <path d="M13 21h8" />
    <path d="M15 5l4 4" />
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  </>,
  'PencilLineIcon',
);

// 铅笔
export const PencilIcon = createIcon(
  <>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="M15 5l4 4" />
  </>,
  'PencilIcon',
);

// 显示器
export const MonitorIcon = createIcon(
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8m-4-4v4" />
  </>,
  'MonitorIcon',
);

// 平板
export const TabletIcon = createIcon(
  <>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M12 18h.01" />
  </>,
  'TabletIcon',
);

// 手机
export const SmartphoneIcon = createIcon(
  <>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M12 18h.01" />
  </>,
  'SmartphoneIcon',
);

// 刷新（顺时针箭头）
export const RefreshIcon = createIcon(
  <>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </>,
  'RefreshIcon',
);

// 外部链接
export const ExternalLinkIcon = createIcon(
  <>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>,
  'ExternalLinkIcon',
);

// 撤销
export const UndoIcon = createIcon(
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
  </>,
  'UndoIcon',
);

// 下载
export const DownloadIcon = createIcon(
  <>
    <path d="M12 15V3" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
  </>,
  'DownloadIcon',
);

// 关闭（叉）
export const XIcon = createIcon(
  <path d="M18 6 6 18M6 6l12 12" />,
  'XIcon',
);

// 加号
export const PlusIcon = createIcon(
  <path d="M5 12h14m-7-7v14" />,
  'PlusIcon',
);

// 设置（齿轮）
export const SettingsIcon = createIcon(
  <>
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </>,
  'SettingsIcon',
);

// 文件夹
export const FolderIcon = createIcon(
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  'FolderIcon',
);

// 下箭头（chevron）
export const ChevronDownIcon = createIcon(
  <path d="m6 9 6 6 6-6" />,
  'ChevronDownIcon',
);

// 右箭头（chevron）
export const ChevronRightIcon = createIcon(
  <path d="m9 18 6-6-6-6" />,
  'ChevronRightIcon',
);

// 收起左侧栏
export const PanelLeftCloseIcon = createIcon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
    <path d="m16 15-3-3 3-3" />
  </>,
  'PanelLeftCloseIcon',
);

// 展开左侧栏
export const PanelLeftOpenIcon = createIcon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
    <path d="m14 9 3 3-3 3" />
  </>,
  'PanelLeftOpenIcon',
);

// 左箭头
export const ArrowLeftIcon = createIcon(
  <path d="m12 19-7-7 7-7m7 7H5" />,
  'ArrowLeftIcon',
);

// 右箭头
export const ArrowRightIcon = createIcon(
  <path d="M5 12h14m-7-7 7 7-7 7" />,
  'ArrowRightIcon',
);

// 上箭头
export const ArrowUpIcon = createIcon(
  <path d="m5 12 7-7 7 7m-7 7V5" />,
  'ArrowUpIcon',
);

// 上传
export const UploadIcon = createIcon(
  <>
    <path d="M12 3v12" />
    <path d="m17 8-5-5-5 5" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  </>,
  'UploadIcon',
);

// 对勾
export const CheckIcon = createIcon(
  <path d="M20 6 9 17l-5-5" />,
  'CheckIcon',
);

// 省略号（横向三点）
export const EllipsisIcon = createIcon(
  <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
  'EllipsisIcon',
);

// 菜单（三横线）
export const MenuIcon = createIcon(
  <path d="M4 5h16M4 12h16M4 19h16" />,
  'MenuIcon',
);

// 主页（房子）
export const HouseIcon = createIcon(
  <>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </>,
  'HouseIcon',
);

// 宫格布局
export const LayoutGridIcon = createIcon(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </>,
  'LayoutGridIcon',
);

// 加载中（缺口圆环，外部配 CSS 旋转动画）
export const LoaderIcon = createIcon(
  <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  'LoaderIcon',
);

// 圆圈对勾（成功）
export const CircleCheckIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </>,
  'CircleCheckIcon',
);

// 圆圈叉（失败）
export const CircleXIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6m0-6 6 6" />
  </>,
  'CircleXIcon',
);

// 三角警告
export const TriangleAlertIcon = createIcon(
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4m0 4h.01" />
  </>,
  'TriangleAlertIcon',
);

// 方块（停止）
export const SquareIcon = createIcon(
  <rect x="3" y="3" width="18" height="18" rx="2" />,
  'SquareIcon',
);

// 星光（AI 生成）
export const SparklesIcon = createIcon(
  <>
    <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
    <path d="M20 2v4m2-2h-4" />
    <circle cx="4" cy="20" r="2" />
  </>,
  'SparklesIcon',
);

// 大脑（思考中）
export const BrainIcon = createIcon(
  <>
    <path d="M12 18V5" />
    <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
    <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
    <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
    <path d="M18 18a4 4 0 0 0 2-7.464" />
    <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
    <path d="M6 18a4 4 0 0 1-2-7.464" />
    <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
  </>,
  'BrainIcon',
);
