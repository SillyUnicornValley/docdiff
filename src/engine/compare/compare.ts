// Two DocModels → DiffResult (docs/implementation/stage2-design.md §3). The body, table
// cells and nested tables all go through the same container comparison.

import type { Block, DocModel, ParagraphBlock, TableBlock, TableCell, TableRow } from '../../model/document';
import type {
  CellPair,
  DiffKind,
  DiffResult,
  Difference,
  OptionalComparison,
  RowSegment,
  Section,
  Segment,
  TablePairSegment,
  TextSpan,
  WordHunk,
} from '../../model/diff';
import { forEachParagraph } from '../../model/docIndex';
import { flattenParagraph } from '../../model/flatten';
import { computeScope } from '../../model/scope';
import { portableUseOld, useOldBlocked, type UseOldContext } from '../../model/useOld';
import { alignBlocks, alignRows, rowKey, type AlignOp } from '../align/alignBlocks';
import { diffKeys } from '../align/myers';
import { hashString } from '../hash';
import { compareFormatting } from './formatting';
import { blockKey, optionalDifference } from './keys';
import { detectedOnlyRows } from './scopeRows';
import { sectionHints } from './sections';
import { commonCategory, fullSpan, similarity, wordDiff } from './wordDiff';

export const ENGINE_VERSION = 'engine-5';

const isPara = (b: Block): b is ParagraphBlock => b.kind === 'paragraph';
/** Only text, tabs, line breaks and comment anchors: per-change selection can rebuild it (decision 42). */
const isPlainPara = (b: Block) => isPara(b) && b.content.every((i) => i.type === 'text' || i.type === 'tab' || i.type === 'break' || i.type === 'comment');
const isEmptyPara = (b: Block) => isPara(b) && flattenParagraph(b).text.trim() === '';
const isH1 = (b: Block): b is ParagraphBlock => isPara(b) && b.role.type === 'heading' && b.role.level === 1;
const cellBlocks = (rows: TableRow[]) => rows.flatMap((r) => r.cells.flatMap((c) => c.blocks));
const parasIn = (blocks: Block[]) => {
  const out: ParagraphBlock[] = [];
  forEachParagraph(blocks, (p) => out.push(p));
  return out;
};

type Unit = Block | TableRow;
const unitKey = (u: Unit) => ('kind' in u ? blockKey(u) : `r:${rowKey(u)}`);

class Comparer {
  differences: Record<string, Difference> = {};
  sections: Section[] = [{ id: 'start', title: '(Start of document)', level: 0 }];
  private currentSection = 'start';
  private idCount = new Map<string, number>();

  constructor(private useOldCtx: UseOldContext) {}

  private noteSection(b: Block, top: boolean) {
    if (!top || !isH1(b)) return;
    this.currentSection = b.id;
    this.sections.push({ id: b.id, title: flattenParagraph(b).text, level: 1 });
  }

  private makeDiff(kind: DiffKind, oldUnits: Unit[], newUnits: Unit[], extra: Partial<Difference> = {}): Difference {
    // Content-based id: the same two files give the same ids, so saved progress can be restored (stage2-design §4).
    const base = `${kind[0]}${hashString(`${kind}|${oldUnits.map(unitKey).join('\n')}|${newUnits.map(unitKey).join('\n')}`)}`;
    const k = (this.idCount.get(base) ?? 0) + 1;
    this.idCount.set(base, k);
    const id = k === 1 ? base : `${base}-${k}`;
    const unit = [...oldUnits, ...newUnits].some((u) => !('kind' in u)) ? 'row' : 'block';
    const oldBlocks = oldUnits.flatMap((u) => ('kind' in u ? [u] : cellBlocks([u])));
    const d: Difference = {
      id,
      kind,
      old: { unit, ids: oldUnits.map((u) => u.id) },
      new: { unit, ids: newUnits.map((u) => u.id) },
      wordHunks: [],
      useOld: portableUseOld(oldBlocks, this.useOldCtx),
      sectionId: this.currentSection,
      ...extra,
    };
    this.differences[id] = d;
    return d;
  }

  private changed(kind: DiffKind, oldBlocks: Block[], newBlocks: Block[], opts: { informational?: OptionalComparison; hunks?: WordHunk[] } = {}) {
    let hunks = opts.hunks ?? [];
    if (!opts.hunks && (kind === 'modified' || kind === 'splitJoin' || kind === 'moved') && [...oldBlocks, ...newBlocks].every(isPara))
      hunks = wordDiff(oldBlocks as ParagraphBlock[], newBlocks as ParagraphBlock[]);
    const d = this.makeDiff(kind, oldBlocks, newBlocks, { wordHunks: hunks });
    const cat = kind === 'tableStructure' ? undefined : commonCategory(hunks);
    if (cat && !opts.informational) d.category = cat;
    if ((kind === 'inserted' || kind === 'deleted') && [...oldBlocks, ...newBlocks].every(isEmptyPara)) d.category = 'emptyParagraph';
    if (opts.informational) d.informational = opts.informational;
    if (kind === 'modified' && !opts.informational && hunks.length >= 2 && hunks.every((h) => h.at) && [...oldBlocks, ...newBlocks].every(isPlainPara)) d.perChange = true;
    if (kind === 'splitJoin') d.summary = oldBlocks.length === 1 ? `1 paragraph split into ${newBlocks.length}` : `${oldBlocks.length} paragraphs joined into 1`;
    return d;
  }

  // -------------------------------------------------------------------------
  // Containers (body, cell)
  // -------------------------------------------------------------------------

  container(o: Block[], n: Block[], top: boolean): Segment[] {
    const ops = alignBlocks(o, n);
    const segments: Segment[] = [];
    const push = (d: Difference, part: 'whole' | 'from' | 'to' = 'whole') => segments.push({ type: 'diff', diffId: d.id, part });

    // Moves: one difference, created when its first half is reached.
    const moves = new Map<number, Difference>();
    const moveDiff = (op: Extract<AlignOp<Block>, { type: 'moveFrom' | 'moveTo' }>) => {
      let d = moves.get(op.move);
      if (!d) {
        const from = ops.find((x) => x.type === 'moveFrom' && x.move === op.move) as Extract<AlignOp<Block>, { type: 'moveFrom' }>;
        const to = ops.find((x) => x.type === 'moveTo' && x.move === op.move) as Extract<AlignOp<Block>, { type: 'moveTo' }>;
        d = this.changed('moved', [from.o], [to.n]);
        d.similarity = Math.round(op.sim * 100) / 100;
        moves.set(op.move, d);
      }
      return d;
    };

    // Adjacent deleted (or inserted) blocks form one difference (decision 14);
    // empty paragraphs are kept apart so they can be hidden as a category, and a
    // level-1 heading starts a new difference so "this section" batch actions fit
    // (spec/comparison §2.2 G2–G4).
    let run: { kind: 'deleted' | 'inserted'; blocks: Block[]; empty: boolean } | null = null;
    const flushRun = () => {
      if (run) push(run.kind === 'deleted' ? this.changed('deleted', run.blocks, []) : this.changed('inserted', [], run.blocks));
      run = null;
    };
    const addToRun = (kind: 'deleted' | 'inserted', b: Block) => {
      const empty = isEmptyPara(b);
      if (!run || run.kind !== kind || run.empty !== empty || isH1(b)) {
        flushRun();
        this.noteSection(b, top);
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
          this.noteSection(op.n, top);
          const info = optionalDifference(op.o, op.n);
          if (info) {
            push(this.changed('modified', [op.o], [op.n], { informational: info }));
            continue;
          }
          const last = segments.at(-1);
          if (last?.type === 'equal') {
            last.old.ids.push(op.o.id);
            last.new.ids.push(op.n.id);
          } else segments.push({ type: 'equal', old: { unit: 'block', ids: [op.o.id] }, new: { unit: 'block', ids: [op.n.id] } });
        } else if (op.type === 'pair') {
          op.n.forEach((b) => this.noteSection(b, top));
          const tables = [...op.o, ...op.n].filter((b) => b.kind === 'table') as TableBlock[];
          if (tables.length === 2) {
            const [ot, nt] = tables;
            // Compatible structure: row by row (M3); otherwise one whole-table choice (decision 6).
            const pair = this.tablePair(ot, nt);
            if (pair) segments.push(pair);
            else push(this.changed('tableStructure', [ot], [nt], { hunks: tableHunks(ot, nt) }));
          } else if (tables.length === 1) push(this.changed('replaced', op.o, op.n));
          else push(this.changed(op.o.length === 1 && op.n.length === 1 ? 'modified' : 'splitJoin', op.o, op.n));
        } else if (op.type === 'moveFrom') push(moveDiff(op), 'from');
        else {
          this.noteSection(op.n, top);
          push(moveDiff(op), 'to');
        }
      }
    }
    flushRun();
    return segments;
  }

  // -------------------------------------------------------------------------
  // Tables (spec/comparison §4, stage2-design §3.2)
  // -------------------------------------------------------------------------

  /** Row-by-row comparison, or null when the structure changed (columns, merged cells). */
  private tablePair(ot: TableBlock, nt: TableBlock): TablePairSegment | null {
    if (ot.gridColumns !== nt.gridColumns) return null;
    const ops = alignRows(ot.rows, nt.rows);
    const layout = (r: TableRow) => r.cells.map((c) => `${c.gridSpan}/${c.vMerge}`).join();
    for (const op of ops) {
      if (op.type === 'pair' && layout(op.o[0]) !== layout(op.n[0])) return null;
      // A row inside a vertical merge cannot be added or removed on its own.
      const row = op.type === 'del' ? op.o : op.type === 'ins' ? op.n : undefined;
      if (row && row.cells.some((c) => c.vMerge !== 'none')) return null;
    }
    const rows: RowSegment[] = [];
    // Adjacent added (or removed) rows form one difference, like paragraphs (decision 14, spec/comparison §2.2 G7).
    let run = null as { kind: 'deleted' | 'inserted'; rows: TableRow[] } | null;
    const flushRun = () => {
      if (run) rows.push({ type: 'diff', diffId: (run.kind === 'deleted' ? this.makeDiff('deleted', run.rows, []) : this.makeDiff('inserted', [], run.rows)).id, part: 'whole' });
      run = null;
    };
    for (const op of ops) {
      if (op.type === 'del' || op.type === 'ins') {
        const kind = op.type === 'del' ? 'deleted' : 'inserted';
        if (run?.kind !== kind) flushRun();
        (run ??= { kind, rows: [] }).rows.push(op.type === 'del' ? op.o : op.n);
        continue;
      }
      flushRun();
      if (op.type === 'equal') rows.push({ type: 'equal', oldRowId: op.o.id, newRowId: op.n.id });
      else if (op.type === 'pair') {
        const [or, nr] = [op.o[0], op.n[0]];
        const cells: CellPair[] = or.cells.map((oc, i) => ({ oldCellId: oc.id, newCellId: nr.cells[i].id, segments: this.cell(oc, nr.cells[i]) }));
        rows.push({ type: 'rowPair', oldRowId: or.id, newRowId: nr.id, cells });
      }
    }
    flushRun();
    return { type: 'tablePair', oldTableId: ot.id, newTableId: nt.id, rows };
  }

  /** A cell with one paragraph on each side is compared directly: a cell-level choice. */
  private cell(oc: TableCell, nc: TableCell): Segment[] {
    const [a, b] = [oc.blocks, nc.blocks];
    if (a.length === 1 && b.length === 1 && isPara(a[0]) && isPara(b[0])) {
      if (blockKey(a[0]) === blockKey(b[0])) {
        const info = optionalDifference(a[0], b[0]);
        if (info) return [{ type: 'diff', diffId: this.changed('modified', a, b, { informational: info }).id, part: 'whole' }];
        return [{ type: 'equal', old: { unit: 'block', ids: [a[0].id] }, new: { unit: 'block', ids: [b[0].id] } }];
      }
      return [{ type: 'diff', diffId: this.changed('modified', a, b).id, part: 'whole' }];
    }
    return this.container(a, b, false);
  }
}

/**
 * Highlights inside a whole-table difference: changed cells of rows that still
 * correspond, and the text of added / removed rows and cells.
 */
function tableHunks(ot: TableBlock, nt: TableBlock): WordHunk[] {
  const hunks: WordHunk[] = [];
  const full = (cells: TableCell[]) => parasIn(cells.flatMap((c) => c.blocks)).filter((p) => !isEmptyPara(p)).map(fullSpan);
  const one = (side: 'old' | 'new', spans: TextSpan[]) => spans.length && hunks.push(side === 'old' ? { old: spans, new: [] } : { old: [], new: spans });
  const cellPair = (oc: TableCell, nc: TableCell) => {
    const [a, b] = [parasIn(oc.blocks), parasIn(nc.blocks)];
    if (a.map(blockKey).join() === b.map(blockKey).join()) return;
    hunks.push(...wordDiff(a, b));
  };
  for (const op of alignRows(ot.rows, nt.rows)) {
    if (op.type === 'del') one('old', full(op.o.cells));
    else if (op.type === 'ins') one('new', full(op.n.cells));
    else if (op.type === 'pair') {
      const [oc, nc] = [op.o[0].cells, op.n[0].cells];
      const ck = (c: TableCell) => c.blocks.map(blockKey).join('\u0003');
      let gapO: TableCell[] = [];
      let gapN: TableCell[] = [];
      const flush = () => {
        // Cells left over after matching identical ones: pair them from the left or from
        // the right, whichever corresponds better (a column added in the middle).
        const k = Math.min(gapO.length, gapN.length);
        const score = (offO: number, offN: number) => {
          let s = 0;
          for (let i = 0; i < k; i++) s += similarity(parasIn(gapO[offO + i].blocks), parasIn(gapN[offN + i].blocks));
          return s;
        };
        const right = score(gapO.length - k, gapN.length - k) >= score(0, 0);
        const offO = right ? gapO.length - k : 0;
        const offN = right ? gapN.length - k : 0;
        gapO.forEach((c, i) => (i >= offO && i < offO + k ? cellPair(c, gapN[offN + i - offO]) : one('old', full([c]))));
        gapN.forEach((c, i) => (i < offN || i >= offN + k) && one('new', full([c])));
        gapO = [];
        gapN = [];
      };
      for (const c of diffKeys(oc.map(ck), nc.map(ck))) {
        if (c.type === 'delete') gapO.push(oc[c.a]);
        else if (c.type === 'insert') gapN.push(nc[c.b]);
        else flush();
      }
      flush();
    }
  }
  return hunks;
}

/** Navigation order: document order of first appearance, including inside tables. */
function orderOf(segments: Segment[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!seen.has(id)) seen.add(id), order.push(id);
  };
  const visit = (segs: Segment[]) => {
    for (const s of segs) {
      if (s.type === 'diff') add(s.diffId);
      else if (s.type === 'tablePair')
        for (const r of s.rows) {
          if (r.type === 'diff') add(r.diffId);
          else if (r.type === 'rowPair') for (const c of r.cells) visit(c.segments);
        }
    }
  };
  visit(segments);
  return order;
}

/** Fields / content controls spanning several blocks or rows, per side (from the reader). */
export interface Groups {
  old: Map<string, string[]>;
  new: Map<string, string[]>;
}

/**
 * "Use old" is not available when a difference covers only part of a field or
 * content control that spans several blocks or rows (spec/export §2): replacing
 * part of it would break the structure.
 */
function applyBoundaries(differences: Record<string, Difference>, groups: Groups) {
  const members = (m: Map<string, string[]>) => {
    const out = new Map<string, Set<string>>();
    for (const [id, gs] of m) for (const g of gs) (out.get(g) ?? out.set(g, new Set()).get(g)!).add(id);
    return out;
  };
  const all = { old: members(groups.old), new: members(groups.new) };
  for (const d of Object.values(differences)) {
    if (d.informational) continue;
    for (const side of ['old', 'new'] as const) {
      const ids = new Set(d[side].ids);
      const broken = [...ids].flatMap((id) => groups[side].get(id) ?? []).find((g) => [...all[side].get(g)!].some((m) => !ids.has(m)));
      if (broken) {
        d.useOld = useOldBlocked(broken.startsWith('field:') ? 'fieldBoundary' : 'contentControlBoundary');
        break;
      }
    }
  }
}

export function compareDocs(o: DocModel, n: DocModel, pendingRevisionsInNew: number, groups?: Groups): DiffResult {
  const c = new Comparer({ newBookmarks: new Set(n.bookmarks ?? []), newNotes: n.notesParts ?? { footnotes: false, endnotes: false } });
  const segments = c.container(o.blocks, n.blocks, true);
  if (groups) applyBoundaries(c.differences, groups);
  const scope = computeScope(o, n, { extraScope: detectedOnlyRows(o, n), pendingRevisionsInNew, sectionHints: sectionHints(o, n, segments, c.differences) });
  // Formatting check (decision 44): only when the reader resolved formatting for both files.
  const checked = !!o.runFormats && !!n.runFormats;
  if (checked) scope.formatting = 'flagged';
  return {
    engineVersion: ENGINE_VERSION,
    old: o,
    new: n,
    segments,
    differences: c.differences,
    order: orderOf(segments),
    sections: c.sections,
    scope,
    formatChanges: checked ? compareFormatting({ segments, differences: c.differences }, o, n) : undefined,
  };
}
