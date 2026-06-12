/**
 * 设计链路系统提示组装 — 对齐参照 packages/contracts/src/prompts/system.ts
 * composeSystemPrompt 的栈序（裁剪到本应用范围：无插件/设计系统/媒体/deck）：
 *
 *   locale override → DISCOVERY_AND_PHILOSOPHY(含 direction 库) → … → 项目元数据块
 *
 * 本应用经 pi --append-system-prompt 注入（pi 自带基底系统提示，相当于参照的
 * BASE_SYSTEM_PROMPT 层），因此这里只产出 append 片段数组，由 launchConfigFor
 * 拼上全局/项目自定义指令。
 */
import type { ProjectMetadata } from '../types.js';
import { DISCOVERY_AND_PHILOSOPHY } from './discovery.js';
import { TECH_STACK_PROMPT } from './tech-stack.js';

/**
 * UI locale override — 参照 system.ts renderUiLocalePrompt 的 zh-CN 分支。
 * 本应用 Web UI 为简体中文,固定注入 zh-CN(参照由客户端传 locale,此为
 * 有意简化)。
 */
export const UI_LOCALE_PROMPT = [
  '# UI locale override',
  '',
  'The studio UI locale for this run is `zh-CN` (Simplified Chinese). All user-visible chat prose and generated UI controls must follow this locale, especially `<question-form>` titles, descriptions, labels, placeholders, helper text, and option labels. Keep machine-readable ids and object option `value` fields exact and unlocalized.',
  '',
  'For the default quick brief in Simplified Chinese, use copy like:',
  '- title: `快速简报 — 30 秒`',
  '- description: `开始生成前我会先确认这些信息。不适用的可以跳过，我会补上默认值。`',
  '- output label/options: `我们要做什么？` / `幻灯片 / 路演稿`, `单页网页原型 / 落地页`, `多屏应用原型`, `数据看板 / 工具界面`, `编辑式 / 营销页面`, `其他 — 我来描述`',
  '- platform label/options: `目标平台` / `响应式网页`, `桌面网页`, `iOS 应用`, `Android 应用`, `平板应用`, `桌面应用`, `固定画布 (1920×1080)`',
  '- audience label/placeholder: `目标用户` / `例如：早期投资人、开发者工具采购者、内部高管评审`',
  '- tone label/options: `视觉调性` / `编辑 / 杂志感`, `现代极简`, `活泼 / 插画感`, `科技 / 工具型`, `奢华 / 精致`, `粗野 / 实验性`, `人性化 / 亲切`',
  '- brand label/options: `品牌背景` / `帮我选一个方向`, `我有品牌规范 — 稍后分享`, `参考网站 / 截图 — 稍后附上`',
  '- scale label/placeholder: `大概需要多少内容？` / `例如：8 页幻灯片、1 个落地页 + 3 个子页面、4 个移动端界面`',
  '- constraints label/placeholder: `还有什么需要知道的吗？` / `真实文案、必须使用的字体、需要避免的内容、截止时间…`',
].join('\n');

const PLATFORM_LABELS: Record<string, string> = {
  responsive: 'responsive web',
  'web-desktop': 'desktop web',
  'mobile-ios': 'iOS app',
  'mobile-android': 'Android app',
  tablet: 'tablet app',
  'desktop-app': 'desktop app',
};

/**
 * 项目元数据块 — 参照 system.ts renderMetadataBlock 裁剪到本应用的
 * ProjectMetadata（kind=prototype 链路：platformTargets / fidelity /
 * includeLandingPage / includeOsWidgets）。措辞照参照原文。
 */
export function renderMetadataBlock(metadata: ProjectMetadata | undefined): string {
  if (!metadata) return '';
  const lines: string[] = [];
  lines.push('## Project metadata');
  lines.push(
    'These are the structured choices the user made (or skipped) when creating this project. Treat known fields as authoritative; for any field marked "(unknown — ask)" you MUST include a matching question in your turn-1 discovery form.',
  );
  lines.push('');
  lines.push(`- **kind**: ${metadata.kind}`);
  const targets = metadata.platformTargets ?? [];
  if (targets.length > 0) {
    lines.push(`- **platformTargets**: ${targets.map((t) => PLATFORM_LABELS[t] ?? t).join(', ')}`);
  } else {
    lines.push('- **platform**: (unknown — ask: responsive web, desktop web, iOS app, Android app, tablet app, or desktop app?)');
  }
  if (targets.includes('responsive')) {
    lines.push(
      '- **responsive web contract**: `responsive` means one web product experience that adapts across modern browser/device ranges, not only legacy desktop/tablet/mobile buckets. It is not an iOS app, Android app, or native tablet app target. Show responsive behavior through real product layout changes; do not render viewport labels as user-facing product content. Cover 2025–2026 breakpoints: mobile compact 360px, mobile standard 390–430px, foldable/small tablet 600–744px, tablet portrait 768–834px, tablet landscape/large tablet 1024–1180px, laptop 1280–1366px, desktop 1440–1536px, and wide 1920px. Use fluid `clamp()` scales, container queries where useful, and explicit layout changes at semantic thresholds. Verify no horizontal scroll at 360px, 390px, 430px, 768px, 820px, 1024px, 1366px, 1440px, and 1920px unless the brief explicitly asks for a pan/board canvas.',
    );
  }
  if (targets.length > 1) {
    lines.push(
      '- **cross-platform deliverable rule**: each selected target keeps the same product goal but MUST be delivered as its own product screen/file when more than one concrete target is selected. Use clear files such as `landing.html` (if enabled), `mobile-ios.html`, `mobile-android.html`, `tablet.html`, `desktop.html`, plus shared `css/` and `js/` when useful. `index.html` may be a launcher/overview that links to these files, but it must not be the only place where mobile/tablet/desktop designs live. Do not collapse cross-platform work into a single tabbed demo, selector UI, comparison board, platform map, or labelled documentation section inside one mock product page.',
    );
  }
  lines.push(
    '- **screen-file-first rule**: each distinct user-facing screen or surface MUST be delivered as its own HTML file unless the user explicitly asks for a single-page scroll or single-file artifact. Do not combine landing pages, product app screens, dashboards, history, pricing, settings, mobile app, tablet app, desktop app, or OS widget surfaces into one long page. Use `index.html` as a launcher/overview that links to screen files when more than one screen exists; it may summarize the product and show screen cards, but it must not contain the full design for every screen.',
  );
  lines.push(
    '- **product-realism rule**: final artifacts must look like real end-user product UI. Do not render project metadata, screen counts, target counts, state counts, "demo only" labels, "settings" panels for choosing platforms, "full design target" badges, viewport/device selector controls, theme/style knobs, platform output maps, behavior-spec sections, or design-process cards inside the product unless the user explicitly asks for a design spec/dashboard. Any navigation/tabs inside the artifact must be real product navigation, not designer controls for switching generated mockups.',
  );
  lines.push(
    '- **visual-system rule**: when the user does not specify colors, layout, or visual direction, you must still make an intentional product-appropriate visual system. Infer a palette from the product category and audience with at least: neutral surface tokens, a primary action color, a secondary/domain accent, and status colors. Avoid plain monochrome/unstyled greyscale outputs. Use tasteful gradients, illustrations, iconography, device/product mockups, and colored state moments where they clarify the product, while still avoiding generic beige/peach/pink/brown AI washes.',
  );
  lines.push(
    '- **app-specific modules rule**: include domain-specific in-app modules/components by default (cards, panels, controls, charts, lists, quick actions, status modules, mini players, checkout/cart summaries, etc. as appropriate). These are product UI modules, not OS home-screen widgets. Give each major module a clear purpose, states, and responsive behavior instead of generic card grids.',
  );
  lines.push(
    '- **implementation-ready UX rule**: the artifact must be implementation-ready, not a static screenshot. Follow the default React stack contract: `.html` shells per screen, interactive logic in `.jsx` components (Babel standalone), shared tokens in `css/tokens.css`. Meaningful UX such as tabs, dialogs, drawers, filters, generation/copy actions, validation, playback controls, or state transitions must be real React state + handlers, not decorative markup.',
  );
  lines.push(
    '- **interaction-fidelity rule**: when the requested screen includes user input, generation, copying, validation, login, checkout, filtering, or any action verb, build real controlled React components for that screen (useState + handlers + working state transitions). Do not substitute static text rows, prefilled-only mockups, screenshot-like device frames, or decorative state cards for editable inputs and working actions.',
  );
  if (metadata.includeLandingPage) {
    lines.push(
      '- **includeLandingPage**: true — create `landing.html` as a separate responsive marketing companion surface in addition to the selected product/app screens. Do not implement the landing page only as a section inside `index.html`, even for responsive-web-only projects. If there is a working product/app screen, create it as a separate file such as `app.html`, `dashboard.html`, or a domain-specific screen name. `index.html` should be a lightweight launcher/overview when multiple files exist. Include hero, value props, product screenshots/device mockups, proof/features, and an appropriate CTA such as waitlist, download, or contact sales.',
    );
  }
  if (metadata.includeOsWidgets) {
    lines.push(
      '- **includeOsWidgets**: true — add platform-native OS home-screen / lock-screen / quick-access widget surfaces where relevant. These are outside-the-app widgets (for example iOS WidgetKit, Android home screen widget, Live Activity/lock screen, tablet glance panel), not in-app cards. Include realistic widget sizes and direct quick actions for the domain.',
    );
  }
  lines.push(
    `- **fidelity**: ${metadata.fidelity ?? '(unknown — ask: wireframe vs high-fidelity)'}`,
  );
  return lines.join('\n');
}

/**
 * 设计链路的 append 片段（顺序对齐参照 composeSystemPrompt：locale 置顶 →
 * discovery 主导层 → 元数据块殿后）。调用方在其后拼全局/项目自定义指令。
 */
export function designAppendPrompts(metadata: ProjectMetadata | undefined): string[] {
  const parts = [UI_LOCALE_PROMPT, DISCOVERY_AND_PHILOSOPHY, TECH_STACK_PROMPT];
  const metaBlock = renderMetadataBlock(metadata);
  if (metaBlock) parts.push(metaBlock);
  return parts;
}
