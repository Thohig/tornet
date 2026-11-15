// Testsviten för simuleringen. Ingen grafik, HUD eller DOM – samma tester körs i webbläsaren
// (tests.html via browser.js) och i terminalen (npm test via run.mjs).
// Varje test seedar slumpen, så resultaten är exakt reproducerbara.
import { S, hooks, hour } from '../src/state.js';
import { floorOpen, FLOOR_HOURS, idx, floorWith, EL, LOBBY, SKY, HOME_FLOORS, OFFICE_FLOORS } from '../src/config.js';
import { DT, step, advance, newSim, resetDay } from '../src/sim.js';
import {
  startFire, setFireMode, startOutage, startGenerator, toggleAutoRescue,
  toggleOff, endFire, canRescue,
} from '../src/incidents.js';
import { liftsAvailable, spawnBus, pn } from '../src/people.js';
import { loadKg, allowed, allowedPos, posOf, safeFloor, operational, canTake, stopFloors, isFull, costBased, benched, inFireZone } from '../src/dispatch.js';
import { RATED_KG, FULL_LOAD, VMAX, DEFAULT_TEMPO, dayLength } from '../src/config.js';
import { needsFreight, mayUseFreight, legDest } from '../src/people.js';
import { fl } from '../src/util.js';
import { setSeed, stream, streamNames } from '../src/rng.js';
import { assignCalls, antiNuisance } from '../src/buttons.js';
import { act } from '../src/actions.js';
import { powerKw, triggerFault, breakDown, tech, techs, techOf, snapCable, EXTRA_QUEUE, CALL_T, trapBreak, FAULT_KIND, jobFloor } from '../src/service.js';
import { WARN_S, FF_ATTACK_S, endOutage } from '../src/incidents.js';
import { forceMove, BLANKET_T } from '../src/visits.js';
import { trafficMode, learnBin, peakHold, PEAK_HOLD } from '../src/dispatch.js';
import { windAt, startStorm } from '../src/weather.js';
import { canBrakeTo } from '../src/elevators.js';
import { MEZZ, STATION, TRAIN_X0, TRAIN_X1 } from '../src/config.js';
import { LAST_H } from '../src/train.js';
import { FIRE_FLOORS, INC_LEVELS } from '../src/incidents.js';
import { CONTROL, BREAK } from '../src/config.js';
import { CHIEFS, chiefPerson, setChief } from '../src/chief.js';
import { CREW_BY, atPost, crewPerson, postFloor } from '../src/crew.js';
import { CREW } from '../src/config.js';
import { PANO, ladderReach, PANO_CREW_S, PANO_DEFAULT_S } from '../src/pano.js';

// ---------- Ramverk ----------
export const tests = [];
const test = (name, fn) => tests.push({ name, fn });
export class Fail extends Error {}
function assert(cond, msg) { if (!cond) throw new Fail(msg); }

// ---------- Hjälp ----------
// (driftchefen är avstängd i testerna om inget annat sägs – de flesta testerna styr incidenterna själva)
function sim(seed, opts = {}) {
  newSim(seed, { strategy: 'smart', autoInc: false, mistakes: 'lite', maint: 'natt', tempo: DEFAULT_TEMPO, chief: false, ...opts });
  S.started = true; S.paused = false;
  hooks.incident = () => {}; hooks.dayEnd = () => {};
}
// Vakt som kontrollerar invarianter efter varje steg
function watcher() {
  const w = { passes: 0, maxRide: 0, maxWait: 0, n: 0, overweight: 0, maxKg: 0, bypassBroken: 0, prev: [],
    outOfRange: 0, wrongDoor: 0, liftPass: 0, railClash: 0, moveBad: 0, badLeg: 0, badFreight: 0, vipMixed: 0, vipSet: [], selfDest: 0, brokenUse: 0, snapUse: 0, prevSnapN: [], holdBoard: 0, prevN: [], prevHold: [],
    jumps: 0, orphanService: 0, techClash: 0, badReserved: 0, dupNames: 0, dupEx: '', idleWait: new Map(), idleWaitMax: 0, badPlatform: 0,
    deadAssign: new Map(), deadAssignMax: 0, deadAssignEx: '', prevMode: [], late: [],
    // dockhuset: hur länge någon har suttit instängd, och hur länge en incident har pågått
    maxTrap: 0, maxStorm: 0, maxFire: 0, maxOutage: 0,
    // en korg vänder aldrig i fart, ingen går trappan in i brandzonen, och ingen tekniker står kvar med ett jobb på fel våning
    flips: 0, prevVel: [], intoFire: 0, prevState: new Map(), techLost: new Map(), techLostMax: 0 };
  w.before = () => S.elevators.map(e => e.pos);
  w.check = before => {
    for (const e of S.elevators) for (const p of e.passengers) if ((p.trapT || 0) > w.maxTrap) w.maxTrap = p.trapT;
    if (S.storm) w.maxStorm = Math.max(w.maxStorm, S.t - S.storm.t0);
    if (S.fire) w.maxFire = Math.max(w.maxFire, S.t - S.fire.t0);
    if (S.outage) w.maxOutage = Math.max(w.maxOutage, S.t - S.outage.t0);
    for (const p of S.people) {
      // (den som redan gick i trappan när larmet gick räknas inte)
      if (S.fire && S.t > S.fire.t0 && !p.role && !p.vip && !p.evac && p.state === 'stairs' && w.prevState.get(p.id) !== 'stairs' && !p.escalator && !inFireZone(p.floor) && inFireZone(p.dest)) w.intoFire++;
      w.prevState.set(p.id, p.state);
      if (p.role === 'hisstekniker' && !p.offDuty && p.job !== null && p.job !== undefined && p.state === 'office' && p.floor !== jobFloor(S.elevators[p.job]) && !inFireZone(p.floor)) {
        const since = w.techLost.get(p.id) ?? S.t; w.techLost.set(p.id, since); w.techLostMax = Math.max(w.techLostMax, S.t - since);
      } else w.techLost.delete(p.id);
    }
    S.elevators.forEach((e, i) => {
      const vel = e.v * e.dir;
      if (w.prevVel[i] !== undefined && vel * w.prevVel[i] < 0 && Math.abs(vel) > 0.3 && Math.abs(w.prevVel[i]) > 0.3) w.flips++;
      w.prevVel[i] = vel;
      const kg = loadKg(e);
      // en hiss får aldrig köra iväg överlastad
      if (e.state === 'moving' && kg > e.ratedKg + 1e-6) w.overweight++;
      // zonerna: hissen håller sig inom sitt schakt och öppnar bara där den har dörrar
      if (e.pos < e.minF - 1e-6 || e.pos > e.maxF + 1e-6) w.outOfRange++;
      // (panoramahissen i lastläge öppnar sin lastdörr mot takterrassen – bara för flyttlasset)
      if (e.state === 'doors' && !e.stops.has(e.floor) && !(e.mode === 'lift' && e.floor === e.terraceF)) w.wrongDoor++;
      if (e.mode === 'lift' && (e.passengers.length || e.reserved)) w.liftPass++;
      for (const p of e.passengers) {
        if (p.state === 'ride' && !e.serves.has(p.dest)) w.badLeg++;
        if (p.state === 'ride' && (e.freight ? !mayUseFreight(p) : needsFreight(p))) w.badFreight++;
        if (e.vipLock && !p.vip && !p.medic && w.vipSet[i] && !w.vipSet[i].has(p)) w.vipMixed++;
      }
      if (e.state === 'moving') w.maxKg = Math.max(w.maxKg, kg);
      // en trasig hiss eller en hiss på service rör sig aldrig och har ingen ombord;
      // en hiss som väntar på service tar aldrig nya passagerare
      // (ett hissfel mellan två våningar har kvar sina instängda – men ingen ny kliver på)
      // (en korg som vevas ner för hand vid brandlarm rör sig – service.js fireCrank)
      if ((e.mode === 'broken' || e.mode === 'service') && ((e.passengers.length && !(e.fault && e.fault.trapped)) || e.reserved || (Math.abs(e.pos - before[i]) > 1e-9 && !(e.fault && e.fault.crank)))) w.brokenUse++;
      // (de som redan var på väg in genom dörren när hissen kallades till service får åka med)
      const aboard = e.passengers.length + e.reserved;
      // (bara om hissen var hållen redan före steget – den som klev på i samma steg som servicen beställdes hann före)
      if (e.hold && w.prevHold[i] && aboard > (w.prevN[i] ?? 0)) w.holdBoard++;
      w.prevN[i] = aboard; w.prevHold[i] = e.hold;
      // full last: över 80 % stannar hissen bara för avstigning, inte för nya hämtningar
      if (e.state === 'doors' && w.prev[i] === 'moving' && e.mode === 'normal' && kg >= e.ratedKg * FULL_LOAD
        && !e.passengers.some(p => p.dest === e.floor) && !e.carCallStop) w.bypassBroken++;
      w.prev[i] = e.state;
      // de som redan var ombord eller på väg in när VIP-läget slogs på får åka med
      if (!e.vipLock) w.vipSet[i] = null;
      else if (!w.vipSet[i]) w.vipSet[i] = new Set(S.people.filter(p => p.car === e && (p.state === 'ride' || p.state === 'boarding')));
      const a = before[i], b = e.pos;
      // en hiss hoppar aldrig: den flyttar sig högst VMAX·DT per steg
      if (Math.abs(b - a) > VMAX * DT + 1e-6) w.jumps++;
      // en hiss på service har alltid en tekniker som jobbar med den
      if (e.mode === 'service' && !techOf(e)) w.orphanService++;
      // reserverade platser = de som är på väg in genom dörren
      if (e.reserved !== S.people.filter(p => p.state === 'boarding' && p.car === e).length) w.badReserved++;
      // Återgår hissen till normal drift mitt i farten (återkallning/nödsänkning avbruten) hinner den inte bromsa till
      // våningar inom bromssträckan – de får den köra förbi tills den har stannat (sedan vänder den tillbaka)
      const pdOf = p => posOf(e, p.dest), crossed = pd => (a < pd && b > pd) || (a > pd && b < pd);
      if (e.mode !== 'normal' || e.state !== 'moving') w.late[i] = null;
      else if ((w.prevMode[i] ?? 'normal') !== 'normal') w.late[i] = new Set(e.passengers.map(pdOf).filter(pd => crossed(pd) || !canBrakeTo(e, pd)));
      // linbrott: korgen faller bara nedåt, står sedan helt still, och ingen ny kliver på (de instängda tas bara ut)
      if (e.mode === 'snapped' && w.prevMode[i] === 'snapped') {
        const n = e.passengers.length;
        if (e.reserved || n > (w.prevSnapN[i] ?? n) || b > a + 1e-9 || (e.snap.ph !== 'fall' && S.t > e.snap.caughtT && Math.abs(b - a) > 1e-9)) w.snapUse++;
      }
      w.prevSnapN[i] = e.passengers.length;
      w.prevMode[i] = e.mode;
      for (const p of e.passengers) {
        // en hiss i normal drift får aldrig köra förbi en passagerares mål
        // (dubbeldäck: målet räknas i korgens läge – övre däcket står en våning högre)
        const pd = pdOf(p);
        if (e.mode === 'normal' && p.state === 'ride' && crossed(pd) && !w.late[i]?.has(pd)) w.passes++;
        if (S.power && e.mode === 'normal') w.maxRide = Math.max(w.maxRide, S.t - p.rideStart);
      }
    });
    // flyttdagen: varje lass är på ett ställe – den som bär eller packar det, balken, panoramahissen
    if (S.move && S.move.state === 'on') for (const it of S.move.items) {
      const holders = S.people.filter(p => p.mover && p.item === it.id).length;
      const ok = it.st === 'packing' || it.st === 'carried' ? holders === 1 : holders === 0;
      if (!ok || (it.st === 'hoist' && S.hoist.item !== it.id) || (it.st === 'lift' && S.hoist.liftItem !== it.id)) w.moveBad++;
    }
    // takskenan: ingen last hänger i hissbalken medan putsarens gondol är nere
    if (S.hoist && S.hoist.item !== null && !S.cleaner.parked) w.railClash++;
    // ingen väntar på en hiss som inte kan komma: tilldelningen till en hiss som är ur drift, på väg till service,
    // sover, är spärrad, reserverad för någon annan eller inte går dit släpps inom ett par steg
    // (vid strömavbrott och brandåterkallning står alla hissar, och då väntar man ut det eller tar trappan)
    if (S.power && !(S.fire && S.fire.mode === 'recall')) {
      for (const p of S.people) {
        const e = p.state === 'wait' && p.assigned !== null ? S.elevators[p.assigned] : null;
        const why = !e ? '' : e.mode !== 'normal' ? e.mode : benched(e) ? 'benched' : e.hold ? 'hold' : e.sleep ? 'sleep' : e.zoneLock ? 'zoneLock'
          : e.vipLock && !p.vip && !p.medic ? 'vipLock' : !canTake(e, p) ? 'canTake' : '';
        if (!why) { w.deadAssign.delete(p); continue; }
        const since = w.deadAssign.get(p) ?? S.t;
        w.deadAssign.set(p, since);
        if (S.t - since > w.deadAssignMax) { w.deadAssignMax = S.t - since; w.deadAssignEx = `${p.name} → ${e.name} (${why})`; }
      }
    } else w.deadAssign.clear();
    // tunnelbanan: på perrongen står bara den som ska med tåget – och efter sista tåget ingen alls
    for (const p of S.people) if (p.state === 'platform' && (p.floor !== STATION || p.exitFloor !== STATION || !p.toTrain || S.trainDone)) w.badPlatform++;
    // två tekniker har aldrig samma hiss som jobb, och högst en extra tekniker är inringd
    { const crew = techs(), jobs = crew.filter(t => t.job !== null && t.job !== undefined).map(t => t.job);
      if (new Set(jobs).size !== jobs.length || crew.filter(t => t.extra).length > 1) w.techClash++; }
    if (++w.n % 30 === 0 && liftsAvailable() && !S.fire) {
      for (const p of S.people) if (p.state === 'wait') w.maxWait = Math.max(w.maxWait, S.t - p.waitStart);
      // ingen ska stå i kön för att åka till våningen hen redan står på
      for (const p of S.people) if (p.state === 'wait' && p.dest === p.floor) w.selfDest++;
      // namnen är unika i huset
      const seen = new Set();
      for (const p of S.people) { if (seen.has(p.name)) { w.dupNames++; w.dupEx = w.dupEx || p.name; } seen.add(p.name); }
      // ingen står länge utan tilldelad hiss medan en ledig hiss som kan ta hen står tom och stilla (kostnadsstyrningen)
      if (costBased()) {
        const idle = S.elevators.filter(e => operational(e) && e.state === 'idle' && !e.passengers.length && !stopFloors(e).length && !isFull(e) && !e.vipLock);
        for (const p of S.people) {
          if (p.state !== 'wait' || p.vip || p.assigned !== null || p.retypeAt > S.t || !idle.some(e => canTake(e, p))) { w.idleWait.delete(p); continue; }
          const since = w.idleWait.get(p) ?? S.t;
          w.idleWait.set(p, since);
          w.idleWaitMax = Math.max(w.idleWaitMax, S.t - since);
        }
      }
    }
  };
  return w;
}
function run(sec, w) {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) { const b = w && w.before(); step(DT); if (w) w.check(b); }
}
function runDay(w) {
  let guard = 0;
  while (!S.summaryShown) { const b = w && w.before(); step(DT); if (w) w.check(b); if (++guard > 200000) throw new Fail('dagen tog aldrig slut'); }
}
function fingerprint() {
  const st = S.stats;
  return JSON.stringify([st.served, +st.waitSum.toFixed(6), st.angry, st.incidents, st.smoked,
    Math.round(st.trappedSec * 1000), S.log.length, S.nextId, S.elevators.map(e => +e.pos.toFixed(6))]);
}
// vänta tills någon hiss kör med passagerare (så att ett strömavbrott faktiskt stänger in folk)
function untilSomeoneRiding() {
  for (let i = 0; i < 120 / DT; i++) { if (S.elevators.some(e => e.state === 'moving' && e.passengers.length)) return; step(DT); }
  throw new Fail('ingen hiss körde med passagerare');
}
// de boende bor kvar över natten – räkna bara de som ska ha gått hem
const visitors = () => S.people.filter(p => p.kind !== 'res').length;
const avgWait = () => S.stats.waitSum / Math.max(1, S.stats.waitN);
const fmt = (w) => `resor ${S.stats.served}, snittväntan ${avgWait().toFixed(1)}s, längsta väntan ${w ? w.maxWait.toFixed(0) : '?'}s, längsta åktur ${w ? w.maxRide.toFixed(0) : '?'}s`;

// ---------- Determinism ----------
test('Samma frö ger exakt samma dag (även med incidenter)', () => {
  sim(1234, { autoInc: true }); runDay(); const a = fingerprint();
  sim(1234, { autoInc: true }); runDay(); const b = fingerprint();
  sim(99, { autoInc: true }); runDay(); const c = fingerprint();
  assert(a === b, `olika resultat med samma frö:\n${a}\n${b}`);
  assert(a !== c, 'olika frön gav samma dag');
  return `frö 1234 → ${S.stats.incidents} incidenter, identiskt två gånger`;
});
test('Bildfrekvensen påverkar inte simuleringen', () => {
  sim(555);
  let steps = 0;
  while (S.t < 600) steps += advance(Math.random() * 0.08 + 0.004, [1, 2, 4, 8][Math.floor(Math.random() * 4)]);
  const a = fingerprint();
  sim(555);
  for (let i = 0; i < steps; i++) step(DT);
  const b = fingerprint();
  assert(a === b, `ojämna bildrutor gav annat resultat:\n${a}\n${b}`);
  return `${steps} steg med slumpade bildrutetider och hastigheter = samma resultat som fasta steg`;
});

// ---------- Hela dagar ----------
// gränser: snittväntan och längsta väntan per strategi (lunchrusningen är kapacitetsbegränsad med 4 hissar)
for (const [strategy, maxAvg, maxLongest] of /** @type {[string, number, number][]} */ ([['smart', 18, 200], ['peak', 18, 200], ['eco', 22, 250], ['nearest', 35, 400], ['random', 45, 400], ['buttons', 25, 300]])) {
  test(`Hel dag med strategin ${strategy}: alla kommer fram`, () => {
    sim(2024, { strategy });
    const w = watcher();
    runDay(w);
    assert(w.passes === 0, `hissar åkte förbi passagerares mål ${w.passes} gånger`);
    assert(w.overweight === 0, `hissar körde överlastade ${w.overweight} gånger`);
    assert(w.bypassBroken === 0, `hiss med full last stannade för hämtning ${w.bypassBroken} gånger`);
    assert(S.stats.served > 250, `för få resor: ${S.stats.served}`);
    assert(avgWait() < maxAvg, `snittväntan ${avgWait().toFixed(1)}s (gräns ${maxAvg}s)`);
    assert(w.maxRide < 90, `någon åkte i ${w.maxRide.toFixed(0)}s`);
    assert(w.maxWait < maxLongest, `någon väntade i ${w.maxWait.toFixed(0)}s (gräns ${maxLongest}s)`);
    assert(visitors() < 15, `${visitors()} personer kvar i huset vid stängning`);
    assert(w.badPlatform === 0, `fel på perrongen ${w.badPlatform} steg`);
    assert(w.outOfRange === 0, `hissar utanför sin zon ${w.outOfRange} gånger`);
    assert(w.wrongDoor === 0, `hissar öppnade på våningar utan dörr ${w.wrongDoor} gånger`);
    assert(w.badLeg === 0, `passagerare åkte hiss som inte går till deras delmål ${w.badLeg} gånger`);
    assert(w.badFreight === 0, `fel last i fel hiss ${w.badFreight} gånger`);
    return fmt(w);
  });
}
test('ETA: styrningens förutsagda väntan stämmer i snitt med den faktiska', () => {
  // eta() räknar med dörrarna och med hur många som kliver på och av vid varje stopp (BOARD_S, ALIGHT_S)
  sim(9001); runDay();
  const st = S.stats, bias = st.etaErr / st.etaN, abs = st.etaAbs / st.etaN;
  assert(st.etaN > 300, `bara ${st.etaN} förutsägelser`);
  assert(Math.abs(bias) < 1, `hissen kommer i snitt ${bias.toFixed(1)} s ${bias > 0 ? 'senare' : 'tidigare'} än förutsagt`);
  assert(abs < 6, `förutsägelsen är i snitt ${abs.toFixed(1)} s fel`);
  return `${st.etaN} förutsägelser · i snitt ${bias >= 0 ? '+' : ''}${bias.toFixed(2)} s (medelfel ${abs.toFixed(1)} s)`;
});
test('Smart styrning är bättre än Närmast och Kaos (snitt över tre dygn)', () => {
  // ett enskilt dygn kan ha tur eller otur – jämför snittet över flera frön
  const avg = {};
  for (const strategy of ['smart', 'nearest', 'random']) {
    let sum = 0;
    for (const seed of [1, 2, 3]) { sim(seed, { strategy }); runDay(); sum += avgWait(); }
    avg[strategy] = sum / 3;
  }
  assert(avg.smart < avg.nearest && avg.smart < avg.random,
    `smart ${avg.smart.toFixed(1)}s, närmast ${avg.nearest.toFixed(1)}s, kaos ${avg.random.toFixed(1)}s`);
  return `snittväntan: smart ${avg.smart.toFixed(1)}s · närmast ${avg.nearest.toFixed(1)}s · kaos ${avg.random.toFixed(1)}s`;
});

// ---------- Dygnet ----------
function runUntil(h, w) { let g = 0; while (hour() < h && !S.summaryShown) { const b = w && w.before(); step(DT); if (w) w.check(b); if (++g > 200000) throw new Fail('kom aldrig fram'); } }
test('Dygnets tempo: det långa dygnet tar ~15 minuter med långa rusningar, det korta 6 minuter', () => {
  const out = [];
  for (const tempo of ['lang', 'kort']) {
    sim(41, { tempo });
    const at = {};
    for (const h of [7, 9.5, 11, 13, 22]) { runUntil(h); at[h] = S.t; }
    runDay();
    const want = dayLength(tempo);
    assert(Math.abs(S.t - want) < want * 0.02, `${tempo}: ett dygn tog ${S.t.toFixed(0)} s (ska vara ${want} s)`);
    out.push(`${tempo} ${(S.t / 60).toFixed(1)} min`);
    if (tempo === 'lang') {
      // per speltimme: morgonrusningen och lunchen får mer än dubbelt så mycket tid som förmiddagen
      const rush = (at[9.5] - at[7]) / 2.5, lunch = (at[13] - at[11]) / 2, mid = (at[11] - at[9.5]) / 1.5;
      assert(rush > 2 * mid && lunch > 2 * mid, `rusningen (${rush.toFixed(0)} s/h) och lunchen (${lunch.toFixed(0)} s/h) är inte långsammare än förmiddagen (${mid.toFixed(0)} s/h)`);
      out.push(`morgonrusning ${(at[9.5] - at[7]).toFixed(0)} s, lunch ${(at[13] - at[11]).toFixed(0)} s`);
    } else {
      const night = S.t - at[22];
      assert(night < at[22] / 2, `natten (${night.toFixed(0)}s) går inte fortare än dagen (${at[22].toFixed(0)}s)`);
    }
  }
  S.tempo = DEFAULT_TEMPO;
  return out.join(' · ');
});
test('Natten: låg belastning, nattpersonal och hissar i nattläge', () => {
  sim(25); runUntil(23.5);
  const roles = new Set(S.people.filter(p => p.role).map(p => p.role));
  for (const r of ['väktare', 'nattdj', 'nattekniker']) assert(roles.has(r), `${r} saknas klockan 23:30`);
  let maxPop = 0, maxWait = 0, maxSleeping = 0; const served0 = S.stats.served;
  while (hour() < 28) {
    step(DT);
    maxPop = Math.max(maxPop, S.people.filter(p => p.state !== 'platform').length); // (perrongen hör till tunnelbanan)
    maxSleeping = Math.max(maxSleeping, S.elevators.filter(e => e.sleep).length);
    for (const p of S.people) if (p.state === 'wait') maxWait = Math.max(maxWait, S.t - p.waitStart);
  }
  const nightTrips = S.stats.served - served0;
  assert(maxPop <= 25 + HOME_FLOORS.length * 4, `${maxPop} personer i huset mitt i natten`);
  assert(maxSleeping >= 1, 'ingen hiss gick i nattläge'); // natten är bara 90 s lång
  assert(maxWait < 40, `någon väntade ${maxWait.toFixed(0)}s på natten`);
  assert(nightTrips > 5, `bara ${nightTrips} hissresor på natten – nattpersonalen åker inte`);
  return `max ${maxPop} personer, ${nightTrips} nattresor, ${maxSleeping} hissar sov, längsta väntan ${maxWait.toFixed(0)}s`;
});
test('Stängda våningar: inga besökare på caféet, banken, tandläkaren eller taket efter stängning', () => {
  sim(43);
  const bad = [];
  while (!S.summaryShown) {
    step(DT);
    if (Math.round(S.t / DT) % 15) continue;
    const h = hour();
    for (const f of [floorWith('cafe'), floorWith('bank'), floorWith('dentist'), floorWith('roof')]) {
      const [open, close] = FLOOR_HOURS[f];
      if (h < close + 1.2 && h >= open) continue; // marginal att gå därifrån (en hissresa tar ungefär en speltimme)
      for (const p of S.people) {
        const there = p.floor === f && p.state === 'office';
        const going = p.goal === f && ['toQueue', 'wait', 'boarding', 'ride'].includes(p.state);
        if ((there || going) && !p.vip && (p.kind === 'vis' || (p.kind === 'emp' && p.home !== f))) bad.push(`${p.name} ${there ? 'på' : 'på väg till'} ${f} kl ${h.toFixed(1)}`);
      }
    }
  }
  assert(bad.length === 0, `${bad.length} fel, t.ex. ${bad.slice(0, 3).join('; ')}`);
  return 'Sky Café 07:30–18, banken 09–16, tandläkaren 08–17, takterrassen 09–20 respekteras';
});
test('Utan Smart-styrning sover inga hissar', () => {
  sim(44, { strategy: 'nearest' }); runUntil(25);
  assert(S.elevators.every(e => !e.sleep), 'en hiss sover trots strategin Närmast');
  return 'nattläget hör till den smarta styrningen';
});

// ---------- Vikt ----------
test('Överlast: turister med resväskor – vågen larmar och den sist påstigna kliver av', () => {
  // (överlasten är slumpens sak – den beror på vem som hinner in i vilken korg – så minst tre och upp till sex förmiddagar körs)
  let overloads = 0, maxKg = 0, days = 0;
  for (const seed of [51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62]) {
    if (days >= 3 && overloads > 0) break;
    days++;
    sim(seed); runUntil(9.6);
    const w = watcher();
    const before = S.stats.overloads;
    // stora bussar: med expresshissarna klarar huset en vanlig busslast (14) utan överlast
    for (let i = 0; i < 4; i++) { spawnBus(24); run(6, w); }
    run(150, w);
    overloads += S.stats.overloads - before; maxKg = Math.max(maxKg, w.maxKg);
    assert(w.overweight === 0, `frö ${seed}: en hiss körde iväg överlastad ${w.overweight} gånger`);
    const stuck = S.people.filter(p => p.why === 'Turist på busstur' && p.state === 'wait' && S.t - p.waitStart > 200).length;
    assert(stuck === 0, `frö ${seed}: ${stuck} turister har väntat över 200 s`);
  }
  assert(overloads > 0, `ingen överlast trots fyra busslaster med resväskor (${days} förmiddagar)`);
  return `${overloads} överlaster på ${days} förmiddagar, tyngsta avgång ${Math.round(maxKg)} kg av ${RATED_KG} – ingen hiss körde överlastad`;
});

// ---------- Brand ----------
test('Brand + brandåterkallning: alla hissar till E och avstängda, alla tar trappan', () => {
  sim(7); runUntil(7.67);
  startFire(idx('7')); run(3); setFireMode('recall'); run(25);
  for (const e of S.elevators) {
    if (e.ffCar) continue; // (brandhissen kör brandkåren)
    assert(e.mode === 'locked', `hiss ${e.name} är i läge ${e.mode}, inte låst`);
    assert(Math.abs(e.pos - e.home) < 1e-6, `hiss ${e.name} står på ${e.pos.toFixed(2)}, inte på sin hemvåning ${e.home}`);
    assert(e.passengers.length === 0, `hiss ${e.name} har ${e.passengers.length} passagerare kvar`);
  }
  const waiting = S.people.filter(p => p.state === 'wait' && !p.ff).length;
  assert(waiting === 0, `${waiting} personer väntar fortfarande på hiss`);
  run(90);
  assert(!S.fire, 'branden släcktes aldrig');
  assert(S.elevators.every(e => e.mode === 'normal'), 'hissarna kom inte tillbaka i drift');
  assert(S.stats.evacuated > 5, `bara ${S.stats.evacuated} utrymda`);
  return `${S.stats.evacuated} utrymda, ${S.stats.smoked} rökexponerade, hissarna i drift igen efter släckning`;
});
test('Branden släcks mitt i återkallningen: hissarna bromsar in till en våning, inget hopp', () => {
  sim(3); runUntil(9);
  startFire(idx('10')); setFireMode('recall');
  let e = null, g = 0;
  while (!e && ++g < 300) { step(DT); e = S.elevators.find(x => x.mode === 'recall' && x.rs === 'move' && Math.abs(x.pos - Math.round(x.pos)) > 0.2) || null; }
  assert(e, 'ingen hiss stod mellan två våningar under återkallningen');
  endFire();
  // (hissen får gärna köra vidare efter att ha stannat – den är i normal drift igen – men den ska ha stannat på en våning)
  let maxJump = 0, stopAt = -1;
  for (let i = 0; i < 10 / DT; i++) {
    const p0 = e.pos; step(DT); maxJump = Math.max(maxJump, Math.abs(e.pos - p0));
    if (stopAt < 0 && e.state !== 'moving' && Math.abs(e.pos - Math.round(e.pos)) < 1e-6) stopAt = e.pos;
  }
  assert(maxJump <= VMAX * DT + 1e-6, `${e.name} hoppade ${maxJump.toFixed(2)} våningar på ett steg`);
  assert(stopAt >= 0, `${e.name} stannade inte på en våning (${e.pos.toFixed(2)})`);
  return `${e.name} bromsade in till ${fl(stopAt)} · största steg ${maxJump.toFixed(3)} våningar`;
});
test('Brand + spärrad zon: hissarna håller sig under brandzonen', () => {
  sim(8); runUntil(7.83);
  const fire = idx('7'); // zonen börjar på 6 – höghissarna (6–T) når ingen våning under den
  startFire(fire); run(2); setFireMode('zone'); run(30);
  let above = 0, wrongStops = 0;
  const locked = S.elevators.filter(e => e.zoneLock).map(e => e.name);
  for (let i = 0; i < 30 / DT; i++) {
    step(DT);
    if (!S.fire) break;
    for (const e of S.elevators) {
      const limit = safeFloor(e) ?? e.minF; // spärrade höghissar står på sin lägsta våning
      if (e.pos > limit + 1e-6) above++;
      if (e.state === 'doors' && !allowed(e.floor) && !(e.zoneLock && e.floor === e.minF)) wrongStops++;
    }
  }
  assert(above === 0, `hissar var ovanför sin säkra våning ${above} gånger`);
  assert(wrongStops === 0, `${wrongStops} stopp i brandzonen`);
  assert(locked.length > 0, 'höghissarna borde spärras när de inte når någon våning under zonen');
  return `alla hissar höll sig under zonen · spärrade: ${locked.join(', ')}`;
});
test('Brand + spärrad zon: dubbeldäckaren släpper av dem som ska till E där den får stanna (ingen förbiåkning när branden släcks)', () => {
  // Branden på 2 ⇒ zonen börjar på 1 (mellanplanet). E är tillåten, men X1:s övre däck skulle då öppna på
  // mellanplanet – korgen får inte stanna i E, så de som ska dit måste läggas om till en våning hissen når.
  let e = null, seed = 0;
  for (seed = 1; seed <= 8 && !e; seed++) {
    sim(seed); const x = S.elevators.find(q => q.name === 'X1');
    let g = 0;
    while (++g < 20000 && hour() < 22) {
      step(DT);
      if (x.state === 'moving' && x.dir < 0 && x.pos > LOBBY + 2.5 && x.mode === 'normal' && x.passengers.some(p => posOf(x, p.dest) === LOBBY)) { e = x; break; }
    }
  }
  assert(e, 'X1 åkte aldrig ner mot E med folk ombord');
  const toE = e.passengers.filter(p => posOf(e, p.dest) === LOBBY);
  startFire(MEZZ + 1); setFireMode('zone');
  assert(!allowedPos(e, LOBBY) && allowed(LOBBY), 'testet förutsätter att E är tillåten men inte för dubbeldäckaren');
  let passes = 0, stopsE = 0, g = 0;
  // branden släcks medan hissen är på väg ner, strax ovanför E (då hinner den inte bromsa dit)
  while (++g < 3000 && e.passengers.some(p => toE.includes(p))) {
    if (S.fire && e.pos < LOBBY + 1 && e.state === 'moving') endFire();
    const a = e.pos; step(DT); const b = e.pos;
    if (e.state === 'doors' && e.floor === LOBBY && S.fire) stopsE++;
    for (const p of e.passengers) { const pd = posOf(e, p.dest); if (e.mode === 'normal' && ((a < pd && b > pd) || (a > pd && b < pd))) passes++; }
  }
  assert(passes === 0, `${e.name} åkte förbi en passagerares mål ${passes} gånger`);
  assert(stopsE === 0, `${e.name} stannade i E medan övre däcket var i brandzonen`);
  assert(toE.every(p => p.car !== e), 'de som skulle till E kom aldrig av');
  return `frö ${seed - 1}: ${toE.length} på väg till E släpptes av på ${toE.map(p => fl(p.floor)).join(', ')} · ingen förbiåkning`;
});
test('Brand utan åtgärd: folk åker genom röken', () => {
  sim(9); runUntil(8.08);
  startFire(idx('4'), false); run(60); // (utan larmets automatiska återkallning)
  assert(S.stats.smoked > 0, 'ingen blev rökexponerad trots normal drift');
  return `${S.stats.smoked} rökexponerade`;
});

test('Brandkåren: larmet återkallar hissarna, brandmännen åker brandhissen upp, de utrymda väntar ute och går in igen', () => {
  sim(31); runUntil(10.2);
  const w = watcher(), F0 = idx('10');
  startFire(F0);
  assert(S.fire.mode === 'recall', `larmet återkallade inte hissarna (läge ${S.fire.mode})`);
  let g = 0, rode = false, assembled = 0, firstAt = null;
  while ((S.fire || S.brigade || S.people.some(p => p.state === 'assembly')) && ++g < 300 / DT) {
    const b = w.before(); step(DT); w.check(b);
    const V = S.elevators.find(e => e.freight);
    if (V.passengers.some(p => p.ff)) rode = true;
    if (V.ffCar && V.passengers.some(p => !p.ff)) throw new Fail('någon annan än brandmännen åkte brandhissen');
    assembled = Math.max(assembled, S.people.filter(p => p.state === 'assembly').length);
    if (S.fire && S.fire.outAt !== null && firstAt === null) firstAt = S.t;
  }
  assert(!S.fire && !S.brigade, 'branden släcktes aldrig eller brandkåren åkte aldrig');
  assert(rode, 'brandmännen åkte aldrig brandhissen');
  assert(assembled > 3, `bara ${assembled} på återsamlingsplatsen`);
  assert(!S.people.some(p => p.state === 'assembly' || p.ff), 'någon stod kvar ute eller en brandman blev kvar');
  assert(S.notices.some(n => n.kind === 'fire'), 'ingen sammanfattning när branden var släckt');
  assert(w.passes === 0 && w.brokenUse === 0 && w.badLeg === 0, 'regelbrott under branden');
  return `${assembled} på återsamlingsplatsen · ${S.stats.smoked} rökexponerade · brandmännen åkte brandhissen`;
});
test('Brandkåren utan brandhiss (strömavbrott): brandmännen springer i trappan och kåren släcker ändå', () => {
  sim(32); runUntil(10.2);
  startFire(idx('12')); startOutage(); S.outage.backAt = S.t + 400;
  let g = 0;
  while (S.fire && ++g < 200 / DT) step(DT);
  assert(!S.fire, 'branden släcktes aldrig');
  assert(S.stats.smoked >= 0 && S.brigade && S.brigade.car === null, 'brandkåren fick en brandhiss trots strömavbrottet');
  return `släckt efter ${Math.round(S.t)} s (senast ${FF_ATTACK_S} s efter att kåren kom)`;
});
test('Brandkåren: brand strax ovanför entrén – brandmännen springer upp och släcker (går inte rakt ut igen)', () => {
  const out = [];
  for (const f of FIRE_FLOORS.filter(f => f - 2 <= LOBBY)) {
    sim(33); runUntil(10.2);
    startFire(f);
    let g = 0, reached = false;
    while (S.fire && ++g < 200 / DT) {
      step(DT);
      if (S.people.some(p => p.ff && p.state === 'office' && p.floor === f)) reached = true;
    }
    assert(!S.fire, `branden på ${fl(f)} släcktes aldrig`);
    assert(reached, `brandmännen kom aldrig fram till branden på ${fl(f)}`);
    assert(S.brigade && S.brigade.car === null, 'varuhissen blev brandhiss fast det inte fanns något att åka till');
    out.push(fl(f));
  }
  assert(out.length > 0, 'ingen brandvåning strax ovanför entrén');
  return `framme på ${out.join(', ')}`;
});

// ---------- Tidtabell, förvarningar, kedjor och efterspel ----------
test('Tidtabellen: 1–3 incidenter per dygn spridda över dagen, ibland en på natten, alltid med förvarning', () => {
  const hours = [];
  let nights = 0, days = 0;
  for (let s = 0; s < 40; s++) {
    sim(8000 + s, { autoInc: true });
    const plan = [...S.incPlan];
    const day = plan.filter(x => !x.night);
    assert(day.length >= 1 && day.length <= 3, `frö ${8000 + s}: ${day.length} incidenter på dagen`);
    for (let i = 1; i < plan.length; i++) assert(plan[i].at - plan[i - 1].at >= 1.2 - 1e-9, 'två incidenter för tätt');
    hours.push(...day.map(x => x.at)); nights += plan.length - day.length; days++;
  }
  assert(Math.min(...hours) < 9 && Math.max(...hours) > 16, `incidenterna klumpar sig (${Math.min(...hours).toFixed(1)}–${Math.max(...hours).toFixed(1)})`);
  assert(nights > 3 && nights < 25, `${nights} nattliga strömavbrott på ${days} dygn`);
  // förvarningen kommer före incidenten
  sim(8003, { autoInc: true });
  let warned = null, broke = null, g = 0;
  while (!broke && ++g < 900 / DT) {
    step(DT);
    if (S.warn && !warned) warned = { ...S.warn };
    if (warned && !S.warn) broke = S.t;
  }
  assert(warned && broke !== null && Math.abs(broke - warned.t0 - WARN_S[warned.type]) < 0.1, `ingen förvarning före incidenten (${JSON.stringify(warned)})`);
  return `${(hours.length / days).toFixed(1)} incidenter per dygn kl ${Math.min(...hours).toFixed(1)}–${Math.max(...hours).toFixed(1)} · ${nights} nattliga avbrott på ${days} dygn · förvarning (${warned.type})`;
});
test('Kedjor: blixten i stormen slår ut strömmen, och hissarna startar om en i taget efteråt', () => {
  sim(41); runUntil(10);
  startStorm(); S.storm.strikeAt = S.t + 3;
  run(4);
  assert(!S.power && S.outage && S.outage.cause === 'blixt', 'blixten slog inte ut strömmen');
  endOutage();
  const order = S.elevators.map(e => e.restartAt);
  assert(order.every((t, i) => i === 0 || t > order[i - 1]), 'hissarna startade inte om en i taget');
  const e = S.elevators.at(-1), pos = e.pos;
  run(0.5);
  assert(e.pos === pos, 'den sista hissen körde innan den hade startat om');
  assert(S.notices.some(n => n.kind === 'power'), 'ingen sammanfattning när strömmen kom tillbaka');
  run(10);
  assert(S.elevators.every(x => S.t >= x.restartAt), 'alla hissar startade inte om');
  return 'blixt → strömavbrott → omstart en i taget';
});
test('Efterspel: folk pratar om incidenten i hissen efteråt', () => {
  sim(42); runUntil(8.5);
  S.lastInc = { id: 999, type: 'fire', t: S.t };
  let talk = 0;
  for (let i = 0; i < 120 / DT; i++) { step(DT); for (const p of S.people) if (p.talkedInc === 999 && p.say && /brand|rök|larm|ute/i.test(p.say.text)) talk++; }
  assert(talk > 0, 'ingen pratade om branden');
  return 'någon pratar om branden';
});
test('Hissfel mellan två våningar: passagerarna sitter kvar tills teknikern har lagat, sedan åker de vidare', () => {
  sim(43); runUntil(9);
  const w = watcher();
  let e = null, g = 0;
  while (!e && ++g < 60 / DT) { step(DT); e = S.elevators.find(x => x.mode === 'normal' && x.state === 'moving' && x.passengers.length >= 2 && !x.deck2 && !x.facade && x.pos - Math.floor(x.pos) > 0.35 && x.pos - Math.floor(x.pos) < 0.75) || null; }
  assert(e, 'ingen hiss körde med folk');
  const who = [...e.passengers];
  trapBreak(e);
  assert(e.mode === 'broken' && e.fault.trapped && e.passengers.length === who.length, 'passagerarna kom ut fast hissen stannade mellan våningarna');
  g = 0;
  while (e.mode === 'broken' && ++g < 300 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode === 'normal', 'hissen lagades aldrig');
  g = 0;
  while (who.some(p => p.state === 'ride' && p.car === e) && ++g < 60 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(!who.some(p => p.state === 'ride' && p.car === e), 'passagerarna kom aldrig fram');
  assert(w.passes === 0 && w.brokenUse === 0, `regelbrott (förbi ${w.passes}, trasig ${w.brokenUse})`);
  assert(S.notices.some(n => n.kind === 'fault'), 'ingen ruta när de instängda kom loss');
  assert(Object.values(FAULT_KIND).every(k => k.need[0] < k.need[1]), 'feltyperna saknar lagningstid');
  return `${who.length} satt fast i ${e.name} · ${Math.round(S.stats.trappedSec)} instängd-sekunder`;
});
test('Instängda går före: teknikern lämnar ett långt jobb för folk som sitter fast mellan två våningar', () => {
  sim(43); runUntil(9);
  const w = watcher();
  // ett långt jobb: teknikern lagar en hiss som tar (nästan) hur lång tid som helst
  const idle = () => S.elevators.find(x => x.mode === 'normal' && !x.passengers.length && !x.deck2 && !x.facade && x.state !== 'moving');
  for (let i = 0; !idle() && i < 60 / DT; i++) step(DT);
  const long = idle();
  assert(long, 'ingen ledig hiss att ha sönder');
  breakDown(long, 'motorn byts'); long.fault.need = 1e6;
  let g = 0;
  while (!(techOf(long) && techOf(long).state === 'office' && techOf(long).workT > 1) && ++g < 200 / DT) { const b = w.before(); step(DT); w.check(b); }
  const t = techOf(long);
  assert(t && t.workT > 1, 'teknikern kom aldrig igång med det långa jobbet');
  // sedan tvärstannar en annan hiss med folk i
  let e = null; g = 0;
  while (!e && ++g < 60 / DT) { step(DT); e = S.elevators.find(x => x !== long && x.mode === 'normal' && x.state === 'moving' && x.passengers.length && !x.deck2 && !x.facade && x.pos - Math.floor(x.pos) > 0.35 && x.pos - Math.floor(x.pos) < 0.75) || null; }
  assert(e, 'ingen hiss körde med folk');
  const extra = techs().length > 1;
  trapBreak(e);
  const t0 = S.t;
  g = 0;
  while (t.job !== e.id && ++g < 3 / DT) step(DT);
  assert(extra || t.job === e.id, `teknikern stannade kvar vid ${long.name} fast folk satt fast i ${e.name}`);
  g = 0;
  while (e.mode === 'broken' && ++g < 150 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode === 'normal', `de instängda i ${e.name} blev aldrig fria`);
  const freed = S.t, saved = long.fault.done || 0;
  g = 0;
  while (techOf(long) === null && ++g < 120 / DT) step(DT);
  assert(techOf(long), `ingen gick tillbaka till ${long.name}`);
  assert(saved > 1, 'arbetet på det långa jobbet sparades inte');
  assert(w.passes === 0 && w.brokenUse === 0, `regelbrott (förbi ${w.passes}, trasig ${w.brokenUse})`);
  return `${t.name}: ${long.name} → ${e.name} (fria efter ${Math.round(freed - t0)} s) → ${long.name} igen`;
});
test('Instängda i två hissar: teknikern som räddar de första ringer direkt in en kollega till de andra', () => {
  sim(43); runUntil(9);
  const mid = x => x.mode === 'normal' && x.state === 'moving' && x.passengers.length && !x.deck2 && !x.facade && x.pos - Math.floor(x.pos) > 0.35 && x.pos - Math.floor(x.pos) < 0.75;
  let a = null, g = 0;
  while (!a && ++g < 120 / DT) { step(DT); a = S.elevators.find(mid) || null; }
  assert(a, 'ingen hiss körde med folk');
  trapBreak(a); a.fault.need = 1e6; // (det första jobbet tar lång tid)
  g = 0;
  while (!(techOf(a) && techOf(a).state === 'office') && ++g < 300 / DT) step(DT);
  assert(techOf(a), `ingen tekniker kom till ${a.name}`);
  let b = null; g = 0;
  while (!b && ++g < 120 / DT) { step(DT); b = S.elevators.find(x => x !== a && mid(x)) || null; }
  assert(b, 'ingen annan hiss körde med folk');
  trapBreak(b);
  const t0 = S.t; g = 0;
  while (!S.techCall && ++g < 20 / DT) step(DT);
  assert(S.techCall && S.techCall.trapped === b.name, `teknikern ringde inte efter hjälp till ${b.name} (${JSON.stringify(S.techCall)})`);
  g = 0;
  while (b.mode === 'broken' && ++g < 200 / DT) step(DT);
  assert(b.mode === 'normal', `de instängda i ${b.name} blev aldrig fria`);
  return `teknikern i ${a.name} ringde in en kollega · de i ${b.name} fria efter ${Math.round(S.t - t0)} s`;
});
test('Brandlarm medan folk sitter fast: teknikern vevar ner korgen för hand och släpper ut dem innan hen utryms', () => {
  sim(43); runUntil(9);
  const w = watcher();
  let e = null, g = 0;
  // en hiss högt upp (så att branden kan ligga ovanför entrén och ändå nå teknikern)
  while (!e && ++g < 120 / DT) { step(DT); e = S.elevators.find(x => x.mode === 'normal' && x.state === 'moving' && x.passengers.length && !x.deck2 && !x.facade && x.pos > LOBBY + 3 && x.pos - Math.floor(x.pos) > 0.35 && x.pos - Math.floor(x.pos) < 0.75) || null; }
  assert(e, 'ingen hiss körde med folk högt upp');
  const who = [...e.passengers];
  trapBreak(e); e.fault.need = 1e6; // (lagningen hinner inte bli klar före branden)
  g = 0;
  let t = null;
  while (!(t && t.state === 'office' && t.floor === e.floor) && ++g < 300 / DT) { const b = w.before(); step(DT); w.check(b); t = techOf(e); }
  assert(t, 'teknikern kom aldrig fram till den instängda hissen');
  startFire(Math.max(LOBBY + 1, t.floor)); // teknikerns våning hamnar i brandzonen
  g = 0;
  while (who.some(p => p.state === 'ride' && p.car === e) && ++g < 60 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(!who.some(p => p.state === 'ride' && p.car === e), `de instängda i ${e.name} sitter kvar under branden`);
  assert(e.mode === 'broken' && !e.fault.trapped && Number.isInteger(e.pos) && e.stops.has(e.pos), `${e.name} står inte trasig vid en våning (${e.mode}, ${e.pos})`);
  assert(who.every(p => p.dead || p.evac || !inFireZone(p.floor)), 'någon som släpptes ut i brandzonen utryms inte');
  g = 0;
  while (!t.dead && t.floor !== t.exitFloor && ++g < 120 / DT) step(DT);
  assert(t.dead || t.floor === t.exitFloor, `${t.name} utrymdes inte efter vevandet`);
  assert(S.notices.some(n => n.kind === 'fault'), 'ingen ruta när de instängda kom ut');
  return `${who.length} ute ur ${e.name} på ${fl(e.floor)} · ${t.name} utryms`;
});

// ---------- Strömavbrott ----------
test('Strömavbrott utan åtgärd: hissarna står still, folk sitter fast, strömmen kommer tillbaka', () => {
  sim(11); runUntil(7.92); untilSomeoneRiding();
  startOutage();
  const pos = S.elevators.map(e => e.pos);
  run(30);
  S.elevators.forEach((e, i) => assert(Math.abs(e.pos - pos[i]) < 1e-9, `hiss ${e.name} rörde sig utan ström`));
  assert(S.stats.trappedSec > 0, 'ingen satt fast');
  run(100);
  assert(S.power && !S.outage, 'strömmen kom aldrig tillbaka');
  assert(S.elevators.every(e => e.mode === 'normal'), 'hissarna återställdes inte');
  return `${Math.round(S.stats.trappedSec)} instängd-sekunder`;
});
test('Strömavbrott + reservkraft med auto-räddning: alla instängda kommer ut', () => {
  sim(12); runUntil(7.92); untilSomeoneRiding();
  startOutage(); S.outage.backAt = S.t + 200; run(1); // längre avbrott än vanligt, så att räddningen hinner
  const trappedAtStart = S.elevators.filter(e => e.passengers.length && !(e.state === 'doors' && e.door >= 0.95)).length;
  startGenerator(); run(6); toggleAutoRescue(true);
  run(70);
  const stillTrapped = S.elevators.filter(e => e.mode === 'normal' && e.passengers.length).reduce((a, e) => a + e.passengers.length, 0);
  assert(!S.power, 'strömmen hann komma tillbaka – testet mäter fel sak');
  assert(stillTrapped === 0, `${stillTrapped} personer sitter fortfarande fast`);
  return `${trappedAtStart} hissar med instängda räddades med reservkraft`;
});
test('Brand + strömavbrott: återkallade hissar kan nödsänkas, och en hiss som kommer tillbaka återkallas också', () => {
  sim(8); runUntil(9.5);
  act('trigger', 'power'); S.outage.backAt = S.t + 200;
  act('trigger', 'fire'); S.fire.brigadeAt = S.t + 1000; // (branden ska pågå längre än strömavbrottet)
  act('fireMode', 'recall'); act('generator'); run(6);
  const n0 = S.elevators.filter(e => e.mode === 'recall' && e.passengers.length).length;
  assert(n0 > 0, 'ingen återkallad hiss hade folk i sig när strömmen gick');
  assert(S.elevators.some(canRescue), 'de instängda i återkallade hissar kan inte nödsänkas');
  act('autoRescue'); run(120);
  const left = S.elevators.reduce((a, e) => a + e.passengers.length, 0);
  assert(left === 0, `${left} sitter fortfarande fast i återkallade hissar`);
  assert(S.stats.trappedSec > 0, 'de instängda räknades inte');
  while (S.outage) step(DT);
  run(2);
  assert(S.fire && S.fire.mode === 'recall', 'branden hann släckas – testet mäter fel sak');
  const loose = S.elevators.filter(e => e.mode === 'normal');
  assert(!loose.length, `${loose.map(e => e.name).join(', ')} går i normal drift mitt under återkallningen`);
  return `${n0} återkallade hissar med instängda nödsänktes · alla återkallade när strömmen kom tillbaka`;
});

test('Hiss ur drift får inga nya resenärer', () => {
  sim(14); runUntil(7.67);
  toggleOff(S.elevators[0], true);
  run(20);
  let assigned = 0;
  for (let i = 0; i < 60 / DT; i++) {
    step(DT);
    assigned += S.people.filter(p => p.state === 'wait' && p.assigned === 0).length;
  }
  assert(assigned === 0, `hiss A fick tilldelningar ${assigned} gånger`);
  return 'hiss A tog inga nya resenärer på 60 s';
});

// ---------- Hela dagar med slumpade incidenter ----------
for (const seed of [31, 32, 33]) {
  test(`Hel dag med slumpade incidenter (frö ${seed}): ingen fastnar`, () => {
    sim(seed, { autoInc: true });
    const w = watcher();
    runDay(w);
    assert(w.passes === 0, `hissar åkte förbi passagerares mål ${w.passes} gånger`);
    assert(w.overweight === 0, `hissar körde överlastade ${w.overweight} gånger`);
    assert(w.maxWait < 300, `någon väntade i ${w.maxWait.toFixed(0)}s med fungerande hissar`);
    assert(visitors() < 20, `${visitors()} personer kvar i huset vid stängning`);
    assert(w.outOfRange === 0 && w.wrongDoor === 0 && w.badLeg === 0, `zonfel: ${w.outOfRange}/${w.wrongDoor}/${w.badLeg}`);
    return `${S.stats.incidents} incidenter · ${fmt(w)}`;
  });
}

// ---------- Det ombyggda huset: zoner, byten, garage, boende, VIP ----------
test('Sky lobbyn: långa resor byter hiss på 6:an, expressen stannar aldrig på vägen', () => {
  sim(61);
  const w = watcher(); runUntil(12, w);
  const tr = S.stats.transfers;
  // (från tunnelbanan går stationsexpressen direkt till sky lobbyn – ett byte färre än via entrén och rulltrappan)
  assert(tr > 20, `bara ${tr} hissbyten på förmiddagen`);
  assert(w.badLeg === 0 && w.wrongDoor === 0 && w.outOfRange === 0, `zonfel: ${w.badLeg} fel delresor, ${w.wrongDoor} fel dörrar, ${w.outOfRange} utanför zon`);
  const x = S.elevators.filter(e => e.express);
  assert(x.every(e => e.trips > 4), `expresshissarna gick nästan inte: ${x.map(e => e.trips).join(', ')}`);
  const low = S.elevators.filter(e => e.group === 'låg');
  return `${tr} hissbyten · expressen ${x.map(e => e.trips).join('+')} stopp · låga zonen ${low.map(e => e.trips).join('+')} stopp`;
});
test('Staplade zoner: låg → hög zon går via entrén (eller mellanplanet), expressen och sky lobbyn', () => {
  sim(1, { strategy: 'nearest' }); // (utan kostnadsstyrning väljer man däck efter udda/jämna våningar)
  const p = { cargo: null, kind: 'emp' };
  const route = (from, goal) => { const r = [from]; let f = from; for (let i = 0; i < 6 && f !== goal; i++) { f = legDest(f, goal, p); r.push(f); } return r.map(fl).join('→'); };
  // dubbeldäcken: nedre däcket E ⇄ 6, övre däcket 1 ⇄ 7 (rulltrappa E → 1)
  const cases = [['3', '10', '3→1→7→10'], ['P2', 'T', 'P2→E→T'], ['12', '1', '12→7→1'], ['5', '6', '5→E→6'], ['E', '9', 'E→1→7→9'],
    ['E', '8', 'E→6→8'], ['E', '7', 'E→1→7'], ['7', 'E', '7→1→E'], ['10', 'E', '10→6→E']];
  for (const [a, b, want] of cases) { const got = route(idx(a), idx(b)); assert(got === want, `${a}→${b}: ${got}, väntade ${want}`); }
  // låga och höga zonens hissar delar schakt men når aldrig samma våning
  for (const a of EL) for (const b of EL) if (a !== b && !a.facade && !b.facade && a.col === b.col && a.col !== undefined)
    assert(a.maxF < b.minF || b.maxF < a.minF, `${a.name} och ${b.name} delar schakt men överlappar`);
  return cases.map(c => c[2]).join(' · ');
});
test('Varuhissen: städvagnar och paket åker bara varuhiss, och den tar bara gods och personal', () => {
  // (budet kommer bara några gånger per förmiddag – därför tre frön)
  let deliveries = 0, trips = 0, maxKg = 0;
  for (const seed of [62, 63, 64]) {
    sim(seed);
    const w = watcher(); runUntil(13, w);
    assert(w.badFreight === 0, `frö ${seed}: ${w.badFreight} gånger fel last i fel hiss`);
    const V = S.elevators.find(e => e.freight);
    assert(V.trips > 3, `frö ${seed}: varuhissen gjorde bara ${V.trips} stopp`);
    deliveries += S.stats.deliveries; trips += V.trips; maxKg = Math.max(maxKg, w.maxKg);
  }
  assert(deliveries > 0, 'inga paket levererades från lastkajen');
  return `${deliveries} leveranser · varuhissen ${trips} stopp · tyngsta avgång ${Math.round(maxKg)} kg (tre förmiddagar)`;
});
test('Garaget: bilar kör in på morgonen och ut på kvällen', () => {
  sim(1);
  // (de boendes bilar räknas inte – de kommer hem på kvällen)
  const notRes = () => S.autos.filter(a => { const p = S.people.find(q => q.id === a.owner); return !p || p.kind !== 'res'; }).length;
  runUntil(10.5); const morning = notRes();
  runUntil(21); const evening = notRes();
  assert(S.stats.carsIn >= 5, `bara ${S.stats.carsIn} bilar körde in`);
  assert(evening < morning, `garaget töms inte på kvällen (${morning} → ${evening} bilar)`);
  return `${S.stats.carsIn} bilar in · ${morning} parkerade 10:30 · ${evening} kvar 21:00 (utom de boendes bilar)`;
});
test('De boende: åker till jobb och skola på morgonen och sover hemma på natten', () => {
  sim(64);
  const res = () => S.people.filter(p => p.kind === 'res');
  const n = res().length;
  assert(n >= 8, `bara ${n} boende`);
  runUntil(11); const away = res().filter(p => p.state === 'away').length;
  runUntil(29.9); // (natten går fort – den som festat kommer hem på morgonkvisten)
  // (ett hushåll som flyttade ut under flyttdagen bor inte här längre)
  const moved = S.move && S.move.state === 'done' ? S.move.family.length : 0;
  const home = res().filter(p => p.floor === p.home && p.state === 'office').length + moved;
  const asleep = res().filter(p => p.sleeping).length;
  assert(away >= 3, `bara ${away} boende var borta klockan 11`);
  assert(home === n, `${n - home} boende är inte hemma klockan 05:55`);
  assert(asleep >= n - 2, `bara ${asleep} av ${n} sover klockan 05:55`);
  return `${n} boende · ${away} borta 11:00 · alla hemma och ${asleep} sover 05:55`;
});
test('VIP-helikoptern: gruppen åker ensam i sin hiss och flyger hem igen', () => {
  sim(65);
  const w = watcher(); runDay(w);
  assert(S.stats.vips === 2, `${S.stats.vips} VIP-besök (väntade 2)`);
  assert(w.vipMixed === 0, `${w.vipMixed} gånger klev någon annan på VIP-hissen`);
  assert(!S.people.some(p => p.vip), 'VIP-gruppen är kvar i huset');
  const P = S.elevators.find(e => e.facade);
  assert(P.trips > 5, `panoramahissen gick bara ${P.trips} stopp`);
  return `2 helikopterbesök · panoramahissen ${P.trips} stopp`;
});

// ---------- KNAPPAR och felknappar ----------
test('Knappar: styrsystemet läser aldrig vart folk ska (bara anrop, korgar och våg)', () => {
  sim(71, { strategy: 'buttons' });
  runUntil(8.5);
  for (let g = 0; !Object.keys(S.calls).length && g < 60 / DT; g++) step(DT);
  assert(Object.keys(S.calls).length > 0, 'inga hallanrop att fördela');
  for (const c of Object.values(S.calls)) c.car = null;
  const real = S.people;
  S.people = new Proxy([], { get() { throw new Fail('styrningen läste S.people'); } });
  try { assignCalls(true); } finally { S.people = real; }
  assert(Object.values(S.calls).some(c => c.car !== null), 'inga anrop fick någon hiss');
  return `${Object.keys(S.calls).length} anrop fördelade utan att titta på personerna`;
});
test('Felknappar: fel knapp ger spökstopp, och utan fel blir det nästan inga', () => {
  const day = mistakes => { sim(72, { strategy: 'buttons', mistakes }); const w = watcher(); runDay(w); assert(w.passes === 0, `förbiåkningar med felknappar=${mistakes}`); return { ...S.stats }; };
  const off = day('av'), many = day('mycket');
  assert(off.wrongPress === 0 && off.kidPresses === 0, `felknappar trots av: ${off.wrongPress}`);
  assert(off.ghostStops < 10, `${off.ghostStops} spökstopp utan felknappar`);
  assert(many.wrongPress > 40, `bara ${many.wrongPress} felknappar på "mycket"`);
  assert(many.ghostStops > off.ghostStops + 15, `spökstopp: av ${off.ghostStops} · mycket ${many.ghostStops}`);
  return `av: ${off.ghostStops} spökstopp · mycket: ${many.wrongPress} felknappar, ${many.kidPresses} barn, ${many.ghostStops} spökstopp`;
});
test('Antinuisance: för många våningsknappar för få passagerare rensas', () => {
  sim(73, { strategy: 'buttons' });
  runUntil(8.5);
  const one = () => S.elevators.find(x => x.passengers.length === 1 && x.serves.size > 5);
  for (let g = 0; !one() && g < 120 / DT; g++) step(DT);
  const e = one();
  assert(e, 'ingen hiss med exakt en passagerare');
  for (const f of e.serves) e.carCalls.add(f);
  const n0 = S.stats.nuisance;
  antiNuisance(e);
  const dest = e.passengers[0].dest;
  assert(e.carCalls.size === 1 && e.carCalls.has(dest), `knappar kvar: ${[...e.carCalls].map(fl).join(',')}`);
  assert(S.stats.nuisance === n0 + 1, 'rensningen räknades inte');
  return `${e.name}: alla knappar rensade, passageraren tryckte ${fl(dest)} igen`;
});

// ---------- Drift: hissfel, tekniker, nattservice ----------
test('Hissfel: hissen går sönder vid nästa stopp, alla kliver ut och teknikern lagar den', () => {
  sim(81);
  runUntil(9);
  const w = watcher();
  triggerFault();
  const e = S.elevators.find(x => x.breakNext || x.mode === 'broken');
  assert(e, 'ingen hiss fick ett fel');
  run(60, w);
  assert(e.mode === 'broken' || S.stats.repairs === 1, `${e.name} gick aldrig sönder (läge ${e.mode})`);
  assert(S.stats.faults === 1, `${S.stats.faults} fel räknades`);
  let g = 0;
  while (e.mode === 'broken' && ++g < 400 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode === 'normal', `${e.name} lagades aldrig (läge ${e.mode})`);
  assert(S.stats.repairs === 1, 'lagningen räknades inte');
  assert(w.brokenUse === 0, `den trasiga hissen användes ${w.brokenUse} steg`);
  assert(w.passes === 0 && w.overweight === 0, 'regelbrott medan hissen var trasig');
  return `${e.name} trasig i ${Math.round(S.stats.downSec)} s, lagad av hissteknikern`;
});
test('Extra tekniker: med många hissfel i kö ringer teknikern hissjouren, kollegan lagar kön och åker hem', () => {
  const lagat = withExtra => {
    sim(82, { autoInc: false });
    runUntil(9.5);
    const w = watcher();
    // fyra hissar går sönder samtidigt (inte varuhissen, så att teknikern kommer fram fort)
    const cars = S.elevators.filter(e => e.mode === 'normal' && !e.freight).slice(0, EXTRA_QUEUE + 2);
    for (const e of cars) breakDown(e, 'bromsen kärvar');
    if (!withExtra) S.extraAt = Infinity; // (jämförelsen: kollegan "är redan på väg" och kommer aldrig, så ingen ringer)
    let g = 0, both = 0, call = null, extra = null;
    while (cars.some(e => e.mode === 'broken') && ++g < 900 / DT) {
      const b = w.before(); step(DT); w.check(b);
      if (S.techCall && !call) call = { ...S.techCall, queued: S.elevators.filter(e => e.mode === 'broken' && e.techId === null).length };
      const crew = techs();
      if (crew.length === 2 && crew.every(t => t.job !== null && t.job !== undefined && t.state === 'office')) both++;
      extra = extra || crew.find(t => t.extra) || null;
    }
    assert(cars.every(e => e.mode === 'normal'), `alla hissar lagades inte (${cars.map(e => `${e.name}:${e.mode}`).join(' ')})`);
    assert(w.techClash === 0, `två tekniker på samma hiss i ${w.techClash} steg`);
    return { t: S.t, call, extra, both, w };
  };
  const a = lagat(true);
  assert(a.call && a.call.queued >= EXTRA_QUEUE, `teknikern ringde aldrig (${JSON.stringify(a.call)})`);
  assert(S.notices.some(n => n.kind === 'tech'), 'ingen informationsruta om samtalet');
  assert(a.extra && a.extra.extra && a.extra.id !== a.call.by, 'ingen extra tekniker kom');
  assert(a.both > 30, `teknikerna lagade aldrig samtidigt (${a.both} steg)`);
  assert(S.stats.extraTechs === 1, `${S.stats.extraTechs} samtal – bara ett ska behövas`);
  assert(a.call.until - a.call.t0 === CALL_T, 'samtalet hade fel längd');
  // kollegan åker hem när kön är tom (och tar ingen nattservice)
  run(200);
  assert(!techs().some(t => t.extra) && (a.extra.dead || a.extra.goal === a.extra.exitFloor), `kollegan åkte inte hem (${a.extra.why})`);
  const b = lagat(false);
  assert(a.t < b.t, `med extra tekniker blev det inte fortare (${a.t.toFixed(0)} s mot ${b.t.toFixed(0)} s)`);
  return `samtal med ${a.call.queued} hissar i kö · alla lagade efter ${Math.round(a.t)} s mot ${Math.round(b.t)} s med en tekniker`;
});
test('Linbrott: korgen faller, fångas mellan två våningar, alla tas ut genom takluckan och linorna byts i timmar', () => {
  sim(83, { autoInc: false });
  runUntil(10);
  const w = watcher();
  act('trigger', 'cable');
  const e = S.elevators.find(x => x.mode === 'snapped' || x.snapNext);
  assert(e, 'ingen hiss fick linbrott');
  let g = 0;
  while (e.mode !== 'snapped' && ++g < 120 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode === 'snapped', `linorna i ${e.name} gick aldrig av`);
  const p0 = e.pos, trapped = [...e.passengers];
  while (e.snap.ph === 'fall' && ++g < 200 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.pos < p0 && e.pos >= e.minF, `korgen föll inte rätt (${p0.toFixed(2)} → ${e.pos.toFixed(2)})`);
  const fr = e.pos - Math.floor(e.pos);
  assert(fr > 0.05 && fr < 0.95, `korgen stannade vid en våning (${e.pos.toFixed(2)}), inte mellan två`);
  const exitF = e.snap.exitF;
  assert(exitF > e.pos + 0.7 && e.serves.has(exitF), `utrymningsvåningen ${fl(exitF)} ligger inte ovanför korgtaket`);
  while (e.mode === 'snapped' && ++g < 600 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode === 'broken' && e.fault && e.fault.cable, `${e.name} gick inte över till linbyte (läge ${e.mode})`);
  assert(!e.passengers.length, 'någon är kvar i korgen');
  assert(trapped.every(p => p.car !== e), 'en instängd sitter fortfarande i hissen');
  const h0 = hour();
  while (e.mode === 'broken' && ++g < 1500 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode === 'normal', `${e.name} lagades aldrig (läge ${e.mode})`);
  assert(hour() - h0 >= 3, `linbytet tog bara ${(hour() - h0).toFixed(1)} speltimmar`);
  assert(S.stats.cables === 1 && S.stats.repairs === 1, 'linbrottet eller lagningen räknades inte');
  assert(w.snapUse === 0 && w.brokenUse === 0, `hissen rörde sig eller tog folk (${w.snapUse}/${w.brokenUse} steg)`);
  assert(w.outOfRange === 0 && w.jumps === 0 && w.passes === 0, 'regelbrott under linbrottet');
  return `${e.name}: ${trapped.length} instängda ut via ${fl(exitF)}, linbyte ${(hour() - h0).toFixed(1)} h`;
});
test('Linbrott med hissteknikern ombord: en kollega larmas, räddar alla och byter linorna', () => {
  let g = 0, e = null, t0 = null, w = null;
  for (const seed of [1, 2, 3, 4, 5]) {
  sim(seed, { autoInc: false });
  runUntil(10);
  w = watcher();
  triggerFault();
  g = 0;
  // linorna går av just när teknikern åker hiss till jobbet
  while (!e && ++g < 400 / DT) {
    const b = w.before(); step(DT); w.check(b);
    const t = tech(), c = t && t.state === 'ride' ? t.car : null;
    if (c && c.mode === 'normal' && c.state === 'moving' && !c.facade && c.pos - Math.floor(c.pos) > 0.35 && c.pos - Math.floor(c.pos) < 0.75 && c.pos > c.minF + 0.6) { e = c; t0 = t; snapCable(e); }
  }
  if (e) break; // (teknikern tar ibland trappan till jobbet – då prövas nästa frö)
  }
  assert(e, 'teknikern åkte aldrig hiss');
  while (e.mode === 'snapped' && ++g < 600 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode === 'broken' && !e.passengers.length, `de instängda kom aldrig ut (läge ${e.mode}, ${e.passengers.length} kvar)`);
  const t1 = tech();
  assert(t1 && t1 !== t0 && t0.offDuty, 'ingen kollega tog över');
  while (S.elevators.some(x => x.mode === 'broken') && ++g < 2000 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(S.elevators.every(x => x.mode !== 'broken'), 'en hiss lagades aldrig');
  assert(t0.state === 'away' || !S.people.includes(t0) || t0.leaving, `den utrymda teknikern gick inte hem (${t0.state})`);
  assert(w.outOfRange === 0 && w.jumps === 0 && w.passes === 0, 'regelbrott under linbrottet');
  return `${e.name}: ${pn(t0)} utrymd av ${pn(t1)}, båda hissarna lagade`;
});
test('Två linbrott: de instängda i den andra hissen väntar inte på linbytet i den första', () => {
  sim(84, { autoInc: false });
  runUntil(10);
  const w = watcher();
  const pickCar = () => S.elevators.find(x => !x.facade && x.mode === 'normal' && x.state === 'moving' && x.passengers.length && x.pos > x.minF + 1.5);
  let g = 0, a = null, b = null;
  while (!a && ++g < 300 / DT) { step(DT); a = pickCar(); }
  assert(a, 'ingen första hiss i fart');
  snapCable(a);
  while (!b && ++g < 600 / DT) { const x = w.before(); step(DT); w.check(x); b = pickCar(); }
  assert(b, 'ingen andra hiss i fart');
  snapCable(b);
  const h0 = hour();
  while ((a.mode === 'snapped' || b.mode === 'snapped') && ++g < 2000 / DT) { const x = w.before(); step(DT); w.check(x); }
  assert(a.mode !== 'snapped' && b.mode !== 'snapped', 'någon sitter fortfarande fast');
  const took = hour() - h0;
  // båda är utrymda innan något linbyte är klart (teknikern lämnar linbytet för de instängda)
  assert(a.mode === 'broken' && b.mode === 'broken', `ett linbyte blev klart innan alla var ute (${a.mode}/${b.mode})`);
  while ((a.mode !== 'normal' || b.mode !== 'normal') && ++g < 4000 / DT) { const x = w.before(); step(DT); w.check(x); }
  assert(a.mode === 'normal' && b.mode === 'normal', `linbytena blev aldrig klara (${a.mode}/${b.mode})`);
  assert(w.snapUse === 0 && w.brokenUse === 0 && w.orphanService === 0, 'regelbrott under linbrotten');
  return `${a.name} och ${b.name}: alla ute på ${took.toFixed(1)} h, båda lagade`;
});
test('Hissfel i entrén: teknikern kliver in och lagar direkt (ingen hissresa till samma våning)', () => {
  sim(82);
  runUntil(8);
  const open = () => S.elevators.find(x => !x.freight && x.mode === 'normal' && x.state === 'doors' && x.floor === LOBBY && x.door >= 1);
  let g0 = 0;
  while (!open() && ++g0 < 120 / DT) step(DT);
  const e = open();
  assert(e, 'ingen hiss stod öppen i entrén');
  breakDown(e, 'testfel');
  const w = watcher();
  let g = 0;
  while (e.mode === 'broken' && ++g < 400 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode === 'normal', `${e.name} lagades aldrig`);
  assert(w.selfDest === 0, 'teknikern köade till sin egen våning');
  return `${e.name} lagad på ${fl(e.floor)}`;
});
test('Nattservice: de slitna hissarna servas på natten, utan den slits de dag för dag', () => {
  const days = (maint, seed) => {
    sim(seed, { autoInc: true, maint });
    let faults = 0, serviced = 0;
    for (let d = 1; d <= 3; d++) { runDay(); faults += S.stats.faults; serviced += S.stats.serviced; S.day++; resetDay(); }
    return { faults, serviced, wear: S.elevators.reduce((a, e) => a + e.wear, 0) / S.elevators.length };
  };
  // (felen räknas över tre frön – med ett enda frö avgör slumpen för mycket)
  const sum = maint => [1, 2, 3].map(seed => days(maint, seed)).reduce((a, b) => ({ faults: a.faults + b.faults, serviced: a.serviced + b.serviced, wear: a.wear + b.wear / 3 }), { faults: 0, serviced: 0, wear: 0 });
  const night = sum('natt'), none = sum('fel');
  assert(night.serviced >= 18, `bara ${night.serviced} hissar servades på 3 × tre nätter`);
  assert(none.serviced === 0, 'service trots "bara vid fel"');
  // (dygn med många hissfel hinner teknikern serva färre på natten – därför en viss marginal)
  assert(night.wear < none.wear * 0.7 && none.wear > 0.4, `snittslitage: nattservice ${night.wear.toFixed(2)} · bara vid fel ${none.wear.toFixed(2)}`);
  assert(night.faults < none.faults, `fel: nattservice ${night.faults} · bara vid fel ${none.faults}`);
  return `3 frön × 3 dygn · nattservice: ${night.serviced} servade, ${night.faults} fel, slitage ${Math.round(night.wear * 100)} % · bara vid fel: ${none.faults} fel, slitage ${Math.round(none.wear * 100)} %`;
});
test('Nattservice som avbryts (teknikern utryms vid brand): hissen fastnar inte på service', () => {
  sim(1);
  let e = null;
  while (!e && hour() < 28) { step(DT); e = S.elevators.find(x => x.mode === 'service' && x.home === SKY) || null; }
  assert(e, 'ingen hiss med hemvåning i sky lobbyn kom på nattservice');
  startFire(SKY + 1); // sky lobbyn hamnar i brandzonen – teknikern utryms
  let g = 0;
  while (S.fire && ++g < 120 / DT) step(DT);
  assert(!S.fire, 'branden släcktes aldrig');
  g = 0;
  while ((e.mode === 'service' || e.hold) && ++g < 60 / DT) step(DT);
  assert(e.mode === 'normal' && !e.hold, `${e.name} står kvar i läget ${e.mode} (hold ${e.hold}) utan tekniker`);
  return `${e.name} i trafik igen ${Math.round(g * DT)} s efter branden`;
});

// ---------- Trappan ----------
test('Trappan: korta resor går ibland till fots, långa resor och tung last aldrig', () => {
  sim(84);
  const bad = [];
  const seen = new Set();
  while (!S.summaryShown) {
    step(DT);
    for (const p of S.people) {
      if (p.state !== 'stairs' || seen.has(p)) continue;
      seen.add(p);
      // bara frivilliga trappresor (inte utrymning, strömavbrott, trasig hiss eller Fia som alltid går)
      if (!p.stairsByChoice || p.quirk === 'trappa') continue;
      const n = Math.abs(p.dest - p.floor);
      if (n > 4) bad.push(`${p.name} gick ${n} våningar`);
      if (p.vip || (p.cargo && p.cargo.kg >= 15)) bad.push(`${p.name} (${p.cargo ? p.cargo.name : 'VIP'}) tog trappan`);
    }
    if (S.summaryShown) break;
    for (const p of S.people) if (p.state !== 'stairs') seen.delete(p);
  }
  assert(bad.length === 0, bad.slice(0, 4).join('; '));
  assert(S.stats.stairsChoice > 15, `bara ${S.stats.stairsChoice} tog trappan frivilligt`);
  assert(S.stats.stairsChoice < S.stats.served * 0.2, `${S.stats.stairsChoice} trappresor mot ${S.stats.served} hissresor – för många`);
  return `${S.stats.stairsChoice} frivilliga trappresor mot ${S.stats.served} hissresor`;
});

// ---------- Energi och strategierna Rusning/Energisnål ----------
test('Energi: strömmen beror på lasten mot motvikten', () => {
  const v = 2.6;
  const heavyUp = powerKw(700, RATED_KG, v, 1), emptyUp = powerKw(0, RATED_KG, v, 1);
  const heavyDown = powerKw(700, RATED_KG, v, -1), emptyDown = powerKw(0, RATED_KG, v, -1), balanced = powerKw(RATED_KG * 0.45, RATED_KG, v, 1);
  assert(heavyUp > 40, `full hiss uppåt drar bara ${heavyUp.toFixed(1)} kW`);
  assert(emptyUp < 0 && heavyDown < 0, `tom upp ${emptyUp.toFixed(1)} kW / full ner ${heavyDown.toFixed(1)} kW borde återmata`);
  assert(emptyDown > balanced && heavyUp > balanced && balanced > 0, 'fel ordning mellan lastfallen');
  sim(85); runUntil(9);
  assert(S.stats.energyRun > 0 && S.stats.regen > 0, 'ingen energi räknades');
  return `full upp ${heavyUp.toFixed(0)} kW · tom ner ${emptyDown.toFixed(0)} kW · balanserad ${balanced.toFixed(0)} kW · tom upp ${emptyUp.toFixed(0)} kW · full ner ${heavyDown.toFixed(0)} kW`;
});
test('Energisnål drar mindre ström än Smart, och Rusning blir inte sämre i entrén på morgonen (snitt över sex dygn)', () => {
  const r = {}, N = 6;
  for (const strategy of ['smart', 'peak', 'eco']) {
    let wait = 0, kwh = 0, run = 0;
    for (let seed = 11; seed < 11 + N; seed++) {
      sim(seed, { strategy });
      runDay(); wait += avgWait(); kwh += S.stats.energy; run += S.stats.energyRun;
    }
    r[strategy] = { wait: wait / N, morning: 0, kwh: kwh / N, run: run / N };
  }
  assert(r.eco.kwh < r.smart.kwh && r.eco.run < r.smart.run * 0.9, `energi: smart ${r.smart.kwh.toFixed(1)} (körning ${r.smart.run.toFixed(1)}) · eco ${r.eco.kwh.toFixed(1)} (${r.eco.run.toFixed(1)}) kWh`);
  assert(r.eco.wait < r.smart.wait * 1.3, `eco väntar för länge: ${r.eco.wait.toFixed(1)}s mot ${r.smart.wait.toFixed(1)}s`);
  // morgonrusningen varierar mycket mellan dygn – jämför den över 48 frön (bara förmiddagen),
  // totalt och i entrén (väntan för dem som kliver på där)
  for (const strategy of ['smart', 'peak']) {
    let morning = 0, lobby = 0, lobbyN = 0; const M = 48;
    for (let seed = 11; seed < 11 + M; seed++) {
      sim(seed, { strategy });
      runUntil(7); const w0 = S.stats.waitSum, n0 = S.stats.waitN;
      const seen = new WeakMap();
      while (hour() < 10.3) {
        step(DT);
        for (const p of S.people) if (p.state === 'boarding' && p.floor === LOBBY && seen.get(p) !== p.rideStart) { seen.set(p, p.rideStart); lobby += p.lastWait; lobbyN++; }
      }
      morning += (S.stats.waitSum - w0) / Math.max(1, S.stats.waitN - n0);
    }
    r[strategy].morning = morning / M; r[strategy].lobby = lobby / Math.max(1, lobbyN);
  }
  // Rusning är bara lite snabbare i entrén: över 3 200 morgnar (7–10.3) 3–5 % kortare väntan, oavsett slumpgenerator.
  // Dygnen sprider så mycket (kvoten över tolv morgnar 0,63–1,58) att en fördel inte går att visa här –
  // det gamla kravet (< 0,92 över tolv frön) höll bara för just frö 11–22, och föll så fort ett slumptal
  // till drogs någonstans (det som såg ut som ett paritetseffekt i antalet rng()-anrop). Över 48 morgnar är
  // spridningen ±0,08 kring 0,96, så kravet är att Rusning inte blir klart sämre, varken i entrén eller totalt.
  assert(r.peak.lobby < r.smart.lobby * 1.15, `entrén på morgonen: rusning ${r.peak.lobby.toFixed(2)}s · smart ${r.smart.lobby.toFixed(2)}s`);
  assert(r.peak.morning < r.smart.morning * 1.1, `morgonrusning: rusning ${r.peak.morning.toFixed(2)}s · smart ${r.smart.morning.toFixed(2)}s`);
  return `morgon smart ${r.smart.morning.toFixed(1)} · rusning ${r.peak.morning.toFixed(1)} s (entrén ${r.smart.lobby.toFixed(1)} → ${r.peak.lobby.toFixed(1)} s) · dygn smart ${r.smart.wait.toFixed(1)} · rusning ${r.peak.wait.toFixed(1)} · eco ${r.eco.wait.toFixed(1)} s · energi smart ${r.smart.kwh.toFixed(1)} · eco ${r.eco.kwh.toFixed(1)} kWh (körning ${r.smart.run.toFixed(1)} → ${r.eco.run.toFixed(1)})`;
});
test('Rusning: på morgonen kör lediga hissar direkt tillbaka till entrén (eller möter tåget)', () => {
  // (i rusningen är hissarna ofta upptagna hela tiden – därför fyra förmiddagar)
  let parked = 0, away = 0, twoMeet = 0; const meets = new Set();
  for (const seed of [1, 2, 3, 4]) {
    sim(seed, { strategy: 'peak' });
    runUntil(7.02); // UPP-läget börjar 07:00
    assert(S.peakMode === 'upp' && trafficMode(8) === 'upp', `rusningsläget är ${S.peakMode}`);
    while (hour() < 9.5) {
      step(DT);
      for (const e of S.elevators) if (e.state === 'moving' && e.targetKind === 'park') {
        if (e.parkTarget === e.home) parked++;
        // (en hiss som går ner till perrongen får möta ett tåg som snart är där – men bara en åt gången)
        else if (e.parkTarget === STATION && e.stops.has(STATION)) { meets.add(`${seed}:${S.trainNext}:${e.id}`); if (S.elevators.filter(o => o.parkTarget === STATION).length > 1) twoMeet++; }
        // (parkTarget null: hissen fick nyss en passagerare – färden räknas om i samma steg)
        else if (e.parkTarget !== null) away++;
      }
    }
  }
  assert(parked > 0 && away === 0, `parkeringar hem ${parked}, någon annanstans ${away}`);
  assert(meets.size > 0 && twoMeet === 0, `hissar som mötte tåget: ${meets.size} (två samtidigt ${twoMeet} steg)`);
  return `${parked} steg med lediga hissar på väg hem i UPP-läget · ${meets.size} gånger mötte en hiss tåget`;
});

test('Rusning och tåget: hissen väntar in klumpen vid perrongen men står inte och väntar i entrén när tåget kommer', () => {
  sim(1, { strategy: 'peak' });
  runUntil(7.3);
  // vänta tills ett tåg står inne och folk fortfarande kliver av
  for (let g = 0; !(S.train && S.train.state === 'stop' && S.train.spawned < S.train.n && S.train.n > 1) && g < 60 / DT; g++) step(DT);
  assert(S.train && S.train.state === 'stop', 'inget tåg stod inne');
  const X1 = S.elevators.find(e => e.express && e.stops.has(STATION)), X2 = S.elevators.find(e => e.express && !e.stops.has(STATION));
  const save = [X1.dir, X2.dir, X1.passengers, X2.passengers, X1.reserved, X2.reserved];
  X1.dir = 1; X2.dir = 1; X1.passengers = []; X2.passengers = []; X1.reserved = 0; X2.reserved = 0;
  const atStation = peakHold(X1, STATION), x1Lobby = peakHold(X1, LOBBY), x2Lobby = peakHold(X2, LOBBY);
  [X1.dir, X2.dir, X1.passengers, X2.passengers, X1.reserved, X2.reserved] = save;
  assert(atStation === PEAK_HOLD, `stationsexpressen väntar ${atStation} s vid perrongen medan folk kliver av`);
  assert(x1Lobby === 0, `stationsexpressen väntar ${x1Lobby} s i entrén fast tåget står inne`);
  assert(x2Lobby === PEAK_HOLD, `expressen som inte går till perrongen väntar ${x2Lobby} s i entrén`);
  return `perrongen ${atStation} s · entrén: X1 ${x1Lobby} s, X2 ${x2Lobby} s`;
});

// ---------- Stamgästerna ----------
test('Stamgästerna: samma karaktärer varje dag, med sina egenheter', () => {
  const day = () => {
    const seen = new Set(), fiaRode = [];
    while (!S.summaryShown) {
      step(DT);
      for (const p of S.people) {
        if (!p.cast) continue;
        seen.add(`${p.cast}:${p.name}`);
        if (p.quirk === 'trappa' && (p.state === 'boarding' || p.state === 'ride') && liftsAvailable()) fiaRode.push(hour().toFixed(2));
      }
    }
    return { seen, fiaRode, st: { ...S.stats } };
  };
  sim(92);
  const d1 = day();
  S.day++; resetDay();
  const d2 = day();
  const want = ['gunnar:Gunnar', 'doris:Doris', 'kurt:Kurt', 'fia:Fia', 'majken:Majken', 'olle:Lill-Olle', 'pelle:Pizza-Pelle'];
  for (const d of [d1, d2]) for (const k of want) assert(d.seen.has(k), `${k} dök inte upp dag ${d === d1 ? 1 : 2}`);
  assert(d1.fiaRode.length === 0 && d2.fiaRode.length === 0, `Fia åkte hiss kl ${d1.fiaRode.concat(d2.fiaRode).slice(0, 3).join(', ')}`);
  assert(d1.st.cups + d2.st.cups >= 2, `Kurt drack bara ${d1.st.cups} + ${d2.st.cups} koppar på två dagar`);
  assert(d1.st.chats + d2.st.chats > 0, 'Majken pratade aldrig med någon');
  return `dag 1: ${d1.st.cups} koppar, ${d1.st.gripes} gnäll, ${d1.st.holds} dörrhåll, ${d1.st.chats} pratstunder · dag 2: ${d2.st.cups} koppar, ${d2.st.gripes} gnäll`;
});

// ---------- Rumstimrar: tider passas ----------
test('Rummen: den som sitter inne när det är dags för hemgång eller lunch går direkt, inte en speltimme senare', () => {
  const CAFE = floorWith('cafe');
  const late = { home: [], lunch: [] };
  for (const seed of [5, 17]) {
    sim(seed);
    const watch = new Map(); // person → [vad, klockslag då det var dags]
    let prevH = hour();
    while (!S.summaryShown) {
      step(DT);
      const h = hour();
      for (const p of S.people) {
        if (p.kind !== 'emp' || p.role) continue;
        const w = watch.get(p);
        if (w) {
          if (p.state !== 'office') { late[w[0]].push(h - w[1]); watch.delete(p); }
          continue;
        }
        if (p.state !== 'office' || p.floor !== p.home) continue;
        if (prevH < p.leaveAt && h >= p.leaveAt) watch.set(p, ['home', p.leaveAt]);
        else if (!p.lunched && prevH < p.lunchAt && h >= p.lunchAt && h < 13.6 && floorOpen(CAFE, h)) watch.set(p, ['lunch', p.lunchAt]);
      }
      prevH = h;
    }
  }
  const max = a => Math.max(0, ...a), mins = x => Math.round(x * 60);
  assert(late.home.length > 20 && late.lunch.length > 5, `för få fall: ${late.home.length} hemgångar, ${late.lunch.length} luncher`);
  assert(max(late.home) < 0.05, `någon satt kvar ${mins(max(late.home))} spelminuter efter hemgångstiden`);
  assert(max(late.lunch) < 0.05, `någon satt kvar ${mins(max(late.lunch))} spelminuter efter lunchtiden`);
  return `${late.home.length} hemgångar och ${late.lunch.length} luncher · längsta dröjsmål ${mins(max(late.home))} resp. ${mins(max(late.lunch))} spelminuter`;
});

// ---------- Nya hissmekaniker ----------
test('Storm: i svajläget kör de höga hissarna långsammare och panoramahissen stängs – utan åtgärd blir det vajerlarm', () => {
  const day = (mode, seed = 71) => {
    sim(seed, { autoInc: false });
    runUntil(9.5);
    act('trigger', 'storm'); if (mode) act('stormMode', mode);
    const w = watcher(); let maxV = 0, pMoving = 0;
    while (S.storm) {
      const b = w.before(); step(DT); w.check(b);
      for (const e of S.elevators) if (e.group === 'hög' && windAt() > 0.5) maxV = Math.max(maxV, e.v);
      const P = S.elevators.find(e => e.facade);
      if (P.windLock && P.state === 'moving' && !P.passengers.length && P.parkTarget !== P.home) pMoving++;
    }
    return { maxV, faults: S.stats.stormFaults, w, P: S.elevators.find(e => e.facade), pMoving };
  };
  const sway = day('sway');
  assert(sway.maxV <= VMAX * 0.72 + 1e-6, `svajläget: höga zonen körde ${sway.maxV.toFixed(2)} våningar/s`);
  assert(sway.faults === 0, `${sway.faults} vajerlarm i svajläget`);
  assert(sway.pMoving === 0, 'panoramahissen körde annat än hem trots att den var stängd för vinden');
  assert(!sway.P.windLock, 'panoramahissen öppnade inte igen efter stormen');
  assert(sway.w.passes === 0 && sway.w.overweight === 0, 'invariant bröts under stormen');
  let faults = 0;
  for (let i = 0; i < 4; i++) { const r = day(null, 171 + i); faults += r.faults; }
  assert(faults > 0, 'inga vajerlarm när hissarna körde som vanligt i stormen (fyra försök)');
  return `svajläge: max ${sway.maxV.toFixed(2)} vån/s i höga zonen, 0 vajerlarm · normal drift: ${faults} vajerlarm på fyra stormar`;
});
test('Motorvärme: en het motor löser ut och tar inga nya; extrafläkten kyler fortare', () => {
  const cool = fan => {
    sim(72); runUntil(9);
    const e = S.elevators.find(x => x.group === 'låg');
    e.heat = 1.05;
    run(0.5);
    assert(e.hot, 'överhettningsskyddet löste inte ut');
    if (fan) act('fan', e.id);
    const w = watcher(); let t = 0, n0 = e.passengers.length + e.reserved, took = 0;
    while (e.hot && t < 200) { const b = w.before(); step(DT); w.check(b); t += DT; if (e.passengers.length + e.reserved > n0) took++; n0 = e.passengers.length + e.reserved; }
    assert(!e.hot, 'motorn svalnade aldrig');
    return { t, took };
  };
  const slow = cool(false), fast = cool(true);
  assert(slow.took === 0 && fast.took === 0, 'en överhettad hiss tog nya passagerare');
  assert(fast.t < slow.t * 0.5, `fläkten hjälpte inte: ${fast.t.toFixed(0)} s mot ${slow.t.toFixed(0)} s`);
  return `svalnade på ${slow.t.toFixed(0)} s utan fläkt, ${fast.t.toFixed(0)} s med extrafläkt`;
});
test('Nivåfel och kyla: slitna linor ger nivåjusteringar och snubbel, kyla får dörrarna i entrén att ta emot', () => {
  let rel = [0, 0], stumbles = 0, fights = 0, warmFights = 0;
  for (const seed of [73, 74, 75]) {
    for (const [k, wear] of [[0, 0.1], [1, 0.9]]) {
      sim(seed);
      for (const e of S.elevators) e.wear = wear;
      S.weather.cold = k ? 1 : 0;
      runUntil(12);
      rel[k] += S.stats.relevels;
      if (k) { stumbles += S.stats.stumbles; fights += S.stats.doorFights; } else warmFights += S.stats.doorFights;
    }
  }
  assert(rel[1] > rel[0] * 1.5, `nivåjusteringar: nya linor ${rel[0]}, slitna ${rel[1]}`);
  assert(stumbles > 0, 'ingen snubblade i de slitna hissarna');
  assert(fights > 0 && warmFights === 0, `dörren tog emot ${fights} gånger i kyla och ${warmFights} när det var varmt`);
  return `nivåjusteringar ${rel[0]} → ${rel[1]} med slitna linor · ${stumbles} snubbel · dörren tog emot ${fights} gånger i kylan`;
});
test('Informationsrutor: ett nytt dygn börjar utan gårdagens rutor (bara en kall dag åt gången)', () => {
  // frö 1: både dag 1 och dag 2 är kalla – förr syntes båda rutorna i början av dag 2
  sim(1); runUntil(12);
  const before = S.notices.length;
  S.day++; resetDay();
  const cold = S.notices.filter(n => n.kind === 'cold');
  assert(cold.length <= 1, `${cold.length} rutor om kall dag samtidigt: ${cold.map(n => n.title).join(', ')}`);
  assert(S.notices.every(n => n.t0 <= S.t), 'en ruta från i går ligger kvar');
  return `${before} rutor på dag 1 · ${S.notices.length} när dag 2 börjar (${S.weather.temp} °C)`;
});
test('Hissetikett: folk avstår från trånga hissar, och turistgruppen tränger ihop sig', () => {
  // (det händer bara några gånger per morgon, och vissa morgnar inte alls – därför fem frön)
  let crowdSkips = 0, holds = 0;
  for (const seed of [74, 75, 76, 77, 78]) { sim(seed); runUntil(10.3); crowdSkips += S.stats.crowdSkips; holds += S.stats.holds; }
  assert(crowdSkips > 0, 'ingen avstod från en trång hiss i morgonrusningen');
  assert(holds > 0, 'ingen höll upp dörren');
  sim(76); spawnBus(5);
  assert(S.people.filter(p => p.why === 'Turist på busstur').every(p => p.space === 9), 'turisterna bryr sig om trängsel');
  return `${crowdSkips} avstod från en trång hiss och ${holds} höll upp dörren i morgonrusningen`;
});
test('Hundsalongen: hundägare lämnar in raggiga pudlar och går ut med nyklippta', () => {
  const spa = floorWith('spa');
  let dropped = 0, picked = 0, wrongFloor = 0;
  for (const seed of [7, 8, 9]) {
    sim(seed);
    const shaggy = new Set(), clipped = new Set();
    while (hour() < 19) {
      step(DT);
      for (const p of S.people) {
        const k = p.cargo && p.cargo.kind;
        if (k === 'raggig') shaggy.add(p);
        else if (shaggy.has(p) && !p.cargo) { shaggy.delete(p); dropped++; if (p.floor !== spa) wrongFloor++; }
        if (k === 'pudel' && !clipped.has(p)) { clipped.add(p); picked++; if (p.floor !== spa) wrongFloor++; }
      }
    }
  }
  assert(dropped > 0 && picked > 0, `lämnade in ${dropped} · hämtade ${picked} pudlar`);
  assert(wrongFloor === 0, `${wrongFloor} hundar byttes någon annanstans än i hundsalongen`);
  return `tre dygn: ${dropped} raggiga pudlar inlämnade, ${picked} nyklippta hämtade`;
});
test('Flyttdag: hushållets bohag bärs ut och lastas in, oberoende drift tar bara flyttgubbarna, Smart låser varuhissen kortare', () => {
  let ok = 0, smartLate = true, dumbEarly = true, pivots = 0;
  const lockShare = { smart: [], nearest: [] };
  for (let seed = 80; seed < 100 && ok < 3; seed++) {
    for (const strategy of ['smart', 'nearest']) {
      sim(seed, { strategy });
      const M = S.move;
      if (!M) continue;
      if (strategy === 'smart') smartLate = smartLate && M.at >= 12; else dumbEarly = dumbEarly && M.at < 11;
      const V = S.elevators.find(e => e.freight), w = watcher(), fam = S.people.filter(p => M.family.includes(p.id));
      assert(fam.length && M.items.length >= 5, `frö ${seed}: inget hushåll eller för litet bohag (${M.items.length})`);
      let bad = 0, sawIndep = false, leftEarly = 0;
      const was = new Map();
      while (!S.summaryShown && M.state !== 'done') {
        const b = w.before(); step(DT); w.check(b);
        if (V.indep) sawIndep = true;
        for (const p of S.people) {
          // ingen annan kliver på medan varuhissen är låst (de som redan var ombord åker klart)
          if (p.state === 'boarding' && was.get(p.id) !== 'boarding' && p.car === V && V.indep && !p.mover && !p.medic) bad++;
          was.set(p.id, p.state);
          if (p.movedOut && M.items.some(it => it.st === 'home' || it.st === 'packing')) leftEarly++;
        }
      }
      assert(sawIndep, `frö ${seed}: varuhissen gick aldrig i oberoende drift`);
      assert(M.state === 'done' && M.done === M.loads && M.truck === M.loads, `frö ${seed}: flytten blev inte klar (${M.done}/${M.truck}/${M.loads} lass)`);
      assert(bad === 0, `frö ${seed}: ${bad} andra klev på under oberoende drift`);
      assert(leftEarly === 0, `frö ${seed}: familjen gick innan lägenheten var tom`);
      assert(!V.indep, 'varuhissen blev kvar i oberoende drift');
      // familjen flyttar: när flytten är klar är de på väg ut (eller redan borta)
      run(120);
      const still = fam.filter(p => !p.dead && S.people.includes(p) && !p.movedOut);
      assert(!still.length, `frö ${seed}: ${still.map(p => p.name).join(', ')} flyttade aldrig`);
      lockShare[strategy].push(M.indepSec / (M.t1 - M.t0));
      pivots += M.pivots;
      if (strategy === 'smart') ok++;
    }
  }
  assert(ok >= 3, 'för få flyttdagar hittades');
  assert(smartLate && dumbEarly, 'bokningstiderna stämmer inte');
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  // (de enkla lägena låser varuhissen så länge bärarna jobbar – det sista kan gå med hissbalken)
  assert(avg(lockShare.smart) < 0.5 && avg(lockShare.nearest) > 0.75, `varuhissen låst: smart ${Math.round(avg(lockShare.smart) * 100)} %, närmast ${Math.round(avg(lockShare.nearest) * 100)} % av flytten`);
  assert(pivots > 0, 'ingen möbel fastnade någonsin i dörren');
  return `${ok} flyttdagar · varuhissen låst ${Math.round(avg(lockShare.smart) * 100)} % av flytten (smart) mot ${Math.round(avg(lockShare.nearest) * 100)} % (närmast) · ${pivots} pivoteringar`;
});
test('Hissbalken: pianot och kassaskåpet går ut genom lastluckan och ner med panoramahissen, putsaren parkerar och balken stannar i blåst', () => {
  let n = 0, hoisted = 0, windHeld = 0, cleanerWaited = 0;
  for (let seed = 80; seed < 140 && n < 3; seed++) {
    sim(seed);
    const M = S.move;
    if (!M || !M.hoist || !M.items.some(i => i.size === 'XL')) continue;
    n++;
    const V = S.elevators.find(e => e.freight), w = watcher();
    let xlInV = 0, stormed = false, lastY = null;
    while (!S.summaryShown && M.state !== 'done') {
      const b = w.before(); step(DT); w.check(b);
      for (const p of V.passengers) if (p.mover && p.item !== null && M.items[p.item].size === 'XL') xlInV++;
      if (S.hoist.phase !== 'idle' && S.cleaner.crew) cleanerWaited += DT;
      // en storm när lasten hänger ute: balken ska stå still
      // (spelaren väljer att vänta ut blåsten – annars bär Smart ner det som står vid luckan i varuhissen)
      if (!stormed && n === 1 && S.hoist.phase === 'lower') { stormed = true; act('moveWind', 'wait'); startStorm(); S.storm.t0 -= S.storm.len * 0.4; }
      if (S.hoist.halted === 'blåst') { if (lastY !== null && S.hoist.y !== lastY) windHeld = -1e9; else windHeld++; lastY = S.hoist.y; } else lastY = null;
    }
    assert(M.state === 'done' && M.truck === M.loads, `frö ${seed}: flytten blev inte klar (${M.truck}/${M.loads})`);
    const xl = M.items.filter(i => i.size === 'XL').length;
    const xlBalk = M.items.filter(i => i.size === 'XL' && i.via === 'balk').length;
    assert(xlBalk === xl && M.hoisted >= xl && xlInV === 0, `frö ${seed}: ${xlBalk} av ${xl} XL-möbler gick med hissbalken (${xlInV} steg i varuhissen)`);
    assert(w.railClash === 0 && w.liftPass === 0 && w.wrongDoor === 0, `frö ${seed}: regelbrott (skena ${w.railClash}, passagerare i lastläge ${w.liftPass}, dörr ${w.wrongDoor})`);
    hoisted += M.hoisted;
  }
  assert(n >= 2, 'för få flyttdagar med piano eller kassaskåp');
  assert(windHeld > 0, 'balken stannade aldrig i blåsten (eller rörde sig ändå)');
  assert(cleanerWaited > 0, 'putsaren behövde aldrig vänta på balken');
  return `${n} flyttdagar · ${hoisted} möbler med hissbalken · stod still i blåst ${Math.round(windHeld * DT)} s · putsaren väntade ${Math.round(cleanerWaited)} s`;
});
/** kör flytten på frö seed (med flyttdag även om slumpen inte gav någon) med spelarens val, till den är klar */
function runMove(seed, strategy, route, blankets, during) {
  sim(seed, { strategy });
  if (!S.move) forceMove();
  const M = S.move;
  act('moveRoute', route); act('moveBlankets', blankets);
  const w = watcher();
  let g = 0;
  while (!S.summaryShown && M.state !== 'done' && ++g < 40 * 3600) { const b = w.before(); step(DT); w.check(b); if (during) during(M); }
  assert(M.state === 'done' && M.truck === M.loads, `frö ${seed} ${route}: flytten blev inte klar (${M.truck}/${M.loads})`);
  assert(w.moveBad === 0 && w.passes === 0 && w.liftPass === 0 && w.railClash === 0, `frö ${seed} ${route}: regelbrott (lass ${w.moveBad}, förbi ${w.passes}, lastläge ${w.liftPass}, skena ${w.railClash})`);
  return M;
}
test('Flyttdag: spelarens val – allt i varuhissen, tungt utanpå eller planerat, med eller utan skyddsfiltar', () => {
  let lockVaru = 0, lockBalk = 0, scratches = 0, crewLate = 0;
  for (const seed of [200, 201, 202]) {
    const varu = runMove(seed, 'smart', 'varu', true);
    assert(varu.hoisted === 0 && varu.items.every(it => it.via === 'varu'), `frö ${seed}: allt i varuhissen – men ${varu.hoisted} gick med balken`);
    lockVaru += varu.indepSec;
    const balk = runMove(seed, 'smart', 'balk', true);
    assert(balk.items.every(it => (it.size === 'L' || it.size === 'XL') === (it.via === 'balk')), `frö ${seed}: tungt utanpå – fel väg för någon möbel`);
    lockBalk += balk.indepSec;
    crewLate += balk.crewAt - balk.t0 >= BLANKET_T - 1e-9 ? 1 : 0;
    const bare = runMove(seed, 'smart', 'auto', false);
    assert(bare.crewAt === bare.t0, 'utan skyddsfiltar ska bärarna börja direkt');
    // (reporna är slumpens sak: med allt i varuhissen går fler stora möbler genom dörren)
    scratches += bare.scratches + runMove(seed, 'smart', 'varu', false).scratches;
  }
  assert(lockBalk < lockVaru / 2, `med hissbalken var varuhissen låst ${Math.round(lockBalk)} s mot ${Math.round(lockVaru)} s i varuhissen`);
  assert(crewLate === 3, 'med skyddsfiltar började bärarna innan filtarna hängde uppe');
  assert(scratches > 0, 'inga repor i varuhissen utan skyddsfiltar');
  return `varuhissen låst ${Math.round(lockVaru)} s (allt i varuhissen) mot ${Math.round(lockBalk)} s (tungt utanpå) · ${scratches} repor utan filtar`;
});
test('Flyttdag: händelser – möbeln fastnar och tar balken, blåsten, varuhissen går sönder, något tappas, lastkajen är upptagen', () => {
  // en möbel som fastnar helt bärs tillbaka och tar hissbalken
  let stuck = 0, broken = 0;
  for (let seed = 200; seed < 230 && (!stuck || !broken); seed++) {
    const M = runMove(seed, 'nearest', 'auto', true);
    stuck += M.items.filter(it => it.pivoted && it.via === 'balk' && it.size === 'L').length > 0 && M.stuck ? 1 : 0;
    broken += M.broken;
  }
  assert(stuck > 0, 'ingen möbel fastnade helt och tog hissbalken');
  assert(broken > 0, 'inget tappades någonsin');
  // blåsten stoppar balken medan något står vid lastluckan: Smart bär ner det i varuhissen, de enkla lägena väntar
  const viaStorm = {};
  for (const strategy of ['smart', 'nearest']) {
    let stormed = false;
    const M = runMove(203, strategy, 'balk', true, M => {
      if (!stormed && M.items.some(it => it.st === 'hatch')) { stormed = true; startStorm(); S.storm.t0 -= S.storm.len * 0.4; S.storm.peak = 1; }
    });
    viaStorm[strategy] = M.items.filter(it => it.forceV).length;
  }
  assert(viaStorm.smart > 0 && viaStorm.nearest === 0, `blåsten: smart bar ner ${viaStorm.smart}, närmast ${viaStorm.nearest} i varuhissen`);
  // varuhissen går sönder när flytten börjar: allt som går tar hissbalken medan den är trasig
  // (hur mycket som hinner ta balken beror på hur snabbt teknikern lagar varuhissen – därför flera frön)
  let broke = false, MB = null;
  for (let seed = 204; seed < 214 && !(broke && MB.hoisted >= 2); seed++) {
    broke = false;
    MB = runMove(seed, 'smart', 'auto', false, M => {
      const V = S.elevators.find(e => e.freight);
      if (!broke && M.state === 'on' && V.mode === 'normal' && V.state !== 'moving' && !V.passengers.length) { broke = true; breakDown(V, 'styrkortet hänger sig'); }
    });
  }
  assert(broke && MB.hoisted >= 2, `varuhissen gick sönder men bara ${MB.hoisted} lass tog balken`);
  // de enkla lägena bokar flytten mitt i leveranserna: flyttbilen får vänta på gatan
  sim(205, { strategy: 'nearest' }); if (!S.move) forceMove();
  runUntil(S.move.at + 0.3);
  assert(S.move.dockWait > 0 || S.move.state === 'on', 'flyttbilen borde ha väntat på leveransbilen');
  const dock = S.move.dockWait;
  return `fastnade och tog balken · ${broken} tappade · i blåsten bar smart ner ${viaStorm.smart} · trasig varuhiss: ${MB.hoisted} lass med balken · flyttbilen väntade ${dock.toFixed(1)} s`;
});
test('Ambulans: personalen får varuhissen med förtur och bär ut patienten på bår', () => {
  const resp = {};
  for (const strategy of ['smart', 'nearest']) {
    sim(77, { strategy }); runUntil(10.5);
    assert(act('trigger', 'medical') !== null || S.medic, 'ingen svimmade');
    const A = S.medic, w = watcher();
    let mixed = 0, crewOther = 0;
    const wasState = new Map();
    while (A.state !== 'done' && !S.summaryShown) {
      const b = w.before(); step(DT); w.check(b);
      for (const p of S.people) if (p.medic && p.state === 'ride' && !p.car.freight) crewOther++;
      // ingen annan får kliva på varuhissen medan den är låst för ambulansen (mellan personalens delresor
      // släpps låset en stund, och då får t.ex. ett bud åka med – sådana kliver av vid nästa stopp)
      const V = S.elevators.find(e => e.freight);
      for (const p of S.people) {
        if (p.state === 'boarding' && p.car === V && wasState.get(p.id) !== 'boarding' && V.vipLock && !p.medic && !p.mover) mixed++;
        wasState.set(p.id, p.state);
      }
    }
    assert(A.state === 'done' && A.taken, `${strategy}: patienten bars aldrig ut`);
    assert(crewOther === 0, `${strategy}: ambulanspersonalen åkte annat än varuhissen`);
    assert(mixed === 0, `${strategy}: andra klev på varuhissen under förturen`);
    assert(!S.people.some(p => p.id === A.pid), 'patienten är kvar i huset');
    assert(w.passes === 0, 'förbiåkning när passagerare fick kliva av');
    resp[strategy] = Math.round(A.t1 - A.t0);
  }
  return `larm till avfärd: smart ${resp.smart} s · närmast ${resp.nearest} s`;
});
test('Ambulans: hissen står kvar på patientens våning och väntar på personalen och båren', () => {
  const out = [];
  for (const strategy of ['smart', 'nearest', 'buttons']) {
    sim(77, { strategy }); runUntil(10.5);
    act('trigger', 'medical');
    const A = S.medic, w = watcher();
    let held = null, heldT = 0, moved = 0, others = 0, backIn = null;
    while (A.state !== 'done' && !S.summaryShown) {
      const b = w.before(); step(DT); w.check(b);
      if (A.car !== null && !held) held = S.elevators[A.car];
      if (held && held.medicHold) {
        heldT += DT;
        if (held.state === 'moving' || Math.abs(held.pos - posOf(held, A.floor)) > 1e-6) moved++;
        if (held.passengers.some(p => !p.medic) || S.people.some(p => p.state === 'boarding' && p.car === held && !p.medic)) others++;
      }
      const bearer = S.people.find(p => p.medic && p.cargo && p.cargo.kind === 'bårP' && p.state === 'ride');
      if (bearer && !backIn) backIn = bearer.car;
    }
    assert(held, `${strategy}: ingen hiss väntade på ambulanspersonalen`);
    assert(heldT > 1, `${strategy}: hissen väntade bara ${heldT.toFixed(1)} s`);
    assert(moved === 0, `${strategy}: den väntande hissen lämnade våningen (${moved} steg)`);
    assert(others === 0, `${strategy}: andra klev på den väntande hissen`);
    assert(backIn === held, `${strategy}: båren åkte ner i ${backIn ? backIn.name : 'ingen hiss'}, inte i ${held.name} som väntade`);
    assert(!held.medicHold && A.car === null, `${strategy}: hissen släpptes aldrig`);
    out.push(`${strategy} ${held.name} väntade ${heldT.toFixed(0)} s`);
  }
  return out.join(' · ');
});
test('Ambulans vid strömavbrott: personalen bär båren i trapporna och räddas först med reservkraft', () => {
  // del 1: strömmen går när ambulansen är larmad – personalen väntar inte på hissar som står still
  sim(77); runUntil(10.5);
  assert(act('trigger', 'medical') !== null || S.medic, 'ingen svimmade');
  const A = S.medic, w = watcher();
  startOutage(); S.outage.backAt = S.t + 400;
  let maxWait = 0, stairs = 0;
  const seen = new Set();
  while (A.state !== 'done' && !S.summaryShown && !S.power) {
    const b = w.before(); step(DT); w.check(b);
    for (const p of S.people) if (p.medic) {
      if (p.state === 'wait') maxWait = Math.max(maxWait, S.t - p.waitStart);
      if (p.state === 'instairs' && !seen.has(p)) { seen.add(p); stairs++; }
      if (p.state !== 'instairs') seen.delete(p);
    }
  }
  assert(!S.power, 'strömmen kom tillbaka – testet mäter fel sak');
  assert(A.state === 'done' && A.taken, 'patienten bars aldrig ut under strömavbrottet');
  assert(maxWait < 0.5, `personalen väntade ${maxWait.toFixed(1)} s på hissar utan ström`);
  assert(stairs >= 4, `bara ${stairs} trappresor (två upp, två ner väntat)`);
  const t1 = Math.round(A.t1 - A.t0);

  // del 2: personalen sitter fast i varuhissen – auto-räddningen tar den hissen först
  sim(77); runUntil(10.5);
  act('trigger', 'medical');
  const V = S.elevators.find(e => e.freight);
  let guard = 0;
  while (!(V.state === 'moving' && V.passengers.some(p => p.medic)) && guard++ < 30 * 300) step(DT);
  assert(V.passengers.some(p => p.medic), 'personalen kom aldrig in i varuhissen');
  // en annan hiss med fler instängda, så att "fullaste först" skulle ha valt den
  startOutage(); S.outage.backAt = S.t + 400;
  startGenerator(); run(6); toggleAutoRescue(true); step(DT);
  assert(S.outage.busy === V.id, `auto-räddningen tog ${S.outage.busy === null ? 'ingen hiss' : S.elevators[S.outage.busy].name} före varuhissen`);
  return `larm till avfärd i mörker: ${t1} s · ${stairs} trappresor · varuhissen räddades först`;
});
test('Flyttdag vid strömavbrott: möblerna bärs inte i trapporna, tomhänta går', () => {
  let seed = 80;
  while (seed < 120) { sim(seed); if (S.move) break; seed++; }
  assert(S.move, 'ingen flyttdag hittades');
  const M = S.move, w = watcher();
  // vänta tills en flyttgubbe står med en möbel och väntar på hissen
  let g = 0;
  while (!S.people.some(p => p.mover && p.state === 'wait' && p.cargo.kg >= 22) && g++ < 30 * 3600) step(DT);
  assert(M.state === 'on', 'flytten kom aldrig igång');
  startOutage();
  let heavyStairs = 0, lightStairs = 0, waitedDark = 0;
  while (!S.power) {
    const b = w.before(); step(DT); w.check(b);
    for (const p of S.people) if (p.mover) {
      if (p.state === 'stairs' && p.cargo.kg >= 15) heavyStairs++;
      if (p.state === 'stairs' && p.cargo.kg < 15) lightStairs++;
      if (p.state === 'wait' && p.cargo.kg >= 22) waitedDark = Math.max(waitedDark, S.t - p.waitStart);
    }
  }
  assert(heavyStairs === 0, 'en flyttgubbe bar en möbel i trapporna');
  assert(waitedDark > 20, `möbeln väntade bara ${waitedDark.toFixed(0)} s – avbrottet borde märkas`);
  while (M.state !== 'done' && !S.summaryShown) { const b = w.before(); step(DT); w.check(b); }
  assert(M.state === 'done' && M.done === M.loads, `flytten blev inte klar (${M.done}/${M.loads})`);
  return `frö ${seed} · möbeln väntade ${Math.round(waitedDark)} s i mörkret · ${lightStairs ? 'tomhänt gick i trappan' : 'ingen tomhänt behövde trappan'}`;
});
test('Flyttdag vid brand: flyttgubbarna utryms, kommer tillbaka efter branden och gör klart flytten', () => {
  let seed = 80;
  while (seed < 120) { sim(seed); if (S.move) break; seed++; }
  assert(S.move, 'ingen flyttdag hittades');
  const M = S.move, w = watcher();
  let g = 0;
  while (M.done < 2 && g++ < 30 * 3600) { const b = w.before(); step(DT); w.check(b); }
  assert(M.state === 'on' && M.done >= 2, 'flytten kom aldrig igång');
  startFire(M.floor);
  while (S.fire) { const b = w.before(); step(DT); w.check(b); }
  const back = () => S.people.filter(p => p.mover && !p.loader).length;
  g = 0;
  while (M.state !== 'done' && !S.summaryShown && g++ < 30 * 3600) { const b = w.before(); step(DT); w.check(b); }
  assert(M.state === 'done' && M.truck === M.loads, `flytten blev inte klar efter branden (${M.truck}/${M.loads} i bilen, ${back()} bärare)`);
  assert(!S.elevators.find(e => e.freight).indep, 'varuhissen blev kvar i oberoende drift');
  return `frö ${seed} · branden på ${fl(M.floor)} · ${M.loads} lass klara ${Math.round(M.t1 - M.t0)} s efter starten`;
});
test('Lärande parkering: minnet byggs upp och följer med till nästa dygn', () => {
  sim(78);
  assert(S.learnMem === null, 'minne redan dag 1');
  runDay();
  const today = S.learnToday.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
  assert(today > 200, `bara ${today} anrop räknades`);
  S.day++; resetDay();
  assert(S.learnMem && S.learnMem[learnBin(8)][LOBBY] > 5, 'minnet säger inte att det brukar bli kö i entrén på morgonen');
  runUntil(15);
  assert(S.stats.learnedParks > 0, 'Smart parkerade aldrig efter det inlärda');
  sim(78, { strategy: 'nearest' }); runDay(); S.day++; resetDay(); runUntil(15);
  assert(S.stats.learnedParks === 0, 'Närmast parkerade efter det inlärda');
  return `${today} anrop dag 1`;
});
test('Dubbeldäck: däcken stannar samtidigt en våning isär, folk åker rätt däck och rulltrappan går till mellanplanet', () => {
  const X = EL.filter(d => d.deck2);
  assert(X.length === 2 && X.every(d => d.upper.every((f, i) => f === d.stops[i] + 1)), 'dubbeldäcken saknas i huset');
  assert(MEZZ === LOBBY + 1, 'mellanplanet ska vara våningen över entrén');
  let upper = 0, esc = 0, wrongDeck = 0;
  for (const strategy of ['smart', 'buttons', 'nearest']) {
    sim(79, { strategy }); const w = watcher();
    while (hour() < 13) {
      const b = w.before(); step(DT); w.check(b);
      for (const e of S.elevators) if (e.deck2) for (const p of e.passengers) if ((p.deck === 1) !== e.upper.has(p.dest)) wrongDeck++;
    }
    assert(w.passes === 0 && w.wrongDoor === 0 && w.badLeg === 0 && w.outOfRange === 0, `${strategy}: invariant bröts (${w.passes} förbi, ${w.wrongDoor} fel dörr, ${w.badLeg} fel delresa)`);
    upper += S.stats.upperDeck; esc += S.stats.escalator;
  }
  assert(wrongDeck === 0, `${wrongDeck} passagerare på fel däck för sitt mål`);
  assert(upper > 10 && esc > 10, `övre däcket ${upper} resor, rulltrappan ${esc}`);
  return `övre däcket ${upper} resor · rulltrappan ${esc} gånger (tre styrlogiker till 13:00)`;
});

// ---------- Tunnelbanan ----------
test('Tunnelbanan: tåget lämnar av folk i klump, tar med dem hem och slutar gå efter sista tåget', () => {
  sim(101);
  const w = watcher();
  let biggest = 0, lateOff = 0, offInFire = 0, onTrainOutside = 0;
  const prevIn = { n: 0 };
  while (!S.summaryShown) {
    const b = w.before(); step(DT); w.check(b);
    const T = S.train;
    if (T && T.state === 'stop') biggest = Math.max(biggest, T.n);
    if (S.stats.trainIn > prevIn.n) {
      if (hour() >= LAST_H) lateOff++;
      if (S.fire) offInFire++;
      prevIn.n = S.stats.trainIn;
    }
    // de som väntar på perrongen står framför tåget
    for (const p of S.people) if (p.state === 'platform' && (p.x < TRAIN_X0 || p.x > TRAIN_X1)) onTrainOutside++;
  }
  const st = S.stats;
  assert(st.trains >= 10, `bara ${st.trains} tåg på ett dygn`);
  assert(st.trainIn > 20 && st.trainOut > 10, `${st.trainIn} klev av och ${st.trainOut} på`);
  assert(biggest >= 5, `som mest ${biggest} av samma tåg – ingen klump`);
  assert(lateOff === 0 && offInFire === 0, `folk klev av efter sista tåget (${lateOff}) eller under brand (${offInFire})`);
  assert(onTrainOutside === 0, 'någon väntade på tåget utanför perrongen');
  assert(w.badPlatform === 0 && w.passes === 0 && w.badLeg === 0 && w.wrongDoor === 0, `invariant bröts: perrong ${w.badPlatform}, förbi ${w.passes}, fel delresa ${w.badLeg}, fel dörr ${w.wrongDoor}`);
  assert(!S.people.some(p => p.exitFloor === STATION), 'någon tänker fortfarande ta tåget efter sista tåget');
  // stationsexpressen går hela vägen ner, den andra expressen och höga zonen gör det inte
  const X1 = S.elevators.find(e => e.stops.has(STATION) && e.express);
  assert(X1 && S.elevators.filter(e => e.express && e !== X1).every(e => !e.serves.has(STATION)), 'stationsexpressen saknas');
  return `${st.trains} tåg · ${st.trainIn} klev av (som mest ${biggest} på en gång) · ${st.trainOut} tog tåget hem`;
});
test('Tunnelbanan: efter sista tåget går de som tänkte ta tåget ut genom entrén', () => {
  sim(103);
  runUntil(LAST_H - 0.3);
  // en sen arbetare som just ska gå hem med tåget
  const p = S.people.find(q => q.kind === 'emp' && q.exitFloor === STATION && q.state === 'office');
  if (p) { p.leaveAt = hour(); p.timer = 0; } // går nu – resan ner tar längre tid än det är kvar till sista tåget
  const w = watcher();
  while (hour() < LAST_H + 1.5) { const b = w.before(); step(DT); w.check(b); }
  assert(S.trainDone, 'sista tåget registrerades aldrig');
  assert(!S.people.some(q => q.state === 'platform'), 'någon står kvar på perrongen efter sista tåget');
  assert(!S.people.some(q => q.exitFloor === STATION), 'någon ska fortfarande ut via stationen');
  assert(w.badPlatform === 0, `fel på perrongen ${w.badPlatform} steg`);
  if (!p) return 'ingen sen tågresenär just då';
  const missed = p.hist.some(h => /Sista tåget har gått|Inga fler tåg/.test(h.text)), caught = p.hist.some(h => /Kliver på tåget/.test(h.text));
  return `${p.name}: ${caught ? 'hann med sista tåget' : missed ? 'missade sista tåget och går ut genom entrén' : 'var fortfarande kvar på jobbet'}`;
});

// ---------- Regression: fingeravtryck mot facit ----------
// Varje fall kör ett helt dygn och sammanfattar det. Facit ligger i tests/golden.json.
// Ändras beteendet oavsiktligt (t.ex. vid en omstrukturering) larmar testet och visar exakt vad som skilde.
// Avsiktliga ändringar godkänns med:  npm run golden
export const GOLDEN_CASES = [
  ...[101, 102, 103, 104, 105, 106, 107, 108].map(seed => ({ seed, strategy: 'smart' })),
  { seed: 201, strategy: 'nearest' }, { seed: 202, strategy: 'nearest' },
  { seed: 301, strategy: 'random' }, { seed: 302, strategy: 'random' },
  { seed: 401, strategy: 'peak' }, { seed: 501, strategy: 'eco' }, { seed: 601, strategy: 'buttons' },
];
export const caseKey = c => `${c.strategy}-${c.seed}`;
export function dayFingerprint(c) {
  sim(c.seed, { strategy: c.strategy, autoInc: true });
  runDay();
  const st = S.stats;
  return {
    resor: st.served, väntSumma: +st.waitSum.toFixed(3), längstaVäntan: +st.waitMax.toFixed(3), arga: st.angry,
    incidenter: st.incidents, rök: st.smoked, instängdSek: +st.trappedSec.toFixed(2),
    överlaster: st.overloads, trappresor: st.stairs, utrymda: st.evacuated,
    hissfel: st.faults, servade: st.serviced, energi: +st.energy.toFixed(4),
    loggrader: S.log.length, personer: S.nextId - 1, kvar: S.people.length,
    hissar: S.elevators.map(e => `${e.name}@${e.pos.toFixed(4)}:${e.trips}stopp:${e.distance.toFixed(2)}vån`).join(' '),
  };
}
let golden = null;
export function setGolden(g) { golden = g; }
test('Regression: samma frön ger samma dygn som facit', () => {
  if (!golden) throw new Fail('facit saknas (tests/golden.json) – skapa det med:  npm run golden');
  const diffs = [];
  for (const c of GOLDEN_CASES) {
    const key = caseKey(c), want = golden[key], got = dayFingerprint(c);
    if (!want) { diffs.push(`${key}: saknas i facit`); continue; }
    for (const k of Object.keys(got)) if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) diffs.push(`${key} ${k}: ${want[k]} → ${got[k]}`);
  }
  assert(diffs.length === 0, `${diffs.length} skillnader mot facit:\n  ${diffs.slice(0, 12).join('\n  ')}${diffs.length > 12 ? '\n  …' : ''}\n(avsiktlig ändring? godkänn med: npm run golden)`);
  return `${GOLDEN_CASES.length} dygn identiska med facit`;
});

// ---------- Invarianter över många frön ----------
/** de nyare invarianterna (hopp, service utan tekniker, reserverade platser, väntan bredvid ledig hiss) */
function newInvariantFails(w, tag) {
  const f = [];
  if (w.jumps) f.push(`${tag}: en hiss hoppade ${w.jumps} gånger (mer än VMAX·DT på ett steg)`);
  if (w.orphanService) f.push(`${tag}: hiss på service utan tekniker i ${w.orphanService} steg`);
  if (w.techClash) f.push(`${tag}: två tekniker på samma hiss (eller fler än en extra) i ${w.techClash} steg`);
  if (w.liftPass) f.push(`${tag}: panoramahissen tog passagerare i lastläge ${w.liftPass} steg`);
  if (w.railClash) f.push(`${tag}: last i hissbalken medan putsaren var nere ${w.railClash} steg`);
  if (w.moveBad) f.push(`${tag}: ett flyttlass var på två ställen (eller inget) ${w.moveBad} steg`);
  if (w.badReserved) f.push(`${tag}: e.reserved stämde inte med de som kliver på (${w.badReserved} steg)`);
  if (w.dupNames) f.push(`${tag}: två personer i huset hette samma sak (${w.dupNames} gånger, t.ex. ${w.dupEx})`);
  if (w.deadAssignMax > 0.5) f.push(`${tag}: någon väntade ${w.deadAssignMax.toFixed(1)} s på en hiss som inte kunde komma (${w.deadAssignEx})`);
  if (w.idleWaitMax > 15) f.push(`${tag}: någon stod ${w.idleWaitMax.toFixed(0)} s utan tilldelad hiss medan en ledig hiss som kunde ta hen stod still`);
  if (w.flips) f.push(`${tag}: en korg bytte riktning i fart ${w.flips} gånger`);
  if (w.intoFire) f.push(`${tag}: ${w.intoFire} gick trappan in i brandzonen`);
  if (w.techLostMax > 60) f.push(`${tag}: en tekniker stod ${w.techLostMax.toFixed(0)} s på fel våning med ett jobb`);
  return f;
}
// Sällsynta fel visar sig bara med vissa frön – därför körs många hela dygn med slumpade incidenter.
const MANY_SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i);
test(`Invarianter över ${MANY_SEEDS.length} slumpade dygn (alla strategier, med incidenter)`, () => {
  const strategies = ['smart', 'peak', 'eco', 'nearest', 'random', 'buttons', 'smart', 'buttons'];
  const fails = [];
  let trips = 0, incidents = 0, worstWait = 0, heaviest = 0;
  for (const [i, seed] of MANY_SEEDS.entries()) {
    const strategy = strategies[i % strategies.length];
    sim(seed, { strategy, autoInc: true, chief: i % 2 === 0 });
    const w = watcher();
    try { runDay(w); } catch (e) { fails.push(`frö ${seed} (${strategy}): kraschade – ${e.message}`); continue; }
    const tag = `frö ${seed} (${strategy})`;
    if (w.passes) fails.push(`${tag}: ${w.passes} förbiåkningar`);
    if (w.overweight) fails.push(`${tag}: körde överlastad ${w.overweight} gånger`);
    if (w.bypassBroken) fails.push(`${tag}: full last stannade för hämtning ${w.bypassBroken} gånger`);
    if (w.maxWait > 400) fails.push(`${tag}: någon väntade ${w.maxWait.toFixed(0)} s`);
    if (visitors() > 25) fails.push(`${tag}: ${visitors()} kvar i huset på morgonen`);
    if (w.outOfRange || w.wrongDoor) fails.push(`${tag}: hiss utanför zon ${w.outOfRange} / dörr där det saknas ${w.wrongDoor}`);
    if (w.badLeg) fails.push(`${tag}: ${w.badLeg} åkte fel hiss för sitt delmål`);
    if (w.badFreight) fails.push(`${tag}: ${w.badFreight} fel last i fel hiss`);
    if (w.vipMixed) fails.push(`${tag}: ${w.vipMixed} klev på VIP-hissen`);
    if (w.brokenUse) fails.push(`${tag}: trasig hiss/service användes ${w.brokenUse} steg`);
    if (w.snapUse) fails.push(`${tag}: hiss med linbrott rörde sig eller tog folk ${w.snapUse} steg`);
    if (w.holdBoard) fails.push(`${tag}: hiss på väg till service tog nya passagerare ${w.holdBoard} gånger`);
    if (S.elevators.some(e => e.mode === 'broken' && S.t - e.fault.t0 > 400)) fails.push(`${tag}: en hiss stod trasig i över 400 s`);
    if (w.selfDest) fails.push(`${tag}: någon väntade på hiss till sin egen våning (${w.selfDest} steg)`);
    fails.push(...newInvariantFails(w, tag));
    trips += S.stats.served; incidents += S.stats.incidents;
    worstWait = Math.max(worstWait, w.maxWait); heaviest = Math.max(heaviest, w.maxKg);
  }
  assert(fails.length === 0, `${fails.length} fel:\n  ${fails.slice(0, 10).join('\n  ')}`);
  return `${trips} resor och ${incidents} incidenter utan fel · längsta väntan ${worstWait.toFixed(0)} s · tyngsta avgång ${Math.round(heaviest)} kg`;
});

// ---------- Spelarens åtgärder i slumpad ordning ----------
// Spelaren kan göra saker som de automatiska incidenterna aldrig gör: byta brandläge mitt i en brand,
// starta brand på natten, stänga av hissar, nödsänka … Åtgärderna slumpas med en egen generator
// (simuleringens slump rörs inte), och samma invarianter kontrolleras varje steg.
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Allt går via act() som gränssnittet.
export const PLAYER_ACTIONS = {
  fire: () => act('trigger', 'fire'),
  fireMode: r => act('fireMode', ['recall', 'zone', 'none'][Math.floor(r() * 3)]),
  outage: () => act('trigger', 'power'),
  generator: () => act('generator'),
  autoRescue: () => act('autoRescue'),
  rescue: () => { const e = S.elevators.find(canRescue); if (e) act('rescue', e.id); },
  off: r => act('carOff', Math.floor(r() * S.elevators.length)),
  fault: () => act('trigger', 'fault'),
  bus: () => act('bus'),
  visitor: r => act('visitor', OFFICE_FLOORS[Math.floor(r() * OFFICE_FLOORS.length)], 200 + r() * 200),
  strategy: r => act('strategy', ['smart', 'peak', 'eco', 'nearest', 'random', 'buttons'][Math.floor(r() * 6)]),
  setting: r => (r() < 0.5 ? act('setting', 'mistakes', ['av', 'lite', 'mycket'][Math.floor(r() * 3)]) : act('setting', 'maint', r() < 0.5 ? 'natt' : 'fel')),
  storm: () => act('trigger', 'storm'),
  stormMode: r => act('stormMode', r() < 0.5 ? 'sway' : 'none'),
  heat: () => act('trigger', 'heat'),
  fan: r => act('fan', Math.floor(r() * S.elevators.length)),
  service: r => act('service', Math.floor(r() * S.elevators.length)),
  medical: () => act('trigger', 'medical'),
  cable: () => act('trigger', 'cable'),
  pano: () => act('trigger', 'pano'),
  panoRescue: r => act('panoRescue', r() < 0.5 ? 'rope' : 'ladder'),
  moveRoute: r => act('moveRoute', ['auto', 'varu', 'balk'][Math.floor(r() * 3)]),
  moveBlankets: r => act('moveBlankets', r() < 0.5),
  moveWind: r => act('moveWind', r() < 0.5 ? 'wait' : 'varu'),
  // framkalla händelser (även på en viss våning eller hiss), slumpen och driftchefen
  trigger: r => act('trigger', ['move', 'lightning', 'cold', 'heatwave', 'train', 'vip'][Math.floor(r() * 6)]),
  fireAt: r => act('trigger', 'fire', FIRE_FLOORS[Math.floor(r() * FIRE_FLOORS.length)]),
  carTrigger: r => act('trigger', ['fault', 'heat', 'cable'][Math.floor(r() * 3)], Math.floor(r() * S.elevators.length)),
  incLevel: r => act('incLevel', ['av', 'lugn', 'normal', 'kaos'][Math.floor(r() * 4)]),
  chief: r => act('chief', r() < 0.7),
  chiefBack: r => act('chiefBack', ['storm', 'fire', 'power', 'strategy', 'move', 'pano', `heat${Math.floor(r() * S.elevators.length)}`][Math.floor(r() * 7)]),
};
const FUZZ_SEEDS = Array.from({ length: 24 }, (_, i) => 5000 + i);
test(`Spelaråtgärder: invarianter över ${FUZZ_SEEDS.length} dygn med slumpade åtgärder (även på natten)`, () => {
  const strategies = ['smart', 'buttons', 'peak', 'eco', 'nearest', 'random'];
  const names = Object.keys(PLAYER_ACTIONS), fails = [];
  let actions = 0;
  for (const [i, seed] of FUZZ_SEEDS.entries()) {
    const strategy = strategies[i % strategies.length], tag = `frö ${seed} (${strategy})`;
    sim(seed, { strategy, autoInc: i % 2 === 0, maint: 'natt', chief: i % 3 !== 2 });
    const r = mulberry(seed * 7919), w = watcher();
    let next = 5 + r() * 20, guard = 0, did = [];
    try {
      while (!S.summaryShown) {
        if (S.t >= next) {
          // under en brand byts läget ofta (även mitt i en återkallning), annars en slumpad åtgärd
          const a = S.fire && r() < 0.6 ? 'fireMode' : names[Math.floor(r() * names.length)];
          PLAYER_ACTIONS[a](r); did.push(a); actions++;
          next = S.t + 2 + r() * (S.fire || S.outage ? 6 : 25);
        }
        const b = w.before(); step(DT); w.check(b);
        if (++guard > 200000) throw new Fail('dagen tog aldrig slut');
      }
    } catch (e) { fails.push(`${tag}: kraschade – ${e.message} (efter ${did.slice(-5).join(', ')})`); continue; }
    if (w.passes) fails.push(`${tag}: ${w.passes} förbiåkningar`);
    if (w.overweight) fails.push(`${tag}: körde överlastad ${w.overweight} gånger`);
    if (w.outOfRange || w.wrongDoor) fails.push(`${tag}: hiss utanför zon ${w.outOfRange} / dörr där det saknas ${w.wrongDoor}`);
    if (w.badLeg) fails.push(`${tag}: ${w.badLeg} åkte fel hiss för sitt delmål`);
    if (w.badFreight) fails.push(`${tag}: ${w.badFreight} fel last i fel hiss`);
    if (w.badPlatform) fails.push(`${tag}: fel på perrongen ${w.badPlatform} steg`);
    if (w.brokenUse) fails.push(`${tag}: trasig hiss/service användes ${w.brokenUse} steg`);
    if (w.snapUse) fails.push(`${tag}: hiss med linbrott rörde sig eller tog folk ${w.snapUse} steg`);
    if (w.selfDest) fails.push(`${tag}: någon väntade på hiss till sin egen våning (${w.selfDest} steg)`);
    // (en brand eller ett strömavbrott som fortfarande pågår när dygnet slutar låser hissarna med rätta)
    // (en service som teknikern utför eller är på väg till när dygnet tar slut är inte fast)
    const working = e => !!techOf(e);
    const stuckMode = e => (e.mode === 'service' && !working(e)) || (!S.fire && (e.mode === 'recall' || e.mode === 'locked')) || (!S.outage && (e.mode === 'rescue' || e.mode === 'dead'));
    if (S.elevators.some(stuckMode))
      fails.push(`${tag}: hiss kvar i läge ${S.elevators.filter(stuckMode).map(e => `${e.name}:${e.mode}`).join(' ')} när dygnet tog slut`);
    fails.push(...newInvariantFails(w, tag));
  }
  assert(fails.length === 0, `${fails.length} fel:\n  ${fails.slice(0, 12).join('\n  ')}`);
  return `${actions} spelaråtgärder över ${FUZZ_SEEDS.length} dygn utan fel`;
});

// ---------- Driftchefen: huset sköter sig självt ----------
/** kör tills villkoret är sant (eller max sekunder) */
function runWhile(cond, maxS, w) { const t0 = S.t; while (cond() && S.t - t0 < maxS && !S.summaryShown) { const b = w && w.before(); step(DT); if (w) w.check(b); } }
const chiefDecs = () => S.chief.log.filter(d => !d.info);
test('Driftchefen: svajläge när det blåser upp, normal drift när det mojnar – inga vajerlarm', () => {
  const out = [];
  for (const seed of [11, 12, 13]) {
    sim(seed, { chief: true }); runUntil(10);
    act('trigger', 'storm');
    assert(S.storm, 'ingen storm');
    const St = S.storm;
    runWhile(() => !!S.storm, 120);
    const ds = chiefDecs().filter(d => d.key === 'storm').map(d => d.text);
    assert(ds.includes('Svajläge'), `frö ${seed}: chefen valde aldrig svajläge (${ds.join(', ')})`);
    assert(St.faults === 0, `frö ${seed}: ${St.faults} vajerlarm trots chefen`);
    const sway = chiefDecs().find(d => d.text === 'Svajläge');
    assert(sway && sway.outcome && sway.outcome.includes('Stormen varade'), `frö ${seed}: beslutet fick ingen efterspelstext (${sway && sway.outcome})`);
    out.push(ds.join(' → '));
  }
  return out.join(' · ');
});
test('Driftchefen: spelaren tar över ett beslut, och lämnar tillbaka det', () => {
  sim(14, { chief: true }); runUntil(10);
  act('trigger', 'storm');
  runWhile(() => S.storm && S.storm.mode !== 'sway', 60);
  assert(S.storm && S.storm.mode === 'sway', 'chefen valde inte svajläge');
  act('stormMode', 'none');
  assert(S.chief.manual.storm && S.chief.dec.storm.by === 'player', 'spelarens val registrerades inte');
  runWhile(() => !!S.storm && windAt() > 0.5, 20);
  assert(!S.storm || S.storm.mode === 'none', 'chefen ändrade spelarens val');
  act('chiefBack', 'storm');
  assert(!S.chief.manual.storm, 'beslutet lämnades inte tillbaka');
  runWhile(() => !!S.storm && S.storm.mode === 'none' && windAt() > 0.5, 5);
  const back = !S.storm || windAt() <= 0.5 || S.storm.mode === 'sway';
  assert(back, 'chefen tog inte tillbaka beslutet');
  runWhile(() => !!S.storm, 120);
  assert(!S.chief.manual.storm && !S.chief.dec.storm, 'beslutet om stormen ligger kvar när stormen är över');
  return `${chiefDecs().length} beslut av chefen · ${S.chief.log.filter(d => d.by === 'player').length} av spelaren`;
});
test('Driftchefen: strömavbrott – reservkraften och auto-räddningen startar av sig själva', () => {
  sim(15, { chief: true }); runUntil(10.2);
  startOutage();
  const O = S.outage, trapped = S.elevators.reduce((a, e) => a + e.passengers.length, 0);
  runWhile(() => !!S.outage && !(S.outage.gen && S.outage.auto), 20);
  assert(trapped === 0 || (O.gen && O.auto), `reservkraften (${O.gen}) eller auto-räddningen (${O.auto}) startade inte (${trapped} instängda)`);
  const w = watcher();
  runWhile(() => !!S.outage, 80, w);
  assert(O.rescued > 0 || trapped === 0, 'ingen hiss nödsänktes');
  return `${trapped} instängda · ${O.rescued} hissar nödsänkta · längst instängd ${Math.round(w.maxTrap)} s`;
});
test('Driftchefen: brand högt upp → brandzon, brand lågt → alla hissar återkallas', () => {
  sim(16, { chief: true }); runUntil(10.5);
  const hi = Math.max(...FIRE_FLOORS.filter(f => f - 2 - LOBBY >= 3));
  startFire(hi);
  runWhile(() => !S.chief.dec.fire, 10);
  assert(S.fire.mode === 'zone', `brand på ${fl(hi)}: läget blev ${S.fire.mode}`);
  endFire(); step(DT);
  const lo = FIRE_FLOORS[0];
  startFire(lo);
  runWhile(() => !S.chief.dec.fire, 10);
  assert(S.fire.mode === 'recall', `brand på ${fl(lo)}: läget blev ${S.fire.mode}`);
  return `${fl(hi)}: zon · ${fl(lo)}: återkallning`;
});
test('Driftchefen: extrafläkten startar när en motor blir överhettad; med chefen på rast händer inget', () => {
  sim(17, { chief: true }); runUntil(9);
  const e = S.elevators.find(x => x.mode === 'normal' && !x.facade);
  act('trigger', 'heat', e.id);
  runWhile(() => !e.hot, 5); step(DT); step(DT);
  assert(e.fan, 'fläkten startade inte');
  sim(17, { chief: false }); runUntil(9);
  const e2 = S.elevators[e.id];
  act('trigger', 'heat', e2.id); act('trigger', 'storm'); startOutage();
  for (let i = 0; i < 20 / DT; i++) step(DT);
  assert(!e2.fan && S.storm.mode === 'none' && S.outage.genAt === null, 'något startade av sig självt med chefen på rast');
  assert(S.chief.log.length === 0, `chefen fattade ${S.chief.log.length} beslut på rasten`);
  return `${e.name}: fläkten på direkt · på rast: inget`;
});
test('Slumpen: Av ger inga incidenter, Kaos fler än Normalt; byte mitt på dagen slumpar om resten', () => {
  const plan = lv => { let n = 0; for (let s = 0; s < 20; s++) { sim(300 + s, { incLevel: lv }); n += S.incPlan.length; } return n / 20; };
  const av = plan('av'), lugn = plan('lugn'), normal = plan('normal'), kaos = plan('kaos');
  assert(av === 0 && lugn < normal && normal < kaos, `incidenter per dygn: av ${av}, lugnt ${lugn}, normalt ${normal}, kaos ${kaos}`);
  sim(320, { incLevel: 'av' });
  runDay();
  assert(S.stats.incidents === 0, `${S.stats.incidents} incidenter med slumpen av`);
  sim(321, { incLevel: 'normal' }); runUntil(13);
  act('incLevel', 'kaos');
  assert(S.incLevel === 'kaos' && S.incPlan.every(x => x.at >= 13), `tidtabellen efter bytet: ${S.incPlan.map(x => x.at.toFixed(1)).join(', ')}`);
  return `per dygn: av ${av} · lugnt ${lugn} · normalt ${normal.toFixed(1)} · kaos ${kaos.toFixed(1)} (${INC_LEVELS.length} lägen)`;
});
test('Framkalla: flyttdag, blixt, tågstörning, VIP, väder och incidenter på en viss våning eller hiss', () => {
  const got = [];
  sim(18); runUntil(10.2);
  // brand på en vald våning
  const f = FIRE_FLOORS[2]; act('trigger', 'fire', f);
  assert(S.fire && S.fire.floor === f, 'branden startade inte på vald våning'); endFire(); step(DT); got.push(`brand ${fl(f)}`);
  // hissfel / het motor / linbrott på en vald hiss
  const e = S.elevators.find(x => x.mode === 'normal' && !x.facade && !x.freight);
  act('trigger', 'heat', e.id); assert(e.heat >= 1, 'motorn blev inte het');
  const c = S.elevators.find(x => x !== e && x.mode === 'normal' && !x.facade && !x.hot);
  act('trigger', 'cable', c.id); assert(c.snapNext, 'linorna knarrar inte i vald hiss');
  const d = S.elevators.find(x => x !== e && x !== c && x.mode === 'normal' && !x.facade);
  act('trigger', 'fault', d.id); assert(d.breakNext || d.trapNext || d.mode === 'broken', 'vald hiss fick inget fel');
  got.push(`fel i ${d.name}, het ${e.name}, linor ${c.name}`);
  // väder
  act('trigger', 'cold'); assert(S.weather.temp < -10 && S.weather.cold > 0, 'ingen kyla');
  act('trigger', 'heatwave'); assert(S.weather.temp > 28, 'ingen värmebölja'); got.push('väder');
  // tågstörning
  if (STATION >= 0) { const before = S.trainNext; runWhile(() => !!S.train, 30); act('trigger', 'train'); assert(S.trainNext > Math.max(before, S.t) + 20, 'tåget blev inte försenat'); got.push('tåg'); }
  // VIP
  runWhile(() => !!S.heli || S.people.some(p => p.vip), 120);
  if (floorWith('roof') >= 0 || S.vipVisits.length) { act('trigger', 'vip'); assert(S.heli, 'ingen helikopter'); got.push('VIP'); }
  // flyttdag
  // (står leveransbilen vid lastkajen väntar flyttbilen på gatan – lastkajen har plats för en bil)
  if (!S.move || S.move.state === 'planned') {
    act('trigger', 'move'); runWhile(() => !S.move || (S.move.state === 'planned' && !S.move.dockWait), 30);
    assert(S.move && (S.move.state !== 'planned' || S.move.dockWait > 0), 'flytten kom inte igång'); got.push('flytt');
  }
  // blixten: strömmen går strax
  act('trigger', 'lightning');
  runWhile(() => S.power, 10);
  assert(!S.power && S.outage && S.outage.cause === 'blixt', 'blixten slog inte ut strömmen');
  got.push('blixt');
  return got.join(' · ');
});
test(`Dockhuset: utan spelaren tar sig huset igenom kaosdygn – incidenterna tar slut av sig själva`, () => {
  const fails = [], seeds = Array.from({ length: 8 }, (_, i) => 2200 + i);
  let decs = 0, inc = 0, trap = 0, storm = 0, fire = 0, out = 0;
  for (const seed of seeds) {
    sim(seed, { incLevel: 'kaos', chief: true });
    const w = watcher();
    try { runDay(w); } catch (e) { fails.push(`frö ${seed}: kraschade – ${e.message}`); continue; }
    decs += chiefDecs().length; inc += S.stats.incidents;
    trap = Math.max(trap, w.maxTrap); storm = Math.max(storm, w.maxStorm); fire = Math.max(fire, w.maxFire); out = Math.max(out, w.maxOutage);
    if (w.maxStorm > 80) fails.push(`frö ${seed}: stormen pågick ${Math.round(w.maxStorm)} s`);
    if (w.maxFire > 130) fails.push(`frö ${seed}: branden pågick ${Math.round(w.maxFire)} s`);
    if (w.maxOutage > 60) fails.push(`frö ${seed}: strömavbrottet pågick ${Math.round(w.maxOutage)} s`);
    if (w.maxTrap > DOCK_TRAP_S) fails.push(`frö ${seed}: någon satt instängd ${Math.round(w.maxTrap)} s`);
    const stuck = S.elevators.filter(e => (!S.fire && (e.mode === 'recall' || e.mode === 'locked')) || (!S.outage && (e.mode === 'rescue' || e.mode === 'dead')));
    if (stuck.length) fails.push(`frö ${seed}: hiss kvar i ${stuck.map(e => `${e.name}:${e.mode}`).join(' ')}`);
    fails.push(...newInvariantFails(w, `frö ${seed}`));
  }
  assert(fails.length === 0, `${fails.length} fel:\n  ${fails.slice(0, 10).join('\n  ')}`);
  assert(decs > seeds.length, `bara ${decs} beslut av chefen på ${seeds.length} dygn`);
  return `${inc} incidenter · ${decs} beslut av chefen · längst: instängd ${Math.round(trap)} s, storm ${Math.round(storm)} s, brand ${Math.round(fire)} s, avbrott ${Math.round(out)} s`;
});
test('Driftcheferna är personer: vid bordet, fikar när det är lugnt, skyndar tillbaka vid larm och byter skift kl 22', () => {
  sim(31, { chief: true });
  const gb = chiefPerson(0);
  const atDesk = p => !!p && p.state === 'office' && p.floor === CONTROL && p.spot && p.spot.post === 'chief';
  const inBreak = p => !!p && p.state === 'office' && p.floor === BREAK && p.spot && p.spot.brk;
  assert(atDesk(gb), `${CHIEFS[0].name} sitter inte vid kontrollbordet när dygnet börjar`);
  // en fikarast när det är lugnt (på dagen)
  let fika = false, back = false;
  while (hour() < 16 && !(fika && back)) { step(DT); if (inBreak(gb)) fika = true; else if (fika && atDesk(gb)) back = true; }
  assert(fika && back, `${gb.name}: fika ${fika} · tillbaka vid bordet ${back}`);
  // larm mitt i rasten: chefen reser sig och går tillbaka
  while (hour() < 21 && !inBreak(gb)) step(DT);
  if (!inBreak(gb)) { gb.breaks.forEach(b => { b.done = false; b.at = hour(); }); while (hour() < 21.4 && !inBreak(gb)) step(DT); }
  assert(inBreak(gb), `${gb.name} tog ingen rast`);
  act('trigger', 'heat', 0);
  let g = 0;
  while (!atDesk(gb) && ++g < 90 / DT) step(DT);
  assert(atDesk(gb), `${gb.name} kom inte tillbaka till bordet efter larmet (${gb.state} på ${fl(gb.floor)})`);
  // spelaren skickar chefen på rast: hen går till personalrummet, och tillbaka när chefen slås på igen
  setChief(false); g = 0;
  while (!inBreak(gb) && ++g < 90 / DT) step(DT);
  assert(inBreak(gb), `${gb.name} gick inte på rast när spelaren tog över`);
  setChief(true);
  // skiftbytet: Rune kommer, väntar tills Gun-Britt har gått och tar över bordet – aldrig två vid bordet
  let both = 0;
  while (hour() < 23.5) {
    step(DT);
    if (S.people.filter(p => atDesk(p)).length > 1) both++;
  }
  const ru = chiefPerson(1);
  assert(both === 0, 'två chefer vid bordet samtidigt');
  assert(!chiefPerson(0), `${CHIEFS[0].name} är kvar i huset efter skiftbytet`);
  assert(atDesk(ru), `${CHIEFS[1].name} sitter inte vid bordet efter skiftbytet (${ru ? `${ru.state} på ${fl(ru.floor)}` : 'inte i huset'})`);
  return `${gb.name} fikade och kom tillbaka · skyndade tillbaka vid larm · ${ru.name} tog över bordet`;
});
test('Personalen: alla kommer till sin post, tar raster, går hem efter passet och delar aldrig plats', () => {
  sim(31, { chief: true });
  const posted = {}, breaks = {}, home = {}, seen = new Set();
  let shared = 0, uncovered = 0;
  const ids = CREW.filter(c => c.arrive !== 'event').map(c => c.id);
  while (!S.summaryShown) {
    step(DT);
    const here = S.people.filter(p => p.crewId && !p.dead);
    for (const p of here) {
      seen.add(p.crewId);
      if (atPost(p)) posted[p.crewId] = true;
      if (p.onBreak && p.state === 'office') breaks[p.crewId] = true;
    }
    for (const id of seen) if (!crewPerson(id)) home[id] = true;
    // aldrig två på samma plats
    const spots = here.filter(p => p.state === 'office' && p.spot && !p.spot.temp && p.spot.k !== 'door').map(p => p.spot);
    if (new Set(spots).size !== spots.length) shared++;
    // kontrollrummet: chefen och bildproducenten är aldrig borta samtidigt på rast (utom när spelaren tog över)
    const away = post => here.some(p => CREW_BY[p.crewId].post === post && p.onBreak);
    if (away('chief') && away('producer')) uncovered++;
  }
  for (const id of ids) {
    const c = CREW_BY[id];
    assert(posted[id], `${c.name} kom aldrig till sin post (${c.post})`);
    assert(c.breaks.length === 0 || breaks[id], `${c.name} tog ingen rast`);
    if (c.until !== null) assert(home[id], `${c.name} gick aldrig hem efter passet`);
  }
  assert(shared === 0, `två ur personalen på samma plats i ${shared} steg`);
  assert(uncovered === 0, `chefen och bildproducenten på rast samtidigt i ${uncovered} steg`);
  return `${ids.length} i personalen · alla på post, rast och hem i tid`;
});
test('Fönsterputsaren: gondolen putsar bara med Hasse ombord, och hissas upp innan han går på rast', () => {
  sim(31, { chief: true });
  let scrubAlone = 0, scrubbed = 0, offMid = 0;
  const C = () => S.cleaner;
  while (hour() < 17.8) {
    step(DT);
    const h = crewPerson('hasse'), aboard = !!h && atPost(h);
    if (C().scrub) { scrubbed++; if (!aboard) scrubAlone++; }
    // den som lämnar gondolen gör det bara när den är uppe vid taket
    if (h && h.floor === postFloor('gondola') && h.state !== 'office' && !C().parked) offMid++;
  }
  assert(scrubbed > 0, 'gondolen putsade aldrig');
  assert(scrubAlone === 0, `gondolen putsade utan putsaren i ${scrubAlone} steg`);
  assert(offMid === 0, `putsaren klev av gondolen mitt på fasaden (${offMid} steg)`);
  return `putsade ${Math.round(scrubbed * DT)} s · alltid med Hasse ombord`;
});
test('Arbetsledaren från hissjouren kommer vid ett linbrott och åker när hissen går igen', () => {
  sim(43); runUntil(9);
  const still = () => S.elevators.find(x => x.mode === 'normal' && !x.facade && x.state !== 'moving' && x.pos > x.minF + 1);
  for (let i = 0; !still() && i < 60 / DT; i++) step(DT);
  const e = still();
  assert(e, 'ingen hiss att ha linbrott i');
  snapCable(e);
  let g = 0, stig = null;
  while (!stig && ++g < 120 / DT) { step(DT); stig = S.people.find(p => p.role === 'arbetsledare') || null; }
  assert(stig, 'ingen arbetsledare kom');
  g = 0;
  while (!(stig.state === 'office' && stig.floor === jobFloor(e)) && !stig.dead && ++g < 200 / DT) step(DT);
  assert(stig.state === 'office', `${stig.name} kom aldrig fram till hissen`);
  // linbytet tar timmar: gör det klart direkt
  g = 0;
  while (e.mode === 'snapped' && ++g < 300 / DT) step(DT);
  if (e.mode === 'broken' && e.fault) e.fault.need = 0;
  g = 0;
  while (!stig.dead && ++g < 300 / DT) step(DT);
  assert(stig.dead, `${stig.name} åkte aldrig tillbaka till jouren (${e.name}: ${e.mode})`);
  return `${stig.name} tittade på ${e.name} och åkte när den gick igen`;
});
/** kör tills panoramahissen sitter fast på fasaden (framkallat), eller kasta */
function panoStuck(w) {
  act('trigger', 'pano');
  let g = 0;
  while (!S.pano && ++g < 900 / DT) { const b = w && w.before(); step(DT); if (w) w.check(b); }
  if (!S.pano) throw new Fail('panoramahissen fastnade aldrig');
  return S.elevators[PANO.id];
}
test('Panoramahissen fast på fasaden: räddningstjänsten firar ner alla med rep, sedan lagas hydrauliken', () => {
  sim(43, { chief: true }); runUntil(9.5);
  const w = watcher(), e = panoStuck(w), who = [...e.passengers], P = S.pano;
  assert(who.length > 0 && e.mode === 'broken' && e.fault.pano, 'korgen fastnade inte med folk i');
  const at = Math.round(e.pos * 1000);
  let g = 0, moved = 0, worked = 0;
  // (var var och en landade – efteråt kan de ha hunnit åka vidare med en annan hiss)
  const landed = new Map(), roping = new Set();
  while (S.pano && S.pano.ph !== 'done' && ++g < 400 / DT) {
    const b = w.before(); step(DT); w.check(b);
    for (const p of who) { if (p.state === 'rope') roping.add(p); else if (roping.has(p) && !landed.has(p)) landed.set(p, p.floor); }
    if (Math.round(e.pos * 1000) !== at) moved++;
    if (techOf(e) && techOf(e).workT > 0 && e.passengers.length) worked++;
  }
  assert(P.ph === 'done', `räddningen blev aldrig klar (${P.ph}, ${e.passengers.length} kvar)`);
  assert(P.setup === 'rope', `chefen valde ${P.setup} fast det var lugnt`);
  assert(moved === 0, 'korgen rörde sig medan den satt fast');
  assert(worked === 0, 'teknikern lagade hydrauliken med folk kvar i korgen');
  // (den som är nere kan redan ha klivit på en annan hiss)
  assert(who.every(p => p.state !== 'rope' && p.car !== e && !e.passengers.includes(p)), 'någon är kvar i korgen eller i repet');
  assert(who.every(p => landed.get(p) === P.toF), `någon landade fel (${who.map(p => fl(landed.get(p) ?? -1)).join(', ')} – skulle till ${fl(P.toF)})`);
  assert(S.chief.log.some(d => d.key === 'pano' && d.by === 'chief'), 'chefen beslutade aldrig');
  g = 0;
  while (e.mode !== 'normal' && ++g < 300 / DT) step(DT);
  assert(e.mode === 'normal', `${e.name} lagades aldrig (${e.mode})`);
  g = 0;
  while (S.pano && ++g < 200 / DT) step(DT);
  assert(!S.pano && !S.people.some(p => p.rescue), 'räddningstjänsten åkte aldrig');
  assert(w.passes === 0 && w.brokenUse === 0, `regelbrott (förbi ${w.passes}, trasig ${w.brokenUse})`);
  return `${who.length} firade ner till ${fl(P.toF)} på ${Math.round(P.t1 - P.t0)} s · ${e.name} lagad`;
});
test('Panoramahissen fast på fasaden: stegbilen (spelarens val) – och utan chef väljer räddningsledaren själv', () => {
  // spelaren väljer stegbilen (när den når) – annars går valet inte igenom
  let ok = null;
  for (const seed of [43, 44, 45, 46]) {
    sim(seed); runUntil(9.5);
    const e = panoStuck(null);
    const reach = ladderReach(e);
    act('panoRescue', 'ladder');
    assert(reach ? S.pano.how === 'ladder' : S.pano.how !== 'ladder', `stegbilen valdes fast den ${reach ? '' : 'inte '}når`);
    if (!reach) continue;
    const P = S.pano;
    let g = 0;
    while (P.ph !== 'done' && ++g < 300 / DT) step(DT);
    assert(P.ph === 'done' && P.setup === 'ladder', `stegbilen fick inte ut dem (${P.ph}/${P.setup})`);
    ok = `${P.n} nerför stegen på ${Math.round(P.t1 - P.t0)} s`;
    break;
  }
  assert(ok, 'panoramahissen fastnade aldrig inom stegens räckvidd');
  // utan chef och utan spelare: räddningsledaren väljer när räddarna har varit på plats en stund
  sim(43); runUntil(9.5);
  panoStuck(null);
  let g = 0;
  while (!S.pano.how && ++g < (PANO_CREW_S + PANO_DEFAULT_S + 5) / DT) step(DT);
  assert(S.pano.how && S.pano.by === 'crew', `ingen valde metod (${S.pano.how}, ${S.pano.by})`);
  return `${ok} · räddningsledaren valde ${S.pano.how} själv`;
});
/** längsta tid någon får sitta instängd när driftchefen sköter huset (linbrott: utrymning genom takluckan) */
const DOCK_TRAP_S = 150;
test('Kontrollrummet finns i huset (en våning med taggen control)', () => {
  assert(CONTROL >= 0 && CONTROL < S.elevators.length + 30, `CONTROL = ${CONTROL}`);
  return `driftcentralen på ${fl(CONTROL)}`;
});

// ---------- Determinism med spelaråtgärder ----------
/** allt som beskriver hur dygnet blev */
function dayPrint() {
  const st = S.stats;
  return JSON.stringify([st, S.nextId, S.people.length, S.elevators.map(e => [e.pos, e.trips, e.distance, e.wear, e.mode, e.kwh])]);
}
// två egna strömmar för testet nedan (en ström per namn och process)
const TEST_A = stream('test-a'), TEST_B = stream('test-b');
test('Slumpströmmar: oberoende per delsystem – ankomsterna beror inte på styrlogiken eller incidenterna', () => {
  // mekaniken: samma frö ger samma följd, olika namn olika följder, och en ström påverkas inte av en annan
  setSeed(7); const a1 = [TEST_A.rng(), TEST_A.rng(), TEST_A.rng()];
  setSeed(7); for (let i = 0; i < 100; i++) TEST_B.rng();
  const a2 = [TEST_A.rng(), TEST_A.rng(), TEST_A.rng()];
  assert(a1.every((x, i) => x === a2[i]), 'ström A ändrades när ström B drog slumptal');
  setSeed(7); assert(TEST_B.rng() !== a1[0], 'två strömmar med olika namn ger samma följd');
  let dup = false; try { stream('test-a'); } catch { dup = true; }
  assert(dup, 'samma strömnamn två gånger borde vara ett fel');
  for (const n of ['anställda', 'besökare', 'gestalt', 'folk', 'styrning', 'incidenter', 'tidtabell', 'väder'])
    assert(streamNames().includes(n), `strömmen ${n} saknas`);
  // i simuleringen: anställda som kommer genom entrén kommer på samma sekunder oavsett styrlogik och slump
  const arrivals = (opts, until) => {
    sim(31, opts);
    const seen = new Set(), out = [];
    while (hour() < until) {
      step(DT);
      for (const p of S.people) if (!seen.has(p.id)) { seen.add(p.id); if (p.kind === 'emp' || (p.kind === 'vis' && !p.vip)) out.push(`${S.t.toFixed(2)}:${p.kind === 'emp' ? p.home : p.goal}:${p.kg}`); }
    }
    return { at: out.join(' '), n: out.length, wear: S.elevators.map(e => e.wear.toFixed(6)).join(), temp: S.weather.temp };
  };
  // (hela dagen: samma personer – hemvåning eller ärende, vikt – på samma sekunder, även de som kommer med tåget)
  const smart = arrivals({ strategy: 'smart' }, 20), near = arrivals({ strategy: 'nearest' }, 20);
  assert(smart.n > 20 && smart.at === near.at, `ankomsterna skiljer sig mellan smart och närmast (${smart.n} mot ${near.n})`);
  // (före sju har ingen incident börjat: slumpens nivå får inte flytta något annat)
  const av = arrivals({ incLevel: 'av' }, 7), kaos = arrivals({ incLevel: 'kaos' }, 7);
  assert(av.at === kaos.at && av.wear === kaos.wear && av.temp === kaos.temp, 'slumpens nivå ändrade ankomsterna, slitaget eller vädret');
  return `${streamNames().length} strömmar · ${smart.n} anställda och besökare – samma personer på samma sekunder med smart och närmast · av = kaos före 07`;
});
test('Determinism: samma frö och samma spelaråtgärder ger exakt samma dygn (även dag 2)', () => {
  const run = () => {
    const r = mulberry(4242);
    sim(77, { autoInc: true, chief: true });
    runDay(); S.day++; resetDay(); // dag 2: slitaget och minnet från dag 1 följer med
    const names = Object.keys(PLAYER_ACTIONS);
    let next = 3, n = 0;
    while (!S.summaryShown) {
      if (S.t >= next) { PLAYER_ACTIONS[names[Math.floor(r() * names.length)]](r); n++; next = S.t + 2 + r() * 12; }
      step(DT);
    }
    return { n, print: dayPrint() };
  };
  const a = run(), b = run();
  assert(a.n > 30, `bara ${a.n} åtgärder`);
  assert(a.print === b.print, `två körningar blev olika dygn:\n${a.print.slice(0, 300)}\n${b.print.slice(0, 300)}`);
  return `${a.n} åtgärder på dag 2 · identiskt dygn`;
});

// ---------- Dygnsskiftet ----------
/** kör till klockslaget h på dygn d (det mjuka dygnsskiftet: klockan börjar om, dagen räknas upp) */
function runTo(d, h, w) {
  let g = 0;
  while (S.day < d || hour() < h) { const b = w && w.before(); step(DT); if (w) w.check(b); if (++g > 400000) throw new Fail(`kom aldrig fram till dag ${d} kl ${h}`); }
}
test('Mjukt dygnsskifte: huset rullar vidare kl 06 – fel, brand och folk följer med, nattskiftet avlöses', () => {
  sim(31, { roll: 'mjuk', chief: true, autoInc: true });
  const w = watcher();
  runTo(1, 29.97, w);
  const e = S.elevators.find(x => x.mode === 'normal' && !x.passengers.length && x.state === 'idle');
  assert(e, 'ingen ledig hiss att ha sönder');
  breakDown(e, 'motorn överhettad');
  act('trigger', 'fire', FIRE_FLOORS[0]);
  const t0 = S.t, ids = new Set(S.people.map(p => p.id)), need = e.fault.need;
  runTo(2, 6.005, w);
  assert(S.day === 2 && S.t > t0, 'klockan på simuleringen (S.t) ska löpa vidare över skiftet');
  assert(e.mode === 'broken' && e.fault && e.fault.need === need, `${e.name} blev hel av dygnsskiftet (${e.mode})`);
  assert(S.fire, 'branden försvann vid dygnsskiftet');
  assert(S.people.some(p => ids.has(p.id)), 'folket i huset försvann vid dygnsskiftet');
  assert(S.stats.served === 0 && S.yesterday && S.yesterday.day === 1, 'dagens statistik ska börja om och gårdagens sparas');
  assert(S.notices.some(n => n.kind === 'day'), 'ingen informationsruta om det nya dygnet');
  runTo(2, 10, w);
  assert(!S.fire, 'branden släcktes aldrig');
  assert(!e.fault, `${e.name} lagades aldrig efter skiftet`);
  for (const c of CREW.filter(x => x.until === null)) assert(!crewPerson(c.id), `${c.name} (nattskiftet) gick aldrig hem`);
  for (const c of CREW.filter(x => x.arrive === null)) assert(atPost(crewPerson(c.id)), `${c.name} (dagskiftet) kom aldrig till sin post`);
  assert(!S.people.some(p => ['väktare', 'nattdj', 'nattekniker'].includes(p.role)), 'nattpersonalen är kvar på förmiddagen');
  assert(S.people.filter(p => p.kind === 'emp').length > 20, 'de anställda kom inte till jobbet dag 2');
  const res = S.people.filter(p => p.kind === 'res');
  assert(res.every(p => p.sched.length && p.sched.some(x => x.at > 6)), 'de boende fick ingen ny dag att leva');
  assert(w.passes === 0 && w.brokenUse === 0 && w.badLeg === 0, `regelbrott över dygnsskiftet (förbi ${w.passes}, trasig ${w.brokenUse}, delresa ${w.badLeg})`);
  runTo(3, 6.01, w);
  assert(S.day === 3 && w.passes === 0, 'dag 3 rullade inte vidare');
  return `brand och ${e.name} fortsatte in i dag 2 · nattskiftet avlöst · ${res.length} boende · dag 3 nådd`;
});
test('Börjar om (resetDay): ett hissfel som inte hann lagas följer med till nästa dygn – folket gör det inte', () => {
  sim(32);
  runDay();
  const e = S.elevators[1];
  breakDown(e, 'bromsen kärvar');
  const need = e.fault.need;
  S.day++; resetDay();
  const n = S.elevators[1];
  assert(n.mode === 'broken' && n.fault && n.fault.what === 'bromsen kärvar' && n.fault.need === need, 'felet följde inte med');
  assert(n.stops.has(n.floor) && n.pos === n.floor, 'den trasiga korgen ska stå på en hållplats');
  assert(!n.passengers.length, 'passagerare följde med');
  runUntil(8);
  assert(!n.fault && n.mode === 'normal', `${n.name} lagades aldrig på morgonen (${n.mode})`);
  return `${n.name}: ${n.fault ? 'trasig' : 'lagad'} på morgonen dag 2`;
});
test('Dygnets händelser: incidenter som tar slut sparas i statistiken (dagens sammanfattning)', () => {
  sim(33, { chief: true });
  runUntil(10);
  act('trigger', 'fire', FIRE_FLOORS[0]);
  runUntil(14);
  const ev = S.stats.events;
  assert(ev.some(e => e.type === 'fire'), `branden finns inte bland dygnets händelser (${ev.map(e => e.type).join(', ')})`);
  assert(ev.every(e => /^\d\d:\d\d$/.test(e.time) && e.title && e.text), 'en händelse saknar tid, rubrik eller text');
  return ev.map(e => `${e.time} ${e.type}`).join(' · ');
});
test('Panoramahissen går ner till tunnelbanan: från perrongen rakt upp till taket – men fastnar aldrig under gatan', () => {
  sim(64);
  const P = S.elevators[PANO.id], roof = floorWith('roof');
  assert(P.stops.has(STATION) && P.minF === STATION, 'panoramahissen går inte ner till tunnelbanan');
  // resvägen: från perrongen till taket är en enda resa (förr: expressen till sky lobbyn och sedan höga zonen)
  assert(legDest(STATION, roof, { kind: 'vis', cargo: null }) === roof, 'från perrongen till taket blir det fortfarande hissbyte');
  const w = watcher();
  let fromTrain = 0, up = 0, stuckLow = 0;
  const seen = new Set();
  while (hour() < 15) {
    const b = w.before(); step(DT); w.check(b);
    for (const p of P.passengers) if (!seen.has(p) && p.floor === STATION) { seen.add(p); fromTrain++; if (p.dest === roof) up++; }
    // framkalla: hydrauliken ska bara kunna låsa sig ovanför gatan
    if (!S.pano && !P.panoNext && P.passengers.length && P.pos < LOBBY) act('trigger', 'pano');
    if (P.fault && P.fault.pano && P.pos < LOBBY + 0.6) stuckLow++;
  }
  assert(w.passes === 0 && w.badLeg === 0, `regelbrott (förbi ${w.passes}, delresa ${w.badLeg})`);
  assert(fromTrain > 0, 'ingen klev på panoramahissen vid perrongen');
  assert(stuckLow === 0, 'panoramahissen fastnade under gatan');
  return `${fromTrain} klev på vid perrongen (${up} till taket) · perrongen → taket utan byte · aldrig fast under gatan`;
});

test('Brand: ingen går trappan in i brandzonen, och de utrymda kommer tillbaka – även de som kom med tåg eller bil', () => {
  sim(1, { chief: true });
  runUntil(9.6);
  const w = watcher(), f = idx('7');
  startFire(f);
  const evac = new Map();
  let g = 0;
  while (S.fire && ++g < 200 / DT) {
    const b = w.before(); step(DT); w.check(b);
    for (const p of S.people) if (p.evac && p.kind === 'emp') evac.set(p.id, p);
  }
  assert(!S.fire, 'branden tog aldrig slut');
  const commuters = [...evac.values()].filter(p => p.exitFloor !== LOBBY).length;
  run(120, w);
  const gone = [...evac.values()].filter(p => p.dead);
  assert(evac.size > 20 && commuters > 5, `för få utrymda för att testet ska säga något (${evac.size}, ${commuters} med tåg/bil)`);
  assert(w.intoFire === 0, `${w.intoFire} gick trappan in i brandzonen`);
  assert(w.flips === 0, `en korg bytte riktning i fart ${w.flips} gånger vid återkallningen`);
  assert(gone.length <= evac.size * 0.1, `${gone.length} av ${evac.size} utrymda anställda gick hem för dagen (${gone.slice(0, 3).map(p => `${p.name}: ${p.why}`).join('; ')})`);
  return `${evac.size} anställda utrymda (${commuters} kom med tåg eller bil) · ${evac.size - gone.length} tillbaka i huset · ingen in i brandzonen`;
});
test('Brand: husets personal som står i kön i brandzonen går ner till entrén – de lämnar inte huset', () => {
  sim(5, { chief: true });
  runUntil(10.3);
  let hit = null, g = 0;
  while (!hit && ++g < 600 / DT) { step(DT); hit = S.people.find(p => p.crewId && (p.state === 'wait' || p.state === 'toQueue') && p.floor > LOBBY + 2 && p.goal !== LOBBY) || null; }
  assert(hit, 'ingen ur personalen stod i en kö högt upp');
  const id = hit.crewId;
  startFire(Math.min(hit.floor + 1, idx('14')), false);
  assert(hit.goal === LOBBY && hit.leaving === false, `${hit.name} utryms ut ur huset (mål ${fl(hit.goal)}, hemgång ${hit.leaving})`);
  g = 0; while (S.fire && ++g < 200 / DT) step(DT);
  run(30);
  assert(crewPerson(id), `${hit.name} lämnade huset under branden`);
  return `${hit.name} gick ner till entrén och var kvar efter branden`;
});
test('Hissteknikern: den som hamnar på fel våning med ett jobb går till jobbet (hissen blir lagad)', () => {
  sim(12); runUntil(10);
  const e = S.elevators.find(x => x.mode === 'normal' && x.state === 'idle' && !x.passengers.length && Math.round(x.pos) > LOBBY + 1 && !x.facade);
  assert(e, 'ingen ledig hiss en bit upp');
  breakDown(e, 'bromsen kärvar');
  let g = 0, t = null;
  while (!(t && t.state === 'office' && t.floor === jobFloor(e)) && ++g < 200 / DT) { step(DT); t = techOf(e); }
  assert(t && t.job === e.id, 'teknikern kom aldrig fram');
  // (som när hen släpps ut ur en annan hiss, eller hissen går sönder någon annanstans än där hen väntar)
  t.floor = LOBBY; t.timer = 1e9;
  const w = watcher();
  g = 0; while (e.mode === 'broken' && ++g < 240 / DT) { const b = w.before(); step(DT); w.check(b); }
  assert(e.mode !== 'broken', `${e.name} blev aldrig lagad – ${t.name} står på ${fl(t.floor)} (${t.state})`);
  assert(w.techLostMax < 10, `teknikern stod ${w.techLostMax.toFixed(0)} s på fel våning`);
  return `${t.name} gick tillbaka till ${e.name} och lagade den`;
});
test('Mjukt dygnsskifte: en boende som är borta utan bokad hemkomst kommer hem på morgonen', () => {
  sim(8, { roll: 'mjuk' });
  runTo(1, 29.9);
  const p = S.people.find(q => q.kind === 'res' && q.state === 'office' && q.floor === q.home && !q.moving);
  assert(p, 'ingen boende hemma');
  // (som den som utrymdes sent på kvällen: ute, och inget i schemat som tar hen hem)
  for (const ev of p.sched) ev.done = true;
  p.state = 'away'; p.returnAt = 99; p.spot = null;
  // (hen kan hinna gå till jobbet igen efteråt – det räcker att hen kom hem)
  let home = false, g = 0;
  while ((S.day < 2 || hour() < 9) && ++g < 400000) { step(DT); if (S.day === 2 && p.state !== 'away') home = true; }
  assert(home, `${p.name} kom aldrig hem på morgonen dag 2 (returnAt ${p.returnAt})`);
  return `${p.name} kom hem på morgonen dag 2`;
});
test('Ambulans och brand: patienten som utryms innan ambulansen kommer ligger inte kvar för alltid', () => {
  sim(21, { roll: 'mjuk' });
  runUntil(10);
  assert(act('trigger', 'medical') !== false && S.medic, 'ingen svimmade');
  const pat = S.people.find(p => p.id === S.medic.pid);
  startFire(Math.max(FIRE_FLOORS[0], Math.min(pat.floor, idx('14'))));
  let g = 0; while ((S.fire || S.medic.state !== 'done') && ++g < 400 / DT) step(DT);
  run(60);
  assert(S.medic.state === 'done', 'ambulansen åkte aldrig');
  assert(pat.dead || !pat.collapsed, `${pat.name} ligger kvar avsvimmad (${pat.state} på ${fl(pat.floor)})`);
  return pat.dead ? `${pat.name} ${S.medic.taken ? 'åkte med ambulansen' : 'lämnade huset'}` : `${pat.name} kvicknade till`;
});
test('Hissteknikern sitter själv fast mellan två våningar: hissjouren skickar en kollega som får loss dem', () => {
  sim(12); runUntil(10);
  const high = () => S.elevators.find(x => x.mode === 'normal' && x.state === 'idle' && !x.passengers.length && Math.round(x.pos) > SKY && !x.facade && !x.freight);
  for (let i = 0; !high() && i < 120 / DT; i++) step(DT);
  const far = high();
  assert(far, 'ingen ledig hiss högt upp');
  breakDown(far, 'bromsen kärvar'); far.fault.need = 1e6;
  // teknikern åker upp – och hissen hen åker med tvärstannar mellan två våningar
  let g = 0, t = null, e = null;
  while (!e && ++g < 300 / DT) {
    step(DT); t = techOf(far);
    const c = t && t.state === 'ride' ? t.car : null;
    if (c && c.mode === 'normal' && c.state === 'moving' && c.pos - Math.floor(c.pos) > 0.35 && c.pos - Math.floor(c.pos) < 0.75 && c.pos > c.minF + 0.6) e = c;
  }
  assert(e, 'teknikern åkte aldrig hiss till jobbet');
  trapBreak(e);
  g = 0; while (e.mode === 'broken' && ++g < 300 / DT) step(DT);
  assert(e.mode !== 'broken', `${e.name} blev aldrig lagad – den enda teknikern (${t.name}) satt själv fast i den`);
  const n = S.people.filter(p => p.role === 'hisstekniker').length;
  return `${t.name} satt fast i ${e.name} · en kollega kom och fick igång den (${n} tekniker i huset)`;
});
