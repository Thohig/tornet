// Långa kodrader: npm run lines [-- --max=200 --code=200 --all]
//
// Listar rader i src/ som är längre än --max tecken där själva koden (utan text i strängar och kommentarer) är
// längre än --code tecken (200: npm run quick och check stoppar nya sådana rader; --code=120 visar nästa att städa).
// Text får vara lång – en replik eller ett hjälpstycke blir inte lättare att läsa av att brytas – men en rad med
// många villkor och anrop blir det. lang-en.js (bara översättningar) räknas inte.
// Avslutas med kod 1 om något hittades, --all listar alla i stället för de 30 längsta.
import { readFileSync, readdirSync } from 'node:fs';
import { tokenizer } from 'acorn';

const arg = (k, d) => Number((process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d);
const MAX = arg('max', 200), CODE = arg('code', 200), ALL = process.argv.includes('--all');
const dir = new URL('../src/', import.meta.url).pathname;

const hits = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'lang-en.js').sort()) {
  const src = readFileSync(dir + f, 'utf8'), lines = src.split('\n');
  // text per rad: tecknen som är strängar, mallsträngarnas text eller kommentarer
  const text = new Array(lines.length).fill(0);
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineOf = pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1; } return lo; };
  const mark = (a, b) => { for (let p = a; p < b;) { const l = lineOf(p), end = Math.min(b, (starts[l + 1] ?? src.length + 1) - 1); text[l] += end - p; p = end + 1; } };
  const onComment = (_block, _t, a, b) => mark(a, b);
  for (const t of tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module', onComment })) {
    if (t.type.label === 'string' || t.type.label === 'template') mark(t.start, t.end);
  }
  lines.forEach((l, i) => {
    const code = l.trimStart().length - text[i];
    if (l.length > MAX && code > CODE) hits.push({ f, n: i + 1, len: l.length, code });
  });
}
hits.sort((a, b) => b.code - a.code);
for (const h of ALL ? hits : hits.slice(0, 30)) console.log(`src/${h.f}:${h.n}  ${h.len} tecken, ${h.code} kod`);
console.log(hits.length ? `\n${hits.length} rader över ${MAX} tecken med mer än ${CODE} tecken kod` : `✓ inga kodrader över ${MAX} tecken`);
process.exit(hits.length ? 1 : 0);
