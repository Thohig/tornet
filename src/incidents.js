// Incidenter: brand och strömavbrott.
import { pick, rand, rng } from './rng.js';
import { fl } from './util.js';
import { FL, LOBBY, OFFICE_FLOORS, TOP } from './config.js';
import { S, hooks, hour, incidentOver, log } from './state.js';
import { trappedTalk } from './cast.js';
import { arriveOnFloor, makePerson, pev, pn, setTrip, toStairs } from './people.js';
import { allowedDest, allowedFor, allowedPos, inFireZone, posOf, rebuildPicks, safeFloor } from './dispatch.js';
import { canBrakeTo, deckFloor, exitAll, recallCar, releaseCalls, restoreElevator, setMode } from './elevators.js';
import { cableCandidate, triggerCable, triggerFault, triggerHeat } from './service.js';
import { startStorm } from './weather.js';
import { startMedical } from './visits.js';

// ---------- Incidenter ----------
/** våningar där spelaren kan starta en brand: allt ovanför entrén utom takterrassen */
export const FIRE_FLOORS = FL.map((_, f) => f).filter(f => f > LOBBY && f <= TOP && FL[f].theme !== 'roof');
/** Utlös en incident nu. target: våningen som brinner, eller hissen (id) som går sönder / blir het / får linbrott. */
export function trigger(type, target = null) {
  const e = target !== null && target !== undefined && type !== 'fire' ? S.elevators[target] || null : null;
  if (type === 'fire') startFire(FIRE_FLOORS.includes(target) ? target : undefined);
  if (type === 'power') startOutage();
  if (type === 'fault') triggerFault(e);
  if (type === 'storm' && startStorm()) incidentStarted(null);
  if (type === 'heat') triggerHeat(e);
  if (type === 'cable') triggerCable(e);
  if (type === 'medical') startMedical(); // (ingen incident – bara en händelse som rutan berättar om)
}
export function incidentStarted(floor) {
  S.stats.incidents++;
  S.flash = 3;
  hooks.incident(floor);
}
// --- Brand ---
/** Brand på våning f. Larmet återkallar hissarna automatiskt (auto = false: spelaren/testet väljer själv). */
export function startFire(f = pick(OFFICE_FLOORS.slice(1)), auto = true) {
  if (S.fire) return;
  S.fire = { floor: f, t0: S.t, mode: 'none', brigadeAt: S.t + rand(22, 30), brigade: false, outAt: /** @type {number|null} */ (null), attackBy: 0,
    smoked: 0, evac: 0, stairs0: S.stats.stairs, assembled: 0 };
  log(`🔥 BRAND på våning ${fl(f)}! Larmet går – våning ${fl(f - 1)} och uppåt utryms`, 'alert');
  for (const p of S.people) {
    if (!inFireZone(p.floor)) continue;
    if (p.state === 'office') p.timer = rand(0.2, 3);
    else if ((p.state === 'wait' || p.state === 'toQueue') && p.dest !== p.exitFloor) {
      p.evac = true; p.evacFrom = p.goal; const x = p.x; setTrip(p, p.exitFloor, 'BRANDLARM – utrymning!'); p.x = x;
      pev(p, `Brandlarmet går! Ändrar mål till ${fl(p.exitFloor)}`);
      // står redan vid utgången (t.ex. VIP-gästerna vid helikoptern på taket): gå ut direkt i stället för att köa
      if (p.floor === p.exitFloor) arriveOnFloor(p);
    } else if (['wait', 'toQueue', 'stairs', 'instairs'].includes(p.state) && p.goal === p.exitFloor) p.evac = true; // redan på väg ut
  }
  rebuildPicks();
  if (auto) { log('🚨 Brandlarmet återkallar alla hissar automatiskt', 'alert'); setFireMode('recall'); }
  incidentStarted(f);
}
export function setFireMode(m) {
  const F = S.fire;
  if (!F || F.mode === m) return;
  F.mode = m;
  // först: hissar som var låsta/återkallade får köra igen
  for (const e of S.elevators) { e.zoneLock = false; if (e.mode === 'recall' || e.mode === 'locked') restoreElevator(e); }
  if (m === 'recall') {
    for (const e of S.elevators) if (e.mode === 'normal' && !e.ffCar) recallCar(e); // (brandhissen kör brandkåren)
    for (const p of S.people) if (p.state === 'wait') p.assigned = null;
    log('🚒 BRANDÅTERKALLNING: alla hissar kör direkt till sin hemvåning (oftast E) och stängs av', 'alert');
  } else if (m === 'zone') {
    const zmax = F.floor - 2; // högsta våningen hissarna får köra till
    for (const p of S.people) if (p.state === 'wait' && (!allowedFor(p, p.floor) || !allowedFor(p, p.dest))) toStairs(p, `Hissarna kör bara upp till ${fl(zmax)} – tar trapporna`);
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
    F.brigade = true; F.attackBy = S.t + FF_ATTACK_S;
    log('🚒 Brandkåren är på plats – brandmännen går in', 'alert');
    brigadeArrives(F);
  }
  // branden släcks när brandmännen är framme (hinner de inte dit släcker kåren utifrån med stegbilen)
  if (F.brigade && F.outAt === null) {
    const at = S.people.find(p => p.ff && !p.dead && p.state === 'office' && p.floor === F.floor);
    if (at || S.t >= F.attackBy) {
      F.outAt = S.t + 16;
      log(at ? `🚒 Brandmännen är framme på ${fl(F.floor)} och släcker` : '🚒 Brandkåren släcker utifrån med stegbilen', 'alert');
    }
  }
  if (F.outAt !== null && S.t >= F.outAt) { endFire(); return; }
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
  for (const e of S.elevators) {
    e.zoneLock = false;
    if (e.mode === 'recall' || e.mode === 'locked') restoreElevator(e);
    if (e.ffCar) { e.ffCar = false; e.indep = false; } // brandhissen går i vanlig trafik igen
  }
  for (const p of S.people) {
    p.evac = false;
    // brandmännen går tillbaka till brandbilen, de utrymda på återsamlingsplatsen går in igen (i omgångar)
    if (p.ff && p.state === 'office') p.timer = Math.min(p.timer, rand(1, 3));
    if (p.state === 'assembly') p.backAt = S.t + rand(2, 14);
  }
  const back = S.people.filter(p => p.state === 'assembly').length, stairs = S.stats.stairs - F.stairs0;
  incidentOver('fire', '✅ Branden är släckt',
    `Branden på våning ${fl(F.floor)} varade ${Math.round(S.t - F.t0)} s. ${F.evac} utrymdes${back ? ` – ${back} väntade på återsamlingsplatsen och går in igen` : ''}`
    + `${stairs ? `, ${stairs} tog trapporna` : ''}. ${F.smoked ? `${F.smoked} fick rök i sig.` : 'Ingen fick rök i sig.'}`, { floor: F.floor });
}
// --- Brandkåren ---
/** så länge brandmännen har på sig att nå branden innan kåren släcker utifrån (s) */
export const FF_ATTACK_S = 45;
/** Brandkåren kommer: varuhissen blir brandhiss (om den når upp) och tre brandmän åker upp till två våningar
 *  under branden och springer resten i trappan. Når hissen inte dit (eller strömmen är borta) springer de hela vägen.
 *  Brinner det högst två våningar över entrén finns inget att åka till: de springer direkt upp till branden
 *  (annars vore entrén deras mål – de vore "framme" och gick rakt ut igen). */
function brigadeArrives(F) {
  const V = S.elevators.find(e => e.freight), low = F.floor - 2 <= LOBBY, tf = low ? F.floor : F.floor - 2;
  let car = null;
  if (!low && V && V.stops.has(tf) && V.stops.has(LOBBY) && ['normal', 'recall', 'locked'].includes(V.mode) && !V.hot && S.power) {
    V.ffCar = true; // (före återställningen – annars återkallas den direkt igen)
    if (V.mode !== 'normal') restoreElevator(V);
    V.indep = true; V.zoneLock = false; V.parkTarget = null; V.sleep = false;
    releaseCalls(V, 'blir brandhiss åt brandkåren');
    car = V;
    log(`🚒 ${V.name} blir brandhiss – brandmännen åker upp till ${fl(tf)}`, 'alert', V.color);
  }
  S.brigade = { t0: S.t, car: car ? car.id : null, floor: F.floor };
  for (let i = 0; i < 3; i++) spawnFirefighter(tf, i, !car);
}
function spawnFirefighter(tf, i, walk) {
  const p = makePerson('staff', LOBBY, -30 - i * 18);
  p.role = 'brandman'; p.ff = true; p.fit = 1; p.task = 'Släcker branden';
  // mörk utryckningsdräkt och gul hjälm
  p.look.shirt = '#2b2f45'; p.look.pants = '#2b2f45'; p.look.tie = false; p.look.acc = 0; p.look.hair = 1; p.look.hairC = '#ffd23f';
  setTrip(p, tf, walk ? `Brandkåren: springer upp till ${fl(tf)}` : `Brandkåren: upp till ${fl(tf)} med brandhissen`);
  S.people.push(p);
  if (walk && p.state === 'toQueue') toStairs(p, 'Brandkåren: springer upp i trapphuset');
  pev(p, `Springer in i entrén i rökdykarutrustning · ${p.why}`);
  log(`🚒 ${pn(p)} (brandman) går in`, 'person', null, p.id);
}
/** brandmannens nästa beslut (anropas från personernas rollogik) */
export function ffNext(p) {
  const F = S.fire;
  if (!F) return [p.exitFloor, 'Branden är släckt – tillbaka till brandbilen'];
  if (p.floor < F.floor) { p.ffStairs = true; return [F.floor, 'Springer de sista våningarna upp till branden']; }
  return null;
}
/** brandkåren åker när alla brandmän har gått ut */
function brigadeTick() {
  if (S.brigade && !S.fire && !S.people.some(p => p.ff && !p.dead)) { S.brigade = null; log('🚒 Brandbilen åker iväg', 'alert'); }
}
// --- Strömavbrott ---
export function startOutage() {
  if (!S.power) return;
  S.power = false;
  S.outage = { t0: S.t, backAt: S.t + rand(40, 55), genAt: null, gen: false, auto: false, busy: null,
    // för efterspelet: orsak, vilka som satt fast, längst instängd, trappresor och räddade hissar; när någon säger något
    cause: /** @type {string|null} */ (null), trapIds: /** @type {number[]} */ ([]), maxTrap: 0, stairs0: S.stats.stairs, rescued: 0, nextTalk: S.t + rand(3, 6) };
  for (const e of S.elevators) { e.v = 0; if (e.state === 'moving') e.stuck = true; }
  for (const p of S.people) if (p.state === 'wait') p.assigned = null;
  rebuildPicks();
  log('⚡ STRÖMAVBROTT! Alla hissar stannar där de är', 'alert');
  incidentStarted(null);
}
/** hissar där folk sitter fast när strömmen går: i normal drift, eller på väg hem i en brandåterkallning */
const stranded = e => e.mode === 'normal' || e.mode === 'recall';
export const canRescue = e => !S.power && S.outage && S.outage.gen && S.outage.busy === null && stranded(e)
  && e.passengers.length > 0 && !(e.state === 'doors' && e.door >= 0.95);
export function startRescue(e, how) {
  if (!canRescue(e)) return;
  // nödsänk till närmaste våning nedanför där hissen har dörrar (expresshissar har inga dörrar på vägen)
  let below = e.minF;
  for (const f of e.stops) if (f <= e.pos + 1e-6 && f > below) below = f;
  setMode(e, 'rescue'); e.rs = 'move'; e.rescueTarget = below; e.v = 0;
  S.outage.busy = e.id; S.outage.rescued++;
  log(`🔋 ${how === 'auto' ? 'Auto-räddning' : 'Du'} nödsänker hiss ${e.name} till ${fl(e.rescueTarget)} (${e.passengers.length} instängda${e.passengers.some(p => p.medic) ? ', ambulanspersonalen först' : ''})`, 'alert', e.color);
  for (const p of e.passengers) pev(p, `Hiss ${e.name} nödsänks på reservkraft – snart ute!`);
}
export function outageTick(dt) {
  const O = S.outage;
  if (O.genAt !== null && !O.gen && S.t >= O.genAt) { O.gen = true; log('🔋 Reservkraften är igång – räcker till EN hiss i taget', 'alert'); }
  for (const e of S.elevators) {
    if (!stranded(e)) continue;
    if (e.state === 'doors' && e.door >= 0.95) { if (e.passengers.length) exitAll(e, e.floor, 'Strömavbrott – dörrarna står öppna, går ut'); continue; }
    for (const p of e.passengers) {
      p.trapT = (p.trapT || 0) + dt; S.stats.trappedSec += dt;
      if (p.trapT > O.maxTrap) O.maxTrap = p.trapT;
      if (!p.trapNoted) { if (!O.trapIds.includes(p.id)) O.trapIds.push(p.id); p.trapNoted = true; pev(p, `Hiss ${e.name} tvärstannade – vi sitter fast${Math.abs(e.pos - Math.round(e.pos)) > 0.05 ? ' mellan våningarna' : ''}!`); }
      p.mood = p.trapT > 25 ? 2 : p.trapT > 8 ? 1 : 0;
    }
  }
  // de instängda pratar (och stamgästerna har egna repliker)
  if (S.t >= O.nextTalk) {
    O.nextTalk = S.t + rand(6, 11);
    const cars = S.elevators.filter(e => stranded(e) && e.passengers.length && !(e.state === 'doors' && e.door >= 0.95));
    if (cars.length) trappedTalk(pick(cars));
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
  const O = S.outage;
  S.power = true; S.powerBack = S.t;
  const trapped = Math.round(S.stats.trappedSec);
  S.outage = null;
  for (const e of S.elevators) { e.stuck = false; if (e.mode === 'dead' || e.mode === 'rescue') restoreElevator(e); }
  // (de som sitter fast efter ett linbrott sitter kvar – strömmen hjälper inte dem)
  for (const e of S.elevators) if (e.mode !== 'snapped') for (const p of e.passengers) { if (p.trapNoted) pev(p, 'Strömmen är tillbaka – hissen rullar igen!'); p.trapT = 0; p.trapNoted = false; }
  // hissarna startar om en i taget, nerifrån och upp (inte alla motorer på en gång)
  S.elevators.forEach((e, i) => { e.restartAt = S.t + 0.8 + i * 0.7; });
  log(`💡 Strömmen är tillbaka! (totalt ${trapped} instängd-sekunder idag) – hissarna startar om en i taget`, 'alert');
  // startströmmen: ibland blir en motor het när allt går igång samtidigt (en kedja av incidenter)
  if (rng() < 0.4) {
    const c = S.elevators.filter(e => e.mode === 'normal' && !e.hot && !e.hold).sort((a, b) => b.passengers.length - a.passengers.length || b.heat - a.heat)[0];
    if (c) { c.heat = Math.max(c.heat, 1.02); log(`🌡️ Startströmmen värmer motorn i ${c.name} – överhettningsskyddet löser ut`, 'alert', c.color); }
  }
  if (O) {
    const n = O.trapIds.length, st = S.stats.stairs - O.stairs0;
    incidentOver('power', '💡 Strömmen är tillbaka',
      `Avbrottet${O.cause === 'blixt' ? ' (blixtnedslaget)' : ''} varade ${Math.round(S.t - O.t0)} s. `
      + (n ? `${n} satt fast i hissarna, längst ${Math.round(O.maxTrap)} s.` : 'Ingen satt fast i hissarna.')
      + (O.rescued ? ` Reservkraften nödsänkte ${O.rescued} hiss${O.rescued > 1 ? 'ar' : ''}.` : '')
      + (st ? ` ${st} tog trapporna.` : '') + ' Hissarna startar om en i taget.');
  }
}
// ---------- Dygnets incidenter: tidtabell och förvarningar ----------
// Varje dygn får 1–3 slumpade incidenter, spridda över dagen med tyngdpunkt i rusningarna och lunchen,
// och ibland ett strömavbrott mitt i natten. Före varje incident kommer en förvarning (det luktar bränt,
// lamporna flimrar, det mörknar, motorn brummar, linorna knarrar) så att man hinner titta dit.
/** hur troligt en incident börjar vid klockan h (rusningarna och lunchen mest) */
const INC_WEIGHT = h => (h < 7 ? 0 : h < 7.5 ? 0.6 : h < 9.5 ? 1.6 : h < 11 ? 1 : h < 13 ? 1.5 : h < 15.5 ? 1 : h < 18.5 ? 1.6 : h < 22 ? 0.7 : 0);
/** förvarningens längd i sekunder (verklig tid) per incidenttyp */
export const WARN_S = { fire: 10, power: 6, storm: 14, heat: 10, fault: 8, cable: 40 };
/** minsta avstånd mellan två planerade incidenter (speltimmar) */
const INC_GAP = 1.2;
/** dygnets tidtabell (anropas av resetDay) */
/** Slumpen: hur ofta incidenterna kommer (spelarens reglage). 'av' = bara det spelaren framkallar. */
export const INC_LEVELS = ['av', 'lugn', 'normal', 'kaos'];
export const INC_LEVEL_NAMES = { av: 'Av', lugn: 'Lugnt', normal: 'Normalt', kaos: 'Kaos' };
/** Dygnets tidtabell (anropas av resetDay, och från klockslaget from när spelaren ändrar slumpen). */
export function planIncidents(from = 6) {
  // (Av slumpar fram en vanlig tidtabell och kastar den: dygnets slumpföljd blir densamma som förr)
  const lv = S.incLevel === 'av' ? 'normal' : S.incLevel;
  S.warn = null;
  const h0 = Math.max(7, from), left = Math.max(0, (22 - h0) / 15);
  const day = () => { for (;;) { const h = rand(h0, 22); if (rng() * 1.6 < INC_WEIGHT(h)) return h; } };
  // (Normalt drar slumptalen i samma ordning som alltid – facit och ligan påverkas inte)
  let n = lv === 'normal' ? 1 + (rng() < 0.6 ? 1 : 0) + (rng() < 0.25 ? 1 : 0)
    : lv === 'lugn' ? (rng() < 0.6 ? 1 : 0) : 3 + (rng() < 0.6 ? 1 : 0) + (rng() < 0.4 ? 1 : 0);
  if (from > 6) n = Math.round(n * left);
  /** @type {{ at: number, night: boolean }[]} */
  const plan = [];
  if (h0 < 22) for (let i = 0; i < n; i++) plan.push({ at: day(), night: false });
  const night = lv === 'normal' ? 0.3 : lv === 'lugn' ? 0.1 : 0.6;
  if (rng() < night) plan.push({ at: rand(Math.max(23.5, from), 28.5), night: true }); // strömavbrott i mörkret
  plan.sort((a, b) => a.at - b.at);
  const gap = lv === 'kaos' ? INC_GAP / 2 : INC_GAP;
  for (let i = 1; i < plan.length; i++) plan[i].at = Math.max(plan[i].at, plan[i - 1].at + gap);
  S.incPlan = S.incLevel === 'av' ? [] : plan.filter(x => x.at < 29.5 && x.at >= from);
}
/** Spelaren ändrar slumpen: resten av dygnets tidtabell slumpas om (en förvarning som pågår får fortsätta). */
export function setIncLevel(v) {
  if (!INC_LEVELS.includes(v) || S.incLevel === v) return;
  S.incLevel = v;
  const W = S.warn;
  planIncidents(hour());
  if (v !== 'av') S.warn = W;
  else if (W && W.car !== undefined) S.elevators[W.car].creak = false;
  log(`🎲 Slumpen: ${INC_LEVEL_NAMES[v]}${v === 'av' ? ' – inga fler incidenter av sig själva i dag' : ` – ${S.incPlan.length} incident${S.incPlan.length === 1 ? '' : 'er'} kvar i dagens tidtabell`}`, 'sys');
}
/** linorna i den mest slitna hissen kan gå av (bara om de är rejält slitna) */
const cableRisk = () => {
  const c = S.elevators.filter(e => cableCandidate(e) && e.wear >= 0.25).sort((a, b) => b.wear - a.wear)[0];
  return c ? { e: c, w: (c.wear - 0.2) * 1.2 } : null;
};
/** välj incident (viktad) och var den händer */
function chooseIncident(night) {
  const busy = S.elevators.filter(e => e.mode === 'normal' && !e.hold && !e.breakNext && !e.indep && !e.hot);
  if (night) return S.power && !S.fire ? { type: 'power' } : null;
  /** @type {[string, number][]} */
  const opts = [];
  if (!S.fire) opts.push(['fire', 1]);
  if (S.power) opts.push(['power', 1]);
  if (busy.length) opts.push(['fault', 1.2]);
  if (!S.storm) opts.push(['storm', 0.8]);
  // motorvärme: varmare dag och hissar som redan går varma gör det troligare
  if (busy.length) opts.push(['heat', 0.4 + Math.max(0, S.weather.temp - 15) * 0.06 + Math.max(...busy.map(e => e.heat)) * 0.6]);
  const cr = cableRisk();
  if (cr) opts.push(['cable', cr.w]);
  if (!opts.length) return null;
  let r = rng() * opts.reduce((a, o) => a + o[1], 0), type = opts[0][0];
  for (const [k, w] of opts) { r -= w; if (r <= 0) { type = k; break; } }
  if (type === 'fire') return { type, floor: pick(OFFICE_FLOORS.slice(1)) };
  if (type === 'fault') { const act = busy.filter(e => e.passengers.length || e.carCalls.size); return { type, car: pick(act.length ? act : busy).id }; }
  if (type === 'heat') return { type, car: [...busy].sort((a, b) => b.heat - a.heat || b.passengers.length - a.passengers.length)[0].id };
  if (type === 'cable') return { type, car: /** @type {{ e: any }} */ (cr).e.id };
  return { type };
}
const WARN_LOG = {
  fire: f => `👃 Det luktar bränt på våning ${fl(f)}…`,
  power: () => '💡 Lamporna i huset flimrar…',
  storm: () => '🌥️ Det mörknar över staden och vinden friskar i…',
  heat: e => `🌡️ Motorn i ${e.name}s maskinrum brummar ansträngt…`,
  fault: e => `🔩 ${e.name} låter konstigt – det gnisslar i korgen…`,
  cable: e => `🪢 Det knarrar i bärlinorna på ${e.name} – de är slitna (${Math.round(e.wear * 100)} %)…`,
};
/** förvarningen startar: incidenten bryter ut när den är slut */
function startWarn(inc) {
  const e = inc.car !== undefined ? S.elevators[inc.car] : null;
  S.warn = { ...inc, t0: S.t, until: S.t + WARN_S[inc.type] };
  log(inc.type === 'fire' ? WARN_LOG.fire(inc.floor) : WARN_LOG[inc.type](e), 'alert', e ? e.color : null);
  if (inc.type === 'fire') for (const p of S.people) if (p.floor === inc.floor && p.state === 'office') pev(p, 'Känner ni lukten? Det luktar bränt…');
  if (inc.type === 'cable' && e) { e.creak = true; for (const p of e.passengers) pev(p, 'Det knarrar i linorna ovanför korgen…'); }
}
/** förvarningen är slut: incidenten bryter ut (om den fortfarande kan) */
function fireWarn(W) {
  const e = W.car !== undefined ? S.elevators[W.car] : null;
  if (W.type === 'fire') startFire(W.floor);
  else if (W.type === 'power') startOutage();
  else if (W.type === 'storm') { if (startStorm()) incidentStarted(null); }
  else if (W.type === 'fault' && e) triggerFault(e);
  else if (W.type === 'heat' && e) triggerHeat(e);
  else if (W.type === 'cable' && e) { e.creak = false; if (cableCandidate(e)) triggerCable(e); }
}
export function incidentTick(dt) {
  if (S.fire) fireTick();
  brigadeTick();
  if (S.outage) outageTick(dt);
  if (S.incLevel === 'av') { if (S.warn) { const e = S.warn.car !== undefined ? S.elevators[S.warn.car] : null; if (e) e.creak = false; S.warn = null; } return; }
  if (S.warn) { if (S.t >= S.warn.until) { const W = S.warn; S.warn = null; fireWarn(W); } return; }
  const next = S.incPlan[0];
  if (!next || hour() < next.at) return;
  S.incPlan.shift();
  const inc = chooseIncident(next.night);
  if (inc) startWarn(inc);
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
