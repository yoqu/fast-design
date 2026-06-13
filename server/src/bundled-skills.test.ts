import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILLS_ROOT = path.resolve(import.meta.dirname, '../../skills');

describe('bundled react-prototype skill', () => {
  const root = path.join(SKILLS_ROOT, 'react-prototype');
  it.each([
    'SKILL.md',
    'assets/template.html',
    'assets/tokens.css',
    'assets/animations.jsx',
    'assets/frames/ios-frame.jsx',
    'assets/frames/android-frame.jsx',
    'assets/frames/browser-window.jsx',
    'references/layouts.md',
    'references/checklist.md',
  ])('携带 %s', (rel) => {
    expect(fs.existsSync(path.join(root, rel))).toBe(true);
  });

  it('seed 模板用国内镜像固定版本 CDN 且组件经 window 暴露', () => {
    const html = fs.readFileSync(path.join(root, 'assets/template.html'), 'utf8');
    expect(html).toContain('registry.npmmirror.com/react/18.3.1/files/umd/react.development.js');
    expect(html).toContain('registry.npmmirror.com/@babel/standalone/7.29.0/files/babel.min.js');
    expect(html).toContain('cdn.tailwindcss.com/3.4.16');
    expect(html).not.toContain('unpkg.com');
    expect(html).not.toContain('type="module"');
    const anims = fs.readFileSync(path.join(root, 'assets/animations.jsx'), 'utf8');
    expect(anims).toContain('Object.assign(window,');
  });

  it('SKILL.md 承接完整作者契约（运行时/网络/token + 组件/动效/设备框架）', () => {
    const md = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
    // 从瘦身的 TECH_STACK_PROMPT 迁入的基础设施段
    expect(md).toContain('registry.npmmirror.com');
    expect(md).toContain('fonts.loli.net');
    expect(md).toContain('unpkg.com'); // 作为「禁引」清单点名
    expect(md).toContain('css/tokens.css');
    // 行为/手法类契约（本就在 skill 内，去重后成为唯一真相源）
    expect(md).toContain('Object.assign(window');
    expect(md).toContain('IosFrame');
    expect(md).toContain('min-h-screen');
    expect(md).toMatch(/单文件|离线/);
  });
});

describe('bundled skills 不含空壳', () => {
  it('所有 SKILL.md 均无 catalogue-entry 正文', () => {
    const dirs = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dirs) {
      const p = path.join(SKILLS_ROOT, d.name, 'SKILL.md');
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, 'utf8');
      expect(text, `${d.name} 仍是空壳目录卡片`).not.toContain('This catalogue entry advertises');
    }
  });
});
