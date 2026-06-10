import { describe, expect, it } from 'vitest';
import {
  archiveFilenameFrom,
  archiveRootFromFilePath,
  buildDesignHandoffContent,
  buildDesignManifestContent,
  safeFilename,
} from './exports';

describe('safeFilename', () => {
  it('slugs unsafe characters and truncates to 60 chars', () => {
    expect(safeFilename('My Cool / Proto!', 'artifact')).toBe('My-Cool-Proto');
    expect(safeFilename('', 'artifact')).toBe('artifact');
    expect(safeFilename('a'.repeat(80), 'artifact')).toHaveLength(60);
    expect(safeFilename('---', 'artifact')).toBe('artifact');
  });
});

describe('archiveRootFromFilePath', () => {
  it('returns the top-level directory for nested paths', () => {
    expect(archiveRootFromFilePath('ui-design/index.html')).toBe('ui-design');
    expect(archiveRootFromFilePath('/ui-design/pages/a.html')).toBe('ui-design');
  });
  it('returns empty for top-level files', () => {
    expect(archiveRootFromFilePath('index.html')).toBe('');
    expect(archiveRootFromFilePath('')).toBe('');
  });
});

describe('archiveFilenameFrom', () => {
  function mockResponse(disposition: string | null): Response {
    return { headers: { get: () => disposition } } as unknown as Response;
  }
  it('prefers RFC5987 UTF-8 filename', () => {
    expect(
      archiveFilenameFrom(mockResponse(`attachment; filename*=UTF-8''%E5%8E%9F%E5%9E%8B.zip`), 't', ''),
    ).toBe('原型.zip');
  });
  it('falls back to quoted filename then local slug', () => {
    expect(archiveFilenameFrom(mockResponse('attachment; filename="proto.zip"'), 't', '')).toBe('proto.zip');
    expect(archiveFilenameFrom(mockResponse(null), 'My Title', '')).toBe('My-Title.zip');
    expect(archiveFilenameFrom(mockResponse(null), 't', 'ui-design')).toBe('ui-design.zip');
  });
});

describe('buildDesignManifestContent', () => {
  it('matches the open-design manifest schema and classifies source files', () => {
    const json = JSON.parse(
      buildDesignManifestContent({
        title: '首页原型',
        entryFile: 'index.html',
        files: ['index.html', 'landing.html', 'css/app.css', 'js/app.js', 'img/logo.png'],
      }),
    );
    expect(json.schema).toBe('open-design.design-manifest.v1');
    expect(json.kind).toBe('html');
    expect(json.entryFile).toBe('index.html');
    expect(json.sourceFiles.html).toEqual(['index.html', 'landing.html']);
    expect(json.sourceFiles.css).toEqual(['css/app.css']);
    expect(json.sourceFiles.scriptsAndComponents).toEqual(['js/app.js']);
    expect(json.sourceFiles.assets).toEqual(['img/logo.png']);
    expect(json.responsiveViewports).toHaveLength(9);
    expect(json.responsiveViewports[1]).toEqual({
      name: 'mobile-standard',
      width: 390,
      height: 844,
      category: 'mobile',
      mustAvoidHorizontalScroll: true,
    });
    expect(json.screenFilePolicy.mode).toBe('screen-file-first');
    const roles = Object.fromEntries(json.screens.map((s: { file: string; role: string }) => [s.file, s.role]));
    expect(roles['index.html']).toBe('launcher-overview');
    expect(roles['landing.html']).toBe('landing-page');
  });

  it('skips frame-wrapper html files from screens', () => {
    const json = JSON.parse(
      buildDesignManifestContent({
        title: 't',
        entryFile: 'index.html',
        files: ['index.html', 'frames/browser-chrome.html'],
      }),
    );
    expect(json.screens.map((s: { file: string }) => s.file)).toEqual(['index.html']);
  });
});

describe('buildDesignHandoffContent', () => {
  it('renders the handoff sections with source map and viewport matrix', () => {
    const md = buildDesignHandoffContent({
      title: '首页原型',
      entryFile: 'index.html',
      files: ['index.html', 'css/app.css'],
    });
    expect(md).toContain('# 首页原型 implementation handoff');
    expect(md).toContain('## Source map');
    expect(md).toContain('Primary entry: `index.html`');
    expect(md).toContain('Stylesheets detected: 1');
    expect(md).toContain('Mobile standard: 390×844');
    expect(md).toContain('Tablet portrait: 820×1180');
    expect(md).toContain('DESIGN-MANIFEST.json');
  });
});
