// Final result rendering: each row's chosen side, without diff highlights.
// Content taken from the OLD file is marked so the reader sees what "Use old" brought back.

import type { ReactNode } from 'react';
import type { RowSegment, Segment } from '../model/diff';
import { effectiveChoice, partOutput } from '../model/final';
import { BlockView, TableFragment, useView } from './render';
import type { Row } from './rows';

function FromOld({ children, id }: { children: ReactNode; id: string }) {
  return (
    <div className="from-old" title={`Taken from the old file (difference ${id})`}>
      <span className="from-old-tag">from old</span>
      {children}
    </div>
  );
}

/** Final content of a cell (or any container) given its segments. */
export function FinalSegments({ segs }: { segs: Segment[] }) {
  const { result, ix, choices } = useView();
  return (
    <>
      {segs.map((s, i) => {
        if (s.type === 'equal') return s.new.ids.map((id) => <BlockView key={id} b={ix.new.block(id)} />);
        if (s.type === 'diff') {
          const d = result.differences[s.diffId];
          const side = partOutput(s.part, effectiveChoice(d, choices));
          if (!side) return null;
          const blocks = d[side].ids.map((id) => <BlockView key={id} b={ix[side].block(id)} />);
          return side === 'old' ? (
            <FromOld key={i} id={d.id}>
              {blocks}
            </FromOld>
          ) : (
            blocks
          );
        }
        return (
          <table key={i} className="doc-table">
            <tbody>
              {s.rows.map((r, ri) => (
                <FinalNestedRow key={ri} r={r} />
              ))}
            </tbody>
          </table>
        );
      })}
    </>
  );
}

function FinalNestedRow({ r }: { r: RowSegment }) {
  const { result, ix, choices } = useView();
  if (r.type === 'diff') {
    const d = result.differences[r.diffId];
    const side = partOutput(r.part, effectiveChoice(d, choices));
    if (!side) return null;
    return (
      <>
        {d[side].ids.map((id) => {
          const row = ix[side].row(id).row;
          return (
            <tr key={id} className={side === 'old' ? 'from-old-row' : ''}>
              {row.cells.map((c) => (
                <td key={c.id} colSpan={c.gridSpan}>
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
  const row = ix.new.row(r.newRowId).row;
  return (
    <tr>
      {row.cells.map((c, ci) => (
        <td key={c.id} colSpan={c.gridSpan}>
          {r.type === 'rowPair' ? <FinalSegments segs={r.cells[ci].segments} /> : c.blocks.map((b) => <BlockView key={b.id} b={b} />)}
        </td>
      ))}
    </tr>
  );
}

/** Final content for one aligned row, or null when the row contributes nothing. */
export function finalRowContent(row: Row, ctx: ReturnType<typeof useView>): ReactNode | null {
  const { result, ix, choices } = ctx;
  if (row.kind === 'gap' || row.kind === 'section') return null;
  if (row.kind === 'equal') return <BlockView b={row.new} />;
  if (row.kind === 'diff') {
    const d = result.differences[row.diffId];
    const side = partOutput(row.part, effectiveChoice(d, choices));
    if (!side) return null;
    const blocks = d[side].ids.map((id) => <BlockView key={id} b={ix[side].block(id)} />);
    return side === 'old' ? <FromOld id={d.id}>{blocks}</FromOld> : <>{blocks}</>;
  }
  const seg = row.seg;
  if (seg.type === 'diff') {
    const d = result.differences[seg.diffId];
    const side = partOutput(seg.part, effectiveChoice(d, choices));
    if (!side) return null;
    // Rows brought back from the old file are laid out on the new table's grid.
    return (
      <TableFragment
        t={row.newTable}
        rows={side === 'old' ? row.old : row.new}
        first={row.first}
        className={side === 'old' ? 'from-old-row' : ''}
        cellContent={(_r, c) => c.blocks.map((b) => <BlockView key={b.id} b={b} />)}
      />
    );
  }
  return (
    <TableFragment
      t={row.newTable}
      rows={row.new}
      first={row.first}
      cellContent={(_r, c, ci) =>
        seg.type === 'rowPair' ? <FinalSegments segs={seg.cells[ci].segments} /> : c.blocks.map((b) => <BlockView key={b.id} b={b} />)
      }
    />
  );
}
