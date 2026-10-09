// @vitest-environment jsdom
import { it } from 'vitest';
import { compareFiles } from './index';
import { testdoc } from './testing/files';
it('probe', async () => {
  for (const p of ['17-notes-links-images', '18-comments', '05-uncompared-and-comments', '09-sections-headers']) {
    const { result } = await compareFiles({ name: 'o', data: testdoc(`${p}_old.docx`) }, { name: 'n', data: testdoc(`${p}_new.docx`) });
    const op = result.otherParts!;
    const pp = (xs: any[]) => xs.map((x) => `${x.label}:${x.status}`).join(' | ');
    process.stdout.write(`== ${p}\n FN ${pp(op.footnotes)}\n EN ${pp(op.endnotes)}\n HF ${pp(op.headersFooters)}\n TB ${pp(op.textBoxes)}\n LINKS ${JSON.stringify(op.links.map(l=>[l.text,l.old,l.new]))}\n IMG ${JSON.stringify(op.images.map(i=>i.text))}\n PROPS ${JSON.stringify(op.properties)}\n CMT ${op.comments.map((c) => `${c.status}:${(c.new ?? c.old)!.author}:${(c.new ?? c.old)!.anchor}`).join(' | ')}\n`);
  }
}, 60000);
