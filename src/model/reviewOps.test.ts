import { describe, expect, it } from 'vitest';
import { MOCK_PAIRS } from '../mock';
import { applyChoices, emptyReview, makeProgressFile, parseProgressFile, redo, undo } from './reviewOps';

const r01 = MOCK_PAIRS.find((p) => p.id === '01')!.build();
const r05 = MOCK_PAIRS.find((p) => p.id === '05')!.build();

describe('review operations', () => {
  it('a batch is one undo step; undo and redo restore exactly', () => {
    let rv = applyChoices(emptyReview(), 'one', [{ diffId: 'd1', to: 'old' }]);
    rv = applyChoices(rv, 'batch', [
      { diffId: 'd2', to: 'new' },
      { diffId: 'd3', to: 'new' },
    ]);
    expect(rv.history.past).toHaveLength(2);
    const u = undo(rv);
    expect(u.state.choices).toEqual({ d1: 'old' });
    expect(redo(u).state.choices).toEqual(rv.state.choices);
  });

  it('a no-op change adds no history entry', () => {
    const rv = applyChoices(emptyReview(), 'x', [{ diffId: 'd1', to: undefined }]);
    expect(rv.history.past).toHaveLength(0);
  });
});

describe('progress files', () => {
  it('round-trips on the same pair', () => {
    const rv = applyChoices(emptyReview(), 'x', [{ diffId: r01.order[0], to: 'old' }]);
    const res = parseProgressFile(JSON.stringify(makeProgressFile(r01, rv, '0.1.0')), r01);
    expect(res).toEqual({ ok: true, choices: { [r01.order[0]]: 'old' }, skipped: 0 });
  });

  it('is refused for different documents', () => {
    const file = makeProgressFile(r01, emptyReview(), '0.1.0');
    const res = parseProgressFile(JSON.stringify(file), r05);
    expect(res.ok).toBe(false);
  });

  it('skips "Use old" where it is unavailable', () => {
    const blocked = Object.values(r05.differences).find((d) => !d.useOld.available)!;
    const file = { ...makeProgressFile(r05, emptyReview(), '0.1.0'), choices: { [blocked.id]: 'old' } };
    const res = parseProgressFile(JSON.stringify(file), r05);
    expect(res).toMatchObject({ ok: true, skipped: 1 });
  });
});
