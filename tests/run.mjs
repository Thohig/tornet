// Kör testsviten i terminalen:   npm test            (alla tester)
//                                 npm test -- natt    (bara tester vars namn innehåller "natt")
//                                 npm test -- --jobs=4 (antal trådar; standard en per kärna, 1 = en tråd)
//                                 npm run golden      (skriv om facit för regressionstestet)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { tests, Fail, setGolden, GOLDEN_CASES, caseKey, dayFingerprint } from './suite.js';
import { goldenDiff } from './goldendiff.js';

const goldenPath = new URL('./golden.json', import.meta.url);
const args = process.argv.slice(2);
const c = { ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' };

if (args.includes('--update-golden')) {
  const g = {};
  for (const gc of GOLDEN_CASES) { g[caseKey(gc)] = dayFingerprint(gc); process.stdout.write('.'); }
  // Visa vad som ändras mot det gamla facit innan det skrivs över, så att det går att se om
  // ändringen var den avsedda.
  const old = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : null;
  const d = old ? goldenDiff(old, g) : null;
  console.log(d ? `\n${d.changed ? c.bold : c.dim}${d.text}${c.off}` : '\nInget tidigare facit.');
  writeFileSync(goldenPath, JSON.stringify(g, null, 2) + '\n');
  console.log(`Facit ${d && !d.changed ? 'oförändrat' : 'uppdaterat'}: ${GOLDEN_CASES.length} dygn skrivna till tests/golden.json`);
  process.exit(0);
}

const golden = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : null;
setGolden(golden);
const filter = args.find(a => !a.startsWith('--'));
const chosen = tests.map((t, i) => ({ t, i })).filter(({ t }) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()));

// Parallellt: testerna är oberoende (varje test bygger sin egen simulering), så de fördelas på
// arbetare med egna moduler. Standard är en arbetare per kärna;
// --jobs=N väljer antalet, --jobs=1 kör allt i den här tråden som förr.
const jobsArg = args.find(a => a.startsWith('--jobs='));
const jobs = Math.max(1, Math.min(chosen.length, jobsArg ? +jobsArg.slice(7) || 1 : availableParallelism()));

// De som tog längst tid förra gången körs först, så att den sista arbetaren inte blir kvar ensam
// med ett långt test (tiderna sparas i tests/.times.json, som inte checkas in).
const timesPath = new URL('./.times.json', import.meta.url);
let times = {};
try { times = JSON.parse(readFileSync(timesPath, 'utf8')); } catch (e) { times = {}; }
const queue = [...chosen].sort((a, b) => (times[b.t.name] ?? 1e9) - (times[a.t.name] ?? 1e9));

let passed = 0;
const t0 = performance.now();
function report({ i, ok, detail, ms }) {
  const t = tests[i];
  times[t.name] = Math.round(ms);
  console.log(`${ok ? c.ok + '✓' : c.bad + '✗'}${c.off} ${t.name} ${c.dim}(${(ms / 1000).toFixed(1)} s)${c.off}`);
  if (detail) console.log(`  ${ok ? c.dim : c.bad}${detail.split('\n').join('\n  ')}${c.off}`);
  if (ok) passed++;
}
function runHere({ t, i }) {
  const start = performance.now();
  let ok = true, detail = '';
  try { detail = t.fn() || ''; } catch (e) { ok = false; detail = e instanceof Fail ? e.message : `${e.name}: ${e.message}\n${e.stack}`; }
  report({ i, ok, detail, ms: performance.now() - start });
}

if (jobs === 1) queue.forEach(runHere);
else {
  console.log(`${c.dim}Kör ${chosen.length} tester på ${jobs} trådar …${c.off}`);
  await new Promise((done, fail) => {
    let running = 0;
    for (let k = 0; k < jobs; k++) {
      const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { golden } });
      const next = () => {
        const job = queue.shift();
        if (!job) { w.terminate(); if (running === 0 && queue.length === 0) done(); return; }
        running++;
        w.postMessage(job.i);
      };
      w.on('message', r => { running--; report(r); next(); });
      w.on('error', fail);
      next();
    }
  });
}
try { writeFileSync(timesPath, JSON.stringify(times, null, 1) + '\n'); } catch (e) { /* bara en optimering */ }

const failed = chosen.length - passed;
console.log(`\n${c.bold}${failed ? c.bad + '✗' : c.ok + '✓'} ${passed} av ${chosen.length} tester godkända på ${((performance.now() - t0) / 1000).toFixed(1)} s${c.off}`);
process.exit(failed ? 1 : 0);
