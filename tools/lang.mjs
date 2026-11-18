// Språket: listar texterna i src/*.js som saknar en engelsk mall i lang-en.js (npm run lang).
// Texterna tas ur källkoden: strängar och mallsträngar (${…} → {0}, {1} …), delade vid html-taggar, med
// data-hint/title som egna texter. Lägg till det som saknas i lang-en.js (svensk mall → engelsk mall).
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import fs from 'fs';
import path from 'path';
const SRC = new URL('../src', import.meta.url).pathname;
const SKIP = new Set(['scoreData.js', 'prof.js', 'rng.js', 'lang.js', 'lang-en.js']);
const out = new Map(); // mall → filer
const struct = new Set();
function addHtml(s, file) {
  // attribut med text
  for (const m of s.matchAll(/(?:data-hint|title|aria-label|placeholder)="([^"]*)"/g)) addHtml(m[1], file);
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
    if (n.type === 'Literal' && typeof n.value === 'string') {
      if (parent && parent.type === 'Property' && parent.key === n) return;
      if (parent && parent.type === 'MemberExpression' && parent.property === n) return;
      addHtml(n.value, f);
    } else if (n.type === 'TemplateLiteral') {
      if (parent && parent.type === 'TaggedTemplateExpression') return;
      let s2 = '';
      n.quasis.forEach((q, i) => { s2 += q.value.cooked; if (i < n.expressions.length) s2 += `{${i}}`; });
      addHtml(s2, f);
    }
  });
}
// mallar som saknas i lang-en.js (en strukturmall utan ord räknas inte)
const EN = (await import('../src/lang-en.js')).default;
const miss = [...out.keys()].filter(k => !(k in EN));
for (const k of miss) console.log(`${[...out.get(k)].join(',')}\t${JSON.stringify(k)}`);
console.log(`\n${out.size} texter i koden · ${miss.length} utan engelsk mall (en del är kod – namn, nycklar – och ska inte översättas)`);
