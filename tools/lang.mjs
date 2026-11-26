// Språket: listar texterna i src/*.js som saknar en engelsk mall i lang-en.js (npm run lang).
// Texterna tas ur källkoden: strängar och mallsträngar (${…} → {0}, {1} …), delade vid html-taggar, med
// data-hint/title som egna texter. Lägg till det som saknas i lang-en.js (svensk mall → engelsk mall).
// sv`…` (sv.js) och sh`…` (lang.js) kontrolleras exakt: mallen måste stå i lang-en.js precis så som den står i koden. --check = bara
// den kontrollen, med felkod om någon mall saknas (npm run quick och check kör den).
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import fs from 'fs';
import path from 'path';
const SRC = new URL('../src', import.meta.url).pathname;
const SKIP = new Set(['scoreData.js', 'prof.js', 'rng.js', 'lang.js', 'lang-en.js']);
const out = new Map(); // mall → filer
const struct = new Set();
const suffix = [];
/** taggarna vars mall slås upp exakt: sv`…` (sv.js) och html-mallen sh`…` (lang.js) */
const EXACT = new Set(['sv', 'sh']);
/** sv`…` och sh`…`: mallen → var den står (fil:rad) */
const svKeys = new Map();
const CHECK = process.argv.includes('--check'); // svenska ändelser som eget värde: `hiss${n > 1 ? 'ar' : ''}` (se CLAUDE.md – skriv hela orden)
function addHtml(s, file) {
  // attribut med text
  for (const m of s.matchAll(/(?:data-hint|title|aria-label|placeholder)="([^"]*)"/g)) addHtml(m[1], file);
  // (attributen tas bort innan resten delas vid taggarna: en förklaring kan själv innehålla <b> och <br>)
  s = s.replace(/(?:data-hint|title|aria-label|placeholder)="[^"]*"/g, '');
  for (let frag of s.split(/<[^>]*>/)) {
    frag = frag.replace(/&nbsp;/g, ' ').trim();
    if (!frag) continue;
    // numrera platshållarna om i fragmentet
    let i = 0; frag = frag.replace(/\{\d+\}/g, () => `{${i++}}`);
    const letters = frag.replace(/\{\d+\}/g, '').match(/[A-Za-zÅÄÖåäöÉé]/g) || [];
    if (letters.length < 2) {
      // strukturmallar utan ord ("{0}: {1} → {2}"): värdena översätts, resten står kvar
      if ((frag.match(/\{\d+\}/g) || []).length >= 2 && /[:→·–(]/.test(frag.replace(/\{\d+\}/g, ''))) struct.add(frag);
      continue;
    }
    if (!/[\sÅÄÖåäö]/.test(frag) && /^[a-z0-9_:.\-#/?=&{}]+$/.test(frag)) continue; // identifierare, klasser, data-act
    if (/^#[0-9a-f]{3,8}$/i.test(frag) || /^(rgba?|hsl)\(/.test(frag) || /^\d+(px|%|s)$/.test(frag)) continue;
    if (!out.has(frag)) out.set(frag, new Set());
    out.get(frag).add(file);
  }
}
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js') && !SKIP.has(f))) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  walk.fullAncestor(ast, (n, _st, anc) => {
    const parent = anc[anc.length - 2];
    if (anc.some(a => a.type === 'ImportDeclaration' || a.type === 'ExportNamedDeclaration' && a.source)) return;
    // slumpströmmarnas namn (stream('väder')) och konsolens meddelanden visas aldrig för spelaren
    if (anc.some(a => a.type === 'CallExpression' && (a.callee.type === 'Identifier' && a.callee.name === 'stream'
      || a.callee.type === 'MemberExpression' && a.callee.object.type === 'Identifier' && a.callee.object.name === 'console'))) return;
    if (n.type === 'Literal' && typeof n.value === 'string') {
      if (parent && parent.type === 'Property' && parent.key === n) return;
      if (parent && parent.type === 'MemberExpression' && parent.property === n) return;
      addHtml(n.value, f);
    } else if (n.type === 'TaggedTemplateExpression' && n.tag.type === 'Identifier' && EXACT.has(n.tag.name)) {
      const q = n.quasi;
      let key = '';
      q.quasis.forEach((x, i) => { key += x.value.cooked; if (i < q.expressions.length) key += `{${i}}`; });
      if (!svKeys.has(key)) svKeys.set(key, `${f}:${code.slice(0, n.start).split('\n').length}`);
    } else if (n.type === 'TemplateLiteral') {
      if (parent && parent.type === 'TaggedTemplateExpression' && !(parent.tag.type === 'Identifier' && parent.tag.name === 'sv')) return; // (sh`…` översätts bara som hel mall)
      // ett ord som slutar med ${villkor ? 'ar' : ''}: ändelsen blir ett värde som lang-en.js inte kan översätta
      n.expressions.forEach((x, i) => {
        const short = y => y.type === 'Literal' && typeof y.value === 'string' && /^[a-zåäö]{0,3}$/.test(y.value);
        if (x.type === 'ConditionalExpression' && short(x.consequent) && short(x.alternate) && /[a-zåäö]$/.test(n.quasis[i].value.cooked)) {
          const line = code.slice(0, x.start).split('\n').length;
          suffix.push(`${f}:${line}\t${code.slice(n.start, n.end).slice(0, 100)}`);
        }
      });
      let s2 = '';
      n.quasis.forEach((q, i) => { s2 += q.value.cooked; if (i < n.expressions.length) s2 += `{${i}}`; });
      addHtml(s2, f);
    }
  });
}
// mallar som saknas i lang-en.js (en strukturmall utan ord räknas inte)
const EN = (await import('../src/lang-en.js')).default;
const svMiss = [...svKeys].filter(([k]) => !(k in EN));
if (CHECK) {
  for (const [k, at] of svMiss) console.log(`${at}\t${JSON.stringify(k)}`);
  console.log(svMiss.length ? `\n✗ ${svMiss.length} av ${svKeys.size} sv\`…\` saknar sin mall i lang-en.js` : `✓ alla ${svKeys.size} sv\`…\` har sin mall i lang-en.js`);
  process.exit(svMiss.length ? 1 : 0);
}
const miss = [...out.keys()].filter(k => !(k in EN));
for (const k of miss) console.log(`${[...out.get(k)].join(',')}\t${JSON.stringify(k)}`);
if (suffix.length) console.log(`\nSvenska ändelser som eget värde – skriv hela orden i båda grenarna:\n${suffix.join('\n')}`);
if (svMiss.length) console.log(`\nsv\`…\` utan sin mall i lang-en.js:\n${svMiss.map(([k, at]) => `${at}\t${JSON.stringify(k)}`).join('\n')}`);
console.log(`\n${out.size} texter i koden · ${miss.length} utan engelsk mall (en del är kod – namn, nycklar – och ska inte översättas)`);
console.log(`${svKeys.size} sv\`…\` · ${svMiss.length} utan sin mall`);
