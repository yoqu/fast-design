import { describe, expect, it } from 'vitest';
import type { ProjectMeta } from './types';
import { filterProjects, sortProjects } from './projectsList';

const p = (id: string, name: string, createdAt: number, updatedAt?: number): ProjectMeta =>
  ({ id, name, createdAt, updatedAt }) as ProjectMeta;

describe('filterProjects', () => {
  const list = [p('1', 'Coffee Shop', 1), p('2', '咖啡店落地页', 2), p('3', 'Dashboard', 3)];
  it('空查询返回原列表', () => {
    expect(filterProjects(list, '  ')).toEqual(list);
  });
  it('大小写不敏感匹配名称', () => {
    expect(filterProjects(list, 'coffee').map((x) => x.id)).toEqual(['1']);
    expect(filterProjects(list, '咖啡').map((x) => x.id)).toEqual(['2']);
  });
});

describe('sortProjects', () => {
  const list = [p('a', 'A', 100, 500), p('b', 'B', 300), p('c', 'C', 200, 900)];
  it('recent 按 updatedAt(缺省回落 createdAt)降序', () => {
    expect(sortProjects(list, 'recent').map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
  it('created 按 createdAt 降序', () => {
    expect(sortProjects(list, 'created').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('不改原数组', () => {
    const copy = [...list];
    sortProjects(list, 'recent');
    expect(list).toEqual(copy);
  });
});
