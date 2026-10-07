// Engine entry point: two .docx files → DiffResult.
// Parsing runs on the main thread; the comparison runs in a Web Worker when
// the browser allows one, otherwise on the main thread.

import type { DiffResult } from '../model/diff';
import { compareDocs, type Groups } from './compare/compare';
import type { CompareRequest } from './compare.worker';
import CompareWorker from './compare.worker?worker&inline';
import { parseDocx, type ParsedDocx } from './docx/parseDocx';
import { DocxError } from './docx/xml';

export { DocxError };

export interface InputFile {
  name: string;
  data: ArrayBuffer;
}

export interface CompareOutput {
  result: DiffResult;
  /** Parsed files (XML working copies), kept on the main thread for export. */
  parsed: { old: ParsedDocx; new: ParsedDocx };
}

/** Steps reported to the progress dialog, in order. */
export const COMPARE_STEPS = ['Reading files', 'Accepting existing tracked changes', 'Aligning paragraphs and tables', 'Finding word-level differences'] as const;

/** Parse one file; a file problem names the file it is about. */
async function parseNamed(f: InputFile, side: 'old' | 'new'): Promise<ParsedDocx> {
  try {
    return await parseDocx(f.data, side, f.name);
  } catch (e) {
    if (e instanceof DocxError) throw new DocxError(`${side === 'old' ? 'Old' : 'New'} file “${f.name}”: ${e.message}`);
    throw e;
  }
}

/**
 * Compare in a Web Worker (inlined as a blob URL so the single-file build and
 * file:// keep working). Any failure to start or run the worker falls back to
 * the main thread, e.g. where a security policy blocks blob workers.
 */
async function compareInWorker(req: CompareRequest): Promise<DiffResult> {
  const fallback = () => compareDocs(req.old, req.new, req.pendingRevisionsInNew, req.groups);
  let worker: Worker;
  try {
    worker = new CompareWorker();
  } catch {
    return fallback();
  }
  return new Promise<DiffResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: true; result: DiffResult } | { ok: false; message: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.message));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      // The worker could not load or crashed outside compareDocs: compare here instead.
      try {
        resolve(fallback());
      } catch (err) {
        reject(err);
      }
    };
    worker.postMessage(req);
  });
}

/** Let the browser paint the progress dialog between steps. */
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function compareFiles(oldFile: InputFile, newFile: InputFile, onStep: (step: number) => void = () => {}): Promise<CompareOutput> {
  onStep(0);
  await yieldToUi();
  // Reading includes accepting existing revisions (decision 22).
  const o = await parseNamed(oldFile, 'old');
  onStep(1);
  await yieldToUi();
  const n = await parseNamed(newFile, 'new');
  onStep(2);
  await yieldToUi();
  const groups: Groups = { old: o.groups, new: n.groups };
  const result = await compareInWorker({ old: o.doc, new: n.doc, pendingRevisionsInNew: n.revisionCount, groups });
  onStep(3);
  await yieldToUi();
  return { result, parsed: { old: o, new: n } };
}
