import { useCallback, useEffect, useState } from 'react';
import { piApi } from '../../lib/api';
import type { SkillInfo } from '../../lib/types';

type Props = { projectId: string | null };

type EditorState = { skill: SkillInfo; content: string } | null;

export default function SkillsSection({ projectId }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSkills(await piApi.skills(projectId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (s: SkillInfo) => {
    try {
      await piApi.toggleSkill(s.scope, s.rel, !s.enabled, projectId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const openEditor = async (s: SkillInfo) => {
    try {
      setEditor({ skill: s, content: await piApi.skillContent(s.scope, s.rel, projectId) });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    }
  };

  const saveEditor = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await piApi.saveSkillContent(editor.skill.scope, editor.skill.rel, editor.content, projectId);
      setEditor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const skill = await piApi.createSkill(name, newDesc.trim());
      setCreating(false);
      setNewName('');
      setNewDesc('');
      await load();
      await openEditor(skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  const remove = async (s: SkillInfo) => {
    if (!confirm(`删除技能「${s.name}」？此操作不可恢复。`)) return;
    try {
      await piApi.deleteSkill(s.scope, s.rel, projectId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (editor) {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">编辑 {editor.skill.name}</h3>
          <div className="flex gap-2">
            <button onClick={() => void saveEditor()} disabled={saving}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50">
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={() => setEditor(null)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">
              返回
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <textarea
          value={editor.content}
          onChange={(e) => setEditor({ ...editor, content: e.target.value })}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-300 p-3 font-mono text-xs outline-none focus:border-zinc-500"
        />
        <p className="text-xs text-zinc-400">SKILL.md 必须以 frontmatter 开头并包含 name 与 description。</p>
      </div>
    );
  }

  const groups: Array<{ title: string; scope: 'global' | 'project' }> = [
    { title: '全局技能（~/.pi/agent/skills）', scope: 'global' },
    ...(projectId ? [{ title: '项目技能（.pi/skills）', scope: 'project' as const }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">Skills</h3>
        {!creating && (
          <button onClick={() => setCreating(true)} className="text-xs text-zinc-500 hover:text-zinc-800">＋ 新建技能</button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {creating && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 p-3">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="技能名（kebab-case）"
            className="w-44 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500" />
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="一句话描述"
            className="flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-500" />
          <button onClick={() => void create()} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">创建</button>
          <button onClick={() => setCreating(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">取消</button>
        </div>
      )}
      {groups.map((g) => {
        const list = skills.filter((s) => s.scope === g.scope);
        return (
          <section key={g.scope}>
            <h4 className="mb-1 text-xs font-medium text-zinc-500">{g.title}</h4>
            {list.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400">暂无技能</p>
            ) : (
              <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {list.map((s) => (
                  <div key={`${s.scope}:${s.rel}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <button
                      role="switch"
                      aria-checked={s.enabled}
                      onClick={() => void toggle(s)}
                      className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${s.enabled ? 'bg-emerald-500' : 'bg-zinc-300'}`}
                      title={s.enabled ? '点击禁用' : '点击启用'}
                    >
                      <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${s.enabled ? 'translate-x-4' : ''}`} />
                    </button>
                    <span className="w-44 truncate font-medium text-zinc-800">{s.name}</span>
                    <span className="flex-1 truncate text-xs text-zinc-400" title={s.description}>{s.description}</span>
                    <button onClick={() => void openEditor(s)} className="text-xs text-zinc-500 hover:text-zinc-800">编辑</button>
                    <button onClick={() => void remove(s)} className="text-xs text-zinc-400 hover:text-red-500">删除</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <p className="text-xs text-zinc-400">启用/禁用写入 pi 的 settings.json，对新启动的会话生效。</p>
    </div>
  );
}
