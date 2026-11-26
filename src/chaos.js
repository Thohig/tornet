// Murphys lag: kaosknappen. Spelaren trycker en gång per dygn och allt som kan gå fel går fel – i en
// kedjereaktion, eftersom vissa incidenter inte kan pågå samtidigt (kuppen kräver ström, ingen brand och
// en ledig lastkaj; blixten är det som slår ut strömmen). Kedjan startar varje steg så fort det kan, och
// det som inte hinner bli av inom stegets väntetid hoppas över. Sedan tar huset hand om resten själv:
// driftchefen fattar sina beslut som vanligt. Kedjan har en egen slumpström ('kaos'): brandvåningen,
// pauserna mellan stegen.
//
// Översikt:
// Murphys lag: kaosknappen (`act('chaos')`, en gång per dygn – `S.chaosDay`, `chaosReady()`). Startar en kedja
// (`S.chaos`, stegen i `STEPS`) av allt som kan gå fel i en ordning där det går (kuppen kräver ström, ingen brand
// och ledig lastkaj): värmebölja/ambulans/tågstörning/VIP → storm med blixt → het motor → hissfel/linbrott/fasaden →
// turistbuss → brand → kupp → flytt. Varje steg har `ready`/`wait` och hoppas över om det inte kan börja i tid; när
// det lugnat sig sammanfattar `incidentOver('chaos', …)`. Egen slumpström `kaos`. Knappen med plastlocket i
// panels.js (`chaosBtn`)
import { anyIncident, chaosIn, systems } from './systems.js';
import { stream } from './rng.js';
const { pick, rand } = stream('kaos');
import { S, incidentOver, log, notice } from './state.js';
import { FIRE_FLOORS, startFire } from './incidents.js';
import { setWeather, strikeNow } from './weather.js';
import { moveNow, startMedical } from './visits.js';
import { delayTrain } from './train.js';
import { vipNow } from './life.js';
import { spawnBus } from './tour.js';
import { heistPossible, startHeist } from './heist.js';
import { triggerHeat } from './service.js';
import { chiefNote } from './chief.js';

/** Kedjan som pågår (S.chaos): steget i tur, när det tidigast får börja och hur länge det har väntat, vad som
 *  blev av och vad som hoppades över, och 'tail' = alla steg är gjorda – kedjan väntar på att det lugnar sig
 * @typedef {{ t0: number, i: number, at: number, waitT: number, did: string[], missed: string[], ph: 'run'|'tail', tailT: number }} Chaos */

/** vad varje del heter i sammanfattningen (incidenterna i stegen cars och guests: chaos.name i registret, systems.js) */
const NAMES = {
  heatwave: '☀️ värmebölja', medical: '🚑 ambulans', train: '🚇 tågstörning', vip: '🚁 VIP', storm: '⛈️ storm och blixt',
  heat: '🌡️ het motor', bus: '🚌 turistbuss', fire: '🔥 brand', heist: '🚐 kupp', move: '🚚 flytt',
};
/** @type {Record<string, string>|null} */
let names = null;
export const chaosNames = () => names ??= { ...NAMES, ...Object.fromEntries(systems().filter(s => s.chaos).map(s => [s.key, s.chaos.name])) };
/** starta registrets incidenter i steget (i registrets ordning) – nycklarna för dem som blev av */
const runIn = step => chaosIn(step).map(s => s.chaos.run() && s.key);
/** strömmen är tillbaka och blixten har slagit ner (hissfel och värme kräver ström) */
const powered = () => S.power && !S.outage && (!S.storm || S.storm.strikeAt === null || S.storm.struck !== null);
/**
 * Stegen i ordning. ready = får steget börja nu, wait = hur länge (s) det får vänta innan det hoppas över,
 * run = startar det som kan startas och returnerar vad som blev av (nycklar i chaosNames()).
 * @type {{ k: string, ready?: () => boolean, wait?: number, run: () => (string|false)[] }[]}
 */
const STEPS = [
  { k: 'alarm', run: () => {
    log('💥 MURPHYS LAG! Alla larm i huset går på en gång – allt som kan gå fel kommer att gå fel', 'alert');
    notice('chaos', '💥 Murphys lag!', 'Någon har tryckt på den röda knappen. Allt som kan gå fel går fel – det ena efter det andra. Driftchefen får klara det så gott det går.');
    chiefNote('chaos', '…vad i hela friden?', 'alla larm i huset går samtidigt');
    return [];
  } },
  { k: 'start', run: () => [setWeather('heatwave') && 'heatwave', startMedical() && 'medical', delayTrain() && 'train', vipNow() && 'vip'] },
  { k: 'storm', ready: () => !S.storm || S.storm.struck === null, wait: 60, run: () => [strikeNow() && 'storm'] },
  { k: 'heat', ready: () => powered() && S.elevators.some(e => e.mode === 'normal'), wait: 150, run: () => [triggerHeat() && 'heat'] },
  { k: 'cars', ready: () => powered() && S.elevators.some(e => e.mode === 'normal'), wait: 90,
    run: () => runIn('cars') },
  { k: 'guests', ready: () => !S.fire, wait: 90, run: () => [spawnBus() > 0 && 'bus', ...runIn('guests')] },
  { k: 'fire', ready: () => !S.fire, wait: 120, run: () => { startFire(pick(FIRE_FLOORS)); return ['fire']; } },
  // kuppen kan inte börja under branden eller strömavbrottet, och inte när flyttbilen står vid lastkajen:
  // den blir finalen när det har lugnat sig
  { k: 'heist', ready: heistPossible, wait: 300, run: () => { if (!startHeist()) return []; S.heistDay = S.day; return ['heist']; } },
  { k: 'move', ready: () => !S.move || S.move.state === 'planned', wait: 60, run: () => [moveNow() && 'move'] },
];
/** stegen som kan hoppas över (de som startar något) */
const STEP_KEYS = { start: ['heatwave', 'medical', 'train', 'vip'], storm: ['storm'], heat: ['heat'], fire: ['fire'], heist: ['heist'], move: ['move'] };
/** @param {string} k */
const stepKeys = k => (k === 'cars' ? chaosIn('cars').map(s => s.key) : k === 'guests' ? ['bus', ...chaosIn('guests').map(s => s.key)] : STEP_KEYS[k] || []);
/** hur länge kedjan högst väntar på att det ska lugna sig efter sista steget (s) */
const TAIL_MAX = 900;

/** kan kaosknappen tryckas nu? (en gång per dygn, och inte medan en kedja pågår) */
export const chaosReady = () => S.chaosDay !== S.day && !S.chaos;
/** Spelaren trycker på kaosknappen. Returnerar false om den redan är använd i dag. */
export function startChaos() {
  if (!chaosReady()) return false;
  S.chaosDay = S.day;
  S.chaos = { t0: S.t, i: 0, at: S.t, waitT: 0, did: [], missed: [], ph: 'run', tailT: 0 };
  return true;
}
/** det har lugnat sig: ingen incident pågår och ingen sitter instängd */
const calm = () => !anyIncident()
  && !S.elevators.some(e => e.passengers.length && (e.mode === 'snapped' || e.mode === 'broken'));
export function chaosTick(dt) {
  const C = S.chaos;
  if (!C) return;
  if (C.ph === 'tail') {
    C.tailT += dt;
    if (calm() || C.tailT > TAIL_MAX) endChaos(C);
    return;
  }
  if (S.t < C.at) return;
  const st = STEPS[C.i];
  if (st.ready && !st.ready()) {
    C.waitT += dt;
    if (C.waitT < (st.wait ?? 0)) return;
    C.missed.push(...stepKeys(st.k));
  } else {
    const got = /** @type {string[]} */ (st.run().filter(Boolean));
    C.did.push(...got);
    C.missed.push(...stepKeys(st.k).filter(k => !got.includes(k)));
  }
  C.i++; C.waitT = 0; C.at = S.t + (C.i === 1 ? 4 : rand(6, 12));
  if (C.i >= STEPS.length) C.ph = 'tail';
}
/** @param {Chaos} C */
function endChaos(C) {
  const min = Math.max(1, Math.round((S.t - C.t0) / 60)), names = ks => ks.map(k => chaosNames()[k]).join(' · ');
  log(`✅ Murphys lag är över – huset klarade ${C.did.length} saker som gick fel`, 'alert');
  incidentOver('chaos', '✅ Murphys lag är över',
    `${C.did.length} saker gick fel på ${min} min: ${names(C.did)}.` + (C.missed.length ? ` Det här hann aldrig hända: ${names(C.missed)}.` : ''));
  S.chaos = null;
}
/** nytt dygn från början (resetDay): knappen är plomberad igen */
export function chaosReset() { S.chaos = null; S.chaosDay = 0; }
