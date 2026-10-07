// Turn the single-file build into an Artifact page: the Artifact host wraps the
// page in its own <!doctype>/<html>/<head>/<body>, so keep only title, styles,
// the root element and the inline script.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
const out = ['<title>docdiff Prototype</title>', ...styles, '<div id="root"></div>', ...scripts].join('\n');
writeFileSync('dist/artifact.html', out);
console.log(`dist/artifact.html: ${(out.length / 1024).toFixed(0)} KB, ${styles.length} style, ${scripts.length} script`);
