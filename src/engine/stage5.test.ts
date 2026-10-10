// @vitest-environment jsdom
// Expected results for the Stage 5 testdocs pairs 16–18 (testdocs/README.md,
// docs/implementation/stage5-design.md).

import { describe, expect, it } from 'vitest';
import type { DiffResult } from '../model/diff';
import { describeResult } from '../testing/describe';
import { testdoc } from './testing/files';
import { compareFiles } from './index';

const cache = new Map<string, Promise<DiffResult>>();
const run = (pair: string) => {
  if (!cache.has(pair))
    cache.set(
      pair,
      compareFiles({ name: `${pair}_old.docx`, data: testdoc(`${pair}_old.docx`) }, { name: `${pair}_new.docx`, data: testdoc(`${pair}_new.docx`) }).then((o) => o.result),
    );
  return cache.get(pair)!;
};
const diffs = (r: DiffResult) => r.order.map((id) => r.differences[id]);
describe('16 formatting-only changes (formatting check postponed, decision 47)', () => {
  it('reports no difference for formatting-only changes', async () => {
    const r = await run('16-formatting');
    // Only one content difference: "4 weeks" → "6 weeks".
    expect(describeResult(r).filter((l) => !l.startsWith('='))).toEqual(['~ Visits occur every 4 weeks during treatment. ⟶ Visits occur every 6 weeks during treatment.']);
    expect(r.scope.formatting).toBe('notChecked');
  });
});

describe('17 old content with notes, links, fields and pictures (decision 43)', () => {
  it('allows "Use old" unless something cannot be copied', async () => {
    const r = await run('17-notes-links-images');
    const why = diffs(r).map((d) => (d.useOld.available ? 'ok' : d.useOld.reason));
    expect(why).toEqual(['ok', 'ok', 'ok', 'ok', 'bookmark', 'ok', 'notesPart', 'image']);
  });
});

describe('17 other parts, item by item (decision 45)', () => {
  it('pairs notes, headers, text boxes, link addresses and properties', async () => {
    const p = (await run('17-notes-links-images')).otherParts!;
    const st = (xs: { label: string; status: string }[]) => xs.map((x) => `${x.label}:${x.status}`);
    // The edited footnote is paired with its most similar counterpart, not by position.
    expect(st(p.footnotes)).toEqual(['Footnote 1:onlyOld', 'Footnote 2 → 1:changed', 'Footnote 3:onlyOld']);
    expect(st(p.endnotes)).toEqual(['Endnote 1:onlyOld']);
    expect(st(p.headersFooters)).toEqual(['Section 1 · Header:changed']);
    expect(st(p.textBoxes)).toEqual(['Text box 1:changed']);
    expect(p.links.map((l) => [l.text, l.old, l.new])).toEqual([['FAQ', 'https://example.com/faq-2025', 'https://example.com/faq-2026']]);
    expect(p.properties).toContainEqual({ name: 'Subject', old: 'Pharmacy manual', new: 'Pharmacy manual (revised)' });
    const fn = p.footnotes[1];
    expect(fn.hunks.length).toBeGreaterThan(0);
  });

  it('05: a changed picture in a shared paragraph is listed', async () => {
    const r = await compareFiles(
      { name: 'o', data: testdoc('05-uncompared-and-comments_old.docx') },
      { name: 'n', data: testdoc('05-uncompared-and-comments_new.docx') },
    );
    expect(r.result.otherParts!.images).toHaveLength(1);
    expect(r.result.scope.items.find((i) => i.element === 'Footnote text')?.status).toBe('flagged');
  });
});

describe('18 comments (decision 46)', () => {
  it('pairs comments by author and text, then by anchor', async () => {
    const r = await run('18-comments');
    const c = r.otherParts!.comments.map((x) => `${x.status}:${(x.new ?? x.old)!.author}:${(x.new ?? x.old)!.anchor}`);
    expect(c).toEqual([
      'same:Dana:18 years or older',
      'textChanged:Dana:30 days',
      'anchorChanged:Evan:at least 50 kg',
      'onlyNew:Farah:Participants with a history of seizures are excluded.',
      'onlyOld:Evan:Participants must be able to swallow tablets.',
    ]);
    // Old comments are shown, marked as old; they never create a difference.
    expect(describeResult(r).filter((l) => !l.startsWith('='))).toEqual([
      '~ Body weight of at least 45 kg is required. ⟶ Body weight of at least 50 kg is required.',
      '+ Participants with a history of seizures are excluded.',
    ]);
  });
});
