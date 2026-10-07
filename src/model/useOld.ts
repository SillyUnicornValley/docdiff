// "Use old" availability (spec §7.5, decision 15): blocked when either side
// contains footnotes, images, hyperlinks, fields, text boxes or objects.

import type { Block, InlinePlaceholderKind } from './document';
import type { UseOldAvailability, UseOldBlockReason } from './diff';
import { forEachBlock } from './docIndex';

const USE_OLD_MESSAGES: Record<UseOldBlockReason, string> = {
  footnote: 'Contains a footnote reference.',
  endnote: 'Contains an endnote reference.',
  image: 'Contains an image or drawing.',
  hyperlink: 'Contains a hyperlink.',
  field: 'Contains a field (cross-reference, date, page number…).',
  textBox: 'Contains a text box.',
  object: 'Contains an embedded object or equation.',
  fieldBoundary: 'A field starts or ends outside this difference.',
  contentControlBoundary: 'A content control starts or ends outside this difference.',
};

export function useOldBlocked(reason: UseOldBlockReason): UseOldAvailability {
  return {
    available: false,
    reason,
    message: `${USE_OLD_MESSAGES[reason]} "Use old" is not available in v1 — export, then make this change in Word.`,
  };
}

export function computeUseOld(blocks: Block[]): UseOldAvailability {
  let reason: UseOldBlockReason | undefined;
  const ph: Partial<Record<InlinePlaceholderKind, UseOldBlockReason>> = {
    footnoteRef: 'footnote',
    endnoteRef: 'endnote',
    image: 'image',
    chart: 'image',
    shape: 'image',
    textBox: 'textBox',
    equation: 'object',
    object: 'object',
  };
  forEachBlock(blocks, (b) => {
    if (reason) return;
    if (b.kind === 'placeholder' && b.element !== 'toc') reason = b.element === 'textBox' ? 'textBox' : b.element === 'equation' || b.element === 'object' ? 'object' : 'image';
    if (b.kind !== 'paragraph') return;
    for (const i of b.content) {
      if (i.type === 'hyperlink') reason ??= 'hyperlink';
      else if (i.type === 'field') reason ??= 'field';
      else if (i.type === 'placeholder' && ph[i.kind]) reason ??= ph[i.kind];
    }
  });
  return reason ? useOldBlocked(reason) : { available: true };
}
