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

  it('a per-change selection that is all one side becomes the plain choice (decision 42)', () => {
    const rv = applyChoices(emptyReview(), 'x', [
      { diffId: 'd1', to: { hunks: ['old', 'old'] } },
      { diffId: 'd2', to: { hunks: ['old', 'new'] } },
    ]);
    expect(rv.state.choices).toEqual({ d1: 'old', d2: { hunks: ['old', 'new'] } });
    expect(applyChoices(rv, 'same', [{ diffId: 'd2', to: { hunks: ['old', 'new'] } }]).history.past).toHaveLength(1);
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

  it('round-trips a per-change selection and skips one that does not fit the difference', () => {
    const base = Object.values(r01.differences).find((x) => x.wordHunks.length >= 2 && !x.informational)!;
    const d = { ...base, perChange: true, useOld: { available: true as const } };
    const r = { ...r01, differences: { ...r01.differences, [d.id]: d } };
    const hunks = d.wordHunks.map((_, i) => (i % 2 ? 'old' : 'new') as 'old' | 'new');
    const rv = applyChoices(emptyReview(), 'x', [{ diffId: d.id, to: { hunks } }]);
    expect(parseProgressFile(JSON.stringify(makeProgressFile(r, rv, '0.5.0')), r)).toEqual({ ok: true, choices: { [d.id]: { hunks } }, skipped: 0 });
    const bad = { ...makeProgressFile(r, rv, '0.5.0'), choices: { [d.id]: { hunks: ['old'] } } };
    expect(parseProgressFile(JSON.stringify(bad), r)).toMatchObject({ ok: true, skipped: 1 });
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
