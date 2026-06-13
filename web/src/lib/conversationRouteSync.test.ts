// web/src/lib/conversationRouteSync.test.ts
import { describe, expect, it } from 'vitest';
import { decideRouteConversationSync } from './conversationRouteSync';

describe('decideRouteConversationSync(对齐参照 ProjectView.tsx:1301-1319)', () => {
  it('外部前进后退:路由 cid 在列表且非本视图刚写入 → 采纳', () => {
    expect(
      decideRouteConversationSync({
        routeConversationId: 'a',
        activeConversationId: 'b',
        lastSyncedConversationId: 'b',
        lastSeenRouteConversationId: null,
        conversationIds: ['b', 'a'],
      }),
    ).toEqual({ adopt: true, lastSeenRouteConversationId: 'a' });
  });

  it('新建会话竞态:URL 还停在旧会话(= lastSynced)时不回翻活动会话', () => {
    // 复现 bug:createConversation 把 active 切到 b,conversations 重载触发
    // 本效应,此刻 URL 仍是旧会话 a;a 是本视图早前写入 URL 的,不是外部导航。
    expect(
      decideRouteConversationSync({
        routeConversationId: 'a',
        activeConversationId: 'b',
        lastSyncedConversationId: 'a',
        lastSeenRouteConversationId: null,
        conversationIds: ['b', 'a'],
      }),
    ).toEqual({ adopt: false, lastSeenRouteConversationId: null });
  });

  it('路由 cid 等于当前活动会话 → 不动作', () => {
    expect(
      decideRouteConversationSync({
        routeConversationId: 'a',
        activeConversationId: 'a',
        lastSyncedConversationId: null,
        lastSeenRouteConversationId: null,
        conversationIds: ['a'],
      }),
    ).toEqual({ adopt: false, lastSeenRouteConversationId: null });
  });

  it('路由无 cid → 不动作并清空 lastSeen', () => {
    expect(
      decideRouteConversationSync({
        routeConversationId: null,
        activeConversationId: 'a',
        lastSyncedConversationId: 'a',
        lastSeenRouteConversationId: 'x',
        conversationIds: ['a'],
      }),
    ).toEqual({ adopt: false, lastSeenRouteConversationId: null });
  });

  it('会话列表未加载 → 不动作且不标记 lastSeen(等列表到位后重试)', () => {
    expect(
      decideRouteConversationSync({
        routeConversationId: 'a',
        activeConversationId: null,
        lastSyncedConversationId: null,
        lastSeenRouteConversationId: null,
        conversationIds: [],
      }),
    ).toEqual({ adopt: false, lastSeenRouteConversationId: null });
  });

  it('路由 cid 不在列表(已删除等)→ 不采纳但标记 lastSeen', () => {
    expect(
      decideRouteConversationSync({
        routeConversationId: 'ghost',
        activeConversationId: 'a',
        lastSyncedConversationId: 'a',
        lastSeenRouteConversationId: null,
        conversationIds: ['a', 'b'],
      }),
    ).toEqual({ adopt: false, lastSeenRouteConversationId: 'ghost' });
  });

  it('同一路由 cid 已处理过(= lastSeen)→ 不重复采纳', () => {
    expect(
      decideRouteConversationSync({
        routeConversationId: 'a',
        activeConversationId: 'b',
        lastSyncedConversationId: 'b',
        lastSeenRouteConversationId: 'a',
        conversationIds: ['a', 'b'],
      }),
    ).toEqual({ adopt: false, lastSeenRouteConversationId: 'a' });
  });
});
