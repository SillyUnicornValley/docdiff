// Mock builder: describe a document pair as an aligned sequence of
// "same / changed" items and get back exactly the DiffResult shape the real
// engine will produce. Block ids, numbering labels, word hunks, "Use old"
// availability, sections and check-scope counts are derived here.

import type {
  Block,
  BlockPlaceholderKind,
  DocModel,
  FieldType,
  FingerprintedPart,
  Inline,
  InlinePlaceholder,
  InlinePlaceholderKind,
  ParagraphBlock,
  ParagraphRole,
  RevisionInfo,
  RunMarks,
  Side,
  TableBlock,
  TableCell,
  TableRow,
  TextInline,
  VMerge,
} from '../model/document';
import type {
  CellPair,
  CheckScope,
  DiffKind,
  DiffResult,
  Difference,
  FingerprintHint,
  OptionalComparison,
  RowSegment,
  ScopeItem,
  Section,
  Segment,
  UseOldAvailability,
  UseOldBlockReason,
  WordHunk,
} from '../model/diff';
import { forEachBlock, forEachParagraph } from '../model/docIndex';
import { fullSpan, wordDiff, type WordDiffOptions } from './wordDiff';

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

export type InlineSpec = string | Inline;

export const t = (text: string, marks?: RunMarks): TextInline => (marks ? { type: 'text', text, marks } : { type: 'text', text });
export const sup = (text: string) => t(text, { superscript: true });
export const sub = (text: string) => t(text, { subscript: true });
export const hidden = (text: string) => t(text, { hidden: true });
export const tab: Inline = { type: 'tab' };
export const br: Inline = { type: 'break' };
export const ph = (kind: InlinePlaceholderKind, label: string, fingerprint?: string): InlinePlaceholder => ({
  type: 'placeholder',
  kind,
  label,
  fingerprint,
});
export const fn = (n: number, fingerprint?: string) => ph('footnoteRef', `Footnote ${n}`, fingerprint);
export const img = (label: string, fingerprint?: string) => ph('image', label, fingerprint);
export const link = (text: string, url: string): Inline => ({ type: 'hyperlink', content: [t(text)], urlFingerprint: hash(url) });
export const field = (fieldType: FieldType, instruction: string, result: string): Inline => ({
  type: 'field',
  fieldType,
  instruction,
  result: [t(result)],
});

export function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Block specs (side-agnostic; ids and numbering are assigned per side)
// ---------------------------------------------------------------------------

export interface ListDef {
  /** Per level: 'bullet' or a label pattern: '1.' | 'a)' | 'i.' | '1)' */
  levels: ('bullet' | '1.' | 'a)' | 'a.' | 'i.' | '1)')[];
}

export interface ParaSpec {
  k: 'p';
  role: ParagraphRole;
  content: Inline[];
  list?: { listId: string; level: number };
  sectionBreak?: boolean;
}

export type CellSpec =
  | string
  | { text?: string; content?: InlineSpec[]; blocks?: Spec[]; span?: number; vmerge?: VMerge; nested?: (c: Container) => void };

export interface RowSpec {
  cells: CellSpec[];
  header?: boolean;
}

export interface TableSpec {
  k: 'table';
  widths: number[];
  rows: RowSpec[];
}

export interface PlaceholderSpec {
  k: 'ph';
  element: BlockPlaceholderKind;
  label: string;
  fingerprint?: string;
  children?: ParaSpec[];
}

export type Spec = ParaSpec | TableSpec | PlaceholderSpec;

const inl = (c: InlineSpec | InlineSpec[]): Inline[] =>
  (Array.isArray(c) ? c : [c]).map((x) => (typeof x === 'string' ? t(x) : x));

export const P = (c: InlineSpec | InlineSpec[], opts: { sectionBreak?: boolean } = {}): ParaSpec => ({
  k: 'p',
  role: { type: 'body' },
  content: inl(c),
  ...opts,
});
export const Title = (c: InlineSpec | InlineSpec[]): ParaSpec => ({ k: 'p', role: { type: 'title' }, content: inl(c) });
export const H = (level: number, c: InlineSpec | InlineSpec[], numbered?: string): ParaSpec => ({
  k: 'p',
  role: { type: 'heading', level },
  content: inl(c),
  list: numbered ? { listId: numbered, level: level - 1 } : undefined,
});
export const LI = (listId: string, level: number, c: InlineSpec | InlineSpec[]): ParaSpec => ({
  k: 'p',
  role: { type: 'listItem', level },
  content: inl(c),
  list: { listId, level },
});
export const Empty = (): ParaSpec => P([]);
export const Table = (widths: number[], rows: (CellSpec[] | RowSpec)[], header = true): TableSpec => ({
  k: 'table',
  widths,
  rows: rows.map((r, i) => (Array.isArray(r) ? { cells: r, header: header && i === 0 } : r)),
});
export const Placeholder = (element: BlockPlaceholderKind, label: string, fingerprint?: string, children?: ParaSpec[]): PlaceholderSpec => ({
  k: 'ph',
  element,
  label,
  fingerprint,
  children,
});

// ---------------------------------------------------------------------------
// Per-side materialisation
// ---------------------------------------------------------------------------

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];

class SideState {
  private n = 0;
  private counters = new Map<string, number[]>();
  constructor(
    public side: Side,
    private lists: Record<string, ListDef>,
  ) {}

  id(prefix = '') {
    return `${this.side === 'old' ? 'o' : 'n'}${prefix}${++this.n}`;
  }

  private label(listId: string, level: number): { label: string; format: 'bullet' | 'number' } {
    const def = this.lists[listId] ?? { levels: ['1.'] };
    const pat = def.levels[Math.min(level, def.levels.length - 1)];
    const c = this.counters.get(listId) ?? [];
    c[level] = (c[level] ?? 0) + 1;
    c.length = level + 1;
    this.counters.set(listId, c);
    const n = c[level];
    switch (pat) {
      case 'bullet':
        return { label: level % 2 === 0 ? '•' : '◦', format: 'bullet' };
      case '1.':
        return { label: `${n}.`, format: 'number' };
      case '1)':
        return { label: `${n})`, format: 'number' };
      case 'a)':
        return { label: `${String.fromCharCode(96 + n)})`, format: 'number' };
      case 'a.':
        return { label: `${String.fromCharCode(96 + n)}.`, format: 'number' };
      case 'i.':
        return { label: `${ROMAN[n - 1] ?? n}.`, format: 'number' };
    }
  }

  para(s: ParaSpec): ParagraphBlock {
    const p: ParagraphBlock = { kind: 'paragraph', id: this.id(), role: s.role, content: s.content.map((x) => ({ ...x })) as Inline[] };
    if (s.list) p.numbering = { listId: s.list.listId, level: s.list.level, ...this.label(s.list.listId, s.list.level) };
    if (s.sectionBreak) p.sectionBreak = true;
    return p;
  }

  cell(c: CellSpec): TableCell {
    const spec = typeof c === 'string' ? { text: c } : c;
    let blocks: Block[];
    if (spec.blocks) blocks = spec.blocks.map((b) => this.block(b));
    else if (spec.content) blocks = [this.para(P(spec.content))];
    else blocks = [this.para(P(spec.text ?? ''))];
    return { id: this.id('c'), gridSpan: spec.span ?? 1, vMerge: spec.vmerge ?? 'none', blocks };
  }

  row(r: RowSpec): TableRow {
    return { id: this.id('r'), cells: r.cells.map((c) => this.cell(c)), isHeader: r.header || undefined };
  }

  table(s: TableSpec): TableBlock {
    return { kind: 'table', id: this.id('t'), gridColumns: s.widths.length, columnWidths: s.widths, rows: s.rows.map((r) => this.row(r)) };
  }

  block(s: Spec): Block {
    if (s.k === 'p') return this.para(s);
    if (s.k === 'table') return this.table(s);
    return {
      kind: 'placeholder',
      id: this.id(),
      element: s.element,
      label: s.label,
      fingerprint: s.fingerprint,
      children: s.children?.map((c) => this.para(c)),
    };
  }
}

// ---------------------------------------------------------------------------
// "Use old" availability (spec §7.5)
// ---------------------------------------------------------------------------

const USE_OLD_MESSAGES: Record<UseOldBlockReason, string> = {
  footnote: 'Contains a footnote reference.',
  endnote: 'Contains an endnote reference.',
  image: 'Contains an image or drawing.',
  hyperlink: 'Contains a hyperlink.',
  field: 'Contains a field (cross-reference, date, page number…).',
  textBox: 'Contains a text box.',
  object: 'Contains an embedded object or equation.',
  fieldBoundary: 'A field starts or ends outside this difference.',
  contentControlBoundary: 'A content control starts or ends outside this difference.',
};

export function useOldBlocked(reason: UseOldBlockReason): UseOldAvailability {
  return {
    available: false,
    reason,
    message: `${USE_OLD_MESSAGES[reason]} "Use old" is not available in v1 — export, then make this change in Word.`,
  };
}

function computeUseOld(blocks: Block[]): UseOldAvailability {
  let reason: UseOldBlockReason | undefined;
  const ph: Partial<Record<InlinePlaceholderKind, UseOldBlockReason>> = {
    footnoteRef: 'footnote',
    endnoteRef: 'endnote',
    image: 'image',
    chart: 'image',
    shape: 'image',
    textBox: 'textBox',
    equation: 'object',
    object: 'object',
  };
  forEachBlock(blocks, (b) => {
    if (reason) return;
    if (b.kind === 'placeholder' && b.element !== 'toc') reason = b.element === 'textBox' ? 'textBox' : b.element === 'equation' || b.element === 'object' ? 'object' : 'image';
    if (b.kind !== 'paragraph') return;
    for (const i of b.content) {
      if (i.type === 'hyperlink') reason ??= 'hyperlink';
      else if (i.type === 'field') reason ??= 'field';
      else if (i.type === 'placeholder' && ph[i.kind]) reason ??= ph[i.kind];
    }
  });
  return reason ? useOldBlocked(reason) : { available: true };
}

// ---------------------------------------------------------------------------
// Container builder (body, or one cell pair)
// ---------------------------------------------------------------------------

interface ChangeOpts extends WordDiffOptions {
  informational?: OptionalComparison;
  useOld?: UseOldAvailability;
  summary?: string;
  /** Extra hunks (e.g. highlighted cells inside a whole-table difference). */
  hunks?: WordHunk[];
}

interface Member {
  kind: DiffKind;
  old: Block[];
  new: Block[];
  hunks: WordHunk[];
}

const paras = (bs: Block[]) => bs.filter((b): b is ParagraphBlock => b.kind === 'paragraph');
const isEmptyPara = (b: Block) => b.kind === 'paragraph' && b.content.every((i) => i.type === 'text' && i.text === '');

export class Container {
  segments: Segment[] = [];
  oldBlocks: Block[] = [];
  newBlocks: Block[] = [];
  private group: Member[] | null = null;
  private moves = new Map<string, { diffId: string; old?: Block[]; new?: Block[] }>();

  constructor(
    protected pair: PairBuilder,
    private top = false,
  ) {}

  /** Materialise specs on one side. Sections follow new-side headings, or old-side ones that were deleted. */
  private mat(side: Side, specs: Spec[], noteOld = false) {
    const st = side === 'old' ? this.pair.oldSide : this.pair.newSide;
    const blocks = specs.map((s) => st.block(s));
    (side === 'old' ? this.oldBlocks : this.newBlocks).push(...blocks);
    if (this.top && (side === 'new' || noteOld)) for (const b of blocks) this.pair.noteSection(b);
    return blocks;
  }

  /** Identical content on both sides. */
  same(...specs: Spec[]) {
    for (const s of specs) {
      // New side first so sections are keyed on the new document.
      const n = this.mat('new', [s]);
      const o = this.mat('old', [s]);
      const last = this.segments.at(-1);
      if (last?.type === 'equal') {
        last.old.ids.push(o[0].id);
        last.new.ids.push(n[0].id);
      } else this.segments.push({ type: 'equal', old: { unit: 'block', ids: [o[0].id] }, new: { unit: 'block', ids: [n[0].id] } });
    }
    return this;
  }

  private change(kind: DiffKind, oldSpecs: Spec[], newSpecs: Spec[], opts: ChangeOpts = {}) {
    const n = this.mat('new', newSpecs);
    const o = this.mat('old', oldSpecs, newSpecs.length === 0);
    let hunks: WordHunk[] = opts.hunks ?? [];
    if ((kind === 'modified' || kind === 'splitJoin') && !opts.hunks) hunks = wordDiff(paras(o), paras(n), opts);
    if (this.group && !opts.informational) {
      this.group.push({ kind, old: o, new: n, hunks });
      return;
    }
    const id = this.pair.addDiff({ kind, old: o, new: n, hunks, unit: 'block', ...opts });
    this.segments.push({ type: 'diff', diffId: id, part: 'whole' });
    return id;
  }

  modified(oldSpec: Spec | Spec[], newSpec: Spec | Spec[], opts?: ChangeOpts) {
    this.change('modified', ([] as Spec[]).concat(oldSpec), ([] as Spec[]).concat(newSpec), opts);
    return this;
  }
  inserted(...specs: Spec[]) {
    this.change('inserted', [], specs);
    return this;
  }
  deleted(...specs: Spec[]) {
    this.change('deleted', specs, []);
    return this;
  }
  splitJoin(oldSpecs: Spec[], newSpecs: Spec[], opts?: ChangeOpts) {
    this.change('splitJoin', oldSpecs, newSpecs, opts);
    return this;
  }
  replaced(oldSpecs: Spec[], newSpecs: Spec[], opts?: ChangeOpts) {
    this.change('replaced', oldSpecs, newSpecs, opts);
    return this;
  }
  /** Informational difference from an optional comparison (TOC, fields): shown only, no choice. */
  info(source: OptionalComparison, oldSpec: Spec, newSpec: Spec) {
    this.change('modified', [oldSpec], [newSpec], { informational: source });
    return this;
  }

  /**
   * Whole-table difference (column / merged-cell change). `cellChanges` lists
   * cell texts to highlight: [old, new] pairs are word-diffed; null on one side
   * highlights the other side's cell completely.
   */
  tableStructure(oldT: TableSpec, newT: TableSpec, cellChanges: [string | null, string | null][] = [], opts: ChangeOpts = {}) {
    const n = this.mat('new', [newT]);
    const o = this.mat('old', [oldT]);
    const find = (bs: Block[], text: string) => {
      let hit: ParagraphBlock | undefined;
      forEachParagraph(bs, (p) => {
        if (!hit && p.content.map((i) => (i.type === 'text' ? i.text : '')).join('') === text) hit = p;
      });
      if (!hit) throw new Error(`Cell text not found: ${text}`);
      return hit;
    };
    const hunks: WordHunk[] = [];
    for (const [a, b] of cellChanges) {
      if (a !== null && b !== null) hunks.push(...wordDiff([find(o, a)], [find(n, b)]));
      else if (a !== null) hunks.push({ old: [fullSpan(find(o, a))], new: [] });
      else if (b !== null) hunks.push({ old: [], new: [fullSpan(find(n, b))] });
    }
    const id = this.pair.addDiff({ kind: 'tableStructure', old: o, new: n, hunks, unit: 'block', ...opts });
    this.segments.push({ type: 'diff', diffId: id, part: 'whole' });
    return this;
  }

  /** Consecutive changes inside `fn` become ONE difference (spec §7.2). */
  grouped(fn: (c: this) => void, opts: Omit<ChangeOpts, 'hunks'> = {}) {
    const sectionId = this.pair.currentSection;
    this.group = [];
    fn(this);
    const members = this.group;
    this.group = null;
    if (members.length === 0) return this;
    const kinds = new Set(members.map((m) => m.kind));
    const kind: DiffKind = kinds.size === 1 ? members[0].kind : 'modified';
    const id = this.pair.addDiff({
      kind,
      old: members.flatMap((m) => m.old),
      new: members.flatMap((m) => m.new),
      hunks: members.flatMap((m) => m.hunks),
      unit: 'block',
      sectionId,
      ...opts,
    });
    this.segments.push({ type: 'diff', diffId: id, part: 'whole' });
    return this;
  }

  /** Original location of moved content. moveFrom/moveTo may come in either order. */
  moveFrom(key: string, ...specs: Spec[]) {
    const o = this.mat('old', specs);
    this.segments.push({ type: 'diff', diffId: this.moveHalf(key, { old: o }), part: 'from' });
    return this;
  }

  /** New location of moved content. */
  moveTo(key: string, ...specs: Spec[]) {
    const n = this.mat('new', specs);
    this.segments.push({ type: 'diff', diffId: this.moveHalf(key, { new: n }), part: 'to' });
    return this;
  }

  private moveHalf(key: string, half: { old?: Block[]; new?: Block[] }): string {
    const m = this.moves.get(key);
    if (!m) {
      const id = this.pair.reserveDiffId();
      this.moves.set(key, { diffId: id, ...half });
      return id;
    }
    this.moves.delete(key);
    const o = half.old ?? m.old!;
    const n = half.new ?? m.new!;
    const hunks = wordDiff(paras(o), paras(n));
    this.pair.addDiff({ kind: 'moved', old: o, new: n, hunks, unit: 'block', id: m.diffId, similarity: hunks.length ? 0.9 : 1 });
    return m.diffId;
  }

  /** Same text, different structure (heading level, list type…): NOT a content difference. */
  sameContent(oldSpec: Spec, newSpec: Spec) {
    const n = this.mat('new', [newSpec]);
    const o = this.mat('old', [oldSpec]);
    const last = this.segments.at(-1);
    if (last?.type === 'equal') {
      last.old.ids.push(o[0].id);
      last.new.ids.push(n[0].id);
    } else this.segments.push({ type: 'equal', old: { unit: 'block', ids: [o[0].id] }, new: { unit: 'block', ids: [n[0].id] } });
    return this;
  }

  /** Two tables aligned row by row. */
  tablePair(widths: number[], fn: (rows: RowBuilder) => void, newWidths = widths) {
    const ot: TableBlock = { kind: 'table', id: this.pair.oldSide.id('t'), gridColumns: widths.length, columnWidths: widths, rows: [] };
    const nt: TableBlock = { kind: 'table', id: this.pair.newSide.id('t'), gridColumns: newWidths.length, columnWidths: newWidths, rows: [] };
    this.oldBlocks.push(ot);
    this.newBlocks.push(nt);
    const rb = new RowBuilder(this.pair, ot, nt);
    fn(rb);
    this.segments.push({ type: 'tablePair', oldTableId: ot.id, newTableId: nt.id, rows: rb.segments });
    return this;
  }
}

export class RowBuilder {
  segments: RowSegment[] = [];
  constructor(
    private pb: PairBuilder,
    private ot: TableBlock,
    private nt: TableBlock,
  ) {}

  private spec(r: CellSpec[] | RowSpec): RowSpec {
    return Array.isArray(r) ? { cells: r } : r;
  }

  same(r: CellSpec[] | RowSpec) {
    const s = this.spec(r);
    const n = this.pb.newSide.row(s);
    const o = this.pb.oldSide.row(s);
    this.nt.rows.push(n);
    this.ot.rows.push(o);
    this.segments.push({ type: 'equal', oldRowId: o.id, newRowId: n.id });
    return this;
  }

  inserted(r: CellSpec[] | RowSpec) {
    const n = this.pb.newSide.row(this.spec(r));
    this.nt.rows.push(n);
    const id = this.pb.addDiff({ kind: 'inserted', old: [], new: [n], hunks: [], unit: 'row' });
    this.segments.push({ type: 'diff', diffId: id, part: 'whole' });
    return this;
  }

  deleted(r: CellSpec[] | RowSpec) {
    const o = this.pb.oldSide.row(this.spec(r));
    this.ot.rows.push(o);
    const id = this.pb.addDiff({ kind: 'deleted', old: [o], new: [], hunks: [], unit: 'row' });
    this.segments.push({ type: 'diff', diffId: id, part: 'whole' });
    return this;
  }

  /** Row pair: cells matched by position; differing cells become cell-level differences. */
  pair(oldR: CellSpec[] | RowSpec, newR: CellSpec[] | RowSpec) {
    const os = this.spec(oldR);
    const ns = this.spec(newR);
    const oRow: TableRow = { id: this.pb.oldSide.id('r'), cells: [], isHeader: os.header || undefined };
    const nRow: TableRow = { id: this.pb.newSide.id('r'), cells: [], isHeader: ns.header || undefined };
    const cells: CellPair[] = [];
    os.cells.forEach((oc, i) => {
      const nc = ns.cells[i];
      const ospec = typeof oc === 'string' ? { text: oc } : oc;
      const nspec = typeof nc === 'string' ? { text: nc } : nc;
      const c = new Container(this.pb);
      if (nspec.nested) nspec.nested(c);
      else if ((ospec.text ?? '') === (nspec.text ?? '') && !ospec.blocks && !nspec.blocks) c.same(P(nspec.text ?? ''));
      else c.modified(ospec.blocks ?? P(ospec.text ?? ''), nspec.blocks ?? P(nspec.text ?? ''));
      const oCell: TableCell = { id: this.pb.oldSide.id('c'), gridSpan: ospec.span ?? 1, vMerge: ospec.vmerge ?? 'none', blocks: c.oldBlocks };
      const nCell: TableCell = { id: this.pb.newSide.id('c'), gridSpan: nspec.span ?? 1, vMerge: nspec.vmerge ?? 'none', blocks: c.newBlocks };
      oRow.cells.push(oCell);
      nRow.cells.push(nCell);
      cells.push({ oldCellId: oCell.id, newCellId: nCell.id, segments: c.segments });
    });
    this.ot.rows.push(oRow);
    this.nt.rows.push(nRow);
    this.segments.push({ type: 'rowPair', oldRowId: oRow.id, newRowId: nRow.id, cells });
    return this;
  }
}

// ---------------------------------------------------------------------------
// Pair builder (top level)
// ---------------------------------------------------------------------------

export interface PairMeta {
  oldName: string;
  newName: string;
  lists?: Record<string, ListDef>;
  oldParts?: Partial<Record<FingerprintedPart, string>>;
  newParts?: Partial<Record<FingerprintedPart, string>>;
  oldRevisions?: RevisionInfo;
  newRevisions?: RevisionInfo;
  oldComments?: number;
  newComments?: number;
  pendingRevisionsInNew?: number;
  /** Extra scope rows (e.g. "Headers and footers") appended after the computed ones. */
  extraScope?: ScopeItem[];
}

interface AddDiff {
  kind: DiffKind;
  old: (Block | TableRow)[];
  new: (Block | TableRow)[];
  hunks: WordHunk[];
  unit: 'block' | 'row';
  id?: string;
  similarity?: number;
  informational?: OptionalComparison;
  useOld?: UseOldAvailability;
  summary?: string;
  sectionId?: string;
}

const PART_LABEL: Record<FingerprintedPart, string> = {
  header: 'Headers',
  footer: 'Footers',
  footnotes: 'Footnote text',
  endnotes: 'Endnote text',
  images: 'Images',
  hyperlinkUrls: 'Hyperlink addresses',
  textBoxes: 'Text boxes',
  properties: 'Document properties',
};

export class PairBuilder extends Container {
  oldSide: SideState;
  newSide: SideState;
  private diffs: Record<string, Difference> = {};
  private diffN = 0;
  private sections: Section[] = [];
  currentSection = 'start';

  constructor(private meta: PairMeta) {
    super(null as unknown as PairBuilder, true);
    this.pair = this;
    this.oldSide = new SideState('old', meta.lists ?? {});
    this.newSide = new SideState('new', meta.lists ?? {});
    this.sections.push({ id: 'start', title: '(Start of document)', level: 0 });
  }

  reserveDiffId() {
    return `d${++this.diffN}`;
  }

  noteSection(b: Block) {
    if (b.kind === 'paragraph' && b.role.type === 'heading' && b.role.level === 1) {
      this.currentSection = b.id;
      this.sections.push({ id: b.id, title: textOf(b), level: 1 });
    }
  }

  addDiff(a: AddDiff): string {
    const id = a.id ?? this.reserveDiffId();
    const blocks = [...a.old, ...a.new].flatMap((x) => ('kind' in x ? [x] : x.cells.flatMap((c) => c.blocks)));
    let category = commonCategory(a.hunks);
    const allEmpty = (xs: (Block | TableRow)[]) => xs.length > 0 && xs.every((x) => 'kind' in x && isEmptyPara(x));
    if ((a.kind === 'inserted' && allEmpty(a.new)) || (a.kind === 'deleted' && allEmpty(a.old))) category = 'emptyParagraph';
    if (a.kind !== 'modified' && a.kind !== 'splitJoin' && a.kind !== 'moved' && category !== 'emptyParagraph') category = undefined;
    const d: Difference = {
      id,
      kind: a.kind,
      old: { unit: a.unit, ids: a.old.map((x) => x.id) },
      new: { unit: a.unit, ids: a.new.map((x) => x.id) },
      wordHunks: a.hunks,
      useOld: a.useOld ?? computeUseOld(blocks),
      sectionId: a.sectionId ?? this.currentSection,
    };
    if (category) d.category = category;
    if (a.informational) d.informational = a.informational;
    if (a.similarity !== undefined) d.similarity = a.similarity;
    if (a.summary) d.summary = a.summary;
    this.diffs[id] = d;
    return id;
  }

  build(): DiffResult {
    const m = this.meta;
    const doc = (side: Side, blocks: Block[]): DocModel => ({
      side,
      fileName: side === 'old' ? m.oldName : m.newName,
      fingerprint: hash(`${side === 'old' ? m.oldName : m.newName}:${blocks.length}:${JSON.stringify(blocks).length}`),
      sizeBytes: 2000 + JSON.stringify(blocks).length,
      blocks,
      partFingerprints: (side === 'old' ? m.oldParts : m.newParts) ?? {},
      revisions: (side === 'old' ? m.oldRevisions : m.newRevisions) ?? { accepted: [], unsupported: [] },
      commentCount: (side === 'old' ? m.oldComments : m.newComments) ?? 0,
    });
    const oldDoc = doc('old', this.oldBlocks);
    const newDoc = doc('new', this.newBlocks);

    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (segs: Segment[]) => {
      for (const s of segs) {
        if (s.type === 'diff') {
          if (!seen.has(s.diffId)) seen.add(s.diffId), order.push(s.diffId);
        } else if (s.type === 'tablePair') {
          for (const r of s.rows) {
            if (r.type === 'diff') {
              if (!seen.has(r.diffId)) seen.add(r.diffId), order.push(r.diffId);
            } else if (r.type === 'rowPair') for (const c of r.cells) visit(c.segments);
          }
        }
      }
    };
    visit(this.segments);

    return {
      engineVersion: 'mock-1',
      old: oldDoc,
      new: newDoc,
      segments: this.segments,
      differences: this.diffs,
      order,
      sections: this.sections,
      scope: this.scope(oldDoc, newDoc),
    };
  }

  private scope(o: DocModel, n: DocModel): CheckScope {
    const count = (d: DocModel) => {
      const c = {
        paragraphs: 0,
        listItems: 0,
        autoNumbers: 0,
        tables: 0,
        rows: 0,
        cells: 0,
        sup: 0,
        hiddenRuns: 0,
        footnoteRefs: 0,
        images: 0,
        fields: 0,
        crossRefs: 0,
        hyperlinks: 0,
        toc: 0,
        textBoxes: 0,
        equations: 0,
      };
      forEachBlock(d.blocks, (b) => {
        if (b.kind === 'table') {
          c.tables++;
          c.rows += b.rows.length;
          c.cells += b.rows.reduce((k, r) => k + r.cells.length, 0);
        } else if (b.kind === 'placeholder') {
          if (b.element === 'toc') c.toc++;
          else if (b.element === 'textBox') c.textBoxes++;
          else if (b.element === 'equation') c.equations++;
          else c.images++;
        } else {
          c.paragraphs++;
          if (b.role.type === 'listItem') c.listItems++;
          if (b.numbering) c.autoNumbers++;
          for (const i of b.content) {
            if (i.type === 'text' && (i.marks?.superscript || i.marks?.subscript)) c.sup++;
            if (i.type === 'text' && i.marks?.hidden) c.hiddenRuns++;
            if (i.type === 'hyperlink') c.hyperlinks++;
            if (i.type === 'field') i.fieldType === 'REF' ? c.crossRefs++ : c.fields++;
            if (i.type === 'placeholder') {
              if (i.kind === 'footnoteRef' || i.kind === 'endnoteRef') c.footnoteRefs++;
              else if (i.kind === 'textBox') c.textBoxes++;
              else if (i.kind === 'equation') c.equations++;
              else if (i.kind !== 'commentAnchor') c.images++;
            }
          }
        }
      });
      return c;
    };
    const a = count(o);
    const b = count(n);
    const rows: [string, ScopeItem['status'], keyof typeof a][] = [
      ['Paragraphs (body text and headings)', 'compared', 'paragraphs'],
      ['List items (text)', 'compared', 'listItems'],
      ['Tables', 'compared', 'tables'],
      ['Table rows', 'compared', 'rows'],
      ['Superscript / subscript runs', 'compared', 'sup'],
      ['Hidden text runs', 'compared', 'hiddenRuns'],
      ['Footnote / endnote references (position)', 'compared', 'footnoteRefs'],
      ['Cross-references (displayed result)', 'compared', 'crossRefs'],
      ['Hyperlinks (display text)', 'compared', 'hyperlinks'],
      ['List numbers and bullets (automatic)', 'shownNotCompared', 'autoNumbers'],
      ['Table of contents', 'shownNotCompared', 'toc'],
      ['Date, page and other fields', 'shownNotCompared', 'fields'],
      ['Images, charts, shapes', 'shownNotCompared', 'images'],
      ['Text boxes', 'shownNotCompared', 'textBoxes'],
      ['Equations', 'shownNotCompared', 'equations'],
    ];
    const items: ScopeItem[] = rows
      .filter(([, , k]) => a[k] + b[k] > 0 || k === 'paragraphs')
      .map(([element, status, k]) => ({ element, status, oldCount: a[k], newCount: b[k] }));
    items.push({ element: 'Comments', status: 'notSupported', oldCount: o.commentCount, newCount: n.commentCount });
    items.push(...(this.meta.extraScope ?? []));

    const parts = new Set<FingerprintedPart>([
      ...(Object.keys(o.partFingerprints) as FingerprintedPart[]),
      ...(Object.keys(n.partFingerprints) as FingerprintedPart[]),
    ]);
    const fingerprints: FingerprintHint[] = [...parts].map((p) => {
      const x = o.partFingerprints[p];
      const y = n.partFingerprints[p];
      if (!x && !y) return { part: p, result: 'absent' };
      if (x === y) return { part: p, result: 'same', message: `${PART_LABEL[p]}: same in both files.` };
      return { part: p, result: 'mayDiffer', message: `${PART_LABEL[p]} may differ — not compared item by item. Check in Word.` };
    });

    return {
      items,
      fingerprints,
      formatting: 'notChecked',
      unsupportedRevisions: [
        ...o.revisions.unsupported.map((u) => ({ side: 'old' as const, type: u.type, location: u.location })),
        ...n.revisions.unsupported.map((u) => ({ side: 'new' as const, type: u.type, location: u.location })),
      ],
      pendingRevisionsInNew: this.meta.pendingRevisionsInNew ?? 0,
    };
  }
}

function textOf(p: ParagraphBlock) {
  return p.content.map((i) => (i.type === 'text' ? i.text : '')).join('');
}

function commonCategory(hunks: WordHunk[]) {
  if (hunks.length === 0) return undefined;
  const c = hunks[0].category;
  return c && hunks.every((h) => h.category === c) ? c : undefined;
}
