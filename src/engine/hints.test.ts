// @vitest-environment jsdom
// Heading level and numbering hints, and "moved and text changed" (decisions 37–38), on the testdocs.

import { describe, expect, it } from 'vitest';
import { structureHints } from '../model/hints';
import { testdoc } from './testing/files';
import { compareFiles } from './index';

const run = (pair: string) =>
  compareFiles({ name: `${pair}_old.docx`, data: testdoc(`${pair}_old.docx`) }, { name: `${pair}_new.docx`, data: testdoc(`${pair}_new.docx`) }).then((o) => o.result);
const fmt = (c: { oldLabel: string; newLabel: string; text: string }) => `${c.oldLabel} → ${c.newLabel}: ${c.text}`;
const show = (pair: string) => run(pair).then((r) => structureHints(r).levels.map(fmt));
const numbering = (pair: string) => run(pair).then((r) => structureHints(r).numbering.map(fmt));

describe('heading level changes (decision 37)', () => {
  it('01: a heading moved down one level is flagged, not a difference', async () => {
    expect(await show('01-basic-text')).toEqual(['Heading 2 → Heading 3: Safety Monitoring']);
  });

  it('12: body text that became a heading (tracked style change) is flagged', async () => {
    expect(await show('12-tracked-and-comments')).toEqual(['Body text → Heading 2: Safety Assessments']);
  });

  it('documents without level changes have none', async () => {
    expect(await show('03-tables')).toEqual([]);
  });
});

describe('moved and text changed (decision 37)', () => {
  it('13: a move with edited words carries word hunks; an unchanged move has none', async () => {
    const r = await run('13-reorder-and-repeats');
    const moves = r.order.map((id) => r.differences[id]).filter((d) => d.kind === 'moved');
    expect(moves.some((d) => d.wordHunks.length > 0)).toBe(true);
    expect(moves.some((d) => d.wordHunks.length === 0)).toBe(true);
  });
});

describe('automatic numbering changes (decision 38)', () => {
  it('02: shifted numbers, bullets turned into numbers and typed numbers turned automatic are flagged', async () => {
    expect(await numbering('02-lists')).toEqual([
      '2. → 3.: Seated systolic blood pressure between 140 and 179 mmHg.', // after the inserted criterion
      '3. → 4.: Able to provide written informed consent.',
      '4. → 5.: Body mass index below 35 kg/m2.',
      '4. → 1.: Known hypersensitivity to Compound X.', // moved to the top
      '• → 1.: Other antihypertensive agents', // bullet list became numbered
      '• → 2.: Systemic corticosteroids',
      '• → 3.: Strong CYP3A4 inhibitors',
      '4 → 5: Study Procedures', // heading number after the inserted section
      'no number → 6.: Obtain informed consent.', // typed "1) " became automatic numbering
      'no number → 7.: Record vital signs.',
      'no number → 8.: Collect blood samples.',
    ]);
  });

  it('a pair without numbering changes has none', async () => {
    expect(await numbering('03-tables')).toEqual([]);
  });
});
