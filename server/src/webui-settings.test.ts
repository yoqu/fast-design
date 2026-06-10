import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readWebuiSettings, webuiSettingsPath, writeWebuiSettings } from './webui-settings.js';

let original: string | null = null;

beforeAll(() => {
  try {
    original = fs.readFileSync(webuiSettingsPath(), 'utf8');
  } catch {
    original = null;
  }
});

afterAll(() => {
  if (original === null) fs.rmSync(webuiSettingsPath(), { force: true });
  else fs.writeFileSync(webuiSettingsPath(), original);
});

describe('webui-settings', () => {
  it('returns empty settings when file missing', () => {
    fs.rmSync(webuiSettingsPath(), { force: true });
    expect(readWebuiSettings()).toEqual({});
  });

  it('round-trips instructions', () => {
    writeWebuiSettings({ instructions: '全局指令' });
    expect(readWebuiSettings().instructions).toBe('全局指令');
  });
});
