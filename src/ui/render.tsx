// Unified reading-style renderers for blocks, paragraphs and table fragments,
// with word-level highlights taken from the diff model.

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Block, InlinePlaceholder, ParagraphBlock, PlaceholderBlock, Side, TableBlock, TableCell, TableRow } from '../model/document';
import type { DiffResult, Difference, RowSegment, Segment } from '../model/diff';
import { flattenParagraph, type Piece, type PieceWrap } from '../model/flatten';
import type { Choice } from '../model/review';
import { isHidden, type Indexes, type Visibility } from './rows';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ViewCtx {
  result: DiffResult;
  ix: Indexes;
  vis: Visibility;
  choices: Record<string, Choice>;
  currentId?: string;
  onSelectDiff?: (id: string) => void;
}

export const ViewContext = createContext<ViewCtx>(null as unknown as ViewCtx);
export const useView = () => useContext(ViewContext);

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

export interface Hl {
  start: number;
  end: number;
  cls: string;
}

export type HlMap = Map<string, Hl[]>;

export function highlightsFor(d: Difference, side: Side, vis: Visibility): HlMap {
  const m: HlMap = new Map();
  if (isHidden(d, vis)) return m;
  for (const h of d.wordHunks) {
    if (h.category && vis.hiddenCategories.has(h.category)) continue;
    const cls = `${side === 'old' ? 'w-del' : 'w-ins'}${h.category === 'whitespace' ? ' w-ws' : ''}${h.category ? ` w-cat` : ''}`;
    for (const s of h[side]) {
      const list = m.get(s.blockId) ?? [];
      list.push({ start: s.start, end: s.end, cls });
      m.set(s.blockId, list);
    }
  }
  return m;
}

/** CSS classes for one side of a difference: tint, dimming, current. */
export function sideClass(d: Difference, side: Side, ctx: ViewCtx): string {
  if (isHidden(d, ctx.vis)) return '';
  const c: string[] = ['chg', `chg-${side}`, `kind-${d.kind}`];
  if (d.informational) c.push('chg-info');
  const choice = ctx.choices[d.id];
  if (!d.informational && choice && choice !== side) c.push('rejected');
  if (!d.informational && choice === side) c.push('chosen');
  if (ctx.currentId === d.id) c.push('current');
  return c.join(' ');
}

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------

function wsVisible(text: string) {
  return text.replace(/ /g, '·').replace(/ /g, '°').replace(/\t/g, '→').replace(/\n/g, '↵');
}

function PlaceholderChip({ p, mayDiffer }: { p: InlinePlaceholder; mayDiffer?: boolean }) {
  const note = p.kind === 'footnoteRef' || p.kind === 'endnoteRef' ? 'text not compared' : 'not compared';
  const title =
    p.kind === 'footnoteRef' || p.kind === 'endnoteRef'
      ? 'Footnote reference: marker position is compared; footnote text is detected only.'
      : 'Shown, not compared in v1.';
  return (
    <span className={`ph-chip ph-${p.kind}${mayDiffer ? ' may-differ' : ''}`} title={title + (mayDiffer ? ' The two versions may differ — check in Word.' : '')}>
      [{p.label} · {note}]{mayDiffer && <span className="may-badge">may differ</span>}
    </span>
  );
}

function renderPiece(piece: Piece, text: string, key: string, cls: string, mayDiffer?: boolean): ReactNode {
  let node: ReactNode;
  if (piece.kind === 'placeholder') node = <PlaceholderChip key={key} p={piece.placeholder!} mayDiffer={mayDiffer} />;
  else if (piece.kind === 'tab') node = <span key={key} className="tab">{'\t'}</span>;
  else if (piece.kind === 'break') node = <br key={key} />;
  else {
    const shown = cls.includes('w-ws') ? wsVisible(text) : text;
    node = shown;
    const m = piece.marks;
    if (m?.superscript) node = <sup>{node}</sup>;
    if (m?.subscript) node = <sub>{node}</sub>;
    if (m?.hidden)
      node = (
        <span className="hidden-text" title="Hidden text (shown and compared)">
          {node}
        </span>
      );
  }
  if (cls) {
    return (
      <span key={key} className={cls}>
        {node}
      </span>
    );
  }
  return <span key={key}>{node}</span>;
}

function WrapView({ wrap, compareFields, children }: { wrap: PieceWrap; compareFields: boolean; children: ReactNode }) {
  if (wrap.type === 'hyperlink')
    return (
      <span className="hyperlink" title="Hyperlink — display text compared; address detected only">
        {children}
      </span>
    );
  const ref = wrap.fieldType === 'REF' || wrap.fieldType === 'PAGEREF';
  return (
    <span
      className={ref ? 'field field-ref' : `field${compareFields ? '' : ' field-nc'}`}
      title={
        ref
          ? `Cross-reference field (${wrap.instruction}) — the displayed result is compared`
          : `${wrap.fieldType} field — ${compareFields ? 'compared (info only)' : 'shown, not compared. Turn on "Compare fields" in View options.'}`
      }
    >
      {children}
    </span>
  );
}

function placeholderFingerprints(p?: ParagraphBlock) {
  return p ? p.content.filter((i): i is InlinePlaceholder => i.type === 'placeholder').map((i) => i.fingerprint) : [];
}

export function Paragraph({ p, hl, counterpart }: { p: ParagraphBlock; hl?: Hl[]; counterpart?: ParagraphBlock }) {
  const { vis } = useView();
  const { pieces, text } = flattenParagraph(p);
  const other = placeholderFingerprints(counterpart);
  let phIndex = 0;
  const out: ReactNode[] = [];
  const marks = (hl ?? []).filter((h) => h.end > h.start);
  const zero = (hl ?? []).filter((h) => h.end === h.start);
  // Pieces of one hyperlink / field are grouped into a single wrapper.
  const groups: { wrap?: PieceWrap; src: number; nodes: ReactNode[] }[] = [];
  for (const piece of pieces) {
    const nodes: ReactNode[] = [];
    const last = groups.at(-1);
    if (piece.wrap && last?.wrap && last.src === piece.src) last.nodes.push(nodes);
    else groups.push({ wrap: piece.wrap, src: piece.src, nodes: [nodes] });
    const pEnd = piece.start + piece.text.length;
    const cuts = new Set<number>([piece.start, pEnd]);
    for (const h of marks) {
      if (h.start > piece.start && h.start < pEnd) cuts.add(h.start);
      if (h.end > piece.start && h.end < pEnd) cuts.add(h.end);
    }
    const pts = [...cuts].sort((a, b) => a - b);
    let mayDiffer = false;
    if (piece.kind === 'placeholder') {
      const fp = piece.placeholder!.fingerprint;
      const o = other[phIndex++];
      mayDiffer = !!counterpart && !!fp && !!o && fp !== o;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const h = marks.find((x) => x.start <= a && x.end >= b);
      nodes.push(renderPiece(piece, piece.text.slice(a - piece.start, b - piece.start), `${piece.start}:${a}`, h?.cls ?? '', mayDiffer));
    }
  }
  for (const g of groups) out.push(g.wrap ? <WrapView key={`w${g.src}`} wrap={g.wrap} compareFields={vis.compareFields}>{g.nodes}</WrapView> : g.nodes);
  for (const z of zero)
    out.push(
      <span key={`z${z.start}`} className={`${z.cls} para-mark`} title="Paragraph break added or removed here">
        ¶
      </span>,
    );
  const role = p.role;
  const cls =
    role.type === 'title'
      ? 'p-title'
      : role.type === 'heading'
        ? `p-h p-h${Math.min(role.level, 4)}`
        : role.type === 'listItem'
          ? 'p-li'
          : 'p-body';
  const empty = text.length === 0;
  return (
    <div
      className={`para ${cls}${empty ? ' p-empty' : ''}`}
      style={role.type === 'listItem' ? { paddingLeft: `${1.6 + role.level * 1.6}em` } : undefined}
      data-level={role.type === 'heading' ? role.level : undefined}
    >
      {p.numbering && (
        <span className="num-label" title="Automatic numbering — shown, not compared in v1">
          {p.numbering.label}
        </span>
      )}
      {empty ? <span className="empty-mark" title="Empty paragraph">¶ empty paragraph</span> : out}
      {p.sectionBreak && (
        <span className="section-break" title="This paragraph carries a section break. If it is removed, the break moves to the neighbouring paragraph.">
          ⸺ Section break ⸺
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function TocBlock({ b, hl, forceOpen }: { b: PlaceholderBlock; hl?: HlMap; forceOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const isOpen = open || forceOpen;
  return (
    <div className="toc">
      <button className="toc-head" onClick={() => setOpen(!open)} aria-expanded={isOpen}>
        {isOpen ? '▾' : '▸'} {b.label} · {b.children?.length ?? 0} entries · <em>{forceOpen ? 'compared (info only)' : 'not compared'}</em>
      </button>
      {isOpen && (
        <div className="toc-body">
          {b.children?.map((c) => <Paragraph key={c.id} p={c} hl={hl?.get(c.id)} />)}
          <div className="toc-note">Update fields in Word after export to refresh the table of contents.</div>
        </div>
      )}
    </div>
  );
}

export function BlockView({ b, hl, counterpart }: { b: Block; hl?: HlMap; counterpart?: Block }) {
  const { vis } = useView();
  if (b.kind === 'paragraph') return <Paragraph p={b} hl={hl?.get(b.id)} counterpart={counterpart?.kind === 'paragraph' ? counterpart : undefined} />;
  if (b.kind === 'table') return <WholeTable t={b} hl={hl} />;
  if (b.element === 'toc') return <TocBlock b={b} hl={hl} forceOpen={vis.compareToc && !!hl} />;
  const mayDiffer = counterpart?.kind === 'placeholder' && counterpart.fingerprint !== b.fingerprint;
  return (
    <div className={`ph-block${mayDiffer ? ' may-differ' : ''}`}>
      [{b.label} · not compared]{mayDiffer && <span className="may-badge">may differ</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function Colgroup({ t }: { t: TableBlock }) {
  const w = t.columnWidths ?? Array(t.gridColumns).fill(1);
  const total = w.reduce((a, b) => a + b, 0);
  return (
    <colgroup>
      {w.map((x, i) => (
        <col key={i} style={{ width: `${(100 * x) / total}%` }} />
      ))}
    </colgroup>
  );
}

function cellClass(c: TableCell, header?: boolean) {
  return `${header ? 'th' : ''} vm-${c.vMerge}`;
}

/** A whole table rendered at once (inside a whole-table difference, or nested in a cell). */
export function WholeTable({ t, hl }: { t: TableBlock; hl?: HlMap }) {
  return (
    <table className="doc-table">
      <Colgroup t={t} />
      <tbody>
        {t.rows.map((r) => (
          <tr key={r.id}>
            {r.cells.map((c) => (
              <td key={c.id} colSpan={c.gridSpan} className={cellClass(c, r.isHeader)}>
                {c.vMerge === 'continue' ? null : c.blocks.map((b) => <BlockView key={b.id} b={b} hl={hl} />)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One or more rows of a top-level table, rendered as a fragment that lines up with its neighbours. */
export function TableFragment({
  t,
  rows,
  first,
  cellContent,
  className,
}: {
  t: TableBlock;
  rows: TableRow[];
  first: boolean;
  cellContent: (row: TableRow, cell: TableCell, ci: number) => ReactNode;
  className?: string;
}) {
  return (
    <table className={`doc-table frag${first ? ' frag-first' : ''}${className ? ` ${className}` : ''}`}>
      <Colgroup t={t} />
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {r.cells.map((c, ci) => (
              <td key={c.id} colSpan={c.gridSpan} className={cellClass(c, r.isHeader)}>
                {c.vMerge === 'continue' ? null : cellContent(r, c, ci)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Segments rendered for ONE side (cell contents, nested tables)
// ---------------------------------------------------------------------------

export function SideSegments({ segs, side }: { segs: Segment[]; side: Side }) {
  const ctx = useView();
  const { result, ix } = ctx;
  return (
    <>
      {segs.map((s, i) => {
        if (s.type === 'equal') return s[side].ids.map((id) => <BlockView key={id} b={ix[side].block(id)} />);
        if (s.type === 'diff') {
          const d = result.differences[s.diffId];
          const ids = (s.part === 'to' && side === 'old') || (s.part === 'from' && side === 'new') ? [] : d[side].ids;
          if (ids.length === 0) return null;
          const hl = highlightsFor(d, side, ctx.vis);
          return (
            <div
              key={`${d.id}-${i}`}
              className={`cell-chg ${sideClass(d, side, ctx)}`}
              onClick={(e) => {
                e.stopPropagation();
                ctx.onSelectDiff?.(d.id);
              }}
            >
              {ids.map((id) => (
                <BlockView key={id} b={ix[side].block(id)} hl={hl} />
              ))}
            </div>
          );
        }
        return <SideTablePair key={i} seg={s} side={side} />;
      })}
    </>
  );
}

function SideTablePair({ seg, side }: { seg: Extract<Segment, { type: 'tablePair' }>; side: Side }) {
  const ctx = useView();
  const t = ctx.ix[side].table(side === 'old' ? seg.oldTableId : seg.newTableId);
  return (
    <table className="doc-table">
      <Colgroup t={t} />
      <tbody>
        {seg.rows.map((r, i) => (
          <SideRow key={i} r={r} side={side} />
        ))}
      </tbody>
    </table>
  );
}

function SideRow({ r, side }: { r: RowSegment; side: Side }) {
  const ctx = useView();
  const { ix, result } = ctx;
  if (r.type === 'diff') {
    const d = result.differences[r.diffId];
    return (
      <>
        {d[side].ids.map((id) => {
          const row = ix[side].row(id).row;
          return (
            <tr key={id} className={sideClass(d, side, ctx)}>
              {row.cells.map((c) => (
                <td key={c.id} colSpan={c.gridSpan} className={cellClass(c, row.isHeader)}>
                  {c.blocks.map((b) => (
                    <BlockView key={b.id} b={b} />
                  ))}
                </td>
              ))}
            </tr>
          );
        })}
      </>
    );
  }
  const row = ix[side].row(side === 'old' ? r.oldRowId : r.newRowId).row;
  return (
    <tr>
      {row.cells.map((c, ci) => (
        <td key={c.id} colSpan={c.gridSpan} className={cellClass(c, row.isHeader)}>
          {r.type === 'rowPair' ? <SideSegments segs={r.cells[ci].segments} side={side} /> : c.blocks.map((b) => <BlockView key={b.id} b={b} />)}
        </td>
      ))}
    </tr>
  );
}
