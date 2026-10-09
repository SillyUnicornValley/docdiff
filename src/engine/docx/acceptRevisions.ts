// "Accept all tracked changes" on a parsed part, in place (spec/reading, decision 22).
// Comparison and export both work on the result, so no position mapping is needed.

import { isW, NS, plainText, remove, unwrap, wAll, wChild } from './xml';

export interface AcceptedRevisions {
  /** Revisions accepted, by readable type. */
  accepted: Map<string, number>;
  /** Revisions that may make nearby results inaccurate (spec/reading §4, decision 34): accepted anyway, reported with a location. */
  unsupported: { type: string; location: string }[];
}

/** Property-change records: accepting means keeping the current properties. */
const FORMAT_CHANGES = ['rPrChange', 'pPrChange'];

/**
 * Cell revisions (spec/reading §4, decision 34): accepted, but the table's
 * column structure may not line up afterwards, so they are reported.
 */
const CELL_CHANGES: Record<string, string> = {
  cellIns: 'Inserted table cell',
  cellDel: 'Deleted table cell',
  cellMerge: 'Merged table cell',
};

/** Other property-change records: accepting keeps the current properties; not reported (decision 34). */
const PROPERTY_CHANGES: Record<string, string> = {
  tblPrChange: 'Table property change',
  tblPrExChange: 'Table property change',
  trPrChange: 'Table property change',
  tcPrChange: 'Table property change',
  tblGridChange: 'Table property change',
  sectPrChange: 'Section and page setup change',
  numberingChange: 'List numbering change',
};

function locationOf(el: Element): string {
  let p: Element | null = el;
  while (p && !isW(p, 'p') && !isW(p, 'tbl')) p = p.parentElement;
  // Property changes sit inside pPr / rPr; walk up from there too.
  if (!p) return 'Unknown location';
  if (isW(p, 'tbl')) return 'Table';
  const text = plainText(p).trim();
  if (!text) return 'Empty paragraph';
  return `Paragraph "${text.length > 50 ? `${text.slice(0, 50)}…` : text}"`;
}

/** Paragraph mark revision: w:pPr/w:rPr/(w:del|w:ins|w:moveFrom|w:moveTo). */
function markRevision(p: Element, local: string): Element | null {
  return wChild(wChild(wChild(p, 'pPr'), 'rPr'), local);
}

/**
 * Join paragraph `p` (whose mark was deleted) into the next paragraph. The
 * joined paragraph keeps the NEXT paragraph's properties, as Word does.
 * Without a following paragraph in the same container, the mark is kept.
 */
function joinWithNext(p: Element) {
  let next = p.nextElementSibling;
  // Skip zero-width markers between the two paragraphs.
  while (next && !isW(next, 'p') && (isW(next, 'bookmarkStart') || isW(next, 'bookmarkEnd'))) next = next.nextElementSibling;
  if (!next || !isW(next, 'p')) {
    if (!plainText(p) && !p.getElementsByTagNameNS(NS.w, 'drawing').length) remove(p);
    return;
  }
  const anchor = wChild(next, 'pPr')?.nextSibling ?? next.firstChild;
  for (const c of Array.from(p.childNodes)) {
    if (isW(c, 'pPr')) continue;
    next.insertBefore(c, anchor);
  }
  remove(p);
}

export function acceptAllRevisions(root: Element): AcceptedRevisions {
  const accepted = new Map<string, number>();
  const unsupported: AcceptedRevisions['unsupported'] = [];
  const count = (type: string, n = 1) => n && accepted.set(type, (accepted.get(type) ?? 0) + n);

  // 1. Cell revisions: report with a location first (before content moves), then accept.
  for (const [local, type] of Object.entries(CELL_CHANGES)) {
    for (const el of wAll(root, local)) {
      unsupported.push({ type, location: locationOf(el) });
      if (local === 'cellDel') {
        // A deleted cell disappears when accepted.
        let tc: Element | null = el;
        while (tc && !isW(tc, 'tc')) tc = tc.parentElement;
        if (tc) remove(tc);
        else remove(el);
      } else remove(el);
    }
  }

  // 2. Deleted table rows (w:trPr/w:del) disappear; inserted rows just lose the marker.
  for (const tr of wAll(root, 'tr')) {
    const trPr = wChild(tr, 'trPr');
    if (wChild(trPr, 'del')) {
      count('Deleted table row');
      remove(tr);
    } else if (wChild(trPr, 'ins')) {
      count('Inserted table row');
      remove(wChild(trPr, 'ins')!);
    }
  }

  // 3. Paragraph marks. Collect first: joining moves nodes around.
  const deletedMarks: Element[] = [];
  for (const p of wAll(root, 'p')) {
    for (const local of ['ins', 'moveTo']) {
      const m = markRevision(p, local);
      if (m) remove(m);
    }
    const del = markRevision(p, 'del') ?? markRevision(p, 'moveFrom');
    if (del) {
      remove(del);
      deletedMarks.push(p);
    }
  }

  // 4. Run-level content: deletions and moved-away text go, insertions and moved-to text stay.
  const removeAll = (local: string, type: string) => {
    const els = wAll(root, local);
    count(type, els.length);
    for (const el of els) remove(el);
  };
  const unwrapAll = (local: string, type: string) => {
    const els = wAll(root, local);
    count(type, els.length);
    for (const el of els) unwrap(el);
  };
  removeAll('del', 'Deleted text');
  removeAll('moveFrom', 'Moved text');
  unwrapAll('ins', 'Inserted text');
  unwrapAll('moveTo', 'Moved text (destination)');
  for (const local of ['moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd'])
    for (const el of wAll(root, local)) remove(el);

  // 5. Join paragraphs whose mark was deleted (after their deleted text is gone).
  count('Deleted paragraph mark', deletedMarks.length);
  for (const p of deletedMarks) joinWithNext(p);

  // 6. Formatting changes: keep the current formatting.
  for (const local of FORMAT_CHANGES) {
    const els = wAll(root, local);
    count('Formatting change', els.length);
    for (const el of els) remove(el);
  }

  for (const [local, type] of Object.entries(PROPERTY_CHANGES)) {
    const els = wAll(root, local);
    count(type, els.length);
    for (const el of els) remove(el);
  }

  // The moved-to half of a move is not a separate revision for the user.
  accepted.delete('Moved text (destination)');

  return { accepted, unsupported };
}

/** Total number of revisions accepted (for "N pending revisions will be accepted on export"). */
export function revisionTotal(r: AcceptedRevisions): number {
  return [...r.accepted.values()].reduce((a, b) => a + b, 0) + r.unsupported.length;
}
