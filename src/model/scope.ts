// Check scope (spec/comparison §5): what was compared, detected only, or shown only,
// with counts per file. Derived from the two DocModels; shared by the engine
// and the mock builder.

import type { DocModel, DocSection, FingerprintedPart, HeaderVariant } from './document';
import type { CheckScope, FingerprintHint, ScopeItem, SectionHint } from './diff';
import { forEachBlock } from './docIndex';

const PART_LABEL: Record<FingerprintedPart, string> = {
  footnotes: 'Footnote text',
  endnotes: 'Endnote text',
  images: 'Images',
  hyperlinkUrls: 'Hyperlink addresses',
  textBoxes: 'Text boxes',
  properties: 'Document properties',
};

const VARIANTS: HeaderVariant[] = ['default', 'first', 'even'];

export interface ScopeOptions {
  /** Extra rows appended after the computed ones. */
  extraScope?: ScopeItem[];
  pendingRevisionsInNew?: number;
  sectionHints?: SectionHint[];
}

export function computeScope(o: DocModel, n: DocModel, opts: ScopeOptions = {}): CheckScope {
  const count = (d: DocModel) => {
    const c = {
      paragraphs: 0,
      listItems: 0,
      autoNumbers: 0,
      tables: 0,
      rows: 0,
      cells: 0,
      sup: 0,
      hiddenRuns: 0,
      footnoteRefs: 0,
      images: 0,
      fields: 0,
      crossRefs: 0,
      hyperlinks: 0,
      toc: 0,
      textBoxes: 0,
      equations: 0,
    };
    forEachBlock(d.blocks, (b) => {
      if (b.kind === 'table') {
        c.tables++;
        c.rows += b.rows.length;
        c.cells += b.rows.reduce((k, r) => k + r.cells.length, 0);
      } else if (b.kind === 'placeholder') {
        if (b.element === 'toc') c.toc++;
        else if (b.element === 'textBox') c.textBoxes++;
        else if (b.element === 'equation') c.equations++;
        else c.images++;
      } else {
        c.paragraphs++;
        if (b.role.type === 'listItem') c.listItems++;
        if (b.numbering) c.autoNumbers++;
        for (const i of b.content) {
          if (i.type === 'text' && (i.marks?.superscript || i.marks?.subscript)) c.sup++;
          if (i.type === 'text' && i.marks?.hidden) c.hiddenRuns++;
          if (i.type === 'hyperlink') c.hyperlinks++;
          if (i.type === 'field') i.fieldType === 'REF' ? c.crossRefs++ : c.fields++;
          if (i.type === 'placeholder') {
            if (i.kind === 'footnoteRef' || i.kind === 'endnoteRef') c.footnoteRefs++;
            else if (i.kind === 'textBox') c.textBoxes++;
            else if (i.kind === 'equation') c.equations++;
            else c.images++;
          }
        }
      }
    });
    return c;
  };
  const a = count(o);
  const b = count(n);
  const rows: [string, ScopeItem['status'], keyof typeof a][] = [
    ['Paragraphs (body text and headings)', 'compared', 'paragraphs'],
    ['List items (text)', 'compared', 'listItems'],
    ['Tables', 'compared', 'tables'],
    ['Table rows', 'compared', 'rows'],
    ['Superscript / subscript runs', 'compared', 'sup'],
    ['Hidden text runs', 'compared', 'hiddenRuns'],
    ['Footnote / endnote references (position)', 'compared', 'footnoteRefs'],
    ['Cross-references (displayed result)', 'compared', 'crossRefs'],
    ['Hyperlinks (display text)', 'compared', 'hyperlinks'],
    ['List numbers and bullets (automatic)', 'shownNotCompared', 'autoNumbers'],
    ['Table of contents', 'shownNotCompared', 'toc'],
    ['Date, page and other fields', 'shownNotCompared', 'fields'],
    ['Images, charts, shapes', 'shownNotCompared', 'images'],
    ['Text boxes', 'shownNotCompared', 'textBoxes'],
    ['Equations', 'shownNotCompared', 'equations'],
  ];
  const items: ScopeItem[] = rows
    .filter(([, , k]) => a[k] + b[k] > 0 || k === 'paragraphs')
    .map(([element, status, k]) => ({ element, status, oldCount: a[k], newCount: b[k] }));
  const hfCount = (d: DocModel) =>
    d.sections.reduce((k, sec) => k + [...Object.values(sec.headers), ...Object.values(sec.footers)].filter((r) => r && !r.linkedToPrevious).length, 0);
  if (hfCount(o) + hfCount(n) > 0) items.push({ element: 'Headers and footers', status: 'detectedOnly', oldCount: hfCount(o), newCount: hfCount(n) });
  items.push({ element: 'Comments', status: 'notSupported', oldCount: o.commentCount, newCount: n.commentCount });
  items.push(...(opts.extraScope ?? []));

  const parts = new Set<FingerprintedPart>([
    ...(Object.keys(o.partFingerprints) as FingerprintedPart[]),
    ...(Object.keys(n.partFingerprints) as FingerprintedPart[]),
  ]);
  const fingerprints: FingerprintHint[] = [...parts].map((p) => {
    const x = o.partFingerprints[p];
    const y = n.partFingerprints[p];
    if (!x && !y) return { part: p, result: 'absent' };
    if (x === y) return { part: p, result: 'same', message: `${PART_LABEL[p]}: same in both files.` };
    return { part: p, result: 'mayDiffer', message: `${PART_LABEL[p]} may differ — not compared item by item. Check in Word.` };
  });

  return {
    items,
    fingerprints,
    sectionHints: opts.sectionHints ?? sectionHintsByIndex(o.sections, n.sections),
    formatting: 'notChecked',
    unsupportedRevisions: [
      ...o.revisions.unsupported.map((u) => ({ side: 'old' as const, type: u.type, location: u.location })),
      ...n.revisions.unsupported.map((u) => ({ side: 'new' as const, type: u.type, location: u.location })),
    ],
    pendingRevisionsInNew: opts.pendingRevisionsInNew ?? 0,
  };
}

/** Sections paired by index. The full engine (M4) pairs them by where their breaks align. */
export function sectionHintsByIndex(o: DocSection[], n: DocSection[]): SectionHint[] {
  const hints: SectionHint[] = [];
  for (let i = 0; i < Math.max(o.length, n.length); i++) {
    const a = o[i];
    const b = n[i];
    for (const part of ['header', 'footer'] as const) {
      const key = part === 'header' ? 'headers' : 'footers';
      for (const v of VARIANTS) {
        const x = a?.[key][v];
        const y = b?.[key][v];
        if (!x && !y) continue;
        const result: SectionHint['result'] = !a ? 'onlyNew' : !b ? 'onlyOld' : x?.fingerprint === y?.fingerprint ? 'same' : 'mayDiffer';
        hints.push({ part, variant: v, oldSection: a?.index, newSection: b?.index, result });
      }
    }
  }
  return hints;
}
