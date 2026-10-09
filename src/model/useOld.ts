// "Use old" availability (spec/merge §3).
//  - computeUseOld: the v1 rule (decisions 5, 15), still used by the hand-written
//    mocks: blocked when either side contains footnotes, images, hyperlinks,
//    fields, text boxes or objects.
//  - portableUseOld: the engine's rule since Stage 5 (decision 43): only what
//    cannot be copied into the new file safely blocks it.

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
  bookmark: 'Contains a cross-reference to a bookmark that is not in the new file.',
  notesPart: 'Contains a footnote or endnote, and the new file has none to add it to.',
};

/** Reasons from the v1 rule keep the v1 wording; Stage 5 reasons say what is still not supported. */
const STAGE5_MESSAGES: Partial<Record<UseOldBlockReason, string>> = {
  footnote: 'Contains a footnote whose text holds a chart, text box or embedded object.',
  endnote: 'Contains an endnote whose text holds a chart, text box or embedded object.',
  image: 'Contains a chart, shape, SmartArt or linked picture.',
  field: 'Contains a field that pulls in another file (INCLUDETEXT, INCLUDEPICTURE, LINK…).',
  object: 'Contains an embedded object or document.',
};

export function useOldBlocked(reason: UseOldBlockReason, stage5 = false): UseOldAvailability {
  const what = (stage5 && STAGE5_MESSAGES[reason]) || USE_OLD_MESSAGES[reason];
  return {
    available: false,
    reason,
    message: `${what} "Use old" is not available here — export, then make this change in Word.`,
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

/** What the new file offers to old content brought into it. */
export interface UseOldContext {
  newBookmarks: Set<string>;
  newNotes: { footnotes: boolean; endnotes: boolean };
}

/** Fields that refer to a bookmark by name (the second word of the instruction). */
const BOOKMARK_FIELDS = new Set(['REF', 'PAGEREF', 'NOTEREF']);
/** Fields that pull content from outside the document. */
const EXTERNAL_FIELDS = new Set(['INCLUDETEXT', 'INCLUDEPICTURE', 'LINK', 'DDE', 'DDEAUTO', 'EMBED', 'IMPORT']);

/**
 * Stage 5 rule (decision 43). Only the OLD side matters: new content that is
 * dropped is simply removed. Old content can come back with hyperlinks,
 * fields, footnotes, endnotes, embedded pictures and equations; charts,
 * shapes, text boxes, embedded objects and linked pictures still block it.
 */
export function portableUseOld(oldBlocks: Block[], ctx: UseOldContext): UseOldAvailability {
  let reason: UseOldBlockReason | undefined;
  const set = (r: UseOldBlockReason) => (reason ??= r);
  forEachBlock(oldBlocks, (b) => {
    if (reason) return;
    if (b.kind === 'placeholder' && b.element !== 'toc') set(b.element === 'textBox' ? 'textBox' : b.element === 'equation' ? 'object' : b.element === 'object' ? 'object' : 'image');
    if (b.kind !== 'paragraph') return;
    for (const i of b.content) {
      if (i.type === 'field') {
        const [kw, arg] = i.instruction.trim().split(/\s+/);
        const key = (kw ?? '').toUpperCase();
        if (EXTERNAL_FIELDS.has(key)) set('field');
        else if (BOOKMARK_FIELDS.has(key) && !ctx.newBookmarks.has((arg ?? '').replace(/^"|"$/g, ''))) set('bookmark');
      } else if (i.type === 'placeholder') {
        if (i.kind === 'footnoteRef' || i.kind === 'endnoteRef') {
          const part = i.kind === 'footnoteRef' ? 'footnotes' : 'endnotes';
          if (i.notPortable) set(i.kind === 'footnoteRef' ? 'footnote' : 'endnote');
          else if (!ctx.newNotes[part]) set('notesPart');
        } else if (i.kind === 'image') {
          if (i.notPortable) set('image');
        } else if (i.kind === 'chart' || i.kind === 'shape') set('image');
        else if (i.kind === 'textBox') set('textBox');
        else if (i.kind === 'object') set('object');
        // equations come back as they are
      }
    }
  });
  return reason ? useOldBlocked(reason, true) : { available: true };
}
