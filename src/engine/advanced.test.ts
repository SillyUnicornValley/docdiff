// @vitest-environment jsdom
// Expected results for the advanced testdocs pairs 08–15 (testdocs/README.md).

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
const blocked = (r: DiffResult) => diffs(r).flatMap((d) => (d.useOld.available ? [] : [d.useOld.reason]));

describe('08 export formatting', () => {
  it('finds content-mark changes (superscript, subscript, hidden) and keeps formatting-only text equal', async () => {
    const lines = describeResult(await run('08-export-formatting'));
    expect(lines).toContain('~ The dose is 75 mg/m2 given as a single infusion. ⟶ The dose is 75 mg/m2 given as a single infusion.');
    expect(lines).toContain('~ Samples are frozen. DRAFT: confirm the freezer model. ⟶ Samples are frozen.');
    expect(lines).toContain('- Retention Period ¶ Records will be kept for 15 years after study completion.');
    expect(lines).toContain('= Archiving'); // same heading, different (localized) style id
  });
});

describe('09 sections, headers and footers', () => {
  it('pairs sections by content and hints header changes per section', async () => {
    const r = await run('09-sections-headers');
    const hints = r.scope.sectionHints.map((h) => `${h.part}:${h.variant}:${h.oldSection ?? '-'}:${h.newSection ?? '-'}:${h.result}`);
    expect(hints).toEqual(
      expect.arrayContaining([
        'header:default:1:1:mayDiffer',
        'header:first:1:1:same',
        'footer:default:1:1:same',
        'header:default:3:5:mayDiffer', // landscape section: header text changed
        'header:default:4:-:onlyOld', // References section removed
        'header:even:-:6:onlyNew', // new appendix with odd/even headers
      ]),
    );
  });
});

describe('10 complex tables', () => {
  it('compares row by row where the structure allows, else the whole table', async () => {
    const r = await run('10-complex-tables');
    const lines = describeResult(r);
    expect(lines).toContain('  row+ 0 | 5 | 0.08 | 3');
    expect(lines).toContain('  row- 3 | 40 | 0.6 | 6');
    expect(lines).toContain('    ~ Hematology ⟶ Haematology'); // text inside a vertically merged cell
    expect(lines).toContain('~(tableStructure) [table 4×5] ⟶ [table 4×4]'); // column removed
    expect(lines).toContain('      row+ Week 8 | ±5'); // row added in a nested table
    expect(lines).toContain('= [table 3×2]'); // shading / widths only: no difference
    expect(diffs(r).filter((d) => d.kind === 'tableStructure')).toHaveLength(1);
  });
});

describe('11 fields and content controls', () => {
  it('compares text inside content controls; blocks "Use old" where structure would break', async () => {
    const r = await run('11-fields-and-controls');
    const lines = describeResult(r);
    expect(lines).toContain('~ ☐ Not applicable (no biological samples are stored) ⟶ ☒ Not applicable (no biological samples are stored)');
    expect(lines).toContain('~ Phase: Phase 2 ⟶ Phase: Phase 3');
    expect(lines).toContain('~ The study runs in Boston and Denver. ⟶ The study runs in Chicago and Denver.');
    // Since Stage 5 (decision 43) fields, hyperlinks and footnotes can come back; only the broken structure still blocks.
    expect(blocked(r)).toEqual(['contentControlBoundary']);
    expect(diffs(r).filter((d) => d.informational === 'fields')).toHaveLength(3); // SEQ captions, field across paragraphs
    expect(r.scope.fingerprints.filter((f) => f.result === 'mayDiffer').map((f) => f.part)).toEqual(
      expect.arrayContaining(['footnotes', 'endnotes', 'hyperlinkUrls', 'textBoxes']),
    );
  });
});

describe('12 tracked changes and comments', () => {
  it('compares the accepted text and reports unsupported revisions', async () => {
    const r = await run('12-tracked-and-comments');
    const lines = describeResult(r);
    expect(lines).toContain('~(splitJoin) Measure blood pressure. ¶ Record heart rate. ⟶ Measure blood pressure and record heart rate.');
    expect(lines).toContain('  row~ Glucose | mmol/L | 3.9-5.5'); // the row name pairs the rows although two cells changed
    expect(lines).toContain('⇄> Three readings are taken.'); // short but unique: a move
    expect(r.scope.unsupportedRevisions).toEqual([{ side: 'new', type: 'Inserted table cell', location: 'Table' }]);
    expect(r.scope.pendingRevisionsInNew).toBeGreaterThan(15);
  });
});

describe('13 reordering and repeated text', () => {
  it('moves unique paragraphs, never one of several identical ones', async () => {
    const r = await run('13-reorder-and-repeats');
    const lines = describeResult(r);
    expect(lines).toContain('⇄> Bring all medication.');
    expect(lines).toContain('⇄> Rest before the visit.');
    expect(lines).toContain('- Imaging ¶ Not applicable.');
    expect(lines).toContain('~ Visit 9 takes place on Day 63. ⟶ Visit 9 takes place on Day 64.');
    expect(lines.filter((l) => l.includes('Not applicable.') && !l.startsWith('='))).toEqual(['- Imaging ¶ Not applicable.']);
  });
});

describe('14 characters and normalisation', () => {
  it('puts each typographic change in its category', async () => {
    const r = await run('14-unicode-and-normalisation');
    const cat = (needle: string) => diffs(r).find((d) => lineOf(r, d.id).includes(needle))?.category;
    expect(cat('Take 10')).toBe('whitespace'); // non-breaking space
    expect(cat('Range 2-8')).toBe('dashes');
    expect(cat("participant's")).toBe('quotes');
    expect(cat('CASE CHANGE')).toBe('case');
    expect(cat('naïve')).toBeUndefined(); // accents are content
    expect(cat('😀')).toBeUndefined();
    const long = diffs(r).find((d) => lineOf(r, d.id).startsWith('~ Attend'))!;
    expect(long.wordHunks).toHaveLength(3); // three single-word edits in a 400-word paragraph
  });
});

describe('15 realistic SOP', () => {
  it('finds the logged version-update changes', async () => {
    const r = await run('15-realistic-sop');
    const lines = describeResult(r);
    for (const l of [
      '  row+ 2.0 | 2026-09-30 | M. Ortiz | Query timelines, roles and the review checklist updated.',
      '- Observational studies are out of scope.',
      '  row+ RBQM | Risk-based quality management.',
      '+ Central Monitor: Reviews key risk indicators every month.',
      '~ Sites must answer queries within 14 calendar days. ⟶ Sites must answer queries within 10 calendar days.',
      '~ ICH E6(R2) Good Clinical Practice. ⟶ ICH E6(R3) Good Clinical Practice.',
      '~ Appendix: Forms ⟶ Appendix: Checklist',
      '  row+ External data reconciled |  |  | ',
      '    ~ J. Lee ⟶ M. Ortiz',
    ])
      expect(lines).toContain(l);
    expect(diffs(r).filter((d) => d.informational === 'toc')).toHaveLength(1);
  });
});

/** The outline line of one difference (first line describeResult gives for it). */
function lineOf(r: DiffResult, id: string): string {
  const d = r.differences[id];
  const one: DiffResult = { ...r, segments: r.segments.filter((s) => s.type === 'diff' && s.diffId === id), order: [id], differences: { [id]: d } };
  return describeResult(one)[0] ?? '';
}
