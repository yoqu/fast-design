import type { ChatMessage, ConversationMeta, ConversationSummary, CustomModel, CustomProvider, ExtensionInfo, ExtensionOpResult, FileEntry, PiModel, PiSettings, PiStatus, ProjectMeta, ProvidersResponse, SkillInfo, UiEvent } from './types';
import type { PreviewUrlResponse, ProjectArtifact } from './artifacts';
import type { CreateProjectRequest } from './newProject';

function encodePath(path: string): string {
  return path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // keep statusText
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listProjects: () => fetch('/api/projects').then((r) => json<ProjectMeta[]>(r)),
  createProject: (input: CreateProjectRequest) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => json<ProjectMeta>(r)),
  updateProject: (
    id: string,
    patch: {
      name?: string;
      model?: string | null;
      thinking?: string | null;
      instructions?: string | null;
      skillId?: string | null;
      pendingPrompt?: string | null;
    },
  ) =>
    fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<ProjectMeta>(r)),
  importClaudeDesign: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return fetch('/api/import/claude-design', { method: 'POST', body: form }).then((r) =>
      json<{ project: ProjectMeta; entryFile: string; files: string[] }>(r),
    );
  },
  deleteProject: (id: string) =>
    fetch(`/api/projects/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  conversations: (id: string) =>
    fetch(`/api/projects/${id}/conversations`)
      .then((r) => json<{ conversations: ConversationSummary[] }>(r))
      .then((b) => b.conversations),
  createConversation: (id: string, title?: string | null) =>
    fetch(`/api/projects/${id}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title ?? null }),
    })
      .then((r) => json<{ conversation: ConversationMeta }>(r))
      .then((b) => b.conversation),
  deleteConversation: (id: string, cid: string) =>
    fetch(`/api/projects/${id}/conversations/${cid}`, { method: 'DELETE' }).then((r) =>
      json<{ ok: boolean }>(r),
    ),
  history: (id: string, cid: string) =>
    fetch(`/api/projects/${id}/conversations/${cid}/history`).then((r) => json<ChatMessage[]>(r)),
  files: (id: string) => fetch(`/api/projects/${id}/files`).then((r) => json<FileEntry[]>(r)),
  abort: (id: string, cid: string) =>
    fetch(`/api/projects/${id}/conversations/${cid}/abort`, { method: 'POST' }),
  exportUrl: (id: string, root?: string) =>
    `/api/projects/${id}/export${root ? `?root=${encodeURIComponent(root)}` : ''}`,
  artifacts: (id: string) =>
    fetch(`/api/projects/${id}/artifacts`).then((r) => json<{ artifacts: ProjectArtifact[] }>(r)).then((b) => b.artifacts),
  previewUrl: (id: string, file?: string) =>
    fetch(`/api/projects/${id}/preview-url${file ? `?file=${encodeURIComponent(file)}` : ''}`).then((r) =>
      json<PreviewUrlResponse>(r),
    ),
  fileUrl: (id: string, path: string) => `/api/projects/${id}/file?path=${encodeURIComponent(path)}`,
  readFile: async (id: string, path: string): Promise<string> => {
    const res = await fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`读取 ${path} 失败 (${res.status})`);
    return res.text();
  },
  putFile: (id: string, path: string, body: Blob | string, overwrite = true) =>
    fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}&overwrite=${overwrite}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteFile: async (id: string, path: string): Promise<void> => {
    const res = await fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        // keep statusText
      }
      throw new Error(detail);
    }
  },
  renameFile: (id: string, from: string, to: string) =>
    fetch(`/api/projects/${id}/file/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }).then((r) => json<{ ok: boolean }>(r)),
};

export { encodePath };

/**
 * POST a chat message and invoke onEvent for each NDJSON line of the
 * streamed response. Resolves when the stream ends.
 */
export async function streamChat(
  projectId: string,
  conversationId: string,
  message: string,
  onEvent: (ev: UiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/conversations/${conversationId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // keep statusText
    }
    throw new Error(detail || '请求失败');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as UiEvent);
      } catch {
        // skip malformed line
      }
    }
  }
}

/** Subscribe to project file-change events. Returns a cleanup function. */
export function subscribeProjectEvents(projectId: string, onFilesChanged: () => void): () => void {
  const source = new EventSource(`/api/projects/${projectId}/events`);
  source.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as { type?: string };
      if (data.type === 'files-changed') onFilesChanged();
    } catch {
      // ignore
    }
  };
  return () => source.close();
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export const piApi = {
  status: () => fetch('/api/pi/status').then((r) => json<PiStatus>(r)),
  settings: () => fetch('/api/pi/settings').then((r) => json<PiSettings>(r)),
  saveSettings: (patch: Partial<PiSettings>) =>
    fetch('/api/pi/settings', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      json<PiSettings>(r),
    ),
  providers: () => fetch('/api/pi/providers').then((r) => json<ProvidersResponse>(r)),
  setProviderKey: (id: string, key: string) =>
    fetch(`/api/pi/providers/${encodeURIComponent(id)}/key`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ key }),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteProviderKey: (id: string) =>
    fetch(`/api/pi/providers/${encodeURIComponent(id)}/key`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  saveCustomProvider: (id: string, body: { baseUrl: string; api: string; apiKey?: string; models: CustomModel[] }, isNew: boolean) =>
    fetch(isNew ? '/api/pi/custom-providers' : `/api/pi/custom-providers/${encodeURIComponent(id)}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(isNew ? { id, ...body } : body),
    }).then((r) => json<CustomProvider[]>(r)),
  deleteCustomProvider: (id: string) =>
    fetch(`/api/pi/custom-providers/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => json<CustomProvider[]>(r)),
  models: () => fetch('/api/pi/models').then((r) => json<{ models: PiModel[] }>(r)).then((b) => b.models),
  skills: (projectId?: string | null) =>
    fetch(`/api/pi/skills${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`)
      .then((r) => json<{ skills: SkillInfo[] }>(r))
      .then((b) => b.skills),
  toggleSkill: (scope: string, rel: string, enabled: boolean, projectId?: string | null) =>
    fetch(`/api/pi/skills/toggles${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ scope, rel, enabled }),
    }).then((r) => json<{ ok: boolean }>(r)),
  createSkill: (name: string, description: string) =>
    fetch('/api/pi/skills', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name, description }) }).then(
      (r) => json<SkillInfo>(r),
    ),
  skillContent: (scope: string, rel: string, projectId?: string | null) =>
    fetch(
      `/api/pi/skills/content?scope=${scope}&rel=${encodeURIComponent(rel)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`,
    )
      .then((r) => json<{ content: string }>(r))
      .then((b) => b.content),
  saveSkillContent: (scope: string, rel: string, content: string, projectId?: string | null) =>
    fetch(`/api/pi/skills/content${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ scope, rel, content }),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteSkill: (scope: string, rel: string, projectId?: string | null) =>
    fetch(
      `/api/pi/skills?scope=${scope}&rel=${encodeURIComponent(rel)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`,
      { method: 'DELETE' },
    ).then((r) => json<{ ok: boolean }>(r)),
  extensions: () => fetch('/api/pi/extensions').then((r) => json<{ extensions: ExtensionInfo[] }>(r)).then((b) => b.extensions),
  installExtension: (source: string) =>
    fetch('/api/pi/extensions', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ source }) }).then((r) =>
      json<ExtensionOpResult>(r),
    ),
  removeExtension: (source: string) =>
    fetch(`/api/pi/extensions?source=${encodeURIComponent(source)}`, { method: 'DELETE' }).then((r) =>
      json<ExtensionOpResult>(r),
    ),
  instructions: () => fetch('/api/pi/instructions').then((r) => json<{ instructions: string }>(r)).then((b) => b.instructions),
  saveInstructions: (instructions: string) =>
    fetch('/api/pi/instructions', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ instructions }) }).then(
      (r) => json<{ instructions: string }>(r),
    ),
};
