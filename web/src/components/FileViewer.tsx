import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectArtifact } from '../lib/artifacts';
import { api } from '../lib/api';
import type { GenerationModel } from '../lib/generation';
import { GenerationStage } from './GenerationStage';
import { ExportMenu } from './ExportMenu';

// Viewport presets ported from open-design FileViewer.tsx:218-240.
type PreviewViewportId = 'desktop' | 'tablet' | 'mobile';

type PreviewViewportPreset = {
  id: PreviewViewportId;
  width: number | null;
  height: number | null;
  label: string;
  title: string;
  icon: string;
};

const PREVIEW_VIEWPORT_PRESETS: PreviewViewportPreset[] = [
  { id: 'desktop', width: null, height: null, label: '桌面', title: '桌面(满幅)', icon: '🖥' },
  { id: 'tablet', width: 820, height: 1180, label: '平板', title: '平板 820×1180', icon: '📱' },
  { id: 'mobile', width: 390, height: 844, label: '手机', title: '手机 390×844', icon: '📲' },
];

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];
const CANVAS_PADDING = 48;

// Ported from open-design effectivePreviewScale (FileViewer.tsx:628-641):
// non-desktop viewports never overflow the canvas — the preset is fitted
// down, and explicit zoom can only zoom within that fit.
function effectivePreviewScale(
  viewport: PreviewViewportId,
  previewScale: number,
  canvas: { width: number; height: number } | null,
): number {
  if (viewport === 'desktop') return previewScale;
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport);
  if (!preset?.width || !preset.height || !canvas?.width || !canvas.height) return previewScale;
  const availableWidth = Math.max(1, canvas.width - CANVAS_PADDING);
  const availableHeight = Math.max(1, canvas.height - CANVAS_PADDING);
  const fitScale = Math.min(1, availableWidth / preset.width, availableHeight / preset.height);
  return Math.min(previewScale, fitScale);
}

type Props = {
  projectId: string;
  file: string;
  artifact: ProjectArtifact | null;
  files: string[];
  reloadKey: number;
  generation: GenerationModel;
  onRetry?: () => void;
};

/**
 * Artifact preview viewer, mirroring open-design's FileViewer prototype path:
 * toolbar (viewport presets / zoom menu / refresh / open in new window /
 * export menu) above a sandboxed scoped-URL iframe, with the generation stage
 * overlaying the canvas while the agent works.
 */
export function FileViewer({ projectId, file, artifact, files, reloadKey, generation, onRetry }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState('allow-scripts allow-forms');
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<PreviewViewportId>('desktop');
  const [zoom, setZoom] = useState(100);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [localReload, setLocalReload] = useState(0);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .previewUrl(projectId, file)
      .then((data) => {
        if (cancelled) return;
        setPreviewUrl(`${data.url}?bridge=snapshot`);
        setSandbox(data.iframeSandbox);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, file, reloadKey, localReload]);

  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!zoomMenuRef.current) return;
      if (!zoomMenuRef.current.contains(e.target as Node)) setZoomMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [zoomMenuOpen]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setCanvasSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const refresh = useCallback(() => setLocalReload((v) => v + 1), []);

  const openInNewWindow = useCallback(() => {
    if (previewUrl) window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }, [previewUrl]);

  const preset = PREVIEW_VIEWPORT_PRESETS.find((p) => p.id === viewport)!;
  const previewScale = zoom / 100;
  const scale = effectivePreviewScale(viewport, previewScale, canvasSize);

  const shellStyle = useMemo(() => {
    if (viewport === 'desktop') {
      return {
        width: `${100 / previewScale}%`,
        height: `${100 / previewScale}%`,
        transform: `scale(${previewScale})`,
        transformOrigin: '0 0',
      } as const;
    }
    return {
      width: preset.width!,
      height: preset.height!,
      transform: `scale(${scale})`,
      transformOrigin: '0 0',
    } as const;
  }, [viewport, previewScale, scale, preset.width, preset.height]);

  const stageVisible = generation.phase !== 'idle' && generation.phase !== 'done';
  const iframeKey = `${previewUrl ?? ''}:${reloadKey}:${localReload}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-200 bg-white px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5">
          {PREVIEW_VIEWPORT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.title}
              onClick={() => setViewport(p.id)}
              className={`rounded-md px-2 py-0.5 text-xs ${
                viewport === p.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div ref={zoomMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setZoomMenuOpen((v) => !v)}
            aria-expanded={zoomMenuOpen}
            className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{zoom}%</span>
          </button>
          {zoomMenuOpen ? (
            <div role="menu" className="absolute left-0 top-full z-20 mt-1 w-24 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
              {ZOOM_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setZoom(level);
                    setZoomMenuOpen(false);
                  }}
                  className={`block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-zinc-100 ${
                    zoom === level ? 'font-semibold text-zinc-900' : 'text-zinc-600'
                  }`}
                >
                  {level}%
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex-1" />
        <span className="truncate text-xs text-zinc-400" title={file}>
          {artifact?.manifest.title || file}
        </span>
        <button type="button" onClick={refresh} title="刷新预览" className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100">
          ⟳
        </button>
        <button type="button" onClick={openInNewWindow} title="新窗口打开" className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100">
          ↗
        </button>
        <ExportMenu projectId={projectId} file={file} artifact={artifact} files={files} iframeRef={iframeRef} />
      </div>
      <div
        ref={canvasRef}
        className={`relative flex-1 overflow-auto ${viewport === 'desktop' ? 'bg-white' : 'bg-zinc-200'}`}
      >
        {stageVisible ? <GenerationStage model={generation} onRetry={onRetry} /> : null}
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">{error}</div>
        ) : previewUrl ? (
          viewport === 'desktop' ? (
            <div style={shellStyle}>
              <iframe
                key={iframeKey}
                ref={iframeRef}
                title={file}
                src={previewUrl}
                sandbox={sandbox}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          ) : (
            <div className="flex min-h-full justify-center" style={{ padding: CANVAS_PADDING / 2 }}>
              <div
                className="overflow-hidden rounded-xl shadow-lg ring-1 ring-zinc-300"
                style={{ width: preset.width! * scale, height: preset.height! * scale }}
              >
                <div style={shellStyle}>
                  <iframe
                    key={iframeKey}
                    ref={iframeRef}
                    title={file}
                    src={previewUrl}
                    sandbox={sandbox}
                    className="border-0 bg-white"
                    style={{ width: preset.width!, height: preset.height! }}
                  />
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">加载预览…</div>
        )}
      </div>
    </div>
  );
}
