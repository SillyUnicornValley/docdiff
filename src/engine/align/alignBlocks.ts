// Align the blocks of one container (docs/stage2-design.md §3.1):
//  1. anchors: blocks whose content is unique on both sides (patience diff);
//  2. Myers diff between anchors;
//  3. in each changed gap, pair blocks by similarity, in order, allowing
//     1→2..3 splits, 2..3→1 joins, and paragraphs ↔ a table (replaced);
//  4. moves: unpaired deleted/inserted paragraphs that match elsewhere.
// A lone deleted + inserted paragraph at the same place becomes one
// "modified" pair even when unrelated (shown as a whole replacement).

import type { Block, ParagraphBlock } from '../../model/document';
import { forEachParagraph } from '../../model/docIndex';
import { flattenParagraph } from '../../model/flatten';
import { blockKey } from '../compare/keys';
import { similarity, wordCount } from '../compare/wordDiff';
import { diffKeys } from './myers';

export type AlignOp =
  | { type: 'equal'; o: Block; n: Block }
  | { type: 'del'; o: Block }
  | { type: 'ins'; n: Block }
  /** Paired content: 1:1, a split (1:k) or a join (k:1). */
  | { type: 'pair'; o: Block[]; n: Block[]; sim: number }
  /** Moved paragraph: both halves share `move`. */
  | { type: 'moveFrom'; o: Block; move: number; sim: number }
  | { type: 'moveTo'; n: Block; move: number; sim: number };

/** Pairing thresholds (stage2-design §3.1). */
export const PAIR_MIN = 0.5;
export const SPLIT_JOIN_MIN = 0.8;
export const MOVE_MIN = 0.8;
export const MOVE_MIN_WORDS = 5;
/** Larger gaps are not paired (two unrelated documents): everything is deleted / inserted. */
const MAX_GAP_CELLS = 40_000;
const MAX_SPLIT = 3;

const isPara = (b: Block): b is ParagraphBlock => b.kind === 'paragraph';
const isEmpty = (b: Block) => isPara(b) && flattenParagraph(b).text.trim() === '';

/** Paragraphs a block contributes to similarity: itself, or all paragraphs of a table. */
function parasOf(blocks: Block[]): ParagraphBlock[] {
  const out: ParagraphBlock[] = [];
  forEachParagraph(blocks, (p) => out.push(p));
  return out;
}

/** Patience anchors: (oldIndex, newIndex) of keys unique on both sides, longest increasing run. */
function anchors(a: string[], b: string[]): [number, number][] {
  const count = (ks: string[]) => {
    const m = new Map<string, number>();
    ks.forEach((k, i) => m.set(k, m.has(k) ? -1 : i));
    return m;
  };
  const ua = count(a);
  const ub = count(b);
  const pairs: [number, number][] = [];
  a.forEach((k, i) => {
    const j = ub.get(k);
    if (ua.get(k) === i && j !== undefined && j >= 0) pairs.push([i, j]);
  });
  // Longest increasing subsequence on j (pairs are sorted by i).
  const tails: number[] = [];
  const prev = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([, j], idx) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[idx] = tails[lo - 1];
    tails[lo] = idx;
  });
  const out: [number, number][] = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k]) out.push(pairs[k]);
  return out.reverse();
}

/** Step 1 + 2: equal / del / ins ops in document order. */
function exactOps(o: Block[], n: Block[]): AlignOp[] {
  const a = o.map(blockKey);
  const b = n.map(blockKey);
  const ops: AlignOp[] = [];
  let i0 = 0;
  let j0 = 0;
  const run = (i1: number, j1: number) => {
    for (const op of diffKeys(a.slice(i0, i1), b.slice(j0, j1))) {
      if (op.type === 'equal') ops.push({ type: 'equal', o: o[i0 + op.a], n: n[j0 + op.b] });
      else if (op.type === 'delete') ops.push({ type: 'del', o: o[i0 + op.a] });
      else ops.push({ type: 'ins', n: n[j0 + op.b] });
    }
  };
  for (const [i, j] of anchors(a, b)) {
    run(i, j);
    ops.push({ type: 'equal', o: o[i], n: n[j] });
    i0 = i + 1;
    j0 = j + 1;
  }
  run(a.length, b.length);
  return ops;
}

/** Can these blocks take part in a similarity pairing? */
const pairable = (x: Block, y: Block) => (isPara(x) && isPara(y) && !isEmpty(x) && !isEmpty(y)) || (x.kind === 'table' && y.kind === 'table');

/** Paragraphs on one side, one table on the other: a block-type change (spec §7.7, "replaced"). */
function replacement(os: Block[], ns: Block[]) {
  const paras = (bs: Block[]) => bs.every((b) => isPara(b) && !isEmpty(b));
  const table = (bs: Block[]) => bs.length === 1 && bs[0].kind === 'table';
  return (paras(os) && table(ns)) || (table(os) && paras(ns));
}

/** Step 3: order-preserving pairing inside one gap by dynamic programming. */
function pairGap(O: Block[], N: Block[]): AlignOp[] {
  const n = O.length;
  const m = N.length;
  const unpaired = (): AlignOp[] => [...O.map((o): AlignOp => ({ type: 'del', o })), ...N.map((x): AlignOp => ({ type: 'ins', n: x }))];
  if (n === 0 || m === 0 || n * m > MAX_GAP_CELLS) return unpaired();

  const len = (bs: Block[]) => wordCount(parasOf(bs)) + 1;
  const simCache = new Map<string, number>();
  const sim = (i0: number, i1: number, j0: number, j1: number) => {
    const k = `${i0},${i1},${j0},${j1}`;
    let s = simCache.get(k);
    if (s === undefined) simCache.set(k, (s = similarity(parasOf(O.slice(i0, i1)), parasOf(N.slice(j0, j1)))));
    return s;
  };

  // score[i][j]: best total for O[0..i) vs N[0..j). Matched content scores sim × size.
  const W = m + 1;
  const score = new Float64Array((n + 1) * W);
  const back = new Int32Array((n + 1) * W); // encoded step: 0 del, 1 ins, 100·ko + kn for a match
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = -1;
      let step = 0;
      if (i > 0 && score[(i - 1) * W + j] > best) (best = score[(i - 1) * W + j]), (step = 0);
      if (j > 0 && score[i * W + j - 1] > best) (best = score[i * W + j - 1]), (step = 1);
      if (i > 0 && j > 0) {
        for (let ko = 1; ko <= Math.min(MAX_SPLIT, i); ko++)
          for (let kn = 1; kn <= Math.min(MAX_SPLIT, j); kn++) {
            if (ko > 1 && kn > 1) continue; // splits and joins only, not n:m
            const os = O.slice(i - ko, i);
            const ns = N.slice(j - kn, j);
            const mixed = replacement(os, ns);
            const ok = mixed || (ko === 1 && kn === 1 ? pairable(os[0], ns[0]) : [...os, ...ns].every((b) => isPara(b) && !isEmpty(b)));
            if (!ok) continue;
            const s = sim(i - ko, i, j - kn, j);
            if (s < (mixed || (ko === 1 && kn === 1) ? PAIR_MIN : SPLIT_JOIN_MIN)) continue;
            const v = score[(i - ko) * W + j - kn] + s * (len(os) + len(ns));
            if (v > best) (best = v), (step = 100 * ko + kn);
          }
      }
      score[i * W + j] = best;
      back[i * W + j] = step;
    }

  const rev: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = back[i * W + j];
    if (step === 0) rev.push({ type: 'del', o: O[--i] });
    else if (step === 1) rev.push({ type: 'ins', n: N[--j] });
    else {
      const ko = Math.floor(step / 100);
      const kn = step % 100;
      rev.push({ type: 'pair', o: O.slice(i - ko, i), n: N.slice(j - kn, j), sim: sim(i - ko, i, j - kn, j) });
      i -= ko;
      j -= kn;
    }
  }
  return rev.reverse();
}

/** Within each run of unpaired ops: deletions first, then insertions (old content is shown above new). */
function normalise(ops: AlignOp[]): AlignOp[] {
  const out: AlignOp[] = [];
  let dels: AlignOp[] = [];
  let ins: AlignOp[] = [];
  const flush = () => {
    out.push(...dels, ...ins);
    dels = [];
    ins = [];
  };
  for (const op of ops) {
    if (op.type === 'del' || op.type === 'moveFrom') dels.push(op);
    else if (op.type === 'ins' || op.type === 'moveTo') ins.push(op);
    else {
      flush();
      out.push(op);
    }
  }
  flush();
  return out;
}

export function alignBlocks(o: Block[], n: Block[]): AlignOp[] {
  // Steps 1–3.
  const exact = exactOps(o, n);
  let ops: AlignOp[] = [];
  let gapO: Block[] = [];
  let gapN: Block[] = [];
  const flushGap = () => {
    if (gapO.length || gapN.length) ops.push(...pairGap(gapO, gapN));
    gapO = [];
    gapN = [];
  };
  for (const op of exact) {
    if (op.type === 'del') gapO.push(op.o);
    else if (op.type === 'ins') gapN.push(op.n);
    else {
      flushGap();
      ops.push(op);
    }
  }
  flushGap();

  // Step 4: moves among the remaining deleted / inserted paragraphs.
  const dels = ops.flatMap((op, k) => (op.type === 'del' && isPara(op.o) && wordCount([op.o]) >= MOVE_MIN_WORDS ? [k] : []));
  const inss = ops.flatMap((op, k) => (op.type === 'ins' && isPara(op.n) && wordCount([op.n]) >= MOVE_MIN_WORDS ? [k] : []));
  const candidates: { d: number; i: number; s: number }[] = [];
  if (dels.length * inss.length <= MAX_GAP_CELLS)
    for (const d of dels)
      for (const i of inss) {
        const s = similarity([(ops[d] as { o: ParagraphBlock }).o], [(ops[i] as { n: ParagraphBlock }).n]);
        if (s >= MOVE_MIN) candidates.push({ d, i, s });
      }
  candidates.sort((x, y) => y.s - x.s);
  const used = new Set<number>();
  let moveNo = 0;
  for (const c of candidates) {
    if (used.has(c.d) || used.has(c.i)) continue;
    used.add(c.d).add(c.i);
    const move = ++moveNo;
    ops[c.d] = { type: 'moveFrom', o: (ops[c.d] as { o: Block }).o, move, sim: c.s };
    ops[c.i] = { type: 'moveTo', n: (ops[c.i] as { n: Block }).n, move, sim: c.s };
  }

  ops = normalise(ops);

  // A lone deleted + inserted paragraph at the same place: one whole replacement.
  const out: AlignOp[] = [];
  for (let k = 0; k < ops.length; k++) {
    const a = ops[k];
    const b = ops[k + 1];
    const before = ops[k - 1];
    const after = ops[k + 2];
    const lone = (x?: AlignOp) => !x || (x.type !== 'del' && x.type !== 'ins');
    if (a.type === 'del' && b?.type === 'ins' && lone(before) && lone(after) && isPara(a.o) && isPara(b.n) && !isEmpty(a.o) && !isEmpty(b.n)) {
      out.push({ type: 'pair', o: [a.o], n: [b.n], sim: similarity([a.o], [b.n]) });
      k++;
    } else out.push(a);
  }
  return out;
}
