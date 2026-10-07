// Pair the sections of the two files by the content they share in the
// alignment (not by number), then hint header/footer differences per pair
// (decision 17, spec §6.3).
//
// Example (05): the new file adds a section break and a landscape appendix.
// Old section 1 shares its paragraphs with new section 1; new section 2
// holds only inserted content, so it is "only in new".

import type { Block, DocModel, DocSection, HeaderVariant } from '../../model/document';
import type { Difference, Segment, SectionHint } from '../../model/diff';

const VARIANTS: HeaderVariant[] = ['default', 'first', 'even'];

/** Section number (1-based) of every top-level block. */
function sectionOf(blocks: Block[]): Map<string, number> {
  const m = new Map<string, number>();
  let s = 1;
  for (const b of blocks) {
    m.set(b.id, s);
    if (b.kind === 'paragraph' && b.sectionBreak) s++;
  }
  return m;
}

/** Top-level block pairs that correspond in the alignment (equal, or paired by a difference). */
function correspondingBlocks(segments: Segment[], differences: Record<string, Difference>): [string, string][] {
  const out: [string, string][] = [];
  for (const s of segments) {
    if (s.type === 'equal') s.old.ids.forEach((id, i) => out.push([id, s.new.ids[i]]));
    else if (s.type === 'tablePair') out.push([s.oldTableId, s.newTableId]);
    else if (s.part === 'whole') {
      const d = differences[s.diffId];
      if (d.old.unit === 'block' && d.old.ids.length && d.new.ids.length) out.push([d.old.ids[0], d.new.ids[0]]);
    }
  }
  return out;
}

/** Order-preserving pairing of sections that maximises shared blocks. */
function pairByOverlap(nOld: number, nNew: number, overlap: (a: number, b: number) => number): [number, number][] {
  const W = nNew + 1;
  const score = new Float64Array((nOld + 1) * W);
  for (let i = 1; i <= nOld; i++)
    for (let j = 1; j <= nNew; j++) {
      const o = overlap(i, j);
      score[i * W + j] = Math.max(score[(i - 1) * W + j], score[i * W + j - 1], o > 0 ? score[(i - 1) * W + j - 1] + o : -1);
    }
  const pairs: [number, number][] = [];
  for (let i = nOld, j = nNew; i > 0 && j > 0; ) {
    const o = overlap(i, j);
    if (o > 0 && score[i * W + j] === score[(i - 1) * W + j - 1] + o) {
      pairs.push([i, j]);
      i--;
      j--;
    } else if (score[i * W + j] === score[(i - 1) * W + j]) i--;
    else j--;
  }
  return pairs.reverse();
}

export function sectionHints(o: DocModel, n: DocModel, segments: Segment[], differences: Record<string, Difference>): SectionHint[] {
  const so = sectionOf(o.blocks);
  const sn = sectionOf(n.blocks);
  const counts = new Map<string, number>();
  for (const [a, b] of correspondingBlocks(segments, differences)) {
    const k = `${so.get(a)}:${sn.get(b)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let pairs = pairByOverlap(o.sections.length, n.sections.length, (a, b) => counts.get(`${a}:${b}`) ?? 0);
  // Nothing in common at all (unrelated files): fall back to pairing by number.
  if (pairs.length === 0) pairs = Array.from({ length: Math.min(o.sections.length, n.sections.length) }, (_, i) => [i + 1, i + 1] as [number, number]);

  const hints: SectionHint[] = [];
  const add = (a: DocSection | undefined, b: DocSection | undefined) => {
    for (const part of ['header', 'footer'] as const) {
      const key = part === 'header' ? 'headers' : 'footers';
      for (const v of VARIANTS) {
        const x = a?.[key][v];
        const y = b?.[key][v];
        if (!x && !y) continue;
        const result: SectionHint['result'] = !a ? 'onlyNew' : !b ? 'onlyOld' : x?.fingerprint === y?.fingerprint ? 'same' : 'mayDiffer';
        hints.push({ part, variant: v, oldSection: a?.index, newSection: b?.index, result });
      }
    }
  };
  // Walk both section lists in order, emitting pairs and the unpaired sections between them.
  let i = 1;
  let j = 1;
  for (const [a, b] of [...pairs, [o.sections.length + 1, n.sections.length + 1] as [number, number]]) {
    for (; i < a; i++) add(o.sections[i - 1], undefined);
    for (; j < b; j++) add(undefined, n.sections[j - 1]);
    if (a <= o.sections.length && b <= n.sections.length) add(o.sections[a - 1], n.sections[b - 1]);
    i = a + 1;
    j = b + 1;
  }
  return hints;
}
