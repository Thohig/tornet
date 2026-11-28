// Grafikens ingång och logiken för VAR folk syns i bilden (hallen framför hissarna).
// Själva ritandet sker i pixel.js (och delarna i pix*.js). Allt här är bara grafik: simuleringens p.x ändras aldrig.
import { clamp } from './util.js';
import { BX1, CAR_W, DOOR_X, FL, SKYWALK_F, TOP, TOWER_X1, W, WAIT_X1, floorY, shaftX, surf } from './config.js';
import { TERRACE_Y } from './hoist.js';
import { riderPos } from './pano.js';
import { S } from './state.js';
import { clouds } from './view.js';
import { renderPixel } from './pixel.js';
import { PX } from './pixart.js';
import { PERSON_H, PERSON_W } from './pixpeople.js';
import { windAt } from './weather.js';
import { SKYWALK_DOOR } from './skywalk.js';
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
 *  (pixhall.js och pixroof.js ritar figuren just där – samma geometri som gondolen och terrassen ritas med) @param {Person} p */
export function winPos(p) {
  const s = p.spot;
  switch (s.win) {
    case 'gondola': {
      // (i repet bredvid gondolen när räddningstjänsten firar ner honom, gondola.js)
      const rope = S.gondola && S.gondola.ph === 'stuck' ? S.gondola.ropeY : null;
      return { x: TOWER_X1[TOP] + 7 + PX * 7 + PERSON_W + (rope !== null ? PX * 20 : 0), y: (rope ?? (S.cleaner ? S.cleaner.y : surf(p.floor))) - PX * (PERSON_H - 1) };
    }
    case 'terrace': return { x: BX1 - PX * 22 + PERSON_W, y: TERRACE_Y - PX * (PERSON_H + 1) };
    case 'reception': return { x: s.x, y: surf(p.floor) - PX * 24 };
    default: return { x: s.x, y: surf(p.floor) - PX * (PERSON_H + (s.k === 'stand' ? 4 : s.win === 'control' ? -5 : -1)) };
  }
}
/** syns huvudet i bilden (i hallen, en korg, ett fönster – eller i rummet i Våningarna)? @param {ReturnType<typeof personHead>} h */
export const seenAt = h => !!h && (!h.hidden || 'room' in h);
/** @param {Person} p */
export function personHead(p) {
  // var personens huvud syns just nu (för markörer & träffytor)
  if (p.dead) return null;
  if (inWindow(p)) { const w = winPos(p); return { x: w.x, y: w.y - 22 }; }
  // firas ner längs fasaden (eller klättrar nerför stegbilens stege) – pano.js
  if (p.state === 'rope') { const r = riderPos(p); if (r) return { x: r.x, y: r.y - 22 }; }
  // på bron till Kronan (skywalk.js): bron går bakåt ur bild – hen syns bara som en siluett i dörrens glas (pixhall.js)
  if (p.state === 'bridge') return { x: SKYWALK_DOOR, y: surf(SKYWALK_F) - 82, hidden: true };
  if (p.state === 'ride') {
    const e = p.car, k = e.deck2 ? p.deck || 0 : 0;
    const i = e.passengers.filter(q => !e.deck2 || (q.deck || 0) === k).indexOf(p);
    return { x: shaftX(e.id) + 4 + carSlotX(carSlot(i)), y: floorY(e.pos + k + (e.level || 0) * 2.5) - 4 - 62, inCar: e };
  }
  // i hallen där personen syns, annars "bakom" korridoren på sin våning – eller i rummet (Våningarna, pixrooms.js)
  const lp = landPos(p);
  if (lp) return { x: lp.x, y: surf(p.floor) + p.depth * 0.6 - 70 };
  const rp = roomPos(p);
  if (rp) return { x: rp.x, y: surf(p.floor) - (rp.pose === 'stand' ? 52 : 44), hidden: true, room: true };
  return { x: DOOR_X, y: surf(p.floor) - 82, hidden: true };
}
// ---------- Var folk syns: rummen (Våningarna) ----------
// Till vänster om hallen syns rummen i genomskärning. Den som är inne på våningen (läget office, och inte på en
// plats i hallen eller i ett fönster) får en plats i rummet: ett skrivbord, en stol eller en plats att stå på,
// efter våningens tema. Platserna delas ut i id-ordning, så att man behåller sin plats medan man är inne.
// Allt här är bara grafik: simuleringen vet inte om rummen.
/** @typedef {{ x: number, pose: 'desk'|'chair'|'stand', face: number, jump?: boolean }} Seat */
/** @param {number} x @param {'desk'|'chair'|'stand'} pose @param {number} [face] @returns {Seat} */
const seat = (x, pose, face = 1) => ({ x, pose, face });
const OFFICE = [seat(96, 'desk'), seat(146, 'desk'), seat(196, 'desk'), seat(78, 'stand'), seat(170, 'stand', -1), seat(122, 'stand'), seat(224, 'stand', -1)];
/** platserna i rummet per tema (världens x mellan rummens väggar) @type {Record<string, Seat[]>} */
export const ROOM_SEATS = {
  office: OFFICE, game: OFFICE, law: [seat(104, 'desk'), seat(184, 'desk'), seat(144, 'stand', -1), seat(80, 'stand'), seat(220, 'stand', -1)],
  ad: [seat(124, 'chair'), seat(160, 'chair'), seat(142, 'chair'), seat(206, 'stand', -1), seat(84, 'stand'), seat(228, 'stand', -1)],
  bank: [seat(112, 'desk'), seat(160, 'desk'), seat(136, 'stand', -1), seat(84, 'stand'), seat(186, 'stand', -1)],
  dentist: [seat(152, 'chair'), seat(176, 'stand', -1), seat(86, 'chair'), seat(104, 'chair'), seat(214, 'stand', -1)],
  radio: [seat(126, 'desk'), seat(170, 'desk'), seat(212, 'stand', -1), seat(86, 'stand')],
  aerobic: [90, 116, 142, 168, 194, 220].map(x => ({ ...seat(x, 'stand'), jump: true })),
  server: [seat(214, 'desk'), seat(110, 'stand'), seat(150, 'stand', -1), seat(180, 'stand')],
  spa: [seat(104, 'stand'), seat(168, 'stand', -1), seat(206, 'stand'), seat(226, 'stand', -1)],
  lab: [seat(100, 'stand'), seat(136, 'stand'), seat(172, 'stand', -1), seat(216, 'desk')],
  sky: [seat(90, 'chair'), seat(118, 'chair'), seat(164, 'chair'), seat(192, 'chair'), seat(228, 'stand', -1), seat(140, 'stand')],
  apartments: [seat(112, 'chair'), seat(130, 'chair'), seat(196, 'stand', -1), seat(220, 'stand'), seat(160, 'stand')],
  lobby: [seat(102, 'chair'), seat(120, 'chair'), seat(184, 'stand', -1), seat(210, 'stand')],
  roof: [seat(110, 'chair'), seat(128, 'chair'), seat(184, 'stand'), seat(214, 'stand', -1)],
  garage: [], dock: [], station: [],
};
/** platserna på våning f (temat, med kontorets som standard) */
export const seatsOf = f => ROOM_SEATS[FL[f].theme] || OFFICE;
/** syns personen i rummet? (inne på våningen, inte i hallen, ett fönster, en korg eller trapphuset) @param {Person} p */
const inRoom = p => !p.dead && p.state === 'office' && !inWindow(p) && !(p.spot && p.spot.win === 'hall') && ffSpot(p) === null && !p.collapsed;
/** @type {{ key: string, at: Map<number, Seat> }} */
const ROOMS = { key: '', at: new Map() };
/** var personen sitter eller står i rummet (null = syns inte där: fullt, eller inte inne) @param {Person} p */
export function roomPos(p) {
  if (!inRoom(p)) return null;
  const key = `${S.day}|${S.t}`;
  if (ROOMS.key !== key) {
    ROOMS.key = key; ROOMS.at.clear();
    /** @type {Map<number, Person[]>} */
    const by = new Map();
    for (const q of S.people) if (inRoom(q)) { const l = by.get(q.floor); if (l) l.push(q); else by.set(q.floor, [q]); }
    for (const [f, ps] of by) {
      const seats = seatsOf(f), free = seats.map(() => true);
      ps.sort((a, b) => a.id - b.id);
      for (const q of ps) {
        // helst samma plats varje gång (efter id), annars nästa lediga
        for (let k = 0; k < seats.length; k++) {
          const i = (q.id * 7 + k) % seats.length;
          if (free[i]) { free[i] = false; ROOMS.at.set(q.id, seats[i]); break; }
        }
      }
    }
  }
  return ROOMS.at.get(p.id) || null;
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
    // (den som just kom över bron från Kronan syns från dörren till bron, skywalk.js)
    const fromBridge = p.fromBridgeT !== undefined && S.t - p.fromBridgeT < 0.5 && p.floor === SKYWALK_F;
    const prev = fromBridge || (!r && p.fromTrain) || (r && (r.state === 'ride' || (r.vis || r.win) && r.floor === p.floor));
    const vx0 = !prev ? DOOR_X : fromBridge || !r || r.state === 'ride' ? p.x : r.vx;
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
