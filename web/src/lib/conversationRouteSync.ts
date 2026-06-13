// web/src/lib/conversationRouteSync.ts
// 路由 cid → 活动会话的同步决策(对齐参照 ProjectView.tsx:1301-1319)。
// 难点:activeConversationId 被本地切换(新建会话等)改掉后,URL 同步
// 是下一个 effect 才追上的;期间路由里的旧 cid 不是外部导航,跟随它会把
// 刚切换的会话翻回去。靠 lastSynced(本视图最近写进 URL 的 cid)与
// lastSeen(已按外部导航处理过的 cid)区分"外部导航"与"本地切换的余波"。

export type RouteConversationSyncInput = {
  routeConversationId: string | null;
  activeConversationId: string | null;
  /** 本视图最近一次写进 URL 的会话 id(URL 同步 effect 在 navigate 前记录)。 */
  lastSyncedConversationId: string | null;
  /** 最近一次已按外部导航处理过的路由会话 id。 */
  lastSeenRouteConversationId: string | null;
  conversationIds: readonly string[];
};

export type RouteConversationSyncDecision = {
  /** true → 把 activeConversationId 切到 routeConversationId。 */
  adopt: boolean;
  /** 决策后 lastSeenRouteConversationId 应取的值。 */
  lastSeenRouteConversationId: string | null;
};

export function decideRouteConversationSync(
  input: RouteConversationSyncInput,
): RouteConversationSyncDecision {
  const {
    routeConversationId,
    activeConversationId,
    lastSyncedConversationId,
    lastSeenRouteConversationId,
    conversationIds,
  } = input;
  if (!routeConversationId) return { adopt: false, lastSeenRouteConversationId: null };
  // 列表未到位时不标记 lastSeen,等加载后重试本决策。
  if (conversationIds.length === 0) return { adopt: false, lastSeenRouteConversationId };
  if (routeConversationId === activeConversationId) {
    return { adopt: false, lastSeenRouteConversationId };
  }
  // 路由仍指向本视图刚写入 URL 的 cid → 本地切换抢先改了 active,URL 同步
  // 还没追上;跟随这个过期路由会与之互搏(参照 1307-1313 注释)。
  if (routeConversationId === lastSyncedConversationId) {
    return { adopt: false, lastSeenRouteConversationId };
  }
  if (routeConversationId === lastSeenRouteConversationId) {
    return { adopt: false, lastSeenRouteConversationId };
  }
  // 同参照:先标记已处理,再查列表;不在列表(已删除/陈旧深链)则不采纳。
  if (!conversationIds.includes(routeConversationId)) {
    return { adopt: false, lastSeenRouteConversationId: routeConversationId };
  }
  return { adopt: true, lastSeenRouteConversationId: routeConversationId };
}
