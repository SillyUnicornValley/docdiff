// @vitest-environment jsdom
// "Use old" is blocked when a difference covers only part of a multi-paragraph
// field or content control (spec §7.6, stage2-design §3.3).

import { describe, expect, it } from 'vitest';
import { compareFiles } from './index';
import { makeDocx, p } from './testing/makeDocx';

const compare = async (oldBody: string, newBody: string) =>
  (await compareFiles({ name: 'o.docx', data: await makeDocx(oldBody) }, { name: 'n.docx', data: await makeDocx(newBody) })).result;

const sdt = (inner: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const reasons = (r: Awaited<ReturnType<typeof compare>>) => Object.values(r.differences).map((d) => (d.useOld.available ? 'ok' : d.useOld.reason));

describe('Use old boundaries', () => {
  it('blocks a change to one paragraph of a multi-paragraph content control', async () => {
    const r = await compare(
      p('Intro.') + sdt(p('Dose is 10 mg once daily.') + p('Take with water.')),
      p('Intro.') + sdt(p('Dose is 20 mg once daily.') + p('Take with water.')),
    );
    expect(reasons(r)).toEqual(['contentControlBoundary']);
  });

  it('allows it when the content control has a single paragraph', async () => {
    const r = await compare(p('Intro.') + sdt(p('Dose is 10 mg once daily.')), p('Intro.') + sdt(p('Dose is 20 mg once daily.')));
    expect(reasons(r)).toEqual(['ok']);
  });

  it('blocks a change inside a field whose result spans paragraphs', async () => {
    // The edited words are ordinary text in the paragraph where the field starts.
    const field = (a: string) =>
      `<w:p><w:r><w:t xml:space="preserve">${a} </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> INCLUDETEXT "x.docx" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Included text.</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Second line.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    const r = await compare(p('Intro.') + field('Dose is 10 mg.'), p('Intro.') + field('Dose is 20 mg.'));
    expect(reasons(r)).toContain('fieldBoundary');
  });

  it('allows a plain paragraph change next to a content control', async () => {
    const r = await compare(p('Dose is 10 mg.') + sdt(p('A.') + p('B.')), p('Dose is 20 mg.') + sdt(p('A.') + p('B.')));
    expect(reasons(r)).toEqual(['ok']);
  });
});

describe('unsupported revision types (spec §5)', () => {
  it('are accepted, reported with type and location, and the comparison continues', async () => {
    const cellIns = `<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:cellIns w:id="1" w:author="A"/></w:tcPr>${p('Added cell')}</w:tc></w:tr></w:tbl>`;
    const sectChange = `<w:p><w:pPr><w:sectPr><w:sectPrChange w:id="2" w:author="A"><w:sectPr/></w:sectPrChange></w:sectPr></w:pPr><w:r><w:t>End of part one.</w:t></w:r></w:p>`;
    const r = await compare(p('Intro.'), p('Intro.') + cellIns + sectChange);
    expect(r.scope.unsupportedRevisions).toEqual([
      { side: 'new', type: 'Inserted table cell', location: 'Table' },
      { side: 'new', type: 'Section and page setup change', location: 'Paragraph "End of part one."' },
    ]);
    expect(r.order.length).toBeGreaterThan(0);
    expect(r.scope.pendingRevisionsInNew).toBe(2);
  });
});

describe('large changed regions (stage2-design M5)', () => {
  it('pairs every paragraph when a term changed in all of them', async () => {
    const words = ['dose', 'visit', 'sample', 'safety', 'review', 'site', 'data', 'report', 'week', 'blood'];
    const para = (i: number, sponsor: string) =>
      p(`${sponsor} ${Array.from({ length: 12 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ')} item ${i}.`);
    const n = 300; // 300 × 300 cells: above the full-table limit, so the diagonal band is used
    const oldBody = Array.from({ length: n }, (_, i) => para(i, 'J&amp;J Innovative Medicine')).join('');
    const newBody = Array.from({ length: n }, (_, i) => para(i, 'J&amp;J IM')).join('');
    const r = await compare(oldBody, newBody);
    const kinds = Object.values(r.differences).map((d) => d.kind);
    expect(kinds.filter((k) => k === 'modified')).toHaveLength(n);
    expect(kinds.filter((k) => k !== 'modified')).toEqual([]);
  });
});
