import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime';

const NOW = 1_750_000_000_000;

describe('relativeTime', () => {
  it('1 分钟内 → 刚才', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('刚才');
  });
  it('未来时间戳 → 刚才', () => {
    expect(relativeTime(NOW + 10_000, NOW)).toBe('刚才');
  });
  it('分钟', () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前');
  });
  it('小时', () => {
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前');
  });
  it('天', () => {
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2 天前');
  });
  it('超过 30 天显示日期', () => {
    const ts = NOW - 40 * 86_400_000;
    expect(relativeTime(ts, NOW)).toBe(new Date(ts).toLocaleDateString('zh-CN'));
  });
});
