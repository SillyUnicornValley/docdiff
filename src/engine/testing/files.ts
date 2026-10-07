/// <reference types="node" />
// Test helper: load a file from testdocs/docs (vitest runs from the repo root).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function testdoc(name: string): ArrayBuffer {
  const buf = readFileSync(join(process.cwd(), 'testdocs', 'docs', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
