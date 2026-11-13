// Tävling mellan styrlogikerna: hela dygn över flera frön, med väntetidens fördelning, restid, energi och trappresor.
//   npm run league                     (standard: 8 frön per strategi)
//   npm run league -- 20               (20 frön per strategi)
//   npm run league -- 8 smart,peak     (bara vissa strategier)
//   npm run league -- 8 --save=fore    (sparar resultatet i tests/league-fore.json)
//   npm run league -- 8 --cmp=fore     (jämför med ett sparat resultat)
//   npm run league -- 8 --flytt --flyttval=varu  (flyttdag varje dygn, med spelarens vägval)
// Väntetiden mäts utifrån (när en person kliver på), så mätningen påverkar inte simuleringen.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { S, hooks } from '../src/state.js';
import { DT, step, newSim } from '../src/sim.js';
import { forceMove } from '../src/visits.js';
import { act } from '../src/replay.js';

const args = process.argv.slice(2);
const plain = args.filter(a => !a.startsWith('--'));
const flag = name => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const seeds = Number(plain[0]) || 8;
const strategies = plain[1] ? plain[1].split(',') : ['smart', 'peak', 'eco', 'buttons', 'nearest', 'random'];
hooks.incident = () => {}; hooks.dayEnd = () => {};

const pct = (xs, q) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** ett dygn: alla väntetider (en per påstigning), restider, energi och trappresor */
function day(seed, strategy) {
  newSim(seed, { strategy, autoInc: true, mistakes: 'lite', maint: 'natt' });
  // --flytt: flyttdag varje dygn (--flyttval=auto|varu|balk väljer vägen för möblerna)
  if (flag('flytt') !== null || args.includes('--flytt')) { forceMove(); if (S.move && flag('flyttval')) act('moveRoute', flag('flyttval')); }
  const waits = new Map(), boarded = new Set(), rides = [];
  while (!S.summaryShown) {
    step(DT);
    for (const p of S.people) {
      if (p.state === 'boarding' && !boarded.has(p)) { boarded.add(p); waits.set(`${p.id}:${p.floor}:${p.dest}`, p.lastWait); }
      else if (p.state !== 'boarding' && boarded.has(p)) {
        boarded.delete(p);
        if (p.state === 'ride') rides.push(p);
      }
    }
  }
  const w = [...waits.values()];
  const M = S.move && S.move.state === 'done' ? S.move : null;
  return { move: M ? { dur: M.t1 - M.t0, lock: M.indepSec, bud: M.budWait, hoisted: M.hoisted } : null, waits: w, served: S.stats.served, kwh: S.stats.energy, stairs: S.stats.stairsChoice, crowd: S.stats.crowdSkips,
    angry: S.stats.angry, etaErr: S.stats.etaN ? S.stats.etaAbs / S.stats.etaN : null, etaBias: S.stats.etaN ? S.stats.etaErr / S.stats.etaN : null };
}

const out = {};
const t0 = performance.now();
for (const strategy of strategies) {
  const all = [], perDay = [];
  let served = 0, kwh = 0, stairs = 0, crowd = 0, angry = 0;
  const etaErr = [], etaBias = [], moves = [];
  for (let i = 0; i < seeds; i++) {
    const d = day(9000 + i, strategy);
    if (d.move) moves.push(d.move);
    all.push(...d.waits); perDay.push(mean(d.waits));
    served += d.served; kwh += d.kwh; stairs += d.stairs; crowd += d.crowd; angry += d.angry;
    if (d.etaErr !== null) { etaErr.push(d.etaErr); etaBias.push(d.etaBias); }
  }
  out[strategy] = {
    medel: mean(all), p50: pct(all, 0.5), p95: pct(all, 0.95), p99: pct(all, 0.99), max: pct(all, 1),
    // spridningen mellan dygnen (för att se om en skillnad är större än slumpen)
    sd: Math.sqrt(mean(perDay.map(x => (x - mean(perDay)) ** 2))),
    resor: served / seeds, kwh: kwh / seeds, trappa: stairs / seeds, trängsel: crowd / seeds, arga: angry / seeds,
    etaFel: etaErr.length ? mean(etaErr) : null, etaBias: etaBias.length ? mean(etaBias) : null,
    // flyttdagarna: hur länge flytten tog, hur länge varuhissen var låst, budens längsta väntan, lass med balken
    flytt: moves.length ? { n: moves.length, tid: mean(moves.map(m => m.dur)), låst: mean(moves.map(m => m.lock)), bud: Math.max(...moves.map(m => m.bud)), balk: mean(moves.map(m => m.hoisted)) } : null,
  };
}
const f = (x, d = 1) => (x === null ? '–' : x.toFixed(d));
const cmpName = flag('cmp');
const cmpPath = cmpName && new URL(`./league-${cmpName}.json`, import.meta.url);
const base = cmpPath && existsSync(cmpPath) ? JSON.parse(readFileSync(cmpPath, 'utf8')) : null;
const delta = (s, k, d = 1) => {
  if (!base || !base[s] || base[s][k] === null || out[s][k] === null) return '';
  const x = out[s][k] - base[s][k];
  return ` (${x >= 0 ? '+' : ''}${x.toFixed(d)})`;
};
console.log(`${seeds} frön per strategi · ${((performance.now() - t0) / 1000).toFixed(0)} s${base ? ` · jämfört med "${cmpName}"` : ''}`);
console.log('strategi  medel ±sd       p50     p95      p99       max   resor   kWh    trappa  trängsel  arga  ETA-fel (bias)');
for (const s of strategies) {
  const r = out[s];
  console.log([s.padEnd(8), `${f(r.medel)}${delta(s, 'medel')}`.padEnd(11) + `±${f(r.sd)}`, f(r.p50).padStart(5), `${f(r.p95)}${delta(s, 'p95')}`.padStart(12),
    `${f(r.p99)}${delta(s, 'p99')}`.padStart(13), f(r.max, 0).padStart(5), f(r.resor, 0).padStart(6), `${f(r.kwh, 0)}${delta(s, 'kwh', 0)}`.padStart(8),
    f(r.trappa, 0).padStart(6), f(r.trängsel, 0).padStart(8), f(r.arga, 0).padStart(6), `${f(r.etaFel)}${delta(s, 'etaFel')}`.padStart(11), r.etaBias === null ? '' : `(${r.etaBias >= 0 ? '+' : ''}${f(r.etaBias)})`].join(' '));
}
if (strategies.some(s => out[s].flytt)) {
  console.log('\nflyttdag  dygn   flytten   varuhissen låst   bud max   lass med balken');
  for (const s of strategies) {
    const m = out[s].flytt; if (!m) continue;
    console.log([s.padEnd(8), String(m.n).padStart(5), `${f(m.tid, 0)} s`.padStart(9), `${f(m.låst, 0)} s`.padStart(17), `${f(m.bud, 0)} s`.padStart(9), f(m.balk).padStart(17)].join(' '));
  }
}
const save = flag('save');
if (save) { writeFileSync(new URL(`./league-${save}.json`, import.meta.url), JSON.stringify(out, null, 2) + '\n'); console.log(`sparat i tests/league-${save}.json`); }
