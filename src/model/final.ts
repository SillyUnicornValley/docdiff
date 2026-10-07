// Final result = concatenation of each segment's chosen side (spec §7.1).
// Unreviewed differences count as 'new'. Informational differences are always 'new'.

import type { Block, NodeId, TableBlock, TableCell, TableRow } from './document';
import type { CellPair, DiffResult, Difference, RowSegment, Segment } from './diff';
import { DocIndex } from './docIndex';
import type { Choice } from './review';

export type Origin = 'old' | 'new';

export interface FinalResult {
  blocks: Block[];
  /** Nodes taken from a difference, with the side they came from. Unmarked nodes are unchanged. */
  origin: Map<NodeId, { side: Origin; diffId: string }>;
}

export function effectiveChoice(d: Difference, choices: Record<string, Choice>): Choice {
  if (d.informational) return 'new';
  return choices[d.id] ?? 'new';
}

/** Which side of a diff segment part ends up in the final result, or null for nothing. */
export function partOutput(part: 'whole' | 'from' | 'to', choice: Choice): Origin | null {
  if (part === 'from') return choice === 'old' ? 'old' : null;
  if (part === 'to') return choice === 'new' ? 'new' : null;
  return choice;
}

export function buildFinal(result: DiffResult, choices: Record<string, Choice>): FinalResult {
  const idx = { old: new DocIndex(result.old), new: new DocIndex(result.new) };
  const origin: FinalResult['origin'] = new Map();

  const segs = (segments: Segment[]): Block[] => {
    const out: Block[] = [];
    for (const s of segments) {
      if (s.type === 'equal') {
        for (const id of s.new.ids) out.push(idx.new.block(id));
      } else if (s.type === 'diff') {
        const d = result.differences[s.diffId];
        const side = partOutput(s.part, effectiveChoice(d, choices));
        if (!side) continue;
        for (const id of d[side].ids) {
          origin.set(id, { side, diffId: d.id });
          out.push(idx[side].block(id));
        }
      } else {
        out.push(tablePair(s.oldTableId, s.newTableId, s.rows));
      }
    }
    return out;
  };

  const tablePair = (oldId: NodeId, newId: NodeId, rows: RowSegment[]): TableBlock => {
    const base = idx.new.table(newId);
    const outRows: TableRow[] = [];
    for (const r of rows) {
      if (r.type === 'equal') outRows.push(idx.new.row(r.newRowId).row);
      else if (r.type === 'diff') {
        const d = result.differences[r.diffId];
        const side = partOutput(r.part, effectiveChoice(d, choices));
        if (!side) continue;
        for (const id of d[side].ids) {
          origin.set(id, { side, diffId: d.id });
          outRows.push(idx[side].row(id).row);
        }
      } else {
        const nr = idx.new.row(r.newRowId).row;
        outRows.push({ ...nr, cells: r.cells.map((c) => cell(c)) });
      }
    }
    void oldId;
    return { ...base, rows: outRows };
  };

  const cell = (c: CellPair): TableCell => {
    const nc = idx.new.cell(c.newCellId);
    return { ...nc, blocks: segs(c.segments) };
  };

  return { blocks: segs(result.segments), origin };
}
