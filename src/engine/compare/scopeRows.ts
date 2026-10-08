// "Detected only" rows of the check-scope panel (spec/comparison §5) for real files.
// The mock builder lists these by hand; the engine counts them.

import type { DocModel } from '../../model/document';
import type { ScopeItem } from '../../model/diff';
import { forEachParagraph } from '../../model/docIndex';

function counts(d: DocModel) {
  let footnotes = 0;
  let endnotes = 0;
  let hyperlinks = 0;
  forEachParagraph(d.blocks, (p) => {
    for (const i of p.content) {
      if (i.type === 'hyperlink') hyperlinks++;
      if (i.type === 'placeholder' && i.kind === 'footnoteRef') footnotes++;
      if (i.type === 'placeholder' && i.kind === 'endnoteRef') endnotes++;
    }
  });
  return { footnotes, endnotes, hyperlinks, properties: d.partFingerprints.properties ? 1 : 0 };
}

export function detectedOnlyRows(o: DocModel, n: DocModel): ScopeItem[] {
  const a = counts(o);
  const b = counts(n);
  const rows: [string, keyof typeof a][] = [
    ['Footnote text', 'footnotes'],
    ['Endnote text', 'endnotes'],
    ['Hyperlink addresses', 'hyperlinks'],
    ['Document properties', 'properties'],
  ];
  return rows.filter(([, k]) => a[k] + b[k] > 0).map(([element, k]) => ({ element, status: 'detectedOnly', oldCount: a[k], newCount: b[k] }));
}
