// Automatic numbering: compute the label Word shows ("3.", "a)", "2.1", "•").
// Shown only, never compared in v1 (spec/comparison §6).

import type { Numbering } from '../../model/document';
import type { StyleMap } from './styles';
import { wAttr, wChild, wChildren, wVal } from './xml';

interface Level {
  start: number;
  numFmt: string;
  lvlText: string;
  isLgl: boolean;
}

interface Num {
  abstractId: string;
  /** Level overrides: a restart value and/or a replacement level definition. */
  overrides: Map<number, { start?: number; level?: Level }>;
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

function roman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) (out += s), (n -= v);
  return out;
}

function letters(n: number): string {
  // Word: a..z, then aa..zz, aaa..
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

function format(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter':
      return letters(n);
    case 'upperLetter':
      return letters(n).toUpperCase();
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n);
    case 'ordinal': {
      const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
      return `${n}${s}`;
    }
    case 'none':
      return '';
    default:
      return String(n);
  }
}

/** Symbol-font bullet characters → readable Unicode bullets. */
function bulletChar(text: string, level: number): string {
  const c = text.trim();
  if (c === '' || c === '•' || c === '·' || c === '') return '•';
  if (c === 'o' || c === '◦') return '◦';
  if (c === '' || c === '§' || c === '▪' || c === '■') return '▪';
  if (c === '' || c === '-' || c === '–') return '–';
  if (c === '' || c === '✓') return '✓';
  return c.length === 1 && c.charCodeAt(0) >= 0xf000 ? (level % 2 === 0 ? '•' : '◦') : c;
}

function readLevel(lvl: Element): Level {
  return {
    start: Number(wVal(lvl, 'start') ?? 1),
    numFmt: wVal(lvl, 'numFmt') ?? 'decimal',
    lvlText: wVal(lvl, 'lvlText') ?? '',
    isLgl: !!wChild(lvl, 'isLgl'),
  };
}

export class NumberingState {
  private abstracts = new Map<string, Map<number, Level>>();
  /** abstractNumId → numStyleLink style id (list styles). */
  private styleLinks = new Map<string, string>();
  private nums = new Map<string, Num>();
  /**
   * Counters per list instance. Word continues numbering across w:num elements
   * that share an abstractNum, unless a w:num has level overrides: then it is
   * its own instance and restarts.
   */
  private counters = new Map<string, number[]>();

  constructor(
    doc: Document | null,
    private styles: StyleMap,
  ) {
    if (!doc) return;
    for (const a of wChildren(doc.documentElement, 'abstractNum')) {
      const id = wAttr(a, 'abstractNumId') ?? '';
      const levels = new Map<number, Level>();
      for (const lvl of wChildren(a, 'lvl')) levels.set(Number(wAttr(lvl, 'ilvl') ?? 0), readLevel(lvl));
      this.abstracts.set(id, levels);
      const link = wVal(a, 'numStyleLink');
      if (link) this.styleLinks.set(id, link);
    }
    for (const n of wChildren(doc.documentElement, 'num')) {
      const overrides = new Map<number, { start?: number; level?: Level }>();
      for (const o of wChildren(n, 'lvlOverride')) {
        const startOverride = wVal(o, 'startOverride');
        const lvl = wChild(o, 'lvl');
        overrides.set(Number(wAttr(o, 'ilvl') ?? 0), {
          start: startOverride !== null ? Number(startOverride) : undefined,
          level: lvl ? readLevel(lvl) : undefined,
        });
      }
      this.nums.set(wAttr(n, 'numId') ?? '', { abstractId: wVal(n, 'abstractNumId') ?? '', overrides });
    }
  }

  /** Abstract list behind a num, following list-style links (numStyleLink → style numPr → num). */
  private abstractOf(numId: string): string | undefined {
    let abs = this.nums.get(numId)?.abstractId;
    for (let i = 0; abs !== undefined && this.styleLinks.has(abs) && i < 5; i++) {
      const linked = this.styles.get(this.styleLinks.get(abs))?.numPr?.numId;
      const next = linked ? this.nums.get(linked)?.abstractId : undefined;
      if (!next || next === abs) break;
      abs = next;
    }
    return abs;
  }

  private level(numId: string, abs: string, ilvl: number): Level | undefined {
    return this.nums.get(numId)?.overrides.get(ilvl)?.level ?? this.abstracts.get(abs)?.get(ilvl);
  }

  /** Advance the list and return the label of this paragraph, or undefined when it is not numbered. */
  next(numId: string, ilvl: number): Numbering | undefined {
    if (numId === '0') return undefined; // numId 0 = numbering explicitly removed
    const abs = this.abstractOf(numId);
    if (abs === undefined) return undefined;
    const lvl = this.level(numId, abs, ilvl);
    if (!lvl) return undefined;

    const overrides = this.nums.get(numId)?.overrides;
    const key = overrides?.size ? `num:${numId}` : `abs:${abs}`;
    let c = this.counters.get(key);
    if (!c) {
      c = [];
      for (const [l, o] of overrides ?? []) {
        if (o.start !== undefined) c[l] = o.start - 1;
        else if (o.level) c[l] = o.level.start - 1;
      }
      this.counters.set(key, c);
    }
    c[ilvl] = (c[ilvl] ?? lvl.start - 1) + 1;
    // Lower levels restart after a higher level advances.
    c.length = ilvl + 1;

    if (lvl.numFmt === 'bullet') {
      const ch = bulletChar(lvl.lvlText, ilvl);
      return { listId: abs, level: ilvl, format: 'bullet', label: ch, listStyle: `Bullet ${ch}` };
    }
    const label = lvl.lvlText.replace(/%([1-9])/g, (_, d: string) => {
      const l = Number(d) - 1;
      const lv = this.level(numId, abs, l);
      const n = c[l] ?? lv?.start ?? 1;
      return format(n, lvl.isLgl && l < ilvl ? 'decimal' : (lv?.numFmt ?? 'decimal'));
    });
    if (lvl.numFmt === 'none' && !label.trim()) return undefined;
    // The list's look, independent of the position: every level shown as its first number.
    const pattern = lvl.lvlText.replace(/%([1-9])/g, (_, d: string) => {
      const l = Number(d) - 1;
      return format(1, lvl.isLgl && l < ilvl ? 'decimal' : (this.level(numId, abs, l)?.numFmt ?? 'decimal'));
    });
    return { listId: abs, level: ilvl, format: 'number', label, listStyle: `Numbered ${pattern}` };
  }
}
