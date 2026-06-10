import express from 'express';
import { projectDir, getProject } from './projects.js';
import {
  CUSTOM_PROVIDER_APIS,
  ConfigCorruptError,
  deleteCustomProvider,
  deleteProviderKey,
  getPiSettings,
  listCustomProviders,
  listProviders,
  setProviderKey,
  updatePiSettings,
  upsertCustomProvider,
} from './pi-config.js';
import {
  createSkill,
  deleteSkill,
  listSkills,
  readSkillContent,
  setSkillEnabled,
  writeSkillContent,
  type SkillScope,
} from './pi-skills.js';
import { getPiStatus, installExtension, listExtensions, listModels, removeExtension } from './pi-cli.js';
import { readWebuiSettings, writeWebuiSettings } from './webui-settings.js';

function errStatus(err: unknown): number {
  if (err instanceof ConfigCorruptError) return 500;
  const msg = String(err);
  if (msg.includes('OAUTH_READONLY')) return 409;
  if (msg.includes('SKILL_EXISTS')) return 409;
  if (msg.includes('BAD_')) return 400;
  if (msg.includes('UNKNOWN_PROVIDER')) return 400;
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 404;
  return 500;
}

function handle(res: express.Response, fn: () => unknown): void {
  try {
    const result = fn();
    res.json(result ?? { ok: true });
  } catch (err) {
    res.status(errStatus(err)).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAsync(res: express.Response, fn: () => Promise<unknown>): Promise<void> {
  try {
    res.json((await fn()) ?? { ok: true });
  } catch (err) {
    res.status(errStatus(err)).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

/** projectId（可选）→ 项目目录，用于项目级技能。 */
function projectDirOf(req: express.Request): string | null {
  const id = typeof req.query.projectId === 'string' ? req.query.projectId : '';
  if (!id) return null;
  if (!getProject(id)) return null;
  return projectDir(id);
}

function skillScope(value: unknown): SkillScope {
  return value === 'project' ? 'project' : 'global';
}

export type PiRoutesDeps = {
  /** 配置变更后让空闲会话下次以新参数重启。 */
  disposeIdleSessions: () => void;
};

export function registerPiRoutes(app: express.Express, deps: PiRoutesDeps): void {
  app.get('/api/pi/status', (_req, res) => void handleAsync(res, () => getPiStatus()));

  app.get('/api/pi/settings', (_req, res) => handle(res, () => getPiSettings()));
  app.put('/api/pi/settings', (req, res) =>
    handle(res, () => {
      const pick = (k: string) => {
        const v = (req.body ?? {})[k];
        return v === undefined ? undefined : typeof v === 'string' && v ? v : null;
      };
      const result = updatePiSettings({
        defaultProvider: pick('defaultProvider'),
        defaultModel: pick('defaultModel'),
        defaultThinkingLevel: pick('defaultThinkingLevel'),
      });
      deps.disposeIdleSessions();
      return result;
    }),
  );

  app.get('/api/pi/providers', (_req, res) =>
    handle(res, () => ({ ...listProviders(), custom: listCustomProviders(), apis: CUSTOM_PROVIDER_APIS })),
  );
  app.put('/api/pi/providers/:id/key', (req, res) =>
    handle(res, () => {
      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      if (!key) throw new Error('BAD_REQUEST: key 不能为空');
      setProviderKey(req.params.id, key);
      deps.disposeIdleSessions();
    }),
  );
  app.delete('/api/pi/providers/:id/key', (req, res) =>
    handle(res, () => {
      deleteProviderKey(req.params.id);
      deps.disposeIdleSessions();
    }),
  );

  app.post('/api/pi/custom-providers', (req, res) =>
    handle(res, () => {
      const { id, baseUrl, api, apiKey, models } = req.body ?? {};
      if (typeof id !== 'string' || typeof baseUrl !== 'string' || typeof api !== 'string') {
        throw new Error('BAD_REQUEST: 需要 id/baseUrl/api');
      }
      upsertCustomProvider(id, { baseUrl, api, apiKey, models: Array.isArray(models) ? models : [] });
      deps.disposeIdleSessions();
      return listCustomProviders();
    }),
  );
  app.put('/api/pi/custom-providers/:id', (req, res) =>
    handle(res, () => {
      const { baseUrl, api, apiKey, models } = req.body ?? {};
      if (typeof baseUrl !== 'string' || typeof api !== 'string') throw new Error('BAD_REQUEST: 需要 baseUrl/api');
      upsertCustomProvider(req.params.id, { baseUrl, api, apiKey, models: Array.isArray(models) ? models : [] });
      deps.disposeIdleSessions();
      return listCustomProviders();
    }),
  );
  app.delete('/api/pi/custom-providers/:id', (req, res) =>
    handle(res, () => {
      deleteCustomProvider(req.params.id);
      deps.disposeIdleSessions();
      return listCustomProviders();
    }),
  );

  app.get('/api/pi/models', (_req, res) => void handleAsync(res, async () => ({ models: await listModels() })));

  app.get('/api/pi/skills', (req, res) => handle(res, () => ({ skills: listSkills(projectDirOf(req)) })));
  app.put('/api/pi/skills/toggles', (req, res) =>
    handle(res, () => {
      const { scope, rel, enabled } = req.body ?? {};
      if (typeof rel !== 'string' || typeof enabled !== 'boolean') throw new Error('BAD_REQUEST: 需要 rel/enabled');
      setSkillEnabled(skillScope(scope), rel, enabled, projectDirOf(req));
      deps.disposeIdleSessions();
    }),
  );
  app.post('/api/pi/skills', (req, res) =>
    handle(res, () => {
      const { name, description } = req.body ?? {};
      if (typeof name !== 'string') throw new Error('BAD_REQUEST: 需要 name');
      return createSkill(name, typeof description === 'string' ? description : '');
    }),
  );
  app.get('/api/pi/skills/content', (req, res) =>
    handle(res, () => {
      const rel = typeof req.query.rel === 'string' ? req.query.rel : '';
      if (!rel) throw new Error('BAD_REQUEST: 需要 rel');
      return { content: readSkillContent(skillScope(req.query.scope), rel, projectDirOf(req)) };
    }),
  );
  app.put('/api/pi/skills/content', (req, res) =>
    handle(res, () => {
      const { scope, rel, content } = req.body ?? {};
      if (typeof rel !== 'string' || typeof content !== 'string') throw new Error('BAD_REQUEST: 需要 rel/content');
      writeSkillContent(skillScope(scope), rel, content, projectDirOf(req));
    }),
  );
  app.delete('/api/pi/skills', (req, res) =>
    handle(res, () => {
      const rel = typeof req.query.rel === 'string' ? req.query.rel : '';
      if (!rel) throw new Error('BAD_REQUEST: 需要 rel');
      deleteSkill(skillScope(req.query.scope), rel, projectDirOf(req));
    }),
  );

  app.get('/api/pi/extensions', (_req, res) => handle(res, () => ({ extensions: listExtensions() })));
  app.post('/api/pi/extensions', (req, res) =>
    void handleAsync(res, async () => {
      const source = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
      const result = await installExtension(source);
      deps.disposeIdleSessions();
      return result;
    }),
  );
  app.delete('/api/pi/extensions', (req, res) =>
    void handleAsync(res, async () => {
      const source = typeof req.query.source === 'string' ? req.query.source : '';
      const result = await removeExtension(source);
      deps.disposeIdleSessions();
      return result;
    }),
  );

  app.get('/api/pi/instructions', (_req, res) =>
    handle(res, () => ({ instructions: readWebuiSettings().instructions ?? '' })),
  );
  app.put('/api/pi/instructions', (req, res) =>
    handle(res, () => {
      const instructions = typeof req.body?.instructions === 'string' ? req.body.instructions : '';
      writeWebuiSettings({ instructions });
      deps.disposeIdleSessions();
      return { instructions };
    }),
  );
}
