// Händelser som spelaren bara informeras om: flyttdag och ambulans.
// Flyttdag: ett hushåll flyttar ut med sitt bohag. Varuhissen går i OBEROENDE DRIFT (nyckelstyrd) – den
// svarar inte på några anrop, bara flyttgubbarna åker med. Smart styrning bokar flytten efter leveranstiden
// och låser varuhissen bara för de stora möblerna; de enkla lägena bokar den mitt i förmiddagen och låser
// varuhissen hela flytten, så paketbuden får vänta.
// Ambulans: någon svimmar. Ambulanspersonalen kommer med bår, som bara får plats i varuhissen, och får
// hissen med prioritet. Smart styrning låter passagerarna som ändå ska åt det hållet åka klart; de enkla
// lägena släpper av alla vid nästa stopp. Hissen som körde upp dem står kvar, låst med deras nyckel, på
// patientens våning tills de kommer tillbaka med båren (medicHold).
import { pick, rand, rng, shuffle } from './rng.js';
import { fl } from './util.js';
import { BOHAG, BOHAG_BY_TYPE, CAR_H, DOCK, FL, HOME_FLOORS, LOBBY, floorWith, floorY, shaftCX } from './config.js';
import { S, hour, log } from './state.js';
import { makePerson, pev, pn, releaseSpot, setTrip } from './people.js';
import { allowedPos, costBased, outReason, prio, posOf } from './dispatch.js';
import { canBrakeTo, deckFloor, unload, releaseCalls } from './elevators.js';
import { hoistServes } from './hoist.js';

const freightCar = () => S.elevators.find(e => e.freight) || null;

// ---------- Dygnets start ----------
export function visitsReset() {
  S.move = null; S.medic = null;
  // flyttdag ungefär vartannat dygn – bokad efter leveranserna (kostnadsstyrningen) eller mitt i dem
  if (DOCK >= 0 && HOME_FLOORS.length && rng() < 0.45) {
    const smart = costBased();
    const at = smart ? rand(12.4, 13.2) : rand(9.2, 10);
    S.move = planMove(smart, at);
  }
  // ambulans ungefär vartannat dygn
  S.medicAt = rng() < 0.5 ? rand(9, 17.5) : null;
}
export function visitsTick(dt) {
  moveTick(dt);
  medicTick();
}

// ---------- Flyttdag ----------
// Ett hushåll i en av bostäderna flyttar ut. Bohaget (BOHAG i config) blir en lista med lass: kartongerna
// staplas på en kärra, möblerna bärs en i taget. Bärarna skruvar isär och bär ner till lastkajen, där
// lastaren lastar in i flyttbilen. De boende packar hemma och går när lägenheten är tom.
// Smart: varuhissen går i oberoende drift bara medan en stor möbel är på väg – kartongerna åker med som
// vanliga resenärer. De enkla lägena låser varuhissen hela flytten.
/** st: home → packing → carried (bärs) → dock → truck, eller för XL med hissbalken: home → packing → hatch (vid lastluckan)
 *  → hoist (hänger i balken) → terrace → lift (i panoramahissen) → truck
 * @typedef {{ id: number, key: string, name: string, size: 'S'|'M'|'L'|'XL', kg: number, sprite: string, long: boolean, pivoted?: boolean,
 *   st: 'home'|'packing'|'carried'|'dock'|'hatch'|'hoist'|'terrace'|'lift'|'truck' }} MoveItem */
/** Väljer hushållet som flyttar och packar bohaget (anropas när dygnet börjar, efter de boende) */
function planMove(smart, at) {
  // (stamgästerna – Majken och Lill-Olle – bor kvar)
  const homes = [];
  for (const f of HOME_FLOORS) for (const apt of [0, 1]) {
    const members = S.people.filter(p => p.kind === 'res' && p.home === f && p.apt === apt);
    if (members.length && !members.some(p => p.cast)) homes.push({ f, apt, members });
  }
  if (!homes.length) return null;
  const H = pick(homes);
  /** @type {MoveItem[]} */
  const items = [];
  const add = key => { const d = BOHAG[key]; items.push({ id: items.length, key, name: d.name, size: d.size, kg: Math.round(rand(d.kg[0], d.kg[1])), sprite: d.sprite, long: !!d.long, st: 'home' }); };
  const once = new Set();
  for (const m of H.members) for (const key of BOHAG_BY_TYPE[m.rtype] || []) {
    if (key !== 'sang' && once.has(key)) continue;
    once.add(key); add(key);
  }
  for (let i = 0; i < H.members.length + 1; i++) add('kartonger');
  add('lampor');
  // kartongerna först (de står packade i hallen), möblerna sist – och i en blandad ordning
  const order = shuffle(items.filter(it => it.size !== 'S'));
  const list = items.filter(it => it.size === 'S').concat(order).map((it, i) => ({ ...it, id: i }));
  const who = H.members.find(p => p.rtype !== 'child') || H.members[0];
  return { floor: H.f, apt: H.apt, family: H.members.map(p => p.id), who: who.name, at, smart, items: list,
    loads: list.length, done: 0, truck: 0, loadT: 0, pivots: 0, indepSec: 0, hoisted: 0, crew: list.length > 9 ? 3 : 2, hoist: hoistServes(H.f),
    state: 'planned', t0: 0, t1: 0 };
}
/** de som bor i lägenheten som töms */
const family = M => S.people.filter(p => M.family.includes(p.id) && !p.dead);
/** finns det kvar något i lägenheten (inte packat och nerburet än)? */
export const leftInFlat = M => M.items.some(it => it.st === 'home' || it.st === 'packing');
const heavyOnWay = (M, V) => S.people.some(p => p.mover && p.item !== undefined && p.item !== null && (M.items[p.item].size === 'L' || M.items[p.item].size === 'XL')
  && ((p.state === 'wait' && p.floor !== DOCK) || ((p.state === 'boarding' || p.state === 'ride') && p.car === V)));
function moveTick(dt) {
  const M = S.move;
  if (!M) return;
  const V = freightCar();
  if (M.state === 'planned') {
    if (hour() < M.at || S.fire) return;
    if (!V || V.mode !== 'normal' || V.hold) { M.at += 0.25; return; } // varuhissen är upptagen – flyttgubbarna väntar en stund
    M.state = 'on'; M.t0 = S.t;
    for (let i = 0; i < M.crew; i++) spawnMover(M, i, false);
    spawnMover(M, M.crew, true);
    // familjen kommer hem och packar (den som är ute vänder hem)
    for (const p of family(M)) { p.moving = true; if (p.state === 'away') p.returnAt = Math.min(p.returnAt, hour() + 0.3); }
    if (!M.smart) { V.indep = true; V.parkTarget = null; V.sleep = false; releaseCalls(V, 'går i oberoende drift (flyttdag)'); }
    log(`🚚 Flyttdag: ${M.who} flyttar från ${fl(M.floor)} – Flyttfirman Lyft & Bär kommer med ${M.crew + 1} man för ${M.loads} lass`
      + (M.smart ? ` (${V.name} går i oberoende drift bara när de stora möblerna åker)` : ` – ${V.name} går i oberoende drift tills flytten är klar`), 'alert', V.color);
    return;
  }
  if (M.state !== 'on') return;
  // flyttgubbar som försvann (utrymde vid brand): det de hade påbörjat ligger kvar i lägenheten, och när
  // branden är släckt kommer de tillbaka och fortsätter
  const crew = S.people.filter(p => p.mover);
  for (const it of M.items) if ((it.st === 'packing' || it.st === 'carried') && !crew.some(p => p.item === it.id)) it.st = 'home';
  if (!S.fire) {
    const carriers = crew.filter(p => !p.loader).length, need = leftInFlat(M) || M.items.some(it => it.st === 'carried');
    if (need && !carriers) {
      for (let i = 0; i < M.crew; i++) spawnMover(M, i, false);
      log(`🚚 Flyttgubbarna från Lyft & Bär är tillbaka och fortsätter flytten från ${fl(M.floor)}`, 'alert', V ? V.color : null);
    }
    if (!crew.some(p => p.loader) && M.items.some(it => it.st !== 'truck')) spawnMover(M, M.crew, true);
  }
  // Smart: oberoende drift bara medan en stor möbel är på väg ner (kartongerna åker som vanliga resenärer);
  // de enkla lägena låser den så länge bärarna jobbar (det som är kvar efter dem går med hissbalken)
  if (V) {
    const want = M.smart ? heavyOnWay(M, V) : S.people.some(p => p.mover && !p.loader);
    if (want !== V.indep) {
      V.indep = want;
      if (want) { V.parkTarget = null; V.sleep = false; releaseCalls(V, 'går i oberoende drift för en stor möbel'); }
    }
  }
  if (V && V.indep) M.indepSec += dt;
  // lastaren vid flyttbilen lastar in det som står på lastkajen
  const loader = S.people.find(p => p.mover && p.loader);
  const pile = M.items.find(it => it.st === 'dock');
  if (loader && loader.state === 'office' && loader.floor === DOCK && pile) {
    M.loadT += dt;
    if (M.loadT >= LOAD_T[pile.size]) {
      M.loadT = 0; pile.st = 'truck'; M.truck++;
      pev(loader, `Lastar in ${pile.name} i flyttbilen (${M.truck}/${M.loads})`);
    }
  }
  if (loader && M.truck >= M.loads && loader.state === 'office' && loader.timer > 1) { loader.timer = 0.2; }
  if (!S.people.some(p => p.mover)) {
    M.state = 'done'; M.t1 = S.t;
    if (V) V.indep = false;
    log(`🚚 Flytten från ${fl(M.floor)} är klar – ${M.loads} lass på ${Math.round(S.t - M.t0)} s${M.pivots ? ` (${M.pivots} gånger fick en möbel vändas i hissdörren)` : ''} · ${V ? V.name : 'varuhissen'} går i vanlig trafik igen`, 'alert', V ? V.color : null);
  }
}
/** sekunder för lastaren att lasta in ett lass i flyttbilen */
const LOAD_T = { S: 2, M: 3.5, L: 5.5, XL: 7 };
/** rumstimer i lägenheten: hur länge det tar att packa klart / skruva isär innan lasset kan bäras */
const PACK_T = { S: [2, 4], M: [4, 7], L: [8, 14], XL: [10, 16] };
function spawnMover(M, i, loader) {
  const p = makePerson('staff', DOCK, 120 + i * 24);
  p.role = 'flyttgubbe'; p.mover = true; p.exitFloor = DOCK; p.loader = loader; p.item = null;
  p.cargo = { kind: 'filtar', name: 'flyttfiltar', kg: 8 };
  p.look.shirt = '#ff8c42'; p.look.tie = false; p.look.acc = 0; // tröja i flyttfirmans orange
  p.task = loader ? 'Lastar flyttbilen vid lastkajen' : `Bär ut bohaget från ${fl(M.floor)}`;
  if (loader) {
    // lastaren stannar vid bilen (arbetet sköts av moveTick)
    p.goal = DOCK; p.dest = DOCK; p.state = 'office'; p.timer = 1e9; p.why = 'Lastar flyttbilen';
  } else setTrip(p, M.floor, `Lyft & Bär: flyttar ut från ${fl(M.floor)}`);
  S.people.push(p);
  pev(p, loader ? 'Öppnar flyttbilens bakdörrar vid lastkajen – tar emot det som bärs ner' : `Kliver ur flyttbilen vid lastkajen · ${p.why}`);
  log(`🚚 ${pn(p)} (flyttgubbe) ${loader ? 'lastar flyttbilen vid lastkajen' : `åker upp till ${fl(M.floor)}`}`, 'person', null, p.id);
}
/** rumstimern när en flyttgubbe kommer fram (people.js): i lägenheten reserveras nästa lass */
export function moverTimer(p) {
  const M = S.move;
  if (p.loader) return 1e9;
  if (!M || p.floor !== M.floor) return rand(1.5, 3); // (vid flyttbilen: ställer av lasset)
  const it = M.items.find(x => x.st === 'home');
  if (!it) return 0.5;
  it.st = 'packing'; p.item = it.id;
  if (it.size === 'L' || it.size === 'XL') pev(p, it.key === 'piano' ? 'Spänner fast pianot på kärran – försiktigt!' : `Skruvar isär ${it.name.replace(/^(en|ett) /, '')}`);
  return rand(PACK_T[it.size][0], PACK_T[it.size][1]);
}
/** flyttgubbens nästa beslut (anropas från personernas rollogik) */
export function moverNext(p) {
  const M = S.move;
  if (!M || M.state !== 'on') return [p.exitFloor, 'Flytten är klar – åker hem'];
  if (p.loader) return M.truck >= M.loads && !S.people.some(q => q.mover && !q.loader) ? [p.exitFloor, 'Flyttbilen är full – kör iväg'] : [DOCK, 'Lastar flyttbilen', false];
  if (p.floor === DOCK) {
    if (p.item !== null && p.item !== undefined) {
      const it = M.items[p.item];
      it.st = 'dock'; M.done++; S.stats.moveLoads++; p.item = null;
      pev(p, `Ställer av ${it.name} vid flyttbilen (${M.done}/${M.loads})`);
      p.cargo = { kind: 'filtar', name: 'flyttfiltar', kg: 8 };
    }
    if (!leftInFlat(M)) return [p.exitFloor, 'Allt är nerburet – åker hem'];
    p.task = 'Hämtar nästa lass';
    return [M.floor, 'Hämtar nästa lass'];
  }
  if (p.floor === M.floor && p.item !== null && p.item !== undefined) {
    const it = M.items[p.item];
    // XL (piano, kassaskåp): ställs vid lastluckan – hissbalken tar den – och bäraren tar nästa lass
    if (it.size === 'XL' && M.hoist) {
      it.st = 'hatch'; p.item = null;
      pev(p, `Ställer ${it.name} vid lastluckan – hissbalken tar den ner till terrassen`);
      return [M.floor, `Ställer ${it.name} vid lastluckan`, false];
    }
    it.st = 'carried';
    p.cargo = { kind: it.sprite, name: it.name, kg: it.kg };
    p.task = `Bär ${it.name}`;
    return [DOCK, `Bär ner ${it.name} till flyttbilen`, false]; // (lastkajen är utgången – men det är ingen hemgång)
  }
  return [DOCK, leftInFlat(M) ? 'Tillbaka till flyttbilen' : 'Inget mer att bära – tillbaka till flyttbilen', false];
}
/** en flyttgubbe kliver på varuhissen med en lång möbel: ibland måste den vändas för att komma in */
export function pivotCheck(e, p) {
  const M = S.move;
  if (!M || !p.mover || p.item === null || p.item === undefined || !e.freight) return;
  const it = M.items[p.item];
  if (!it.long || it.pivoted || rng() >= 0.45) return;
  it.pivoted = true; M.pivots++;
  e.dwellNeed = Math.max(e.dwellNeed, e.dwell + rand(4, 7)); // dörrarna står öppna medan den vänds
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 26, text: 'PIVOT!', color: '#ff8c42', life: 1.8, size: 14 });
  pev(p, `${it.name[0].toUpperCase()}${it.name.slice(1)} fastnar i dörren – PIVOT! PIVOT! (vänder och vrider)`);
  log(`🛋️ ${it.name[0].toUpperCase()}${it.name.slice(1)} fastnar i dörren till ${e.name} – flyttgubbarna vänder och vrider`, 'move', e.color, p.id);
}
/** de boende som flyttar: packar hemma och går när lägenheten är tom (anropas av resNext i life.js) */
export function movingResNext(p) {
  const M = S.move;
  if (!M || M.state === 'planned') return undefined; // vanlig dag tills flytten börjar
  if (M.state === 'on' && leftInFlat(M)) {
    if (p.floor !== p.home) return [p.home, 'Hem och packa – det är flyttdag!'];
    if (rng() < 0.3) pev(p, pick(['Packar kartonger', 'Försiktigt med pianot!', 'Var har vi lagt tejpen?', 'Ser på när soffan bärs ut']));
    return null;
  }
  // lägenheten är tom: en sista blick, sedan går de
  p.movedOut = true; p.sleeping = false;
  return [p.exitFloor, 'Flyttar! En sista blick på den tomma lägenheten – hejdå huset'];
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
      // (en våning i brandzonen får hissen inte stanna på – då åker passagerarna förbi den)
      if (e.stops.has(g) && allowedPos(e, g) && canBrakeTo(e, g) && (g - e.pos) * d >= 0) { at = g; break; }
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
