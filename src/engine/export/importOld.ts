// Bring old-file content into the new file (spec/export §2, decisions 25–26).
//
// Restored paragraphs (deleted, moved back, split/joined, replaced):
//  - paragraph style: same style name in the new file → else the new file's
//    heading style of the same outline level → else the default (Normal) style;
//  - list items join the neighbouring list in the new file at the old level;
//    otherwise they keep the old list only when the new file has the same list
//    definition, else they lose the numbering;
//  - paragraph direct formatting is dropped; simple character emphasis
//    (bold, italic, underline, strike, caps) and the content marks
//    (superscript, subscript, hidden) are kept; fonts, sizes and colours are dropped.
// Restored tables and rows keep their own layout (widths, borders, merges,
// shading) and cell paragraph formatting; only styles are mapped by name.
// Never brought back: bookmarks, comments and section breaks of the old file.

import type { StyleMap } from '../docx/styles';
import { elementChildren, isW, NS, remove, wAttr, wChild, wChildren, wVal } from '../docx/xml';
import { ensurePPr, setPPr, wEl, XML_NS } from './dom';

export interface StyleInfo {
  id: string;
  type: string;
  name: string;
}

export function styleList(doc: Document | null): StyleInfo[] {
  if (!doc) return [];
  return wChildren(doc.documentElement, 'style').map((s) => ({
    id: wAttr(s, 'styleId') ?? '',
    type: wAttr(s, 'type') ?? 'paragraph',
    name: (wVal(s, 'name') ?? wAttr(s, 'styleId') ?? '').toLowerCase(),
  }));
}

/** numId → level → "numFmt|lvlText", to recognise the same list definition in both files. */
export function numberingFormats(doc: Document | null): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  if (!doc) return out;
  const levels = (el: Element) => new Map(wChildren(el, 'lvl').map((l) => [Number(wAttr(l, 'ilvl') ?? 0), `${wVal(l, 'numFmt')}|${wVal(l, 'lvlText')}`] as const));
  const abstracts = new Map(wChildren(doc.documentElement, 'abstractNum').map((a) => [wAttr(a, 'abstractNumId') ?? '', levels(a)] as const));
  for (const num of wChildren(doc.documentElement, 'num')) {
    const lv = new Map(abstracts.get(wVal(num, 'abstractNumId') ?? '') ?? []);
    for (const o of wChildren(num, 'lvlOverride')) {
      const l = wChild(o, 'lvl');
      if (l) lv.set(Number(wAttr(o, 'ilvl') ?? 0), `${wVal(l, 'numFmt')}|${wVal(l, 'lvlText')}`);
    }
    out.set(wAttr(num, 'numId') ?? '', lv);
  }
  return out;
}

const KEEP_RUN_PROPS = new Set(['rStyle', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'vanish', 'specVanish', 'u', 'vertAlign']);
const DROP_ALWAYS = new Set([
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference', 'annotationRef', 'proofErr', 'permStart', 'permEnd',
  'lastRenderedPageBreak', 'sectPr', 'rPrChange', 'pPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange', 'tblGridChange', 'sectPrChange', 'numberingChange',
]);

/** Elements copied as they are: drawings, VML pictures and equations. */
function isIsland(el: Element): boolean {
  return (isW(el) && (el.localName === 'drawing' || el.localName === 'pict' || el.localName === 'object')) || (el.namespaceURI === NS.m && (el.localName === 'oMath' || el.localName === 'oMathPara'));
}

function inIsland(el: Element, root: Element): boolean {
  for (let a = el.parentElement; a && a !== root; a = a.parentElement) if (isIsland(a)) return true;
  return false;
}

export interface ImportContext {
  oldStyles: StyleInfo[];
  newStyles: StyleInfo[];
  oldStyleMap: StyleMap;
  newStyleMap: StyleMap;
  oldNumbering: Map<string, Map<number, string>>;
  newNumbering: Map<string, Map<number, string>>;
}

export class Importer {
  private byIdOld: Map<string, StyleInfo>;
  private byNameNew = new Map<string, string>();
  /** Every element brought in from the old file, for the list pass after insertion. */
  readonly imported: Element[] = [];
  private pending = new Set<Element>();

  constructor(
    private doc: Document,
    private ctx: ImportContext,
  ) {
    this.byIdOld = new Map(ctx.oldStyles.map((s) => [s.id, s]));
    for (const s of ctx.newStyles) if (!this.byNameNew.has(`${s.type}:${s.name}`)) this.byNameNew.set(`${s.type}:${s.name}`, s.id);
  }

  /**
   * Clone an old element into the new document. `restored` = a paragraph
   * brought back on its own (direct formatting dropped); otherwise a table
   * or row that keeps its layout.
   */
  import(oldEl: Element, restored: boolean, track = true): Element {
    const el = this.doc.importNode(oldEl, true) as Element;
    this.sanitize(el);
    if (restored) for (const p of [el, ...Array.from(el.getElementsByTagNameNS(NS.w, 'p'))].filter((x) => isW(x, 'p') && !inIsland(x, el))) this.reduceParagraph(p);
    // A table cell must end with a paragraph.
    for (const tc of [el, ...Array.from(el.getElementsByTagNameNS(NS.w, 'tc'))].filter((x) => isW(x, 'tc'))) {
      if (!isW(tc.lastElementChild, 'p')) tc.appendChild(wEl(this.doc, 'p'));
    }
    // `track`: inserted into the body later, so restored list items are fixed after insertion.
    if (track) this.imported.push(el);
    return el;
  }

  private sanitize(root: Element) {
    // Alternate content: keep what the reader read (the first choice), as plain content.
    for (const ac of Array.from(root.getElementsByTagNameNS(NS.mc, 'AlternateContent')).reverse()) {
      const pick = ac.getElementsByTagNameNS(NS.mc, 'Choice')[0] ?? ac.getElementsByTagNameNS(NS.mc, 'Fallback')[0];
      if (pick) while (pick.firstChild) ac.parentNode!.insertBefore(pick.firstChild, ac);
      remove(ac);
    }
    const walk = (el: Element) => {
      for (const a of Array.from(el.attributes)) {
        // Relationship ids stay: the carrier maps them to the new file (decision 43).
        const keep =
          (a.namespaceURI === NS.w && !a.localName.startsWith('rsid')) || a.namespaceURI === XML_NS || a.namespaceURI === NS.r || a.name.startsWith('xmlns');
        if (!keep) el.removeAttributeNode(a);
      }
      for (const c of elementChildren(el)) {
        // Drawings and equations are copied whole (pictures and equations can come back, decision 43).
        if (isIsland(c)) continue;
        if (!isW(c) || DROP_ALWAYS.has(c.localName)) {
          remove(c);
          continue;
        }
        walk(c);
      }
      if (isW(el, 'pStyle') || isW(el, 'rStyle') || isW(el, 'tblStyle')) {
        const type = isW(el, 'pStyle') ? 'paragraph' : isW(el, 'rStyle') ? 'character' : 'table';
        const mapped = this.mapStyle(wAttr(el, 'val') ?? '', type);
        if (mapped) el.setAttributeNS(NS.w, 'w:val', mapped);
        else remove(el);
      }
    };
    walk(root);
    // Runs left empty (a comment reference run) disappear.
    for (const r of Array.from(root.getElementsByTagNameNS(NS.w, 'r'))) if (elementChildren(r).every((c) => isW(c, 'rPr'))) remove(r);
  }

  /** Old style id → new style id (spec/export §2 lookup order), or null for the default style. */
  private mapStyle(oldId: string, type: string): string | null {
    const info = this.byIdOld.get(oldId);
    const byName = info ? this.byNameNew.get(`${type}:${info.name}`) : undefined;
    if (byName) return byName;
    if (type !== 'paragraph') return null;
    const old = this.ctx.oldStyleMap.get(oldId);
    if (old?.isTitle) return this.ctx.newStyles.find((s) => s.type === 'paragraph' && s.name === 'title')?.id ?? null;
    if (old?.outlineLvl !== undefined)
      return this.ctx.newStyles.find((s) => s.type === 'paragraph' && this.ctx.newStyleMap.get(s.id)?.outlineLvl === old.outlineLvl)?.id ?? null;
    return null;
  }

  /** Restored paragraph: keep only style and numbering; keep simple emphasis on runs. */
  private reduceParagraph(p: Element) {
    const pPr = wChild(p, 'pPr');
    if (pPr) for (const c of elementChildren(pPr)) if (!isW(c, 'pStyle') && !isW(c, 'numPr')) remove(c);
    if (pPr && !pPr.firstElementChild) remove(pPr);
    for (const r of Array.from(p.getElementsByTagNameNS(NS.w, 'r')).filter((x) => !inIsland(x, p))) {
      const rPr = wChild(r, 'rPr');
      if (!rPr) continue;
      for (const c of elementChildren(rPr)) if (!KEEP_RUN_PROPS.has(c.localName)) remove(c);
      if (!rPr.firstElementChild) remove(rPr);
    }
  }

  /**
   * After insertion: attach restored list items to the neighbouring list in
   * the new file (decision 25). Must run in document order.
   */
  fixLists() {
    // Restored paragraphs not handled yet still carry the old file's list ids: never a neighbour.
    this.pending = new Set(this.imported.flatMap((el) => (isW(el, 'p') ? [el] : Array.from(el.getElementsByTagNameNS(NS.w, 'p')))));
    for (const el of this.imported) {
      const paras = isW(el, 'p') ? [el] : Array.from(el.getElementsByTagNameNS(NS.w, 'p'));
      for (const p of paras) {
        this.pending.delete(p);
        const numPr = wChild(wChild(p, 'pPr'), 'numPr');
        if (!numPr) continue;
        const numId = wVal(numPr, 'numId');
        const ilvl = Number(wVal(numPr, 'ilvl') ?? 0);
        const neighbour = this.neighbourList(p);
        let target: string | null = null;
        if (neighbour) target = neighbour;
        else if (numId && numId !== '0' && this.sameList(numId, ilvl)) target = numId;
        if (target) {
          const fresh = wEl(this.doc, 'numPr');
          fresh.appendChild(wEl(this.doc, 'ilvl', { val: String(ilvl) }));
          fresh.appendChild(wEl(this.doc, 'numId', { val: target }));
          setPPr(ensurePPr(p), fresh);
        } else remove(numPr);
      }
    }
  }

  private sameList(numId: string, ilvl: number): boolean {
    const a = this.ctx.oldNumbering.get(numId)?.get(ilvl);
    return !!a && a === this.ctx.newNumbering.get(numId)?.get(ilvl);
  }

  /** numId of the nearest list paragraph just before (else just after) `p`. */
  private neighbourList(p: Element): string | null {
    const listOf = (q: Element | null): string | null => {
      if (!q || !isW(q, 'p')) return null;
      const pPr = wChild(q, 'pPr');
      const direct = wVal(wChild(pPr, 'numPr'), 'numId');
      if (direct) return direct === '0' ? null : direct;
      return this.ctx.newStyleMap.get(wVal(pPr, 'pStyle'))?.numPr?.numId ?? null;
    };
    const sibling = (from: Element, dir: 'prev' | 'next') => {
      let s = dir === 'prev' ? from.previousElementSibling : from.nextElementSibling;
      while (s && ((!isW(s, 'p') && !isW(s, 'tbl')) || this.pending.has(s))) s = dir === 'prev' ? s.previousElementSibling : s.nextElementSibling;
      return s;
    };
    return listOf(sibling(p, 'prev')) ?? listOf(sibling(p, 'next'));
  }
}
