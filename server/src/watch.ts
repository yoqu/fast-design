import fs from 'node:fs';
import { HIDDEN_DIRS, projectDir } from './projects.js';

type Listener = () => void;

type Watcher = {
  fsWatcher: fs.FSWatcher;
  listeners: Set<Listener>;
  debounce: NodeJS.Timeout | null;
};

const watchers = new Map<string, Watcher>();

/**
 * Subscribe to file changes in a project directory (debounced 300ms).
 * Changes under hidden dirs (.webui, .pi, node_modules, .git) are ignored.
 * Returns an unsubscribe function; the underlying fs.watch is closed when
 * the last listener leaves.
 */
export function watchProject(id: string, listener: Listener): () => void {
  let watcher = watchers.get(id);
  if (!watcher) {
    const fsWatcher = fs.watch(projectDir(id), { recursive: true }, (_event, filename) => {
      if (filename) {
        const segments = String(filename).split(/[\\/]/);
        if (segments.some((seg) => HIDDEN_DIRS.has(seg))) return;
      }
      const w = watchers.get(id);
      if (!w) return;
      if (w.debounce) clearTimeout(w.debounce);
      w.debounce = setTimeout(() => {
        w.debounce = null;
        for (const fn of w.listeners) fn();
      }, 300);
    });
    watcher = { fsWatcher, listeners: new Set(), debounce: null };
    watchers.set(id, watcher);
  }
  watcher.listeners.add(listener);
  return () => {
    const w = watchers.get(id);
    if (!w) return;
    w.listeners.delete(listener);
    if (w.listeners.size === 0) {
      if (w.debounce) clearTimeout(w.debounce);
      w.fsWatcher.close();
      watchers.delete(id);
    }
  };
}

export function closeProjectWatcher(id: string): void {
  const w = watchers.get(id);
  if (!w) return;
  if (w.debounce) clearTimeout(w.debounce);
  w.fsWatcher.close();
  watchers.delete(id);
}
