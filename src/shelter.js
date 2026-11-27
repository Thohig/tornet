// Skyddsrummet i berget (SR, mellan tunnelbanan och pendeln): provlarmet och skyddsrumsövningen.
//
// Hesa Fredrik: första måndagen i mars, juni, september och december kl 15 provas larmet ”Viktigt meddelande till
// allmänheten” (S.cal.hesa, calendar.js). Ingen ska göra något – men alla tittar upp, några undrar och Göran i Kronan
// skämtar i driftradion. Efteråt passar driftchefen på att hålla skyddsrumsövning.
//
// Skyddsrumsövningen (S.ovning, act('trigger', 'ovning') – eller efter provlarmet): huset går ner till skyddsrummet
// våning för våning. Driftchefen (chief.js) eller spelaren (act('ovning', …)) väljer ordningen:
//   top    – uppifrån: de som har längst väg börjar, och hissarna går fulla nedåt hela tiden
//   bottom – nerifrån: de nedersta är snabbt nere och står inte i vägen när de högre våningarna kommer
// Alla som sitter på sin plats (inte de som är på väg hem, personalen eller turisterna) går ner – med hissarna som
// når skyddsrummet (X1:s övre däck, pendelhissen) eller trappan. När alla är nere (eller tiden är slut) räknas de,
// och sedan går alla tillbaka dit de var.
// (Simulering: S.ovning, och p.drill/p.drillFrom på dem som är med. Egen slumpström `skyddsrum`.)
import { stream } from './rng.js';
const { pick } = stream('skyddsrum');
import { S, hour, incidentOver, log, notice } from './state.js';
import { incidentStarted } from './incidents.js';
import { sv } from './sv.js';
import { FL, FLOORS, PENDEL, SHELTER, SKY, STATION } from './config.js';
import { pev, releaseSpot, setTrip } from './people.js';
import { chiefNote } from './chief.js';
import { fl } from './util.js';
/** @typedef {import('./people.js').Person} Person */

/**
 * Skyddsrumsövningen (S.ovning): t0 = när den började; ph = 'wait' (väntar på ordningen) → 'call' (våningarna kallas
 * ner en i taget) → 'in' (alla är nere och räknas); order = '' | 'top' | 'bottom', by = vem som bestämde; queue =
 * våningarna i den ordning de kallas, fi = nästa i tur, nextAt = när; total = hur många som kallats, inside = hur
 * många som är nere, lastCall = när den sista våningen kallades; inT = när räkningen började; hesa = efter provlarmet.
 * @typedef {{ t0: number, ph: 'wait'|'call'|'in', order: string, by: string, queue: number[], fi: number, nextAt: number,
 *   total: number, inside: number, lastCall: number, inT: number, hesa: boolean }} Ovning
 */
/** skyddsrummets ståldörr i hallen (världens x – pixhall.js ritar den där, och där försvinner man in) */
export const SHELTER_DOOR_X = 432;
/** provlarmet: kl 15, och signalen ljuder i två minuter (speltid) */
export const HESA_H = 15, HESA_LEN = 2 / 60;
/** övningen efter provlarmet börjar strax efter */
const HESA_DRILL_H = 15.15;
/** mellan två våningar som kallas ner (s), och hur länge man väntar på de sista innan man räknar */
const CALL_S = 3, LATE_S = 90, COUNT_S = 8, MAX_S = 260;
/** det folk säger när provlarmet går */
const HESA_SAYS = ['Är det måndag? Jaha, provlarmet.', 'Viktigt meddelande… nej, det är bara kvartalet.', 'Klockan tre – då vet vi att klockan går rätt.',
  'Hesa Fredrik! Han låter som vanligt.', 'Ska vi göra något? Nej, va?'];

/** kan övningen börja nu? (huset har skyddsrum, det brinner inte och strömmen är på) */
export const ovningPossible = () => SHELTER >= 0 && !S.ovning && !S.fire && S.power && hour() >= 7 && hour() < 21;
/** går provlarmet just nu? (för ljudet och skylten) */
export const hesaNow = () => S.cal.hesa && hour() >= HESA_H && hour() < HESA_H + HESA_LEN;
/** våningarna som kallas ner, nerifrån och upp (inte berget, där man redan är, eller perrongerna) */
const drillFloors = () => Array.from({ length: FLOORS }, (_, f) => f).filter(f => f !== SHELTER && f !== PENDEL && f !== STATION);
/** är p med på övningen om hen sitter på våningen nu? (inte personalen, rollerna, turisterna, VIP eller de boende) @param {Person} p */
const joins = p => !p.dead && p.state === 'office' && !p.leaving && !p.role && !p.crewId && !p.vip && !p.tour && !p.guide && !p.guest
  && !p.touring && !p.dog && !p.collapsed && !p.hostage && !p.robber && p.kind !== 'res' && !p.drill;

/** Slumpen inte – spelaren (act('trigger', 'ovning')) eller driftchefen efter provlarmet: övningen börjar. */
export function startOvning(hesa = false) {
  if (!ovningPossible()) return false;
  S.ovning = { t0: S.t, ph: 'wait', order: '', by: '', queue: [], fi: 0, nextAt: S.t, total: 0, inside: 0, lastCall: S.t, inT: 0, hesa };
  log('🛡️ Skyddsrumsövning! Huset ska ner i skyddsrummet – våning för våning', 'alert');
  notice('ovning', '🛡️ Skyddsrumsövning', sv`Huset övar att gå ner i skyddsrummet på ${fl(SHELTER)}, våning för våning. Hissarna som når dit är X1:s övre däck och pendelhissen – resten får ta trappan.`, { floor: SHELTER });
  incidentStarted(SHELTER);
  return true;
}
/** Ordningen: 'top' (uppifrån) eller 'bottom' (nerifrån). by = 'chief' eller 'player'. */
export function setOvningOrder(order, by) {
  const X = S.ovning;
  if (!X || (order !== 'top' && order !== 'bottom') || X.ph === 'in') return false;
  if (X.order === order) return true;
  X.order = order; X.by = by;
  // (våningar som redan kallats står kvar först; resten läggs i den nya ordningen)
  const done = X.queue.slice(0, X.fi), rest = drillFloors().filter(f => !done.includes(f));
  X.queue = [...done, ...(order === 'top' ? rest.reverse() : rest)];
  if (X.ph === 'wait') { X.ph = 'call'; X.nextAt = S.t; }
  log(order === 'top' ? '🛡️ Övningen går uppifrån – de som har längst väg börjar' : '🛡️ Övningen går nerifrån – de nedersta först', 'alert');
  return true;
}
/** hur många som är med och var de är (kortet och regissören) */
export const drillers = () => S.people.filter(p => !p.dead && p.drill);
/** de som sitter i skyddsrummet */
const insideNow = () => drillers().filter(p => p.floor === SHELTER && p.state === 'office').length;

/** @param {number} _dt */
export function shelterTick(_dt) {
  if (SHELTER < 0) return;
  hesaTick();
  const X = S.ovning;
  if (!X) return;
  // brand eller strömavbrott: övningen avbryts (det får bli på riktigt i stället)
  if (S.fire || !S.power) { finish(X, S.fire ? 'Övningen avbröts – brandlarmet går på riktigt.' : 'Övningen avbröts – strömmen gick.'); return; }
  // (utan beslut efter en stund: uppifrån, som det står i pärmen)
  if (X.ph === 'wait' && S.t - X.t0 > 8) setOvningOrder('top', 'chief');
  if (X.ph === 'call' && S.t >= X.nextAt) {
    if (X.fi < X.queue.length) callFloor(X, X.queue[X.fi++]);
    X.nextAt = S.t + CALL_S;
  }
  X.inside = insideNow();
  if (X.ph === 'call' && X.fi >= X.queue.length && (X.inside >= drillers().length || S.t - X.lastCall > LATE_S)) {
    X.ph = 'in'; X.inT = S.t;
    log(sv`🛡️ ${X.inside} är nere i skyddsrummet – räkning`, 'alert');
  }
  if ((X.ph === 'in' && S.t - X.inT >= COUNT_S) || S.t - X.t0 > MAX_S) finish(X);
}
/** våning f kallas ner @param {Ovning} X */
function callFloor(X, f) {
  let n = 0;
  for (const p of S.people) {
    if (p.floor !== f || !joins(p)) continue;
    p.drill = true; p.drillFrom = f; n++;
    releaseSpot(p);
    setTrip(p, SHELTER, 'Skyddsrumsövning – ner till skyddsrummet', false);
    pev(p, sv`Skyddsrumsövning: ${fl(f)} ska ner nu`);
  }
  X.total += n; X.lastCall = S.t;
  if (n) log(sv`🛡️ ${FL[f].name} (${fl(f)}) går ner till skyddsrummet – ${n} personer`, 'sys');
}
/** övningen är slut: alla går tillbaka dit de var @param {Ovning} X */
function finish(X, why = '') {
  let back = 0;
  for (const p of drillers()) {
    p.drill = false;
    const from = p.drillFrom ?? SKY;
    p.drillFrom = undefined;
    // (den som sitter i skyddsrummet eller står i kö går tillbaka; den som är i hissen eller trappan går tillbaka när hen är framme)
    if (p.state === 'office' || p.state === 'wait' || p.state === 'toQueue') {
      releaseSpot(p);
      setTrip(p, from, 'Övningen är slut – tillbaka upp', false);
      back++;
    }
  }
  const sec = Math.round(S.t - X.t0), late = X.total - X.inside;
  S.ovning = null;
  incidentOver('ovning', '✅ Skyddsrumsövningen är över', why || (X.total
    ? sv`${X.inside} av ${X.total} var nere i skyddsrummet efter ${sec} s.${late > 0 ? sv` ${late} hann inte ner.` : ''}`
    : 'Ingen satt på sin plats – övningen blev kort.'), { floor: SHELTER });
  if (back) log(sv`🛡️ Övningen är slut – ${back} går tillbaka upp`, 'sys');
}

// ---------- Hesa Fredrik ----------
function hesaTick() {
  const h = hour();
  if (!S.cal.hesa) return;
  if (S.hesaDay !== S.day && h >= HESA_H && h < HESA_H + 0.5) {
    S.hesaDay = S.day;
    log('📢 Hesa Fredrik ljuder – provlarmet ”Viktigt meddelande till allmänheten”, första måndagen i kvartalet', 'alert');
    notice('hesa', '📢 Hesa Fredrik', 'Klockan tre första måndagen i mars, juni, september och december provas larmet ”Viktigt meddelande till allmänheten”. Det är bara ett prov – ingen behöver göra något.');
    chiefNote('hesa', 'Det är bara provlarmet', 'första måndagen i kvartalet, klockan tre');
    // några som står i hallarna säger något (efter id, ingen slump: vem som står där beror på styrlogiken)
    const heard = S.people.filter(p => !p.dead && !p.role && (p.state === 'office' || p.state === 'wait')).slice(0, 6);
    for (const p of heard) pev(p, HESA_SAYS[p.id % HESA_SAYS.length]);
    S.hesaDrill = true;
  }
  // efter provlarmet: driftchefen håller skyddsrumsövning (om hen är på och det går)
  if (S.hesaDrill && h >= HESA_DRILL_H) {
    S.hesaDrill = false;
    if (S.chief && S.chief.on && startOvning(true)) chiefNote('ovning', 'Nu när alla ändå har hört larmet – skyddsrumsövning!', 'det är provlarmsdag');
  }
}
/** Göran i Kronan har något att säga om provlarmet (skywalk.js frågar) */
export const hesaLine = () => (S.cal.hesa && hour() >= HESA_H && hour() < HESA_H + 0.4 ? pick(['Hörde ni Fredrik? Han är hes som vanligt.', 'Provlarmet här också – Kronans folk tittade upp från luncherna.']) : null);

export function shelterReset() { S.ovning = null; S.hesaDrill = false; }
