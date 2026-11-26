// Skelettet till en ny incident: npm run new-incident -- <nyckel> "<Namn>" "<English name>" [emoji] [--visa]
//
//   npm run new-incident -- duva "Duvan i hallen" "Pigeon in the hall" 🐦
//
// Skapar det som varje incident behöver (CLAUDE.md, ”Ny incident”) så att den går att framkalla direkt:
//   src/<nyckel>.js     modulen: egen slumpström, typen, start/tick/reset, när den kan börja; tar slut av sig själv
//   src/state.js        fältet S.<nyckel> i INIT
//   src/systems.js      posten i registret (före vädret): tick, reset, on, trigger, förvarningen
//   src/incui.js        knappen i Framkalla, informationskortet och regissörens klipp
//   src/lang-en.js      engelska mallar för skelettets texter
//   tests/suite.js      ett test: den går att framkalla och tar slut av sig själv
// Sedan står det TODO där innehållet ska in. Skelettet drar inga slumptal förrän incidenten börjar och är inte med
// i dygnets tidtabell (weight) – facit ändras inte förrän du lägger till det. --visa skriver ut i stället för att ändra.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const SHOW = process.argv.includes('--visa');
const [key, name, en, icon = '❗'] = args;
if (!key || !name || !en) {
  console.error('Använd: npm run new-incident -- <nyckel> "<Namn>" "<English name>" [emoji] [--visa]');
  process.exit(2);
}
if (!/^[a-z][a-z0-9]*$/.test(key)) { console.error(`Nyckeln ska vara små bokstäver a–z (utan å, ä, ö): ${key}`); process.exit(2); }
const root = new URL('..', import.meta.url).pathname;
const file = p => root + p;
if (existsSync(file(`src/${key}.js`))) { console.error(`src/${key}.js finns redan`); process.exit(2); }
for (const [p, re] of [['src/state.js', new RegExp(`^\\s*${key}:`, 'm')], ['src/systems.js', new RegExp(`key: '${key}'`)]]) {
  if (re.test(readFileSync(file(p), 'utf8'))) { console.error(`${p} har redan ${key}`); process.exit(2); }
}
const Type = key[0].toUpperCase() + key.slice(1);
const q = s => s.replace(/'/g, "\\'");
const jq = s => JSON.stringify(s);

/** @type {Map<string, string>} sökväg → nytt innehåll */
const out = new Map();
const edit = (p, fn) => { const s = out.get(p) ?? readFileSync(file(p), 'utf8'), r = fn(s); if (r === s) throw new Error(`hittade inte platsen i ${p}`); out.set(p, r); };
/** lägg in text efter raden som matchar re (sista träffen om last) */
const afterLine = (s, re, ins, last = false) => {
  const lines = s.split('\n'), hits = lines.map((l, i) => (re.test(l) ? i : -1)).filter(i => i >= 0);
  if (!hits.length) return s;
  const i = last ? hits[hits.length - 1] : hits[0];
  lines.splice(i + 1, 0, ins);
  return lines.join('\n');
};

// ---------- modulen ----------
out.set(`src/${key}.js`, `// ${name}: TODO – vad som händer, vem som rycker ut och vad driftchefen (eller spelaren) kan välja.
// (Simulering: läget ligger i S.${key}. Egen slumpström.)
import { stream } from './rng.js';
const { rand } = stream('${key}');
import { S, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';

/**
 * ${name} (S.${key}): t0 = när den började, ph = 'on' → 'done', len = hur länge den håller på (s).
 * @typedef {{ t0: number, ph: string, len: number }} ${Type}
 */

/** kan den börja just nu? */
export const ${key}Possible = () => !S.${key} && !S.fire && S.power;

/** Slumpen eller spelaren (act('trigger', '${key}')): den börjar. false om den inte kan börja nu. */
export function start${Type}() {
  if (!${key}Possible()) return false;
  S.${key} = { t0: S.t, ph: 'on', len: rand(60, 120) };
  log('${icon} ${q(name)}!', 'alert');
  incidentStarted(null);
  return true;
}

/** @param {number} _dt */
export function ${key}Tick(_dt) {
  const X = S.${key};
  if (!X) return;
  // TODO: det som händer medan den pågår
  if (X.ph === 'on' && S.t - X.t0 >= X.len) {
    X.ph = 'done';
    incidentOver('${key}', '✅ ${q(name)} är över', \`Det tog \${Math.round(S.t - X.t0)} s.\`);
    S.${key} = null;
  }
}

export function ${key}Reset() { S.${key} = null; }
`);

// ---------- S.<nyckel> ----------
edit('src/state.js', s => afterLine(s, /^\s*gondola: \/\*\* @type .*leak: /,
  `  ${key}: /** @type {import('./${key}.js').${Type}|null} */ (null), // ${name} (${key}.js)`));

// ---------- registret ----------
edit('src/systems.js', s => {
  s = afterLine(s, /^import /, `import { ${key}Reset, ${key}Tick, start${Type} } from './${key}.js';`, true);
  return s.replace(/(\n\s*\/\/ vädret: stormen blåser)/, `
    // ${name} (${key}.js) – TODO: weight: () => ${key}Possible() && 0.3 för dygnets tidtabell (ändrar facit: npm run golden),
    // chief (beslutet i chief.js), chaos (ett steg i Murphys lag), roles/spot/blocks/out om folket eller hissarna berörs
    { key: '${key}', tick: ${key}Tick, reset: ${key}Reset, on: () => !!S.${key}, trigger: () => start${Type}(),
      warnS: 8, warn: () => '${icon} TODO: förvarningen…', hit: () => start${Type}() },$1`);
});

// ---------- gränssnittet ----------
edit('src/incui.js', s => {
  s = afterLine(s, /^import /, `import { ${key}Possible } from './${key}.js';`, true);
  return s.replace(/\n {2}\];\n\}\s*$/, `
  {
    key: '${key}',
    trig: { icon: '${icon}', name: '${q(name)}', hint: 'TODO: vad som händer', off: () => !${key}Possible(),
      why: () => (S.${key} ? 'den pågår redan' : 'det går inte just nu') },
    warn: (_W, add) => add('warn', 76, 'floor', LOBBY, '${icon} TODO: förvarningen', true),
    card: (h, parts) => {
      const { card, cd, line } = h;
      // TODO: ett kort med val (alert) när spelaren kan göra något: chiefLine, acts, choice, hint
      const X = S.${key};
      if (X && X.ph === 'on') parts.push(card('${key}', 'info ${key}', '${icon} ${q(name)}', \`
          \${line(\`TODO: vad som händer. Över \${cd(X.t0 + X.len - S.t)}.\`)}\`));
    },
    shots: (add) => {
      const X = S.${key};
      if (X && X.ph === 'on') add('${key}', 70, 'floor', LOBBY, '${icon} ${q(name)}', S.t - X.t0 < 1);
    },
  },
  ];
}
`);
});

// ---------- engelska ----------
edit('src/lang-en.js', s => s.replace(/\n\};\s*$/, `
  // ${name} (${key}.js) – TODO: översätt
  ${jq(name)}: ${jq(en)},
  ${jq(`${name}!`)}: ${jq(`${en}!`)},
  ${jq(`✅ ${name} är över`)}: ${jq(`✅ ${en} is over`)},
  "TODO: vad som händer": "TODO: what happens",
  "TODO: förvarningen": "TODO: the warning",
  "TODO: förvarningen…": "TODO: the warning…",
  "TODO: vad som händer. Över {0}.": "TODO: what happens. Over {0}.",
};
`));
// (mallar som redan finns läggs inte in två gånger)
{
  const s = out.get('src/lang-en.js'), seen = new Set(), lines = s.split('\n');
  const keyOf = l => (l.match(/^ {2}("(?:[^"\\]|\\.)*"):/) || [])[1];
  const kept = lines.filter(l => { const k = keyOf(l); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; });
  out.set('src/lang-en.js', kept.join('\n'));
}

// ---------- testet ----------
edit('tests/suite.js', s => s.replace(/\ntest\('Språket:/, `
test('${q(name)}: går att framkalla och tar slut av sig själv', () => {
  sim(3, { roll: 'mjuk', incLevel: 'av' });
  while (hour() < 10) step(DT);
  assert(act('trigger', '${key}') === true, 'gick inte att framkalla');
  assert(S.${key}, 'S.${key} sattes inte');
  let g = 0;
  while (S.${key} && ++g < 600 / DT) step(DT);
  assert(!S.${key}, 'tog aldrig slut');
  return \`över efter \${Math.round(g * DT)} s\`;
});

test('Språket:`));

for (const [p, s] of out) {
  if (SHOW) { console.log(`===== ${p}`); console.log(p === `src/${key}.js` ? s : '(ändrad)'); continue; }
  writeFileSync(file(p), s);
  console.log(`✓ ${p}`);
}
if (!SHOW) console.log(`
Nu: npm run quick. Sedan, där det står TODO:
  - src/${key}.js: vad som händer, vem som kommer (callJanitor i crew.js, makePerson …) och när det är över
  - src/systems.js: weight (dygnets tidtabell), chief, chaos, roles/spot/blocks/out – sedan npm run golden
  - src/incui.js: kortet med val (data-act="${key}:val" → ACTIONS i actions.js och PLAYER_ACTIONS i tests/suite.js)
  - src/chief.js: driftchefens beslut med skäl (${key}ChiefTick), chiefLine('${key}', …) på kortet
  - grafiken (pix*.js), regissörens klipp (shots), ljudet (sound i incui.js) och texterna i lang-en.js
  - CHANGELOG.md, README.md, CLAUDE.md (modultabellen) och IDEER.md (stryk idén)`);
