// Stage 3: Clean .docx export (spec §8.4, docs/stage3-design.md).
//
// The base is the NEW file with all its tracked changes accepted. Only the
// differences set to "Use old" change it:
//   modified paragraphs → edited in place (paragraphEdit.ts)
//   old content brought back → imported next to its aligned position (importOld.ts)
//   new content dropped → removed, markers and section breaks protected (structure.ts)
// Everything else — styles, numbering, headers, footers, images, comments —
// is copied unchanged. The exported file is then read again and compared with
// the final-result preview (selfCheck.ts).

import type { Block, NodeId, ParagraphBlock } from '../../model/document';
import type { DiffResult, Difference, RowSegment, Segment } from '../../model/diff';
import { DocIndex } from '../../model/docIndex';
import { buildFinal, effectiveChoice, partOutput } from '../../model/final';
import type { Choice } from '../../model/review';
import { acceptAllRevisions, revisionTotal } from '../docx/acceptRevisions';
import { parseDocx, type ParsedDocx } from '../docx/parseDocx';
import { StyleMap } from '../docx/styles';
import { DocxError, elementChildren, isW, NS, onOff, wChild, wVal } from '../docx/xml';
import { wEl, insertAfter } from './dom';
import { Importer, numberingFormats, styleList } from './importOld';
import { ExportError, ParagraphEditor } from './paragraphEdit';
import { selfCheck, type SelfCheck } from './selfCheck';
import { normaliseSections, removeElements, tidy } from './structure';

export { ExportError };

export interface ExportFile {
  name: string;
  data: ArrayBuffer;
}

export interface ExportResult {
  bytes: Uint8Array<ArrayBuffer>;
  check: SelfCheck;
  /** Differences whose old content was written into the file. */
  usedOld: number;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

function serialize(doc: Document): string {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith('<?xml') ? s : XML_DECL + s;
}

/** Last element of a TOC that starts at `first` (the TOC field may span many paragraphs). */
function tocElements(first: Element): Element[] {
  const out: Element[] = [];
  let depth = 0;
  for (let p: Element | null = first; p; p = p.nextElementSibling) {
    out.push(p);
    for (const f of Array.from(p.getElementsByTagNameNS(NS.w, 'fldChar'))) {
      const t = f.getAttributeNS(NS.w, 'fldCharType');
      if (t === 'begin') depth++;
      else if (t === 'end') depth--;
    }
    if (depth <= 0) break;
  }
  return out;
}

class Exporter {
  private idx: { old: DocIndex; new: DocIndex };
  private removed = new Set<Element>();
  private editor: ParagraphEditor;
  private importer: Importer;
  /** Where the next imported element goes after a given anchor (keeps insertion order). */
  private lastInsertedAfter = new Map<Element, Element>();
  usedOld = new Set<string>();

  constructor(
    private result: DiffResult,
    private choices: Record<string, Choice>,
    private o: ParsedDocx,
    private n: ParsedDocx,
    newStyles: StyleMap,
    importer: Importer,
  ) {
    this.idx = { old: new DocIndex(result.old), new: new DocIndex(result.new) };
    this.importer = importer;
    this.editor = new ParagraphEditor((r) => {
      const rPr = wChild(r, 'rPr');
      const style = wVal(rPr, 'rStyle');
      const m = style ? { ...newStyles.charMarks(style) } : {};
      const va = wVal(rPr, 'vertAlign');
      if (va !== null) {
        m.superscript = va === 'superscript';
        m.subscript = va === 'subscript';
      }
      const vanish = wChild(rPr, 'vanish') ?? wChild(rPr, 'specVanish');
      if (vanish) m.hidden = onOff(vanish);
      return m;
    });
  }

  private el(side: 'old' | 'new', id: NodeId): Element {
    const e = (side === 'old' ? this.o : this.n).source.get(id);
    if (!e) throw new ExportError(`Internal error: no source for ${id}.`);
    return e;
  }

  /** Elements of the new file that a segment occupies, in order. */
  private newEls(s: Segment | RowSegment): Element[] {
    if (s.type === 'equal') {
      if ('oldRowId' in s) return [this.el('new', s.newRowId)];
      return s.new.ids.flatMap((id) => this.blockEls('new', id));
    }
    if (s.type === 'tablePair') return [this.el('new', s.newTableId)];
    if (s.type === 'rowPair') return [this.el('new', s.newRowId)];
    if (s.part === 'from') return [];
    const d = this.result.differences[s.diffId];
    return d.new.ids.flatMap((id) => (d.new.unit === 'row' ? [this.el('new', id)] : this.blockEls('new', id)));
  }

  private blockEls(side: 'old' | 'new', id: NodeId): Element[] {
    const b = this.idx[side].block(id);
    const e = this.el(side, id);
    return b.kind === 'placeholder' && b.element === 'toc' ? tocElements(e) : [e];
  }

  // -------------------------------------------------------------------------

  run() {
    this.container(this.result.segments, this.containerOf(this.n.xml));
    removeElements(this.containerOf(this.n.xml), this.removed);
    this.importer.fixLists();
    const body = this.containerOf(this.n.xml);
    normaliseSections(body);
    tidy(body);
  }

  private containerOf(doc: Document): Element {
    return wChild(doc.documentElement, 'body')!;
  }

  private container(segments: Segment[], container: Element) {
    segments.forEach((s, i) => {
      if (s.type === 'tablePair') this.rows(s.rows, this.el('new', s.newTableId));
      else if (s.type === 'diff') this.diff(s, segments, i, container);
    });
  }

  private rows(rows: RowSegment[], tbl: Element) {
    rows.forEach((r, i) => {
      if (r.type === 'rowPair') for (const c of r.cells) this.container(c.segments, this.el('new', c.newCellId));
      else if (r.type === 'diff') this.diff(r, rows, i, tbl);
    });
  }

  private diff(s: { diffId: string; part: 'whole' | 'from' | 'to' }, siblings: (Segment | RowSegment)[], i: number, container: Element) {
    const d = this.result.differences[s.diffId];
    const choice = effectiveChoice(d, this.choices);
    if (choice !== 'old') return;
    if (!d.useOld.available) throw new ExportError(`Difference ${d.id} cannot use old: ${d.useOld.message}`);
    this.usedOld.add(d.id);
    const out = partOutput(s.part, choice);
    const present = s.part === 'from' ? [] : this.newEls(s as Segment);
    if (out === null) {
      for (const e of present) this.removed.add(e);
      return;
    }
    // out === 'old'
    if (this.inPlace(d)) {
      d.old.ids.forEach((oid, k) => this.editor.rewrite(this.el('new', d.new.ids[k]), this.idx.old.block(oid) as ParagraphBlock));
      return;
    }
    const restored = d.old.ids.flatMap((oid) => this.importBlock(d, oid));
    this.place(restored, siblings, i, container);
    for (const e of present) this.removed.add(e);
  }

  /** Paired paragraphs on both sides: edit the new paragraphs in place. */
  private inPlace(d: Difference): boolean {
    if (d.old.unit !== 'block' || d.old.ids.length !== d.new.ids.length || !d.new.ids.length) return false;
    if (d.kind !== 'modified') return false;
    const isP = (b: Block) => b.kind === 'paragraph';
    return d.old.ids.every((id) => isP(this.idx.old.block(id))) && d.new.ids.every((id) => isP(this.idx.new.block(id)));
  }

  private importBlock(d: Difference, oid: NodeId): Element[] {
    if (d.old.unit === 'row') return [this.importer.import(this.el('old', oid), false)];
    const b = this.idx.old.block(oid);
    if (b.kind === 'placeholder' && b.element !== 'toc') throw new ExportError('This element cannot be brought back.');
    return this.blockEls('old', oid).map((e) => this.importer.import(e, b.kind === 'paragraph'));
  }

  /** Insert old elements where segment i sits: after the previous segment's content, else before the next. */
  private place(els: Element[], siblings: (Segment | RowSegment)[], i: number, container: Element) {
    for (let k = i - 1; k >= 0; k--) {
      const prev = this.newEls(siblings[k]);
      if (!prev.length) continue;
      const anchor = prev[prev.length - 1];
      let ref = this.lastInsertedAfter.get(anchor) ?? anchor;
      for (const e of els) insertAfter(e, ref), (ref = e);
      this.lastInsertedAfter.set(anchor, ref);
      return;
    }
    for (let k = i + 1; k < siblings.length; k++) {
      const next = this.newEls(siblings[k]);
      if (!next.length) continue;
      for (const e of els) next[0].parentNode!.insertBefore(e, next[0]);
      return;
    }
    // Nothing of the new file in this container: append (before the body's final section settings).
    const tail = isW(container, 'body') ? wChild(container, 'sectPr') : null;
    const lastSect = tail ? elementChildren(container).filter((c) => isW(c, 'sectPr')).at(-1)! : null;
    for (const e of els) container.insertBefore(e, lastSect);
  }
}

/** Ask Word to update fields (TOC, cross-references) when the file is opened (spec §8.4). */
const SETTINGS_AFTER_UPDATE_FIELDS = [
  'hdrShapeDefaults', 'footnotePr', 'endnotePr', 'compat', 'docVars', 'rsids', 'mathPr', 'attachedSchema', 'themeFontLang',
  'clrSchemeMapping', 'doNotIncludeSubdocsInStats', 'doNotAutoCompressPictures', 'forceUpgrade', 'captions', 'readModeInkLockDown',
  'smartTagType', 'schemaLibrary', 'shapeDefaults', 'doNotEmbedSmartTags', 'decimalSymbol', 'listSeparator',
];

async function setUpdateFields(pkg: ParsedDocx['pkg']) {
  const path = pkg.partByType('/settings');
  if (!path) return; // No settings part: Word still opens the file; fields refresh on the next update.
  const doc = await pkg.readXml(path);
  if (!doc) return;
  const root = doc.documentElement;
  for (const c of elementChildren(root)) if (isW(c, 'updateFields')) root.removeChild(c);
  const el = wEl(doc, 'updateFields', { val: 'true' });
  const before = elementChildren(root).find((c) => !isW(c) || SETTINGS_AFTER_UPDATE_FIELDS.includes(c.localName));
  root.insertBefore(el, before ?? null);
  pkg.zip.file(path, serialize(doc));
}

/** Clean = no pending tracked changes anywhere: also accept them in headers, footers, notes and comments. */
async function acceptOtherParts(pkg: ParsedDocx['pkg']) {
  const parts = [...pkg.rels.values()].filter((r) => !r.external && /\/(header|footer|footnotes|endnotes|comments)$/.test(r.type));
  for (const r of parts) {
    const doc = await pkg.readXml(r.target);
    if (!doc) continue;
    if (revisionTotal(acceptAllRevisions(doc.documentElement)) > 0) pkg.zip.file(r.target, serialize(doc));
  }
}

export async function exportClean(oldFile: ExportFile, newFile: ExportFile, result: DiffResult, choices: Record<string, Choice>): Promise<ExportResult> {
  // Read both files again: the export edits a fresh copy, so it can run any number of times.
  const [o, n] = await Promise.all([parseDocx(oldFile.data, 'old', oldFile.name), parseDocx(newFile.data, 'new', newFile.name)]);
  if (o.doc.fingerprint !== result.old.fingerprint || n.doc.fingerprint !== result.new.fingerprint)
    throw new ExportError('The files are not the ones that were compared. Compare them again, then export.');

  const read = async (p: ParsedDocx, suffix: string) => {
    const path = p.pkg.partByType(suffix);
    return path ? p.pkg.readXml(path) : null;
  };
  const [os, ns, on, nn] = await Promise.all([read(o, '/styles'), read(n, '/styles'), read(o, '/numbering'), read(n, '/numbering')]);
  const newStyleMap = new StyleMap(ns);
  const importer = new Importer(n.xml, {
    oldStyles: styleList(os),
    newStyles: styleList(ns),
    oldStyleMap: new StyleMap(os),
    newStyleMap,
    oldNumbering: numberingFormats(on),
    newNumbering: numberingFormats(nn),
  });
  const ex = new Exporter(result, choices, o, n, newStyleMap, importer);
  ex.run();

  n.pkg.zip.file(n.pkg.documentPath, serialize(n.xml));
  await setUpdateFields(n.pkg);
  await acceptOtherParts(n.pkg);
  const bytes = (await n.pkg.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: DOCX_MIME })) as Uint8Array<ArrayBuffer>;

  // Self-check (spec §8.4): the file opens, and its content matches the preview.
  let check: SelfCheck;
  try {
    const again = await parseDocx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 'new', 'export');
    check = selfCheck(buildFinal(result, choices).blocks, again.doc.blocks);
    // The re-read must not find pending revisions.
    if (again.revisionCount > 0) check = { ...check, ok: false, problems: [...check.problems, `${again.revisionCount} tracked change(s) are still in the file.`] };
  } catch (e) {
    check = { ok: false, compared: 0, mismatches: 0, examples: [], problems: [`The exported file could not be read back: ${e instanceof DocxError || e instanceof Error ? e.message : String(e)}`] };
  }
  return { bytes, check, usedOld: ex.usedOld.size };
}

