// Open a .docx (OPC zip package) and resolve its parts and relationships.

import JSZip from 'jszip';
import { DocxError, NS, parseXml } from './xml';

export interface Relationship {
  id: string;
  type: string;
  /** Resolved part path inside the zip, or the raw target for external links. */
  target: string;
  external: boolean;
}

export interface DocxPackage {
  zip: JSZip;
  /** Main document part, normally "word/document.xml". */
  documentPath: string;
  /** Relationships of the main document part, by id. */
  rels: Map<string, Relationship>;
  readText(path: string): Promise<string | null>;
  readXml(path: string): Promise<Document | null>;
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Path of the first part related to the main document by a relationship type ending in `typeSuffix`. */
  partByType(typeSuffix: string): string | undefined;
}

const OFFICE_DOCUMENT = '/officeDocument';

/** Resolve a relationship target relative to the part that owns the .rels file. */
function resolvePath(sourcePart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = sourcePart.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function relsPathOf(part: string): string {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

export function parseRels(doc: Document, sourcePart: string): Map<string, Relationship> {
  const map = new Map<string, Relationship>();
  for (const el of Array.from(doc.getElementsByTagNameNS(NS.rels, 'Relationship'))) {
    const id = el.getAttribute('Id') ?? '';
    const external = el.getAttribute('TargetMode') === 'External';
    const raw = el.getAttribute('Target') ?? '';
    map.set(id, { id, type: el.getAttribute('Type') ?? '', target: external ? raw : resolvePath(sourcePart, raw), external });
  }
  return map;
}

/** Recognise files that are clearly not a .docx before handing them to JSZip. */
function sniff(bytes: Uint8Array) {
  const sig = Array.from(bytes.subarray(0, 4));
  // OLE compound file: a password-protected .docx or an old .doc saved with a .docx name.
  if (sig.join() === [0xd0, 0xcf, 0x11, 0xe0].join())
    throw new DocxError('This file is password-protected or is an old Word 97–2003 document. Remove the password or save it as .docx in Word, then try again.');
  if (sig[0] !== 0x50 || sig[1] !== 0x4b) throw new DocxError('This file is not a Word .docx file, or it is damaged.');
}

export async function openDocx(data: ArrayBuffer): Promise<DocxPackage> {
  const bytes = new Uint8Array(data);
  sniff(bytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new DocxError('This file could not be opened. It may be damaged or not a Word .docx file.');
  }

  const readText = async (path: string) => {
    const f = zip.file(path);
    return f ? f.async('string') : null;
  };
  const readXml = async (path: string) => {
    const t = await readText(path);
    return t === null ? null : parseXml(t, path);
  };
  const readBytes = async (path: string) => {
    const f = zip.file(path);
    return f ? f.async('uint8array') : null;
  };

  let documentPath = 'word/document.xml';
  const pkgRels = await readXml('_rels/.rels');
  if (pkgRels) {
    const main = [...parseRels(pkgRels, '').values()].find((r) => r.type.endsWith(OFFICE_DOCUMENT));
    if (main) documentPath = main.target;
  }
  if (!zip.file(documentPath)) throw new DocxError('This file does not contain a Word document body. It may be damaged or another kind of Office file.');

  const docRels = await readXml(relsPathOf(documentPath));
  const rels = docRels ? parseRels(docRels, documentPath) : new Map<string, Relationship>();

  return {
    zip,
    documentPath,
    rels,
    readText,
    readXml,
    readBytes,
    partByType: (suffix) => [...rels.values()].find((r) => !r.external && r.type.endsWith(suffix))?.target,
  };
}
