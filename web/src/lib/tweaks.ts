// Tweaks 宿主协议 Protocol A（参照 design-templates/tweaks/SKILL.md:150-187）的
// 纯决策层：把 artifact → 宿主 的 postMessage 折算成「工具栏开关该置何值 + 是否
// 需要回送指令同步 iframe 面板」，与 FileViewer 的 React 状态/副作用解耦，便于测试。
//
// 关键修复：协议约定 `visible` 省略/为 true 代表「面板已在屏上」，但实践中部分
// artifact（如 frontend-design 生成件）上报 __edit_mode_available 时面板其实默认
// 关闭、等待显式 __activate_edit_mode。若宿主只把开关置「开」而不回送指令，就会
// 出现开关显示「开」却没有面板、需双击才唤起的错位。故默认开启时主动回送
// __activate_edit_mode，让面板与开关一致地展开。

export type TweaksHostCommand = '__activate_edit_mode' | '__deactivate_edit_mode';

export interface TweaksSyncAction {
  /** 是否更新工具栏「可用」标志（undefined 表示不变） */
  available?: boolean;
  /** 是否更新工具栏「开/关」标志（undefined 表示不变） */
  on?: boolean;
  /** 需要回送给 iframe 的指令，用于强制面板与开关同步（undefined 表示不回送） */
  command?: TweaksHostCommand;
}

/**
 * 把一条来自 artifact 的 postMessage 数据折算成宿主应执行的同步动作。
 * 非 Tweaks 协议消息返回 null。
 */
export function reduceTweaksMessage(data: unknown): TweaksSyncAction | null {
  if (!data || typeof data !== 'object') return null;
  const type = (data as { type?: unknown }).type;
  if (type === '__edit_mode_available') {
    const on = (data as { visible?: unknown }).visible !== false;
    return on
      ? { available: true, on: true, command: '__activate_edit_mode' }
      : { available: true, on: false };
  }
  if (type === '__edit_mode_dismissed') {
    return { on: false };
  }
  return null;
}
