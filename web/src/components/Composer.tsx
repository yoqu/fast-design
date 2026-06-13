import { useCallback, useEffect, useRef, useState } from 'react';
import { api, piApi } from '../lib/api';
import type { ChatAttachment, PiModel, SkillInfo, SkillRef } from '../lib/types';
import { applyMention, filterMentionFiles, getMentionContext, type MentionContext } from '../lib/mention';
import { CheckIcon, ChevronDownIcon, FileIcon, LoaderIcon, PaperclipIcon, PlusIcon, SparklesIcon, XIcon } from './icons';

/** 一次性预填内容（pendingPrompt + 快速简报里上传的附件）。 */
export type ComposerSeed = {
  text: string;
  /** 已上传到项目目录的附件，直接以就绪 chip 预填。 */
  attachments?: ChatAttachment[];
};

type Props = {
  projectId: string;
  busy: boolean;
  /** 一次性预填内容；变为非空时填入输入框并聚焦。 */
  seed?: ComposerSeed | null;
  /** 可切换的模型列表（菜单展示 provider/id）。 */
  models: PiModel[];
  /** 当前会话的模型覆盖；null = 跟随项目设置。 */
  model: string | null;
  /** 项目设置里的默认模型，用于「跟随项目设置」项的副标题。 */
  projectModel: string | null;
  /** 切换会话模型（null = 恢复跟随项目设置）；回合进行中按钮禁用。 */
  onModelChange: (model: string | null) => void;
  onSend: (message: string, attachments: ChatAttachment[], skills: SkillRef[]) => void;
  onStop: () => void;
};

/** 输入框里待发送的附件（上传中/已就绪/失败）。 */
type PendingAttachment = {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
  /** 上传成功后的项目内相对路径。 */
  path?: string;
  /** 图片的本地预览 URL（objectURL，移除/发送后 revoke）。 */
  previewUrl?: string;
};

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 菜单/按钮上的模型短名：取 provider/id 中的 id 段。 */
function modelShortName(model: string): string {
  const slash = model.indexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

export default function Composer({ projectId, busy, seed, models, model, projectModel, onModelChange, onSend, onStop }: Props) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mention, setMention] = useState<MentionContext | null>(null);
  const [mentionItems, setMentionItems] = useState<string[]>([]);
  const [mentionActive, setMentionActive] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillList, setSkillList] = useState<SkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<SkillRef[]>([]);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const skillsLoaded = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // @ 弹层打开期间的项目文件全集；打开时拉取一次。
  const mentionFiles = useRef<string[]>([]);
  // setValue 后需要恢复的光标位置（@ 选中回写时用）。
  const pendingCaret = useRef<number | null>(null);
  // Esc 关闭后，同一个 @（按 start 定位）不再重新弹出。
  const dismissedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!seed) return;
    setValue(seed.text);
    if (seed.attachments?.length) {
      // 简报附件已在项目目录里，直接挂为就绪 chip；图片用服务端 URL 预览。
      setAttachments(
        seed.attachments.map((a) => ({
          key: a.path,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          status: 'ready',
          path: a.path,
          previewUrl: a.mimeType.startsWith('image/') ? api.fileUrl(projectId, a.path) : undefined,
        })),
      );
    }
    textareaRef.current?.focus();
  }, [seed, projectId]);

  useEffect(() => {
    if (pendingCaret.current === null) return;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(caret, caret);
    }
  }, [value]);

  // ---- 模型切换 ----

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [modelMenuOpen]);

  const pickModel = useCallback(
    (next: string | null) => {
      setModelMenuOpen(false);
      if (next !== model) onModelChange(next);
    },
    [model, onModelChange],
  );

  // ---- + 菜单 / Skill 引用 ----

  useEffect(() => {
    if (!plusMenuOpen && !skillPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!plusMenuRef.current?.contains(e.target as Node)) {
        setPlusMenuOpen(false);
        setSkillPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [plusMenuOpen, skillPickerOpen]);

  const openSkillPicker = useCallback(() => {
    setPlusMenuOpen(false);
    setSkillPickerOpen(true);
    if (!skillsLoaded.current) {
      skillsLoaded.current = true;
      piApi.skills(projectId).then(setSkillList).catch(() => setSkillList([]));
    }
  }, [projectId]);

  const toggleSkill = useCallback((s: SkillInfo) => {
    setSelectedSkills((prev) => {
      const exists = prev.some((p) => p.scope === s.scope && p.rel === s.rel);
      return exists
        ? prev.filter((p) => !(p.scope === s.scope && p.rel === s.rel))
        : [...prev, { scope: s.scope, rel: s.rel, name: s.name }];
    });
  }, []);

  // ---- @ 提及 ----

  const closeMention = useCallback(() => {
    setMention(null);
    setMentionItems([]);
    setMentionActive(0);
  }, []);

  /** 根据当前文本与光标刷新 @ 弹层状态（onChange/光标移动后调用）。 */
  const refreshMention = useCallback(
    (text: string, caret: number) => {
      const ctx = getMentionContext(text, caret);
      if (!ctx || dismissedAt.current === ctx.start) {
        if (!ctx) dismissedAt.current = null;
        closeMention();
        return;
      }
      setMention((prev) => {
        if (!prev || prev.start !== ctx.start) {
          // 弹层新开：拉一次项目文件列表
          api
            .files(projectId)
            .then((files) => {
              mentionFiles.current = files.map((f) => f.path);
              setMentionItems(filterMentionFiles(mentionFiles.current, ctx.query));
            })
            .catch(() => setMentionItems([]));
        } else {
          setMentionItems(filterMentionFiles(mentionFiles.current, ctx.query));
        }
        return ctx;
      });
      setMentionActive(0);
    },
    [projectId, closeMention],
  );

  const pickMention = useCallback(
    (path: string) => {
      const el = textareaRef.current;
      if (!el || !mention) return;
      const result = applyMention(value, mention, el.selectionStart, path);
      pendingCaret.current = result.caret;
      setValue(result.text);
      closeMention();
    },
    [value, mention, closeMention],
  );

  // ---- 附件 ----

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      for (const file of files) {
        const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const isImage = file.type.startsWith('image/');
        const entry: PendingAttachment = {
          key,
          name: file.name || (isImage ? '粘贴的图片.png' : '附件'),
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          status: 'uploading',
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        };
        setAttachments((prev) => [...prev, entry]);
        api
          .uploadAttachment(projectId, file)
          .then((uploaded) =>
            setAttachments((prev) =>
              prev.map((a) => (a.key === key ? { ...a, status: 'ready', path: uploaded.path, name: uploaded.name } : a)),
            ),
          )
          .catch(() =>
            setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, status: 'error' } : a))),
          );
      }
    },
    [projectId],
  );

  const removeAttachment = useCallback(
    (key: string) => {
      setAttachments((prev) => {
        const target = prev.find((a) => a.key === key);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        if (target?.status === 'ready' && target.path) void api.deleteFile(projectId, target.path).catch(() => {});
        return prev.filter((a) => a.key !== key);
      });
    },
    [projectId],
  );

  const uploading = attachments.some((a) => a.status === 'uploading');
  const readyAttachments = attachments.filter(
    (a): a is PendingAttachment & { path: string } => a.status === 'ready' && !!a.path,
  );
  const canSend = !busy && !uploading && (!!value.trim() || readyAttachments.length > 0);

  const send = () => {
    if (!canSend) return;
    const message = value.trim();
    const sent: ChatAttachment[] = readyAttachments.map((a) => ({
      name: a.name,
      path: a.path,
      mimeType: a.mimeType,
      size: a.size,
    }));
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setValue('');
    setAttachments([]);
    closeMention();
    const sentSkills = selectedSkills;
    setSelectedSkills([]);
    onSend(message, sent, sentSkills);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (mention && mentionItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActive((i) => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActive((i) => (i - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(mentionItems[mentionActive]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissedAt.current = mention.start;
        closeMention();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t border-zinc-200 p-3">
      <div
        className={`relative rounded-xl border bg-white p-2 focus-within:border-zinc-500 ${
          dragOver ? 'border-zinc-500 bg-zinc-50' : 'border-zinc-300'
        }`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
      >
        {mention && mentionItems.length > 0 && (
          <div className="absolute bottom-full left-0 z-20 mb-1.5 max-h-64 w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
            {mentionItems.map((path, i) => {
              const slash = path.lastIndexOf('/');
              const base = path.slice(slash + 1);
              const dir = slash >= 0 ? path.slice(0, slash) : '';
              return (
                <button
                  key={path}
                  type="button"
                  // textarea 失焦前完成选择（onMouseDown 早于 blur）
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(path);
                  }}
                  onMouseEnter={() => setMentionActive(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    i === mentionActive ? 'bg-zinc-100' : ''
                  }`}
                >
                  <FileIcon size={14} className="shrink-0 text-zinc-400" />
                  <span className="truncate text-zinc-800">{base}</span>
                  {dir && <span className="ml-auto shrink-0 truncate text-xs text-zinc-400">{dir}</span>}
                </button>
              );
            })}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
            {attachments.map((a) => (
              <div
                key={a.key}
                className={`group relative flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
                  a.status === 'error' ? 'border-red-200 bg-red-50 text-red-600' : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                }`}
              >
                {a.previewUrl ? (
                  <img src={a.previewUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
                ) : (
                  <FileIcon size={16} className="shrink-0 text-zinc-400" />
                )}
                <div className="min-w-0">
                  <div className="max-w-36 truncate font-medium">{a.name}</div>
                  <div className="text-[11px] text-zinc-400">
                    {a.status === 'uploading' ? '上传中…' : a.status === 'error' ? '上传失败' : formatSize(a.size)}
                  </div>
                </div>
                {a.status === 'uploading' ? (
                  <LoaderIcon size={13} className="animate-spin text-zinc-400" />
                ) : (
                  <button
                    type="button"
                    title="移除附件"
                    aria-label={`移除附件 ${a.name}`}
                    onClick={() => removeAttachment(a.key)}
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
                  >
                    <XIcon size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {selectedSkills.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {selectedSkills.map((s) => (
              <span
                key={`${s.scope}:${s.rel}`}
                className="group flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-700"
              >
                <SparklesIcon size={13} className="shrink-0 text-violet-400" />
                <span className="max-w-36 truncate font-medium">{s.name}</span>
                <button
                  type="button"
                  title="移除 skill"
                  aria-label={`移除 skill ${s.name}`}
                  onClick={() => setSelectedSkills((prev) => prev.filter((p) => !(p.scope === s.scope && p.rel === s.rel)))}
                  className="rounded p-0.5 text-violet-400 hover:bg-violet-200 hover:text-violet-700"
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              refreshMention(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onClick={(e) => refreshMention(value, e.currentTarget.selectionStart)}
            onKeyUp={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                refreshMention(value, e.currentTarget.selectionStart);
              }
            }}
            onBlur={() => {
              // 延迟关闭，给弹层的 onMouseDown 留出执行机会
              setTimeout(closeMention, 120);
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.items)
                .filter((item) => item.kind === 'file')
                .map((item) => item.getAsFile())
                .filter((f): f is File => !!f);
              if (files.length > 0) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            rows={Math.min(12, Math.max(3, value.split('\n').length))}
            placeholder="描述你想开发的页面…（@ 引用文件，Enter 发送，Shift+Enter 换行）"
            className="max-h-72 w-full resize-none bg-transparent px-1.5 py-1 text-sm outline-none"
          />
          {/* 底部工具栏：+ 菜单 / 模型在左，发送在右 */}
          <div className="flex items-center gap-1">
            <div className="relative" ref={plusMenuRef}>
              <button
                type="button"
                title="添加内容"
                aria-label="添加内容"
                aria-haspopup="menu"
                aria-expanded={plusMenuOpen || skillPickerOpen}
                onClick={() => {
                  setSkillPickerOpen(false);
                  setPlusMenuOpen((v) => !v);
                }}
                className={`rounded-lg p-2 ${
                  plusMenuOpen || skillPickerOpen ? 'bg-zinc-100 text-zinc-700' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
                }`}
              >
                <PlusIcon size={16} />
              </button>
              {plusMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-20 mb-1.5 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <PaperclipIcon size={15} className="shrink-0 text-zinc-400" />
                    添加附件
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openSkillPicker}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <SparklesIcon size={15} className="shrink-0 text-zinc-400" />
                    引用 Skill
                  </button>
                </div>
              )}
              {skillPickerOpen && (
                <div className="absolute bottom-full left-0 z-20 mb-1.5 flex max-h-80 w-80 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
                  <div className="border-b border-zinc-100 p-2">
                    <input
                      autoFocus
                      value={skillQuery}
                      onChange={(e) => setSkillQuery(e.target.value)}
                      placeholder="搜索 skill…"
                      className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto py-1">
                    {(() => {
                      const q = skillQuery.trim().toLowerCase();
                      const list = q
                        ? skillList.filter(
                            (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
                          )
                        : skillList;
                      const scopeLabel: Record<string, string> = { bundled: '内置设计', project: '项目', global: '全局' };
                      if (list.length === 0) {
                        return <p className="px-3 py-4 text-center text-xs text-zinc-400">无匹配 skill</p>;
                      }
                      return list.map((s) => {
                        const checked = selectedSkills.some((p) => p.scope === s.scope && p.rel === s.rel);
                        return (
                          <button
                            key={`${s.scope}:${s.rel}`}
                            type="button"
                            onClick={() => toggleSkill(s)}
                            className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-zinc-50"
                          >
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                              {checked && <CheckIcon size={13} className="text-violet-600" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-sm text-zinc-800">{s.name}</span>
                                <span className="shrink-0 rounded bg-zinc-100 px-1 text-[10px] text-zinc-400">
                                  {scopeLabel[s.scope] ?? s.scope}
                                </span>
                              </span>
                              <span className="block truncate text-[11px] text-zinc-400">{s.description}</span>
                            </span>
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
            <div className="relative" ref={modelMenuRef}>
              <button
                type="button"
                title={model ? `模型：${model}（仅当前会话）` : `模型：跟随项目设置${projectModel ? `（${projectModel}）` : ''}`}
                aria-label="切换模型"
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                disabled={busy}
                onClick={() => setModelMenuOpen((v) => !v)}
                className={`flex max-w-36 items-center gap-1 rounded-lg px-2 py-2 text-xs disabled:opacity-40 ${
                  modelMenuOpen ? 'bg-zinc-100 text-zinc-700' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
                }`}
              >
                <span className="truncate">
                  {model ? modelShortName(model) : projectModel ? modelShortName(projectModel) : '全局默认'}
                </span>
                {!model && projectModel && <span className="shrink-0 text-[10px] text-zinc-300">跟随</span>}
                <ChevronDownIcon size={12} className="shrink-0" />
              </button>
              {modelMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-20 mb-1.5 max-h-72 w-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={model === null}
                    onClick={() => pickModel(null)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-zinc-800">跟随项目设置</div>
                      <div className="truncate text-[10px] text-zinc-400">{projectModel ?? '全局默认'}</div>
                    </div>
                    {model === null && <CheckIcon size={13} className="shrink-0 text-zinc-600" />}
                  </button>
                  {models.length > 0 && <div className="my-1 border-t border-zinc-100" />}
                  {models.map((m) => {
                    const id = `${m.provider}/${m.id}`;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={model === id}
                        onClick={() => pickModel(id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-zinc-800">{m.id}</div>
                          <div className="truncate text-[10px] text-zinc-400">{m.provider}</div>
                        </div>
                        {model === id && <CheckIcon size={13} className="shrink-0 text-zinc-600" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex-1" />
            {busy ? (
              <button
                onClick={onStop}
                className="rounded-lg bg-red-500 px-3.5 py-1.5 text-sm text-white hover:bg-red-600"
              >
                停止
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!canSend}
                className="rounded-lg bg-zinc-800 px-3.5 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-40"
              >
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
