// Händelser som spelaren bara informeras om: flyttdag och ambulans.
// Flyttdag: ett hushåll flyttar ut med sitt bohag. Varuhissen går i OBEROENDE DRIFT (nyckelstyrd) – den
// svarar inte på några anrop, bara flyttgubbarna åker med. Smart styrning bokar flytten efter leveranstiden
// och låser varuhissen bara för de stora möblerna; de enkla lägena bokar den mitt i förmiddagen och låser
// varuhissen hela flytten, så paketbuden får vänta.
// Ambulans: någon svimmar. Ambulanspersonalen kommer med bår, som bara får plats i varuhissen, och får
// hissen med prioritet. Smart styrning låter passagerarna som ändå ska åt det hållet åka klart; de enkla
// lägena släpper av alla vid nästa stopp. Hissen som körde upp dem står kvar, låst med deras nyckel, på
// patientens våning tills de kommer tillbaka med båren (medicHold).
import { stream } from './rng.js';
const { pick, rand, rng, shuffle } = stream('händelser');
import { fl } from './util.js';
import { BOHAG, BOHAG_BY_TYPE, CAR_H, DOCK, DOOR_X, FL, HOME_FLOORS, LOBBY, floorWith, floorY, shaftCX } from './config.js';
import { S, dayEvent, hour, log } from './state.js';
import { makePerson, needsFreight, pev, pn, releaseSpot, setTrip } from './people.js';
import { allowedPos, costBased, outReason, OUT_TEXT, prio, posOf } from './dispatch.js';
import { canBrakeTo, deckFloor, unload, releaseCalls } from './elevators.js';
import { hoistHalt, hoistServes } from './hoist.js';
import { spawnCrew } from './crew.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

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
/** Mjukt dygnsskifte: en flytt eller ambulans som pågår får fortsätta, annars planeras dagens som vanligt */
export function visitsRoll() {
  const M = S.move && S.move.state === 'on' ? S.move : null, med = S.medic;
  visitsReset();
  if (M) S.move = M;
  S.medic = med;
}
export function visitsTick(dt) {
  moveTick(dt);
  medicTick();
}

// ---------- Flyttdag ----------
// Ett hushåll i en av bostäderna flyttar ut. Bohaget (BOHAG i config) blir en lista med lass: kartongerna
// staplas på en kärra, möblerna bärs en i taget. Bärarna skruvar isär och bär ner till lastkajen, där
// lastaren lastar in i flyttbilen. De boende packar hemma och går när lägenheten är tom.
// Vägen för varje möbel: varuhissen eller hissbalken (lastluckan → terrassen → panoramahissen, hoist.js).
// Spelaren väljer på flyttkortet (act: moveRoute/moveBlankets/moveWind): allt i varuhissen, tungt utanpå
// eller låt styrningen planera. Smart planerar per möbel efter kön vid varuhissen och vinden; de enkla
// lägena kör XL med balken och resten i varuhissen, som är låst så länge bärarna jobbar.
/** st: home → packing → carried (bärs) → dock → truck, eller med hissbalken: home → packing → hatch (vid lastluckan)
 *  → hoist (hänger i balken) → terrace → lift (i panoramahissen) → truck
 * @typedef {{ id: number, key: string, name: string, size: 'S'|'M'|'L'|'XL', kg: number, sprite: string, long: boolean, pivoted?: boolean,
 *   forceV?: boolean, via?: 'varu'|'balk', st: 'home'|'packing'|'carried'|'dock'|'hatch'|'hoist'|'terrace'|'lift'|'truck' }} MoveItem */
/** spelarens vägval: auto = låt styrningen planera */
export const MOVE_ROUTES = ['auto', 'varu', 'balk'];
/** sekunder det tar att klä varuhissen med skyddsfiltar innan bärarna börjar */
export const BLANKET_T = 10;
/**
 * Flyttdagen (S.move): hushållet, bohaget (items), lassen, bärarna, spelarens val och vad som hände.
 * @typedef {{ floor: number, apt: number, family: number[], who: string, at: number, smart: boolean, items: MoveItem[],
 *   loads: number, done: number, truck: number, loadT: number, crew: number, hoist: boolean,
 *   route: string, blankets: boolean, windChoice: string|null, crewAt: number, crewOut: boolean,
 *   pivots: number, stuck: number, broken: number, scratches: number, indepSec: number, hoisted: number, viaV: number,
 *   dockWait: number, budWait: number, notes: Record<string, boolean>, state: string, t0: number, t1: number }} Move
 */
/** Väljer hushållet som flyttar och packar bohaget (anropas när dygnet börjar, efter de boende)
 * @param {boolean} smart @param {number} at @returns {Move|null} */
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
    loads: list.length, done: 0, truck: 0, loadT: 0, crew: list.length > 9 ? 3 : 2, hoist: hoistServes(H.f),
    // spelarens val
    route: 'auto', blankets: true, windChoice: null, crewAt: 0, crewOut: false,
    // vad som hände (resultatet)
    pivots: 0, stuck: 0, broken: 0, scratches: 0, indepSec: 0, hoisted: 0, viaV: 0, dockWait: 0, budWait: 0,
    notes: {},
    state: 'planned', t0: 0, t1: 0 };
}
/** Bara för mätningar (ligan): ett dygn med flyttdag även när slumpen inte gav någon */
export function forceMove() {
  if (S.move || DOCK < 0 || !HOME_FLOORS.length) return;
  const smart = costBased();
  S.move = planMove(smart, smart ? 12.6 : 9.5);
}
/** Spelaren: flyttbilen kommer nu (ett bokat flyttlass flyttas fram, annars bokar ett hushåll en flytt) */
export function moveNow() {
  if (DOCK < 0 || !HOME_FLOORS.length) return false;
  const M = S.move;
  if (M && M.state === 'planned') { M.at = Math.min(M.at, hour()); return true; }
  if (M) return false; // (en flytt per dygn)
  S.move = planMove(costBased(), hour());
  if (S.move) log(`🚚 Flyttbilen svänger in mot lastkajen – ${S.move.who} flyttar i dag`, 'alert');
  return !!S.move;
}
/** de som bor i lägenheten som töms */
const family = M => S.people.filter(p => M.family.includes(p.id) && !p.dead);
/** finns det kvar något i lägenheten (inte packat och nerburet än)? */
export const leftInFlat = M => M.items.some(it => it.st === 'home' || it.st === 'packing');
const big = it => it.size === 'L' || it.size === 'XL';
const heavyOnWay = (M, V) => S.people.some(p => p.mover && p.item !== undefined && p.item !== null && big(M.items[p.item])
  && ((p.state === 'wait' && p.floor !== DOCK) || ((p.state === 'boarding' || p.state === 'ride') && p.car === V)));
/** hur många med tung last (bud, städare) som väntar på varuhissen just nu */
const freightQueue = () => S.people.filter(p => p.state === 'wait' && !p.mover && !p.medic && needsFreight(p)).length;
/** varuhissen går inte (trasig, linbyte, service, avstängd …) */
const vDown = V => !V || V.mode !== 'normal' || !!outReason(V) && !V.indep && !V.liftWant;
/** Ska möbeln ut med hissbalken? Spelarens val först, sedan styrningens plan. */
export function viaHoist(M, it) {
  if (!M.hoist || it.forceV) return false;
  // varuhissen går inte: allt som går tar balken (om det inte blåser för mycket)
  if (vDown(freightCar())) return true;
  if (M.route === 'varu') return false;
  if (M.route === 'balk') return big(it);
  if (it.size === 'XL') return true;
  // Smart: en stor möbel går utanpå när det är kö till varuhissen (eller förmiddagens leveranser) och vinden tillåter
  return M.smart && it.size === 'L' && hoistHalt() !== 'blåst' && (freightQueue() >= 2 || hour() < 11.5);
}
/** spelarens val på flyttkortet (via act – spelas in) */
export function setMoveRoute(r) {
  const M = S.move;
  if (!M || M.state === 'done' || !MOVE_ROUTES.includes(r) || M.route === r) return;
  M.route = r;
  log(`🚚 Flytten: ${{ auto: 'styrningen planerar vägen för varje möbel', varu: 'allt går i varuhissen', balk: 'de stora möblerna går utanpå med hissbalken' }[r]}`, 'alert');
}
export function setMoveBlankets(on) {
  const M = S.move;
  if (!M || M.state !== 'planned' || M.blankets === !!on) return;
  M.blankets = !!on;
  log(on ? '🚚 Flytten: varuhissen kläs med skyddsfiltar (tar en stund i början)' : '🚚 Flytten: inga skyddsfiltar – det går fortare, men väggarna kan få sig en smäll', 'alert');
}
export function setMoveWind(c) {
  const M = S.move;
  if (!M || M.state !== 'on' || (c !== 'wait' && c !== 'varu')) return;
  M.windChoice = c;
  log(c === 'varu' ? '🚚 Flytten: det som står vid lastluckan bärs ner i varuhissen i stället' : '🚚 Flytten: möblerna vid lastluckan väntar tills det mojnar', 'alert');
}
function moveTick(dt) {
  const M = S.move;
  if (!M) return;
  const V = freightCar();
  if (M.state === 'planned') {
    if (hour() < M.at || S.fire) return;
    if (!V || V.mode !== 'normal' || V.hold) { M.at += 0.25; return; } // varuhissen är upptagen – flyttgubbarna väntar en stund
    // lastkajen har plats för en bil: står leveransbilen där får flyttbilen vänta på gatan
    if (S.truck && S.truck.state !== 'out') {
      M.dockWait += dt;
      if (!M.notes.dock) { M.notes.dock = true; log('🚚 Flyttbilen får vänta på gatan – leveransbilen står vid lastkajen', 'alert'); }
      return;
    }
    M.state = 'on'; M.t0 = S.t;
    M.crewAt = S.t + (M.blankets ? BLANKET_T : 0);
    spawnMover(M, M.crew, true);
    // med hissbalken kommer lastaren som tar emot möblerna på takterrassen (personalen, crew.js)
    if (M.hoist) spawnCrew('mona', false, DOCK);
    // familjen kommer hem och packar (den som är ute vänder hem)
    for (const p of family(M)) { p.moving = true; if (p.state === 'away') p.returnAt = Math.min(p.returnAt, hour() + 0.3); }
    if (!M.smart || M.blankets) { V.indep = true; V.parkTarget = null; V.sleep = false; releaseCalls(V, M.blankets ? 'kläs med skyddsfiltar (flyttdag)' : 'går i oberoende drift (flyttdag)'); }
    log(`🚚 Flyttdag: ${M.who} flyttar från ${fl(M.floor)} – Flyttfirman Lyft & Bär kommer med ${M.crew + 1} man för ${M.loads} lass`
      + (M.blankets ? ` · först kläs ${V.name} med skyddsfiltar` : ''), 'alert', V.color);
    return;
  }
  if (M.state !== 'on') return;
  // skyddsfiltarna hänger uppe: bärarna börjar
  if (!M.crewOut && S.t >= M.crewAt) {
    M.crewOut = true;
    for (let i = 0; i < M.crew; i++) spawnMover(M, i, false);
  }
  // flyttgubbar som försvann (utrymde vid brand): det de hade påbörjat ligger kvar i lägenheten, och när
  // branden är släckt kommer de tillbaka och fortsätter
  const crew = S.people.filter(p => p.mover);
  for (const it of M.items) if ((it.st === 'packing' || it.st === 'carried') && !crew.some(p => p.item === it.id)) it.st = 'home';
  if (!S.fire && M.crewOut) {
    const carriers = crew.filter(p => !p.loader).length, need = leftInFlat(M) || M.items.some(it => it.st === 'carried');
    if (need && !carriers) {
      for (let i = 0; i < M.crew; i++) spawnMover(M, i, false);
      log(`🚚 Flyttgubbarna från Lyft & Bär är tillbaka och fortsätter flytten från ${fl(M.floor)}`, 'alert', V ? V.color : null);
    }
    if (!crew.some(p => p.loader) && M.items.some(it => it.st !== 'truck')) spawnMover(M, M.crew, true);
  }
  // blåsten stoppar hissbalken: det som står vid lastluckan väntar – eller bärs ner i varuhissen
  // (Smart väljer varuhissen, de enkla lägena väntar; spelaren kan välja själv)
  const atHatch = M.items.filter(it => it.st === 'hatch');
  if (hoistHalt() === 'blåst' && atHatch.length) {
    if (!M.notes.wind) { M.notes.wind = true; log(`🌬️ Blåsten stoppar hissbalken – ${atHatch.map(it => it.name).join(' och ')} står vid lastluckan`, 'alert'); }
    if ((M.windChoice ?? (M.smart ? 'varu' : 'wait')) === 'varu' && !vDown(V)) {
      for (const it of atHatch) { it.st = 'home'; it.forceV = true; }
      log('🚚 Det som stod vid lastluckan bärs ner i varuhissen i stället', 'move');
    }
  }
  // varuhissen gick sönder mitt i flytten: det som går tar hissbalken
  if (vDown(V) && M.hoist && !M.notes.vdown && V && V.mode !== 'normal') { M.notes.vdown = true; log(`🚚 ${V.name} ${OUT_TEXT[V.mode] || 'går inte'} – flyttgubbarna tar allt med hissbalken`, 'alert', V.color); }
  // varuhissen: filtarna hängs upp i början; sedan låser Smart den bara för de stora möblerna,
  // de enkla lägena så länge bärarna jobbar (det som är kvar efter dem går med hissbalken)
  if (V && !V.ffCar) { // (under branden är varuhissen brandkårens)
    const want = !M.crewOut ? M.blankets : M.smart ? heavyOnWay(M, V) : S.people.some(p => p.mover && !p.loader);
    if (want !== V.indep) {
      V.indep = want;
      if (want) { V.parkTarget = null; V.sleep = false; releaseCalls(V, 'går i oberoende drift för en stor möbel'); }
    }
  }
  if (V && V.indep) M.indepSec += dt;
  // budens väntan vid varuhissen under flytten (resultatet)
  for (const p of S.people) if (p.role === 'bud' && p.state === 'wait') M.budWait = Math.max(M.budWait, S.t - p.waitStart);
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
  if (!S.people.some(p => p.mover) && M.crewOut) {
    M.state = 'done'; M.t1 = S.t;
    if (V) V.indep = false;
    S.stats.moves++;
    dayEvent('move', `🚚 Flytten från ${fl(M.floor)} är klar`, `${M.who} flyttade: ${M.loads} lass på ${Math.round(S.t - M.t0)} s${M.broken ? `, ${M.broken} tappade` : ''}${!M.blankets && M.scratches ? `, ${M.scratches} repor utan filtar` : ''}${M.pivots ? `, ${M.pivots} ${M.pivots === 1 ? 'möbel' : 'möbler'} fick vändas i dörren` : ''}.`);
    log(`🚚 Flytten från ${fl(M.floor)} är klar – ${M.loads} lass på ${Math.round(S.t - M.t0)} s${M.pivots ? ` (${M.pivots} gånger fick en möbel vändas i hissdörren)` : ''} · ${V ? V.name : 'varuhissen'} går i vanlig trafik igen`, 'alert', V ? V.color : null);
  }
}
/** sekunder för lastaren att lasta in ett lass i flyttbilen */
const LOAD_T = { S: 2, M: 3.5, L: 5.5, XL: 7 };
/** rumstimer i lägenheten: hur länge det tar att packa klart / skruva isär innan lasset kan bäras */
const PACK_T = { S: [2, 4], M: [4, 7], L: [8, 14], XL: [10, 16] };
const FILTAR = () => ({ kind: 'filtar', name: 'flyttfiltar', kg: 8 });
function spawnMover(M, i, loader) {
  const p = makePerson('staff', DOCK, 120 + i * 24);
  p.role = 'flyttgubbe'; p.mover = true; p.exitFloor = DOCK; p.loader = loader; p.item = null;
  p.cargo = FILTAR();
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
/** rumstimern när en flyttgubbe kommer fram (people.js): i lägenheten reserveras nästa lass @param {Person} p */
export function moverTimer(p) {
  const M = S.move;
  if (p.loader) return 1e9;
  if (!M || p.floor !== M.floor) return rand(1.5, 3); // (vid flyttbilen: ställer av lasset)
  const it = M.items.find(x => x.st === 'home');
  if (!it) return 0.5;
  it.st = 'packing'; p.item = it.id;
  if (big(it)) pev(p, it.key === 'piano' ? 'Spänner fast pianot på kärran – försiktigt!' : `Skruvar isär ${it.name.replace(/^(en|ett) /, '')}`);
  let t = rand(PACK_T[it.size][0], PACK_T[it.size][1]);
  // Smart: kartongerna får vänta en stund när buden står i kö vid varuhissen
  if (M.smart && M.route === 'auto' && it.size === 'S' && freightQueue() >= 2) {
    t += 6;
    pev(p, 'Packar en kartong till – buden står i kö vid varuhissen');
  }
  return t;
}
/** flyttgubbens nästa beslut (anropas från personernas rollogik) @param {Person} p */
export function moverNext(p) {
  const M = S.move;
  if (!M || M.state !== 'on') return [p.exitFloor, 'Flytten är klar – åker hem'];
  if (p.loader) return M.truck >= M.loads && !S.people.some(q => q.mover && !q.loader) ? [p.exitFloor, 'Flyttbilen är full – kör iväg'] : [DOCK, 'Lastar flyttbilen', false];
  if (p.floor === DOCK) {
    if (p.item !== null && p.item !== undefined) {
      const it = M.items[p.item];
      it.st = 'dock'; M.done++; M.viaV++; S.stats.moveLoads++; p.item = null;
      pev(p, `Ställer av ${it.name} vid flyttbilen (${M.done}/${M.loads})`);
      p.cargo = FILTAR();
      // ibland tappas något (det mesta klarar sig)
      if ((it.size === 'S' || it.size === 'M') && rng() < 0.06) {
        M.broken++; S.stats.moveBroken++;
        S.fx.push({ x: DOOR_X + 40, y: floorY(DOCK) - 40, text: 'KRASCH!', color: '#ff5d52', life: 1.6, size: 14 });
        log(`💥 KRASCH! ${it.size === 'S' ? 'En flyttkartong' : cap(it.name)} tappas vid flyttbilen – det klirrar`, 'alert', null, p.id);
        for (const q of family(M)) pev(q, it.size === 'S' ? 'Hörde du? Det var nog porslinet …' : `Nej! ${cap(it.name)}!`);
      }
    }
    if (!leftInFlat(M)) return [p.exitFloor, 'Allt är nerburet – åker hem'];
    p.task = 'Hämtar nästa lass';
    return [M.floor, 'Hämtar nästa lass'];
  }
  if (p.floor === M.floor && p.item !== null && p.item !== undefined) {
    const it = M.items[p.item];
    // med hissbalken: ställs vid lastluckan – balken tar den – och bäraren tar nästa lass
    if (viaHoist(M, it)) {
      it.st = 'hatch'; it.via = 'balk'; p.item = null;
      pev(p, `Ställer ${it.name} vid lastluckan – hissbalken tar den ner till terrassen`);
      return [M.floor, `Ställer ${it.name} vid lastluckan`, false];
    }
    it.st = 'carried'; it.via = 'varu';
    p.cargo = { kind: it.sprite, name: it.name, kg: it.kg };
    p.task = `Bär ${it.name}`;
    return [DOCK, `Bär ner ${it.name} till flyttbilen`, false]; // (lastkajen är utgången – men det är ingen hemgång)
  }
  return [DOCK, leftInFlat(M) ? 'Tillbaka till flyttbilen' : 'Inget mer att bära – tillbaka till flyttbilen', false];
}
const cap = s => s[0].toUpperCase() + s.slice(1);
/**
 * En flyttgubbe kliver på varuhissen med en möbel (anropas från boardDone). Långa möbler kan behöva vändas
 * ("PIVOT!") och ibland fastnar de helt: då bärs möbeln tillbaka till lastluckan och tar hissbalken – eller
 * (utan balk, eller när spelaren valt allt i varuhissen) trycks den in med våld. Utan skyddsfiltar kan
 * stora möbler skrapa i väggarna. Returnerar true om flyttgubben fick kliva av igen.
 * @param {Person} p
 * @param {Elevator} e
 */
export function moveBoard(e, p) {
  const M = S.move;
  if (!M || !p.mover || p.item === null || p.item === undefined || !e.freight) return false;
  const it = M.items[p.item];
  if (big(it) && !M.blankets && rng() < 0.35) {
    M.scratches++; e.wear += 0.03;
    S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 10, text: 'SKRRT!', color: '#ffd23f', life: 1.2 });
    log(`🪵 ${cap(it.name)} skrapar i väggen i ${e.name} – inga skyddsfiltar`, 'move', e.color, p.id);
  }
  if (!it.long || it.pivoted || rng() >= 0.45) return false;
  it.pivoted = true; M.pivots++;
  const name = cap(it.name);
  // fastnar helt (bara på väg ner från lägenheten)
  if (p.floor === M.floor && rng() < 0.3) {
    M.stuck++;
    if (M.hoist && M.route !== 'varu' && !it.forceV) {
      e.passengers = e.passengers.filter(q => q !== p);
      if (!e.passengers.some(q => posOf(e, q.dest) === posOf(e, p.dest))) e.carCalls.delete(posOf(e, p.dest));
      p.car = null; p.state = 'office'; p.goal = M.floor; p.dest = M.floor; p.item = null; p.cargo = FILTAR();
      it.st = 'hatch'; it.via = 'balk';
      p.timer = moverTimer(p);
      S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 26, text: 'FAST!', color: '#ff5d52', life: 1.8, size: 14 });
      pev(p, `${name} går inte in i hissen hur vi än vrider – vi bär den till lastluckan, hissbalken får ta den`);
      log(`🛋️ ${name} fastnar helt i dörren till ${e.name} – bärs tillbaka och tar hissbalken i stället`, 'alert', e.color, p.id);
      return true;
    }
    e.dwellNeed = Math.max(e.dwellNeed, e.dwell + rand(10, 14));
    if (!M.blankets) { M.scratches++; e.wear += 0.04; }
    S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 26, text: 'TRYCK!', color: '#ff5d52', life: 2, size: 14 });
    log(`🛋️ ${name} fastnar helt i dörren till ${e.name} – flyttgubbarna trycker in den med våld`, 'alert', e.color, p.id);
    return false;
  }
  e.dwellNeed = Math.max(e.dwellNeed, e.dwell + rand(4, 7)); // dörrarna står öppna medan den vänds
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 26, text: 'PIVOT!', color: '#ff8c42', life: 1.8, size: 14 });
  pev(p, `${name} fastnar i dörren – PIVOT! PIVOT! (vänder och vrider)`);
  log(`🛋️ ${name} fastnar i dörren till ${e.name} – flyttgubbarna vänder och vrider`, 'move', e.color, p.id);
  return false;
}
/** de boende som flyttar: packar hemma och går när lägenheten är tom (anropas av resNext i life.js) @param {Person} p */
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
  if (S.medicAt !== null && !S.medic && hour() >= S.medicAt) {
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
    // (patienten som inte kom med – utrymd vid brand när ambulansen kom – har kvicknat till och ligger inte kvar)
    const pat = A.taken ? null : S.people.find(p => p.id === A.pid && !p.dead && p.collapsed);
    if (pat) { pat.collapsed = false; if (pat.state === 'office') pat.timer = Math.min(pat.timer, 2); pev(pat, 'Kvicknar till – ambulansen har redan åkt'); }
    S.stats.medicSec += S.t - A.t0;
    dayEvent('medical', '🚑 Ambulansen har kört', `${A.taken ? `${A.pname} fördes till sjukhuset` : 'Ambulansen åkte tom'} – ${Math.round(S.t - A.t0)} s från larm till avfärd.`);
    log(`🚑 Ambulansen kör iväg${A.taken ? ` med ${A.pname}` : ''} – ${Math.round(S.t - A.t0)} s från larm till avfärd`, 'alert');
  }
}
/** uppe hos patienten: på våningen – inte i en hiss eller i trappan (den med akutväskan kan ta trappan ner) @param {Person} p */
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
        holdClear(e);
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
/**
 * Ambulansen (S.medic): patienten, var, ambulanspersonalen (state: called → …) och hissen de låser.
 * @typedef {{ pid: number, pname: string, floor: number, where: string, t0: number, crewAt: number, state: string,
 *   taken: boolean, t1: number, car: number|null, held: boolean, spotX: number }} Medic
 */
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
  S.medic = { pid: p.id, pname: p.name, floor: p.floor, where, t0: S.t, crewAt: S.t + rand(6, 10), state: 'called', taken: false, t1: 0, car: null, held: false, spotX: p.spot ? p.spot.x : 300 };
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
/** ambulanspersonalens nästa beslut (anropas från personernas rollogik) @param {Person} p */
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
/** Hissen ställs på patientens våning: den som fortfarande åker med (på väg längre) kliver av här –
 *  en hiss som väntar på ambulansen kör ingenstans @param {Elevator} e */
function holdClear(e) {
  const f = Math.round(e.pos), out = e.passengers.filter(p => !prio(p));
  if (!out.length) return;
  for (const p of out) {
    const pf = deckFloor(e, p, f);
    if (p.dest === pf) continue;
    pev(p, `Ambulansen behöver hiss ${e.name} – jag kliver av här på ${fl(pf)} och tar en annan hiss`);
    p.dest = pf;
  }
  e.carCalls = new Set(e.passengers.map(p => posOf(e, p.dest)));
  log(`🚑 ${e.name}: ${out.length} passagerare kliver av på ${fl(f)} – hissen väntar på ambulansen`, 'alert', e.color);
  if (e.state === 'doors' && e.doorPhase === 'open') unload(e, f);
}
/** @param {Elevator} e */
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
/** @param {Elevator} e */
const onTheWay = (e, dest, target) => {
  const d = Math.sign(target - e.pos);
  return d !== 0 && (dest - e.pos) * d >= 0 && (target - dest) * d >= 0;
};
