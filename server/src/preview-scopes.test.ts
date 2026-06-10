import { describe, expect, it } from 'vitest';
import { mintPreviewScope, previewScopeRe, validatePreviewScope } from './preview-scopes.js';

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
});
