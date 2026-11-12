// Spelarens åtgärder och replay. Allt spelaren gör som påverkar simuleringen går via act(): åtgärden
// sparas med stegnumret (S.steps) och kan spelas upp igen exakt – samma frö + samma åtgärder vid samma
// steg ⇒ identiskt dygn. En inspelning är ett vanligt objekt som kan delas som länk (?replay=…).
// Rör aldrig DOM – gränssnittet anropar act() och encodeReplay()/decodeReplay(); startReplay ligger i sim.js.
import { STRAT_NAMES } from './config.js';
import { S, log } from './state.js';
import { rngState } from './rng.js';
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
 * @typedef {{ v: 1|2, sv?: number, seed: number, day: number, strategy: string, autoInc: boolean, mistakes: string, maint: string,
 *   wear: number[], learn?: number[][]|null, actions: RecordedAction[], checks?: string[] }} Recording
 * @typedef {{ sv: number|null, checks: string[]|null, drift: number|null, ok: number }} ReplayCheck
 */

// ---------- Kontrollsummor ----------
// Simuleringens version. Höj den när beteendet ändras avsiktligt – `npm run golden` vägrar skriva om facit
// annars. En replay-länk från en annan version spelas fortfarande upp, men spelaren får veta att dygnet kan avvika.
export const SIM_VERSION = 5;
/** var 900:e steg (30 sekunder) räknas en kontrollsumma av simuleringens tillstånd */
export const CHECK_EVERY = 900;

// Hash över tillståndet: talen läses bit för bit (float64), så minsta avrundningsskillnad syns.
// Två webbläsare som räknar Math.sin/exp en aning olika ger alltså olika summor redan vid första avvikelsen.
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
/** Kontrollsumman för simuleringens tillstånd just nu (bara simuleringen – gränssnittets fält räknas inte). */
export function stateHash() {
  let h = 0x811c9dc5;
  const w = x => { h = Math.imul(h ^ x, 0x5bd1e995); h ^= h >>> 13; };
  const v = x => {
    if (typeof x === 'number') { f64[0] = x; w(u32[0]); w(u32[1]); }
    else if (typeof x === 'string') { w(x.length); for (let i = 0; i < x.length; i++) w(x.charCodeAt(i)); }
    else if (typeof x === 'boolean') w(x ? 0x7e1 : 0x7e0);
    else w(x == null ? 0x6e11 : 0x0b1);
  };
  v(S.steps); w(rngState); v(S.t); v(S.clock); v(S.nextId); v(S.power); v(S.strategy); v(!!S.fire);
  for (const k in S.stats) v(S.stats[k]);
  v(S.people.length);
  for (const p of S.people) {
    v(p.id); v(p.state); v(p.floor); v(p.dest); v(p.goal); v(p.x); v(p.kg); v(p.assigned); v(p.car ? p.car.id : -1); v(p.mood); v(p.timer);
  }
  for (const e of S.elevators) {
    v(e.pos); v(e.v); v(e.dir); v(e.state); v(e.mode); v(e.door); v(e.wear); v(e.kwh); v(e.heat); v(e.level); v(!!e.sleep);
    v(e.passengers.length); for (const p of e.passengers) v(p.id);
    for (const f of e.carCalls) v(f);
  }
  return (h >>> 0).toString(36);
}
/** Anropas av step() var CHECK_EVERY:e steg: sparar summan och jämför med inspelningens under en uppspelning. */
export function checkTick() {
  const h = stateHash(), i = S.checks.length, R = S.replayCheck;
  S.checks.push(h);
  if (!S.replay || !R || !R.checks || R.drift !== null || i >= R.checks.length) return;
  if (R.checks[i] !== h) {
    R.drift = S.t;
    log(`⚠️ Replayen avviker från inspelningen efter ${Math.round(S.t)} s – resten av dygnet kan bli annorlunda`, 'alert');
  } else if (++R.ok === R.checks.length) log(`🔁 Replayen stämmer med inspelningen (${R.ok} kontrollsummor)`, 'sys');
}

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
  return /** @type {Recording} */ ({ v: 2, sv: SIM_VERSION, ...S.recStart, actions: S.actions.map(x => ({ ...x, args: [...x.args] })), checks: [...S.checks] });
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
    if ((rec.v !== 1 && rec.v !== 2) || !Number.isFinite(rec.seed) || !Array.isArray(rec.actions) || !Array.isArray(rec.wear)) return null;
    if (rec.actions.some(x => !Number.isInteger(x.n) || !(x.a in ACTIONS) || !Array.isArray(x.args))) return null;
    if (rec.learn != null && !(Array.isArray(rec.learn) && rec.learn.every(r => Array.isArray(r) && r.every(Number.isFinite)))) return null;
    // version 2: simuleringsversion + kontrollsummor (version 1 saknar dem men spelas ändå upp)
    if (rec.v === 2 && !(Number.isInteger(rec.sv) && Array.isArray(rec.checks) && rec.checks.every(c => typeof c === 'string'))) return null;
    return rec;
  } catch (e) { return null; }
}
