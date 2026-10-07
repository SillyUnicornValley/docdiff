// Id → node lookup for one document (blocks, rows, cells at any depth).

import type { Block, DocModel, NodeId, ParagraphBlock, TableBlock, TableCell, TableRow } from './document';

export type IndexedNode =
  | { kind: 'block'; node: Block }
  | { kind: 'row'; node: TableRow; table: TableBlock }
  | { kind: 'cell'; node: TableCell; row: TableRow; table: TableBlock };

export class DocIndex {
  private map = new Map<NodeId, IndexedNode>();

  constructor(doc: DocModel) {
    this.addBlocks(doc.blocks);
  }

  private addBlocks(blocks: Block[]) {
    for (const b of blocks) {
      this.map.set(b.id, { kind: 'block', node: b });
      if (b.kind === 'table') {
        for (const r of b.rows) {
          this.map.set(r.id, { kind: 'row', node: r, table: b });
          for (const c of r.cells) {
            this.map.set(c.id, { kind: 'cell', node: c, row: r, table: b });
            this.addBlocks(c.blocks);
          }
        }
      } else if (b.kind === 'placeholder' && b.children) {
        this.addBlocks(b.children);
      }
    }
  }

  get(id: NodeId): IndexedNode | undefined {
    return this.map.get(id);
  }

  block(id: NodeId): Block {
    const n = this.map.get(id);
    if (!n || n.kind !== 'block') throw new Error(`Not a block: ${id}`);
    return n.node;
  }

  row(id: NodeId): { row: TableRow; table: TableBlock } {
    const n = this.map.get(id);
    if (!n || n.kind !== 'row') throw new Error(`Not a row: ${id}`);
    return { row: n.node, table: n.table };
  }

  cell(id: NodeId): TableCell {
    const n = this.map.get(id);
    if (!n || n.kind !== 'cell') throw new Error(`Not a cell: ${id}`);
    return n.node;
  }

  table(id: NodeId): TableBlock {
    const b = this.block(id);
    if (b.kind !== 'table') throw new Error(`Not a table: ${id}`);
    return b;
  }
}

/** Visit every paragraph (including table cells and TOC entries). */
export function forEachParagraph(blocks: Block[], fn: (p: ParagraphBlock) => void) {
  for (const b of blocks) {
    if (b.kind === 'paragraph') fn(b);
    else if (b.kind === 'table') for (const r of b.rows) for (const c of r.cells) forEachParagraph(c.blocks, fn);
    else if (b.children) forEachParagraph(b.children, fn);
  }
}

export function forEachBlock(blocks: Block[], fn: (b: Block) => void) {
  for (const b of blocks) {
    fn(b);
    if (b.kind === 'table') for (const r of b.rows) for (const c of r.cells) forEachBlock(c.blocks, fn);
    else if (b.kind === 'placeholder' && b.children) forEachBlock(b.children, fn);
  }
}
