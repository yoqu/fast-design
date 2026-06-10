import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createProject, deleteProject, projectDir } from './projects.js';
import {
  artifactManifestNameFor,
  createHtmlArtifactManifest,
  inferLegacyManifest,
  listArtifacts,
  parseArtifactManifest,
  serializeArtifactManifest,
} from './artifacts.js';

const created: string[] = [];

afterAll(() => {
  for (const id of created) deleteProject(id);
});

describe('manifest parsing', () => {
  it('round-trips a created html manifest', () => {
    const manifest = createHtmlArtifactManifest({ entry: 'index.html', title: '首页原型' });
    const parsed = parseArtifactManifest(serializeArtifactManifest(manifest));
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('html');
    expect(parsed!.renderer).toBe('html');
    expect(parsed!.entry).toBe('index.html');
    expect(parsed!.exports).toEqual(['html', 'pdf', 'zip']);
    expect(parsed!.primary).toBe(true);
    expect(parsed!.status).toBe('complete');
  });

  it('rejects invalid manifests', () => {
    expect(parseArtifactManifest('not json')).toBeNull();
    expect(parseArtifactManifest('{}')).toBeNull();
    expect(parseArtifactManifest(JSON.stringify({ version: 2, entry: 'a', title: 'b' }))).toBeNull();
    expect(
      parseArtifactManifest(
        JSON.stringify({ version: 1, kind: 'html', renderer: 'html', entry: 'a.html', title: 't', exports: [] }),
      ),
    ).toBeNull();
    expect(
      parseArtifactManifest(
        JSON.stringify({ version: 1, kind: 'nope', renderer: 'html', entry: 'a.html', title: 't', exports: ['html'] }),
      ),
    ).toBeNull();
  });

  it('normalizes missing status to complete', () => {
    const parsed = parseArtifactManifest(
      JSON.stringify({ version: 1, kind: 'html', renderer: 'html', entry: 'a.html', title: 't', exports: ['html'] }),
    );
    expect(parsed!.status).toBe('complete');
  });
});

describe('inferLegacyManifest', () => {
  it('infers html artifacts', () => {
    const m = inferLegacyManifest({ entry: 'app.html' });
    expect(m).not.toBeNull();
    expect(m!.kind).toBe('html');
    expect(m!.renderer).toBe('html');
    expect(m!.exports).toEqual(['html', 'pdf', 'zip']);
    expect(m!.primary).toBe(true);
    expect(m!.title).toBe('app.html');
  });

  it('detects decks from filename heuristics', () => {
    const m = inferLegacyManifest({ entry: 'pitch-deck.html' });
    expect(m!.kind).toBe('deck');
    expect(m!.renderer).toBe('deck-html');
    expect(m!.exports).toEqual(['html', 'pdf', 'pptx', 'zip']);
  });

  it('infers svg, markdown, react and code kinds', () => {
    expect(inferLegacyManifest({ entry: 'logo.svg' })!.kind).toBe('svg');
    expect(inferLegacyManifest({ entry: 'README.md' })!.kind).toBe('markdown-document');
    expect(inferLegacyManifest({ entry: 'Widget.tsx' })!.kind).toBe('react-component');
    expect(inferLegacyManifest({ entry: 'app.css' })!.kind).toBe('code-snippet');
    expect(inferLegacyManifest({ entry: 'photo.png' })).toBeNull();
  });
});

describe('listArtifacts', () => {
  it('lists sidecar manifests and infers legacy html, deduplicating entries', async () => {
    const meta = createProject('artifacts');
    created.push(meta.id);
    const root = projectDir(meta.id);
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>a</h1>');
    fs.writeFileSync(
      path.join(root, artifactManifestNameFor('index.html')),
      serializeArtifactManifest(createHtmlArtifactManifest({ entry: 'index.html', title: '首页' })),
    );
    fs.writeFileSync(path.join(root, 'about.html'), '<h1>b</h1>');
    fs.writeFileSync(path.join(root, 'app.css'), 'body{}');

    const artifacts = await listArtifacts(meta.id);
    const entries = artifacts.map((a) => a.manifest.entry).sort();
    expect(entries).toEqual(['about.html', 'index.html']);
    const index = artifacts.find((a) => a.manifest.entry === 'index.html')!;
    expect(index.legacy).toBe(false);
    expect(index.manifest.title).toBe('首页');
    expect(index.manifestPath).toBe(artifactManifestNameFor('index.html'));
    const about = artifacts.find((a) => a.manifest.entry === 'about.html')!;
    expect(about.legacy).toBe(true);
    expect(about.manifestPath).toBeNull();
  });

  it('skips manifests whose entry file is missing', async () => {
    const meta = createProject('artifacts-missing');
    created.push(meta.id);
    const root = projectDir(meta.id);
    fs.writeFileSync(
      path.join(root, artifactManifestNameFor('ghost.html')),
      serializeArtifactManifest(createHtmlArtifactManifest({ entry: 'ghost.html', title: 'ghost' })),
    );
    expect(await listArtifacts(meta.id)).toEqual([]);
  });
});
