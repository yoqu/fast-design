// web/src/App.tsx
import { useCallback, useEffect, useState } from 'react';
import { piApi } from './lib/api';
import { navigate, useRoute } from './router';
import EntryShell from './components/EntryShell';
import ProjectView from './components/ProjectView';
import InstallGuide from './components/InstallGuide';

/** 路由分发壳:home → EntryShell,project → ProjectView。 */
export default function App() {
  const route = useRoute();
  const [piInstalled, setPiInstalled] = useState<boolean | null>(null);

  const checkPi = useCallback(async (): Promise<boolean> => {
    try {
      const status = await piApi.status();
      setPiInstalled(status.installed);
      return status.installed;
    } catch {
      setPiInstalled(true); // server 不可达时不阻塞主界面,由各视图错误流程提示
      return true;
    }
  }, []);

  useEffect(() => {
    void checkPi();
  }, [checkPi]);

  // `/` 规范化为 `/projects`(默认落项目列表)。
  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      navigate({ kind: 'home', view: 'projects' }, { replace: true });
    }
  }, []);

  if (piInstalled === false) return <InstallGuide onRecheck={checkPi} />;

  if (route.kind === 'project') {
    return (
      <ProjectView
        key={route.projectId}
        projectId={route.projectId}
        routeConversationId={route.conversationId ?? null}
        routeFileName={route.fileName}
      />
    );
  }
  return <EntryShell view={route.view} />;
}
