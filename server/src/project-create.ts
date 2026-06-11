import type { ProjectFidelity, ProjectMetadata, ProjectPlatform } from './types.js';

// 与 types.ts 的 ProjectPlatform union 保持同步；新增平台时两处均需更新。
export const PROJECT_PLATFORMS: ProjectPlatform[] = [
  'responsive',
  'web-desktop',
  'mobile-ios',
  'mobile-android',
  'tablet',
  'desktop-app',
];

const FIDELITIES: ProjectFidelity[] = ['wireframe', 'high-fidelity'];

export type CreateProjectInput = {
  name: string;
  model: string | null;
  skillId: string | null;
  pendingPrompt: string | null;
  metadata: ProjectMetadata;
};

function optionalTrimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 宽容净化创建请求体（对齐 open-design：客户端可信度有限，非法值回落默认而非报错）。
 * 默认值与参照 NewProjectPanel 一致：platformTargets=['responsive']、
 * fidelity='high-fidelity'、开关 false、nameSource='user'。
 */
export function parseCreateProjectBody(body: unknown): CreateProjectInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawMeta = (typeof b.metadata === 'object' && b.metadata !== null ? b.metadata : {}) as Record<string, unknown>;

  const platformTargets = Array.isArray(rawMeta.platformTargets)
    ? [...new Set(rawMeta.platformTargets.filter((p): p is ProjectPlatform => PROJECT_PLATFORMS.includes(p as ProjectPlatform)))]
    : [];

  return {
    name: typeof b.name === 'string' ? b.name.trim() : '',
    model: optionalTrimmed(b.model),
    skillId: optionalTrimmed(b.skillId),
    pendingPrompt: optionalTrimmed(b.pendingPrompt),
    metadata: {
      kind: 'prototype',
      platformTargets: platformTargets.length > 0 ? platformTargets : ['responsive'],
      fidelity: FIDELITIES.includes(rawMeta.fidelity as ProjectFidelity)
        ? (rawMeta.fidelity as ProjectFidelity)
        : 'high-fidelity',
      includeLandingPage: rawMeta.includeLandingPage === true,
      includeOsWidgets: rawMeta.includeOsWidgets === true,
      nameSource: rawMeta.nameSource === 'generated' ? 'generated' : 'user',
    },
  };
}
