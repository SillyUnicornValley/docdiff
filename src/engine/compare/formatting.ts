// Formatting check (decision 44, stage5-design §4): formatting differences of
// paired paragraphs and tables. Shown only — a formatting difference is never
// a choice, and the export keeps the new file's formatting.
//
//  - paragraph properties: style name, alignment, indents, spacing;
//  - list type, when both paragraphs are list items ("Bullet •" → "Numbered 1.");
//  - character formatting, compared on the words both paragraphs share (changed
//    words are content differences and already highlighted);
//  - table style.
// Paragraphs whose heading level changed are left out: the ⚑ hint covers them,
// and every property their styles set would differ too.

import type { DiffResult, FormatChange, FormatItem } from '../../model/diff';
import { DocIndex } from '../../model/docIndex';
import type { DocModel, FormatProps, ParagraphBlock } from '../../model/document';
import { flattenParagraph } from '../../model/flatten';
import { pairedNodes, roleLabel } from '../../model/hints';
import { diffKeys } from '../align/myers';
import { tokenize } from './wordDiff';

const preview = (t: string) => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

/** Format index at a position, walking forward through sorted runs. */
class Cursor {
  private i = 0;
  constructor(private runs: [number, number, number][]) {}
  at(pos: number): number {
    while (this.i < this.runs.length && this.runs[this.i][1] <= pos) this.i++;
    const r = this.runs[this.i];
    return r && r[0] <= pos ? r[2] : -1;
  }
}

export function compareFormatting(r: Pick<DiffResult, 'segments' | 'differences'>, o: DocModel, n: DocModel): FormatChange[] {
  const ix = { old: new DocIndex(o), new: new DocIndex(n) };
  const paired = pairedNodes(r, ix);
  const oldFormats = o.runFormats ?? [];
  const newFormats = n.runFormats ?? [];
  const oldKeys = oldFormats.map((f) => JSON.stringify(f));
  const newKeys = newFormats.map((f) => JSON.stringify(f));
  const propDiffCache = new Map<string, string[]>();
  const differingProps = (a: number, b: number): string[] => {
    if (a < 0 || b < 0 || oldKeys[a] === newKeys[b]) return [];
    const key = `${a}|${b}`;
    let hit = propDiffCache.get(key);
    if (!hit) {
      const x = oldFormats[a];
      const y = newFormats[b];
      hit = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]);
      propDiffCache.set(key, hit);
    }
    return hit;
  };

  const changes: FormatChange[] = [];
  for (const [op, np] of paired.paragraphs) {
    if (roleLabel(op.role) !== roleLabel(np.role)) continue;
    const items: FormatItem[] = [];
    if (op.format && np.format) items.push(...propItems(op.format.para, np.format.para));
    if (op.numbering?.listStyle && np.numbering?.listStyle && op.numbering.listStyle !== np.numbering.listStyle)
      items.push({ property: 'List type', old: op.numbering.listStyle, new: np.numbering.listStyle });
    if (op.format && np.format) items.push(...charItems(op, np, oldFormats, newFormats, differingProps));
    if (items.length) changes.push({ target: 'paragraph', oldId: op.id, newId: np.id, text: preview(flattenParagraph(np).text), items });
  }
  for (const [ot, nt] of paired.tables) {
    if (ot.style !== undefined && nt.style !== undefined && ot.style !== nt.style) {
      const first = nt.rows[0]?.cells[0]?.blocks.find((b): b is ParagraphBlock => b.kind === 'paragraph');
      changes.push({ target: 'table', oldId: ot.id, newId: nt.id, text: first ? preview(flattenParagraph(first).text) : '', items: [{ property: 'Table style', old: ot.style, new: nt.style }] });
    }
  }
  return changes;
}

function propItems(a: FormatProps, b: FormatProps): FormatItem[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).map((k) => ({ property: k, old: a[k] ?? '—', new: b[k] ?? '—' }));
}

/** Character formatting differences on the shared words, grouped into ranges of the new text. */
function charItems(
  op: ParagraphBlock,
  np: ParagraphBlock,
  oldFormats: FormatProps[],
  newFormats: FormatProps[],
  differingProps: (a: number, b: number) => string[],
): FormatItem[] {
  const oc = new Cursor(op.format!.runs);
  const nc = new Cursor(np.format!.runs);
  const ta = tokenize([op]);
  const tb = tokenize([np]);
  const text = flattenParagraph(np).text;
  // Open range per "property|old|new": [start, end] in the new text.
  const open = new Map<string, { item: FormatItem; start: number; end: number }>();
  const done: { item: FormatItem; start: number }[] = [];
  const close = (k: string) => {
    const g = open.get(k)!;
    open.delete(k);
    g.item.places = [preview(text.slice(g.start, g.end))];
    done.push({ item: g.item, start: g.start });
  };
  for (const op2 of diffKeys(
    ta.map((t) => t.key),
    tb.map((t) => t.key),
  )) {
    if (op2.type !== 'equal') continue;
    const a = ta[op2.a];
    const b = tb[op2.b];
    if (!a.word) continue; // spaces and punctuation: formatting there is invisible or noise
    for (let k = 0; k < b.end - b.start; k++) {
      const fa = oc.at(a.start + k);
      const fb = nc.at(b.start + k);
      const pos = b.start + k;
      for (const prop of differingProps(fa, fb)) {
        const ov = oldFormats[fa][prop] ?? '—';
        const nv = newFormats[fb][prop] ?? '—';
        const key = `${prop}|${ov}|${nv}`;
        const g = open.get(key);
        // Extend across the spaces between words with the same change.
        if (g && /^[\s\p{P}]*$/u.test(text.slice(g.end, pos))) g.end = pos + 1;
        else {
          if (g) close(key);
          open.set(key, { item: { property: prop, old: ov, new: nv }, start: pos, end: pos + 1 });
        }
      }
    }
  }
  for (const k of [...open.keys()]) close(k);
  // One item per property change, listing every place it applies: “Each”, “receive”, “baseline”.
  const grouped = new Map<string, { item: FormatItem; texts: string[] }>();
  for (const d of done.sort((x, y) => x.start - y.start)) {
    const key = `${d.item.property}|${d.item.old}|${d.item.new}`;
    const g = grouped.get(key);
    if (g) g.texts.push(...d.item.places!);
    else grouped.set(key, { item: d.item, texts: [...d.item.places!] });
  }
  return [...grouped.values()].map(({ item, texts }) => ({ property: item.property, old: item.old, new: item.new, places: texts }));
}
