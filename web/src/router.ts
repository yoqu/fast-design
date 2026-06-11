// 自研轻量路由(行为照抄参照 open-design router.ts):URL 是
// "当前视图/打开文件"的唯一真值来源,pushState + popstate 驱动
// useSyncExternalStore,避免引入 react-router。
import { useSyncExternalStore } from 'react';

export type EntryHomeView = 'home' | 'projects';

export type Route =
  | { kind: 'home'; view: EntryHomeView }
  | {
      kind: 'project';
      projectId: string;
      /** 会话深链;不存在时由 ProjectView 回落 list[0]。 */
      conversationId?: string | null;
      fileName: string | null;
    };

export function parseRoute(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'home', view: 'projects' };
  if (parts[0] === 'home') return { kind: 'home', view: 'home' };
  if (parts[0] === 'projects') {
    if (parts[1]) {
      const projectId = decodeURIComponent(parts[1]);
      if (parts[2] === 'conversations' && parts[3]) {
        const conversationId = decodeURIComponent(parts[3]);
        if (parts[4] === 'files' && parts[5]) {
          return { kind: 'project', projectId, conversationId, fileName: decodeURIComponent(parts.slice(5).join('/')) };
        }
        return { kind: 'project', projectId, conversationId, fileName: null };
      }
      if (parts[2] === 'files' && parts[3]) {
        return { kind: 'project', projectId, conversationId: null, fileName: decodeURIComponent(parts.slice(3).join('/')) };
      }
      return { kind: 'project', projectId, conversationId: null, fileName: null };
    }
    return { kind: 'home', view: 'projects' };
  }
  return { kind: 'home', view: 'projects' };
}

export function buildPath(route: Route): string {
  if (route.kind === 'home') return route.view === 'home' ? '/home' : '/projects';
  const id = encodeURIComponent(route.projectId);
  const file = route.fileName
    ? route.fileName.split('/').map((s) => encodeURIComponent(s)).join('/')
    : null;
  if (route.conversationId) {
    const cid = encodeURIComponent(route.conversationId);
    return file
      ? `/projects/${id}/conversations/${cid}/files/${file}`
      : `/projects/${id}/conversations/${cid}`;
  }
  return file ? `/projects/${id}/files/${file}` : `/projects/${id}`;
}

// popstate 派发推迟到微任务,允许在 render/setState 中安全调用(同参照)。
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const target = buildPath(route);
  if (target === window.location.pathname) return;
  if (opts.replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  queueMicrotask(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

let cachedPathname: string | null = null;
let cachedRoute: Route | null = null;

function getRouteSnapshot(): Route {
  const pathname = window.location.pathname;
  if (cachedPathname !== pathname || cachedRoute === null) {
    cachedPathname = pathname;
    cachedRoute = parseRoute(pathname);
  }
  return cachedRoute;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRouteSnapshot, getRouteSnapshot);
}
