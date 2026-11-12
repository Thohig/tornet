// Incidenter: brand och strömavbrott.
import { pick, rand } from './rng.js';
import { fl } from './util.js';
import { OFFICE_FLOORS } from './config.js';
import { S, hooks, hour, log } from './state.js';
import { arriveOnFloor, pev, pn, setTrip, toStairs } from './people.js';
import { allowed, allowedDest, allowedPos, inFireZone, posOf, rebuildPicks, safeFloor } from './dispatch.js';
import { bounceBoarders, canBrakeTo, deckFloor, exitAll, restoreElevator, setMode } from './elevators.js';
import { triggerFault, triggerHeat } from './service.js';
import { startStorm } from './weather.js';
import { startMedical } from './visits.js';

// ---------- Incidenter ----------
export function trigger(type) {
  if (type === 'fire') startFire();
  if (type === 'power') startOutage();
  if (type === 'fault') triggerFault();
  if (type === 'storm' && startStorm()) incidentStarted(null);
  if (type === 'heat') triggerHeat();
  if (type === 'medical') startMedical(); // (ingen incident – bara en händelse som rutan berättar om)
}
export function incidentStarted(floor) {
  S.stats.incidents++;
  S.flash = 3;
  hooks.incident(floor);
}
// --- Brand ---
export function startFire(f = pick(OFFICE_FLOORS.slice(1))) {
  if (S.fire) return;
  S.fire = { floor: f, t0: S.t, mode: 'none', brigadeAt: S.t + rand(22, 30), brigade: false, outAt: null, smoked: 0, evac: 0 };
  log(`🔥 BRAND på våning ${fl(f)}! Larmet går – våning ${fl(f - 1)} och uppåt utryms`, 'alert');
  for (const p of S.people) {
    if (!inFireZone(p.floor)) continue;
    if (p.state === 'office') p.timer = rand(0.2, 3);
    else if ((p.state === 'wait' || p.state === 'toQueue') && p.dest !== p.exitFloor) {
      p.evac = true; const x = p.x; setTrip(p, p.exitFloor, 'BRANDLARM – utrymning!'); p.x = x;
      pev(p, `Brandlarmet går! Ändrar mål till ${fl(p.exitFloor)}`);
      // står redan vid utgången (t.ex. VIP-gästerna vid helikoptern på taket): gå ut direkt i stället för att köa
      if (p.floor === p.exitFloor) arriveOnFloor(p);
    } else if (['wait', 'toQueue', 'stairs', 'instairs'].includes(p.state) && p.goal === p.exitFloor) p.evac = true; // redan på väg ut
  }
  rebuildPicks();
  incidentStarted(f);
}
export function setFireMode(m) {
  const F = S.fire;
  if (!F || F.mode === m) return;
  F.mode = m;
  // först: hissar som var låsta/återkallade får köra igen
  for (const e of S.elevators) { e.zoneLock = false; if (e.mode === 'recall' || e.mode === 'locked') restoreElevator(e); }
  if (m === 'recall') {
    for (const e of S.elevators) {
      if (e.mode !== 'normal') continue;
      bounceBoarders(e);
      setMode(e, 'recall'); e.rs = e.door > 0 ? 'close' : 'move'; e.parkTarget = null;
    }
    for (const p of S.people) if (p.state === 'wait') p.assigned = null;
    log('🚒 BRANDÅTERKALLNING: alla hissar kör direkt till sin hemvåning (oftast E) och stängs av', 'alert');
  } else if (m === 'zone') {
    const zmax = F.floor - 2; // högsta våningen hissarna får köra till
    for (const p of S.people) if (p.state === 'wait' && (!allowed(p.floor) || !allowed(p.dest))) toStairs(p, `Hissarna kör bara upp till ${fl(zmax)} – tar trapporna`);
    for (const e of S.elevators) {
      const safe = safeFloor(e), drop = safe ?? e.minF;
      // hissar som inte når någon våning utanför zonen kör ner till sin lägsta våning och spärras
      e.zoneLock = safe === null;
      for (const g of [...e.carCalls]) if (!allowedPos(e, g)) e.carCalls.delete(g);
      for (const p of e.passengers) {
        if (allowedDest(e, p)) continue;
        // hinner hissen inte bromsa till den säkra våningen läggs den om vid nästa stopp (zoneReroute)
        if (!canBrakeTo(e, drop)) continue;
        p.viaStairs = true; p.dest = deckFloor(e, p, drop); e.carCalls.add(drop);
        pev(p, `Brandzonen spärrad – hiss ${e.name} släpper av mig på ${fl(drop)}, sen trappan`);
      }
      if (e.zoneLock) log(`🚧 ${e.name} når ingen våning utanför brandzonen – kör till ${fl(drop)} och stängs av`, 'alert', e.color);
      if (e.parkTarget !== null && !allowedPos(e, e.parkTarget)) e.parkTarget = drop;
    }
    // den som väntar på en dubbeldäckare som inte längre får stanna där (eller vid målet) får en ny hiss
    for (const p of S.people) {
      const e = p.state === 'wait' && p.assigned !== null ? S.elevators[p.assigned] : null;
      if (e && (!allowedPos(e, posOf(e, p.floor)) || !allowedDest(e, p))) p.assigned = null;
    }
    log(`🚧 BRANDZON SPÄRRAD: hissarna kör bara upp till ${fl(zmax)}`, 'alert');
  } else {
    log('Brandläge: normal drift – hissarna kör som vanligt (genom röken!)', 'alert');
  }
  rebuildPicks();
}
export function fireTick() {
  const F = S.fire;
  if (!F.brigade && S.t >= F.brigadeAt) {
    F.brigade = true; F.outAt = S.t + 16;
    log('🚒 Brandkåren är på plats och börjar släcka', 'alert');
  }
  if (F.brigade && S.t >= F.outAt) { endFire(); return; }
  // rök: hissar i eller ovanför brandzonen, och folk som väntar på brandvåningen
  for (const e of S.elevators) {
    if (e.pos < F.floor - 0.5) continue;
    for (const p of e.passengers) {
      if (p.smoked) continue;
      p.smoked = true; F.smoked++; S.stats.smoked++; p.mood = 2;
      pev(p, `Rök i hisschaktet! *host host* (hiss ${e.name} vid våning ${fl(Math.round(e.pos))})`);
      log(`💨 ${pn(p)} fick rök i sig i hiss ${e.name}`, 'alert', e.color, p.id);
    }
  }
  for (const p of S.people) {
    if (p.state === 'wait' && p.floor === F.floor && S.t - p.waitStart > 4 && !p.smoked) {
      p.smoked = true; F.smoked++; S.stats.smoked++;
      pev(p, 'Står och väntar på hissen mitt i röken! *host*');
      log(`💨 ${pn(p)} står i röken på ${fl(F.floor)} och väntar på hiss`, 'alert', null, p.id);
    }
  }
}
export function endFire() {
  const F = S.fire;
  log(`✅ Branden på ${fl(F.floor)} är släckt · ${F.evac} utrymda · ${F.smoked} rökexponerade`, 'alert');
  S.fire = null;
  for (const e of S.elevators) { e.zoneLock = false; if (e.mode === 'recall' || e.mode === 'locked') restoreElevator(e); }
  for (const p of S.people) p.evac = false;
}
// --- Strömavbrott ---
export function startOutage() {
  if (!S.power) return;
  S.power = false;
  S.outage = { t0: S.t, backAt: S.t + rand(40, 55), genAt: null, gen: false, auto: false, busy: null };
  for (const e of S.elevators) { e.v = 0; if (e.state === 'moving') e.stuck = true; }
  for (const p of S.people) if (p.state === 'wait') p.assigned = null;
  rebuildPicks();
  log('⚡ STRÖMAVBROTT! Alla hissar stannar där de är', 'alert');
  incidentStarted(null);
}
export const canRescue = e => !S.power && S.outage && S.outage.gen && S.outage.busy === null && e.mode === 'normal'
  && e.passengers.length > 0 && !(e.state === 'doors' && e.door >= 0.95);
export function startRescue(e, how) {
  if (!canRescue(e)) return;
  // nödsänk till närmaste våning nedanför där hissen har dörrar (expresshissar har inga dörrar på vägen)
  let below = e.minF;
  for (const f of e.stops) if (f <= e.pos + 1e-6 && f > below) below = f;
  setMode(e, 'rescue'); e.rs = 'move'; e.rescueTarget = below; e.v = 0;
  S.outage.busy = e.id;
  log(`🔋 ${how === 'auto' ? 'Auto-räddning' : 'Du'} nödsänker hiss ${e.name} till ${fl(e.rescueTarget)} (${e.passengers.length} instängda${e.passengers.some(p => p.medic) ? ', ambulanspersonalen först' : ''})`, 'alert', e.color);
  for (const p of e.passengers) pev(p, `Hiss ${e.name} nödsänks på reservkraft – snart ute!`);
}
export function outageTick(dt) {
  const O = S.outage;
  if (O.genAt !== null && !O.gen && S.t >= O.genAt) { O.gen = true; log('🔋 Reservkraften är igång – räcker till EN hiss i taget', 'alert'); }
  for (const e of S.elevators) {
    if (e.mode !== 'normal') continue;
    if (e.state === 'doors' && e.door >= 0.95) { if (e.passengers.length) exitAll(e, e.floor, 'Strömavbrott – dörrarna står öppna, går ut'); continue; }
    for (const p of e.passengers) {
      p.trapT = (p.trapT || 0) + dt; S.stats.trappedSec += dt;
      if (!p.trapNoted) { p.trapNoted = true; pev(p, `Hiss ${e.name} tvärstannade – vi sitter fast${Math.abs(e.pos - Math.round(e.pos)) > 0.05 ? ' mellan våningarna' : ''}!`); }
      p.mood = p.trapT > 25 ? 2 : p.trapT > 8 ? 1 : 0;
    }
  }
  if (O.gen && O.auto && O.busy === null) {
    // ambulanspersonalen först, sedan den fullaste hissen
    const medics = e => e.passengers.some(p => p.medic) ? 1 : 0;
    const c = S.elevators.filter(canRescue).sort((a, b) => medics(b) - medics(a) || b.passengers.length - a.passengers.length)[0];
    if (c) startRescue(c, 'auto');
  }
  if (S.t >= O.backAt) endOutage();
}
export function endOutage() {
  S.power = true;
  const trapped = Math.round(S.stats.trappedSec);
  S.outage = null;
  for (const e of S.elevators) { e.stuck = false; if (e.mode === 'dead' || e.mode === 'rescue') restoreElevator(e); }
  for (const e of S.elevators) for (const p of e.passengers) { if (p.trapNoted) pev(p, 'Strömmen är tillbaka – hissen rullar igen!'); p.trapT = 0; p.trapNoted = false; }
  log(`💡 Strömmen är tillbaka! (totalt ${trapped} instängd-sekunder idag)`, 'alert');
}
export function incidentTick(dt) {
  if (S.fire) fireTick();
  if (S.outage) outageTick(dt);
  if (!S.autoInc) return;
  const h = hour();
  if (S.t < S.nextInc || h < 8 || h > 18) return;
  S.nextInc = S.t + rand(130, 220); // ungefär 1–2 incidenter per dygn
  const opts = [];
  if (!S.fire) opts.push('fire');
  if (S.power) opts.push('power');
  // hissfel: en slumpad hiss går sönder vid nästa stopp (slitna hissar går dessutom sönder av sig själva)
  if (S.elevators.some(e => e.mode === 'normal' && !e.hold && !e.breakNext)) opts.push('fault');
  if (!S.storm) opts.push('storm');
  if (S.elevators.some(e => e.mode === 'normal' && !e.hot)) opts.push('heat');
  if (opts.length) trigger(pick(opts));
}

// ---------- Spelarens åtgärder (används av knapparna och av testerna) ----------
export function startGenerator() {
  if (!S.outage || S.outage.genAt !== null) return;
  S.outage.genAt = S.t + 5; log('🔋 Reservkraften startar… (5s)', 'alert');
}
export function toggleAutoRescue(on = !(S.outage && S.outage.auto)) {
  if (!S.outage) return;
  S.outage.auto = on; log(`Auto-räddning ${on ? 'PÅ – ambulansen först, sedan fullaste hissen' : 'AV'}`, 'alert');
}
export function toggleOff(e, off = !e.off) {
  e.off = off;
  log(`${e.name} ${off ? 'tas ur drift – kör klart sina passagerare men tar inga nya' : 'är i drift igen'}`, 'alert', e.color);
}
