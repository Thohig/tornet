// Svindeln: berg- och dalbanan på takterrassen. Åkarna kommer upp med hissarna (oftast panoramahissen),
// ställer sig i kön vid Banhissen – en liten korg för tre som tar dem upp till plattformen – och kliver på
// tåget (8 platser). Tåget dras upp för kedjebacken, störtdyker, gör en loop och kommer tillbaka; åkarna tar
// Banhissen ner igen och går ut ur huset (en del mår illa – mess.js). Banan stänger i blåst, vid strömavbrott,
// vid brandlarm och på kvällen.
// Incidenten: tåget fastnar i kedjebacken. Antingen väntar man på banmästaren (en givare som löst ut går fort att
// återställa) eller så går åkarna ner för servicetrappan längs backen en i taget (kedjan har hoppat av, det tar
// länge). Driftchefen väljer (chief.js), spelaren via act('coasterRescue', 'wait'|'walk'), annars banmästaren själv.
// (Simulering: läget ligger i S.coaster – grafiken i pixel.js läser bara. trackAt() är ren geometri.)
import { stream } from './rng.js';
const BANAN = stream('banan'), QUEASY = stream('illamående');
import { ROOF, floorY } from './config.js';
import { S, hour, incidentOver, log } from './state.js';
import { pev, pn, setTrip, walk } from './people.js';
import { inFireZone } from './dispatch.js';
import { incidentStarted } from './incidents.js';
import { windAt } from './weather.js';
import { WIND_STOP } from './hoist.js';

// ---------- Geometri (världens koordinater på takdäcket) ----------
/** takdäckets golv (där kön står) */
export const DECK_Y = ROOF >= 0 ? floorY(ROOF) - 4 : 0;
/** plattformen där tåget stannar, och Banhissen som går upp dit genom plattformen */
export const PLAT_Y = DECK_Y - 128, LIFT_X = 322, PLAT_X0 = 276, PLAT_X1 = 368;
/** kön på däcket börjar till höger om Banhissen */
export const QUEUE_X = LIFT_X + 16, QUEUE_DX = 11;
export const LIFT_CAP = 3, TRAIN_CAP = 8;
const LIFT_T = 3.2, LIFT_DOOR = 0.8, LOAD_MAX = 10, CLIMB_T = 7, RIDE_T = 12, UNLOAD_T = 1.6, BOARD_DT = 0.35;
/** gånghastigheten nerför servicetrappan (s per åkare) och så länge banmästaren väntar på ett beslut (s) */
export const WALK_T = 4.5, COASTER_DEFAULT_S = 16;
/** öppettider: kön tar emot nya mellan de här klockslagen */
export const OPEN_H = 10, CLOSE_H = 19.5;

// Banan som en polylinje: plattformen, kedjebacken, toppen, fallet, loopen, kamelpuckeln och tillbaka in från
// vänster (utanför bilden). Parametern u (0–1) går längs banan efter sträckan.
// (helikopterplattan ligger längre till höger – banan håller sig till vänster om x 445)
const LOOP_C = { x: 352, y: PLAT_Y - 34 }, LOOP_R = 28, LOOP_I = 9, LOOP_N = 20;
const PTS = (() => {
  const P = [[290, PLAT_Y], [368, PLAT_Y], [384, PLAT_Y - 8], [416, PLAT_Y - 92], [426, PLAT_Y - 98], [436, PLAT_Y - 92],
    [434, PLAT_Y - 50], [420, PLAT_Y - 4], [398, PLAT_Y + 8]];
  // loopen: in längst ner åt vänster, upp på vänster sida, över toppen, ner på höger sida och ut åt vänster
  for (let k = 0; k <= LOOP_N; k++) { const t = (k / LOOP_N) * Math.PI * 2; P.push([LOOP_C.x - LOOP_R * Math.sin(t) - k * 0.5, LOOP_C.y + 8 + LOOP_R * Math.cos(t)]); }
  P.push([306, PLAT_Y - 4], [284, PLAT_Y - 44], [266, PLAT_Y - 42], [246, PLAT_Y - 6], [214, PLAT_Y + 6], [150, PLAT_Y], [200, PLAT_Y], [290, PLAT_Y]);
  return P;
})();
/** punkter där banan står på pelare ner till däcket (allt utom loopen) */
export const SUPPORTS = PTS.filter((_, i) => i < LOOP_I || i > LOOP_I + LOOP_N);
const SEG = PTS.slice(1).map((q, i) => Math.hypot(q[0] - PTS[i][0], q[1] - PTS[i][1]));
const TOTAL = SEG.reduce((a, b) => a + b, 0);
/** var på banan (u = 0–1) tåget är: { x, y, a } där a = lutningen i radianer */
export function trackAt(u) {
  let d = (((u % 1) + 1) % 1) * TOTAL;
  for (let i = 0; i < SEG.length; i++) {
    if (d <= SEG[i] || i === SEG.length - 1) {
      const k = SEG[i] ? Math.min(1, d / SEG[i]) : 0, a = PTS[i], b = PTS[i + 1];
      return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    d -= SEG[i];
  }
  return { x: PTS[0][0], y: PTS[0][1], a: 0 };
}
/** banans punkter (för grafiken) och längd */
export const TRACK = PTS, TRACK_LEN = TOTAL;
/** punkten dist världsenheter bakom u längs banan */
export const trackBack = (u, dist) => trackAt(u - dist / TOTAL);
/** var plats i (0–7) sitter i tåget, räknat bakåt från fronten: två vagnar med två rader à två */
export const seatBack = i => { const row = i >> 1; return row * 11 + (row >= 2 ? 6 : 0) + 6; };
/** u vid toppen av kedjebacken */
export const U_PEAK = SEG.slice(0, 4).reduce((a, b) => a + b, 0) / TOTAL;
/** u där plattformen slutar (tåget står med fronten här när det lastar) */
export const U_LOAD = SEG[0] / TOTAL;

// ---------- Tillståndet ----------
export function coasterReset() {
  S.coaster = ROOF < 0 ? null : {
    why: '', // varför banan är stängd ('' = öppen)
    queue: /** @type {number[]} */ ([]), plat: /** @type {number[]} */ ([]), exitq: /** @type {number[]} */ ([]),
    lift: { pos: 0, ph: 'idle', t: 0, riders: /** @type {number[]} */ ([]), dir: 0 },
    train: { ph: 'load', t: 0, u: U_LOAD, riders: /** @type {number[]} */ ([]), firstAt: /** @type {number|null} */ (null), nextBoard: 0, stuckNext: false, prog: 0 },
    stuck: /** @type {any} */ (null),
    walker: /** @type {{ id: number, t0: number, x0: number, y0: number }|null} */ (null),
  };
}
const byId = id => S.people.find(p => p.id === id) || null;
/** öppet för nya åkare efter klockan (bara klockan – ankomsterna i sim.js får inte bero på något annat) */
export const coasterHours = h => ROOF >= 0 && h >= OPEN_H && h < CLOSE_H - 0.8;
/** varför banan är stängd just nu ('' = öppen) */
function closedWhy() {
  const h = hour();
  if (S.fire && inFireZone(ROOF)) return 'Stängt – brandlarm';
  if (!S.power) return 'Stängt – strömavbrott';
  if (windAt() > WIND_STOP * 0.85) return 'Stängt – för blåsigt';
  if (S.coaster.stuck) return 'Stängt – tåget sitter fast';
  if (h < OPEN_H) return 'Öppnar kl 10';
  if (h >= CLOSE_H) return 'Stängt för kvällen';
  return '';
}

// ---------- Åkarna ----------
/** framme på taket för att åka: ställ dig i kön (false = stängt, hen gör något annat på taket) */
export function joinCoaster(p) {
  const C = S.coaster;
  p.coaster = false;
  if (!C || p.floor !== ROOF) return false;
  if (C.why) { pev(p, `Svindeln: ${C.why.toLowerCase()} – tittar på utsikten i stället`); return false; }
  p.state = 'coaster'; p.cst = 'queue'; p.spot = null; p.face = -1;
  C.queue.push(p.id);
  p.tx = QUEUE_X + (C.queue.length - 1) * QUEUE_DX;
  pev(p, `Ställer mig i kön till Svindeln (${C.queue.length} i kön)`);
  return true;
}
/** åkaren lämnar banan och går ut ur huset (eller tillbaka in i huset) från däcket vid x */
function leave(p, why, x = LIFT_X + 8) {
  const C = S.coaster;
  for (const k of ['queue', 'plat', 'exitq']) C[k] = C[k].filter(id => id !== p.id);
  p.cst = null; p.x = x; p.floor = ROOF;
  if (S.fire && inFireZone(ROOF)) { p.evac = true; p.evacFrom = ROOF; }
  setTrip(p, p.exitFloor, why);
  pev(p, why);
}
/** efter åket: hur det kändes, och om magen hänger med */
function afterRide(p) {
  p.rode = (p.rode || 0) + 1;
  const sick = QUEASY.rng() < 0.22, delay = QUEASY.rand(1, 28);
  if (sick) { p.queasyAt = S.t + delay; pev(p, 'Svindeln! … oj, magen. Jag mår inte så bra.'); }
  else pev(p, QUEASY.pick(['Svindeln! Det kittlade i magen hela vägen ner!', 'IGEN! Jag vill åka igen!', 'Loopen! Jag tappade nästan glasögonen!', 'Aldrig mer. Aldrig. Mer.']));
}

// ---------- Varje steg ----------
export function coasterTick(dt) {
  const C = S.coaster;
  if (!C) return;
  const why = closedWhy();
  if (why !== C.why) {
    if (why && !C.why) log(`🎢 Svindeln: ${why.toLowerCase()}`, 'move');
    else if (!why) log('🎢 Svindeln är öppen – åk om du vågar!', 'move');
    C.why = why;
  }
  // (den som inte längre är kvar vid banan – gått hem, hämtad av ambulansen – stryks ur köerna)
  const here = id => { const p = byId(id); return !!p && p.state === 'coaster'; };
  for (const k of ['queue', 'plat', 'exitq']) if (!C[k].every(here)) C[k] = C[k].filter(here);
  const fire = S.fire && inFireZone(ROOF);
  // stängt: kön går (vid brand går alla ner direkt via servicetrappan)
  if (why) for (const id of [...C.queue]) { const p = byId(id); if (p) leave(p, `Svindeln: ${why.toLowerCase()} – går därifrån`, p.x); }
  if (fire) for (const id of [...C.plat, ...C.exitq, ...C.lift.riders]) { const p = byId(id); if (p) leave(p, 'BRANDLARM – ner för servicetrappan!', LIFT_X); }
  if (fire) C.lift.riders = [];
  // kön: alla går fram mot Banhissen
  C.queue.forEach((id, i) => { const p = byId(id); if (p) { p.tx = QUEUE_X + i * QUEUE_DX; walk(p, dt); p.face = -1; } });
  liftTick(dt, !!why);
  trainTick(dt, !!why);
  stuckTick();
}
/** Banhissen: tre i taget upp till plattformen, och ner med dem som har åkt */
function liftTick(dt, closed) {
  const C = S.coaster, L = C.lift;
  if (!S.power) return; // (strömlös: står still där den är)
  if (L.ph === 'move') {
    L.pos = Math.max(0, Math.min(1, L.pos + L.dir * dt / LIFT_T));
    if ((L.dir > 0 && L.pos >= 1) || (L.dir < 0 && L.pos <= 0)) { L.ph = 'door'; L.t = S.t; }
    return;
  }
  if (L.ph === 'door') {
    if (S.t - L.t < LIFT_DOOR) return;
    // av: uppe till plattformen, nere ut på däcket
    for (const id of L.riders) {
      const p = byId(id); if (!p) continue;
      if (L.pos >= 1) { p.cst = 'plat'; C.plat.push(id); p.x = PLAT_X0 + 6 + (C.plat.length % 6) * 10; pev(p, 'Uppe på Svindelns plattform – hjärtat bultar'); }
      else leave(p, p.rode ? 'Har åkt Svindeln – går ut' : `Svindeln: ${C.why.toLowerCase() || 'stängt'} – går ut`);
    }
    L.riders = [];
    L.ph = 'idle';
  }
  // på: uppe tar den med dem som ska ner, nere dem som står först i kön (om det finns plats på plattformen)
  if (L.pos >= 1) {
    const down = C.exitq.slice(0, LIFT_CAP);
    if (down.length) { C.exitq = C.exitq.slice(down.length); go(L, -1, down, 'Banhissen ner till däcket'); return; }
    if (C.queue.length && !closed) { go(L, -1, [], ''); return; }
  } else {
    const room = TRAIN_CAP + 2 - C.plat.length - C.train.riders.length * (C.train.ph === 'load' ? 1 : 0);
    const n = closed ? 0 : Math.min(LIFT_CAP, room, C.queue.length);
    // de första i kön som har hunnit fram till hissen (i tur och ordning)
    const front = [];
    for (const id of C.queue.slice(0, n)) { const p = byId(id); if (!p || Math.abs(p.x - p.tx) >= 2) break; front.push(id); }
    if (front.length) { C.queue = C.queue.slice(front.length); go(L, 1, front, 'Kliver in i Banhissen – tre i taget, upp till Svindeln'); return; }
    if (C.exitq.length) { go(L, 1, [], ''); return; }
  }
}
function go(L, dir, riders, why) {
  L.riders = riders; L.dir = dir; L.ph = 'move';
  for (const id of riders) { const p = byId(id); if (p) { p.cst = 'lift'; if (why) pev(p, why); } }
}
/** tåget: lastar, kedjebacken, åket, tillbaka in */
function trainTick(dt, closed) {
  const C = S.coaster, T = C.train;
  if (T.ph === 'load') {
    T.u = U_LOAD;
    // stängt: de som satt i tåget kliver av och tar Banhissen ner
    if (closed && !C.stuck) {
      for (const id of [...T.riders, ...C.plat]) { const p = byId(id); if (p) { p.cst = 'exitq'; C.exitq.push(id); pev(p, `Svindeln: ${C.why.toLowerCase()} – kliver av och tar Banhissen ner`); } }
      T.riders = []; C.plat = []; T.firstAt = null;
      return;
    }
    if (closed) return;
    if (C.plat.length && T.riders.length < TRAIN_CAP && S.t >= T.nextBoard) {
      const id = C.plat.shift(), p = byId(id);
      if (p) { p.cst = 'train'; T.riders.push(id); pev(p, `Spänner fast bygeln – plats ${T.riders.length} i Svindeln`); }
      T.nextBoard = S.t + BOARD_DT;
      if (T.firstAt === null) T.firstAt = S.t;
    }
    const lifting = C.lift.riders.length > 0 && C.lift.dir > 0;
    if (T.riders.length >= TRAIN_CAP || (T.riders.length && S.t - (T.firstAt ?? S.t) >= LOAD_MAX && !lifting && !C.plat.length)) {
      T.ph = 'climb'; T.t = S.t; T.prog = 0;
      log(`🎢 Svindeln går med ${T.riders.length} åkare – klick, klick, klick uppför kedjebacken`, 'move');
    }
    return;
  }
  if (T.ph === 'climb') {
    if (C.stuck) return; // (står stilla i backen tills det är löst – stuckTick)
    if (!S.power) { stick('ström'); return; } // (kedjan stannar utan ström – spärrhakarna håller tåget)
    T.prog = Math.min(1, T.prog + dt / CLIMB_T);
    T.u = U_LOAD + (U_PEAK - U_LOAD) * T.prog;
    if (T.stuckNext && T.prog > 0.55 && T.riders.length) { stick(BANAN.rng() < 0.5 ? 'kedja' : 'givare'); return; }
    if (T.prog >= 1) {
      T.ph = 'ride'; T.t = S.t;
      if (T.riders.length) S.fx.push({ x: trackAt(U_PEAK).x, y: trackAt(U_PEAK).y - 20, text: 'AAAAAH!', color: '#ffe14d', life: 2, size: 14 });
    }
    return;
  }
  if (T.ph === 'ride') {
    // gravitationen: det går utan ström, och fortast efter toppen
    const k = Math.min(1, (S.t - T.t) / RIDE_T);
    T.u = U_PEAK + (1 + U_LOAD - U_PEAK) * (1 - (1 - k) * (1 - k * 0.35));
    if (k >= 1) { T.ph = 'unload'; T.t = S.t; T.u = U_LOAD; }
    return;
  }
  if (T.ph === 'unload') {
    T.u = U_LOAD;
    if (S.t - T.t < UNLOAD_T) return;
    if (T.riders.length) { S.stats.coasterRides++; S.stats.coasterRiders += T.riders.length; }
    for (const id of T.riders) { const p = byId(id); if (!p) continue; p.cst = 'exitq'; C.exitq.push(id); afterRide(p); }
    T.riders = []; T.ph = 'load'; T.firstAt = null;
  }
}

// ---------- Incidenten: tåget fastnar i kedjebacken ----------
/** kan tåget fastna nu (för slumpen och framkalla)? */
export const coasterCandidate = () => !!S.coaster && !S.coaster.stuck && !S.coaster.why && !S.coaster.train.stuckNext;
/** Framkalla: nästa tåg med åkare stannar i kedjebacken */
export function triggerCoaster() {
  if (!coasterCandidate()) return false;
  S.coaster.train.stuckNext = true;
  log('🎢 Det gnisslar i Svindelns kedja…', 'alert');
  return true;
}
const STUCK_TEXT = { kedja: 'kedjan har hoppat av drevet', givare: 'en givare har löst ut', 'ström': 'kedjan stannade när strömmen gick' };
function stick(kind) {
  const C = S.coaster, T = C.train;
  T.stuckNext = false;
  const need = kind === 'kedja' ? BANAN.rand(55, 75) : kind === 'givare' ? BANAN.rand(14, 22) : 3;
  C.stuck = { t0: S.t, kind, need, fixAt: S.t + need, how: /** @type {string|null} */ (null), by: '', n: T.riders.length, out: 0, nextOut: 0 };
  S.stats.coasterStuck++;
  for (const id of T.riders) { const p = byId(id); if (p) pev(p, `Svindeln tvärstannade i kedjebacken – ${STUCK_TEXT[kind]}! Vi sitter fast högt över taket`); }
  log(`🎢 Svindeln sitter fast i kedjebacken – ${STUCK_TEXT[kind]}. ${T.riders.length} åkare hänger över taket`, 'alert');
  S.fx.push({ x: trackAt(T.u).x, y: trackAt(T.u).y - 18, text: 'KLONK!', color: '#ff9f1c', life: 1.6 });
  incidentStarted(ROOF);
}
const HOW_TEXT = { wait: 'Vänta på banmästaren', walk: 'Ner för servicetrappan' };
export const coasterHowText = how => HOW_TEXT[how] || '';
/** Välj hur åkarna kommer loss (by = 'chief', 'player' eller 'crew'). Returnerar false om det inte går. */
export function setCoasterHow(how, by) {
  const St = S.coaster && S.coaster.stuck;
  if (!St || !HOW_TEXT[how]) return false;
  if (St.how === how) return true;
  St.how = how; St.by = by;
  if (by === 'crew') log(`🎢 Banmästaren bestämmer: ${HOW_TEXT[how].toLowerCase()}`, 'alert');
  if (how === 'walk') St.nextOut = Math.max(St.nextOut, S.t + 2);
  return true;
}
/** blåser det för mycket för att gå på servicetrappan? */
export const stairsWindy = () => windAt() > WIND_STOP;
/** är banan lagad? (strömmen tillbaka och banmästaren klar) */
const fixed = St => S.power && S.t >= St.fixAt;
function stuckTick() {
  const C = S.coaster, St = C.stuck, T = C.train;
  if (!St) { C.walker = null; return; }
  if (St.kind === 'ström' && !S.power) St.fixAt = S.t + 3; // (kedjan startar om en stund efter att strömmen är tillbaka)
  if (!St.how && S.t - St.t0 >= COASTER_DEFAULT_S) setCoasterHow(St.need > 30 || St.kind === 'ström' ? (stairsWindy() ? 'wait' : 'walk') : 'wait', 'crew');
  // ner för trappan, en i taget (stannar i blåst)
  if (St.how === 'walk') {
    const W = C.walker;
    if (W && S.t >= W.t0 + WALK_T) {
      const p = byId(W.id);
      C.walker = null; St.out++;
      if (p) { leave(p, 'Nere på däcket efter servicetrappan – benen skakar', trackAt(T.u).x - 10); pev(p, `Gick ner för Svindelns servicetrappa efter ${Math.round(S.t - St.t0)} s i backen`); }
    }
    if (!C.walker && T.riders.length && S.t >= St.nextOut && !stairsWindy()) {
      const id = T.riders.shift(), p = byId(id), at = trackAt(T.u);
      if (p) { p.cst = 'walk'; C.walker = { id, t0: S.t, x0: at.x, y0: at.y }; pev(p, 'Kliver ur vagnen och tar servicetrappan ner längs backen'); log(`🪜 ${pn(p)} går ner för Svindelns servicetrappa`, 'alert', null, p.id); }
      St.nextOut = S.t + WALK_T + 0.5;
    }
  }
  // klart: banmästaren är färdig (och de som skulle gå ner är nere) – tåget fortsätter
  if (fixed(St) && St.how && !(St.how === 'walk' && (C.walker || T.riders.length))) {
    C.stuck = null;
    const how = St.out ? `${St.out} gick ner för servicetrappan` : `${St.n} satt kvar tills banmästaren hade ${St.kind === 'kedja' ? 'lagt på kedjan' : St.kind === 'ström' ? 'fått ström igen' : 'återställt givaren'}`;
    log(`✅ Svindeln rullar igen efter ${Math.round(S.t - St.t0)} s i kedjebacken`, 'alert');
    incidentOver('coaster', '✅ Svindeln rullar igen', `Tåget satt fast i kedjebacken i ${Math.round(S.t - St.t0)} s (${STUCK_TEXT[St.kind]}) – ${how}.`, { floor: ROOF });
    for (const id of T.riders) { const p = byId(id); if (p) pev(p, 'Det rycker till – vi åker igen!'); }
  }
}

// ---------- Var åkarna syns (grafiken och träffytorna) ----------
/** x (figurens mitt) och y (fötterna) i världen för den som är i Svindeln, eller null */
export function coasterPos(p) {
  const C = S.coaster;
  if (!C || p.state !== 'coaster') return null;
  switch (p.cst) {
    case 'queue': return { x: p.x, y: DECK_Y, where: 'queue' };
    case 'lift': { const i = C.lift.riders.indexOf(p.id); return { x: LIFT_X - 5 + i * 5, y: DECK_Y + (PLAT_Y - DECK_Y) * C.lift.pos, where: 'lift' }; }
    case 'plat': return { x: PLAT_X0 + 6 + (C.plat.indexOf(p.id) % 7) * 11, y: PLAT_Y, where: 'plat' };
    case 'exitq': return { x: PLAT_X1 - 6 - (C.exitq.indexOf(p.id) % 7) * 11, y: PLAT_Y, where: 'plat' };
    case 'train': {
      const i = C.train.riders.indexOf(p.id), at = trackBack(C.train.u, seatBack(i));
      return { x: at.x + (i & 1) * 3, y: at.y, where: 'train', seat: i };
    }
    case 'walk': {
      const W = C.walker; if (!W || W.id !== p.id) return null;
      const k = Math.min(1, (S.t - W.t0) / WALK_T);
      return { x: W.x0 - 20 * k, y: W.y0 + (DECK_Y - W.y0) * k, where: 'walk' };
    }
  }
  return null;
}
