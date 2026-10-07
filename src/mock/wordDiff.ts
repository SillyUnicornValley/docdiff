// Mock-only word differ. Stands in for the Stage 2 engine (jsdiff) so mock
// data gets realistic word-level spans without hand-counting offsets.

import type { ParagraphBlock } from '../model/document';
import type { NormCategory, TextSpan, WordHunk } from '../model/diff';
import { flattenParagraph } from '../model/flatten';

interface Token {
  key: string;
  text: string;
  blockId: string;
  start: number;
  end: number;
  /** Paragraph boundary between two blocks of a multi-paragraph side. */
  para?: boolean;
}

function tokenize(blocks: ParagraphBlock[]): Token[] {
  const out: Token[] = [];
  blocks.forEach((b, bi) => {
    if (bi > 0) {
      const prev = blocks[bi - 1];
      const len = flattenParagraph(prev).text.length;
      out.push({ key: '¶', text: '', blockId: prev.id, start: len, end: len, para: true });
    }
    for (const p of flattenParagraph(b).pieces) {
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
        out.push({ key: `${mt[0]}|${sig}`, text: mt[0], blockId: b.id, start: s, end: s + mt[0].length });
      }
    }
  });
  return out;
}

type Op = { type: 'eq' | 'del' | 'ins'; a?: Token; b?: Token };

function lcs(a: Token[], b: Token[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key) ops.push({ type: 'eq', a: a[i++], b: b[j++] });
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ type: 'del', a: a[i++] });
    else ops.push({ type: 'ins', b: b[j++] });
  }
  while (i < n) ops.push({ type: 'del', a: a[i++] });
  while (j < m) ops.push({ type: 'ins', b: b[j++] });
  return ops;
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

export interface WordDiffOptions {
  /** Force one hunk covering everything (complete rewrite). */
  whole?: boolean;
}

/** Word-level hunks between two runs of paragraphs (1:1, split, join, n:m). */
export function wordDiff(oldBlocks: ParagraphBlock[], newBlocks: ParagraphBlock[], opts: WordDiffOptions = {}): WordHunk[] {
  const a = tokenize(oldBlocks);
  const b = tokenize(newBlocks);
  const ops = lcs(a, b);

  const eqChars = ops.filter((o) => o.type === 'eq' && o.a!.key.trim() !== '|').reduce((n, o) => n + o.a!.text.length, 0);
  const total = Math.max(1, Math.max(textOf(a).length, textOf(b).length));
  if (opts.whole || eqChars / total < 0.35) {
    return [{ old: spansOf(a.filter((t) => !t.para)), new: spansOf(b.filter((t) => !t.para)) }];
  }

  // Group consecutive non-equal ops; merge groups separated by a single equal whitespace token.
  const groups: { a: Token[]; b: Token[] }[] = [];
  let cur: { a: Token[]; b: Token[] } | null = null;
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.type === 'eq') {
      const isWs = /^\s+\|$/u.test(o.a!.key);
      const nextChanged = ops[k + 1] && ops[k + 1].type !== 'eq';
      if (cur && isWs && nextChanged) {
        cur.a.push(o.a!);
        cur.b.push(o.b!);
        continue;
      }
      cur = null;
      continue;
    }
    if (!cur) groups.push((cur = { a: [], b: [] }));
    if (o.a) cur.a.push(o.a);
    if (o.b) cur.b.push(o.b);
  }

  return groups.map((g) => {
    const h: WordHunk = { old: spansOf(g.a), new: spansOf(g.b) };
    // A superscript/subscript/hidden change is content, never a normalisation category.
    const marked = [...g.a, ...g.b].some((t) => !t.para && !t.key.endsWith('|') && t.key.includes('|'));
    const c = marked ? undefined : classify(textOf(g.a), textOf(g.b));
    if (c) h.category = c;
    return h;
  });
}

/** Whole-paragraph highlight on one side (used for cells in whole-table differences). */
export function fullSpan(p: ParagraphBlock): TextSpan {
  return { blockId: p.id, start: 0, end: flattenParagraph(p).text.length };
}
