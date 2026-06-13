import { describe, expect, it } from 'vitest';
import type { ProjectMetadata } from '../types.js';
import { DISCOVERY_AND_PHILOSOPHY } from './discovery.js';
import { DESIGN_DIRECTIONS, renderDirectionSpecBlock } from './directions.js';
import { UI_LOCALE_PROMPT, designAppendPrompts, renderMetadataBlock } from './compose.js';
import { TECH_STACK_PROMPT } from './tech-stack.js';

const META: ProjectMetadata = {
  kind: 'prototype',
  platformTargets: ['responsive'],
  fidelity: 'high-fidelity',
  includeLandingPage: false,
  includeOsWidgets: false,
  nameSource: 'user',
};

describe('discovery prompt', () => {
  it('包含三条硬规则与默认 discovery 表单', () => {
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('## RULE 1');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('## RULE 2');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('## RULE 3');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('<question-form id="discovery" title="Quick brief — 30 seconds">');
    // 品牌分支的稳定 value（参照 RULE 2 按这些值匹配，不可本地化）。
    for (const v of ['pick_direction', 'brand_spec', 'reference_match']) {
      expect(DISCOVERY_AND_PHILOSOPHY).toContain(v);
    }
  });

  it('嵌入完整方向库（5 个方向的 palette/posture）', () => {
    expect(DESIGN_DIRECTIONS).toHaveLength(5);
    const block = renderDirectionSpecBlock();
    for (const d of DESIGN_DIRECTIONS) {
      expect(block).toContain(`(id: ${d.id})`);
      expect(block).toContain(d.palette.accent);
    }
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('## Direction library');
  });

  it('范围裁剪：不引用本应用没有的 /frames/ 资产与 <artifact> 聊天协议', () => {
    expect(DISCOVERY_AND_PHILOSOPHY).not.toContain('/frames/');
    expect(DISCOVERY_AND_PHILOSOPHY).not.toContain('<artifact>');
  });
});

describe('renderMetadataBlock', () => {
  it('responsive 单目标：含响应式契约，不含跨平台规则', () => {
    const block = renderMetadataBlock(META);
    expect(block).toContain('- **kind**: prototype');
    expect(block).toContain('- **platformTargets**: responsive web');
    expect(block).toContain('responsive web contract');
    expect(block).not.toContain('cross-platform deliverable rule');
    expect(block).toContain('- **fidelity**: high-fidelity');
  });

  it('多目标触发跨平台规则；开关字段按需出现', () => {
    const block = renderMetadataBlock({
      ...META,
      platformTargets: ['mobile-ios', 'mobile-android'],
      includeLandingPage: true,
      includeOsWidgets: true,
    });
    expect(block).toContain('cross-platform deliverable rule');
    expect(block).toContain('- **platformTargets**: iOS app, Android app');
    expect(block).toContain('- **includeLandingPage**: true');
    expect(block).toContain('- **includeOsWidgets**: true');
    expect(block).not.toContain('responsive web contract');
  });

  it('缺失字段标记 (unknown — ask)，无 metadata 返回空串', () => {
    const block = renderMetadataBlock({ kind: 'prototype', nameSource: 'user' } as ProjectMetadata);
    expect(block).toContain('(unknown — ask: responsive web');
    expect(block).toContain('(unknown — ask: wireframe vs high-fidelity)');
    expect(renderMetadataBlock(undefined)).toBe('');
  });
});

describe('tech-stack prompt（瘦身版：基础设施硬约束 + skill 指针）', () => {
  it('保留固定版本运行时硬契约', () => {
    expect(TECH_STACK_PROMPT).toContain('registry.npmmirror.com/react/18.3.1/files/umd/react.development.js');
    expect(TECH_STACK_PROMPT).toContain('registry.npmmirror.com/react-dom/18.3.1/files/umd/react-dom.development.js');
    expect(TECH_STACK_PROMPT).toContain('registry.npmmirror.com/@babel/standalone/7.29.0/files/babel.min.js');
    expect(TECH_STACK_PROMPT).toContain('cdn.tailwindcss.com/3.4.16');
  });

  it('国内镜像：不引用境外中央 CDN，integrity 哈希保留', () => {
    // 不再从 unpkg 引脚定运行时（仅在「禁用清单」里点名，不作为 script src）
    expect(TECH_STACK_PROMPT).not.toContain('unpkg.com/react');
    expect(TECH_STACK_PROMPT).not.toContain('src="https://unpkg');
    // SRI 哈希在 npmmirror 上字节级一致，必须保留
    expect(TECH_STACK_PROMPT).toContain('sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L');
    expect(TECH_STACK_PROMPT).toContain('registry.npmmirror.com');
    expect(TECH_STACK_PROMPT).toContain('fonts.loli.net');
  });

  it('作者契约细节已下放，仅留 react-prototype skill 指针', () => {
    // 行为/手法类规则迁入 skill，系统提示不再重复
    expect(TECH_STACK_PROMPT).not.toContain('Object.assign(window, {');
    expect(TECH_STACK_PROMPT).not.toContain('scrollIntoView');
    expect(TECH_STACK_PROMPT).not.toContain('IosFrame');
    expect(TECH_STACK_PROMPT).not.toContain('min-h-screen');
    // 改为指向单一真相源 skill 及其入门三件套
    expect(TECH_STACK_PROMPT).toContain('react-prototype');
    expect(TECH_STACK_PROMPT).toContain('assets/template.html');
    expect(TECH_STACK_PROMPT).toContain('references/checklist.md');
  });
});

describe('designAppendPrompts', () => {
  it('栈序：locale → discovery → tech-stack → metadata', () => {
    const parts = designAppendPrompts(META);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(UI_LOCALE_PROMPT);
    expect(parts[1]).toBe(DISCOVERY_AND_PHILOSOPHY);
    expect(parts[2]).toBe(TECH_STACK_PROMPT);
    expect(parts[3]).toContain('## Project metadata');
  });

  it('无 metadata 时省略元数据块（仍含 tech-stack）', () => {
    const parts = designAppendPrompts(undefined);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe(TECH_STACK_PROMPT);
  });
});
