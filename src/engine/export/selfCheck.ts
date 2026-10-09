// Export self-check (spec/export §1): the exported file is read again and its
// content compared with the final-result preview, block by block, with the
// same content keys the comparison uses (text and content marks; formatting
// and numbering labels are not content). Since Stage 5 (decision 43) the key
// also covers what old content can bring along: footnote and endnote text,
// picture bytes and hyperlink addresses (their fingerprints).

import type { Block, ParagraphBlock } from '../../model/document';
import { forEachParagraph } from '../../model/docIndex';
import { flattenParagraph, paragraphPlainText } from '../../model/flatten';
import { diffKeys } from '../align/myers';
import { blockKey } from '../compare/keys';

export interface SelfCheck {
  ok: boolean;
  /** Top-level blocks compared. */
  compared: number;
  /** Blocks that differ (missing, extra or changed). */
  mismatches: number;
  /** First few differences, as readable text. */
  examples: { expected?: string; actual?: string }[];
  /** Other problems (file could not be read back, revisions left…). */
  problems: string[];
}

function preview(b: Block): string {
  if (b.kind === 'placeholder') return `[${b.label}]`;
  const texts: string[] = [];
  if (b.kind === 'paragraph') texts.push(paragraphPlainText(b));
  else forEachParagraph([b], (p) => texts.push(paragraphPlainText(p)));
  const t = (b.kind === 'table' ? `[Table] ${texts.join(' | ')}` : texts.join(' ')).trim() || '(empty paragraph)';
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

/** Fingerprints of the notes, pictures and links a paragraph refers to, in order. */
function referenceKey(p: ParagraphBlock): string {
  let k = '';
  let lastLink = -1;
  for (const piece of flattenParagraph(p).pieces) {
    const ph = piece.placeholder;
    if (ph && (ph.kind === 'footnoteRef' || ph.kind === 'endnoteRef' || ph.kind === 'image')) k += `|${ph.kind}:${ph.fingerprint ?? ''}`;
    if (piece.wrap?.type === 'hyperlink' && piece.src !== lastLink) k += `|link:${piece.wrap.urlFingerprint}`;
    if (piece.wrap) lastLink = piece.src;
  }
  return k;
}

function checkKey(b: Block): string {
  const refs: string[] = [];
  forEachParagraph([b], (p) => refs.push(referenceKey(p)));
  return `${blockKey(b)}\u0007${refs.join('\u0003')}`;
}

export function selfCheck(expected: Block[], actual: Block[]): SelfCheck {
  const ops = diffKeys(expected.map(checkKey), actual.map(checkKey));
  const examples: SelfCheck['examples'] = [];
  let mismatches = 0;
  for (const op of ops) {
    if (op.type === 'equal') continue;
    mismatches++;
    if (examples.length < 5) examples.push(op.type === 'delete' ? { expected: preview(expected[op.a]) } : { actual: preview(actual[op.b]) });
  }
  return { ok: mismatches === 0, compared: expected.length, mismatches, examples, problems: [] };
}
