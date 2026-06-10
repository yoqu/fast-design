import { describe, expect, it } from 'vitest';
import { deriveGenerationModel, type GenerationInput } from './generation';

const base: GenerationInput = {
  busy: false,
  aborted: false,
  error: null,
  sawDelta: false,
  lastActivity: null,
  lastWrite: null,
  turnEnded: false,
};

describe('deriveGenerationModel', () => {
  it('is idle before any turn', () => {
    const m = deriveGenerationModel(base);
    expect(m.phase).toBe('idle');
  });

  it('starts generating with understand running', () => {
    const m = deriveGenerationModel({ ...base, busy: true });
    expect(m.phase).toBe('generating');
    expect(m.steps).toEqual([
      { id: 'understand', status: 'running' },
      { id: 'generate', status: 'pending' },
      { id: 'prepare', status: 'pending' },
    ]);
  });

  it('advances to generate once deltas arrive and surfaces activity', () => {
    const m = deriveGenerationModel({ ...base, busy: true, sawDelta: true, lastActivity: '正在分析需求' });
    expect(m.steps[0]).toEqual({ id: 'understand', status: 'succeeded' });
    expect(m.steps[1]).toEqual({ id: 'generate', status: 'running' });
    expect(m.activityLabel).toBe('正在分析需求');
  });

  it('reports file writes as the detail label', () => {
    const m = deriveGenerationModel({ ...base, busy: true, sawDelta: true, lastWrite: 'index.html' });
    expect(m.detailLabel).toBe('Writing index.html');
  });

  it('marks prepare running then done after the turn ends', () => {
    const ending = deriveGenerationModel({ ...base, busy: true, sawDelta: true, lastWrite: 'index.html', turnEnded: false });
    expect(ending.steps[2]!.status).toBe('pending');
    const done = deriveGenerationModel({ ...base, sawDelta: true, turnEnded: true });
    expect(done.phase).toBe('done');
    expect(done.steps.every((s) => s.status === 'succeeded')).toBe(true);
  });

  it('maps abort to stopped and error to failed', () => {
    expect(deriveGenerationModel({ ...base, aborted: true, sawDelta: true }).phase).toBe('stopped');
    const failed = deriveGenerationModel({ ...base, error: 'rate limited', sawDelta: true, turnEnded: true });
    expect(failed.phase).toBe('failed');
    expect(failed.errorMessage).toBe('rate limited');
    expect(failed.steps.some((s) => s.status === 'failed')).toBe(true);
  });

  it('truncates long activity to 120 chars', () => {
    const m = deriveGenerationModel({ ...base, busy: true, sawDelta: true, lastActivity: 'x'.repeat(300) });
    expect(m.activityLabel!.length).toBeLessThanOrEqual(121); // 120 + ellipsis
  });
});
