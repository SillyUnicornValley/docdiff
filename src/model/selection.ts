// Per-change selection inside a modified paragraph (decision 42, stage5-design §2).
// The difference stays one unit; a HunkSelection picks old or new for each word hunk,
// and the final paragraph is the new paragraph with the "old" hunks put back.

import type { Difference, TextSpan, WordHunk } from './diff';
import type { Inline, ParagraphBlock, RunMarks } from './document';
import { flattenParagraph } from './flatten';
import type { Choice, HunkSelection, ReviewStatus, Selection } from './review';

export const isHunkSelection = (s: Selection | undefined): s is HunkSelection => typeof s === 'object' && s !== null;

/** All hunks the same → the plain choice; otherwise the selection itself. */
export function normalizeSelection(s: Selection): Selection {
  if (!isHunkSelection(s)) return s;
  const first = s.hunks[0];
  return s.hunks.every((h) => h === first) && first ? first : s;
}

export function sameSelection(a: Selection | undefined, b: Selection | undefined): boolean {
  if (isHunkSelection(a) && isHunkSelection(b)) return a.hunks.length === b.hunks.length && a.hunks.every((h, i) => h === b.hunks[i]);
  return a === b;
}

export function statusOfSelection(s: Selection | undefined): ReviewStatus {
  if (s === undefined) return 'unreviewed';
  return isHunkSelection(s) ? 'mixed' : s;
}

/** The choice of hunk `i` under a selection (unreviewed = new). */
export function hunkChoice(s: Selection | undefined, i: number): Choice {
  if (s === undefined) return 'new';
  return isHunkSelection(s) ? (s.hunks[i] ?? 'new') : s;
}

/** Can this selection be applied to this difference? (progress files, autosave) */
export function validSelection(d: Difference | undefined, s: unknown): s is Selection {
  if (!d || d.informational) return false;
  if (s === 'new') return true;
  if (s === 'old') return d.useOld.available;
  if (!isHunkSelection(s as Selection)) return false;
  const h = (s as HunkSelection).hunks;
  return (
    !!d.perChange && d.useOld.available && Array.isArray(h) && h.length === d.wordHunks.length && h.every((c) => c === 'old' || c === 'new')
  );
}

// ---------------------------------------------------------------------------
// Building the mixed paragraph
// ---------------------------------------------------------------------------

/** A hunk's character range on one side: its spans, or its insertion point. */
function range(spans: TextSpan[], at: number | undefined): [number, number] {
  if (!spans.length) return [at ?? 0, at ?? 0];
  return [Math.min(...spans.map((s) => s.start)), Math.max(...spans.map((s) => s.end))];
}

export interface MixedParagraph {
  block: ParagraphBlock;
  /** Ranges of the result that came from the old paragraph (for the "from old" highlight). */
  fromOld: { start: number; end: number }[];
}

const sameMarks = (a?: RunMarks, b?: RunMarks) => !!a?.superscript === !!b?.superscript && !!a?.subscript === !!b?.subscript && !!a?.hidden === !!b?.hidden;

/**
 * The new paragraph with the hunks chosen "old" replaced by the old text.
 * Both paragraphs hold only text, tabs, line breaks and (new side) comment
 * anchors — the engine sets `perChange` only then.
 */
export function mixedParagraph(oldP: ParagraphBlock, newP: ParagraphBlock, hunks: WordHunk[], sel: Selection | undefined): MixedParagraph {
  const content: Inline[] = [];
  const fromOld: MixedParagraph['fromOld'] = [];
  let len = 0;
  const pushChar = (ch: string, marks?: RunMarks) => {
    len += ch.length;
    if (ch === '\t') return void content.push({ type: 'tab' });
    if (ch === '\n') return void content.push({ type: 'break' });
    const last = content.at(-1);
    if (last?.type === 'text' && sameMarks(last.marks, marks)) last.text += ch;
    else content.push(marks ? { type: 'text', text: ch, marks: { ...marks } } : { type: 'text', text: ch });
  };
  const oldPieces = flattenParagraph(oldP).pieces;
  const emitOld = (s: number, e: number) => {
    const start = len;
    for (const p of oldPieces) {
      if (p.kind === 'comment') continue;
      const a = Math.max(s, p.start);
      const b = Math.min(e, p.start + p.text.length);
      for (let k = a; k < b; k++) pushChar(p.text[k - p.start], p.marks);
    }
    if (len > start) fromOld.push({ start, end: len });
  };

  const chosen = hunks
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => hunkChoice(sel, i) === 'old')
    .map(({ h }) => ({ o: range(h.old, h.at?.old), n: range(h.new, h.at?.new) }))
    .sort((x, y) => x.n[0] - y.n[0]);
  let next = 0;
  let skipUntil = -1;
  const reach = (pos: number) => {
    while (next < chosen.length && chosen[next].n[0] <= pos) {
      emitOld(chosen[next].o[0], chosen[next].o[1]);
      skipUntil = Math.max(skipUntil, chosen[next].n[1]);
      next++;
    }
  };
  for (const p of flattenParagraph(newP).pieces) {
    if (p.kind === 'comment') {
      reach(p.start - 1);
      content.push(p.comment!);
      continue;
    }
    for (let k = 0; k < p.text.length; k++) {
      const pos = p.start + k;
      reach(pos);
      if (pos < skipUntil) continue;
      pushChar(p.text[k], p.marks);
    }
  }
  reach(Number.MAX_SAFE_INTEGER);
  const block: ParagraphBlock = { ...newP, content };
  return { block, fromOld };
}
