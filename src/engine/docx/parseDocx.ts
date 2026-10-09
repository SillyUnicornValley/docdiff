// .docx → DocModel. Runs on the main thread (decision 22). The returned XML is
// the revision-accepted working copy that a later export modifies.

import type { CommentItem, DocModel, DocParts, DocSection, FingerprintedPart, HeaderFooterRef, HeaderVariant, NodeId, Side } from '../../model/document';
import { hashBytes, hashString, sha256Hex } from '../hash';
import { acceptAllRevisions, revisionTotal } from './acceptRevisions';
import { NumberingState } from './numbering';
import { openDocx, parseRels, relsPathOf, type DocxPackage, type Relationship } from './package';
import { BodyReader } from './readBody';
import { FormatResolver } from './formatting';
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

/**
 * Can a note be copied into another file (decision 43)? Not when it holds a
 * text box or embedded object, or refers to a part other than a picture or a link.
 */
function portableNote(n: Element, rels: Map<string, Relationship>): boolean {
  if (n.getElementsByTagNameNS(NS.w, 'txbxContent').length || n.getElementsByTagNameNS(NS.w, 'object').length) return false;
  for (const el of Array.from(n.getElementsByTagName('*'))) {
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI !== NS.r) continue;
      const rel = rels.get(a.value);
      if (!rel || (!rel.external && !rel.type.endsWith('/image') && !rel.type.endsWith('/hyperlink'))) return false;
    }
  }
  return true;
}

async function notesText(pkg: DocxPackage, relSuffix: string, local: 'footnote' | 'endnote') {
  const map = new Map<string, string>();
  const nonPortable = new Set<string>();
  const elements = new Map<string, Element>();
  const path = pkg.partByType(relSuffix);
  const doc = path ? await pkg.readXml(path) : null;
  if (!doc || !path) return { map, nonPortable, elements, present: false };
  acceptAllRevisions(doc.documentElement);
  const relsDoc = await pkg.readXml(relsPathOf(path));
  const rels = relsDoc ? parseRels(relsDoc, path) : new Map<string, Relationship>();
  for (const n of wChildren(doc.documentElement, local)) {
    const type = wAttr(n, 'type');
    if (type && type !== 'normal') continue; // separators
    const id = wAttr(n, 'id') ?? '';
    map.set(id, plainText(n));
    elements.set(id, n);
    if (!portableNote(n, rels)) nonPortable.add(id);
  }
  return { map, nonPortable, elements, present: true };
}

async function commentsOf(pkg: DocxPackage) {
  const map = new Map<string, { author: string; preview: string; text: string }>();
  const path = pkg.partByType('/comments');
  const doc = path ? await pkg.readXml(path) : null;
  if (!doc) return map;
  for (const c of wChildren(doc.documentElement, 'comment')) {
    const text = wChildren(c, 'p')
      .map((p) => plainText(p))
      .join(' ')
      .trim();
    map.set(wAttr(c, 'id') ?? '', { author: wAttr(c, 'author') ?? 'Unknown', preview: text.length > 80 ? `${text.slice(0, 80)}…` : text, text });
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

/** Header/footer part path → fingerprint of its text; and the parts themselves. */
async function headerFooterFingerprints(pkg: DocxPackage) {
  const map = new Map<string, string>();
  const roots = new Map<string, Element>();
  for (const r of pkg.rels.values()) {
    if (r.external || !(r.type.endsWith('/header') || r.type.endsWith('/footer'))) continue;
    const doc = await pkg.readXml(r.target);
    if (!doc) continue;
    acceptAllRevisions(doc.documentElement);
    // Fields such as PAGE show cached numbers; compare the visible text, which is what a reader sees.
    map.set(r.target, hashString(plainText(doc.documentElement)));
    roots.set(r.target, doc.documentElement);
  }
  return { map, roots };
}

const PROPERTY_NAMES: [string, 'dc' | 'cp', string][] = [
  ['Title', 'dc', 'title'],
  ['Subject', 'dc', 'subject'],
  ['Description', 'dc', 'description'],
  ['Keywords', 'cp', 'keywords'],
  ['Category', 'cp', 'category'],
];

async function propertiesOf(pkg: DocxPackage): Promise<Record<string, string>> {
  const core = await pkg.readXml('docProps/core.xml');
  const out: Record<string, string> = {};
  if (!core) return out;
  const ns = { dc: 'http://purl.org/dc/elements/1.1/', cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties' };
  for (const [label, prefix, local] of PROPERTY_NAMES) {
    const v = core.getElementsByTagNameNS(ns[prefix], local)[0]?.textContent?.trim();
    if (v) out[label] = v;
  }
  return out;
}

/** Text inside each comment range, in document order (decision 46). */
function commentAnchors(body: Element): Map<string, string> {
  const text = new Map<string, string>();
  const open = new Set<string>();
  // A plain walk: a '*' element query over a large body is very slow in some DOMs.
  const visit = (el: Element) => {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI === NS.w) {
        if (c.localName === 'commentRangeStart') {
          const id = wAttr(c, 'id') ?? '';
          open.add(id);
          if (!text.has(id)) text.set(id, '');
          continue;
        }
        if (c.localName === 'commentRangeEnd') {
          open.delete(wAttr(c, 'id') ?? '');
          continue;
        }
        if (c.localName === 't') {
          for (const id of open) text.set(id, text.get(id)! + (c.textContent ?? ''));
          continue;
        }
      }
      if (c.firstElementChild) visit(c);
    }
  };
  visit(body);
  return text;
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
      if (target && hf.has(target)) m[v] = { fingerprint: hf.get(target)!, part: target };
      // No own header of this kind: Word reuses the previous section's ("Link to Previous").
      else if (prev?.[v]) m[v] = { fingerprint: prev[v]!.fingerprint, linkedToPrevious: true, part: prev[v]!.part };
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
  const stylesXml = stylesPath ? await pkg.readXml(stylesPath) : null;
  const styles = new StyleMap(stylesXml);
  const numbering = new NumberingState(numberingPath ? await pkg.readXml(numberingPath) : null, styles);
  const fn = await notesText(pkg, '/footnotes', 'footnote');
  const en = await notesText(pkg, '/endnotes', 'endnote');
  const footnotes = fn.map;
  const endnotes = en.map;
  const comments = await commentsOf(pkg);
  const media = await mediaFingerprints(pkg);
  const hf = await headerFooterFingerprints(pkg);

  const ctx = { side, styles, numbering, rels: pkg.rels, footnotes, endnotes, nonPortableNotes: { footnotes: fn.nonPortable, endnotes: en.nonPortable }, comments, media, formats: new FormatResolver(stylesXml) };
  const reader = new BodyReader(ctx);
  const r = reader.readBody(body);

  // Content outside the body, read the same way, for the Other parts tab (decision 45).
  // Separate readers with their own id prefixes keep node ids unique.
  const sub = (idPrefix: string) => new BodyReader({ ...ctx, idPrefix });
  const notes = (ids: string[], els: Map<string, Element>, label: string, prefix: string) => {
    const rd = sub(prefix);
    return ids.flatMap((id, k) => {
      const el = els.get(id);
      return el ? [{ id, label: `${label} ${k + 1}`, blocks: rd.readContainer(el) }] : [];
    });
  };
  const hfReader = sub('h');
  const tbReader = sub('x');
  const docParts: DocParts = {
    footnotes: notes(r.noteRefs.footnotes, fn.elements, 'Footnote', 'f'),
    endnotes: notes(r.noteRefs.endnotes, en.elements, 'Endnote', 'e'),
    headersFooters: Object.fromEntries([...hf.roots].map(([path, root]) => [path, hfReader.readContainer(root)])),
    textBoxes: r.textBoxElements.map((el) => tbReader.readContainer(el)),
    properties: await propertiesOf(pkg),
  };
  const anchors = commentAnchors(body);
  const commentItems: CommentItem[] = [...r.commentBlocks.keys()].flatMap((id) => {
    const c = comments.get(id);
    return c ? [{ id, author: c.author, text: c.text, anchor: anchors.get(id) ?? '', blockId: r.commentBlocks.get(id) }] : [];
  });

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
    sections: sectionsOf(pkg, r.blocks, r.sectionBreaks, finalSectPr, hf.map),
    revisions: {
      accepted: [...revisions.accepted].map(([type, count]) => ({ type, count })),
      unsupported: revisions.unsupported,
    },
    commentCount: comments.size,
    parts: docParts,
    comments: commentItems,
    runFormats: r.runFormats,
    bookmarks: [...new Set(Array.from(body.getElementsByTagNameNS(NS.w, 'bookmarkStart')).map((b) => wAttr(b, 'name') ?? ''))].filter(Boolean),
    notesParts: { footnotes: fn.present, endnotes: en.present },
  };
  return { doc, source: r.source, xml, pkg, revisionCount: revisionTotal(revisions), groups: r.groups };
}

