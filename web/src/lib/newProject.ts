import type { ProjectFidelity, ProjectMetadata, ProjectPlatform } from './types';

/** 对齐 open-design NewProjectPanel 的 6 个目标平台（顺序一致）。 */
export const DESIGN_PLATFORMS: Array<{ value: ProjectPlatform; label: string; hint: string }> = [
  { value: 'responsive', label: '响应式', hint: '自适应桌面与移动端' },
  { value: 'web-desktop', label: '桌面 Web', hint: '面向宽屏浏览器' },
  { value: 'mobile-ios', label: 'iOS', hint: 'iPhone 移动端界面' },
  { value: 'mobile-android', label: 'Android', hint: 'Android 移动端界面' },
  { value: 'tablet', label: '平板', hint: 'iPad / 平板尺寸' },
  { value: 'desktop-app', label: '桌面应用', hint: '桌面客户端窗口' },
];

/** 对齐参照 autoName：`Prototype · {toLocaleDateString()}`。 */
export function autoName(now: Date = new Date()): string {
  return `Prototype · ${now.toLocaleDateString()}`;
}

export type NewProjectForm = {
  name: string;
  prompt: string;
  model: string | null;
  platformTargets: ProjectPlatform[];
  fidelity: ProjectFidelity;
  includeLandingPage: boolean;
  includeOsWidgets: boolean;
};

export type CreateProjectRequest = {
  name: string;
  model: string | null;
  skillId: string | null;
  pendingPrompt: string | null;
  metadata: ProjectMetadata;
};

/** 表单 → POST /api/projects 请求体。空名回落 autoName 并标记 nameSource:'generated'。 */
export function buildCreateRequest(form: NewProjectForm): CreateProjectRequest {
  const trimmedName = form.name.trim();
  const trimmedPrompt = form.prompt.trim();
  return {
    name: trimmedName || autoName(),
    model: form.model,
    skillId: null,
    pendingPrompt: trimmedPrompt || null,
    metadata: {
      kind: 'prototype',
      platformTargets: form.platformTargets,
      fidelity: form.fidelity,
      includeLandingPage: form.includeLandingPage,
      includeOsWidgets: form.includeOsWidgets,
      nameSource: trimmedName ? 'user' : 'generated',
    },
  };
}
