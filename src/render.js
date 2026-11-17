// Grafikens ingång och logiken för VAR folk syns i bilden (hallen framför hissarna).
// Själva ritandet sker i pixel.js. Allt här är bara grafik: simuleringens p.x ändras aldrig.
import { clamp } from './util.js';
import { BX1, CAR_W, DOOR_X, TOP, TOWER_X1, W, WAIT_X1, floorY, shaftX, surf } from './config.js';
import { TERRACE_Y } from './hoist.js';
import { riderPos } from './pano.js';
import { S } from './state.js';
import { clouds } from './view.js';
import { renderPixel } from './pixel.js';
import { PX } from './pixart.js';
import { PERSON_H, PERSON_W } from './pixpeople.js';
import { windAt } from './weather.js';
/** @typedef {import('./people.js').Person} Person */

/** platser i korgen: bakre raden (0–3) och främre raden (4–7), utspridda över korgens bredd */
export function carSlotX(i) { return i < 4 ? 12 + i * (CAR_W - 24) / 3 : 16 + (i - 4) * (CAR_W - 32) / 3; }
/** hissetikett: den i:te som kliver på ställer sig i ett ledigt hörn först, sedan i mitten (platsens index) */
const CORNERS = [0, 3, 1, 2, 4, 7, 5, 6];
export const carSlot = i => CORNERS[i % 8];
/** syns personen på sin plats (spot.win): i ett fönster i hallens bakvägg (kontrollrummet, personalrummet),
 *  bakom receptionsdisken, i gondolen eller på takterrassen? ('hall' = står i hallen och ritas som folket där) @param {Person} p */
export const inWindow = p => p.state === 'office' && !!(p.spot && p.spot.win) && p.spot.win !== 'hall';
/** var den som syns på sin plats ritas: x = figurens mitt och y = huvudets överkant, i världens koordinater
 *  (pixel.js ritar figuren just där – samma geometri som gondolen och terrassen ritas med) @param {Person} p */
export function winPos(p) {
  const s = p.spot;
  switch (s.win) {
    case 'gondola': return { x: TOWER_X1[TOP] + 7 + PX * 7 + PERSON_W, y: (S.cleaner ? S.cleaner.y : surf(p.floor)) - PX * (PERSON_H - 1) };
    case 'terrace': return { x: BX1 - PX * 22 + PERSON_W, y: TERRACE_Y - PX * (PERSON_H + 1) };
    case 'reception': return { x: s.x, y: surf(p.floor) - PX * 24 };
    default: return { x: s.x, y: surf(p.floor) - PX * (PERSON_H + (s.k === 'stand' ? 4 : s.win === 'control' ? -5 : -1)) };
  }
}
/** @param {Person} p */
export function personHead(p) {
  // var personens huvud syns just nu (för markörer & träffytor)
  if (p.dead) return null;
  if (inWindow(p)) { const w = winPos(p); return { x: w.x, y: w.y - 22 }; }
  // firas ner längs fasaden (eller klättrar nerför stegbilens stege) – pano.js
  if (p.state === 'rope') { const r = riderPos(p); if (r) return { x: r.x, y: r.y - 22 }; }
  if (p.state === 'ride') {
    const e = p.car, k = e.deck2 ? p.deck || 0 : 0;
    const i = e.passengers.filter(q => !e.deck2 || (q.deck || 0) === k).indexOf(p);
    return { x: shaftX(e.id) + 4 + carSlotX(carSlot(i)), y: floorY(e.pos + k + (e.level || 0) * 2.5) - 4 - 62, inCar: e };
  }
  // i hallen där personen syns, annars "bakom" korridoren på sin våning
  const lp = landPos(p);
  if (lp) return { x: lp.x, y: surf(p.floor) + p.depth * 0.6 - 70 };
  return { x: DOOR_X, y: surf(p.floor) - 82, hidden: true };
}
// ---------- Var folk syns: hallen framför hissarna ----------
// Simuleringen låter folk gå hela vägen genom rummen, men bilden visar bara hallen. Kön pressas
// ihop mot korridoren (visX), och den som är på väg in i eller ut ur rummen syns bara på den
// sista/första biten genom hallen – i samma takt som i simuleringen. Allt här är bara grafik.
const QA = 60, QB = WAIT_X1 - DOOR_X;
/** världens x → x i hallen: närmast hissarna oförändrat, längre bort allt tätare mot korridoren */
export function visX(x) {
  const d = WAIT_X1 - x;
  if (d <= QA) return x;
  const r = QB - QA;
  return WAIT_X1 - (QA + r * (1 - Math.exp(-(d - QA) / r)));
}
const SHOWN = new Set(['toQueue', 'wait', 'boarding', 'exiting', 'stairs', 'platform']);
/** @type {WeakMap<object, {state: string, floor: number, vis: boolean, vx: number, x0?: number, vx0?: number, fromDoor?: boolean, win?: boolean}>} */
const SEEN = new WeakMap();
const lerp = (a, b, t) => a + (b - a) * t;
/** var personen syns i hallen just nu: { x, a, dir } (a = synlighet 0–1), eller null om hen är "bakom" korridoren */
/** brandmännen på brandvåningen går inte in i rummen i bilden: de står i hallen med slangen riktad mot lågorna
 *  vid korridoren (x i hallen, annars null). Gäller tills de går därifrån, även en stund efter att det är släckt. @param {Person} p */
export function ffSpot(p) {
  if (!p.ff || !S.brigade || p.floor !== S.brigade.floor || (p.state !== 'office' && p.state !== 'exiting')) return null;
  return DOOR_X + 76 + (p.id % 3) * 22;
}
/** @param {Person} p */
export function landPos(p) {
  let r = SEEN.get(p);
  // står på en plats i hallen (personalen vid godisautomaten, på perrongen, brandmännen som släcker): syns där
  const hx = p.state !== 'office' ? null : p.spot && p.spot.win === 'hall' ? p.spot.x : ffSpot(p);
  if (hx !== null) {
    if (r) { r.state = p.state; r.floor = p.floor; r.vis = true; r.vx = hx; r.win = true; }
    else SEEN.set(p, { state: p.state, floor: p.floor, vis: true, vx: hx, win: true });
    return { x: hx, a: 1, dir: 0, face: p.ff ? -1 : 0 };
  }
  if (p.state === 'ride' || !SHOWN.has(p.state)) {
    const vis = p.state === 'ride', win = inWindow(p);
    // (den som sitter i ett fönster syns där – går hen sedan ut i hallen gör hen det därifrån, inte ur korridoren)
    if (r) { r.state = p.state; r.vis = vis; r.floor = p.floor; r.win = win; if (win) r.vx = p.spot.x; }
    else SEEN.set(p, { state: p.state, floor: p.floor, vis, vx: win ? p.spot.x : DOOR_X, win });
    return null;
  }
  if (!r || r.state !== p.state || r.floor !== p.floor && r.state !== 'ride') {
    // nytt läge: kom personen från något som syntes (hissen, kön) eller inifrån rummen?
    // (den som just klev av tunnelbanan syns från första steget, vid tågets dörr)
    const prev = (!r && p.fromTrain) || (r && (r.state === 'ride' || (r.vis || r.win) && r.floor === p.floor));
    const vx0 = !prev ? DOOR_X : !r || r.state === 'ride' ? p.x : r.vx;
    r = { state: p.state, floor: p.floor, vis: false, vx: vx0, x0: p.x, vx0, fromDoor: !prev };
    SEEN.set(p, r);
  }
  let vx, a = 1;
  if (p.state === 'wait' || p.state === 'platform') vx = visX(p.x);
  else {
    // (den som ska med tunnelbanan går ut på perrongen, inte in i korridoren)
    // (till ett fönster i bakväggen går man genom hallen och sätter sig där)
    const ffx = ffSpot(p), toWin = p.state === 'exiting' && (!!(p.spot && p.spot.win) || ffx !== null);
    const toDoor = (p.state === 'exiting' && !p.toTrain && !toWin) || p.state === 'stairs';
    if (r.fromDoor && toDoor) { r.vis = false; return null; } // inifrån och in igen: syns aldrig
    const vxT = toDoor ? DOOR_X : ffx !== null ? ffx : p.state === 'boarding' || toWin ? p.tx : visX(p.tx);
    const Dw = Math.abs(p.tx - r.x0), t = Dw > 1 ? clamp(Math.abs(p.x - r.x0) / Dw, 0, 1) : 1;
    // kort gångväg (rummet ligger nära kön): dyk upp/försvinn en bit ut i hallen i stället för att
    // rusa genom den – högst 1,6 × gångfarten i bilden
    let from = r.vx0, to = vxT;
    if (r.fromDoor) from = Math.max(DOOR_X, vxT - 1.6 * Dw);
    else if (toDoor) to = Math.max(DOOR_X, from - 1.6 * Dw);
    // f = hur stor del av gångvägen som syns i hallen (samma gångfart som i simuleringen)
    const f = Dw > 1 ? clamp(Math.abs(to - from) / Dw, 0.05, 1) : 1;
    let u;
    if (r.fromDoor) { u = clamp((t - (1 - f)) / f, 0, 1); a = clamp(u * 4, 0, 1); }
    else if (toDoor) { u = clamp(t / f, 0, 1); a = clamp((1 - u) * 4, 0, 1); }
    else u = t;
    vx = lerp(from, to, u);
  }
  const dir = Math.sign(vx - r.vx) || 0;
  r.vx = vx; r.vis = a > 0.3;
  if (a <= 0) return null;
  return { x: vx, a, dir };
}
/** de som är inne på våningen (syns inte i hallen) – för klick på korridoren */
export function peopleBehindDoor(f) {
  return S.people.filter(p => !p.dead && p.floor === f && p.state !== 'away' && p.state !== 'incar' && p.state !== 'ride' && personHead(p)?.hidden)
    .sort((a, b) => a.id - b.id);
}

export function render(dt) {
  // molnen driver fortare när det blåser
  if (S.started && !S.paused) { const w = 1 + windAt() * 5; for (const c of clouds) { c.x += c.v * dt * S.speed * w; if (c.x > W + 80) c.x = -80; } }
  renderPixel(dt);
}
