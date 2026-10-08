// Align two sequences of units: the blocks of a container, or the rows of a
// table (docs/implementation/stage2-design.md §3.1, §3.2):
//  1. anchors: units whose content is unique on both sides (patience diff);
//  2. Myers diff between anchors;
//  3. in each changed gap, pair units by similarity, in order (blocks also
//     allow 1→2..3 splits, 2..3→1 joins, and paragraphs ↔ a table);
//  4. moves (blocks only): unpaired deleted/inserted paragraphs that match elsewhere.
// For blocks, a lone deleted + inserted block at the same place becomes one
// pair even when unrelated (shown as a whole replacement; spec/comparison §2.2 G5).

import type { Block, ParagraphBlock, TableRow } from '../../model/document';
import { forEachParagraph } from '../../model/docIndex';
import { flattenParagraph } from '../../model/flatten';
import { blockKey } from '../compare/keys';
import { concatSig, sigSimilarity, wordCount, wordSig, type WordSig } from '../compare/wordDiff';
import { diffKeys } from './myers';

export type AlignOp<T> =
  | { type: 'equal'; o: T; n: T }
  | { type: 'del'; o: T }
  | { type: 'ins'; n: T }
  /** Paired content: 1:1, a split (1:k) or a join (k:1). */
  | { type: 'pair'; o: T[]; n: T[]; sim: number }
  /** Moved paragraph: both halves share `move`. */
  | { type: 'moveFrom'; o: T; move: number; sim: number }
  | { type: 'moveTo'; n: T; move: number; sim: number };

/** Pairing thresholds (stage2-design §3.1). */
export const PAIR_MIN = 0.5;
export const SPLIT_JOIN_MIN = 0.8;
/** Two tables at corresponding places pair more easily: row-by-row comparison is still useful. */
export const TABLE_PAIR_MIN = 0.3;
export const MOVE_MIN = 0.8;
export const MOVE_MIN_WORDS = 5;
/** Gaps up to this many cells are paired with the full table; larger ones within a diagonal band. */
const MAX_GAP_CELLS = 40_000;
const BAND_MIN = 60;
const MAX_BAND_CELLS = 600_000;
const MAX_SPLIT = 3;

/** What the generic aligner needs to know about a kind of unit. */
interface UnitSpec<T> {
  key(u: T): string;
  /** Paragraphs the unit contributes to similarity. */
  paras(us: T[]): ParagraphBlock[];
  /** Similarity of two runs; defaults to word similarity of their paragraphs. Below `min` an upper bound is enough. */
  similarity?(os: T[], ns: T[], min: number): number;
  /** Can these runs (1:1, or 1:k / k:1) be paired, and with which minimum similarity? */
  pairRule(os: T[], ns: T[]): number | undefined;
  /** Paragraph that may take part in a move (blocks only). */
  movable?(u: T): boolean;
  /**
   * Paragraph that may move even when short, if its exact text occurs only once
   * in each file (blocks only). "Bring all medication." moved within a list is a
   * move; one of several "Not applicable." paragraphs is not.
   */
  uniqueMovable?(u: T): boolean;
  /** Lone deleted + inserted unit at the same place: pair them anyway? */
  lonePair?(o: T, n: T): boolean;
  /** Units too common to anchor an alignment (empty paragraphs, empty rows). */
  weak?(u: T): boolean;
}

const isPara = (b: Block): b is ParagraphBlock => b.kind === 'paragraph';
const isEmpty = (b: Block) => isPara(b) && flattenParagraph(b).text.trim() === '';

/** Paragraphs a block contributes to similarity: itself, or all paragraphs of a table. */
function parasOf(blocks: Block[]): ParagraphBlock[] {
  const out: ParagraphBlock[] = [];
  forEachParagraph(blocks, (p) => out.push(p));
  return out;
}

/** Paragraphs on one side, one table on the other: a block-type change (spec/comparison §4, "replaced"). */
export function isReplacement(os: Block[], ns: Block[]) {
  const paras = (bs: Block[]) => bs.length > 0 && bs.every((b) => isPara(b) && !isEmpty(b));
  const table = (bs: Block[]) => bs.length === 1 && bs[0].kind === 'table';
  return (paras(os) && table(ns)) || (table(os) && paras(ns));
}

const BLOCKS: UnitSpec<Block> = {
  key: blockKey,
  paras: parasOf,
  pairRule(os, ns) {
    if (isReplacement(os, ns)) return PAIR_MIN;
    if (os.length === 1 && ns.length === 1) {
      const [x, y] = [os[0], ns[0]];
      if (x.kind === 'table' && y.kind === 'table') return TABLE_PAIR_MIN;
      return isPara(x) && isPara(y) && !isEmpty(x) && !isEmpty(y) ? PAIR_MIN : undefined;
    }
    return [...os, ...ns].every((b) => isPara(b) && !isEmpty(b)) ? SPLIT_JOIN_MIN : undefined;
  },
  movable: (b) => isPara(b) && wordCount([b]) >= MOVE_MIN_WORDS,
  uniqueMovable: (b) => isPara(b) && !isEmpty(b),
  weak: isEmpty,
  lonePair: (o, n) => (isPara(o) && isPara(n) && !isEmpty(o) && !isEmpty(n)) || isReplacement([o], [n]) || (o.kind === 'table' && n.kind === 'table'),
};

const rowKeyCache = new WeakMap<TableRow, string>();
export const rowKey = (r: TableRow) => {
  let k = rowKeyCache.get(r);
  if (k === undefined) rowKeyCache.set(r, (k = r.cells.map((c) => `${c.gridSpan}/${c.vMerge}:${c.blocks.map(blockKey).join('\u0003')}`).join('\u0004')));
  return k;
};
const rowParas = (rs: TableRow[]) => parasOf(rs.flatMap((r) => r.cells.flatMap((c) => c.blocks)));

const cellKey = (c: TableRow['cells'][number]) => c.blocks.map(blockKey).join('\u0003');

/** Word signature of one unit (cached) or of a run of units. */
const unitSigCache = new WeakMap<object, WordSig>();
function sigOf<T>(spec: UnitSpec<T>, us: T[]): WordSig {
  const one = (u: T) => {
    let sig = unitSigCache.get(u as object);
    if (!sig) unitSigCache.set(u as object, (sig = wordSig(spec.paras([u]))));
    return sig;
  };
  return us.length === 1 ? one(us[0]) : concatSig(us.map(one));
}

/**
 * Rows are short, so word similarity alone is too strict ("Creatinine | mg/dL" vs
 * "Creatinine | umol/L" shares 1 of 3 words). Also count identical cells, if at
 * least one of them has text.
 */
function rowSimilarity(os: TableRow[], ns: TableRow[]): number {
  const words = sigSimilarity(sigOf(ROWS, os), sigOf(ROWS, ns));
  if (os.length !== 1 || ns.length !== 1 || os[0].cells.length !== ns[0].cells.length) return words;
  const [a, b] = [os[0].cells, ns[0].cells];
  let same = 0;
  let sameText = 0;
  a.forEach((c, i) => {
    if (cellKey(c) !== cellKey(b[i])) return;
    same++;
    if (wordCount(parasOf(c.blocks)) > 0) sameText++;
  });
  let sim = sameText > 0 ? Math.max(words, same / a.length) : words;
  // The first column usually names the row ("Glucose | mg/dL | 70-99" → "Glucose | mmol/L | 3.9-5.5"):
  // the same name is enough to pair, even when every other cell changed.
  if (cellKey(a[0]) === cellKey(b[0]) && /\p{L}.*\p{L}|\p{L}\p{N}|\p{N}\p{L}/u.test(parasOf(a[0].blocks).map((p) => flattenParagraph(p).text).join(' ')))
    sim = Math.max(sim, PAIR_MIN);
  return sim;
}

const ROWS: UnitSpec<TableRow> = {
  key: rowKey,
  paras: rowParas,
  similarity: rowSimilarity,
  // Rows pair 1:1 only; an empty row never pairs by similarity.
  pairRule: (os, ns) => (os.length === 1 && ns.length === 1 && wordCount(rowParas(os)) > 0 && wordCount(rowParas(ns)) > 0 ? PAIR_MIN : undefined),
  weak: (r) => wordCount(rowParas([r])) === 0,
};

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
function exactOps<T>(o: T[], n: T[], spec: UnitSpec<T>): AlignOp<T>[] {
  const a = o.map(spec.key);
  const b = n.map(spec.key);
  const ops: AlignOp<T>[] = [];
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

const simOf = <T>(spec: UnitSpec<T>, os: T[], ns: T[], min = 0) =>
  spec.similarity ? spec.similarity(os, ns, min) : sigSimilarity(sigOf(spec, os), sigOf(spec, ns), min);

/**
 * Step 3: order-preserving pairing inside one gap by dynamic programming.
 * Small gaps use the full table. Large gaps (e.g. a term replaced in every
 * paragraph, so nothing is identical) only search a band around the diagonal:
 * document order is mostly kept, so pairs lie near it.
 */
function pairGap<T>(O: T[], N: T[], spec: UnitSpec<T>): AlignOp<T>[] {
  const n = O.length;
  const m = N.length;
  if (n === 0 || m === 0) return [...O.map((o): AlignOp<T> => ({ type: 'del', o })), ...N.map((x): AlignOp<T> => ({ type: 'ins', n: x }))];

  const len = (us: T[]) => us.reduce((k, u) => k + sigOf(spec, [u]).seq.length, 0) + 1;
  const keys = { o: O.map(spec.key), n: N.map(spec.key) };
  // Each (run, run) is evaluated once per cell, so no cache is needed; `min` lets most pairs stop early.
  const sim = (i0: number, i1: number, j0: number, j1: number, min = 0) => simOf(spec, O.slice(i0, i1), N.slice(j0, j1), min);

  // Band half-width: the whole table when small enough, else around the diagonal.
  const B = (n + 1) * (m + 1) <= MAX_GAP_CELLS ? Math.max(n, m) : Math.max(BAND_MIN, Math.min(Math.abs(n - m) + BAND_MIN, Math.floor(MAX_BAND_CELLS / (2 * (n + 1)))));
  const Wb = 2 * B + 1;
  const centre = (i: number) => Math.round((i * m) / n);
  const at = (i: number, j: number) => {
    const off = j - centre(i) + B;
    return off < 0 || off >= Wb ? -1 : i * Wb + off;
  };
  // score(i, j): best total for O[0..i) vs N[0..j). Matched content scores sim × size.
  const score = new Float64Array((n + 1) * Wb).fill(-Infinity);
  const back = new Int32Array((n + 1) * Wb); // encoded step: 0 del, 1 ins, 2 equal, 100·ko + kn for a match
  const get = (i: number, j: number) => {
    const k = at(i, j);
    return k < 0 ? -Infinity : score[k];
  };
  score[at(0, 0)] = 0;
  for (let i = 0; i <= n; i++) {
    const c = centre(i);
    for (let j = Math.max(0, c - B); j <= Math.min(m, c + B); j++) {
      if (i === 0 && j === 0) continue;
      let best = -Infinity;
      let step = 0;
      if (i > 0 && get(i - 1, j) > best) (best = get(i - 1, j)), (step = 0);
      if (j > 0 && get(i, j - 1) > best) (best = get(i, j - 1)), (step = 1);
      // Identical weak units (e.g. empty paragraphs) folded into the gap: keep them aligned when it costs nothing.
      if (i > 0 && j > 0 && keys.o[i - 1] === keys.n[j - 1] && get(i - 1, j - 1) + 0.01 > best) (best = get(i - 1, j - 1) + 0.01), (step = 2);
      if (i > 0 && j > 0) {
        for (let ko = 1; ko <= Math.min(MAX_SPLIT, i); ko++)
          for (let kn = 1; kn <= Math.min(MAX_SPLIT, j); kn++) {
            if (ko > 1 && kn > 1) continue; // splits and joins only, not n:m
            const prev = get(i - ko, j - kn);
            if (prev === -Infinity) continue;
            const os = O.slice(i - ko, i);
            const ns = N.slice(j - kn, j);
            const min = spec.pairRule(os, ns);
            if (min === undefined) continue;
            const s = sim(i - ko, i, j - kn, j, min);
            if (s < min) continue;
            const v = prev + s * (len(os) + len(ns));
            if (v > best) (best = v), (step = 100 * ko + kn);
          }
      }
      score[at(i, j)] = best;
      back[at(i, j)] = step;
    }
  }

  const rev: AlignOp<T>[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = back[at(i, j)];
    if (step === 0) rev.push({ type: 'del', o: O[--i] });
    else if (step === 1) rev.push({ type: 'ins', n: N[--j] });
    else if (step === 2) rev.push({ type: 'equal', o: O[--i], n: N[--j] });
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
function normalise<T>(ops: AlignOp<T>[]): AlignOp<T>[] {
  const out: AlignOp<T>[] = [];
  let dels: AlignOp<T>[] = [];
  let ins: AlignOp<T>[] = [];
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

function alignUnits<T>(o: T[], n: T[], spec: UnitSpec<T>): AlignOp<T>[] {
  // Steps 1–3. Gaps run between "strong" equal units; identical weak units
  // inside a gap (an empty paragraph between a deleted and an inserted table)
  // are re-aligned within the gap instead of splitting it.
  let ops: AlignOp<T>[] = [];
  let pending: AlignOp<T>[] = [];
  const flushGap = () => {
    if (pending.some((op) => op.type !== 'equal')) {
      const gapO = pending.flatMap((op) => (op.type === 'del' || op.type === 'equal' ? [op.o] : []));
      const gapN = pending.flatMap((op) => (op.type === 'ins' || op.type === 'equal' ? [op.n] : []));
      ops.push(...pairGap(gapO, gapN, spec));
    } else ops.push(...pending);
    pending = [];
  };
  for (const op of exactOps(o, n, spec)) {
    if (op.type === 'equal' && !spec.weak?.(op.o)) {
      flushGap();
      ops.push(op);
    } else pending.push(op);
  }
  flushGap();

  // Step 4: moves among the remaining deleted / inserted paragraphs.
  if (spec.movable) {
    const movable = spec.movable;
    const counts = (us: T[]) => {
      const m = new Map<string, number>();
      for (const u of us) m.set(spec.key(u), (m.get(spec.key(u)) ?? 0) + 1);
      return m;
    };
    const [countO, countN] = [counts(o), counts(n)];
    const unique = (u: T) => !!spec.uniqueMovable?.(u) && countO.get(spec.key(u)) === 1 && countN.get(spec.key(u)) === 1;
    const dels = ops.flatMap((op, k) => (op.type === 'del' && (movable(op.o) || unique(op.o)) ? [k] : []));
    const inss = ops.flatMap((op, k) => (op.type === 'ins' && (movable(op.n) || unique(op.n)) ? [k] : []));
    const candidates: { d: number; i: number; s: number }[] = [];
    if (dels.length * inss.length <= MAX_GAP_CELLS)
      for (const d of dels)
        for (const i of inss) {
          const [x, y] = [(ops[d] as { o: T }).o, (ops[i] as { n: T }).n];
          if (!(movable(x) && movable(y))) {
            // Short paragraphs: only an identical, unique text moves.
            if (spec.key(x) === spec.key(y) && unique(x)) candidates.push({ d, i, s: 1 });
            continue;
          }
          const s = simOf(spec, [x], [y], MOVE_MIN);
          if (s >= MOVE_MIN) candidates.push({ d, i, s });
        }
    candidates.sort((x, y) => y.s - x.s);
    const used = new Set<number>();
    let moveNo = 0;
    for (const c of candidates) {
      if (used.has(c.d) || used.has(c.i)) continue;
      used.add(c.d).add(c.i);
      const move = ++moveNo;
      ops[c.d] = { type: 'moveFrom', o: (ops[c.d] as { o: T }).o, move, sim: c.s };
      ops[c.i] = { type: 'moveTo', n: (ops[c.i] as { n: T }).n, move, sim: c.s };
    }
  }

  ops = normalise(ops);
  if (!spec.lonePair) return ops;

  // A lone deleted + inserted unit at the same place: one whole replacement.
  const out: AlignOp<T>[] = [];
  for (let k = 0; k < ops.length; k++) {
    const a = ops[k];
    const b = ops[k + 1];
    const lone = (x?: AlignOp<T>) => !x || (x.type !== 'del' && x.type !== 'ins');
    if (a.type === 'del' && b?.type === 'ins' && lone(ops[k - 1]) && lone(ops[k + 2]) && spec.lonePair(a.o, b.n)) {
      out.push({ type: 'pair', o: [a.o], n: [b.n], sim: simOf(spec, [a.o], [b.n]) });
      k++;
    } else out.push(a);
  }
  return out;
}

export const alignBlocks = (o: Block[], n: Block[]) => alignUnits(o, n, BLOCKS);
export const alignRows = (o: TableRow[], n: TableRow[]) => alignUnits(o, n, ROWS);
