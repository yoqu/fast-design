import type { GenerationModel, GenerationStepId } from '../lib/generation';
import { CheckIcon, SparklesIcon, SquareIcon, XIcon } from './icons';

type Props = {
  model: GenerationModel;
  onRetry?: () => void;
};

const STEP_LABELS: Record<GenerationStepId, string> = {
  understand: '理解需求',
  generate: '生成页面',
  prepare: '准备预览',
};

/**
 * Overlay shown over the preview area while the agent generates a prototype,
 * mirroring open-design's GenerationPreviewStage: mark icon, title, lead line
 * (latest activity), three-step progress, substatus and a retry action on
 * failure.
 */
export function GenerationStage({ model, onRetry }: Props) {
  const generating = model.phase === 'generating';

  const title =
    model.phase === 'failed'
      ? '生成失败'
      : model.phase === 'stopped'
        ? '已停止'
        : '正在生成原型…';

  const lead =
    model.phase === 'failed'
      ? model.errorMessage || '生成过程中出现问题,请重试。'
      : model.phase === 'stopped'
        ? '本次生成已停止,可以继续对话或重试。'
        : model.activityLabel;

  const MarkIcon = model.phase === 'failed' ? XIcon : model.phase === 'stopped' ? SquareIcon : SparklesIcon;
  const showSubstatus = generating && Boolean(model.detailLabel);

  return (
    <section
      data-testid="generation-stage"
      data-phase={model.phase}
      aria-live="polite"
      aria-busy={generating}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/95 px-8 text-center"
    >
      <div
        aria-hidden
        className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${
          model.phase === 'failed'
            ? 'bg-red-100 text-red-600'
            : 'bg-zinc-900 text-white' + (generating ? ' animate-pulse' : '')
        }`}
      >
        <MarkIcon size={22} />
      </div>
      <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>
      {!showSubstatus && lead ? (
        <p className="max-w-md text-sm text-zinc-500">{lead}</p>
      ) : null}
      <ol className="mt-2 flex flex-col items-start gap-2">
        {model.steps
          .filter((step) => step.status !== 'pending')
          .map((step) => (
            <li key={step.id} data-status={step.status} className="flex items-center gap-2 text-sm">
              <span aria-hidden className="flex h-4 w-4 items-center justify-center">
                {step.status === 'succeeded' ? (
                  <CheckIcon size={13} className="text-emerald-600" />
                ) : step.status === 'failed' ? (
                  <XIcon size={13} className="text-red-500" />
                ) : (
                  <span
                    className={`h-2 w-2 rounded-full bg-zinc-800 ${step.status === 'running' && generating ? 'animate-pulse' : ''}`}
                  />
                )}
              </span>
              <span className={step.status === 'running' ? 'text-zinc-900' : 'text-zinc-500'}>
                {STEP_LABELS[step.id]}
              </span>
            </li>
          ))}
      </ol>
      {showSubstatus ? (
        <div key={model.detailLabel ?? ''} className="mt-1 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
          {model.detailLabel}
        </div>
      ) : null}
      {model.phase === 'failed' && onRetry ? (
        <button
          type="button"
          data-testid="generation-stage-retry"
          onClick={onRetry}
          className="mt-2 rounded-lg bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700"
        >
          重试
        </button>
      ) : null}
    </section>
  );
}
