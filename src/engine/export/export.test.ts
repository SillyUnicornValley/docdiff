// @vitest-environment jsdom
// Clean export (Stage 3) on every testdocs pair: for several choice patterns
// the exported file, read again, must match the final-result preview.
// Set DOCDIFF_EXPORT_DIR to also write the exported files (for XSD validation,
// see docs/stage3-design.md §6).

/// <reference types="node" />
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiffResult } from '../../model/diff';
import type { Choice } from '../../model/review';
import { parseDocx } from '../docx/parseDocx';
import { compareFiles } from '../index';
import { makeDocx, p } from '../testing/makeDocx';
import { testdoc } from '../testing/files';
import { blockKey } from '../compare/keys';
import { exportClean } from './exportDocx';

const PAIRS = ['01-basic-text', '02-lists', '03-tables', '04-tracked-changes', '05-uncompared-and-comments', '06-edge-alignment', '07-long-document',
  '08-export-formatting', '09-sections-headers', '10-complex-tables', '11-fields-and-controls', '12-tracked-and-comments', '13-reorder-and-repeats',
  '14-unicode-and-normalisation', '15-realistic-sop'];
const REAL = ['real examples/77242113PSO3001_Data Management Plan_v1.01_13MAR2025.docx', 'real examples/77242113PSO3001_Data Management Plan_V3.02_16Jun2026.docx'];

const files = (pair: string) => ({
  old: { name: `${pair}_old.docx`, data: testdoc(`${pair}_old.docx`) },
  new: { name: `${pair}_new.docx`, data: testdoc(`${pair}_new.docx`) },
});

/** Choice patterns: every difference new / old / alternating / seeded random. */
function patterns(r: DiffResult): [string, Record<string, Choice>][] {
  const ids = r.order.filter((id) => !r.differences[id].informational && r.differences[id].useOld.available);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (f: (id: string, i: number) => Choice) => Object.fromEntries(ids.map((id, i) => [id, f(id, i)]));
  return [
    ['all new', {}],
    ['all old', pick(() => 'old')],
    ['alternating', pick((_, i) => (i % 2 ? 'old' : 'new'))],
    ['random', pick(() => (rnd() < 0.5 ? 'old' : 'new'))],
  ];
}

const outDir = process.env.DOCDIFF_EXPORT_DIR;
if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

async function checkPair(name: string, f: ReturnType<typeof files>) {
  const { result } = await compareFiles(f.old, f.new);
  for (const [label, choices] of patterns(result)) {
    const out = await exportClean(f.old, f.new, result, choices);
    if (!out.check.ok) console.log(name, label, JSON.stringify(out.check, null, 1));
    expect({ label, ...out.check }).toMatchObject({ label, ok: true });
    if (outDir) writeFileSync(join(outDir, `${name.replace(/[^\w-]+/g, '_')}__${label.replace(' ', '-')}.docx`), out.bytes);
  }
}

describe('clean export matches the final-result preview', () => {
  it.each(PAIRS)('%s', async (pair) => checkPair(pair, files(pair)), 60000);
  it('real example (Data Management Plan)', async () => {
    await checkPair('real-dmp', { old: { name: 'old.docx', data: testdoc(REAL[0]) }, new: { name: 'new.docx', data: testdoc(REAL[1]) } });
  }, 60000);
});

/** Export with the given difference ids (by a predicate on the result) set to old; return the exported document.xml. */
async function exportWith(oldXml: string, newXml: string, pick: (r: DiffResult) => string[] = (r) => r.order) {
  const o = { name: 'o.docx', data: await makeDocx(oldXml) };
  const n = { name: 'n.docx', data: await makeDocx(newXml) };
  const { result } = await compareFiles(o, n);
  const choices = Object.fromEntries(pick(result).map((id) => [id, 'old' as Choice]));
  const out = await exportClean(o, n, result, choices);
  const parsed = await parseDocx(out.bytes.buffer as ArrayBuffer, 'new', 'x');
  const xml = new XMLSerializer().serializeToString(parsed.xml);
  return { out, xml, parsed, result };
}

const run = (t: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;

describe('clean export details', () => {
  it('keeps the formatting of the replaced word and of unchanged text', async () => {
    const { out, xml } = await exportWith(
      p('Participants will be treated for 12 weeks in total.'),
      `<w:p>${run('Participants will be treated for ', '<w:i/>')}${run('24', '<w:b/>')}${run(' weeks in total.')}</w:p>`,
    );
    expect(out.check.ok).toBe(true);
    expect(xml).toContain('<w:b/></w:rPr><w:t xml:space="preserve">12</w:t>');
    expect(xml).toContain('<w:i/></w:rPr><w:t xml:space="preserve">Participants will be treated for </w:t>');
  });

  it('keeps a comment range around replaced text', async () => {
    const cmt = '<w:commentRangeStart w:id="0"/>' + run('24 weeks') + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>';
    const { xml } = await exportWith(p('Treatment duration is 12 weeks.'), `<w:p>${run('Treatment duration is ')}${cmt}${run('.')}</w:p>`);
    expect(xml).toMatch(/<w:commentRangeStart w:id="0"\/><w:r><w:t xml:space="preserve">12 weeks<\/w:t><\/w:r><w:commentRangeEnd/);
  });

  it('brings superscript back with the old text', async () => {
    const { out, xml } = await exportWith(`<w:p>${run('Area in m')}${run('2', '<w:vertAlign w:val="superscript"/>')}</w:p>`, p('Area in m2'));
    expect(out.check.ok).toBe(true);
    expect(xml).toContain('<w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">2</w:t>');
  });

  it('moves bookmarks and comment markers out of a removed paragraph', async () => {
    const old = p('Alpha paragraph stays.') + p('Omega paragraph stays.');
    const added = `<w:p><w:bookmarkStart w:id="5" w:name="_Ref1"/><w:commentRangeStart w:id="0"/>${run('A brand new sentence added here.')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:bookmarkEnd w:id="5"/></w:p>`;
    const { out, xml } = await exportWith(old, p('Alpha paragraph stays.') + added + p('Omega paragraph stays.'));
    expect(out.check.ok).toBe(true);
    expect(xml).not.toContain('A brand new sentence');
    for (const m of ['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference']) expect(xml).toContain(`<w:${m}`);
  });

  it('keeps the page setup of the kept content when the last section is removed (05)', async () => {
    const f = files('05-uncompared-and-comments');
    const { result } = await compareFiles(f.old, f.new);
    const choices = Object.fromEntries(result.order.filter((id) => result.differences[id].useOld.available && !result.differences[id].informational).map((id) => [id, 'old' as Choice]));
    const out = await exportClean(f.old, f.new, result, choices);
    expect(out.check.ok).toBe(true);
    const parsed = await parseDocx(out.bytes.buffer as ArrayBuffer, 'new', 'x');
    const body = parsed.xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'body')[0];
    const finalSect = new XMLSerializer().serializeToString(body.lastElementChild!);
    expect(finalSect).not.toContain('landscape');
    expect(parsed.doc.sections).toHaveLength(1);
  });

  it('keeps the landscape appendix in its own section when only the break paragraph is removed (05)', async () => {
    const f = files('05-uncompared-and-comments');
    const { result } = await compareFiles(f.old, f.new);
    const breakDiff = result.order.find((id) => {
      const d = result.differences[id];
      return d.kind === 'inserted' && d.new.ids.some((nid) => result.new.sections.some((s) => s.breakBlockId === nid));
    })!;
    const out = await exportClean(f.old, f.new, result, { [breakDiff]: 'old' });
    expect(out.check.ok).toBe(true);
    const parsed = await parseDocx(out.bytes.buffer as ArrayBuffer, 'new', 'x');
    expect(parsed.doc.sections).toHaveLength(2);
  });

  it('restores a deleted heading with the new file’s heading style and joins a neighbouring list', async () => {
    const f = files('02-lists');
    const { result } = await compareFiles(f.old, f.new);
    const deleted = result.order.filter((id) => result.differences[id].kind === 'deleted');
    const out = await exportClean(f.old, f.new, result, Object.fromEntries(deleted.map((id) => [id, 'old' as Choice])));
    expect(out.check.ok).toBe(true);
    const parsed = await parseDocx(out.bytes.buffer as ArrayBuffer, 'new', 'x');
    const restored = parsed.doc.blocks.find((b) => b.kind === 'paragraph' && blockKey(b).includes('History of stroke'));
    expect(restored && restored.kind === 'paragraph' && restored.role.type).toBe('listItem');
  });

  it('sets “update fields on open” and leaves no tracked changes (04)', async () => {
    const f = files('04-tracked-changes');
    const { result } = await compareFiles(f.old, f.new);
    const out = await exportClean(f.old, f.new, result, {});
    expect(out.check.ok).toBe(true);
    const parsed = await parseDocx(out.bytes.buffer as ArrayBuffer, 'new', 'x');
    expect(parsed.revisionCount).toBe(0);
    const settings = await parsed.pkg.readText('word/settings.xml');
    expect(settings).toContain('<w:updateFields w:val="true"/>');
  });

  it('refuses files that are not the compared ones', async () => {
    const f = files('01-basic-text');
    const { result } = await compareFiles(f.old, f.new);
    const other = files('02-lists');
    await expect(exportClean(other.old, other.new, result, {})).rejects.toThrow(/not the ones that were compared/);
  });
});

describe('clean export of 08 (styles, lists, formatting)', () => {
  it('maps styles by name, attaches lists to neighbours, keeps simple emphasis', async () => {
    const f = files('08-export-formatting');
    const { result } = await compareFiles(f.old, f.new);
    const all = Object.fromEntries(result.order.filter((id) => result.differences[id].useOld.available).map((id) => [id, 'old' as Choice]));
    const out = await exportClean(f.old, f.new, result, all);
    expect(out.check.ok).toBe(true);
    const parsed = await parseDocx(out.bytes.buffer as ArrayBuffer, 'new', 'x');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const para = (text: string) => Array.from(parsed.xml.getElementsByTagNameNS(W, 'p')).find((p) => (p.textContent ?? '').startsWith(text))!;
    const xml = (text: string) => new XMLSerializer().serializeToString(para(text));
    expect(xml('Retention Period')).toContain('w:val="Ueberschrift2"'); // localized heading id found by name
    expect(xml('Record every dose.')).toContain('<w:numId w:val="2"/>'); // joins the neighbouring list
    expect(xml('You feel unwell.')).not.toContain('numPr'); // its list exists only in the old file
    expect(xml('Count the tablets.')).toContain('<w:numId w:val="5"/>'); // same list definition in both files
    const note = xml('Note:');
    expect(note).not.toContain('pStyle'); // "Note" style is not in the new file → default style
    expect(note).toContain('<w:b/>'); // simple emphasis kept
    expect(note).not.toContain('w:color'); // colours and fonts dropped
    expect(xml('The sponsor must notify')).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">10 business days/);
  });
});

describe('clean export of 09 and 12', () => {
  it('09: dropping the new last section keeps the landscape settings of the section before it', async () => {
    const f = files('09-sections-headers');
    const { result } = await compareFiles(f.old, f.new);
    const appendix = result.order.find((id) => describeIds(result, id).includes('Appendix B'))!;
    const out = await exportClean(f.old, f.new, result, { [appendix]: 'old' });
    expect(out.check.ok).toBe(true);
    const parsed = await parseDocx(out.bytes.buffer as ArrayBuffer, 'new', 'x');
    const body = parsed.xml.getElementsByTagNameNS(W, 'body')[0];
    expect(new XMLSerializer().serializeToString(body.lastElementChild!)).toContain('w:orient="landscape"');
    expect(parsed.doc.sections).toHaveLength(result.new.sections.length - 1);
  });

  it('12: no tracked changes remain anywhere, and the new comments are kept', async () => {
    const f = files('12-tracked-and-comments');
    const { result } = await compareFiles(f.old, f.new);
    const out = await exportClean(f.old, f.new, result, {});
    expect(out.check.ok).toBe(true);
    const parsed = await parseDocx(out.bytes.buffer as ArrayBuffer, 'new', 'x');
    for (const path of Object.keys(parsed.pkg.zip.files).filter((p) => /^word\/(document|header\d*|footnotes|comments)\.xml$/.test(p))) {
      const xml = (await parsed.pkg.readText(path))!;
      expect(xml, path).not.toMatch(/<w:(ins|del|moveFrom|moveTo|cellIns|rPrChange|pPrChange) /);
    }
    expect(parsed.doc.commentCount).toBe(6);
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** Text of the blocks a difference covers on either side. */
function describeIds(r: DiffResult, id: string): string {
  const d = r.differences[id];
  const text = (side: 'old' | 'new') => d[side].ids.map((x) => JSON.stringify(r[side].blocks.find((b) => b.id === x) ?? '')).join(' ');
  return `${text('old')} ${text('new')}`;
}
