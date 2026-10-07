// Content keys: two blocks with the same key have the same compared content.

import type { Block, ParagraphBlock } from '../../model/document';
import type { OptionalComparison } from '../../model/diff';
import { flattenParagraph } from '../../model/flatten';

/**
 * Content key of a paragraph: visible text plus content marks (superscript,
 * hidden). Comments are zero-width and ignored. Field results other than
 * cross-references are optional comparisons (decision 10): left out unless `withFields`.
 */
export function paragraphKey(p: ParagraphBlock, withFields = false): string {
  let key = '';
  let lastField = -1;
  for (const piece of flattenParagraph(p).pieces) {
    if (piece.kind === 'comment') continue;
    if (!withFields && piece.wrap?.type === 'field' && piece.wrap.fieldType !== 'REF') {
      if (piece.src !== lastField) key += '\u0006';
      lastField = piece.src;
      continue;
    }
    const m = piece.marks;
    if (m?.superscript || m?.subscript || m?.hidden) key += `\u0001${m.superscript ? '^' : ''}${m.subscript ? '_' : ''}${m.hidden ? 'h' : ''}\u0002`;
    key += piece.text;
  }
  return key;
}

const keyCache = new WeakMap<Block, string>();

export function blockKey(b: Block): string {
  const hit = keyCache.get(b);
  if (hit !== undefined) return hit;
  let k: string;
  if (b.kind === 'paragraph') k = `p:${paragraphKey(b)}`;
  // TOC and other placeholders are not compared: same kind = same.
  else if (b.kind === 'placeholder') k = `x:${b.element}`;
  else k = `t:${b.rows.map((r) => r.cells.map((c) => `${c.gridSpan}/${c.vMerge}:${c.blocks.map(blockKey).join('\u0003')}`).join('\u0004')).join('\u0005')}`;
  keyCache.set(b, k);
  return k;
}

/** Same compared content, but a TOC or a date/page field shows something else (decision 10). */
export function optionalDifference(a: Block, b: Block): OptionalComparison | undefined {
  if (a.kind === 'placeholder' && b.kind === 'placeholder' && a.element === 'toc') return a.fingerprint !== b.fingerprint ? 'toc' : undefined;
  if (a.kind === 'paragraph' && b.kind === 'paragraph') return paragraphKey(a, true) !== paragraphKey(b, true) ? 'fields' : undefined;
  return undefined;
}
