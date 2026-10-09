// "Use old" on a modified paragraph (spec/export §2, decision 24): edit the new
// paragraph in place so that its text becomes the old text.
//  - Paragraph properties, numbering and unchanged words keep the new file's formatting.
//  - Old words that replace new words take the formatting of the words they
//    replace; pure insertions take the formatting of the text before them.
//  - Superscript, subscript and hidden text come from the old file (they are content).
//  - Bookmarks, comment ranges and other markers stay where they are.
//
// Example: new "Treatment duration is [24 weeks]." (24 bold, inside a comment
// range) → old "…is 12 weeks." gives "…is [12 weeks]." with 12 bold and still
// inside the comment range.

import type { ParagraphBlock, RunMarks } from '../../model/document';
import { flattenParagraph } from '../../model/flatten';
import { diffKeys } from '../align/myers';
import { elementChildren, isW, NS, wAttr, wChild } from '../docx/xml';
import { insertAfter, setRPr, wEl, XML_NS } from './dom';

export class ExportError extends Error {}

/** Markers kept when a paragraph's content is replaced. */
const MARKERS = new Set(['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'permStart', 'permEnd']);

interface Char {
  ch: string;
  marks?: RunMarks;
}

/** One visible character of the new paragraph, exploded into its own run. */
interface Atom extends Char {
  run: Element;
}

const marksTag = (m?: RunMarks) => (m?.superscript ? '^' : '') + (m?.subscript ? '_' : '') + (m?.hidden ? 'h' : '');
const sameMarks = (a?: RunMarks, b?: RunMarks) => marksTag(a) === marksTag(b);

/** Word characters group into one token; everything else is a token on its own. */
function tokens(chars: Char[]): { key: string; from: number; to: number }[] {
  const out: { key: string; from: number; to: number }[] = [];
  const word = /[\p{L}\p{N}]/u;
  for (let i = 0; i < chars.length; ) {
    let j = i + 1;
    if (word.test(chars[i].ch)) while (j < chars.length && word.test(chars[j].ch) && sameMarks(chars[j].marks, chars[i].marks)) j++;
    out.push({ key: `${marksTag(chars[i].marks)}\u0001${chars.slice(i, j).map((c) => c.ch).join('')}`, from: i, to: j });
    i = j;
  }
  return out;
}

/** Old paragraph text as characters with marks. Only plain content can come back (spec/merge §3). */
export function oldChars(p: ParagraphBlock): Char[] {
  const out: Char[] = [];
  for (const piece of flattenParagraph(p).pieces) {
    if (piece.kind === 'comment') continue;
    if (piece.kind === 'placeholder' || piece.wrap) throw new ExportError('A paragraph with a footnote, image, hyperlink or field cannot be brought back.');
    for (const ch of piece.text) out.push(piece.marks ? { ch, marks: piece.marks } : { ch });
  }
  return out;
}

/** Visible characters of a run child, as the reader sees them (readBody.ts runChild). */
function childChars(c: Element): string | null {
  if (!isW(c)) return null;
  switch (c.localName) {
    case 't':
      return c.textContent ?? '';
    case 'tab':
    case 'ptab':
      return '\t';
    case 'br': {
      const type = wAttr(c, 'type');
      return type === 'page' || type === 'column' ? null : '\n';
    }
    case 'cr':
      return '\n';
    case 'noBreakHyphen':
      return '‑';
    case 'sym': {
      const code = parseInt(wAttr(c, 'char') ?? '', 16);
      return Number.isNaN(code) ? null : String.fromCharCode(code);
    }
  }
  return null;
}

/** New run: the given properties (cloned) plus one content child. */
function runWith(doc: Document, rPr: Element | null, child: Element): Element {
  const r = wEl(doc, 'r');
  if (rPr) r.appendChild(rPr.cloneNode(true));
  r.appendChild(child);
  return r;
}

function textEl(doc: Document, text: string): Element {
  const t = wEl(doc, 't');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.textContent = text;
  return t;
}

/** Content element for one character. */
function charEl(doc: Document, ch: string): Element {
  if (ch === '\t') return wEl(doc, 'tab');
  if (ch === '\n') return wEl(doc, 'br');
  return textEl(doc, ch);
}

export class ParagraphEditor {
  constructor(private marksOf: (run: Element) => RunMarks) {}

  /** Replace the visible content of `p` (new file) by the text of `old`. */
  rewrite(p: Element, old: ParagraphBlock) {
    const doc = p.ownerDocument;
    const created = new Set<Element>();
    const atoms = this.explode(p, created);
    const want = oldChars(old);
    const ta = tokens(want);
    const tb = tokens(atoms);
    const ops = diffKeys(
      ta.map((t) => t.key),
      tb.map((t) => t.key),
    );

    // Walk the edit script hunk by hunk: removed new atoms and added old characters.
    let prevAtom: Atom | undefined;
    let removed: Atom[] = [];
    let added: Char[] = [];
    const flush = (nextAtom: Atom | undefined) => {
      if (added.length) {
        const base = removed[0] ?? prevAtom ?? nextAtom;
        const runs = this.makeRuns(doc, added, base?.run ?? null, created);
        if (removed[0]) for (const r of runs) removed[0].run.parentNode!.insertBefore(r, removed[0].run);
        else if (prevAtom) {
          let ref: Element = prevAtom.run;
          for (const r of runs) insertAfter(r, ref), (ref = r);
        } else if (nextAtom) for (const r of runs) nextAtom.run.parentNode!.insertBefore(r, nextAtom.run);
        else for (const r of runs) p.appendChild(r);
      }
      for (const a of removed) a.run.parentNode?.removeChild(a.run);
      removed = [];
      added = [];
    };
    for (const op of ops) {
      if (op.type === 'equal') {
        const t = tb[op.b];
        flush(atoms[t.from]);
        prevAtom = atoms[t.to - 1];
      } else if (op.type === 'delete') {
        const t = ta[op.a];
        added.push(...want.slice(t.from, t.to));
      } else {
        const t = tb[op.b];
        removed.push(...atoms.slice(t.from, t.to));
      }
    }
    flush(undefined);
    this.merge(created);
  }

  /**
   * Replace the whole content of `p` (new file) by the content of `src`, an old
   * paragraph already imported into the new document (decision 43, for
   * paragraphs with footnotes, links, fields, pictures or equations). The new
   * paragraph keeps its properties. Its bookmark and comment markers stay:
   * those before any visible content at the start, the others at the end.
   */
  replaceContent(p: Element, src: Element) {
    const doc = p.ownerDocument;
    const pPr = wChild(p, 'pPr');
    const lead: Element[] = [];
    const trail: Element[] = [];
    let seenContent = false;
    const visit = (el: Element) => {
      for (const c of elementChildren(el)) {
        if (c === pPr) continue;
        if (isW(c) && MARKERS.has(c.localName)) {
          (seenContent ? trail : lead).push(c);
          continue;
        }
        if (isW(c, 'r')) {
          const ref = wChild(c, 'commentReference');
          if (ref) {
            const r = wEl(doc, 'r');
            const rPr = wChild(c, 'rPr');
            if (rPr) r.appendChild(rPr.cloneNode(true));
            r.appendChild(ref.cloneNode(true));
            (seenContent ? trail : lead).push(r);
          }
          if (elementChildren(c).some((k) => childChars(k) !== null || isW(k, 'drawing') || isW(k, 'footnoteReference') || isW(k, 'endnoteReference'))) seenContent = true;
          continue;
        }
        if (isW(c)) visit(c);
        else seenContent = true; // equations and other inline content
      }
    };
    visit(p);
    for (const c of elementChildren(p)) if (c !== pPr) p.removeChild(c);
    for (const m of lead) p.appendChild(m);
    for (const c of elementChildren(src)) if (!isW(c, 'pPr')) p.appendChild(c);
    for (const m of trail) p.appendChild(m);
  }

  /**
   * Split every run of `p` that has visible content into one run per child,
   * and every w:t into one run per character. Returns the visible atoms in order.
   */
  private explode(p: Element, created: Set<Element>): Atom[] {
    const doc = p.ownerDocument;
    const atoms: Atom[] = [];
    const visit = (el: Element) => {
      for (const c of elementChildren(el)) {
        if (isW(c, 'r')) this.explodeRun(doc, c, atoms, created);
        else if (isW(c, 'sdt')) {
          const content = wChild(c, 'sdtContent');
          if (content) visit(content);
        } else if (isW(c) && ['smartTag', 'customXml', 'bdo', 'dir', 'ins', 'moveTo', 'hyperlink', 'fldSimple'].includes(c.localName)) visit(c);
      }
    };
    visit(p);
    return atoms;
  }

  private explodeRun(doc: Document, r: Element, atoms: Atom[], created: Set<Element>) {
    const kids = elementChildren(r);
    if (!kids.some((c) => childChars(c) !== null)) return; // markers, fields, drawings: leave alone
    const rPr = wChild(r, 'rPr');
    const marks = this.marksOf(r);
    const mk = marks.superscript || marks.subscript || marks.hidden ? marks : undefined;
    for (const c of kids) {
      if (c === rPr) continue;
      const chars = childChars(c);
      if (chars === null) {
        const nr = runWith(doc, rPr, c);
        r.parentNode!.insertBefore(nr, r);
        continue;
      }
      if (isW(c, 't')) {
        for (const ch of chars) {
          const nr = runWith(doc, rPr, textEl(doc, ch));
          r.parentNode!.insertBefore(nr, r);
          created.add(nr);
          atoms.push({ ch, marks: mk, run: nr });
        }
      } else {
        const nr = runWith(doc, rPr, c);
        r.parentNode!.insertBefore(nr, r);
        created.add(nr);
        atoms.push({ ch: chars, marks: mk, run: nr });
      }
    }
    r.parentNode!.removeChild(r);
  }

  /** Runs for added old characters, formatted like `base`, with the old marks. */
  private makeRuns(doc: Document, chars: Char[], base: Element | null, created: Set<Element>): Element[] {
    const baseRPr = base ? wChild(base, 'rPr') : null;
    const baseMarks = base ? this.marksOf(base) : {};
    const out: Element[] = [];
    for (const c of chars) {
      const rPr = (baseRPr?.cloneNode(true) as Element | undefined) ?? wEl(doc, 'rPr');
      this.applyMarks(doc, rPr, c.marks ?? {}, baseMarks);
      const r = wEl(doc, 'r');
      if (rPr.firstElementChild) r.appendChild(rPr);
      r.appendChild(charEl(doc, c.ch));
      created.add(r);
      out.push(r);
    }
    return out;
  }

  /** Make the run show exactly the old marks, overriding what the base formatting implies. */
  private applyMarks(doc: Document, rPr: Element, want: RunMarks, base: RunMarks) {
    const va = want.superscript ? 'superscript' : want.subscript ? 'subscript' : base.superscript || base.subscript ? 'baseline' : null;
    for (const v of Array.from(rPr.getElementsByTagNameNS(NS.w, 'vertAlign'))) v.parentNode!.removeChild(v);
    if (va) setRPr(rPr, wEl(doc, 'vertAlign', { val: va }));
    if (!!want.hidden !== !!base.hidden || want.hidden) {
      for (const local of ['vanish', 'specVanish']) for (const v of Array.from(rPr.getElementsByTagNameNS(NS.w, local))) v.parentNode!.removeChild(v);
      if (want.hidden) setRPr(rPr, wEl(doc, 'vanish'));
      else if (base.hidden) setRPr(rPr, wEl(doc, 'vanish', { val: '0' }));
    }
  }

  /** Join neighbouring text-only runs with identical properties back together. */
  private merge(created: Set<Element>) {
    const textOnly = (r: Element) => elementChildren(r).every((c) => isW(c, 'rPr') || isW(c, 't'));
    const props = (r: Element) => {
      const rPr = wChild(r, 'rPr');
      return rPr ? new XMLSerializer().serializeToString(rPr) : '';
    };
    for (const r of created) {
      if (!r.parentNode || !textOnly(r)) continue;
      const t = wChild(r, 't')!;
      for (let next = r.nextElementSibling; next && created.has(next) && textOnly(next) && props(next) === props(r); next = r.nextElementSibling) {
        t.textContent = (t.textContent ?? '') + (wChild(next, 't')?.textContent ?? '');
        next.parentNode!.removeChild(next);
      }
    }
  }
}
