import type { ProjectMeta } from './types';

/** Projects 视图子标签:recent=最近修改优先(参照 Recent),created=创建时间优先(参照 Yours)。 */
export type ProjectsSubTab = 'recent' | 'created';

export function filterProjects(list: ProjectMeta[], query: string): ProjectMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) => p.name.toLowerCase().includes(q));
}

export function sortProjects(list: ProjectMeta[], tab: ProjectsSubTab): ProjectMeta[] {
  return [...list].sort((a, b) =>
    tab === 'recent'
      ? (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)
      : b.createdAt - a.createdAt,
  );
}
