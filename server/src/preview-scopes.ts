// Ephemeral preview scope tokens, mirroring open-design's projectPreviewScopes:
// the preview iframe never gets a raw file route; it gets a minted scope that
// only validates for its own project. Tokens live in process memory — a server
// restart invalidates them, which is fine because the client re-requests
// /preview-url on every viewer mount.
import { randomBytes } from 'node:crypto';

const scopes = new Map<string, string[]>(); // projectId -> tokens, newest last
const MAX_PER_PROJECT = 32;

export const previewScopeRe = /^[a-z0-9]{24,64}$/;

export function mintPreviewScope(projectId: string): string {
  const token = randomBytes(16).toString('hex');
  const list = scopes.get(projectId) ?? [];
  list.push(token);
  if (list.length > MAX_PER_PROJECT) list.splice(0, list.length - MAX_PER_PROJECT);
  scopes.set(projectId, list);
  return token;
}

export function validatePreviewScope(projectId: string, scope: string): boolean {
  return (scopes.get(projectId) ?? []).includes(scope);
}
