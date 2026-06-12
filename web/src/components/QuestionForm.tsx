// 表单视图 — 对齐参照 apps/web/src/components/QuestionForm.tsx：
// 全题型渲染（含 direction-cards 富卡片）、required/maxSelections 门控、
// 已提交锁定态、skipAll、formatFormAnswers 序列化与 parseSubmittedAnswers
// 反向解析。样式按本项目 Tailwind 习惯改写，行为一致（文案中文）。
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { DirectionCard, FormOption, QuestionForm } from '../lib/questionForm';
import { formatFormAnswers, formOptionValueForLabel } from '../lib/questionForm';

interface Props {
  form: QuestionForm;
  // Whether the user can still submit answers (the active, unanswered form).
  interactive: boolean;
  // Pre-existing answers — when we detect a follow-up user message that
  // begins with "[form answers — <id>]", we parse it back out and pass it
  // here so the rendered form reflects what was sent.
  submittedAnswers?: Record<string, string | string[]>;
  // When the form lives in the Questions tab the Continue button owns the
  // submit, so hide the form's own footer button and report ready-state out.
  hideInternalSubmit?: boolean;
  onReadyChange?: (ready: boolean) => void;
  onSubmit?: (text: string, answers: Record<string, string | string[]>) => void;
}

// Lets a parent (the Questions tab Continue button) trigger submission.
export interface QuestionFormHandle {
  submit: () => void;
  // Submit with no answers — backs the "skip all" affordance. Every question
  // is optional, so this just records each as "(skipped)" and moves on.
  skipAll: () => void;
}

export const QuestionFormView = forwardRef<QuestionFormHandle, Props>(function QuestionFormView(
  { form, interactive, submittedAnswers, hideInternalSubmit = false, onReadyChange, onSubmit },
  ref,
) {
  const initial = useMemo(() => buildInitialState(form, submittedAnswers), [form, submittedAnswers]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(initial);
  const locked = !interactive || !onSubmit || submittedAnswers !== undefined;
  const currentAnswers = submittedAnswers ?? answers;

  // When the form streams in question-by-question, backfill state for newly
  // revealed questions without disturbing answers the user already touched.
  useEffect(() => {
    setAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const q of form.questions) {
        if (next[q.id] !== undefined) continue;
        changed = true;
        if (submittedAnswers && submittedAnswers[q.id] !== undefined) {
          next[q.id] = canonicalizeQuestionValue(q, submittedAnswers[q.id]!);
        } else if (q.defaultValue !== undefined) {
          next[q.id] = canonicalizeQuestionValue(q, q.defaultValue);
        } else {
          next[q.id] = q.type === 'checkbox' ? [] : '';
        }
      }
      return changed ? next : prev;
    });
  }, [form, submittedAnswers]);

  function update(id: string, value: string | string[]) {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleCheckbox(id: string, option: string, maxSelections?: number) {
    if (locked) return;
    setAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      const has = current.includes(option);
      if (!has && maxSelections !== undefined && current.length >= maxSelections) {
        return prev;
      }
      const next = has ? current.filter((v) => v !== option) : [...current, option];
      return { ...prev, [id]: next };
    });
  }

  function handleSubmit() {
    if (locked || !onSubmit) return;
    // Block submit until required fields are answered and selection caps hold.
    // skipAll() is the only path that intentionally bypasses this.
    if (!ready) return;
    onSubmit(formatFormAnswers(form, answers), answers);
  }

  function handleSkipAll() {
    if (locked || !onSubmit) return;
    const empty: Record<string, string | string[]> = {};
    onSubmit(formatFormAnswers(form, empty), empty);
  }

  // Per-question checkbox selection caps must hold.
  const withinSelectionLimits = form.questions.every((q) => {
    if (q.type !== 'checkbox' || q.maxSelections === undefined) return true;
    const v = currentAnswers[q.id];
    return !Array.isArray(v) || v.length <= q.maxSelections;
  });
  // Required questions must carry a non-empty answer. This gates the standard
  // submit button AND the Questions-tab Continue CTA — only skipAll() bypasses
  // it on purpose.
  const requiredAnswered = form.questions.every((q) => {
    if (q.required !== true) return true;
    const v = currentAnswers[q.id];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.trim().length > 0;
  });
  const ready = withinSelectionLimits && requiredAnswered;

  useImperativeHandle(ref, () => ({ submit: handleSubmit, skipAll: handleSkipAll }));
  useEffect(() => {
    onReadyChange?.(!locked && ready);
  }, [onReadyChange, locked, ready]);

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${locked ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-200 bg-white'}`}
      data-form-id={form.id}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white"
        >
          ?
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-zinc-800">{form.title}</div>
          {form.description ? (
            <div className="mt-0.5 text-xs text-zinc-500">{form.description}</div>
          ) : null}
        </div>
        {locked ? (
          <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] text-zinc-600">已回答</span>
        ) : null}
      </div>
      <div className="mt-3 space-y-4">
        {form.questions.map((q) => {
          const value = currentAnswers[q.id];
          return (
            <div key={q.id}>
              <label className="text-xs font-medium text-zinc-700">
                <span>{q.label}</span>
                {q.required ? <span className="ml-0.5 text-red-500" aria-label="必填">*</span> : null}
              </label>
              {q.help ? <div className="mt-0.5 text-[10px] text-zinc-400">{q.help}</div> : null}
              <div className="mt-1.5">
                {q.type === 'radio' && q.options ? (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((opt) => (
                      <label
                        key={opt.value}
                        title={opt.description}
                        className={chipClass(value === opt.value, locked)}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`${form.id}-${q.id}`}
                          value={opt.value}
                          checked={value === opt.value}
                          disabled={locked}
                          aria-label={opt.label}
                          onChange={() => update(q.id, opt.value)}
                        />
                        <OptionCopy option={opt} />
                      </label>
                    ))}
                  </div>
                ) : null}
                {q.type === 'checkbox' && q.options ? (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((opt) => {
                      const arr = Array.isArray(value) ? value : [];
                      const on = arr.includes(opt.value);
                      const maxed =
                        q.maxSelections !== undefined && !on && arr.length >= q.maxSelections;
                      return (
                        <label
                          key={opt.value}
                          title={opt.description}
                          className={`${chipClass(on, locked)} ${maxed ? 'cursor-not-allowed opacity-40' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            value={opt.value}
                            checked={on}
                            disabled={locked || maxed}
                            aria-label={opt.label}
                            onChange={() => toggleCheckbox(q.id, opt.value, q.maxSelections)}
                          />
                          <OptionCopy option={opt} />
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                {q.type === 'select' && q.options ? (
                  <select
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
                    value={typeof value === 'string' ? value : ''}
                    disabled={locked}
                    onChange={(e) => update(q.id, e.target.value)}
                  >
                    <option value="" disabled>
                      {q.placeholder ?? '请选择…'}
                    </option>
                    {q.options.map((opt) => (
                      <option key={opt.value} value={opt.value} title={opt.description}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                {q.type === 'text' ? (
                  <input
                    type="text"
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400 disabled:bg-zinc-50"
                    value={typeof value === 'string' ? value : ''}
                    placeholder={q.placeholder}
                    disabled={locked}
                    onChange={(e) => update(q.id, e.target.value)}
                  />
                ) : null}
                {q.type === 'textarea' ? (
                  <textarea
                    className="w-full resize-none rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400 disabled:bg-zinc-50"
                    value={typeof value === 'string' ? value : ''}
                    placeholder={q.placeholder}
                    disabled={locked}
                    rows={3}
                    onChange={(e) => update(q.id, e.target.value)}
                  />
                ) : null}
                {q.type === 'direction-cards' && q.cards && q.cards.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {q.cards.map((card) => (
                      <DirectionCardView
                        key={card.id}
                        card={card}
                        formId={form.id}
                        questionId={q.id}
                        selected={value === card.id || value === card.label}
                        disabled={locked}
                        onSelect={() => update(q.id, card.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {hideInternalSubmit ? null : (
        <div className="mt-4 flex items-center justify-between gap-2">
          {locked ? (
            <span className="text-[11px] text-zinc-400">
              {submittedAnswers ? '回答已发送' : '该表单已过期'}
            </span>
          ) : (
            <span className="text-[11px] text-zinc-400">不适用的可以跳过</span>
          )}
          {!locked ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!ready}
              title={ready ? '发送回答' : '请先完成必填项'}
              className="rounded-lg bg-zinc-900 px-4 py-1.5 text-xs text-white disabled:opacity-40"
            >
              {form.submitLabel ?? '继续'}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
});

function chipClass(on: boolean, locked: boolean): string {
  return `cursor-pointer rounded-full border px-3 py-1 text-xs ${
    on ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
  } ${locked ? 'cursor-default opacity-70 hover:bg-transparent' : ''}`;
}

function OptionCopy({ option }: { option: FormOption }) {
  return (
    <span className="inline-flex flex-col">
      <span>{option.label}</span>
      {option.description ? <span className="text-[10px] opacity-70">{option.description}</span> : null}
    </span>
  );
}

function DirectionCardView({
  card,
  formId,
  questionId,
  selected,
  disabled,
  onSelect,
}: {
  card: DirectionCard;
  formId: string;
  questionId: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`block cursor-pointer rounded-xl border p-3 transition-colors ${
        selected ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-zinc-200 hover:border-zinc-400'
      } ${disabled ? 'cursor-default opacity-70' : ''}`}
    >
      <input
        type="radio"
        className="sr-only"
        name={`${formId}-${questionId}`}
        value={card.id}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect()}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold text-zinc-800">{card.label}</div>
        {selected ? (
          <span className="shrink-0 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white">已选</span>
        ) : null}
      </div>
      {card.palette.length > 0 ? (
        <div className="mt-2 flex gap-1" aria-hidden>
          {card.palette.slice(0, 6).map((c, i) => (
            <span
              key={i}
              className="h-4 w-4 rounded-full border border-zinc-200"
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex items-baseline gap-2" aria-hidden>
        <span className="text-xl leading-none text-zinc-800" style={{ fontFamily: card.displayFont }}>
          Aa
        </span>
        <span className="truncate text-[11px] text-zinc-500" style={{ fontFamily: card.bodyFont }}>
          锐利的排版与克制的用色
        </span>
      </div>
      {card.mood ? <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{card.mood}</p> : null}
      {card.references.length > 0 ? (
        <p className="mt-1.5 text-[10px] text-zinc-400">
          <span className="font-medium">参考</span> {card.references.slice(0, 4).join(' · ')}
        </p>
      ) : null}
    </label>
  );
}

function buildInitialState(
  form: QuestionForm,
  submitted: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const q of form.questions) {
    if (submitted && submitted[q.id] !== undefined) {
      out[q.id] = canonicalizeQuestionValue(q, submitted[q.id]!);
      continue;
    }
    if (q.defaultValue !== undefined) {
      out[q.id] = canonicalizeQuestionValue(q, q.defaultValue);
      continue;
    }
    if (q.type === 'checkbox') {
      out[q.id] = [];
    } else {
      out[q.id] = '';
    }
  }
  return out;
}

function canonicalizeQuestionValue(
  q: QuestionForm['questions'][number],
  value: string | string[],
): string | string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => formOptionValueForLabel(q, entry));
  }
  return formOptionValueForLabel(q, value);
}

/**
 * Reverse of formatFormAnswers — when we render an old assistant message
 * that contained a form, look at the next user message in the conversation
 * to see if the form was already answered. If so, return the answers map
 * so the form renders in the locked "answered" state with the user's
 * picks visible.
 */
export function parseSubmittedAnswers(
  form: QuestionForm,
  userMessageContent: string,
): Record<string, string | string[]> | null {
  const lines = userMessageContent.split('\n').map((l) => l.trim());
  if (lines.length === 0) return null;
  const header = lines[0] ?? '';
  // We accept any "form answers" header so the agent can paraphrase.
  if (!/^\[form answers/i.test(header)) return null;
  const answers: Record<string, string | string[]> = {};
  const labelToId = new Map<string, string>();
  for (const q of form.questions) labelToId.set(q.label.toLowerCase(), q.id);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = /^[-*]\s*([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const labelKey = m[1]!.trim().toLowerCase();
    const value = m[2]!.trim();
    const id = labelToId.get(labelKey);
    if (!id) continue;
    const q = form.questions.find((x) => x.id === id);
    if (!q) continue;
    if (q.type === 'checkbox') {
      answers[id] = value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.toLowerCase() !== '(skipped)')
        .map((s) => formOptionValueForLabel(q, parseSubmittedOptionToken(s)));
    } else {
      answers[id] = value.toLowerCase() === '(skipped)' ? '' : formOptionValueForLabel(q, parseSubmittedOptionToken(value));
    }
  }
  return Object.keys(answers).length > 0 ? answers : null;
}

function parseSubmittedOptionToken(raw: string): string {
  const match = /\s+\[value:\s*([^\]]+)\]\s*$/i.exec(raw);
  if (!match) return raw.trim();
  return match[1]!.trim();
}
