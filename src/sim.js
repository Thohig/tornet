// Simuleringssteget, fast tidssteg och nollställning av dagar.
import { rand, rng, setSeed } from './rng.js';
import { K, fl } from './util.js';
import { END_H, FLOORS, MAXP, timeScale, pace, setTempo, LOBBY, CAFE, floorWith, floorOpen, EL, ROOF, STATION } from './config.js';
const SPA = floorWith('spa');
import { S, hooks, hour, log, newStats } from './state.js';
import { spawnEmployee, spawnStaff, spawnVisitor, updatePerson, spawnPizza, rerouteStranded, spawnDogOwner } from './people.js';
import { canTake, costBased, dispatchPerson, rebuildPicks, reoptimize, stopFloors, trafficMode, keyed, prio, learnBlend, emptyLearn, outReason } from './dispatch.js';
import { serviceTick } from './service.js';
import { castSchedule } from './cast.js';
import { makeElevator, updateElevator, releaseCalls } from './elevators.js';
import { buttonsMode, buttonWaitTick, dispatchCalls } from './buttons.js';
import { incidentTick, planIncidents } from './incidents.js';
import { lifeTick, lifeReset } from './life.js';
import { stormTick, weatherReset } from './weather.js';
import { TRAIN_SHARE, trainReset, trainTick } from './train.js';
import { medicClear, visitsReset, visitsTick } from './visits.js';
import { hoistReset, hoistTick } from './hoist.js';
import { chiefReset, chiefTick } from './chief.js';

// ---------- Planerad rutt (för HUD) ----------
export function plannedRoute(e) {
  if (e.mode === 'recall') return [e.home];
  if (e.mode === 'rescue') return [e.rescueTarget];
  if (e.mode === 'lift') return [e.target ?? e.terraceF];
  const items = [];
  for (const f of e.carCalls) items.push({ f, k: 'car' });
  for (const k in e.pick) items.push({ f: parseInt(k, 10), k: k.endsWith('u') ? 1 : -1 });
  if (!items.length) return e.parkTarget !== null ? [e.parkTarget] : [];
  const pos = e.pos;
  let d = e.dir;
  if (!d) {
    const n = items.reduce((a, b) => (Math.abs(b.f - pos) < Math.abs(a.f - pos) ? b : a));
    d = Math.sign(n.f - pos) || (n.k === 'car' ? 1 : n.k);
  }
  const leg1 = items.filter(i => (i.f - pos) * d > -0.01 && (i.k === 'car' || i.k === d));
  const rest = items.filter(i => !leg1.includes(i));
  leg1.sort((a, b) => (a.f - b.f) * d);
  rest.sort((a, b) => (b.f - a.f) * d);
  const out = [];
  for (const i of [...leg1, ...rest]) if (out[out.length - 1] !== i.f) out.push(i.f);
  return out;
}

// ---------- Simuleringssteg ----------
// Trafikprofil över dygnet (personer per simuleringssekund). ARRIVAL_MUL höjer inflödet så att huset
// fylls under den korta dagen (6-minutersdygnet, se EMP_K för det långa) – testerna larmar om hissarna blir överbelastade.
const ARRIVAL_MUL = 1.6;
// Anställda i ett längre dygn: rusningen varar längre i verklig tid. Med EMP_K = 0 är trycket per sekund
// detsamma (många fler anställda), med 1 kommer lika många som i 6-minutersdygnet (glesa, lugna rusningar).
// 0.3 ger ungefär samma väntetider över dygnet som det korta dygnet (p50 ≈ 9 s, p95 ≈ 38 s) med knappt
// dubbelt så många anställda – mätt med sex frön, Smart.
export const EMP_K = 0.3;
function arrivalRate(h) { return ARRIVAL_MUL * baseRate(h) * pace(h) ** EMP_K; }
function baseRate(h) {
  if (h < 6.5) return 0.02; if (h < 7) return 0.08; if (h < 7.3) return 0.21;
  if (h < 9.3) return 0.56; if (h < 10.2) return 0.18; if (h < 15) return 0.03;
  return 0;
}
// Kvälls- och nattpersonalens schema (klockslag 6–30)
function makeSchedule() {
  return [
    { at: 17.5, run: () => { for (let i = 0; i < 3; i++) spawnStaff('städare'); } },
    { at: 20.5, run: () => spawnStaff('vaktmästare') },
    { at: 21.5, run: () => spawnStaff('nattdj') },
    { at: 22, run: () => spawnStaff('väktare') },
    { at: 22.2, run: () => spawnStaff('nattekniker') },
    { at: 24.5, run: () => spawnPizza() },
    { at: 26.8, run: () => spawnVisitor(LOBBY, -30, floorWith('server'), 'Akut serverlarm – ringde in från jouren') },
    ...castSchedule(), // stamgästerna kommer på sina vanliga tider
  ];
}
export function spawnTick(dt) {
  const h = hour();
  if (S.fire) return; // vid brand släpps ingen in
  for (const ev of S.sched) if (!ev.done && h >= ev.at) { ev.done = true; ev.run(); }
  if (S.people.length >= MAXP) return;
  // en del av de anställda kommer med tunnelbanan i stället (train.js tar med dem)
  if (rng() < arrivalRate(h) * (STATION >= 0 ? 1 - TRAIN_SHARE : 1) * dt) spawnEmployee();
  const lunch = h >= 11.2 && h < 12.8;
  let v = h >= 9 && h < 17 ? 0.045 : 0;
  if (lunch) v += 0.07;
  // besökarna räknas per speltimme (pace): ett längre dygn ger inte fler besökare, bara glesare
  const pc = pace(h);
  v *= ARRIVAL_MUL * pc;
  // (hundägarna till hundsalongen delar slumptalet med besökarna – ett extra rng() i varje steg skulle flytta
  // hela dygnets slumpföljd, och testerna har visat sig känsliga för hur många slumptal varje steg drar)
  const u = rng();
  if (u < v * dt) spawnVisitor(LOBBY, -30, lunch && rng() < 0.7 ? CAFE : null);
  else if (SPA >= 0 && floorOpen(SPA, h) && floorOpen(SPA, h + 1.2) && u < (v + 0.02 * pc) * dt) spawnDogOwner();
  // turister åker panoramahissen upp till takterrassen
  if (ROOF >= 0 && h >= 9.5 && h < 19 && rng() < 0.02 * pc * dt) spawnVisitor(LOBBY, -30, ROOF, 'Utsikt från takterrassen');
  if (h >= 17 && h < 20.5 && rng() < 0.03 * pc * dt) spawnVisitor(LOBBY, -30, floorWith('aerobic'), 'Kvällspass på Svettis');
}
// Nattläge (Smart, Rusning, Energisnål): överflödiga hissar somnar i entrén för att spara energi och vaknar vid kö.
// Energisnål låter dessutom lediga hissar sova dygnet runt, där de står.
function nightModeTick(dt) {
  const h = hour();
  const eco = S.strategy === 'eco';
  const night = costBased() && S.power && (eco || (h >= 22.5 && h < 29.5));
  const waiting = S.people.filter(p => p.state === 'wait');
  if (!night) {
    for (const e of S.elevators) if (e.sleep) { e.sleep = false; log(`☀️ ${e.name} vaknar ur nattläget`, 'park', e.color); }
    return;
  }
  // gruppens vakthiss: den första som kan köra (en trasig hiss, en på service eller en avstängd räknas inte)
  const usable = e => !outReason(e) && !e.indep;
  const keeper = g => S.elevators.find(x => x.group === g && usable(x));
  for (const e of S.elevators) {
    const k = keeper(e.group);
    if (k === e && e.sleep) { e.sleep = false; e.sleepT = 0; log(`☀️ ${e.name} vaknar – den ska hålla vakt i gruppen`, 'park', e.color); }
  }
  // (natten går fort: 8 s väntan är nästan en speltimme)
  if ((waiting.length > 3 || waiting.some(p => S.t - p.waitStart > 8)) && S.t >= (S.wakeAt || 0)) {
    // väck en hiss som kan ta någon i kön (den som har väntat längst först) – en åt gången, med en kort paus,
    // så att inte alla hissar vaknar för samma kö
    const queue = [...waiting].sort((a, b) => a.waitStart - b.waitStart);
    for (const p of queue) {
      const z = S.elevators.find(e => e.sleep && usable(e) && canTake(e, p));
      if (z) { z.sleep = false; z.sleepT = 0; S.wakeAt = S.t + 3; log(`⏰ ${z.name} väcks ur nattläget – det bildas kö`, 'park', z.color); return; }
    }
  }
  // (en kö som en hiss inte kan ta – t.ex. i en annan zon – hindrar den inte från att somna)
  for (const e of S.elevators) {
    const idle = usable(e) && !e.medicHold && e.state === 'idle' && (eco ? e.stops.has(Math.round(e.pos)) : Math.round(e.pos) === e.home)
      && !e.passengers.length && !stopFloors(e).length;
    e.sleepT = idle ? (e.sleepT || 0) + dt : 0;
    // en hiss per grupp är alltid vaken
    if (e !== keeper(e.group) && !e.sleep && e.sleepT > 8 && !waiting.some(p => canTake(e, p))) {
      e.sleep = true; log(`🌙 ${e.name} går i viloläge på ${fl(Math.round(e.pos))} – sparar energi`, 'park', e.color);
    }
  }
}
export function step(dt) {
  S.t += dt;
  S.clock += dt * timeScale(hour());
  spawnTick(dt);
  lifeTick(dt);
  trainTick(dt, arrivalRate);
  visitsTick(dt);
  hoistTick(dt);
  stormTick(dt);
  nightModeTick(dt);
  for (const p of S.people) updatePerson(p, dt);
  if (S.people.some(p => p.dead)) S.people = S.people.filter(p => !p.dead);
  incidentTick(dt);
  chiefTick(dt);
  rebuildPicks();
  const wl = Array.from({ length: FLOORS }, () => ({ u: [], d: [] }));
  for (const p of S.people) {
    if (p.state !== 'wait') continue;
    wl[p.floor][K(p.dir)].push(p);
    // KNAPPAR: folk trycker på knappar; VIP-gruppen har nyckel och styrs som vanligt
    if (buttonsMode() && !keyed(p)) { buttonWaitTick(p, dt); continue; }
    if (p.assigned === null && !(p.retypeAt > S.t)) dispatchPerson(p);
  }
  if (buttonsMode()) dispatchCalls();
  S.wl = wl;
  // VIP-läge: hissen som tar VIP-gruppen tar inga andra under tiden
  // (VIP-gästerna plockas ut en gång – loopen nedan ändrar bara vanliga personer)
  const vips = S.people.filter(prio);
  for (const e of S.elevators) {
    if (!vips.length) { e.vipLock = false; continue; } // (nästan alltid: ingen VIP eller ambulans i huset)
    const holders = vips.filter(p => ((p.state === 'wait' && p.assigned === e.id) || ((p.state === 'boarding' || p.state === 'ride') && p.car === e)));
    // (ambulansens hiss är låst även medan den står och väntar på personalen)
    const lock = holders.length > 0 || e.medicHold;
    if (lock && !e.vipLock) {
      const medic = e.medicHold || holders.some(p => p.medic), who = medic ? 'ambulansen' : 'VIP-gruppen';
      log(medic ? `🚑 Förtur: ${e.name} reserveras för ambulansen` : `👔 VIP-läge: ${e.name} reserveras för VIP-gruppen`, 'alert', e.color);
      // de som redan hade fått hissen får en annan
      e.vipLock = lock;
      releaseCalls(e, `reserveras för ${who}`, prio);
      // ambulansen har förtur: passagerarna som inte ska åt samma håll kliver av vid nästa stopp
      if (medic) medicClear(e);
      rebuildPicks();
      // den som bara kunde åka med den här hissen tar en annan väg (t.ex. från taket via höga zonen)
      rerouteStranded();
      for (const p of S.people) if (p.state === 'wait' && p.assigned === null && !prio(p) && !(buttonsMode() && !keyed(p))) dispatchPerson(p);
    }
    e.vipLock = lock;
  }
  for (const e of S.elevators) updateElevator(e, dt);
  serviceTick(dt);
  if (S.strategy === 'peak') {
    const m = trafficMode(hour());
    if (m !== S.peakMode) {
      S.peakMode = m;
      log(m === 'upp' ? '🚦 Rusningsläge UPP: lediga hissar kör direkt till entrén och väntar på fler'
        : m === 'ned' ? '🚦 Rusningsläge NED: lediga hissar väntar högst upp i sina zoner'
          : m === 'lunch' ? '🚦 Rusningsläge LUNCH: hissarna sprids ut över huset' : '🚦 Rusningsläget av – jämn trafik', 'park');
    }
  } else S.peakMode = null;
  if ((costBased() || buttonsMode()) && S.power) {
    S.reoptT -= dt;
    if (S.reoptT <= 0) { S.reoptT = 1.5; if (buttonsMode()) dispatchCalls(true); else reoptimize(); }
  }
  if (hour() >= END_H && !S.summaryShown) { S.summaryShown = true; hooks.dayEnd(); }
}
// Fast tidssteg: verklig tid samlas på hög och simuleringen tar alltid exakt lika långa steg.
// Då beter sig spelet likadant oavsett bildfrekvens och hastighet.
export const DT = 1 / 30;
export function advance(realDt, speed) {
  S.acc = Math.min((S.acc || 0) + realDt * speed, 2);
  let n = 0;
  while (S.acc >= DT) { step(DT); S.acc -= DT; n++; }
  return n;
}
// En ny dag: allt nollställs och slumpen seedas om, så att varje dag är reproducerbar.
export const daySeed = () => (Math.imul(S.seed >>> 0, 1000003) + S.day) >>> 0;
export function resetDay() {
  setSeed(daySeed());
  // lärande parkering: gårdagens anrop vägs in i minnet (följer med till nästa dygn, som slitaget)
  learnBlend(); S.learnToday = emptyLearn();
  S.t = 0; S.clock = 0; S.sched = makeSchedule(); S.acc = 0; S.summaryShown = false; S.nextId = 1; S.sel = null; S.wl = null; S.reoptT = 0;
  S.people = []; S.stats = newStats(); S.calls = {};
  S.fire = null; S.power = true; S.outage = null; S.techCallAt = null; S.techCall = null; S.extraAt = null; S.powerBack = null; S.brigade = null; S.peakMode = null; S.wakeAt = 0;
  S.notices = []; S.feed = []; // gårdagens informationsrutor visas inte igen (klockan S.t börjar om från 0)
  S.occ = new Map();
  // slitaget följer med från gårdagen (dag 1: slumpat – huset är inte nytt)
  const carry = S.day > 1 && S.elevators.length === EL.length ? S.elevators.map(e => e.wear) : null;
  S.elevators = EL.map((_, i) => makeElevator(i));
  for (const e of S.elevators) { const w0 = rand(0.1, 0.5); e.wear = carry ? carry[e.id] : w0; }
  lifeReset();
  trainReset();
  weatherReset();
  visitsReset();
  hoistReset();
  planIncidents(); // (sist: tidtabellen slumpas när allt annat är på plats)
  S.lastInc = null;
  chiefReset();
}
export function newSim(seed, opts = {}) {
  S.seed = seed >>> 0; S.day = opts.day || 1; S.log = []; S.fx = []; S.elevators = [];
  S.learnMem = null; S.learnToday = null; S.notices = []; S.dismissed = new Set();
  if (opts.strategy) S.strategy = opts.strategy;
  // slumpen: incLevel (av/lugn/normal/kaos), eller autoInc (sant = normal, falskt = av) som förr
  if (opts.incLevel !== undefined) S.incLevel = opts.incLevel;
  else if (opts.autoInc !== undefined) S.incLevel = opts.autoInc ? 'normal' : 'av';
  // driftchefen: på från början (chief: false = allt väntar på spelaren); chiefStrat = får byta styrlogik i rusningen
  S.chief = null;
  chiefReset();
  if (opts.chief !== undefined) S.chief.on = !!opts.chief;
  if (opts.chiefStrat !== undefined) S.chief.strat = !!opts.chiefStrat;
  if (opts.mistakes !== undefined) S.mistakes = opts.mistakes;
  if (opts.maint !== undefined) S.maint = opts.maint;
  S.tempo = setTempo(opts.tempo ?? S.tempo);
  resetDay();
}
