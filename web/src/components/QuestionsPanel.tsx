// web/src/components/QuestionsPanel.tsx
import { useEffect, useState } from 'react';
import type { FormQuestion, QuestionForm } from '../lib/questionForm';

type Props = {
  form: QuestionForm;
  /** 把答案组合为一条消息发送到对话。 */
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

type Answers = Record<string, string | string[]>;

function answerText(q: FormQuestion, value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  const text = (Array.isArray(value) ? value.join('、') : value).trim();
  if (!text) return null;
  return `**${q.label}**:${text}`;
}

/** Questions 面板,对齐参照 QuestionsPanel(题型裁剪到 5 种基础类型)。 */
export default function QuestionsPanel({ form, onSubmit, disabled }: Props) {
  const [answers, setAnswers] = useState<Answers>({});

  // 新表单到来(对象引用变化,form.id 可能为 null 不可依赖)时清空旧答案。
  useEffect(() => {
    setAnswers({});
  }, [form]);

  const set = (id: string, value: string | string[]) => setAnswers((prev) => ({ ...prev, [id]: value }));

  const missingRequired = form.questions.some(
    (q) => q.required && !answerText(q, answers[q.id]),
  );

  const submit = () => {
    const lines = form.questions
      .map((q) => answerText(q, answers[q.id]))
      .filter((l): l is string => l !== null);
    if (lines.length === 0) return;
    onSubmit(lines.join('\n'));
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <h2 className="text-sm font-semibold text-zinc-800">{form.title ?? '请确认几个问题'}</h2>
      <div className="mt-4 space-y-5">
        {form.questions.map((q) => (
          <fieldset key={q.id}>
            <legend className="text-xs font-medium text-zinc-700">
              {q.label}
              {q.required && <span className="ml-0.5 text-red-500">*</span>}
            </legend>
            {q.help && <p className="mt-0.5 text-[10px] text-zinc-400">{q.help}</p>}
            <div className="mt-1.5">
              {(q.type === 'radio' || q.type === 'checkbox') && (
                <div className="flex flex-wrap gap-1.5">
                  {(q.options ?? []).map((o) => {
                    const cur = answers[q.id];
                    const checked =
                      q.type === 'radio' ? cur === o.value : Array.isArray(cur) && cur.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        title={o.description}
                        onClick={() => {
                          if (q.type === 'radio') set(q.id, o.value);
                          else {
                            const list = Array.isArray(cur) ? cur : [];
                            set(q.id, checked ? list.filter((v) => v !== o.value) : [...list, o.value]);
                          }
                        }}
                        className={`rounded-full border px-3 py-1 text-xs ${
                          checked ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {q.type === 'select' && (
                <select
                  value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                  onChange={(e) => set(q.id, e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
                >
                  <option value="">请选择…</option>
                  {(q.options ?? []).map((o) => (
                    <option key={o.value} value={o.value} title={o.description}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {q.type === 'text' && (
                <input
                  value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                  onChange={(e) => set(q.id, e.target.value)}
                  placeholder={q.placeholder}
                  className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400"
                />
              )}
              {q.type === 'textarea' && (
                <textarea
                  value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                  onChange={(e) => set(q.id, e.target.value)}
                  placeholder={q.placeholder}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400"
                />
              )}
            </div>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || missingRequired}
        onClick={submit}
        className="mt-6 rounded-lg bg-zinc-900 px-4 py-1.5 text-xs text-white disabled:opacity-40"
      >
        提交回答
      </button>
    </div>
  );
}
