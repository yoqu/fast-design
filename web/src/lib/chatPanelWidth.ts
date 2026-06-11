// 常量对齐参照 ProjectView.tsx:295-309。
export const DEFAULT_CHAT_PANEL_WIDTH = 460;
export const MIN_CHAT_PANEL_WIDTH = 345;
export const MAX_CHAT_PANEL_WIDTH = 720;
export const CHAT_PANEL_KEYBOARD_STEP = 16;
export const CHAT_PANEL_WIDTH_KEY = 'webui:project.chatPanelWidth';

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function clampChatPanelWidth(width: number): number {
  if (Number.isNaN(width)) return DEFAULT_CHAT_PANEL_WIDTH;
  return Math.min(MAX_CHAT_PANEL_WIDTH, Math.max(MIN_CHAT_PANEL_WIDTH, Math.round(width)));
}

export function readSavedChatPanelWidth(storage: StorageLike = localStorage): number {
  try {
    const raw = storage.getItem(CHAT_PANEL_WIDTH_KEY);
    if (!raw) return DEFAULT_CHAT_PANEL_WIDTH;
    return clampChatPanelWidth(Number(raw));
  } catch {
    return DEFAULT_CHAT_PANEL_WIDTH;
  }
}

export function saveChatPanelWidth(width: number, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(CHAT_PANEL_WIDTH_KEY, String(clampChatPanelWidth(width)));
  } catch {
    // localStorage 不可用时仅失去记忆,无碍。
  }
}
