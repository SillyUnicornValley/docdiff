// Engine entry point: two .docx files → DiffResult.
// Tables are compared row by row from M3; the comparison moves into a Web Worker in M5.

import type { DiffResult } from '../model/diff';
import { compareDocs } from './compare/compare';
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
  const result = compareDocs(o.doc, n.doc, n.revisionCount);
  onStep(3);
  await yieldToUi();
  return { result, parsed: { old: o, new: n } };
}
