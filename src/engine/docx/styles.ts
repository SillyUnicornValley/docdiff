// Paragraph styles: heading level, title, and numbering inherited through basedOn.

import type { RunMarks } from '../../model/document';
import { onOff, wAttr, wChild, wChildren, wVal } from './xml';

export interface NumPr {
  numId: string;
  ilvl: number;
}

export interface ResolvedStyle {
  id: string;
  name: string;
  /** 0-based outline level (Heading 1 = 0); undefined for body text. */
  outlineLvl?: number;
  isTitle: boolean;
  numPr?: NumPr;
}

interface RawStyle {
  id: string;
  name: string;
  basedOn?: string;
  outlineLvl?: number;
  numId?: string;
  ilvl?: number;
}

interface RawCharStyle {
  basedOn?: string;
  vertAlign?: string;
  vanish?: boolean;
}

export class StyleMap {
  private raw = new Map<string, RawStyle>();
  private chars = new Map<string, RawCharStyle>();
  private charMarksCache = new Map<string, RunMarks>();
  private resolved = new Map<string, ResolvedStyle>();
  /** Paragraph style used when a paragraph names none (w:default="1"). */
  readonly defaultParagraphStyle: string | undefined;

  constructor(doc: Document | null) {
    let def: string | undefined;
    if (doc) {
      for (const s of wChildren(doc.documentElement, 'style')) {
        const id = wAttr(s, 'styleId') ?? '';
        if (wAttr(s, 'type') === 'character') {
          const rPr = wChild(s, 'rPr');
          this.chars.set(id, {
            basedOn: wVal(s, 'basedOn') ?? undefined,
            vertAlign: wVal(rPr, 'vertAlign') ?? undefined,
            vanish: wChild(rPr, 'vanish') ? onOff(wChild(rPr, 'vanish')) : undefined,
          });
          continue;
        }
        if (wAttr(s, 'type') !== 'paragraph') continue;
        const pPr = wChild(s, 'pPr');
        const numPr = wChild(pPr, 'numPr');
        const lvl = wVal(pPr, 'outlineLvl');
        this.raw.set(id, {
          id,
          name: wVal(s, 'name') ?? id,
          basedOn: wVal(s, 'basedOn') ?? undefined,
          outlineLvl: lvl !== null ? Number(lvl) : undefined,
          numId: wVal(numPr, 'numId') ?? undefined,
          ilvl: wVal(numPr, 'ilvl') !== null ? Number(wVal(numPr, 'ilvl')) : undefined,
        });
        if (onDefault(s)) def = id;
      }
    }
    this.defaultParagraphStyle = def;
  }

  get(id: string | null | undefined): ResolvedStyle | undefined {
    const key = id ?? this.defaultParagraphStyle;
    if (!key) return undefined;
    const hit = this.resolved.get(key);
    if (hit) return hit;
    const chain: RawStyle[] = [];
    for (let s = this.raw.get(key); s && chain.length < 20 && !chain.includes(s); s = s.basedOn ? this.raw.get(s.basedOn) : undefined) chain.push(s);
    if (chain.length === 0) return undefined;
    const pick = <K extends keyof RawStyle>(k: K) => chain.find((s) => s[k] !== undefined)?.[k];
    const name = chain[0].name;
    // Built-in heading styles are recognised by name too, in case outlineLvl is missing.
    const byName = /^heading ([1-9])$/i.exec(name);
    const outlineLvl = pick('outlineLvl') ?? (byName ? Number(byName[1]) - 1 : undefined);
    const numId = pick('numId');
    const r: ResolvedStyle = {
      id: key,
      name,
      outlineLvl: outlineLvl !== undefined && outlineLvl < 9 ? outlineLvl : undefined,
      isTitle: /^title$/i.test(name),
      numPr: numId !== undefined ? { numId, ilvl: pick('ilvl') ?? 0 } : undefined,
    };
    this.resolved.set(key, r);
    return r;
  }

  /** Content marks a character style applies (superscript/subscript, hidden). */
  charMarks(id: string): RunMarks {
    const hit = this.charMarksCache.get(id);
    if (hit) return hit;
    let vertAlign: string | undefined;
    let vanish: boolean | undefined;
    const seen = new Set<string>();
    for (let k: string | undefined = id; k && !seen.has(k); k = this.chars.get(k)?.basedOn) {
      seen.add(k);
      const c = this.chars.get(k);
      vertAlign ??= c?.vertAlign;
      vanish ??= c?.vanish;
    }
    const m: RunMarks = {};
    if (vertAlign === 'superscript') m.superscript = true;
    if (vertAlign === 'subscript') m.subscript = true;
    if (vanish) m.hidden = true;
    this.charMarksCache.set(id, m);
    return m;
  }
}

function onDefault(s: Element) {
  const v = wAttr(s, 'default');
  return v === '1' || v === 'true' || v === 'on';
}
