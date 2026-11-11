// Människor: utseende, resor, beslut, trapphus och platser.
import { pick, rand, randi, rng, shuffle } from './rng.js';
import { fl } from './util.js';
import { FL, NAMES, ROLE_NAMES, floorOpen, OFFICE_FLOORS, SPOTS, STAIR_X, TOP, VISIT_WHY, WAIT_X1, WALK, RATED_KG, LOBBY, CAFE, floorWith, EL, SKY } from './config.js';
import { S, clockStr, hour, log } from './state.js';
import { inFireZone, requestRide, loadKg, personKg } from './dispatch.js';
import { kickOff } from './elevators.js';
import { arriveByCar, leaveBuilding, resNext, homeSpot } from './life.js';

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
export function pev(p, text) {
  p.hist.unshift({ time: clockStr(), text });
  if (p.hist.length > 60) p.hist.pop();
  if (p === S.sel) S.trackDirty = true;
}
export function makePerson(kind, floor, x) {
  return {
    id: S.nextId++, name: pick(NAMES), kind, floor, x, tx: x, dest: 0, dir: 0, state: 'toQueue',
    waitStart: 0, waited: 0, mood: 0, face: 1, walkPhase: rng() * 6,
    speedMul: rand(0.85, 1.15), depth: rand(-7, 0), look: makeLook(),
    timer: 0, dead: false, car: null, assigned: null, leaving: false, rideStart: 0, spot: null,
    why: '', hist: [], trips: 0, totalWait: 0, totalRide: 0, seen: '', patience: rand(5, 15),
    kg: Math.round(rand(55, 105)), cargo: null, exitFloor: LOBBY,
  };
}
export const CARGO = {
  portfölj: { kind: 'portfölj', name: 'portfölj', kg: 3 },
  ryggsäck: { kind: 'ryggsäck', name: 'ryggsäck', kg: 8 },
  resväska: { kind: 'resväska', name: 'resväska', kg: 20 },
  städvagn: { kind: 'städvagn', name: 'städvagn', kg: 60 },
  verktygslåda: { kind: 'verktygslåda', name: 'verktygslåda', kg: 22 },
  pizza: { kind: 'pizza', name: 'pizzakartonger', kg: 6 },
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
export const elevatorAllows = (d, p) => (d.freight ? mayUseFreight(p) : !needsFreight(p));
/** Nästa delmål: direkt om någon hiss går hela vägen, annars till sky lobbyn för att byta hiss. */
export function legDest(from, goal, p) {
  if (from === goal) return goal;
  if (EL.some(d => elevatorAllows(d, p) && d.serves.includes(from) && d.serves.includes(goal))) return goal;
  return from !== SKY ? SKY : goal;
}
/** Påbörja en resa mot slutmålet goal (kan bli flera delresor) */
export function setTrip(p, goal, why) {
  p.goal = goal; p.dest = legDest(p.floor, goal, p); p.dir = Math.sign(p.dest - p.floor);
  p.leaving = goal === p.exitFloor; p.why = why; p.assigned = null;
  p.state = 'toQueue'; p.tx = queueSpot(p.floor); p.mood = 0;
}
export function releaseSpot(p) {
  const s = p.spot;
  if (s && !s.temp && s.occ === p.id) s.occ = null;
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
  if (p.role) return { x: rand(150, 470), k: 'stand', face: pick([1, -1]), desc: p.task || ROLE_SPOT_DESC[p.role] || 'Jobbar', temp: true };
  const free = s => s.k === 'door' || !s.occ;
  if (p.kind === 'emp' && f === p.home && p.homeSpot !== undefined && free(list[p.homeSpot])) return list[p.homeSpot];
  const pref = list.filter(s => free(s) && (p.kind === 'emp' ? s.staff : !s.staff));
  const any = list.filter(free);
  const s = pick(pref.length ? pref : any.length ? any : [null]);
  if (s) return s;
  return { x: rand(170, 460), k: 'stand', face: pick([1, -1]), desc: 'Står och väntar på en ledig plats', temp: true };
}
export function gotoSpot(p, f) {
  p.spot = pickSpot(p, f);
  if (!p.spot.temp && p.spot.k !== 'door') p.spot.occ = p.id;
  p.tx = p.spot.x;
}
export function spawnEmployee() {
  const p = makePerson('emp', LOBBY, -30 - rand(0, 20));
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
  if (rng() < 0.35) arriveByCar(p); // kör till jobbet om det finns plats i garaget
  S.people.push(p);
  pev(p, `Kliver in i entrén · ${p.why} (${fl(p.home)})`);
  log(`${pn(p)} anländer · ska till ${fl(p.home)}`, 'person', null, p.id);
  return p;
}
export const openFloors = (h = hour()) => OFFICE_FLOORS.concat(CAFE).filter(f => floorOpen(f, h));
// Besökare går bara till våningar som är öppna. Returnerar null om inget är öppet (t.ex. mitt i natten).
export function spawnVisitor(floor = 0, x = -30, dest = null, why = null) {
  const h = hour(), open = openFloors(h);
  if (dest !== null && dest !== LOBBY && !floorOpen(dest, h)) dest = null;
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
      if (walk(p, dt)) { p.state = 'wait'; if (!p.keepWait) p.waitStart = S.t; p.keepWait = false; p.face = 1; requestRide(p); }
      break;
    case 'wait':
      p.waited = S.t - p.waitStart;
      p.mood = p.waited > 55 ? 2 : p.waited > 28 ? 1 : 0;
      if (p.mood === 2 && !p.angryNoted) { p.angryNoted = true; pev(p, 'Börjar bli riktigt sur… #@%!'); }
      if (!liftsAvailable() && p.waited > p.patience) toStairs(p, S.power ? 'Hissarna är avstängda – tar trapporna' : 'Hissarna står still (strömavbrott) – tar trapporna');
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
        p.timer = 2 + Math.abs(p.dest - p.floor) * 1.8;
        pev(p, `Går i trapphuset ${fl(p.floor)} → ${fl(p.dest)}`);
      }
      break;
    case 'instairs':
      p.timer -= dt;
      if (p.timer <= 0) stairsDone(p);
      break;
    case 'away': case 'incar': break; // utanför huset / sitter i bilen (sköts i life.js)
    case 'office':
      p.timer -= dt;
      if (p.timer <= 0) officeDone(p);
      break;
  }
}
export function toStairs(p, why) {
  p.state = 'stairs'; p.assigned = null; p.tx = STAIR_X; p.car = null; p.mood = Math.min(p.mood, 1);
  p.dest = p.goal ?? p.dest; p.dir = Math.sign(p.dest - p.floor); // trappan går hela vägen
  pev(p, why);
  log(`${pn(p)} tar trapporna ${fl(p.floor)}→${fl(p.dest)}`, 'person', null, p.id);
}
export function stairsDone(p) {
  p.floor = p.dest; p.x = STAIR_X + 4; p.trips++;
  S.stats.stairs++;
  pev(p, `Framme på ${fl(p.floor)} via trapporna – flåsar`);
  arriveOnFloor(p);
}
export function arriveOnFloor(p) {
  // personen har kommit fram till sin våning (med hiss eller trappa)
  if (p.goal !== undefined && p.floor !== p.goal) {
    // framme vid ett delmål (sky lobbyn) – byt hiss och fortsätt
    S.stats.transfers++;
    p.dest = legDest(p.floor, p.goal, p); p.dir = Math.sign(p.dest - p.floor);
    p.state = 'toQueue'; p.tx = queueSpot(p.floor); p.assigned = null;
    pev(p, `Byter hiss på ${fl(p.floor)} – vidare mot ${fl(p.goal)}`);
    log(`↹ ${pn(p)} byter hiss på ${fl(p.floor)} (mot ${fl(p.goal)})`, 'person', null, p.id);
    return;
  }
  if (p.evac && p.floor === p.exitFloor) { S.stats.evacuated++; if (S.fire) S.fire.evac++; }
  if (p.floor === p.exitFloor && p.leaving) { p.state = 'exiting'; p.tx = p.auto ? p.auto.x + 22 : -40; p.spot = null; return; }
  p.state = 'exiting';
  gotoSpot(p, p.floor);
}
export function boardDone(p) {
  const e = p.car;
  e.reserved--; e.resKg = Math.max(0, (e.resKg || 0) - personKg(p)); e.passengers.push(p); p.state = 'ride';
  if (loadKg(e) > e.ratedKg) { kickOff(e, p); return; }
  p.avoid = undefined;
  if (!e.carCalls.has(p.dest)) {
    e.carCalls.add(p.dest);
    pev(p, `Inne i hiss ${e.name} – ${fl(p.dest)} läggs på hissens stopplista`);
    log(`${e.name}: ${pn(p)} ska till ${fl(p.dest)} – nytt stopp`, 'car', e.color, p.id);
  } else pev(p, `Inne i hiss ${e.name} – den ska redan till ${fl(p.dest)}`);
}
export function exitDone(p) {
  if (p.leaving && p.floor === p.exitFloor && (p.tx < 0 || p.auto)) { leaveBuilding(p); return; }
  p.state = 'office';
  p.face = p.spot.face || 1;
  pev(p, p.spot.desc);
  if (inFireZone(p.floor)) p.timer = rand(0.5, 2);
  else if (p.kind === 'res') p.timer = p.floor === p.home ? rand(12, 25) : rand(25, 45);
  else if (p.role === 'bud') { p.timer = rand(8, 15); S.stats.deliveries++; }
  else if (p.role) p.timer = { 'väktare': rand(8, 15), 'städare': rand(25, 45), 'vaktmästare': rand(30, 50), 'nattdj': rand(60, 120), 'nattekniker': p.floor === LOBBY ? rand(4, 8) : rand(30, 70) }[p.role];
  else if (p.floor === CAFE) p.timer = rand(25, 60);
  else if (p.kind === 'vis') p.timer = rand(20, 50);
  else if (p.floor === p.home) p.timer = rand(40, 110);
  else p.timer = rand(30, 70);
}
export function decideNext(p) {
  const h = hour();
  if (inFireZone(p.floor)) { p.evac = true; return [p.exitFloor, 'BRANDLARM – utrymning!']; }
  if (p.role) return roleNext(p, h);
  if (p.kind === 'res') return resNext(p, h);
  if (h >= 29.5) return [p.exitFloor, 'Natten är slut – äntligen hem'];
  if (p.kind === 'vis') return [p.exitFloor, 'Ärendet klart – går ut'];
  if (h >= p.leaveAt) return [p.exitFloor, p.overtime ? 'Övertiden är slut – hemgång' : 'Arbetsdagen är slut – hemgång'];
  // en stängd våning lämnar man om man inte jobbar där
  if (!floorOpen(p.floor, h) && p.floor !== p.home) return [p.home, `${FL[p.floor].name} stänger – tillbaka till jobbet`];
  if (!p.lunched && h >= p.lunchAt && h < 13.6 && p.floor !== CAFE && floorOpen(CAFE, h)) { p.lunched = true; return [CAFE, `Lunchsugen – till ${FL[CAFE].name}`]; }
  if (p.floor !== p.home) return [p.home, `Tillbaka till jobbet på ${FL[p.home].short}`];
  if (rng() < 0.14 && h < 16.5) {
    const g = pick(OFFICE_FLOORS.filter(f => f !== p.home && floorOpen(f, h)).concat([null]));
    if (g !== null && g !== undefined) return [g, `Möte på ${FL[g].short}`];
  }
  return null;
}
export function officeDone(p) {
  const r = decideNext(p);
  if (!r || r[0] === p.floor) { p.timer = rand(40, 110); return; }
  p.x = p.spot ? p.spot.x : p.x;
  releaseSpot(p);
  setTrip(p, r[0], r[1]);
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
  const floors = OFFICE_FLOORS.concat(CAFE);
  if (role === 'väktare') { p.route = [...floors].reverse().concat(LOBBY); p.ri = -1; }
  if (role === 'städare') p.route = shuffle([...floors]);
  if (role === 'vaktmästare') p.route = shuffle([...floors]).slice(0, 4);
  const first = roleNext(p, hour()) || [5, ''];
  setTrip(p, first[0], first[1]);
  S.people.push(p);
  pev(p, `Kliver in i entrén · ${ROLE_NAMES[role]} · ${p.why}`);
  log(`${pn(p)} (${ROLE_NAMES[role].toLowerCase()}) kommer till jobbet`, 'person', null, p.id);
  return p;
}
function roleNext(p, h) {
  switch (p.role) {
    case 'bud': return [p.exitFloor, 'Paketet levererat – tillbaka till lastbilen'];
    case 'väktare': {
      if (h >= 29.3) return [p.exitFloor, 'Passet är slut – går hem'];
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
      if (h >= 29) return [p.exitFloor, 'Nattsändningen är slut – godnatt!'];
      return p.floor === floorWith('radio') ? null : [floorWith('radio'), 'Till studion – nattsändning på Kanal 97'];
    case 'nattekniker':
      if (h >= 29.3) return [p.exitFloor, 'Passet är slut – går hem'];
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
    if (rng() < 0.7) withCargo(p, 'resväska');
    k++;
  }
  return k;
}
export function spawnPizza() { const p = spawnVisitor(LOBBY, -30, floorWith('radio'), 'Levererar pizza till nattsändningen'); if (p) withCargo(p, 'pizza'); return p; }
