import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintPreviewScope, previewScopeRe, validatePreviewScope } from './preview-scopes.js';

// 隔离数据目录：preview scope 现在持久化到 data 根，测试不污染真实 data/。
let dataDir: string;
beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-preview-scopes-'));
  process.env.PI_WEBUI_DATA = dataDir;
});
afterAll(() => {
  delete process.env.PI_WEBUI_DATA;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('preview scopes', () => {
  it('mints tokens matching the scope pattern', () => {
    const token = mintPreviewScope('proj-a');
    expect(token).toMatch(previewScopeRe);
  });

  it('validates only minted tokens for the same project', () => {
    const token = mintPreviewScope('proj-b');
    expect(validatePreviewScope('proj-b', token)).toBe(true);
    expect(validatePreviewScope('proj-other', token)).toBe(false);
    expect(validatePreviewScope('proj-b', 'deadbeefdeadbeefdeadbeef')).toBe(false);
  });

  it('evicts oldest tokens beyond the per-project cap', () => {
    const first = mintPreviewScope('proj-c');
    for (let i = 0; i < 32; i++) mintPreviewScope('proj-c');
    expect(validatePreviewScope('proj-c', first)).toBe(false);
  });

  it('tokens survive a server restart (persisted under the data root)', async () => {
    const token = mintPreviewScope('proj-restart');
    // tsx watch 改一行服务端代码就重启进程；resetModules 后重新 import
    // 得到全新模块实例，等价于重启后的进程。
    vi.resetModules();
    const fresh = await import('./preview-scopes.js');
    expect(fresh.validatePreviewScope('proj-restart', token)).toBe(true);
    expect(fresh.validatePreviewScope('proj-other', token)).toBe(false);
  });
});
