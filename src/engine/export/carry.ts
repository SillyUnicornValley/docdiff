// Carry what old content refers to into the new file (decision 43, stage5-design §3).
//
// Content copied from the old file keeps references to the old package:
//  - relationship ids (r:id, r:embed…) of hyperlinks and pictures → new
//    relationships in the new part, pictures copied into word/media;
//  - footnote / endnote references → the note is copied into the new file's
//    notes part under a fresh id;
//  - drawing ids (wp:docPr/@id) → renumbered, Word wants them unique.
// Charts, embedded objects and other parts are never carried: "Use old" is not
// available for them (src/model/useOld.ts), and meeting one here is an error.

import type { ParsedDocx } from '../docx/parseDocx';
import { parseRels, relsPathOf, type Relationship } from '../docx/package';
import { NS, parseXml, wAttr, wChildren } from '../docx/xml';
import type { Importer } from './importOld';
import { ExportError } from './paragraphEdit';

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

function serialize(doc: Document): string {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith('<?xml') ? s : XML_DECL + s;
}

/** Target of a relationship from `fromPart` to `toPath`, relative to the source part's folder. */
function relativeTarget(fromPart: string, toPath: string): string {
  const from = fromPart.split('/').slice(0, -1);
  const to = toPath.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

/** Relationships of one part of the new file, with additions. */
class RelsWriter {
  private ids: Set<string>;
  private added = new Map<string, string>();
  private n = 0;
  dirty = false;

  constructor(
    readonly part: string,
    readonly doc: Document,
  ) {
    this.ids = new Set(Array.from(doc.getElementsByTagNameNS(NS.rels, 'Relationship')).map((r) => r.getAttribute('Id') ?? ''));
  }

  add(type: string, target: string, external: boolean): string {
    const key = `${type}|${target}|${external}`;
    const hit = this.added.get(key);
    if (hit) return hit;
    let id: string;
    do id = `rIdDd${++this.n}`;
    while (this.ids.has(id));
    this.ids.add(id);
    const el = this.doc.createElementNS(NS.rels, 'Relationship');
    el.setAttribute('Id', id);
    el.setAttribute('Type', type);
    el.setAttribute('Target', target);
    if (external) el.setAttribute('TargetMode', 'External');
    this.doc.documentElement.appendChild(el);
    this.added.set(key, id);
    this.dirty = true;
    return id;
  }
}

interface NotesPart {
  local: 'footnote' | 'endnote';
  /** Old file: the notes by id, and the relationships of the old notes part. */
  oldNotes: Map<string, Element>;
  oldRels: Map<string, Relationship>;
  /** New file: notes part path and XML (absent: the new file has no notes part). */
  newPath?: string;
  newDoc?: Document;
  nextId: number;
  copied: Map<string, string>;
  importer?: Importer;
}

export class Carrier {
  private writers = new Map<string, RelsWriter>();
  /** Old media path → new media path. */
  private media = new Map<string, string>();
  private contentTypes: Document | null = null;
  private ctDirty = false;
  private nextDocPr = 0;
  private notes: Record<'footnoteReference' | 'endnoteReference', NotesPart> | null = null;

  constructor(
    private o: ParsedDocx,
    private n: ParsedDocx,
  ) {}

  /** Read what carrying may touch. `makeImporter` gives an importer that writes into a given document. */
  async init(makeImporter: (doc: Document) => Importer) {
    this.contentTypes = await this.n.pkg.readXml('[Content_Types].xml');
    for (const d of Array.from(this.n.xml.getElementsByTagNameNS(NS.wp, 'docPr'))) this.nextDocPr = Math.max(this.nextDocPr, Number(d.getAttribute('id')) || 0);
    const notes = async (suffix: string, local: 'footnote' | 'endnote'): Promise<NotesPart> => {
      const oldPath = this.o.pkg.partByType(suffix);
      const oldDoc = oldPath ? await this.o.pkg.readXml(oldPath) : null;
      const oldRelsDoc = oldPath ? await this.o.pkg.readXml(relsPathOf(oldPath)) : null;
      const newPath = this.n.pkg.partByType(suffix);
      const newDoc = newPath ? ((await this.n.pkg.readXml(newPath)) ?? undefined) : undefined;
      const part: NotesPart = {
        local,
        oldNotes: new Map(oldDoc ? wChildren(oldDoc.documentElement, local).map((e) => [wAttr(e, 'id') ?? '', e] as const) : []),
        oldRels: oldRelsDoc && oldPath ? parseRels(oldRelsDoc, oldPath) : new Map(),
        newPath,
        newDoc,
        nextId: newDoc ? Math.max(0, ...wChildren(newDoc.documentElement, local).map((e) => Number(wAttr(e, 'id')) || 0)) + 1 : 1,
        copied: new Map(),
      };
      if (newDoc) part.importer = makeImporter(newDoc);
      if (newPath) await this.writer(newPath);
      return part;
    };
    this.notes = { footnoteReference: await notes('/footnotes', 'footnote'), endnoteReference: await notes('/endnotes', 'endnote') };
    await this.writer(this.n.pkg.documentPath);
  }

  private async writer(part: string): Promise<RelsWriter> {
    let w = this.writers.get(part);
    if (!w) {
      const doc =
        (await this.n.pkg.readXml(relsPathOf(part))) ??
        parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rels}"/>`, relsPathOf(part));
      w = new RelsWriter(part, doc);
      this.writers.set(part, w);
    }
    return w;
  }

  /** Old content now inside the new main document: fix its references. */
  carryIntoBody(el: Element) {
    this.carry(el, this.o.pkg.rels, this.n.pkg.documentPath);
  }

  private carry(el: Element, oldRels: Map<string, Relationship>, newPart: string) {
    const writer = this.writers.get(newPart);
    if (!writer) throw new ExportError(`Internal error: no relationships for ${newPart}.`);
    const all = [el, ...Array.from(el.getElementsByTagName('*'))];
    for (const e of all) {
      for (const a of Array.from(e.attributes)) {
        if (a.namespaceURI !== NS.r) continue;
        const rel = oldRels.get(a.value);
        if (!rel) throw new ExportError(`The old file refers to a missing relationship (${a.value}).`);
        a.value = this.mapRel(rel, writer);
      }
      if (e.namespaceURI === NS.wp && e.localName === 'docPr') e.setAttribute('id', String(++this.nextDocPr));
    }
    if (newPart !== this.n.pkg.documentPath) return;
    for (const local of ['footnoteReference', 'endnoteReference'] as const) {
      for (const ref of Array.from(el.getElementsByTagNameNS(NS.w, local))) ref.setAttributeNS(NS.w, 'w:id', this.copyNote(local, wAttr(ref, 'id') ?? ''));
    }
  }

  private mapRel(rel: Relationship, writer: RelsWriter): string {
    if (rel.external) return writer.add(rel.type, rel.target, true);
    if (rel.type.endsWith('/image')) {
      let path = this.media.get(rel.target);
      if (!path) {
        const ext = (rel.target.split('.').pop() ?? 'bin').toLowerCase();
        let k = this.media.size + 1;
        do path = `word/media/docdiff${k++}.${ext}`;
        while (this.n.pkg.zip.file(path));
        this.media.set(rel.target, path);
        this.ensureContentType(path, ext);
      }
      return writer.add(rel.type, relativeTarget(writer.part, path), false);
    }
    if (rel.type.endsWith('/hyperlink')) return writer.add(rel.type, rel.target, false);
    throw new ExportError(`This content refers to a part that cannot be copied (${rel.type.split('/').pop()}).`);
  }

  private ensureContentType(path: string, ext: string) {
    const root = this.contentTypes?.documentElement;
    if (!root) return;
    const has = Array.from(root.getElementsByTagNameNS(CT_NS, 'Default')).some((d) => (d.getAttribute('Extension') ?? '').toLowerCase() === ext);
    if (has) return;
    const type = IMAGE_TYPES[ext];
    const el = this.contentTypes!.createElementNS(CT_NS, type ? 'Default' : 'Override');
    if (type) {
      el.setAttribute('Extension', ext);
      el.setAttribute('ContentType', type);
      // Defaults come before overrides.
      root.insertBefore(el, root.getElementsByTagNameNS(CT_NS, 'Override')[0] ?? null);
    } else {
      el.setAttribute('PartName', `/${path}`);
      el.setAttribute('ContentType', 'application/octet-stream');
      root.appendChild(el);
    }
    this.ctDirty = true;
  }

  /** Copy one old note into the new notes part; returns its new id. */
  private copyNote(kind: 'footnoteReference' | 'endnoteReference', oldId: string): string {
    const part = this.notes![kind];
    const hit = part.copied.get(oldId);
    if (hit) return hit;
    const src = part.oldNotes.get(oldId);
    if (!src || !part.newDoc || !part.importer || !part.newPath) throw new ExportError(`The new file has no ${part.local}s to add this ${part.local} to.`);
    const el = part.importer.import(src, true, false);
    const id = String(part.nextId++);
    el.setAttributeNS(NS.w, 'w:id', id);
    el.removeAttributeNS(NS.w, 'type');
    this.carry(el, part.oldRels, part.newPath);
    part.newDoc.documentElement.appendChild(el);
    part.copied.set(oldId, id);
    return id;
  }

  /** Write everything that changed into the new package. */
  async finish() {
    const zip = this.n.pkg.zip;
    for (const [oldPath, newPath] of this.media) {
      const bytes = await this.o.pkg.readBytes(oldPath);
      if (!bytes) throw new ExportError(`A picture of the old file is missing (${oldPath}).`);
      zip.file(newPath, bytes);
    }
    for (const w of this.writers.values()) if (w.dirty) zip.file(relsPathOf(w.part), serialize(w.doc));
    if (this.ctDirty && this.contentTypes) zip.file('[Content_Types].xml', serialize(this.contentTypes));
    for (const part of Object.values(this.notes ?? {})) if (part.copied.size && part.newDoc && part.newPath) zip.file(part.newPath, serialize(part.newDoc));
  }
}
