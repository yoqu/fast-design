import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createProject,
  decodeMultipartFilename,
  deleteProject,
  getProject,
  listFiles,
  listProjects,
  projectDir,
  safeResolve,
  touchProject,
  updateProject,
  validateProjectPath,
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

  it('updates project meta fields partially', () => {
    const meta = createProject('patch-me');
    created.push(meta.id);
    const updated = updateProject(meta.id, { model: 'minimax-cn/MiniMax-M2.7', thinking: 'high' });
    expect(updated?.model).toBe('minimax-cn/MiniMax-M2.7');
    expect(updated?.thinking).toBe('high');
    expect(updated?.name).toBe('patch-me');
    const cleared = updateProject(meta.id, { model: null, instructions: '项目指令' });
    expect(cleared?.model).toBeNull();
    expect(cleared?.thinking).toBe('high');
    expect(cleared?.instructions).toBe('项目指令');
  });
});

describe('createProject extras', () => {
  it('persists skillId, pendingPrompt, metadata and updatedAt', () => {
    const meta = createProject('p1-extras', null, {
      skillId: 'frontend-design',
      pendingPrompt: 'make a coffee landing page',
      metadata: {
        kind: 'prototype',
        platformTargets: ['responsive', 'mobile-ios'],
        fidelity: 'wireframe',
        includeLandingPage: true,
        includeOsWidgets: false,
        nameSource: 'generated',
      },
    });
    created.push(meta.id);
    const loaded = getProject(meta.id)!;
    expect(loaded.skillId).toBe('frontend-design');
    expect(loaded.pendingPrompt).toBe('make a coffee landing page');
    expect(loaded.updatedAt).toBe(loaded.createdAt);
    expect(loaded.metadata).toEqual({
      kind: 'prototype',
      platformTargets: ['responsive', 'mobile-ios'],
      fidelity: 'wireframe',
      includeLandingPage: true,
      includeOsWidgets: false,
      nameSource: 'generated',
    });
  });

  it('defaults metadata to { kind: prototype } when omitted (legacy callers)', () => {
    const meta = createProject('p1-legacy');
    created.push(meta.id);
    expect(meta.metadata).toEqual({ kind: 'prototype' });
    expect(meta.skillId).toBeNull();
    expect(meta.pendingPrompt).toBeNull();
  });
});

describe('updateProject extras', () => {
  it('updates name/skillId, clears pendingPrompt with null, bumps updatedAt', async () => {
    const meta = createProject('p1-update', null, { pendingPrompt: 'seed' });
    created.push(meta.id);
    await new Promise((r) => setTimeout(r, 5));
    const next = updateProject(meta.id, { name: 'renamed', skillId: 'frontend-design', pendingPrompt: null })!;
    expect(next.name).toBe('renamed');
    expect(next.skillId).toBe('frontend-design');
    expect(next.pendingPrompt).toBeNull();
    expect(next.updatedAt!).toBeGreaterThan(meta.createdAt);
  });

  it('ignores undefined fields and empty name', () => {
    const meta = createProject('p1-noop', null, { pendingPrompt: 'keep' });
    created.push(meta.id);
    const next = updateProject(meta.id, { name: '   ' })!;
    expect(next.name).toBe('p1-noop');
    expect(next.pendingPrompt).toBe('keep');
  });
});

describe('touchProject + list ordering', () => {
  it('touch bumps updatedAt and listProjects sorts by updatedAt desc', async () => {
    const a = createProject('p1-order-a');
    const b = createProject('p1-order-b');
    created.push(a.id, b.id);
    await new Promise((r) => setTimeout(r, 5));
    touchProject(a.id);
    const list = listProjects();
    const ia = list.findIndex((p) => p.id === a.id);
    const ib = list.findIndex((p) => p.id === b.id);
    expect(ia).toBeLessThan(ib);
  });
});

describe('validateProjectPath', () => {
  it('normalizes backslashes and collapses empty segments', () => {
    expect(validateProjectPath('a\\b\\c.txt')).toBe('a/b/c.txt');
    expect(validateProjectPath('a//b.txt')).toBe('a/b.txt');
  });

  it('rejects traversal, absolute, drive-letter and NUL paths', () => {
    expect(() => validateProjectPath('../evil.txt')).toThrow('invalid file name');
    expect(() => validateProjectPath('a/../b.txt')).toThrow('invalid file name');
    expect(() => validateProjectPath('/etc/passwd')).toThrow('invalid file name');
    expect(() => validateProjectPath('C:/windows.txt')).toThrow('invalid file name');
    expect(() => validateProjectPath('a\0b')).toThrow('invalid file name');
    expect(() => validateProjectPath('   ')).toThrow('invalid file name');
  });

  it('rejects reserved segments (.webui / .pi)', () => {
    expect(() => validateProjectPath('.webui/meta.json')).toThrow('reserved project path');
    expect(() => validateProjectPath('a/.pi/x')).toThrow('reserved project path');
  });
});

describe('decodeMultipartFilename', () => {
  it('repairs latin1-mojibake utf8 names', () => {
    const mojibake = Buffer.from('麓客+志愿者系统.zip', 'utf8').toString('latin1');
    expect(decodeMultipartFilename(mojibake)).toBe('麓客+志愿者系统.zip');
  });

  it('passes through already-unicode names and empty input', () => {
    expect(decodeMultipartFilename('麓客.zip')).toBe('麓客.zip');
    expect(decodeMultipartFilename('plain.zip')).toBe('plain.zip');
    expect(decodeMultipartFilename('')).toBe('');
  });
});

describe('createProject with reserved id', () => {
  it('uses extra.id when provided', () => {
    const meta = createProject('p2-fixed-id', null, { id: 'p2fixedid001' });
    created.push(meta.id);
    expect(meta.id).toBe('p2fixedid001');
    expect(getProject('p2fixedid001')!.name).toBe('p2-fixed-id');
  });
});

describe('listFiles dotfile alignment', () => {
  it('skips dotfiles like open-design collectFiles', () => {
    const meta = createProject('p2-dotfiles');
    created.push(meta.id);
    const root = projectDir(meta.id);
    fs.writeFileSync(path.join(root, '.thumbnail'), 'x');
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    const names = listFiles(meta.id).map((f) => f.path);
    expect(names).toContain('index.html');
    expect(names).not.toContain('.thumbnail');
  });
});
