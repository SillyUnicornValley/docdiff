// Structure hints between paired paragraphs (spec/comparison §1, §6; decisions 37–38).
// Shown only: not a difference, not choosable; export keeps the new file.
//  - heading level changes ("Heading 1 → Heading 2", "Body text → Heading 2")
//  - automatic numbering changes ("3. → 4.", "1. → a.")

import type { DiffResult, RowSegment, Segment } from './diff';
import { DocIndex } from './docIndex';
import type { Block, NodeId, ParagraphBlock, ParagraphRole, TableBlock } from './document';
import { flattenParagraph } from './flatten';

export interface StructureChange {
  oldId: NodeId;
  newId: NodeId;
  oldLabel: string;
  newLabel: string;
  /** Text of the new paragraph, for lists. */
  text: string;
}

export interface StructureHints {
  levels: StructureChange[];
  numbering: StructureChange[];
}

export function roleLabel(r: ParagraphRole): string {
  if (r.type === 'title') return 'Title';
  if (r.type === 'heading') return `Heading ${r.level}`;
  if (r.type === 'listItem') return 'List item';
  return 'Body text';
}

const isHeading = (r: ParagraphRole) => r.type === 'heading' || r.type === 'title';

/** Label shown when one side has no automatic number. */
export const NO_NUMBER = 'no number';

export interface PairedNodes {
  paragraphs: [ParagraphBlock, ParagraphBlock][];
  tables: [TableBlock, TableBlock][];
}

/**
 * Paired paragraphs, in document order of the alignment: equal content,
 * modified paragraphs (1:1 by position) and moves, including inside tables.
 */
function pairedParagraphs(r: Pick<DiffResult, 'segments' | 'differences'>, ix: { old: DocIndex; new: DocIndex }): [ParagraphBlock, ParagraphBlock][] {
  return pairedNodes(r, ix).paragraphs;
}

/** Paired paragraphs (see above) and paired tables: equal, compared row by row, or a whole-table difference. */
export function pairedNodes(r: Pick<DiffResult, 'segments' | 'differences'>, ix: { old: DocIndex; new: DocIndex }): PairedNodes {
  const out: [ParagraphBlock, ParagraphBlock][] = [];
  const tables: [TableBlock, TableBlock][] = [];
  const pair = (o: Block, n: Block) => {
    if (o.kind === 'table' && n.kind === 'table') {
      tables.push([o, n]);
      // Equal tables: pair cell contents by position.
      o.rows.forEach((row, ri) => row.cells.forEach((c, ci) => pairLists(c.blocks, n.rows[ri]?.cells[ci]?.blocks ?? [])));
    } else if (o.kind === 'paragraph' && n.kind === 'paragraph') out.push([o, n]);
  };
  const pairLists = (os: Block[], ns: Block[]) => os.forEach((b, i) => ns[i] && pair(b, ns[i]));
  const pairIds = (os: NodeId[], ns: NodeId[]) => pairLists(os.map((id) => ix.old.block(id)), ns.map((id) => ix.new.block(id)));

  const seen = new Set<string>();
  const walk = (segs: Segment[]) => {
    for (const s of segs) {
      if (s.type === 'equal') pairIds(s.old.ids, s.new.ids);
      else if (s.type === 'diff') {
        const d = r.differences[s.diffId];
        if (seen.has(d.id) || d.old.unit !== 'block') continue;
        seen.add(d.id);
        if ((d.kind === 'modified' || d.kind === 'moved') && d.old.ids.length === d.new.ids.length) pairIds(d.old.ids, d.new.ids);
        else if (d.kind === 'tableStructure') tables.push([ix.old.table(d.old.ids[0]), ix.new.table(d.new.ids[0])]);
      } else {
        tables.push([ix.old.table(s.oldTableId), ix.new.table(s.newTableId)]);
        s.rows.forEach(walkRow);
      }
    }
  };
  const walkRow = (row: RowSegment) => {
    if (row.type === 'equal') {
      const [o, n] = [ix.old.row(row.oldRowId).row, ix.new.row(row.newRowId).row];
      o.cells.forEach((c, ci) => pairLists(c.blocks, n.cells[ci]?.blocks ?? []));
    } else if (row.type === 'rowPair') row.cells.forEach((c) => walk(c.segments));
  };
  walk(r.segments);
  return { paragraphs: out, tables };
}

export function structureHints(r: DiffResult, ix = { old: new DocIndex(r.old), new: new DocIndex(r.new) }): StructureHints {
  const hints: StructureHints = { levels: [], numbering: [] };
  for (const [o, n] of pairedParagraphs(r, ix)) {
    const change = (oldLabel: string, newLabel: string) => ({ oldId: o.id, newId: n.id, oldLabel, newLabel, text: flattenParagraph(n).text.trim() });
    if (isHeading(o.role) || isHeading(n.role)) {
      const [a, b] = [roleLabel(o.role), roleLabel(n.role)];
      if (a !== b) hints.levels.push(change(a, b));
    }
    if (o.numbering || n.numbering) {
      const [a, b] = [o.numbering?.label ?? NO_NUMBER, n.numbering?.label ?? NO_NUMBER];
      if (a !== b) hints.numbering.push(change(a, b));
    }
  }
  return hints;
}
