// Människor: utseende, resor, beslut, trapphus och platser.
import { pick, rand, randi, rng, shuffle } from './rng.js';
import { fl } from './util.js';
import { activityRate, roomUnits, FLOOR_HOURS, FL, NAMES, ROLE_NAMES, floorOpen, OFFICE_FLOORS, SPOTS, STAIR_X, VISIT_WHY, WAIT_X1, WALK, LOBBY, CAFE, DOCK, MEZZ, floorWith, EL, SKY, CAST, STATION, TRAIN_X0, TRAIN_X1 } from './config.js';
import { S, clockStr, hour, log, occOf, setOcc } from './state.js';
import { inFireZone, requestRide, loadKg, personKg, eta, keyed, posOf, costBased, prio, outLong, servesNow } from './dispatch.js';
import { techNext, maybeStumble } from './service.js';
import { moverNext, medicNext } from './visits.js';
import { alwaysStairs, castBoard, castNext, castPizza, castWaitTick, flushSay, say } from './cast.js';
import { kickOff } from './elevators.js';
import { arriveByCar, leaveBuilding, resNext, homeSpot } from './life.js';
import { buttonsMode, carButtonMistakes } from './buttons.js';

// ---------- Människor ----------
export const SKIN = ['#ffdbb8', '#f6c48f', '#d9a066', '#a8693f', '#7a4a2a', '#ffe4c8'];
export const SHIRT = ['#ff6fb5', '#4dd2ff', '#7cf06b', '#ffd23f', '#ff8c42', '#b388ff', '#2ec4b6', '#ff5d73', '#ffffff'];
export const PANTS = ['#2b2d6e', '#3a3a3a', '#6b4f2a', '#1f6f8b', '#5a2a6e', '#2f5d3a'];
export const HAIR_NAT = ['#2a1a10', '#5a3412', '#d9a441', '#b8461f', '#1b1033', '#e8e8e8'];
export const HAIR_FUN = ['#3f7cff', '#ff4fa3', '#7cf06b'];
export function makeLook() {
  return {
    skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS),
    hair: randi(0, 6), hairC: rng() < 0.12 ? pick(HAIR_FUN) : pick(HAIR_NAT),
    tie: rng() < 0.35, tieC: pick(SHIRT), stripe: rng() < 0.5,
    acc: pick([0, 0, 1, 1, 2, 2, 3, 4, 5]),
  };
}
export const pn = p => `${p.name} (${p.id})`;
// Namnen är unika i huset: en ny person får ett namn som ingen annan i huset bär just nu, och aldrig
// ett stamgästnamn (inte heller delar som "Pelle" i Pizza-Pelle). Exakt ett rng()-anrop, som förut.
const CAST_WORDS = new Set(CAST.flatMap(c => c.name.split(/[- ]/)));
const POOL = NAMES.filter(n => !CAST_WORDS.has(n));
const SUFFIX = 'BCDEFGHJKLMNOPRST';
export function freeName() {
  const used = new Set(S.people.map(p => p.name));
  const free = POOL.filter(n => !used.has(n));
  const r = rng();
  if (free.length) return free[Math.floor(r * free.length)];
  // alla namn är upptagna: samma namn med en bokstav efter (Lisa B, Lisa C …)
  const base = POOL[Math.floor(r * POOL.length)];
  for (const s of SUFFIX) if (!used.has(`${base} ${s}`)) return `${base} ${s}`;
  return `${base} ${S.nextId}`;
}
export function pev(p, text) {
  p.hist.unshift({ time: clockStr(), text });
  if (p.hist.length > 60) p.hist.pop();
  if (p === S.sel) S.trackDirty = true;
}
export function makePerson(kind, floor, x) {
  return {
    id: S.nextId++, name: freeName(), kind, floor, x, tx: x, dest: 0, dir: 0, state: 'toQueue',
    waitStart: 0, waited: 0, mood: 0, face: 1, walkPhase: rng() * 6,
    speedMul: rand(0.85, 1.15), depth: rand(-7, 0), look: makeLook(),
    timer: 0, dead: false, car: null, assigned: null, leaving: false, rideStart: 0, spot: null,
    why: '', hist: [], trips: 0, totalWait: 0, totalRide: 0, seen: '', patience: rand(5, 15),
    kg: Math.round(rand(55, 105)), cargo: null, exitFloor: LOBBY,
    fit: rng(), // hur gärna personen tar trappan (0 = aldrig, 1 = gärna)
    // hissetikett: hur många man står ut med i korgen (av 8) innan man hellre väntar på nästa (9 = bryr sig inte),
    // och om man håller upp dörren åt den som kommer springande
    space: 6 + Math.floor(rng() * 4), polite: rng() < 0.2,
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
};
const withCargo = (p, kind) => { p.cargo = { ...CARGO[kind] }; return p; };
export function queueSpot(f) {
  const n = S.people.reduce((a, p) => a + (p.floor === f && (p.state === 'wait' || p.state === 'toQueue') ? 1 : 0), 0);
  return WAIT_X1 - rand(0, Math.min(380, 60 + n * 9));
}
// ---------- Resplanering: delresor och hissbyten ----------
// Stora saker (städvagnar, leveranser) får bara åka varuhiss; varuhissen är för personal och gods.
export const needsFreight = p => !!(p.cargo && p.cargo.kg >= 22);
export const mayUseFreight = p => needsFreight(p) || p.kind === 'staff';
/** får personen åka den här hisstypen? */
// (ambulanspersonalen med båren och flyttgubbarna åker bara varuhiss)
export const elevatorAllows = (d, p) => (p.medic || p.mover ? !!d.freight : d.freight ? mayUseFreight(p) : !needsFreight(p));
/**
 * Nästa delmål på vägen mot goal: direkt om någon hiss går hela vägen, annars dit där man byter hiss
 * (t.ex. låg zon → entrén → expressen → sky lobbyn → hög zon). Söker resvägen med minst antal byten
 * och, bland dem, kortast sträcka. Bara hissar som personen får åka räknas.
 */
export function legDest(from, goal, p) {
  if (from === goal) return goal;
  // hissar som är trasiga eller på service undviks om det finns en annan väg
  const ok = EL.filter(d => elevatorAllows(d, p) && !down(d.id, p));
  const plan = route(from, goal, ok);
  const hop = plan !== null ? plan : route(from, goal, EL.filter(d => elevatorAllows(d, p))) ?? (from !== SKY ? SKY : goal);
  // dubbeldäck: från entrén upp mot höga zonen kan man ta rulltrappan till mellanplanet och övre däcket
  if (MEZZ >= 0 && from === LOBBY && hop === SKY && goal > SKY && plan !== null && upperDeckChoice(goal, ok)) return MEZZ;
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
/** Byte mellan entrén och mellanplanet (på väg till eller från expressens övre däck) görs i rulltrappan */
const escalatorHop = p => MEZZ >= 0 && p.goal !== undefined
  && ((p.floor === LOBBY && p.dest === MEZZ && p.goal !== MEZZ) || (p.floor === MEZZ && p.dest === LOBBY && p.fromUpper));
function rideEscalator(p) {
  p.state = 'stairs'; p.escalator = true; p.fromUpper = false; p.assigned = null; p.car = null; p.tx = STAIR_X; p.dir = Math.sign(p.dest - p.floor);
  S.stats.escalator++;
  pev(p, p.dest === MEZZ ? 'Tar rulltrappan upp till mellanplanet – expressens övre däck' : 'Tar rulltrappan ner till entrén');
}
// (en hiss som är reserverad för VIP-gruppen eller ambulansen räknas som ur drift för alla andra)
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
/** Påbörja en resa mot slutmålet goal (kan bli flera delresor) */
export function setTrip(p, goal, why, leaving = goal === p.exitFloor) {
  p.goal = goal; p.dest = legDest(p.floor, goal, p); p.dir = Math.sign(p.dest - p.floor);
  p.leaving = leaving; p.why = why; p.assigned = null;
  p.state = 'toQueue'; p.tx = queueSpot(p.floor); p.mood = 0; p.bank = null; p.fixAt = 0;
  // redan framme (t.ex. teknikern vars jobb är i entrén där hen kliver in): gå direkt dit, ingen hiss
  if (goal === p.floor) arriveOnFloor(p);
  else if (escalatorHop(p)) rideEscalator(p);
}
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
export function pickSpot(p, f) {
  const list = SPOTS[f];
  // nattpersonal: egna platser
  if (p.kind === 'res' && f === p.home) return homeSpot(p);
  const own = p.role && list.find(s => s.role === p.role);
  if (own) return own;
  if (p.role) return { x: p.nearX ?? rand(150, 470), k: 'stand', face: pick([1, -1]), desc: p.task || ROLE_SPOT_DESC[p.role] || 'Jobbar', temp: true };
  const free = s => s.k === 'door' || occOf(s) === null;
  if (p.kind === 'emp' && f === p.home && p.homeSpot !== undefined && free(list[p.homeSpot])) return list[p.homeSpot];
  const pref = list.filter(s => free(s) && (p.kind === 'emp' ? s.staff : !s.staff));
  const any = list.filter(free);
  const s = pick(pref.length ? pref : any.length ? any : [null]);
  if (s) return s;
  return { x: rand(170, 460), k: 'stand', face: pick([1, -1]), desc: 'Står och väntar på en ledig plats', temp: true };
}
export function gotoSpot(p, f) {
  p.spot = pickSpot(p, f);
  if (!p.spot.temp && p.spot.k !== 'door') setOcc(p.spot, p.id);
  p.tx = p.spot.x;
}
/** En anställd kommer till jobbet: genom entrén, eller med tunnelbanan (trainX = dörren hen kliver av vid) */
export function spawnEmployee(trainX = null) {
  const byTrain = trainX !== null && STATION >= 0;
  const p = makePerson('emp', byTrain ? STATION : LOBBY, byTrain ? trainX : -30 - rand(0, 20));
  if (byTrain) p.exitFloor = STATION;
  if (p.look.acc === 1) withCargo(p, 'portfölj'); else if (p.look.acc === 5) withCargo(p, 'ryggsäck');
  p.home = pick(OFFICE_FLOORS);
  const staffIdx = SPOTS[p.home].map((s, i) => (s.staff ? i : -1)).filter(i => i >= 0);
  p.homeSpot = pick(staffIdx);
  // de flesta går hem 16–18:30, en del jobbar över på kvällen och några är riktiga nattugglor
  const r = rng();
  p.leaveAt = r < 0.85 ? rand(15.8, 18.6) : r < 0.97 ? rand(19, 22.5) : rand(23, 27);
  if (p.leaveAt >= 19) p.overtime = true;
  p.lunchAt = rng() < 0.6 ? rand(11.2, 12.9) : 99;
  p.lunched = false;
  setTrip(p, p.home, `Till jobbet på ${FL[p.home].short}`);
  if (!byTrain && rng() < 0.35) arriveByCar(p); // kör till jobbet om det finns plats i garaget
  S.people.push(p);
  pev(p, `${byTrain ? 'Kliver av tunnelbanan' : 'Kliver in i entrén'} · ${p.why} (${fl(p.home)})`);
  log(`${pn(p)} anländer${byTrain ? ' med tunnelbanan' : ''} · ska till ${fl(p.home)}`, 'person', null, p.id);
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
      const r = rng();
      const dentist = floorWith('dentist');
      dest = r < 0.18 && cand.includes(dentist) ? dentist : r < 0.38 && cand.includes(CAFE) ? CAFE : pick(cand);
    } else dest = rng() < 0.35 || !cand.length ? LOBBY : pick(cand);
  }
  const p = makePerson('vis', floor, x);
  setTrip(p, dest, why || (dest === LOBBY ? 'Ska ut ur huset' : VISIT_WHY[dest]));
  S.people.push(p);
  pev(p, `${floor === LOBBY ? 'Kliver in i entrén' : `Dyker upp på våning ${fl(floor)}`} · ${p.why} (${fl(dest)})`);
  log(`${pn(p)} dyker upp på ${fl(floor)} · ska till ${fl(dest)}`, 'person', null, p.id);
  return p;
}

export function walk(p, dt, speed = WALK) {
  const dx = p.tx - p.x, st = speed * p.speedMul * dt;
  if (Math.abs(dx) <= st) { p.x = p.tx; return true; }
  p.face = Math.sign(dx); p.x += p.face * st; p.walkPhase += dt * 10 * p.speedMul;
  return false;
}
export const liftsAvailable = () => S.power && !(S.fire && S.fire.mode === 'recall') && S.elevators.some(e => e.mode === 'normal' && !e.off);
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
      if (p.medic && !S.power) { toStairs(p, `Strömavbrott – bär ${p.cargo ? p.cargo.name : 'utrustningen'} i trapporna`); break; }
      // tung last (möbler, tunga paket) bärs inte i trapporna: man väntar ut strömavbrottet vid hissen
      if (!S.power && S.outage && p.cargo && p.cargo.kg >= 15) {
        if (p.darkNoted !== S.outage.t0) { p.darkNoted = S.outage.t0; pev(p, `Strömavbrott – ${p.cargo.name} går inte att bära i trapporna, väntar ut det`); }
        castWaitTick(p);
        break;
      }
      if (!liftsAvailable() && p.waited > p.patience) { toStairs(p, S.power ? 'Hissarna är avstängda – tar trapporna' : 'Hissarna står still (strömavbrott) – tar trapporna'); break; }
      // ingen hiss som går hit fungerar (trasig eller på service – sovande hissar vaknar ju): den som kan går
      if (p.waited > p.patience + 15 && S.power && stranded(p) && canWalk(p)) { toStairs(p, 'Ingen hiss går hit just nu (fel eller service) – tar trapporna'); break; }
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
        p.timer = p.escalator ? 1.6 : (2 + Math.abs(p.dest - p.floor) * 1.8) * (p.cargo && p.cargo.kg >= 15 ? 1.4 : 1);
        pev(p, p.escalator ? `Åker rulltrappa ${fl(p.floor)} → ${fl(p.dest)}` : `Går i trapphuset ${fl(p.floor)} → ${fl(p.dest)}`);
      }
      break;
    case 'instairs':
      p.timer -= dt;
      if (p.timer <= 0) stairsDone(p);
      break;
    case 'away': case 'incar': case 'platform': break; // utanför huset / i bilen (life.js) / väntar på tåget (train.js)
    case 'office':
      p.timer -= dt * activityRate(hour()); // vistelsen räknas i speltid
      if (p.timer <= 0) officeDone(p);
      break;
  }
}
// ---------- Strandsatt: hissen man väntar på är trasig eller på service ----------
/** finns det ingen fungerande hiss (sovande räknas – de vaknar) som tar personen den här delresan? */
const stranded = p => !S.elevators.some(e => servesNow(e, p));
/** Anropas när en hiss går sönder eller tas till service: de som stod och väntade på den byter väg direkt. */
export function rerouteStranded() {
  for (const p of S.people) {
    if (p.state !== 'wait' || p.goal === undefined || !stranded(p)) continue;
    const alt = legDest(p.floor, p.goal, p);
    if (alt === p.dest) continue;
    pev(p, `Vägen via ${fl(p.dest)} är ur funktion – tar en annan väg via ${fl(alt)}`);
    const ws = p.waitStart;
    setTrip(p, p.goal, p.why, p.leaving); p.keepWait = true; p.waitStart = ws;
  }
}

// ---------- Trappan som alternativ ----------
// Den som ska en våning upp eller ett par ner tar ofta trappan direkt, och den som har väntat länge
// på en kort resa tröttnar och går. Trappan går hela vägen till slutmålet (inga hissbyten).
export const STAIRS_UP = 1, STAIRS_DOWN = 2, STAIRS_IMPATIENT_UP = 2, STAIRS_IMPATIENT_DOWN = 4;
const canWalk = p => !p.vip && !p.evac && !(p.cargo && p.cargo.kg >= 15) && p.goal !== undefined;
/** Tar personen trappan? impatient = har stått i kön en stund. Returnerar true om hen gick. */
export function stairsChoice(p, impatient) {
  if (!canWalk(p) || !liftsAvailable()) return false;
  const span = p.goal - p.floor, down = span < 0, n = Math.abs(span);
  if (!n) return false;
  if (alwaysStairs(p) && !impatient) {
    S.stats.stairsChoice++; p.stairsByChoice = true;
    toStairs(p, `${n} våningar ${down ? 'ner' : 'upp'} till fots – som vanligt`);
    say(p, 'stairs');
    return true;
  }
  if (!impatient) {
    if (n > (down ? STAIRS_DOWN : STAIRS_UP) || p.fit < (down ? 0.55 : 0.7)) return false;
    S.stats.stairsChoice++; p.stairsByChoice = true;
    toStairs(p, n === 1 ? `Det är bara en våning – tar trappan ${down ? 'ner' : 'upp'}` : `Bara ${n} våningar ner – tar trappan`);
    return true;
  }
  if (p.waited < 20 + p.patience * 2 || n > (down ? STAIRS_IMPATIENT_DOWN : STAIRS_IMPATIENT_UP) || p.fit < 0.25) return false;
  // hissen som är på väg hit inom några sekunder väntar man ut
  if (p.assigned !== null && eta(S.elevators[p.assigned], p.floor, p.dir) < 8) return false;
  S.stats.stairsChoice++; p.stairsByChoice = true;
  toStairs(p, `Tröttnar på att vänta efter ${Math.round(p.waited)} s – det är bara ${n} våning${n > 1 ? 'ar' : ''}, tar trappan`);
  return true;
}
export function toStairs(p, why) {
  p.escalator = false; p.fromUpper = false;
  p.state = 'stairs'; p.assigned = null; p.tx = STAIR_X; p.car = null; p.mood = Math.min(p.mood, 1);
  p.dest = p.goal ?? p.dest; p.dir = Math.sign(p.dest - p.floor); // trappan går hela vägen
  pev(p, why);
  log(`${pn(p)} tar trapporna ${fl(p.floor)}→${fl(p.dest)}`, 'person', null, p.id);
}
export function stairsDone(p) {
  p.floor = p.dest; p.x = STAIR_X + 4; p.trips++; p.stairsByChoice = false;
  if (p.escalator) { p.escalator = false; pev(p, `Framme på ${fl(p.floor)} med rulltrappan`); arriveOnFloor(p); return; }
  S.stats.stairs++;
  pev(p, `Framme på ${fl(p.floor)} via trapporna – flåsar`);
  arriveOnFloor(p);
}
/** målet har stängt: tillbaka till jobbet (anställda) eller ut ur huset */
function turnBack(p) {
  const back = p.kind === 'emp' && p.home !== p.floor ? p.home : p.exitFloor;
  const name = FL[p.goal].name;
  pev(p, `${name} har hunnit stänga – vänder på ${fl(p.floor)}`);
  const ws = p.waitStart;
  setTrip(p, back, back === p.exitFloor ? `${name} har hunnit stänga – går ut` : `${name} har hunnit stänga – tillbaka till jobbet`);
  p.keepWait = true; p.waitStart = ws;
}
/** har våningen f (med öppettider) stängt för den här personen? */
const closedFor = (p, f) => !p.role && p.kind !== 'res' && !p.vip && f !== p.home && f !== p.exitFloor && !!FLOOR_HOURS[f] && !floorOpen(f, hour());
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
    pev(p, `Byter hiss på ${fl(p.floor)} – vidare mot ${fl(p.goal)}`);
    log(`↹ ${pn(p)} byter hiss på ${fl(p.floor)} (mot ${fl(p.goal)})`, 'person', null, p.id);
    return;
  }
  if (p.evac && p.floor === p.exitFloor) { S.stats.evacuated++; if (S.fire) S.fire.evac++; }
  if (p.floor === p.exitFloor && p.leaving) {
    p.state = 'exiting'; p.spot = null;
    // tunnelbanan: ställ sig på perrongen framför tåget
    if (p.floor === STATION) { p.toTrain = true; p.tx = rand(TRAIN_X0 + 10, TRAIN_X1 - 10); return; }
    p.tx = p.auto ? p.auto.x + 22 : -40; return;
  }
  p.state = 'exiting';
  gotoSpot(p, p.floor);
}
export function boardDone(p) {
  const e = p.car;
  e.reserved--; e.resKg = Math.max(0, (e.resKg || 0) - personKg(p)); e.passengers.push(p); p.state = 'ride';
  if (loadKg(e) > e.ratedKg) { kickOff(e, p); return; }
  p.avoid = undefined;
  maybeStumble(e, p);
  if (!e.carCalls.has(posOf(e, p.dest))) {
    e.carCalls.add(posOf(e, p.dest));
    pev(p, `Inne i hiss ${e.name} – ${fl(p.dest)} läggs på hissens stopplista`);
    log(`${e.name}: ${pn(p)} ska till ${fl(p.dest)} – nytt stopp`, 'car', e.color, p.id);
  } else pev(p, `Inne i hiss ${e.name} – den ska redan till ${fl(p.dest)}`);
  // KNAPPAR: knappanelen i korgen – ibland trycker man fel, och barn trycker gärna på allt
  if (buttonsMode() && !keyed(p)) carButtonMistakes(p, e);
  if (p.cast) castBoard(p, e);
}
export function exitDone(p) {
  if (p.toTrain && p.leaving && p.floor === STATION && p.floor === p.exitFloor) {
    p.state = 'platform'; p.face = 1; p.waitStart = S.t;
    pev(p, S.train ? 'Framme på perrongen – tåget står inne!' : 'Väntar på tåget på perrongen');
    return;
  }
  if (p.leaving && p.floor === p.exitFloor && (p.tx < 0 || p.auto)) { leaveBuilding(p); return; }
  p.state = 'office';
  p.face = p.spot.face || 1;
  pev(p, p.spot.desc);
  if (inFireZone(p.floor)) p.timer = rand(0.5, 2);
  // framme först efter stängning (resan tog för lång tid): vänder direkt
  else if (!p.role && p.kind !== 'res' && p.floor !== p.home && !floorOpen(p.floor, hour()) && FLOOR_HOURS[p.floor]) {
    p.timer = rand(0.3, 1);
    pev(p, `${FL[p.floor].name} har redan stängt – vänder direkt`);
  }
  else if (p.kind === 'res') p.timer = p.floor === p.home ? rand(12, 25) : rand(25, 45);
  // framme vid tunnelbanan men inte på väg med tåget (sista tåget har gått): vidare upp till entrén
  else if (p.floor === STATION && !p.role) { p.timer = rand(0.3, 1.2); pev(p, S.trainDone ? 'Inga fler tåg i natt – går upp till entrén' : 'Tittar på tidtabellen'); }
  else if (p.role === 'bud') { p.timer = rand(8, 15); S.stats.deliveries++; }
  else if (p.role === 'flyttgubbe') p.timer = p.floor === DOCK ? rand(1.5, 3) : rand(4, 7);
  else if (p.role === 'ambulans') p.timer = rand(5, 8);
  else if (p.role === 'hisstekniker') p.timer = p.job !== null && p.job !== undefined ? 1e9 : rand(1, 3); // arbetet sköts av service.js
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
/** klockslaget (6–30) för personens nästa kända händelse efter h, eller Infinity */
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
/** kapa rumstimern (räknas i speltid via activityRate) så att den löper ut strax efter nästa händelse */
export function capTimer(p) {
  const h = hour(), t = nextEventH(p, h);
  if (t === Infinity) return;
  const units = roomUnits(h, t + 0.005);
  if (units < p.timer) p.timer = units;
}
export function decideNext(p) {
  const h = hour();
  if (inFireZone(p.floor)) { p.evac = true; return [p.exitFloor, 'BRANDLARM – utrymning!']; }
  if (p.role) return roleNext(p, h);
  if (p.collapsed) { p.timer = 1e9; return null; } // ligger kvar tills ambulansen kommer
  if (p.kind === 'res') return resNext(p, h);
  if (h >= 27.5) return [p.exitFloor, 'Natten är slut – äntligen hem']; // natten går fort: hemresan tar ett par speltimmar
  if (p.kind === 'vis') return [p.exitFloor, 'Ärendet klart – går ut'];
  if (h >= p.leaveAt) return [p.exitFloor, p.overtime ? 'Övertiden är slut – hemgång' : 'Arbetsdagen är slut – hemgång'];
  // en stängd våning lämnar man om man inte jobbar där
  if (!floorOpen(p.floor, h) && p.floor !== p.home) return [p.home, `${FL[p.floor].name} stänger – tillbaka till jobbet`];
  if (!p.lunched && h >= p.lunchAt && h < 13.6 && p.floor !== CAFE && floorOpen(CAFE, h)) { p.lunched = true; return [CAFE, `Lunchsugen – till ${FL[CAFE].name}`]; }
  if (p.floor !== p.home) return [p.home, `Tillbaka till jobbet på ${FL[p.home].short}`];
  const own = castNext(p, h);
  if (own) return own;
  if (rng() < 0.14 && h < 16.5) {
    // bara dit som har öppet en halvtimme till – resan över zonerna (via entrén och sky lobbyn) tar en stund
    const g = pick(OFFICE_FLOORS.filter(f => f !== p.home && floorOpen(f, h) && floorOpen(f, h + 1.5)).concat([null]));
    if (g !== null && g !== undefined) return [g, `Möte på ${FL[g].short}`];
  }
  return null;
}
export function officeDone(p) {
  const r = decideNext(p);
  // personal som står vid utgången och ska gå hem (flyttgubbarna vid lastkajen) går direkt ut
  const leaveHere = r && r[0] === p.floor && p.role && p.floor === p.exitFloor && r[2] !== false;
  if (!r || (r[0] === p.floor && !leaveHere)) { p.timer = p.collapsed ? 1e9 : rand(40, 110); if (!p.collapsed) capTimer(p); return; }
  p.x = p.spot ? p.spot.x : p.x;
  releaseSpot(p);
  setTrip(p, r[0], r[1], r[2]);
  pev(p, `Bestämmer sig: ${r[1]} (${fl(r[0])})`);
  log(`${pn(p)}: ${r[1]} → ${fl(r[0])}`, 'person', null, p.id);
}

// ---------- Kvälls- och nattpersonal ----------
const JANITOR_TASKS = ['Byter ett lysrör', 'Lagar en knarrande dörr', 'Kollar ventilationen', 'Torkar upp en kaffefläck', 'Smörjer dörrgångjärn'];
export function spawnStaff(role) {
  const p = makePerson('staff', LOBBY, -30 - rand(0, 30));
  p.role = role;
  if (role === 'städare') withCargo(p, 'städvagn');
  if (role === 'vaktmästare') withCargo(p, 'verktygslåda');
  if (role === 'hisstekniker') { withCargo(p, 'servicevaska'); p.job = null; p.workT = 0; }
  const floors = OFFICE_FLOORS.concat(CAFE);
  if (role === 'väktare') { p.route = [...floors].reverse().concat(LOBBY); p.ri = -1; }
  if (role === 'städare') p.route = shuffle([...floors]).slice(0, 4); // tre städare delar på huset
  if (role === 'vaktmästare') p.route = shuffle([...floors]).slice(0, 3);
  const first = roleNext(p, hour()) || [p.exitFloor, 'Inget att göra i kväll – går hem'];
  setTrip(p, first[0], first[1], first[2]);
  S.people.push(p);
  pev(p, `Kliver in i entrén · ${ROLE_NAMES[role]} · ${p.why}`);
  log(`${pn(p)} (${ROLE_NAMES[role].toLowerCase()}) kommer till jobbet`, 'person', null, p.id);
  return p;
}
function roleNext(p, h) {
  switch (p.role) {
    case 'bud': return [p.exitFloor, 'Paketet levererat – tillbaka till lastbilen'];
    case 'hisstekniker': return techNext(p);
    case 'flyttgubbe': return moverNext(p);
    case 'ambulans': return medicNext(p);
    case 'väktare': {
      if (h >= 27) return [p.exitFloor, 'Passet är slut – går hem'];
      for (let i = 0; i < p.route.length; i++) {
        p.ri = (p.ri + 1) % p.route.length;
        const f = p.route[p.ri];
        if (f !== p.floor) return [f, f === LOBBY ? 'Väktarrunda: kollar entrén' : `Väktarrunda: kollar våning ${fl(f)}`];
      }
      return null;
    }
    case 'städare':
      while (p.route.length && p.route[0] === p.floor) p.route.shift();
      return p.route.length ? [p.route.shift(), 'Städar nästa våning'] : [p.exitFloor, 'Klar med städningen – går hem'];
    case 'vaktmästare':
      while (p.route.length && p.route[0] === p.floor) p.route.shift();
      if (!p.route.length) return [p.exitFloor, 'Alla jobb fixade – går hem'];
      p.task = pick(JANITOR_TASKS);
      return [p.route.shift(), p.task];
    case 'nattdj':
      if (h >= 27) return [p.exitFloor, 'Nattsändningen är slut – godnatt!'];
      return p.floor === floorWith('radio') ? null : [floorWith('radio'), 'Till studion – nattsändning på Kanal 97'];
    case 'nattekniker':
      if (h >= 27) return [p.exitFloor, 'Passet är slut – går hem'];
      if (p.floor !== floorWith('server')) return [floorWith('server'), 'Tillbaka till serverhallen'];
      return rng() < 0.5 ? [LOBBY, 'Hämtar kaffe från automaten i entrén'] : null;
  }
  return null;
}

// En busslast turister – de flesta med resväska. Returnerar antalet som kom in (0 om allt är stängt).
export function spawnBus(n = 14) {
  let k = 0;
  for (let i = 0; i < n; i++) {
    const p = spawnVisitor(LOBBY, -30 - i * 24, rng() < 0.5 ? CAFE : pick(OFFICE_FLOORS), 'Turist på busstur');
    if (!p) continue;
    p.look.acc = rng() < 0.5 ? 3 : p.look.acc;
    p.space = 9; // turistgruppen tränger ihop sig – ingen vill bli lämnad kvar
    if (rng() < 0.7) withCargo(p, 'resväska');
    k++;
  }
  return k;
}
export function spawnPizza() { const p = spawnVisitor(LOBBY, -30, floorWith('radio'), 'Levererar pizza till nattsändningen'); if (p) { withCargo(p, 'pizza'); castPizza(p); } return p; }
