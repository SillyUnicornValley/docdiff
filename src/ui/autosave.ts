// Browser-local autosave of review choices (decision A11). Auxiliary only:
// the progress file stays the real way to keep a review. Storage can be
// unavailable or cleared at any time, so every access is guarded.

import type { DiffResult } from '../model/diff';
import type { Selection } from '../model/review';
import { validSelection } from '../model/selection';

export interface AutosaveEntry {
  savedAt: string;
  choices: Record<string, Selection>;
}

const keyOf = (r: DiffResult) => `docdiff:autosave:${r.old.fingerprint}:${r.new.fingerprint}`;

export function readAutosave(r: DiffResult): AutosaveEntry | null {
  try {
    const raw = localStorage.getItem(keyOf(r));
    if (!raw) return null;
    const e = JSON.parse(raw) as AutosaveEntry;
    // Keep only choices that still apply to this comparison.
    const choices: Record<string, Selection> = {};
    for (const [id, c] of Object.entries(e.choices ?? {})) {
      if (validSelection(r.differences[id], c)) choices[id] = c;
    }
    return Object.keys(choices).length ? { savedAt: e.savedAt, choices } : null;
  } catch {
    return null;
  }
}

export function writeAutosave(r: DiffResult, choices: Record<string, Selection>) {
  try {
    if (Object.keys(choices).length === 0) localStorage.removeItem(keyOf(r));
    else localStorage.setItem(keyOf(r), JSON.stringify({ savedAt: new Date().toISOString(), choices } satisfies AutosaveEntry));
  } catch {
    // Storage unavailable (private window, blocked site data): autosave is best-effort.
  }
}
