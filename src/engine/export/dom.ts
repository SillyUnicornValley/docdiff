// DOM helpers for writing WordprocessingML during export.

import { elementChildren, isW, NS } from '../docx/xml';

export const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export function wEl(doc: Document, local: string, attrs: Record<string, string> = {}): Element {
  const el = doc.createElementNS(NS.w, `w:${local}`);
  for (const [k, v] of Object.entries(attrs)) el.setAttributeNS(NS.w, `w:${k}`, v);
  return el;
}

export function insertAfter(el: Node, ref: Node) {
  ref.parentNode!.insertBefore(el, ref.nextSibling);
}

/** Element order inside w:rPr (CT_RPr), so inserted properties stay schema-valid. */
const RPR_ORDER = [
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint',
  'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u',
  'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath',
];

/** Element order inside w:pPr (CT_PPr) up to the properties export touches. */
const PPR_ORDER = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd',
  'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi',
  'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
  'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange',
];

function placeOrdered(parent: Element, child: Element, order: string[]) {
  const rank = order.indexOf(child.localName);
  for (const c of elementChildren(parent)) {
    if (isW(c) && c.localName === child.localName) {
      parent.replaceChild(child, c);
      return;
    }
  }
  const before = elementChildren(parent).find((c) => order.indexOf(c.localName) > rank);
  parent.insertBefore(child, before ?? null);
}

export function setRPr(rPr: Element, child: Element) {
  placeOrdered(rPr, child, RPR_ORDER);
}

export function setPPr(pPr: Element, child: Element) {
  placeOrdered(pPr, child, PPR_ORDER);
}

/** The w:pPr of a paragraph, created (as first child) when missing. */
export function ensurePPr(p: Element): Element {
  let pPr = elementChildren(p).find((c) => isW(c, 'pPr'));
  if (!pPr) {
    pPr = wEl(p.ownerDocument, 'pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  return pPr;
}

/** Paragraphs inside `el` (or `el` itself), skipping those inside text boxes. */
export function paragraphsIn(el: Element): Element[] {
  if (isW(el, 'p')) return [el];
  return Array.from(el.getElementsByTagNameNS(NS.w, 'p')).filter((p) => {
    for (let a = p.parentElement; a && a !== el; a = a.parentElement) if (isW(a, 'txbxContent')) return false;
    return true;
  });
}
