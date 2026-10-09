// Review state: the user's choices, kept separate from the immutable DiffResult
// (spec/merge §2). Missing entry = unreviewed, which counts as 'new' for the result.

import type { DiffId } from './diff';

export type Choice = 'old' | 'new';

/**
 * Per-change choice inside one modified paragraph (decision 42): one Choice per
 * word hunk of the difference, in order. Only stored when the hunks are mixed;
 * all-old or all-new is stored as the plain Choice.
 */
export interface HunkSelection {
  hunks: Choice[];
}

export type Selection = Choice | HunkSelection;
export type ReviewStatus = 'unreviewed' | Choice | 'mixed';

export interface ReviewState {
  choices: Record<DiffId, Selection>;
}

/** One undoable step. A batch action ("all unreviewed → new") is ONE step. */
export interface HistoryEntry {
  label: string; // "Use old on #12", "Section 'Dosing' → new"
  changes: { diffId: DiffId; before: Selection | undefined; after: Selection | undefined }[];
}

export interface ReviewHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

/**
 * Saved progress file (spec/ui §4). Loads only if both fingerprints match.
 * formatVersion 2 (v0.5) adds per-change selections; version 1 files still load.
 */
export interface ReviewProgressFile {
  format: 'docdiff-review';
  formatVersion: 1 | 2;
  appVersion: string;
  engineVersion: string;
  savedAt: string; // ISO timestamp
  old: { fileName: string; fingerprint: string };
  new: { fileName: string; fingerprint: string };
  choices: Record<DiffId, Selection>;
}
