// Sample pairs on the select screen: the testdocs pairs 01–18, built into the
// page so a click compares real files with the real engine. Only
// testdocs/docs/*.docx is included — never the "real examples" subfolder.
// The hand-written mock pairs stay available for UI work with ?mock in the URL.

const FILES = import.meta.glob<string>('../testdocs/docs/*.docx', { query: '?url', import: 'default', eager: true });

export interface SamplePair {
  id: string;
  title: string;
  description: string;
  oldName: string;
  newName: string;
}

export const SAMPLE_PAIRS: SamplePair[] = [
  {
    id: '01',
    title: '01 · Basic text',
    description: 'Number change, rewrite, inserted and deleted paragraphs; formatting-only changes produce no difference.',
  },
  {
    id: '02',
    title: '02 · Lists',
    description: 'Inserted list item (later numbers shift, not shown as a change), moved item, typed → automatic numbers.',
  },
  {
    id: '03',
    title: '03 · Tables',
    description: 'Cell edits, row insert/delete, column change as a whole-table choice, paragraphs ↔ table, nested table.',
  },
  {
    id: '04',
    title: '04 · Existing tracked changes',
    description: 'Both files contain pending tracked changes; they are compared as if all were accepted.',
  },
  {
    id: '05',
    title: '05 · Not-compared elements',
    description: 'Placeholders, table of contents and date field, footnotes, comments, a new landscape section.',
  },
  {
    id: '06',
    title: '06 · Alignment edge cases',
    description: 'Repeated paragraphs, split and joined paragraphs, a move, whitespace / quote / dash / case changes.',
  },
  {
    id: '07',
    title: '07 · Long document',
    description: '60 chapters, about 150 pages, 60 tables, with about 75 changes spread through it.',
  },
  {
    id: '08',
    title: '08 · Export formatting',
    description: 'Mixed formatting, superscript and hidden text, comments, a custom style, localized style names, lists to restore.',
  },
  {
    id: '09',
    title: '09 · Sections, headers, footers',
    description: 'Cover page, two-column and landscape sections, a removed section, odd/even headers, page X of Y footers.',
  },
  {
    id: '10',
    title: '10 · Complex tables',
    description: 'Merged headers, vertical merges, a removed column, rich cells, nested rows, long definitions, split table.',
  },
  {
    id: '11',
    title: '11 · Fields and content controls',
    description: 'Check box, drop-down, date and text controls, SEQ captions, cross-references, links, notes, equation, text box.',
  },
  {
    id: '12',
    title: '12 · Tracked changes and comments',
    description: 'Pending revisions by several authors in text, lists, tables and the header; overlapping and multi-paragraph comments.',
  },
  {
    id: '13',
    title: '13 · Reordering and repetition',
    description: 'A chapter moved, swapped paragraphs, a reordered list, repeated boilerplate and near-identical lines.',
  },
  {
    id: '14',
    title: '14 · Characters and normalisation',
    description: 'Symbols, accents, CJK and emoji; no-break and zero-width spaces, dashes, quotes, soft and no-break hyphens.',
  },
  {
    id: '15',
    title: '15 · Realistic SOP v1.0 → v2.0',
    description: 'A complete procedure document with history, TOC, definitions, steps, figure, footnote, landscape appendix.',
  },
  {
    id: '16',
    title: '16 · Formatting',
    description: 'Formatting-only changes: bold, colour, font, alignment, spacing, list type, table style; style vs direct formatting.',
  },
  {
    id: '17',
    title: '17 · Notes, links and pictures',
    description: 'Old paragraphs with footnotes, links, a picture, an equation and cross-references to bring back; header, text box, link address changes.',
  },
  {
    id: '18',
    title: '18 · Comments',
    description: 'Comments in both files: the same, reworded, on changed text, only in the old file, only in the new file.',
  },
].flatMap((p) => {
  const base = Object.keys(FILES).find((k) => k.includes(`/${p.id}-`) && k.endsWith('_old.docx'));
  if (!base) return [];
  const stem = base.slice(base.lastIndexOf('/') + 1, -'_old.docx'.length);
  return [{ ...p, oldName: `${stem}_old.docx`, newName: `${stem}_new.docx` }];
});

/** The embedded files of a sample pair (inlined as data URLs in the single-file build). */
export async function sampleFiles(p: SamplePair): Promise<{ old: File; new: File }> {
  const file = async (name: string) => {
    const url = FILES[`../testdocs/docs/${name}`];
    const bytes = url.startsWith('data:') ? decodeDataUrl(url) : new Uint8Array(await (await fetch(url)).arrayBuffer());
    return new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  };
  return { old: await file(p.oldName), new: await file(p.newName) };
}

/** Decode without fetch(): some hosts' content policies block fetching data: URLs. */
function decodeDataUrl(url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
