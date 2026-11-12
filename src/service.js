// Drift: slitage, hissfel, hisstekniker, nattservice och energi.
// Hissarna slits av varje stopp och varje våning de kör (mer med tung last). Slitna hissar går oftare
// sönder – då larmas hissjouren och en hisstekniker kommer och lagar. Med nattservice går teknikern
// igenom de mest slitna hissarna på natten. Slitaget följer med till nästa dygn.
// Energin räknas fysikaliskt: korgen balanseras av en motvikt (korgen + 45 % av märklasten), så
// motorn drar ström när den lyfter obalansen och återmatar el när obalansen drar den.
import { pick, rand, rng } from './rng.js';
import { fl } from './util.js';
import { BALANCE, DOOR_T, FLOOR_M, CAR_H, floorY, shaftCX, timeScale } from './config.js';
import { S, hour, log, notice } from './state.js';
import { needsFreight, pev, pn, rerouteStranded, spawnStaff } from './people.js';
import { rebuildPicks, travel, cabinKg } from './dispatch.js';
import { bounceBoarders, exitAll, restoreElevator } from './elevators.js';

// ---------- Energi ----------
export const MOVE_KW = 3;      // friktion, drivsystem och ventilation när korgen rör sig
export const MOTOR_EFF = 0.8;    // motorns verkningsgrad när den lyfter
export const REGEN = 0.45;       // andel av lägesenergin som återmatas till nätet när obalansen drar
export const STANDBY_KW = 0.25, SLEEP_KW = 0.05; // styrsystem, belysning och fläkt; nattläge släcker det mesta
/** obalans i kg åt färdriktningen: > 0 = motorn måste lyfta, < 0 = obalansen drar (återmatning) */
export const imbalance = (kg, rated, dir) => (kg - BALANCE * rated) * Math.sign(dir);
/** effekt i kW för en korg med lasten kg som åker med v våningar/s åt dir (negativt = återmatar) */
export function powerKw(kg, rated, v, dir) {
  if (!v || !dir) return 0;
  const lift = imbalance(kg, rated, dir) * 9.81 * v * FLOOR_M / 1000;
  return MOVE_KW + (lift > 0 ? lift / MOTOR_EFF : lift * REGEN);
}
/** energi i kWh för att köra floors våningar (med tecken) med lasten kg – används av energisparläget */
export function moveKwh(kg, rated, floors) {
  if (!floors) return 0;
  const lift = imbalance(kg, rated, floors) * 9.81 * Math.abs(floors) * FLOOR_M / 3.6e6;
  return MOVE_KW * travel(Math.abs(floors)) / 3600 + (lift > 0 ? lift / MOTOR_EFF : lift * REGEN);
}
function energyTick(e, dt) {
  const kg = cabinKg(e);
  e.kw = e.state === 'moving' ? powerKw(kg, e.ratedKg, e.v, e.dir) : 0;
  // vänteläget räknas i spelets klocktid (natten går fortare), körningen i verklig simuleringstid
  const standby = (e.sleep || e.mode === 'dead' || !S.power ? SLEEP_KW : STANDBY_KW) * dt * timeScale(hour()) / 3600;
  const run = e.kw * dt / 3600;
  // extrafläkten i maskinrummet drar också ström
  const fan = e.fan ? FAN_KW * dt / 3600 : 0;
  e.kwh += standby + run + fan;
  S.stats.energy += standby + run + fan; S.stats.energyRun += run;
  if (run < 0) S.stats.regen -= run;
}

// ---------- Slitage och fel ----------
// (kalibrerat för ett dygn på 6 minuter: ungefär 350 stopp per dygn i hela huset)
export const WEAR_STOP = 0.0022, WEAR_FLOOR = 0.00055, FAULT_K = 0.034, SERVICE_AT = 0.2;
export const FAULTS = ['dörrfel – dörrarna går inte att stänga', 'motorn överhettad', 'styrkortet hänger sig', 'nivåfel – korgen stannar ojämnt', 'bromsen kärvar', 'vajerlarm'];
function wearTick(e) {
  const stops = e.trips - e.wearTrips, dist = e.distance - e.wearDist;
  if (!stops && !dist) return;
  // tung last sliter mer på linor, broms och motor
  e.wear += stops * WEAR_STOP + dist * WEAR_FLOOR * (1 + cabinKg(e) / e.ratedKg);
  e.wearTrips = e.trips; e.wearDist = e.distance;
}
/** Anropas när dörrarna har öppnat helt och folk klivit av: går hissen sönder här? */
export function maybeBreak(e) {
  if (e.mode !== 'normal' || e.hold) return false;
  if (!e.breakNext) {
    if (!S.autoInc || !S.power || S.fire) return false;
    if (rng() >= FAULT_K * e.wear * e.wear) return false;
  }
  breakDown(e, e.stormFault ? 'vajerlarm – linorna slog i schaktet i stormen' : pick(FAULTS));
  e.stormFault = false;
  return true;
}
export function breakDown(e, what) {
  e.breakNext = false;
  e.mode = 'broken'; e.hold = false; e.parkTarget = null; e.dir = 0; e.v = 0;
  e.floor = Math.round(e.pos);
  e.fault = { what, t0: S.t, need: rand(12, 20) };
  e.state = 'doors'; e.doorPhase = 'open';
  bounceBoarders(e);
  const n = e.passengers.length;
  if (n) exitAll(e, e.floor, `Hiss ${e.name} gick sönder (${what})`);
  e.carCalls.clear();
  for (const p of S.people) if (p.state === 'wait' && p.assigned === e.id) { p.assigned = null; pev(p, `Hiss ${e.name} gick sönder – systemet letar en ny hiss åt mig`); }
  for (const c of Object.values(S.calls)) if (c.car === e.id) c.car = null;
  S.stats.faults++;
  log(`🔧 ${e.name} gick sönder på ${fl(e.floor)}: ${what}${n ? ` – ${n} passagerare kliver ut` : ''}`, 'alert', e.color);
  rerouteStranded();
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 30, text: 'KLONK!', color: '#ff9f1c', life: 1.6 });
  rebuildPicks();
}
/** Spelaren utlöser ett hissfel: en hiss som kör eller står öppen går sönder vid nästa stopp */
export function triggerFault() {
  const ok = S.elevators.filter(e => e.mode === 'normal' && !e.hold && !e.breakNext);
  if (!ok.length) return;
  // helst en hiss med passagerare eller stopp kvar – då händer det snart
  const busy = ok.filter(e => e.passengers.length || e.carCalls.size);
  const e = pick(busy.length ? busy : ok);
  if (e.state === 'doors' && e.door >= 1 && e.stops.has(e.floor)) breakDown(e, pick(FAULTS));
  else { e.breakNext = true; log(`🔧 ${e.name} låter konstigt… den går sönder vid nästa stopp`, 'alert', e.color); }
}

// ---------- Hisstekniker ----------
export const tech = () => S.people.find(p => p.role === 'hisstekniker' && !p.dead) || null;
export const nightWindow = (h = hour()) => h >= 21 && h < 27;
/** våningen teknikern ska till för hissen e */
export const jobFloor = e => (e.mode === 'broken' ? e.floor : e.home);
/** Nästa jobb: trasiga hissar först, sedan (på natten, med nattservice) den mest slitna. */
function chooseJob() {
  const broken = S.elevators.filter(e => e.mode === 'broken').sort((a, b) => a.fault.t0 - b.fault.t0);
  if (broken.length) return broken[0];
  // service som spelaren har beställt (t.ex. nivåjustering efter ett snubbel) görs direkt, även på dagen
  const asap = S.elevators.find(e => e.serviceAsap && e.mode === 'normal');
  if (asap && !S.fire && S.power) return asap;
  if (S.maint !== 'natt' || !nightWindow() || S.fire || !S.power) return null;
  // varuhissen servas först när ingen med tung last (städvagn, verktygslåda) är kvar i huset
  const heavy = S.people.some(p => needsFreight(p) && p.state !== 'away');
  const worn = S.elevators.filter(e => e.mode === 'normal' && e.wear >= SERVICE_AT && !(e.freight && heavy)).sort((a, b) => b.wear - a.wear);
  return worn[0] || null;
}
/** Teknikerns nästa beslut (anropas från personernas rollogik i people.js) */
export function techNext(p) {
  if (p.job !== null && p.job !== undefined) {
    const e = S.elevators[p.job];
    if (e.mode === 'broken' || e.hold) return [jobFloor(e), p.task, false];
    p.job = null;
  }
  const e = chooseJob();
  if (!e) return [p.exitFloor, 'Inga fler hissjobb – åker hem'];
  p.job = e.id; e.techId = p.id; p.workT = 0;
  if (e.mode === 'broken') p.task = `Lagar hiss ${e.name}: ${e.fault.what}`;
  else {
    e.hold = true;
    // gruppen behöver en vaken hiss medan den här är på service
    const twin = S.elevators.find(x => x !== e && x.group === e.group && x.sleep);
    if (twin) { twin.sleep = false; twin.sleepT = 0; log(`☀️ ${twin.name} vaknar – ${e.name} ska på service`, 'park', twin.color); }
    p.task = e.serviceAsap ? `Nivåjustering och service på hiss ${e.name}` : `Nattservice på hiss ${e.name} (slitage ${Math.round(e.wear * 100)} %)`;
    log(`🔧 ${e.name} tas ur trafik för ${e.serviceAsap ? 'beställd service' : 'nattservice'} – kör hem till ${fl(e.home)}`, 'alert', e.color);
    rerouteStranded();
  }
  return [jobFloor(e), p.task, false]; // jobbet kan ligga i entrén – det är ingen hemgång
}
function callTech(why) {
  S.techCallAt = S.t + rand(8, 15);
  log(`📞 ${why} – hissteknikern är på väg`, 'alert');
}
function techTick(dt) {
  const t = tech();
  // hissar vars tekniker försvann (t.ex. utrymde vid brand) släpps
  for (const e of S.elevators) {
    if (e.techId === null) continue;
    if (!t || t.job !== e.id) {
      e.techId = null;
      if (e.hold && e.mode === 'normal') e.hold = false;
      // påbörjad nattservice utan tekniker: hissen stängs och går i trafik igen (servas en annan natt)
      else if (e.mode === 'service') {
        e.hold = false; restoreElevator(e);
        log(`🔧 ${e.name}: nattservicen avbröts – hissen går i trafik igen`, 'alert', e.color);
      }
    }
  }
  if (!t && S.techCallAt === null && !S.fire) {
    if (S.elevators.some(e => e.mode === 'broken')) callTech('Hissjouren larmas');
    else if (S.elevators.some(e => e.serviceAsap) && chooseJob()) callTech('Beställd service');
    else if (chooseJob()) callTech('Nattservice av slitna hissar');
  }
  if (!t && S.techCallAt !== null && S.t >= S.techCallAt) { S.techCallAt = null; if (chooseJob()) spawnStaff('hisstekniker'); }
  if (!t || t.job === null || t.job === undefined) return;
  const e = S.elevators[t.job];
  if (t.state !== 'office' || t.floor !== jobFloor(e)) return;
  if (e.mode === 'normal' && e.hold) {
    // nattservice: börjar när hissen står tom och stilla hemma
    if (e.homeT < 0.5 || e.passengers.length || e.reserved) return;
    e.mode = 'service'; e.sleep = false; e.floor = e.home; e.state = 'doors'; e.doorPhase = 'open'; e.dir = 0;
    e.serviceNeed = rand(0.3, 0.5) * 3600 / timeScale(hour()); // en knapp halvtimme i speltid
    pev(t, `Öppnar hiss ${e.name} och börjar serva`);
    log(`🔧 ${pn(t)} servar ${e.name} på ${fl(e.home)}`, 'alert', e.color, t.id);
    return;
  }
  if (e.mode !== 'broken' && e.mode !== 'service') return;
  t.workT += dt;
  if (t.workT < (e.mode === 'broken' ? e.fault.need : e.serviceNeed)) return;
  if (e.mode === 'broken') {
    const down = S.t - e.fault.t0;
    S.stats.repairs++; S.stats.downSec += down;
    e.wear = Math.max(0.1, e.wear * 0.8); // lagad, men fortfarande sliten – bara service nollställer
    log(`✅ ${e.name} är lagad efter ${Math.round(down)} s (${e.fault.what})`, 'alert', e.color);
    pev(t, `Hiss ${e.name} är lagad`);
    e.fault = null;
  } else {
    S.stats.serviced++;
    log(`✅ Nattservice klar på ${e.name} – slitaget ${Math.round(e.wear * 100)} % → 5 %`, 'alert', e.color);
    pev(t, `Servicen på hiss ${e.name} är klar`);
    e.wear = 0.05; e.serviceAsap = false;
  }
  e.hold = false; e.techId = null;
  restoreElevator(e);
  t.job = null; t.workT = 0; t.timer = rand(1, 3); // nästa beslut strax
}

// ---------- Motorvärme ----------
// Varje start och stopp värmer motorn (mer med tung last), och den svalnar långsamt. En varm motor kör
// långsammare; blir den för het löser överhettningsskyddet ut: hissen kör klart sina passagerare,
// tar inga nya och står still tills motorn har svalnat. Extrafläkten (spelarens åtgärd) kyler fortare.
export const HEAT_STOP = 0.05, HEAT_TAU = 55, FAN_TAU = 15, FAN_KW = 1.2, WARM_AT = 0.8, COOL_AT = 0.5;
/** ett stopp värmer motorn */
export function heatOnStop(e) { e.heat += HEAT_STOP * (0.5 + cabinKg(e) / e.ratedKg); }
/** varm motor kör långsammare */
export const heatMul = e => (e.heat >= WARM_AT ? 0.8 : 1);
function heatTick(e, dt) {
  e.heat += Math.max(0, e.kw) * dt * 0.0004; // lyfter tungt = värme
  e.heat -= e.heat * dt / (e.fan ? FAN_TAU : HEAT_TAU);
  if (!e.hot && e.heat >= 1 && e.mode === 'normal') {
    e.hot = true; S.stats.heatStops++;
    log(`🌡️ ${e.name}: motorn är överhettad – överhettningsskyddet löser ut, hissen tar inga nya resenärer`, 'alert', e.color);
  } else if (e.hot && e.heat < COOL_AT) {
    e.hot = false;
    log(`🌡️ ${e.name}: motorn har svalnat – i trafik igen`, 'alert', e.color);
  }
  if (e.fan && !e.hot && e.heat < 0.25) { e.fan = false; log(`🌀 ${e.name}: extrafläkten stängs av`, 'alert', e.color); }
}
/** Spelaren startar extrafläkten i maskinrummet */
export function startFan(e) {
  if (!e || e.fan) return;
  e.fan = true;
  log(`🌀 Extrafläkten startas i ${e.name}s maskinrum – motorn kyls snabbare (drar ${FAN_KW} kW)`, 'alert', e.color);
}
/** Slumpad incident: kylfläkten hakar upp sig och motorn i en hiss som kör mycket blir het */
export function triggerHeat() {
  const ok = S.elevators.filter(e => e.mode === 'normal' && !e.hot && !e.hold);
  if (!ok.length) return;
  const busy = ok.filter(e => e.passengers.length || e.carCalls.size);
  const e = pick(busy.length ? busy : ok);
  e.heat = Math.max(e.heat, 1.05);
  log(`🌡️ Kylningen i ${e.name}s maskinrum hakar upp sig – motorn blir het`, 'alert', e.color);
}

// ---------- Nivåfel ----------
// Bärlinorna töjer sig när lasten ändras medan dörrarna står öppna, så korgen sjunker (eller stiger) en
// bit. Når det LEVEL_TOL justerar hissen nivån (dörrarna hålls öppna en stund). Slitna linor töjer sig
// mer, och i en sliten hiss kan den som kliver på eller av snubbla på kanten.
export const STRETCH = 0.05, LEVEL_TOL = 0.025;
/** anropas när hissen öppnar: korgen står i nivå */
export function levelStart(e) { e.lvKg = cabinKg(e); e.level = 0; }
/** medan dörrarna står öppna */
export function levelTick(e) {
  const kg = cabinKg(e);
  e.level = -(kg - (e.lvKg || 0)) / e.ratedKg * STRETCH * (1 + 2 * e.wear);
  if (Math.abs(e.level) > LEVEL_TOL) {
    e.lvKg = kg; e.level = 0; e.dwellNeed += 0.25; S.stats.relevels++;
  }
}
/** Kliver någon på eller av när korgen inte står i nivå? Då kan hen snubbla. */
export function maybeStumble(e, p) {
  if (Math.abs(e.level || 0) < LEVEL_TOL * 0.45 || e.wear < 0.4 || rng() >= 0.06 * e.wear) return;
  const cm = Math.round(Math.abs(e.level) * 350);
  S.stats.stumbles++;
  p.mood = Math.max(p.mood || 0, 1);
  pev(p, `Snubblar på tröskeln – hiss ${e.name} stod ${cm} cm ${e.level < 0 ? 'för lågt' : 'för högt'}!`);
  log(`🦶 ${pn(p)} snubblade på tröskeln i ${e.name} (nivåfel ${cm} cm, slitage ${Math.round(e.wear * 100)} %)`, 'alert', e.color, p.id);
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 30, text: 'OJ!', color: '#ffe14d', life: 1.2 });
  if (!(S.t - (e.stumbleNoted ?? -99) < 40)) {
    e.stumbleNoted = S.t;
    notice('stumble', `🦶 Snubbel i hiss ${e.name}`,
      `${p.name} snubblade på tröskeln på ${fl(e.floor)}: korgen stod ${cm} cm ${e.level < 0 ? 'för lågt' : 'för högt'}. Linorna i ${e.name} är slitna (${Math.round(e.wear * 100)} %) och töjer sig när folk kliver på och av.`,
      { car: e.id, floor: e.floor, act: `level:${e.id}`, actLabel: '🔧 Beställ service nu' });
  }
}
/** Spelaren beställer service (nivåjustering) – teknikern kommer direkt, även på dagen */
export function orderService(e) {
  if (!e || e.serviceAsap || e.mode !== 'normal') return;
  e.serviceAsap = true;
  log(`🔧 Service beställd för ${e.name} – hissteknikern larmas`, 'alert', e.color);
}

export function serviceTick(dt) {
  for (const e of S.elevators) {
    wearTick(e);
    energyTick(e, dt);
    heatTick(e, dt);
    if (e.state === 'doors' && e.doorPhase === 'open') levelTick(e); else if (e.state !== 'doors') e.level = 0;
    // trasiga hissar och hissar i service står med öppna dörrar
    if ((e.mode === 'broken' || e.mode === 'service') && e.door < 1) e.door = Math.min(1, e.door + dt / DOOR_T);
    // hiss som väntar på nattservice kör hem tom
    if (e.hold && e.mode === 'normal' && e.state === 'idle' && !e.passengers.length && !e.carCalls.size && Math.round(e.pos) !== e.home) e.parkTarget = e.home;
    // hur länge den har stått stilla hemma (servicen börjar först då)
    e.homeT = e.hold && e.mode === 'normal' && e.state === 'idle' && Math.abs(e.pos - e.home) < 1e-6 ? (e.homeT || 0) + dt : 0;
  }
  techTick(dt);
}
