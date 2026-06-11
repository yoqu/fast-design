import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectArtifact } from '../lib/artifacts';
import { reduceTweaksMessage } from '../lib/tweaks';
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
  const [sandbox, setSandbox] = useState('allow-scripts allow-downloads');
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<PreviewViewportId>('desktop');
  const [zoom, setZoom] = useState(100);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [localReload, setLocalReload] = useState(0);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  // Tweaks 宿主协议 Protocol A（参照 design-templates/tweaks/SKILL.md:145-185）：
  // artifact 挂载时向 parent 发 __edit_mode_available（缺省 visible 视为 true），
  // 宿主工具栏据此启用 Tweaks 开关；点击向 iframe 发 __activate/__deactivate_edit_mode；
  // artifact 本地关闭（×/Esc）会发 __edit_mode_dismissed，开关回拨为关。
  const [tweaksAvailable, setTweaksAvailable] = useState(false);
  const [tweaksOn, setTweaksOn] = useState(false);
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

  // 预览文档更换（含刷新）后重置 Tweaks 可用性，等 artifact 重新上报。
  useEffect(() => {
    setTweaksAvailable(false);
    setTweaksOn(false);
  }, [previewUrl, reloadKey, localReload]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!ev.data || ev.source !== iframeRef.current?.contentWindow) return;
      const action = reduceTweaksMessage(ev.data);
      if (!action) return;
      if (action.available !== undefined) setTweaksAvailable(action.available);
      if (action.on !== undefined) setTweaksOn(action.on);
      // 默认开启时回送激活指令，强制 iframe 面板与工具栏开关一致展开，
      // 避免开关显「开」却没面板、需双击才唤起的错位。
      if (action.command) (ev.source as Window).postMessage({ type: action.command }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const toggleTweaks = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    setTweaksOn((prev) => {
      const next = !prev;
      frame.postMessage({ type: next ? '__activate_edit_mode' : '__deactivate_edit_mode' }, '*');
      return next;
    });
  }, []);

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

  // 对齐参照 generation-preview.ts:161-170：FileViewer 打开即存在可预览面
  // （hasPreviewSurface），此时生成中/停止/等待输入一律不遮罩，预览保持可
  // 交互；仅明确失败时显示错误舞台。首次生成（无 tab）的完整舞台由
  // Workspace 空态承担。
  const stageVisible = generation.phase === 'failed';
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
        {tweaksAvailable ? (
          <button
            type="button"
            onClick={toggleTweaks}
            title="Tweaks 面板"
            aria-pressed={tweaksOn}
            className={`rounded-md px-2 py-1 text-xs ${
              tweaksOn ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            Tweaks
          </button>
        ) : null}
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
