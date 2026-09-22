import { readFileSync } from 'node:fs';
import { classifyMono, DATA_LITERAL } from './ui-mono-map.mjs';
import { enclosingRun, enclosingTag } from './ui-type-inventory.mjs';

const file = process.argv[2];
const needle = process.argv[3];
const src = readFileSync(file, 'utf8');

function elementBody(s, idx) {
  const after = s.slice(idx, idx + 1600);
  const gt = after.indexOf('>');
  if (gt < 0) return '';
  let t = after.slice(gt + 1, gt + 1 + 420);
  t = t.replace(/className=(?:"[^"]*"|\{[^}]*\})/g, ' ');
  t = t.replace(/style=\{\{[^}]*\}\}/g, ' ');
  t = t.replace(/<[^>]*>/g, ' ');
  return t.trim().replace(/\s+/g, ' ').slice(0, 260);
}

const i = src.indexOf(needle);
if (i < 0) { console.log('needle not found'); process.exit(1); }
// find the font-mono token at or after the needle, or use the needle position
const at = i;
const body = elementBody(src, at);
const tag = enclosingTag(src, at);
const run = enclosingRun(src, at) || '';
console.log('tag  :', tag);
console.log('run  :', JSON.stringify(run.slice(0, 80)));
console.log('body :', JSON.stringify(body.slice(0, 160)));
console.log('literals that match:', DATA_LITERAL.map((re, n) => (re.test(body) ? n : null)).filter((x) => x !== null));
console.log('verdict:', classifyMono({ tag, run, body }));
