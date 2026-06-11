import { describe, expect, it } from 'vitest';
import { parseCreateProjectBody } from './project-create.js';

describe('parseCreateProjectBody', () => {
  it('parses a full valid body', () => {
    const input = parseCreateProjectBody({
      name: '  My App  ',
      model: 'anthropic/claude',
      skillId: 'frontend-design',
      pendingPrompt: '  build a dashboard ',
      metadata: {
        kind: 'prototype',
        platformTargets: ['mobile-ios', 'tablet'],
        fidelity: 'wireframe',
        includeLandingPage: true,
        includeOsWidgets: true,
        nameSource: 'user',
      },
    });
    expect(input).toEqual({
      name: 'My App',
      model: 'anthropic/claude',
      skillId: 'frontend-design',
      pendingPrompt: 'build a dashboard',
      metadata: {
        kind: 'prototype',
        platformTargets: ['mobile-ios', 'tablet'],
        fidelity: 'wireframe',
        includeLandingPage: true,
        includeOsWidgets: true,
        nameSource: 'user',
      },
    });
  });

  it('falls back to defaults on missing/invalid values', () => {
    const input = parseCreateProjectBody({
      name: 42,
      metadata: {
        kind: 'deck',
        platformTargets: ['responsive', 'nonsense', 'mobile-ios', 'mobile-ios'],
        fidelity: 'ultra',
        includeLandingPage: 'yes',
        nameSource: 'agent',
      },
    });
    expect(input).toEqual({
      name: '',
      model: null,
      skillId: null,
      pendingPrompt: null,
      metadata: {
        kind: 'prototype',
        platformTargets: ['responsive', 'mobile-ios'],
        fidelity: 'high-fidelity',
        includeLandingPage: false,
        includeOsWidgets: false,
        nameSource: 'user',
      },
    });
  });

  it('defaults platformTargets to [responsive] when empty or absent', () => {
    expect(parseCreateProjectBody({}).metadata.platformTargets).toEqual(['responsive']);
    expect(
      parseCreateProjectBody({ metadata: { platformTargets: [] } }).metadata.platformTargets,
    ).toEqual(['responsive']);
  });

  it('treats empty pendingPrompt as null', () => {
    expect(parseCreateProjectBody({ pendingPrompt: '   ' }).pendingPrompt).toBeNull();
  });

  it('handles null or undefined body', () => {
    expect(parseCreateProjectBody(null).metadata.platformTargets).toEqual(['responsive']);
    expect(parseCreateProjectBody(undefined).name).toBe('');
  });

  it('handles non-object metadata', () => {
    expect(parseCreateProjectBody({ metadata: 'string' }).metadata.fidelity).toBe('high-fidelity');
    expect(parseCreateProjectBody({ metadata: [] }).metadata.platformTargets).toEqual(['responsive']);
  });
});
