import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSkill,
  deleteSkill,
  listSkills,
  readSkillContent,
  setSkillEnabled,
  writeSkillContent,
} from './pi-skills.js';

let piDir: string;
let projDir: string;

function writeSkill(root: string, name: string, frontmatter = `---\nname: ${name}\ndescription: 技能 ${name}\n---\n\n正文`) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), frontmatter);
}

beforeEach(() => {
  piDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skills-pi-'));
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skills-proj-'));
  process.env.PI_WEBUI_PI_DIR = piDir;
});

afterEach(() => {
  delete process.env.PI_WEBUI_PI_DIR;
  fs.rmSync(piDir, { recursive: true, force: true });
  fs.rmSync(projDir, { recursive: true, force: true });
});

describe('listSkills', () => {
  it('discovers dir skills, root md skills, and project skills', () => {
    const root = path.join(piDir, 'skills');
    writeSkill(root, 'alpha');
    fs.writeFileSync(path.join(root, 'solo.md'), '---\nname: solo\ndescription: 单文件\n---\n');
    fs.mkdirSync(path.join(root, 'nested', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'nested', 'deep', 'SKILL.md'), '---\nname: deep\ndescription: 嵌套\n---\n');
    writeSkill(path.join(projDir, '.pi', 'skills'), 'proj-skill');

    const skills = listSkills(projDir);
    const rels = skills.map((s) => `${s.scope}:${s.rel}`).sort();
    expect(rels).toEqual(['global:alpha', 'global:nested/deep', 'global:solo.md', 'project:proj-skill']);
    expect(skills.find((s) => s.rel === 'alpha')!.description).toBe('技能 alpha');
    expect(skills.every((s) => s.enabled)).toBe(true);
  });

  it('skips hidden and node_modules directories', () => {
    const root = path.join(piDir, 'skills');
    writeSkill(root, 'alpha');
    fs.mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'objects', 'SKILL.md'), '---\nname: evil\ndescription: x\n---\n');
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'SKILL.md'), '---\nname: dep\ndescription: x\n---\n');
    expect(listSkills(null).map((s) => s.rel)).toEqual(['alpha']);
  });

  it('follows symlinked skill directories (npx skills install layout)', () => {
    const real = path.join(piDir, 'real-skills');
    writeSkill(real, 'linked');
    const root = path.join(piDir, 'skills');
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(path.join(real, 'linked'), path.join(root, 'linked'));
    const skills = listSkills(null);
    expect(skills.map((s) => s.rel)).toEqual(['linked']);
    expect(skills[0].description).toBe('技能 linked');
  });

  it('reflects disabled state from settings.json patterns (both dir and SKILL.md forms)', () => {
    const root = path.join(piDir, 'skills');
    writeSkill(root, 'alpha');
    writeSkill(root, 'beta');
    fs.writeFileSync(
      path.join(piDir, 'settings.json'),
      JSON.stringify({ skills: ['-alpha/SKILL.md', '-beta'] }),
    );
    const skills = listSkills(null);
    expect(skills.find((s) => s.rel === 'alpha')!.enabled).toBe(false);
    expect(skills.find((s) => s.rel === 'beta')!.enabled).toBe(false);
  });
});

describe('setSkillEnabled', () => {
  it('writes -pattern to global settings and removes it on re-enable, preserving other entries', () => {
    writeSkill(path.join(piDir, 'skills'), 'alpha');
    fs.writeFileSync(path.join(piDir, 'settings.json'), JSON.stringify({ theme: 'dark', skills: ['~/extra'] }));
    setSkillEnabled('global', 'alpha', false, null);
    let raw = JSON.parse(fs.readFileSync(path.join(piDir, 'settings.json'), 'utf8'));
    expect(raw.skills).toEqual(['~/extra', '-alpha/SKILL.md']);
    expect(raw.theme).toBe('dark');
    setSkillEnabled('global', 'alpha', true, null);
    raw = JSON.parse(fs.readFileSync(path.join(piDir, 'settings.json'), 'utf8'));
    expect(raw.skills).toEqual(['~/extra', '+alpha/SKILL.md']);
  });

  it('writes project toggles to <project>/.pi/settings.json', () => {
    writeSkill(path.join(projDir, '.pi', 'skills'), 'p1');
    setSkillEnabled('project', 'p1', false, projDir);
    const raw = JSON.parse(fs.readFileSync(path.join(projDir, '.pi', 'settings.json'), 'utf8'));
    expect(raw.skills).toEqual(['-p1/SKILL.md']);
  });
});

describe('create / read / write / delete', () => {
  it('creates a skill with template and validates names', () => {
    const skill = createSkill('my-skill', '我的技能');
    expect(skill.rel).toBe('my-skill');
    const content = readSkillContent('global', 'my-skill', null);
    expect(content).toContain('name: my-skill');
    expect(content).toContain('description: 我的技能');
    expect(() => createSkill('Bad Name', 'x')).toThrow(/BAD_NAME/);
    expect(() => createSkill('my-skill', 'dup')).toThrow(/SKILL_EXISTS/);
  });

  it('writes content only with valid frontmatter', () => {
    createSkill('w1', 'desc');
    expect(() => writeSkillContent('global', 'w1', '没有 frontmatter', null)).toThrow(/BAD_FRONTMATTER/);
    writeSkillContent('global', 'w1', '---\nname: w1\ndescription: 新描述\n---\n\n新正文', null);
    expect(readSkillContent('global', 'w1', null)).toContain('新描述');
  });

  it('deletes skill directories and root md skills', () => {
    createSkill('gone', 'x');
    deleteSkill('global', 'gone', null);
    expect(listSkills(null)).toEqual([]);
  });

  it('rejects empty rel', () => {
    expect(() => readSkillContent('global', '', null)).toThrow(/BAD_PATH/);
  });

  it('rejects path traversal', () => {
    expect(() => readSkillContent('global', '../../../etc/passwd', null)).toThrow(/BAD_PATH/);
    expect(() => deleteSkill('global', '..', null)).toThrow(/BAD_PATH/);
    expect(() => writeSkillContent('project', '../x', '---\nname: a\ndescription: b\n---\n', projDir)).toThrow(/BAD_PATH/);
  });
});
