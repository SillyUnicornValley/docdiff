// @vitest-environment jsdom
// The real engine on the testdocs pairs: same invariants as the mocks.

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiffResult } from '../model/diff';
import { DocIndex } from '../model/docIndex';
import { flattenParagraph } from '../model/flatten';
import { describeResult } from '../testing/describe';
import { defineInvariantTests, paragraphTexts } from '../testing/invariants';
import { testdoc } from './testing/files';
import { compareFiles, type CompareOutput } from './index';

const PAIRS = ['01-basic-text', '02-lists', '03-tables', '04-tracked-changes', '05-uncompared-and-comments', '06-edge-alignment', '07-long-document'];

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

/** Text of the highlighted spans on one side of every difference of the given kinds. */
function changedTexts(r: DiffResult, kinds: string[], side: 'old' | 'new') {
  const ix = new DocIndex(r[side]);
  const out: string[] = [];
  for (const d of Object.values(r.differences)) {
    if (!kinds.includes(d.kind)) continue;
    for (const h of d.wordHunks)
      for (const sp of h[side]) {
        const b = ix.get(sp.blockId);
        if (b?.kind === 'block' && b.node.kind === 'paragraph') out.push(flattenParagraph(b.node).text.slice(sp.start, sp.end));
      }
  }
  return out;
}

const blockTexts = (r: DiffResult, kind: string, side: 'old' | 'new') => {
  const ix = new DocIndex(r[side]);
  return Object.values(r.differences)
    .filter((d) => d.kind === kind && d[side].unit === 'block')
    .flatMap((d) => paragraphTexts(d[side].ids.map((id) => ix.block(id))));
};

describe('expected outlines (testdocs/README.md)', () => {
  const outline = async (pair: string) => describeResult((await run(pair)).result);

  it('01 basic text', async () => {
    expect(await outline('01-basic-text')).toEqual([
      '= Clinical Study Protocol CX-201',
      '= Introduction',
      '= This document describes the design of a randomized, double-blind study of Compound X in adults with moderate hypertension.',
      '~ Participants will be treated for 12 weeks, followed by a 4-week safety follow-up period. ⟶ Participants will be treated for 24 weeks, followed by a 4-week safety follow-up period.',
      '~ The primary objective is to evaluate the change in systolic blood pressure from baseline. ⟶ The primary objective is to assess the change in mean seated systolic blood pressure from baseline to Week 24.',
      '~ Study Design ⟶ Study Design and Duration',
      '= Eligible participants will be randomized in a 1:1 ratio to Compound X or placebo.',
      '+ Randomization will be stratified by site and baseline blood pressure category.',
      '~ Visits will occur at screening, baseline, and Weeks 2, 4, 8 and 12. ⟶ Visits will occur at screening, baseline, and Weeks 2, 4, 8, 12, 16 and 24.',
      '- An interim analysis is not planned for this study.',
      '= The sponsor will provide study drug in identical blister packs.',
      '= All adverse events must be reported within 24 hours of awareness.',
      '= The investigator is responsible for maintaining accurate source documents.',
      '= Safety Monitoring',
      '= A Data Monitoring Committee will review unblinded safety data every six months.',
      '= Ethics',
      '= The protocol will be approved by an independent ethics committee before enrollment begins.',
      '= This protocol will be conducted in accordance with Good Clinical Practice.',
    ]);
  });

  it('01: 12 → 24 highlights only the number', async () => {
    const r = (await run('01-basic-text')).result;
    expect(changedTexts(r, ['modified'], 'old')).toContain('12');
    const d = Object.values(r.differences).find((x) => x.wordHunks.some((h) => h.new.length === 1 && h.new[0].end - h.new[0].start === 2 && h.old[0]?.end - h.old[0]?.start === 2));
    expect(d?.wordHunks).toHaveLength(1);
  });

  it('06 alignment edge cases', async () => {
    const o = await outline('06-edge-alignment');
    // The deleted pair is the heading AND the paragraph after it.
    expect(o).toContain('- Pharmacogenomics ¶ Not applicable.');
    expect(o.filter((l) => l === '= Not applicable.')).toHaveLength(3);
    expect(o).toContain('⇄< Protocol deviations will be documented in the trial master file.');
    expect(o).toContain('⇄> Protocol deviations will be documented in the trial master file.');
    expect(o.filter((l) => l.startsWith('~(splitJoin)'))).toHaveLength(2);
    for (const c of ['quotes', 'dashes', 'whitespace', 'case']) expect(o.some((l) => l.endsWith(`{${c}}`))).toBe(true);
    // Superscript change is content: no category.
    expect(o.find((l) => l.startsWith('~ Viral load'))).not.toMatch(/\{/);
    expect(o.filter((l) => l.includes('{emptyParagraph}'))).toHaveLength(2);
  });

  it('06: a complete rewrite is one whole replacement; a long paragraph highlights only the number', async () => {
    const r = (await run('06-edge-alignment')).result;
    const rewrite = Object.values(r.differences).find((d) => d.kind === 'modified' && d.wordHunks.length === 1 && d.wordHunks[0].old[0]?.start === 0 && d.wordHunks[0].new[0]?.start === 0);
    expect(rewrite).toBeTruthy();
    expect(changedTexts(r, ['modified'], 'new')).toContain('10');
  });

  it('02 lists: inserted item is not a modification of the following ones; move detected', async () => {
    const o = await outline('02-lists');
    expect(o).toContain('+ Diagnosis of essential hypertension for at least 3 months.');
    expect(o).toContain('= Seated systolic blood pressure between 140 and 179 mmHg.');
    expect(o).toContain('⇄> Known hypersensitivity to Compound X.');
    expect(o).toContain('- History of stroke or myocardial infarction within 6 months.');
    // A new level-1 heading starts its own difference.
    expect(o).toContain('+ Concomitant Medications ¶ Stable doses of lipid-lowering therapy are permitted.');
  });

  it('03 tables', async () => {
    const o = (await outline('03-tables')).filter((l) => !l.startsWith('= '));
    expect(o).toEqual([
      // Same columns: row by row; each added / removed row and each changed cell is its own choice.
      '[table pair]',
      '  row= Cohort | Dose | Participants',
      '  row= 1 | 10 mg | 12',
      '  row+ 1b | 15 mg | 6',
      '  row~ 2 | 20 mg | 18',
      '    ~ 12 ⟶ 18',
      '  row- 3 | 40 mg | 12',
      '  row= 4 | 80 mg | 12',
      '  row+ 5 | 160 mg | 6',
      // Column added; merged cell extended: whole-table choice (decision 6).
      '~(tableStructure) [table 5×4] ⟶ [table 5×5]',
      '~(tableStructure) [table 6×3] ⟶ [table 8×3]',
      // Block type changed at the same place: one replacement (design-review §6.1 G5).
      '~(replaced) Sponsor: Acme Pharma Ltd. ¶ CRO: Beta Research Inc. ⟶ [table 3×2]',
      '~(replaced) [table 3×2] ⟶ Abbreviations are defined at first use in the text.',
      // Nested table compared inside its cell.
      '[table pair]',
      '  row= Item | Details',
      '  row~ Visit windows | Windows are relative to baseline: [table 2×2] ',
      '    [table pair]',
      '      row= Visit | Window',
      '      row~ Week 4 | +/- 5 days',
      '        ~ +/- 3 days ⟶ +/- 5 days',
    ]);
  });

  it('03: whole-table differences still highlight the changed cells', async () => {
    const r = (await run('03-tables')).result;
    const ts = Object.values(r.differences).filter((d) => d.kind === 'tableStructure');
    expect(ts.every((d) => d.wordHunks.length > 0)).toBe(true);
    const newText = changedTexts(r, ['tableStructure'], 'new');
    expect(newText).toEqual(expect.arrayContaining(['24', 'Week 4', 'Neutrophils', 'umol/L']));
  });

  it('04: rows inserted and deleted by tracked changes', async () => {
    const o = await outline('04-tracked-changes');
    expect(o).toContain('  row+ Run-in | -7');
    expect(o).toContain('  row- Week 12 | 84');
  });

  it('04 tracked changes: compared after accepting', async () => {
    const o = await outline('04-tracked-changes');
    expect(o).toContain('~ The study will enroll 120 participants across 15 sites. ⟶ The study will enroll 150 participants across 15 sites.');
    expect(o).toContain('= This paragraph was inserted by a tracked change in the old version.');
    expect(o.some((l) => l.startsWith('~(splitJoin) The washout period'))).toBe(true);
    expect(o).toContain('⇄> Unblinding procedures are described in Section 9.');
    expect(o).toContain('= Statistical Considerations');
  });

  it('07 long document: every listed change is found', async () => {
    const r = (await run('07-long-document')).result;
    const lines = readFileSync(join(process.cwd(), 'testdocs/docs/07-long-document_changes.txt'), 'utf8').split('\n').filter(Boolean);
    const prefix = (l: string) => /'(.*?)\.\.\.'/.exec(l)![1];
    const newWords = changedTexts(r, ['modified'], 'new').join(' ');
    const inserted = blockTexts(r, 'inserted', 'new');
    const deleted = blockTexts(r, 'deleted', 'old');
    const moved = blockTexts(r, 'moved', 'new');
    const missing: string[] = [];
    for (const l of lines) {
      if (l.startsWith('MODIFY')) {
        const word = /-> '(.*)'$/.exec(l)![1].replace(/\.$/, '');
        if (!newWords.includes(word)) missing.push(l);
      } else if (l.startsWith('INSERT')) {
        // "after paragraph starting …": the inserted paragraph itself is random text; count them.
      } else if (l.startsWith('DELETE')) {
        if (!deleted.some((t) => t.startsWith(prefix(l)))) missing.push(l);
      } else if (l.startsWith('MOVE')) {
        if (!moved.some((t) => t.startsWith(prefix(l)))) missing.push(l);
      } else if (l.startsWith('CELL')) {
        const [, from, to] = /: '(.*)' -> '(.*)'$/.exec(l)!;
        if (!(to ? newWords.includes(to) : changedTexts(r, ['modified'], 'old').includes(from))) missing.push(l);
      }
    }
    expect(missing).toEqual([]);
    expect(inserted.length).toBeGreaterThanOrEqual(lines.filter((l) => l.startsWith('INSERT')).length);
    expect(Object.values(r.differences).filter((d) => d.kind === 'moved')).toHaveLength(2);
    const rowsAdded = Object.values(r.differences).filter((d) => d.kind === 'inserted' && d.new.unit === 'row');
    expect(rowsAdded).toHaveLength(lines.filter((l) => l.startsWith('ROW+')).length);
    // Nothing reported beyond the list: 40 word edits + 10 cell edits.
    expect(Object.values(r.differences).filter((d) => d.kind === 'modified')).toHaveLength(50);
    expect(Object.values(r.differences).some((d) => d.kind === 'tableStructure')).toBe(false);
  });
});
