// Mock pair registry. Stage 2 replaces this with: parse(oldFile), parse(newFile), compare().

import type { DiffResult } from '../model/diff';
import { case01, case02, case03, case05, case06 } from './cases';
import { largeCase } from './large';

export interface MockPair {
  id: string;
  title: string;
  description: string;
  oldName: string;
  newName: string;
  build: () => DiffResult;
}

export const MOCK_PAIRS: MockPair[] = [
  {
    id: '01',
    title: '01 · Basic text',
    description: 'Number change, rewrite, inserted and deleted paragraphs; formatting-only changes produce no difference.',
    oldName: '01-basic-text_old.docx',
    newName: '01-basic-text_new.docx',
    build: case01,
  },
  {
    id: '02',
    title: '02 · Lists',
    description: 'Inserted list item (later numbers shift, not shown as a change), moved item, typed → automatic numbers.',
    oldName: '02-lists_old.docx',
    newName: '02-lists_new.docx',
    build: case02,
  },
  {
    id: '03',
    title: '03 · Tables',
    description: 'Cell edit, row insert/delete, column change offered as a whole-table choice, paragraphs ↔ table, nested table.',
    oldName: '03-tables_old.docx',
    newName: '03-tables_new.docx',
    build: case03,
  },
  {
    id: '05',
    title: '05 · Not-compared elements',
    description: 'Placeholders, TOC and date field (optional comparisons), footnote and field differences where "Use old" is unavailable.',
    oldName: '05-uncompared-and-comments_old.docx',
    newName: '05-uncompared-and-comments_new.docx',
    build: case05,
  },
  {
    id: '06',
    title: '06 · Alignment edge cases',
    description: 'Split and joined paragraphs, moved paragraph, whitespace / quote / dash / case categories, superscript change.',
    oldName: '06-edge-alignment_old.docx',
    newName: '06-edge-alignment_new.docx',
    build: case06,
  },
  {
    id: 'large',
    title: 'Large · ~200 pages',
    description: 'Generated: 60 chapters, about 3,000 blocks, 60 tables, ~75 differences. For scrolling performance.',
    oldName: '07-long-document_old.docx',
    newName: '07-long-document_new.docx',
    build: largeCase,
  },
];

/** Pick the mock for two chosen file names (by the "NN-" prefix), defaulting to 01. */
export function mockForFiles(oldName: string, newName: string): MockPair {
  const key = (n: string) => n.match(/^(\d\d)-/)?.[1];
  const k = key(newName) ?? key(oldName);
  if (k === '07') return MOCK_PAIRS.find((p) => p.id === 'large')!;
  return MOCK_PAIRS.find((p) => p.id === k) ?? MOCK_PAIRS[0];
}
