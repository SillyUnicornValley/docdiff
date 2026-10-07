// Readable outline of a DiffResult, for tests and debugging:
//   "= text" equal, "- text" deleted, "+ text" inserted, "~ old ⟶ new" paired,
//   "⇄< text" / "⇄> text" the two halves of a move, "i~" informational.
// Inside a row-by-row table pair: "  row= …", "  row- …", "  row+ …", and the
// differences of paired rows' cells indented below "  row~ …".

import type { DiffResult, Difference, Segment } from '../model/diff';
import type { Block } from '../model/document';
import { DocIndex } from '../model/docIndex';
import { flattenParagraph } from '../model/flatten';

const short = (b: Block) =>
  b.kind === 'paragraph' ? flattenParagraph(b).text.replace(/\n/g, '↵').replace(/￼/g, '▪') : b.kind === 'table' ? `[table ${b.rows.length}×${b.gridColumns}]` : `[${b.element}]`;

export function describeResult(r: DiffResult): string[] {
  const result = r;
  const ix = { old: new DocIndex(r.old), new: new DocIndex(r.new) };
  const texts = (d: Difference, side: 'old' | 'new') =>
    d[side].ids.map((id) => {
      const n = ix[side].get(id)!;
      return n.kind === 'block' ? short(n.node) : `[${n.kind}]`;
    });
  const lines: string[] = [];
  const rowText = (side: 'old' | 'new', id: string) =>
    ix[side]
      .row(id)
      .row.cells.map((c) => c.blocks.map(short).join(' '))
      .join(' | ');
  const visit = (segs: Segment[], indent = '') => {
    for (const s of segs) {
      if (s.type === 'equal') s.new.ids.forEach((id) => lines.push(`${indent}= ${short(ix.new.block(id))}`));
      else if (s.type === 'tablePair') {
        lines.push(`${indent}[table pair]`);
        for (const r of s.rows) {
          if (r.type === 'equal') lines.push(`${indent}  row= ${rowText('new', r.newRowId)}`);
          else if (r.type === 'rowPair') {
            const inner: string[] = [];
            const before = lines.length;
            r.cells.forEach((c) => visit(c.segments, `${indent}    `));
            inner.push(...lines.splice(before).filter((l) => !l.trimStart().startsWith('=')));
            lines.push(`${indent}  row${inner.length ? '~' : '='} ${rowText('new', r.newRowId)}`, ...inner);
          } else {
            const d = r.diffId && result.differences[r.diffId];
            const side = d && d.kind === 'deleted' ? 'old' : 'new';
            lines.push(`${indent}  row${side === 'old' ? '-' : '+'} ${rowText(side, d ? d[side].ids[0] : '')}`);
          }
        }
      } else {
        const d = r.differences[s.diffId];
        const cat = d.category ? ` {${d.category}}` : '';
        if (d.kind === 'moved') lines.push(indent + (s.part === 'from' ? `⇄< ${texts(d, 'old').join(' ¶ ')}` : `⇄> ${texts(d, 'new').join(' ¶ ')}${cat}`));
        else if (d.kind === 'deleted') lines.push(`${indent}- ${texts(d, 'old').join(' ¶ ')}${cat}`);
        else if (d.kind === 'inserted') lines.push(`${indent}+ ${texts(d, 'new').join(' ¶ ')}${cat}`);
        else lines.push(`${indent}${d.informational ? 'i' : ''}~${d.kind === 'modified' ? '' : `(${d.kind})`} ${texts(d, 'old').join(' ¶ ')} ⟶ ${texts(d, 'new').join(' ¶ ')}${cat}`);
      }
    }
  };
  visit(r.segments);
  return lines;
}
