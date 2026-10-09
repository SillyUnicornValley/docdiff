// @vitest-environment jsdom
// Reader checks against the expectations in testdocs/README.md.

import { describe, expect, it } from 'vitest';
import type { Block, ParagraphBlock, PlaceholderBlock, TableBlock } from '../../model/document';
import { forEachParagraph } from '../../model/docIndex';
import { flattenParagraph } from '../../model/flatten';
import { testdoc } from '../testing/files';
import { parseDocx } from './parseDocx';

const parse = (name: string) => parseDocx(testdoc(name), name.includes('_old') ? 'old' : 'new', name);
const texts = (blocks: Block[]) => {
  const out: string[] = [];
  forEachParagraph(blocks, (p) => out.push(flattenParagraph(p).text));
  return out;
};
const paras = (blocks: Block[]) => blocks.filter((b): b is ParagraphBlock => b.kind === 'paragraph');
const find = (blocks: Block[], start: string) => {
  let hit: ParagraphBlock | undefined;
  forEachParagraph(blocks, (p) => {
    if (!hit && flattenParagraph(p).text.startsWith(start)) hit = p;
  });
  if (!hit) throw new Error(`No paragraph starts with "${start}"`);
  return hit;
};

describe('01 basic text', () => {
  it('reads split runs, bookmarks and proofing marks as one plain text run', async () => {
    const { doc } = await parse('01-basic-text_new.docx');
    const p = find(doc.blocks, 'All adverse events');
    expect(p.content).toEqual([{ type: 'text', text: 'All adverse events must be reported within 24 hours of awareness.' }]);
  });
  it('recognises title and heading levels', async () => {
    const { doc } = await parse('01-basic-text_new.docx');
    expect(paras(doc.blocks)[0].role).toEqual({ type: 'title' });
    expect(find(doc.blocks, 'Safety Monitoring').role).toEqual({ type: 'heading', level: 3 });
  });
  it('fingerprints the file bytes with SHA-256', async () => {
    const { doc } = await parse('01-basic-text_old.docx');
    expect(doc.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('02 lists', () => {
  it('computes automatic numbers like Word', async () => {
    const { doc } = await parse('02-lists_new.docx');
    const label = (s: string) => find(doc.blocks, s).numbering?.label;
    expect(label('Diagnosis of essential')).toBe('2.');
    expect(label('Body mass index')).toBe('5.');
    expect(label('Women of childbearing')).toBe('a.');
    expect(label('Participation in another')).toBe('3.');
    expect(label('Concomitant Medications')).toBe('4');
    // The procedures list continues list 1 on purpose (build_testdocs.py).
    expect(label('Obtain informed consent')).toBe('6.');
  });
  it('shows bullets and keeps typed numbers as text', async () => {
    const { doc } = await parse('02-lists_old.docx');
    expect(find(doc.blocks, 'Other antihypertensive').numbering).toMatchObject({ format: 'bullet', label: '•' });
    expect(find(doc.blocks, '1) Obtain').role).toEqual({ type: 'body' });
    expect(find(doc.blocks, 'Women of childbearing').role).toEqual({ type: 'listItem', level: 1 });
  });
});

describe('03 tables', () => {
  it('reads merged cells, spans, header rows and nested tables', async () => {
    const { doc } = await parse('03-tables_new.docx');
    const tables = doc.blocks.filter((b): b is TableBlock => b.kind === 'table');
    expect(tables.map((t) => t.gridColumns)).toEqual([3, 5, 3, 2, 2]);
    const lab = tables[2];
    expect(lab.rows[0].isHeader).toBe(true);
    expect(lab.rows[1].cells[0].vMerge).toBe('restart');
    expect(lab.rows[2].cells[0].vMerge).toBe('continue');
    expect(lab.rows.at(-1)!.cells[0].gridSpan).toBe(3);
    const nested = tables[4].rows[1].cells[1].blocks.find((b) => b.kind === 'table') as TableBlock;
    expect(texts(nested.rows[1].cells[1].blocks)).toEqual(['+/- 5 days']);
  });
});

describe('04 existing tracked changes', () => {
  it('compares as if all revisions were accepted', async () => {
    const { doc, revisionCount } = await parse('04-tracked-changes_new.docx');
    const t = texts(doc.blocks);
    expect(t).toContain('The study will enroll 150 participants across 15 sites.');
    expect(t).toContain('Dosing will be once daily with food.');
    // Deleted paragraph mark: two paragraphs joined.
    expect(t).toContain('The washout period is 2 weeks. Participants must discontinue prior therapy.');
    // Move: only at the new position, never twice.
    expect(t.filter((x) => x.startsWith('Unblinding procedures')).length).toBe(1);
    expect(t.indexOf('Unblinding procedures are described in Section 9.')).toBeGreaterThan(t.indexOf('Emergency unblinding is available through the IRT system.'));
    // Rows: inserted kept, deleted removed.
    expect(t).toContain('Run-in');
    expect(t).not.toContain('Week 12');
    expect(t).toContain('Samples will be stored at -70 C for up to 10 years.');
    // Paragraph-property revision: the current style (Heading 2) is used.
    expect(find(doc.blocks, 'Statistical Considerations').role).toEqual({ type: 'heading', level: 2 });
    expect(revisionCount).toBeGreaterThan(0);
  });
  it('accepts the old file revisions too', async () => {
    const { doc } = await parse('04-tracked-changes_old.docx');
    const t = texts(doc.blocks);
    expect(t).toContain('The study will enroll 120 participants across 15 sites.');
    expect(t).toContain('This paragraph was inserted by a tracked change in the old version.');
    expect(t.join('\n')).not.toMatch(/delText/);
  });
});

describe('05 not-compared elements and comments', () => {
  it('collapses the table of contents into one placeholder', async () => {
    const { doc } = await parse('05-uncompared-and-comments_new.docx');
    const toc = doc.blocks.find((b): b is PlaceholderBlock => b.kind === 'placeholder' && b.element === 'toc')!;
    expect(texts(toc.children!)).toEqual(['Treatment\t1', 'Measurements\t1', 'Safety Reporting Requirements\t2', 'Appendix A. Detailed Schedule\t3']);
    expect(toc.fingerprint).toBeTruthy();
  });
  it('reads fields, footnotes, hyperlinks, images, hidden text and comment markers', async () => {
    const { doc } = await parse('05-uncompared-and-comments_new.docx');
    expect(find(doc.blocks, 'Version date').content[1]).toMatchObject({ type: 'field', fieldType: 'DATE', result: [{ text: '2026-09-15' }] });
    expect(find(doc.blocks, 'Serious adverse events').content[1]).toMatchObject({ type: 'field', fieldType: 'REF' });
    expect(find(doc.blocks, 'Blood pressure will').content[1]).toMatchObject({ type: 'placeholder', kind: 'footnoteRef', label: 'Footnote 1' });
    expect(find(doc.blocks, 'Full prescribing').content[1]).toMatchObject({ type: 'hyperlink', content: [{ text: 'sponsor website' }] });
    expect(find(doc.blocks, 'Measurements are taken').content[1]).toMatchObject({ marks: { hidden: true } });
    expect(find(doc.blocks, 'Treatment duration').content).toMatchObject([{ text: 'Treatment duration is ' }, { type: 'comment', author: 'Reviewer B' }, { text: '24 weeks.' }]);
    let image = false;
    forEachParagraph(doc.blocks, (p) => (image ||= p.content.some((i) => i.type === 'placeholder' && i.kind === 'image' && !!i.fingerprint)));
    expect(image).toBe(true);
    expect(doc.commentCount).toBe(3);
    expect(Object.keys(doc.partFingerprints).sort()).toEqual(['footnotes', 'hyperlinkUrls', 'images', 'properties']);
  });
  it('shows comments of the old file marked as old (decision 46)', async () => {
    const { doc } = await parse('05-uncompared-and-comments_old.docx');
    const comments: unknown[] = [];
    forEachParagraph(doc.blocks, (p) => comments.push(...p.content.filter((i) => i.type === 'comment')));
    expect(comments).toEqual([{ type: 'comment', author: 'Carol', preview: expect.any(String), fromOld: true }]);
    expect(doc.comments).toMatchObject([{ author: 'Carol', anchor: '12 weeks' }]);
  });
  it('reads sections and header fingerprints', async () => {
    const [o, n] = [await parse('05-uncompared-and-comments_old.docx'), await parse('05-uncompared-and-comments_new.docx')];
    expect(n.doc.sections.length).toBe(2);
    expect(find(n.doc.blocks, 'End of main protocol').sectionBreak).toBe(true);
    const appendix = paras(n.doc.blocks).find((p) => p.role.type === 'heading' && flattenParagraph(p).text.startsWith('Appendix A'))!;
    expect(n.doc.sections[1].firstBlockId).toBe(appendix.id);
    expect(o.doc.sections[0].headers.default!.fingerprint).not.toBe(n.doc.sections[0].headers.default!.fingerprint);
  });
});

describe('06 alignment edge cases', () => {
  it('keeps superscript and soft line breaks as content', async () => {
    const { doc } = await parse('06-edge-alignment_new.docx');
    expect(find(doc.blocks, 'Viral load').content).toContainEqual({ type: 'text', text: '5', marks: { superscript: true } });
    expect(flattenParagraph(find(doc.blocks, 'Contact:')).text).toBe('Contact:\nDr. Jane Smith, Medical Monitor');
  });
});

describe('errors', () => {
  it('rejects files that are not .docx', async () => {
    const bytes = new TextEncoder().encode('hello').buffer as ArrayBuffer;
    await expect(parseDocx(bytes, 'old', 'x.docx')).rejects.toThrow(/not a Word \.docx/);
  });
});
