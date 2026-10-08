// Document model: what the .docx parser (Stage 2) produces for ONE file, after
// all existing tracked changes have been accepted. Only content-relevant
// information is kept; formatting (fonts, bold, spacing...) is not modelled.

/** Unique within one document. Blocks, table rows and cells share one id space. */
export type NodeId = string;

export type Side = 'old' | 'new';

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

/** Run marks that count as content (spec/ui §1). Bold/italic etc. are formatting and are dropped. */
export interface RunMarks {
  superscript?: boolean;
  subscript?: boolean;
  /** Hidden text: displayed with a dotted underline and compared (spec/scope §4.1). */
  hidden?: boolean;
}

export interface TextInline {
  type: 'text';
  text: string;
  marks?: RunMarks;
}

export interface TabInline {
  type: 'tab';
}

/** Shift+Enter line break. */
export interface BreakInline {
  type: 'break';
}

/**
 * Hyperlink: display text is compared; the URL is "detected only", so we keep a
 * fingerprint, not the address. Its presence blocks "Use old" (spec/merge §3).
 */
export interface HyperlinkInline {
  type: 'hyperlink';
  content: TextInline[];
  urlFingerprint: string;
}

export type FieldType = 'DATE' | 'PAGE' | 'NUMPAGES' | 'REF' | 'PAGEREF' | 'SEQ' | 'OTHER';

/**
 * Field with its cached result. REF (cross-reference) results are compared as
 * content; DATE/PAGE-like fields only when the "Compare fields" option is on.
 */
export interface FieldInline {
  type: 'field';
  fieldType: FieldType;
  instruction: string;
  result: TextInline[];
}

export type InlinePlaceholderKind =
  | 'footnoteRef'
  | 'endnoteRef'
  | 'image'
  | 'chart'
  | 'shape'
  | 'textBox'
  | 'equation'
  | 'object';

/**
 * An element inside a paragraph that is shown but not compared (or, for
 * footnote/endnote refs, compared by marker position only).
 */
export interface InlinePlaceholder {
  type: 'placeholder';
  kind: InlinePlaceholderKind;
  /** Display label, e.g. "Footnote 2". */
  label: string;
  /** Cheap fingerprint of the hidden content (footnote text, image bytes...) for "may differ" hints. */
  fingerprint?: string;
}

/**
 * Where a comment of the NEW file is anchored (decision A10: shown, not
 * compared). Zero-width: it adds no characters to the flattened text, so it
 * never creates a difference. Comments of the old file are not shown.
 */
export interface CommentInline {
  type: 'comment';
  author: string;
  /** First words of the comment, for the tooltip. */
  preview: string;
}

export type Inline =
  | TextInline
  | CommentInline
  | TabInline
  | BreakInline
  | HyperlinkInline
  | FieldInline
  | InlinePlaceholder;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type ParagraphRole =
  | { type: 'title' }
  | { type: 'heading'; level: number } // 1..9
  | { type: 'body' }
  | { type: 'listItem'; level: number }; // 0-based list level

/** Automatic numbering as Word would render it. Shown, never compared in v1 (spec/comparison §6). */
export interface Numbering {
  listId: string;
  level: number;
  format: 'bullet' | 'number';
  /** Computed label: "3.", "a)", "•", "2.1". */
  label: string;
}

export interface ParagraphBlock {
  kind: 'paragraph';
  id: NodeId;
  role: ParagraphRole;
  /** Present on auto-numbered list items AND auto-numbered headings. */
  numbering?: Numbering;
  content: Inline[];
  /** This paragraph carries a section break (sectPr). Used for structure-protection hints. */
  sectionBreak?: boolean;
}

export type VMerge = 'none' | 'restart' | 'continue';

export interface TableCell {
  id: NodeId;
  /** Number of grid columns this cell spans (w:gridSpan). */
  gridSpan: number;
  vMerge: VMerge;
  /** Paragraphs and nested tables. */
  blocks: Block[];
}

export interface TableRow {
  id: NodeId;
  cells: TableCell[];
  /** Repeating header row. */
  isHeader?: boolean;
}

export interface TableBlock {
  kind: 'table';
  id: NodeId;
  /** Number of grid columns (w:tblGrid). */
  gridColumns: number;
  /** Relative column widths, length = gridColumns. */
  columnWidths?: number[];
  rows: TableRow[];
}

export type BlockPlaceholderKind =
  | 'image'
  | 'chart'
  | 'shape'
  | 'smartArt'
  | 'textBox'
  | 'equation'
  | 'object'
  | 'toc';

/**
 * A block-level element that is shown but not compared. The TOC is collapsed by
 * default; its cached entries are kept in `children` so the optional
 * "Compare table of contents" toggle can show and compare them.
 */
export interface PlaceholderBlock {
  kind: 'placeholder';
  id: NodeId;
  element: BlockPlaceholderKind;
  /** e.g. "Figure 1 image", "Table of contents (8 entries)". */
  label: string;
  fingerprint?: string;
  children?: ParagraphBlock[];
}

export type Block = ParagraphBlock | TableBlock | PlaceholderBlock;

// ---------------------------------------------------------------------------
// Whole document
// ---------------------------------------------------------------------------

/**
 * Parts of the file outside the body that are "detected only" (spec/comparison §5).
 * Headers and footers are per section, see DocSection.
 */
export type FingerprintedPart =
  | 'footnotes'
  | 'endnotes'
  | 'images'
  | 'hyperlinkUrls'
  | 'textBoxes'
  | 'properties';

/** Word keeps up to three headers (and footers) per section. */
export type HeaderVariant = 'default' | 'first' | 'even';

export interface HeaderFooterRef {
  /** Fingerprint of the header/footer text (detected only, not compared item by item). */
  fingerprint: string;
  /** No own header here: Word's "Link to Previous" reuses the previous section's. */
  linkedToPrevious?: boolean;
}

/**
 * A document section. In Word a section break (sectPr) is stored on the LAST
 * paragraph of the section; the last section's settings belong to the body.
 */
export interface DocSection {
  /** 1-based, in document order. */
  index: number;
  /** First top-level block of the section (where its marker is shown). */
  firstBlockId?: NodeId;
  /** Paragraph carrying this section's break; absent for the last section. */
  breakBlockId?: NodeId;
  headers: Partial<Record<HeaderVariant, HeaderFooterRef>>;
  footers: Partial<Record<HeaderVariant, HeaderFooterRef>>;
}

export interface RevisionInfo {
  /** Revisions accepted on load, by type. */
  accepted: { type: string; count: number }[];
  /** Revision types docdiff cannot handle; comparison continues (spec/reading). */
  unsupported: { type: string; location: string; nearBlockId?: NodeId }[];
}

export interface DocModel {
  side: Side;
  fileName: string;
  /** SHA-256 of the uploaded file bytes. Used by review-progress files. */
  fingerprint: string;
  sizeBytes: number;
  blocks: Block[];
  partFingerprints: Partial<Record<FingerprintedPart, string>>;
  sections: DocSection[];
  revisions: RevisionInfo;
  /** Number of comments (shown in scope panel; not compared). */
  commentCount: number;
}
