// Questions 面板 — 对齐参照 apps/web/src/components/QuestionsPanel.tsx：
// 逐题 reveal（280ms/题，按 formKey 记忆不重播）、120 秒自动跳过倒计时、
// 「全部跳过 / 继续」页脚按钮、流式生成中的 typing 指示。
import { useEffect, useRef, useState } from 'react';
import type { QuestionForm } from '../lib/questionForm';
import { QuestionFormView, type QuestionFormHandle } from './QuestionForm';

// Surface one new question every this many ms. The agent often emits the whole
// form artifact in a single chunk, so we can't rely on the parse count
// trickling in — we always play this reveal client-side so the frame shows
// first and each question slides in after it.
const REVEAL_INTERVAL_MS = 280;

// Form occurrences whose one-by-one reveal has already played to completion.
// The Questions tab is conditionally mounted, so a remount would otherwise
// reset `revealed` to 0 and replay the whole animation. Keyed by the host's
// stable per-occurrence id so a fresh form (new conversation) still animates
// while the same form never re-animates.
const revealedOccurrences = new Set<string>();

// Once the form is actionable, the user has this long before we auto-continue
// for them — submitting whatever they picked (unanswered questions count as
// skipped) so generation never stalls waiting on a reply.
const SKIP_COUNTDOWN_SECONDS = 120;

type Props = {
  form: QuestionForm | null;
  // Stable id for this form occurrence. Lets the reveal survive a remount
  // (see `revealedOccurrences`) without re-animating.
  formKey?: string | null;
  // Whether the form is the active, unanswered one — it stays editable while
  // streaming and while the turn is busy, so it never flickers locked/unlocked.
  interactive: boolean;
  // The turn is busy (streaming/queued); keep Continue/Skip disabled while the
  // form itself stays editable.
  submitDisabled?: boolean;
  submittedAnswers?: Record<string, string | string[]>;
  // The assistant turn is still streaming the form — keep Continue disabled
  // and show the generating hint.
  generating: boolean;
  /** 把答案组合为一条 [form answers — id] 消息发送到对话。 */
  onSubmit: (text: string) => void;
};

export default function QuestionsPanel({
  form,
  formKey = null,
  interactive,
  submitDisabled = false,
  submittedAnswers,
  generating,
  onSubmit,
}: Props) {
  const formRef = useRef<QuestionFormHandle>(null);
  const [ready, setReady] = useState(false);

  const total = form?.questions.length ?? 0;
  const answered = submittedAnswers !== undefined;
  // If this occurrence already finished its reveal in a prior mount, show it in
  // full immediately rather than replaying the animation on remount.
  const [revealed, setRevealed] = useState(() =>
    formKey && revealedOccurrences.has(formKey) ? total : 0,
  );

  // Tick the visible question count up to the total, one at a time. This runs
  // regardless of whether the questions arrived incrementally or in one burst,
  // so the build-up is always visible. An already-answered (historical) form
  // shows everything at once — no reason to re-animate something the user sent.
  useEffect(() => {
    if (answered) {
      setRevealed(total);
      return;
    }
    if (revealed >= total) {
      // Reveal finished — remember it so a remount of this same occurrence
      // shows the form in full instead of animating again.
      if (formKey && total > 0) revealedOccurrences.add(formKey);
      return;
    }
    const id = window.setTimeout(
      () => setRevealed((n) => Math.min(n + 1, total)),
      REVEAL_INTERVAL_MS,
    );
    return () => window.clearTimeout(id);
  }, [answered, total, revealed, formKey]);

  const fullyRevealed = revealed >= total;
  const visibleCount = answered ? total : Math.min(revealed, total);
  const visibleForm = form
    ? { ...form, questions: form.questions.slice(0, visibleCount) }
    : null;
  // Still producing: the turn is streaming, OR we're mid reveal animation.
  const building = generating || (!answered && !fullyRevealed);

  // Submission needs the form present, active, fully revealed, and not blocked
  // by a busy/streaming turn. Required-field readiness is tracked separately by
  // `ready` (from QuestionFormView) and gates Continue via `canContinue`.
  const canSubmit = !!form && interactive && !building && !submitDisabled;
  const canContinue = canSubmit && ready;
  const canSkip = canSubmit;

  // Auto-skip countdown. It only runs while the form is actionable; pausing
  // (busy turn, re-stream) resets it so we never auto-submit a half-ready form.
  const [remaining, setRemaining] = useState(SKIP_COUNTDOWN_SECONDS);
  const autoFiredRef = useRef(false);

  useEffect(() => {
    if (!canSubmit) {
      setRemaining(SKIP_COUNTDOWN_SECONDS);
      autoFiredRef.current = false;
      return;
    }
    const id = window.setInterval(() => {
      setRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [canSubmit]);

  // When the countdown elapses, continue with the current selections (anything
  // untouched submits as skipped) and let generation proceed.
  useEffect(() => {
    if (canSubmit && remaining <= 0 && !autoFiredRef.current) {
      autoFiredRef.current = true;
      // Honour the user's picks when the form is submittable; otherwise fall
      // back to skipping so a stray selection-cap can't stall generation.
      if (ready) formRef.current?.submit();
      else formRef.current?.skipAll();
    }
  }, [canSubmit, ready, remaining]);

  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  return (
    <div className="flex h-full flex-col" data-testid="questions-panel">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {visibleForm ? (
          <>
            <QuestionFormView
              ref={formRef}
              form={visibleForm}
              interactive={interactive}
              submittedAnswers={submittedAnswers}
              hideInternalSubmit
              onReadyChange={setReady}
              onSubmit={(text) => onSubmit(text)}
            />
            {building ? (
              <div className="mt-3 flex gap-1 px-1" aria-hidden>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-300 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-300 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-300 [animation-delay:300ms]" />
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">正在生成问题…</div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-200 px-5 py-3">
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">
          {building ? '正在生成问题…' : canSkip ? '超时将自动按当前选择继续' : null}
        </span>
        <button
          type="button"
          disabled={!canSkip}
          onClick={() => formRef.current?.skipAll()}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
        >
          全部跳过
          {canSkip ? <span className="ml-1.5 font-mono text-[10px] text-zinc-400">{countdown}</span> : null}
        </button>
        <button
          type="button"
          disabled={!canContinue}
          onClick={() => formRef.current?.submit()}
          className="rounded-lg bg-zinc-900 px-4 py-1.5 text-xs text-white disabled:opacity-40"
        >
          继续
        </button>
      </div>
    </div>
  );
}
