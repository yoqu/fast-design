import { useEffect, useRef, useState } from 'react';
import type { ConversationSummary } from '../lib/types';
import { PlusIcon, XIcon } from './icons';

type Props = {
  conversations: ConversationSummary[];
  activeId: string;
  onSelect: (cid: string) => void;
  onCreate: () => void;
  onRename: (cid: string, title: string) => void;
  onDelete: (cid: string) => void;
};

/**
 * 对话历史菜单,对齐参照 ConversationsMenu.tsx:pill(当前标题+计数)+
 * 下拉(New/列表最近优先/双击重命名/✕删除确认/当前高亮/空状态)。
 */
export default function ConversationsMenu({ conversations, activeId, onSelect, onCreate, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const clickGuardRef = useRef<'dbl' | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const current = conversations.find((c) => c.id === activeId);

  const commitRename = (cid: string) => {
    if (editingId !== cid) return; // unmount 后的 blur 双发防护
    setEditingId(null);
    const title = draft.trim();
    setDraft('');
    if (title) onRename(cid, title);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={`flex max-w-56 items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
          open ? 'border-zinc-400 bg-zinc-100' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
        }`}
      >
        <span className="truncate">{current?.title ?? '对话'}</span>
        <span className="shrink-0 rounded-full bg-zinc-200 px-1.5 text-[10px] text-zinc-600">{conversations.length}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-medium text-zinc-500">对话</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100"
            >
              <PlusIcon size={12} />
              新建
            </button>
          </div>
          {conversations.length === 0 && <p className="px-2 py-3 text-center text-xs text-zinc-400">还没有对话</p>}
          {sorted.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                c.id === activeId ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(c.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5"
                />
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={(e) => {
                    if (e.detail !== 1) return; // 双击的第二次 click 交给 onDoubleClick
                    // 延迟到双击窗口结束再执行选择,避免卸载菜单使 dblclick 失效。
                    const cid = c.id;
                    window.setTimeout(() => {
                      if (clickGuardRef.current === 'dbl') {
                        clickGuardRef.current = null;
                        return;
                      }
                      setOpen(false);
                      if (cid !== activeId) onSelect(cid);
                    }, 250);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    clickGuardRef.current = 'dbl';
                    setDraft(c.title ?? '');
                    setEditingId(c.id);
                  }}
                >
                  <span className="block truncate">{c.title ?? '未命名对话'}</span>
                  <span className="text-[10px] text-zinc-400">{c.messageCount} 条消息</span>
                </button>
              )}
              <button
                type="button"
                aria-label="删除对话"
                className="rounded px-1 text-zinc-300 opacity-0 hover:bg-zinc-200 hover:text-red-500 group-hover:opacity-100"
                onClick={() => {
                  if (confirm(`删除对话「${c.title ?? '未命名对话'}」？此操作不可恢复。`)) {
                    setOpen(false);
                    onDelete(c.id);
                  }
                }}
              >
                <XIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
