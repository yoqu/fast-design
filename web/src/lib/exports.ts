// Client-side export helpers, ported 1:1 from open-design
// apps/web/src/runtime/exports.ts with the desktop-host (Electron), react
// component and deck branches removed — the prototype flow only ships the
// browser paths:
//   - HTML : download the artifact as a single .html file via a Blob URL.
//   - ZIP  : pack the artifact with a coding handoff guide (see ./zip.ts),
//            or ask the server to bundle the on-disk project tree.
//   - PDF  : open the artifact in a popup window and trigger window.print().
//   - PNG/JPEG/WebP : capture the preview iframe via the snapshot bridge.
import { buildSandboxedPreviewDocument, buildSrcdoc } from './srcdoc';
import { buildZip } from './zip';

const DESIGN_HANDOFF_FILENAME = 'DESIGN-HANDOFF.md';
const DESIGN_MANIFEST_FILENAME = 'DESIGN-MANIFEST.json';

export function safeFilename(name: string, fallback: string): string {
  const slug = (name || fallback)
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function triggerHrefDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerHrefDownload(url, filename);
  // Revoke later — Safari sometimes hasn't finished reading the blob yet
  // when the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function exportAsHtml(html: string, title: string): void {
  const doc = buildSrcdoc(html);
  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, `${safeFilename(title, 'artifact')}.html`);
}

// A file is treated as a preview-chrome wrapper only when it lives inside
// a frames/ or device-frames/ directory, or its filename is an unambiguous
// wrapper template (browser-chrome.html, device-frame.html).  Filenames
// like phone.html or iphone-upgrade.html are legitimate product-screen
// deliverables and must not be dropped from manifest screens.
const FRAME_WRAPPER_FILE_RE = /(^|\/)(frames?\/|device-frames?\/)|(^|\/)(browser-chrome|device-frame)\.html?$/i;

function isFrameWrapperHtmlFile(file: string): boolean {
  return FRAME_WRAPPER_FILE_RE.test(file);
}

type DesignFileMap = {
  files: string[];
  htmlFiles: string[];
  screenHtmlFiles: string[];
  cssFiles: string[];
  jsFiles: string[];
  assetFiles: string[];
  entryFile: string;
};

function designFileMap(entryFile: string, files?: string[]): DesignFileMap {
  const all = Array.from(new Set([entryFile, ...(files ?? [])])).sort((a, b) => a.localeCompare(b));
  const htmlFiles = all.filter((name) => /\.html?$/i.test(name));
  const screenHtmlFiles = htmlFiles.filter((name) => !isFrameWrapperHtmlFile(name));
  const cssFiles = all.filter((name) => /\.css$/i.test(name));
  const jsFiles = all.filter((name) => /\.[cm]?[jt]sx?$/i.test(name));
  const assetFiles = all.filter((name) => !htmlFiles.includes(name) && !cssFiles.includes(name) && !jsFiles.includes(name));
  const preferredEntryFile = !isFrameWrapperHtmlFile(entryFile)
    ? entryFile
    : screenHtmlFiles.find((name) => /(^|\/)index\.html$/i.test(name)) || screenHtmlFiles[0] || entryFile;
  return { files: all, htmlFiles, screenHtmlFiles, cssFiles, jsFiles, assetFiles, entryFile: preferredEntryFile };
}

export function buildDesignManifestContent(opts: {
  title: string;
  entryFile: string;
  files?: string[];
  kind?: 'html' | 'react';
}): string {
  const title = opts.title || 'Open Design artifact';
  const requestedEntryFile = opts.entryFile || 'index.html';
  const { files, htmlFiles, screenHtmlFiles, cssFiles, jsFiles, assetFiles, entryFile } = designFileMap(requestedEntryFile, opts.files);
  const screenFiles = screenHtmlFiles.length > 0 ? screenHtmlFiles : [entryFile];
  return JSON.stringify({
    schema: 'open-design.design-manifest.v1',
    title,
    kind: opts.kind ?? 'html',
    entryFile,
    sourceFiles: {
      all: files,
      html: htmlFiles,
      css: cssFiles,
      scriptsAndComponents: jsFiles,
      assets: assetFiles,
    },
    screens: screenFiles.map((file) => {
      const isIndex = /(^|\/)index\.html?$/i.test(file);
      const isLanding = /(^|\/)(landing|marketing)\.html?$/i.test(file) || /landing|marketing/i.test(file);
      const isOsWidget = /widget|live-activity|lock-screen|home-screen/i.test(file);
      const isApp = /app|dashboard|workspace|generator|translator|editor|screen/i.test(file);
      return {
        file,
        role: isIndex && screenFiles.length > 1 ? 'launcher-overview' : isLanding ? 'landing-page' : isOsWidget ? 'os-widget-surface' : isApp ? 'product-screen' : 'screen',
        implementationNote: isIndex && screenFiles.length > 1
          ? 'Use this as the navigation/overview entry only; implement each linked screen file as its own route/surface.'
          : 'Preserve visual hierarchy, responsive behavior, and interactive states from this screen.',
      };
    }),
    screenFilePolicy: {
      mode: 'screen-file-first',
      entryFileRole: screenFiles.length > 1 && /(^|\/)index\.html?$/i.test(entryFile) ? 'launcher-overview' : 'primary-screen',
      rules: [
        'Each distinct user-facing screen or surface must be delivered and implemented as its own file/route.',
        'If a landing page is present or requested, keep it in landing.html and do not merge it into the product app screen.',
        'When multiple HTML screens exist, index.html is a launcher/overview only; it must not be treated as the combined final UI.',
        'Keep product app screens, landing pages, platform screens, and OS widget surfaces separate in production code.',
      ],
    },
    appModules: [
      'Identify domain-specific in-app modules from the exported UI; do not reduce them to generic cards.',
      'For each major module, implement purpose, default/loading/empty/error/success states, and responsive behavior.',
      'Keep app modules separate from OS home-screen widgets in the production component model.',
    ],
    osWidgets: [
      'If the export includes home-screen, lock-screen, Live Activity, tablet glance, or Android widget surfaces, implement them as platform quick-access surfaces outside the app UI.',
      'If none are present, do not invent OS widgets unless the product requirements request them.',
    ],
    landingPage: {
      detection: 'Inspect files and screen names for a marketing/landing page surface. If present, keep it separate from product app screens.',
      requiredSections: ['hero', 'value props', 'product proof/screenshots', 'feature proof', 'CTA'],
    },
    tokens: {
      source: cssFiles.length > 0 ? cssFiles : [entryFile],
      required: ['background', 'surface', 'foreground', 'muted text', 'border', 'accent', 'radius', 'shadow', 'spacing', 'type scale', 'motion'],
      note: 'Extract/freeze tokens before framework implementation so coding tools do not substitute default theme colors or typography.',
    },
    interactions: {
      source: jsFiles.length > 0 ? jsFiles : [entryFile],
      requiredStates: ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'empty', 'error', 'success'],
      requiredBehaviors: ['forms/validation where present', 'tabs/filters where present', 'dialogs/sheets/drawers where present', 'copy/generate/share actions where present', 'player or quick controls where present'],
      note: 'If the prototype is static, derive missing behavior from visible controls and document it before coding.',
    },
    responsiveViewports: [
      { name: 'mobile-compact', width: 360, height: 800, category: 'mobile', mustAvoidHorizontalScroll: true },
      { name: 'mobile-standard', width: 390, height: 844, category: 'mobile', mustAvoidHorizontalScroll: true },
      { name: 'mobile-large', width: 430, height: 932, category: 'mobile', mustAvoidHorizontalScroll: true },
      { name: 'foldable-small-tablet', width: 600, height: 960, category: 'foldable-tablet', mustAvoidHorizontalScroll: true },
      { name: 'tablet-portrait', width: 820, height: 1180, category: 'tablet', mustAvoidHorizontalScroll: true },
      { name: 'tablet-landscape', width: 1024, height: 768, category: 'tablet', mustAvoidHorizontalScroll: true },
      { name: 'laptop', width: 1366, height: 768, category: 'desktop', mustAvoidHorizontalScroll: true },
      { name: 'desktop', width: 1440, height: 900, category: 'desktop', mustAvoidHorizontalScroll: true },
      { name: 'wide', width: 1920, height: 1080, category: 'wide', mustAvoidHorizontalScroll: true },
    ],
    implementationChecklist: [
      'Open entryFile first and map screens, modules, tokens, and interactions.',
      'Extract tokens before writing framework components.',
      'Implement app-specific modules with real states instead of generic card grids.',
      'Preserve or rebuild JS interactions for meaningful UX actions.',
      'Validate screenshots at desktop/tablet/mobile viewports with no horizontal overflow.',
      'Keep landing pages, in-app modules, and OS widgets as separate implementation surfaces.',
    ],
  }, null, 2);
}

export function buildDesignHandoffContent(opts: {
  title: string;
  entryFile: string;
  files?: string[];
  kind?: 'html' | 'react';
}): string {
  const title = opts.title || 'Open Design artifact';
  const requestedEntryFile = opts.entryFile || 'index.html';
  const { files, htmlFiles, cssFiles, jsFiles, assetFiles, entryFile } = designFileMap(requestedEntryFile, opts.files);
  const accentLikelyBrandLed =
    files.some((name) => /(design|brand|tokens?|theme|style|tailwind|variables)\.(css|scss|sass|less|json|ts|tsx|js|jsx|md)$/i.test(name)) ||
    cssFiles.length > 0;
  const hasResponsiveClues =
    htmlFiles.length > 0 ||
    cssFiles.length > 0 ||
    files.some((name) => /(screens?|pages?|components?|app|src)\//i.test(name));
  const list = (items: string[]) => items.length > 0 ? items.map((name) => `- \`${name}\``).join('\n') : '- None detected';
  const sourceNote = opts.kind === 'react'
    ? 'Use the exported React source as the component contract, then preserve the rendered visual behavior in the target app.'
    : `Start from \`${entryFile}\`, then preserve the visual system, responsive behavior, and interactions found in the exported files.`;

  return `# ${title} implementation handoff

This archive is the source of truth for turning the design into production code. ${sourceNote}

## Implementation target
- Build production UI from the exported design, not a loose reinterpretation.
- Preserve typography scale, spacing rhythm, color tokens, border radii, shadows, motion timing, and component states.
- Replace static placeholders only when the target app has real data or functional equivalents.
- Keep generated product UI free of Open Design chrome, preview labels, or design-process annotations.
- Treat this handoff as a visual contract: if implementation choices conflict, match the exported pixels and behavior first, then refactor internals.

## Source map
- Primary entry: \`${entryFile}\`
- HTML screens detected: ${htmlFiles.length}
- Stylesheets detected: ${cssFiles.length}
- Script/component files detected: ${jsFiles.length}
- Supporting assets detected: ${assetFiles.length}

## Responsive contract
Validate the implementation across this 2025–2026 viewport matrix:
- Mobile compact: 360×800
- Mobile standard: 390×844
- Mobile large: 430×932
- Foldable / small tablet: 600×960
- Tablet portrait: 820×1180
- Tablet landscape: 1024×768
- Laptop: 1366×768
- Desktop: 1440×900
- Wide desktop: 1920×1080

For responsive web exports, treat these as a modern breakpoint system for one adaptive web experience, not three fixed screenshots. Do not split responsive web into unrelated native app screens unless the project explicitly includes native targets. Use semantic layout thresholds, fluid \`clamp()\` type/spacing, and container queries where component width matters more than viewport width. ${hasResponsiveClues ? 'Preserve any CSS media queries, container queries, fluid \`clamp()\` scales, and layout changes already present in the exported files.' : 'If responsive rules are not present in the export, add them in the target implementation before shipping.'}

## Design fidelity contract
- Extract reusable tokens before writing components: background, surface, foreground, muted text, border, accent, radius, shadow, spacing, type scale, and motion duration/easing.
- Map product screens, in-app modules/components, optional landing page, and optional OS widget surfaces before coding. Keep these surfaces separate in the target architecture.
- Match layout geometry: max-widths, gutters, grid columns, card proportions, sticky/fixed elements, and viewport-specific navigation.
- Preserve real copy, labels, and data shown in the export. Do not replace specific text with generic marketing filler.
- Preserve interactive affordances: hover, focus, pressed, disabled, loading, validation, copy/share, tab/accordion, modal/sheet, and keyboard states where present.
- Preserve accessibility semantics when converting: headings stay hierarchical, controls remain buttons/links/inputs, focus states stay visible.
- Do not keep prototype-only annotations, frame labels, or Open Design chrome in the production UI.

## CJX-ready UX contract
- Use \`${DESIGN_MANIFEST_FILENAME}\` as the machine-readable map for screens, app modules, OS widgets, landing pages, tokens, interactions, and viewport checks.
- Screen-file-first: when multiple user-facing surfaces exist, implement each HTML screen as its own route/file. Treat \`index.html\` as a launcher/overview when the manifest marks it that way, not as a combined final UI.
- If \`landing.html\`, app screens, platform screens, or OS widget files exist, preserve those boundaries in the target app instead of merging them into one page.
- A single self-contained \`${entryFile}\` is acceptable only when the export truly contains one user-facing screen and its CSS/JS are structured enough to extract tokens, components, states, and behavior.
- If separate \`css/\` or \`js/\` files exist, treat them as source of truth for token/component/interactions before porting to React, Vue, SwiftUI, Compose, or another target stack.
- In-app modules/components are product UI blocks inside the app. OS widgets are home-screen/lock-screen/quick-access surfaces outside the app. Do not merge those concepts.

## Color and brand contract
- Use the exported design tokens and product/domain context as the color source of truth.
- Do not introduce warm beige / cream / peach / pink / orange-brown background washes unless they are already explicit brand/reference colors in the export.
- ${accentLikelyBrandLed ? 'A stylesheet or design/token file was detected; inspect it for canonical color variables before choosing framework theme tokens.' : 'No obvious token stylesheet was detected; sample colors from the entry file and convert them into named tokens before coding.'}

## Implementation sequence for AI coding tools
1. Open \`${entryFile}\` and \`${DESIGN_MANIFEST_FILENAME}\`; identify every screen file, launcher/overview file, app module, and interaction before coding.
2. If multiple HTML screens exist, map them to separate routes/surfaces first; do not merge \`landing.html\`, product app screens, platform screens, or OS widgets into one route.
3. Extract a token table from CSS/root styles and inline styles before building framework components.
4. Build product screens and domain-specific in-app modules from largest layout regions down to controls; avoid starting with isolated atoms that lose spatial intent.
5. Port responsive behavior across the modern viewport matrix and test each semantic breakpoint before cleanup.
6. Port interactions and states, then replace static placeholders only with real app data or functional equivalents.
7. Keep optional landing page and OS widget surfaces as separate surfaces if present.
8. Compare final screenshots against the export at 360×800, 390×844, 430×932, 820×1180, 1024×768, 1366×768, 1440×900, and 1920×1080 before declaring done.

## Entry points
${list(htmlFiles.length > 0 ? htmlFiles : [entryFile])}

## Styles
${list(cssFiles)}

## Scripts/components
${list(jsFiles)}

## Assets and supporting files
${list(assetFiles)}

## Coding checklist for AI tools
1. Inspect \`${entryFile}\` and \`${DESIGN_MANIFEST_FILENAME}\` first and identify reusable components before coding.
2. Implement each user-facing screen file as its own route/surface; keep launcher, landing, app, platform, and OS widget files separate.
3. Extract design tokens into the target stack: colors, type scale, spacing, radius, shadows, and motion.
4. Implement layout with real 2025–2026 responsive breakpoints, fluid type/spacing, and container-query-aware component behavior; test with no horizontal overflow.
5. Preserve interactive controls, hover/focus/pressed states, form behavior, validation, and copy actions where present.
6. Implement domain-specific in-app modules with real states; do not flatten them into generic cards.
7. Keep landing page, product screens, and OS widget/quick-access surfaces separate when present.
8. Confirm the production result visually matches the exported design before refactoring internals.
9. Reject implementation shortcuts that flatten the design into generic cards, generic gradients, placeholder stats, or framework-default typography.
10. If a detail is ambiguous, keep the exported HTML/CSS/JS behavior rather than inventing a new pattern.
`;
}

export function exportAsZip(html: string, title: string, files?: string[]): void {
  const doc = buildSrcdoc(html);
  const slug = safeFilename(title, 'artifact');
  const fileList = files && files.length > 0 ? files : ['index.html'];
  const blob = buildZip([
    { path: `${slug}/index.html`, content: doc },
    {
      path: `${slug}/${DESIGN_HANDOFF_FILENAME}`,
      content: buildDesignHandoffContent({
        title: title || slug,
        entryFile: 'index.html',
        files: fileList,
      }),
    },
    {
      path: `${slug}/${DESIGN_MANIFEST_FILENAME}`,
      content: buildDesignManifestContent({
        title: title || slug,
        entryFile: 'index.html',
        files: fileList,
      }),
    },
  ]);
  triggerDownload(blob, `${slug}.zip`);
}

// ---------------------------------------------------------------------------
// Image screenshot export
// ---------------------------------------------------------------------------

export type PreviewSnapshot = { dataUrl: string; w: number; h: number };

export type PreviewSnapshotResult =
  | { ok: true; snapshot: PreviewSnapshot }
  | { ok: false; reason: 'loading' | 'post-message-error' | 'render-error' | 'timeout'; error?: string };

export function requestPreviewSnapshotResult(
  iframe: HTMLIFrameElement,
  timeout = 8000,
): Promise<PreviewSnapshotResult> {
  const win = iframe.contentWindow;
  if (!win) return Promise.resolve({ ok: false, reason: 'loading' });
  const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    let done = false;
    function onMsg(ev: MessageEvent) {
      if (ev.source !== win) return;
      const d = ev.data as {
        type?: string;
        id?: string;
        dataUrl?: string;
        w?: number;
        h?: number;
        error?: string;
      } | null;
      if (!d || d.type !== 'od:snapshot:result' || d.id !== id) return;
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      if (d.dataUrl && d.w && d.h) resolve({ ok: true, snapshot: { dataUrl: d.dataUrl, w: d.w, h: d.h } });
      else resolve({ ok: false, reason: 'render-error', error: d.error });
    }
    window.addEventListener('message', onMsg);
    try {
      win.postMessage({ type: 'od:snapshot', id }, '*');
    } catch {
      done = true;
      window.removeEventListener('message', onMsg);
      resolve({ ok: false, reason: 'post-message-error' });
    }
    setTimeout(() => {
      if (!done) {
        done = true;
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, reason: 'timeout' });
      }
    }, timeout);
  });
}

export async function requestPreviewSnapshot(
  iframe: HTMLIFrameElement,
  timeout = 8000,
): Promise<PreviewSnapshot | null> {
  const result = await requestPreviewSnapshotResult(iframe, timeout);
  return result.ok ? result.snapshot : null;
}

/** Convert a data-URL to a Blob without re-encoding through canvas. */
function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('Invalid data URL');
  }
  const [header, base64] = dataUrl.split(',');
  const mime = header?.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bytes = atob(base64 ?? '');
  if (bytes.length <= 0) {
    throw new Error('Image snapshot is empty');
  }
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export type ImageExportFormat = 'png' | 'jpeg' | 'webp';

type ImageExportSpec = {
  extension: string;
  mime: `image/${string}`;
  pickerLabel: string;
};

const IMAGE_EXPORT_SPECS: Record<ImageExportFormat, ImageExportSpec> = {
  png: {
    extension: 'png',
    mime: 'image/png',
    pickerLabel: 'PNG image',
  },
  jpeg: {
    extension: 'jpg',
    mime: 'image/jpeg',
    pickerLabel: 'JPEG image',
  },
  webp: {
    extension: 'webp',
    mime: 'image/webp',
    pickerLabel: 'WebP image',
  },
};

type FileSystemWritableFileStreamLike = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
};

type FileSystemFileHandleLike = {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
};

type SaveFilePickerOptionsLike = {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
};

type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptionsLike) => Promise<FileSystemFileHandleLike>;
};

export type ImageExportTarget = {
  filename: string;
  method: 'download' | 'picker';
  save: (blob: Blob) => Promise<void> | void;
};

type ImageExportTargetOptions = {
  useNativePicker?: boolean;
};

function imageExportFilename(title: string, format: ImageExportFormat): string {
  const spec = IMAGE_EXPORT_SPECS[format];
  return `${safeFilename(title, 'artifact')}.${spec.extension}`;
}

function downloadImageExportTarget(filename: string): ImageExportTarget {
  return {
    filename,
    method: 'download',
    save: (blob) => {
      triggerDownload(blob, filename);
    },
  };
}

export function downloadImageDataUrl(dataUrl: string, filename: string): void {
  // Validate the snapshot without converting the actual download path to a blob URL.
  dataUrlToBlob(dataUrl);
  triggerHrefDownload(dataUrl, filename);
}

function isDomExceptionNamed(err: unknown, names: ReadonlySet<string>): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return names.has(err.name);
  }
  if (!err || typeof err !== 'object' || !('name' in err)) return false;
  return typeof err.name === 'string' && names.has(err.name);
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image snapshot'));
    img.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(`Could not encode snapshot as ${mime}`));
        return;
      }
      if (blob.type && blob.type !== mime) {
        reject(new Error(`Browser encoded ${blob.type} instead of ${mime}`));
        return;
      }
      resolve(blob);
    }, mime, quality);
  });
}

export async function imageDataUrlToBlob(
  dataUrl: string,
  format: ImageExportFormat,
): Promise<Blob> {
  const spec = IMAGE_EXPORT_SPECS[format];
  if (format === 'png') {
    const blob = dataUrlToBlob(dataUrl);
    if (blob.type === spec.mime) return blob;
  }

  const img = await loadImageFromDataUrl(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width <= 0 || height <= 0) {
    throw new Error('Image snapshot is empty');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  if (format === 'jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvasToBlob(canvas, spec.mime, format === 'jpeg' ? 0.92 : undefined);
}

export async function prepareImageExportTarget(
  title: string,
  format: ImageExportFormat,
  options: ImageExportTargetOptions = {},
): Promise<ImageExportTarget | null> {
  const spec = IMAGE_EXPORT_SPECS[format];
  const filename = imageExportFilename(title, format);
  const picker = (window as WindowWithSaveFilePicker).showSaveFilePicker;
  if (options.useNativePicker !== false && typeof picker === 'function') {
    try {
      const handle = await picker.call(window, {
        suggestedName: filename,
        types: [
          {
            description: spec.pickerLabel,
            accept: {
              [spec.mime]: [`.${spec.extension}`],
            },
          },
        ],
      });
      return {
        filename,
        method: 'picker',
        save: async (blob) => {
          const writable = await handle.createWritable();
          try {
            await writable.write(blob);
          } finally {
            await writable.close();
          }
        },
      };
    } catch (err) {
      if (isDomExceptionNamed(err, new Set(['AbortError']))) return null;
      if (isDomExceptionNamed(err, new Set(['NotAllowedError', 'SecurityError']))) {
        return downloadImageExportTarget(filename);
      }
      throw err;
    }
  }

  return downloadImageExportTarget(filename);
}

/** Download a snapshot data-URL as a PNG file. */
export function exportAsImage(dataUrl: string, title: string): void {
  try {
    const blob = dataUrlToBlob(dataUrl);
    triggerDownload(blob, `${safeFilename(title, 'artifact')}.png`);
  } catch (err) {
    console.warn('[exportAsImage] failed to convert snapshot:', err);
    throw err;
  }
}

// Project ZIP export — asks the server to bundle the on-disk project tree.
// `filePath` is the active file's project-relative path; if it lives inside a
// top-level directory we scope the archive to that directory, otherwise we ask
// for the whole project. Falls back to the in-memory single-file ZIP on any
// failure so the action never silently no-ops.
export async function exportProjectAsZip(opts: {
  projectId: string;
  filePath: string;
  fallbackHtml: string;
  fallbackTitle: string;
}): Promise<void> {
  const root = archiveRootFromFilePath(opts.filePath);
  const url = `/api/projects/${encodeURIComponent(opts.projectId)}/export${
    root ? `?root=${encodeURIComponent(root)}` : ''
  }`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`archive request failed (${resp.status})`);
    const blob = await resp.blob();
    triggerDownload(blob, archiveFilenameFrom(resp, opts.fallbackTitle, root));
  } catch (err) {
    console.warn('[exportProjectAsZip] falling back to single-file ZIP:', err);
    exportAsZip(opts.fallbackHtml, opts.fallbackTitle);
  }
}

// Exported for unit tests. Pure string transform with no DOM dependency.
export function archiveRootFromFilePath(filePath: string): string {
  const trimmed = (filePath || '').replace(/^\/+/, '');
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return '';
  return trimmed.slice(0, slash);
}

// Exported for unit tests so the Content-Disposition fallback chain
// (UTF-8 → legacy quoted → local slug) can be exercised against mock
// Response objects.
export function archiveFilenameFrom(resp: Response, fallbackTitle: string, root: string): string {
  const header = resp.headers.get('content-disposition') || '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star && star[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to the legacy filename= or local fallback
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  if (plain && plain[1]) return plain[1];
  const slug = safeFilename(root || fallbackTitle, 'project');
  return `${slug}.zip`;
}

// Open the artifact in a new tab via a Blob URL with a self-printing script
// injected, then let the user pick "Save as PDF" from the system print dialog.
export async function exportAsPdf(
  html: string,
  title: string,
  opts?: { sandboxedPreview?: boolean },
): Promise<void> {
  const sandboxedPreview = opts?.sandboxedPreview ?? true;
  // Generate a per-export nonce so the print-ready handshake is resistant to
  // spoofing by untrusted scripts inside the exported artifact.
  const nonce = randomUUID();
  let doc = buildSrcdoc(html);
  doc = injectPrintReadyHandshake(doc, nonce);

  // Browser flow: wrap with allow-modals so the injected script can call
  // window.print(), then inject the self-printing script and open a popup.
  if (sandboxedPreview) {
    doc = buildSandboxedPreviewDocument(doc, title, { allowModals: true });
    doc = injectParentPrintReadyCache(doc, nonce);
  }
  doc = injectPrintScript(doc, title);

  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // Open an empty tab synchronously (without noopener) to reliably detect
  // popup blocking — window.open with 'noopener' returns null on success.
  const win = window.open('', '_blank');

  if (!win) {
    if (typeof alert !== 'undefined') {
      alert('Popup blocked! Click the popup-blocked icon in your browser address bar (or browser menu), choose "Always allow pop-ups" for this site, then retry Export PDF.');
    }
    URL.revokeObjectURL(url);
    return;
  }

  if (sandboxedPreview) {
    try {
      win.opener = null;
    } catch {
      // Guard against potential context environment restrictions
    }
  }

  win.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function injectPrintScript(doc: string, title: string): string {
  const safeTitle = JSON.stringify(title || 'artifact');
  // setTimeout gives stylesheets and images one tick to settle before the
  // print dialog measures the page; without it some print previews come
  // out blank in Chrome.
  const script = `<script>try{document.title=${safeTitle}}catch(e){}window.addEventListener('load',function(){setTimeout(function(){try{window.focus();window.print()}catch(e){}},300)})</script>`;
  if (/<\/head>/i.test(doc)) return doc.replace(/<\/head>/i, `${script}</head>`);
  if (/<\/body>/i.test(doc)) return doc.replace(/<\/body>/i, `${script}</body>`);
  return doc + script;
}

function injectPrintReadyHandshake(doc: string, nonce: string): string {
  // Wait for fonts, the window load event (which covers initial images), and
  // any images that are still loading after load fires. Also wait for CSS
  // image URLs and two animation frames so background/list/border images and
  // final layout are settled before printing.
  const script = `<script data-od-print-ready>(function(){function waitForImages(){var imgs=Array.from(document.images).filter(function(img){return !img.complete});return Promise.all(imgs.map(function(img){return new Promise(function(r){img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true});if(img.complete)r()})}))}function cssUrlValues(value){var urls=[];if(!value||value==='none')return urls;value.replace(/url\\((['"]?)(.*?)\\1\\)/g,function(_,q,rawUrl){if(rawUrl&&!/^data:/i.test(rawUrl))urls.push(rawUrl);return''});return urls}function waitForCssBackgroundImages(){var urls=new Set();Array.from(document.querySelectorAll('*')).forEach(function(el){var style=window.getComputedStyle(el);cssUrlValues(style.backgroundImage).forEach(function(url){urls.add(url)});cssUrlValues(style.borderImageSource).forEach(function(url){urls.add(url)});cssUrlValues(style.listStyleImage).forEach(function(url){urls.add(url)})});return Promise.all(Array.from(urls).map(function(url){return new Promise(function(r){var img=new Image();img.onload=r;img.onerror=r;img.src=url})}))}function nextFrame(){return new Promise(function(r){requestAnimationFrame(function(){r(true)})})}Promise.all([document.fonts&&document.fonts.ready?document.fonts.ready.catch(function(){}):Promise.resolve(),new Promise(function(r){if(document.readyState==='complete')r();else window.addEventListener('load',r,{once:true})})]).then(function(){return Promise.all([waitForImages(),waitForCssBackgroundImages()])}).then(nextFrame).then(nextFrame).then(function(){window.parent.postMessage({type:'OD_PRINT_READY',nonce:'${nonce}'},'*')})})();<\/script>`;
  if (/<\/head>/i.test(doc)) return doc.replace(/<\/head>/i, `${script}</head>`);
  if (/<\/body>/i.test(doc)) return doc.replace(/<\/body>/i, `${script}</body>`);
  return doc + script;
}

function injectParentPrintReadyCache(doc: string, nonce: string): string {
  const script = `<script>window.__odPrintReady=false;window.addEventListener('message',function(e){if(e.data&&e.data.type==='OD_PRINT_READY'&&e.data.nonce==='${nonce}'&&(e.source===window||(window.frames&&e.source===window.frames[0])))window.__odPrintReady=true});<\/script>`;
  if (/<head>/i.test(doc)) return doc.replace(/<head>/i, `<head>${script}`);
  return script + doc;
}
