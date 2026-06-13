import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSkill,
  deleteSkill,
  enabledSkillPaths,
  listSkills,
  readSkillContent,
  resolveSkills,
  sanitizeSkillRefs,
  setSkillEnabled,
  skillReferenceDirective,
  writeSkillContent,
} from './pi-skills.js';

let piDir: string;
let projDir: string;
let bundledDir: string;
let dataDir: string;

function writeSkill(root: string, name: string, frontmatter = `---\nname: ${name}\ndescription: 技能 ${name}\n---\n\n正文`) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), frontmatter);
}

beforeEach(() => {
  piDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skills-pi-'));
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skills-proj-'));
  // 内置 skill 根 / data 根隔离到空临时目录，避免泄漏仓库真实 skills/ 与 webui-settings。
  bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skills-bundled-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skills-data-'));
  process.env.PI_WEBUI_PI_DIR = piDir;
  process.env.PI_WEBUI_SKILLS_DIR = bundledDir;
  process.env.PI_WEBUI_DATA = dataDir;
});

afterEach(() => {
  delete process.env.PI_WEBUI_PI_DIR;
  delete process.env.PI_WEBUI_SKILLS_DIR;
  delete process.env.PI_WEBUI_DATA;
  fs.rmSync(piDir, { recursive: true, force: true });
  fs.rmSync(projDir, { recursive: true, force: true });
  fs.rmSync(bundledDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
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

describe('bundled (内置设计 skill)', () => {
  it('lists bundled skills first, then global, then project', () => {
    writeSkill(bundledDir, 'frontend-design');
    writeSkill(path.join(piDir, 'skills'), 'g1');
    writeSkill(path.join(projDir, '.pi', 'skills'), 'p1');
    const skills = listSkills(projDir);
    expect(skills.map((s) => `${s.scope}:${s.rel}`)).toEqual([
      'bundled:frontend-design',
      'global:g1',
      'project:p1',
    ]);
    expect(skills.every((s) => s.enabled)).toBe(true);
  });

  it('toggle writes bundledSkillsDisabled to webui-settings, not pi settings.json', () => {
    writeSkill(bundledDir, 'taste-skill');
    setSkillEnabled('bundled', 'taste-skill', false, null);
    const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'webui-settings.json'), 'utf8'));
    expect(settings.bundledSkillsDisabled).toEqual(['taste-skill']);
    expect(fs.existsSync(path.join(piDir, 'settings.json'))).toBe(false);
    expect(listSkills(null).find((s) => s.rel === 'taste-skill')!.enabled).toBe(false);
    setSkillEnabled('bundled', 'taste-skill', true, null);
    expect(listSkills(null).find((s) => s.rel === 'taste-skill')!.enabled).toBe(true);
  });

  it('rejects path traversal on bundled', () => {
    expect(() => readSkillContent('bundled', '../../../etc/passwd', null)).toThrow(/BAD_PATH/);
  });

  it('react-prototype 强启用：无视禁用清单，恒 enabled 且 toggle off 为 no-op', () => {
    writeSkill(bundledDir, 'react-prototype');
    writeSkill(bundledDir, 'taste-skill');
    // 即便预先写入禁用清单，也应被强启用覆盖
    setSkillEnabled('bundled', 'react-prototype', false, null);
    expect(fs.existsSync(path.join(dataDir, 'webui-settings.json'))).toBe(false); // toggle no-op，未落盘
    const info = listSkills(null).find((s) => s.rel === 'react-prototype')!;
    expect(info.enabled).toBe(true);
    // 对比：普通 bundled skill 仍可正常关闭
    setSkillEnabled('bundled', 'taste-skill', false, null);
    expect(listSkills(null).find((s) => s.rel === 'taste-skill')!.enabled).toBe(false);
    // 注入列表必含 react-prototype，不含被关的 taste-skill
    const paths = enabledSkillPaths(null);
    expect(paths).toContain(path.join(bundledDir, 'react-prototype'));
    expect(paths).not.toContain(path.join(bundledDir, 'taste-skill'));
  });
});

describe('enabledSkillPaths', () => {
  it('returns abs paths of enabled bundled + project skills, excludes global and disabled', () => {
    writeSkill(bundledDir, 'frontend-design');
    writeSkill(bundledDir, 'gsap-core');
    writeSkill(path.join(piDir, 'skills'), 'g1'); // global 不入注入列表
    writeSkill(path.join(projDir, '.pi', 'skills'), 'p1');
    setSkillEnabled('bundled', 'gsap-core', false, null);
    const paths = enabledSkillPaths(projDir).sort();
    expect(paths).toEqual(
      [path.join(bundledDir, 'frontend-design'), path.join(projDir, '.pi', 'skills', 'p1')].sort(),
    );
  });

  it('returns empty when nothing enabled / no skills', () => {
    expect(enabledSkillPaths(null)).toEqual([]);
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
  it('creates a skill in the bundled library and validates names', () => {
    const skill = createSkill('my-skill', '我的技能');
    expect(skill.rel).toBe('my-skill');
    expect(skill.scope).toBe('bundled');
    const content = readSkillContent('bundled', 'my-skill', null);
    expect(content).toContain('name: my-skill');
    expect(content).toContain('description: 我的技能');
    expect(() => createSkill('Bad Name', 'x')).toThrow(/BAD_NAME/);
    expect(() => createSkill('my-skill', 'dup')).toThrow(/SKILL_EXISTS/);
  });

  it('writes content only with valid frontmatter', () => {
    createSkill('w1', 'desc');
    expect(() => writeSkillContent('bundled', 'w1', '没有 frontmatter', null)).toThrow(/BAD_FRONTMATTER/);
    writeSkillContent('bundled', 'w1', '---\nname: w1\ndescription: 新描述\n---\n\n新正文', null);
    expect(readSkillContent('bundled', 'w1', null)).toContain('新描述');
  });

  it('deletes skill directories and root md skills', () => {
    createSkill('gone', 'x');
    deleteSkill('bundled', 'gone', null);
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

describe('sanitizeSkillRefs', () => {
  it('保留合法 ref、按 scope+rel 去重、丢弃非法项', () => {
    const out = sanitizeSkillRefs([
      { scope: 'bundled', rel: 'a' },
      { scope: 'bundled', rel: 'a' }, // 重复
      { scope: 'project', rel: ' b ' }, // trim
      { scope: 'nope', rel: 'c' }, // 非法 scope
      { scope: 'global', rel: '' }, // 空 rel
      'garbage',
      null,
    ]);
    expect(out).toEqual([
      { scope: 'bundled', rel: 'a' },
      { scope: 'project', rel: 'b' },
    ]);
  });

  it('非数组返回空', () => {
    expect(sanitizeSkillRefs(undefined)).toEqual([]);
    expect(sanitizeSkillRefs({})).toEqual([]);
  });
});

describe('resolveSkills', () => {
  it('把 ref 解析为技能目录绝对路径并带回 name/description，缺失项跳过', () => {
    writeSkill(bundledDir, 'hero'); // name=hero, description=技能 hero
    writeSkill(path.join(projDir, '.pi', 'skills'), 'local');
    const out = resolveSkills(
      [
        { scope: 'bundled', rel: 'hero' },
        { scope: 'project', rel: 'local' },
        { scope: 'bundled', rel: 'missing' },
      ],
      projDir,
    );
    expect(out).toEqual([
      { path: path.join(bundledDir, 'hero'), name: 'hero', description: '技能 hero' },
      { path: path.join(projDir, '.pi', 'skills', 'local'), name: 'local', description: '技能 local' },
    ]);
  });

  it('空输入返回空', () => {
    expect(resolveSkills([], projDir)).toEqual([]);
  });
});

describe('skillReferenceDirective', () => {
  it('拼接成引导指令', () => {
    const text = skillReferenceDirective([{ name: 'hero', description: '英雄区' }]);
    expect(text).toContain('hero');
    expect(text).toContain('英雄区');
  });
  it('空列表返回空串', () => {
    expect(skillReferenceDirective([])).toBe('');
  });
});
