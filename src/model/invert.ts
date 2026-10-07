// Swap old ↔ new on a DiffResult (used when the user swaps the two files).
// Stage 2 will simply re-run the comparison instead.

import type { DiffKind, DiffResult, Difference, RowSegment, Segment } from './diff';

const KIND: Partial<Record<DiffKind, DiffKind>> = { inserted: 'deleted', deleted: 'inserted' };

export function invertResult(r: DiffResult): DiffResult {
  const seg = (s: Segment): Segment => {
    if (s.type === 'equal') return { type: 'equal', old: s.new, new: s.old };
    if (s.type === 'diff') return { ...s, part: s.part === 'from' ? 'to' : s.part === 'to' ? 'from' : 'whole' };
    return {
      type: 'tablePair',
      oldTableId: s.newTableId,
      newTableId: s.oldTableId,
      rows: s.rows.map(
        (row): RowSegment =>
          row.type === 'equal'
            ? { type: 'equal', oldRowId: row.newRowId, newRowId: row.oldRowId }
            : row.type === 'diff'
              ? row
              : {
                  type: 'rowPair',
                  oldRowId: row.newRowId,
                  newRowId: row.oldRowId,
                  cells: row.cells.map((c) => ({ oldCellId: c.newCellId, newCellId: c.oldCellId, segments: c.segments.map(seg) })),
                },
      ),
    };
  };
  const differences: Record<string, Difference> = {};
  for (const d of Object.values(r.differences)) {
    differences[d.id] = {
      ...d,
      kind: KIND[d.kind] ?? d.kind,
      old: d.new,
      new: d.old,
      wordHunks: d.wordHunks.map((h) => ({ ...h, old: h.new, new: h.old })),
    };
  }
  // Moved content: in the swapped pair the 'to' location comes first in some cases; keep order by first appearance.
  return {
    ...r,
    old: { ...r.new, side: 'old' },
    new: { ...r.old, side: 'new' },
    segments: r.segments.map(seg),
    differences,
    scope: {
      ...r.scope,
      items: r.scope.items.map((i) => ({ ...i, oldCount: i.newCount, newCount: i.oldCount })),
      sectionHints: r.scope.sectionHints.map((h) => ({
        ...h,
        oldSection: h.newSection,
        newSection: h.oldSection,
        result: h.result === 'onlyOld' ? 'onlyNew' : h.result === 'onlyNew' ? 'onlyOld' : h.result,
      })),
      unsupportedRevisions: r.scope.unsupportedRevisions.map((u) => ({ ...u, side: u.side === 'old' ? 'new' : 'old' })),
    },
  };
}
