// View model: DiffResult segments → aligned rows for the virtualised list.
// One row = one horizontal band; both sides of a row share its height, so the
// shorter side's empty space is the alignment spacer.

import type { Block, TableBlock, TableRow } from '../model/document';
import type { DiffId, DiffResult, Difference, NormCategory, RowSegment, SectionHint, Segment } from '../model/diff';
import { DocIndex } from '../model/docIndex';

export type Part = 'whole' | 'from' | 'to';

export type Row =
  | { kind: 'equal'; key: string; old: Block; new: Block }
  | { kind: 'diff'; key: string; diffId: DiffId; part: Part; old: Block[]; new: Block[] }
  | {
      kind: 'tableRow';
      key: string;
      oldTable: TableBlock;
      newTable: TableBlock;
      seg: RowSegment;
      old: TableRow[];
      new: TableRow[];
      diffIds: DiffId[];
      first: boolean;
    }
  | { kind: 'gap'; key: string; runId: string; count: number }
  /** Header/footer marker for section 1 (later sections show theirs on the section-break line). */
  | { kind: 'section'; key: string; old?: SectionMarker; new?: SectionMarker };

export interface SectionMarker {
  section: number;
  hints: SectionHint[];
}

export interface SectionMarkers {
  first: { old?: SectionMarker; new?: SectionMarker };
  /** Marker of the section that STARTS after this section-break paragraph (ids are unique across sides). */
  afterBreak: Map<string, SectionMarker>;
}

/** Markers only for sections where some header/footer may differ or exists on one side only. */
export function sectionMarkers(r: DiffResult): SectionMarkers {
  const out: SectionMarkers = { first: {}, afterBreak: new Map() };
  for (const side of ['old', 'new'] as const) {
    const secs = r[side].sections;
    secs.forEach((sec, i) => {
      const hints = r.scope.sectionHints.filter((h) => (side === 'old' ? h.oldSection : h.newSection) === sec.index);
      if (!hints.some((h) => h.result !== 'same')) return;
      const m = { section: sec.index, hints };
      if (i === 0) out.first[side] = m;
      else if (secs[i - 1].breakBlockId) out.afterBreak.set(secs[i - 1].breakBlockId!, m);
    });
  }
  return out;
}

export function withSectionRows(rows: Row[], m: SectionMarkers): Row[] {
  if (!m.first.old && !m.first.new) return rows;
  return [{ kind: 'section', key: 'section:1', ...m.first }, ...rows];
}

export interface Indexes {
  old: DocIndex;
  new: DocIndex;
}

export function makeIndexes(r: DiffResult): Indexes {
  return { old: new DocIndex(r.old), new: new DocIndex(r.new) };
}

/** All diff ids inside a list of segments, recursively (cells, nested tables). */
export function diffIdsIn(segs: Segment[], out: DiffId[] = []): DiffId[] {
  for (const s of segs) {
    if (s.type === 'diff') out.push(s.diffId);
    else if (s.type === 'tablePair') for (const r of s.rows) diffIdsInRow(r, out);
  }
  return out;
}

export function diffIdsInRow(r: RowSegment, out: DiffId[] = []): DiffId[] {
  if (r.type === 'diff') out.push(r.diffId);
  else if (r.type === 'rowPair') for (const c of r.cells) diffIdsIn(c.segments, out);
  return out;
}

export function buildRows(r: DiffResult, ix: Indexes): Row[] {
  const rows: Row[] = [];
  for (const s of r.segments) {
    if (s.type === 'equal') {
      s.new.ids.forEach((nid, i) => rows.push({ kind: 'equal', key: nid, old: ix.old.block(s.old.ids[i]), new: ix.new.block(nid) }));
    } else if (s.type === 'diff') {
      const d = r.differences[s.diffId];
      rows.push({
        kind: 'diff',
        key: `${d.id}:${s.part}`,
        diffId: d.id,
        part: s.part,
        old: s.part === 'to' ? [] : d.old.ids.map((id) => ix.old.block(id)),
        new: s.part === 'from' ? [] : d.new.ids.map((id) => ix.new.block(id)),
      });
    } else {
      const oldTable = ix.old.table(s.oldTableId);
      const newTable = ix.new.table(s.newTableId);
      s.rows.forEach((seg, i) => {
        let o: TableRow[] = [];
        let n: TableRow[] = [];
        if (seg.type === 'diff') {
          const d = r.differences[seg.diffId];
          o = d.old.ids.map((id) => ix.old.row(id).row);
          n = d.new.ids.map((id) => ix.new.row(id).row);
        } else {
          o = [ix.old.row(seg.oldRowId).row];
          n = [ix.new.row(seg.newRowId).row];
        }
        rows.push({
          kind: 'tableRow',
          key: `${s.newTableId}:${i}`,
          oldTable,
          newTable,
          seg,
          old: o,
          new: n,
          diffIds: diffIdsInRow(seg),
          first: i === 0,
        });
      });
    }
  }
  return rows;
}

export interface Visibility {
  hiddenCategories: Set<NormCategory>;
  compareToc: boolean;
  compareFields: boolean;
  /** Mark automatic numbering changes (decision 38). */
  showNumbering: boolean;
  /** Mark formatting changes with "Aa" (decision 44). */
  showFormatting: boolean;
}

/** Is this difference hidden from view and navigation (category filter / optional comparison off)? */
export function isHidden(d: Difference, v: Visibility): boolean {
  if (d.informational === 'toc') return !v.compareToc;
  if (d.informational === 'fields') return !v.compareFields;
  if (d.informational === 'numbering') return true;
  if (d.category && v.hiddenCategories.has(d.category)) return true;
  if (d.wordHunks.length > 0 && d.wordHunks.every((h) => h.category && v.hiddenCategories.has(h.category))) return true;
  return false;
}

export function rowDiffIds(row: Row): DiffId[] {
  if (row.kind === 'diff') return [row.diffId];
  if (row.kind === 'tableRow') return row.diffIds;
  return [];
}

export interface Folding {
  collapseUnchanged: boolean;
  diffsOnly: boolean;
  expanded: Set<string>;
}

/**
 * Apply "collapse unchanged" / "differences only": runs of unchanged rows are
 * replaced by a gap row, keeping `context` rows on each side.
 */
export function foldRows(rows: Row[], changed: (row: Row) => boolean, f: Folding): Row[] {
  if (!f.collapseUnchanged && !f.diffsOnly) return rows;
  const context = f.diffsOnly ? 0 : 2;
  const minRun = f.diffsOnly ? 1 : 2 * context + 3;
  const out: Row[] = [];
  let run: Row[] = [];
  const flush = (atStart: boolean, atEnd: boolean) => {
    const runId = run[0]?.key;
    if (run.length >= minRun && runId && !f.expanded.has(runId)) {
      const head = atStart ? 0 : context;
      const tail = atEnd ? 0 : context;
      const hiddenCount = run.length - head - tail;
      if (hiddenCount > 0) {
        out.push(...run.slice(0, head));
        out.push({ kind: 'gap', key: `gap:${runId}`, runId, count: hiddenCount });
        out.push(...run.slice(run.length - tail));
        run = [];
        return;
      }
    }
    out.push(...run);
    run = [];
  };
  let seenChange = false;
  for (const row of rows) {
    // Keep table header rows next to changed table rows for context.
    const keep = changed(row) || (row.kind === 'tableRow' && row.new[0]?.isHeader && f.diffsOnly && tableHasChange(rows, row, changed));
    if (keep) {
      flush(!seenChange, false);
      out.push(row);
      seenChange = true;
    } else run.push(row);
  }
  flush(!seenChange, true);
  return out;
}

function tableHasChange(rows: Row[], header: Row, changed: (row: Row) => boolean) {
  if (header.kind !== 'tableRow') return false;
  return rows.some((r) => r.kind === 'tableRow' && r.newTable === header.newTable && changed(r));
}
