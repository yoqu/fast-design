import { describe, expect, it } from 'vitest';
import { buildPath, parseRoute } from './router';

describe('parseRoute', () => {
  it('/ 默认落项目列表', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home', view: 'projects' });
  });
  it('/home 是 Home 视图', () => {
    expect(parseRoute('/home')).toEqual({ kind: 'home', view: 'home' });
  });
  it('/projects 是项目列表', () => {
    expect(parseRoute('/projects')).toEqual({ kind: 'home', view: 'projects' });
  });
  it('/projects/:id', () => {
    expect(parseRoute('/projects/abc')).toEqual({
      kind: 'project', projectId: 'abc', conversationId: null, fileName: null,
    });
  });
  it('/projects/:id/conversations/:cid', () => {
    expect(parseRoute('/projects/abc/conversations/c1')).toEqual({
      kind: 'project', projectId: 'abc', conversationId: 'c1', fileName: null,
    });
  });
  it('会话+文件深链,文件路径可含子目录', () => {
    expect(parseRoute('/projects/abc/conversations/c1/files/sub/page%20a.html')).toEqual({
      kind: 'project', projectId: 'abc', conversationId: 'c1', fileName: 'sub/page a.html',
    });
  });
  it('无会话的文件深链', () => {
    expect(parseRoute('/projects/abc/files/index.html')).toEqual({
      kind: 'project', projectId: 'abc', conversationId: null, fileName: 'index.html',
    });
  });
  it('未知路径回落项目列表', () => {
    expect(parseRoute('/whatever/x')).toEqual({ kind: 'home', view: 'projects' });
  });
});

describe('buildPath', () => {
  it('home 视图', () => {
    expect(buildPath({ kind: 'home', view: 'home' })).toBe('/home');
    expect(buildPath({ kind: 'home', view: 'projects' })).toBe('/projects');
  });
  it('project 各形态与 parseRoute 互逆', () => {
    const routes = [
      { kind: 'project', projectId: 'abc', conversationId: null, fileName: null },
      { kind: 'project', projectId: 'abc', conversationId: 'c1', fileName: null },
      { kind: 'project', projectId: 'abc', conversationId: 'c1', fileName: 'sub/page a.html' },
      { kind: 'project', projectId: 'abc', conversationId: null, fileName: 'index.html' },
    ] as const;
    for (const r of routes) expect(parseRoute(buildPath(r))).toEqual(r);
  });
});
