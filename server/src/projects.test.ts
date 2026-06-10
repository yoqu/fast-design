import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createProject,
  deleteProject,
  getProject,
  listFiles,
  listProjects,
  projectDir,
  readHistory,
  appendHistory,
  safeResolve,
} from './projects.js';

const created: string[] = [];

afterAll(() => {
  for (const id of created) deleteProject(id);
});

describe('projects', () => {
  it('creates, lists and deletes projects', () => {
    const meta = createProject('测试项目');
    created.push(meta.id);
    expect(meta.name).toBe('测试项目');
    expect(listProjects().some((p) => p.id === meta.id)).toBe(true);
    expect(getProject(meta.id)?.id).toBe(meta.id);
  });

  it('persists chat history', () => {
    const meta = createProject('history');
    created.push(meta.id);
    expect(readHistory(meta.id)).toEqual([]);
    appendHistory(meta.id, { role: 'user', content: 'hi', createdAt: 1 });
    expect(readHistory(meta.id)).toHaveLength(1);
  });

  it('lists files excluding hidden dirs', () => {
    const meta = createProject('files');
    created.push(meta.id);
    fs.writeFileSync(`${projectDir(meta.id)}/index.html`, '<h1>hi</h1>');
    fs.mkdirSync(`${projectDir(meta.id)}/css`, { recursive: true });
    fs.writeFileSync(`${projectDir(meta.id)}/css/app.css`, 'body{}');
    const files = listFiles(meta.id).map((f) => f.path);
    expect(files).toEqual(['css/app.css', 'index.html']);
    expect(files.some((f) => f.includes('.webui'))).toBe(false);
  });

  it('rejects path traversal in safeResolve', () => {
    const meta = createProject('safe');
    created.push(meta.id);
    expect(safeResolve(meta.id, '../../etc/passwd')).toBeNull();
    expect(safeResolve(meta.id, 'a/../../x')).toBeNull();
    expect(safeResolve(meta.id, 'index.html')).toContain(projectDir(meta.id));
    expect(() => projectDir('../evil')).toThrow();
  });
});
