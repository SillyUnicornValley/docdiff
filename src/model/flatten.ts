// Flattening rule shared by the engine and the UI. TextSpan offsets in the
// diff model are offsets into this flattened text.
//   text -> as-is, tab -> '\t', break -> '\n',
//   hyperlink / field -> their visible text, placeholder -> U+FFFC

import type {
  FieldType,
  Inline,
  InlinePlaceholder,
  ParagraphBlock,
  RunMarks,
} from './document';

export const PLACEHOLDER_CHAR = '￼';

export type PieceWrap =
  | { type: 'hyperlink'; urlFingerprint: string }
  | { type: 'field'; fieldType: FieldType; instruction: string };

export interface Piece {
  start: number;
  text: string;
  kind: 'text' | 'tab' | 'break' | 'placeholder';
  marks?: RunMarks;
  placeholder?: InlinePlaceholder;
  wrap?: PieceWrap;
  /** Index of the source inline (pieces of one hyperlink/field share it). */
  src: number;
}

export interface Flattened {
  text: string;
  pieces: Piece[];
}

export function flattenInlines(inlines: Inline[]): Flattened {
  const pieces: Piece[] = [];
  let pos = 0;
  let src = 0;
  const push = (p: Omit<Piece, 'start' | 'src'>) => {
    pieces.push({ ...p, start: pos, src });
    pos += p.text.length;
  };
  for (const [i, inl] of inlines.entries()) {
    src = i;
    switch (inl.type) {
      case 'text':
        if (inl.text) push({ text: inl.text, kind: 'text', marks: inl.marks });
        break;
      case 'tab':
        push({ text: '\t', kind: 'tab' });
        break;
      case 'break':
        push({ text: '\n', kind: 'break' });
        break;
      case 'hyperlink':
        for (const r of inl.content)
          push({ text: r.text, kind: 'text', marks: r.marks, wrap: { type: 'hyperlink', urlFingerprint: inl.urlFingerprint } });
        break;
      case 'field':
        for (const r of inl.result)
          push({
            text: r.text,
            kind: 'text',
            marks: r.marks,
            wrap: { type: 'field', fieldType: inl.fieldType, instruction: inl.instruction },
          });
        break;
      case 'placeholder':
        push({ text: PLACEHOLDER_CHAR, kind: 'placeholder', placeholder: inl });
        break;
    }
  }
  return { text: pieces.map((p) => p.text).join(''), pieces };
}

const cache = new WeakMap<ParagraphBlock, Flattened>();

export function flattenParagraph(p: ParagraphBlock): Flattened {
  let f = cache.get(p);
  if (!f) {
    f = flattenInlines(p.content);
    cache.set(p, f);
  }
  return f;
}

/** Plain readable text (placeholders become their label in brackets). */
export function paragraphPlainText(p: ParagraphBlock): string {
  return p.content
    .map((i) => {
      switch (i.type) {
        case 'text':
          return i.text;
        case 'tab':
          return '\t';
        case 'break':
          return ' ';
        case 'hyperlink':
          return i.content.map((r) => r.text).join('');
        case 'field':
          return i.result.map((r) => r.text).join('');
        case 'placeholder':
          return `[${i.label}]`;
      }
    })
    .join('');
}
