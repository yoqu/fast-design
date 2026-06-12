import { describe, expect, it } from 'vitest';
import { autoName, buildCreateRequest, DESIGN_PLATFORMS } from './newProject';

describe('autoName', () => {
  it('formats as "Prototype · <localeDateString>"', () => {
    const now = new Date(2026, 5, 10);
    expect(autoName(now)).toBe(`Prototype · ${now.toLocaleDateString()}`);
  });
});

describe('DESIGN_PLATFORMS', () => {
  it('lists the six open-design platforms in order', () => {
    expect(DESIGN_PLATFORMS.map((p) => p.value)).toEqual([
      'responsive',
      'web-desktop',
      'mobile-ios',
      'mobile-android',
      'tablet',
      'desktop-app',
    ]);
  });
});

describe('buildCreateRequest', () => {
  it('uses trimmed user name with nameSource user', () => {
    const req = buildCreateRequest({
      name: '  我的应用 ',
      prompt: ' 做一个登录页 ',
      model: 'anthropic/claude',
      platformTargets: ['mobile-ios'],
      fidelity: 'wireframe',
      includeLandingPage: true,
      includeOsWidgets: false,
    });
    expect(req).toEqual({
      name: '我的应用',
      model: 'anthropic/claude',
      skillId: 'frontend-design',
      pendingPrompt: '做一个登录页',
      metadata: {
        kind: 'prototype',
        platformTargets: ['mobile-ios'],
        fidelity: 'wireframe',
        includeLandingPage: true,
        includeOsWidgets: false,
        nameSource: 'user',
      },
    });
  });

  it('falls back to autoName + nameSource generated, empty prompt → null', () => {
    const req = buildCreateRequest({
      name: '   ',
      prompt: '',
      model: null,
      platformTargets: ['responsive'],
      fidelity: 'high-fidelity',
      includeLandingPage: false,
      includeOsWidgets: false,
    });
    expect(req.name).toBe(autoName());
    expect(req.metadata.nameSource).toBe('generated');
    expect(req.pendingPrompt).toBeNull();
    expect(req.model).toBeNull();
  });
});
