import fs from 'node:fs';
import path from 'node:path';
import { piAgentDir, readJsonConfig } from './pi-config.js';
import { readWebuiSettings, writeWebuiSettings } from './webui-settings.js';

export type SkillScope = 'global' | 'project' | 'bundled';

export type SkillInfo = {
  name: string;
  description: string;
  /** 相对 skills 根目录：目录技能为目录相对路径，根级 .md 技能为文件名。 */
  rel: string;
  scope: SkillScope;
  enabled: boolean;
};

function globalSkillsRoot(): string {
  return path.join(piAgentDir(), 'skills');
}

function projectSkillsRoot(projectDir: string): string {
  return path.join(projectDir, '.pi', 'skills');
}

/** 仓库内置设计 skill 根目录；与 projects.ts 的 DATA_ROOT 同源解析，测试经 PI_WEBUI_SKILLS_DIR 覆盖。 */
function bundledSkillsRoot(): string {
  return process.env.PI_WEBUI_SKILLS_DIR
    ? path.resolve(process.env.PI_WEBUI_SKILLS_DIR)
    : path.resolve(import.meta.dirname, '../../skills');
}

function skillsRoot(scope: SkillScope, projectDir: string | null): string {
  if (scope === 'global') return globalSkillsRoot();
  if (scope === 'bundled') return bundledSkillsRoot();
  if (!projectDir) throw new Error('BAD_PATH: project scope 需要 projectDir');
  return projectSkillsRoot(projectDir);
}

/** rel → 技能内容文件绝对路径（含越界校验）。根级 .md 技能 rel 以 .md 结尾。 */
function resolveSkillFile(scope: SkillScope, rel: string, projectDir: string | null): string {
  if (!rel) throw new Error('BAD_PATH: empty rel');
  const root = skillsRoot(scope, projectDir);
  const target = rel.endsWith('.md') ? rel : path.join(rel, 'SKILL.md');
  const abs = path.resolve(root, target);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`BAD_PATH: ${rel}`);
  if (abs === root) throw new Error(`BAD_PATH: ${rel}`);
  return abs;
}

/** 与 pi config TUI 一致的开关 pattern：SKILL.md 相对 skills 根目录的路径。 */
function togglePattern(rel: string): string {
  return rel.endsWith('.md') ? rel : `${rel}/SKILL.md`;
}

// ---- frontmatter ----

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export function parseFrontmatter(content: string): { name: string | null; description: string | null } {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return { name: null, description: null };
  const get = (key: string): string | null => {
    const line = match[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    if (!line) return null;
    return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') || null;
  };
  return { name: get('name'), description: get('description') };
}

// ---- 扫描 ----

/** Dirent 类型判定，符号链接按其目标解析（pi 加载技能时同样跟随符号链接）。 */
function direntKind(parent: string, d: fs.Dirent): 'dir' | 'file' | null {
  if (d.isDirectory()) return 'dir';
  if (d.isFile()) return 'file';
  if (d.isSymbolicLink()) {
    try {
      const st = fs.statSync(path.join(parent, d.name));
      if (st.isDirectory()) return 'dir';
      if (st.isFile()) return 'file';
    } catch {
      // 悬空链接：忽略
    }
  }
  return null;
}

function disabledPatterns(scope: SkillScope, projectDir: string | null): Set<string> {
  // 内置 skill 的开关存 webui-settings（不写 pi settings.json），存的是 rel（目录名）。
  if (scope === 'bundled') {
    const raw = readWebuiSettings().bundledSkillsDisabled;
    return new Set(Array.isArray(raw) ? raw : []);
  }
  const file =
    scope === 'global'
      ? path.join(piAgentDir(), 'settings.json')
      : path.join(projectDir ?? '', '.pi', 'settings.json');
  const raw = readJsonConfig<Record<string, unknown>>(file, {});
  const entries = Array.isArray(raw.skills) ? (raw.skills as string[]) : [];
  const out = new Set<string>();
  for (const e of entries) {
    if (typeof e === 'string' && e.startsWith('-')) out.add(e.slice(1));
  }
  return out;
}

function isDisabled(rel: string, disabled: Set<string>): boolean {
  // pi 对 SKILL.md 的 exact-pattern 同时匹配文件路径与父目录路径。
  if (rel.endsWith('.md') && !rel.endsWith('/SKILL.md') && rel !== 'SKILL.md') return disabled.has(rel);
  return disabled.has(togglePattern(rel)) || disabled.has(rel);
}

function scanRoot(root: string, scope: SkillScope, disabled: Set<string>): SkillInfo[] {
  const out: SkillInfo[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  const pushSkill = (rel: string, contentFile: string) => {
    let content = '';
    try {
      content = fs.readFileSync(contentFile, 'utf8');
    } catch {
      return;
    }
    const fm = parseFrontmatter(content);
    const fallback = rel.endsWith('.md') ? path.basename(rel, '.md') : path.basename(rel);
    out.push({
      name: fm.name ?? fallback,
      description: fm.description ?? '',
      rel,
      scope,
      enabled: !isDisabled(rel, disabled),
    });
  };
  const walk = (dir: string) => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const skillMd = dirents.find((d) => direntKind(dir, d) === 'file' && d.name === 'SKILL.md');
    if (skillMd) {
      pushSkill(path.relative(root, dir).split(path.sep).join('/'), path.join(dir, 'SKILL.md'));
      return; // 技能目录不再向下递归
    }
    for (const d of dirents) {
      if (direntKind(dir, d) === 'dir' && !d.name.startsWith('.') && d.name !== 'node_modules') walk(path.join(dir, d.name));
    }
  };
  for (const entry of entries) {
    if (direntKind(root, entry) === 'file' && entry.name.endsWith('.md')) pushSkill(entry.name, path.join(root, entry.name));
    else if (direntKind(root, entry) === 'dir' && !entry.name.startsWith('.') && entry.name !== 'node_modules') walk(path.join(root, entry.name));
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function listSkills(projectDir: string | null): SkillInfo[] {
  // 排序：内置设计 skill 置顶，其次全局，最后项目级。
  const out = scanRoot(bundledSkillsRoot(), 'bundled', disabledPatterns('bundled', null));
  out.push(...scanRoot(globalSkillsRoot(), 'global', disabledPatterns('global', null)));
  if (projectDir) {
    out.push(...scanRoot(projectSkillsRoot(projectDir), 'project', disabledPatterns('project', projectDir)));
  }
  return out;
}

/**
 * 启用中的「内置 + 项目」skill 的绝对目录路径，供 pi `--skill` 注入。
 * 全局 scope 不在此列——spawn 用 `--no-skills` 关掉全局自动发现，只显式加载这些设计 skill。
 */
export function enabledSkillPaths(projectDir: string | null): string[] {
  return listSkills(projectDir)
    .filter((s) => s.enabled && (s.scope === 'bundled' || s.scope === 'project'))
    .map((s) => {
      const root = s.scope === 'bundled' ? bundledSkillsRoot() : projectSkillsRoot(projectDir!);
      return path.join(root, s.rel);
    });
}

// ---- 启用/禁用 ----

export function setSkillEnabled(scope: SkillScope, rel: string, enabled: boolean, projectDir: string | null): void {
  resolveSkillFile(scope, rel, projectDir); // 路径校验
  // 内置 skill 的开关写 webui-settings 的 bundledSkillsDisabled（存被禁用的 rel）。
  if (scope === 'bundled') {
    const current = readWebuiSettings().bundledSkillsDisabled ?? [];
    const set = new Set(current);
    if (enabled) set.delete(rel);
    else set.add(rel);
    writeWebuiSettings({ bundledSkillsDisabled: [...set] });
    return;
  }
  const file =
    scope === 'global'
      ? path.join(piAgentDir(), 'settings.json')
      : path.join(projectDir!, '.pi', 'settings.json');
  const raw = readJsonConfig<Record<string, unknown>>(file, {});
  const pattern = togglePattern(rel);
  const current = Array.isArray(raw.skills) ? (raw.skills as string[]) : [];
  // 与 pi config TUI 一致：清掉该资源的既有 ± 条目，再追加新状态。
  const updated = current.filter((p) => {
    const stripped = p.startsWith('!') || p.startsWith('+') || p.startsWith('-') ? p.slice(1) : p;
    return stripped !== pattern && stripped !== rel;
  });
  updated.push(enabled ? `+${pattern}` : `-${pattern}`);
  raw.skills = updated;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
}

// ---- CRUD ----

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function createSkill(name: string, description: string): SkillInfo {
  if (!SKILL_NAME_RE.test(name)) throw new Error(`BAD_NAME: ${name}（仅小写字母/数字/连字符）`);
  // 落到内置设计 skill 库：新建即在 UI 可见且会经 --skill 注入 agent（全局目录已对用户隐藏）。
  const dir = path.join(bundledSkillsRoot(), name);
  if (fs.existsSync(dir)) throw new Error(`SKILL_EXISTS: ${name}`);
  fs.mkdirSync(dir, { recursive: true });
  // 描述压成单行，防止换行注入破坏 frontmatter 结构。
  const desc = (description.trim() || name).replace(/\s*\r?\n\s*/g, ' ');
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n在这里编写技能说明。\n`,
  );
  return { name, description: desc, rel: name, scope: 'bundled', enabled: true };
}

export function readSkillContent(scope: SkillScope, rel: string, projectDir: string | null): string {
  return fs.readFileSync(resolveSkillFile(scope, rel, projectDir), 'utf8');
}

export function writeSkillContent(scope: SkillScope, rel: string, content: string, projectDir: string | null): void {
  const file = resolveSkillFile(scope, rel, projectDir);
  const fm = parseFrontmatter(content);
  if (!fm.name || !fm.description) {
    throw new Error('BAD_FRONTMATTER: SKILL.md 必须以 frontmatter 开头且包含 name 与 description');
  }
  fs.writeFileSync(file, content);
}

export function deleteSkill(scope: SkillScope, rel: string, projectDir: string | null): void {
  const file = resolveSkillFile(scope, rel, projectDir);
  if (rel.endsWith('.md')) fs.rmSync(file, { force: true });
  else fs.rmSync(path.dirname(file), { recursive: true, force: true });
}
