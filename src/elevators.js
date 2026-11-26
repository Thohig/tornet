// Hissarna: rörelse, dörrar, av-/påstigning och incidentlägen.
import { stream } from './rng.js';
import { sv } from './sv.js';
const { rand, rng } = stream('hissar');
import { ARR, fl } from './util.js';
import { ACC, CAP, DOOR_T, DWELL, EL, LOBBY, VMAX, shaftCX, CAR_H, floorY } from './config.js';
import { S, log } from './state.js';
import { arriveOnFloor, elevatorAllows, liftsAvailable, pev, pn, setTrip, toStairs, queueSpot } from './people.js';
import {
  safeFloor, aheadOf, allowed, allowedDest, allowedPos, assignedTo, isFull, maybePark, rebuildPicks, stopFloors, loadKg,
  personKg, slotsFull, benched, keyed, posOf, outReason, outText, etaOutcome,
} from './dispatch.js';
import { answerCalls, buttonsMode, clearCall } from './buttons.js';
import { panoDue, panoStick } from './pano.js';
import { maybeBreak, heatOnStop, heatMul, levelStart, maybeStumble, snapStep, snapDue, snapCable, trapDue, trapBreak } from './service.js';
import { doorHold, politeHold } from './cast.js';
import { liftStep } from './hoist.js';
import { windMul } from './weather.js';
import { peakHold } from './dispatch.js';
import { crashRun, crashStop, sweepDir, sweepStop } from './crash.js';
/** @typedef {import('./people.js').Person} Person */

// ---------- Hissar ----------
/** Ett hissfel som väntar på tekniker (service.js) @typedef {{ what: string, t0: number, need: number, kind?: string, tool?: string, cable?: boolean, exitF?: number, done?: number, trapped?: boolean, n?: number, nextTalk?: number, pano?: boolean, crank?: { to: number, by: number, open: boolean, why: string } }} Fault */
/** Linbrottet: fall → fast → utrymning (service.js) @typedef {{ ph: string, t0: number, stopAt: number, caughtT: number, exitF: number, n: number, out: number, nextOut: number, climb: number }} Snap */
/**
 * En hiss. Läget (`pos`, `floor`, `carCalls`, `pick`, `stops`) räknas i nedre däckets våningar,
 * `serves` i riktiga våningar (se posOf/deckFloor i dispatch.js). Grundfälten sätts i `makeElevator`,
 * de valfria av delsystemen när de behövs.
 * @typedef {{
 *   id: number, name: string, color: string, pos: number, v: number, dir: number, pick: Record<string, number>,
 *   serves: Set<number>, stops: Set<number>, upper: Set<number>, legs: number[][], deck2: boolean, minF: number, maxF: number,
 *   home: number, group: string, ratedKg: number, freight: boolean, express: boolean, facade: boolean, terraceF: number,
 *   liftWant: boolean, state: string, doorPhase: 'opening'|'open'|'closing'|null, door: number, dwell: number, dwellNeed: number,
 *   floor: number, passengers: import('./people.js').Person[], reserved: number, carCalls: Set<number>,
 *   parkTarget: number|null, idleTime: number, distance: number, trips: number, lastOff: number, lastOn: number,
 *   target: number|null, targetKind: string|null, fullFlash: number, mode: string, off: boolean, hijack: boolean, rs: string|null,
 *   rescueTarget: number, snapNext: boolean, snap: Snap|null, wear: number, wearTrips: number, wearDist: number,
 *   fault: Fault|null, hold: boolean, homeT: number, techId: number|null, breakNext: boolean, serviceNeed: number,
 *   kw: number, kwh: number, cap: number, heat: number, hot: boolean, fan: boolean, level: number, lvKg: number,
 *   windLock: boolean, wetLock: boolean, serviceAsap: boolean, indep: boolean, medicHold: boolean, outWas: string, vipLock: boolean,
 *   sleep: boolean, zoneLock: boolean, creak: boolean, restartAt: number, ffCar: boolean, hotT0: number, trapNext: boolean,
 *   overloadFlash?: number, resKg?: number, pickKg?: number, panoNext?: boolean, bounce?: number, stormFault?: boolean,
 *   sleepT?: number, fightAt?: number, fought?: boolean, deckN?: number[], deckFull?: boolean[], stumbleNoted?: number,
 *   stuck?: boolean, heldTrip?: number, politeTrip?: number, skipTrip?: number, closeTrip?: number, carCallStop?: boolean,
 * }} Elevator
 */
/** @param {number} i @returns {Elevator} */
export function makeElevator(i) {
  const d = EL[i], pos = d.startF;
  return {
    id: i, name: d.name, color: d.color, pos, v: 0, dir: 0, pick: {},
    // serves = våningar där folk kliver på/av; stops = där korgen stannar (dubbeldäck: nedre däcket)
    serves: new Set(d.serves), stops: new Set(d.stops), upper: new Set(d.upper), legs: d.legs, deck2: d.deck2, minF: d.minF, maxF: d.maxF, home: d.home, group: d.group, ratedKg: d.ratedKg,
    freight: !!d.freight, express: !!d.express, facade: !!d.facade, terraceF: d.terraceF, liftWant: false,
    state: 'idle', doorPhase: null, door: 0, dwell: 0, dwellNeed: DWELL, floor: pos,
    passengers: [], reserved: 0, carCalls: new Set(), parkTarget: null, idleTime: 0,
    distance: 0, trips: 0, lastOff: 0, lastOn: 0, target: null, targetKind: null, fullFlash: 0,
    mode: 'normal', off: false, hijack: false, rs: null, rescueTarget: 0,
    // linbrott: snapNext = linorna går av vid nästa åktur, snap = förloppet (fall → fast → utrymning)
    snapNext: false, snap: null,
    // drift: slitage 0–1+, fel, hållen för service, tekniker, energi (kW just nu, kWh i dag)
    wear: 0, wearTrips: 0, wearDist: 0, fault: null,
    hold: false, homeT: 0, techId: /** @type {number|null} */ (null), breakNext: false, serviceNeed: 0, kw: 0, kwh: 0,
    cap: d.deck2 ? CAP * 2 : CAP, // platser i korgen (dubbeldäck: CAP per däck)
    // motorvärme (0–1+, överhettad = hot), extrafläkt, nivåfel (våningar, negativt = för lågt), stängd för vinden,
    // beställd service, oberoende drift (flyttdag)
    heat: 0, hot: false, fan: false, level: 0, lvKg: 0, windLock: false, wetLock: false, serviceAsap: false, indep: false,
    medicHold: false, // står kvar låst på patientens våning tills ambulanspersonalen kommer tillbaka (visits.js)
    outWas: '', // senaste orsaken till att hissen var ur trafiken (outReason) – hämtningarna släpps när den ändras
    vipLock: false, sleep: false, zoneLock: false,
    // incidenter: linorna knarrar (förvarning), omstart efter strömavbrott, brandhissen (brandkåren), när motorn blev het
    creak: false, restartAt: 0, ffCar: false, hotT0: 0, trapNext: false,
  };
}
/** Hinner hissen stanna på våning f? Falskt bara om f ligger framför den, närmare än bromssträckan. @param {Elevator} e */
export function canBrakeTo(e, f) {
  if (e.state !== 'moving' || !e.dir) return true;
  const ahead = (f - e.pos) * e.dir;
  return ahead <= 0 || ahead >= (e.v * e.v) / (2 * ACC) + e.v * (1 / 30) * 2 + 0.01;
}
/** toppfarten just nu: svajläget i storm och en varm motor sänker den @param {Elevator} e */
export const vmaxOf = e => VMAX * windMul(e) * heatMul(e);
/** @param {Elevator} e */
export function shouldStop(e, g, d) {
  if (!e.stops.has(g)) return false;
  if (!allowedPos(e, g) && !(e.zoneLock && g === e.minF)) return false; // spärrad hiss får köra ner till sin lägsta våning // expresshissar m.fl. stannar bara på sina våningar
  // Hiss-O-Matic har kraschat: nödläget stannar på varje våning (crash.js) – men en full korg kör förbi (vågen sitter i korgen)
  if (crashRun(e)) return sweepStop(e, g) && (e.carCalls.has(g) || !isFull(e));
  if (e.carCalls.has(g)) return true;
  if (isFull(e)) return false;
  if (assignedTo(e, g, d)) return true;
  if (assignedTo(e, g, -d) && !stopFloors(e).some(x => (x - g) * d > 0)) return true;
  return false;
}
/** Hissen kan inte hämta fler – personerna den skulle hämta (utom de som keep(p) behåller) får en ny hiss,
 *  och hallanropen den hade tagit (KNAPPAR) går tillbaka till gruppen. @param {Elevator} e */
export function releaseCalls(e, why, keep = /** @type {((p: any) => boolean)|null} */ (null)) {
  let n = 0;
  for (const p of S.people) {
    if (p.state === 'wait' && p.assigned === e.id && !(keep && keep(p))) {
      p.assigned = null; n++;
      pev(p, sv`Hiss ${e.name} ${why} – systemet letar en ny hiss åt mig`);
    }
  }
  let calls = 0;
  for (const c of Object.values(S.calls)) if (c.car === e.id) { c.car = null; calls++; }
  if (n) log(n > 1 ? sv`${e.name} ${why} – släpper ${n} hämtningar` : sv`${e.name} ${why} – släpper en hämtning`, 'move', e.color);
  if (n || calls) rebuildPicks();
}
/** Byter hissens läge. Alla byten går hit: lämnar hissen normal drift släpps väntande hämtningar direkt,
 *  så att ingen står och väntar på en hiss som inte kommer. @param {Elevator} e */
export function setMode(e, m) {
  const was = e.mode;
  e.mode = m;
  if (m !== 'normal' && was === 'normal') releaseCalls(e, outText(m) || m);
}
/** @param {Elevator} e */
export function updateElevator(e, dt) {
  e.fullFlash = Math.max(0, e.fullFlash - dt);
  e.overloadFlash = Math.max(0, (e.overloadFlash || 0) - dt);
  if (e.mode === 'snapped') { snapStep(e, dt); return; } // linbrott: fångapparaten är mekanisk och bryr sig inte om strömmen
  if (!S.power && e.mode !== 'rescue') { if (e.state === 'moving') e.v = 0; return; } // strömlös – står helt still
  if (e.mode === 'recall') { recallStep(e, dt); return; }
  if (e.mode === 'rescue') { rescueStep(e, dt); return; }
  if (e.mode === 'lift') { liftStep(e, dt); return; } // flyttlass från terrassen (hoist.js)
  if (e.mode !== 'normal') return; // låst (brand) eller utrymd (ström)
  // En full hiss behåller sina hämtningar (folk kliver av längre fram) men stannar inte för dem
  // förrän det finns plats. Omfördelningen flyttar dem om en annan hiss blir klart bättre.
  // hissen tas ur trafiken (överhettad, vind, avstängd, service, brandzon): släpp hämtningarna en gång, när det händer
  // (styrningen tilldelar den inga nya så länge orsaken finns kvar)
  const out = outReason(e);
  if (out && out !== e.outWas) releaseCalls(e, outText(out));
  e.outWas = out;
  // efter ett strömavbrott startar hissarna om en i taget
  if (e.restartAt && S.t < e.restartAt) { if (e.state === 'moving') e.v = 0; return; }
  if (e.state === 'doors') { updateDoors(e, dt); return; }
  if (e.state === 'idle') { idleEval(e, dt); if (/** @type {string} */ (e.state) !== 'moving') return; } // (idleEval kan sätta igång den)
  // ett hissfel som stoppar korgen mellan två våningar (folk sitter fast tills teknikern lagat den)
  if (trapDue(e)) { trapBreak(e); return; }
  if (panoDue(e)) { panoStick(e); return; } // (panoramahissen fastnar på fasaden – pano.js)
  moveStep(e, dt);
  // linorna har knarrat (triggerCable): de går av när korgen är mitt emellan två våningar
  if (snapDue(e)) snapCable(e);
}
// Brandzon: passagerare som klev på efter spärren och ska in i zonen släpps av vid hissens säkra våning
/** @param {Elevator} e */
function zoneReroute(e, f) {
  const drop = safeFloor(e) ?? e.minF;
  let here = false;
  for (const p of e.passengers) {
    const pd = deckFloor(e, p, drop);
    if (allowedDest(e, p) || p.dest === pd) continue;
    e.carCalls.delete(posOf(e, p.dest)); p.viaStairs = true; p.dest = pd; e.carCalls.add(drop);
    pev(p, sv`Brandzonen spärrad – hiss ${e.name} släpper av mig på ${fl(pd)}, sen trappan`);
    if (drop === f) here = true;
  }
  return here;
}
/** @param {Elevator} e */
export function idleEval(e, dt) {
  const f = Math.round(e.pos);
  e.pos = f; e.v = 0; e.target = null;
  if (S.fire && S.fire.mode === 'zone' && zoneReroute(e, f)) { arrive(e, f); return; }
  // nödläget (crash.js): korgen pendlar hela tiden och vänder vid schaktets ände
  if (crashRun(e)) { e.idleTime = 0; e.parkTarget = null; e.dir = sweepDir(e, f); if (e.dir) e.state = 'moving'; return; }
  const full = isFull(e), up = !full && assignedTo(e, f, 1), dn = !full && assignedTo(e, f, -1);
  if ((up || dn) && (e.dir === 0 || assignedTo(e, f, e.dir) || !aheadOf(e, f, e.dir))) { arrive(e, f); return; }
  const stops = stopFloors(e);
  if (stops.length === 0) {
    if (S.fire && S.fire.mode === 'zone' && !allowedPos(e, f) && f !== (safeFloor(e) ?? e.minF)) e.parkTarget = safeFloor(e) ?? e.minF;
    if (e.parkTarget === f) e.parkTarget = null;
    if (e.parkTarget === null) { e.dir = 0; e.idleTime += dt; maybePark(e); }
    if (e.parkTarget !== null && e.parkTarget !== f) { e.dir = Math.sign(e.parkTarget - f); e.state = 'moving'; }
    return;
  }
  e.idleTime = 0;
  if (e.dir !== 0 && aheadOf(e, f, e.dir)) { e.state = 'moving'; return; }
  if (e.dir !== 0 && aheadOf(e, f, -e.dir)) {
    log(sv`${e.name} vänder ${ARR(-e.dir)} – inga fler mål ${ARR(e.dir)}`, 'move', e.color);
    e.dir = -e.dir; e.state = 'moving'; return;
  }
  const near = stops.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));
  e.dir = Math.sign(near - f) || 1; e.state = 'moving';
}
/** @param {Elevator} e */
export function moveStep(e, dt) {
  const d = e.dir;
  if (d === 0) { e.state = 'idle'; return; }
  const brake = (e.v * e.v) / (2 * ACC);
  const slack = e.v * dt * 2 + 0.01; // marginal för att tidssteget varierar mellan bildrutor
  const startF = d > 0 ? Math.ceil(e.pos - 1e-6) : Math.floor(e.pos + 1e-6);
  const noStops = stopFloors(e).length === 0;
  // Ett stopp som hissen redan bromsar mot släpps aldrig – annars kan små variationer
  // i bildfrekvensen få bromskollen att tro att stoppet är för nära, så hissen åker förbi.
  const committed = e.targetKind === 'stop' && e.target !== null
    && (e.target - e.pos) * d > -1e-6 && shouldStop(e, e.target, d);
  let target = null, kind = 'halt';
  for (let g = startF; g >= e.minF && g <= e.maxF; g += d) {
    if (committed && (g - e.target) * d >= 0) { target = e.target; kind = 'stop'; break; }
    if ((g - e.pos) * d < brake - slack) continue; // hinner inte bromsa
    if (shouldStop(e, g, d)) { target = g; kind = 'stop'; break; }
    if (noStops && e.parkTarget === g) { target = g; kind = 'park'; break; }
  }
  if (target === null) {
    for (let g = startF; g >= e.minF && g <= e.maxF; g += d) {
      if ((g - e.pos) * d >= brake - slack) { target = g; break; }
    }
    if (target === null) target = d > 0 ? e.maxF : e.minF;
  }
  e.target = target; e.targetKind = kind;
  const dist = Math.max(0, (target - e.pos) * d);
  const vAllow = Math.sqrt(2 * ACC * dist);
  e.v = Math.min(e.v + ACC * dt, vmaxOf(e), vAllow);
  const step = e.v * dt;
  if (step >= dist || dist < 0.002) {
    e.pos = target; e.v = 0; e.distance += dist;
    if (kind === 'stop') arrive(e, target);
    else {
      if (kind === 'park') e.parkTarget = null;
      e.state = 'idle';
    }
  } else {
    e.pos += step * d; e.distance += step;
  }
}
/** @param {Elevator} e */
export function moveTo(e, target, vmax, dt) {
  const d = Math.sign(target - e.pos);
  // på väg åt andra hållet (återkallad i full fart): bromsa in först – en korg vänder inte på ett ögonblick
  if (e.v > 0 && e.dir && e.dir !== d) {
    e.v = Math.max(0, e.v - ACC * dt);
    const st = e.v * dt, np = Math.max(e.minF, Math.min(e.maxF, e.pos + e.dir * st));
    e.distance += Math.abs(np - e.pos); e.pos = np;
    return false;
  }
  if (!d) { e.v = 0; return true; }
  e.dir = d;
  const dist = Math.abs(target - e.pos);
  e.v = Math.min(e.v + ACC * dt, vmax, Math.sqrt(2 * ACC * dist));
  const st = e.v * dt;
  if (st >= dist || dist < 0.002) { e.distance += dist; e.pos = target; e.v = 0; return true; }
  e.pos += d * st; e.distance += st;
  return false;
}
/** @param {Elevator} e */
export function arrive(e, f) {
  e.carCallStop = e.carCalls.has(f); // stannade för en knapp i korgen (kan vara en felknapp)
  e.pos = f; e.v = 0; e.floor = f; e.carCalls.delete(f);
  let d = e.dir;
  const up = assignedTo(e, f, 1), dn = assignedTo(e, f, -1);
  if (d === 0) d = up ? 1 : dn ? -1 : 0;
  else if (!assignedTo(e, f, d) && !aheadOf(e, f, d)) {
    d = (assignedTo(e, f, -d) || aheadOf(e, f, -d)) ? -d : 0;
  }
  if (crashRun(e)) { d = sweepDir(e, f); crashStop(); }
  e.dir = d;
  if (buttonsMode()) answerCalls(e, f);
  e.state = 'doors'; e.doorPhase = 'opening'; e.dwell = 0; e.dwellNeed = DWELL;
  e.lastOff = 0; e.lastOn = 0; e.trips++; e.target = null;
  heatOnStop(e); levelStart(e);
  for (const p of e.passengers) if (posOf(e, p.dest) !== f) pev(p, sv`Hiss ${e.name} stannar på ${fl(deckFloor(e, p, f))} (inte mitt mål)`);
}
/** @param {Elevator} e */
export function updateDoors(e, dt) {
  const f = e.floor;
  if (e.doorPhase === 'opening') {
    e.door = Math.min(1, e.door + dt / DOOR_T);
    if (e.door >= 1) {
      e.doorPhase = 'open'; e.dwell = 0; unload(e, f);
      if (maybeBreak(e)) return;
      e.dwellNeed = Math.max(e.dwellNeed, peakHold(e, f));
    }
    return;
  }
  if (e.doorPhase === 'open') {
    e.dwell += dt;
    if (e.dwell > 0.3) e.dwellNeed += doorHold(e, f) + politeHold(e, f); // Doris (och andra artiga) håller upp dörren
    if (e.dwell > 0.6) closePress(e);
    if (e.dwell > 0.25 && !benched(e) && !e.hold) load(e, f);
    if (e.dwell >= e.dwellNeed && e.reserved === 0) {
      e.doorPhase = 'closing';
      // kyla: skorstenseffekten i entrén – dörren tar ibland emot och glider upp en bit igen
      const cold = f === LOBBY ? S.weather.cold : 0;
      e.bounce = 0;
      if (cold > 0 && rng() < 0.4 * cold) { e.fightAt = 0.35 + 0.3 * cold; e.fought = false; } else e.fightAt = -1;
      // spökstopp: dörrarna öppnade men ingen klev av eller på (felknapp, bus eller tomt anrop)
      if (!e.lastOff && !e.lastOn && e.skipTrip !== e.trips) {
        S.stats.ghostStops++;
        log(sv`👻 ${e.name} stannade på ${fl(f)} – ingen klev av eller på`, 'move', e.color);
      }
    }
    return;
  }
  // stänger: i kyla går det trögare i entrén, och dörren kan ta emot (glider upp igen en bit)
  const slow = f === LOBBY ? 1 + 1.5 * S.weather.cold : 1;
  if (e.bounce > 0) { const k = Math.min(e.bounce, dt / DOOR_T); e.door = Math.min(1, e.door + k); e.bounce -= k; return; }
  e.door = Math.max(0, e.door - dt / (DOOR_T * slow));
  if (e.fightAt > 0 && !e.fought && e.door <= e.fightAt) {
    e.fought = true; e.bounce = 0.3; S.stats.doorFights++;
    log(sv`❄️ ${e.name}: dörren tar emot i entrén – kalldraget trycker (skorstenseffekten)`, 'move', e.color);
    S.fx.push({ x: shaftCX(e.id), y: floorY(f) - CAR_H - 26, text: 'FSSSS!', color: '#bfeaff', life: 1.2, size: 14 });
  }
  if (e.door <= 0) { e.state = 'idle'; e.doorPhase = null; e.idleTime = 0; }
}
/**
 * STÄNG-knappen: en otålig passagerare trycker på den, gärna flera gånger. Med vanliga knappar (KNAPPAR)
 * stänger dörren lite tidigare; i destinationssystemen är knappen inte ens kopplad – som i många riktiga hissar.
 * @param {Elevator} e
 */
function closePress(e) {
  if (e.closeTrip === e.trips) return;
  const p = e.passengers.find(q => (q.mood || 0) >= 1 || q.quirk === 'gnäll');
  if (!p) return;
  e.closeTrip = e.trips;
  if (rng() > 0.35) return;
  S.stats.closePresses++;
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 22, text: 'STÄNG! STÄNG!', color: '#ffe14d', life: 1, size: 14 });
  if (buttonsMode()) {
    e.dwellNeed = Math.max(e.dwell + 0.1, e.dwellNeed - 0.6);
    pev(p, `Trycker på STÄNG fem gånger – dörren går igen lite tidigare`);
  } else pev(p, 'Trycker på STÄNG fem gånger – knappen är inte ens kopplad i det här systemet');
}
/** dubbeldäck: våningen där passageraren står när korgen är på f (övre däcket en våning högre) @param {Person} p @param {Elevator} e */
export const deckFloor = (e, p, f) => (e.deck2 && p.deck === 1 ? f + 1 : f);
/** @param {Person} p @param {Elevator} e */
export function exitPassenger(e, p, f) {
  const ride = S.t - p.rideStart;
  p.floor = f; p.car = null; p.assigned = null; p.mood = 0; p.angryNoted = false; p.trapT = 0; p.trapNoted = false;
  p.x = shaftCX(e.id) + rand(-8, 8); p.face = -1;
  p.totalRide += ride;
  return ride;
}
/** @param {Elevator} e */
export function unload(e, f) {
  const out = e.passengers.filter(p => posOf(e, p.dest) === f);
  e.passengers = e.passengers.filter(p => posOf(e, p.dest) !== f);
  for (const p of out) {
    const ride = exitPassenger(e, p, p.dest);
    p.trips++; p.offCar = e.id; p.offAt = p.floor; // (vilken hiss hen kom med – ambulansens hiss väntar på dem)
    S.stats.rideSum += ride; S.stats.rideN++; S.stats.served++;
    if (e.deck2 && p.deck === 1) { S.stats.upperDeck++; p.fromUpper = true; }
    pev(p, sv`Kliver av hiss ${e.name} på ${fl(p.floor)}${e.deck2 ? (p.deck ? ' (övre däcket)' : ' (nedre däcket)') : ''} · åkte ${Math.round(ride)}s`);
    log(sv`${pn(p)} kliver av ${e.name} på ${fl(p.floor)}`, 'person', null, p.id);
    maybeStumble(e, p);
    if (p.viaStairs) { p.viaStairs = false; toStairs(p, sv`Fortsätter till ${fl(p.goal)} via trapporna`); continue; }
    arriveOnFloor(p);
  }
  e.lastOff = out.length;
  e.dwellNeed = DWELL + out.length * 0.18;
}
/** @param {Elevator} e */
export function exitAll(e, f, why) {
  // alla passagerare måste ut här (brand, ström) – de som inte var framme går vidare
  const ps = e.passengers; e.passengers = [];
  for (const p of ps) exitOne(e, p, deckFloor(e, p, f), why);
  e.carCalls.clear();
}
/** En passagerare måste ut på våningen pf (en riktig våning) innan hen är framme – och går vidare därifrån. @param {Person} p @param {Elevator} e */
export function exitOne(e, p, pf, why) {
  e.passengers = e.passengers.filter(q => q !== p);
  exitPassenger(e, p, pf);
  if (p.goal === pf) { pev(p, sv`Kliver av hiss ${e.name} på ${fl(pf)}`); arriveOnFloor(p); return; }
  p.dir = Math.sign(p.goal - pf);
  if (liftsAvailable() && allowed(pf) && allowed(p.goal)) { setTrip(p, p.goal, p.why); pev(p, sv`${why} – ställer mig i kön igen`); }
  else toStairs(p, sv`${why} – tar trapporna`);
}
/** hissteknikern på väg till ett jobb (går före kön och tränger sig in) @param {Person} p */
const onCall = p => p.role === 'hisstekniker' && p.job != null;
/** @param {Elevator} e */
export function load(e, f) {
  // (dubbeldäck: folk på våningen ovanför kliver på övre däcket samtidigt)
  // först till kvarn – utom hissteknikern på väg till ett jobb, som får gå före kön (folket släpper fram hen)
  const waiting = S.people.filter(p => p.state === 'wait' && (p.floor === f || (e.deck2 && p.floor === f + 1 && e.upper.has(p.floor))))
    .sort((a, b) => +onCall(b) - +onCall(a) || a.waitStart - b.waitStart);
  // varje person kommenterar ett visst hisstopp högst en gång (per hiss – annars spammas loggen
  // när två hissar står öppna samtidigt på samma våning)
  /** @param {Person} p */
  const seen = p => { p.seenBy = p.seenBy || {}; if (p.seenBy[e.id] === e.trips) return true; p.seenBy[e.id] = e.trips; return false; };
  let boarded = false;
  const buttons = buttonsMode(), sweep = crashRun(e);
  for (const p of waiting) {
    // KNAPPAR: man kliver på vilken hiss som helst i sin grupp som öppnar åt rätt håll; i nödläge (crash.js) på
    // vilken hiss som helst som går hela vägen och öppnar åt rätt håll
    const any = buttons || sweep;
    const mine = sweep && !keyed(p) ? e.legs.some(l => l.includes(p.floor) && l.includes(p.dest)) && allowedDest(e, p) && elevatorAllows(EL[e.id], p)
      : buttons && !keyed(p) ? p.bank === e.group && e.legs.some(l => l.includes(p.floor) && l.includes(p.dest)) && allowedDest(e, p) && !e.vipLock && !e.indep
        : p.assigned === e.id;
    if (!mine) {
      if (any && !keyed(p)) continue;
      if (p.assigned !== null && !seen(p)) { pev(p, sv`Hiss ${e.name} öppnar – men jag ska ta ${EL[p.assigned].name}`); }
      continue;
    }
    if (e.dir !== 0 && p.dir !== e.dir) {
      if (!seen(p)) { pev(p, sv`Min hiss ${e.name} öppnade men ska ${ARR(e.dir)} först – väntar kvar`); }
      continue;
    }
    // den som nyss fick kliva av för överlast försöker inte igen vid samma stopp
    if (p.kicked === `${e.id}:${e.trips}`) continue;
    // hissetikett: man kliver inte på en hiss som KÄNNS full, långt innan vågen säger stopp – men den som
    // har väntat länge tränger sig in ändå (i Rusning står man tätare)
    const stop = `${e.id}:${e.trips}`;
    if (p.crowdSkip === stop) continue;
    const n = (e.passengers.length + e.reserved) * CAP / e.cap;
    const room = p.space + (S.strategy === 'peak' && S.peakMode ? 2 : 0);
    if (!keyed(p) && !onCall(p) && n >= room && S.t - p.waitStart < 20 && !slotsFull(e)) {
      p.crowdSkip = stop; S.stats.crowdSkips++; e.skipTrip = e.trips;
      pev(p, sv`Hiss ${e.name} ser trång ut (${e.passengers.length + e.reserved} personer) – väntar hellre på nästa`);
      if (!buttons) { p.assigned = null; p.avoid = e.id; rebuildPicks(); }
      continue;
    }
    // vid dörren kliver man på så länge det finns plats – vågen märker överlast först när man står inne
    if (slotsFull(e) || loadKg(e) >= e.ratedKg || deckFull(e, p)) { e.fullFlash = 1.2; continue; }
    if (e.dir === 0) e.dir = p.dir;
    p.state = 'boarding'; p.car = e; p.tx = shaftCX(e.id) + rand(-6, 6);
    p.deck = e.deck2 && e.upper.has(p.floor) ? 1 : 0;
    e.reserved++; e.resKg = (e.resKg || 0) + personKg(p); e.lastOn++; boarded = true;
    const w = S.t - p.waitStart;
    p.lastWait = w; p.totalWait += w;
    S.stats.waitSum += w; S.stats.waitN++; S.stats.waitMax = Math.max(S.stats.waitMax, w);
    etaOutcome(p);
    if (p.mood >= 2) S.stats.angry++;
    p.rideStart = S.t;
    pev(p, sv`Kliver på hiss ${e.name} efter ${Math.round(w)}s väntan`);
    log(sv`${pn(p)} kliver på ${e.name} (väntat ${Math.round(w)}s)`, 'person', null, p.id);
  }
  // KNAPPAR: hissen som står här åt det hållet släcker knappen i hallen
  if (boarded && buttons) for (const d of [1, -1]) if (d === e.dir) { clearCall(e.group, f, d); if (e.deck2) clearCall(e.group, f + 1, d); }
  if (boarded) rebuildPicks();
}
/** dubbeldäck: varje däck har CAP platser @param {Person} p @param {Elevator} e */
const deckFull = (e, p) => e.deck2 && S.people.filter(q => q.car === e && (q.state === 'ride' || q.state === 'boarding') && q.deck === (e.upper.has(p.floor) ? 1 : 0)).length >= CAP;
/** @param {Elevator} e */
export function bounceBoarders(e) {
  // folk som är på väg in i en hiss som just stängts av får vänta igen
  for (const p of S.people) if (p.state === 'boarding' && p.car === e) { p.state = 'wait'; p.car = null; p.assigned = null; p.waitStart = S.t; }
  e.reserved = 0; e.resKg = 0;
}
/** @param {Elevator} e */
export function restoreElevator(e) {
  const d = e.dir;
  setMode(e, 'normal'); e.rs = null; e.target = null; e.targetKind = null; e.dir = 0;
  // den som var ombord ska fortfarande av: om återkallningen kom precis när hissen stannade på målet
  // (stoppet var redan struket men dörrarna hann aldrig öppna) läggs stoppet tillbaka
  for (const p of e.passengers) e.carCalls.add(posOf(e, p.dest));
  if (e.door > 0) { e.state = 'doors'; e.doorPhase = 'closing'; }
  // mellan två våningar (avbruten återkallning/nödsänkning): bromsa in till en våning i stället för att hoppa dit
  else if (Math.abs(e.pos - Math.round(e.pos)) > 1e-6) {
    e.dir = d || -1; e.state = 'moving';
    // i full fart hinner korgen inte bromsa till en våning som ligger närmare än bromssträckan –
    // den stannar på nästa och kör tillbaka (en fysisk gräns, inte ett val av styrningen)
    for (const p of e.passengers) {
      if (!canBrakeTo(e, posOf(e, p.dest))) pev(p, sv`Hiss ${e.name} hinner inte bromsa till ${fl(p.dest)} – vänder på nästa våning`);
    }
  }
  else e.state = 'idle';
  // en hiss som kommer tillbaka mitt under en brandåterkallning (lagad, nödsänkt, linbytt) återkallas den också
  // (utom brandhissen, som kör brandkåren)
  if (S.fire && S.fire.mode === 'recall' && !e.ffCar) recallCar(e);
}
/** Brandåterkallning av en hiss: stäng dörrarna och kör hem utan stopp (recallStep tar över) @param {Elevator} e */
export function recallCar(e) {
  bounceBoarders(e);
  setMode(e, 'recall'); e.rs = e.door > 0 ? 'close' : 'move'; e.parkTarget = null;
}

// ---------- Hisslägen vid incidenter ----------
/** @param {Elevator} e */
export function recallStep(e, dt) {
  // Brandåterkallning: stäng dörrarna, kör direkt till hemvåningen (E, eller närmaste i zonen) utan stopp, släpp ut alla, stäng av
  if (e.rs === 'close') {
    e.state = 'doors'; e.doorPhase = 'closing';
    e.door = Math.max(0, e.door - dt / DOOR_T);
    if (e.door <= 0) { e.rs = 'move'; e.state = 'moving'; }
    return;
  }
  if (e.rs === 'move') {
    e.state = 'moving'; e.target = e.home; e.targetKind = 'recall';
    if (moveTo(e, e.home, vmaxOf(e), dt)) { e.rs = 'open'; e.state = 'doors'; e.doorPhase = 'opening'; e.floor = e.home; }
    return;
  }
  if (e.rs === 'open') {
    e.door = Math.min(1, e.door + dt / DOOR_T);
    if (e.door >= 1) {
      e.doorPhase = 'open';
      if (e.passengers.length) exitAll(e, e.home, sv`Brandåterkallning – alla ut på ${fl(e.home)}`);
      setMode(e, 'locked'); e.rs = null;
      log(sv`🚒 ${e.name} står avstängd i ${fl(e.home)} med öppna dörrar`, 'alert', e.color);
    }
  }
}
/** @param {Elevator} e */
export function rescueStep(e, dt) {
  // Nödsänkning på reservkraft: krypkör till närmaste våning nedanför, öppna, släpp ut alla
  if (e.rs === 'move') {
    e.state = 'moving'; e.target = e.rescueTarget; e.targetKind = 'rescue';
    if (moveTo(e, e.rescueTarget, 0.55, dt)) { e.rs = 'open'; e.state = 'doors'; e.doorPhase = 'opening'; e.floor = e.rescueTarget; }
    return;
  }
  if (e.rs === 'open') {
    e.door = Math.min(1, e.door + dt / DOOR_T);
    if (e.door >= 1) {
      e.doorPhase = 'open';
      const n = e.passengers.length;
      exitAll(e, e.floor, 'Räddad ur hissen med reservkraft');
      setMode(e, 'dead'); e.rs = null;
      if (S.outage) S.outage.busy = null;
      log(sv`🔋 ${e.name} nödsänkt till ${fl(e.floor)} – ${n} personer ute`, 'alert', e.color);
    }
  }
}

// Överlast: vågen i golvet piper och den som klev på sist får kliva av och vänta på nästa hiss.
/** @param {Person} p @param {Elevator} e */
export function kickOff(e, p) {
  e.passengers = e.passengers.filter(q => q !== p);
  if (!e.passengers.some(q => posOf(e, q.dest) === posOf(e, p.dest))) e.carCalls.delete(posOf(e, p.dest));
  // väntetiden räknas om när personen väl kommer med en hiss
  S.stats.waitSum -= p.lastWait || 0; S.stats.waitN--; p.totalWait -= p.lastWait || 0;
  if (p.mood >= 2) S.stats.angry--; // räknas igen när hen väl kommer med
  S.stats.overloads++;
  p.kicked = `${e.id}:${e.trips}`; p.avoid = e.id;
  p.car = null; p.assigned = null; p.keepWait = true;
  p.state = 'toQueue'; p.tx = queueSpot(p.floor); p.face = -1;
  e.overloadFlash = 2;
  e.dwell = Math.min(e.dwell, e.dwellNeed - 1); // dörrarna hålls öppna en stund medan det piper
  const kg = Math.round(loadKg(e) + personKg(p));
  const what = p.cargo ? sv` (med ${p.cargo.name})` : '';
  pev(p, sv`PIIIP! Hiss ${e.name} är överlastad (${kg}/${e.ratedKg} kg) – jag får kliva av${what} och vänta på nästa`);
  log(sv`⚖️ ${e.name} överlastad ${kg}/${e.ratedKg} kg – ${pn(p)}${what} kliver av`, 'alert', e.color, p.id);
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 30, text: 'BZZT!', color: '#ff5d52', life: 1.4 });
  rebuildPicks();
}
