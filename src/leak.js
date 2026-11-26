// Vattenläckan: ett vattenrör spricker på en våning (S.leak). Vattnet rinner nedåt, en våning i taget, och in i
// hisschakten som går förbi de blöta våningarna (panoramahissen utanpå huset klarar sig). Husets vaktmästare
// (crew.js – Bosse på dagen, kvällsvaktmästaren, annars jouren) springer ner till pannrummet på P1 och stänger
// huvudkranen; sedan slutar det rinna, golven torkar och hissteknikern går igenom de blöta schakten (beställd service).
// Driftchefens beslut (chief.js), eller spelarens via act('leak', 'stop'|'run'):
//   stop – hissarna i de blöta schakten tas ur drift direkt (e.wetLock): säkert, men köerna växer och fler tar trappan
//   run  – de kör vidare tills kranen är stängd: bättre flöde, men vattnet kan kortsluta styrningen – ett riktigt hissfel
// Folk som går över de blöta golven halkar ibland (som snubblet vid nivåfel).
// (Simulering: läget ligger i S.leak, grafiken i pixhall.js läser bara. Egen slumpström.)
//
// Översikt:
// vattenläckan (`S.leak`, incident och `act('trigger', 'leak', våning)` – `LEAK_FLOORS`): ett rör spricker, vattnet
// rinner en våning nedåt var `SPREAD_S` och in i de schakt som går förbi (`wetShaft`, inte panoramahissen), tills
// vaktmästaren (uppdraget `leak`) har vridit om huvudkranen i pannrummet på P1 (`VALVE_T`); golven torkar (`DRY_S`)
// och hissteknikern går igenom de blöta schakten (beställd service). Driftchefen (`leakChiefTick`) eller spelaren
// (`act('leak', 'stop'|'run')`): `stop` = de blöta hissarna står still (`e.wetLock`, `outReason` 'wet'), `run` = de
// kör vidare men kan kortslutas (`SHORT_K` per blöt våning i hissens eget schakt, `wetIn` → hissfel). Folk halkar på
// blöta golv. Läcker det i labbet är vattnet grönt. Grafiken i pixhall.js (`wetHall`, `drawLeakPx`). Egen slumpström
// `vattenläcka`
import { stream } from './rng.js';
import { sv } from './sv.js';
const { pick, rng } = stream('vattenläcka');
import { fl } from './util.js';
import { BOILER_STAND, CAFE, DOCK, FL, HOME_FLOORS, LOBBY, OFFICE_FLOORS, floorWith } from './config.js';
import { S, incidentOver, log } from './state.js';
import { pev, pn } from './people.js';
import { inFireZone, rebuildPicks } from './dispatch.js';
import { callJanitor, dutyDone, onDuty } from './crew.js';
import { orderService, triggerFault } from './service.js';
import { incidentStarted } from './incidents.js';
/** @typedef {import('./people.js').Person} Person */
/** @typedef {import('./elevators.js').Elevator} Elevator */

/**
 * Vattenläckan (S.leak). src = våningen där röret sprack; wet = de blöta våningarna (från src och nedåt);
 * nextAt = när nästa våning blir blöt; shut = huvudkranen är stängd (shutAt); mode = '' (inget beslut – hissarna kör),
 * 'stop' eller 'run'; jan = vaktmästaren (id); valveT = hur länge hen vridit på kranen; shorts = hissar som
 * kortslöts; green = läckan är i labbet (den gröna vätskan följer med); slips = hur många som halkade.
 * @typedef {{ t0: number, src: number, wet: number[], nextAt: number, shut: boolean, shutAt: number, mode: string, by: string,
 *   jan: number, who: string, valveT: number, shorts: number[], green: boolean, slips: number, cars: number[], ph: string }} Leak
 */
/** vattnet når nästa våning efter (s) */
export const SPREAD_S = 24;
/** huvudkranen: så länge vrider vaktmästaren (s) */
export const VALVE_T = 5;
/** golven torkar efter att kranen stängts (s) */
export const DRY_S = 45;
/** risken (per sekund och blöt våning i schaktet) att en blöt hiss som kör kortsluts */
export const SHORT_K = 0.006;
/** risken (per sekund) att den som går över ett blött golv halkar */
const SLIP_K = 0.05;
const LAB = floorWith('lab');
/** våningar där ett rör kan spricka: bostäderna, labbet, Sky Café, kontoren */
const SOURCES = [...new Set([...HOME_FLOORS, LAB, CAFE, ...OFFICE_FLOORS.filter(f => f > LOBBY + 2)])].filter(f => f >= 0);

/** våningar där ett rör kan spricka (spelaren kan välja en av dem) */
export const LEAK_FLOORS = SOURCES;
/** kan ett rör spricka nu? */
export const leakPossible = () => !S.leak && SOURCES.length > 0 && DOCK >= 0;
/** är våningen f blöt? */
export const wetFloor = f => !!S.leak && S.leak.ph !== 'done' && S.leak.wet.includes(f);
/** går hissens schakt förbi en blöt våning? (panoramahissen utanpå huset klarar sig) @param {Elevator} e */
export const wetShaft = e => wetIn(e) > 0;
/** hur många blöta våningar hissens schakt går förbi (panoramahissen: inga) @param {Elevator} e */
export const wetIn = e => !S.leak || S.leak.ph === 'done' || e.facade ? 0 : S.leak.wet.filter(f => f >= e.minF && f <= e.maxF).length;

/** Spelaren eller slumpen: ett rör spricker på våning f (utelämnat: slumpen väljer). Returnerar false om det inte går. */
export function startLeak(f = null) {
  if (!leakPossible()) return false;
  const src = f !== null && SOURCES.includes(f) && !inFireZone(f) ? f : pick(SOURCES.filter(x => !inFireZone(x)));
  if (src === undefined) return false;
  S.leak = { t0: S.t, src, wet: [src], nextAt: S.t + SPREAD_S, shut: false, shutAt: 0, mode: '', by: '', jan: -1, who: '', valveT: 0,
    shorts: [], green: src === LAB, slips: 0, cars: [], ph: 'leak' };
  const jan = callJanitor('leak', DOCK, 'Springer ner till pannrummet – stänger huvudkranen', 'Vrider om huvudkranen i pannrummet', BOILER_STAND);
  S.leak.jan = jan.id;
  for (const p of S.people) if (p.floor === src && p.state === 'office' && !p.role) pev(p, S.leak.green ? 'Det forsar GRÖNT vatten ur taket!' : 'Ett rör har spruckit – det forsar ur taket!');
  log(sv`🚿 Ett vattenrör har spruckit på ${fl(src)}${S.leak.green ? ' (och den gröna vätskan i labbet följer med)' : ''} – vattnet rinner nedåt`, 'alert');
  S.fx.push({ x: 380, y: 0, text: 'PLASK!', color: '#3f7cff', life: 1.6 });
  incidentStarted(src);
  noteCars();
  return true;
}
/** Hur hissarna i de blöta schakten körs: 'stop' (ur drift) eller 'run' (kör vidare). by = 'chief' eller 'player'. */
export function setLeakMode(mode, by) {
  const L = S.leak;
  if (!L || L.ph !== 'leak' || (mode !== 'stop' && mode !== 'run')) return false;
  if (L.mode === mode) return true;
  L.mode = mode; L.by = by;
  lockCars();
  log(mode === 'stop' ? '🚿 Hissarna i de blöta schakten tas ur drift tills kranen är stängd' : '🚿 Hissarna i de blöta schakten kör vidare', 'alert');
  return true;
}
/** hissarna i blöta schakt (för korten och beslutet) */
const noteCars = () => { const L = S.leak; if (L) L.cars = S.elevators.filter(wetShaft).map(e => e.id); };
/** ur drift (stop) eller i drift (run, eller läckan är över) */
function lockCars() {
  const L = S.leak, on = !!L && L.ph === 'leak' && L.mode === 'stop' && !L.shut;
  let changed = false;
  for (const e of S.elevators) {
    const lock = on && wetShaft(e);
    if (!!e.wetLock !== lock) { e.wetLock = lock; changed = true; }
  }
  if (changed) rebuildPicks();
}

// ---------- Varje steg ----------
export function leakTick(dt) {
  const L = S.leak;
  if (!L) return;
  // vattnet rinner nedåt tills kranen är stängd
  if (!L.shut && S.t >= L.nextAt) {
    const low = Math.min(...L.wet);
    if (low > 0) {
      L.wet.push(low - 1);
      log(sv`🚿 Vattnet har nått ${fl(low - 1)}`, 'alert');
      noteCars();
    }
    L.nextAt = S.t + SPREAD_S;
  }
  lockCars();
  // vaktmästaren stänger huvudkranen i pannrummet (ringas in igen om hen försvann)
  if (!L.shut) {
    let jan = S.people.find(p => p.id === L.jan && !p.dead) || null;
    if (!jan || !jan.duty || jan.duty.kind !== 'leak') { jan = callJanitor('leak', DOCK, 'Springer ner till pannrummet – stänger huvudkranen', 'Vrider om huvudkranen i pannrummet', BOILER_STAND); L.jan = jan.id; }
    if (onDuty(jan, 'leak')) {
      L.valveT += dt;
      if (L.valveT >= VALVE_T) shutValve(L, jan);
    }
  } else if (S.t >= L.shutAt + DRY_S) { finish(L); return; }
  // kör de blöta hissarna vidare kan vattnet kortsluta styrningen (bara med strömmen på)
  if (!L.shut && L.mode !== 'stop' && S.power) {
    for (const e of S.elevators) {
      const n = wetIn(e);
      if (e.mode !== 'normal' || e.state !== 'moving' || L.shorts.includes(e.id) || !n) continue;
      // risken växer med de blöta våningarna i hissens eget schakt (vattnet längre upp rinner inte här)
      if (rng() < SHORT_K * dt * n) {
        L.shorts.push(e.id);
        log(sv`⚡ Vattnet når styrningen i ${e.name} – kortslutning!`, 'alert', e.color);
        triggerFault(e);
      }
    }
  }
  // folk som går över de blöta golven halkar ibland
  for (const p of S.people) {
    if (p.dead || p.dog || !L.wet.includes(p.floor) || (p.state !== 'toQueue' && p.state !== 'exiting') || L.shut) continue;
    if (rng() < SLIP_K * dt) {
      L.slips++; S.stats.stumbles++;
      p.mood = Math.max(p.mood || 0, 1);
      pev(p, 'Halkar på det blöta golvet – OJ!');
      S.fx.push({ x: p.x, y: 0, text: 'OJ!', color: '#ffe14d', life: 1.1 });
    }
  }
}
/** @param {Leak} L @param {Person} jan */
function shutValve(L, jan) {
  L.shut = true; L.shutAt = S.t; L.who = jan.name;
  dutyDone(jan);
  lockCars();
  pev(jan, 'Huvudkranen är stängd – nu slutar det rinna');
  log(sv`🔧 ${pn(jan)} har stängt huvudkranen i pannrummet – vattnet slutar rinna (${L.wet.length} ${L.wet.length === 1 ? 'våning' : 'våningar'} blöta)`, 'alert', null, jan.id);
  // hissteknikern går igenom de blöta schakten (beställd service – en i taget)
  for (const id of L.cars) if (!L.shorts.includes(id)) orderService(S.elevators[id]);
}
/** @param {Leak} L */
function finish(L) {
  L.ph = 'done';
  lockCars();
  const sec = Math.round(L.shutAt - L.t0), n = L.wet.length;
  const how = L.mode === 'stop' ? 'Hissarna i de blöta schakten stod still tills kranen var stängd.'
    : L.shorts.length ? sv`Hissarna körde vidare – ${L.shorts.map(id => S.elevators[id].name).join(' och ')} kortslöts.` : 'Hissarna körde vidare utan att något kortslöts.';
  log(`✅ Vattenläckan är åtgärdad – golven har torkat`, 'alert');
  incidentOver('leak', '✅ Vattenläckan är åtgärdad',
    sv`Röret sprack på ${fl(L.src)}${L.green ? ' (i labbet – vattnet var grönt)' : ''}. Vattnet hann till ${n} ${n === 1 ? 'våning' : 'våningar'} innan ${L.who || 'vaktmästaren'} stängde huvudkranen efter ${sec} s. ${how}`
    + (L.slips ? sv` ${L.slips} halkade på de blöta golven.` : '') + (L.cars.length ? ' Teknikern går igenom de blöta schakten.' : ''), { floor: L.src });
  S.leak = null;
}
/** dygnet börjar om (resetDay) */
export function leakReset() { S.leak = null; for (const e of S.elevators) e.wetLock = false; }
/** våningens namn för korten */
export const leakPlace = L => `${fl(L.src)} · ${FL[L.src].short}`;
