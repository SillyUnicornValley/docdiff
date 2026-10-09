// Effective formatting of paragraphs, runs and tables, for the formatting
// check (decision 44, stage5-design §4). Shown only: formatting never creates
// a difference and never changes the export.
//
// Precedence, lowest first: built-in defaults → document defaults →
// paragraph style chain (basedOn, base first) → character style chain →
// direct formatting. Toggle properties (bold, italic…) are treated like the
// others (the nearest setting wins); table style conditional formatting and
// list-level indents are not resolved.

import type { FormatProps } from '../../model/document';
import { onOff, wAttr, wChild, wChildren, wVal } from './xml';

interface RawStyle {
  type: string;
  name: string;
  basedOn?: string;
  pPr: Element | null;
  rPr: Element | null;
}

/** Defaults Word uses when nothing is set. */
const RUN_DEFAULTS: FormatProps = {
  Bold: 'off',
  Italic: 'off',
  Underline: 'none',
  Strikethrough: 'off',
  'All caps': 'off',
  'Small caps': 'off',
  Font: '(default)',
  Size: '10 pt',
  Color: 'automatic',
  Highlight: 'none',
};

const PARA_DEFAULTS: FormatProps = {
  Alignment: 'left',
  'Indent left': '0"',
  'Indent right': '0"',
  'First line': 'none',
  'Space before': '0 pt',
  'Space after': '0 pt',
  'Line spacing': 'single',
};

const inches = (twips: number) => `${Math.round((twips / 1440) * 100) / 100}"`;
const points = (twips: number) => `${Math.round((twips / 20) * 10) / 10} pt`;
const ALIGN: Record<string, string> = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', both: 'justified', distribute: 'distributed' };

/** Run properties set by one w:rPr. */
function readRPr(rPr: Element | null, out: FormatProps) {
  if (!rPr) return;
  const toggle = (local: string, label: string) => {
    const el = wChild(rPr, local);
    if (el) out[label] = onOff(el) ? 'on' : 'off';
  };
  toggle('b', 'Bold');
  toggle('i', 'Italic');
  toggle('strike', 'Strikethrough');
  if (wChild(rPr, 'dstrike') && onOff(wChild(rPr, 'dstrike'))) out.Strikethrough = 'double';
  toggle('caps', 'All caps');
  toggle('smallCaps', 'Small caps');
  const u = wChild(rPr, 'u');
  if (u) out.Underline = wAttr(u, 'val') ?? 'single';
  const fonts = wChild(rPr, 'rFonts');
  if (fonts) {
    const f = wAttr(fonts, 'ascii') ?? wAttr(fonts, 'hAnsi') ?? (wAttr(fonts, 'asciiTheme') ? `theme (${wAttr(fonts, 'asciiTheme')})` : null);
    if (f) out.Font = f;
  }
  const sz = wVal(rPr, 'sz');
  if (sz !== null && !Number.isNaN(Number(sz))) out.Size = `${Number(sz) / 2} pt`;
  const color = wChild(rPr, 'color');
  if (color) {
    const theme = wAttr(color, 'themeColor');
    const v = wAttr(color, 'val');
    out.Color = theme ? `theme (${theme})` : !v || v === 'auto' ? 'automatic' : `#${v.toUpperCase()}`;
  }
  const hl = wVal(rPr, 'highlight');
  if (hl !== null) out.Highlight = hl;
}

/** Paragraph properties set by one w:pPr. */
function readPPr(pPr: Element | null, out: FormatProps) {
  if (!pPr) return;
  const jc = wVal(pPr, 'jc');
  if (jc) out.Alignment = ALIGN[jc] ?? jc;
  const ind = wChild(pPr, 'ind');
  if (ind) {
    const num = (n: string) => wAttr(ind, n);
    const left = num('left') ?? num('start');
    const right = num('right') ?? num('end');
    if (left !== null) out['Indent left'] = inches(Number(left));
    if (right !== null) out['Indent right'] = inches(Number(right));
    if (num('hanging') !== null) out['First line'] = `hanging ${inches(Number(num('hanging')))}`;
    else if (num('firstLine') !== null) out['First line'] = Number(num('firstLine')) ? inches(Number(num('firstLine'))) : 'none';
  }
  const sp = wChild(pPr, 'spacing');
  if (sp) {
    const before = wAttr(sp, 'before');
    const after = wAttr(sp, 'after');
    if (onOffAttr(wAttr(sp, 'beforeAutospacing'))) out['Space before'] = 'auto';
    else if (before !== null) out['Space before'] = points(Number(before));
    if (onOffAttr(wAttr(sp, 'afterAutospacing'))) out['Space after'] = 'auto';
    else if (after !== null) out['Space after'] = points(Number(after));
    const line = wAttr(sp, 'line');
    if (line !== null) {
      const rule = wAttr(sp, 'lineRule') ?? 'auto';
      const v = Number(line);
      out['Line spacing'] =
        rule === 'exact' ? `exactly ${points(v)}` : rule === 'atLeast' ? `at least ${points(v)}` : v === 240 ? 'single' : `${Math.round((v / 240) * 100) / 100} lines`;
    }
  }
}

const onOffAttr = (v: string | null) => v !== null && !['0', 'false', 'off'].includes(v);

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export class FormatResolver {
  private styles = new Map<string, RawStyle>();
  private defaultStyle: Record<string, string> = {};
  private docRPr: Element | null = null;
  private docPPr: Element | null = null;
  private runCache = new Map<string, FormatProps>();
  private paraCache = new Map<string, FormatProps>();

  constructor(doc: Document | null) {
    if (!doc) return;
    const root = doc.documentElement;
    const defaults = wChild(root, 'docDefaults');
    this.docRPr = wChild(wChild(defaults, 'rPrDefault'), 'rPr');
    this.docPPr = wChild(wChild(defaults, 'pPrDefault'), 'pPr');
    for (const s of wChildren(root, 'style')) {
      const id = wAttr(s, 'styleId') ?? '';
      const type = wAttr(s, 'type') ?? 'paragraph';
      this.styles.set(`${type}:${id}`, { type, name: wVal(s, 'name') ?? id, basedOn: wVal(s, 'basedOn') ?? undefined, pPr: wChild(s, 'pPr'), rPr: wChild(s, 'rPr') });
      const def = wAttr(s, 'default');
      if (def === '1' || def === 'true' || def === 'on') this.defaultStyle[type] = id;
    }
  }

  /** Style chain, base first. */
  private chain(type: string, id: string | null | undefined): RawStyle[] {
    const out: RawStyle[] = [];
    for (let k: string | undefined = id ?? this.defaultStyle[type]; k && out.length < 20; ) {
      const s = this.styles.get(`${type}:${k}`);
      if (!s || out.includes(s)) break;
      out.unshift(s);
      k = s.basedOn;
    }
    return out;
  }

  styleName(type: 'paragraph' | 'table', id: string | null | undefined): string {
    const k = id ?? this.defaultStyle[type];
    const s = k ? this.styles.get(`${type}:${k}`) : undefined;
    return capitalise(s?.name ?? k ?? '(none)');
  }

  /** Effective paragraph properties, including the style name. */
  paragraph(pPr: Element | null): FormatProps {
    const styleId = wVal(pPr, 'pStyle');
    let base = this.paraCache.get(styleId ?? '');
    if (!base) {
      base = { 'Paragraph style': this.styleName('paragraph', styleId), ...PARA_DEFAULTS };
      readPPr(this.docPPr, base);
      for (const s of this.chain('paragraph', styleId)) readPPr(s.pPr, base);
      this.paraCache.set(styleId ?? '', base);
    }
    const direct = pPr && elementCount(pPr, ['jc', 'ind', 'spacing']) ? { ...base } : base;
    if (direct !== base) readPPr(pPr, direct);
    return direct;
  }

  /** Effective run properties of a run in a paragraph of the given style. */
  run(rPr: Element | null, paraStyleId: string | null): FormatProps {
    const charStyle = wVal(rPr, 'rStyle');
    const key = `${paraStyleId ?? ''}|${charStyle ?? ''}`;
    let base = this.runCache.get(key);
    if (!base) {
      base = { ...RUN_DEFAULTS };
      readRPr(this.docRPr, base);
      for (const s of this.chain('paragraph', paraStyleId)) readRPr(s.rPr, base);
      if (charStyle) for (const s of this.chain('character', charStyle)) readRPr(s.rPr, base);
      this.runCache.set(key, base);
    }
    if (!rPr) return base;
    const out = { ...base };
    readRPr(rPr, out);
    return out;
  }

  table(tblPr: Element | null): string {
    return this.styleName('table', wVal(tblPr, 'tblStyle'));
  }
}

function elementCount(el: Element, locals: string[]): number {
  return locals.reduce((k, l) => k + (wChild(el, l) ? 1 : 0), 0);
}
