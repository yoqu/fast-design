import { describe, expect, it } from 'vitest';
import {
  CHAT_PANEL_WIDTH_KEY,
  DEFAULT_CHAT_PANEL_WIDTH,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  clampChatPanelWidth,
  readSavedChatPanelWidth,
  saveChatPanelWidth,
} from './chatPanelWidth';

function memStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('clampChatPanelWidth', () => {
  it('限制在 [345, 720]', () => {
    expect(clampChatPanelWidth(100)).toBe(MIN_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(9999)).toBe(MAX_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(500)).toBe(500);
  });
  it('非法值回落默认 460', () => {
    expect(clampChatPanelWidth(Number.NaN)).toBe(DEFAULT_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(Infinity)).toBe(MAX_CHAT_PANEL_WIDTH);
  });
});

describe('read/save', () => {
  it('无存储回落默认', () => {
    expect(readSavedChatPanelWidth(memStorage())).toBe(DEFAULT_CHAT_PANEL_WIDTH);
  });
  it('读取时 clamp 越界存量', () => {
    expect(readSavedChatPanelWidth(memStorage({ [CHAT_PANEL_WIDTH_KEY]: '50' }))).toBe(MIN_CHAT_PANEL_WIDTH);
  });
  it('save 后可 read 回', () => {
    const s = memStorage();
    saveChatPanelWidth(512, s);
    expect(readSavedChatPanelWidth(s)).toBe(512);
  });
});
