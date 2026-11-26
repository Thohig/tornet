// Panik i hissen: en fullsatt korg tvärstannar mellan två våningar (som ett vanligt hissfel med instängda,
// service.js), och en av passagerarna får cellskräck. Hen trycker på alla våningsknappar, ringer larmet om och om
// igen och ropar – och de andra i korgen blir oroliga de också (level = hur illa det är, 0–1). Hissteknikern är på
// väg som vanligt. Driftchefen (chief.js) eller spelaren (act('panic', …)) väljer:
//   talk  – driftcentralen pratar lugnande med dem i nödtelefonen tills teknikern har lagat hissen; paniken lägger
//           sig sakta, men när hissen går igen stannar den på varje våning som hen tryckte på
//   crank – teknikern vevar ner korgen för hand till närmaste våning så fort hen är framme (crankDown i service.js)
//           och släpper ut dem; lagningen får vänta tills de är ute
// (Simulering: läget ligger i S.panic. Egen slumpström.)
import { stream } from './rng.js';
const { pick, rand } = stream('panik');
import { S, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';
import { allowedPos } from './dispatch.js';
import { crankDown, techOf } from './service.js';
import { pev, pn } from './people.js';
import { fl } from './util.js';
import { CAR_H, floorY, shaftCX } from './config.js';
import { sv } from './sv.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

/**
 * Paniken (S.panic): car = hissen; ph = 'wait' (korgen ska tvärstanna) → 'on' (de sitter fast) → 'ride' (lagad,
 * korgen åker med folket i och stannar där hen tryckte); who = den som fick panik; mode = '' (inget beslut), 'talk'
 * eller 'crank'; level = hur illa det är (0–1); alarms = hur många gånger larmet ringt; pressed = våningsknapparna
 * hen tryckte på; nextAlarm = nästa larm; n = hur många som satt fast.
 * @typedef {{ t0: number, car: number, ph: 'wait'|'on'|'ride', who: number, mode: string, by: string, level: number,
 *   alarms: number, pressed: number[], nextAlarm: number, n: number, onT: number }} Panic
 */
/** minst så många i korgen för att paniken ska sprida sig */
export const PANIC_MIN = 3;
/** så fort paniken lägger sig när någon pratar med dem, och växer annars (per sekund) */
const CALM = 0.03, GROW = 0.012;
/** det hen ropar (en replik i taget, i korgens pratbubbla) */
const SHOUTS = ['Släpp ut mig!', 'Jag får ingen luft!', 'Väggarna kommer närmare!', 'Hallå?! HALLÅ!', 'Varför händer inget?!'];
const CALMED = ['Okej… jag andas.', 'Tack. Det känns lite bättre.', 'Säg att det snart är klart.'];

/** hissar där det kan hända: fullsatta, i vanlig drift och på väg (inte panoramahissen – den har sin egen olycka) */
const candidates = () => S.elevators.filter(e => e.mode === 'normal' && !e.facade && !e.trapNext && e.state === 'moving'
  && e.passengers.length >= PANIC_MIN && !e.indep && !e.vipLock);
/** kan någon få panik nu? */
export const panicPossible = () => !S.panic && S.power && !S.fire && candidates().length > 0;
/** sitter folk fast mellan två våningar i hissen? @param {Elevator} e */
const trapped = e => e.mode === 'broken' && !!e.fault && !!e.fault.trapped && e.passengers.length > 0;

/** Slumpen eller spelaren (act('trigger', 'panic')): den fullaste korgen på väg tvärstannar snart. */
export function startPanic() {
  if (!panicPossible()) return false;
  const e = candidates().sort((a, b) => b.passengers.length - a.passengers.length)[0];
  e.trapNext = true; // (service.js: korgen stannar mellan två våningar – trapDue/trapBreak)
  S.panic = { t0: S.t, car: e.id, ph: 'wait', who: -1, mode: '', by: '', level: 0.5, alarms: 0, pressed: [], nextAlarm: 0, n: 0, onT: 0 };
  return true;
}
/** Beslutet: 'talk' (prata med dem) eller 'crank' (veva ner korgen). by = 'chief' eller 'player'. */
export function setPanicMode(mode, by) {
  const P = S.panic;
  if (!P || P.ph !== 'on' || (mode !== 'talk' && mode !== 'crank')) return false;
  if (P.mode === mode) return true;
  P.mode = mode; P.by = by;
  const e = S.elevators[P.car];
  log(mode === 'talk' ? sv`📞 Driftcentralen pratar med dem i ${e.name} i nödtelefonen` : sv`🔧 Teknikern vevar ner ${e.name} för hand så fort hen är framme`, 'alert', e.color);
  return true;
}
/** den som har panik ropar något (pratbubblan i korgen) @param {Person} p */
const shout = (p, text) => { p.say = { text, until: S.t + 4 }; };

/** @param {number} dt */
export function panicTick(dt) {
  const P = S.panic;
  if (!P) return;
  const e = S.elevators[P.car];
  if (P.ph === 'wait') {
    if (trapped(e)) begin(P, e);
    // (korgen hann aldrig stanna mellan två våningar, eller något annat hände: ingen panik den här gången)
    else if (S.t - P.t0 > 60 || (!e.trapNext && e.mode === 'normal')) { e.trapNext = false; S.panic = null; }
    return;
  }
  const who = S.people.find(p => p.id === P.who && !p.dead) || null;
  if (P.ph === 'on') {
    if (!trapped(e) || !who || who.car !== e) { out(P, e, who); return; }
    P.onT += dt;
    P.level = Math.max(0, Math.min(1, P.level + (P.mode === 'talk' ? -CALM : GROW) * dt));
    for (const p of e.passengers) p.mood = Math.max(p.mood, P.level > 0.6 ? 2 : 1);
    // larmknappen och våningsknapparna – oftare ju värre det är
    if (S.t >= P.nextAlarm && P.level > 0.15) {
      P.alarms++;
      P.nextAlarm = S.t + rand(5, 9) / (0.5 + P.level);
      const free = [...e.stops].filter(f => !P.pressed.includes(f) && allowedPos(e, f));
      if (free.length) P.pressed.push(pick(free));
      shout(who, pick(SHOUTS));
      S.fx.push({ x: shaftCX(e.id), y: floorY(e.pos) - CAR_H - 34, text: 'RIIING!', color: '#ff5d52', life: 1.2 });
      if (P.alarms % 3 === 1) log(sv`🔔 Larmet i ${e.name} ringer igen (${P.alarms}:e gången) – ${pn(who)} trycker på alla knappar`, 'alert', e.color, who.id);
    }
    if (P.mode === 'talk' && P.level <= 0.15 && P.level + CALM * dt > 0.15) { shout(who, pick(CALMED)); pev(who, 'Rösten i nödtelefonen hjälper – andas lugnt'); }
    // vevandet: teknikern vevar ner korgen så fort hen står vid den
    if (P.mode === 'crank') { const t = techOf(e); if (t) crankDown(t, 'panic'); }
    return;
  }
  // ph === 'ride': hissen är lagad och åker med dem – och stannar på varje våning hen tryckte på
  if (e.mode !== 'normal' || !who || who.car !== e) finish(P, e, 'ride');
}
/** korgen har tvärstannat: någon får panik @param {Panic} P @param {Elevator} e */
function begin(P, e) {
  // den som står ut minst med trängsel (p.space) får panik
  const who = [...e.passengers].filter(p => !p.dog && !p.medic).sort((a, b) => a.space - b.space || a.id - b.id)[0];
  if (!who) { S.panic = null; return; }
  P.ph = 'on'; P.who = who.id; P.n = e.passengers.length; P.nextAlarm = S.t + 1.5; P.level = 0.55;
  pev(who, 'Cellskräck! Trycker på alla knappar och ringer larmet');
  log(sv`😱 ${pn(who)} får panik i ${e.name} mellan två våningar – trycker på alla knappar och ringer larmet!`, 'alert', e.color, who.id);
  shout(who, 'Släpp ut mig! SLÄPP UT MIG!');
  incidentStarted(e.floor);
}
/** de är inte längre instängda: utsläppta (vevade) eller så går hissen igen med dem i @param {Panic} P @param {Elevator} e */
function out(P, e, who) {
  if (who && who.car === e && e.mode === 'normal') {
    // lagad med folket i: knapparna hen tryckte på gäller fortfarande
    for (const f of P.pressed) if (e.stops.has(f)) e.carCalls.add(f);
    P.ph = 'ride';
    if (P.pressed.length) log(sv`🔘 ${e.name} går igen – och stannar på alla ${P.pressed.length} våningar som ${pn(who)} tryckte på`, 'alert', e.color, who.id);
    return;
  }
  finish(P, e, 'out');
}
/** @param {Panic} P @param {Elevator} e */
function finish(P, e, how) {
  const who = S.people.find(p => p.id === P.who);
  S.panic = null;
  const name = who ? who.name : 'Någon';
  const end = how === 'out' ? sv`${P.mode === 'crank' ? 'Teknikern vevade ner korgen och släppte ut dem' : 'De kom ut'} efter ${Math.round(P.onT)} s.`
    : sv`Hissen lagades med dem i efter ${Math.round(P.onT)} s och stannade sedan på ${P.pressed.length} våningar i onödan.`;
  incidentOver('panic', sv`✅ Paniken i ${e.name} är över`, sv`${name} fick panik när ${e.name} tvärstannade med ${P.n} i korgen. Larmet ringde ${P.alarms} gånger. ${end}`, { car: e.id });
}
/** våningen där korgen sitter (för korten) @param {Panic} P */
export const panicWhere = P => fl(Math.floor(S.elevators[P.car].pos));

export function panicReset() { S.panic = null; }
