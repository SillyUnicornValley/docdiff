// Review state: the user's choices, kept separate from the immutable DiffResult
// (spec/merge §2). Missing entry = unreviewed, which counts as 'new' for the result.

import type { DiffId } from './diff';

export type Choice = 'old' | 'new';
export type ReviewStatus = 'unreviewed' | Choice;

export interface ReviewState {
  choices: Record<DiffId, Choice>;
}

/** One undoable step. A batch action ("all unreviewed → new") is ONE step. */
export interface HistoryEntry {
  label: string; // "Use old on #12", "Section 'Dosing' → new"
  changes: { diffId: DiffId; before: Choice | undefined; after: Choice | undefined }[];
}

export interface ReviewHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

/** Saved progress file (spec/ui §4). Loads only if both fingerprints match. */
export interface ReviewProgressFile {
  format: 'docdiff-review';
  formatVersion: 1;
  appVersion: string;
  engineVersion: string;
  savedAt: string; // ISO timestamp
  old: { fileName: string; fingerprint: string };
  new: { fileName: string; fingerprint: string };
  choices: Record<DiffId, Choice>;
}
