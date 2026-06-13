import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { ProjectArtifact } from '../lib/artifacts';
import { reduceTweaksMessage } from '../lib/tweaks';
import {
  applyTextEdits,
  htmlScriptSources,
  planTextEdits,
  reduceTextEditMessage,
  resolveScriptPath,
  type ScriptFileContent,
  type TextEditCommit,
  type TextEditPlan,
} from '../lib/textEdit';
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MaximizeIcon,
  MinimizeIcon,
  MonitorIcon,
  PencilLineIcon,
  RefreshIcon,
  ShareIcon,
  SmartphoneIcon,
  TabletIcon,
  UndoIcon,
  type IconProps,
} from './icons';
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
  icon: (props: IconProps) => ReactElement;
};

const PREVIEW_VIEWPORT_PRESETS: PreviewViewportPreset[] = [
  { id: 'desktop', width: null, height: null, label: '桌面', title: '桌面(满幅)', icon: MonitorIcon },
  { id: 'tablet', width: 820, height: 1180, label: '平板', title: '平板 820×1180', icon: TabletIcon },
  { id: 'mobile', width: 390, height: 844, label: '手机', title: '手机 390×844', icon: SmartphoneIcon },
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
  // 可视化文案编辑（设计 docs/superpowers/specs/2026-06-11-visual-text-edit-design.md）：
  // 开关控制 iframe 内 bridge；提交经串行队列，先在 HTML 文本区域定位，未命中
  // 再降级到脚本源码（内联脚本 + 本地 <script src>，覆盖 JSX/Babel 渲染文本）；
  // 编辑期间冻结外部 reloadKey（保存自身触发的 SSE 重载会丢滚动位置），退出时
  // 再同步；撤销用提交前各受影响文件的快照组 + localReload 重载。
  const isHtmlFile = /\.html?$/i.test(file);
  const [textEditOn, setTextEditOn] = useState(false);
  const [textEditStatus, setTextEditStatus] = useState<{
    kind: 'idle' | 'saving' | 'saved' | 'error';
    message?: string;
  }>({ kind: 'idle' });
  const [undoCount, setUndoCount] = useState(0);
  const [frozenReloadKey, setFrozenReloadKey] = useState(reloadKey);
  const textEditOnRef = useRef(false);
  const undoStackRef = useRef<ScriptFileContent[][]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // 分享 popover：打开时现取一个不带 bridge 参数的干净预览链接。
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);
  // 全屏：预览区铺满整个浏览器窗口（fixed 覆盖层），Esc 退出。
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .previewUrl(projectId, file)
      .then((data) => {
        if (cancelled) return;
        setPreviewUrl(`${data.url}?bridge=${isHtmlFile ? 'snapshot,edit' : 'snapshot'}`);
        setSandbox(data.iframeSandbox);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, file, frozenReloadKey, localReload, isHtmlFile]);

  useEffect(() => {
    textEditOnRef.current = textEditOn;
  }, [textEditOn]);

  // 编辑模式下不透传外部 reloadKey（保存自身会触发 SSE 重载），退出时同步。
  useEffect(() => {
    if (!textEditOn) setFrozenReloadKey(reloadKey);
  }, [reloadKey, textEditOn]);

  // 切文件/项目退出编辑态并清撤销栈（快照只对当前文件有效）。
  useEffect(() => {
    setTextEditOn(false);
    setTextEditStatus({ kind: 'idle' });
    undoStackRef.current = [];
    setUndoCount(0);
  }, [projectId, file]);

  useEffect(() => {
    if (textEditStatus.kind !== 'saved') return;
    const timer = setTimeout(() => setTextEditStatus({ kind: 'idle' }), 2500);
    return () => clearTimeout(timer);
  }, [textEditStatus]);

  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!zoomMenuRef.current) return;
      if (!zoomMenuRef.current.contains(e.target as Node)) setZoomMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [zoomMenuOpen]);

  // 分享菜单点击外部关闭。
  useEffect(() => {
    if (!shareOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!shareMenuRef.current) return;
      if (!shareMenuRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [shareOpen]);

  const toggleShare = useCallback(() => {
    setShareOpen((prev) => {
      const next = !prev;
      if (next) {
        setShareCopied(false);
        setShareUrl(null);
        api
          .previewUrl(projectId, file)
          .then((data) => setShareUrl(new URL(data.url, window.location.origin).href))
          .catch(() => setShareUrl(null));
      }
      return next;
    });
  }, [projectId, file]);

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // 剪贴板权限被拒：降级用临时输入框。
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }, [shareUrl]);

  // 切文件退出全屏；全屏中 Esc 退出。
  useEffect(() => {
    setFullscreen(false);
  }, [projectId, file]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

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
  // 注意依赖 frozenReloadKey 而非 reloadKey：文案编辑冻结期间 iframe 并未重载。
  useEffect(() => {
    setTweaksAvailable(false);
    setTweaksOn(false);
  }, [previewUrl, frozenReloadKey, localReload]);

  const handleTextEditCommit = useCallback(
    (frame: Window, commit: TextEditCommit) => {
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        setTextEditStatus({ kind: 'saving' });
        try {
          const source = await api.readFile(projectId, file);
          // 带插桩 loc 的提交必须走完整规划（loc 优先于 HTML 同名文本，且可能
          // 指向外部脚本文件）；纯文本提交先试 HTML 文本区域的快路径。
          const hasLoc = commit.edits.some((e) => e.loc);
          const direct = hasLoc ? null : applyTextEdits(source, commit.edits);
          let scripts: ScriptFileContent[] = [];
          let plan: TextEditPlan;
          if (direct !== null) {
            plan = { ok: true, html: direct, files: [] };
          } else {
            // 拉取本地脚本源（内联脚本随 HTML 本体），定位脚本渲染文本。
            const paths = [
              ...new Set(
                htmlScriptSources(source)
                  .srcs.map((src) => resolveScriptPath(file, src))
                  .filter((p): p is string => p !== null),
              ),
            ];
            scripts = (
              await Promise.all(
                paths.map(async (path) => {
                  try {
                    return { path, content: await api.readFile(projectId, path) };
                  } catch {
                    return null;
                  }
                }),
              )
            ).filter((s): s is ScriptFileContent => s !== null);
            plan = planTextEdits(source, scripts, commit.edits);
          }
          if (!plan.ok) {
            frame.postMessage({ type: 'pi:edit:result', id: commit.id, ok: false }, '*');
            setTextEditStatus({
              kind: 'error',
              message:
                plan.reason === 'ambiguous'
                  ? '该文本在源码中出现多处，无法唯一定位'
                  : plan.reason === 'unsafe'
                    ? '新文本含可能破坏脚本语法的字符，未保存'
                    : '无法在源码中定位该文本（可能由脚本动态拼接）',
            });
            return;
          }
          const writes: ScriptFileContent[] = [
            ...(plan.html !== source ? [{ path: file, content: plan.html }] : []),
            ...plan.files,
          ];
          const snapshot = writes.map((w) => ({
            path: w.path,
            content: w.path === file ? source : (scripts.find((s) => s.path === w.path)?.content ?? ''),
          }));
          for (const w of writes) await api.putFile(projectId, w.path, w.content);
          undoStackRef.current.push(snapshot);
          if (undoStackRef.current.length > 50) undoStackRef.current.shift();
          setUndoCount(undoStackRef.current.length);
          frame.postMessage({ type: 'pi:edit:result', id: commit.id, ok: true }, '*');
          setTextEditStatus({ kind: 'saved' });
        } catch (err) {
          frame.postMessage({ type: 'pi:edit:result', id: commit.id, ok: false }, '*');
          setTextEditStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    },
    [projectId, file],
  );

  const undoTextEdit = useCallback(() => {
    const snapshot = undoStackRef.current.pop();
    if (snapshot === undefined) return;
    setUndoCount(undoStackRef.current.length);
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      setTextEditStatus({ kind: 'saving' });
      try {
        for (const f of snapshot) await api.putFile(projectId, f.path, f.content);
        setTextEditStatus({ kind: 'saved' });
        setLocalReload((v) => v + 1);
      } catch (err) {
        setTextEditStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
  }, [projectId]);

  const toggleTextEdit = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    setTextEditOn((prev) => {
      const next = !prev;
      frame.postMessage({ type: next ? 'pi:edit:activate' : 'pi:edit:deactivate' }, '*');
      return next;
    });
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!ev.data || ev.source !== iframeRef.current?.contentWindow) return;
      const editAction = reduceTextEditMessage(ev.data);
      if (editAction) {
        // iframe（重新）加载后 bridge 就绪：编辑开关仍开则重新激活。
        if (editAction.ready && textEditOnRef.current) {
          (ev.source as Window).postMessage({ type: 'pi:edit:activate' }, '*');
        }
        if (editAction.commit) handleTextEditCommit(ev.source as Window, editAction.commit);
        return;
      }
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
  }, [handleTextEditCommit]);

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
  const iframeKey = `${previewUrl ?? ''}:${frozenReloadKey}:${localReload}`;

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-white' : 'flex h-full flex-col'}>
      <div className="flex items-center gap-1 border-b border-zinc-200 bg-white px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5">
          {PREVIEW_VIEWPORT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.title}
              aria-label={p.label}
              onClick={() => setViewport(p.id)}
              className={`rounded-md px-2 py-1 ${
                viewport === p.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              <p.icon size={14} />
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
        {textEditStatus.kind !== 'idle' ? (
          <span
            className={`max-w-40 truncate text-xs ${
              textEditStatus.kind === 'error' ? 'text-red-500' : 'text-zinc-400'
            }`}
            title={textEditStatus.message}
          >
            {textEditStatus.kind === 'saving'
              ? '保存中…'
              : textEditStatus.kind === 'saved'
                ? '已保存'
                : textEditStatus.message ?? '保存失败'}
          </span>
        ) : null}
        {textEditOn && undoCount > 0 ? (
          <button
            type="button"
            onClick={undoTextEdit}
            title="撤销上一次文案修改"
            className="rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100"
            aria-label="撤销"
          >
            <UndoIcon size={14} />
          </button>
        ) : null}
        {isHtmlFile ? (
          <button
            type="button"
            onClick={toggleTextEdit}
            title="可视化编辑文案"
            aria-label="可视化编辑文案"
            aria-pressed={textEditOn}
            className={`rounded-md px-2 py-1 ${
              textEditOn ? 'bg-blue-600 text-white' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <PencilLineIcon size={14} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={refresh}
          title="刷新预览"
          aria-label="刷新预览"
          className="rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100"
        >
          <RefreshIcon size={14} />
        </button>
        <button
          type="button"
          onClick={openInNewWindow}
          title="新窗口打开"
          aria-label="新窗口打开"
          className="rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100"
        >
          <ExternalLinkIcon size={14} />
        </button>
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? '退出全屏 (Esc)' : '全屏预览'}
          aria-label={fullscreen ? '退出全屏' : '全屏预览'}
          aria-pressed={fullscreen}
          className={`rounded-md px-2 py-1 ${
            fullscreen ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          {fullscreen ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>
        <div ref={shareMenuRef} className="relative">
          <button
            type="button"
            onClick={toggleShare}
            title="分享预览链接"
            aria-expanded={shareOpen}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            <ShareIcon size={13} />
            分享
          </button>
          {shareOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
              <p className="text-xs font-medium text-zinc-700">分享预览</p>
              <p className="mt-1 text-[11px] text-zinc-400">同一网络内打开此链接即可直接预览当前页面。</p>
              {shareUrl ? (
                <>
                  <div className="mt-2 truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-500" title={shareUrl}>
                    {shareUrl}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void copyShareUrl()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-zinc-900 px-2 py-1.5 text-xs text-white hover:bg-zinc-700"
                    >
                      {shareCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                      {shareCopied ? '已复制' : '复制链接'}
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-zinc-300 px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                    >
                      <ExternalLinkIcon size={12} />
                      打开预览
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-zinc-400">生成链接中…</p>
              )}
            </div>
          ) : null}
        </div>
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
