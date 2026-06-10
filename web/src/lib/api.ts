import type { ChatMessage, FileEntry, ProjectMeta, UiEvent } from './types';

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
  createProject: (name: string) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => json<ProjectMeta>(r)),
  deleteProject: (id: string) =>
    fetch(`/api/projects/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  history: (id: string) => fetch(`/api/projects/${id}/history`).then((r) => json<ChatMessage[]>(r)),
  files: (id: string) => fetch(`/api/projects/${id}/files`).then((r) => json<FileEntry[]>(r)),
  abort: (id: string) => fetch(`/api/projects/${id}/abort`, { method: 'POST' }),
  exportUrl: (id: string) => `/api/projects/${id}/export`,
  previewUrl: (id: string, file: string) => `/preview/${id}/${file}`,
};

/**
 * POST a chat message and invoke onEvent for each NDJSON line of the
 * streamed response. Resolves when the stream ends.
 */
export async function streamChat(
  projectId: string,
  message: string,
  onEvent: (ev: UiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/chat`, {
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
