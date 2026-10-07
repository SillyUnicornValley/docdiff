// Read the (revision-accepted) document body into DocModel blocks, following
// docs/stage2-design.md §2. Formatting is dropped; only content is kept.

import type {
  Block,
  FieldType,
  Inline,
  InlinePlaceholder,
  InlinePlaceholderKind,
  NodeId,
  ParagraphBlock,
  ParagraphRole,
  PlaceholderBlock,
  RunMarks,
  Side,
  TableBlock,
  TableCell,
  TableRow,
  TextInline,
} from '../../model/document';
import { hashString } from '../hash';
import type { Relationship } from './package';
import type { NumberingState } from './numbering';
import type { StyleMap } from './styles';
import { elementChildren, isW, NS, onOff, plainText, wAttr, wChild, wChildren, wVal } from './xml';

export interface BodyContext {
  side: Side;
  styles: StyleMap;
  numbering: NumberingState;
  rels: Map<string, Relationship>;
  /** Footnote / endnote text by id, for placeholder fingerprints. */
  footnotes: Map<string, string>;
  endnotes: Map<string, string>;
  /** Comments of this file by id. Only the new file's comments are shown (decision 19). */
  comments: Map<string, { author: string; preview: string }>;
  /** Media fingerprints by part path. */
  media: Map<string, string>;
}

/** What the reader collects besides blocks. */
export interface BodyResult {
  blocks: Block[];
  /** NodeId → XML element (w:p, w:tbl, w:tr, w:tc; first paragraph of a TOC). */
  source: Map<NodeId, Element>;
  /** Paragraphs carrying a section break, with their w:sectPr, in order. */
  sectionBreaks: { blockId: NodeId; sectPr: Element }[];
  hyperlinkTargets: string[];
  textBoxTexts: string[];
  /**
   * Structures spanning several blocks or rows: id → group names. "field:N" for a
   * field whose result spans paragraphs, "cc:N" for a content control around
   * several blocks or rows. A difference covering only part of a group cannot
   * "Use old" (spec §7.6).
   */
  groups: Map<NodeId, string[]>;
}

interface FieldFrame {
  instr: string;
  phase: 'instr' | 'result';
  kind?: 'toc' | 'hyperlink' | 'field';
  result: TextInline[];
  group: string;
}

const FIELD_TYPES: Record<string, FieldType> = {
  DATE: 'DATE',
  TIME: 'DATE',
  CREATEDATE: 'DATE',
  SAVEDATE: 'DATE',
  PRINTDATE: 'DATE',
  PAGE: 'PAGE',
  NUMPAGES: 'NUMPAGES',
  SECTIONPAGES: 'NUMPAGES',
  REF: 'REF',
  NOTEREF: 'REF',
  PAGEREF: 'PAGEREF',
  SEQ: 'SEQ',
};

const fieldKeyword = (instr: string) => instr.trim().split(/\s+/)[0]?.toUpperCase() ?? '';

function fieldType(instr: string): FieldType {
  return FIELD_TYPES[fieldKeyword(instr)] ?? 'OTHER';
}

/** HYPERLINK field target: first quoted argument, or \l "bookmark". */
function hyperlinkFieldTarget(instr: string): string {
  return /"([^"]*)"/.exec(instr)?.[1] ?? instr;
}

const sameMarks = (a?: RunMarks, b?: RunMarks) =>
  !!a?.superscript === !!b?.superscript && !!a?.subscript === !!b?.subscript && !!a?.hidden === !!b?.hidden;

const cleanMarks = (m: RunMarks): RunMarks | undefined => {
  const out: RunMarks = {};
  if (m.superscript) out.superscript = true;
  if (m.subscript) out.subscript = true;
  if (m.hidden) out.hidden = true;
  return Object.keys(out).length ? out : undefined;
};

/** Append text, merging with the previous text inline when the marks match (split runs become one). */
function pushText(target: Inline[] | TextInline[], text: string, marks?: RunMarks) {
  if (!text) return;
  const last = target.at(-1);
  if (last?.type === 'text' && sameMarks(last.marks, marks)) last.text += text;
  else (target as Inline[]).push(marks ? { type: 'text', text, marks } : { type: 'text', text });
}

export class BodyReader {
  private n = 0;
  private fields: FieldFrame[] = [];
  private toc: { block: PlaceholderBlock; texts: string[] } | null = null;
  private tocEndedHere = false;
  private footnoteNo = 0;
  private endnoteNo = 0;
  private commentsSeen = new Set<string>();
  private out: Inline[] = [];
  private groupNo = 0;
  readonly result: BodyResult = { blocks: [], source: new Map(), sectionBreaks: [], hyperlinkTargets: [], textBoxTexts: [], groups: new Map() };

  constructor(private ctx: BodyContext) {}

  private addGroup(id: NodeId, group: string) {
    const g = this.result.groups.get(id);
    if (!g) this.result.groups.set(id, [group]);
    else if (!g.includes(group)) g.push(group);
  }

  private id(prefix = '') {
    return `${this.ctx.side === 'old' ? 'o' : 'n'}${prefix}${++this.n}`;
  }

  readBody(body: Element) {
    this.result.blocks = this.readBlocks(body, true);
    this.finishToc(this.result.blocks);
    return this.result;
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  private readBlocks(container: Element, top = false): Block[] {
    const blocks: Block[] = [];
    const visit = (el: Element) => {
      for (const c of elementChildren(el)) {
        if (isW(c, 'p')) this.paragraph(c, blocks, top);
        else if (isW(c, 'tbl')) {
          this.finishToc(blocks);
          blocks.push(this.table(c));
        } else if (isW(c, 'sdt')) {
          const content = wChild(c, 'sdtContent');
          const start = blocks.length;
          if (content) visit(content);
          if (blocks.length - start > 1) {
            const group = `cc:${++this.groupNo}`;
            for (const b of blocks.slice(start)) this.addGroup(b.id, group);
          }
        } else if (isW(c, 'customXml') || isW(c, 'smartTag')) visit(c);
        else if (isW(c, 'altChunk')) {
          const b: PlaceholderBlock = { kind: 'placeholder', id: this.id(), element: 'object', label: 'Embedded document' };
          this.result.source.set(b.id, c);
          blocks.push(b);
        }
        // sectPr, bookmarks, permission ranges…: no content.
      }
    };
    visit(container);
    return blocks;
  }

  private paragraph(p: Element, blocks: Block[], top: boolean) {
    const inTocBefore = !!this.toc;
    this.tocEndedHere = false;
    const block = this.readParagraph(p);
    const inToc = inTocBefore || !!this.toc || this.tocEndedHere;
    if (inToc && this.toc) {
      // TOC entries are kept as the placeholder's children (collapsed by default, decision 10).
      if (block.content.length) {
        this.toc.block.children!.push(block);
        this.toc.texts.push(JSON.stringify(block.content));
      }
      if (!this.result.source.has(this.toc.block.id)) this.result.source.set(this.toc.block.id, p);
      if (this.tocEndedHere) this.finishToc(blocks);
      return;
    }
    this.result.source.set(block.id, p);
    blocks.push(block);
    const sectPr = wChild(wChild(p, 'pPr'), 'sectPr');
    if (top && sectPr) {
      block.sectionBreak = true;
      this.result.sectionBreaks.push({ blockId: block.id, sectPr });
    }
  }

  private finishToc(blocks: Block[]) {
    if (!this.toc) return;
    const { block, texts } = this.toc;
    block.label = 'Table of contents';
    block.fingerprint = hashString(texts.join('\n'));
    blocks.push(block);
    this.toc = null;
  }

  private role(p: Element): { role: ParagraphRole; numbering?: ParagraphBlock['numbering'] } {
    const pPr = wChild(p, 'pPr');
    const style = this.ctx.styles.get(wVal(pPr, 'pStyle'));
    const numPr = wChild(pPr, 'numPr');
    const numId = wVal(numPr, 'numId') ?? style?.numPr?.numId;
    const ilvlRaw = wVal(numPr, 'ilvl');
    const ilvl = ilvlRaw !== null ? Number(ilvlRaw) : (style?.numPr?.ilvl ?? 0);
    const numbering = numId !== undefined ? this.ctx.numbering.next(numId, ilvl) : undefined;
    const directLvl = wVal(pPr, 'outlineLvl');
    const outline = directLvl !== null && Number(directLvl) < 9 ? Number(directLvl) : style?.outlineLvl;
    let role: ParagraphRole;
    if (style?.isTitle) role = { type: 'title' };
    else if (outline !== undefined) role = { type: 'heading', level: outline + 1 };
    else if (numbering) role = { type: 'listItem', level: ilvl };
    else role = { type: 'body' };
    return { role, numbering };
  }

  private readParagraph(p: Element): ParagraphBlock {
    const { role, numbering } = this.role(p);
    const block: ParagraphBlock = { kind: 'paragraph', id: this.id(), role, content: [] };
    if (numbering) block.numbering = numbering;
    this.out = block.content;
    const spanning = () => (this.fields[0] && this.fields[0].kind !== 'toc' && fieldKeyword(this.fields[0].instr) !== 'TOC' ? this.fields[0].group : undefined);
    const atStart = spanning();
    this.inlines(p, {});
    // A field still open at either end of the paragraph spans paragraphs.
    for (const g of [atStart, spanning()]) if (g) this.addGroup(block.id, g);
    // A field that continues into the next paragraph: close what it showed here.
    const outer = this.fields[0];
    if (outer && outer.phase === 'result' && outer.kind !== 'toc' && outer.result.length) {
      this.emitField(outer);
      outer.result = [];
    }
    return block;
  }

  // -------------------------------------------------------------------------
  // Inline content
  // -------------------------------------------------------------------------

  /** Route visible content: dropped inside field instructions, collected inside field results. */
  private emitText(text: string, marks?: RunMarks) {
    if (this.fields.some((f) => f.phase === 'instr')) return;
    const outer = this.fields[0];
    if (outer && outer.kind !== 'toc') pushText(outer.result, text, marks);
    else pushText(this.out, text, marks);
  }

  private emitInline(inl: Inline) {
    if (this.fields.some((f) => f.phase === 'instr')) return;
    this.out.push(inl);
  }

  private emitField(f: FieldFrame) {
    if (f.kind === 'hyperlink') {
      const target = hyperlinkFieldTarget(f.instr);
      this.result.hyperlinkTargets.push(target);
      this.out.push({ type: 'hyperlink', content: f.result, urlFingerprint: hashString(target) });
    } else this.out.push({ type: 'field', fieldType: fieldType(f.instr), instruction: f.instr.trim(), result: f.result });
  }

  private fieldChar(type: string | null) {
    if (type === 'begin') this.fields.push({ instr: '', phase: 'instr', result: [], group: `field:${++this.groupNo}` });
    else if (type === 'separate') {
      const f = this.fields.at(-1);
      if (!f) return;
      f.phase = 'result';
      const kw = fieldKeyword(f.instr);
      f.kind = kw === 'TOC' ? 'toc' : kw === 'HYPERLINK' ? 'hyperlink' : 'field';
      if (f.kind === 'toc' && this.fields.length === 1 && !this.toc)
        this.toc = { block: { kind: 'placeholder', id: this.id(), element: 'toc', label: 'Table of contents', children: [] }, texts: [] };
    } else if (type === 'end') {
      const f = this.fields.pop();
      if (!f || this.fields.length > 0) return; // nested field: its result already went to the outer one
      if (f.kind === 'toc' || (!f.kind && fieldKeyword(f.instr) === 'TOC')) this.tocEndedHere = true;
      else if (f.kind === undefined) {
        // No cached result (begin…end without separate).
        f.kind = fieldKeyword(f.instr) === 'HYPERLINK' ? 'hyperlink' : 'field';
        this.emitField(f);
      } else this.emitField(f);
    }
  }

  private inlines(el: Element, marks: RunMarks) {
    for (const c of elementChildren(el)) {
      if (c.namespaceURI === NS.m && (c.localName === 'oMath' || c.localName === 'oMathPara')) {
        this.emitInline(this.placeholder('equation', 'Equation', hashString(c.textContent ?? '')));
        continue;
      }
      if (c.namespaceURI === NS.mc && c.localName === 'AlternateContent') {
        const choice = c.getElementsByTagNameNS(NS.mc, 'Choice')[0];
        if (choice) this.inlines(choice, marks);
        continue;
      }
      if (!isW(c)) continue;
      switch (c.localName) {
        case 'r':
          this.run(c);
          break;
        case 'hyperlink':
          this.hyperlink(c);
          break;
        case 'fldSimple': {
          const instr = wAttr(c, 'instr') ?? '';
          this.fieldChar('begin');
          this.fields.at(-1)!.instr = instr;
          this.fieldChar('separate');
          this.inlines(c, marks);
          this.fieldChar('end');
          break;
        }
        case 'sdt': {
          const content = wChild(c, 'sdtContent');
          if (content) this.inlines(content, marks);
          break;
        }
        case 'smartTag':
        case 'customXml':
        case 'bdo':
        case 'dir':
        case 'ins':
        case 'moveTo':
          this.inlines(c, marks);
          break;
        case 'commentRangeStart':
          this.comment(wAttr(c, 'id'));
          break;
        // pPr, bookmarks, proofErr, permStart…: no content.
      }
    }
  }

  private comment(id: string | null) {
    if (id === null || this.commentsSeen.has(id)) return;
    this.commentsSeen.add(id);
    if (this.ctx.side !== 'new') return;
    const c = this.ctx.comments.get(id);
    if (c) this.emitInline({ type: 'comment', author: c.author, preview: c.preview });
  }

  private hyperlink(h: Element) {
    const relId = h.getAttributeNS(NS.r, 'id');
    const anchor = wAttr(h, 'anchor');
    const target = relId ? (this.ctx.rels.get(relId)?.target ?? '') : anchor ? `#${anchor}` : '';
    // Inside a field result the hyperlink is just text of that field.
    if (this.fields.length > 0) {
      this.inlines(h, {});
      return;
    }
    const outer = this.out;
    const content: Inline[] = [];
    this.out = content;
    this.inlines(h, {});
    this.out = outer;
    const texts = content.filter((i): i is TextInline => i.type === 'text');
    // Placeholders or comments inside the link stay next to it.
    for (const i of content) if (i.type !== 'text') outer.push(i);
    this.result.hyperlinkTargets.push(target);
    outer.push({ type: 'hyperlink', content: texts, urlFingerprint: hashString(target) });
  }

  private runMarks(r: Element): RunMarks {
    const rPr = wChild(r, 'rPr');
    const rStyle = wVal(rPr, 'rStyle');
    const m: RunMarks = rStyle ? { ...this.ctx.styles.charMarks(rStyle) } : {};
    const va = wVal(rPr, 'vertAlign');
    if (va !== null) {
      m.superscript = va === 'superscript';
      m.subscript = va === 'subscript';
    }
    const vanish = wChild(rPr, 'vanish') ?? wChild(rPr, 'specVanish');
    if (vanish) m.hidden = onOff(vanish);
    return cleanMarks(m) ?? {};
  }

  private run(r: Element) {
    const marks = this.runMarks(r);
    const mk = Object.keys(marks).length ? marks : undefined;
    for (const c of elementChildren(r)) {
      if (c.namespaceURI === NS.mc && c.localName === 'AlternateContent') {
        const choice = c.getElementsByTagNameNS(NS.mc, 'Choice')[0];
        if (choice) for (const d of elementChildren(choice)) this.runChild(d, mk);
        continue;
      }
      this.runChild(c, mk);
    }
  }

  private runChild(c: Element, marks: RunMarks | undefined) {
    if (!isW(c)) return;
    switch (c.localName) {
      case 't':
        this.emitText(c.textContent ?? '', marks);
        break;
      case 'instrText': {
        const f = this.fields.at(-1);
        if (f && f.phase === 'instr') f.instr += c.textContent ?? '';
        break;
      }
      case 'fldChar':
        this.fieldChar(wAttr(c, 'fldCharType'));
        break;
      case 'tab':
      case 'ptab':
        if (this.fields.length && this.fields[0].kind !== 'toc') this.emitText('\t', marks);
        else this.emitInline({ type: 'tab' });
        break;
      case 'br': {
        const type = wAttr(c, 'type');
        if (type === 'page' || type === 'column') break; // layout only
        if (this.fields.length && this.fields[0].kind !== 'toc') this.emitText('\n', marks);
        else this.emitInline({ type: 'break' });
        break;
      }
      case 'cr':
        this.emitInline({ type: 'break' });
        break;
      case 'noBreakHyphen':
        this.emitText('‑', marks);
        break;
      case 'sym': {
        const code = parseInt(wAttr(c, 'char') ?? '', 16);
        if (!Number.isNaN(code)) this.emitText(String.fromCharCode(code), marks);
        break;
      }
      case 'footnoteReference': {
        const id = wAttr(c, 'id') ?? '';
        this.emitInline(this.placeholder('footnoteRef', `Footnote ${++this.footnoteNo}`, hashString(this.ctx.footnotes.get(id) ?? '')));
        break;
      }
      case 'endnoteReference': {
        const id = wAttr(c, 'id') ?? '';
        this.emitInline(this.placeholder('endnoteRef', `Endnote ${++this.endnoteNo}`, hashString(this.ctx.endnotes.get(id) ?? '')));
        break;
      }
      case 'commentReference':
        // Point comments have no range start: show the marker here.
        this.comment(wAttr(c, 'id'));
        break;
      case 'drawing':
        this.emitInline(this.drawing(c));
        break;
      case 'pict':
        this.emitInline(this.vml(c));
        break;
      case 'object':
        this.emitInline(this.placeholder('object', 'Embedded object', hashString(c.textContent ?? '')));
        break;
      // rPr, lastRenderedPageBreak, softHyphen, annotationRef, delText…: no content.
    }
  }

  private placeholder(kind: InlinePlaceholderKind, label: string, fingerprint?: string): InlinePlaceholder {
    return fingerprint ? { type: 'placeholder', kind, label, fingerprint } : { type: 'placeholder', kind, label };
  }

  private drawing(d: Element): InlinePlaceholder {
    const name = d.getElementsByTagNameNS(NS.wp, 'docPr')[0]?.getAttribute('name') ?? '';
    const uri = d.getElementsByTagNameNS(NS.a, 'graphicData')[0]?.getAttribute('uri') ?? '';
    const txbx = d.getElementsByTagNameNS(NS.w, 'txbxContent')[0];
    if (txbx) {
      const text = plainText(txbx);
      this.result.textBoxTexts.push(text);
      return this.placeholder('textBox', name || 'Text box', hashString(text));
    }
    if (uri.endsWith('/picture')) {
      const embed = d.getElementsByTagNameNS(NS.a, 'blip')[0]?.getAttributeNS(NS.r, 'embed');
      const target = embed ? this.ctx.rels.get(embed)?.target : undefined;
      return this.placeholder('image', name || 'Picture', target ? this.ctx.media.get(target) : undefined);
    }
    if (uri.endsWith('/chart')) return this.placeholder('chart', name || 'Chart', hashString(name));
    return this.placeholder('shape', name || 'Shape', hashString(name + uri));
  }

  private vml(p: Element): InlinePlaceholder {
    const txbx = p.getElementsByTagNameNS(NS.w, 'txbxContent')[0];
    if (txbx) {
      const text = plainText(txbx);
      this.result.textBoxTexts.push(text);
      return this.placeholder('textBox', 'Text box', hashString(text));
    }
    const img = p.getElementsByTagNameNS(NS.v, 'imagedata')[0];
    const rid = img?.getAttributeNS(NS.r, 'id');
    if (rid) {
      const target = this.ctx.rels.get(rid)?.target;
      return this.placeholder('image', 'Picture', target ? this.ctx.media.get(target) : undefined);
    }
    return this.placeholder('shape', 'Shape');
  }

  // -------------------------------------------------------------------------
  // Tables
  // -------------------------------------------------------------------------

  private table(tbl: Element): TableBlock {
    const widths = wChildren(wChild(tbl, 'tblGrid') ?? tbl, 'gridCol').map((g) => Number(wAttr(g, 'w') ?? 0));
    const t: TableBlock = { kind: 'table', id: this.id('t'), gridColumns: widths.length, rows: [] };
    if (widths.length && widths.every((w) => w > 0)) t.columnWidths = widths;
    this.result.source.set(t.id, tbl);
    const rows = (el: Element): Element[] =>
      elementChildren(el).flatMap((c) =>
        isW(c, 'tr') ? [c] : isW(c, 'sdt') ? rows(wChild(c, 'sdtContent') ?? c) : isW(c, 'customXml') ? rows(c) : [],
      );
    for (const tr of rows(tbl)) t.rows.push(this.row(tr));
    // A content control around several rows (e.g. a repeating section).
    for (const sdt of elementChildren(tbl).filter((c) => isW(c, 'sdt'))) {
      const trs = new Set(rows(sdt));
      if (trs.size < 2) continue;
      const group = `cc:${++this.groupNo}`;
      for (const r of t.rows) if (trs.has(this.result.source.get(r.id)!)) this.addGroup(r.id, group);
    }
    if (!t.gridColumns) t.gridColumns = Math.max(0, ...t.rows.map((r) => r.cells.reduce((k, c) => k + c.gridSpan, 0)));
    return t;
  }

  private row(tr: Element): TableRow {
    const row: TableRow = { id: this.id('r'), cells: [] };
    this.result.source.set(row.id, tr);
    if (onOffChild(wChild(tr, 'trPr'), 'tblHeader')) row.isHeader = true;
    const cells = (el: Element): Element[] =>
      elementChildren(el).flatMap((c) =>
        isW(c, 'tc') ? [c] : isW(c, 'sdt') ? cells(wChild(c, 'sdtContent') ?? c) : isW(c, 'customXml') ? cells(c) : [],
      );
    for (const tc of cells(tr)) row.cells.push(this.cell(tc));
    return row;
  }

  private cell(tc: Element): TableCell {
    const tcPr = wChild(tc, 'tcPr');
    const vMergeEl = wChild(tcPr, 'vMerge');
    const id = this.id('c');
    const cell: TableCell = {
      id,
      gridSpan: Number(wVal(tcPr, 'gridSpan') ?? 1) || 1,
      vMerge: !vMergeEl ? 'none' : wAttr(vMergeEl, 'val') === 'restart' ? 'restart' : 'continue',
      blocks: this.readBlocks(tc),
    };
    this.result.source.set(id, tc);
    return cell;
  }
}

function onOffChild(parent: Element | null, local: string) {
  const el = wChild(parent, local);
  return !!el && onOff(el);
}
