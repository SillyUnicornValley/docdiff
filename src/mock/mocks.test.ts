// Invariants every DiffResult must satisfy (mock now, real engine in Stage 2).

import { describe, expect, it } from 'vitest';
import { MOCK_PAIRS } from './index';
import { sectionMarkers } from '../ui/rows';
import { defineInvariantTests } from '../testing/invariants';

describe.each(MOCK_PAIRS.map((p) => [p.id, p] as const))('mock %s', (_id, pair) => {
  defineInvariantTests(() => pair.build());
});

describe('specific expectations', () => {
  const get = (id: string) => MOCK_PAIRS.find((p) => p.id === id)!.build();

  it('01: 12 → 24 highlights only the number', () => {
    const r = get('01');
    const d = Object.values(r.differences).find((x) => x.wordHunks.some((h) => h.old.length === 1 && h.old[0].end - h.old[0].start === 2))!;
    expect(d).toBeTruthy();
  });

  it('A2: each modified paragraph is its own difference; adjacent inserts merge', () => {
    const r01 = get('01');
    const mods = Object.values(r01.differences).filter((d) => d.kind === 'modified');
    expect(mods.every((d) => d.old.ids.length === 1 && d.new.ids.length === 1)).toBe(true);
    const r02 = get('02');
    expect(Object.values(r02.differences).some((d) => d.kind === 'inserted' && d.new.ids.length === 3)).toBe(true);
    // 06 typography: one difference per paragraph, each with a single category.
    const r06 = get('06');
    const cats = Object.values(r06.differences).map((d) => d.category).filter(Boolean);
    expect(cats).toEqual(expect.arrayContaining(['quotes', 'dashes', 'whitespace', 'case']));
  });

  it('05: footnote and field differences block "Use old"', () => {
    const r = get('05');
    const reasons = Object.values(r.differences)
      .filter((d) => !d.useOld.available)
      .map((d) => (d.useOld.available ? '' : d.useOld.reason));
    expect(reasons).toContain('footnote');
    expect(reasons).toContain('field');
  });

  it('06: typography hunks are categorised', () => {
    const r = get('06');
    const cats = new Set(Object.values(r.differences).flatMap((d) => d.wordHunks.map((h) => h.category)));
    for (const c of ['whitespace', 'quotes', 'dashes', 'case']) expect(cats).toContain(c);
  });

  it('05: headers and footers are hinted per section', () => {
    const r = get('05');
    expect(r.scope.sectionHints.map((h) => `${h.part}:${h.oldSection ?? '-'}:${h.newSection ?? '-'}:${h.result}`)).toEqual([
      'header:1:1:mayDiffer',
      'footer:1:1:same',
      'header:-:2:onlyNew',
      'footer:-:2:onlyNew',
    ]);
    const m = sectionMarkers(r);
    expect(m.first.old?.section).toBe(1);
    expect(m.first.new?.section).toBe(1);
    // Section 2 of the new file is marked on the paragraph that carries the break.
    const breakId = r.new.sections[0].breakBlockId!;
    expect(m.afterBreak.get(breakId)?.section).toBe(2);
  });

  it('05: new-file comments are shown but never create or change a difference', () => {
    const r = get('05');
    const withComment = r.new.blocks.filter((b) => b.kind === 'paragraph' && b.content.some((i) => i.type === 'comment'));
    expect(withComment).toHaveLength(3);
    // The titration paragraph only gained a comment: it stays in an equal segment.
    const titration = withComment.find((b) => b.kind === 'paragraph' && b.content.some((i) => i.type === 'text' && i.text.startsWith('The dose')))!;
    const inDiff = Object.values(r.differences).some((d) => d.new.ids.includes(titration.id));
    expect(inDiff).toBe(false);
    // 12 → 24 still highlights only the number.
    const d = Object.values(r.differences).find((x) => x.kind === 'modified' && x.wordHunks.length === 1 && x.wordHunks[0].new[0]?.end - x.wordHunks[0].new[0]?.start === 2);
    expect(d).toBeTruthy();
  });

  it('large: identical headers produce no section marker', () => {
    const m = sectionMarkers(get('large'));
    expect(m.first).toEqual({});
    expect(m.afterBreak.size).toBe(0);
  });

  it('large: about 3,000 blocks', () => {
    const r = get('large');
    expect(r.new.blocks.length).toBeGreaterThan(2500);
  });
});
