// Drift: slitage, hissfel, hisstekniker, nattservice och energi.
// Hissarna slits av varje stopp och varje våning de kör (mer med tung last). Slitna hissar går oftare
// sönder – då larmas hissjouren och en hisstekniker kommer och lagar. Blir kön av trasiga hissar lång
// ringer teknikern hissjouren och får en extra tekniker (S.techCall, S.extraAt). Med nattservice går
// teknikern igenom de mest slitna hissarna på natten. Slitaget följer med till nästa dygn.
// Energin räknas fysikaliskt: korgen balanseras av en motvikt (korgen + 45 % av märklasten), så
// motorn drar ström när den lyfter obalansen och återmatar el när obalansen drar den.
import { pick, rand, rng } from './rng.js';
import { fl } from './util.js';
import { BALANCE, DOOR_T, FLOOR_M, FLOOR_H, CAR_H, VMAX, floorY, shaftCX, timeScale, tempoWear } from './config.js';
import { S, hour, incidentOver, log, notice } from './state.js';
import { needsFreight, pev, pn, rerouteStranded, spawnStaff } from './people.js';
import { rebuildPicks, travel, cabinKg, prio, inFireZone } from './dispatch.js';
import { bounceBoarders, exitAll, exitOne, moveTo, restoreElevator, setMode } from './elevators.js';
import { incidentStarted } from './incidents.js';
import { trappedTalk } from './cast.js';

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
// (kalibrerat för ett dygn på 6 minuter: ungefär 350 stopp per dygn i hela huset – tempoWear() skalar om för längre dygn)
export const WEAR_STOP = 0.0022, WEAR_FLOOR = 0.00055, FAULT_K = 0.034, SERVICE_AT = 0.2;
export const FAULTS = ['dörrfel – dörrarna går inte att stänga', 'motorn överhettad', 'styrkortet hänger sig', 'nivåfel – korgen stannar ojämnt', 'bromsen kärvar', 'vajerlarm'];
function wearTick(e) {
  const stops = e.trips - e.wearTrips, dist = e.distance - e.wearDist;
  if (!stops && !dist) return;
  // tung last sliter mer på linor, broms och motor
  e.wear += (stops * WEAR_STOP + dist * WEAR_FLOOR * (1 + cabinKg(e) / e.ratedKg)) * tempoWear();
  e.wearTrips = e.trips; e.wearDist = e.distance;
}
/** slumpens reglage (S.incLevel) gör slitagefelen ovanligare eller vanligare */
const FAULT_MUL = { lugn: 0.5, normal: 1, kaos: 2 };
/** Anropas när dörrarna har öppnat helt och folk klivit av: går hissen sönder här? */
export function maybeBreak(e) {
  if (e.mode !== 'normal' || e.hold) return false;
  if (!e.breakNext) {
    if (S.incLevel === 'av' || !S.power || S.fire) return false;
    if (rng() >= FAULT_K * (FAULT_MUL[S.incLevel] ?? 1) * tempoWear() * e.wear * e.wear) return false;
  }
  breakDown(e, e.stormFault ? 'vajerlarm – linorna slog i schaktet i stormen' : pick(FAULTS));
  e.stormFault = false;
  return true;
}
/** Feltyperna: hur de syns (pixel.js) och hur lång tid de tar att laga (s) */
export const FAULT_KIND = /** @type {Record<string, { kind: string, need: [number, number], tool: string }>} */ ({
  'dörrfel – dörrarna går inte att stänga': { kind: 'door', need: [10, 16], tool: 'Justerar dörrmaskinen' },
  'motorn överhettad': { kind: 'motor', need: [18, 26], tool: 'Byter motorns kylfläkt' },
  'styrkortet hänger sig': { kind: 'board', need: [6, 10], tool: 'Startar om styrkortet' },
  'nivåfel – korgen stannar ojämnt': { kind: 'level', need: [12, 18], tool: 'Kalibrerar nivågivaren' },
  'bromsen kärvar': { kind: 'brake', need: [16, 24], tool: 'Slipar och justerar bromsbackarna' },
  'vajerlarm': { kind: 'rope', need: [14, 20], tool: 'Spänner och kontrollerar linorna' },
});
const faultKind = what => FAULT_KIND[what] || (what.startsWith('vajerlarm') ? FAULT_KIND.vajerlarm : { kind: 'board', need: [12, 20], tool: 'Felsöker' });
export function breakDown(e, what) {
  e.breakNext = false; e.trapNext = false;
  setMode(e, 'broken'); e.hold = false; e.parkTarget = null; e.dir = 0; e.v = 0;
  e.floor = Math.round(e.pos);
  const K = faultKind(what);
  e.fault = { what, kind: K.kind, tool: K.tool, t0: S.t, need: rand(K.need[0], K.need[1]) };
  e.state = 'doors'; e.doorPhase = 'open';
  bounceBoarders(e);
  const n = e.passengers.length;
  if (n) exitAll(e, e.floor, `Hiss ${e.name} gick sönder (${what})`);
  e.carCalls.clear();
  S.stats.faults++;
  log(`🔧 ${e.name} gick sönder på ${fl(e.floor)}: ${what}${n ? ` – ${n} passagerare kliver ut` : ''}`, 'alert', e.color);
  rerouteStranded();
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 30, text: 'KLONK!', color: '#ff9f1c', life: 1.6 });
  rebuildPicks();
}
/** Spelaren utlöser ett hissfel: en hiss som kör eller står öppen går sönder vid nästa stopp */
export function triggerFault(target = null) {
  const ok = S.elevators.filter(e => e.mode === 'normal' && !e.hold && !e.breakNext);
  if (!ok.length) return;
  // helst en hiss med passagerare eller stopp kvar – då händer det snart
  const busy = ok.filter(e => e.passengers.length || e.carCalls.size);
  const e = target && ok.includes(target) ? target : pick(busy.length ? busy : ok);
  // ibland stannar korgen tvärt mellan två våningar med folk i (de sitter fast tills teknikern får igång den)
  if (target && e.passengers.length && rng() < TRAP_CHANCE) { e.trapNext = true; log(`🔧 ${e.name} hackar och gnisslar…`, 'alert', e.color); return; }
  if (e.state === 'doors' && e.door >= 1 && e.stops.has(e.floor)) breakDown(e, pick(FAULTS));
  else { e.breakNext = true; log(`🔧 ${e.name} låter konstigt… den går sönder vid nästa stopp`, 'alert', e.color); }
}
/** andelen av de slumpade hissfelen (med folk ombord) där korgen stannar mellan två våningar */
export const TRAP_CHANCE = 0.45;
const TRAP_FAULTS = ['styrkortet hänger sig', 'bromsen kärvar', 'dörrfel – dörrarna går inte att stänga'];
/** ska korgen stanna mellan två våningar nu? */
export const trapDue = e => e.trapNext && e.mode === 'normal' && e.state === 'moving' && midFloor(e) && e.passengers.length > 0;
/** Korgen tvärstannar mellan två våningar: passagerarna sitter kvar tills teknikern har lagat hissen. */
export function trapBreak(e) {
  e.trapNext = false; e.breakNext = false;
  const what = pick(TRAP_FAULTS), K = faultKind(what);
  bounceBoarders(e);
  setMode(e, 'broken'); e.hold = false; e.parkTarget = null; e.target = null; e.targetKind = null; e.v = 0; e.dir = 0; e.state = 'idle';
  e.floor = Math.round(e.pos); e.carCalls.clear();
  e.fault = { what, kind: K.kind, tool: K.tool, t0: S.t, need: rand(K.need[0], K.need[1]), trapped: true, n: e.passengers.length, nextTalk: S.t + rand(2, 4) };
  S.stats.faults++;
  for (const p of e.passengers) pev(p, `Hiss ${e.name} tvärstannade mellan två våningar – vi sitter fast! (${what})`);
  log(`🔧 ${e.name} tvärstannade mellan två våningar: ${what} – ${e.passengers.length} sitter fast`, 'alert', e.color);
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.pos) - CAR_H - 30, text: 'KLONK!', color: '#ff9f1c', life: 1.6 });
  rerouteStranded();
  rebuildPicks();
}
/** de som sitter fast i en trasig korg: tiden räknas, humöret sjunker och någon säger något ibland */
function stuckTick(e, dt) {
  for (const p of e.passengers) { p.trapT = (p.trapT || 0) + dt; S.stats.trappedSec += dt; p.mood = p.trapT > 25 ? 2 : p.trapT > 8 ? 1 : 0; }
  if (S.t >= e.fault.nextTalk) { e.fault.nextTalk = S.t + rand(6, 10); trappedTalk(e); }
}

// ---------- Hisstekniker ----------
/** sitter fast i en hiss med linbrott (då kan hen inte rädda någon – inte ens sig själv) */
const trappedIn = p => p.state === 'ride' && !!p.car && p.car.mode === 'snapped';
/** i tjänst: inte en som sitter instängd eller har gått av passet efter att ha blivit utrymd */
const onDuty = p => p.role === 'hisstekniker' && !p.dead && !p.offDuty && !trappedIn(p);
/** teknikerna i tjänst (ordinarie först, en extra inringd kan komma till) */
export const techs = () => S.people.filter(onDuty);
/** den första teknikern i tjänst, eller null */
export const tech = () => S.people.find(onDuty) || null;
/** teknikern som har hissen e som sitt jobb, eller null */
export const techOf = e => S.people.find(p => onDuty(p) && p.job === e.id) || null;
/** så många trasiga hissar i kö (utöver den teknikern jobbar med) innan hen ringer in en extra tekniker */
export const EXTRA_QUEUE = 2;
/** samtalets längd (s): teknikerns replik, sedan hissjourens svar */
export const CALL_T = 6, CALL_REPLY = 3.5;
/** trasiga hissar (och linbrott med folk som väntar på räddning) som ingen tekniker har tagit */
export const queuedFaults = () => S.elevators.filter(e => (e.mode === 'broken' || (e.mode === 'snapped' && e.snap.ph !== 'fall')) && e.techId === null);
export const nightWindow = (h = hour()) => h >= 21 && h < 27;
/** våningen teknikern ska till för hissen e */
export const jobFloor = e => (e.mode === 'snapped' ? e.snap.exitF : e.mode === 'broken' ? (e.fault.cable ? e.fault.exitF : e.floor) : e.home);
/** folk sitter fast i hissen e och väntar på en tekniker (linbrott, eller korgen har stannat mellan två våningar) */
const trapping = e => e.passengers.length > 0 &&
  ((e.mode === 'snapped' && e.snap.ph !== 'fall') || (e.mode === 'broken' && !!e.fault && !!e.fault.trapped));
/** Nästa jobb för teknikern p (null = vem som helst): trasiga hissar först, sedan (på natten, med nattservice)
 *  den mest slitna. En hiss som en annan tekniker redan har tagit hoppas över. Den extra teknikern tar bara fel. */
function chooseJob(p = null) {
  // (under en brand går ingen tekniker in i brandzonen)
  const free = e => (e.techId === null || (p !== null && e.techId === p.id)) && !inFireZone(jobFloor(e));
  // linbrott med folk instängda går före allt annat (först fångat, först räddat)
  const snapped = S.elevators.filter(e => e.mode === 'snapped' && e.snap.ph !== 'fall' && free(e)).sort((a, b) => a.snap.t0 - b.snap.t0);
  if (snapped.length) return snapped[0];
  // sedan instängda mellan två våningar, sedan övriga fel
  const broken = S.elevators.filter(e => e.mode === 'broken' && free(e)).sort((a, b) => (trapping(b) ? 1 : 0) - (trapping(a) ? 1 : 0) || a.fault.t0 - b.fault.t0);
  if (broken.length) return broken[0];
  if (p && p.extra) return null;
  // service som spelaren har beställt (t.ex. nivåjustering efter ett snubbel) görs direkt, även på dagen
  const asap = S.elevators.find(e => e.serviceAsap && e.mode === 'normal' && free(e));
  if (asap && !S.fire && S.power) return asap;
  if (S.maint !== 'natt' || !nightWindow() || S.fire || !S.power) return null;
  // varuhissen servas först när ingen med tung last (städvagn, verktygslåda) är kvar i huset
  const heavy = S.people.some(p => needsFreight(p) && p.state !== 'away');
  const worn = S.elevators.filter(e => e.mode === 'normal' && e.wear >= SERVICE_AT && !(e.freight && heavy) && free(e)).sort((a, b) => b.wear - a.wear);
  return worn[0] || null;
}
/** Teknikerns nästa beslut (anropas från personernas rollogik i people.js) */
export function techNext(p) {
  if (p.job !== null && p.job !== undefined) {
    const e = S.elevators[p.job];
    // (jobbet ligger i brandzonen: det får vänta tills branden är släckt – arbetet sparas)
    if (inFireZone(jobFloor(e))) {
      if (e.fault) e.fault.done = p.workT;
      e.techId = null; p.job = null; p.workT = 0;
      pev(p, `Hiss ${e.name} är i brandzonen – jobbet får vänta tills det är släckt`);
    } else if (e.mode === 'broken' || e.mode === 'snapped' || e.hold) return [jobFloor(e), p.task, false];
    p.job = null;
  }
  const e = chooseJob(p);
  if (!e) return [p.exitFloor, p.extra ? 'Kön är tom – åker hem igen' : 'Inga fler hissjobb – åker hem'];
  p.job = e.id; e.techId = p.id; p.workT = (e.fault && e.fault.done) || 0; // (ett avbrutet jobb fortsätter där det slutade)
  if (e.mode === 'snapped') p.task = `Räddar ${e.passengers.length} instängda ur hiss ${e.name} (linbrott)`;
  else if (e.mode === 'broken') p.task = e.fault.cable ? `Byter bärlinor i hiss ${e.name}` : `Lagar hiss ${e.name}: ${e.fault.what}`;
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
const hasJob = p => p.job !== null && p.job !== undefined;
/** Teknikern t har för många trasiga hissar i kö: hen ringer hissjouren, som skickar en extra tekniker. */
function callExtra(t, queued) {
  const n = queued.length, names = queued.map(e => e.name).join(', '), stuck = queued.find(trapping);
  // (sitter det folk fast är det det samtalet handlar om)
  const what = stuck ? `folk sitter fast i ${stuck.name}` : `${n} trasiga hissar står i kö (${names})`;
  S.techCall = { by: t.id, t0: S.t, until: S.t + CALL_T, n, cars: queued.map(e => e.id), trapped: stuck ? stuck.name : null };
  S.extraAt = S.t + CALL_T + rand(12, 20);
  S.stats.extraTechs++;
  // andra gången samma dag: hissjouren skickar arbetsledaren också
  if (S.stats.extraTechs === 2) foremanFor(queued[0], S.extraAt + 6);
  pev(t, `Ringer hissjouren: ${what} – ber om en extra tekniker`);
  log(`📞 ${pn(t)} ringer hissjouren – ${what}, en extra tekniker skickas`, 'alert', null, t.id);
  notice('tech', '📞 Teknikern ringer in en kollega',
    `${t.name} lagar ${S.elevators[t.job].name}, men ${stuck ? `folk sitter fast i ${stuck.name} och kan inte vänta` : `${n} trasiga hissar till står i kö (${names})`}. Hen ringer hissjouren, som skickar en extra tekniker. Kollegan tar de köade hissarna och åker hem när kön är tom.`,
    { act: `person:${t.id}`, actLabel: '📹 Följ teknikern' });
}
// ---------- Arbetsledaren från hissjouren ----------
// Stig kommer vid ett linbrott, eller när hissjouren har ringts in för andra gången samma dag. Han följer
// jobbet på plats (står vid hissen och inspekterar) och åker tillbaka till jouren när hissen går igen.
const FOREMAN = { name: 'Stig', title: 'Arbetsledare på hissjouren',
  look: { skin: '#ffdbb8', shirt: '#ffd23f', pants: '#2b2f45', hair: 2, hairC: '#e8e8e8', tie: false, tieC: '#ffe14d', stripe: true, acc: 3 } };
/** beställ arbetsledaren till hissen e (kommer klockan at, om han inte redan är här) */
function foremanFor(e, at) {
  if (S.foreman || S.people.some(p => p.role === 'arbetsledare' && !p.dead)) return;
  S.foreman = { car: e.id, at };
}
/** Arbetsledarens nästa beslut (rollogiken i people.js) */
export function foremanNext(p) {
  const e = S.elevators[p.watch];
  if (!e || (e.mode !== 'snapped' && e.mode !== 'broken')) return [p.exitFloor, `${e ? e.name : 'Hissen'} går igen – åker tillbaka till jouren`];
  const f = jobFloor(e);
  p.task = e.mode === 'snapped' ? `Inspekterar linbrottet i ${e.name}` : `Ser till att ${e.name} blir lagad`;
  // (false: hissen kan stå i entrén, som är utgången – det är ingen hemgång)
  return [f, `Hissjouren: ${p.task.toLowerCase()}`, false];
}
function foremanTick() {
  const F = S.foreman;
  if (!F || S.t < F.at || S.fire) return;
  S.foreman = null;
  const e = S.elevators[F.car];
  if (e.mode !== 'snapped' && e.mode !== 'broken') return;
  const p = spawnStaff('arbetsledare', false, { watch: e.id, title: FOREMAN.title, name: FOREMAN.name, look: { ...FOREMAN.look } });
  log(`🦺 ${pn(p)} från hissjouren kommer för att titta på ${e.name}`, 'alert', e.color, p.id);
}
function techTick(dt) {
  foremanTick();
  // en tekniker som själv sitter fast efter ett linbrott släpper sitt jobb – hissjouren skickar en kollega
  for (const p of S.people) {
    if (p.role !== 'hisstekniker' || !trappedIn(p) || !hasJob(p)) continue;
    const cur = S.elevators[p.job];
    if (cur.fault) cur.fault.done = p.workT;
    p.job = null; p.workT = 0;
    pev(p, `Sitter själv fast i hiss ${p.car.name} – ringer hissjouren efter en kollega`);
  }
  const crew = techs();
  // instängda (linbrott, eller korgen har stannat mellan två våningar) går före allt: om ingen tekniker är ledig
  // eller redan på väg lämnar en av dem det hen håller på med (arbetet sparas) och går dit
  // (före släppet nedan, så att en påbörjad service avbryts i samma steg)
  const waiting = S.elevators.find(x => trapping(x) && x.techId === null);
  if (waiting && !crew.some(t => !hasJob(t))) {
    const t = crew.find(q => !trapping(S.elevators[q.job]));
    if (t) {
      const cur = S.elevators[t.job];
      if (cur.fault) cur.fault.done = t.workT;
      pev(t, `Larm: folk sitter fast i hiss ${waiting.name} – lämnar ${cur.name} så länge`);
      t.job = null; t.workT = 0;
      if (t.state === 'office') t.timer = Math.min(t.timer, 0.5);
    }
  }
  // hissar vars tekniker försvann (t.ex. utrymde vid brand) eller gick till ett annat jobb släpps
  for (const e of S.elevators) {
    if (e.techId === null) continue;
    const owner = crew.find(q => q.id === e.techId);
    if (!owner || owner.job !== e.id) {
      e.techId = null;
      if (e.hold && e.mode === 'normal') e.hold = false;
      // påbörjad nattservice utan tekniker: hissen stängs och går i trafik igen (servas en annan natt)
      else if (e.mode === 'service') {
        e.hold = false; restoreElevator(e);
        log(`🔧 ${e.name}: nattservicen avbröts – hissen går i trafik igen`, 'alert', e.color);
      }
    }
  }
  // brand: hissjouren kommer bara för dem som sitter fast utanför brandzonen (resten får vänta tills det är släckt)
  if (!crew.length && S.techCallAt === null && S.fire && S.elevators.some(e => trapping(e) && !inFireZone(jobFloor(e)))) callTech('Folk sitter fast i en hiss trots brandlarmet – hissjouren larmas');
  if (!crew.length && S.techCallAt === null && !S.fire) {
    if (S.elevators.some(e => e.mode === 'snapped' && e.snap.ph !== 'fall')) callTech('Linbrott – hissjouren larmas');
    else if (S.elevators.some(e => e.mode === 'broken')) callTech('Hissjouren larmas');
    else if (S.elevators.some(e => e.serviceAsap) && chooseJob()) callTech('Beställd service');
    else if (chooseJob()) callTech('Nattservice av slitna hissar');
  }
  if (!crew.length && S.techCallAt !== null && S.t >= S.techCallAt) { S.techCallAt = null; if (chooseJob()) spawnStaff('hisstekniker'); }
  // lång kö av trasiga hissar: den ensamma teknikern ringer in en extra (en åt gången)
  if (S.techCall && S.t >= S.techCall.until) S.techCall = null;
  if (crew.length === 1 && !S.techCall && S.extraAt === null && !S.fire && hasJob(crew[0]) && !crew[0].extra) {
    const queued = queuedFaults();
    // (sitter det folk fast i en hiss som väntar ringer teknikern direkt – de ska inte vänta ut ett annat jobb)
    if (queued.length >= EXTRA_QUEUE || queued.some(trapping)) callExtra(crew[0], queued);
  }
  if (S.extraAt !== null && S.t >= S.extraAt) {
    S.extraAt = null;
    // (kön kan ha hunnit tömmas, eller det brinner – då kommer ingen)
    if (!S.fire && queuedFaults().length) {
      const x = spawnStaff('hisstekniker', true);
      log(`🔧 Extra tekniker ${pn(x)} är på plats – tar ${hasJob(x) ? S.elevators[x.job].name : 'kön'}`, 'alert', null, x.id);
    }
  }
  for (const t of techs()) workTick(t, dt);
}
/** teknikern t arbetar på sitt jobb (om hen är framme) */
function workTick(t, dt) {
  if (!hasJob(t)) return;
  const e = S.elevators[t.job];
  if (t.state !== 'office' || t.floor !== jobFloor(e)) return;
  if (e.fault && e.fault.crank) return; // (vevar ner korgen för hand vid brandlarm – lagningen får vänta)
  if (e.mode === 'normal' && e.hold) {
    // nattservice: börjar när hissen står tom och stilla hemma
    if (e.homeT < 0.5 || e.passengers.length || e.reserved) return;
    setMode(e, 'service'); e.sleep = false; e.floor = e.home; e.state = 'doors'; e.doorPhase = 'open'; e.dir = 0;
    e.serviceNeed = rand(0.3, 0.5) * 3600 / timeScale(hour()); // en knapp halvtimme i speltid
    pev(t, `Öppnar hiss ${e.name} och börjar serva`);
    log(`🔧 ${pn(t)} servar ${e.name} på ${fl(e.home)}`, 'alert', e.color, t.id);
    return;
  }
  if (e.mode === 'snapped') { evacStep(e, t); return; }
  if (e.mode !== 'broken' && e.mode !== 'service') return;
  // linbytet räknas i speltimmar (det pågår in på kvällen, då klockan går fortare)
  t.workT += e.fault && e.fault.cable ? dt * timeScale(hour()) / 3600 : dt;
  if (t.workT < (e.mode === 'broken' ? e.fault.need : e.serviceNeed)) return;
  if (e.mode === 'broken' && e.fault.cable) {
    S.stats.repairs++; S.stats.downSec += S.t - e.fault.t0;
    e.wear = 0.05; // nya linor och en genomgång av hela hissen
    log(`✅ ${e.name} har nya bärlinor efter ${Math.round(e.fault.need * 10) / 10} timmars arbete i schaktet – provkör och går i trafik igen`, 'alert', e.color);
    pev(t, `Nya linor i hiss ${e.name} – provkört och klart`);
    incidentOver('cable', `✅ Nya bärlinor i ${e.name}`, `Linbytet efter linbrottet tog ${Math.round(e.fault.need * 10) / 10} speltimmar. Hissen är genomgången från topp till botten och går i trafik igen.`, { car: e.id });
    e.fault = null; e.dir = -1; // korgen står mellan två våningar: kör ner till närmaste stopp
  } else if (e.mode === 'broken') {
    const down = S.t - e.fault.t0;
    if (e.fault.trapped) {
      for (const p of e.passengers) { pev(p, `Hissen rullar igen – efter ${Math.round(p.trapT || 0)} s mellan två våningar`); p.trapT = 0; }
      incidentOver('fault', `✅ De instängda i ${e.name} är fria`, `${e.fault.n} satt fast mellan två våningar i ${Math.round(down)} s tills ${t.name} fick igång hissen (${e.fault.what}).`, { car: e.id });
    }
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

// ---------- Brandlarm medan folk sitter fast ----------
// Teknikern som står vid en korg där folk sitter fast utryms inte förrän de är ute: hen vevar ner korgen för
// hand (bromsen lossas, korgen glider sakta) till närmaste våning, öppnar och släpper ut dem – de utryms med
// hen. Hissen är fortfarande trasig och lagas när branden är släckt.
/** Teknikern t ska utrymmas: vevar hen först ner en korg med instängda? (true = vevandet pågår, vänta) */
export function fireCrank(t) {
  if (!hasJob(t)) return false;
  const e = S.elevators[t.job];
  if (e.mode !== 'broken' || !e.fault || !e.fault.trapped || !e.passengers.length || t.state !== 'office' || t.floor !== jobFloor(e)) return false;
  if (!e.fault.crank) {
    const stops = [...e.stops], below = stops.filter(f => f <= e.pos + 1e-6).sort((a, b) => b - a);
    const to = below.length ? below[0] : stops.sort((a, b) => Math.abs(a - e.pos) - Math.abs(b - e.pos))[0];
    e.fault.crank = { to, by: t.id, open: false };
    pev(t, `Brandlarm! Vevar ner hiss ${e.name} för hand till ${fl(to)} och släpper ut de instängda först`);
    log(`🔧 Brandlarm: ${pn(t)} vevar ner ${e.name} för hand till ${fl(to)} – ${e.passengers.length} instängda släpps ut`, 'alert', e.color, t.id);
    for (const p of e.passengers) pev(p, `Teknikern vevar ner hissen för hand – vi ska ut!`);
  }
  return true;
}
/** korgen glider ner för hand, dörrarna öppnas och de instängda går ut (och utryms om det brinner) */
function crankTick(e, dt) {
  const c = e.fault.crank;
  if (!c.open) {
    if (moveTo(e, c.to, 0.3, dt)) { c.open = true; e.floor = c.to; e.dir = 0; e.state = 'doors'; e.doorPhase = 'opening'; }
    return;
  }
  e.door = Math.min(1, e.door + dt / DOOR_T);
  if (e.door < 1) return;
  e.doorPhase = 'open';
  const n = e.passengers.length, down = S.t - e.fault.t0, t = S.people.find(p => p.id === c.by && !p.dead);
  // de som kommer ut i brandzonen går raka vägen ut ur huset
  for (const p of e.passengers) if (inFireZone(e.floor) || inFireZone(p.goal)) { p.evac = true; p.evacFrom = p.goal; p.goal = p.exitFloor; p.why = 'BRANDLARM – utrymning!'; }
  exitAll(e, e.floor, 'Utsläppt ur hissen för hand');
  e.fault.trapped = false; e.fault.crank = null;
  log(`🔧 ${e.name} nedvevad till ${fl(e.floor)} – ${n} ute`, 'alert', e.color);
  incidentOver('fault', `✅ De instängda i ${e.name} är ute`, `${n} satt fast mellan två våningar i ${Math.round(down)} s. När brandlarmet gick vevade ${t ? t.name : 'teknikern'} ner korgen för hand till ${fl(e.floor)} och släppte ut dem. Hissen lagas när branden är släckt.`, { car: e.id });
  if (t && t.state === 'office') t.timer = Math.min(t.timer, 0.3); // (och utryms själv)
  rerouteStranded();
}

// ---------- Linbrott ----------
// Bärlinorna går av mitt i en åktur. Korgen faller fritt tills fångapparaten griper och den står fast
// mellan två våningar. Hissjouren kommer, öppnar schaktdörren på våningen ovanför, klättrar ner på
// korgtaket och tar ut de instängda en i taget genom takluckan och uppför en stege. Sedan står hissen
// avstängd i flera speltimmar medan teknikern byter linor i schaktet.
export const FALL_G = 3.2;  // våningar/s² i fritt fall (överdrivet långsamt, så att det syns)
export const CLIMB_T = 4;   // sekunder per person ut genom takluckan …
export const CLIMB_FLOOR = 1.5; // … och lite till för varje våning stegen är lång (expresshissar)
export const CABLE_H = [3, 5]; // linbytet tar 3–5 speltimmar
/** kan linorna gå av i den här hissen? (panoramahissen på fasaden är hydraulisk och har inga linor) */
export const cableCandidate = e => e.mode === 'normal' && !e.hold && !e.indep && !e.facade && !e.snapNext;
/** korgen är tillräckligt långt från en våning för att fastna emellan (och har utrymme att falla) */
const midFloor = e => { const fr = e.pos - Math.floor(e.pos); return fr > 0.35 && fr < 0.75 && e.pos > e.minF + 0.6; };
/** ska linorna (som knarrat) gå av just nu? */
export const snapDue = e => e.snapNext && e.mode === 'normal' && e.state === 'moving' && midFloor(e);
/** Spelaren eller slumpen: linorna i en hiss i fart går av (helst en med folk i). Står alla still knarrar
 *  linorna i en hiss, och de går av mitt emellan två våningar på dess nästa åktur. */
export function triggerCable(target = null) {
  if (target) { if (cableCandidate(target)) { target.snapNext = true; log(`🪢 Linorna i ${target.name} fransar sig – de går av på nästa åktur!`, 'alert', target.color); } return; }
  const ok = S.elevators.filter(cableCandidate);
  if (!ok.length) return;
  const now = ok.filter(e => e.state === 'moving' && midFloor(e)), busy = now.filter(e => e.passengers.length);
  if (now.length) { snapCable(pick(busy.length ? busy : now)); return; }
  const e = pick(ok); e.snapNext = true;
  log(`🪢 Det knarrar oroväckande i bärlinorna på ${e.name}…`, 'alert', e.color);
}
/** Linorna går av: korgen börjar falla (snapStep tar över tills fångapparaten griper). */
export function snapCable(e) {
  // (ett väntande hissfel eller vajerlarm försvinner med linbytet – hela hissen gås igenom)
  e.snapNext = false; e.breakNext = false; e.stormFault = false;
  bounceBoarders(e);
  setMode(e, 'snapped');
  e.hold = false; e.parkTarget = null; e.target = null; e.targetKind = null; e.carCalls.clear();
  e.state = 'moving'; e.dir = -1; e.v = 0; e.door = 0; e.doorPhase = null;
  // fångapparaten griper knappt en våning längre ner, mitt emellan två våningar (aldrig under den lägsta)
  let stopAt = Math.floor(e.pos) - 1 + rand(0.4, 0.6);
  if (stopAt < e.minF + 0.3) stopAt = Math.floor(e.pos) + rand(0.12, 0.25);
  e.snap = { ph: 'fall', t0: S.t, stopAt, caughtT: 0, exitF: 0, n: e.passengers.length, out: 0, nextOut: 0, climb: 0 };
  S.stats.cables++;
  for (const p of e.passengers) pev(p, `PANG! Något small i taket på hiss ${e.name} – vi faller!`);
  log(`🪢 LINBROTT i ${e.name}! Bärlinorna gick av – korgen faller${e.passengers.length ? ` med ${e.passengers.length} ombord` : ''}`, 'alert', e.color);
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.pos) - CAR_H - 30, text: 'PANG!', color: '#ff2d55', life: 1.6 });
  rerouteStranded();
  rebuildPicks();
  incidentStarted(null);
  foremanFor(e, S.t + 25); // (arbetsledaren från hissjouren kommer och tittar på linbrottet)
}
/** korgtakets höjd i våningar (dubbeldäck: övre korgens tak) */
export const carRoof = e => e.pos + (e.deck2 ? 1 : 0) + CAR_H / FLOOR_H;
/** Fritt fall tills fångapparaten griper. Sedan står korgen helt still tills linorna är bytta. */
export function snapStep(e, dt) {
  const s = e.snap;
  if (!s || s.ph !== 'fall') { e.v = 0; return; }
  e.v = Math.min(VMAX, e.v + FALL_G * dt);
  e.pos = Math.max(s.stopAt, e.pos - e.v * dt);
  if (e.pos <= s.stopAt + 1e-9) caught(e);
}
function caught(e) {
  const s = e.snap;
  e.pos = s.stopAt; e.v = 0; e.dir = 0; e.state = 'idle'; e.floor = Math.floor(e.pos + 1e-6);
  s.ph = 'trapped'; s.caughtT = S.t;
  // utrymningen sker på närmaste våning ovanför korgtaket (översta korgen) där schaktet har en dörr
  const roof = carRoof(e);
  const above = [...e.serves].filter(f => f >= roof - 0.05).sort((a, b) => a - b);
  s.exitF = above.length ? above[0] : Math.max(...e.serves);
  s.climb = CLIMB_T + CLIMB_FLOOR * Math.max(0, s.exitF - roof - 1);
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.pos) - CAR_H - 30, text: 'GNIIISSCH!', color: '#ffd23f', life: 1.6 });
  const between = Math.abs(e.pos - Math.round(e.pos)) > 0.05;
  for (const p of e.passengers) {
    p.mood = 2; p.trapNoted = true;
    pev(p, `Fångapparaten tog tag – hiss ${e.name} hänger ${between ? `mellan ${fl(Math.floor(e.pos))} och ${fl(Math.ceil(e.pos))}` : `vid ${fl(Math.round(e.pos))}`}. Vi trycker på larmknappen!`);
  }
  log(`🛑 Fångapparaten i ${e.name} grep – korgen står fast ${between ? 'mellan två våningar' : `vid ${fl(Math.round(e.pos))}`}${e.passengers.length ? `, ${e.passengers.length} instängda` : ''}`, 'alert', e.color);
}
/** de instängda väntar i den fastkörda korgen (var den tom stängs den av för linbyte, steget efter att den fångades) */
function trappedTick(e, dt) {
  if (!e.passengers.length && e.snap.ph === 'trapped' && S.t > e.snap.caughtT) { cableDown(e); return; }
  for (const p of e.passengers) { p.trapT = (p.trapT || 0) + dt; S.stats.trappedSec += dt; }
}
/** vem som tas ut härnäst: förtur (VIP, ambulans), sedan den som har suttit fast längst – null om ingen är kvar */
export function nextOut(e) {
  if (!e.passengers.length) return null;
  return [...e.passengers].sort((a, b) => Number(prio(b)) - Number(prio(a)) || (b.trapT || 0) - (a.trapT || 0) || a.id - b.id)[0];
}
/** teknikern är på plats ovanför korgen: öppnar takluckan och tar ut en i taget */
function evacStep(e, t) {
  const s = e.snap;
  if (s.ph === 'fall') return;
  if (s.ph === 'trapped') {
    s.ph = 'evac'; s.nextOut = S.t + s.climb;
    pev(t, `Nödöppnar schaktdörren på ${fl(s.exitF)}, klättrar ner på korgtaket och öppnar takluckan`);
    log(`🧗 ${pn(t)} öppnar takluckan på ${e.name} – utrymningen börjar`, 'alert', e.color, t.id);
    for (const p of e.passengers) pev(p, 'Takluckan öppnas – hissteknikern är här!');
    return;
  }
  if (S.t < s.nextOut) return;
  const p = nextOut(e);
  if (p) {
    // en utrymd tekniker lämnar över till kollegan och går hem och vilar
    if (p.role === 'hisstekniker') { p.offDuty = true; p.job = null; p.goal = p.exitFloor; p.why = 'Kollegan tar över – går hem och vilar'; }
    exitOne(e, p, s.exitF, `Ute ur hiss ${e.name} genom takluckan`);
    s.out++; s.nextOut = S.t + s.climb;
    pev(p, `Klättrade ut genom takluckan och uppför stegen till ${fl(s.exitF)} – efter ${Math.round(S.t - s.t0)} s`);
  }
  if (!e.passengers.length) cableDown(e, t);
}
/** Läget för en hiss med linbrott, i klartext (för HUD:en) */
export function cableStatus(e) {
  const t = techOf(e) || tech(), mine = !!t && t.job === e.id;
  const here = mine && t.state === 'office' && t.floor === jobFloor(e);
  if (e.mode === 'snapped') {
    const s = e.snap, n = e.passengers.length;
    if (s.ph === 'fall') return `Korgen faller – fångapparaten griper strax!`;
    if (s.ph === 'evac' && mine) return `${t.name} tar ut folk genom takluckan till ${fl(s.exitF)} – ${s.out} ute, ${n} kvar`;
    const who = mine ? `${t.name} är på väg till ${fl(s.exitF)}` : t ? `Teknikern ${t.name} gör klart ett annat jobb först` : S.techCallAt !== null ? 'Hissjouren är larmad' : `Väntar på hissjouren${S.fire ? ' (brand)' : ''}`;
    return `${n} instängda i ${Math.round(S.t - s.t0)} s · ${who}`;
  }
  const F = e.fault;
  if (!here) return mine ? `${t.name} är på väg för att byta linorna` : 'Linorna ska bytas – väntar på hissteknikern';
  const left = Math.max(0, F.need - t.workT);
  return `${t.name} byter linor i schaktet (${Math.round(100 * Math.min(1, t.workT / F.need))} %) · klar om ~${left < 1 ? `${Math.max(1, Math.round(left * 60))} min` : `${Math.round(left * 10) / 10} h`} speltid`;
}
/** alla är ute (eller korgen var tom): hissen står avstängd medan linorna byts */
function cableDown(e, t = null) {
  const s = e.snap;
  setMode(e, 'broken');
  e.fault = { what: 'linbrott', t0: s.t0, need: rand(CABLE_H[0], CABLE_H[1]), cable: true, exitF: s.exitF };
  e.snap = null; e.state = 'idle'; e.dir = 0; e.v = 0;
  // (brandzonen kan ha lagt stopp och parkering på den fastkörda korgen – de gäller inte efter linbytet)
  e.carCalls.clear(); e.parkTarget = null;
  S.stats.faults++;
  if (s.n) log(`✅ Alla ${s.n} ute ur ${e.name} efter ${Math.round(S.t - s.t0)} s – hissen stängs av medan linorna byts`, 'alert', e.color);
  if (t) { t.workT = 0; t.task = `Byter bärlinor i hiss ${e.name}`; pev(t, `Alla är ute – nu ska nya linor in i schaktet på ${e.name}`); }
  rebuildPicks();
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
  // en varm dag kyler maskinrummet sämre
  e.heat -= e.heat * dt / (e.fan ? FAN_TAU : HEAT_TAU * (1 + Math.max(0, S.weather.temp - 15) * 0.03));
  if (!e.hot && e.heat >= 1 && e.mode === 'normal') {
    e.hot = true; e.hotT0 = S.t; S.stats.heatStops++;
    log(`🌡️ ${e.name}: motorn är överhettad – överhettningsskyddet löser ut, hissen tar inga nya resenärer`, 'alert', e.color);
  } else if (e.hot && e.heat < COOL_AT) {
    e.hot = false;
    log(`🌡️ ${e.name}: motorn har svalnat – i trafik igen`, 'alert', e.color);
    incidentOver('heat', `✅ ${e.name} har svalnat`, `Motorn var överhettad i ${Math.round(S.t - e.hotT0)} s${e.fan ? ' – extrafläkten kylde den fortare' : ''}. Hissen går i trafik igen.`, { car: e.id });
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
export function triggerHeat(target = null) {
  const ok = S.elevators.filter(e => e.mode === 'normal' && !e.hot && !e.hold);
  if (!ok.length) return;
  const busy = ok.filter(e => e.passengers.length || e.carCalls.size);
  const e = target && ok.includes(target) ? target : pick(busy.length ? busy : ok);
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
    if (e.mode === 'snapped' && e.snap.ph !== 'fall') trappedTick(e, dt);
    // (en hiss med linbrott står mellan två våningar – där finns inga dörrar att öppna)
    if ((e.mode === 'broken' || e.mode === 'service') && !(e.fault && (e.fault.cable || e.fault.trapped)) && e.door < 1) e.door = Math.min(1, e.door + dt / DOOR_T);
    if (e.mode === 'broken' && e.fault && e.fault.trapped) stuckTick(e, dt);
    if (e.mode === 'broken' && e.fault && e.fault.crank) crankTick(e, dt);
    // hiss som väntar på nattservice kör hem tom
    if (e.hold && e.mode === 'normal' && e.state === 'idle' && !e.passengers.length && !e.carCalls.size && Math.round(e.pos) !== e.home) e.parkTarget = e.home;
    // hur länge den har stått stilla hemma (servicen börjar först då)
    e.homeT = e.hold && e.mode === 'normal' && e.state === 'idle' && Math.abs(e.pos - e.home) < 1e-6 ? (e.homeT || 0) + dt : 0;
  }
  techTick(dt);
}
