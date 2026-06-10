import fs from 'node:fs';
import path from 'node:path';
import { piAgentDir, readJsonConfig } from './pi-config.js';

export type SkillScope = 'global' | 'project';

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

function skillsRoot(scope: SkillScope, projectDir: string | null): string {
  if (scope === 'global') return globalSkillsRoot();
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

function disabledPatterns(scope: SkillScope, projectDir: string | null): Set<string> {
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
    const skillMd = dirents.find((d) => d.isFile() && d.name === 'SKILL.md');
    if (skillMd) {
      pushSkill(path.relative(root, dir).split(path.sep).join('/'), path.join(dir, 'SKILL.md'));
      return; // 技能目录不再向下递归
    }
    for (const d of dirents) {
      if (d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules') walk(path.join(dir, d.name));
    }
  };
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) pushSkill(entry.name, path.join(root, entry.name));
    else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') walk(path.join(root, entry.name));
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function listSkills(projectDir: string | null): SkillInfo[] {
  const out = scanRoot(globalSkillsRoot(), 'global', disabledPatterns('global', null));
  if (projectDir) {
    out.push(...scanRoot(projectSkillsRoot(projectDir), 'project', disabledPatterns('project', projectDir)));
  }
  return out;
}

// ---- 启用/禁用 ----

export function setSkillEnabled(scope: SkillScope, rel: string, enabled: boolean, projectDir: string | null): void {
  resolveSkillFile(scope, rel, projectDir); // 路径校验
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
  const dir = path.join(globalSkillsRoot(), name);
  if (fs.existsSync(dir)) throw new Error(`SKILL_EXISTS: ${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const desc = description.trim() || name;
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n在这里编写技能说明。\n`,
  );
  return { name, description: desc, rel: name, scope: 'global', enabled: true };
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
