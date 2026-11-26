// Hiss-O-Matic 3000 kraschar: styrsystemet som fördelar hissarna går ner. Hissarna går då i nödläge: ingen får
// en hiss tilldelad, varje korg pendlar upp och ner i sitt schakt och stannar på VARJE våning den passerar, och
// folk kliver på den första korg som öppnar åt rätt håll (som förr i tiden). Det fungerar – men det går långsamt.
// Driftcentralen ringer leverantörens support. Driftchefen (chief.js) eller spelaren (act('crash', …)) väljer:
//   nod  – låt hissarna gå i nödläge tills supporten har hittat felet (lugnt, men långsamt hela tiden)
//   boot – ”Har du testat att starta om?” – en hård omstart: alla hissar står still där de är medan systemet
//          startar (BOOT_S), och omstarten lyckas inte alltid (BOOT_OK) – då blir det blå skärm och nödläge igen
// Hissar i oberoende drift (flyttgubbarna, ambulansen), VIP-låset och kapade hissar styrs inte av Hiss-O-Matic.
// (Simulering: läget ligger i S.crash; elevators.js och dispatch.js frågar crashRun/crashed. Egen slumpström.)
import { stream } from './rng.js';
const { rand, rng } = stream('krasch');
import { S, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';
import { allowedPos, outReason, rebuildPicks } from './dispatch.js';
import { sv } from './sv.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */

/**
 * Kraschen (S.crash): ph = 'nod' (nödläge) eller 'boot' (omstart pågår till bootEnd); mode = '' (inget beslut),
 * 'nod' eller 'boot'; until = när supporten har hittat felet; boots/failed = omstarter och misslyckade omstarter;
 * line = supportsamtalets nästa replik (nextLine); stops = stopp i nödläge.
 * @typedef {{ t0: number, ph: 'nod'|'boot', mode: string, by: string, until: number, bootEnd: number, boots: number,
 *   failed: number, line: number, nextLine: number, stops: number }} Crash
 */
/** omstarten tar (s) – alla hissar står still under tiden */
export const BOOT_S = 22;
/** chansen att en omstart lyckas */
export const BOOT_OK = 0.65;
/** supportsamtalet: replikerna i tur och ordning (och hur långt efter den förra de kommer, s) */
/** @type {{ dt: number, text: string }[]} */
const SUPPORT = [
  { dt: 4, text: '📞 Driftcentralen ringer Hiss-O-Matics support: ”Ni står i kö. Ni är nummer fjorton.”' },
  { dt: 16, text: '📞 Supporten: ”Har ni testat att starta om?”' },
  { dt: 30, text: '📞 Supporten: ”Vi ser felet i loggen. Det är en minnesläcka i hallanropen.”' },
  { dt: 30, text: '📞 Supporten: ”Vi skickar en rättning på diskett med bud.”' },
];

/** kan styrsystemet krascha nu? */
export const crashPossible = () => !S.crash && S.power && !S.fire;
/** styrsystemet ligger nere (nödläge eller omstart): ingen fördelar hissarna */
export const crashed = () => !!S.crash;
/** hissen pendlar i nödläge och stannar på varje våning @param {Elevator} e */
export const crashRun = e => !!S.crash && S.crash.ph === 'nod' && e.mode === 'normal' && !e.indep && !e.vipLock && !e.hijack && !outReason(e);
/** en hållplats för hissen i nödläget (bara där den får stanna) @param {Elevator} e */
const stopOk = (e, g) => e.stops.has(g) && allowedPos(e, g);
/** nödlägets riktning från våningen f: samma håll som förut, och vänd vid schaktets ände @param {Elevator} e */
export function sweepDir(e, f) {
  const d = e.dir || (f > (e.minF + e.maxF) / 2 ? -1 : 1);
  const more = dd => [...e.stops].some(g => (g - f) * dd > 0 && stopOk(e, g));
  return more(d) ? d : more(-d) ? -d : 0;
}
/** stannar hissen i nödläge på våningen g? (inte där den nyss stannade och fortfarande står) @param {Elevator} e */
export const sweepStop = (e, g) => stopOk(e, g) && !(g === e.floor && Math.abs(g - e.pos) < 0.001);

/** ingen har längre någon hiss: alla tilldelningar och hallanrop släpps */
function dropAll() {
  for (const p of S.people) if (p.state === 'wait') p.assigned = null;
  for (const c of Object.values(S.calls)) c.car = null;
  for (const e of S.elevators) e.parkTarget = null;
  rebuildPicks();
}
/** Slumpen eller spelaren (act('trigger', 'crash')): styrsystemet kraschar. false om det inte kan just nu. */
export function startCrash() {
  if (!crashPossible()) return false;
  S.crash = { t0: S.t, ph: 'nod', mode: '', by: '', until: S.t + rand(110, 160), bootEnd: 0, boots: 0, failed: 0,
    line: 0, nextLine: S.t + SUPPORT[0].dt, stops: 0 };
  dropAll();
  log('🖥️ Hiss-O-Matic 3000 har kraschat! Hissarna går i nödläge och stannar på varje våning', 'alert');
  S.fx.push({ x: 380, y: 0, text: 'FATAL ERROR', color: '#3f7cff', life: 2 });
  incidentStarted(null);
  return true;
}
/** Beslutet: 'nod' (vänta ut supporten) eller 'boot' (starta om). by = 'chief' eller 'player'. */
export function setCrashMode(mode, by) {
  const C = S.crash;
  if (!C || C.ph !== 'nod' || (mode !== 'nod' && mode !== 'boot')) return false;
  C.mode = mode; C.by = by;
  if (mode === 'boot') boot(C);
  else log('🖥️ Hissarna går i nödläge tills supporten har hittat felet', 'alert');
  return true;
}
/** den hårda omstarten: alla hissar står still där de är tills systemet är uppe igen @param {Crash} C */
function boot(C) {
  C.ph = 'boot'; C.bootEnd = S.t + BOOT_S; C.boots++;
  for (const e of S.elevators) if (e.mode === 'normal') e.restartAt = C.bootEnd + e.id * 0.7;
  log(sv`🖥️ Hiss-O-Matic startas om – alla hissar står still i ${BOOT_S} s`, 'alert');
}

/** @param {number} _dt */
export function crashTick(_dt) {
  const C = S.crash;
  if (!C) return;
  // supporten i telefonen (en replik i taget)
  if (C.line < SUPPORT.length && S.t >= C.nextLine) {
    log(SUPPORT[C.line].text, 'chief');
    C.line++;
    if (C.line < SUPPORT.length) C.nextLine = S.t + SUPPORT[C.line].dt;
  }
  if (!S.power) return; // (strömavbrott: allt står ändå still – kraschen väntar)
  if (C.ph === 'boot' && S.t >= C.bootEnd) {
    // den andra omstarten lyckas alltid (supporten är med i telefonen)
    if (rng() < BOOT_OK || C.boots >= 2) { finish(C); return; }
    C.ph = 'nod'; C.failed++; C.mode = '';
    C.until = Math.max(C.until, S.t + rand(40, 70));
    for (const e of S.elevators) e.restartAt = 0;
    dropAll();
    log('🖥️ BLÅ SKÄRM! Omstarten misslyckades – hissarna går i nödläge igen', 'alert');
    S.fx.push({ x: 380, y: 0, text: 'BLÅ SKÄRM', color: '#3f7cff', life: 2 });
    return;
  }
  if (C.ph === 'nod' && S.t >= C.until) finish(C);
}
/** systemet är uppe: hissarna startar om en i taget och styrningen fördelar dem igen @param {Crash} C */
function finish(C) {
  const sec = Math.round(S.t - C.t0);
  for (const e of S.elevators) if (e.mode === 'normal') e.restartAt = S.t + 0.5 + e.id * 0.5;
  S.crash = null;
  rebuildPicks();
  log('✅ Hiss-O-Matic 3000 är igång igen – hissarna styrs som vanligt', 'alert');
  const how = C.boots && !C.failed ? 'En omstart löste det.'
    : C.failed ? sv`Omstarten misslyckades ${C.failed === 1 ? 'en gång' : sv`${C.failed} gånger`} innan systemet kom upp.`
      : 'Hissarna gick i nödläge tills supporten hade hittat felet.';
  incidentOver('crash', '✅ Hiss-O-Matic är igång igen', sv`Styrsystemet låg nere i ${sec} s. ${how} Hissarna stannade ${C.stops} gånger i nödläge.`);
}
/** ett stopp i nödläge (för sammanfattningen) */
export function crashStop() { if (S.crash) S.crash.stops++; }

export function crashReset() { S.crash = null; }
