import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createProject, deleteProject, projectDir } from './projects.js';
import {
  artifactManifestNameFor,
  createHtmlArtifactManifest,
  parseArtifactManifest,
  serializeArtifactManifest,
} from './artifacts.js';
import {
  deleteProjectFile,
  readProjectFile,
  renameProjectFile,
  writeProjectFile,
} from './files.js';

const created: string[] = [];

afterAll(() => {
  for (const id of created) deleteProject(id);
});

function makeProject(name: string): string {
  const meta = createProject(name);
  created.push(meta.id);
  return meta.id;
}

describe('writeProjectFile', () => {
  it('creates nested files and reads them back', async () => {
    const id = makeProject('files-write');
    await writeProjectFile(id, 'css/app.css', Buffer.from('body{}'), { overwrite: true });
    expect((await readProjectFile(id, 'css/app.css')).toString()).toBe('body{}');
  });

  it('rejects overwrite=false on existing files with FILE_EXISTS', async () => {
    const id = makeProject('files-exists');
    await writeProjectFile(id, 'a.html', Buffer.from('1'), { overwrite: true });
    await expect(
      writeProjectFile(id, 'a.html', Buffer.from('2'), { overwrite: false }),
    ).rejects.toThrow('FILE_EXISTS');
  });

  it('rejects traversal paths', async () => {
    const id = makeProject('files-trav');
    await expect(
      writeProjectFile(id, '../evil.html', Buffer.from('x'), { overwrite: true }),
    ).rejects.toThrow();
  });
});

describe('deleteProjectFile', () => {
  it('deletes the file and its artifact sidecar', async () => {
    const id = makeProject('files-del');
    const root = projectDir(id);
    fs.writeFileSync(path.join(root, 'index.html'), '<h1></h1>');
    fs.writeFileSync(
      path.join(root, artifactManifestNameFor('index.html')),
      serializeArtifactManifest(createHtmlArtifactManifest({ entry: 'index.html', title: 't' })),
    );
    await deleteProjectFile(id, 'index.html');
    expect(fs.existsSync(path.join(root, 'index.html'))).toBe(false);
    expect(fs.existsSync(path.join(root, artifactManifestNameFor('index.html')))).toBe(false);
  });
});

describe('renameProjectFile', () => {
  it('renames file, migrates sidecar and rewrites manifest entry', async () => {
    const id = makeProject('files-rename');
    const root = projectDir(id);
    fs.writeFileSync(path.join(root, 'old.html'), '<h1></h1>');
    fs.writeFileSync(
      path.join(root, artifactManifestNameFor('old.html')),
      serializeArtifactManifest(createHtmlArtifactManifest({ entry: 'old.html', title: '原型' })),
    );
    await renameProjectFile(id, 'old.html', 'new.html');
    expect(fs.existsSync(path.join(root, 'new.html'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'old.html'))).toBe(false);
    expect(fs.existsSync(path.join(root, artifactManifestNameFor('old.html')))).toBe(false);
    const manifest = parseArtifactManifest(
      fs.readFileSync(path.join(root, artifactManifestNameFor('new.html')), 'utf8'),
    );
    expect(manifest!.entry).toBe('new.html');
    expect(manifest!.title).toBe('原型');
  });

  it('rejects when the target already exists', async () => {
    const id = makeProject('files-rename-clash');
    const root = projectDir(id);
    fs.writeFileSync(path.join(root, 'a.html'), 'a');
    fs.writeFileSync(path.join(root, 'b.html'), 'b');
    await expect(renameProjectFile(id, 'a.html', 'b.html')).rejects.toThrow('FILE_EXISTS');
  });

  it('rejects traversal in either side', async () => {
    const id = makeProject('files-rename-trav');
    fs.writeFileSync(path.join(projectDir(id), 'a.html'), 'a');
    await expect(renameProjectFile(id, 'a.html', '../b.html')).rejects.toThrow();
    await expect(renameProjectFile(id, '../a.html', 'b.html')).rejects.toThrow();
  });
});
