// Pixelgrafik: det som står still eller rör sig utanför hallarna – himlen, stadssiluetten, gatan med
// fotgängare, brandbilen och turistbussen, tornets fasad, schakten, garagerampen, terrassen,
// bjälklagen, lastkajen och våningsdisplayerna vid schaktdörrarna.
import { clouds, nightness, skyAt, skyline, stars } from './view.js';
import { hour, S } from './state.js';
import { blend, dark, ellipseSprite, led, light, PX, rgbOf, text, textW } from './pixart.js';
import {
  BX0, BX1, CAR_H, carPos, DOCK, DOOR_X, EL, FLOORS, floorY, GARAGE_FLOORS, GROUND_Y, H, LAND_X0, LOBBY, ROOF_Y, SEAM_F,
  SHAFT_W, SHAFT_X0, shaftCX, shaftX, STATION, surf, TOP, TOWER_X1, W,
} from './config.js';
import { clamp, fl } from './util.js';
import { PAL } from './pixpal.js';
import { vpick, vrand } from './rng.js';
import { HAIR_NAT, PANTS, SHIRT, SKIN } from './people.js';
import { PERSON_H, PERSON_W, personSprite } from './pixpeople.js';
import { BUS_LEN, BUS_STOP_X } from './tour.js';
import { buttonsMode, hallLit } from './buttons.js';
import { assignedTo, keyed } from './dispatch.js';
import { sunWarp } from './calendar.js';
import { box, cloudSprite, CY, g, INK, layer, line, lo, MOON, nightStep, once, pill, R, reserve, SUN, X, X0, Y } from './pixcore.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */

// ---------- Himmel (förberäknad, med rastrerad övergång som på 16-bitarstiden) ----------
const sky = { c: /** @type {HTMLCanvasElement|null} */ (null), key: '' };
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function skyCanvas(w) {
  // himlen följer dygnet men dämpas lite mot grått, som resten av paletten
  const [a0, b0] = skyAt(hour()), a = blend(a0, '#9aa4b0', 0.25), b = blend(b0, '#9aa4b0', 0.25);
  const q = c => rgbOf(c).map(v => v >> 3).join(',');
  const key = `${q(a)}|${q(b)}|${w}`;
  if (sky.c && sky.key === key) return sky.c;
  const h = Math.ceil(H / PX), N = 14;
  const A = rgbOf(a), B = rgbOf(b);
  const steps = Array.from({ length: N }, (_, i) => [0, 1, 2].map(k => Math.round(A[k] + (B[k] - A[k]) * (i / (N - 1)))));
  const c = sky.c && sky.c.width === w ? sky.c : document.createElement('canvas');
  c.width = w; c.height = h;
  const cg = c.getContext('2d'), img = cg.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const v = (y / (h - 1)) * (N - 1), i0 = Math.floor(v), fr = v - i0;
    for (let x = 0; x < w; x++) {
      const s = steps[Math.min(N - 1, fr * 16 > BAYER[y & 3][x & 3] ? i0 + 1 : i0)], o = (y * w + x) * 4;
      d[o] = s[0]; d[o + 1] = s[1]; d[o + 2] = s[2]; d[o + 3] = 255;
    }
  }
  cg.putImageData(img, 0, 0);
  sky.c = c; sky.key = key;
  return c;
}
export function drawSkyAll(h) {
  // himlen följer världens x (X0 är alltid samma i den här vyn), så den räknas i ritytans bredd
  const sc = skyCanvas(lo.width);
  g.drawImage(sc, 0, -CY);
  const n = nightness(h);
  if (n > 0.05) for (const s of stars) {
    const tw = Math.sin(S.anim * 3 + s.x) > 0.3;
    R(X(s.x), Y(s.y), 1, 1, tw ? `rgba(255,255,220,${n})` : `rgba(255,255,220,${n * 0.5})`);
    if (s.r > 1.6 && tw) { R(X(s.x) - 1, Y(s.y), 3, 1, `rgba(255,255,220,${n * 0.6})`); R(X(s.x), Y(s.y) - 1, 1, 3, `rgba(255,255,220,${n * 0.6})`); }
  }
  // solens bana följer dagens sol (calendar.js); en ljus sommarnatt är ändå natt, då syns månen
  const tt = clamp((sunWarp(h, S.cal) - 6.5) / 13, 0, 1);
  if (n / S.cal.nightMax < 0.8) {
    const sx = W - 40 - tt * (W - 80), sy = 100 - Math.sin(tt * Math.PI) * 60;
    const k = Math.floor(S.anim * 2) % 2;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + k * Math.PI / 8; R(X(sx) + Math.round(Math.cos(a) * 11), Y(sy) + Math.round(Math.sin(a) * 11), 2, 2, '#ffb627'); }
    const s = SUN(); g.drawImage(s, X(sx) - 8, Y(sy) - 8);
  } else { const m = MOON(); g.drawImage(m, X(870) - 10, Y(60) - 10); }
  // stadssiluetten (statiskt lager)
  const ns = nightStep(h);
  layer('skyline', `${ns}|${S.power}`, () => drawSkylinePx(ns));
  for (const c of clouds) { const s = cloudSprite(c.s); g.drawImage(s, X(c.x) - Math.round(20 * c.s / PX), Y(c.y) - Math.round(30 * c.s / PX)); }
}
function drawSkylinePx(n) {
  const lit = n > 0.3 && S.power;
  for (const b of skyline) {
    const x = X(b.x), y = Y(GROUND_Y - b.h), w = Math.round(b.w / PX), bot = Y(GROUND_Y);
    if (x > lo.width || x + w < 0 || bot < 0 || y > lo.height) continue;
    const col = blend(PAL.city, PAL.cityNight, n);
    R(x, y, w, bot - y, dark(col, 0.25)); R(x + 1, y + 1, w - 2, bot - y - 1, col);
    for (let wy = y + 4; wy < bot - 4; wy += 6) for (let wx = x + 3; wx < x + w - 4; wx += 5)
      if ((((wx + X0 / PX) * 7 + (wy + CY) * 13) % 10) / 10 < b.win) R(wx, wy, 2, 3, lit ? '#ffe14d' : 'rgba(255,255,255,.3)');
  }
}
export function drawGroundPx() {
  const gy = Y(GROUND_Y);
  R(0, gy + 7, lo.width, lo.height, PAL.dirt);
  for (let y = Y(GROUND_Y + 50); y < lo.height; y += 23) R(0, y, lo.width, 5, PAL.dirtStripe);
  for (let i = 0; i < 90; i++) { const wx = (i * 137) % W, wy = GROUND_Y + 24 + (i * 53) % (H - GROUND_Y - 30); R(X(wx), Y(wy), 3, 2, PAL.pebble); }
  // under gatan: ledningar, ett avloppsrör och tunnelbanans tunnel ut mot stan
  const ly = Y(GROUND_Y + 22);
  R(0, ly, lo.width, 1, '#ffd23f'); R(0, ly + 2, lo.width, 1, '#3f7cff'); R(0, ly + 4, lo.width, 1, '#ff5d52');
  const py = Y(GROUND_Y + 44);
  R(0, py - 1, lo.width, 9, INK); R(0, py, lo.width, 7, '#7d786d'); R(0, py + 1, lo.width, 1, '#a8a395'); R(0, py + 5, lo.width, 1, '#5b574e');
  for (let x = -((X0 / PX) % 40); x < lo.width; x += 40) R(x, py - 1, 2, 9, '#5b574e');
  const t0 = Y(floorY(STATION + 1) + 18), t1 = Y(floorY(STATION) + 2);
  R(0, t0 - 2, lo.width, t1 - t0 + 4, INK); R(0, t0, lo.width, t1 - t0, '#1e2430');
  for (let x = -((X0 / PX) % 10); x < lo.width; x += 10) R(x, t0, 1, t1 - t0, '#262d3b');
  R(0, t1 - 2, lo.width, 1, '#8a909a');
  drawFoundationPx();
  // trottoaren och gatan
  R(0, gy, lo.width, 7, PAL.walk); R(0, gy, lo.width, 1, INK); R(0, gy + 7, lo.width, 1, INK);
  for (let x = -((X0 / PX) % 12); x < lo.width; x += 12) R(x, gy + 1, 1, 6, PAL.walkLine);
}
/** Under stationen: berget, husets bottenplatta med pålar ner i det och schaktgroparna med buffertar
 *  (gul-svarta stötdämpare) under hissarna som går ända ner till stationen. Bara grafik. */
function drawFoundationPx() {
  const y0 = Y(BASE_Y), bx0 = X(BX0), bx1 = X(BX1);
  if (y0 > lo.height || bx1 < 0) return;
  // berget: grått med sprickor, en bit under bottenplattan
  const rock = y0 + 22;
  R(0, rock, lo.width, lo.height - rock, '#6f6c68'); R(0, rock, lo.width, 1, '#4f4c48');
  for (let i = 0; i < 40; i++) {
    const wx = (i * 211) % W, x = X(wx), y = rock + 4 + (i * 7) % 30;
    if (x > -8 && x < lo.width) { R(x, y, 5, 1, '#5d5a56'); R(x + 5, y + 1, 3, 1, '#5d5a56'); }
  }
  // bottenplattan och pålarna
  R(bx0, y0, bx1 - bx0, 4, '#9c978c'); R(bx0, y0 + 4, bx1 - bx0, 1, INK);
  for (let x = bx0 + 6; x < bx1 - 2; x += 22) { R(x, y0 + 5, 3, rock - y0 + 4, '#8a857a'); R(x + 3, y0 + 5, 1, rock - y0 + 4, '#6d695f'); }
  // schaktgroparna: där bärlinan slutar står korgen på buffertarna om den åker för långt
  for (const e of EL) {
    if (e.facade || e.minF !== 0) continue;
    const x = X(shaftX(e.id)) + 2, w = Math.round(SHAFT_W / PX) - 4;
    if (x > lo.width || x + w < 0) continue;
    R(x - 1, y0, w + 2, 15, INK); R(x, y0, w, 14, '#2a2f38'); R(x, y0 + 12, w, 2, '#3a4150');
    for (const bx of [x + Math.round(w * 0.25) - 2, x + Math.round(w * 0.75) - 2]) {
      R(bx, y0 + 5, 5, 7, INK);
      for (let k = 0; k < 3; k++) R(bx + 1, y0 + 6 + k * 2, 3, 1, k % 2 ? '#1a1a1a' : '#ffd23f');
      R(bx, y0 + 4, 5, 1, '#b8bcc4');
    }
  }
}
/** Gatan utanför (till höger om huset): gatlyktor, busshållplatsen, ett träd och folk som går förbi.
 *  Bara grafik: fotgängarna får egna utseenden (inga dubbelgångare till folket i huset) och slumpas med vrand. */
const walkers = [];
let walkerN = 0;
let walkerT = 0;
export function drawStreetPx(dt, h) {
  const gy = Y(GROUND_Y), n = nightness(h);
  truckTick(dt);
  if (truck.x === TRUCK_PARK) drawTruckLadderPx(X(truck.x), gy); // (stegen syns uppe vid branden även när gatan är utanför bilden)
  if (gy < -40 || gy - 60 > lo.height) return;
  const sx0 = X(BX1 + 7), sx1 = lo.width;
  // träd och busskur framför panoramahissens glasrör, gatlykta längst ut
  const tx = X(BX1 + 136);
  R(tx, gy - 14, 2, 14, '#6b4a2b');
  for (const [dx, dy, r] of [[-5, -24, 6], [3, -26, 6], [-1, -31, 5]]) g.drawImage(once('tree' + r, () => ellipseSprite(r * 2, r * 2, '#389a5c', INK, '#2f7d4a')), tx + dx - r + 1, gy + dy - r + 6);
  const bx = X(BX1 + 34);
  R(bx, gy - 24, 1, 24, INK); box(bx - 4, gy - 30, 9, 7, '#ffd23f'); text(g, 'B', bx + 1, gy - 29, INK, 'center');
  R(bx + 4, gy - 6, 14, 2, '#8a6a46'); R(bx + 5, gy - 4, 1, 4, INK); R(bx + 16, gy - 4, 1, 4, INK);
  const lx = sx1 - 6;
  R(lx, gy - 34, 2, 34, '#3a3f48'); R(lx - 6, gy - 35, 8, 2, '#3a3f48'); R(lx - 7, gy - 33, 4, 2, S.power && n > 0.3 ? '#ffe14d' : '#9aa3ad');
  if (S.power && n > 0.3) for (let r = 0; r < 30; r++) { const w = 3 + Math.round(r * 0.6); R(lx - 5 - (w >> 1), gy - 31 + r, w, 1, `rgba(255,236,170,${(0.1 * n).toFixed(3)})`); }
  // fotgängare: fler i rusningen, nästan inga på natten
  if (S.started && !S.paused) {
    walkerT -= dt * S.speed;
    const rate = n > 0.7 ? 0.1 : (h > 7 && h < 9.5) || (h > 16 && h < 18.5) ? 0.9 : 0.4;
    if (walkerT <= 0 && walkers.length < 6 && S.people.length) {
      walkerT = vrand(1, 3) / rate;
      // (egna utseenden – inga dubbelgångare till folket i huset)
      const dir = vrand(0, 1) < 0.5 ? 1 : -1;
      const look = { skin: vpick(SKIN), shirt: vpick(SHIRT), pants: vpick(PANTS), hair: Math.floor(vrand(0, 6)), hairC: vpick(HAIR_NAT),
        tie: vrand(0, 1) < 0.3, tieC: vpick(SHIRT), stripe: vrand(0, 1) < 0.5, acc: vpick([0, 0, 1, 2, 3, 5]) };
      walkers.push({ x: dir > 0 ? BX1 - 10 : W + 10, dir, v: vrand(24, 40), look, child: vrand(0, 1) < 0.1, mood: 0, id: 7000 + walkerN++, depth: vrand(0, 3) });
    }
    for (const w of walkers) w.x += w.dir * w.v * dt * S.speed;
  }
  for (let i = walkers.length - 1; i >= 0; i--) if (walkers[i].x < BX1 - 20 || walkers[i].x > W + 20) walkers.splice(i, 1);
  g.save(); g.beginPath(); g.rect(sx0, gy - 40, sx1 - sx0, 48); g.clip();
  if (S.tour) drawBusPx(S.tour, gy, n);
  if (truck.x !== null) drawFireTruckPx(X(truck.x), gy);
  for (const w of walkers) {
    const frame = Math.floor(w.x / 6) % 4 & 3;
    g.drawImage(personSprite(w, 'side', frame, w.dir), X(w.x) - PERSON_W / 2, gy + 3 + Math.round(w.depth) - PERSON_H);
  }
  g.restore();
}

// ---------- Brandbilen ----------
// Bara grafik (som fotgängarna): bilen kör in från höger strax innan kåren är framme, står med blåljus vid
// hållplatsen (framför bussen, om den står där) så länge kåren är i huset och kör vidare åt vänster sedan.
const TRUCK_LEN = 112, TRUCK_PARK = BX1 + 12, TRUCK_V = 130;
const truck = { x: /** @type {number|null} */ (null) };
function truckTick(dt) {
  const F = S.fire;
  const want = !!(S.brigade || (F && (F.brigade || F.brigadeAt - S.t < 3.5)));
  const step = S.started && !S.paused ? TRUCK_V * dt * S.speed : 0;
  if (want) truck.x = truck.x === null || truck.x < TRUCK_PARK ? (truck.x === null ? BX1 + 440 : TRUCK_PARK) : Math.max(TRUCK_PARK, truck.x - step);
  else if (truck.x !== null) { truck.x -= step; if (truck.x < BX1 - TRUCK_LEN - 20) truck.x = null; }
}
function drawFireTruckPx(x, gy) {
  const w = Math.round(TRUCK_LEN / PX), h = 20, y = gy + 6 - h, on = Math.sin(S.anim * 11) > 0, parked = truck.x === TRUCK_PARK;
  // skåpet med rulljalusier och den vita randen, hytten fram (bilen kör åt vänster)
  box(x + 13, y + 2, w - 13, h - 5, '#c81e3a');
  R(x + 14, y + 11, w - 15, 2, '#ffffff');
  for (let jx = x + 16; jx + 2 < x + w - 2; jx += 3) R(jx, y + 13, 1, 2, '#a3172e'); // (jalusierna under randen)
  box(x, y + 5, 15, h - 8, '#c81e3a');
  R(x + 2, y + 7, 6, 5, '#9fd3ff'); R(x + 2, y + 7, 1, 5, '#ffffff'); R(x + 9, y + 7, 4, 5, '#9fd3ff');
  R(x + 1, y + h - 6, 2, 2, '#fff6a8');
  // stegen på taket (rest när kåren släcker utifrån – den ritas då för sig)
  if (!(parked && ladderUp())) { R(x + 16, y, w - 18, 1, '#cfd4da'); R(x + 16, y + 2, w - 18, 1, '#cfd4da'); for (let lx = x + 17; lx < x + w - 3; lx += 4) R(lx, y, 1, 3, '#9aa3ad'); }
  // blåljusen på hytten och baktill
  R(x + 3, y + 3, 4, 2, on ? '#3f7cff' : '#1b2a6e'); R(x + 9, y + 3, 4, 2, on ? '#1b2a6e' : '#3f7cff');
  R(x + w - 4, y + 1, 3, 2, on ? '#1b2a6e' : '#3f7cff');
  if (on && parked) { R(x + 1, y + 1, 8, 6, 'rgba(63,124,255,.25)'); }
  text(g, 'BRANDKÅREN', x + 13 + Math.round((w - 13) / 2), y + 4, '#ffffff', 'center');
  reserve(x + 13, y + 3, w - 13, 7); // (repliker och bubblor som ritas efter gatan lägger sig inte över skylten)
  for (const hx of [x + 4, x + 22, x + w - 12]) { R(hx, y + h - 6, 7, 5, INK); R(hx + 2, y + h - 4, 3, 1, '#7d786d'); }
}
/** släcker kåren utifrån (brandmännen hann inte upp i tid)? */
const ladderUp = () => !!(S.fire && S.fire.outAt !== null && !S.people.some(p => p.ff && !p.dead && p.state === 'office' && p.floor === S.fire.floor));
/** stegbilen: stegen rest mot brandvåningen och en vattenstråle in genom fasaden */
function drawTruckLadderPx(x, gy) {
  if (!ladderUp()) return;
  const F = S.fire, x0 = x + 30, y0 = gy - 14, x1 = X(towerX1At(floorY(F.floor))) + 2, y1 = Y(surf(F.floor)) - 14;
  if (Math.max(y0, y1) < 0 || Math.min(y0, y1) > lo.height) return;
  line(x0, y0, x1 + 2, y1, '#cfd4da'); line(x0 + 2, y0, x1 + 4, y1 + 1, '#9aa3ad');
  R(x1 + 1, y1 - 3, 4, 4, '#c81e3a');
  for (let i = 0; i < 8; i++) {
    const k = (S.anim * 1.8 + i / 8) % 1;
    R(x1 - Math.round(k * 14), y1 - 2 + Math.round(k * k * 6), 2, 1, k < 0.8 ? '#9fd3ff' : '#ffffff');
  }
}

/** Stadsturens buss (tour.js) vid hållplatsen: kör in från höger, står med öppen dörr medan gruppen är i huset
 *  och kör vidare åt vänster. Tutar den skakar den lite. */
function drawBusPx(T, gy, n) {
  const w = Math.round(BUS_LEN / PX), h = 21, x = X(T.x), y = gy + 4 - h;
  const standing = T.ph !== 'in' && T.ph !== 'out' && Math.abs(T.x - BUS_STOP_X) < 1;
  const shake = T.honked && T.ph === 'back' && Math.sin(S.anim * 30) > 0.6 ? 1 : 0;
  const y0 = y - shake, lit = S.power && n > 0.3;
  box(x, y0, w, h - 3, '#008080');
  R(x + 1, y0 + 1, w - 2, 1, light('#008080', 0.3));
  // vindrutan fram (bussen kör åt vänster), sidorutorna och dörren
  R(x + 1, y0 + 3, 4, 8, lit ? '#ffe9a8' : '#9fd3ff'); R(x + 1, y0 + 3, 1, 8, '#ffffff');
  for (let wx = x + 13; wx + 6 < x + w - 2; wx += 7) R(wx, y0 + 3, 6, 5, lit ? '#ffe9a8' : '#9fd3ff');
  R(x + 6, y0 + 3, 5, h - 7, standing ? '#1b1033' : '#5fb3c9');
  R(x + 6, y0 + 3, 5, 1, INK);
  // skylten längs sidan
  R(x + 12, y0 + 10, w - 14, 7, '#ffd23f');
  text(g, 'STADSTUREN', x + 12 + Math.round((w - 14) / 2), y0 + 11, INK, 'center');
  reserve(x + 12, y0 + 10, w - 14, 7); // (repliker och bubblor som ritas efter gatan lägger sig inte över skylten)
  // hjulen
  for (const hx of [x + 8, x + w - 13]) { R(hx, y0 + h - 5, 7, 5, INK); R(hx + 2, y0 + h - 3, 3, 1, '#7d786d'); }
  if (lit) R(x - 2, y0 + h - 8, 2, 2, '#fff6a8');
}

// ---------- Byggnaden ----------
// Tornet är indraget: under sky lobbyn har det full bredd (BX1), ovanför bara så brett som höga zonen
// behöver (UX1). Taket på den breda delen blir en terrass, och under expresshissarna går garagerampen.
const INSIDE_EL = EL.filter(e => !e.facade);
// (dubbeldäck: schaktet går en våning högre än nedre däckets översta stopp – topF)
/** (tar både hissen och dess data i EL) @param {{ id: number, minF: number }} e */
export const shaftTop = e => floorY(EL[e.id].topF + 1) + 4, shaftBot = e => floorY(e.minF) + 4;
export const BASE_Y = floorY(0) + 6, DECK_Y = floorY(TOP);
export const UX1 = TOWER_X1[TOP], SEAM_Y = floorY(SEAM_F);
 // tornets övre högerkant och terrassens golv
/** schaktkolumnerna (vänsterkant) med hissarna i varje – låg och hög zon kan dela kolumn */
const COLS = [...new Set(INSIDE_EL.map(e => shaftX(e.id)))].sort((a, b) => a - b).map(x => ({ x, els: INSIDE_EL.filter(e => shaftX(e.id) === x) }));
/** tornets högerkant i höjd med världens y */
const towerX1At = y => (y < SEAM_Y ? UX1 : BX1);
/** hissen ovanpå i samma schakt (staplade zoner), om någon @param {{ id: number, minF: number }} e */
export const stackedAbove = e => INSIDE_EL.find(o => o !== e && shaftX(o.id) === shaftX(e.id) && o.minF === EL[e.id].topF + 1);
/** rampen ner till garaget: kolumnerna under expresshissarna, där inget schakt går under entrén */
const RAMP_COLS = COLS.filter(c => c.els.every(e => e.minF >= LOBBY));
/** rampens nedersta våning (understa garaget – under det ligger stationen) */
const RAMP_F = Math.min(LOBBY, ...GARAGE_FLOORS);
function brickWall(x0, y0, x1, y1) {
  if (x1 <= x0 || y1 <= y0) return;
  R(x0, y0, x1 - x0, y1 - y0, PAL.brick);
  const start = y0 + ((6 - ((y0 + CY) % 7) + 7) % 7);
  for (let y = start; y < y1; y += 7) {
    R(x0, y, x1 - x0, 1, PAL.mortar);
    const off = Math.floor((y + CY) / 7) % 2 ? 6 : 0;
    for (let x = x0 + off; x < x1; x += 12) R(x, Math.max(y0, y - 6), 1, Math.min(6, y - y0), PAL.mortar);
  }
}
export function drawShell(h) {
  const ns = nightStep(h);
  layer('shell', `${ns}|${S.power}`, () => drawShellStatic(ns));
  drawRampCarsPx();
  drawDockTrucksPx();
}
// ---------- Lastkajen: leveransbilen och flyttbilen (life.js, visits.js) ----------
// Lastkajen ligger nere på P1, på vändplanet där rampen från gatan svänger. Bilen backar ner för rampen och
// ställer sig med bakdörrarna mot kajen (till vänster). Kajen har plats för en bil: står flyttbilen där väntar
// leveransbilen på gatan, och tvärtom. Allt här är grafik – läget kommer ur simuleringen.
const DOCK_DRIVE_S = 3;
 // (flyttbilen: så länge den syns köra ner för rampen eller upp igen)
/** en bil vid lastkajen: x = bilens vänsterkant (bakdörrarna), yb = golvet under hjulen; open = bakdörrarna öppna */
function dockTruck(x, yb, kind, open) {
  const flytt = kind === 'flytt', kupp = kind === 'kupp', body = flytt || kupp ? '#f4f1e8' : '#ffd23f', w = flytt ? 40 : 32, hgt = flytt ? 15 : 12;
  // skåpet (bak, till vänster) och hytten (fram, till höger)
  box(x, yb - hgt - 3, w - 9, hgt, body);
  box(x + w - 10, yb - 12, 10, 9, flytt ? '#ff8c42' : kupp ? '#5b6b3a' : '#d4a017'); R(x + w - 8, yb - 11, 6, 4, '#bfeaff');
  R(x + 1, yb - 5, w - 2, 2, INK);
  for (const wx of [x + 3, x + w - 8]) { R(wx, yb - 4, 5, 4, INK); R(wx + 1, yb - 3, 3, 2, '#5a5a5a'); }
  if (flytt) { R(x + 2, yb - hgt + 1, w - 13, 3, '#ff8c42'); text(g, 'FLYTT', x + (w - 9) / 2, yb - hgt + 5, '#ff8c42', 'center'); }
  else if (kupp) { R(x + 2, yb - hgt - 1, w - 13, 1, '#5b6b3a'); text(g, 'FASAD', x + (w - 9) / 2, yb - hgt + 2, '#5b6b3a', 'center'); } // (Fasad & Fönster AB, heist.js)
  else { R(x + 2, yb - hgt - 1, w - 13, 1, '#c81e3a'); text(g, 'PAKET', x + (w - 9) / 2, yb - hgt + 2, INK, 'center'); }
  // bakdörrarna står öppna mot kajen
  if (open) { R(x - 1, yb - hgt - 3, 2, hgt, INK); R(x - 3, yb - hgt - 2, 2, hgt - 2, dark(body, 0.25)); }
  return w;
}
/** bilens mitt i världen (för regissören i sidled): u = 0 på gatan, 1 parkerad vid kajen – samma väg som `at` nedan */
export function dockTruckX(u) {
  if (!RAMP_COLS.length) return null;
  const x0 = BX1 + 8, x1 = RAMP_COLS[0].x + 4; // (rx1 + 6 och rx0 + 3 låga pixlar i rampGeom)
  return x0 + (x1 - x0) * clamp(u, 0, 1) + 32;
}
function drawDockTrucksPx() {
  if (!RAMP_COLS.length || DOCK < 0) return;
  const { rx0, rx1, top, bot, yE, y1 } = rampGeom();
  if (top > lo.height || bot < 0) return;
  // från gatan (öppningen i fasaden) ner till vändplanet på P1 – u = 0 på gatan, 1 parkerad vid kajen
  const at = u => ({ x: Math.round(rx1 + 6 + (rx0 + 3 - (rx1 + 6)) * u), y: Math.round(yE + (y1 - yE) * u) });
  const draw = (u, kind, open) => {
    const p = at(clamp(u, 0, 1));
    g.save(); g.beginPath(); g.rect(rx0, top, X(BX1 + 7) - rx0 + 30, bot - top); g.clip();
    dockTruck(p.x, p.y, kind, open && u >= 1);
    if (u < 1 && Math.floor(S.anim * 4) % 2) R(p.x - 1, p.y - 7, 1, 2, '#ff5d52'); // (backljuset)
    g.restore();
  };
  // leveransbilen: x i simuleringen går från −260 (gatan) till 70 (vid kajen)
  const T = S.truck;
  if (T) draw((T.x + 260) / 330, 'paket', T.state === 'parked');
  // kuppen: skåpbilen från Fasad & Fönster AB (förvarningen: den backar in och blir stående med motorn igång)
  const Hs = S.heist, W = S.warn && S.warn.type === 'heist' ? S.warn : null;
  if (Hs && Hs.van !== 'gone') draw((Hs.vanX + 260) / 330, 'kupp', Hs.van === 'park');
  else if (W) draw(Math.min(1, (S.t - W.t0) / 4), 'kupp', false);
  // flyttbilen: står vid kajen medan flytten pågår (och kör ner/upp precis i början och slutet)
  const M = S.move;
  if (M && M.state === 'on') draw(Math.min(1, (S.t - M.t0) / DOCK_DRIVE_S), 'flytt', true);
  else if (M && M.state === 'done' && S.t - M.t1 < DOCK_DRIVE_S) draw(1 - (S.t - M.t1) / DOCK_DRIVE_S, 'flytt', false);
  // väntar på gatan (lastkajen är upptagen): utanför garageöppningen. Gatan har bara plats för en bil – är
  // turistbussen där, eller kör en annan bil in eller ut, kör flyttbilen ett varv runt kvarteret (syns inte)
  const street = S.tour || (T && T.state !== 'parked') || (Hs && Hs.van !== 'park' && Hs.van !== 'gone');
  if (M && M.state === 'planned' && M.dockWait > 0 && !street) dockTruck(rx1 + 10, yE, 'flytt', false);
}
function drawShellStatic(nn) {
  // huset: rumsdelen (under hallarna) och schakttornet i två block; kontur runt
  const x0 = X(LAND_X0 - 20), xs = X(SHAFT_X0 - 8), x1 = X(BX1 + 7), xu = X(UX1 + 7);
  const yd = Y(DECK_Y - 4), yr = Y(ROOF_Y - 4), ys = Y(SEAM_Y) - 2, yb = Y(BASE_Y);
  R(x0, yd, xs - x0, yb - yd, INK); R(xs, yr, xu - xs + 1, yb - yr, INK); R(xs, ys, x1 - xs + 1, yb - ys, INK);
  R(x0, yd + 2, xs - x0, yb - yd - 4, PAL.shell);
  R(xs + 2, yr + 2, xu - xs - 3, yb - yr - 4, PAL.shell); R(xs + 2, ys + 2, x1 - xs - 3, yb - ys - 4, PAL.shell);
  // tegel runt schakten
  const wx0 = X(SHAFT_X0 - 5), wy0 = Y(ROOF_Y + 4), wy1 = Y(BASE_Y - 6);
  brickWall(wx0, wy0, X(UX1 - 4), ys + 4); brickWall(wx0, ys + 4, X(BX1 - 4), wy1);
  // fasad med fönster där inget schakt går (men bara där huset finns på den våningen)
  for (const c of COLS) {
    const x = X(c.x);
    for (let f = 0; f < FLOORS; f++) {
      if (c.els.some(e => f >= e.minF && f <= e.topF + 1) || c.x + SHAFT_W > TOWER_X1[f]) continue;
      const top = Y(floorY(f + 1) + 6), bot = Y(floorY(f) - 6);
      if (bot < 0 || top > lo.height) continue;
      if (f < LOBBY) { if (!RAMP_COLS.includes(c) || f < RAMP_F) R(x - 2, top - 1, SHAFT_W / PX + 4, bot - top + 2, PAL.basement); continue; }
      const nw = Math.floor((SHAFT_W - 6) / 32);
      for (let k = 0; k < nw; k++) {
        const wx = x + Math.round(((SHAFT_W - nw * 32 + 6) / 2 + k * 32) / PX), wy = top + 11;
        const lit = nn > 0.2 && S.power && ((f * 7 + c.x * 3 + k * 5) % 5) < 2;
        box(wx, wy, 13, 20, lit ? PAL.lit : blend(PAL.glass, PAL.glassNight, nn));
        R(wx + 6, wy + 1, 1, 18, INK); R(wx + 1, wy + 9, 11, 1, INK);
        R(wx + 2, wy + 2, 1, 6, 'rgba(255,255,255,.5)');
      }
    }
  }
  drawRampPx();
  towerFacade();
  // schakten
  for (const e of INSIDE_EL) {
    const x = X(shaftX(e.id)), t = Y(shaftTop(e)), b = Y(shaftBot(e)), w = SHAFT_W / PX;
    R(x - 2, t, w + 5, b - t, PAL.shaftOuter); R(x, t, w, b - t, PAL.shaft);
    R(x + 1, t, 2, b - t, PAL.rail); R(x + w - 3, t, 2, b - t, PAL.rail);
    for (let y = t + ((-CY % 8) + 8) % 8; y < b; y += 8) { R(x + 1, y, 2, 1, PAL.railDot); R(x + w - 3, y, 2, 1, PAL.railDot); }
    if (e.express) for (let f = e.minF + 1; f < e.maxF; f++) {
      if (EL[e.id].serves.includes(f)) continue; // där dörrarna finns står ingen text g.globalAlpha = 0.45; text(g, 'EXPRESS', x + w / 2, Y(floorY(f) - FLOOR_H / 2) - 3, PAL.express, 'center'); g.globalAlpha = 1;
    }
  }
  // staplade zoner: ett mellanbjälklag med maskin där låga zonens schakt slutar och höga zonens börjar
  for (const e of INSIDE_EL) {
    if (!stackedAbove(e)) continue;
    const x = X(shaftX(e.id)), y = Y(shaftTop(e)), w = SHAFT_W / PX;
    R(x - 2, y - 1, w + 5, 4, INK); R(x - 1, y, w + 3, 2, PAL.slab);
    for (let k = 4; k < w - 4; k += 6) R(x + k, y, 3, 1, '#ffe14d');
  }
  // panoramahissens skenor och gångbryggor (bryggorna når tornet, även över terrassen)
  for (const e of EL.filter(e => e.facade)) {
    const x = X(shaftX(e.id)), t = Y(shaftTop(e) - 8), b = Y(shaftBot(e)), w = SHAFT_W / PX;
    // under gatan: röret går ner genom trottoaren i ett utgrävt schakt till tunnelbanans tunnel
    if (EL[e.id].minF < LOBBY) {
      const gy = Y(GROUND_Y) + 7;
      R(x - 3, gy, w + 6, b - gy + 2, INK); R(x - 2, gy, w + 4, b - gy + 1, '#2a2620');
      for (let y = gy + 4; y < b; y += 9) { R(x - 2, y, 2, 1, '#4a4338'); R(x + w, y + 4, 2, 1, '#4a4338'); } // (spontväggen)
      // ledningarna och avloppsröret går igenom röret i tätade genomföringar
      for (const [yy, hh] of [[GROUND_Y + 21, 7], [GROUND_Y + 43, 11]]) for (const cx of [x - 4, x + w + 1]) { R(cx, Y(yy) - 1, 3, hh, INK); R(cx + 1, Y(yy), 1, hh - 2, '#a8a395'); }
      R(x - 3, b, w + 6, 2, INK); R(x - 2, b, w + 4, 1, '#8a909a'); // (golvet i botten av röret)
      // skylten vid perrongen: härifrån går det rakt upp till taket
      const sy = Y(floorY(EL[e.id].minF) - 4) - 46, sw = textW('TILL TAKET') + 6;
      box(x - sw - 2, sy, sw, 9, '#93379e'); text(g, 'TILL TAKET', x - sw / 2 - 2, sy + 2, '#ffffff', 'center');
      R(x - sw / 2 - 3, sy - 6, 3, 5, '#ffd23f'); R(x - sw / 2 - 4, sy - 5, 5, 1, '#ffd23f'); // (en pil uppåt)
    }
    // panoramahissens bana: ett glasrör med stålprofiler vid varje våning, som en del av fasaden
    R(x + 3, t, w - 6, b - t, 'rgba(191,234,255,.22)');
    for (let f = 0; f <= FLOORS; f++) {
      const y = Y(floorY(f));
      if (y <= t || y >= b) continue;
      R(x + 2, y - 1, w - 4, 2, INK); R(x + 2, y - 1, w - 4, 1, PAL.steel);
      line(x + 6, y - 4, x + 14, y - 22, 'rgba(255,255,255,.35)'); // reflexer i glaset
      line(x + 10, y - 4, x + 16, y - 16, 'rgba(255,255,255,.25)');
      // konsol in mot fasaden
      const fx = X(towerX1At(floorY(f) - 1) + 7);
      if (fx < x && (f % 2 === 0 || x - fx < 20)) { R(fx, y - 2, x - fx + 2, 3, INK); R(fx, y - 1, x - fx + 2, 1, PAL.steel); }
    }
    for (const rx of [x + 2, x + w - 4]) { R(rx - 1, t, 4, b - t, INK); R(rx, t, 2, b - t, PAL.steel); }
    // glastakets kupol överst
    R(x + 1, t - 2, w - 2, 3, INK); R(x + 2, t - 1, w - 4, 1, PAL.steel);
    for (const f of e.serves) { const y = Y(floorY(f) - 4), bx = X(TOWER_X1[f] + 7); box(bx, y - 2, x - bx + 1, 4, PAL.steel); }
  }
}
/** Tornets utsida: en ljus hörnpilaster längs högerkanten och gesimser som sticker ut vid varje bjälklag,
 *  så att huset läses som en byggnad även där schakten syns. */
function towerFacade() {
  const slabCol = '#c9c3b3', shade = '#8a8475';
  for (let f = LOBBY; f < FLOORS; f++) {
    const ex = X(TOWER_X1[f] + 7), yt = Y(floorY(f + 1)), yb = Y(floorY(f));
    // pilastern: ljus kant med skugga
    R(ex - 4, yt, 3, yb - yt, slabCol); R(ex - 2, yt, 1, yb - yt, shade);
    // gesims
    R(ex - 5, yb - 3, 8, 4, INK); R(ex - 4, yb - 2, 6, 2, slabCol); R(ex - 4, yb - 2, 6, 1, '#ffffff');
  }
  // terrassens kant (där tornet blir smalt) får en egen gesims
  if (UX1 < BX1) { const ys = Y(SEAM_Y); R(X(UX1 + 7) - 1, ys - 4, X(BX1 + 7) - X(UX1 + 7) + 4, 4, INK); R(X(UX1 + 7), ys - 3, X(BX1 + 7) - X(UX1 + 7) + 2, 2, slabCol); }
}
/** garagerampen under expresshissarna: in från gatan och i två svängar ner till P1 och P2 */
/** rampens mått i ritytan */
function rampGeom() {
  return { rx0: X(RAMP_COLS[0].x - 2), rx1: X(BX1 - 4), top: Y(GROUND_Y + 8), bot: Y(floorY(RAMP_F) - 2),
    yE: Y(GROUND_Y) + 2, y1: Y(surf(LOBBY - 1)), y0: Y(surf(LOBBY - 2)) };
}
function drawRampPx() {
  if (!RAMP_COLS.length) return;
  const { rx0, rx1, top, bot, yE, y1, y0 } = rampGeom();
  if (top > lo.height || bot < 0) return;
  R(rx0, top, rx1 - rx0, bot - top, PAL.basement);
  // bakväggens betongpelare
  for (let x = rx0 + 6; x < rx1 - 4; x += 28) R(x, top, 4, bot - top, dark(PAL.basement, 0.12));
  // ramperna: gatan → P1 (åt vänster) och P1 → P2 (åt höger)
  const band = (xa, ya, xb, yb) => {
    const n = Math.abs(xb - xa);
    for (let i = 0; i <= n; i++) {
      const xx = xa + Math.sign(xb - xa) * i, yy = Math.round(ya + (yb - ya) * (i / n));
      R(xx, yy, 1, 4, '#8c877c'); R(xx, yy, 1, 1, '#b8b2a5'); R(xx, yy + 4, 1, 1, INK);
      if ((xx + 2) % 6 < 3) R(xx, yy + 2, 1, 1, '#ffe14d');
    }
  };
  if (LOBBY >= 1) band(rx1 - 1, yE, rx0 + 18, y1 - 4);
  if (LOBBY >= 2) { R(rx0 + 2, y1 - 4, 18, 4, '#8c877c'); band(rx0 + 18, y1 - 4 + 0, rx1 - 1, y0 - 4); }
  // öppningen i fasaden mot gatan, med skylt
  R(rx1, yE - 1, X(BX1 + 7) - rx1 + 1, Y(GROUND_Y + 40) - yE, '#2b2f36');
  pill(rx1 - 34, top + 2, 30, 9, PAL.sign); text(g, 'GARAGE', rx1 - 19, top + 3, '#ffffff', 'center');
}
/** bilar som är på väg in eller ut åker på rampen (bara grafik – ritas varje bildruta ovanpå lagret) */
function drawRampCarsPx() {
  if (!RAMP_COLS.length) return;
  const { rx0, rx1, top, bot, yE, y1, y0 } = rampGeom();
  if (top > lo.height || bot < 0) return;
  const moving = (S.autos || []).filter(a => a.state === 'in' || a.state === 'out');
  moving.slice(0, 2).forEach(a => {
    // t = 0 vid gatan, 1 längst ner – följer bilens färd i simuleringen (in: −140 → plats, ut: plats → −170)
    const t = a.state === 'in' ? clamp((a.x + 140) / (a.slot + 140), 0, 1) : 1 - clamp((a.slot - a.x) / (a.slot + 170), 0, 1);
    const onFirst = t < 0.5 || LOBBY < 2, u = onFirst ? t * 2 : (t - 0.5) * 2;
    const xa = onFirst ? rx1 - 1 : rx0 + 18, xb = onFirst ? rx0 + 18 : rx1 - 1;
    const ya = onFirst ? yE : y1 - 4, yb = onFirst ? y1 - 4 : y0 - 4;
    const cx = Math.round(xa + (xb - xa) * u), cy = Math.round(ya + (yb - ya) * u);
    box(cx - 8, cy - 6, 17, 6, a.color); R(cx - 5, cy - 9, 10, 4, INK); R(cx - 4, cy - 8, 8, 3, '#bfeaff');
    R(cx - 6, cy - 1, 3, 2, INK); R(cx + 4, cy - 1, 3, 2, INK);
  });
}
/** takterrassen ovanpå den breda delen av tornet (taket på sky lobbyn) */
export function drawTerracePx(h) {
  if (UX1 >= BX1) return;
  const x0 = X(UX1 + 7), x1 = X(BX1 + 7), y = Y(SEAM_Y) - 2;
  if (y < -40 || y > lo.height + 10) return;
  R(x0, y - 2, x1 - x0, 2, '#94a3b8'); for (let x = x0; x < x1; x += 6) R(x, y - 2, 1, 2, '#7a889e');
  // räcke
  R(x0 + 1, y - 16, x1 - x0 - 2, 1, INK);
  for (let x = x0 + 3; x < x1 - 1; x += 10) R(x, y - 16, 1, 14, INK);
  // krukväxter, parasoll och bänkar i luckorna mellan expresshissarnas maskinhus
  const houses = INSIDE_EL.filter(e => e.maxF < TOP && !stackedAbove(e) && shaftX(e.id) >= UX1).map(e => X(shaftCX(e.id))).sort((p, q) => p - q);
  const gaps = [], cols = ['#389a5c', '#2f7d4a', '#4caf6a'];
  let from = x0 + 2;
  for (const hx of houses) { gaps.push([from, hx - 13]); from = hx + 14; }
  gaps.push([from, x1 - 2]);
  const plant = (x, i) => {
    box(x, y - 9, 9, 7, '#a65e3a'); R(x + 1, y - 9, 7, 1, '#c27a54');
    for (let k = 0; k < 4; k++) R(x - 1 + k * 3, y - 15 + (k % 2) * 2, 4, 6, cols[(k + i) % 3]);
    R(x + 3, y - 18, 3, 3, cols[(i + 1) % 3]);
  };
  gaps.forEach(([ga, gb], i) => {
    const w = gb - ga;
    if (w >= 30) {
      const mx = Math.round((ga + gb) / 2);
      R(mx, y - 26, 1, 24, INK);
      box(mx - 10, y - 30, 21, 5, i % 2 ? '#d4a017' : '#bd6659'); R(mx - 9, y - 30, 19, 1, '#ffffff');
      box(mx - 8, y - 7, 17, 3, '#8a6a46'); R(mx - 7, y - 4, 1, 2, INK); R(mx + 7, y - 4, 1, 2, INK);
      if (w >= 44) { plant(ga + 1, i); plant(gb - 10, i + 1); }
    } else if (w >= 10) plant(Math.round((ga + gb) / 2) - 4, i);
  });
  const n = nightness(h);
  if (n > 0.3 && S.power) for (let x = x0 + 6; x < x1 - 4; x += 20) R(x, y - 18, 2, 2, '#ffe14d');
}
export function drawSlabsPx() {
  for (let f = 0; f <= FLOORS; f++) {
    const y = Y(floorY(f)) - 2;
    if (y < -4 || y > lo.height + 4) continue;
    const holes = INSIDE_EL.filter(e => e.minF < f && f <= e.topF).map(e => [shaftX(e.id), shaftX(e.id) + SHAFT_W]).sort((a, b) => a[0] - b[0]);
    // bjälklaget når ut till tornets kant: den bredaste av våningarna över och under
    const edge = Math.max(f < FLOORS ? TOWER_X1[f] : 0, f > 0 ? TOWER_X1[f - 1] : 0);
    let a = f === FLOORS ? SHAFT_X0 - 8 : LAND_X0 - 20;
    const segs = [];
    for (const [h0, h1] of holes) { if (h0 > a) segs.push([a, h0]); a = Math.max(a, h1); }
    segs.push([a, edge + 7]);
    for (const [s0, s1] of segs) { const x = X(s0), w = X(s1) - x; R(x, y, w, 4, INK); R(x, y + 1, w, 2, PAL.slab); R(x, y + 1, w, 1, PAL.slabHi); }
  }
  // dörrkarmar vid varje hållplats
  for (const e of INSIDE_EL) for (const f of e.serves) {
    const x = X(shaftX(e.id)) + 1, y = Y(surf(f) - CAR_H - 3), w = SHAFT_W / PX - 2, h = Math.round((CAR_H + 3) / PX);
    if (y > lo.height || y + h < 0) continue;
    R(x, y, w, 1, PAL.frame); R(x, y, 1, h, PAL.frame); R(x + w - 1, y, 1, h, PAL.frame);
  }
}
/** våningsdisplayerna sitter på hallväggen framför schakten: ritas efter linorna (som annars skymmer dem) men före korgarna */
export function drawLanternsPx() {
  drawLandingDoorsPx();
  for (const e of S.elevators) for (const f of e.serves) lantern(e, f);
}
/** Landningsdörrarna: stängda skjutdörrar vid varje hållplats, så att schakten ser ut som en vägg med
 *  dörrar. Korgen ritas ovanpå, och när den står inne syns dess egna dörrar glida upp. */
function drawLandingDoorsPx() {
  // på kvällen mörknar dörrarna med hallen
  const k = nightness(hour()) * 0.5, nt = c => (k > 0.02 ? blend(c, '#1e2440', k) : c);
  const C0 = nt('#8a909a'), C1 = nt('#a7adb6'), C2 = nt('#c8ccd2'), C3 = nt('#959ba5'), C4 = nt('#5b6370');
  for (const e of INSIDE_EL) for (const f of e.serves) {
    const x = X(shaftX(e.id)) + 2, w = SHAFT_W / PX - 4, yb = Y(surf(f)), h = Math.round(CAR_H / PX) - 1, y = yb - h;
    if (y > lo.height || yb < 0) continue;
    const half = w >> 1;
    R(x, y, w, h, C0);
    for (const dx of [0, half]) {
      R(x + dx + 1, y + 1, half - 2, h - 2, C1);
      R(x + dx + 1, y + 1, half - 2, 1, C2); R(x + dx + 1, y + 1, 1, h - 2, C2);
      R(x + dx + 1, y + h - 6, half - 2, 5, C3);
    }
    R(x + half - 1, y, 2, h, C4);
  }
}
/** Våningsdisplay ovanför hissdörren. KNAPPAR: riktning, korgens våning och hallknapparna ▲/▼.
 *  Destinationsstyrning (övriga lägen): det finns inga hallknappar – displayen är bredare och visar i stället
 *  vilka våningar hissen ska till med dem som väntar här (som "5 8 12" i verkliga hus). @param {Elevator} e */
function lantern(e, f) {
  const buttons = buttonsMode(), w = buttons ? 31 : 45;
  const x = X(shaftCX(e.id)) - Math.floor(w / 2), y = Y(floorY(f) - 108);
  if (y < -14 || y > lo.height) return;
  box(x, y, w, 11, PAL.lantern);
  if (!(S.power || (S.outage && S.outage.gen))) return;
  // dubbeldäck: displayen på övre däckets våningar visar var övre däcket är
  const cp = carPos(e.id, f), up = f - cp;
  const here = Math.abs(e.pos - cp) < 0.05 && e.state === 'doors';
  // displayen tänds bara där något händer (korgen är nära, någon väntar här, eller den ska stanna här);
  // på resten av våningarna är den släckt – annars upprepas samma siffra i hela schaktet
  const waiting = buttons ? (hallLit(e.group, f, 1) || hallLit(e.group, f, -1)) : destsAt(e, f).length > 0;
  if (!here && !waiting && Math.abs(e.pos - cp) > 1.5 && !e.carCalls.has(cp) && !assignedTo(e, cp, 1) && !assignedTo(e, cp, -1)) {
    R(x + w / 2 - 1, y + 5, 3, 1, PAL.dim);
    return;
  }
  reserve(x, y, w, 11); // (en tänd display: repliker och tankebubblor lägger sig inte över siffrorna)
  const col = here ? '#7dff9a' : PAL.led;
  led(g, fl(Math.round(e.pos) + up), x + 14, y + 2, col, 'center');
  if (e.dir && (e.state === 'moving' || here)) led(g, e.dir > 0 ? '▲' : '▼', x + 2, y + 2, col);
  if (!buttons) {
    R(x + 24, y + 2, 1, 7, PAL.dim);
    const dests = destsAt(e, f);
    if (!dests.length) { R(x + 27, y + 5, 2, 1, PAL.dim); return; }
    // så många mål som får plats, resten som "+"
    let s = '';
    for (const d of dests) { const t = s ? `${s} ${fl(d)}` : fl(d); if (textW(t) > w - 29) { s += '+'; break; } s = t; }
    text(g, s, x + 27, y + 3, here ? '#7dff9a' : '#ffffff');
    return;
  }
  // hallknapparna: i KNAPPAR-läget lyser gruppens gemensamma knapp
  for (const d of [1, -1]) {
    if (d === 1 && cp >= e.maxF || d === -1 && cp <= e.minF) continue;
    const lit = hallLit(e.group, f, d);
    const lx = x + w - 6, ly = y + (d > 0 ? 2 : 6);
    const c = lit ? '#ffe14d' : PAL.dim;
    if (d > 0) { R(lx + 2, ly, 1, 1, c); R(lx + 1, ly + 1, 3, 1, c); R(lx, ly + 2, 5, 1, c); }
    else { R(lx, ly, 5, 1, c); R(lx + 1, ly + 1, 3, 1, c); R(lx + 2, ly + 2, 1, 1, c); }
  }
}
/** målvåningarna för dem som väntar på våning f och har fått hissen e (i färdriktningen, närmast först) @param {Elevator} e */
function destsAt(e, f) {
  const set = new Set();
  for (const p of S.people) if (p.floor === f && p.assigned === e.id && (p.state === 'wait' || p.state === 'boarding')) set.add(p.dest);
  return [...set].sort((a, b) => Math.abs(a - f) - Math.abs(b - f) || a - b);
}
/** Destinationsterminalen vid korridoren: man slår in våningen och skärmen visar vilken hiss man ska ta.
 *  Bara i lägen med destinationsstyrning (inte KNAPPAR). Ren grafik ur p.assigned/p.waitStart. */
export function terminal(f) {
  if (buttonsMode() || !S.elevators.some(e => e.serves.has(f))) return;
  // mellan skylten med antalet inne och entréns däckskylt
  const bot = Y(floorY(f) - 4), x = X(DOOR_X) + 30, y = bot - 18;
  if (y > lo.height || bot < 0) return;
  reserve(x, y, 11, bot - y);
  // fot och stolpe
  R(x + 1, bot - 4, 9, 1, INK); R(x + 2, bot - 5, 7, 1, '#6b7280');
  R(x + 4, y + 8, 3, bot - 5 - (y + 8), INK); R(x + 5, y + 8, 1, bot - 5 - (y + 8), '#9aa3ad');
  // huvudet med skärmen
  box(x, y, 11, 9, PAL.panel); R(x + 1, y + 1, 9, 1, '#ffffff');
  const on = S.power || (S.outage && S.outage.gen);
  R(x + 1, y + 2, 9, 6, on ? '#0b1a10' : '#15171c');
  if (!on) return;
  if (S.fire && S.fire.mode !== 'none') { if (Math.sin(S.anim * 8) > 0) text(g, '!', x + 5, y + 2, '#ff2d55', 'center'); return; }
  // senaste tilldelningen på våningen (inom ett par sekunder): hissens namn i hissens färg
  let best = null;
  for (const p of S.people) {
    if (p.floor !== f || p.assigned === null || keyed(p) || (p.state !== 'wait' && p.state !== 'boarding')) continue;
    if (S.t - p.waitStart < 2.5 && (!best || p.waitStart > best.waitStart)) best = p;
  }
  if (best) { const e = S.elevators[best.assigned]; text(g, e.name, x + 5, y + 2, light(e.color, 0.25), 'center'); }
  else if (Math.floor(S.anim * 2) % 2) R(x + 2, y + 6, 2, 1, '#7dff9a'); // blinkande markör: väntar på nästa
}
