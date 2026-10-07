// Invariants every DiffResult must satisfy (mock now, real engine in Stage 2).

import { describe, expect, it } from 'vitest';
import type { Block } from '../model/document';
import type { DiffResult } from '../model/diff';
import { forEachParagraph } from '../model/docIndex';
import { buildFinal } from '../model/final';
import { flattenParagraph } from '../model/flatten';
import { invertResult } from '../model/invert';
import type { Choice } from '../model/review';
import { MOCK_PAIRS } from './index';

const text = (blocks: Block[]) => {
  const out: string[] = [];
  forEachParagraph(blocks, (p) => out.push(flattenParagraph(p).text));
  return out;
};

const allChoices = (r: DiffResult, c: Choice) => Object.fromEntries(Object.keys(r.differences).map((id) => [id, c]));

describe.each(MOCK_PAIRS.map((p) => [p.id, p] as const))('mock %s', (_id, pair) => {
  const r = pair.build();

  it('lists every difference in navigation order exactly once', () => {
    expect(new Set(r.order).size).toBe(r.order.length);
    expect([...r.order].sort()).toEqual(Object.keys(r.differences).sort());
  });

  it('all "new" (default) reproduces the new document (acceptance 7)', () => {
    expect(text(buildFinal(r, {}).blocks)).toEqual(text(r.new.blocks));
  });

  it('all "old" reproduces the old document', () => {
    // Informational differences always stay "new"; skip pairs that have them.
    if (Object.values(r.differences).some((d) => d.informational)) return;
    expect(text(buildFinal(r, allChoices(r, 'old')).blocks)).toEqual(text(r.old.blocks));
  });

  it('moved content is never duplicated or lost (acceptance 9)', () => {
    for (const d of Object.values(r.differences).filter((x) => x.kind === 'moved')) {
      for (const c of ['old', 'new'] as const) {
        const f = buildFinal(r, { [d.id]: c });
        const ids = d[c].ids;
        const present = ids.filter((id) => f.origin.has(id));
        expect(present).toEqual(ids);
        const other = d[c === 'old' ? 'new' : 'old'].ids;
        expect(other.some((id) => f.origin.has(id))).toBe(false);
      }
    }
  });

  it('swapping files twice is a no-op', () => {
    expect(invertResult(invertResult(r)).differences).toEqual(r.differences);
  });
});

describe('specific expectations', () => {
  const get = (id: string) => MOCK_PAIRS.find((p) => p.id === id)!.build();

  it('01: 12 → 24 highlights only the number', () => {
    const r = get('01');
    const d = Object.values(r.differences).find((x) => x.wordHunks.some((h) => h.old.length === 1 && h.old[0].end - h.old[0].start === 2))!;
    expect(d).toBeTruthy();
  });

  it('05: footnote and field differences block "Use old"', () => {
    const r = get('05');
    const reasons = Object.values(r.differences)
      .filter((d) => !d.useOld.available)
      .map((d) => (d.useOld.available ? '' : d.useOld.reason));
    expect(reasons).toContain('footnote');
    expect(reasons).toContain('field');
  });

  it('06: typography hunks are categorised', () => {
    const r = get('06');
    const cats = new Set(Object.values(r.differences).flatMap((d) => d.wordHunks.map((h) => h.category)));
    for (const c of ['whitespace', 'quotes', 'dashes', 'case']) expect(cats).toContain(c);
  });

  it('large: about 3,000 blocks', () => {
    const r = get('large');
    expect(r.new.blocks.length).toBeGreaterThan(2500);
  });
});
