// @vitest-environment jsdom
// The real engine on the testdocs pairs: same invariants as the mocks.

import { describe, expect, it } from 'vitest';
import { defineInvariantTests, paragraphTexts } from '../testing/invariants';
import { testdoc } from './testing/files';
import { compareFiles, type CompareOutput } from './index';

const PAIRS = ['01-basic-text', '02-lists', '03-tables', '04-tracked-changes', '05-uncompared-and-comments', '06-edge-alignment'];

const cache = new Map<string, Promise<CompareOutput>>();
const run = (pair: string) => {
  if (!cache.has(pair))
    cache.set(pair, compareFiles({ name: `${pair}_old.docx`, data: testdoc(`${pair}_old.docx`) }, { name: `${pair}_new.docx`, data: testdoc(`${pair}_new.docx`) }));
  return cache.get(pair)!;
};

describe.each(PAIRS)('engine %s', (pair) => {
  defineInvariantTests(async () => (await run(pair)).result);
});

describe('engine specifics', () => {
  it('gives the same difference ids when the same files are compared again', async () => {
    const a = (await run('01-basic-text')).result;
    const b = (await compareFiles({ name: 'o', data: testdoc('01-basic-text_old.docx') }, { name: 'n', data: testdoc('01-basic-text_new.docx') })).result;
    expect(b.order).toEqual(a.order);
  });

  it('01: formatting-only and run-split changes are not differences', async () => {
    const r = (await run('01-basic-text')).result;
    const changed = Object.values(r.differences).flatMap((d) => [...d.old.ids, ...d.new.ids]);
    const ix = new Map([...r.old.blocks, ...r.new.blocks].map((b) => [b.id, b]));
    const changedText = paragraphTexts(changed.map((id) => ix.get(id)!));
    expect(changedText.some((t) => t.startsWith('All adverse events'))).toBe(false);
    expect(changedText.some((t) => t.startsWith('Safety Monitoring'))).toBe(false);
  });

  it('04: counts pending revisions of the new file', async () => {
    const r = (await run('04-tracked-changes')).result;
    expect(r.scope.pendingRevisionsInNew).toBeGreaterThan(0);
  });

  it('05: lists detected-only parts in the check scope', async () => {
    const r = (await run('05-uncompared-and-comments')).result;
    const els = r.scope.items.map((i) => i.element);
    expect(els).toEqual(expect.arrayContaining(['Footnote text', 'Hyperlink addresses', 'Headers and footers', 'Comments']));
    expect(r.scope.fingerprints.find((f) => f.part === 'footnotes')?.result).toBe('mayDiffer');
  });
});
