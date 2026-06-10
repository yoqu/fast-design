// Project file CRUD with artifact-sidecar coupling, mirroring open-design's
// project file routes: deleting or renaming an artifact entry file keeps its
// `<entry>.artifact.json` sidecar consistent.
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeResolve } from './projects.js';
import { artifactManifestNameFor, parseArtifactManifest, serializeArtifactManifest } from './artifacts.js';

function resolveOrThrow(id: string, rel: string): string {
  const abs = safeResolve(id, rel);
  if (!abs) throw new Error(`BAD_PATH: ${rel}`);
  return abs;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

export async function readProjectFile(id: string, rel: string): Promise<Buffer> {
  return fs.readFile(resolveOrThrow(id, rel));
}

export async function writeProjectFile(
  id: string,
  rel: string,
  data: Buffer,
  opts: { overwrite: boolean },
): Promise<void> {
  const abs = resolveOrThrow(id, rel);
  if (!opts.overwrite && (await exists(abs))) throw new Error(`FILE_EXISTS: ${rel}`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

export async function deleteProjectFile(id: string, rel: string): Promise<void> {
  await fs.rm(resolveOrThrow(id, rel));
  const sidecar = safeResolve(id, artifactManifestNameFor(rel));
  if (sidecar && (await exists(sidecar))) await fs.rm(sidecar);
}

export async function renameProjectFile(id: string, from: string, to: string): Promise<void> {
  const fromAbs = resolveOrThrow(id, from);
  const toAbs = resolveOrThrow(id, to);
  if (await exists(toAbs)) throw new Error(`FILE_EXISTS: ${to}`);
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);

  const fromSidecar = resolveOrThrow(id, artifactManifestNameFor(from));
  if (!(await exists(fromSidecar))) return;
  const toSidecar = resolveOrThrow(id, artifactManifestNameFor(to));
  const manifest = parseArtifactManifest(await fs.readFile(fromSidecar, 'utf8'));
  if (manifest) {
    // The sidecar lives next to its entry, so the stored entry is the bare
    // filename relative to the sidecar's directory.
    manifest.entry = path.posix.basename(to);
    manifest.updatedAt = new Date().toISOString();
    await fs.writeFile(toSidecar, serializeArtifactManifest(manifest));
    await fs.rm(fromSidecar);
  } else {
    await fs.rename(fromSidecar, toSidecar);
  }
}

export { artifactManifestNameFor };
