import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT } from './projects.js';

export type WebuiSettings = { instructions?: string };

export function webuiSettingsPath(): string {
  return path.join(DATA_ROOT, 'webui-settings.json');
}

export function readWebuiSettings(): WebuiSettings {
  try {
    return JSON.parse(fs.readFileSync(webuiSettingsPath(), 'utf8')) as WebuiSettings;
  } catch {
    return {};
  }
}

export function writeWebuiSettings(patch: WebuiSettings): WebuiSettings {
  const next = { ...readWebuiSettings(), ...patch };
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(webuiSettingsPath(), JSON.stringify(next, null, 2));
  return next;
}
