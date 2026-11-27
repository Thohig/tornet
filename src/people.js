// Människor: utseende, resor, beslut, trapphus och platser.
import { stream } from './rng.js';
import { sv } from './sv.js';
const { pick, rand, rng } = stream('folk');
// vem en ny person är (namn, utseende, vikt, tålamod …) har en egen ström, skild från vad folk gör
// – en ström för dem som kommer av sig själva (anställda och besökare: samma personer oavsett styrlogik) och en för
// dem som kallas in av det som händer i huset (tekniker, brandmän, flyttgubbar …), som beror på styrlogiken
const G = stream('gestalt'), G2 = stream('inkallade');
/** @typedef {import('./rng.js').Stream} Stream */
/** @typedef {import('./config.js').Spot} Spot */
/** @typedef {ReturnType<typeof makeLook>} Look */
/** Det en person bär: väska, städvagn, flyttlass … (≥ 22 kg = bara varuhissen) @typedef {{ kind: string, name: string, kg: number }} Cargo */
/** En händelse i en boendes dygnsrutin (life.js) @typedef {{ at: number, go: string, why: string, done?: boolean }} RoutineEv */
/** En rast för husets personal (crew.js) @typedef {{ at: number, len: number, where: string, why: string, done: boolean }} CrewBreak */

/**
 * En person i huset. Grundfälten sätts i `blankPerson`; resten sätts av delsystemen
 * när de behövs och är `undefined` tills dess (därför valfria).
 * @typedef {{
 *   id: number, name: string, kind: 'emp'|'vis'|'staff'|'res', floor: number, x: number, tx: number,
 *   dest: number, goal?: number, dir: number, state: string, timer: number, dead: boolean,
 *   waitStart: number, waited: number, mood: number, face: number, walkPhase: number, speedMul: number, depth: number,
 *   look: Look|null, car: import('./elevators.js').Elevator|null, assigned: number|null, leaving: boolean, rideStart: number, spot: Spot|null,
 *   why: string, hist: { time: string, text: string }[], trips: number, totalWait: number, totalRide: number, seen: string,
 *   patience: number, kg: number, cargo: Cargo|null, exitFloor: number, fit: number, space: number, polite: boolean,
 *   y?: number,
 *   role?: string, title?: string, task?: string, vip?: boolean, child?: boolean, quirk?: string, cast?: string,
 *   crewId?: string, onBreak?: boolean, breakUntil?: number, breakWhy?: string, breakWhere?: string, breakF?: number, breaks?: CrewBreak[],
 *   duty?: import('./crew.js').Duty|null, jour?: boolean, gondola?: boolean, dog?: boolean, chase?: boolean,
 *   offDuty?: boolean, shiftEnd?: boolean, overtime?: boolean, homeSpot?: number, watch?: number,
 *   home?: number, apt?: number, rtype?: string, wake?: number, sleepAt?: number, sleeping?: boolean, sched?: RoutineEv[],
 *   returnAt?: number, hasCar?: boolean, auto?: import('./life.js').Auto|null, movedOut?: boolean,
 *   leaveAt?: number, lunchAt?: number, lunched?: boolean, backAt?: number, cups?: number,
 *   bank?: string|null, fixAt?: number, avoid?: number, kicked?: string, crowdSkip?: string, keepWait?: boolean,
 *   etaAt?: number, lastWait?: number, retypeAt?: number, seenBy?: Record<number, number>, offCar?: number, offAt?: number,
 *   deck?: number, fromUpper?: boolean, escalator?: boolean, escT?: number, hurry?: boolean, moving?: boolean,
 *   stairsByChoice?: boolean, viaStairs?: boolean, nearX?: number,
 *   toTrain?: boolean, fromTrain?: boolean, boardAt?: number,
 *   kronan?: boolean, kronanLunch?: boolean, kronanEvac?: boolean, kronanUntil?: number, toBridge?: boolean, frozen?: boolean,
 *   bridgeT?: number, bridgeDir?: number, bridgeGoal?: number, bridgeWhy?: string, bridgeHelp?: boolean, fromBridgeT?: number, refugee?: boolean,
 *   evac?: boolean, evacFrom?: number, evacBack?: boolean, smoked?: boolean, ff?: boolean, ffStairs?: boolean,
 *   trapT?: number, trapNoted?: boolean, darkNoted?: number, noLiftNoted?: boolean, angryNoted?: boolean, collapsed?: boolean,
 *   job?: number|null, workT?: number, extra?: boolean, route?: number[], ri?: number,
 *   medic?: boolean, mover?: boolean, loader?: boolean, item?: number|null, rescue?: boolean, ropeF?: number,
 *   guide?: boolean, tour?: boolean, guest?: boolean, touring?: boolean, keys?: number|null, robber?: boolean, caught?: boolean, hostage?: boolean, hero?: boolean,
 *   say?: { text: string, until: number }, sayLater?: string|null, gripes?: number, talkedInc?: number,
 *   party?: boolean, partyBag?: Cargo|null, cake?: boolean,
 * }} Person
 */
import { fl } from './util.js';
import {
  activityRate, roomUnits, FLOOR_HOURS, FL, NAMES, ROLE_NAMES, floorOpen, OFFICE_FLOORS, SPOTS, STAIR_X, VISIT_WHY,
  WAIT_X1, WALK, LOBBY, CAFE, MEZZ, floorWith, EL, SKY, CAST, CREW, STATION, TRAIN_X0, TRAIN_X1, DOCK, SKYWALK_F,
} from './config.js';
import { S, clockStr, hour, log, occOf, setOcc } from './state.js';
import { inFireZone, requestRide, loadKg, personKg, eta, keyed, posOf, costBased, prio, outLong, servesNow } from './dispatch.js';
import { maybeStumble, fireCrank } from './service.js';
import { moverTimer, moveBoard } from './visits.js';
import { alwaysStairs, castBoard, castNext, castPizza, castWaitTick, flushSay, incidentTalk, say } from './cast.js';
import { kickOff } from './elevators.js';
import { arriveByCar, backFromAssembly, fireReturn, leaveBuilding, resNext, homeSpot } from './life.js';
import { CREW_LOOK, crewNext, crewSpot, dutyNext, dutySpot } from './crew.js';
import { buttonsMode, carButtonMistakes } from './buttons.js';
import { balloonFreight } from './party.js';
import { escalatorClosed, escalatorStopped, onEscalator, walkedEscalator } from './rulltrappa.js';
import { tourNext, tourSpot } from './tour.js';
import { guestNext, keyNext, visningSpot } from './visning.js';
import { sysArrive, sysNext, sysRole, sysSeized, sysSpot } from './systems.js';
import { bridgeEvac, bridgeOut, enterBridge } from './skywalk.js';

// ---------- Människor ----------
export const SKIN = ['#ffdbb8', '#f6c48f', '#d9a066', '#a8693f', '#7a4a2a', '#ffe4c8'];
export const SHIRT = ['#ff6fb5', '#4dd2ff', '#7cf06b', '#ffd23f', '#ff8c42', '#b388ff', '#2ec4b6', '#ff5d73', '#ffffff'];
export const PANTS = ['#2b2d6e', '#3a3a3a', '#6b4f2a', '#1f6f8b', '#5a2a6e', '#2f5d3a'];
export const HAIR_NAT = ['#2a1a10', '#5a3412', '#d9a441', '#b8461f', '#1b1033', '#e8e8e8'];
export const HAIR_FUN = ['#3f7cff', '#ff4fa3', '#7cf06b'];
export function makeLook(G = G2) {
  return {
    skin: G.pick(SKIN), shirt: G.pick(SHIRT), pants: G.pick(PANTS),
    hair: G.randi(0, 6), hairC: G.rng() < 0.12 ? G.pick(HAIR_FUN) : G.pick(HAIR_NAT),
    tie: G.rng() < 0.35, tieC: G.pick(SHIRT), stripe: G.rng() < 0.5,
    acc: G.pick([0, 0, 1, 1, 2, 2, 3, 4, 5]),
  };
}
/** @param {Person} p */
export const pn = p => `${p.name} (${p.id})`;
// Namnen är unika i huset: en ny person får ett namn som ingen annan i huset bär just nu, och aldrig
// ett stamgästnamn (inte heller delar som "Pelle" i Pizza-Pelle) eller ett namn ur husets personal (Bosse).
const CAST_WORDS = new Set(CAST.flatMap(c => c.name.split(/[- ]/)).concat(CREW.map(c => c.name)));
const POOL = NAMES.filter(n => !CAST_WORDS.has(n));
const SUFFIX = 'BCDEFGHJKLMNOPRST';
export function freeName(G = G2) {
  const used = new Set(S.people.map(p => p.name));
  const free = POOL.filter(n => !used.has(n));
  const r = G.rng();
  if (free.length) return free[Math.floor(r * free.length)];
  // alla namn är upptagna: samma namn med en bokstav efter (Lisa B, Lisa C …)
  const base = POOL[Math.floor(r * POOL.length)];
  for (const s of SUFFIX) if (!used.has(`${base} ${s}`)) return `${base} ${s}`;
  return `${base} ${S.nextId}`;
}
/** @param {Person} p */
export function pev(p, text) {
  p.hist.unshift({ time: clockStr(), text });
  if (p.hist.length > 60) p.hist.pop();
  if (p === S.sel) S.trackDirty = true;
}
/** @param {Person['kind']} kind @param {number} floor @param {number} x @param {Stream} [G] @returns {Person} */
export function makePerson(kind, floor, x, G = G2) {
  return blankPerson(kind, floor, x, {
    name: freeName(G), walkPhase: G.rng() * 6, speedMul: G.rand(0.85, 1.15), depth: G.rand(-7, 0), look: makeLook(G),
    patience: G.rand(5, 15), kg: Math.round(G.rand(55, 105)),
    fit: G.rng(), // hur gärna personen tar trappan (0 = aldrig, 1 = gärna)
    // hissetikett: hur många man står ut med i korgen (av 8) innan man hellre väntar på nästa (9 = bryr sig inte),
    // och om man håller upp dörren åt den som kommer springande
    space: 6 + Math.floor(G.rng() * 4), polite: G.rng() < 0.2,
  });
}
/** En person med givna egenskaper (namn, utseende, vikt …) – drar inga slumptal (driftcheferna, chief.js) */
/** @param {Person['kind']} kind @param {number} floor @param {number} x @param {Partial<Person>} o @returns {Person} */
export function blankPerson(kind, floor, x, o) {
  return {
    id: S.nextId++, name: '', kind, floor, x, tx: x, dest: 0, dir: 0, state: 'toQueue',
    waitStart: 0, waited: 0, mood: 0, face: 1, walkPhase: 0, speedMul: 1, depth: -3, look: null,
    timer: 0, dead: false, car: null, assigned: null, leaving: false, rideStart: 0, spot: null,
    why: '', hist: [], trips: 0, totalWait: 0, totalRide: 0, seen: '', patience: 10,
    kg: 75, cargo: null, exitFloor: LOBBY, fit: 0.5, space: 7, polite: false,
    ...o,
  };
}
export const CARGO = {
  portfölj: { kind: 'portfölj', name: 'portfölj', kg: 3 },
  ryggsäck: { kind: 'ryggsäck', name: 'ryggsäck', kg: 8 },
  resväska: { kind: 'resväska', name: 'resväska', kg: 20 },
  städvagn: { kind: 'städvagn', name: 'städvagn', kg: 60 },
  verktygslåda: { kind: 'verktygslåda', name: 'verktygslåda', kg: 22 },
  pizza: { kind: 'pizza', name: 'pizzakartonger', kg: 6 },
  servicevaska: { kind: 'verktygslåda', name: 'serviceväska', kg: 12 },
  pudel: { kind: 'pudel', name: 'nyklippt pudel', kg: 7 },
  raggig: { kind: 'raggig', name: 'raggig pudel', kg: 8 },
  // firmafesten (party.js): gästernas ballonger och budets tårta (för tung för en vanlig hiss)
  ballonger: { kind: 'ballonger', name: 'ballonger', kg: 1 },
  tårta: { kind: 'tårta', name: 'tårta', kg: 25 },
};
const SPA = floorWith('spa');
/** @param {Person} p */
const withCargo = (p, kind) => { p.cargo = { ...CARGO[kind] }; return p; };
export function queueSpot(f) {
  const n = S.people.reduce((a, p) => a + (p.floor === f && (p.state === 'wait' || p.state === 'toQueue') ? 1 : 0), 0);
  return WAIT_X1 - rand(0, Math.min(380, 60 + n * 9));
}
// ---------- Resplanering: delresor och hissbyten ----------
// Stora saker (städvagnar, leveranser) får bara åka varuhiss; varuhissen är för personal och gods.
/** @param {Person} p */
export const needsFreight = p => !!(p.cargo && p.cargo.kg >= 22);
/** @param {Person} p */
export const mayUseFreight = p => needsFreight(p) || p.kind === 'staff' || balloonFreight(p);
/** får personen åka den här hisstypen? */
// (ambulanspersonalen med båren och flyttgubbarna åker bara varuhiss)
/** @param {Person} p */
// (guiden och gästen på rundvisningen åker samma hissar – inte personalens varuhiss)
// (firmafestens gäster med ballonger tar bara varuhissen när det är bestämt – party.js)
export const elevatorAllows = (d, p) => (p.medic || p.mover || (p.robber && !p.caught) || balloonFreight(p) ? !!d.freight : d.freight ? mayUseFreight(p) && !p.touring : !needsFreight(p));
/**
 * Nästa delmål på vägen mot goal: direkt om någon hiss går hela vägen, annars dit där man byter hiss
 * (t.ex. låg zon → entrén → expressen → sky lobbyn → hög zon). Söker resvägen med minst antal byten
 * och, bland dem, kortast sträcka. Bara hissar som personen får åka räknas.
 * @param {Person} p
 */
export function legDest(from, goal, p) {
  if (from === goal) return goal;
  // hissar som är trasiga eller på service undviks om det finns en annan väg
  const ok = EL.filter(d => elevatorAllows(d, p) && !down(d.id, p));
  const plan = route(from, goal, ok);
  const hop = plan !== null ? plan : route(from, goal, EL.filter(d => elevatorAllows(d, p))) ?? (from !== SKY ? SKY : goal);
  // dubbeldäck: från entrén upp mot höga zonen kan man ta rulltrappan till mellanplanet och övre däcket
  if (MEZZ >= 0 && from === LOBBY && hop === SKY && goal > SKY && plan !== null && escalatorOk(p) && upperDeckChoice(goal, ok)) return MEZZ;
  return hop;
}
/** Väljer personen expressens övre däck (via mellanplanet)? Målet 7 nås direkt därifrån. Kostnadsstyrningen
 *  delar upp folk efter köerna vid de två däcken; annars väljer man efter udda/jämna våningar, som på skyltarna. */
function upperDeckChoice(goal, ok) {
  const up = SKY + 1;
  if (!ok.some(d => d.deck2 && d.upper.includes(MEZZ) && d.upper.includes(up))) return false;
  if (goal === up) return true;
  if (!route(up, goal, ok)) return false;
  if (costBased() && !buttonsMode()) {
    const q = f => S.people.filter(q => (q.state === 'wait' || q.state === 'toQueue') && q.floor === f && q.dest === (f === MEZZ ? up : SKY)).length;
    return q(MEZZ) + (S.people.filter(q => q.escalator).length) < q(LOBBY);
  }
  return (goal - SKY) % 2 === 1;
}
/** Tar personen rulltrappan nu? Inte när den är avspärrad, och står den still går den som bär något tungt eller
 *  ogärna går (p.fit) hellre till expressens nedre däck (rulltrappa.js) @param {Person} p */
const escalatorOk = p => !escalatorClosed() && !(escalatorStopped() && p && ((p.cargo && p.cargo.kg >= 15) || p.fit < 0.3));
/** Hur länge resan i rulltrappan tar (s): 1,6 s när den rullar; står den still går man – uppför flåsar man, och ju
 *  fler som går samtidigt desto trängre @param {Person} p */
function escalatorTime(p) {
  if (!escalatorStopped()) return 1.6;
  const others = onEscalator().filter(q => q !== p).length;
  return (p.dest > p.floor ? 6.5 : 4) + 0.8 * others;
}
/** Byte mellan entrén och mellanplanet (på väg till eller från expressens övre däck) görs i rulltrappan @param {Person} p */
const escalatorHop = p => MEZZ >= 0 && p.goal !== undefined && !escalatorClosed()
  && ((p.floor === LOBBY && p.dest === MEZZ && p.goal !== MEZZ) || (p.floor === MEZZ && p.dest === LOBBY && p.fromUpper));
/** @param {Person} p */
function rideEscalator(p) {
  p.state = 'stairs'; p.escalator = true; p.fromUpper = false; p.assigned = null; p.car = null; p.tx = STAIR_X; p.dir = Math.sign(p.dest - p.floor);
  S.stats.escalator++;
  pev(p, p.dest === MEZZ ? 'Tar rulltrappan upp till mellanplanet – expressens övre däck' : 'Tar rulltrappan ner till entrén');
}
// (en hiss som är reserverad för VIP-gruppen eller ambulansen räknas som ur drift för alla andra)
/** @param {Person} p */
const down = (id, p) => { const e = S.elevators[id]; return !!e && (outLong(e) || (e.vipLock && !prio(p))); };
/** första delmålet på resvägen med minst antal byten (och kortast sträcka) med hissarna lifts, eller null */
function route(from, goal, lifts) {
  // (en hiss kör bara mellan våningar på samma däck: legs)
  if (lifts.some(d => d.legs.some(l => l.includes(from) && l.includes(goal)))) return goal;
  // bredden först: varje steg är en hissresa; best[f] = [antal resor, sträcka, första delmålet]
  /** @type {Map<number, [number, number, number]>} */
  const best = new Map([[from, [0, 0, -1]]]);
  let frontier = [from];
  for (let legs = 1; legs <= 4 && frontier.length; legs++) {
    const next = [];
    for (const f of frontier) {
      const [, dist, first] = /** @type {[number, number, number]} */ (best.get(f));
      for (const d of lifts) for (const leg of d.legs) {
        if (!leg.includes(f)) continue;
        for (const g of leg) {
          if (g === f) continue;
          const cand = /** @type {[number, number, number]} */ ([legs, dist + Math.abs(g - f), first < 0 ? g : first]);
          const old = best.get(g);
          if (!old) { best.set(g, cand); next.push(g); } else if (old[0] === legs && cand[1] < old[1]) best.set(g, cand);
        }
      }
    }
    if (best.has(goal)) return best.get(goal)[2];
    frontier = next;
  }
  return null;
}
/** finns det en väg till slutmålet med hissar som går (inte trasiga, på service eller reserverade för någon annan)? @param {Person} p */
const workingRoute = p => route(p.floor, p.goal, EL.filter(d => elevatorAllows(d, p) && !down(d.id, p))) !== null;
/** Påbörja en resa mot slutmålet goal (kan bli flera delresor) @param {Person} p */
export function setTrip(p, goal, why, leaving = goal === p.exitFloor) {
  p.goal = goal; p.dest = legDest(p.floor, goal, p); p.dir = Math.sign(p.dest - p.floor);
  p.leaving = leaving; p.why = why; p.assigned = null;
  p.state = 'toQueue'; p.tx = queueSpot(p.floor); p.mood = 0; p.bank = null; p.fixAt = 0;
  // redan framme (t.ex. teknikern vars jobb är i entrén där hen kliver in): gå direkt dit, ingen hiss
  if (goal === p.floor) arriveOnFloor(p);
  else if (escalatorHop(p)) rideEscalator(p);
}
/** @param {Person} p */
export function releaseSpot(p) {
  const s = p.spot;
  if (s && !s.temp && occOf(s) === p.id) setOcc(s, null);
  p.spot = null;
}
const ROLE_SPOT_DESC = {
  'väktare': 'Lyser med ficklampan och kollar att dörrarna är låsta',
  'städare': 'Dammsuger och tömmer papperskorgar',
  'nattekniker': 'Köper kaffe ur automaten',
};
/** @param {Person} p */
export function pickSpot(p, f) {
  const list = SPOTS[f];
  if (p.crewId) return crewSpot(p, f);
  // (vaktmästaren på uppdrag står synligt i hallen, crew.js)
  const ds = dutySpot(p, f);
  if (ds) return ds;
  // (delsystemen: kuppens gäng, den lösa hunden och de som jagar den syns i hallen – systems.js)
  const ss = sysSpot(p, f);
  if (ss !== undefined) return ss;
  // (rundvisningen: gästen står bredvid guiden i hallen, visning.js)
  const vs = p.guest || p.touring ? visningSpot(p, f) : null;
  if (vs) return vs;
  // nattpersonal: egna platser
  if (p.kind === 'res' && f === p.home) return homeSpot(p);
  const own = p.role && list.find(s => s.role === p.role);
  if (own) return own;
  // (räddningstjänsten står synligt i hallen eller på taket)
  if (p.rescue || p.gondola) return { x: p.nearX, k: 'stand', face: 1, desc: p.task, temp: true, win: 'hall' };
  // (Stadsturen står ute på takterrassen och syns, tour.js)
  const ts = p.tour ? tourSpot(p, f) : null;
  if (ts) return ts;
  if (p.role) return { x: p.nearX ?? rand(150, 470), k: 'stand', face: pick([1, -1]), desc: p.task || ROLE_SPOT_DESC[p.role] || 'Jobbar', temp: true };
  // (personalens poster, rastmål och personalrummet väljer ingen annan)
  const free = s => !s.brk && !s.post && !s.where && (s.k === 'door' || occOf(s) === null);
  if (p.kind === 'emp' && f === p.home && p.homeSpot !== undefined && free(list[p.homeSpot])) return list[p.homeSpot];
  const pref = list.filter(s => free(s) && (p.kind === 'emp' ? s.staff : !s.staff));
  const any = list.filter(free);
  const s = pick(pref.length ? pref : any.length ? any : [null]);
  if (s) return s;
  return { x: rand(170, 460), k: 'stand', face: pick([1, -1]), desc: 'Står och väntar på en ledig plats', temp: true };
}
/** @param {Person} p */
export function gotoSpot(p, f) {
  p.spot = pickSpot(p, f);
  if (!p.spot.temp && p.spot.k !== 'door') setOcc(p.spot, p.id);
  p.tx = p.spot.x;
}
/** En anställd kommer till jobbet: genom entrén, eller med tunnelbanan (trainX = dörren hen kliver av vid) */
export function spawnEmployee(trainX = null) {
  const byTrain = trainX !== null && STATION >= 0;
  const p = makePerson('emp', byTrain ? STATION : LOBBY, byTrain ? trainX : -30 - G.rand(0, 20), G);
  if (byTrain) p.exitFloor = STATION;
  if (p.look.acc === 1) withCargo(p, 'portfölj'); else if (p.look.acc === 5) withCargo(p, 'ryggsäck');
  p.home = G.pick(OFFICE_FLOORS);
  const staffIdx = SPOTS[p.home].map((s, i) => (s.staff ? i : -1)).filter(i => i >= 0);
  p.homeSpot = G.pick(staffIdx);
  // de flesta går hem 16–18:30, en del jobbar över på kvällen och några är riktiga nattugglor
  const r = G.rng();
  p.leaveAt = r < 0.85 ? G.rand(15.8, 18.6) : r < 0.97 ? G.rand(19, 22.5) : G.rand(23, 27);
  if (p.leaveAt >= 19) p.overtime = true;
  p.lunchAt = G.rng() < 0.6 ? G.rand(11.2, 12.9) : 99;
  p.lunched = false;
  setTrip(p, p.home, sv`Till jobbet på ${FL[p.home].short}`);
  if (!byTrain && G.rng() < 0.35) arriveByCar(p); // kör till jobbet om det finns plats i garaget
  S.people.push(p);
  pev(p, `${byTrain ? 'Kliver av tunnelbanan' : 'Kliver in i entrén'} · ${p.why} (${fl(p.home)})`);
  log(sv`${pn(p)} anländer${byTrain ? ' med tunnelbanan' : ''} · ska till ${fl(p.home)}`, 'person', null, p.id);
  return p;
}
export const openFloors = (h = hour()) => OFFICE_FLOORS.concat(CAFE).filter(f => floorOpen(f, h) && floorOpen(f, h + 1.2));
// Besökare går bara till våningar som är öppna. Returnerar null om inget är öppet (t.ex. mitt i natten).
export function spawnVisitor(floor = 0, x = -30, dest = null, why = null) {
  const h = hour(), open = openFloors(h);
  // dit man ska måste ha öppet en stund till – en resa genom huset tar ungefär en speltimme
  if (dest !== null && dest !== LOBBY && !(floorOpen(dest, h) && floorOpen(dest, h + 1.2))) dest = null;
  if (dest === null) {
    const cand = open.filter(f => f !== floor);
    if (floor === LOBBY) {
      if (!cand.length) return null;
      const r = G.rng();
      const dentist = floorWith('dentist');
      dest = r < 0.18 && cand.includes(dentist) ? dentist : r < 0.38 && cand.includes(CAFE) ? CAFE : G.pick(cand);
    } else dest = G.rng() < 0.35 || !cand.length ? LOBBY : G.pick(cand);
  }
  const p = makePerson('vis', floor, x, G);
  setTrip(p, dest, why || (dest === LOBBY ? 'Ska ut ur huset' : VISIT_WHY[dest]));
  S.people.push(p);
  pev(p, `${floor === LOBBY ? 'Kliver in i entrén' : sv`Dyker upp på våning ${fl(floor)}`} · ${p.why} (${fl(dest)})`);
  log(sv`${pn(p)} dyker upp på ${fl(floor)} · ska till ${fl(dest)}`, 'person', null, p.id);
  return p;
}

/** @param {Person} p */
export function walk(p, dt, speed = WALK) {
  const dx = p.tx - p.x, st = speed * p.speedMul * dt;
  if (Math.abs(dx) <= st) { p.x = p.tx; return true; }
  p.face = Math.sign(dx); p.x += p.face * st; p.walkPhase += dt * 10 * p.speedMul;
  return false;
}
export const liftsAvailable = () => S.power && !(S.fire && S.fire.mode === 'recall') && S.elevators.some(e => e.mode === 'normal' && !e.off && !sysSeized(e));
/** @param {Person} p */
export function updatePerson(p, dt) {
  switch (p.state) {
    case 'toQueue':
      if (walk(p, dt)) {
        p.state = 'wait'; if (!p.keepWait) p.waitStart = S.t; p.keepWait = false; p.face = 1;
        if (p.sayLater) flushSay(p);
        if (stairsChoice(p, false)) break;
        requestRide(p);
      }
      break;
    case 'wait':
      p.waited = S.t - p.waitStart;
      p.mood = p.waited > 55 ? 2 : p.waited > 28 ? 1 : 0;
      if (p.mood === 2 && !p.angryNoted) { p.angryNoted = true; pev(p, 'Börjar bli riktigt sur… #@%!'); }
      // ambulanspersonalen väntar inte ut ett strömavbrott: de bär båren i trapporna direkt
      if ((p.medic || p.ff) && !S.power) { toStairs(p, sv`Strömavbrott – bär ${p.cargo ? p.cargo.name : 'utrustningen'} i trapporna`); break; }
      // hissteknikern kan inte vänta på hissen hen ska laga: når bara den trasiga hissen jobbet (t.ex. panoramahissen
      // som gick sönder uppe vid takterrassen) tar hen trappan
      if (p.role === 'hisstekniker' && p.goal !== undefined && !workingRoute(p)) { toStairs(p, sv`Ingen hiss som går når ${fl(p.goal)} – tar trappan till jobbet`); break; }
      // tung last (möbler, tunga paket) bärs inte i trapporna: man väntar ut strömavbrottet vid hissen
      if (!S.power && S.outage && p.cargo && p.cargo.kg >= 15) {
        if (p.darkNoted !== S.outage.t0) { p.darkNoted = S.outage.t0; pev(p, sv`Strömavbrott – ${p.cargo.name} går inte att bära i trapporna, väntar ut det`); }
        castWaitTick(p);
        break;
      }
      if (!liftsAvailable() && p.waited > p.patience && !(p.ff && S.elevators.some(e => e.ffCar && e.mode === 'normal'))) { toStairs(p, S.power ? 'Hissarna är avstängda – tar trapporna' : 'Hissarna står still (strömavbrott) – tar trapporna'); break; }
      // ingen hiss som går hit fungerar (trasig eller på service – sovande hissar vaknar ju): den som kan går
      if (p.waited > p.patience + 15 && S.power && stranded(p) && canWalk(p)) { toStairs(p, 'Ingen hiss går hit just nu (fel eller service) – tar trapporna'); break; }
      // vaktmästaren på uppdrag (läckan, gondolen, hunden) väntar inte: ingen hiss går – springer i trappan med verktygslådan
      if (p.duty && p.waited > 3 && (stranded(p) || !liftsAvailable())) { toStairs(p, 'Ingen hiss går – springer i trappan'); break; }
      // hissteknikern på väg till instängda (linbrott, korg mellan två våningar) väntar inte länge: dröjer hissen
      // springer hen i trappan med serviceväskan (annars kan de sitta kvar medan teknikern står i en kö)
      if (p.role === 'hisstekniker' && p.job !== null && p.job !== undefined && p.waited > 15 && Math.abs(p.goal - p.floor) <= RESCUE_STAIRS
        && rescueJob(p)) { toStairs(p, 'Instängda väntar – springer i trappan i stället'); break; }
      if (stairsChoice(p, true)) break;
      // målet hann stänga medan man stod i kön: vänd
      if (p.goal !== undefined && p.goal !== p.floor && closedFor(p, p.goal)) { turnBack(p); break; }
      castWaitTick(p);
      break;
    case 'boarding':
      if (walk(p, dt)) boardDone(p);
      break;
    case 'exiting':
      if (walk(p, dt)) exitDone(p);
      break;
    case 'stairs':
      if (walk(p, dt, p.evac ? WALK * 1.3 : WALK)) {
        p.state = 'instairs';
        // tung last (båren, möbler) bärs långsammare i trapphuset
        p.timer = p.escalator ? escalatorTime(p) : (2 + Math.abs(p.dest - p.floor) * 1.8) * (p.cargo && p.cargo.kg >= 15 ? 1.4 : 1);
        if (p.escalator) p.escT = p.timer; // (hela resan i rulltrappan: grafiken ritar dem i den)
        if (p.escalator && escalatorStopped()) {
          walkedEscalator();
          pev(p, p.dest > p.floor ? 'Går uppför den stillastående rulltrappan – flåsar' : 'Går nerför den stillastående rulltrappan');
        } else pev(p, p.escalator ? sv`Åker rulltrappa ${fl(p.floor)} → ${fl(p.dest)}` : sv`Går i trapphuset ${fl(p.floor)} → ${fl(p.dest)}`);
      }
      break;
    case 'instairs':
      p.timer -= dt;
      if (p.timer <= 0) stairsDone(p);
      break;
    case 'away': case 'incar': case 'platform': case 'bridge': case 'kronan': break; // utanför huset / i bilen (life.js) / väntar på tåget (train.js) / på bron eller i Kronan (skywalk.js)
    case 'assembly': if (!S.fire && S.t >= (p.backAt ?? 0)) backFromAssembly(p); break; // återsamlingsplatsen (brand)
    case 'office':
      p.timer -= dt * activityRate(hour()); // vistelsen räknas i speltid
      if (p.timer <= 0) officeDone(p);
      break;
  }
}
// ---------- Strandsatt: hissen man väntar på är trasig eller på service ----------
/** finns det ingen fungerande hiss (sovande räknas – de vaknar) som tar personen den här delresan? @param {Person} p */
const stranded = p => !S.elevators.some(e => servesNow(e, p));
/** Anropas när en hiss går sönder eller tas till service: de som stod och väntade på den byter väg direkt. */
export function rerouteStranded() {
  for (const p of S.people) {
    if (p.state !== 'wait' || p.goal === undefined || !stranded(p)) continue;
    const alt = legDest(p.floor, p.goal, p);
    if (alt === p.dest) continue;
    pev(p, sv`Vägen via ${fl(p.dest)} är ur funktion – tar en annan väg via ${fl(alt)}`);
    const ws = p.waitStart;
    setTrip(p, p.goal, p.why, p.leaving); p.keepWait = true; p.waitStart = ws;
  }
}

// ---------- Trappan som alternativ ----------
// Den som ska en våning upp eller ett par ner tar ofta trappan direkt, och den som har väntat länge
// på en kort resa tröttnar och går. Trappan går hela vägen till slutmålet (inga hissbyten).
export const STAIRS_UP = 1, STAIRS_DOWN = 2, STAIRS_IMPATIENT_UP = 2, STAIRS_IMPATIENT_DOWN = 4;
/** hur många våningar hissteknikern springer i trappan för att nå instängda när hissen dröjer */
const RESCUE_STAIRS = 6;
/** ska teknikern rädda instängda (linbrott, eller ett fel där folk sitter fast)? @param {Person} p */
const rescueJob = p => { const e = S.elevators[p.job]; return !!e && (e.mode === 'snapped' || !!(e.fault && e.fault.trapped)); };
/** @param {Person} p */
const canWalk = p => !p.vip && !p.evac && !p.dog && !(p.cargo && p.cargo.kg >= 15) && p.goal !== undefined;
/** Tar personen trappan? impatient = har stått i kön en stund. Returnerar true om hen gick. @param {Person} p */
export function stairsChoice(p, impatient) {
  if (!canWalk(p) || !liftsAvailable() || p.tour || p.touring) return false; // (turistgruppen och rundvisningen håller ihop – ingen tar trappan själv)
  const span = p.goal - p.floor, down = span < 0, n = Math.abs(span);
  if (!n) return false;
  if (alwaysStairs(p) && !impatient) {
    S.stats.stairsChoice++; p.stairsByChoice = true;
    toStairs(p, sv`${n} våningar ${down ? 'ner' : 'upp'} till fots – som vanligt`);
    say(p, 'stairs');
    return true;
  }
  if (!impatient) {
    if (n > (down ? STAIRS_DOWN : STAIRS_UP) || p.fit < (down ? 0.55 : 0.7)) return false;
    S.stats.stairsChoice++; p.stairsByChoice = true;
    toStairs(p, n === 1 ? sv`Det är bara en våning – tar trappan ${down ? 'ner' : 'upp'}` : sv`Bara ${n} våningar ner – tar trappan`);
    return true;
  }
  if (p.waited < 20 + p.patience * 2 || n > (down ? STAIRS_IMPATIENT_DOWN : STAIRS_IMPATIENT_UP) || p.fit < 0.25) return false;
  // hissen som är på väg hit inom några sekunder väntar man ut
  if (p.assigned !== null && eta(S.elevators[p.assigned], p.floor, p.dir) < 8) return false;
  S.stats.stairsChoice++; p.stairsByChoice = true;
  toStairs(p, n > 1 ? sv`Tröttnar på att vänta efter ${Math.round(p.waited)} s – det är bara ${n} våningar, tar trappan`
    : sv`Tröttnar på att vänta efter ${Math.round(p.waited)} s – det är bara en våning, tar trappan`);
  return true;
}
/** Dit man utryms: de som jobbar, bor eller är på besök samlas utanför entrén (återsamlingsplatsen) – även de som
 *  kom med tåg eller bil. Inhyrd personal och VIP-gästerna tar sin egen utgång. @param {Person} p */
// (brinner det nedanför sky lobbyn går de som är där eller ovanför ut över bron till Kronan, skywalk.js)
export const evacFloor = p => (!p.role && !p.vip && !p.movedOut && ['emp', 'vis', 'res'].includes(p.kind) ? (bridgeEvac(p) ? SKYWALK_F : LOBBY)
  : p.exitFloor);
/**
 * Det brinner dit p ska: ingen går trappan in i brandzonen. Hen går ut till återsamlingsplatsen och kommer in igen
 * när branden är släckt (evacFrom). Gäller de som jobbar, bor och är på besök – inte brandkåren och annan personal.
 * @param {Person} p
 */
export function fireDivert(p) {
  if (!S.fire || p.evac || p.role || p.vip || !['emp', 'vis', 'res'].includes(p.kind) || p.goal === undefined || !inFireZone(p.goal)) return false;
  const to = p.goal;
  pev(p, sv`Brandlarm på vägen till ${fl(to)} – dit går ingen nu, väntar utanför tills det är släckt`);
  const ws = p.waitStart;
  p.evac = true; p.evacFrom = to;
  setTrip(p, LOBBY, 'BRANDLARM – väntar utanför tills det är släckt', true);
  if (p.state === 'toQueue') { p.keepWait = true; p.waitStart = ws; }
  return true;
}
/** @param {Person} p */
export function toStairs(p, why) {
  if (fireDivert(p)) return;
  p.escalator = false; p.fromUpper = false;
  p.state = 'stairs'; p.assigned = null; p.tx = STAIR_X; p.car = null; p.mood = Math.min(p.mood, 1);
  p.dest = p.goal ?? p.dest; p.dir = Math.sign(p.dest - p.floor); // trappan går hela vägen
  pev(p, why);
  log(sv`${pn(p)} tar trapporna ${fl(p.floor)}→${fl(p.dest)}`, 'person', null, p.id);
}
/** @param {Person} p */
export function stairsDone(p) {
  p.floor = p.dest; p.x = STAIR_X + 4; p.trips++; p.stairsByChoice = false;
  if (p.escalator) { p.escalator = false; pev(p, sv`Framme på ${fl(p.floor)} med rulltrappan`); arriveOnFloor(p); return; }
  S.stats.stairs++;
  pev(p, sv`Framme på ${fl(p.floor)} via trapporna – flåsar`);
  arriveOnFloor(p);
}
/** målet har stängt: tillbaka till jobbet (anställda) eller ut ur huset @param {Person} p */
function turnBack(p) {
  const back = p.kind === 'emp' ? p.home : p.exitFloor;
  const name = FL[p.goal].name;
  pev(p, sv`${name} har hunnit stänga – vänder på ${fl(p.floor)}`);
  const ws = p.waitStart;
  setTrip(p, back, back === p.exitFloor ? sv`${name} har hunnit stänga – går ut` : sv`${name} har hunnit stänga – tillbaka till jobbet`);
  if (p.state === 'toQueue') { p.keepWait = true; p.waitStart = ws; }
}
/** har våningen f (med öppettider) stängt för den här personen? @param {Person} p */
const closedFor = (p, f) => !p.role && !p.guest && p.kind !== 'res' && !p.vip && f !== p.home && f !== p.exitFloor && !!FLOOR_HOURS[f] && !floorOpen(f, hour());
/** var p lämnar huset just nu: sin vanliga utgång, eller (utrymd vid brand) den hen utryms genom @param {Person} p */
const exitOf = p => (p.evac ? evacFloor(p) : p.exitFloor);
/** @param {Person} p */
export function arriveOnFloor(p) {
  // personen har kommit fram till sin våning (med hiss eller trappa)
  // på väg genom huset till en våning som hann stänga under resan: vänd vid hissbytet
  if (p.goal !== undefined && p.floor !== p.goal && closedFor(p, p.goal)) { turnBack(p); return; }
  if (p.goal !== undefined && p.floor !== p.goal) {
    // framme vid ett delmål (sky lobbyn) – byt hiss och fortsätt
    S.stats.transfers++;
    p.dest = legDest(p.floor, p.goal, p); p.dir = Math.sign(p.dest - p.floor);
    p.state = 'toQueue'; p.tx = queueSpot(p.floor); p.assigned = null; p.bank = null; p.fixAt = 0;
    if (escalatorHop(p)) { rideEscalator(p); return; }
    pev(p, sv`Byter hiss på ${fl(p.floor)} – vidare mot ${fl(p.goal)}`);
    log(sv`↹ ${pn(p)} byter hiss på ${fl(p.floor)} (mot ${fl(p.goal)})`, 'person', null, p.id);
    return;
  }
  // branden släcktes innan hen hann ut: tillbaka dit hen kom ifrån (i stället för att gå hem för dagen)
  if (p.evacBack) { p.evacBack = false; if (fireReturn(p, 'Faran över – tillbaka in')) return; }
  const out = exitOf(p);
  if (p.evac && p.floor === out) { S.stats.evacuated++; if (S.fire) S.fire.evac++; }
  if (p.floor === out && p.leaving) {
    if (bridgeOut(p)) return; // (ut över bron till Kronan, skywalk.js)
    p.state = 'exiting'; p.spot = null;
    // tunnelbanan: ställ sig på perrongen framför tåget
    if (p.floor === STATION) { p.toTrain = true; p.tx = rand(TRAIN_X0 + 10, TRAIN_X1 - 10); return; }
    p.tx = p.auto && p.auto.floor === p.floor ? p.auto.x + 22 : -40; return;
  }
  p.state = 'exiting';
  gotoSpot(p, p.floor);
}
/** @param {Person} p */
export function boardDone(p) {
  const e = p.car;
  e.reserved--; e.resKg = Math.max(0, (e.resKg || 0) - personKg(p)); e.passengers.push(p); p.state = 'ride';
  if (loadKg(e) > e.ratedKg) { kickOff(e, p); return; }
  p.avoid = undefined;
  maybeStumble(e, p);
  if (moveBoard(e, p)) return; // (flyttdag: en lång möbel kan behöva vändas i dörren – eller fastna helt)
  if (!e.carCalls.has(posOf(e, p.dest))) {
    e.carCalls.add(posOf(e, p.dest));
    pev(p, sv`Inne i hiss ${e.name} – ${fl(p.dest)} läggs på hissens stopplista`);
    log(sv`${e.name}: ${pn(p)} ska till ${fl(p.dest)} – nytt stopp`, 'car', e.color, p.id);
  } else pev(p, sv`Inne i hiss ${e.name} – den ska redan till ${fl(p.dest)}`);
  // KNAPPAR: knappanelen i korgen – ibland trycker man fel, och barn trycker gärna på allt
  if (buttonsMode() && !keyed(p)) carButtonMistakes(p, e);
  if (p.cast) castBoard(p, e);
  incidentTalk(p, e);
}
/** @param {Person} p */
export function exitDone(p) {
  if (p.toBridge) { enterBridge(p); return; } // (vid dörren till bron: ut på den, skywalk.js)
  if (p.toTrain && p.leaving && p.floor === STATION && p.floor === p.exitFloor) {
    p.state = 'platform'; p.face = 1; p.waitStart = S.t;
    pev(p, S.train ? 'Framme på perrongen – tåget står inne!' : 'Väntar på tåget på perrongen');
    return;
  }
  // på väg ut när branden släcktes: vänder i dörren och går in igen
  if (!p.spot && p.evacBack) { p.evacBack = false; if (fireReturn(p, 'Faran över – tillbaka in')) return; }
  if ((p.leaving && p.floor === exitOf(p) && (p.tx < 0 || p.auto)) || !p.spot) { leaveBuilding(p); return; }
  p.state = 'office';
  p.face = p.spot.face || 1;
  pev(p, p.spot.desc);
  if (inFireZone(p.floor)) p.timer = rand(0.5, 2);
  // framme först efter stängning (resan tog för lång tid): vänder direkt
  else if (!p.role && p.kind !== 'res' && p.floor !== p.home && !floorOpen(p.floor, hour()) && FLOOR_HOURS[p.floor]) {
    p.timer = rand(0.3, 1);
    pev(p, sv`${FL[p.floor].name} har redan stängt – vänder direkt`);
  }
  else if (p.kind === 'res') p.timer = p.floor === p.home ? rand(12, 25) : rand(25, 45);
  // framme vid tunnelbanan men inte på väg med tåget (sista tåget har gått): vidare upp till entrén
  else if (p.floor === STATION && !p.role) { p.timer = rand(0.3, 1.2); pev(p, S.trainDone ? 'Inga fler tåg i natt – går upp till entrén' : 'Tittar på tidtabellen'); }
  else if (sysArrive(p)) { /* (delsystemen sätter timern: den lösa hunden, de som jagar den, kuppens gäng – systems.js) */ }
  else if (p.role === 'bud') { p.timer = rand(8, 15); S.stats.deliveries++; }
  else if (p.role === 'flyttgubbe') p.timer = moverTimer(p); // (i lägenheten: packar eller skruvar isär nästa lass)
  else if (p.role === 'ambulans') p.timer = rand(5, 8);
  else if (p.role === 'brandman') p.timer = S.fire && p.floor >= S.fire.floor ? 1e9 : rand(0.3, 1); // (släcker tills branden är ute)
  else if (p.role === 'hisstekniker') p.timer = p.job !== null && p.job !== undefined ? 1e9 : rand(1, 3); // arbetet sköts av service.js
  else if (p.crewId) p.timer = CREW_LOOK; // (personalen tittar ofta upp: rast, larm, skiftbyte – crew.js)
  else if (p.role === 'arbetsledare') p.timer = 6; // (tittar till hissen, se foremanNext i service.js)
  else if (p.role === 'räddare') p.timer = 4;
  else if (p.role) p.timer = { 'väktare': rand(8, 15), 'städare': rand(25, 45), 'vaktmästare': rand(30, 50), 'nattdj': rand(60, 120), 'nattekniker': p.floor === LOBBY ? rand(4, 8) : rand(30, 70) }[p.role];
  else if (p.floor === CAFE) p.timer = rand(25, 60);
  else if (p.kind === 'vis') p.timer = rand(20, 50);
  else if (p.floor === p.home) p.timer = rand(40, 110);
  else p.timer = rand(30, 70);
  capTimer(p);
}
// ---------- Nästa kända händelse ----------
// Rumstimern slumpas, men den som har en tid att passa (lunch, hemgång, att våningen stänger, de
// boendes schema) ska inte sitta kvar förbi den: timern kapas så att nästa beslut kommer strax efter.
/** klockslaget (6–30) för personens nästa kända händelse efter h, eller Infinity @param {Person} p */
export function nextEventH(p, h) {
  if (p.role) return Infinity; // personalens rundor styrs av egna timrar
  const ts = [];
  if (p.kind === 'res') {
    for (const ev of p.sched || []) if (!ev.done) ts.push(ev.at);
    if (p.sleepAt !== undefined) ts.push(p.sleepAt);
    if (p.wake !== undefined) ts.push(p.wake, p.wake + 24);
  } else {
    ts.push(27.5); // natten är slut – alla går hem
    if (p.kind === 'emp') {
      ts.push(p.leaveAt);
      if (!p.lunched && p.floor !== CAFE) ts.push(p.lunchAt);
    }
    const oh = FLOOR_HOURS[p.floor];
    if (oh && p.floor !== p.home) ts.push(oh[1]);
  }
  let m = Infinity;
  for (const t of ts) if (t > h && t < m) m = t;
  return m;
}
/** kapa rumstimern (räknas i speltid via activityRate) så att den löper ut strax efter nästa händelse @param {Person} p */
export function capTimer(p) {
  const h = hour(), t = nextEventH(p, h);
  if (t === Infinity) return;
  const units = roomUnits(h, t + 0.005);
  if (units < p.timer) p.timer = units;
}
/** @param {Person} p */
export function decideNext(p) {
  const h = hour();
  // (personalen går ut i entrén och väntar där – de lämnar inte huset)
  if (inFireZone(p.floor) && p.crewId) { p.onBreak = false; return [LOBBY, 'BRANDLARM – går ner till entrén', false]; }
  // (teknikern vid en korg där folk sitter fast släpper ut dem först – service.js)
  if (inFireZone(p.floor) && p.role === 'hisstekniker' && fireCrank(p)) return null;
  if (inFireZone(p.floor) && !p.ff) { p.evac = true; p.evacFrom = p.floor; return [evacFloor(p), 'BRANDLARM – utrymning!', true]; }
  // (delsystemen: kuppens hjälte och gisslan, den som jagar den lösa hunden – systems.js)
  const sn = sysNext(p);
  if (sn !== undefined) return sn;
  // (väktaren som visar runt: rundvisningen bestämmer vart han går, visning.js)
  if (p.touring && p.role && !p.crewId) return null;
  if (p.role) return roleNext(p, h);
  if (p.collapsed) { p.timer = 1e9; return null; } // ligger kvar tills ambulansen kommer
  if (p.kind === 'res') return resNext(p, h);
  if (p.tour || p.guide) return tourNext(p);
  if (p.guest) return guestNext(p); // (rundvisningen: guiden säger till när de går vidare, visning.js) // (Stadsturen: guiden säger till när gruppen går vidare, tour.js)
  if (h >= 27.5) return [p.exitFloor, 'Natten är slut – äntligen hem']; // natten går fort: hemresan tar ett par speltimmar
  if (p.kind === 'vis') {
    // i hundsalongen hämtar man sin pudel och har den med sig ut (kopplet syns i hallen och i hissen)
    if (p.floor === SPA && p.cargo && p.cargo.kind === 'raggig') { p.cargo = null; pev(p, 'Lämnar in den raggiga pudeln – hämtas i morgon'); return [p.exitFloor, 'Går ut utan hund']; }
    if (p.floor === SPA && !p.cargo) { withCargo(p, 'pudel'); pev(p, 'Får tillbaka sin nyklippta pudel'); return [p.exitFloor, 'Går ut med pudeln']; }
    return [p.exitFloor, 'Ärendet klart – går ut'];
  }
  if (h >= p.leaveAt) return [p.exitFloor, p.overtime ? 'Övertiden är slut – hemgång' : 'Arbetsdagen är slut – hemgång'];
  // en stängd våning lämnar man om man inte jobbar där
  if (!floorOpen(p.floor, h) && p.floor !== p.home) return [p.home, sv`${FL[p.floor].name} stänger – tillbaka till jobbet`];
  if (!p.lunched && h >= p.lunchAt && h < 13.6 && p.floor !== CAFE && floorOpen(CAFE, h)) { p.lunched = true; return [CAFE, sv`Lunchsugen – till ${FL[CAFE].name}`]; }
  if (p.floor !== p.home) return [p.home, sv`Tillbaka till jobbet på ${FL[p.home].short}`];
  const own = castNext(p, h);
  if (own) return own;
  if (rng() < 0.14 && h < 16.5) {
    // bara dit som har öppet en halvtimme till – resan över zonerna (via entrén och sky lobbyn) tar en stund
    const g = pick(OFFICE_FLOORS.filter(f => f !== p.home && floorOpen(f, h) && floorOpen(f, h + 1.5)).concat([null]));
    if (g !== null && g !== undefined) return [g, sv`Möte på ${FL[g].short}`];
  }
  return null;
}
/** @param {Person} p */
export function officeDone(p) {
  const r = decideNext(p);
  // den som står vid utgången och ska gå hem (flyttgubbarna vid lastkajen, den som blev utsläppt i entrén) går direkt ut
  const leaveHere = r && r[0] === p.floor && p.floor === p.exitFloor && r[2] !== false;
  // (flyttgubben som ställde en möbel vid lastluckan tar nästa lass direkt)
  if (r && r[0] === p.floor && p.mover && !leaveHere) { p.timer = moverTimer(p); return; }
  if (!r || (r[0] === p.floor && !leaveHere)) {
    if (p.crewId) { p.timer = CREW_LOOK; return; }
    p.timer = p.collapsed ? 1e9 : rand(40, 110); if (!p.collapsed) capTimer(p); return;
  }
  p.x = p.spot ? p.spot.x : p.x;
  releaseSpot(p);
  setTrip(p, r[0], r[1], r[2]);
  if (p.ffStairs) { p.ffStairs = false; if (p.state === 'toQueue') toStairs(p, r[1]); } // (brandmännen: sista biten i trappan)
  pev(p, sv`Bestämmer sig: ${r[1]} (${fl(r[0])})`);
  log(`${pn(p)}: ${r[1]} → ${fl(r[0])}`, 'person', null, p.id);
}

// ---------- Kvälls- och nattpersonal ----------
const JANITOR_TASKS = ['Byter ett lysrör', 'Lagar en knarrande dörr', 'Kollar ventilationen', 'Torkar upp en kaffefläck', 'Smörjer dörrgångjärn'];
/** personal kommer till jobbet; extra = inringd extra hisstekniker (tar bara hissfel, åker hem när kön är tom)
 * @param {string} role @param {boolean} [extra] @param {Partial<Person>|null} [o] */
export function spawnStaff(role, extra = false, o = null) {
  const G = G2, p = makePerson('staff', LOBBY, -30 - G.rand(0, 30));
  p.role = role;
  if (o) Object.assign(p, o);
  if (role === 'städare') withCargo(p, 'städvagn');
  if (role === 'vaktmästare') withCargo(p, 'verktygslåda');
  if (role === 'hisstekniker') { withCargo(p, 'servicevaska'); p.job = null; p.workT = 0; p.extra = extra; }
  const floors = OFFICE_FLOORS.concat(CAFE);
  if (role === 'väktare') { p.route = [...floors].reverse().concat(LOBBY); p.ri = -1; }
  if (role === 'städare') p.route = G.shuffle([...floors]).slice(0, 4); // tre städare delar på huset
  // (kvällsvaktmästaren börjar med att titta till pannan i pannrummet på P1; jourvaktmästaren kommer bara för sitt uppdrag)
  if (role === 'vaktmästare') p.route = p.jour ? [] : (DOCK >= 0 ? [DOCK] : []).concat(G.shuffle([...floors]).slice(0, 3));
  const first = roleNext(p, hour()) || (p.duty ? [p.duty.f, p.duty.why, false] : [p.exitFloor, 'Inget att göra i kväll – går hem']);
  setTrip(p, first[0], first[1], first[2]);
  S.people.push(p);
  const title = extra ? 'Extra hisstekniker (inringd)' : p.title || ROLE_NAMES[role];
  pev(p, sv`Kliver in i entrén · ${title} · ${p.why}`);
  log(sv`${pn(p)} (${title.toLowerCase()}) kommer till jobbet`, 'person', null, p.id);
  return p;
}
/** @param {Person} p */
function roleNext(p, h) {
  if (p.crewId) return crewNext(p, h);
  // (nyckelbäraren låser upp ett stängt stopp åt rundvisningen, visning.js)
  if (p.keys !== undefined && p.keys !== null) { const r = keyNext(p); if (r !== undefined) return r; }
  // (incidenternas och besökens roller – tekniker, räddare, hund, flyttgubbe, brandman, rånare … – står i registret, systems.js)
  const sr = sysRole(p, h);
  if (sr !== undefined) return sr;
  // husets egna roller
  switch (p.role) {
    case 'bud': return [p.exitFloor, 'Paketet levererat – tillbaka till lastbilen'];
    case 'väktare': {
      if (h >= 27 || p.shiftEnd) return [p.exitFloor, 'Passet är slut – går hem'];
      for (let i = 0; i < p.route.length; i++) {
        p.ri = (p.ri + 1) % p.route.length;
        const f = p.route[p.ri];
        if (f !== p.floor) return [f, f === LOBBY ? 'Väktarrunda: kollar entrén' : sv`Väktarrunda: kollar våning ${fl(f)}`];
      }
      return null;
    }
    case 'städare':
      while (p.route.length && p.route[0] === p.floor) p.route.shift();
      return p.route.length ? [p.route.shift(), 'Städar nästa våning'] : [p.exitFloor, 'Klar med städningen – går hem'];
    case 'vaktmästare':
      if (p.duty) return dutyNext(p);
      while (p.route.length && p.route[0] === p.floor) p.route.shift();
      if (!p.route.length) return [p.exitFloor, p.jour ? 'Uppdraget klart – åker hem igen' : 'Alla jobb fixade – går hem'];
      if (p.route[0] === DOCK) { p.task = 'Tittar till pannan i pannrummet'; return [p.route.shift(), p.task]; }
      p.task = pick(JANITOR_TASKS);
      return [p.route.shift(), p.task];
    case 'nattdj':
      if (h >= 27 || p.shiftEnd) return [p.exitFloor, 'Nattsändningen är slut – godnatt!'];
      return p.floor === floorWith('radio') ? null : [floorWith('radio'), 'Till studion – nattsändning på Kanal 97'];
    case 'nattekniker':
      if (h >= 27 || p.shiftEnd) return [p.exitFloor, 'Passet är slut – går hem'];
      if (p.floor !== floorWith('server')) return [floorWith('server'), 'Tillbaka till serverhallen'];
      return rng() < 0.5 ? [LOBBY, 'Hämtar kaffe från automaten i entrén'] : null;
  }
  return null;
}

/** hundägare till hundsalongen: hälften lämnar in en raggig pudel, hälften hämtar en nyklippt */
export function spawnDogOwner() {
  const drop = rng() < 0.5;
  const p = spawnVisitor(LOBBY, -30, SPA, drop ? 'Lämnar pudeln för klippning' : VISIT_WHY[SPA]);
  if (p && drop) withCargo(p, 'raggig');
  return p;
}
export function spawnPizza() { const p = spawnVisitor(LOBBY, -30, floorWith('radio'), 'Levererar pizza till nattsändningen'); if (p) { withCargo(p, 'pizza'); castPizza(p); } return p; }
