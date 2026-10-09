// Other parts, compared item by item (decisions 45–46, stage5-design §5–§6):
// footnotes, endnotes, headers, footers, text boxes, hyperlink addresses,
// pictures, document properties and comments. Shown only: none of these is a
// choice, and the export keeps the new file's versions.

import type { CommentPair, DiffResult, ImageChange, LinkChange, OtherParts, PartPair, PropertyChange } from '../../model/diff';
import { DocIndex, forEachParagraph } from '../../model/docIndex';
import type { Block, CommentItem, DocModel, HyperlinkInline, InlinePlaceholder, ParagraphBlock } from '../../model/document';
import { flattenParagraph } from '../../model/flatten';
import { pairedNodes } from '../../model/hints';
import { diffKeys } from '../align/myers';
import { blockKey } from './keys';
import { similarity, wordDiff } from './wordDiff';

const VARIANT = { default: '', first: ' (first page)', even: ' (even pages)' } as const;

const parasIn = (blocks: Block[]) => {
  const out: ParagraphBlock[] = [];
  forEachParagraph(blocks, (p) => out.push(p));
  return out;
};
const contentKey = (blocks: Block[]) => blocks.map(blockKey).join('\u0003');
const preview = (t: string) => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

function partPair(label: string, o: Block[] | undefined, n: Block[] | undefined): PartPair {
  if (!o) return { label, status: 'onlyNew', old: [], new: n ?? [], hunks: [] };
  if (!n) return { label, status: 'onlyOld', old: o, new: [], hunks: [] };
  if (contentKey(o) === contentKey(n)) return { label, status: 'same', old: [], new: [], hunks: [] };
  return { label, status: 'changed', old: o, new: n, hunks: wordDiff(parasIn(o), parasIn(n)) };
}

/** Below this word similarity two leftover items are not the same item edited. */
const MIN_SIMILARITY = 0.4;

/**
 * Pair two lists in order: identical items first; the leftovers between them
 * by best word similarity (an edited footnote), the rest are on one side only.
 */
function pairInOrder<T>(a: T[], b: T[], key: (x: T) => string, blocks: (x: T) => Block[]): [T | undefined, T | undefined][] {
  const out: [T | undefined, T | undefined][] = [];
  let ga: T[] = [];
  let gb: T[] = [];
  const flush = () => {
    const taken = new Set<number>();
    const match = ga.map((x) => {
      let best = -1;
      let bestSim = MIN_SIMILARITY;
      gb.forEach((y, j) => {
        if (taken.has(j)) return;
        const sim = similarity(parasIn(blocks(x)), parasIn(blocks(y)));
        if (sim >= bestSim) (best = j), (bestSim = sim);
      });
      if (best >= 0) taken.add(best);
      return best;
    });
    // New-file order; old-only items go where their old neighbours are.
    let j = 0;
    ga.forEach((x, i) => {
      if (match[i] < 0) return void out.push([x, undefined]);
      for (; j <= match[i]; j++) if (!taken.has(j) || j === match[i]) out.push(j === match[i] ? [x, gb[j]] : [undefined, gb[j]]);
    });
    for (; j < gb.length; j++) if (!taken.has(j)) out.push([undefined, gb[j]]);
    ga = [];
    gb = [];
  };
  for (const op of diffKeys(a.map(key), b.map(key))) {
    if (op.type === 'equal') {
      flush();
      out.push([a[op.a], b[op.b]]);
    } else if (op.type === 'delete') ga.push(a[op.a]);
    else gb.push(b[op.b]);
  }
  flush();
  return out;
}

function notes(o: DocModel, n: DocModel, kind: 'footnotes' | 'endnotes'): PartPair[] {
  const word = kind === 'footnotes' ? 'Footnote' : 'Endnote';
  return pairInOrder(o.parts?.[kind] ?? [], n.parts?.[kind] ?? [], (x) => contentKey(x.blocks), (x) => x.blocks).map(([x, y]) => {
    const num = (s?: string) => s?.replace(`${word} `, '');
    const label = x && y ? (num(x.label) === num(y.label) ? x.label : `${word} ${num(x.label)} → ${num(y.label)}`) : (x ?? y)!.label;
    return partPair(label, x?.blocks, y?.blocks);
  });
}

function headersFooters(r: Pick<DiffResult, 'scope'>, o: DocModel, n: DocModel): PartPair[] {
  const out: PartPair[] = [];
  for (const h of r.scope.sectionHints) {
    const key = h.part === 'header' ? 'headers' : 'footers';
    const x = h.oldSection ? o.sections[h.oldSection - 1]?.[key][h.variant] : undefined;
    const y = h.newSection ? n.sections[h.newSection - 1]?.[key][h.variant] : undefined;
    // A section that reuses the previous section's header on both sides adds nothing new.
    if (x?.linkedToPrevious && y?.linkedToPrevious) continue;
    const sec = h.oldSection === h.newSection ? `Section ${h.newSection}` : `Section ${h.oldSection ?? '–'} → ${h.newSection ?? '–'}`;
    const label = `${sec} · ${h.part === 'header' ? 'Header' : 'Footer'}${VARIANT[h.variant]}`;
    const ob = x?.part ? o.parts?.headersFooters[x.part] : undefined;
    const nb = y?.part ? n.parts?.headersFooters[y.part] : undefined;
    if (!ob && !nb) continue;
    out.push(partPair(label, ob, nb));
  }
  return out;
}

function textBoxes(o: DocModel, n: DocModel): PartPair[] {
  return pairInOrder(o.parts?.textBoxes ?? [], n.parts?.textBoxes ?? [], contentKey, (x) => x).map(([x, y], i) => partPair(`Text box ${i + 1}`, x, y));
}

function linksAndImages(r: Pick<DiffResult, 'segments' | 'differences'>, o: DocModel, n: DocModel) {
  const links: LinkChange[] = [];
  const images: ImageChange[] = [];
  const paired = pairedNodes(r, { old: new DocIndex(o), new: new DocIndex(n) });
  for (const [op, np] of paired.paragraphs) {
    const lk = (p: ParagraphBlock) => p.content.filter((i): i is HyperlinkInline => i.type === 'hyperlink');
    const [la, lb] = [lk(op), lk(np)];
    for (let i = 0; i < Math.min(la.length, lb.length); i++)
      if (la[i].urlFingerprint !== lb[i].urlFingerprint)
        links.push({ text: lb[i].content.map((t) => t.text).join(''), old: la[i].target ?? '(unknown)', new: lb[i].target ?? '(unknown)', newId: np.id });
    const im = (p: ParagraphBlock) => p.content.filter((i): i is InlinePlaceholder => i.type === 'placeholder' && i.kind === 'image');
    const [ia, ib] = [im(op), im(np)];
    for (let i = 0; i < Math.min(ia.length, ib.length); i++)
      if (ia[i].fingerprint && ib[i].fingerprint && ia[i].fingerprint !== ib[i].fingerprint)
        images.push({ label: ib[i].label, text: preview(flattenParagraph(np).text.replace(/￼/g, '')) || '(picture only)', newId: np.id });
  }
  return { links, images };
}

function properties(o: DocModel, n: DocModel): PropertyChange[] {
  const a = o.parts?.properties ?? {};
  const b = n.parts?.properties ?? {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).map((k) => ({ name: k, old: a[k], new: b[k] }));
}

/**
 * Comments (decision 46): same author and text and anchor → same; then same
 * author and anchor → text changed; then same author and text → anchor changed;
 * the rest are only in one file.
 */
function comments(o: DocModel, n: DocModel): CommentPair[] {
  const left = [...(o.comments ?? [])];
  const right = [...(n.comments ?? [])];
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const pairs: CommentPair[] = [];
  const pass = (status: CommentPair['status'], key: (c: CommentItem) => string) => {
    for (const c of [...left]) {
      const k = key(c);
      const j = right.findIndex((d) => key(d) === k);
      if (j < 0) continue;
      pairs.push({ status, old: c, new: right[j] });
      left.splice(left.indexOf(c), 1);
      right.splice(j, 1);
    }
  };
  pass('same', (c) => `${c.author}\u0001${norm(c.text)}\u0001${norm(c.anchor)}`);
  pass('textChanged', (c) => `${c.author}\u0001${norm(c.anchor)}`);
  pass('anchorChanged', (c) => `${c.author}\u0001${norm(c.text)}`);
  pairs.push(...left.map((c) => ({ status: 'onlyOld' as const, old: c })), ...right.map((c) => ({ status: 'onlyNew' as const, new: c })));
  // Document order of the new file, then the old-only ones in theirs.
  const order = new Map((n.comments ?? []).map((c, i) => [c.id, i]));
  const oldOrder = new Map((o.comments ?? []).map((c, i) => [c.id, i]));
  const rank = (p: CommentPair) => (p.new ? (order.get(p.new.id) ?? 0) : 1e6 + (oldOrder.get(p.old!.id) ?? 0));
  return pairs.sort((x, y) => rank(x) - rank(y));
}

export function compareOtherParts(r: Pick<DiffResult, 'segments' | 'differences' | 'scope'>, o: DocModel, n: DocModel): OtherParts {
  return {
    footnotes: notes(o, n, 'footnotes'),
    endnotes: notes(o, n, 'endnotes'),
    headersFooters: headersFooters(r, o, n),
    textBoxes: textBoxes(o, n),
    ...linksAndImages(r, o, n),
    properties: properties(o, n),
    comments: comments(o, n),
  };
}
