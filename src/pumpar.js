// Pumparna stannar: grundvattnet i berget pumpas ut hela tiden ur pumprummet i skyddsrummet (SR). När pumparna stannar
// (en motor som brann, en propp i silen – eller strömmen som gick, incidents.js) stiger vattnet i botten av huset:
// först i pendelhissens schaktgrop, sedan i maskinrummet under den långa rulltrappan. Vaktmästaren går ner till
// pumprummet och får igång dem (men bara när det finns ström), och sedan sjunker vattnet igen.
// Valet (driftchefen i chief.js eller spelaren, act('pumpar', …)):
//   run  – pendelhissen kör vidare tills vattnet når gropen: pendeln fungerar, men hinner vaktmästaren inte fram
//          går pendelhissen sönder (vatten i gropen – teknikern får torka och byta kontaktorer)
//   stop – pendelhissen ställs direkt: inget går sönder, men alla från pendeln får ta X1 eller rulltrappan
// Rulltrappan genom berget stannar när vattnet når dess maskinrum (deepEscalatorShut, people.js).
// (Simulering: läget ligger i S.pumpar. Egen slumpström `pumpar`.)
import { stream } from './rng.js';
const { pick, rand } = stream('pumpar');
import { S, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';
import { sv } from './sv.js';
import { PENDEL, SHELTER } from './config.js';
import { pev, pn } from './people.js';
import { callJanitor, dutyDone, onDuty } from './crew.js';
import { triggerFault } from './service.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

/**
 * Pumparna stannar (S.pumpar): t0 = när de stannade, ph = 'on' (står) → 'drain' (går igen, vattnet sjunker); cause =
 * varför; level = vattnet i botten (0 = torrt, 1 = upp till pendelns perrong); mode = '' (inget beslut), 'run' eller
 * 'stop'; by = vem som bestämde; jan = vaktmästaren; fixT/fixLen = hur länge hen har skruvat och hur länge det tar;
 * flooded = pendelhissen fick vatten i gropen; outage = det var strömmen; peak = högsta vattennivån.
 * @typedef {{ t0: number, ph: 'on'|'drain', cause: string, level: number, mode: string, by: string, jan: number,
 *   fixT: number, fixLen: number, flooded: boolean, outage: boolean, peak: number }} Pumpar
 */
/** där vaktmästaren står vid pumprummets dörr i skyddsrummets hall (världens x; pixhall.js ritar dörren där) */
export const PUMP_X = 578;
/** vattnet når pendelhissens grop / rulltrappans maskinrum vid de här nivåerna */
export const PIT_LEVEL = 0.8, ESC_LEVEL = 0.6;
/** hur fort vattnet stiger (per sekund) med och utan ström: utan ström går inte ens dräneringen */
const RISE = 1 / 150, RISE_DARK = 1 / 95, DRAIN = 1 / 45;
/** det som kan ha stoppat pumparna */
const CAUSES = ['en propp av grus i silen', 'en motorlindning som brann', 'en flottör som hängt upp sig', 'en säkring som gått i pumpskåpet'];

/** pendelhissarna (gruppen 'pendel' i config) */
const pendelCars = () => S.elevators.filter(e => e.group === 'pendel');
/** kan pumparna stanna nu? (huset har pumprum och pendel, och det brinner inte) */
export const pumparPossible = () => !S.pumpar && SHELTER >= 0 && PENDEL >= 0 && !S.fire;
/** står rulltrappan genom berget still för vattnet? */
export const deepEscalatorShut = () => !!S.pumpar && S.pumpar.level >= ESC_LEVEL;
/** tar pendelhissen e inga nya för vattnet? (ställd, eller vatten i gropen) @param {Elevator} e */
export const pumpLock = e => !!S.pumpar && e.group === 'pendel' && (S.pumpar.level >= PIT_LEVEL || (S.pumpar.ph === 'on' && S.pumpar.mode === 'stop'));

/** Slumpen, spelaren (act('trigger', 'pumpar')) eller strömavbrottet: pumparna stannar. false om det inte går nu. */
export function startPumpar(outage = false) {
  if (!pumparPossible()) return false;
  const X = S.pumpar = { t0: S.t, ph: /** @type {'on'} */ ('on'), cause: outage ? 'strömavbrottet' : pick(CAUSES), level: 0.05, mode: '', by: '',
    jan: -1, fixT: 0, fixLen: rand(20, 35), flooded: false, outage, peak: 0.05 };
  callPumpJanitor(X);
  log(outage ? '🌊 Pumparna i berget stannade med strömmen – grundvattnet börjar stiga' : sv`🌊 Pumparna i berget har stannat (${X.cause}) – grundvattnet börjar stiga`, 'alert');
  incidentStarted(SHELTER);
  return true;
}
/** @param {Pumpar} X */
function callPumpJanitor(X) {
  X.jan = callJanitor('pumpar', SHELTER, 'Går ner till pumprummet – pumparna har stannat', 'Skruvar i pumpskåpet i pumprummet', PUMP_X).id;
}
/** Beslutet: 'run' (pendelhissen kör vidare) eller 'stop' (ställs). by = 'chief' eller 'player'. */
export function setPumparMode(mode, by) {
  const X = S.pumpar;
  if (!X || X.ph !== 'on' || (mode !== 'run' && mode !== 'stop')) return false;
  if (X.mode === mode) return true;
  X.mode = mode; X.by = by;
  log(mode === 'stop' ? '🚧 Pendelhissen ställs tills pumparna går igen – folk tar X1 eller rulltrappan'
    : '🌊 Pendelhissen kör vidare tills vattnet når gropen', 'alert');
  return true;
}

/** @param {number} dt */
export function pumparTick(dt) {
  // strömmen går: pumparna stannar med den (en gång per avbrott – de går igen med strömmen)
  if (!S.pumpar && S.outage && S.pumparOut !== S.outage.t0 && S.t - S.outage.t0 > 12) {
    S.pumparOut = S.outage.t0;
    startPumpar(true);
  }
  const X = S.pumpar;
  if (!X) return;
  if (X.ph === 'on') {
    X.level = Math.min(1, X.level + dt * (S.power ? RISE : RISE_DARK));
    X.peak = Math.max(X.peak, X.level);
    // vatten i gropen: pendelhissen som körde vidare går sönder (en gång)
    if (X.level >= PIT_LEVEL && !X.flooded) {
      X.flooded = true;
      if (X.mode !== 'stop') for (const e of pendelCars()) if (e.mode === 'normal' && triggerFault(e)) log(sv`🌊 Vattnet når gropen under ${e.name} – kontaktorerna får sig en skvätt`, 'alert', e.color);
    }
    // vaktmästaren i pumprummet (ringas in igen om hen försvann); utan ström går pumparna inte att starta
    let jan = S.people.find(p => p.id === X.jan && !p.dead) || null;
    if (!jan || !jan.duty || jan.duty.kind !== 'pumpar') { callPumpJanitor(X); jan = S.people.find(p => p.id === X.jan) || null; }
    if (onDuty(jan, 'pumpar') && S.power && (X.fixT += dt) >= X.fixLen) restart(X, jan);
  } else {
    X.level = Math.max(0, X.level - dt * DRAIN);
    if (X.level <= 0) finish(X);
  }
}
/** @param {Pumpar} X @param {Person} jan */
function restart(X, jan) {
  X.ph = 'drain';
  dutyDone(jan);
  pev(jan, X.outage ? 'Startade om pumparna efter strömavbrottet – det brummar igen' : sv`Hittade ${X.cause} – pumparna går igen`);
  log(X.outage ? sv`🔧 ${pn(jan)} startade om pumparna – vattnet sjunker` : sv`🔧 ${pn(jan)} hittade ${X.cause} – pumparna går igen och vattnet sjunker`, 'alert', null, jan.id);
}
/** @param {Pumpar} X */
function finish(X) {
  const sec = Math.round(S.t - X.t0), peak = Math.round(X.peak * 100);
  const how = X.flooded && X.mode !== 'stop' ? 'Pendelhissen körde vidare och fick vatten i gropen.'
    : X.mode === 'stop' ? 'Pendelhissen stod still – folk tog X1 och rulltrappan.' : 'Vattnet nådde aldrig gropen.';
  S.pumpar = null;
  incidentOver('pumpar', '✅ Det är torrt i berget igen', sv`Pumparna stod i ${sec} s och vattnet steg till ${peak} %. ${how}`, { floor: SHELTER });
}

export function pumparReset() { S.pumpar = null; S.pumparOut = -1; }
