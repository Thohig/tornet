// Testsviten för simuleringen. Ingen grafik, HUD eller DOM – samma tester körs i webbläsaren
// (tests.html via browser.js) och i terminalen (npm test via run.mjs).
// Varje test seedar slumpen, så resultaten är exakt reproducerbara.
import { S, hooks, hour } from '../src/state.js';
import { floorOpen, FLOOR_HOURS, idx, floorWith, EL, LOBBY, SKY, HOME_FLOORS } from '../src/config.js';
import { DT, step, advance, newSim } from '../src/sim.js';
import {
  startFire, setFireMode, startOutage, startGenerator, toggleAutoRescue,
  toggleOff,
} from '../src/incidents.js';
import { liftsAvailable, spawnBus } from '../src/people.js';
import { loadKg, allowed, safeFloor } from '../src/dispatch.js';
import { RATED_KG, FULL_LOAD } from '../src/config.js';
import { needsFreight, mayUseFreight, legDest } from '../src/people.js';
import { fl } from '../src/util.js';

// ---------- Ramverk ----------
export const tests = [];
const test = (name, fn) => tests.push({ name, fn });
export class Fail extends Error {}
function assert(cond, msg) { if (!cond) throw new Fail(msg); }

// ---------- Hjälp ----------
function sim(seed, opts = {}) {
  newSim(seed, { strategy: 'smart', autoInc: false, ...opts });
  S.started = true; S.paused = false;
  hooks.incident = () => {}; hooks.dayEnd = () => {};
}
// Vakt som kontrollerar invarianter efter varje steg
function watcher() {
  const w = { passes: 0, maxRide: 0, maxWait: 0, n: 0, overweight: 0, maxKg: 0, bypassBroken: 0, prev: [],
    outOfRange: 0, wrongDoor: 0, badLeg: 0, badFreight: 0, vipMixed: 0, vipSet: [], selfDest: 0 };
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
      // full last: över 80 % stannar hissen bara för avstigning, inte för nya hämtningar
      if (e.state === 'doors' && w.prev[i] === 'moving' && e.mode === 'normal' && kg >= e.ratedKg * FULL_LOAD
        && !e.passengers.some(p => p.dest === e.floor)) w.bypassBroken++;
      w.prev[i] = e.state;
      // de som redan var ombord eller på väg in när VIP-läget slogs på får åka med
      if (!e.vipLock) w.vipSet[i] = null;
      else if (!w.vipSet[i]) w.vipSet[i] = new Set(S.people.filter(p => p.car === e && (p.state === 'ride' || p.state === 'boarding')));
      const a = before[i], b = e.pos;
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
for (const [strategy, maxAvg, maxLongest] of /** @type {[string, number, number][]} */ ([['smart', 18, 200], ['nearest', 35, 400], ['random', 45, 400]])) {
  test(`Hel dag med strategin ${strategy}: alla kommer fram`, () => {
    sim(2024, { strategy });
    const w = watcher();
    runDay(w);
    assert(w.passes === 0, `hissar åkte förbi passagerares mål ${w.passes} gånger`);
    assert(w.overweight === 0, `hissar körde överlastade ${w.overweight} gånger`);
    assert(w.bypassBroken === 0, `hiss med full last stannade för hämtning ${w.bypassBroken} gånger`);
    assert(S.stats.served > 500, `för få resor: ${S.stats.served}`);
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
test('Dygnet går 06:00–06:00 och natten går fortare', () => {
  sim(41); runUntil(22); const day = S.t; runDay();
  const night = S.t - day;
  assert(S.t > 1900 && S.t < 2200, `ett dygn tog ${S.t.toFixed(0)} simuleringssekunder`);
  assert(night < day / 4, `natten (${night.toFixed(0)}s) går inte fortare än dagen (${day.toFixed(0)}s)`);
  return `dag 06–22: ${day.toFixed(0)} s · kväll+natt 22–06: ${night.toFixed(0)} s (simuleringstid)`;
});
test('Natten: låg belastning, nattpersonal och hissar i nattläge', () => {
  sim(42); runUntil(23.5);
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
  assert(maxSleeping >= 2, `bara ${maxSleeping} hissar gick i nattläge`);
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
      if (h < close + 0.6 && h >= open) continue; // en halvtimmes marginal att gå därifrån
      for (const p of S.people) {
        const there = p.floor === f && p.state === 'office';
        const going = p.goal === f && ['toQueue', 'wait', 'boarding', 'ride'].includes(p.state);
        if ((there || going) && (p.kind === 'vis' || (p.kind === 'emp' && p.home !== f))) bad.push(`${p.name} ${there ? 'på' : 'på väg till'} ${f} kl ${h.toFixed(1)}`);
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
  sim(7); run(200);
  startFire(idx('7')); run(3); setFireMode('recall'); run(60);
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
  assert(S.stats.evacuated > 10, `bara ${S.stats.evacuated} utrymda`);
  return `${S.stats.evacuated} utrymda, ${S.stats.smoked} rökexponerade, hissarna i drift igen efter släckning`;
});
test('Brand + spärrad zon: hissarna håller sig under brandzonen', () => {
  sim(8); run(220);
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
  sim(9); run(250);
  startFire(idx('4')); run(60);
  assert(S.stats.smoked > 0, 'ingen blev rökexponerad trots normal drift');
  return `${S.stats.smoked} rökexponerade`;
});

// ---------- Strömavbrott ----------
test('Strömavbrott utan åtgärd: hissarna står still, folk sitter fast, strömmen kommer tillbaka', () => {
  sim(11); run(230); untilSomeoneRiding();
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
  sim(12); run(230); untilSomeoneRiding();
  startOutage(); run(1);
  const trappedAtStart = S.elevators.filter(e => e.passengers.length && !(e.state === 'doors' && e.door >= 0.95)).length;
  startGenerator(); run(6); toggleAutoRescue(true);
  run(70);
  const stillTrapped = S.elevators.filter(e => e.mode === 'normal' && e.passengers.length).reduce((a, e) => a + e.passengers.length, 0);
  assert(!S.power, 'strömmen hann komma tillbaka – testet mäter fel sak');
  assert(stillTrapped === 0, `${stillTrapped} personer sitter fortfarande fast`);
  return `${trappedAtStart} hissar med instängda räddades med reservkraft`;
});

test('Hiss ur drift får inga nya resenärer', () => {
  sim(14); run(200);
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
  assert(x.every(e => e.trips > 10), `expresshissarna gick nästan inte: ${x.map(e => e.trips).join(', ')}`);
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
  sim(63);
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
  runUntil(29.5);
  const home = res().filter(p => p.floor === p.home && p.state === 'office').length;
  const asleep = res().filter(p => p.sleeping).length;
  assert(away >= 3, `bara ${away} boende var borta klockan 11`);
  assert(home === n, `${n - home} boende är inte hemma klockan 05:30`);
  assert(asleep >= n - 1, `bara ${asleep} av ${n} sover klockan 05:30`);
  return `${n} boende · ${away} borta 11:00 · alla hemma och ${asleep} sover 05:30`;
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

// ---------- Regression: fingeravtryck mot facit ----------
// Varje fall kör ett helt dygn och sammanfattar det. Facit ligger i tests/golden.json.
// Ändras beteendet oavsiktligt (t.ex. vid en omstrukturering) larmar testet och visar exakt vad som skilde.
// Avsiktliga ändringar godkänns med:  npm run golden
export const GOLDEN_CASES = [
  ...[101, 102, 103, 104, 105, 106, 107, 108].map(seed => ({ seed, strategy: 'smart' })),
  { seed: 201, strategy: 'nearest' }, { seed: 202, strategy: 'nearest' },
  { seed: 301, strategy: 'random' }, { seed: 302, strategy: 'random' },
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
// Sällsynta fel visar sig bara med vissa frön – därför körs många hela dygn med slumpade incidenter.
const MANY_SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i);
test(`Invarianter över ${MANY_SEEDS.length} slumpade dygn (alla strategier, med incidenter)`, () => {
  const strategies = ['smart', 'smart', 'nearest', 'random'];
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
    if (w.selfDest) fails.push(`${tag}: någon väntade på hiss till sin egen våning (${w.selfDest} steg)`);
    trips += S.stats.served; incidents += S.stats.incidents;
    worstWait = Math.max(worstWait, w.maxWait); heaviest = Math.max(heaviest, w.maxKg);
  }
  assert(fails.length === 0, `${fails.length} fel:\n  ${fails.slice(0, 10).join('\n  ')}`);
  return `${trips} resor och ${incidents} incidenter utan fel · längsta väntan ${worstWait.toFixed(0)} s · tyngsta avgång ${Math.round(heaviest)} kg`;
});
