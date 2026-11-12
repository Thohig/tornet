// Kör testsviten i terminalen:   npm test            (alla tester)
//                                 npm test -- natt    (bara tester vars namn innehåller "natt")
//                                 npm run golden      (skriv om facit för regressionstestet)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tests, Fail, setGolden, GOLDEN_CASES, caseKey, dayFingerprint } from './suite.js';
import { SIM_VERSION } from '../src/replay.js';

const goldenPath = new URL('./golden.json', import.meta.url);
const args = process.argv.slice(2);
const c = { ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' };

if (args.includes('--update-golden')) {
  const old = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : null;
  const g = { _simVersion: SIM_VERSION };
  for (const gc of GOLDEN_CASES) { g[caseKey(gc)] = dayFingerprint(gc); process.stdout.write('.'); }
  // ändrat beteende ⇒ gamla replay-länkar ger ett annat dygn, så simuleringens version måste höjas
  const changed = old && GOLDEN_CASES.some(gc => JSON.stringify(old[caseKey(gc)]) !== JSON.stringify(g[caseKey(gc)]));
  if (changed && old._simVersion === SIM_VERSION) {
    console.log(`\n${c.bad}✗ Beteendet har ändrats men SIM_VERSION är fortfarande ${SIM_VERSION}.${c.off}`);
    console.log(`  Höj SIM_VERSION i src/replay.js (gamla replay-länkar ger annars ett annat dygn utan förklaring) och kör igen.`);
    process.exit(1);
  }
  writeFileSync(goldenPath, JSON.stringify(g, null, 2) + '\n');
  console.log(`\nFacit uppdaterat: ${GOLDEN_CASES.length} dygn skrivna till tests/golden.json`);
  process.exit(0);
}

setGolden(existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : null);
const filter = args.find(a => !a.startsWith('--'));
const chosen = filter ? tests.filter(t => t.name.toLowerCase().includes(filter.toLowerCase())) : tests;
let passed = 0;
const t0 = performance.now();
for (const t of chosen) {
  const start = performance.now();
  let ok = true, detail = '';
  try { detail = t.fn() || ''; } catch (e) { ok = false; detail = e instanceof Fail ? e.message : `${e.name}: ${e.message}\n${e.stack}`; }
  const sec = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`${ok ? c.ok + '✓' : c.bad + '✗'}${c.off} ${t.name} ${c.dim}(${sec} s)${c.off}`);
  if (detail) console.log(`  ${ok ? c.dim : c.bad}${detail.split('\n').join('\n  ')}${c.off}`);
  if (ok) passed++;
}
const failed = chosen.length - passed;
console.log(`\n${c.bold}${failed ? c.bad + '✗' : c.ok + '✓'} ${passed} av ${chosen.length} tester godkända på ${((performance.now() - t0) / 1000).toFixed(1)} s${c.off}`);
process.exit(failed ? 1 : 0);
