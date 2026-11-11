// Testsviten för simuleringen. Ingen grafik, HUD eller DOM – samma tester körs i webbläsaren
// (tests.html via browser.js) och i terminalen (npm test via run.mjs).
// Varje test seedar slumpen, så resultaten är exakt reproducerbara.
import { S, hooks, hour } from '../src/state.js';
import { floorOpen, FLOOR_HOURS, idx, floorWith, EL, LOBBY, SKY, HOME_FLOORS, OFFICE_FLOORS } from '../src/config.js';
import { DT, step, advance, newSim, resetDay, startReplay } from '../src/sim.js';
import {
  startFire, setFireMode, startOutage, startGenerator, toggleAutoRescue,
  toggleOff, endFire, canRescue,
} from '../src/incidents.js';
import { liftsAvailable, spawnBus } from '../src/people.js';
import { loadKg, allowed, safeFloor, operational, canTake, stopFloors, isFull, costBased } from '../src/dispatch.js';
import { RATED_KG, FULL_LOAD, VMAX } from '../src/config.js';
import { needsFreight, mayUseFreight, legDest } from '../src/people.js';
import { fl } from '../src/util.js';
import { assignCalls, antiNuisance } from '../src/buttons.js';
import { act, recording, encodeReplay, decodeReplay } from '../src/replay.js';
import { powerKw, triggerFault, breakDown, tech } from '../src/service.js';
import { trafficMode } from '../src/dispatch.js';

// ---------- Ramverk ----------
export const tests = [];
const test = (name, fn) => tests.push({ name, fn });
export class Fail extends Error {}
function assert(cond, msg) { if (!cond) throw new Fail(msg); }

// ---------- Hjälp ----------
function sim(seed, opts = {}) {
  newSim(seed, { strategy: 'smart', autoInc: false, mistakes: 'lite', maint: 'natt', ...opts });
  S.started = true; S.paused = false;
  hooks.incident = () => {}; hooks.dayEnd = () => {};
}
// Vakt som kontrollerar invarianter efter varje steg
function watcher() {
  const w = { passes: 0, maxRide: 0, maxWait: 0, n: 0, overweight: 0, maxKg: 0, bypassBroken: 0, prev: [],
    outOfRange: 0, wrongDoor: 0, badLeg: 0, badFreight: 0, vipMixed: 0, vipSet: [], selfDest: 0, brokenUse: 0, holdBoard: 0, prevN: [],
    jumps: 0, orphanService: 0, badReserved: 0, idleWait: new Map(), idleWaitMax: 0 };
  w.before = () => S.elevators.map(e => e.pos);
  w.check = before => {
    S.elevators.forEach((e, i) => {
      const kg = loadKg(e);
      // en hiss får aldrig köra iväg överlastad
      if (e.state === 'moving' && kg > e.ratedKg + 1e-6) w.overweight++;
      // zonerna: hissen håller sig inom sitt schakt och öppnar bara där den har dörrar
      if (e.pos < e.minF - 1e-6 || e.pos > e.maxF + 1e-6) w.outOfRange++;
      if (e.state === 'doors' && !e.serves.has(e.floor)) w.wrongDoor++;
      for (const p of e.passengers) {
        if (p.state === 'ride' && !e.serves.has(p.dest)) w.badLeg++;
        if (p.state === 'ride' && (e.freight ? !mayUseFreight(p) : needsFreight(p))) w.badFreight++;
        if (e.vipLock && !p.vip && w.vipSet[i] && !w.vipSet[i].has(p)) w.vipMixed++;
      }
      if (e.state === 'moving') w.maxKg = Math.max(w.maxKg, kg);
      // en trasig hiss eller en hiss på service rör sig aldrig och har ingen ombord;
      // en hiss som väntar på service tar aldrig nya passagerare
      if ((e.mode === 'broken' || e.mode === 'service') && (e.passengers.length || e.reserved || Math.abs(e.pos - before[i]) > 1e-9)) w.brokenUse++;
      // (de som redan var på väg in genom dörren när hissen kallades till service får åka med)
      const aboard = e.passengers.length + e.reserved;
      if (e.hold && aboard > (w.prevN[i] ?? 0)) w.holdBoard++;
      w.prevN[i] = aboard;
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
      if (e.mode === 'service') { const t = tech(); if (!t || t.job !== e.id) w.orphanService++; }
      // reserverade platser = de som är på väg in genom dörren
      if (e.reserved !== S.people.filter(p => p.state === 'boarding' && p.car === e).length) w.badReserved++;
      for (const p of e.passengers) {
        // en hiss i normal drift får aldrig köra förbi en passagerares mål
        if (e.mode === 'normal' && p.state === 'ride' && ((a < p.dest && b > p.dest) || (a > p.dest && b < p.dest))) w.passes++;
        if (S.power && e.mode === 'normal') w.maxRide = Math.max(w.maxRide, S.t - p.rideStart);
      }
    });
    if (++w.n % 30 === 0 && liftsAvailable() && !S.fire) {
      for (const p of S.people) if (p.state === 'wait') w.maxWait = Math.max(w.maxWait, S.t - p.waitStart);
      // ingen ska stå i kön för att åka till våningen hen redan står på
      for (const p of S.people) if (p.state === 'wait' && p.dest === p.floor) w.selfDest++;
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
    assert(w.outOfRange === 0, `hissar utanför sin zon ${w.outOfRange} gånger`);
    assert(w.wrongDoor === 0, `hissar öppnade på våningar utan dörr ${w.wrongDoor} gånger`);
    assert(w.badLeg === 0, `passagerare åkte hiss som inte går till deras delmål ${w.badLeg} gånger`);
    assert(w.badFreight === 0, `fel last i fel hiss ${w.badFreight} gånger`);
    return fmt(w);
  });
}
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
test('Dygnet går 06:00–06:00 på ungefär 6 minuter och natten går fortare', () => {
  sim(41); runUntil(22); const day = S.t; runDay();
  const night = S.t - day;
  assert(S.t > 330 && S.t < 390, `ett dygn tog ${S.t.toFixed(0)} simuleringssekunder (ska vara ≈ 6 minuter)`);
  assert(night < day / 2, `natten (${night.toFixed(0)}s) går inte fortare än dagen (${day.toFixed(0)}s)`);
  return `dag 06–22: ${day.toFixed(0)} s · kväll+natt 22–06: ${night.toFixed(0)} s (simuleringstid)`;
});
test('Natten: låg belastning, nattpersonal och hissar i nattläge', () => {
  sim(25); runUntil(23.5);
  const roles = new Set(S.people.filter(p => p.role).map(p => p.role));
  for (const r of ['väktare', 'nattdj', 'nattekniker']) assert(roles.has(r), `${r} saknas klockan 23:30`);
  let maxPop = 0, maxWait = 0, maxSleeping = 0; const served0 = S.stats.served;
  while (hour() < 28) {
    step(DT);
    maxPop = Math.max(maxPop, S.people.length);
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
  sim(51); runUntil(9.6);
  const w = watcher();
  const before = S.stats.overloads;
  // stora bussar: med expresshissarna klarar huset en vanlig busslast (14) utan överlast
  for (let i = 0; i < 4; i++) { spawnBus(24); run(6, w); }
  run(150, w);
  const overloads = S.stats.overloads - before;
  assert(overloads > 0, 'ingen överlast trots fyra busslaster med resväskor');
  assert(w.overweight === 0, `en hiss körde iväg överlastad ${w.overweight} gånger`);
  const stuck = S.people.filter(p => p.why === 'Turist på busstur' && p.state === 'wait' && S.t - p.waitStart > 200).length;
  assert(stuck === 0, `${stuck} turister har väntat över 200 s`);
  return `${overloads} överlaster, tyngsta avgång ${Math.round(w.maxKg)} kg av ${RATED_KG} – ingen hiss körde överlastad`;
});

// ---------- Brand ----------
test('Brand + brandåterkallning: alla hissar till E och avstängda, alla tar trappan', () => {
  sim(7); runUntil(7.67);
  startFire(idx('7')); run(3); setFireMode('recall'); run(25);
  for (const e of S.elevators) {
    assert(e.mode === 'locked', `hiss ${e.name} är i läge ${e.mode}, inte låst`);
    assert(Math.abs(e.pos - e.home) < 1e-6, `hiss ${e.name} står på ${e.pos.toFixed(2)}, inte på sin hemvåning ${e.home}`);
    assert(e.passengers.length === 0, `hiss ${e.name} har ${e.passengers.length} passagerare kvar`);
  }
  const waiting = S.people.filter(p => p.state === 'wait').length;
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
  let maxJump = 0;
  for (let i = 0; i < 10 / DT; i++) { const p0 = e.pos; step(DT); maxJump = Math.max(maxJump, Math.abs(e.pos - p0)); }
  assert(maxJump <= VMAX * DT + 1e-6, `${e.name} hoppade ${maxJump.toFixed(2)} våningar på ett steg`);
  assert(Math.abs(e.pos - Math.round(e.pos)) < 1e-6 && e.state !== 'moving', `${e.name} stannade inte på en våning (${e.pos.toFixed(2)})`);
  return `${e.name} bromsade in till ${fl(e.pos)} · största steg ${maxJump.toFixed(3)} våningar`;
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
test('Brand utan åtgärd: folk åker genom röken', () => {
  sim(9); runUntil(8.08);
  startFire(idx('4')); run(60);
  assert(S.stats.smoked > 0, 'ingen blev rökexponerad trots normal drift');
  return `${S.stats.smoked} rökexponerade`;
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
  assert(tr > 30, `bara ${tr} hissbyten på förmiddagen`);
  assert(w.badLeg === 0 && w.wrongDoor === 0 && w.outOfRange === 0, `zonfel: ${w.badLeg} fel delresor, ${w.wrongDoor} fel dörrar, ${w.outOfRange} utanför zon`);
  const x = S.elevators.filter(e => e.express);
  assert(x.every(e => e.trips > 4), `expresshissarna gick nästan inte: ${x.map(e => e.trips).join(', ')}`);
  const low = S.elevators.filter(e => e.group === 'låg');
  return `${tr} hissbyten · expressen ${x.map(e => e.trips).join('+')} stopp · låga zonen ${low.map(e => e.trips).join('+')} stopp`;
});
test('Staplade zoner: låg → hög zon går via entrén, expressen och sky lobbyn', () => {
  const p = { cargo: null, kind: 'emp' };
  const route = (from, goal) => { const r = [from]; let f = from; for (let i = 0; i < 6 && f !== goal; i++) { f = legDest(f, goal, p); r.push(f); } return r.map(fl).join('→'); };
  const cases = [['3', '10', '3→E→6→10'], ['P2', 'T', 'P2→E→T'], ['12', '1', '12→6→E→1'], ['5', '6', '5→E→6'], ['E', '9', 'E→6→9']];
  for (const [a, b, want] of cases) { const got = route(idx(a), idx(b)); assert(got === want, `${a}→${b}: ${got}, väntade ${want}`); }
  // låga och höga zonens hissar delar schakt men når aldrig samma våning
  for (const a of EL) for (const b of EL) if (a !== b && !a.facade && !b.facade && a.col === b.col && a.col !== undefined)
    assert(a.maxF < b.minF || b.maxF < a.minF, `${a.name} och ${b.name} delar schakt men överlappar`);
  return cases.map(c => c[2]).join(' · ');
});
test('Varuhissen: städvagnar och paket åker bara varuhiss, och den tar bara gods och personal', () => {
  sim(62);
  const w = watcher(); runUntil(13, w);
  assert(w.badFreight === 0, `${w.badFreight} gånger fel last i fel hiss`);
  const V = S.elevators.find(e => e.freight);
  assert(V.trips > 3, `varuhissen gjorde bara ${V.trips} stopp`);
  assert(S.stats.deliveries > 0, 'inga paket levererades från lastkajen');
  return `${S.stats.deliveries} leveranser · varuhissen ${V.trips} stopp · tyngsta avgång ${Math.round(w.maxKg)} kg`;
});
test('Garaget: bilar kör in på morgonen och ut på kvällen', () => {
  sim(1);
  runUntil(10.5); const morning = S.autos.length;
  runUntil(21); const evening = S.autos.length;
  assert(S.stats.carsIn >= 5, `bara ${S.stats.carsIn} bilar körde in`);
  assert(evening < morning, `garaget töms inte på kvällen (${morning} → ${evening} bilar)`);
  return `${S.stats.carsIn} bilar in · ${morning} parkerade 10:30 · ${evening} kvar 21:00 (de boendes)`;
});
test('De boende: åker till jobb och skola på morgonen och sover hemma på natten', () => {
  sim(64);
  const res = () => S.people.filter(p => p.kind === 'res');
  const n = res().length;
  assert(n >= 8, `bara ${n} boende`);
  runUntil(11); const away = res().filter(p => p.state === 'away').length;
  runUntil(29.9); // (natten går fort – den som festat kommer hem på morgonkvisten)
  const home = res().filter(p => p.floor === p.home && p.state === 'office').length;
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
  const days = maint => {
    sim(1, { autoInc: true, maint });
    let faults = 0, serviced = 0;
    for (let d = 1; d <= 3; d++) { runDay(); faults += S.stats.faults; serviced += S.stats.serviced; S.day++; resetDay(); }
    return { faults, serviced, wear: S.elevators.reduce((a, e) => a + e.wear, 0) / S.elevators.length };
  };
  const night = days('natt'), none = days('fel');
  assert(night.serviced >= 6, `bara ${night.serviced} hissar servades på tre nätter`);
  assert(none.serviced === 0, 'service trots "bara vid fel"');
  assert(night.wear < none.wear * 0.6 && none.wear > 0.4, `snittslitage: nattservice ${night.wear.toFixed(2)} · bara vid fel ${none.wear.toFixed(2)}`);
  assert(night.faults < none.faults, `fel: nattservice ${night.faults} · bara vid fel ${none.faults}`);
  return `3 dygn · nattservice: ${night.serviced} servade, ${night.faults} fel, slitage ${Math.round(night.wear * 100)} % · bara vid fel: ${none.faults} fel, slitage ${Math.round(none.wear * 100)} %`;
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
test('Energisnål drar mindre ström än Smart, och Rusning ger kortare väntan i morgonrusningen (snitt över sex dygn)', () => {
  const r = {}, N = 6;
  for (const strategy of ['smart', 'peak', 'eco']) {
    let wait = 0, morning = 0, kwh = 0, run = 0;
    for (let seed = 11; seed < 11 + N; seed++) {
      sim(seed, { strategy });
      runUntil(7); const w0 = S.stats.waitSum, n0 = S.stats.waitN;
      runUntil(10.3); morning += (S.stats.waitSum - w0) / Math.max(1, S.stats.waitN - n0);
      runDay(); wait += avgWait(); kwh += S.stats.energy; run += S.stats.energyRun;
    }
    r[strategy] = { wait: wait / N, morning: morning / N, kwh: kwh / N, run: run / N };
  }
  assert(r.eco.kwh < r.smart.kwh && r.eco.run < r.smart.run * 0.9, `energi: smart ${r.smart.kwh.toFixed(1)} (körning ${r.smart.run.toFixed(1)}) · eco ${r.eco.kwh.toFixed(1)} (${r.eco.run.toFixed(1)}) kWh`);
  assert(r.eco.wait < r.smart.wait * 1.3, `eco väntar för länge: ${r.eco.wait.toFixed(1)}s mot ${r.smart.wait.toFixed(1)}s`);
  assert(r.peak.morning < r.smart.morning, `morgonrusning: rusning ${r.peak.morning.toFixed(2)}s · smart ${r.smart.morning.toFixed(2)}s`);
  return `morgon smart ${r.smart.morning.toFixed(1)} · rusning ${r.peak.morning.toFixed(1)} s · dygn smart ${r.smart.wait.toFixed(1)} · rusning ${r.peak.wait.toFixed(1)} · eco ${r.eco.wait.toFixed(1)} s · energi smart ${r.smart.kwh.toFixed(1)} · eco ${r.eco.kwh.toFixed(1)} kWh (körning ${r.smart.run.toFixed(1)} → ${r.eco.run.toFixed(1)})`;
});
test('Rusning: på morgonen kör lediga hissar direkt tillbaka till entrén', () => {
  sim(1, { strategy: 'peak' });
  runUntil(8);
  assert(S.peakMode === 'upp' && trafficMode(8) === 'upp', `rusningsläget är ${S.peakMode}`);
  let parked = 0, away = 0;
  while (hour() < 9.5) {
    step(DT);
    for (const e of S.elevators) if (e.state === 'moving' && e.targetKind === 'park') { if (e.parkTarget === e.home) parked++; else away++; }
  }
  assert(parked > 0 && away === 0, `parkeringar hem ${parked}, någon annanstans ${away}`);
  return `${parked} steg med lediga hissar på väg hem i UPP-läget`;
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
  sim(91);
  const d1 = day();
  S.day++; resetDay();
  const d2 = day();
  const want = ['gunnar:Gunnar', 'doris:Doris', 'kurt:Kurt', 'fia:Fia', 'majken:Majken', 'olle:Lill-Olle', 'pelle:Pizza-Pelle'];
  for (const d of [d1, d2]) for (const k of want) assert(d.seen.has(k), `${k} dök inte upp dag ${d === d1 ? 1 : 2}`);
  assert(d1.fiaRode.length === 0 && d2.fiaRode.length === 0, `Fia åkte hiss kl ${d1.fiaRode.concat(d2.fiaRode).slice(0, 3).join(', ')}`);
  assert(d1.st.cups >= 2, `Kurt drack bara ${d1.st.cups} koppar`);
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
  if (w.badReserved) f.push(`${tag}: e.reserved stämde inte med de som kliver på (${w.badReserved} steg)`);
  if (w.idleWaitMax > 15) f.push(`${tag}: någon stod ${w.idleWaitMax.toFixed(0)} s utan tilldelad hiss medan en ledig hiss som kunde ta hen stod still`);
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
    sim(seed, { strategy, autoInc: true });
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
// Allt går via act() som gränssnittet, så åtgärderna spelas in och kan spelas upp (replay-testet nedan).
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
};
const FUZZ_SEEDS = Array.from({ length: 24 }, (_, i) => 5000 + i);
test(`Spelaråtgärder: invarianter över ${FUZZ_SEEDS.length} dygn med slumpade åtgärder (även på natten)`, () => {
  const strategies = ['smart', 'buttons', 'peak', 'eco', 'nearest', 'random'];
  const names = Object.keys(PLAYER_ACTIONS), fails = [];
  let actions = 0;
  for (const [i, seed] of FUZZ_SEEDS.entries()) {
    const strategy = strategies[i % strategies.length], tag = `frö ${seed} (${strategy})`;
    sim(seed, { strategy, autoInc: i % 2 === 0, maint: 'natt' });
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
    if (w.brokenUse) fails.push(`${tag}: trasig hiss/service användes ${w.brokenUse} steg`);
    if (w.selfDest) fails.push(`${tag}: någon väntade på hiss till sin egen våning (${w.selfDest} steg)`);
    // (en brand eller ett strömavbrott som fortfarande pågår när dygnet slutar låser hissarna med rätta)
    const stuckMode = e => e.mode === 'service' || (!S.fire && (e.mode === 'recall' || e.mode === 'locked')) || (!S.outage && (e.mode === 'rescue' || e.mode === 'dead'));
    if (S.elevators.some(stuckMode))
      fails.push(`${tag}: hiss kvar i läge ${S.elevators.filter(stuckMode).map(e => `${e.name}:${e.mode}`).join(' ')} när dygnet tog slut`);
    fails.push(...newInvariantFails(w, tag));
  }
  assert(fails.length === 0, `${fails.length} fel:\n  ${fails.slice(0, 12).join('\n  ')}`);
  return `${actions} spelaråtgärder över ${FUZZ_SEEDS.length} dygn utan fel`;
});

// ---------- Replay ----------
/** allt som beskriver hur dygnet blev (loggens längd räknas inte – uppspelningen loggar en rad till) */
function replayPrint() {
  const st = S.stats;
  return JSON.stringify([st, S.nextId, S.people.length, S.elevators.map(e => [e.pos, e.trips, e.distance, e.wear, e.mode, e.kwh])]);
}
test('Replay: ett dygn med slumpade spelaråtgärder spelas upp exakt likadant (även dag 2 och via länken)', () => {
  const r = mulberry(4242);
  sim(77, { autoInc: true });
  runDay(); S.day++; resetDay(); // dag 2: slitaget från dag 1 måste följa med i inspelningen
  const names = Object.keys(PLAYER_ACTIONS);
  let next = 3;
  while (!S.summaryShown) {
    if (S.t >= next) { PLAYER_ACTIONS[names[Math.floor(r() * names.length)]](r); next = S.t + 2 + r() * 12; }
    step(DT);
  }
  const rec = recording(), want = replayPrint();
  assert(rec.actions.length > 30, `bara ${rec.actions.length} åtgärder spelades in`);
  const link = encodeReplay(rec), back = decodeReplay(link);
  assert(back && JSON.stringify(back) === JSON.stringify(rec), 'länken gick inte att läsa tillbaka');
  assert(decodeReplay('inte-en-replay') === null && decodeReplay(encodeReplay({ ...rec, actions: [{ n: 1, a: 'hacka', args: [] }] })) === null, 'trasiga länkar godtogs');
  startReplay(back);
  assert(act('bus') === null && S.actions.length === rec.actions.length, 'spelaren kunde ändra dygnet under uppspelningen');
  while (!S.summaryShown) step(DT);
  const got = replayPrint();
  assert(got === want, `uppspelningen blev ett annat dygn:\n${want.slice(0, 300)}\n${got.slice(0, 300)}`);
  return `${rec.actions.length} åtgärder på dag ${rec.day} · länk ${link.length} tecken · identiskt dygn`;
});
