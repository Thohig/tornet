// Spelarens åtgärder och replay. Allt spelaren gör som påverkar simuleringen går via act(): åtgärden
// sparas med stegnumret (S.steps) och kan spelas upp igen exakt – samma frö + samma åtgärder vid samma
// steg ⇒ identiskt dygn. En inspelning är ett vanligt objekt som kan delas som länk (?replay=…).
// Rör aldrig DOM – gränssnittet anropar act() och encodeReplay()/decodeReplay(); startReplay ligger i sim.js.
import { STRAT_NAMES } from './config.js';
import { S, log } from './state.js';
import { pev, spawnBus, spawnVisitor } from './people.js';
import { rebuildPicks } from './dispatch.js';
import { setFireMode, startGenerator, startRescue, toggleAutoRescue, toggleOff, trigger } from './incidents.js';
import { setStormMode } from './weather.js';
import { orderService, startFan } from './service.js';

/** Byt styrlogik: hallknapparna nollställs och alla väntande fördelas om. */
export function changeStrategy(k) {
  if (S.strategy === k) return;
  S.strategy = k;
  S.calls = {};
  for (const p of S.people) if (p.state === 'wait') { p.assigned = null; p.bank = null; p.fixAt = 0; pev(p, 'Styrlogiken byttes – får en ny hiss'); }
  for (const e of S.elevators) { e.parkTarget = null; e.sleep = false; }
  S.peakMode = null;
  rebuildPicks();
  log(`Styrlogik bytt till ${STRAT_NAMES[k]} – alla väntande fördelas om`, 'sys');
}
/** inställningar som spelaren kan ändra under dygnet */
const SETTINGS = ['autoInc', 'mistakes', 'maint'];

/** Alla åtgärder som spelas in. Argumenten är rena data (id, våningsindex, strängar) så att de kan sparas. */
export const ACTIONS = {
  trigger: type => trigger(type),
  fireMode: m => setFireMode(m),
  generator: () => startGenerator(),
  autoRescue: () => toggleAutoRescue(),
  rescue: id => startRescue(S.elevators[id], 'manual'),
  carOff: id => toggleOff(S.elevators[id]),
  strategy: k => changeStrategy(k),
  setting: (key, v) => { if (SETTINGS.includes(key)) S[key] = v; },
  stormMode: m => setStormMode(m),
  fan: id => startFan(S.elevators[id]),
  service: id => orderService(S.elevators[id]),
  visitor: (f, x) => spawnVisitor(f, x),
  bus: () => spawnBus(),
};

/**
 * @typedef {{ n: number, a: string, args: any[] }} RecordedAction
 * @typedef {{ v: 1, seed: number, day: number, strategy: string, autoInc: boolean, mistakes: string, maint: string,
 *   wear: number[], learn?: number[][]|null, actions: RecordedAction[] }} Recording
 */

/** Utför en spelaråtgärd och spela in den. Under en uppspelning tar spelaren inte över – åtgärden ignoreras. */
export function act(name, ...args) {
  if (S.replay) { log('▶ Replay pågår – dina åtgärder ändrar inte dygnet', 'sys'); return null; }
  S.actions.push({ n: S.steps, a: name, args });
  return ACTIONS[name](...args);
}
/** Anropas först i varje simuleringssteg: utför de inspelade åtgärder som hände före det här steget. */
export function replayTick() {
  const q = S.replayQueue;
  while (q.length && q[0].n <= S.steps) {
    const { a, args } = q.shift();
    if (ACTIONS[a]) ACTIONS[a](...args);
  }
}
/** Dygnets start (sparas av resetDay): det som inte går att räkna fram ur fröet. */
export function recordStart() {
  S.recStart = { seed: S.seed, day: S.day, strategy: S.strategy, autoInc: S.autoInc, mistakes: S.mistakes, maint: S.maint, wear: S.elevators.map(e => e.wear),
    learn: S.learnMem && S.learnMem.map(r => [...r]) };
}
/** Inspelningen av dygnet hittills. */
export function recording() {
  return /** @type {Recording} */ ({ v: 1, ...S.recStart, actions: S.actions.map(x => ({ ...x, args: [...x.args] })) });
}
// ---------- Länkformat ----------
// JSON i base64url – kort nog för en adressrad (en åtgärd ≈ 20 tecken).
export function encodeReplay(rec = recording()) {
  const bytes = new TextEncoder().encode(JSON.stringify(rec));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** @returns {Recording|null} null om strängen inte är en giltig inspelning */
export function decodeReplay(str) {
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const rec = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    if (rec.v !== 1 || !Number.isFinite(rec.seed) || !Array.isArray(rec.actions) || !Array.isArray(rec.wear)) return null;
    if (rec.actions.some(x => !Number.isInteger(x.n) || !(x.a in ACTIONS) || !Array.isArray(x.args))) return null;
    if (rec.learn != null && !(Array.isArray(rec.learn) && rec.learn.every(r => Array.isArray(r) && r.every(Number.isFinite)))) return null;
    return rec;
  } catch (e) { return null; }
}
