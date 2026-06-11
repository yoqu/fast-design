import { describe, expect, it } from 'vitest';
import { detectEditors, EDITOR_CANDIDATES, openInEditor } from './handoff.js';

describe('detectEditors', () => {
  it('darwin 下 /Applications 命中即 installed', () => {
    const out = detectEditors({
      platform: 'darwin',
      exists: (p) => p === '/Applications/Cursor.app',
      hasBin: () => false,
    });
    expect(out.find((e) => e.id === 'cursor')?.installed).toBe(true);
    expect(out.find((e) => e.id === 'vscode')?.installed).toBe(false);
  });
  it('PATH 上有 bin 也算 installed(非 darwin)', () => {
    const out = detectEditors({
      platform: 'linux',
      exists: () => false,
      hasBin: (bin) => bin === 'code',
    });
    expect(out.find((e) => e.id === 'vscode')?.installed).toBe(true);
  });
  it('返回全部候选且顺序稳定', () => {
    const out = detectEditors({ platform: 'linux', exists: () => false, hasBin: () => false });
    expect(out.map((e) => e.id)).toEqual(EDITOR_CANDIDATES.map((c) => c.id));
  });
});

describe('openInEditor', () => {
  it('未知编辑器返回 false', () => {
    expect(openInEditor('not-an-editor', '/tmp')).toBe(false);
  });
});
