// Word-level comparison of paragraphs (docs/stage2-design.md §3.3): tokens,
// similarity for pairing, and word hunks with normalisation categories.
// Used by the engine and, for realistic spans, by the mock builder.

import type { ParagraphBlock } from '../../model/document';
import type { NormCategory, TextSpan, WordHunk } from '../../model/diff';
import { flattenParagraph } from '../../model/flatten';
import { diffKeys } from '../align/myers';

export interface Token {
  key: string;
  text: string;
  blockId: string;
  start: number;
  end: number;
  /** Paragraph boundary between two blocks of a multi-paragraph side. */
  para?: boolean;
  /** Letters or digits (used for similarity; whitespace and punctuation are not). */
  word?: boolean;
}

const tokenCache = new WeakMap<ParagraphBlock, Token[]>();

/** Tokens of one paragraph: words, single whitespace runs, single punctuation characters. */
function paragraphTokens(b: ParagraphBlock): Token[] {
  const hit = tokenCache.get(b);
  if (hit) return hit;
  const out: Token[] = [];
  let lastField = -1;
  for (const p of flattenParagraph(b).pieces) {
    if (p.kind === 'comment') continue; // comments are not compared
    // Date, page and other field results are optional comparisons (decision 10): one opaque token.
    if (p.wrap?.type === 'field' && p.wrap.fieldType !== 'REF') {
      if (p.src === lastField) out.at(-1)!.end = p.start + p.text.length;
      else out.push({ key: `F:${p.wrap.fieldType}`, text: p.text, blockId: b.id, start: p.start, end: p.start + p.text.length });
      lastField = p.src;
      continue;
    }
    if (p.kind !== 'text') {
      const key = p.kind === 'placeholder' ? `PH:${p.placeholder!.kind}` : p.kind === 'break' ? '\n' : p.text;
      out.push({ key, text: p.text, blockId: b.id, start: p.start, end: p.start + p.text.length });
      continue;
    }
    const m = p.marks;
    const sig = m ? `${m.superscript ? 'sup' : ''}${m.subscript ? 'sub' : ''}${m.hidden ? 'hid' : ''}` : '';
    const re = /[\p{L}\p{N}]+|\s+|./gu;
    let mt: RegExpExecArray | null;
    while ((mt = re.exec(p.text))) {
      const s = p.start + mt.index;
      const word = /^[\p{L}\p{N}]/u.test(mt[0]);
      out.push({ key: `${mt[0]}|${sig}`, text: mt[0], blockId: b.id, start: s, end: s + mt[0].length, word });
    }
  }
  tokenCache.set(b, out);
  return out;
}

export function tokenize(blocks: ParagraphBlock[]): Token[] {
  const out: Token[] = [];
  blocks.forEach((b, bi) => {
    if (bi > 0) {
      const prev = blocks[bi - 1];
      const len = flattenParagraph(prev).text.length;
      out.push({ key: '¶', text: '', blockId: prev.id, start: len, end: len, para: true });
    }
    out.push(...paragraphTokens(b));
  });
  return out;
}

/** Word count (letters/digits tokens) of paragraphs. */
export function wordCount(blocks: ParagraphBlock[]): number {
  let n = 0;
  for (const b of blocks) for (const t of paragraphTokens(b)) if (t.word) n++;
  return n;
}

const wordKeys = (blocks: ParagraphBlock[]) => {
  const out: string[] = [];
  for (const b of blocks) for (const t of paragraphTokens(b)) if (t.word) out.push(t.key.toLowerCase());
  return out;
};

/**
 * Similarity of two runs of paragraphs, 0..1: 2·(common words in order) / (words in both).
 * Case-insensitive, punctuation and whitespace ignored.
 */
export function similarity(a: ParagraphBlock[], b: ParagraphBlock[]): number {
  const x = wordKeys(a);
  const y = wordKeys(b);
  if (x.length + y.length === 0) return 0;
  // Cheap upper bound first: shared words regardless of order.
  const counts = new Map<string, number>();
  for (const k of x) counts.set(k, (counts.get(k) ?? 0) + 1);
  let shared = 0;
  for (const k of y) {
    const c = counts.get(k);
    if (c) shared++, counts.set(k, c - 1);
  }
  const bound = (2 * shared) / (x.length + y.length);
  if (bound < 0.3) return bound;
  const eq = diffKeys(x, y).filter((o) => o.type === 'equal').length;
  return (2 * eq) / (x.length + y.length);
}

function spansOf(tokens: Token[]): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const t of tokens) {
    const last = spans.at(-1);
    if (!t.para && last && last.blockId === t.blockId && last.end === t.start) last.end = t.end;
    else spans.push({ blockId: t.blockId, start: t.start, end: t.end });
  }
  return spans;
}

const textOf = (ts: Token[]) => ts.map((t) => (t.para ? '¶' : t.text)).join('');

export function classify(oldText: string, newText: string): NormCategory | undefined {
  if (oldText.includes('¶') || newText.includes('¶')) return undefined;
  const ws = (s: string) => s.replace(/\s+/gu, ' ').trim();
  if (ws(oldText) === ws(newText)) return 'whitespace';
  const q = (s: string) => ws(s).replace(/[“”„"]/g, '"').replace(/[‘’']/g, "'");
  if (q(oldText) === q(newText)) return 'quotes';
  const d = (s: string) => ws(s).replace(/\s*[-‐‑‒–—―]\s*/g, '-');
  if (d(oldText) === d(newText)) return 'dashes';
  if (oldText.toLowerCase() === newText.toLowerCase()) return 'case';
  return undefined;
}

/**
 * Typed list number ↔ automatic number showing the same label (decision 23):
 * e.g. old "1) Obtain…" (typed) vs new "Obtain…" numbered "1)".
 */
function numberingText(g: { a: Token[]; b: Token[] }, oldBlocks: ParagraphBlock[], newBlocks: ParagraphBlock[]): boolean {
  if (oldBlocks.length !== 1 || newBlocks.length !== 1) return false;
  const check = (typed: Token[], other: Token[], typedBlock: ParagraphBlock, autoBlock: ParagraphBlock) => {
    const label = autoBlock.numbering?.label;
    if (!label || typedBlock.numbering || other.length || !typed.length || typed[0].start !== 0) return false;
    return textOf(typed).trim() === label.trim();
  };
  return check(g.a, g.b, oldBlocks[0], newBlocks[0]) || check(g.b, g.a, newBlocks[0], oldBlocks[0]);
}

export interface WordDiffOptions {
  /** Force one hunk covering everything (complete rewrite). */
  whole?: boolean;
}

/** Below this share of unchanged characters a paragraph is shown as one whole replacement (06 "rewrite"). */
const WHOLE_REPLACEMENT_BELOW = 0.35;

/** Word-level hunks between two runs of paragraphs (1:1, split, join, n:m). */
export function wordDiff(oldBlocks: ParagraphBlock[], newBlocks: ParagraphBlock[], opts: WordDiffOptions = {}): WordHunk[] {
  const a = tokenize(oldBlocks);
  const b = tokenize(newBlocks);
  const ops = diffKeys(
    a.map((t) => t.key),
    b.map((t) => t.key),
  );

  let eqChars = 0;
  for (const o of ops) if (o.type === 'equal' && a[o.a].key.trim() !== '|') eqChars += a[o.a].text.length;
  const total = Math.max(1, textOf(a).length, textOf(b).length);
  if (opts.whole || eqChars / total < WHOLE_REPLACEMENT_BELOW) {
    return [{ old: spansOf(a.filter((t) => !t.para)), new: spansOf(b.filter((t) => !t.para)) }];
  }

  // Group consecutive non-equal ops; merge groups separated by a single equal whitespace token.
  const groups: { a: Token[]; b: Token[] }[] = [];
  let cur: { a: Token[]; b: Token[] } | null = null;
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.type === 'equal') {
      const isWs = /^\s+\|$/u.test(a[o.a].key);
      const nextChanged = ops[k + 1] && ops[k + 1].type !== 'equal';
      if (cur && isWs && nextChanged) {
        cur.a.push(a[o.a]);
        cur.b.push(b[o.b]);
        continue;
      }
      cur = null;
      continue;
    }
    if (!cur) groups.push((cur = { a: [], b: [] }));
    if (o.type === 'delete') cur.a.push(a[o.a]);
    else cur.b.push(b[o.b]);
  }

  return groups.map((g) => {
    const h: WordHunk = { old: spansOf(g.a), new: spansOf(g.b) };
    // A superscript/subscript/hidden change is content, never a normalisation category.
    const marked = [...g.a, ...g.b].some((t) => !t.para && !t.key.endsWith('|') && t.key.includes('|'));
    const c = marked ? undefined : numberingText(g, oldBlocks, newBlocks) ? 'numberingText' : classify(textOf(g.a), textOf(g.b));
    if (c) h.category = c;
    return h;
  });
}

/** Whole-paragraph highlight on one side (used for cells in whole-table differences). */
export function fullSpan(p: ParagraphBlock): TextSpan {
  return { blockId: p.id, start: 0, end: flattenParagraph(p).text.length };
}

/** The category shared by every hunk, if any (the whole difference can then be hidden by it). */
export function commonCategory(hunks: WordHunk[]): NormCategory | undefined {
  if (hunks.length === 0) return undefined;
  const c = hunks[0].category;
  return c && hunks.every((h) => h.category === c) ? c : undefined;
}
