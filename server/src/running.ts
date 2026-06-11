/** 从 session 表(key 为 `${projectId}:${cid}`)提取仍在生成中的项目 id 集。 */
export function runningProjectIds(sessions: Iterable<[string, { isBusy: boolean }]>): Set<string> {
  const out = new Set<string>();
  for (const [key, session] of sessions) {
    if (!session.isBusy) continue;
    const sep = key.indexOf(':');
    if (sep > 0) out.add(key.slice(0, sep));
  }
  return out;
}
