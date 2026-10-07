// Web Worker: runs the comparison off the main thread (stage2-design §1, M5).
// Parsing stays on the main thread (DOMParser is not available in workers).

import { compareDocs, type Groups } from './compare/compare';
import type { DocModel } from '../model/document';

export interface CompareRequest {
  old: DocModel;
  new: DocModel;
  pendingRevisionsInNew: number;
  groups: Groups;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<CompareRequest>) => void) | null; postMessage(m: unknown): void };

scope.onmessage = (e) => {
  try {
    const { old, new: neu, pendingRevisionsInNew, groups } = e.data;
    scope.postMessage({ ok: true, result: compareDocs(old, neu, pendingRevisionsInNew, groups) });
  } catch (err) {
    scope.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
