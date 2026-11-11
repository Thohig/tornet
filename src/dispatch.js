// Destinationsstyrning: kostnadsfunktion, tilldelning, omfördelning, parkering.
import { pick, rand, rng } from './rng.js';
import { ARR, K, fl } from './util.js';
import { ACC, CAP, DOOR_T, STOP_COST, TOP, VMAX, FULL_LOAD, LOBBY, EL, idx } from './config.js';
import { S, hour, log } from './state.js';
import { liftsAvailable, pev, pn, toStairs, elevatorAllows } from './people.js';
import { buttonsMode, mistakeRate, pressHallButton } from './buttons.js';
import { moveKwh } from './service.js';

// ---------- Destinationsstyrning ----------
// Varje hiss har e.pick: { '3u': antal } = personer den ska hämta på våning 3 som ska uppåt.
export function rebuildPicks() {
  for (const e of S.elevators) { e.pick = {}; e.pickKg = 0; }
  // KNAPPAR: hissen vet bara om anropen i hallen (ett per våning och riktning), inte hur många som väntar
  const buttons = buttonsMode();
  if (buttons) for (const c of Object.values(S.calls)) if (c.car !== null) S.elevators[c.car].pick[c.f + K(c.d)] = 1;
  for (const p of S.people) {
    if (p.state !== 'wait' || p.assigned === null || (buttons && !p.vip)) continue;
    const e = S.elevators[p.assigned], k = p.floor + K(p.dir);
    e.pick[k] = (e.pick[k] || 0) + 1;
    e.pickKg += EST_KG; // styrningen vet inte vad väntande väger – bara vågen i korgen mäter på riktigt
  }
}
export function assignedTo(e, f, d) { return (e.pick[f + K(d)] || 0) > 0; }
export function pickTotal(e) { let n = 0; for (const k in e.pick) n += e.pick[k]; return n; }
export function stopFloors(e) {
  const s = new Set(e.carCalls);
  for (const k in e.pick) s.add(parseInt(k, 10));
  return [...s];
}
export const aheadOf = (e, f, d) => stopFloors(e).some(g => (g - f) * d > 0);
// Vikt i hissen just nu: passagerare + de som håller på att kliva in
// Uppskattad vikt per väntande person (systemet kan inte väga folk innan de kliver på)
export const EST_KG = 75;
export const personKg = p => p.kg + (p.cargo ? p.cargo.kg : 0);
export function loadKg(e) {
  let kg = e.resKg || 0;
  for (const p of e.passengers) kg += personKg(p);
  return kg;
}
// Vikt som syns på vågen: bara de som redan står i korgen (inte de som är på väg in).
// Används av grafiken – lastreglerna använder loadKg.
export function cabinKg(e) {
  let kg = 0;
  for (const p of e.passengers) kg += personKg(p);
  return kg;
}
export const slotsFull = e => e.passengers.length + e.reserved >= CAP;
// "Full" = alla platser tagna eller full last (≥ 80 % av märklasten): hissen tar inga nya hämtningar
export const isFull = e => slotsFull(e) || loadKg(e) >= e.ratedKg * FULL_LOAD;
/** Går hissen både till personens våning och till målet (för den här delresan)? */
export const canTake = (e, p) => e.serves.has(p.floor) && e.serves.has(p.dest) && elevatorAllows(e, p);
export const operational = e => S.power && e.mode === 'normal' && !e.off && !e.sleep && !e.zoneLock && !e.hold;
/** strategier som använder kostnadsfunktionen (Smart och dess varianter) */
export const costBased = (k = S.strategy) => k === 'smart' || k === 'peak' || k === 'eco';

// ---------- Rusningsläge (strategin Rusning) ----------
/** trafikmönstret: 'upp' (morgonrusning in i huset), 'ned' (hemgång), 'lunch' eller null */
export function trafficMode(h) {
  if (h >= 7 && h < 10.3) return 'upp';
  if (h >= 11.2 && h < 13.4) return 'lunch';
  if (h >= 15.8 && h < 18.6) return 'ned';
  return null;
}
export const PEAK_HOLD = 3.2;
/** UPP-läge: en hiss som öppnar i sin hemvåning (entrén/sky lobbyn) väntar lite längre så att fler hinner med */
export function peakHold(e, f) {
  if (S.strategy !== 'peak' || S.peakMode !== 'upp' || f !== e.home || e.dir < 0 || e.freight) return 0;
  return e.passengers.length + e.reserved < CAP / 2 ? PEAK_HOLD : 0;
}

// ---------- Energisparläget ----------
// Energin räknas i kWh och vägs mot väntetid: 1 kWh ≈ ECO_S_PER_KWH sekunders väntan.
export const ECO_S_PER_KWH = 400, ECO_START_S = 8;
/** Extra energi för att hiss e ska hämta p: tomkörning till p (med hissens last), om den inte redan är på väg förbi */
export function fetchKwh(e, p) {
  const stops = stopFloors(e);
  const d = Math.sign(p.floor - e.pos);
  if (!d) return 0;
  if (e.dir === d && stops.some(g => (g - p.floor) * d >= 0)) return 0; // åker ändå dit
  return moveKwh(loadKg(e), e.ratedKg, p.floor - e.pos);
}
/** energikostnaden i sekunder (bara för energisparläget) */
export function ecoCost(e, p) {
  const idle = !stopFloors(e).length && !e.passengers.length;
  return ECO_S_PER_KWH * fetchKwh(e, p) + (idle ? ECO_START_S : 0);
}
export const pickersAt = (e, f, d) => S.people.filter(p => p.state === 'wait' && p.assigned === e.id && p.floor === f && p.dir === d);
// Får hissarna köra till våning f? (påverkas av brandläget)
export function allowed(f) {
  if (!S.fire) return true;
  if (S.fire.mode === 'recall') return false;
  if (S.fire.mode === 'zone') return f <= S.fire.floor - 2;
  return true;
}
/** Högsta våning hissen går till som ligger utanför brandzonen (null om ingen – t.ex. höghissar vid brand lågt ner). */
export function safeFloor(e) {
  let best = null;
  for (const f of e.serves) if (allowed(f) && (best === null || f > best)) best = f;
  return best;
}
export const inFireZone = f => !!S.fire && f > LOBBY && f >= S.fire.floor - 1;

export function requestRide(p) {
  pev(p, `Tänker: jag ska till ${fl(p.dest)} ${ARR(p.dir)}`);
  if (buttonsMode() && !p.vip) { pressHallButton(p); return; }
  // ibland slår man in fel våning på terminalen och får börja om
  if (!p.vip && rng() < mistakeRate(0.04)) {
    p.retypeAt = S.t + rand(2, 4);
    S.stats.wrongPress++;
    pev(p, 'Slog in fel våning på terminalen – slår in igen');
    log(`🙈 ${pn(p)} slog in fel våning på ${fl(p.floor)} och börjar om`, 'button', null, p.id);
    return;
  }
  const open = S.elevators.find(e => operational(e) && canTake(e, p) && (p.vip || !e.vipLock) && e.id !== p.avoid && e.state === 'doors' && e.floor === p.floor && e.doorPhase !== 'closing' && (e.dir === p.dir || e.dir === 0) && !isFull(e));
  if (open && allowed(p.dest)) {
    p.assigned = open.id;
    pev(p, `Hiss ${open.name} står redan öppen här och ska åt rätt håll – får den direkt`);
    log(`${pn(p)} ${fl(p.floor)}→${fl(p.dest)} · ${open.name} står redan här`, 'assign', open.color, p.id);
    rebuildPicks();
    return;
  }
  dispatchPerson(p);
}

// ---------- Kostnadsberäkning ----------
export function travel(dist) { return dist <= 0.001 ? 0 : dist / VMAX + (VMAX / ACC) * 0.5; }
export function eta(e, f, d) {
  const stops = stopFloors(e);
  const pos = e.pos;
  let t = 0;
  if (e.state === 'doors') {
    if (e.floor === f && e.doorPhase !== 'closing' && (e.dir === d || e.dir === 0)) return 0;
    t += e.doorPhase === 'closing' ? e.door * DOOR_T
      : (e.doorPhase === 'opening' ? (1 - e.door) * DOOR_T : 0) + Math.max(0, e.dwellNeed - e.dwell) + DOOR_T;
  }
  const dir = e.dir;
  if (dir === 0 || stops.length === 0) return t + travel(Math.abs(f - pos));
  const ahead = (f - pos) * dir > 0.01 || (Math.abs(f - pos) <= 0.01 && e.state !== 'moving');
  if (ahead && d === dir) {
    const n = stops.filter(g => (g - pos) * dir > 0.01 && (f - g) * dir > 0.01).length;
    return t + travel(Math.abs(f - pos)) + n * STOP_COST;
  }
  let ext = pos;
  for (const g of stops) if ((g - ext) * dir > 0) ext = g;
  if (ahead && (f - ext) * dir > 0) ext = f;
  return t + travel(Math.abs(ext - pos)) + travel(Math.abs(ext - f)) + stops.length * STOP_COST;
}
export function personCost(e, p) {
  const stops = stopFloors(e);
  let c = eta(e, p.floor, p.dir);
  const lo = Math.min(p.floor, p.dest), hi = Math.max(p.floor, p.dest);
  c += travel(hi - lo) + stops.filter(g => g > lo && g < hi).length * STOP_COST * 0.7;
  if (!stops.includes(p.dest)) c += STOP_COST * 0.6; // nytt stopp för hissen = dyrare
  const self = p.assigned === e.id;
  const committed = e.passengers.length + e.reserved + pickTotal(e) - (self ? 1 : 0);
  // Överbokning räknas både i platser och i kilo: varje person utöver kapaciteten kräver i snitt
  // en extra del av en tur. Ett proportionellt straff hindrar att en hiss får 20+ hämtningar.
  // uppmätt vikt i korgen + uppskattning för de som ska hämtas (inklusive den här personen)
  const kg = loadKg(e) + (e.pickKg || 0) - (self ? EST_KG : 0) + EST_KG;
  const over = Math.max(committed + 1 - CAP, (kg - e.ratedKg * FULL_LOAD) / 80, 0);
  const extraTrip = (2 * TOP / VMAX + 4 * STOP_COST) / CAP;
  c += committed * 0.4 + over * extraTrip + (isFull(e) ? 120 : 0);
  if (S.strategy === 'eco') c += ecoCost(e, p);
  return c;
}
export function costLine(p, chosenId) {
  return S.elevators.map(e => {
    if (!operational(e)) return `${e.name} –`;
    const c = personCost(e, p);
    const t = `${e.name} ${c > 99 ? 'FULL' : Math.round(c) + 's'}`;
    return e.id === chosenId ? `<u>${t} ✓</u>` : t;
  }).join(' · ');
}
export function dispatchPerson(p) {
  if (!allowed(p.floor) || !allowed(p.dest)) {
    toStairs(p, S.fire && S.fire.mode === 'recall' ? 'Brandåterkallning – alla hissar avstängda, tar trapporna' : 'Hissarna kör inte hit pga branden – tar trapporna');
    return;
  }
  let cands = S.elevators.filter(e => operational(e) && !isFull(e) && canTake(e, p) && (p.vip || !e.vipLock));
  if (p.vip) {
    // VIP: samma hiss som resten av gruppen, annars en tom hiss
    const mine = cands.filter(e => e.vipLock), empty = cands.filter(e => !e.passengers.length && !pickTotal(e));
    if (mine.length) cands = mine; else if (empty.length) cands = empty;
  }
  // den som just fick kliva av pga överlast slipper samma hiss om det finns andra
  if (p.avoid !== undefined && cands.some(e => e.id !== p.avoid)) cands = cands.filter(e => e.id !== p.avoid);
  if (!cands.length) {
    if (!p.noLiftNoted) { p.noLiftNoted = true; pev(p, liftsAvailable() ? 'Alla hissar är fulla – väntar på att någon får plats' : 'Inga hissar går just nu…'); }
    return;
  }
  p.noLiftNoted = false;
  let chosen, info, why;
  if (S.strategy === 'random') {
    chosen = pick(cands); info = 'slumpen avgör!'; why = 'slumpvis vald';
  } else if (S.strategy === 'nearest') {
    chosen = cands.reduce((a, b) => (Math.abs(b.pos - p.floor) < Math.abs(a.pos - p.floor) ? b : a));
    const dist = Math.abs(Math.round(chosen.pos - p.floor));
    info = `närmast (${dist} vån bort)`; why = `närmast, ${dist} våningar bort`;
  } else {
    const costs = cands.map(e => ({ e, c: personCost(e, p) }));
    const best = costs.reduce((a, b) => (b.c < a.c ? b : a));
    chosen = best.e;
    info = costs.map(x => `${x.e.name}:${Math.round(x.c)}s`).join(' ');
    why = `billigast – hämtning + resa ≈ ${Math.round(best.c)}s` + (stopFloors(chosen).includes(p.dest) ? `, ska redan till ${fl(p.dest)}` : '');
  }
  p.assigned = chosen.id; chosen.parkTarget = null;
  pev(p, `Systemet ger mig hiss ${chosen.name} (${why})`);
  log(`${pn(p)} ${fl(p.floor)}→${fl(p.dest)} · hiss ${chosen.name} · ${info}`, 'assign', chosen.color, p.id);
  rebuildPicks();
}
export function reoptimize() {
  for (const p of S.people) {
    if (p.state !== 'wait' || p.assigned === null) continue;
    const cur = S.elevators[p.assigned];
    if (cur.state === 'doors' && cur.floor === p.floor) continue;
    const cc = personCost(cur, p);
    if (cc < 6) continue;
    let best = null, bc = Infinity;
    for (const e of S.elevators) {
      if (e === cur || isFull(e) || !operational(e) || !canTake(e, p) || (e.vipLock && !p.vip)) continue;
      const x = personCost(e, p);
      if (x < bc) { bc = x; best = e; }
    }
    if (best && bc < cc * 0.6 && cc - bc > 6) {
      p.assigned = best.id; best.parkTarget = null;
      pev(p, `Omfördelning! ${cur.name} → ${best.name} (${Math.round(cc)}s → ${Math.round(bc)}s)`);
      log(`↻ ${pn(p)} flyttas ${cur.name}→${best.name} (${Math.round(cc)}s → ${Math.round(bc)}s)`, 'reopt', best.color, p.id);
      rebuildPicks();
    }
  }
}
// Var hissarna parkerar när de är lediga (bara Smart). Varje hiss har egna parkeringsvåningar i BUILDING.
export function parkFloor(e, h) {
  const p = /** @type {{ day?: string, lunch?: string, evening?: string }} */ (EL[e.id].park || {});
  const at = label => (label !== undefined ? idx(label) : e.home);
  if (S.strategy === 'peak') {
    const m = trafficMode(h);
    if (m === 'upp') return [e.home, 'UPP-läge – tillbaka till entrén direkt'];
    if (m === 'ned' && !e.freight) return [e.maxF, 'NED-läge – väntar högst upp i zonen'];
  }
  if (h >= 20 || h < 6.5) return [e.home, 'kväll/natt – vila hemma'];
  if (h < 10.3) return [e.home, 'morgonrusning – vänta vid entrén'];
  if (h >= 11.2 && h < 13.4) return [at(p.lunch), 'lunchrusning'];
  if (h >= 15.5) return [at(p.evening), 'hemgång – vänta högt upp'];
  return [at(p.day), 'jämn fördelning över huset'];
}
export function maybePark(e) {
  if ((S.strategy !== 'smart' && S.strategy !== 'peak') || e.off || e.zoneLock || e.hold) return;
  if (e.idleTime < (S.strategy === 'peak' && S.peakMode === 'upp' ? 0.5 : 3)) return;
  const [z, why] = parkFloor(e, hour());
  const f = Math.round(e.pos);
  const target = allowed(z) && e.serves.has(z) ? z : e.home;
  if (target !== f) {
    e.parkTarget = target;
    log(`${e.name} parkerar på ${fl(target)} (${why})`, 'park', e.color);
  }
  e.idleTime = 0;
}
