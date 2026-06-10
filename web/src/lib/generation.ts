// Generation preview model, mirroring open-design's
// apps/web/src/runtime/generation-preview.ts three-step pipeline
// (Understand → Generate → Prepare) driven by the streaming chat events.

export type GenerationPhase = 'idle' | 'generating' | 'stopped' | 'failed' | 'done';
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type GenerationStepId = 'understand' | 'generate' | 'prepare';

export interface GenerationStep {
  id: GenerationStepId;
  status: StepStatus;
}

export interface GenerationModel {
  phase: GenerationPhase;
  steps: GenerationStep[];
  /** Latest streamed thinking/text line, shown while generating. */
  activityLabel: string | null;
  /** Latest file-write tool call, e.g. "Writing index.html". */
  detailLabel: string | null;
  errorMessage: string | null;
}

export interface GenerationInput {
  /** An agent turn is currently running. */
  busy: boolean;
  /** The user aborted the current/last turn. */
  aborted: boolean;
  /** Error reported by the agent for the last turn. */
  error: string | null;
  /** At least one text/thinking delta has streamed in this turn. */
  sawDelta: boolean;
  /** Most recent streamed thinking/text fragment. */
  lastActivity: string | null;
  /** Most recent file path written by a tool call. */
  lastWrite: string | null;
  /** The turn finished (done event received). */
  turnEnded: boolean;
}

const MAX_ACTIVITY_CHARS = 120;

function truncateActivity(value: string | null): string | null {
  if (!value) return null;
  const line = value.split('\n').filter((part) => part.trim().length > 0).pop()?.trim() ?? '';
  if (!line) return null;
  return line.length > MAX_ACTIVITY_CHARS ? `${line.slice(0, MAX_ACTIVITY_CHARS)}…` : line;
}

export function deriveGenerationModel(input: GenerationInput): GenerationModel {
  const failed = Boolean(input.error);
  const stopped = input.aborted && !failed;
  const done = input.turnEnded && !failed && !stopped && !input.busy;
  const generating = input.busy && !failed && !stopped;

  const phase: GenerationPhase = failed
    ? 'failed'
    : stopped
      ? 'stopped'
      : generating
        ? 'generating'
        : done && input.sawDelta
          ? 'done'
          : input.turnEnded || input.busy
            ? 'done'
            : 'idle';

  const understand: StepStatus = !generating && phase !== 'failed' && phase !== 'stopped' && phase !== 'done'
    ? 'pending'
    : input.sawDelta
      ? 'succeeded'
      : phase === 'failed'
        ? 'failed'
        : 'running';
  const generate: StepStatus =
    understand !== 'succeeded'
      ? 'pending'
      : phase === 'done'
        ? 'succeeded'
        : phase === 'failed'
          ? 'failed'
          : phase === 'stopped'
            ? 'pending'
            : 'running';
  const prepare: StepStatus = phase === 'done' ? 'succeeded' : 'pending';

  return {
    phase,
    steps: [
      { id: 'understand', status: understand },
      { id: 'generate', status: generate },
      { id: 'prepare', status: prepare },
    ],
    activityLabel: truncateActivity(input.lastActivity),
    detailLabel: input.lastWrite ? `Writing ${input.lastWrite}` : null,
    errorMessage: input.error,
  };
}
