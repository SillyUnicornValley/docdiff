// Diff model: what the comparison engine (Stage 2) produces for a document pair.
// It never changes after comparison. User choices live in review.ts.

import type { DocModel, FingerprintedPart, HeaderVariant, NodeId } from './document';

export type DiffId = string;

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

/**
 * A contiguous run of nodes on one side, in document order, all in the same
 * container (body, table cell, or table). Empty `ids` = nothing on this side.
 *  - unit 'block': paragraphs / tables / placeholders
 *  - unit 'row':   rows of one table (row insert/delete, spec §7.7)
 */
export interface SideRange {
  unit: 'block' | 'row';
  ids: NodeId[];
}

/**
 * Character range inside one paragraph's flattened text. Flattening rule
 * (shared by engine and UI, see flatten.ts): text as-is, tab = '\t',
 * break = '\n', hyperlink/field = their visible text, placeholder = U+FFFC.
 */
export interface TextSpan {
  blockId: NodeId;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Differences
// ---------------------------------------------------------------------------

export type DiffKind =
  | 'modified' // 1..n paragraphs ↔ 1..n paragraphs, same count, paired
  | 'inserted' // old empty
  | 'deleted' // new empty
  | 'moved' // one difference, two locations (spec §7.4)
  | 'splitJoin' // 1→n or n→1 paragraphs
  | 'tableStructure' // column / merged-cell / nested structure change: whole table
  | 'replaced'; // block type changed, e.g. paragraphs ↔ table: whole block

/** Normalisation categories (spec §6.5, decision 23). Shown by default, each can be hidden. */
export type NormCategory = 'whitespace' | 'emptyParagraph' | 'quotes' | 'dashes' | 'case' | 'numberingText';

/**
 * One word-level change inside a difference: old spans ↔ new spans. Kept as
 * pairs (not just highlights) so later versions can offer word-level choice
 * (spec §7.2) and Track Changes export can reuse them.
 */
export interface WordHunk {
  old: TextSpan[];
  new: TextSpan[];
  /** Set when this hunk is only a whitespace/quote/dash/case change. */
  category?: NormCategory;
}

export type UseOldBlockReason =
  | 'footnote'
  | 'endnote'
  | 'image'
  | 'hyperlink'
  | 'field'
  | 'textBox'
  | 'object'
  | 'fieldBoundary'
  | 'contentControlBoundary';

export type UseOldAvailability =
  | { available: true }
  | { available: false; reason: UseOldBlockReason; message: string };

/** Differences from optional comparisons (spec §6.4) are informational: no choice. */
export type OptionalComparison = 'toc' | 'fields' | 'numbering';

export interface Difference {
  id: DiffId;
  kind: DiffKind;
  /**
   * Old-side content. For 'moved' this is the ORIGINAL location; for
   * 'tableStructure' / 'replaced' it is the whole old block(s).
   */
  old: SideRange;
  /** New-side content. For 'moved' this is the NEW location. */
  new: SideRange;
  wordHunks: WordHunk[];
  /** Set when EVERY hunk belongs to this one category (whole diff can be hidden by it). */
  category?: NormCategory;
  useOld: UseOldAvailability;
  /** Set for optional-comparison differences: shown only, not reviewable, not counted. */
  informational?: OptionalComparison;
  /** Section (heading block id on the new side, or old side if gone) for "this section" batch actions. */
  sectionId: string;
  /** For 'moved': similarity of the two locations, 1 = identical text. */
  similarity?: number;
  /** Short human summary for lists/tooltips, e.g. "12 → 24". Engine may leave empty. */
  summary?: string;
}

// ---------------------------------------------------------------------------
// Segments: the ordered, non-overlapping alignment (spec §7.1)
// ---------------------------------------------------------------------------

/** Identical content on both sides; old.ids[i] pairs with new.ids[i]. */
export interface EqualSegment {
  type: 'equal';
  old: SideRange;
  new: SideRange;
}

/**
 * Position of a difference in the alignment. A 'moved' difference appears TWICE:
 * part 'from' at the old location (old side shown, new side empty) and part 'to'
 * at the new location. All other differences appear once with part 'whole'.
 */
export interface DiffSegment {
  type: 'diff';
  diffId: DiffId;
  part: 'whole' | 'from' | 'to';
}

/**
 * Two tables paired with compatible structure: aligned row by row. Changes
 * inside are row-level diffs, or cell-level diffs nested in a row pair.
 */
export interface TablePairSegment {
  type: 'tablePair';
  oldTableId: NodeId;
  newTableId: NodeId;
  rows: RowSegment[];
}

export type RowSegment =
  | { type: 'equal'; oldRowId: NodeId; newRowId: NodeId }
  | { type: 'diff'; diffId: DiffId; part: 'whole' | 'from' | 'to' } // row inserted / deleted
  | { type: 'rowPair'; oldRowId: NodeId; newRowId: NodeId; cells: CellPair[] };

/** Cells of a row pair, matched by grid position. Cell contents recurse into Segment[] (nested tables). */
export interface CellPair {
  oldCellId: NodeId;
  newCellId: NodeId;
  segments: Segment[];
}

export type Segment = EqualSegment | DiffSegment | TablePairSegment;

// ---------------------------------------------------------------------------
// Check scope (spec §6.3)
// ---------------------------------------------------------------------------

export type ScopeStatus = 'compared' | 'detectedOnly' | 'shownNotCompared' | 'notSupported';

export interface ScopeItem {
  element: string; // "Body paragraphs", "Images", "Footnote text"...
  status: ScopeStatus;
  oldCount: number;
  newCount: number;
}

export interface FingerprintHint {
  part: FingerprintedPart;
  result: 'same' | 'mayDiffer' | 'absent';
  message?: string; // "Header text differs; not compared item by item."
}

/**
 * Header/footer "may differ" hint for one section pair and one variant.
 * Sections are paired by their position in the alignment (section breaks that
 * fall in the same aligned place); a section present on one side only is
 * 'onlyOld' / 'onlyNew'.
 */
export interface SectionHint {
  part: 'header' | 'footer';
  variant: HeaderVariant;
  oldSection?: number;
  newSection?: number;
  result: 'same' | 'mayDiffer' | 'onlyOld' | 'onlyNew';
}

export interface CheckScope {
  items: ScopeItem[];
  fingerprints: FingerprintHint[];
  /** Headers and footers, per section and variant. */
  sectionHints: SectionHint[];
  formatting: 'notChecked';
  unsupportedRevisions: { side: 'old' | 'new'; type: string; location: string }[];
  /** Pending revisions in the NEW file; they will be accepted on export. */
  pendingRevisionsInNew: number;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface Section {
  id: string;
  title: string;
  level: number;
}

export interface DiffResult {
  engineVersion: string;
  old: DocModel;
  new: DocModel;
  segments: Segment[];
  differences: Record<DiffId, Difference>;
  /** Navigation order (document order by first appearance in segments). */
  order: DiffId[];
  sections: Section[];
  scope: CheckScope;
}
