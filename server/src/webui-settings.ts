import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT } from './projects.js';

export type WebuiSettings = {
  instructions?: string;
  /** 被禁用的内置（bundled）设计 skill 的 rel 列表；不写全局 pi settings.json。 */
  bundledSkillsDisabled?: string[];
};

export function webuiSettingsPath(): string {
  // 调用时读 env（而非 import 期冻结的 DATA_ROOT），让测试可经 PI_WEBUI_DATA 隔离；
  // 生产环境 env 未设或与 DATA_ROOT 一致，行为不变。
  const root = process.env.PI_WEBUI_DATA ? path.resolve(process.env.PI_WEBUI_DATA) : DATA_ROOT;
  return path.join(root, 'webui-settings.json');
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
