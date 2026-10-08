// Structure protection when content is removed (spec/export §2, decisions 27–28).
//
// Markers: bookmarks and comment ranges inside removed content move to the
// nearest kept paragraph before it (else after it), in their original order,
// so ranges only shrink and the new file's comments are kept.
//
// Sections: a removed paragraph that ends a section leaves its section
// settings behind. They move to the last kept paragraph of that section; a
// section with nothing left disappears. If the document's last section ends
// up empty, the document's final page setup comes from the section before it.
// Example (05): the new file adds "End of main protocol." (section break,
// portrait) and a landscape appendix. Using old for both leaves the old
// content in a portrait document — not a landscape one.

import { elementChildren, isW, NS, remove, wChild } from '../docx/xml';
import { ensurePPr, insertAfter, paragraphsIn, setPPr, wEl } from './dom';

const TMP_NS = 'urn:docdiff:export';
const MARKERS = new Set(['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd']);

/** Remove elements of the new file, protecting markers and section breaks. */
export function removeElements(body: Element, removed: Set<Element>) {
  const isRemoved = (el: Element) => {
    for (let a: Element | null = el; a && a !== body; a = a.parentElement) if (removed.has(a)) return true;
    return false;
  };
  for (const el of removed) {
    if (!el.parentNode) continue;
    relocateMarkers(el, isRemoved);
    const sectPr = isW(el, 'p') ? wChild(wChild(el, 'pPr'), 'sectPr') : null;
    if (sectPr && isTopLevel(body, el)) {
      const holder = el.ownerDocument.createElementNS(TMP_NS, 'dd:sect');
      holder.appendChild(sectPr);
      el.parentNode.insertBefore(holder, el);
    }
    remove(el);
  }
}

function isTopLevel(body: Element, el: Element): boolean {
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (a === body) return true;
    if (!isW(a, 'sdt') && !isW(a, 'sdtContent') && !isW(a, 'customXml')) return false;
  }
  return false;
}

function relocateMarkers(el: Element, isRemoved: (el: Element) => boolean) {
  const found: Element[] = [];
  for (const m of Array.from(el.getElementsByTagNameNS(NS.w, '*'))) {
    if (MARKERS.has(m.localName)) found.push(m);
    else if (m.localName === 'commentReference') {
      // Keep the reference in a run of its own.
      const r = wEl(m.ownerDocument, 'r');
      const rPr = wChild(m.parentElement, 'rPr');
      if (rPr) r.appendChild(rPr.cloneNode(true));
      r.appendChild(m.cloneNode(true));
      found.push(r);
    }
  }
  if (!found.length) return;
  const before = keptParagraph(el, 'prev', isRemoved);
  if (before) {
    for (const m of found) before.appendChild(m);
    return;
  }
  const after = keptParagraph(el, 'next', isRemoved);
  if (after) {
    let ref: Node | null = wChild(after, 'pPr');
    for (const m of found) {
      if (ref) insertAfter(m, ref);
      else after.insertBefore(m, after.firstChild);
      ref = m;
    }
  }
  // Nothing kept anywhere near: the markers go with the content.
}

/** Nearest paragraph before/after `el` that is kept, searching outwards through containers. */
function keptParagraph(el: Element, dir: 'prev' | 'next', isRemoved: (el: Element) => boolean): Element | null {
  for (let cur: Element | null = el; cur && !isW(cur, 'body'); cur = cur.parentElement) {
    for (let s = dir === 'prev' ? cur.previousElementSibling : cur.nextElementSibling; s; s = dir === 'prev' ? s.previousElementSibling : s.nextElementSibling) {
      if (isRemoved(s)) continue;
      const ps = paragraphsIn(s).filter((p) => !isRemoved(p));
      if (ps.length) return dir === 'prev' ? ps[ps.length - 1] : ps[0];
    }
    if (isW(cur, 'tc')) return null; // stay inside the table cell
  }
  return null;
}

/** Top-level paragraphs, tables and section holders of the body, in order. */
function topLevel(body: Element): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    for (const c of elementChildren(el)) {
      if (isW(c, 'p') || isW(c, 'tbl') || c.namespaceURI === TMP_NS) out.push(c);
      else if (isW(c, 'sdt')) {
        const content = wChild(c, 'sdtContent');
        if (content) visit(content);
      } else if (isW(c, 'customXml')) visit(c);
    }
  };
  visit(body);
  return out;
}

export function normaliseSections(body: Element) {
  let lastP: Element | null = null;
  let hasContent = false;
  let lastBreak: Element | null = null;
  for (const el of topLevel(body)) {
    if (el.namespaceURI === TMP_NS) {
      const sectPr = el.firstElementChild!;
      if (lastP) {
        setPPr(ensurePPr(lastP), sectPr);
        lastBreak = lastP;
        lastP = null;
        hasContent = false;
      }
      remove(el);
    } else if (isW(el, 'p') && wChild(wChild(el, 'pPr'), 'sectPr')) {
      lastBreak = el;
      lastP = null;
      hasContent = false;
    } else {
      if (isW(el, 'p')) lastP = el;
      hasContent = true;
    }
  }
  // The last section lost all its content: the document ends with the previous section's settings.
  if (!hasContent && lastBreak) {
    const sectPr = wChild(wChild(lastBreak, 'pPr'), 'sectPr')!;
    const final = wChildren(body, 'sectPr').at(-1);
    if (final) body.replaceChild(sectPr, final);
    else body.appendChild(sectPr);
  }
}

function wChildren(el: Element, local: string) {
  return elementChildren(el).filter((c) => isW(c, local));
}

/** Containers left invalid by removals: empty cells, tables without rows, empty content controls. */
export function tidy(body: Element) {
  const doc = body.ownerDocument;
  for (const tbl of Array.from(body.getElementsByTagNameNS(NS.w, 'tbl')).reverse()) {
    if (!tbl.getElementsByTagNameNS(NS.w, 'tr').length) {
      const parent = tbl.parentElement;
      remove(tbl);
      if (parent && isW(parent, 'tc') && !isW(parent.lastElementChild, 'p')) parent.appendChild(wEl(doc, 'p'));
    }
  }
  for (const tc of Array.from(body.getElementsByTagNameNS(NS.w, 'tc'))) if (!isW(tc.lastElementChild, 'p')) tc.appendChild(wEl(doc, 'p'));
  for (const sdt of Array.from(body.getElementsByTagNameNS(NS.w, 'sdtContent')).reverse()) {
    const outer = sdt.parentElement;
    if (!outer || insideParagraph(outer)) continue; // inline content controls (checkboxes, plain text…)
    if (!elementChildren(sdt).some((c) => isW(c, 'p') || isW(c, 'tbl') || isW(c, 'tr') || isW(c, 'tc') || isW(c, 'sdt'))) remove(outer);
  }
}

function insideParagraph(el: Element): boolean {
  for (let a = el.parentElement; a; a = a.parentElement) if (isW(a, 'p')) return true;
  return false;
}
