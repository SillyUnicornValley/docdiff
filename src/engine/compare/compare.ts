// Two DocModels → DiffResult (docs/stage2-design.md §3). Tables are compared
// as whole blocks for now; row-level table comparison is milestone M3.

import type { Block, DocModel, ParagraphBlock } from '../../model/document';
import type { DiffKind, DiffResult, Difference, OptionalComparison, Section, Segment, WordHunk } from '../../model/diff';
import { flattenParagraph } from '../../model/flatten';
import { computeScope } from '../../model/scope';
import { computeUseOld } from '../../model/useOld';
import { alignBlocks, type AlignOp } from '../align/alignBlocks';
import { hashString } from '../hash';
import { blockKey, optionalDifference } from './keys';
import { detectedOnlyRows } from './scopeRows';
import { commonCategory, wordDiff } from './wordDiff';

export const ENGINE_VERSION = 'engine-2';

const isPara = (b: Block): b is ParagraphBlock => b.kind === 'paragraph';
const isEmptyPara = (b: Block) => isPara(b) && flattenParagraph(b).text.trim() === '';
const isH1 = (b: Block): b is ParagraphBlock => isPara(b) && b.role.type === 'heading' && b.role.level === 1;

export function compareDocs(o: DocModel, n: DocModel, pendingRevisionsInNew: number): DiffResult {
  const ops = alignBlocks(o.blocks, n.blocks);

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

  const makeDiff = (kind: DiffKind, oldBlocks: Block[], newBlocks: Block[], extra: Partial<Difference> = {}): Difference => {
    // Content-based id: the same two files give the same ids, so saved progress can be restored (stage2-design §4).
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
      ...extra,
    };
    differences[id] = d;
    return d;
  };

  const push = (d: Difference, part: 'whole' | 'from' | 'to' = 'whole') => {
    if (!order.includes(d.id)) order.push(d.id);
    segments.push({ type: 'diff', diffId: d.id, part });
  };

  const changed = (kind: DiffKind, oldBlocks: Block[], newBlocks: Block[], informational?: OptionalComparison) => {
    let hunks: WordHunk[] = [];
    if ((kind === 'modified' || kind === 'splitJoin' || kind === 'moved') && [...oldBlocks, ...newBlocks].every(isPara))
      hunks = wordDiff(oldBlocks as ParagraphBlock[], newBlocks as ParagraphBlock[]);
    const d = makeDiff(kind, oldBlocks, newBlocks, { wordHunks: hunks });
    const cat = commonCategory(hunks);
    if (cat && !informational) d.category = cat;
    if ((kind === 'inserted' || kind === 'deleted') && [...oldBlocks, ...newBlocks].every(isEmptyPara)) d.category = 'emptyParagraph';
    if (informational) d.informational = informational;
    if (kind === 'splitJoin') d.summary = oldBlocks.length === 1 ? `1 paragraph split into ${newBlocks.length}` : `${oldBlocks.length} paragraphs joined into 1`;
    return d;
  };

  // Moves: one difference, created when its first half is reached.
  const moves = new Map<number, Difference>();
  const moveDiff = (op: Extract<AlignOp, { type: 'moveFrom' | 'moveTo' }>) => {
    let d = moves.get(op.move);
    if (!d) {
      const from = ops.find((x) => x.type === 'moveFrom' && x.move === op.move) as Extract<AlignOp, { type: 'moveFrom' }>;
      const to = ops.find((x) => x.type === 'moveTo' && x.move === op.move) as Extract<AlignOp, { type: 'moveTo' }>;
      d = changed('moved', [from.o], [to.n]);
      d.similarity = Math.round(op.sim * 100) / 100;
      moves.set(op.move, d);
    }
    return d;
  };

  // Adjacent deleted (or inserted) blocks form one difference (decision 14);
  // empty paragraphs are kept apart so they can be hidden as a category, and a
  // level-1 heading starts a new difference so "this section" batch actions fit.
  let run: { kind: 'deleted' | 'inserted'; blocks: Block[]; empty: boolean } | null = null;
  const flushRun = () => {
    if (run) push(run.kind === 'deleted' ? changed('deleted', run.blocks, []) : changed('inserted', [], run.blocks));
    run = null;
  };
  const addToRun = (kind: 'deleted' | 'inserted', b: Block) => {
    const empty = isEmptyPara(b);
    if (!run || run.kind !== kind || run.empty !== empty || isH1(b)) {
      flushRun();
      noteSection(b);
      run = { kind, blocks: [], empty };
    }
    run.blocks.push(b);
  };

  for (const op of ops) {
    if (op.type === 'del') addToRun('deleted', op.o);
    else if (op.type === 'ins') addToRun('inserted', op.n);
    else {
      flushRun();
      if (op.type === 'equal') {
        noteSection(op.n);
        const info = optionalDifference(op.o, op.n);
        if (info) {
          push(changed('modified', [op.o], [op.n], info));
          continue;
        }
        const last = segments.at(-1);
        if (last?.type === 'equal') {
          last.old.ids.push(op.o.id);
          last.new.ids.push(op.n.id);
        } else segments.push({ type: 'equal', old: { unit: 'block', ids: [op.o.id] }, new: { unit: 'block', ids: [op.n.id] } });
      } else if (op.type === 'pair') {
        op.n.forEach(noteSection);
        const tables = [...op.o, ...op.n].filter((b) => b.kind === 'table').length;
        if (tables === 2) push(changed('tableStructure', op.o, op.n));
        else if (tables === 1) push(changed('replaced', op.o, op.n));
        else push(changed(op.o.length === 1 && op.n.length === 1 ? 'modified' : 'splitJoin', op.o, op.n));
      } else if (op.type === 'moveFrom') push(moveDiff(op), 'from');
      else {
        noteSection(op.n);
        push(moveDiff(op), 'to');
      }
    }
  }
  flushRun();

  return {
    engineVersion: ENGINE_VERSION,
    old: o,
    new: n,
    segments,
    differences,
    order,
    sections,
    scope: computeScope(o, n, { extraScope: detectedOnlyRows(o, n), pendingRevisionsInNew }),
  };
}
