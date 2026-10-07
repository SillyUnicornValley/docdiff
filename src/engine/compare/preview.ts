// M1 preview comparison (temporary, replaced in M2): aligns top-level blocks
// whose content is identical; everything else is shown as deleted / inserted.
// It already produces a complete DiffResult so the UI works on real files.

import type { Block, DocModel, ParagraphBlock } from '../../model/document';
import type { DiffKind, DiffResult, Difference, OptionalComparison, Section, Segment } from '../../model/diff';
import { flattenParagraph } from '../../model/flatten';
import { computeScope } from '../../model/scope';
import { computeUseOld } from '../../model/useOld';
import { diffKeys } from '../align/myers';
import { hashString } from '../hash';
import { detectedOnlyRows } from './scopeRows';

export const PREVIEW_ENGINE_VERSION = 'preview-1';

/**
 * Content key of a paragraph: visible text plus content marks (superscript,
 * hidden). Comments are zero-width and ignored. Field results other than
 * cross-references are optional comparisons (decision 10): left out unless `withFields`.
 */
export function paragraphKey(p: ParagraphBlock, withFields = false): string {
  let key = '';
  let lastField = -1;
  for (const piece of flattenParagraph(p).pieces) {
    if (piece.kind === 'comment') continue;
    if (!withFields && piece.wrap?.type === 'field' && piece.wrap.fieldType !== 'REF') {
      if (piece.src !== lastField) key += '\u0006';
      lastField = piece.src;
      continue;
    }
    const m = piece.marks;
    if (m?.superscript || m?.subscript || m?.hidden) key += `\u0001${m.superscript ? '^' : ''}${m.subscript ? '_' : ''}${m.hidden ? 'h' : ''}\u0002`;
    key += piece.text;
  }
  return key;
}

export function blockKey(b: Block): string {
  if (b.kind === 'paragraph') return `p:${paragraphKey(b)}`;
  // TOC and other placeholders are not compared: same kind = same.
  if (b.kind === 'placeholder') return `x:${b.element}`;
  return `t:${b.rows.map((r) => r.cells.map((c) => `${c.gridSpan}/${c.vMerge}:${c.blocks.map(blockKey).join('\u0003')}`).join('\u0004')).join('\u0005')}`;
}

function optionalDifference(a: Block, b: Block): OptionalComparison | undefined {
  if (a.kind === 'placeholder' && b.kind === 'placeholder' && a.element === 'toc') return a.fingerprint !== b.fingerprint ? 'toc' : undefined;
  if (a.kind === 'paragraph' && b.kind === 'paragraph') return paragraphKey(a, true) !== paragraphKey(b, true) ? 'fields' : undefined;
  return undefined;
}

const isEmptyPara = (b: Block) => b.kind === 'paragraph' && flattenParagraph(b).text === '';
const isH1 = (b: Block): b is ParagraphBlock => b.kind === 'paragraph' && b.role.type === 'heading' && b.role.level === 1;

export function previewCompare(o: DocModel, n: DocModel, pendingRevisionsInNew: number): DiffResult {
  const oldKeys = o.blocks.map(blockKey);
  const newKeys = n.blocks.map(blockKey);
  const ops = diffKeys(oldKeys, newKeys);

  const segments: Segment[] = [];
  const differences: Record<string, Difference> = {};
  const order: string[] = [];
  const sections: Section[] = [{ id: 'start', title: '(Start of document)', level: 0 }];
  let currentSection = 'start';
  const idCount = new Map<string, number>();

  const noteSection = (b: Block) => {
    if (!isH1(b)) return;
    currentSection = b.id;
    sections.push({ id: b.id, title: flattenParagraph(b).text, level: 1 });
  };

  const addDiff = (kind: DiffKind, oldBlocks: Block[], newBlocks: Block[], informational?: OptionalComparison) => {
    // Content-based id: stable when the same two files are compared again (stage2-design §4).
    const base = `${kind[0]}${hashString(`${kind}|${oldBlocks.map(blockKey).join('\n')}|${newBlocks.map(blockKey).join('\n')}`)}`;
    const k = (idCount.get(base) ?? 0) + 1;
    idCount.set(base, k);
    const id = k === 1 ? base : `${base}-${k}`;
    const d: Difference = {
      id,
      kind,
      old: { unit: 'block', ids: oldBlocks.map((b) => b.id) },
      new: { unit: 'block', ids: newBlocks.map((b) => b.id) },
      wordHunks: [],
      useOld: computeUseOld([...oldBlocks, ...newBlocks]),
      sectionId: currentSection,
    };
    if ((oldBlocks.length ? oldBlocks : newBlocks).every(isEmptyPara)) d.category = 'emptyParagraph';
    if (informational) d.informational = informational;
    differences[id] = d;
    order.push(id);
    segments.push({ type: 'diff', diffId: id, part: 'whole' });
  };

  let dels: Block[] = [];
  let ins: Block[] = [];
  const flush = () => {
    if (dels.length) {
      // A deleted level-1 heading still opens a section for "this section" batch actions.
      dels.forEach(noteSection);
      addDiff('deleted', dels, []);
    }
    if (ins.length) {
      ins.forEach(noteSection);
      addDiff('inserted', [], ins);
    }
    dels = [];
    ins = [];
  };

  for (const op of ops) {
    if (op.type === 'delete') dels.push(o.blocks[op.a]);
    else if (op.type === 'insert') ins.push(n.blocks[op.b]);
    else {
      flush();
      const [ob, nb] = [o.blocks[op.a], n.blocks[op.b]];
      noteSection(nb);
      // Same content, but a TOC or a date/page field shows something else: shown only, no choice (decision 10).
      const info = optionalDifference(ob, nb);
      if (info) {
        addDiff('modified', [ob], [nb], info);
        continue;
      }
      const last = segments.at(-1);
      if (last?.type === 'equal') {
        last.old.ids.push(o.blocks[op.a].id);
        last.new.ids.push(n.blocks[op.b].id);
      } else segments.push({ type: 'equal', old: { unit: 'block', ids: [o.blocks[op.a].id] }, new: { unit: 'block', ids: [n.blocks[op.b].id] } });
    }
  }
  flush();

  return {
    engineVersion: PREVIEW_ENGINE_VERSION,
    old: o,
    new: n,
    segments,
    differences,
    order,
    sections,
    scope: computeScope(o, n, { extraScope: detectedOnlyRows(o, n), pendingRevisionsInNew }),
  };
}
