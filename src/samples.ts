// Sample pairs on the select screen: the testdocs pairs 01–07, built into the
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
