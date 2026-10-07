// Pure operations on review state + undo/redo history.

import type { DiffId, DiffResult } from './diff';
import type { Choice, HistoryEntry, ReviewHistory, ReviewProgressFile, ReviewState, ReviewStatus } from './review';

export interface Review {
  state: ReviewState;
  history: ReviewHistory;
}

export const emptyReview = (): Review => ({ state: { choices: {} }, history: { past: [], future: [] } });

export function statusOf(review: Review, id: DiffId): ReviewStatus {
  return review.state.choices[id] ?? 'unreviewed';
}

/** Apply choices as ONE undoable step. Changes that do nothing are dropped. */
export function applyChoices(
  review: Review,
  label: string,
  changes: { diffId: DiffId; to: Choice | undefined }[],
): Review {
  const choices = { ...review.state.choices };
  const entry: HistoryEntry = { label, changes: [] };
  for (const c of changes) {
    const before = choices[c.diffId];
    if (before === c.to) continue;
    entry.changes.push({ diffId: c.diffId, before, after: c.to });
    if (c.to === undefined) delete choices[c.diffId];
    else choices[c.diffId] = c.to;
  }
  if (entry.changes.length === 0) return review;
  return { state: { choices }, history: { past: [...review.history.past, entry], future: [] } };
}

function replay(choices: Record<DiffId, Choice>, entry: HistoryEntry, dir: 'undo' | 'redo') {
  const next = { ...choices };
  for (const c of entry.changes) {
    const v = dir === 'undo' ? c.before : c.after;
    if (v === undefined) delete next[c.diffId];
    else next[c.diffId] = v;
  }
  return next;
}

export function undo(review: Review): Review {
  const entry = review.history.past.at(-1);
  if (!entry) return review;
  return {
    state: { choices: replay(review.state.choices, entry, 'undo') },
    history: { past: review.history.past.slice(0, -1), future: [entry, ...review.history.future] },
  };
}

export function redo(review: Review): Review {
  const entry = review.history.future[0];
  if (!entry) return review;
  return {
    state: { choices: replay(review.state.choices, entry, 'redo') },
    history: { past: [...review.history.past, entry], future: review.history.future.slice(1) },
  };
}

export function makeProgressFile(result: DiffResult, review: Review, appVersion: string): ReviewProgressFile {
  return {
    format: 'docdiff-review',
    formatVersion: 1,
    appVersion,
    engineVersion: result.engineVersion,
    savedAt: new Date().toISOString(),
    old: { fileName: result.old.fileName, fingerprint: result.old.fingerprint },
    new: { fileName: result.new.fileName, fingerprint: result.new.fingerprint },
    choices: review.state.choices,
  };
}

export type LoadProgressResult =
  | { ok: true; choices: Record<DiffId, Choice>; skipped: number }
  | { ok: false; message: string };

export function parseProgressFile(text: string, result: DiffResult): LoadProgressResult {
  let data: ReviewProgressFile;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: 'This file is not a docdiff review-progress file (invalid JSON).' };
  }
  if (data?.format !== 'docdiff-review' || data.formatVersion !== 1)
    return { ok: false, message: 'This file is not a docdiff review-progress file.' };
  const mismatch: string[] = [];
  if (data.old?.fingerprint !== result.old.fingerprint)
    mismatch.push(`old file (saved with "${data.old?.fileName}", now "${result.old.fileName}")`);
  if (data.new?.fingerprint !== result.new.fingerprint)
    mismatch.push(`new file (saved with "${data.new?.fileName}", now "${result.new.fileName}")`);
  if (mismatch.length)
    return {
      ok: false,
      message: `Progress not loaded: the ${mismatch.join(' and the ')} is not the same document. Progress only loads for the exact two files it was saved with.`,
    };
  const choices: Record<DiffId, Choice> = {};
  let skipped = 0;
  for (const [id, c] of Object.entries(data.choices ?? {})) {
    const d = result.differences[id];
    if (!d || d.informational || (c !== 'old' && c !== 'new') || (c === 'old' && !d.useOld.available)) skipped++;
    else choices[id] = c;
  }
  return { ok: true, choices, skipped };
}
