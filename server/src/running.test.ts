import { describe, expect, it } from 'vitest';
import { runningProjectIds } from './running.js';

describe('runningProjectIds', () => {
  it('从 busy session 中提取项目 id', () => {
    const sessions = new Map([
      ['p1:c1', { isBusy: true }],
      ['p1:c2', { isBusy: false }],
      ['p2:c9', { isBusy: false }],
      ['p3:c0', { isBusy: true }],
    ]);
    expect(runningProjectIds(sessions)).toEqual(new Set(['p1', 'p3']));
  });
  it('空 sessions 返回空集', () => {
    expect(runningProjectIds(new Map())).toEqual(new Set());
  });
});
