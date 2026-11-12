// Händelser som spelaren bara informeras om: flyttdag och ambulans.
// Flyttdag: en boende flyttar. Varuhissen tas i OBEROENDE DRIFT (nyckelstyrd) – den svarar inte på
// några anrop, bara flyttgubbarna åker med den – tills flytten är klar. Smart styrning bokar flytten
// efter leveranstiden; de enkla lägena bokar den mitt i förmiddagen, så paketbuden får vänta.
// Ambulans: någon svimmar. Ambulanspersonalen kommer med bår, som bara får plats i varuhissen, och får
// hissen med prioritet. Smart styrning låter passagerarna som ändå ska åt det hållet åka klart; de enkla
// lägena släpper av alla vid nästa stopp. Hissen som körde upp dem står kvar, låst med deras nyckel, på
// patientens våning tills de kommer tillbaka med båren (medicHold).
import { pick, rand, rng } from './rng.js';
import { fl } from './util.js';
import { DOCK, FL, HOME_FLOORS, LOBBY, floorWith } from './config.js';
import { S, hour, log } from './state.js';
import { makePerson, pev, pn, releaseSpot, setTrip } from './people.js';
import { costBased, outReason, prio, posOf } from './dispatch.js';
import { canBrakeTo, deckFloor, unload, releaseCalls } from './elevators.js';

export const MOVE_ITEMS = ['flyttkartonger', 'en soffa', 'en bokhylla', 'ett kylskåp', 'en säng', 'ett akvarium', 'en tv-bänk', 'ett piano(!)'];
const freightCar = () => S.elevators.find(e => e.freight) || null;

// ---------- Dygnets start ----------
export function visitsReset() {
  S.move = null; S.medic = null;
  // flyttdag ungefär vartannat dygn – bokad efter leveranserna (kostnadsstyrningen) eller mitt i dem
  if (DOCK >= 0 && HOME_FLOORS.length && rng() < 0.45) {
    const smart = costBased();
    S.move = { floor: pick(HOME_FLOORS), at: smart ? rand(12.4, 13.2) : rand(9.2, 10), smart, loads: 2, done: 0, state: 'planned', t0: 0, t1: 0 };
  }
  // ambulans ungefär vartannat dygn
  S.medicAt = rng() < 0.5 ? rand(9, 17.5) : null;
}
export function visitsTick() {
  moveTick();
  medicTick();
}

// ---------- Flyttdag ----------
function moveTick() {
  const M = S.move;
  if (!M) return;
  const V = freightCar();
  if (M.state === 'planned') {
    if (hour() < M.at || S.fire) return;
    if (!V || V.mode !== 'normal' || V.hold) { M.at += 0.25; return; } // varuhissen är upptagen – flyttgubbarna väntar en stund
    M.state = 'on'; M.t0 = S.t;
    V.indep = true; V.parkTarget = null; V.sleep = false;
    releaseCalls(V, 'går i oberoende drift (flyttdag)');
    for (let i = 0; i < 2; i++) spawnMover(M, i);
    log(`🚚 Flyttdag: Flyttfirman Lyft & Bär kommer – ${V.name} går i oberoende drift till flytten från ${fl(M.floor)} är klar`, 'alert', V.color);
    return;
  }
  if (M.state === 'on' && !S.people.some(p => p.mover)) {
    M.state = 'done'; M.t1 = S.t;
    if (V) V.indep = false;
    log(`🚚 Flytten från ${fl(M.floor)} är klar (${M.done} lass) – ${V ? V.name : 'varuhissen'} går i vanlig trafik igen`, 'alert', V ? V.color : null);
  }
}
function spawnMover(M, i) {
  const p = makePerson('staff', DOCK, 120 + i * 24);
  p.role = 'flyttgubbe'; p.mover = true; p.exitFloor = DOCK;
  p.cargo = { kind: 'filtar', name: 'flyttfiltar', kg: 8 };
  p.look.shirt = '#ff8c42'; p.look.tie = false; p.look.acc = 0; // tröja i flyttfirmans orange
  setTrip(p, M.floor, `Lyft & Bär: flyttar ut från ${fl(M.floor)}`);
  S.people.push(p);
  pev(p, `Kliver ur flyttbilen vid lastkajen · ${p.why}`);
  log(`🚚 ${pn(p)} (flyttgubbe) åker upp till ${fl(M.floor)}`, 'person', null, p.id);
}
/** flyttgubbens nästa beslut (anropas från personernas rollogik) */
export function moverNext(p) {
  const M = S.move;
  if (!M || M.state !== 'on') return [p.exitFloor, 'Flytten är klar – åker hem'];
  const heavy = p.cargo && p.cargo.kg >= 22;
  if (p.floor === DOCK) {
    if (heavy) {
      M.done++; S.stats.moveLoads++;
      pev(p, `Lastar in ${p.cargo.name} i flyttbilen (${M.done}/${M.loads})`);
      p.cargo = { kind: 'filtar', name: 'flyttfiltar', kg: 8 };
    }
    if (M.done >= M.loads) return [p.exitFloor, 'Flytten är klar – åker hem'];
    p.task = 'Hämtar nästa lass';
    return [M.floor, 'Hämtar nästa lass'];
  }
  if (p.floor === M.floor) {
    const carrying = S.people.filter(q => q.mover && q !== p && q.cargo && q.cargo.kg >= 22).length;
    if (M.done + carrying >= M.loads) return [DOCK, 'Inget mer att bära – tillbaka till flyttbilen', false];
    const name = pick(MOVE_ITEMS);
    p.cargo = { kind: 'flyttlåda', name, kg: Math.round(rand(30, 85)) };
    p.task = `Bär ${name}`;
    return [DOCK, `Bär ner ${name} till flyttbilen`, false]; // (lastkajen är utgången – men det är ingen hemgång)
  }
  return [DOCK, 'Tillbaka till flyttbilen', false];
}

// ---------- Ambulans ----------
function medicTick() {
  if (S.medicAt !== null && S.medicAt !== undefined && !S.medic && hour() >= S.medicAt) {
    S.medicAt = null;
    if (!S.fire) startMedical();
  }
  const A = S.medic;
  if (!A) return;
  if (A.state === 'called' && S.t >= A.crewAt) {
    A.state = 'onway';
    for (let i = 0; i < 2; i++) spawnMedic(A, i);
    log(S.power ? '🚑 Ambulansen är framme vid entrén – personalen tar varuhissen med prioritet' : '🚑 Ambulansen är framme vid entrén – strömavbrott, personalen springer i trapporna', 'alert');
  }
  const crew = S.people.filter(p => p.medic);
  holdTick(A, crew);
  if ((A.state === 'onway' || A.state === 'transport') && !crew.length) {
    // personalen har lämnat huset (med patienten, eller utan om hen redan hade gått)
    A.state = 'done'; A.t1 = S.t;
    S.stats.medicSec += S.t - A.t0;
    log(`🚑 Ambulansen kör iväg${A.taken ? ` med ${A.pname}` : ''} – ${Math.round(S.t - A.t0)} s från larm till avfärd`, 'alert');
  }
}
/** uppe hos patienten: på våningen – inte i en hiss eller i trappan (den med akutväskan kan ta trappan ner) */
const upstairs = (A, p) => p.floor === A.floor && !['ride', 'boarding', 'stairs', 'instairs'].includes(p.state);
/**
 * Hissen som körde upp personalen väntar på dem: den står kvar på patientens våning (parkerar inte, somnar
 * inte) och är låst för ambulansen tills personalen har klivit på igen med båren. Går hissen ur drift
 * (brand, fel, avstängd) släpps den – då får personalen en annan hiss med förtur.
 */
function holdTick(A, crew) {
  if (A.car === null && !A.held && (A.state === 'onway' || A.state === 'transport')) {
    const p = crew.find(q => upstairs(A, q) && q.offAt === A.floor && q.offCar !== undefined);
    if (p) {
      const e = S.elevators[p.offCar];
      if (e && e.mode === 'normal' && !outReason(e)) {
        A.car = e.id; A.held = true; e.medicHold = true; e.parkTarget = null;
        log(`🚑 ${e.name} står kvar på ${fl(A.floor)} med ambulansens nyckel – väntar på personalen och båren`, 'alert', e.color);
      }
    }
  }
  if (A.car === null) return;
  const e = S.elevators[A.car];
  if (!e) { A.car = null; return; }
  // släpps när personalen har klivit på (eller gått därifrån), eller när hissen går ur drift
  const gone = !crew.some(p => upstairs(A, p)), out = !gone && !!outReason(e);
  if (!gone && !out) return;
  e.medicHold = false; A.car = null;
  if (out) log(`🚑 ${e.name} kan inte vänta längre på ambulansen – personalen får en annan hiss med förtur`, 'alert', e.color);
}
/** Någon svimmar (dygnets schema, eller spelarens test). Returnerar false om ingen passar. */
export function startMedical() {
  if (S.medic && S.medic.state !== 'done') return false;
  const ok = S.people.filter(p => p.state === 'office' && (p.kind === 'emp' || p.kind === 'vis') && !p.cast && !p.vip && !p.role && p.floor !== LOBBY && !p.collapsed);
  if (!ok.length) return false;
  const gym = ok.filter(p => p.floor === floorWith('aerobic'));
  const p = gym.length && rng() < 0.6 ? pick(gym) : pick(ok);
  p.collapsed = true; p.timer = 1e9; p.mood = 1;
  const where = FL[p.floor].short;
  pev(p, p.floor === floorWith('aerobic') ? 'Svimmar mitt i passet! Någon ringer 112' : 'Mår dåligt och svimmar – någon ringer 112');
  S.medic = { pid: p.id, pname: p.name, floor: p.floor, where, t0: S.t, crewAt: S.t + rand(6, 10), state: 'called', taken: false, t1: 0, car: /** @type {number|null} */ (null), held: false, spotX: p.spot ? p.spot.x : 300 };
  S.stats.medical++;
  log(`🚑 ${pn(p)} har svimmat på ${where} (${fl(p.floor)}) – ambulans larmad`, 'alert', null, p.id);
  return true;
}
function spawnMedic(A, i) {
  const p = makePerson('staff', LOBBY, -30 - i * 22);
  p.role = 'ambulans'; p.medic = true; p.nearX = A.spotX + (i ? 22 : -22);
  p.cargo = i ? { kind: 'väska', name: 'akutväska', kg: 10 } : { kind: 'bår', name: 'bår', kg: 30 };
  p.look.shirt = '#2ec4b6'; p.look.pants = '#2ec4b6'; p.look.tie = false; p.look.acc = 0;
  p.task = 'Tar hand om patienten';
  setTrip(p, A.floor, `Ambulans: akut till ${A.where}`);
  S.people.push(p);
  pev(p, `Springer in i entrén med ${p.cargo.name} · ${p.why}`);
  log(`🚑 ${pn(p)} (ambulanssjukvårdare) på väg till ${fl(A.floor)}`, 'person', null, p.id);
}
/** ambulanspersonalens nästa beslut (anropas från personernas rollogik) */
export function medicNext(p) {
  const A = S.medic;
  if (!A || p.floor !== A.floor) return [p.exitFloor, A && A.taken ? 'Till ambulansen' : 'Tillbaka till ambulansen'];
  const pat = S.people.find(q => q.id === A.pid && !q.dead && q.collapsed && q.floor === A.floor && q.state === 'office');
  if (pat && p.cargo && p.cargo.kind === 'bår' && !A.taken) {
    // patienten läggs på båren och bärs ut (och lämnar simuleringen med ambulansen)
    A.taken = true; A.state = 'transport';
    releaseSpot(pat);
    pat.dead = true; pat.collapsed = false;
    pev(pat, `Läggs på båren och bärs ut till ambulansen av ${p.name}`);
    p.cargo = { kind: 'bårP', name: `bår med ${pat.name}`, kg: 30 + pat.kg };
    log(`🚑 ${pat.name} bärs ut på bår från ${fl(A.floor)}`, 'alert', null, p.id);
    return [p.exitFloor, `Bär ${pat.name} till ambulansen`];
  }
  return [p.exitFloor, A.taken ? 'Följer med båren till ambulansen' : 'Patienten är inte här – tillbaka till ambulansen'];
}
/**
 * Ambulansen får hissen med prioritet: passagerarna ombord som inte ska åt samma håll kliver av vid nästa
 * stopp och tar en annan hiss. Kostnadsstyrningen låter de som ändå ska på vägen åka klart; de enkla
 * lägena släpper av alla.
 */
export function medicClear(e) {
  const crew = S.people.find(p => p.medic && p.state === 'wait' && p.assigned === e.id);
  const target = crew ? crew.floor : null;
  const smart = costBased();
  const out = e.passengers.filter(p => !prio(p) && !(smart && target !== null && onTheWay(e, posOf(e, p.dest), posOf(e, target))));
  if (!out.length) return;
  let at;
  if (e.state === 'doors') at = e.floor;
  else {
    // nästa våning hissen hinner bromsa till åt det håll den kör
    const d = e.dir || Math.sign((target ?? e.pos) - e.pos) || 1;
    at = null;
    for (let g = d > 0 ? Math.ceil(e.pos - 1e-6) : Math.floor(e.pos + 1e-6); g >= e.minF && g <= e.maxF; g += d) {
      if (e.stops.has(g) && canBrakeTo(e, g) && (g - e.pos) * d >= 0) { at = g; break; }
    }
    if (at === null) return; // (hissen är vid ändstationen – alla kliver av där ändå)
  }
  for (const p of out) {
    const pf = deckFloor(e, p, at);
    if (p.dest === pf) continue;
    pev(p, `Ambulansen behöver hiss ${e.name} – jag får kliva av på ${fl(pf)} och ta en annan hiss`);
    p.dest = pf;
  }
  e.carCalls = new Set(e.passengers.map(p => posOf(e, p.dest)));
  log(`🚑 ${e.name}: ${out.length} passagerare kliver av på ${fl(at)} – ambulansen har förtur`, 'alert', e.color);
  if (e.state === 'doors' && e.doorPhase === 'open') unload(e, at);
}
const onTheWay = (e, dest, target) => {
  const d = Math.sign(target - e.pos);
  return d !== 0 && (dest - e.pos) * d >= 0 && (target - dest) * d >= 0;
};
