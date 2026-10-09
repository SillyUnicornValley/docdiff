// @vitest-environment jsdom
// Expected results for the Stage 5 testdocs pairs 16–18 (testdocs/README.md,
// docs/implementation/stage5-design.md).

import { describe, expect, it } from 'vitest';
import type { DiffResult, FormatChange } from '../model/diff';
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
const lines = (cs: FormatChange[]) => cs.flatMap((c) => c.items.map((i) => `${c.text} | ${i.property}: ${i.old} → ${i.new}${i.places ? ` · ${i.places.join(', ')}` : ''}`));

describe('16 formatting check (decision 44)', () => {
  it('finds formatting changes on paired content without content differences', async () => {
    const r = await run('16-formatting');
    // Only one content difference: "4 weeks" → "6 weeks".
    expect(describeResult(r).filter((l) => !l.startsWith('='))).toEqual(['~ Visits occur every 4 weeks during treatment. ⟶ Visits occur every 6 weeks during treatment.']);
    expect(r.scope.formatting).toBe('flagged');
    expect(lines(r.formatChanges!)).toEqual([
      'The study drug must be stored below 25 °C. | Bold: off → on · must',
      'Report all serious adverse events within 24 hours. | Color: #C00000 → automatic · 24 hours',
      'Keep the carton closed until use. | Font: Calibri → Arial · Keep the carton closed until use',
      'Keep the carton closed until use. | Size: 11 pt → 12 pt · Keep the carton closed until use',
      'Do not freeze. | Alignment: left → center',
      'Protect from light. | Indent left: 0" → 0.5"',
      'Protect from light. | Space after: 8 pt → 18 pt',
      // Bold from the style or set directly: the same; only the style name differs.
      'Only trained staff may prepare the infusion. | Paragraph style: Strong Note → Normal',
      // Italic from a character style or set directly: no difference at all ("Read the pharmacy manual first.").
      'Visits occur every 6 weeks during treatment. | Italic: off → on · Visits',
      'Visits occur every 6 weeks during treatment. | Highlight: none → yellow · treatment',
      'Check the expiry date. | List type: Bullet • → Numbered 1.',
      'Inspect the vial. | List type: Bullet • → Numbered 1.',
      'Record the batch number. | List type: Bullet • → Numbered 1.',
      'Parameter | Table style: Table Grid → Light List',
    ]);
  });

  it('leaves out paragraphs whose heading level changed (01: the ⚑ hint covers them)', async () => {
    const r = await run('01-basic-text');
    expect(r.formatChanges!.map((c) => c.text)).toEqual(['All adverse events must be reported within 24 hours of awareness.']);
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
