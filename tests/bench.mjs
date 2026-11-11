// Mäter simuleringens fart i Node: steg per sekund för hela dygn med olika styrlogiker.
//   npm run bench            (standard: tre frön per strategi)
//   npm run bench -- 10      (tio frön per strategi)
import { S, hooks } from '../src/state.js';
import { DT, step, newSim } from '../src/sim.js';

const seeds = Number(process.argv[2]) || 3;
const strategies = ['smart', 'peak', 'eco', 'buttons', 'nearest'];
hooks.incident = () => {}; hooks.dayEnd = () => {};

let totalSteps = 0, totalMs = 0;
for (const strategy of strategies) {
  let steps = 0, peak = 0;
  const t0 = performance.now();
  for (let i = 0; i < seeds; i++) {
    newSim(7000 + i, { strategy, autoInc: true, mistakes: 'lite', maint: 'natt' });
    while (!S.summaryShown) { step(DT); steps++; peak = Math.max(peak, S.people.length); }
  }
  const ms = performance.now() - t0;
  totalSteps += steps; totalMs += ms;
  console.log(`${strategy.padEnd(8)} ${Math.round(steps / (ms / 1000)).toString().padStart(7)} steg/s · ${(ms / seeds).toFixed(0).padStart(5)} ms per dygn · max ${peak} personer`);
}
console.log(`totalt   ${Math.round(totalSteps / (totalMs / 1000)).toString().padStart(7)} steg/s (${(30).toString()} steg = 1 s spel i hastighet 1×)`);
