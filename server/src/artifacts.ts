// Artifact manifest system, ported 1:1 from open-design
// (apps/web/src/artifacts/types.ts + manifest.ts). A "normal artifact" is a
// project file (the entry) plus an optional `<entry>.artifact.json` sidecar;
// HTML files without a sidecar become legacy-inferred artifacts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { listFiles, safeResolve } from './projects.js';

export type ArtifactKind =
  | 'html'
  | 'deck'
  | 'react-component'
  | 'markdown-document'
  | 'svg'
  | 'diagram'
  | 'code-snippet'
  | 'mini-app'
  | 'design-system';

export type ArtifactRendererId =
  | 'html'
  | 'deck-html'
  | 'react-component'
  | 'markdown'
  | 'svg'
  | 'diagram'
  | 'code'
  | 'mini-app'
  | 'design-system';

export type ArtifactExportKind = 'html' | 'pdf' | 'zip' | 'pptx' | 'jsx' | 'md' | 'svg' | 'txt';

export type ArtifactStatus = 'streaming' | 'complete' | 'error';

export interface ArtifactManifest {
  version: 1;
  kind: ArtifactKind;
  title: string;
  entry: string;
  renderer: ArtifactRendererId;
  // Optional for backward compatibility with older manifests; normalized to "complete".
  status?: ArtifactStatus;
  exports: ArtifactExportKind[];
  /** Optional primary entry hint for multi-file outputs. */
  primary?: string | boolean;
  /** Reserved for future multi-file artifact packaging. */
  supportingFiles?: string[];
  createdAt?: string;
  updatedAt?: string;
  sourceSkillId?: string;
  designSystemId?: string | null;
  metadata?: Record<string, unknown>;
}

const MANIFEST_VERSION = 1;
const ALLOWED_KINDS: ReadonlySet<ArtifactKind> = new Set([
  'html',
  'deck',
  'react-component',
  'markdown-document',
  'svg',
  'diagram',
  'code-snippet',
  'mini-app',
  'design-system',
]);
const ALLOWED_RENDERERS: ReadonlySet<ArtifactRendererId> = new Set([
  'html',
  'deck-html',
  'react-component',
  'markdown',
  'svg',
  'diagram',
  'code',
  'mini-app',
  'design-system',
]);
const ALLOWED_EXPORTS: ReadonlySet<ArtifactExportKind> = new Set([
  'html',
  'pdf',
  'zip',
  'pptx',
  'jsx',
  'md',
  'svg',
  'txt',
]);
const ALLOWED_STATUS: ReadonlySet<ArtifactStatus> = new Set(['streaming', 'complete', 'error']);

function normalizeExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function inferKindFromEntry(entry: string): ArtifactKind | null {
  const ext = normalizeExt(entry);
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (ext === '.svg') return 'svg';
  if (ext === '.md') return 'markdown-document';
  if (['.jsx', '.tsx'].includes(ext)) return 'react-component';
  if (['.js', '.ts', '.json', '.css'].includes(ext)) return 'code-snippet';
  return null;
}

function exportsForKind(kind: ArtifactKind): ArtifactExportKind[] {
  if (kind === 'deck') return ['html', 'pdf', 'pptx', 'zip'];
  if (kind === 'react-component') return ['jsx', 'html', 'zip'];
  if (kind === 'markdown-document') return ['md', 'html', 'pdf', 'zip'];
  if (kind === 'svg' || kind === 'diagram') return ['svg', 'zip'];
  if (kind === 'code-snippet') return ['txt', 'zip'];
  return ['html', 'pdf', 'zip'];
}

export function artifactManifestNameFor(entry: string): string {
  return `${entry}.artifact.json`;
}

export function createHtmlArtifactManifest(input: {
  entry: string;
  title: string;
  metadata?: Record<string, unknown>;
}): ArtifactManifest {
  const now = new Date().toISOString();
  return {
    version: MANIFEST_VERSION,
    kind: 'html',
    title: input.title,
    entry: input.entry,
    renderer: 'html',
    status: 'complete',
    exports: ['html', 'pdf', 'zip'],
    primary: true,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
}

export function serializeArtifactManifest(manifest: ArtifactManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function parseArtifactManifest(raw: string): ArtifactManifest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ArtifactManifest>;
    if (parsed?.version !== MANIFEST_VERSION) return null;
    if (typeof parsed.entry !== 'string' || !parsed.entry) return null;
    if (typeof parsed.title !== 'string' || !parsed.title) return null;
    if (!Array.isArray(parsed.exports)) return null;
    if (typeof parsed.kind !== 'string' || typeof parsed.renderer !== 'string') {
      return null;
    }
    if (!ALLOWED_KINDS.has(parsed.kind as ArtifactKind)) return null;
    if (!ALLOWED_RENDERERS.has(parsed.renderer as ArtifactRendererId)) return null;
    if (parsed.status !== undefined && !ALLOWED_STATUS.has(parsed.status as ArtifactStatus)) {
      return null;
    }
    if (parsed.exports.length === 0) return null;
    if (parsed.exports.some((value) => !ALLOWED_EXPORTS.has(value as ArtifactExportKind))) return null;
    return {
      version: MANIFEST_VERSION,
      kind: parsed.kind as ArtifactKind,
      title: parsed.title,
      entry: parsed.entry,
      renderer: parsed.renderer as ArtifactRendererId,
      status: ALLOWED_STATUS.has(parsed.status as ArtifactStatus)
        ? (parsed.status as ArtifactStatus)
        : 'complete',
      exports: parsed.exports as ArtifactExportKind[],
      primary:
        parsed.primary === true || typeof parsed.primary === 'string'
          ? parsed.primary
          : undefined,
      supportingFiles: Array.isArray(parsed.supportingFiles)
        ? parsed.supportingFiles.filter((x): x is string => typeof x === 'string')
        : undefined,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      sourceSkillId: typeof parsed.sourceSkillId === 'string' ? parsed.sourceSkillId : undefined,
      designSystemId:
        typeof parsed.designSystemId === 'string' || parsed.designSystemId === null
          ? parsed.designSystemId
          : undefined,
      metadata:
        parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata)
          ? parsed.metadata
          : undefined,
    };
  } catch {
    return null;
  }
}

export function inferLegacyManifest(input: {
  entry: string;
  title?: string;
  metadata?: Record<string, unknown>;
}): ArtifactManifest | null {
  const kind = inferKindFromEntry(input.entry);
  if (!kind) return null;
  const lowerEntry = input.entry.toLowerCase();
  const isDeck =
    kind === 'html' &&
    (lowerEntry.includes('deck') || lowerEntry.includes('slides') || lowerEntry.includes('pitch'));
  const renderer: ArtifactRendererId =
    isDeck
      ? 'deck-html'
      : kind === 'html'
        ? 'html'
        : kind === 'markdown-document'
          ? 'markdown'
          : kind === 'react-component'
            ? 'react-component'
            : kind === 'code-snippet'
              ? 'code'
              : kind === 'deck'
                ? 'deck-html'
                : kind;
  const resolvedKind = isDeck ? 'deck' : kind;
  return {
    version: MANIFEST_VERSION,
    kind: resolvedKind,
    title: input.title || input.entry,
    entry: input.entry,
    renderer,
    status: 'complete',
    exports: exportsForKind(resolvedKind),
    primary: resolvedKind === 'html' || resolvedKind === 'deck' ? true : undefined,
    metadata: input.metadata,
  };
}

const MANIFEST_SUFFIX = '.artifact.json';

export interface ProjectArtifact {
  manifest: ArtifactManifest;
  /** Project-relative path of the sidecar, or null for inferred legacy artifacts. */
  manifestPath: string | null;
  legacy: boolean;
}

/**
 * Scan a project for artifacts: every valid `*.artifact.json` sidecar whose
 * entry file exists, plus a legacy-inferred manifest for each HTML file not
 * already covered by a sidecar.
 */
export async function listArtifacts(projectId: string): Promise<ProjectArtifact[]> {
  const files = listFiles(projectId);
  const paths = new Set(files.map((f) => f.path));
  const out: ProjectArtifact[] = [];
  const coveredEntries = new Set<string>();

  for (const file of files) {
    if (!file.path.endsWith(MANIFEST_SUFFIX)) continue;
    const abs = safeResolve(projectId, file.path);
    if (!abs) continue;
    let manifest: ArtifactManifest | null = null;
    try {
      manifest = parseArtifactManifest(await fs.readFile(abs, 'utf8'));
    } catch {
      manifest = null;
    }
    if (!manifest) continue;
    // The sidecar sits next to its entry; resolve the entry relative to it.
    const dir = path.posix.dirname(file.path);
    const entryRel = dir === '.' ? manifest.entry : path.posix.join(dir, manifest.entry);
    if (!paths.has(entryRel)) continue;
    coveredEntries.add(entryRel);
    out.push({ manifest: { ...manifest, entry: entryRel }, manifestPath: file.path, legacy: false });
  }

  for (const file of files) {
    if (file.path.endsWith(MANIFEST_SUFFIX)) continue;
    if (!/\.html?$/i.test(file.path)) continue;
    if (coveredEntries.has(file.path)) continue;
    const manifest = inferLegacyManifest({ entry: file.path });
    if (!manifest) continue;
    out.push({ manifest, manifestPath: null, legacy: true });
  }

  return out.sort((a, b) => a.manifest.entry.localeCompare(b.manifest.entry));
}
