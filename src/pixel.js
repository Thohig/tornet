// Pixelgrafik (16-bit): hela bilden i den förenklade vyn, ritad på ett rutnät i låg upplösning
// som sedan skalas upp utan utjämning. Samma världskoordinater som den tecknade grafiken – bara
// avrundade till rutor om PX världsenheter – så klick, kamera och spårning fungerar som vanligt.
// Bara grafik: läser simuleringens tillstånd men ändrar det aldrig (utom S.fx-listan, som den
// tecknade grafiken också räknar ner).
import { ARR, clamp, fl } from './util.js';
import { BREAK, BX1, CAR_H, CAR_W, CONTROL, EL, FL, FLOORS, FLOOR_H, FLOOR_HOURS, FULL_LOAD, GARAGE_FLOORS, HATCH_FLOORS, GROUND_Y, H, INNER_X1, LAND_X0, DOOR_X, DOCK, LOBBY, MEZZ, ROOF_Y, SEAM_F, SHAFT_W, SHAFT_X0, STATION, TOP, TOWER_X1, TRAIN_LEN, TRAIN_X0, TRAIN_X1, W, SPOTS, carPos, floorOpen, floorY, shaftCX, shaftX, surf } from './config.js';
import { exposure, windAt } from './weather.js';
import { CALL_REPLY, WARM_AT, nextOut, techOf } from './service.js';
import { HOIST_OK, PARK_Y, TERRACE_Y, cleanerAt } from './hoist.js';
import { S, hour } from './state.js';
import { allowed, assignedTo, cabinKg, keyed } from './dispatch.js';
import { noteDetail, stateInfo } from './describe.js';
import { VIEW, clouds, ctx, cv, nightness, skyAt, skyline, stars } from './view.js';
import { carSlot, carSlotX, inWindow, landPos, peopleBehindDoor, personHead, winPos } from './render.js';
import { vpick, vrand } from './rng.js';
import { PX, blend, dark, light, ellipseSprite, fromCells, sprite, text, textW, plain, rgbOf, led } from './pixart.js';
import { buttonsMode, hallLit } from './buttons.js';
import { TRAIN_DOORS, nextTrainMin, trainDoors } from './train.js';
import { PERSON_H, PERSON_W, cargoSprite, personSprite } from './pixpeople.js';
import { PAL } from './pixpal.js';
import { CHIEFS, alarm, chiefOnDuty, chiefPerson } from './chief.js';
import { CREW_BY } from './crew.js';
import { RAISE_T, RIG_T, ROPE_DX, riderPos } from './pano.js';
import { HAIR_NAT, PANTS, SHIRT, SKIN } from './people.js';

const INK = PAL.ink;

// ---------- Ritytan i låg upplösning ----------
const LO = document.createElement('canvas');
const G = /** @type {CanvasRenderingContext2D} */ (LO.getContext('2d'));
// lo/g är ritytan som ritfunktionerna skriver till just nu: bilden, eller ett statiskt lager (se layer)
let lo = LO, g = G;
let X0 = 0, CY = 0;
/** världens x/y → pixel i ritytan */
const X = x => Math.round((x - X0) / PX);
const Y = y => Math.round(y / PX) - CY;
/** så länge det tar för våningarna att tändas igen efter ett strömavbrott (s) */
const RELIGHT_S = 2.4;
const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
// ---------- Statiska lager ----------
// Det som nästan aldrig ändras (stadssiluetten, tegel, fasadfönster, schakt, garagerampen) ritas en gång
// i ett eget lager som täcker hela världens höjd, och kopieras sedan in varje bildruta. Lagret ritas om
// bara när nyckeln ändras (natten i 32 steg, strömmen, bredden). Ritfunktionerna är desamma: medan
// lagret ritas pekar lo/g på lagret och CY är 0, så Y() ger världens y i lagret.
/** @type {Map<string, { c: HTMLCanvasElement, g: CanvasRenderingContext2D, key: string }>} */
const layers = new Map();
function layer(name, key, draw) {
  let L = layers.get(name);
  const full = `${key}|${LO.width}|${X0}`;
  if (!L || L.key !== full) {
    if (!L) { const c = document.createElement('canvas'); L = { c, g: /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), key: '' }; layers.set(name, L); }
    L.c.width = LO.width; L.c.height = Math.ceil(H / PX) + 4; // (att sätta storleken tömmer lagret)
    L.key = full;
    const kLo = lo, kG = g, kCY = CY;
    lo = L.c; g = L.g; CY = 0; g.imageSmoothingEnabled = false;
    try { draw(); } finally { lo = kLo; g = kG; CY = kCY; }
  }
  // bara den synliga biten kopieras
  const sy = clamp(CY, 0, L.c.height), sh = Math.min(LO.height, L.c.height - sy);
  if (sh > 0) G.drawImage(L.c, 0, sy, L.c.width, sh, 0, sy - CY, L.c.width, sh);
}
/** nattfaktorn i 32 steg (för lagrens nycklar – skillnaden syns inte i pixelgrafiken) */
const nightStep = h => Math.round(nightness(h) * 32) / 32;
/** ruta med kontur */
function box(x, y, w, h, fill, outline = INK) { R(x, y, w, h, outline); R(x + 1, y + 1, w - 2, h - 2, fill); }
/** ruta med kontur och "fasade" hörn (pixelkonstens rundade hörn) */
function pill(x, y, w, h, fill, outline = INK) {
  R(x + 1, y, w - 2, h, outline); R(x, y + 1, w, h - 2, outline);
  R(x + 1, y + 1, w - 2, h - 2, fill);
}
/** marscherande myror runt en ruta (spårning, följ) */
function ants(x, y, w, h, c, speed = 8) {
  const ph = Math.floor(S.anim * speed);
  g.fillStyle = c;
  const per = 2 * (w + h);
  for (let i = 0; i < per; i++) {
    if (((i + ph) >> 1) % 2) continue;
    let px, py;
    if (i < w) { px = x + i; py = y; } else if (i < w + h) { px = x + w - 1; py = y + i - w; }
    else if (i < 2 * w + h) { px = x + w - 1 - (i - w - h); py = y + h - 1; } else { px = x; py = y + h - 1 - (i - 2 * w - h); }
    g.fillRect(px, py, 1, 1);
  }
}
/** linje pixel för pixel (Bresenham) */
function line(x0, y0, x1, y1, c) {
  g.fillStyle = c;
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (let n = 0; n < 2000; n++) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/** liten etikett med kontur: text i ruta */
function label(str, cx, y, fill = '#ffffff', color = INK, align = 'center') {
  const s = plain(str); if (!s) return 0;
  const w = textW(s) + 5;
  const x = align === 'center' ? Math.round(cx - w / 2) : align === 'right' ? cx - w : cx;
  pill(x, y, w, 9, fill);
  text(g, s, x + 3, y + 1, color);
  return w;
}

// ---------- Platsbokning för skyltar och bubblor ----------
// Varje bildruta bokar skyltarna i hallen först (våningsnamn, trappa, räknare …), sedan bubblorna en i
// taget. En bubbla som krockar flyttas uppåt/nedåt till närmaste lediga plats – eller ritas inte alls
// om den bara är utfyllnad (repliker från rummen, grupperade tankebubblor).
/** @type {{x:number,y:number,w:number,h:number}[]} */
let taken = [];
const hits = (x, y, w, h) => taken.some(r => x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h);
function reserve(x, y, w, h) { taken.push({ x, y, w, h }); }
/** närmaste lediga y för rutan (bokas), eller null om allt är upptaget */
function place(x, y, w, h, steps = [0, -11, 11, -22]) {
  for (const d of steps) if (!hits(x, y + d, w, h)) { reserve(x, y + d, w, h); return y + d; }
  return null;
}

// ---------- Figurer som byggs en gång ----------
const memo = new Map();
const once = (key, fn) => { let v = memo.get(key); if (!v) { v = fn(); memo.set(key, v); } return v; };
/** stjärnan med våningsnumret */
function starSprite(c) {
  return once('star' + c, () => {
    const r1 = 9.5, r0 = 5, n = 19, cells = [];
    const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? r0 : r1; pts.push([9 + Math.cos(a) * r, 9.5 + Math.sin(a) * r]); }
    const inside = (x, y) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
    for (let y = 0; y < n; y++) { const row = []; for (let x = 0; x < n; x++) row.push(inside(x + 0.5, y + 0.5) ? (y < 6 ? light(c, 0.25) : c) : null); cells.push(row); }
    return fromCells(cells, n, n, 1, INK);
  });
}
const SUN = () => once('sun', () => {
  const cells = [], n = 15, c = 7;
  for (let y = 0; y < n; y++) { const row = []; for (let x = 0; x < n; x++) { const d = Math.hypot(x - c, y - c); row.push(d <= 7.2 ? (y === 6 && (x >= 3 && x <= 6 || x >= 8 && x <= 11) ? INK : y === 7 && (x === 7) ? INK : y === 10 && x >= 5 && x <= 9 ? INK : y === 9 && (x === 4 || x === 10) ? INK : d > 5.6 ? '#ffb627' : '#ffe14d') : null); } cells.push(row); }
  return fromCells(cells, n, n, 1, INK);
});
const MOON = () => once('moon', () => {
  const cells = [], n = 20;
  for (let y = 0; y < n; y++) { const row = []; for (let x = 0; x < n; x++) row.push(Math.hypot(x - 9.5, y - 9.5) <= 9.5 && Math.hypot(x - 14, y - 6) > 8 ? (x < 6 ? '#fff6c9' : '#efe2a0') : null); cells.push(row); }
  return fromCells(cells, n, n, 1, INK);
});
function cloudSprite(s) {
  return once('cloud' + s.toFixed(2), () => {
    const parts = [[0, 0, 18], [18, -8, 20], [36, 0, 16], [16, 6, 16]].map(([x, y, r]) => [(x + 20) * s / PX, (y + 30) * s / PX, r * s / PX]);
    const w = Math.ceil(76 * s / PX), h = Math.ceil(56 * s / PX), cells = [];
    for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) { const inside = parts.some(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r); row.push(inside ? (y > h * 0.62 ? '#dfe7f5' : '#ffffff') : null); } cells.push(row); }
    return fromCells(cells, w, h, 1, INK);
  });
}
/** linhjul i maskinrummet – ekrarna i några vridningslägen */
function wheelSprite(color, k) {
  return once(`wheel${color}${k}`, () => {
    const n = 15, c = 7, cells = [];
    const a0 = (k / 6) * (Math.PI / 3);
    for (let y = 0; y < n; y++) {
      const row = [];
      for (let x = 0; x < n; x++) {
        const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
        if (d > 7.2) { row.push(null); continue; }
        if (d <= 2) { row.push(color); continue; }
        if (d > 5.8) { row.push(PAL.wheelRim); continue; }
        const a = Math.atan2(dy, dx);
        const spoke = [0, 1, 2].some(i => { const da = Math.abs(((a - a0 - i * Math.PI / 3) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2); return da * d < 0.8; });
        row.push(spoke ? INK : PAL.wheelIn);
      }
      cells.push(row);
    }
    return fromCells(cells, n, n, 1, INK);
  });
}
const FLAMES = () => once('flames', () => [
  ['....R.....', '...RR.....', '...RRR..R.', '..RROR.RR.', '..ROORRRR.', '.RROYORRR.', '.ROOYYOOR.', 'RROYYYYORR', 'ROOYYYYOOR', 'ROOYYYYOOR', '.ROOYYOOR.', '..RROORR..'],
  ['.....R....', '....RR..R.', '..R.RRR.R.', '..RRROR.RR', '.RRORRORR.', '.ROOYOORR.', 'RROOYYOORR', 'ROOYYYYOOR', 'ROOYYYYOOR', 'ROOYYYYOOR', '.ROOYYOOR.', '..RROORR..'],
  ['...R......', '...RR.R...', '.R.RRRRR..', '.RRRORRR..', '.RROORORR.', 'RROOYYORR.', 'ROOYYYOORR', 'ROOYYYYOOR', 'ROOYYYYOOR', 'ROOYYYYOOR', '.ROOYYOOR.', '..RROORR..'],
].map(r => sprite(r, { R: '#ff4b1f', O: '#ff9f1c', Y: '#ffe14d' })));
const PUFF = r => once('puff' + r, () => ellipseSprite(r * 2, r * 2, '#5a5068', null, '#4a4058'));
const ARROW = () => once('arrow', () => sprite(['.YYY.', '.YYY.', '.YYY.', 'YYYYY', '.YYY.', '..Y..'], { Y: '#ffe14d' }));
const STAIR_ICON = () => once('stair', () => sprite(['....WW', '...WW.', '..WW..', '.WW...', 'WW....'], { W: '#ffffff' }, null));
const HELI = () => once('heli', () => sprite([
  '..................KK......',
  '..........RRRRRRRRRRR.....',
  '........RRRRRRRRRRRRRRR...',
  'TTTTTTTRRRRRRRRRRRRRBBBB..',
  'T......RRRYYYRRRRRRRBBBBB.',
  '.......RRRRRRRRRRRRRRBBBB.',
  '........RRRRRRRRRRRRRRRR..',
  '..........RRRRRRRRRRRR....',
  '...........K.......K......',
  '.........KKKKKKKKKKKKK....',
], { R: '#ff2d55', B: '#bfeaff', Y: '#ffe14d', T: '#1b1033', K: INK }));

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
function drawSkyAll(h) {
  // himlen följer världens x (X0 är alltid samma i den här vyn), så den räknas i ritytans bredd
  const sc = skyCanvas(lo.width);
  g.drawImage(sc, 0, -CY);
  const n = nightness(h);
  if (n > 0.05) for (const s of stars) {
    const tw = Math.sin(S.anim * 3 + s.x) > 0.3;
    R(X(s.x), Y(s.y), 1, 1, tw ? `rgba(255,255,220,${n})` : `rgba(255,255,220,${n * 0.5})`);
    if (s.r > 1.6 && tw) { R(X(s.x) - 1, Y(s.y), 3, 1, `rgba(255,255,220,${n * 0.6})`); R(X(s.x), Y(s.y) - 1, 1, 3, `rgba(255,255,220,${n * 0.6})`); }
  }
  const tt = clamp((h - 6.5) / 13, 0, 1);
  if (n < 0.8) {
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
function drawGroundPx() {
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
  // trottoaren och gatan
  R(0, gy, lo.width, 7, PAL.walk); R(0, gy, lo.width, 1, INK); R(0, gy + 7, lo.width, 1, INK);
  for (let x = -((X0 / PX) % 12); x < lo.width; x += 12) R(x, gy + 1, 1, 6, PAL.walkLine);
}
/** Gatan utanför (till höger om huset): gatlyktor, busshållplatsen, ett träd och folk som går förbi.
 *  Bara grafik: fotgängarna lånar utseendet av någon i huset och slumpas med vrand. */
const walkers = [];
let walkerN = 0;
let walkerT = 0;
function drawStreetPx(dt, h) {
  const gy = Y(GROUND_Y), n = nightness(h);
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
  for (const w of walkers) {
    const frame = Math.floor(w.x / 6) % 4 & 3;
    g.drawImage(personSprite(w, 'side', frame, w.dir), X(w.x) - PERSON_W / 2, gy + 3 + Math.round(w.depth) - PERSON_H);
  }
  g.restore();
}

// ---------- Byggnaden ----------
// Tornet är indraget: under sky lobbyn har det full bredd (BX1), ovanför bara så brett som höga zonen
// behöver (UX1). Taket på den breda delen blir en terrass, och under expresshissarna går garagerampen.
const INSIDE_EL = EL.filter(e => !e.facade);
// (dubbeldäck: schaktet går en våning högre än nedre däckets översta stopp – topF)
const shaftTop = e => floorY(EL[e.id].topF + 1) + 4, shaftBot = e => floorY(e.minF) + 4;
const BASE_Y = floorY(0) + 6, DECK_Y = floorY(TOP);
const UX1 = TOWER_X1[TOP], SEAM_Y = floorY(SEAM_F); // tornets övre högerkant och terrassens golv
/** schaktkolumnerna (vänsterkant) med hissarna i varje – låg och hög zon kan dela kolumn */
const COLS = [...new Set(INSIDE_EL.map(e => shaftX(e.id)))].sort((a, b) => a - b).map(x => ({ x, els: INSIDE_EL.filter(e => shaftX(e.id) === x) }));
/** tornets högerkant i höjd med världens y */
const towerX1At = y => (y < SEAM_Y ? UX1 : BX1);
/** hissen ovanpå i samma schakt (staplade zoner), om någon */
const stackedAbove = e => INSIDE_EL.find(o => o !== e && shaftX(o.id) === shaftX(e.id) && o.minF === EL[e.id].topF + 1);
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
function drawShell(h) {
  const ns = nightStep(h);
  layer('shell', `${ns}|${S.power}`, () => drawShellStatic(ns));
  drawRampCarsPx();
  drawDockTrucksPx();
}
// ---------- Lastkajen: leveransbilen och flyttbilen (life.js, visits.js) ----------
// Lastkajen ligger nere på P1, på vändplanet där rampen från gatan svänger. Bilen backar ner för rampen och
// ställer sig med bakdörrarna mot kajen (till vänster). Kajen har plats för en bil: står flyttbilen där väntar
// leveransbilen på gatan, och tvärtom. Allt här är grafik – läget kommer ur simuleringen.
const DOCK_DRIVE_S = 3; // (flyttbilen: så länge den syns köra ner för rampen eller upp igen)
/** en bil vid lastkajen: x = bilens vänsterkant (bakdörrarna), yb = golvet under hjulen; open = bakdörrarna öppna */
function dockTruck(x, yb, kind, open) {
  const flytt = kind === 'flytt', body = flytt ? '#f4f1e8' : '#ffd23f', w = flytt ? 40 : 32, hgt = flytt ? 15 : 12;
  // skåpet (bak, till vänster) och hytten (fram, till höger)
  box(x, yb - hgt - 3, w - 9, hgt, body);
  box(x + w - 10, yb - 12, 10, 9, flytt ? '#ff8c42' : '#d4a017'); R(x + w - 8, yb - 11, 6, 4, '#bfeaff');
  R(x + 1, yb - 5, w - 2, 2, INK);
  for (const wx of [x + 3, x + w - 8]) { R(wx, yb - 4, 5, 4, INK); R(wx + 1, yb - 3, 3, 2, '#5a5a5a'); }
  if (flytt) { R(x + 2, yb - hgt + 1, w - 13, 3, '#ff8c42'); text(g, 'FLYTT', x + (w - 9) / 2, yb - hgt + 5, '#ff8c42', 'center'); }
  else { R(x + 2, yb - hgt - 1, w - 13, 1, '#c81e3a'); text(g, 'PAKET', x + (w - 9) / 2, yb - hgt + 2, INK, 'center'); }
  // bakdörrarna står öppna mot kajen
  if (open) { R(x - 1, yb - hgt - 3, 2, hgt, INK); R(x - 3, yb - hgt - 2, 2, hgt - 2, dark(body, 0.25)); }
  return w;
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
  // flyttbilen: står vid kajen medan flytten pågår (och kör ner/upp precis i början och slutet)
  const M = S.move;
  if (M && M.state === 'on') draw(Math.min(1, (S.t - M.t0) / DOCK_DRIVE_S), 'flytt', true);
  else if (M && M.state === 'done' && S.t - M.t1 < DOCK_DRIVE_S) draw(1 - (S.t - M.t1) / DOCK_DRIVE_S, 'flytt', false);
  // väntar på gatan (lastkajen är upptagen): utanför garageöppningen
  if (M && M.state === 'planned' && M.dockWait > 0) dockTruck(rx1 + 10, yE, 'flytt', false);
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
function drawTerracePx(h) {
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
function drawSlabsPx() {
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
function drawLanternsPx() {
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
 *  vilka våningar hissen ska till med dem som väntar här (som "5 8 12" i verkliga hus). */
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
/** målvåningarna för dem som väntar på våning f och har fått hissen e (i färdriktningen, närmast först) */
function destsAt(e, f) {
  const set = new Set();
  for (const p of S.people) if (p.floor === f && p.assigned === e.id && (p.state === 'wait' || p.state === 'boarding')) set.add(p.dest);
  return [...set].sort((a, b) => Math.abs(a - f) - Math.abs(b - f) || a - b);
}
/** Destinationsterminalen vid korridoren: man slår in våningen och skärmen visar vilken hiss man ska ta.
 *  Bara i lägen med destinationsstyrning (inte KNAPPAR). Ren grafik ur p.assigned/p.waitStart. */
function terminal(f) {
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

// ---------- Hallen på varje våning ----------
/** Kvällsljus i hallen: väggarna blir blåare, och där någon är (eller i entrén, hemma, i garaget) lyser
 *  taklamporna i varma koner. Ritas före folket, så att de står i ljuset. */
const ALWAYS_LIT = ['lobby', 'apartments', 'garage', 'dock', 'station', 'sky'];
function nightLight(f, th, x0, x1, top, bot, n) {
  if (n < 0.05) return;
  R(x0, top, x1 - x0, bot - top, `rgba(18,22,70,${(0.3 * n).toFixed(3)})`);
  if (!S.power || !(OCC[f] > 0 || ALWAYS_LIT.includes(th))) return;
  const warm = th === 'apartments' ? '255,214,140' : '255,240,190', a = 0.11 * n;
  for (let lx = x0 + 40; lx < x1 - 8; lx += 52) {
    R(lx - 3, top, 7, 1, INK); R(lx - 2, top + 1, 5, 1, '#fff3b0');
    for (let r = 0; r < bot - top - 5; r++) {
      const w = 5 + Math.round(r * 0.7);
      R(lx - (w >> 1), top + 2 + r, w, 1, `rgba(${warm},${a.toFixed(3)})`);
    }
    R(lx - 14, bot - 4, 29, 1, `rgba(${warm},${(a * 2).toFixed(3)})`);
  }
}
/** gallret för en stängd verksamhet och skylten med öppettiden (ritas på korridoren) */
function closedGate(f, cx, cy, cw, ch) {
  for (let x = cx + 1; x < cx + cw; x += 3) R(x, cy, 1, ch, '#8a909a');
  for (let y = cy + 2; y < cy + ch; y += 6) R(cx, y, cw, 1, '#6b7280');
  const oh = FLOOR_HOURS[f], o = (oh[0] % 1 ? `${Math.floor(oh[0])}:30` : `${oh[0]}:00`).padStart(5, '0');
  pill(cx - 1, cy + 4, cw + 2, 9, '#ff5d52'); text(g, 'STÄNGT', cx + cw / 2, cy + 5, '#ffffff', 'center');
  pill(cx + 2, cy + 14, cw - 4, 9, '#ffffff'); text(g, o, cx + cw / 2, cy + 15, '#c81e3a', 'center');
}
/** Glimtar av rummen längst in i korridoren: en möbel eller pryl som visar vad som finns där, och ibland
 *  en skugga som går förbi. Ren grafik ur våningens tema. */
const GLIMPSE = {
  dentist: [['......KK', '.....KYK', '......KK', '..TTTTT.', 'TTTTTTT.', '...SS...', '..SSSS..'], { K: INK, Y: '#ffe14d', T: '#409991', S: '#9aa3ad' }],
  game: [['.KKKKKK.', '.KGGGGK.', '.KGgGGK.', '.KGGGGK.', '.KKKKKK.', '...KK...', '.KKKKKK.'], { K: '#3a3f48', G: '#38d9a9', g: '#ffffff' }],
  ad: [['RRYYBB..', 'RRYYBB..', 'PPGGOO..', 'PPGGOO..', '.K..K...', 'K....K..'], { R: '#ff5d52', Y: '#ffe14d', B: '#3f7cff', P: '#ff4fa3', G: '#7cf06b', O: '#ff9f1c', K: INK }],
  law: [['BBBBBBBB', 'RGrBRgGB', 'BBBBBBBB', 'gRBGrRBg', 'BBBBBBBB', 'RrGBgRGr', 'BBBBBBBB'], { B: '#6b4a2b', R: '#8a2a2a', G: '#2f5d3a', r: '#c0392b', g: '#d4a017' }],
  radio: [['RRRRRR..', 'RWWWWR..', 'RRRRRR..', '........', '...K....', '..KKK...', '...K....', '...K....', '..KKK...'], { R: '#c81e3a', W: '#ffffff', K: INK }],
  aerobic: [['MMMMMMMM', 'MmMMMMmM', 'MMMMMMMM', 'MMMMMMMM', '........', '.PPPPPP.', '.K....K.'], { M: '#bfeaff', m: '#ffffff', P: '#ff4fa3', K: INK }],
  server: [['KKKKKKKK', 'KgKrKgKK', 'KKKKKKKK', 'KgKgKrKK', 'KKKKKKKK', 'KrKgKgKK', 'KKKKKKKK'], { K: '#2b2f36', g: '#7cf06b', r: '#ffb000' }],
  spa: [['..w..w..', '.w..w...', '..BBBB..', '.BBBBBB.', '.BbbbbB.', '.BBBBBB.'], { w: '#ffffff', B: '#a64eb3', b: '#bfeaff' }],
  bank: [['.YYYY...', 'YKKKKY..', 'YKYYKY..', 'YKKKKY..', '.YYYY...', 'WWWWWWWW', 'BBBBBBBB'], { Y: '#d4a017', K: '#5a4a20', W: '#e8e2d0', B: '#8a6a46' }],
  lab: [['..KK....', '..GG....', '..GG..K.', '.GgGG.G.', 'GGGGGGGG', 'WWWWWWWW', 'K......K'], { K: INK, G: '#38d9a9', g: '#ffffff', W: '#d4d0c8' }],
  sky: [['.KKKK...', '.KSSK...', '.KKKK...', '..CC.ww.', '.CCCCw..', '.CCCC...', 'WWWWWWWW'], { K: '#3a3f48', S: '#9aa3ad', C: '#8a5a2b', w: '#ffffff', W: '#bd6659' }],
  apartments: [['.KKKKK..', '.KTTTK..', '.KTTTK..', '.KKKKK..', '........', 'SSSSSSSS', 'S.SSSS.S'], { K: '#2b2f36', T: '#6fa8ff', S: '#c0392b' }],
  garage: [['..KKKK..', '.KCCCCK.', 'CCCCCCCC', 'CRCCCCRC', '.K....K.'], { K: INK, C: '#5b8fb9', R: '#ff5d52' }],
  dock: [['BBB.BBB.', 'BYB.BYB.', 'BBB.BBB.', 'BBBBBBB.', 'BBYBBYB.', 'BBBBBBB.'], { B: '#b07a45', Y: '#e8d27a' }],
  station: [['YYYYYYYY', 'YKKKKKKY', 'YYYYYYYY', '...KK...', '...KK...'], { Y: '#ffd23f', K: INK }],
  roof: [['..GG....', '.GGGG...', 'GGGGGG..', '..BB....', '..BB....'], { G: '#389a5c', B: '#8a5a2b' }],
};
const glimpseSprite = th => once('glimpse' + th, () => (GLIMPSE[th] ? sprite(GLIMPSE[th][0], GLIMPSE[th][1], null) : null));
function glimpse(f, th, ix, iy, iw, ih, n) {
  const sp = glimpseSprite(th);
  g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
  if (sp) g.drawImage(sp, ix + Math.round((iw - sp.width) / 2), iy + ih - sp.height);
  // tv:n hemma och skärmarna i spelstudion flimrar på kvällen
  if (th === 'apartments' && n > 0.4) R(ix, iy, iw, ih, `rgba(111,168,255,${(0.12 + 0.12 * Math.abs(Math.sin(S.anim * 5.3 + f))).toFixed(3)})`);
  if (th === 'server' && Math.sin(S.anim * 9 + f) > 0.6) R(ix + 4, iy + ih - 6, 1, 1, '#7cf06b');
  // en skugga som går förbi längst in (någon är inne)
  if (OCC_IN[f] > 0) {
    const per = 7 + (f % 3) * 2, t = (S.anim / per + f * 0.37) % 1;
    if (t < 0.45) {
      const k = t / 0.45, dir = f % 2 ? 1 : -1, sx = dir > 0 ? ix - 4 + Math.round(k * (iw + 8)) : ix + iw + 4 - Math.round(k * (iw + 8));
      const by = iy + ih - 1, bob = Math.floor(S.anim * 8) % 2;
      R(sx - 1, by - 9 - bob, 3, 3, 'rgba(27,16,51,.55)'); R(sx - 2, by - 6 - bob, 5, 6 + bob, 'rgba(27,16,51,.55)');
    }
  }
  g.restore();
}
/** Inredning i hallen (bakom folket): en tavla på väggen, en krukväxt och något som hör till våningen.
 *  Platserna räknas ut ur våningens nummer, så att varje hall ser lite olika ut men aldrig ändras. */
const PICS = ['#ff5d52', '#3f7cff', '#ffe14d', '#7cf06b', '#ff4fa3', '#38d9a9'];
function hallProps(f, th, top, bot) {
  if (th === 'roof') return;
  const base = X(DOOR_X) + 60 + (f * 7) % 14;
  const plantPot = (px, big) => {
    box(px, bot - 9, 7, 6, '#a65e3a'); R(px + 1, bot - 9, 5, 1, '#c27a54');
    for (let k = 0; k < (big ? 4 : 3); k++) R(px - 2 + k * 3, bot - 16 - (big ? 4 : 0) + (k % 2) * 3, 3, 8 + (big ? 3 : 0), ['#389a5c', '#2f7d4a', '#4caf6a'][k % 3]);
  };
  if (th === 'garage' || th === 'dock' || th === 'station') {
    // betong: gula stolpar och en skylt
    for (const px of [base, base + 46]) { R(px, bot - 14, 3, 11, '#ffd23f'); for (let y = bot - 13; y < bot - 3; y += 4) R(px, y, 3, 2, INK); }
    if (th !== 'station') { box(base + 12, top + 20, 22, 9, PAL.sign); text(g, th === 'dock' ? 'KAJ' : 'P', base + 23, top + 22, '#ffffff', 'center'); }
    return;
  }
  // tavla
  const pw = 16, py = top + 20, c1 = PICS[f % PICS.length], c2 = PICS[(f + 2) % PICS.length];
  box(base, py, pw, 11, '#6b4a2b'); R(base + 1, py + 1, pw - 2, 9, '#fff8e0');
  R(base + 2, py + 6, pw - 4, 3, c1); R(base + 4 + (f % 5), py + 2, 4, 4, c2);
  if (th === 'apartments') {
    // postlådor och en dörrmatta
    for (let k = 0; k < 3; k++) { box(base + 22 + k * 7, py + 2, 6, 5, '#9aa3ad'); R(base + 24 + k * 7, py + 3, 2, 1, INK); }
    R(base + 2, bot - 4, 18, 1, '#8a2a2a');
    plantPot(base + 50, false);
    return;
  }
  if (th === 'sky') {
    // soffa med utsikt
    box(base + 22, bot - 10, 26, 7, '#4695b8'); R(base + 22, bot - 13, 26, 4, INK); R(base + 23, bot - 12, 24, 2, '#5aa9cc');
    plantPot(base + 54, true);
    return;
  }
  // kontor: vattenautomat och en växt
  const wx = base + 26;
  box(wx, bot - 12, 7, 9, '#d4d0c8'); box(wx + 1, bot - 20, 5, 8, '#bfeaff'); R(wx + 2, bot - 18, 3, 1, '#ffffff'); R(wx + 2, bot - 9, 2, 1, '#3f7cff');
  plantPot(base + 40, (f % 2) === 0);
}
/** entréns golv: rutigt marmorgolv */
function lobbyFloor(x0, x1, bot) {
  R(x0, bot - 3, x1 - x0, 3, '#d4d0c8');
  for (let x = x0; x < x1; x += 4) R(x, bot - 3 + ((x - x0) / 4) % 2, 4, 1, '#8a8475');
  R(x0, bot - 3, x1 - x0, 1, '#ffffff');
}
/** karuselldörren i entrén: gatan syns genom glaset och vingarna snurrar när folk går ut och in */
function revolvingDoor(cx, cy, cw, ch, h) {
  const n = nightness(h);
  R(cx, cy, cw, ch, blend('#bfe3f2', '#26324a', n));
  // gatan utanför: trottoar, och en gatlykta i mörkret
  R(cx, cy + ch - 6, cw, 6, blend('#c0c0c0', '#4a5060', n));
  if (n > 0.4) { R(cx + cw - 6, cy + 4, 1, ch - 10, INK); R(cx + cw - 8, cy + 3, 5, 2, '#ffe14d'); }
  // vingarna (fyra, sedda från sidan): x = cos(vinkeln)
  // (inte personHead/landPos här: de räknar gångriktningen och får bara anropas en gång per bildruta och person)
  const busy = S.people.some(p => p.floor === LOBBY && (p.state === 'exiting' || p.state === 'toQueue'));
  const a = (busy ? S.anim * 2.2 : 0) % (Math.PI / 2);
  for (let k = 0; k < 4; k++) {
    const c = Math.cos(a + k * Math.PI / 2), wx = cx + cw / 2 + Math.round(c * (cw / 2 - 3));
    if (Math.sin(a + k * Math.PI / 2) < 0) continue; // bara de främre vingarna
    R(wx, cy + 1, 1, ch - 2, '#606878'); R(wx + 1, cy + 1, 1, ch - 2, 'rgba(255,255,255,.5)');
  }
  R(cx + cw / 2, cy, 1, ch, INK); // axeln
  R(cx, cy, cw, 2, PAL.steel); R(cx, cy + ch - 1, cw, 1, PAL.steel);
  // reflex i glaset
  line(cx + 3, cy + ch - 4, cx + 9, cy + 4, 'rgba(255,255,255,.55)');
}
/** entréns inredning: receptionsdisken, krukväxter och en lampa i taket (rulltrappan ritas för sig) */
function lobbyProps(top, bot) {
  const dx = X(DOOR_X) + 46;
  // receptionen: disk med dator och klocka, receptionisten (crew.js) bakom – eller en skylt när hon är borta
  const rec = sitters(LOBBY, 'reception')[0];
  if (rec) {
    const w = winPos(rec);
    g.drawImage(personSprite(winFig(rec, 0), 'front', 0, 1, { blink: blinkOf(rec) }), X(w.x) - PERSON_W / 2, Y(w.y));
  }
  // godisautomaten (där den högra krukväxten stod)
  const vx = dx + 24;
  box(vx, bot - 22, 9, 19, '#c81e3a'); R(vx + 1, bot - 21, 7, 9, '#bfeaff');
  for (let k = 0; k < 3; k++) R(vx + 2 + k * 2, bot - 20 + (k % 2) * 3, 1, 2, ['#ffd23f', '#7cf06b', '#ff4fa3'][k]);
  R(vx + 2, bot - 9, 5, 2, INK); R(vx + 6, bot - 15, 1, 1, S.power ? '#7cf06b' : '#3a3f48');
  box(dx, bot - 14, 20, 11, '#8a6a46'); R(dx + 1, bot - 13, 18, 1, '#b08a5a'); R(dx + 2, bot - 9, 16, 1, '#6b4a2b');
  box(dx + 12, bot - 19, 6, 5, '#d4d0c8'); R(dx + 13, bot - 18, 4, 3, S.power ? '#38d9a9' : '#2b2f36');
  R(dx + 3, bot - 16, 3, 2, '#ffe14d');
  const berit = !rec && S.people.find(p => p.role === 'receptionist' && !p.dead);
  if (berit && berit.onBreak) { const t = /lunch/i.test(berit.breakWhy) ? 'LUNCH' : 'FIKA'; pill(dx, bot - 21, 21, 8, '#ffffff'); text(g, t, dx + 10, bot - 20, '#c81e3a', 'center'); }
  reserve(dx, bot - 22, 20, 19);
  // krukväxt
  for (const px of [dx - 10]) {
    box(px, bot - 9, 7, 6, '#a65e3a');
    for (let k = 0; k < 3; k++) R(px - 1 + k * 3, bot - 15 + (k % 2) * 2, 3, 6, ['#389a5c', '#2f7d4a', '#4caf6a'][k]);
  }
  // ljuskrona i taket
  const lx = X(DOOR_X) + 56;
  R(lx, top, 1, 5, INK); R(lx - 5, top + 5, 11, 1, '#d4a017');
  for (let k = -4; k <= 4; k += 4) R(lx + k, top + 6, 1, 2, S.power ? '#fff3b0' : '#5a5a5a');
}
/** rulltrappan från entrén upp till mellanplanet (övre däcket), ritas genom bjälklaget efter hallarna */
function drawEscalatorPx() {
  if (MEZZ < 0) return;
  const xb = X(DOOR_X) + 84, yb = Y(floorY(LOBBY) - 4) - 3, xt = xb + 70, yt = Y(floorY(MEZZ) - 4) - 3;
  if (yb < -10 || yt > lo.height + 10) return;
  const L = xt - xb, ph = Math.floor(S.anim * 10) % 4;
  for (let i = -8; i <= L + 8; i++) {
    const k = clamp(i / L, 0, 1), x = xb + i, y = Math.round(yb + (yt - yb) * k);
    R(x, y - 9, 1, 8, 'rgba(191,234,255,.35)'); // glasräcket
    R(x, y - 10, 1, 1, INK);                     // ledstången
    R(x, y, 1, 1, '#8a909a');                    // stegen
    R(x, y + 1, 1, 3, '#5b6b80'); R(x, y + 4, 1, 1, INK); // fackverket under
    if (i >= 0 && i <= L && (i + ph) % 4 === 0) R(x, y - 1, 1, 1, '#d4d0c8');
  }
}

let OCC = [], OCC_IN = [];
function drawHall(f, h) {
  const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) - 4), x0 = X(LAND_X0), x1 = X(INNER_X1);
  const th = FL[f].theme, acc = FL[f].acc;
  if (th === 'roof') {
    // takterrassen: räcke och trall under öppen himmel
    R(x0, bot - 17, x1 - x0, 1, INK);
    for (let x = x0 + 2; x < x1; x += 12) R(x, bot - 17, 1, 15, INK);
    R(x0, bot - 4, x1 - x0, 4, '#94a3b8'); for (let x = x0; x < x1; x += 6) R(x, bot - 4, 1, 4, '#7a889e');
  } else {
    const wall = blend(PAL.wall, acc, 0.16);
    R(x0, top, x1 - x0, bot - top, wall);
    for (let x = x0 + 4; x < x1; x += 11) R(x, top, 1, bot - top - 15, blend(PAL.wall, acc, 0.3));
    R(x0, bot - 15, x1 - x0, 15, blend(PAL.wain, acc, 0.28));
    R(x0, bot - 15, x1 - x0, 1, blend(PAL.wainLine, acc, 0.3));
    R(x0, bot - 14, x1 - x0, 1, light(blend(PAL.wain, acc, 0.28), 0.3));
    for (let x = x0 + 8; x < x1 - 2; x += 16) R(x, bot - 12, Math.min(10, x1 - 2 - x), 8, blend(PAL.panel, acc, 0.3));
  }
  if (th === 'lobby') lobbyFloor(x0, x1, bot);
  else { R(x0, bot - 3, x1 - x0, 3, blend(PAL.floor, acc, 0.25)); R(x0, bot - 3, x1 - x0, 1, light(blend(PAL.floor, acc, 0.25), 0.25)); }
  // korridoren in mot rummen (perspektiv: mörk gång, ljus längst in) – i entrén en karuselldörr mot gatan
  const cw = 28, ch = 31, cx = X(DOOR_X) - cw / 2, cy = bot - ch;
  const n = nightness(h), lit = S.power && (OCC[f] > 0 || n < 0.5);
  R(cx - 4, cy - 4, cw + 8, ch + 4, INK); R(cx - 3, cy - 3, cw + 6, ch + 3, acc); R(cx - 3, cy - 3, cw + 6, 1, light(acc, 0.35));
  R(cx - 1, cy - 1, cw + 2, ch + 1, INK);
  if (th === 'lobby') revolvingDoor(cx, cy, cw, ch, h);
  else {
    R(cx, cy, cw, ch, PAL.corridor);
    const ix = cx + 7, iy = cy + 7, iw = cw - 14, ih = ch - 13;
    R(ix, iy, iw, ih, lit ? blend(acc, '#fff8d0', 0.55) : PAL.dim);
    if (lit) glimpse(f, th, ix, iy, iw, ih, n);
    for (let r = 0; r < ch - (iy - cy) - ih; r++) {
      const yy = iy + ih + r, k = r / (ch - (iy - cy) - ih);
      const xa = Math.round(ix - k * 7), xb = Math.round(ix + iw + k * 7);
      R(xa, yy, xb - xa, 1, r % 2 ? PAL.corrA : PAL.corrB);
    }
    line(cx, cy, ix, iy, PAL.corrEdge); line(cx + cw - 1, cy, ix + iw - 1, iy, PAL.corrEdge);
    // stängt: ett galler för korridoren och skylten på gallret (i stället för en lapp mitt i hallen)
    if (FLOOR_HOURS[f] && !floorOpen(f, h)) closedGate(f, cx, cy, cw, ch);
  }
  if (th === 'lobby') lobbyProps(top, bot);
  else if (f === CONTROL) controlRoom(top, bot);
  else if (f === BREAK) breakRoom(top, bot, h);
  else hallProps(f, th, top, bot);
  // spårad person därinne / muspekaren över korridoren
  const sel = S.sel && !S.sel.dead && S.sel.floor === f && S.sel.state !== 'ride' && personHead(S.sel)?.hidden;
  if (sel || S.hoverDoor === f) ants(cx - 6, cy - 6, cw + 12, ch + 6, sel ? '#ffe14d' : '#ffffff');
  // antal inne på våningen
  // antal inne: en liten skylt bredvid korridoren, som ett dörrnummer
  if (OCC_IN[f]) { const s = String(OCC_IN[f]), w = Math.max(9, textW(s) + 5); pill(cx + cw + 4, bot - 13, w, 9, '#ffffff'); text(g, s, cx + cw + 4 + w / 2, bot - 12, INK, 'center'); reserve(cx + cw + 4, bot - 13, w, 9); }
  // våningsnummer och företagsskylt
  const st = starSprite(acc); g.drawImage(st, X(DOOR_X) - 10, top + 1);
  text(g, fl(f), X(DOOR_X) + 1, top + 7, '#ffffff', 'center', 1, INK);
  const name = plain(FL[f].name), nx = X(DOOR_X) + 13, nw = Math.min(x1 - nx - 2, textW(name) + 7);
  reserve(X(DOOR_X) - 10, top, nw + 23, 17);
  pill(nx, top + 6, nw, 10, acc); R(nx + 1, top + 7, nw - 2, 1, light(acc, 0.35));
  g.save(); g.beginPath(); g.rect(nx + 1, top + 6, nw - 2, 10); g.clip();
  text(g, name, nx + 4, top + 7, '#ffffff', 'left', 1, dark(acc, 0.55));
  g.restore();
  stairSign(f, false);
  if (f === STATION) drawPlatformPx(top, bot, h);
}
// ---------- Driftcentralen: kontrollrummet där driftchefen sitter ----------
// Ett fönster i hallens bakvägg: en skärm per hiss (korgens läge i schaktet, rött när den är trasig),
// ett larmljus som snurrar under incidenter, kontrollbordet och driftchefen (Gun-Britt på dagen, Rune på
// natten) – cheferna är personer (chief.js): den som sitter vid bordet ritas här. Chefen står upp under larm;
// är chefen på rast eller på väg står stolen tom. Pratbubblan ritas i drawChiefPx.
/** var chefens huvud ritades i den här bildrutan (låg upplösning), null = syns inte */
let chiefAt = /** @type {{ x: number, y: number }|null} */ (null);
/** den som sitter i ett fönster ritas med en egen figur (humöret efter larmet – personens eget p.mood rörs inte) */
const winFig = (p, mood) => ({ id: p.id, mood, child: false, smoked: false, look: p.look });
const sitters = (f, win) => S.people.filter(p => !p.dead && p.floor === f && inWindow(p) && p.spot.win === win);
function controlRoom(top, bot) {
  const wx = X(DOOR_X) + 58, ww = Math.min(108, X(INNER_X1) - 14 - wx), wy = top + 18, wh = bot - 3 - wy;
  if (ww < 50) return;
  const power = S.power || (S.outage && S.outage.gen), alarmed = alarm(), blink = Math.floor(S.anim * 3) % 2 === 0;
  // ramen och rummet (mörkt, upplyst av skärmarna)
  box(wx - 2, wy - 2, ww + 4, wh + 3, PAL.steel);
  R(wx, wy, ww, wh, power ? '#1d2433' : '#0d1018');
  // skylten i fönstrets överkant: när chefen säger något rullar det som en textremsa
  const C0 = S.chief, say = C0 && C0.on && C0.say && S.t < C0.say.until ? C0.say : null;
  R(wx, wy, ww, 7, say ? '#000000' : '#000080');
  g.save(); g.beginPath(); g.rect(wx + 1, wy, ww - 9, 7); g.clip();
  if (say) {
    const str = plain(say.text.toUpperCase()), tw = textW(str), room = ww - 10;
    const off = tw <= room ? 0 : Math.floor(((S.t - say.t0) * 22) % (tw + 24)) - 12;
    text(g, str, wx + 2 - Math.max(0, off), wy + 1, say.dec ? '#ffd23f' : '#7dff9a');
  } else text(g, 'DRIFTCENTRAL', wx + 3, wy + 1, '#ffffff');
  g.restore();
  reserve(wx - 2, wy - 2, ww + 4, 9);
  // larmljuset: snurrar rött under incidenter och färgar rummet
  const lx = wx + ww - 6;
  if (alarmed) {
    const sp = Math.sin(S.anim * 9);
    box(lx, wy + 1, 4, 4, sp > 0 ? '#ff2d55' : '#7a2033');
    if (sp > 0.2) R(wx, wy + 6, ww, wh - 6, 'rgba(255,45,85,.14)');
  } else box(lx, wy + 1, 4, 4, '#4a2a33');
  // en skärm per hiss: korgens läge i schaktet
  const n = S.elevators.length, mw = Math.max(6, Math.min(12, Math.floor((ww - 6) / n) - 1)), my = wy + 9, mh = 10;
  const mx0 = wx + Math.round((ww - n * (mw + 1)) / 2);
  S.elevators.forEach((e, i) => {
    const x = mx0 + i * (mw + 1);
    box(x, my, mw, mh, '#3a3f48');
    const bad = e.mode === 'broken' || e.mode === 'snapped' || e.mode === 'dead';
    if (!power) { R(x + 1, my + 1, mw - 2, mh - 2, '#15171c'); return; }
    R(x + 1, my + 1, mw - 2, mh - 2, bad && blink ? '#5a0f1a' : '#0b1a10');
    R(x + 1, my + 1, mw - 2, 1, e.color); // hissens färg upptill
    const cx = x + Math.floor(mw / 2);
    R(cx, my + 2, 1, mh - 3, '#1f3a28');
    const k = clamp((e.pos - e.minF) / Math.max(1, e.topF - e.minF), 0, 1), dy = my + mh - 2 - Math.round(k * (mh - 4));
    const dot = bad ? '#ff2d55' : e.hot ? '#ff9f1c' : e.mode === 'service' || e.hold ? '#ffe14d' : e.sleep ? '#2f6b47' : light(e.color, 0.35);
    R(cx - 1, dy - 1, 3, 2, dot);
  });
  // kontrollbordet med knappar som blinkar (och en kaffekopp)
  const dy = wy + wh - 6;
  const C = S.chief, on = !!(C && C.on), seat = post => SPOTS[CONTROL].find(s => s.post === post);
  const desk = seat('chief'), prod = seat('producer'), here = sitters(CONTROL, 'control');
  const P = here.find(p => p.spot === desk), Q = here.find(p => p.spot === prod);
  const px = X(desk.x) - PERSON_W / 2, qx = prod ? X(prod.x) - PERSON_W / 2 : 0;
  chiefAt = null;
  g.save(); g.beginPath(); g.rect(wx, wy + 6, ww, wh - 6); g.clip();
  // stolarna (syns bakom dem som sitter – tomma när de har rast eller är på väg)
  R(px + 1, dy - 7, 2, 7, '#3a3f48'); R(px + 1, dy - 1, 9, 1, '#3a3f48');
  if (prod) { R(qx + PERSON_W - 3, dy - 7, 2, 7, '#3a3f48'); R(qx + 1, dy - 1, 9, 1, '#3a3f48'); }
  // bildproducentens egen skärm (det regissören visar) med en blinkande REC-lampa
  if (prod) {
    const mx = qx - 11;
    box(mx, dy - 9, 10, 9, '#d4d0c8'); R(mx + 1, dy - 8, 8, 6, power ? '#10243a' : '#15171c');
    if (power) { R(mx + 2, dy - 6, 6, 2, '#3f7cff'); if (Q && Math.floor(S.anim * 1.5) % 2) R(mx + 7, dy - 8, 1, 1, '#ff2d55'); }
  }
  // under larm står de upp (framifrån) och följer skärmarna, annars sitter de vid bordet
  for (const p of here) {
    const view = alarmed ? 'front' : 'side', bob = alarmed ? Math.round(Math.sin(S.anim * 3 + p.id)) : 0;
    const spr = personSprite(winFig(p, alarmed ? 1 : 0), view, 0, p.spot.face || 1, { blink: Math.sin(S.anim * 0.8 + p.id) > 0.97 });
    const sx = X(winPos(p).x) - PERSON_W / 2, sy = Y(winPos(p).y) - (alarmed ? 5 : 0) + bob;
    g.drawImage(spr, sx, sy);
    if (p === P) chiefAt = { x: sx + PERSON_W / 2, y: sy };
  }
  // rast: stolsryggen syns
  if (!P) { R(px + 2, dy - 12, 6, 6, '#3a3f48'); R(px + 3, dy - 11, 4, 4, '#5a6070'); }
  if (prod && !Q) { R(qx + 3, dy - 12, 6, 6, '#3a3f48'); R(qx + 4, dy - 11, 4, 4, '#5a6070'); }
  g.restore();
  box(wx + 2, dy, ww - 4, 6, '#8a909a'); R(wx + 3, dy + 1, ww - 6, 1, '#c0c6cc');
  for (let i = 0; i < 6; i++) if (power) R(wx + 40 + i * 4, dy + 3, 2, 1, (Math.floor(S.anim * 2 + i * 1.7) % 3) ? ['#7cf06b', '#ffe14d', '#ff5d52'][i % 3] : '#3a3f48');
  // skärmen på bordet: chefens senaste beslut som en blinkande rad (eller RAST)
  const tx = px + 13, ty = dy - 8;
  box(tx, ty, 14, 9, '#d4d0c8'); R(tx + 1, ty + 1, 12, 6, power ? '#0b1a10' : '#15171c');
  const away = !P && on && CHIEFS.some((_, i) => { const q = chiefPerson(i); return q && q.onBreak; });
  if (power) {
    if (!on) text(g, 'RAST', tx + 7, ty + 1, '#ffd23f', 'center');
    else if (away) text(g, 'FIKA', tx + 7, ty + 1, '#ffd23f', 'center');
    else if (C.say && S.t < C.say.until && blink) R(tx + 2, ty + 3, 10, 2, '#7dff9a');
    else { R(tx + 2, ty + 2, 6, 1, '#7dff9a'); R(tx + 2, ty + 4, 8, 1, '#2f6b47'); }
  }
  R(tx + 6, ty + 9, 2, 1, INK);
  R(px + 30, dy - 3, 3, 3, '#ffffff'); R(px + 31, dy - 2, 1, 1, '#8a5a2b'); // kaffekoppen
  // reflex i glaset
  line(wx + 3, wy + wh - 2, wx + 9, wy + 8, 'rgba(255,255,255,.12)');
}
/** driftchefens pratbubbla (efter folket, så att den hamnar överst): ovanför fönstret, och bara de första
 *  sekunderna – sedan står det kvar i textremsan */
function drawChiefPx() {
  const C = S.chief;
  if (!C || !C.on || !C.say || S.t - C.say.t0 > 3.5) return;
  const who = chiefOnDuty();
  let at = chiefAt;
  // chefen är inte vid bordet (fikar, är på väg): det sägs i walkie-talkien där hen är
  const p = chiefPerson(CHIEFS.indexOf(who));
  if (p && !(chiefAt && inWindow(p) && p.spot.post === 'chief')) {
    const hd = personHead(p);
    at = hd && !hd.hidden ? { x: X(hd.x), y: Y(hd.y) + 11 } : chiefAt;
  }
  if (!at) return;
  bubble(`${who.name}: "${C.say.text}"`, at.x, at.y - 14, C.say.dec ? '#fff6a8' : '#ffffff');
}
// ---------- Panoramahissen fast på fasaden (pano.js) ----------
// Repet från taket ovanför korgen och den som firas ner i sele, eller stegbilen på gatan med stegen rest mot
// korgen och den som klättrar ner. Läget räknas i simuleringen (S.pano) – här ritas bara.
function drawPanoPx() {
  const P = S.pano;
  if (!P || !P.crew) return;
  const e = S.elevators[P.car], cx = X(shaftCX(e.id)), gy = Y(GROUND_Y), carBot = Y(floorY(e.pos));
  const way = P.setup || P.how, rider = P.rider ? S.people.find(p => p.id === P.rider.id) : null, rp = rider ? riderPos(rider) : null;
  if (way === 'ladder') {
    // stegbilen under korgen: hytt, flak och blåljus
    const tx = cx - 44, on = Math.sin(S.anim * 11) > 0;
    box(tx, gy - 12, 34, 10, '#c81e3a'); box(tx + 33, gy - 16, 11, 14, '#c81e3a'); R(tx + 35, gy - 15, 7, 5, '#bfeaff');
    R(tx + 2, gy - 9, 30, 1, '#ffd23f'); text(g, '112', tx + 17, gy - 10, '#ffffff', 'center');
    box(tx + 36, gy - 19, 5, 3, on ? '#3f7cff' : '#1b2a6e');
    for (const wx of [tx + 4, tx + 26, tx + 36]) { R(wx, gy - 3, 5, 3, INK); R(wx + 1, gy - 2, 3, 1, '#5a5a5a'); }
    // stegen reses från flaket mot korgens golv
    const k = P.ph === 'stuck' ? 0 : P.ph === 'rig' ? clamp(1 - (P.t - S.t) / RAISE_T, 0, 1) : 1;
    const x0 = tx + 8, y0 = gy - 13, x1 = Math.round(x0 + (cx - 6 - x0) * k), y1 = Math.round(y0 + (carBot - y0) * k);
    if (k > 0) {
      line(x0, y0, x1, y1, INK); line(x0 + 3, y0, x1 + 3, y1, INK);
      const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 4));
      for (let i = 1; i < n; i++) { const t = i / n; R(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 4, 1, '#d4d0c8'); }
    }
  } else if (way === 'rope' && P.ph !== 'stuck') {
    // blocket på taket ovanför panoramahissen och repet ner till korgen (eller till den som firas ner)
    // (repet hänger mellan fasaden och glasröret, bredvid korgen)
    const rx = X(shaftCX(e.id) + ROPE_DX), ay = Y(floorY(EL[e.id].topF) - CAR_H - 30), k = P.ph === 'rig' ? clamp(1 - (P.t - S.t) / RIG_T, 0, 1) : 1;
    box(rx - 3, ay - 3, 7, 5, '#ffd23f'); R(rx - 6, ay - 6, 13, 2, INK);
    const endY = rp ? Y(rp.y) + 2 : Math.round(ay + (carBot - ay) * k), endX = rp ? X(rp.x) : rx;
    line(rx, ay + 2, endX, endY, '#ff8c42');
    if (!rp && k >= 1) { R(rx - 1, carBot - 2, 3, 2, '#ff8c42'); } // (selen väntar vid korgens dörr)
  }
  // den som är på väg ner: framifrån, i sele (repet) eller med händerna på stegen
  if (rider && rp) {
    const sx = X(rp.x) - PERSON_W / 2, sy = Y(rp.y) + Math.round(Math.sin(S.anim * 3 + rider.id) * (way === 'rope' ? 1 : 0));
    g.drawImage(personSprite(winFig(rider, rider.mood || 0), 'front', 0, 1, { blink: blinkOf(rider) }), sx, sy);
    if (way === 'rope') { R(sx + 2, sy + 11, PERSON_W - 4, 1, '#ff8c42'); R(sx + PERSON_W / 2, sy + 9, 1, 4, '#ff8c42'); }
  }
}
// ---------- Personalrummet: där driftcheferna fikar ----------
// Ett fönster i hallens bakvägg, som kontrollrummet: soffa, bord med korsord, kaffebryggare och kylskåp.
// De som sitter där ritas på sina platser (SPOTS[BREAK], config.js); kaffet ångar när någon är inne.
function breakRoom(top, bot, h) {
  const wx = X(DOOR_X) + 58, ww = Math.min(108, X(INNER_X1) - 14 - wx), wy = top + 18, wh = bot - 3 - wy;
  if (ww < 50) return;
  const lit = S.power || (S.outage && S.outage.gen), who = sitters(BREAK, 'break'), n = nightness(h);
  box(wx - 2, wy - 2, ww + 4, wh + 3, PAL.steel);
  R(wx, wy, ww, wh, lit ? (who.length || n < 0.5 ? '#d9c9a0' : '#a89a78') : '#26221c');
  R(wx, wy, ww, 7, '#000080');
  text(g, 'PERSONALRUM', wx + 3, wy + 1, '#ffffff');
  reserve(wx - 2, wy - 2, ww + 4, 9);
  const fy = wy + wh - 1; // golvet i rummet
  g.save(); g.beginPath(); g.rect(wx, wy + 7, ww, wh - 7); g.clip();
  // tapet, golvlist och golv
  if (lit) for (let x = wx + 3; x < wx + ww; x += 6) R(x, wy + 7, 1, wh - 10, '#cbb98c');
  R(wx, fy - 2, ww, 3, lit ? '#8a6a46' : '#3a2f24');
  const B = SPOTS[BREAK].filter(s => s.brk), sofa = B.filter(s => s.k === 'chair').slice(0, 3), [c1, c2] = B.filter(s => s.k === 'chair').slice(3), fridge = B.find(s => s.k === 'stand');
  // hyllan över soffan med kaffebryggaren och muggarna
  const sa = Math.max(wx + 1, X(sofa[0].x) - 9), sb = X(sofa[sofa.length - 1].x) + 9;
  R(sa + 4, wy + 15, sb - sa - 8, 1, '#6b4a2b');
  const kx = sa + 6;
  box(kx, wy + 8, 6, 7, '#2b2f36'); R(kx + 1, wy + 11, 4, 3, lit ? '#8a5a2b' : '#3a2a1a');
  R(kx + 4, wy + 9, 1, 1, lit && Math.floor(S.anim * 2) % 2 ? '#ff5d52' : '#5a2a2a');
  for (let k = 0; k < 3; k++) R(kx + 9 + k * 4, wy + 12, 2, 3, ['#ffffff', '#ffd23f', '#3f7cff'][k]);
  // en affisch och väggklockan (visar husets klocka) ovanför bordet
  const ax = X(c1.x) + 4, cx = X(c2.x) + 5, cy = wy + 12;
  box(ax, wy + 9, 11, 9, '#fff8e0'); R(ax + 2, wy + 11, 7, 2, '#c81e3a'); R(ax + 2, wy + 14, 5, 1, '#3f7cff'); R(ax + 2, wy + 16, 6, 1, '#9aa3ad');
  R(cx - 2, cy - 3, 5, 7, INK); R(cx - 3, cy - 2, 7, 5, INK); R(cx - 2, cy - 2, 5, 5, '#ffffff');
  const hh = h % 12, a1 = (hh / 12) * Math.PI * 2, a2 = (h % 1) * Math.PI * 2;
  R(cx + Math.round(Math.sin(a1) * 1.2), cy - Math.round(Math.cos(a1) * 1.2), 1, 1, INK);
  R(cx + Math.round(Math.sin(a2) * 2), cy - Math.round(Math.cos(a2) * 2), 1, 1, '#c81e3a'); R(cx, cy, 1, 1, INK);
  // soffryggen (bakom folket) och kylskåpet
  R(sa, fy - 13, sb - sa, 8, INK); R(sa + 1, fy - 12, sb - sa - 2, 7, '#7a3f5a'); R(sa + 1, fy - 12, sb - sa - 2, 1, '#9a5f7a');
  const fx = wx + ww - 8;
  const open = fridge && who.some(p => p.spot === fridge);
  box(fx, fy - 20, 8, 18, '#e8e8e8'); R(fx + 1, fy - 13, 6, 1, '#9aa3ad');
  if (open) { R(fx + 1, fy - 19, 6, 5, lit ? '#fff6c0' : '#8a8a70'); R(fx + 2, fy - 16, 2, 2, '#ff5d52'); } // (dörren står öppen)
  else { R(fx + 6, fy - 18, 1, 3, '#9aa3ad'); R(fx + 6, fy - 10, 1, 4, '#9aa3ad'); }
  // folket: sittande i soffan och vid bordet, stående vid kylskåpet
  for (const p of who) {
    const sp = p.spot, sit = sp.k !== 'stand', dir = sp.face || 1, w = winPos(p);
    const spr = personSprite(winFig(p, 0), 'side', 0, dir, { blink: Math.sin(S.anim * 0.7 + p.id) > 0.97 });
    g.drawImage(spr, X(w.x) - PERSON_W / 2, Y(w.y) + (sit ? Math.round(Math.sin(S.anim * 1.3 + p.id) * 0.4) : 0));
    // ångan ur koppen
    if (sit && lit && Math.sin(S.anim * 2 + p.id) > -0.3) {
      const ux = X(sp.x) + dir * 6, uy = fy - 13 - (Math.floor(S.anim * 4 + p.id) % 3);
      R(ux, uy, 1, 1, 'rgba(255,255,255,.7)');
    }
  }
  // soffans sits och armstöd framför benen, och bordet mellan stolarna
  R(sa, fy - 6, sb - sa, 5, INK); R(sa + 1, fy - 5, sb - sa - 2, 3, '#9a5f7a');
  R(sa, fy - 10, 3, 9, INK); R(sb - 3, fy - 10, 3, 9, INK);
  const ta = X(c1.x) + 5, tb = X(c2.x) - 5;
  R(ta, fy - 8, tb - ta, 2, '#6b4a2b'); R(ta + 1, fy - 6, 1, 5, '#6b4a2b'); R(tb - 2, fy - 6, 1, 5, '#6b4a2b');
  R(ta + 2, fy - 10, 5, 2, '#f4f1e8'); R(tb - 4, fy - 11, 2, 3, '#ffffff'); // korsordet och en kopp
  R(X(c1.x) - 3, fy - 6, 1, 5, '#3a3f48'); R(X(c2.x) + 3, fy - 6, 1, 5, '#3a3f48'); // stolsbenen
  if (!lit) R(wx, wy + 7, ww, wh - 7, 'rgba(0,0,0,.35)');
  g.restore();
  line(wx + 3, wy + wh - 2, wx + 9, wy + 8, 'rgba(255,255,255,.12)');
}
// ---------- Flyttdagen ----------
/** hissbalken: balken på taket med block och talja, kroken (med lasten) och lastluckorna i tornets fasad */
function drawHoistPx() {
  if (!HOIST_OK || !S.hoist) return;
  const H = S.hoist, M = S.move, wall = X(UX1 + 7), wind = S.storm ? windAt() : 0;
  // lastluckorna: en liten dörr i fasaden på varje bostadsvåning (öppen när kroken är där)
  for (const f of HATCH_FLOORS) {
    const yy = Y(floorY(f)) - 1;
    if (yy < -40 || yy > lo.height + 40) continue;
    const open = M && M.state === 'on' && M.floor === f && (H.phase === 'fetch' || H.phase === 'hook' || M.items.some(it => it.st === 'hatch'));
    R(wall - 6, yy - 22, 7, 22, INK); R(wall - 5, yy - 21, 5, 21, open ? '#2b2f36' : '#8a5a2b');
    if (!open) R(wall - 2, yy - 11, 1, 2, '#ffd23f');
    // möbler som står och väntar i luckan
    if (open && M) {
      const wait = M.items.find(it => it.st === 'hatch');
      const cg = wait ? cargoSprite(wait.sprite, -1) : null;
      if (cg) g.drawImage(cg.c, wall - 8 - cg.c.width + 4, yy - cg.c.height + 1);
    }
  }
  // terrassen: det som väntar på panoramahissen
  if (M && M.state === 'on') {
    const ty = Y(TERRACE_Y) - 2;
    let x = X(BX1) - 30;
    for (const it of M.items.filter(i => i.st === 'terrace')) {
      const cg = cargoSprite(it.sprite, 1); if (!cg) continue;
      g.drawImage(cg.c, x - cg.c.width, ty - cg.c.height + 1); x -= cg.c.width + 3;
    }
    const mona = S.people.find(p => p.role === 'lastare' && inWindow(p));
    if (mona) g.drawImage(personSprite(winFig(mona, 0), 'side', 0, 1, { blink: blinkOf(mona) }), X(BX1) - 22, ty - PERSON_H + 1);
  }
  if (H.phase === 'idle') return;
  // balken: en gul bom ut från taket med blocket längst ut
  const ay = Y(ROOF_Y - 10), bx0 = wall - 6, bx1 = wall + 34;
  const out = H.phase === 'rig' ? clamp(H.t / 4, 0, 1) : H.phase === 'unrig' && H.y <= PARK_Y + 1e-6 ? clamp(1 - H.t / 4, 0, 1) : 1;
  const tip = Math.round(bx0 + (bx1 - bx0) * out);
  R(bx0, ay - 13, tip - bx0 + 2, 4, INK); R(bx0 + 1, ay - 12, tip - bx0, 2, '#ffd23f');
  for (let x = bx0 + 3; x < tip - 2; x += 6) R(x, ay - 12, 2, 2, INK);
  R(tip - 2, ay - 10, 5, 5, INK); R(tip - 1, ay - 9, 3, 3, PAL.steel); // blocket
  if (out < 1) return;
  // linorna (talja: två parter) och kroken – svänger i blåsten
  const sway = Math.round(Math.sin(S.anim * 2.1) * wind * 8);
  const hy = Y(H.y), hx = tip + sway;
  if (hy < -60 || ay > lo.height + 60) return;
  line(tip - 1, ay - 7, hx - 1, hy - 8, '#3a3f4a'); line(tip + 1, ay - 7, hx + 1, hy - 8, '#3a3f4a');
  R(hx - 2, hy - 9, 5, 4, INK); R(hx - 1, hy - 8, 3, 2, PAL.steel); // underblocket
  R(hx, hy - 5, 1, 3, INK); R(hx - 1, hy - 3, 1, 1, INK); // kroken
  const it = H.item !== null && M ? M.items[H.item] : null;
  if (it) {
    const cg = cargoSprite(it.sprite, 1);
    if (cg) {
      const lx = hx - Math.round(cg.c.width / 2), ly = hy + 2;
      line(hx, hy - 2, lx + 1, ly, '#ff8c42'); line(hx, hy - 2, lx + cg.c.width - 2, ly, '#ff8c42'); // lyftstroppar
      g.drawImage(cg.c, lx, ly);
    }
  }
  if (H.halted && Math.sin(S.anim * 5) > -0.2) label(H.halted === 'blåst' ? 'VINDSTOPP' : 'STOPP', hx, hy - 24, '#ff5d52', '#ffffff');
}

/** det som står packat i trapphallen utanför lägenheten och det som väntar vid flyttbilen på lastkajen */
function drawMovePilesPx() {
  const M = S.move;
  if (!M || M.state !== 'on') return;
  movePile(DOCK, M.items.filter(it => it.st === 'dock'));
  movePile(M.floor, M.items.filter(it => it.st === 'home'));
}
function movePile(f, items) {
  if (!items.length) return;
  const fy = Y(surf(f)), top = Y(floorY(f + 1) + 4);
  if (fy < 0 || top > lo.height) return;
  let x = X(DOOR_X) + 20;
  const show = items.slice(0, 4);
  for (const it of show) {
    const cg = cargoSprite(it.sprite, 1); if (!cg) continue;
    g.drawImage(cg.c, x, fy - cg.c.height + 1);
    x += cg.c.width + 2;
  }
  if (items.length > show.length) text(g, `+${items.length - show.length}`, x + 2, fy - 8, '#ffffff', 'left', 1, INK);
}
// ---------- Tunnelbanan ----------
// Spåret ligger längs perrongens bakvägg mellan två tunnelmynningar; tåget är längre än perrongens synliga
// del, så bara mitten syns. Allt läses ur S.train (simuleringen) – här ritas bara.
const TRAIN_BODY = '#b8c0cc', TRAIN_STRIPE = '#2a5db0', TRAIN_GLASS = '#26324a';
function drawPlatformPx(top, bot, h) {
  const tx0 = X(TRAIN_X0), tx1 = X(TRAIN_X1), ty0 = bot - 26, ty1 = bot - 3;
  // spårgropen och tunnelväggen bakom, med kakel ovanför
  R(tx0 - 4, ty0 - 2, tx1 - tx0 + 6, ty1 - ty0 + 2, '#1e2430');
  for (let x = tx0 - 4; x < tx1 + 2; x += 6) R(x, ty0 - 2, 1, ty1 - ty0 + 2, '#262d3b');
  for (let x = tx0 - 4; x < tx1 + 2; x += 4) for (let y = top + 28 - 9; y < ty0 - 2; y += 3) R(x, y, 3, 2, (x + y) % 7 ? '#d9e2ec' : '#c3cfdc');
  const T = S.train;
  if (T) {
    const doors = trainDoors(T);
    g.save(); g.beginPath(); g.rect(tx0, ty0 - 1, tx1 - tx0, ty1 - ty0 + 1); g.clip();
    // tåget: vagnar à 70 världsenheter, nosen långt bort i tunneln åt båda hållen
    const x0 = X(T.x - 160), x1 = X(T.x + TRAIN_LEN + 160), y0 = ty0 + 1, y1 = ty1 - 1;
    R(x0, y0, x1 - x0, y1 - y0, INK); R(x0, y0 + 1, x1 - x0, y1 - y0 - 2, TRAIN_BODY);
    R(x0, y0 + 1, x1 - x0, 1, light(TRAIN_BODY, 0.4));
    R(x0, y1 - 7, x1 - x0, 2, TRAIN_STRIPE);
    // vagnskarvar och fönster
    for (let wx = X(T.x - 140); wx < x1; wx += 35) R(wx, y0, 1, y1 - y0, dark(TRAIN_BODY, 0.45));
    for (let wx = X(T.x - 160) + 3; wx < x1 - 4; wx += 7) {
      R(wx, y0 + 4, 5, 6, TRAIN_GLASS);
      if (S.power || nightness(h) < 0.5) R(wx, y0 + 4, 5, 1, '#ffe9a8');
    }
    // dörrarna glider isär när tåget står inne
    for (const d of TRAIN_DOORS) {
      const cx = X(T.x + d * TRAIN_LEN), gap = Math.round(doors * 3);
      R(cx - 4, y0 + 2, 8, y1 - y0 - 3, dark(TRAIN_BODY, 0.18));
      R(cx - 4, y0 + 3, 3, 7, TRAIN_GLASS); R(cx + 1, y0 + 3, 3, 7, TRAIN_GLASS);
      if (gap) R(cx - gap, y0 + 2, gap * 2, y1 - y0 - 3, '#ffe9a8');
      R(cx, y0 + 2, 1, y1 - y0 - 3, INK);
    }
    // hjulen
    for (let wx = X(T.x - 150); wx < x1; wx += 35) { R(wx + 4, y1 - 1, 4, 2, INK); R(wx + 26, y1 - 1, 4, 2, INK); }
    g.restore();
  }
  // tunnelmynningarna (ovanpå tåget, så att det glider in och ut ur mörkret)
  for (const [mx, w] of [[tx0 - 6, 6], [tx1, 4]]) {
    R(mx, ty0 - 4, w, ty1 - ty0 + 4, '#0d1018');
    R(mx, ty0 - 5, w, 1, INK);
  }
  // perrongkanten med gul linje
  R(tx0 - 6, ty1, tx1 - tx0 + 10, 1, '#ffd23f'); R(tx0 - 6, ty1 + 1, tx1 - tx0 + 10, 1, INK);
  // avgångsskylten: DOS-svart med gul text (ingen klocka – bara minuter kvar i speltid)
  const m = nextTrainMin(), msg = m === null ? 'INGA FLER TÅG' : T ? (T.state === 'in' ? 'TÅGET KOMMER' : T.state === 'stop' ? 'STIG PÅ!' : 'AVGÅR') : `TÅG OM ${m} MIN`;
  const bw = textW(msg) + 6, bx = tx1 - bw, by = top + 16;
  box(bx, by, bw, 9, '#101418'); text(g, msg, bx + 3, by + 2, m === null ? '#ff5d52' : '#ffd23f');
}
function stairSign(f, glow) {
  const x = X(DOOR_X) + 19, y = Y(floorY(f + 1) + 4) + 24;
  reserve(x, y, 33, 9);
  if (glow) R(x - 2, y - 2, 37, 13, 'rgba(34,197,94,.45)');
  pill(x, y, 33, 9, PAL.green);
  g.drawImage(STAIR_ICON(), x + 2, y + 2);
  text(g, 'TRAPPA', x + 9, y + 1, '#ffffff');
}
function floorOverlays(f, h) {
  const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) - 4), x0 = X(LAND_X0), x1 = X(INNER_X1);
  const NO_DIM = ['lobby', 'apartments', 'roof', 'garage', 'dock', 'station'];
  const th = FL[f].theme, n = nightness(h);
  if (!NO_DIM.includes(th) && floorOpen(f, h)) {
    if (n > 0.05 && !OCC[f]) R(x0, top, x1 - x0, bot - top, `rgba(10,6,34,${0.45 * n})`);
  }
  if (f !== LOBBY && !FL[f].open && !floorOpen(f, h)) {
    const someone = S.people.some(p => p.floor === f && (p.state === 'office' || p.state === 'exiting'));
    R(x0, top, x1 - x0, bot - top, `rgba(10,6,34,${someone ? 0.38 : 0.62})`);
  }
  if (th !== 'roof') nightLight(f, th, x0, x1, top, bot, n);
  if (S.fire) {
    const on = Math.sin(S.anim * 10) > 0;
    box(x1 - 10, top + 3, 5, 5, on ? '#ff2d55' : '#7a2033');
    if (on) R(x1 - 12, top + 1, 9, 9, 'rgba(255,45,85,.3)');
    if (S.fire.mode === 'zone' && !allowed(f)) R(x0, top, x1 - x0, bot - top, 'rgba(255,45,85,.08)');
    if (f === S.fire.floor) {
      const F = S.fire, prog = fireProg(F);
      R(x0, top, x1 - x0, bot - top, `rgba(255,100,20,${(0.2 + 0.08 * Math.sin(S.anim * 7)) * (1 - prog * 0.85)})`);
      if (prog < 0.9) {
        const fr = FLAMES();
        [DOOR_X - 10, DOOR_X + 10, DOOR_X + 46].forEach((wx, i) => g.drawImage(fr[(Math.floor(S.anim * 9) + i) % 3], X(wx) - 6, bot - 13 - (i === 1 ? 4 : 0)));
      }
    }
  }
}

// ---------- Hissarna ----------
/** korgens läge i lågupplösta pixlar, null om den är utanför bilden */
function carGeom(e) {
  // nivåfel: korgen står en aning för lågt eller högt när linorna töjer sig (överdrivet så att det syns)
  const lv = (e.level || 0) * 2.5 + (e.mode === 'broken' && e.fault && e.fault.kind === 'level' ? Math.sin(S.anim * 9) * 0.03 : 0);
  const x = X(shaftX(e.id) + 4), cw = CAR_W / PX, chh = CAR_H / PX;
  const ybOf = k => Y(floorY(e.pos + k + lv) - 4);
  const top = e.deck2 ? 1 : 0, yb = ybOf(0), yt = ybOf(top) - chh; // yt = överkanten på den översta korgen
  if (yt > lo.height + 40 || yb < -40) return null;
  return { x, cw, chh, ybOf, top, yb, yt };
}
/** motvikt och bärlinor: ritas före våningsdisplayerna (som sitter framför schakten) och korgarna */
function drawRopesPx(e) {
  const G = carGeom(e);
  if (!G || e.facade) return;
  const { x, cw, yt } = G;
  {
    // motvikt och bärlinor – i stormen svänger linorna i de höga schakten
    const span = Math.max(1, e.maxF - e.minF), frac = (e.pos - e.minF) / span;
    const st = Y(shaftTop(e)), sb = Y(shaftBot(e)), cwH = 23, cwX = X(shaftX(e.id) + SHAFT_W - 15);
    const cut = ropesCut(e);
    // linbrott: motvikten har rasat ner på sin buffert i schaktets botten
    const cwY = cut === null ? Math.round(st + 4 + frac * (sb - st - cwH - 8)) : sb - cwH - 4;
    if (cut !== null) {
      // avslitna linor hänger från taket (under linbytet blir de nya längre och längre)
      const end = Math.round(st + (yt - 4 - st) * cut);
      R(cwX + 2, st, 1, Math.round((cwY - st) * 0.2), INK); frayed(cwX + 2, st + Math.round((cwY - st) * 0.2));
      for (const dx of [-6, -2, 2, 6]) { R(x + cw / 2 + dx, st, 1, end - st, INK); if (end < yt - 6) frayed(x + cw / 2 + dx, end); }
      box(cwX, cwY, 5, cwH, PAL.basement); for (let k = 1; k < 5; k++) R(cwX + 1, cwY + k * 4, 3, 1, '#4a4170');
      // linfästet på korgtaket med stumparna kvar
      R(x + cw / 2 - 9, yt - 4, 19, 1, INK); R(x + cw / 2 - 9, yt - 4, 1, 4, INK); R(x + cw / 2 + 9, yt - 4, 1, 4, INK);
      if (cut < 0.99) for (const dx of [-6, 6]) { R(x + cw / 2 + dx, yt - 7, 1, 3, INK); frayed(x + cw / 2 + dx, yt - 8, -1); }
      return;
    }
    const ropeFault = e.mode === 'broken' && e.fault && e.fault.kind === 'rope';
    const amp = exposure(e) * Math.max(0, windAt() - 0.3) * 7 + (ropeFault ? 1.5 : 0);
    const sway = y => (amp ? Math.round(Math.sin((y + CY) / 23 + S.anim * 2.3) * amp * Math.sin(Math.PI * (y - st) / Math.max(1, yt - st))) : 0);
    if (amp) for (let y = st; y < cwY; y++) R(cwX + 2 + sway(y), y, 1, 1, INK); else R(cwX + 2, st, 1, cwY - st, INK);
    box(cwX, cwY, 5, cwH, PAL.basement); for (let k = 1; k < 5; k++) R(cwX + 1, cwY + k * 4, 3, 1, '#4a4170');
    for (const dx of [-6, -2, 2, 6]) {
      if (amp) for (let y = st; y < yt - 4; y++) R(x + cw / 2 + dx + sway(y), y, 1, 1, INK);
      else R(x + cw / 2 + dx, st, 1, yt - st, INK);
    }
    R(x + cw / 2 - 9, yt - 4, 19, 1, INK); R(x + cw / 2 - 9, yt - 4, 1, 4, INK); R(x + cw / 2 + 9, yt - 4, 1, 4, INK);
    // linorna slår i schaktväggen i stormen
    if (amp > 3.5 && Math.sin(S.anim * 3.1 + e.id * 1.3) > 0.85) {
      const sy = Math.round(st + (yt - st) * 0.45);
      for (let n = 0; n < 4; n++) R(x - 2 + Math.round(vrand(0, 3)), sy + Math.round(vrand(-4, 4)), 1, 1, vpick(['#ffffff', '#ffd23f']));
      label('SMACK!', x - 4, sy - 4, '#ffffff', INK);
    }
    // förvarning: slitna linor fransar sig och knarrar
    if (e.creak) {
      const fy = Math.round(st + (yt - st) * 0.5);
      for (const dx of [-6, -2, 2, 6]) { R(x + cw / 2 + dx - 1, fy, 3, 1, '#c9a26b'); if (Math.sin(S.anim * 5 + dx) > 0.5) R(x + cw / 2 + dx + 1, fy + 1, 1, 1, '#c9a26b'); }
      if (Math.sin(S.anim * 2.7) > 0.3) label('KNARR…', x + cw / 2, fy - 10, '#ffe9a8', INK);
    }
  }
}
/** Ett hissfel syns på sitt sätt: rök ur motorn, ERR på styrkortet, gnistor från bromsen, nivåpilar –
 *  och vid ett fel mellan två våningar sitter folk fast med nödljuset tänt och knackar */
function faultPx(e, x, cw, chh, yt, yb) {
  const F = e.fault, kind = F ? F.kind : '';
  if (F && F.trapped) {
    R(x + 2, yt + 2, cw - 4, chh - 4, 'rgba(255,214,120,.14)'); R(x + Math.round(cw / 2) - 2, yt + 1, 5, 1, '#ffe9a8');
    if (Math.sin(S.anim * 4 + e.id) > 0) label('INSTÄNGDA!', x + cw / 2, yt - 11, '#ffffff', '#ff2d55');
    else if (Math.sin(S.anim * 2.3 + e.id) > 0.4) label('KNACK KNACK', x + cw / 2, yt + chh / 2, '#ffffff', INK);
    else label('FEL!', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  } else if (Math.sin(S.anim * 6) > -0.4) label('FEL!', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  if (kind === 'motor') for (let i = 0; i < 3; i++) { const k = (S.anim * 0.7 + i / 3) % 1; g.globalAlpha = (1 - k) * 0.6; g.drawImage(PUFF(2 + Math.round(k * 3)), x + cw / 2 - 4 + i * 3, yt - 8 - Math.round(k * 14)); g.globalAlpha = 1; }
  if (kind === 'board' && Math.sin(S.anim * 8) > 0) label('ERR 0x1F', x + cw / 2, yt + chh / 2 - 4, '#7cf06b', INK);
  if (kind === 'brake' && Math.sin(S.anim * 9) > 0.2) for (const sx of [x - 2, x + cw + 1]) for (let n = 0; n < 3; n++) R(sx + Math.round(vrand(-1, 1)), yb - Math.round(vrand(2, chh - 2)), 1, 1, vpick(['#ffd23f', '#ffffff', '#ff9f1c']));
  if (kind === 'level') { const up = Math.sin(S.anim * 3) > 0; text(g, up ? '▲' : '▼', x + cw + 3, yt + chh / 2 - 3, '#ffe14d', 'left', 1, INK); }
}
/** Linbrott: hur långt ner i schaktet linorna når (0–1 av vägen till korgen), null = hela linor */
function ropesCut(e) {
  if (e.mode === 'snapped') return 0.22;
  if (e.mode !== 'broken' || !e.fault || !e.fault.cable) return null;
  const t = techOf(e), on = t && t.state === 'office' && t.floor === e.fault.exitF;
  return 0.22 + 0.78 * (on ? Math.min(1, t.workT / e.fault.need) : 0);
}
/** en fransig linända (dir = 1 nedåt, -1 uppåt) */
function frayed(x, y, dir = 1) { R(x - 1, y + dir, 1, 1, INK); R(x + 1, y + dir, 1, 1, INK); R(x, y + 2 * dir, 1, 1, '#7a6f9a'); }
/** Linbrott: gnistor från fångapparaten, takluckan, stegen upp till schaktdörren och teknikern på korgtaket */
function drawCableRescue(e, G) {
  const { x, cw, yt, yb } = G;
  const s = e.snap, F = e.mode === 'broken' && e.fault && e.fault.cable ? e.fault : null;
  if (!s && !F) return;
  // gnistor längs styrskenorna medan korgen faller och en kort stund efter att fångapparaten tog
  if (s && (s.ph === 'fall' || S.t - s.caughtT < 1.2)) {
    for (const sx of [x - 2, x + cw + 1]) for (let n = 0; n < 5; n++)
      R(sx + Math.round(vrand(-2, 2)), yb - Math.round(vrand(0, 10)) - (s.ph === 'fall' ? Math.round(vrand(0, 14)) : 0), 1, 1, vpick(['#ffd23f', '#ffffff', '#ff9f1c', '#ff5d52']));
  }
  const exitF = s ? s.exitF : F.exitF, top = Y(floorY(exitF) - 4);
  const t = techOf(e), here = t && t.state === 'office' && t.floor === exitF ? t : null;
  // avspärrning vid schaktdörren på våningen ovanför
  if (here || F) for (let k = 0; k < cw; k += 4) R(x + k, top - 18, 2, 2, (k / 4) % 2 ? INK : '#ffd23f');
  const evac = s && s.ph === 'evac';
  if (!evac && !here) return;
  // takluckan står öppen
  const hx = x + Math.round(cw / 2) - 14;
  R(hx, yt - 1, 8, 2, INK); R(hx + 1, yt - 4, 1, 3, '#8a8f99');
  // stegen från korgtaket upp till schaktdörren
  const lx = x + cw - 10;
  // (kraftiga sidostänger med kontur – en tunn linje syns inte när man scrollar snabbt)
  if (top < yt - 2) {
    for (const sx of [lx - 1, lx + 4]) { R(sx - 1, top, 4, yt - top, INK); R(sx, top, 2, yt - top, '#e0b83a'); }
    for (let y = top + 2; y < yt - 1; y += 4) { R(lx + 1, y - 1, 3, 3, INK); R(lx + 1, y, 3, 1, '#e0b83a'); }
  }
  // teknikern på korgtaket (med pannlampa); vid linbytet står hen och drar i de nya linorna
  if (here) {
    const px = x + Math.round(cw / 2) - PERSON_W / 2 + (evac ? 2 : (Math.sin(S.anim * 2) > 0 ? 1 : 0)), py = yt - 1 - PERSON_H;
    g.drawImage(personSprite(here, 'front', 0, 1, { blink: blinkOf(here) }), px, py);
    R(px + PERSON_W / 2, py + 2, 1, 1, '#fff6a8');
    phoneOn(here, px, py);
    if (!evac && Math.sin(S.anim * 9 + e.id) > 0.4) for (let n = 0; n < 3; n++) R(px - 2 - Math.round(vrand(0, 3)), py + 6 + Math.round(vrand(0, 5)), 1, 1, vpick(['#ffd23f', '#ffffff']));
  }
  // den som är på väg ut klättrar uppför stegen
  const c = evac ? climber(e) : null;
  if (c && top < yt) {
    const k = clamp(1 - (s.nextOut - S.t) / s.climb, 0, 1), py = Math.round(yt - PERSON_H - (yt - top) * k);
    g.drawImage(personSprite(c, 'front', 0, 1, { blink: blinkOf(c) }), lx - 2, py);
  }
}
/** den som klättrar ut genom takluckan just nu (ritas på stegen, inte i korgen) */
const climber = e => (e.snap && e.snap.ph === 'evac' && S.t > e.snap.nextOut - e.snap.climb * 0.7 ? nextOut(e) : null);
function drawCarPx(e) {
  const G = carGeom(e);
  if (!G) return;
  const { x, cw, chh, ybOf, top, yb, yt } = G;
  const off = e.off || e.mode === 'locked' || e.sleep || e.zoneLock || e.mode === 'broken' || e.mode === 'snapped' || e.mode === 'service' || e.hold || e.hot || e.windLock;
  const body = off ? PAL.carOff : e.color;
  // dubbeldäck: ramen mellan korgarna
  if (e.deck2) {
    const y0 = ybOf(1), y1 = yb - chh;
    R(x, y0 - 1, cw, y1 - y0 + 2, INK); R(x + 1, y0, cw - 2, y1 - y0, dark(body, 0.35));
    for (let k = 0; k < cw - 8; k += 8) { line(x + 2 + k, y0, x + 8 + k, y1 - 1, dark(body, 0.6)); line(x + 8 + k, y0, x + 2 + k, y1 - 1, dark(body, 0.6)); }
  }
  for (let k = 0; k <= top; k++) cabinPx(e, k, x, ybOf(k), body, k === top);
  drawCableRescue(e, G);
  if (VIEW.follow === e.id) ants(x - 3, yt - 3, cw + 6, yb - yt + 6, '#7dff9a');
  if (e.overloadFlash > 0) { if (Math.sin(S.anim * 18) > -0.2) label('ÖVERLAST!', x + cw / 2, yt - 11, '#ff2d55', '#ffffff'); }
  else if (e.fullFlash > 0) label('FULLT!', x + cw / 2, yt - 11, '#ffffff', '#ff2d55');
  if (e.off) label('UR DRIFT', x + cw / 2, yt + chh / 2 - 4, '#ffe14d');
  if (e.sleep) for (let i = 0; i < 3; i++) {
    const k = (S.anim * 0.5 + i / 3) % 1;
    g.globalAlpha = 1 - k; text(g, 'Z', x + cw / 2 + 3 + Math.round(k * 7), yt - 3 - Math.round(k * 13), '#bfeaff', 'left', i === 2 ? 2 : 1, INK); g.globalAlpha = 1;
  }
  if (e.zoneLock) label('SPÄRRAD', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  if (e.mode === 'locked') label('AVSTÄNGD', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  if (e.mode === 'recall') label(`→ TILL ${fl(e.home)}`, x + cw / 2, yt - 11, '#ff8c42');
  if (e.mode === 'rescue') label('NÖDSÄNK', x + cw / 2, yt - 11, '#7dff9a');
  if (e.mode === 'normal' && S.power && e.restartAt && S.t < e.restartAt) label('OMSTART', x + cw / 2, yt - 11, '#7dff9a');
  if (e.mode === 'lift' || e.liftWant) label(e.mode === 'lift' ? 'FLYTTLASS' : '→ FLYTTLASS', x + cw / 2, yt - 11, '#ff8c42');
  if (e.mode === 'snapped') { if (Math.sin(S.anim * 7) > -0.3) label('LINBROTT!', x + cw / 2, yt + chh / 2 - 4, '#ff2d55', '#ffffff'); }
  if (e.mode === 'broken' && e.fault && e.fault.cable) label('LINBYTE', x + cw / 2, yt + chh / 2 - 4, '#ffd23f');
  else if (e.mode === 'broken') { faultPx(e, x, cw, chh, yt, yb); }
  // förvarning: det gnisslar och hackar i korgen
  if (S.warn && S.warn.type === 'fault' && S.warn.car === e.id && e.mode === 'normal') {
    if (Math.sin(S.anim * 6) > 0) label('GNISSEL…', x + cw / 2, yt - 11, '#ffe9a8', INK);
    if (Math.sin(S.anim * 13) > 0.6) for (let n = 0; n < 2; n++) R(x - 1 + (n ? cw + 1 : 0), yt + Math.round(vrand(4, chh - 4)), 1, 1, '#ffd23f');
  }
  if (e.mode === 'service') label(e.serviceAsap ? 'NIVÅJUSTERING' : 'SERVICE', x + cw / 2, yt - 11, '#ffd23f');
  if (e.hold && e.mode === 'normal') label('→ SERVICE', x + cw / 2, yt - 11, '#ffd23f');
  if (e.mode === 'normal' && !e.hold) {
    if (e.hot) { if (Math.sin(S.anim * 5) > -0.3) label('ÖVERHETTAD!', x + cw / 2, yt - 11, '#ff5d52', '#ffffff'); }
    else if (e.windLock) label('STÄNGD – STORM', x + cw / 2, yt - 11, '#5b8fb9', '#ffffff');
    else if (e.ffCar) label('BRANDHISS', x + cw / 2, yt - 11, '#ffffff', '#c81e3a');
    else if (e.indep) label('FLYTT · NYCKEL', x + cw / 2, yt - 11, '#d4a017');
    else if (e.medicHold) label('AMBULANS · VÄNTAR', x + cw / 2, yt - 11, '#2ec4b6');
    else if (e.heat >= WARM_AT && e.state === 'moving') label('VARM', x + cw / 2, yt - 11, '#ff8c42');
  }
  // en stamgäst i korgen som pratar
  const talker = e.passengers.find(talking);
  if (talker) speech(talker, x + cw / 2, yt - 23);
}
/** En korg (dubbeldäck: k = 0 nedre, 1 övre) med sina passagerare och dörrar. head = översta korgen (namn och våg). */
function cabinPx(e, k, x, yb, body, head) {
  const cw = CAR_W / PX, chh = CAR_H / PX, yt = yb - chh;
  R(x, yt + (e.facade ? 2 : 0), cw, chh - (e.facade ? 2 : 0), INK);
  if (e.facade) { R(x + 2, yt, cw - 4, 2, INK); R(x + 1, yt + 1, cw - 2, 1, INK); }
  R(x + 1, yt + 1, cw - 2, chh - 2, body);
  R(x + 1, yt + 1, cw - 2, 1, light(body, 0.4)); R(x + 1, yb - 2, cw - 2, 1, dark(body, 0.3));
  const ix = x + 2, iy = yt + 9, iw = cw - 4, ih = chh - 11; // överkanten (9 px) har namn och våg
  R(ix - 1, iy - 1, iw + 2, ih + 2, INK);
  const inner = e.facade ? PAL.cabinGlass : e.freight ? PAL.cabinFreight : PAL.cabin;
  R(ix, iy, iw, ih, inner);
  R(ix, iy + ih - 6, iw, 6, dark(inner, 0.12));
  if (e.freight && S.move && S.move.state === 'on' && S.move.blankets) {
    // flyttdag: väggarna kläs med blå skyddsfiltar (hela flytten, även när hissen inte är låst)
    R(ix, iy, iw, ih - 6, '#3f5f9f');
    for (let yy = 0; yy < ih - 6; yy += 6) for (let xx = (yy / 6) % 2 ? 3 : 0; xx < iw; xx += 6) R(ix + xx, iy + yy, 3, 3, '#5577b8');
  } else if (e.freight) for (let n = 0; n < 4; n++) R(ix, iy + 5 + n * 8, iw, 1, 'rgba(27,16,51,.18)');
  else for (let n = 1; n < 4; n++) R(ix + n * Math.round(iw / 4), iy, 1, ih - 6, dark(inner, 0.08));
  if (e.facade) { line(ix + 3, iy + ih - 3, ix + 10, iy + 3, '#ffffff'); line(ix + 7, iy + ih - 3, ix + 14, iy + 3, '#ffffff'); }
  // passagerarna: hörnen först (hissetikett), bakre raden först
  g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
  const out = climber(e);
  const ps = e.passengers.filter(p => (!e.deck2 || (p.deck || 0) === k) && p !== out);
  const order = ps.map((p, i) => ({ p, s: carSlot(i) })).sort((a, b) => Number(a.s >= 4) - Number(b.s >= 4));
  for (const { p, s } of order) {
    // bakre raden står högre upp och lite i skugga, så att huvudena syns ovanför främre raden
    const back = s < 4, px = x + Math.round(carSlotX(s) / PX) - PERSON_W / 2 + (back ? 0 : 2), py = yb - (back ? 7 : 1) - PERSON_H;
    if (back) g.filter = 'brightness(0.82)';
    // last (städvagn, paketkärra, flyttlåda, bår …) står bredvid ägaren – resväskan bakom, resten framför
    // (lasten vänds in mot korgens mitt, annars klipps den av väggen)
    const cx = px + PERSON_W / 2, cy = py + PERSON_H - 1; // (fötterna, som i hallen)
    const cg = p.cargo && !DOGS[p.cargo.kind] ? cargoSprite(p.cargo.kind, cx > ix + iw / 2 ? -1 : 1) : null;
    if (cg && p.cargo.kind === 'resväska') g.drawImage(cg.c, cx + cg.dx, cy - cg.c.height + 1 - cg.lift);
    g.drawImage(personSprite(p, 'front', 0, 1, { blink: blinkOf(p), hot: hotOf(p) }), px, py);
    if (cg && p.cargo.kind !== 'resväska') g.drawImage(cg.c, cx + cg.dx, cy - cg.c.height + 1 - cg.lift);
    g.filter = 'none';
    phoneOn(p, px, py);
  }
  // pudlar i korgen sitter längst fram vid matte/husses fötter
  for (const { p, s } of order) {
    const dog = p.cargo ? DOGS[p.cargo.kind] : null; if (!dog) continue;
    const d = cargoSprite(dog + 'F', 1); if (!d) continue;
    const px = x + Math.round(carSlotX(s) / PX) + 2, py = yb - 1 - d.c.height;
    g.drawImage(d.c, px, py);
    if (Math.sin(S.anim * 0.8 + p.id * 2.3) > 0.97) bark(px + 4, py);
  }
  // flyttlasset från terrassen (panoramahissen i lastläge)
  if (k === 0 && e.mode === 'lift' && S.hoist && S.hoist.liftItem !== null && S.move) {
    const cg = cargoSprite(S.move.items[S.hoist.liftItem].sprite, 1);
    if (cg) g.drawImage(cg.c, x + Math.round((cw - cg.c.width) / 2), yb - 1 - cg.c.height);
  }
  // hissteknikern står i den öppna korgen och skruvar
  const fixer = k === 0 && (e.mode === 'broken' || e.mode === 'service') && e.techId !== null ? S.people.find(p => p.id === e.techId && p.state === 'office' && p.floor === e.floor) : null;
  if (fixer) {
    const px = x + Math.round(cw / 2) - PERSON_W / 2 + (Math.sin(S.anim * 3) > 0 ? 1 : 0), py = yb - 1 - PERSON_H;
    g.drawImage(personSprite(fixer, 'front', 0, 1, { blink: blinkOf(fixer) }), px, py);
    phoneOn(fixer, px, py);
    // gnistor från verktyget
    if (Math.sin(S.anim * 11 + e.id) > 0.3) for (let n = 0; n < 3; n++) R(px + PERSON_W + 1 + Math.round(vrand(0, 4)), py + 10 + Math.round(vrand(0, 6)), 1, 1, vpick(['#ffd23f', '#ffffff', '#ff9f1c']));
  }
  g.restore();
  // dörrarna är av tonat glas, så att man ser vilka som åker med
  // dörrfel: dörrarna slår upp och igen
  const flap = e.mode === 'broken' && e.fault && e.fault.kind === 'door' && !e.fault.trapped;
  const half = iw / 2, open = Math.round(half * (1 - (flap ? 0.5 + 0.5 * Math.sin(S.anim * 7) : e.door)));
  if (open > 0) for (const side of [0, 1]) {
    const px = side ? ix + iw - open : ix;
    R(px, iy, open, ih, PAL.doorGlass);
    R(px, iy + ih - 7, open, 7, PAL.doorLow);
    R(px, iy, open, 1, PAL.doorTop);
    R(side ? px : px + open - 1, iy, 1, ih, PAL.doorEdge);
    if (open > 4) R(side ? px + 2 : px + open - 3, iy + 3, 1, Math.min(10, ih - 12), 'rgba(255,255,255,.6)');
  }
  if (e.sleep) R(ix, iy, iw, ih, 'rgba(20,14,60,.45)');
  const sh = dark(body, 0.65);
  if (!head) { text(g, k ? 'ÖVRE DÄCK' : 'NEDRE DÄCK', x + 3, yt + 2, '#ffffff', 'left', 1, sh); return; }
  // överkanten: hissens namn och färdriktning i stora LED-tecken, vågen som en liten display till höger
  const nw = led(g, e.name, x + 2, yt + 1, '#ffffff', 'left', sh);
  if (e.dir && e.state === 'moving') led(g, e.dir > 0 ? '▲' : '▼', x + 3 + nw, yt + 1, '#ffffff', 'left', sh);
  const kg = cabinKg(e), ks = String(Math.round(kg)), kw = textW(ks) + textW('KG') + 6;
  const hot = kg > e.ratedKg ? '#ff5d52' : kg >= e.ratedKg * FULL_LOAD ? '#ff9f1c' : '#ffd23f';
  box(x + cw - kw - 1, yt + 1, kw, 8, '#101418');
  text(g, ks, x + cw - kw + 2, yt + 1, hot);
  text(g, 'KG', x + cw - 3, yt + 1, '#8a8f99', 'right');
  const fr = Math.min(1, kg / e.ratedKg);
  R(ix, yb - 3, iw, 2, 'rgba(27,16,51,.6)');
  R(ix, yb - 3, Math.round(iw * fr), 2, kg > e.ratedKg ? '#ff2d55' : kg >= e.ratedKg * FULL_LOAD ? '#ff8c42' : '#7cf06b');
}
const blinkOf = p => Math.sin(S.anim * 0.9 + p.id * 1.7) > 0.985;
const hotOf = p => (p.mood || 0) === 2 && Math.sin(S.anim * 8 + p.id) > 0;

// ---------- Folket i hallarna ----------
function drawHallPeople() {
  const list = [];
  for (const p of S.people) {
    if (p.dead) continue;
    const lp = landPos(p);
    if (lp) list.push({ p, lp });
  }
  list.sort((a, b) => (a.p.depth - b.p.depth) || (a.p.id - b.p.id));
  for (const { p, lp } of list) {
    const walking = p.state !== 'wait' && p.state !== 'office'; // (office: står på en plats i hallen, crew.js)
    const dir = walking && lp.dir ? lp.dir : (p.face || 1);
    const frame = walking ? Math.floor(((p.walkPhase || 0) % (Math.PI * 2)) / (Math.PI / 2)) % 4 : 0;
    const fx = X(lp.x), fy = Y(surf(p.floor) + p.depth * 0.6);
    g.globalAlpha = lp.a;
    const dog = p.cargo ? DOGS[p.cargo.kind] : null;
    // (lasten syns även i kön – städvagnar och paketkärror vid varuhissen ska synas)
    const cg = dog ? cargoSprite(dog + (walking ? (frame % 2 ? '2' : '') : 'S'), dir) : p.cargo ? cargoSprite(p.cargo.kind, dir) : null;
    if (cg && p.cargo.kind === 'resväska') g.drawImage(cg.c, fx + cg.dx, fy - cg.c.height + 1 - cg.lift);
    g.drawImage(personSprite(p, 'side', frame, dir, { blink: blinkOf(p), hot: hotOf(p) }), fx - PERSON_W / 2, fy - PERSON_H + 1);
    phoneOn(p, fx - PERSON_W / 2, fy - PERSON_H + 1, dir);
    if (cg && p.cargo.kind !== 'resväska') g.drawImage(cg.c, fx + cg.dx, fy - cg.c.height + 1 - cg.lift);
    if (dog && cg) poodleExtras(p, fx, fy, dir, cg);
    // ånga ur öronen när någon är riktigt sur
    if ((p.mood || 0) === 2) for (let i = 0; i < 2; i++) {
      const k = (S.anim * 1.4 + i * 0.5 + p.id * 0.13) % 1;
      R(fx + (i ? 4 : -5), fy - 25 - Math.round(k * 7), k < 0.5 ? 2 : 1, k < 0.5 ? 2 : 1, `rgba(255,255,255,${1 - k})`);
    }
    g.globalAlpha = 1;
  }
  // pratbubblor från stamgästerna först (de är viktigast), sedan tankebubblorna och namnbrickorna
  for (const { p, lp } of list) if (talking(p) && lp.a > 0.5) speech(p, X(lp.x), Y(surf(p.floor) + p.depth * 0.6) - 38 - (p.state === 'wait' ? 12 : 0));
  // tankebubblorna: de som väntar på samma hiss till samma våning delar en bubbla ("→6 L1 ×3"),
  // utom den som spåras och när namnbrickorna är på
  const groups = new Map();
  for (const { p, lp } of list) {
    if (p.state !== 'wait') continue;
    const k = S.tags || p === S.sel ? `p${p.id}` : `${p.floor}|${p.dest}|${p.assigned}|${buttonsMode() ? p.dir : ''}|${p.fixAt ? 1 : 0}`;
    const gr = groups.get(k);
    if (gr) gr.push({ p, lp }); else groups.set(k, [{ p, lp }]);
  }
  for (const gr of groups.values()) {
    const lead = gr.find(q => q.p === S.sel) || gr.reduce((a, b) => (b.lp.x > a.lp.x ? b : a));
    thought(lead.p, X(lead.lp.x) + 3, Y(surf(lead.p.floor) + lead.p.depth * 0.6) - 30, gr.length);
  }
  // namnbrickor: alla med ID-knappen, stamgästerna alltid (med en stjärna)
  for (const { p, lp } of list) {
    if (!(S.tags || p.cast) || p.state === 'wait' || lp.a <= 0.5 || talking(p)) continue;
    const s = plain((p.cast ? '* ' : '') + p.name), w = textW(s) + 5, cx = X(lp.x), y = place(Math.round(cx - w / 2), Y(surf(p.floor) + p.depth * 0.6) - 36, w, 9, [0, -10]);
    if (y !== null) label(s, cx, y, p.cast ? '#ffe14d' : '#ffffff');
  }
}
/** hundar i koppel: bagagesorten → figurernas namn (gång, gång2, S = sitter, F = framifrån) */
const DOGS = { pudel: 'pudel', raggig: 'ragg' };
/** pudelns koppel (från handen till halsbandet) och ett "VOV!" då och då */
function poodleExtras(p, fx, fy, dir, cg) {
  const hx = fx + dir * 2, hy = fy - 9;
  const cx = fx + cg.dx + (dir > 0 ? 6 : cg.c.width - 7), cy = fy - cg.c.height + 5;
  line(hx, hy, cx, cy, '#ff4fa3');
  if (Math.sin(S.anim * 0.8 + p.id * 2.3) > 0.97) bark(fx + cg.dx + Math.round(cg.c.width / 2), fy - cg.c.height - 1);
}
function bark(cx, y) { text(g, 'VOV!', cx, y - 6, '#ffffff', 'center', 1, INK); }
const talking = p => !!(p.say && S.t < p.say.until);
/** pratbubbla med namn och replik, med en liten pil ner mot personen */
function speech(p, cx, y) { bubble(`${p.name}: "${p.say.text}"`, cx, y); }
function bubble(str, cx, y0, fill = '#ffffff') {
  const s = plain(str);
  // (bubblan hålls inom bilden – pilen pekar ändå på personen)
  const w = Math.min(textW(s) + 6, 260), x = clamp(Math.round(cx - w / 2), 1, Math.max(1, lo.width - w - 1));
  // repliker är viktiga: de flyttas uppåt om platsen är tagen, men ritas alltid
  const y = place(x, y0, w, 9, [0, -11, -22]) ?? y0;
  if (y < y0) R(cx, y + 9, 1, y0 - y, INK);
  pill(x, y, w, 9, fill);
  g.save(); g.beginPath(); g.rect(x + 1, y, w - 2, 9); g.clip();
  text(g, s, x + 3, y + 1, INK);
  g.restore();
  R(cx - 1, y0 + 9, 3, 1, INK); R(cx, y0 + 10, 1, 1, INK);
}
/** tankebubblan: mål och tilldelad hiss (n = hur många som tänker samma sak) */
function thought(p, x, y, n = 1) {
  // KNAPPAR: personen vet bara vilken knapp hen tryckt – ingen hiss är "hens"
  const buttons = buttonsMode() && !p.vip;
  const e = !buttons && p.assigned !== null ? S.elevators[p.assigned] : null;
  const txt = plain((S.tags ? p.name + ' ' : '') + (buttons ? (p.fixAt ? '?! ' : ARR(p.dir) + ' ') : '') + '→' + fl(p.dest));
  const tw = textW(txt), chip = e ? textW(e.name) + 4 : 0, many = n > 1 ? `x${n}` : '', mw = many ? textW(many) + 3 : 0;
  const w = tw + 6 + (e ? chip + 2 : 0) + mw, h = 9, bx = x - Math.round(w / 2), y0 = y - h;
  const by = place(bx, y0, w, h, [0, -10, -20]) ?? (p === S.sel ? y0 : null);
  if (by === null) return; // ingen plats: personen syns ändå i kön, och spåras man syns bubblan alltid
  R(x - 1, y + 2, 2, 2, INK); R(x + 1, y, 2, 2, INK); R(x + 1, y, 1, 1, '#ffffff');
  if (by < y0) for (let yy = by + h + 1; yy < y; yy += 3) R(x + 1, yy, 1, 1, INK);
  pill(bx, by, w, h, p === S.sel ? '#ffe14d' : '#ffffff');
  text(g, txt, bx + 3, by + 1, INK);
  if (e) { const cx = bx + tw + 5; R(cx, by + 1, chip, 7, e.color); text(g, e.name, cx + 2, by + 1, PAL.on(e.color)); }
  if (many) text(g, many, bx + w - mw, by + 1, '#606878');
}

// ---------- Telefonsamtalet: teknikern ringer in en extra tekniker ----------
/** var den som ringer ritades i den här bildrutan (låg upplösning), null = syns inte */
let callAt = /** @type {{ x: number, y: number }|null} */ (null);
const calling = p => !!S.techCall && S.techCall.by === p.id && S.t < S.techCall.until;
/** mobiltelefonen vid örat; (px, py) = figurens övre vänstra hörn, dir = sidovyns riktning (0 = framifrån) */
function phoneOn(p, px, py, dir = 0) {
  if (!calling(p)) return;
  const hx = dir ? px + PERSON_W / 2 + (dir > 0 ? 1 : -3) : px + PERSON_W - 4, hy = py + 3;
  R(hx - 1, hy - 1, 4, 8, INK); R(hx, hy, 2, 6, '#3a3f4a'); R(hx, hy + 1, 2, 2, '#7cf06b'); R(hx + 1, hy - 4, 1, 3, INK);
  callAt = { x: hx + 1, y: hy };
}
/** ringvågor från telefonen och samtalet i två pratbubblor: teknikern, sedan hissjourens svar */
function drawCallPx() {
  const C = S.techCall;
  if (!C || S.t >= C.until) return;
  const p = S.people.find(q => q.id === C.by);
  if (!p || p.dead) return;
  let at = callAt;
  if (!at) {
    // teknikern syns inte (i ett rum eller i trappan): en telefon vid korridoren på hens våning
    const h = personHead(p);
    if (!h) return;
    at = h.hidden ? { x: X(DOOR_X) + 12, y: Y(floorY(p.floor)) - 30 } : { x: X(h.x) + 3, y: Y(h.y) + 3 };
    R(at.x - 3, at.y - 1, 6, 9, INK); R(at.x - 2, at.y, 4, 7, '#3a3f4a'); R(at.x - 2, at.y + 1, 4, 2, '#7cf06b'); R(at.x + 1, at.y - 4, 1, 3, INK);
  }
  // ringvågorna växer ut från luren
  const n = Math.floor(S.anim * 5) % 4;
  for (let k = 1; k <= n; k++) {
    const x = at.x + 2 + k * 2;
    R(x, at.y - k + 2, 1, 2 * k - 1, '#ffe14d'); R(x - 1, at.y - k + 1, 1, 1, '#ffe14d'); R(x - 1, at.y + k + 1, 1, 1, '#ffe14d');
  }
  const reply = S.t - C.t0 >= CALL_REPLY;
  const str = reply ? 'Hissjouren: "Uppfattat – vi skickar en kollega direkt!"'
    : C.trapped ? `${p.name}: "Jouren? Folk sitter fast i ${C.trapped} – skicka en till!"` : `${p.name}: "Jouren? ${C.n} hissar trasiga i kö – skicka en till!"`;
  bubble(str, at.x, at.y - 18, reply ? '#fff6a8' : '#ffffff');
}

// ---------- Spårning, muspekare, pratbubblor ----------
function drawSelectionPx() {
  const p = S.sel;
  if (!p || p.dead) return;
  if (p.state === 'wait' && p.assigned !== null) {
    const e = S.elevators[p.assigned], x = X(shaftX(e.id) + 4), yt = Y(floorY(e.pos) - 4 - CAR_H);
    ants(x - 2, yt - 2, CAR_W / PX + 4, CAR_H / PX + 4, '#ffe14d');
    label(`→ ${p.name}`, x + CAR_W / PX / 2, yt - 12, '#ffe14d');
  }
  const h = personHead(p);
  if (!h) return;
  if (h.hidden) { trackNote(p, X(DOOR_X) + 14, Y(floorY(p.floor)) - 14, true); return; }
  const bob = Math.round(Math.sin(S.anim * 6) * 1.5);
  const hx = X(h.x), hy = Y(h.y) - (p.state === 'wait' ? 17 : 8) + bob;
  g.drawImage(ARROW(), hx - 3, hy - 7);
  trackNote(p, hx, hy - 9, false);
}
function trackNote(p, x, yb, side) {
  const [lab, col] = stateInfo(p);
  const name = plain(`${p.name}${p.state === 'instairs' ? ' (i trapphuset)' : ''}`), detail = plain(noteDetail(p)), sl = plain(lab);
  const w1 = textW(name), w2 = textW(sl) + 5, w3 = textW(detail);
  const w = Math.max(w1 + w2 + 4, w3) + 8, h = 18;
  const bx = side ? x + 4 : clamp(x - Math.round(w / 2), 2, lo.width - w - 2), by = yb - h;
  pill(bx, by, w, h, PAL.note);
  if (side) { R(bx - 3, by + 7, 4, 1, INK); R(bx - 2, by + 6, 1, 3, INK); R(bx - 1, by + 5, 1, 5, INK); R(bx, by + 6, 1, 3, PAL.note); }
  else { R(x - 2, by + h, 5, 1, INK); R(x - 1, by + h + 1, 3, 1, INK); R(x, by + h + 2, 1, 1, INK); R(x - 1, by + h - 1, 3, 1, PAL.note); R(x, by + h, 1, 1, PAL.note); }
  text(g, name, bx + 4, by + 1, INK);
  R(bx + 7 + w1, by + 2, w2, 7, col); text(g, sl, bx + 10 + w1, by + 1, PAL.on(col));
  text(g, detail, bx + 4, by + 9, PAL.noteText);
}
function drawHoverPx() {
  if (S.hoverDoor !== null && S.hoverDoor !== undefined && !S.hover) {
    const f = S.hoverDoor, n = peopleBehindDoor(f).length;
    const t = n ? `${FL[f].short}: ${n} inne – klicka för att spåra` : `${FL[f].short}: ingen inne`;
    label(t, X(LAND_X0) + 3, Y(floorY(f) - 80) - 4, '#ffffff', INK, 'left');
  }
  const p = S.hover;
  if (!p || p === S.sel) return;
  const h = personHead(p);
  if (!h || h.hidden) return;
  const t = p.state === 'office' ? `${p.name} · ${FL[p.floor].short}` : `${p.name} · ${fl(p.floor)}→${fl(p.dest)}`;
  label(t, X(h.x), Y(h.y) - (p.state === 'wait' ? 20 : 10));
}
// pratbubblor: hörs ut genom korridoren, en åt gången per våning (repliker per våningstema)
const GAGS = {
  _: ['Har någon sett min häftapparat?', 'Snart fredag!', 'Vem tog min yoghurt?!', 'Kopiatorn har papperstrassel IGEN', 'Min Tamagotchi är hungrig', 'Har du fått mitt fax?', 'Kaffet är slut!'],
  dentist: ['Gapa stooort!', 'Det känns bara lite…', 'Glöm inte tandtråden!'],
  game: ['Det är ingen bugg – det är en feature!', 'En bana till…', 'Vem skrev över min sparfil?'],
  ad: ['Tänk utanför boxen!', 'Mer neonrosa!', 'Kunden vill ha en delfin i filmen'],
  law: ['Invändning!', 'Enligt paragraf 12…', 'Faktureras per kvart'],
  radio: ['Ni lyssnar på Kanal 97!', 'Ring in och tävla!', 'Nästa låt är en riktig dänga!'],
  aerobic: ['Och KNÄLYFT!', 'Känn hur det bränner!', 'Fem till!'],
  server: ['Har du testat att starta om?', 'Modemet piper konstigt…', 'Y2K blir lugnt… va?'],
  spa: ['Vilken fin pudel!', 'Vem släppte ut taxen?', 'Vov!'],
  bank: ['Räntan är 7 %!', 'Ta en nummerlapp, tack', 'I tre exemplar!'],
  lab: ['Det borde inte bubbla så…', 'Eureka!', 'Varför glöder den?'],
  sky: ['Vilken utsikt!', 'En latte, tack', 'Byter hiss här – smart!'],
  apartments: ['Vad blir det till middag?', 'Var är fjärrkontrollen?', 'Dags att vattna blommorna', 'Spelar in på video!', 'Mamma, får jag spela Nintendo?'],
  roof: ['Vilken utsikt!', 'Tomaterna växer så det knakar', 'Kolla, en helikopter!'],
  dock: ['Paket till våning 9!', 'Var är följesedeln?'],
  lobby: [],
  garage: ['Var parkerade jag nu?'],
  cafe: [],
};
// personalen och de andra som jobbar i huset säger saker som hör till jobbet – aldrig kontorsrepliker
// (husets personal har sina repliker i CREW i config: lines.post och lines.break)
const ROLE_GAGS = {
  'väktare': ['Allt lugnt på min runda', 'Vem lämnade dörren olåst?', 'Ficklampan behöver nya batterier', 'Klockan tre – dags för nästa runda'],
  'städare': ['Vem har tappat konfetti här?', 'Torka fötterna!', 'Dammsugaren låter konstigt', 'Tre papperskorgar kvar'],
  'vaktmästare': ['Ett lysrör till…', 'Det knarrar i den här dörren', 'Var är skiftnyckeln?', 'Pannan ska ses över i morgon'],
  'nattdj': ['Ni lyssnar på Kanal 97!', 'Nästa låt är en riktig dänga!', 'Ring in och önska!', 'Klockan är mycket – stanna kvar!'],
  'nattekniker': ['Har du testat att starta om?', 'Modemet piper igen', 'Kaffe nummer fem', 'Servern lever – än så länge'],
  'hisstekniker': ['Den här bromsen har sett bättre dagar', 'Var är tretton-nyckeln?', 'Smörj, smörj', 'Vem har tryckt på alla knappar?!'],
  'arbetsledare': ['Det här ska rapporteras', 'Vem servade den här senast?', 'Linorna ska bytas var tionde år!', 'Jag vill se loggboken'],
  'bud': ['Paket till våning nio!', 'Kvittera här, tack', 'Var ligger 402?'],
  'flyttgubbe': ['PIVOT!', 'Lyft med benen!', 'Vem packar böcker i en enda låda?!', 'Ett, två, tre – LYFT!'],
  'ambulans': ['Försiktigt med båren', 'Ta det lugnt, vi är här nu', 'Puls och andning – bra'],
  'brandman': ['Ur vägen!', 'Rökdykare på väg upp', 'Släckt här – vidare!'],
  'lastare': [],
};
/** vad den här personen kan säga i rummet, eller null = kontorets/våningens vanliga repliker */
function workLines(p) {
  if (p.crewId) { const L = CREW_BY[p.crewId].lines; return p.onBreak || (p.spot && p.spot.brk) ? L.break : L.post; }
  return p.role ? ROLE_GAGS[p.role] || [] : null;
}
let gags = [], gagT = 2;
function drawGagsPx(dt) {
  if (S.started && !S.paused) {
    gagT -= dt;
    if (gagT <= 0) {
      gagT = vrand(1.8, 4);
      const lo2 = VIEW.camY, hi = VIEW.camY + VIEW.viewH;
      // (vid kontrollbordet pratar chefen själv – S.chief.say; personalen och andra i tjänst bara om jobbet)
      const cands = S.people.filter(p => p.state === 'office' && !p.sleeping && p.spot && p.spot.k !== 'door' && p.spot.post !== 'chief'
        && (workLines(p) === null || workLines(p).length > 0)
        && floorY(p.floor) > lo2 + 40 && floorY(p.floor) < hi + 40 && !gags.some(q => q.p.floor === p.floor));
      if (cands.length) {
        const p = vpick(cands), work = workLines(p), th = FL[p.floor].theme;
        const own = GAGS[th] && GAGS[th].length ? GAGS[th] : null;
        const list = work || (own && vrand(0, 1) < 0.75 ? own : GAGS._);
        if (list.length) gags.push({ p, text: vpick(list), life: 3.2 });
      }
    }
  }
  for (const q of gags) {
    q.life -= dt;
    if (q.p.state !== 'office' || q.p.dead) { q.life = 0; continue; }
    // den som syns där hen är (personalrummet, receptionen, gondolen, i hallen): bubblan över huvudet
    if (inWindow(q.p) || q.p.spot?.win === 'hall') { const hd = personHead(q.p); if (hd) { g.globalAlpha = clamp(q.life * 2, 0, 1); bubble(plain(q.text), X(hd.x), Y(hd.y) - 3); g.globalAlpha = 1; } continue; }
    // repliken hörs från rummen: bubblan sitter till höger om trappskylten med en pil mot korridoren
    const s = plain(q.text), w = textW(s) + 7, x = Math.min(X(DOOR_X) + 56, X(INNER_X1) - w - 1), y0 = Y(floorY(q.p.floor + 1) + 4) + 24;
    const y = place(x, y0, w, 10, [0, 10]);
    if (y === null) { q.life = Math.min(q.life, 0.3); continue; }
    g.globalAlpha = clamp(q.life * 2, 0, 1);
    pill(x, y, w, 10, '#ffffff'); text(g, s, x + 4, y + 2, INK);
    R(x - 2, y + 4, 2, 1, INK); R(x - 3, y + 5, 1, 1, INK);
    g.globalAlpha = 1;
  }
  gags = gags.filter(q => q.life > 0);
}

// ---------- Taket, helikoptern, incidenter ----------
function drawRoofPx() {
  const n = nightness(hour());
  box(X(SHAFT_X0 - 8), Y(ROOF_Y - 50), Math.round((UX1 - SHAFT_X0 + 4) / PX), 24, PAL.machine);
  R(X(SHAFT_X0 - 8) + 1, Y(ROOF_Y - 50) + 1, Math.round((UX1 - SHAFT_X0 + 4) / PX) - 2, 1, PAL.machineHi);
  text(g, 'MASKINRUM', X(SHAFT_X0), Y(ROOF_Y - 50) + 2, INK);
  const wheel = (e, cx, cy) => {
    g.drawImage(wheelSprite(e.color, Math.floor(((e.distance * 2.2) % (Math.PI / 3)) / (Math.PI / 3) * 6)), X(cx) - 8, Y(cy) - 8);
    // varm motor: det ångar och lyser rött i maskinen; extrafläkten snurrar bredvid
    if (e.heat >= WARM_AT * 0.85) {
      const k = Math.min(1, (e.heat - WARM_AT * 0.85) / 0.4);
      R(X(cx) - 9, Y(cy) + 7, 18, 2, `rgba(255,${Math.round(140 - k * 100)},40,${0.4 + k * 0.5})`);
      for (let i = 0; i < 3; i++) { const t = (S.anim * 0.8 + i / 3) % 1; g.globalAlpha = (1 - t) * (0.4 + k * 0.6); g.drawImage(PUFF(2 + Math.round(t * 2)), X(cx) - 4 + i * 3, Y(cy) - 12 - Math.round(t * 12)); g.globalAlpha = 1; }
    }
    // överhettad: luften dallrar över maskinen
    if (e.hot) for (let i = 0; i < 6; i++) { const t = (S.anim * 1.2 + i / 6) % 1; R(X(cx) - 6 + i * 2 + Math.round(Math.sin(S.anim * 6 + i) * 1.5), Y(cy) - 10 - Math.round(t * 10), 1, 2, 'rgba(255,220,160,.45)'); }
    // förvarning: motorn brummar ansträngt och börjar glöda
    if (S.warn && S.warn.type === 'heat' && S.warn.car === e.id) {
      const k = clamp((S.t - S.warn.t0) / (S.warn.until - S.warn.t0), 0, 1);
      R(X(cx) - 9, Y(cy) + 7, 18, 2, `rgba(255,140,40,${(0.2 + 0.5 * k * (0.6 + 0.4 * Math.sin(S.anim * 9))).toFixed(2)})`);
      if (Math.sin(S.anim * 5) > 0) label('BRUMMM…', X(cx), Y(cy) - 20, '#ffe9a8', INK);
    }
    if (e.fan) {
      const fx = X(cx) + 11, fy = Y(cy) - 3, a = S.anim * 14;
      box(fx - 4, fy - 4, 9, 9, PAL.steel);
      for (let i = 0; i < 3; i++) { const b = a + i * 2.094; R(fx + Math.round(Math.cos(b) * 2.5), fy + Math.round(Math.sin(b) * 2.5), 1, 1, INK); }
      R(fx, fy, 1, 1, INK);
    }
  };
  for (const e of S.elevators) {
    const cx = shaftCX(e.id);
    if (EL[e.id].facade) { box(X(UX1 + 4), Y(ROOF_Y - 26), Math.round((cx - UX1 + 2) / PX), 4, PAL.steel); wheel(e, cx, ROOF_Y - 20); continue; }
    if (EL[e.id].maxF >= TOP) { wheel(e, cx, ROOF_Y - 20); continue; }
    if (stackedAbove(EL[e.id])) continue; // maskinen sitter i mellanbjälklaget under höga zonen
    const y = shaftTop(EL[e.id]);
    box(X(cx) - 11, Y(y - 34), 23, 15, PAL.machine); // litet maskinhus – resten av taket är terrass
    wheel(e, cx, y - 19);
  }
  // skylten på taket
  const sx0 = SHAFT_X0 - 16, sx1 = UX1 + 16; // skylten får skjuta ut lite över det smala tornet
  for (const px of [sx0 + 60, sx1 - 60]) R(X(px) - 1, Y(96), 3, Y(ROOF_Y - 50) - Y(96), INK);
  const bx = X(sx0), by = Y(24), bw = X(sx1) - bx, bh = 36;
  box(bx, by, bw, bh, PAL.sign); R(bx + 1, by + 1, bw - 2, 1, PAL.signHi); R(bx + 1, by + bh - 2, bw - 2, 1, PAL.signLo);
  const nb = Math.floor((bw - 12) / 10);
  for (let i = 0; i < nb; i++) {
    const on = S.power && (Math.floor(S.anim * 4) + i) % 3 === 0;
    for (const yy of [by + 3, by + bh - 5]) R(bx + 6 + i * 10, yy, 2, 2, on ? PAL.bulbOn : PAL.bulbOff);
  }
  const ts = Math.max(1, Math.min(4, Math.floor((bw - 10) / textW('SKYSKRAPAN'))));
  text(g, 'SKYSKRAPAN', bx + bw / 2, by + Math.round((bh - 5 * ts) / 2), '#ffffff', 'center', ts, INK);
  const ax = X(UX1 - 24);
  R(ax, Y(24), 2, Y(ROOF_Y - 50) - Y(24), INK); R(ax - 7, Y(60), 16, 2, INK); R(ax - 5, Y(80), 12, 2, INK);
  // vimpel i masten: står rakt ut i stormen
  const w = windAt(), fl0 = Y(40), flen = 5 + Math.round(w * 16);
  for (let i = 0; i < flen; i++) {
    const wave = Math.round(Math.sin(S.anim * (3 + w * 9) - i * 0.6) * (1.5 - w) * (i / flen) * 2 + (1 - w) * i * 0.5);
    R(ax + 2 + i, fl0 + wave, 1, Math.max(1, 4 - Math.floor(i * 3 / flen)), i % 6 < 3 ? '#ffe14d' : '#2a5db0');
  }
  const blink = Math.sin(S.anim * 4) > 0;
  if (blink) R(ax - 4, Y(20) - 4, 10, 10, `rgba(255,45,85,${0.35 + n * 0.3})`);
  box(ax - 2, Y(20) - 2, 6, 6, blink ? '#ff2d55' : '#7a2033');
}
// ---------- Fönsterputsaren och hissbalken ----------
// En gondol hänger i en arm på taket utanför det smala tornet; på flyttdagen tar hissbalken samma skena
// (läget räknas i simuleringen – hoist.js – här ritas bara).
// (putsaren och lastaren på terrassen är personer i huset – crew.js)
function drawCleanerPx() {
  const G0 = cleanerAt(); // (null: huset har inget smalt torn att putsa)
  if (!G0) return;
  const wind = S.storm ? windAt() : 0;
  const wall = X(UX1 + 7), ay = Y(ROOF_Y - 10), ax0 = wall - 4, ax1 = wall + 26;
  // armen på taket med två linor
  R(ax0, ay - 8, 2, 9, INK); R(ax0, ay - 1, ax1 - ax0 + 2, 3, INK); R(ax0 + 1, ay, ax1 - ax0, 1, PAL.steel);
  const sway = Math.round(Math.sin(S.anim * 2.6) * wind * 6);
  const gx = wall + 3 + sway, gw = 22, gy = Y(G0.y);
  if (gy < -20 || ay > lo.height + 20) return;
  for (const cx of [gx + 3, gx + gw - 4]) line(cx - sway, ay + 2, cx, gy - 12, '#3a3f4a');
  // putsaren (vänd mot fasaden) och hinken
  const hasse = G0.crew ? S.people.find(p => p.role === 'fönsterputsare' && inWindow(p)) : null;
  if (hasse) {
    const bob = G0.scrub ? Math.round(Math.sin(S.anim * 5) * 1) : 0;
    g.drawImage(personSprite(winFig(hasse, wind > 0.5 ? 1 : 0), 'side', 0, -1, { blink: blinkOf(hasse) }), gx + 4, gy - PERSON_H + 1 + bob);
    if (G0.scrub && wind < 0.5) {
      // skrapan går upp och ner mot fasaden; det glittrar där det blivit rent
      const sy = gy - 16 + Math.round(Math.sin(S.anim * 4) * 6);
      line(gx + 6, gy - 11, wall + 1, sy, '#8a5a2b'); R(wall, sy - 3, 2, 7, INK); R(wall + 1, sy - 2, 1, 5, '#36c5d6');
      if (Math.sin(S.anim * 7) > 0.6) R(wall - 2 + Math.round(vrand(0, 3)), sy + Math.round(vrand(-8, 8)), 1, 1, '#ffffff');
    }
  }
  // korgen: räcke, golv och en hink
  R(gx, gy - 12, gw, 1, INK); R(gx, gy - 12, 1, 12, INK); R(gx + gw - 1, gy - 12, 1, 12, INK);
  R(gx + gw - 7, gy - 5, 4, 4, INK); R(gx + gw - 6, gy - 4, 2, 3, '#3f7cff');
  box(gx - 1, gy - 6, gw + 2, 7, PAL.steel);
  text(g, 'PUTS', gx + gw / 2, gy - 5, INK, 'center');
  // droppar från skrapan
  if (G0.scrub) for (let i = 0; i < 3; i++) {
    const k = (S.anim * 0.9 + i / 3) % 1;
    R(gx + 4 + i * 6, gy + 2 + Math.round(k * 40), 1, 2, `rgba(120,200,255,${1 - k})`);
  }
}
const ROOF_F = FL.findIndex(f => f.theme === 'roof');
function drawHeliPx() {
  const Hh = S.heli; if (!Hh || ROOF_F < 0) return;
  const bot = floorY(ROOF_F) - 4, x = X(476), y = Y(bot - 30 + Hh.y);
  const s = HELI();
  g.drawImage(s, x - 17, y - 8);
  const span = Math.round(28 * Math.abs(Math.cos(S.anim * (Hh.state === 'parked' ? 4 : 25))));
  R(x - span + 2, y - 10, span * 2, 2, INK); R(x - span + 3, y - 10, span * 2 - 2, 1, '#94a3b8');
  R(x + 2, y - 9, 2, 2, INK);
  text(g, 'VIP', x - 2, y - 2, '#ffe14d', 'left', 1, INK);
  if (Hh.state !== 'parked') for (let i = 0; i < 4; i++) { const k = (S.anim * 2 + i / 4) % 1; const r = Math.round(15 + k * 25); R(x - r, Y(bot) - 2 - i, 4, 1, 'rgba(255,255,255,.6)'); R(x + r, Y(bot) - 2 - i, 4, 1, 'rgba(255,255,255,.6)'); }
}
/** hur långt släckningen har kommit (0–1): från att brandmännen är framme tills branden är ute */
const fireProg = F => (F.outAt !== null ? clamp(1 - (F.outAt - S.t) / 28, 0, 1) : 0);
function drawSmokePx() {
  const F = S.fire;
  // förvarning: det luktar bränt – tunna rökslingor ur korridoren på våningen
  if (!F) {
    const W = S.warn;
    if (!W || W.type !== 'fire') return;
    const k0 = clamp((S.t - W.t0) / (W.until - W.t0), 0, 1), top = floorY(W.floor + 1) + 4;
    for (let i = 0; i < 4; i++) {
      const k = (S.anim * 0.3 + i / 4) % 1, x = DOOR_X + 6 + i * 9 + Math.sin(S.anim * 1.5 + i) * 4;
      g.globalAlpha = (1 - k) * 0.25 * (0.4 + k0); g.drawImage(PUFF(2 + Math.round(k * 2)), X(x) - 2, Y(top + 40 - k * 40) - 2);
    }
    g.globalAlpha = 1;
    return;
  }
  const prog = fireProg(F);
  const top = floorY(F.floor + 1) + 4;
  for (let i = 0; i < 14; i++) {
    const k = (S.anim * 0.35 + i / 14) % 1;
    const x = 120 + (i * 37) % 820 + Math.sin(S.anim + i) * 10;
    if (x < LAND_X0 - 20) continue;
    const y = top + 30 - k * FLOOR_H * 1.8, r = Math.round((10 + k * 22) / PX);
    g.globalAlpha = (1 - k) * 0.55 * (1 - prog);
    g.drawImage(PUFF(r), X(x) - r, Y(y) - r);
  }
  g.globalAlpha = 1;
}
function drawOutagePx() {
  // strömmen är tillbaka: våningarna tänds en i taget nerifrån och upp
  if (S.power) {
    // förvarning: lamporna flimrar
    if (S.warn && S.warn.type === 'power' && vrand(0, 1) < 0.3) R(X(LAND_X0 - 20), Y(ROOF_Y - 4), lo.width, Y(BASE_Y) - Y(ROOF_Y - 4), `rgba(8,4,28,${vrand(0.15, 0.45).toFixed(2)})`);
    const k = S.powerBack === null ? 1 : (S.t - S.powerBack) / RELIGHT_S;
    if (k >= 1) return;
    for (let f = Math.floor(k * FLOORS); f < FLOORS; f++) {
      const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) + 4);
      if (bot < 0 || top > lo.height) continue;
      R(X(LAND_X0 - 20), top, lo.width, bot - top, 'rgba(8,4,28,.55)');
    }
    return;
  }
  const O = S.outage;
  R(X(LAND_X0 - 20), Y(ROOF_Y - 4), lo.width, Y(BASE_Y) - Y(ROOF_Y - 4), `rgba(8,4,28,${O && O.gen ? 0.48 : 0.62})`);
  const on = Math.sin(S.anim * 5) > 0;
  for (let f = 0; f < FLOORS; f++) {
    const top = Y(floorY(f + 1) + 4);
    if (top < -60 || top > lo.height) continue;
    if (on) R(X(INNER_X1) - 15, top + 2, 7, 7, 'rgba(255,93,82,.35)');
    R(X(INNER_X1) - 13, top + 4, 3, 3, on ? '#ff5d52' : '#5a1e2a');
    stairSign(f, true);
  }
  for (const e of S.elevators) {
    if (!e.passengers.length || e.mode !== 'normal') continue;
    const x = X(shaftX(e.id) + 4), yt = Y(floorY(e.pos) - 4 - CAR_H), cw = CAR_W / PX, chh = CAR_H / PX;
    // nödbelysningen i taket och en ficklampa (mobilskärmen) som sveper i korgen
    R(x + 2, yt + 2, cw - 4, chh - 4, 'rgba(255,214,120,.16)');
    R(x + Math.round(cw / 2) - 2, yt + 1, 5, 1, '#ffe9a8');
    const sx = x + 6 + Math.round((Math.sin(S.anim * 1.3 + e.id) + 1) / 2 * (cw - 14)), sy = yt + 9;
    for (let i = 0; i < 9; i++) R(sx - Math.floor(i / 3), sy + i, 1 + Math.floor(i / 1.5), 1, 'rgba(255,246,168,.35)');
    if (Math.sin(S.anim * 4 + e.id) > 0) label('HJÄLP!', x + cw / 2, yt - 11, '#ffffff', '#ff2d55');
    // någon knackar på dörren
    else if (Math.sin(S.anim * 2.3 + e.id * 1.7) > 0.6) label('KNACK KNACK', x + cw / 2, yt + chh / 2, '#ffffff', INK);
  }
  if (O && O.gen) {
    const gx = X(UX1 - 40), gy = Y(ROOF_Y - 70);
    box(gx - 15, gy, 30, 11, PAL.green); text(g, 'RESERV', gx, gy + 2, '#ffffff', 'center');
    for (let i = 0; i < 2; i++) { const k = (S.anim * 0.9 + i * 0.5) % 1; g.globalAlpha = 1 - k; g.drawImage(PUFF(2 + Math.round(k * 2)), gx + 9, gy - 4 - Math.round(k * 10)); g.globalAlpha = 1; }
  }
}
function drawBannersPx() {
  const list = [];
  if (S.fire) list.push([`🔥 BRAND PÅ VÅNING ${fl(S.fire.floor)}${!S.fire.brigade ? '' : S.fire.outAt === null ? ' – BRANDKÅREN GÅR IN' : ' – BRANDKÅREN SLÄCKER'}`, '#ff2d55']);
  if (!S.power) list.push([`⚡ STRÖMAVBROTT${S.outage && S.outage.gen ? ' – RESERVKRAFT' : ''}`, '#6366f1']);
  if (S.storm) list.push([`🌬️ STORM${S.storm.mode === 'sway' ? ' – SVAJLÄGE' : ''}`, '#2a5db0']);
  list.forEach(([t, c], i) => {
    const s = plain(t), on = Math.sin(S.anim * 6) > -0.3, w = textW(s) * 2 + 16, x = Math.round(lo.width / 2 - w / 2), y = Math.round(VIEW.camY / PX) - CY + 6 + i * 18;
    pill(x, y, w, 16, on ? c : INK);
    text(g, s, lo.width / 2, y + 2, on ? '#ffffff' : c, 'center', 2);
  });
}
// ---------- Väder och ambulans (bara grafik) ----------
/** snöflingor när det är kallt – bara utanför huset (himlen, ovanför taket och terrassen, fasaden) */
const snow = [];
function drawSnowPx(dt) {
  const c = S.weather.cold;
  if (c <= 0) { snow.length = 0; return; }
  const want = Math.round(40 + c * 120), w = windAt();
  while (snow.length < want) snow.push({ x: vrand(LAND_X0, W), y: vrand(VIEW.camY - 40, VIEW.camY + VIEW.viewH), v: vrand(18, 40), p: vrand(0, 6) });
  if (snow.length > want) snow.length = want;
  const outside = (x, y) => y < ROOF_Y - 6 || x > BX1 + 8 || (x > UX1 + 8 && y < SEAM_Y - 6) || y > GROUND_Y + 2 && x > BX1;
  for (const f of snow) {
    if (S.started && !S.paused) { f.y += f.v * dt * S.speed; f.x += (Math.sin(S.anim + f.p) * 8 + w * 90) * dt * S.speed; }
    if (f.y > VIEW.camY + VIEW.viewH + 20 || f.x > W + 10) { f.y = VIEW.camY - vrand(0, 40); f.x = vrand(LAND_X0 - 100, W); }
    if (outside(f.x, f.y)) R(X(f.x), Y(f.y), 1, 1, 'rgba(255,255,255,.85)');
  }
}
/** ambulansen: blått blinkljus i entrén medan personalen är i huset */
function drawMedicPx() {
  const A = S.medic;
  if (!A || A.state === 'done' || A.state === 'called') return;
  const top = Y(floorY(LOBBY + 1) + 4), bot = Y(floorY(LOBBY) - 4), x0 = X(LAND_X0);
  if (bot < 0 || top > lo.height) return;
  const on = Math.sin(S.anim * 12) > 0;
  if (on) R(x0, top, X(INNER_X1) - x0, bot - top, 'rgba(60,120,255,.12)');
  const x1 = X(INNER_X1);
  box(x1 - 22, top + 3, 7, 5, on ? '#3f7cff' : '#1b2a6e');
  label('AMBULANS', x1 - 50, top + 12, '#ffffff', '#2ec4b6');
}
/** Stormen: mörkare himmel (även som förvarning), regn och blixtar – och blixten som slår ut strömmen */
function drawWeatherPx() {
  const St = S.storm, W = S.warn && S.warn.type === 'storm' ? S.warn : null;
  const dim = St ? 0.18 * clamp(windAt() / 0.8, 0.3, 1) : W ? 0.18 * clamp((S.t - W.t0) / (W.until - W.t0), 0, 1) : 0;
  if (dim > 0) R(0, 0, lo.width, lo.height, `rgba(20,24,48,${dim.toFixed(3)})`);
  if (!St) return;
  // regnet piskar snett i vinden
  const w = windAt(), n = Math.round(40 + w * 80), slant = Math.round(1 + w * 3);
  for (let i = 0; i < n; i++) {
    const rx = ((i * 97 + S.anim * (60 + w * 90)) % (lo.width + 40)) - 20, ry = ((i * 53 + S.anim * 260) % (lo.height + 20)) - 10;
    R(Math.round(rx), Math.round(ry), 1, 3, 'rgba(180,200,255,.35)'); R(Math.round(rx) + slant, Math.round(ry) + 3, 1, 2, 'rgba(180,200,255,.25)');
  }
}
/** blixten ritas sist (ovanpå strömavbrottets mörker): vitt sken och en blixt ner i taket, eller blixtar långt borta */
function drawLightningPx() {
  const St = S.storm;
  if (!St) return;
  const since = St.struck !== null ? S.t - St.struck : Infinity;
  if (since < 0.6) {
    R(0, 0, lo.width, lo.height, `rgba(255,255,255,${(0.55 * (1 - since / 0.6)).toFixed(2)})`);
    let bx = X(SHAFT_X0 + 60), by = Y(ROOF_Y - 400);
    const ty = Y(ROOF_Y - 40);
    while (by < ty) { const nx = bx + Math.round(vrand(-5, 5)), ny = Math.min(ty, by + Math.round(vrand(4, 9))); line(bx, by, nx, ny, '#ffffff'); bx = nx; by = ny; }
  } else if (vrand(0, 1) < 0.006) R(0, 0, lo.width, lo.height, 'rgba(255,255,255,.25)'); // blixtar långt borta
}
/** Brandkåren: blåljus i entrén och folket på återsamlingsplatsen utanför entrédörren */
function drawBrigadePx() {
  const top = Y(floorY(LOBBY + 1) + 4), bot = Y(floorY(LOBBY) - 4);
  if (bot < 0 || top > lo.height) return;
  const x0 = X(LAND_X0), x1 = X(INNER_X1);
  if (S.brigade || (S.fire && S.fire.brigade)) {
    const on = Math.sin(S.anim * 11) > 0;
    R(x0, top, x1 - x0, bot - top, on ? 'rgba(255,45,85,.10)' : 'rgba(60,120,255,.10)');
    box(x1 - 32, top + 3, 7, 5, on ? '#ff2d55' : '#7a2033'); box(x1 - 22, top + 3, 7, 5, on ? '#1b2a6e' : '#3f7cff');
    label('BRANDKÅREN', x1 - 58, top + 12, '#ffffff', '#c81e3a');
  }
  const out = S.people.filter(p => p.state === 'assembly');
  if (!out.length) return;
  // utanför glasdörren: en klunga som väntar (de närmast ritas, resten syns i siffran)
  const fy = Y(surf(LOBBY)) + 1;
  out.slice(0, 7).forEach((p, i) => {
    g.globalAlpha = 0.85;
    g.drawImage(personSprite(p, 'side', 0, 1, { blink: blinkOf(p) }), x0 + 1 + i * 5 - (i % 2), fy - PERSON_H - (i % 2) * 2);
    g.globalAlpha = 1;
  });
  label(`ÅTERSAMLING ${out.length}`, x0 + 2, fy - PERSON_H - 12, '#ffffff', '#c81e3a', 'left');
}
/** skylt i entrén och på mellanplanet: övre däcket nås via rulltrappan */
function deckSign(f) {
  if (MEZZ < 0 || (f !== LOBBY && f !== MEZZ)) return;
  const x = X(INNER_X1) - 66, y = Y(floorY(f + 1) + 4) + 34;
  pill(x, y, 62, 9, PAL.sign); reserve(x, y, 62, 9);
  text(g, f === LOBBY ? 'ÖVRE DÄCK: VÅN 1' : 'EXPRESS ÖVRE DÄCK', x + 31, y + 1, '#ffffff', 'center');
}
/** Ljudeffekterna ("STÄNG!", "FSSSS!" …): samma effekt på samma våning visas en gång, med "×n" när
 *  flera hissar säger samma sak – annars staplas de och täcker displayerna. */
function drawFxPx(dt) {
  const groups = new Map();
  for (const f of S.fx) {
    f.life -= dt; f.y -= 30 * dt;
    if (f.band === undefined) f.band = Math.round(f.y / FLOOR_H);
    const k = `${f.text}|${f.band}`, gr = groups.get(k);
    if (gr) gr.push(f); else groups.set(k, [f]);
  }
  for (const gr of groups.values()) {
    const f = gr.reduce((a, b) => (b.life > a.life ? b : a));
    const x = gr.reduce((a, b) => a + b.x, 0) / gr.length;
    const n = new Set(gr.map(q => Math.round(q.x))).size;
    g.globalAlpha = clamp(f.life, 0, 1);
    text(g, plain(f.text) + (n > 1 ? ` x${n}` : ''), X(x), Y(f.y) - 6, f.color, 'center', (f.size || 22) > 24 ? 3 : 2, INK);
    g.globalAlpha = 1;
  }
  S.fx = S.fx.filter(f => f.life > 0);
}

// ---------- Hela bilden ----------
export function renderPixel(dt) {
  const s = VIEW.scale * VIEW.dpr;
  const w = Math.ceil(cv.width / s / PX) + 1, h = Math.ceil(cv.height / s / PX) + 2;
  if (lo.width !== w || lo.height !== h) { lo.width = w; lo.height = h; }
  X0 = VIEW.x0; CY = Math.floor(VIEW.camY / PX);
  g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.globalAlpha = 1;
  callAt = null; chiefAt = null; taken = [];
  const hr = hour();
  OCC = new Array(FLOORS).fill(0); OCC_IN = new Array(FLOORS).fill(0);
  for (const p of S.people) {
    if (p.dead) continue;
    if (p.state !== 'ride' && p.state !== 'away' && p.state !== 'incar' && p.state !== 'assembly') OCC[p.floor]++;
    if ((p.state === 'office' && !(p.spot && p.spot.win)) || p.state === 'instairs') OCC_IN[p.floor]++;
  }
  drawSkyAll(hr);
  drawGroundPx();
  drawShell(hr);
  for (let f = 0; f < FLOORS; f++) {
    if (floorY(f) < VIEW.camY - 10 || floorY(f + 1) > VIEW.camY + VIEW.viewH + 10) continue;
    drawHall(f, hr); terminal(f); floorOverlays(f, hr); deckSign(f);
  }
  drawSlabsPx();
  drawEscalatorPx();
  drawTerracePx(hr);
  for (const e of S.elevators) drawRopesPx(e);
  drawLanternsPx();
  for (const e of S.elevators) drawCarPx(e);
  drawMovePilesPx();
  drawStreetPx(dt, hr);
  drawHallPeople();
  drawPanoPx();
  drawHeliPx();
  drawSnowPx(dt);
  drawWeatherPx();
  drawMedicPx();
  drawBrigadePx();
  drawSmokePx();
  drawOutagePx();
  drawLightningPx();
  drawRoofPx();
  drawCleanerPx();
  drawHoistPx();
  drawCallPx();
  drawChiefPx();
  drawSelectionPx();
  drawHoverPx();
  drawGagsPx(dt);
  drawFxPx(dt);
  drawBannersPx();
  // skala upp till skärmen utan utjämning
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const k = PX * s;
  ctx.drawImage(lo, 0, Math.round((CY * PX - VIEW.camY) * s), Math.round(w * k), Math.round(h * k));
}
