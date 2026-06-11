// Artifact manifest types, mirroring server/src/artifacts.ts (which is itself
// a 1:1 port of open-design's apps/web/src/artifacts/types.ts).
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
  status?: ArtifactStatus;
  exports: ArtifactExportKind[];
  primary?: string | boolean;
  supportingFiles?: string[];
  createdAt?: string;
  updatedAt?: string;
  sourceSkillId?: string;
  designSystemId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProjectArtifact {
  manifest: ArtifactManifest;
  manifestPath: string | null;
  legacy: boolean;
}

export interface PreviewUrlResponse {
  url: string;
  file: string;
  iframeSandbox: string;
  opaqueOrigin: boolean;
}
