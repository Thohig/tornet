// Simuleringssteget, fast tidssteg och nollställning av dagar.
import { rand, rng, setSeed } from './rng.js';
import { K } from './util.js';
import { END_H, FLOORS, MAXP, SPOTS, TOP, timeScale, LOBBY, CAFE, floorWith, EL, ROOF } from './config.js';
import { S, hooks, hour, log, newStats } from './state.js';
import { spawnEmployee, spawnStaff, spawnVisitor, updatePerson, spawnPizza, pev } from './people.js';
import { dispatchPerson, rebuildPicks, reoptimize, stopFloors } from './dispatch.js';
import { makeElevator, updateElevator } from './elevators.js';
import { buttonsMode, buttonWaitTick, dispatchCalls } from './buttons.js';
import { incidentTick } from './incidents.js';
import { lifeTick, lifeReset } from './life.js';

// ---------- Planerad rutt (för HUD) ----------
export function plannedRoute(e) {
  if (e.mode === 'recall') return [0];
  if (e.mode === 'rescue') return [e.rescueTarget];
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
// Trafikprofil över dygnet (personer per simuleringssekund). Avvägd för 12 våningar och 4 hissar –
// testerna i tests.html larmar om det blir överbelastat.
function arrivalRate(h) {
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
  ];
}
export function spawnTick(dt) {
  const h = hour();
  if (S.fire) return; // vid brand släpps ingen in
  for (const ev of S.sched) if (!ev.done && h >= ev.at) { ev.done = true; ev.run(); }
  if (S.people.length >= MAXP) return;
  if (rng() < arrivalRate(h) * dt) spawnEmployee();
  const lunch = h >= 11.2 && h < 12.8;
  let v = h >= 9 && h < 17 ? 0.045 : 0;
  if (lunch) v += 0.07;
  if (rng() < v * dt) spawnVisitor(LOBBY, -30, lunch && rng() < 0.7 ? CAFE : null);
  // turister åker panoramahissen upp till takterrassen
  if (ROOF >= 0 && h >= 9.5 && h < 19 && rng() < 0.02 * dt) spawnVisitor(LOBBY, -30, ROOF, 'Utsikt från takterrassen');
  if (h >= 17 && h < 20.5 && rng() < 0.03 * dt) spawnVisitor(LOBBY, -30, floorWith('aerobic'), 'Kvällspass på Svettis');
}
// Nattläge (bara Smart): överflödiga hissar somnar i entrén för att spara energi och vaknar vid kö.
function nightModeTick(dt) {
  const h = hour();
  const night = S.strategy === 'smart' && S.power && h >= 22.5 && h < 29.5;
  const waiting = S.people.filter(p => p.state === 'wait');
  if (!night) {
    for (const e of S.elevators) if (e.sleep) { e.sleep = false; log(`☀️ ${e.name} vaknar ur nattläget`, 'park', e.color); }
    return;
  }
  if (waiting.length > 3 || waiting.some(p => S.t - p.waitStart > 25)) {
    const z = S.elevators.find(e => e.sleep);
    if (z) { z.sleep = false; z.sleepT = 0; log(`⏰ ${z.name} väcks ur nattläget – det bildas kö`, 'park', z.color); }
    return;
  }
  for (const e of S.elevators) {
    const idle = e.mode === 'normal' && !e.off && e.state === 'idle' && Math.round(e.pos) === e.home
      && !e.passengers.length && !stopFloors(e).length;
    e.sleepT = idle ? (e.sleepT || 0) + dt : 0;
    // en hiss per grupp är alltid vaken
    if (e !== S.elevators.find(x => x.group === e.group) && !e.sleep && e.sleepT > 20 && !waiting.length) {
      e.sleep = true; log(`🌙 ${e.name} går i nattläge i entrén – sparar energi`, 'park', e.color);
    }
  }
}
export function step(dt) {
  S.t += dt;
  S.clock += dt * timeScale(hour());
  spawnTick(dt);
  lifeTick(dt);
  nightModeTick(dt);
  for (const p of S.people) updatePerson(p, dt);
  if (S.people.some(p => p.dead)) S.people = S.people.filter(p => !p.dead);
  incidentTick(dt);
  rebuildPicks();
  const wl = Array.from({ length: FLOORS }, () => ({ u: [], d: [] }));
  for (const p of S.people) {
    if (p.state !== 'wait') continue;
    wl[p.floor][K(p.dir)].push(p);
    // KNAPPAR: folk trycker på knappar; VIP-gruppen har nyckel och styrs som vanligt
    if (buttonsMode() && !p.vip) { buttonWaitTick(p, dt); continue; }
    if (p.assigned === null && !(p.retypeAt > S.t)) dispatchPerson(p);
  }
  if (buttonsMode()) dispatchCalls();
  S.wl = wl;
  // VIP-läge: hissen som tar VIP-gruppen tar inga andra under tiden
  for (const e of S.elevators) {
    const lock = S.people.some(p => p.vip && ((p.state === 'wait' && p.assigned === e.id) || ((p.state === 'boarding' || p.state === 'ride') && p.car === e)));
    if (lock && !e.vipLock) {
      log(`👔 VIP-läge: ${e.name} reserveras för VIP-gruppen`, 'alert', e.color);
      // de som redan hade fått hissen får en annan
      for (const p of S.people) if (p.state === 'wait' && !p.vip && p.assigned === e.id) { p.assigned = null; pev(p, `Hiss ${e.name} reserveras för VIP-gruppen – systemet letar en ny hiss åt mig`); }
      e.vipLock = lock;
      rebuildPicks();
      for (const p of S.people) if (p.state === 'wait' && p.assigned === null && !p.vip) dispatchPerson(p);
    }
    e.vipLock = lock;
  }
  for (const e of S.elevators) updateElevator(e, dt);
  if ((S.strategy === 'smart' || buttonsMode()) && S.power) {
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
  S.t = 0; S.clock = 0; S.sched = makeSchedule(); S.acc = 0; S.summaryShown = false; S.nextId = 1; S.sel = null; S.wl = null; S.reoptT = 0;
  S.people = []; S.stats = newStats(); S.calls = {};
  S.fire = null; S.power = true; S.outage = null;
  S.nextInc = rand(150, 260);
  for (const list of SPOTS) for (const s of list) s.occ = null;
  S.elevators = EL.map((_, i) => makeElevator(i));
  lifeReset();
}
export function newSim(seed, opts = {}) {
  S.seed = seed >>> 0; S.day = opts.day || 1; S.log = []; S.fx = [];
  if (opts.strategy) S.strategy = opts.strategy;
  if (opts.autoInc !== undefined) S.autoInc = opts.autoInc;
  if (opts.mistakes !== undefined) S.mistakes = opts.mistakes;
  resetDay();
}
