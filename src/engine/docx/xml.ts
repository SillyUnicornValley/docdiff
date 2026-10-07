// Small DOM helpers for WordprocessingML. All parsing uses the browser's
// DOMParser on the main thread (decision 22: DOMParser is not available in
// Web Workers).

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  v: 'urn:schemas-microsoft-com:vml',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
} as const;

export class DocxError extends Error {}

export function parseXml(text: string, partName: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new DocxError(`The file is damaged: ${partName} is not valid XML.`);
  return doc;
}

/** Element in the w: namespace, optionally with the given local name. */
export function isW(n: Node | null | undefined, local?: string): boolean {
  return !!n && n.nodeType === 1 && (n as Element).namespaceURI === NS.w && (!local || (n as Element).localName === local);
}

export function elementChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) out.push(c);
  return out;
}

/** Direct w: children, optionally filtered by local name. */
export function wChildren(el: Element, local?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (isW(c, local)) out.push(c);
  return out;
}

export function wChild(el: Element | null | undefined, local: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (isW(c, local)) return c;
  return null;
}

/** First w: descendant with the given local name. */
export function wFind(el: Element, local: string): Element | null {
  return el.getElementsByTagNameNS(NS.w, local)[0] ?? null;
}

export function wAll(el: Element | Document, local: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(NS.w, local));
}

export function wAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(NS.w, name) ?? el.getAttribute(`w:${name}`);
}

/** w:val of a child element, e.g. wVal(pPr, 'pStyle'). */
export function wVal(el: Element | null | undefined, child: string): string | null {
  return wAttr(wChild(el, child), 'val');
}

/** On/off property (w:b, w:vanish…): present and not explicitly false. */
export function onOff(el: Element | null | undefined): boolean {
  if (!el) return false;
  const v = wAttr(el, 'val');
  return v === null || !['0', 'false', 'off'].includes(v);
}

/** Replace an element by its children (used to unwrap w:ins, w:sdt content…). */
export function unwrap(el: Element) {
  const parent = el.parentNode!;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

export function remove(el: Element) {
  el.parentNode?.removeChild(el);
}

/** Visible text of a fragment: w:t only (not w:delText or w:instrText). */
export function plainText(el: Element): string {
  return wAll(el, 't')
    .map((t) => t.textContent ?? '')
    .join('');
}
