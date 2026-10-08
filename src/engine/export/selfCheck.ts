// Export self-check (spec/export §1): the exported file is read again and its
// content compared with the final-result preview, block by block, with the
// same content keys the comparison uses (text and content marks; formatting
// and numbering labels are not content).

import type { Block } from '../../model/document';
import { forEachParagraph } from '../../model/docIndex';
import { paragraphPlainText } from '../../model/flatten';
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

export function selfCheck(expected: Block[], actual: Block[]): SelfCheck {
  const ops = diffKeys(expected.map(blockKey), actual.map(blockKey));
  const examples: SelfCheck['examples'] = [];
  let mismatches = 0;
  for (const op of ops) {
    if (op.type === 'equal') continue;
    mismatches++;
    if (examples.length < 5) examples.push(op.type === 'delete' ? { expected: preview(expected[op.a]) } : { actual: preview(actual[op.b]) });
  }
  return { ok: mismatches === 0, compared: expected.length, mismatches, examples, problems: [] };
}
