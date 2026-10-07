// Readable outline of a DiffResult, for tests and debugging:
//   "= text" equal, "- text" deleted, "+ text" inserted, "~ old ⟶ new" paired,
//   "⇄< text" / "⇄> text" the two halves of a move, "i~" informational.

import type { DiffResult, Difference, Segment } from '../model/diff';
import type { Block } from '../model/document';
import { DocIndex } from '../model/docIndex';
import { flattenParagraph } from '../model/flatten';

const short = (b: Block) =>
  b.kind === 'paragraph' ? flattenParagraph(b).text.replace(/\n/g, '↵').replace(/￼/g, '▪') : b.kind === 'table' ? `[table ${b.rows.length}×${b.gridColumns}]` : `[${b.element}]`;

export function describeResult(r: DiffResult): string[] {
  const ix = { old: new DocIndex(r.old), new: new DocIndex(r.new) };
  const texts = (d: Difference, side: 'old' | 'new') =>
    d[side].ids.map((id) => {
      const n = ix[side].get(id)!;
      return n.kind === 'block' ? short(n.node) : `[${n.kind}]`;
    });
  const lines: string[] = [];
  const visit = (segs: Segment[]) => {
    for (const s of segs) {
      if (s.type === 'equal') s.new.ids.forEach((id) => lines.push(`= ${short(ix.new.block(id))}`));
      else if (s.type === 'tablePair') lines.push(`= [tablePair ${s.rows.length} rows]`);
      else {
        const d = r.differences[s.diffId];
        const cat = d.category ? ` {${d.category}}` : '';
        if (d.kind === 'moved') lines.push(s.part === 'from' ? `⇄< ${texts(d, 'old').join(' ¶ ')}` : `⇄> ${texts(d, 'new').join(' ¶ ')}${cat}`);
        else if (d.kind === 'deleted') lines.push(`- ${texts(d, 'old').join(' ¶ ')}${cat}`);
        else if (d.kind === 'inserted') lines.push(`+ ${texts(d, 'new').join(' ¶ ')}${cat}`);
        else lines.push(`${d.informational ? 'i' : ''}~${d.kind === 'modified' ? '' : `(${d.kind})`} ${texts(d, 'old').join(' ¶ ')} ⟶ ${texts(d, 'new').join(' ¶ ')}${cat}`);
      }
    }
  };
  visit(r.segments);
  return lines;
}
