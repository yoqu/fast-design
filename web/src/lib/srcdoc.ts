// Minimal srcdoc helpers for the html-prototype path. Open-design's full
// srcdoc.ts also rebuilds deck frameworks and react harnesses; the prototype
// flow only needs a well-formed document plus the sandboxed wrapper (ported
// verbatim from apps/web/src/runtime/exports.ts:844-877).

export function buildSrcdoc(html: string): string {
  const trimmed = html.replace(/^﻿/, '');
  if (/^\s*<!doctype/i.test(trimmed)) return trimmed;
  return `<!doctype html>\n${trimmed}`;
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Blob documents inherit the origin of the page that created them. For
// generated preview HTML, opening the artifact itself as the top-level Blob
// document would bypass the preview contract: the untrusted code must run in
// an iframe sandbox without `allow-same-origin`. This wrapper is same-origin,
// but it contains no generated script; the generated document lives in an
// opaque-origin child.
export function buildSandboxedPreviewDocument(
  doc: string,
  title: string,
  opts?: { allowModals?: boolean },
): string {
  const safeTitle = escapeHtmlAttribute(title || 'Preview');
  const sandbox = opts?.allowModals ? 'allow-scripts allow-modals' : 'allow-scripts';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>html,body,iframe{margin:0;width:100%;height:100%;border:0}body{overflow:hidden;background:#fff}</style>
</head>
<body>
  <iframe title="${safeTitle}" sandbox="${sandbox}" srcdoc="${escapeHtmlAttribute(doc)}"></iframe>
</body>
</html>`;
}
