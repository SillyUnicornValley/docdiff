// Invariants every DiffResult must satisfy, from the mock or the real engine
// (docs/stage2-design.md §6 M6). Call inside a describe block.

import { expect, it } from 'vitest';
import type { DiffResult } from '../model/diff';
import type { Block } from '../model/document';
import { forEachParagraph } from '../model/docIndex';
import { buildFinal } from '../model/final';
import { flattenParagraph } from '../model/flatten';
import { invertResult } from '../model/invert';
import type { Choice } from '../model/review';

export const paragraphTexts = (blocks: Block[]) => {
  const out: string[] = [];
  forEachParagraph(blocks, (p) => out.push(flattenParagraph(p).text));
  return out;
};

const allChoices = (r: DiffResult, c: Choice) => Object.fromEntries(Object.keys(r.differences).map((id) => [id, c]));

export function defineInvariantTests(get: () => DiffResult | Promise<DiffResult>) {
  it('lists every difference in navigation order exactly once', async () => {
    const r = await get();
    expect(new Set(r.order).size).toBe(r.order.length);
    expect([...r.order].sort()).toEqual(Object.keys(r.differences).sort());
  });

  it('all "new" (default) reproduces the new document (acceptance 7)', async () => {
    const r = await get();
    expect(paragraphTexts(buildFinal(r, {}).blocks)).toEqual(paragraphTexts(r.new.blocks));
  });

  it('all "old" reproduces the old document', async () => {
    const r = await get();
    // Informational differences always stay "new"; skip pairs that have them.
    if (Object.values(r.differences).some((d) => d.informational)) return;
    expect(paragraphTexts(buildFinal(r, allChoices(r, 'old')).blocks)).toEqual(paragraphTexts(r.old.blocks));
  });

  it('moved content is never duplicated or lost (acceptance 9)', async () => {
    const r = await get();
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

  it('swapping files twice is a no-op', async () => {
    const r = await get();
    expect(invertResult(invertResult(r)).differences).toEqual(r.differences);
  });
}
