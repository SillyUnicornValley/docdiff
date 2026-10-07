// .docx → DocModel. Runs on the main thread (decision 22). The returned XML is
// the revision-accepted working copy that a later export modifies.

import type { DocModel, DocSection, FingerprintedPart, HeaderFooterRef, HeaderVariant, NodeId, Side } from '../../model/document';
import { hashBytes, hashString, sha256Hex } from '../hash';
import { acceptAllRevisions, revisionTotal } from './acceptRevisions';
import { NumberingState } from './numbering';
import { openDocx, type DocxPackage } from './package';
import { BodyReader } from './readBody';
import { StyleMap } from './styles';
import { DocxError, NS, plainText, wAttr, wChild, wChildren } from './xml';

export interface ParsedDocx {
  doc: DocModel;
  /** NodeId → element in `xml`. Main thread only; used by export. */
  source: Map<NodeId, Element>;
  /** document.xml with all existing revisions accepted. */
  xml: Document;
  pkg: DocxPackage;
  /** Revisions accepted on load (for the new file: "N pending revisions will be accepted on export"). */
  revisionCount: number;
  /** Fields and content controls spanning several blocks or rows (see BodyResult.groups). */
  groups: Map<NodeId, string[]>;
}

const VARIANTS: HeaderVariant[] = ['default', 'first', 'even'];

async function notesText(pkg: DocxPackage, relSuffix: string, local: 'footnote' | 'endnote') {
  const map = new Map<string, string>();
  const path = pkg.partByType(relSuffix);
  const doc = path ? await pkg.readXml(path) : null;
  if (!doc) return map;
  for (const n of wChildren(doc.documentElement, local)) {
    const type = wAttr(n, 'type');
    if (type && type !== 'normal') continue; // separators
    map.set(wAttr(n, 'id') ?? '', plainText(n));
  }
  return map;
}

async function commentsOf(pkg: DocxPackage) {
  const map = new Map<string, { author: string; preview: string }>();
  const path = pkg.partByType('/comments');
  const doc = path ? await pkg.readXml(path) : null;
  if (!doc) return map;
  for (const c of wChildren(doc.documentElement, 'comment')) {
    const text = wChildren(c, 'p')
      .map((p) => plainText(p))
      .join(' ')
      .trim();
    map.set(wAttr(c, 'id') ?? '', { author: wAttr(c, 'author') ?? 'Unknown', preview: text.length > 80 ? `${text.slice(0, 80)}…` : text });
  }
  return map;
}

async function mediaFingerprints(pkg: DocxPackage) {
  const map = new Map<string, string>();
  const files = Object.keys(pkg.zip.files).filter((p) => p.startsWith('word/media/') && !pkg.zip.files[p].dir);
  for (const p of files) {
    const bytes = await pkg.readBytes(p);
    if (bytes) map.set(p, hashBytes(bytes));
  }
  return map;
}

/** Header/footer part path → fingerprint of its text. */
async function headerFooterFingerprints(pkg: DocxPackage) {
  const map = new Map<string, string>();
  for (const r of pkg.rels.values()) {
    if (r.external || !(r.type.endsWith('/header') || r.type.endsWith('/footer'))) continue;
    const doc = await pkg.readXml(r.target);
    if (!doc) continue;
    // Fields such as PAGE show cached numbers; compare the visible text, which is what a reader sees.
    map.set(r.target, hashString(plainText(doc.documentElement)));
  }
  return map;
}

async function propertiesFingerprint(pkg: DocxPackage): Promise<string | undefined> {
  const core = await pkg.readXml('docProps/core.xml');
  if (!core) return undefined;
  // Only user-visible properties: author/modified dates change on every save.
  const pick = (ns: string, local: string) => core.getElementsByTagNameNS(ns, local)[0]?.textContent ?? '';
  const dc = 'http://purl.org/dc/elements/1.1/';
  const cp = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
  return hashString([pick(dc, 'title'), pick(dc, 'subject'), pick(dc, 'description'), pick(cp, 'keywords'), pick(cp, 'category')].join('\u0001'));
}

function sectionsOf(
  pkg: DocxPackage,
  blocks: DocModel['blocks'],
  breaks: { blockId: NodeId; sectPr: Element }[],
  finalSectPr: Element | null,
  hf: Map<string, string>,
): DocSection[] {
  const sectPrs = [...breaks.map((b) => b.sectPr), finalSectPr];
  const out: DocSection[] = [];
  const refs = (sectPr: Element | null, local: 'headerReference' | 'footerReference', prev?: Partial<Record<HeaderVariant, HeaderFooterRef>>) => {
    const m: Partial<Record<HeaderVariant, HeaderFooterRef>> = {};
    for (const v of VARIANTS) {
      const ref = sectPr ? wChildren(sectPr, local).find((r) => (wAttr(r, 'type') ?? 'default') === v) : undefined;
      const rid = ref?.getAttributeNS(NS.r, 'id');
      const target = rid ? pkg.rels.get(rid)?.target : undefined;
      if (target && hf.has(target)) m[v] = { fingerprint: hf.get(target)! };
      // No own header of this kind: Word reuses the previous section's ("Link to Previous").
      else if (prev?.[v]) m[v] = { fingerprint: prev[v]!.fingerprint, linkedToPrevious: true };
    }
    return m;
  };
  const blockIndex = new Map(blocks.map((b, i) => [b.id, i]));
  sectPrs.forEach((sectPr, i) => {
    const prev = out.at(-1);
    const firstBlockId = i === 0 ? blocks[0]?.id : blocks[(blockIndex.get(breaks[i - 1].blockId) ?? -2) + 1]?.id;
    const sec: DocSection = { index: i + 1, firstBlockId, headers: refs(sectPr, 'headerReference', prev?.headers), footers: refs(sectPr, 'footerReference', prev?.footers) };
    if (i < breaks.length) sec.breakBlockId = breaks[i].blockId;
    out.push(sec);
  });
  return out;
}

export async function parseDocx(data: ArrayBuffer, side: Side, fileName: string): Promise<ParsedDocx> {
  const pkg = await openDocx(data);
  const xml = await pkg.readXml(pkg.documentPath);
  const body = xml && wChild(xml.documentElement, 'body');
  if (!xml || !body) throw new DocxError('This file does not contain a Word document body.');

  const revisions = acceptAllRevisions(body);

  const stylesPath = pkg.partByType('/styles');
  const numberingPath = pkg.partByType('/numbering');
  const styles = new StyleMap(stylesPath ? await pkg.readXml(stylesPath) : null);
  const numbering = new NumberingState(numberingPath ? await pkg.readXml(numberingPath) : null, styles);
  const footnotes = await notesText(pkg, '/footnotes', 'footnote');
  const endnotes = await notesText(pkg, '/endnotes', 'endnote');
  const comments = await commentsOf(pkg);
  const media = await mediaFingerprints(pkg);
  const hf = await headerFooterFingerprints(pkg);

  const reader = new BodyReader({ side, styles, numbering, rels: pkg.rels, footnotes, endnotes, comments, media });
  const r = reader.readBody(body);

  const parts: Partial<Record<FingerprintedPart, string>> = {};
  if (footnotes.size) parts.footnotes = hashString([...footnotes.values()].join('\u0001'));
  if (endnotes.size) parts.endnotes = hashString([...endnotes.values()].join('\u0001'));
  if (media.size) parts.images = hashString([...media.values()].sort().join());
  if (r.hyperlinkTargets.length) parts.hyperlinkUrls = hashString(r.hyperlinkTargets.join('\n'));
  if (r.textBoxTexts.length) parts.textBoxes = hashString(r.textBoxTexts.join('\u0001'));
  const props = await propertiesFingerprint(pkg);
  if (props) parts.properties = props;

  const finalSectPr = wChildren(body, 'sectPr').at(-1) ?? null;
  const doc: DocModel = {
    side,
    fileName,
    fingerprint: await sha256Hex(data),
    sizeBytes: data.byteLength,
    blocks: r.blocks,
    partFingerprints: parts,
    sections: sectionsOf(pkg, r.blocks, r.sectionBreaks, finalSectPr, hf),
    revisions: {
      accepted: [...revisions.accepted].map(([type, count]) => ({ type, count })),
      unsupported: revisions.unsupported,
    },
    commentCount: comments.size,
  };
  return { doc, source: r.source, xml, pkg, revisionCount: revisionTotal(revisions), groups: r.groups };
}

