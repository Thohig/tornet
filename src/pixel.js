// Pixelgrafik (16-bit): hela bilden i den förenklade vyn, ritad på ett rutnät i låg upplösning
// som sedan skalas upp utan utjämning. Samma världskoordinater som den tecknade grafiken – bara
// avrundade till rutor om PX världsenheter – så klick, kamera och spårning fungerar som vanligt.
// Bara grafik: läser simuleringens tillstånd men ändrar det aldrig (utom S.fx-listan, som den
// tecknade grafiken också räknar ner).
import { clamp, fl } from './util.js';
import { BX1, CAR_H, CAR_W, EL, FL, FLOORS, FLOOR_H, FLOOR_HOURS, FULL_LOAD, GROUND_Y, H, INNER_X1, LAND_X0, DOOR_X, LOBBY, ROOF_Y, SHAFT_W, SHAFT_X0, TOP, W, floorOpen, floorY, shaftCX, shaftX, surf } from './config.js';
import { S, hour } from './state.js';
import { allowed, cabinKg } from './dispatch.js';
import { noteDetail, stateInfo } from './describe.js';
import { VIEW, clouds, ctx, cv, nightness, skyAt, skyline, stars } from './view.js';
import { carSlotX, landPos, peopleBehindDoor, personHead } from './render.js';
import { vpick, vrand } from './rng.js';
import { PX, blend, dark, light, ellipseSprite, fromCells, sprite, text, textW, plain, rgbOf } from './pixart.js';
import { PERSON_H, PERSON_W, cargoSprite, personSprite } from './pixpeople.js';
import { PAL } from './pixpal.js';

const INK = PAL.ink;

// ---------- Ritytan i låg upplösning ----------
const lo = document.createElement('canvas');
const g = /** @type {CanvasRenderingContext2D} */ (lo.getContext('2d'));
let X0 = 0, CY = 0;
/** världens x/y → pixel i ritytan */
const X = x => Math.round((x - X0) / PX);
const Y = y => Math.round(y / PX) - CY;
const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
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
  // stadssiluetten
  const lit = n > 0.3 && S.power;
  for (const b of skyline) {
    const x = X(b.x), y = Y(GROUND_Y - b.h), w = Math.round(b.w / PX), bot = Y(GROUND_Y);
    if (x > lo.width || x + w < 0 || bot < 0 || y > lo.height) continue;
    const col = blend(PAL.city, PAL.cityNight, n);
    R(x, y, w, bot - y, dark(col, 0.25)); R(x + 1, y + 1, w - 2, bot - y - 1, col);
    for (let wy = y + 4; wy < bot - 4; wy += 6) for (let wx = x + 3; wx < x + w - 4; wx += 5)
      if ((((wx + X0 / PX) * 7 + (wy + CY) * 13) % 10) / 10 < b.win) R(wx, wy, 2, 3, lit ? '#ffe14d' : 'rgba(255,255,255,.3)');
  }
  for (const c of clouds) { const s = cloudSprite(c.s); g.drawImage(s, X(c.x) - Math.round(20 * c.s / PX), Y(c.y) - Math.round(30 * c.s / PX)); }
}
function drawGroundPx() {
  const gy = Y(GROUND_Y);
  R(0, gy + 7, lo.width, lo.height, PAL.dirt);
  for (let y = Y(GROUND_Y + 50); y < lo.height; y += 23) R(0, y, lo.width, 5, PAL.dirtStripe);
  for (let i = 0; i < 90; i++) { const wx = (i * 137) % W, wy = GROUND_Y + 24 + (i * 53) % (H - GROUND_Y - 30); R(X(wx), Y(wy), 3, 2, PAL.pebble); }
  R(0, gy, lo.width, 7, PAL.walk); R(0, gy, lo.width, 1, INK); R(0, gy + 7, lo.width, 1, INK);
  for (let x = -((X0 / PX) % 12); x < lo.width; x += 12) R(x, gy + 1, 1, 6, PAL.walkLine);
}

// ---------- Byggnaden ----------
const INSIDE_EL = EL.filter(e => !e.facade);
const shaftTop = e => floorY(e.maxF + 1) + 4, shaftBot = e => floorY(e.minF) + 4;
const BASE_Y = floorY(0) + 6, DECK_Y = floorY(TOP);
function drawShell(h) {
  // huset: rumsdelen (under hallarna) och schakttornet; kontur runt
  const x0 = X(LAND_X0 - 20), xs = X(SHAFT_X0 - 8), x1 = X(BX1 + 7), yd = Y(DECK_Y - 4), yr = Y(ROOF_Y - 4), yb = Y(BASE_Y);
  R(x0, yd, xs - x0, yb - yd, INK); R(xs, yr, x1 - xs + 1, yb - yr, INK);
  R(x0, yd + 2, xs - x0, yb - yd - 4, PAL.shell); R(xs + 2, yr + 2, x1 - xs - 3, yb - yr - 4, PAL.shell);
  // tegel runt schakten
  const wx0 = X(SHAFT_X0 - 5), wx1 = X(BX1 - 4), wy0 = Y(ROOF_Y + 4), wy1 = Y(BASE_Y - 6);
  R(wx0, wy0, wx1 - wx0, wy1 - wy0, PAL.brick);
  for (let y = wy0 + 6, row = 0; y < wy1; y += 7, row++) {
    R(wx0, y, wx1 - wx0, 1, PAL.mortar);
    const off = (row + CY) % 2 ? 6 : 0;
    for (let x = wx0 + off; x < wx1; x += 12) R(x, y - 6, 1, 6, PAL.mortar);
  }
  const nn = nightness(h);
  // fasad med fönster där ett schakt inte går
  for (const e of INSIDE_EL) {
    const x = X(shaftX(e.id));
    for (let f = 0; f < FLOORS; f++) {
      if (f >= e.minF && f <= e.maxF + 1) continue;
      const top = Y(floorY(f + 1) + 6), bot = Y(floorY(f) - 6);
      if (bot < 0 || top > lo.height) continue;
      if (f < LOBBY) { R(x - 2, top - 1, SHAFT_W / PX + 4, bot - top + 2, PAL.basement); continue; }
      const nw = Math.floor((SHAFT_W - 6) / 32);
      for (let k = 0; k < nw; k++) {
        const wx = x + Math.round(((SHAFT_W - nw * 32 + 6) / 2 + k * 32) / PX), wy = top + 11;
        const lit = nn > 0.2 && S.power && ((f * 7 + e.id * 3 + k * 5) % 5) < 2;
        box(wx, wy, 13, 20, lit ? PAL.lit : blend(PAL.glass, PAL.glassNight, nn));
        R(wx + 6, wy + 1, 1, 18, INK); R(wx + 1, wy + 9, 11, 1, INK);
        R(wx + 2, wy + 2, 1, 6, 'rgba(255,255,255,.5)');
      }
    }
  }
  // schakten
  for (const e of INSIDE_EL) {
    const x = X(shaftX(e.id)), t = Y(shaftTop(e)), b = Y(shaftBot(e)), w = SHAFT_W / PX;
    R(x - 2, t, w + 5, b - t, PAL.shaftOuter); R(x, t, w, b - t, PAL.shaft);
    R(x + 1, t, 2, b - t, PAL.rail); R(x + w - 3, t, 2, b - t, PAL.rail);
    for (let y = t + ((-CY % 8) + 8) % 8; y < b; y += 8) { R(x + 1, y, 2, 1, PAL.railDot); R(x + w - 3, y, 2, 1, PAL.railDot); }
    if (e.express) for (let f = e.minF + 1; f < e.maxF; f++) { g.globalAlpha = 0.45; text(g, 'EXPRESS', x + w / 2, Y(floorY(f) - FLOOR_H / 2) - 3, PAL.express, 'center'); g.globalAlpha = 1; }
  }
  // panoramahissens skenor och gångbryggor
  for (const e of EL.filter(e => e.facade)) {
    const x = X(shaftX(e.id)), t = Y(shaftTop(e) - 8), b = Y(shaftBot(e)), w = SHAFT_W / PX;
    for (const rx of [x + 2, x + w - 4]) { R(rx - 1, t, 4, b - t, INK); R(rx, t, 2, b - t, PAL.steel); }
    for (let y = t + 10; y < b; y += 20) line(X(BX1 + 7), y, x + 3, y + 5, 'rgba(27,16,51,.6)');
    for (const f of e.serves) { const y = Y(floorY(f) - 4); box(X(BX1 + 7), y - 2, x - X(BX1 + 7) + 1, 4, PAL.steel); }
  }
}
function drawSlabsPx() {
  for (let f = 0; f <= FLOORS; f++) {
    const y = Y(floorY(f)) - 2;
    if (y < -4 || y > lo.height + 4) continue;
    const holes = INSIDE_EL.filter(e => e.minF < f && f <= e.maxF).map(e => [shaftX(e.id), shaftX(e.id) + SHAFT_W]).sort((a, b) => a[0] - b[0]);
    let a = f === FLOORS ? SHAFT_X0 - 8 : LAND_X0 - 20;
    const segs = [];
    for (const [h0, h1] of holes) { if (h0 > a) segs.push([a, h0]); a = Math.max(a, h1); }
    segs.push([a, BX1 + 7]);
    for (const [s0, s1] of segs) { const x = X(s0), w = X(s1) - x; R(x, y, w, 4, INK); R(x, y + 1, w, 2, PAL.slab); R(x, y + 1, w, 1, PAL.slabHi); }
  }
  // dörrkarmar vid varje hållplats
  for (const e of INSIDE_EL) for (const f of e.serves) {
    const x = X(shaftX(e.id)) + 1, y = Y(surf(f) - CAR_H - 3), w = SHAFT_W / PX - 2, h = Math.round((CAR_H + 3) / PX);
    if (y > lo.height || y + h < 0) continue;
    R(x, y, w, 1, PAL.frame); R(x, y, 1, h, PAL.frame); R(x + w - 1, y, 1, h, PAL.frame);
  }
  for (const e of S.elevators) for (const f of e.serves) lantern(e, f);
}
/** våningsdisplay ovanför hissdörren: korgens våning, riktning och anropslampor */
function lantern(e, f) {
  const cx = X(shaftCX(e.id)), y = Y(floorY(f) - 106);
  if (y < -10 || y > lo.height) return;
  box(cx - 12, y, 25, 9, PAL.lantern);
  if (!(S.power || (S.outage && S.outage.gen))) return;
  const here = Math.abs(e.pos - f) < 0.05 && e.state === 'doors';
  const led = here ? '#7dff9a' : PAL.led;
  text(g, fl(Math.round(e.pos)), cx + 3, y + 1, led, 'center');
  if (e.dir && (e.state === 'moving' || here)) text(g, e.dir > 0 ? '▲' : '▼', cx - 9, y + 1, led);
  for (const d of [1, -1]) {
    if (d === 1 && f >= e.maxF || d === -1 && f <= e.minF) continue;
    const lit = e.pick[f + (d > 0 ? 'u' : 'd')] > 0;
    const lx = cx + 15, ly = y + (d > 0 ? 0 : 4);
    const c = lit ? '#ffe14d' : PAL.dim;
    if (d > 0) { R(lx + 1, ly, 1, 1, c); R(lx, ly + 1, 3, 1, c); R(lx - 1, ly + 2, 5, 1, c); }
    else { R(lx - 1, ly + 1, 5, 1, c); R(lx, ly + 2, 3, 1, c); R(lx + 1, ly + 3, 1, 1, c); }
  }
}

// ---------- Hallen på varje våning ----------
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
  R(x0, bot - 3, x1 - x0, 3, blend(PAL.floor, acc, 0.25)); R(x0, bot - 3, x1 - x0, 1, light(blend(PAL.floor, acc, 0.25), 0.25));
  // korridoren in mot rummen (perspektiv: mörk gång, ljus längst in)
  const cw = 24, ch = 31, cx = X(DOOR_X) - cw / 2, cy = bot - ch;
  const lit = S.power && (OCC[f] > 0 || nightness(h) < 0.5);
  R(cx - 4, cy - 4, cw + 8, ch + 4, INK); R(cx - 3, cy - 3, cw + 6, ch + 3, acc); R(cx - 3, cy - 3, cw + 6, 1, light(acc, 0.35));
  R(cx - 1, cy - 1, cw + 2, ch + 1, INK);
  R(cx, cy, cw, ch, PAL.corridor);
  const ix = cx + 7, iy = cy + 7, iw = cw - 14, ih = ch - 13;
  R(ix, iy, iw, ih, lit ? blend(acc, '#fff8d0', 0.55) : PAL.dim);
  for (let r = 0; r < ch - (iy - cy) - ih; r++) {
    const yy = iy + ih + r, k = r / (ch - (iy - cy) - ih);
    const xa = Math.round(ix - k * 7), xb = Math.round(ix + iw + k * 7);
    R(xa, yy, xb - xa, 1, r % 2 ? PAL.corrA : PAL.corrB);
  }
  line(cx, cy, ix, iy, PAL.corrEdge); line(cx + cw - 1, cy, ix + iw - 1, iy, PAL.corrEdge);
  // spårad person därinne / muspekaren över korridoren
  const sel = S.sel && !S.sel.dead && S.sel.floor === f && S.sel.state !== 'ride' && personHead(S.sel)?.hidden;
  if (sel || S.hoverDoor === f) ants(cx - 6, cy - 6, cw + 12, ch + 6, sel ? '#ffe14d' : '#ffffff');
  // antal inne på våningen
  // antal inne: en liten skylt bredvid korridoren, som ett dörrnummer
  if (OCC_IN[f]) { const s = String(OCC_IN[f]), w = Math.max(9, textW(s) + 5); pill(cx + cw + 4, bot - 13, w, 9, '#ffffff'); text(g, s, cx + cw + 4 + w / 2, bot - 12, INK, 'center'); }
  // våningsnummer och företagsskylt
  const st = starSprite(acc); g.drawImage(st, X(DOOR_X) - 10, top + 1);
  text(g, fl(f), X(DOOR_X) + 1, top + 7, '#ffffff', 'center', 1, INK);
  const name = plain(FL[f].name), nx = X(DOOR_X) + 13, nw = Math.min(x1 - nx - 2, textW(name) + 7);
  pill(nx, top + 6, nw, 10, acc); R(nx + 1, top + 7, nw - 2, 1, light(acc, 0.35));
  g.save(); g.beginPath(); g.rect(nx + 1, top + 6, nw - 2, 10); g.clip();
  text(g, name, nx + 4, top + 7, '#ffffff', 'left', 1, dark(acc, 0.55));
  g.restore();
  stairSign(f, false);
}
function stairSign(f, glow) {
  const x = X(DOOR_X) + 17, y = Y(floorY(f + 1) + 4) + 24;
  if (glow) R(x - 2, y - 2, 37, 13, 'rgba(34,197,94,.45)');
  pill(x, y, 33, 9, PAL.green);
  g.drawImage(STAIR_ICON(), x + 2, y + 2);
  text(g, 'TRAPPA', x + 9, y + 1, '#ffffff');
}
function floorOverlays(f, h) {
  const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) - 4), x0 = X(LAND_X0), x1 = X(INNER_X1);
  const NO_DIM = ['lobby', 'apartments', 'roof', 'garage', 'dock'];
  if (!NO_DIM.includes(FL[f].theme) && floorOpen(f, h)) {
    const n = nightness(h);
    if (n > 0.05 && !OCC[f]) R(x0, top, x1 - x0, bot - top, `rgba(10,6,34,${0.45 * n})`);
  }
  if (FL[f].open && !floorOpen(f, h)) label(`STÄNGT – öppnar ${String(FLOOR_HOURS[f][0]).padStart(2, '0')}:00`, X(DOOR_X) + 55, top + 18, '#ff5d52', '#ffffff');
  if (f !== LOBBY && !FL[f].open && !floorOpen(f, h)) {
    const someone = S.people.some(p => p.floor === f && (p.state === 'office' || p.state === 'exiting'));
    R(x0, top, x1 - x0, bot - top, `rgba(10,6,34,${someone ? 0.38 : 0.62})`);
    const oh = FLOOR_HOURS[f], o = oh[0] % 1 ? `${Math.floor(oh[0])}:30` : `${oh[0]}:00`;
    label(`STÄNGT · öppnar ${o.padStart(5, '0')}`, X(DOOR_X) + 55, top + 18, '#ff5d52', '#ffffff');
  }
  if (S.fire) {
    const on = Math.sin(S.anim * 10) > 0;
    box(x1 - 10, top + 3, 5, 5, on ? '#ff2d55' : '#7a2033');
    if (on) R(x1 - 12, top + 1, 9, 9, 'rgba(255,45,85,.3)');
    if (S.fire.mode === 'zone' && !allowed(f)) R(x0, top, x1 - x0, bot - top, 'rgba(255,45,85,.08)');
    if (f === S.fire.floor) {
      const F = S.fire, prog = F.brigade ? clamp(1 - (F.outAt - S.t) / 28, 0, 1) : 0;
      R(x0, top, x1 - x0, bot - top, `rgba(255,100,20,${(0.2 + 0.08 * Math.sin(S.anim * 7)) * (1 - prog * 0.85)})`);
      if (prog < 0.9) {
        const fr = FLAMES();
        [DOOR_X - 10, DOOR_X + 10, DOOR_X + 46].forEach((wx, i) => g.drawImage(fr[(Math.floor(S.anim * 9) + i) % 3], X(wx) - 6, bot - 13 - (i === 1 ? 4 : 0)));
      }
    }
  }
}

// ---------- Hissarna ----------
function drawCarPx(e) {
  const x = X(shaftX(e.id) + 4), yb = Y(floorY(e.pos) - 4), cw = CAR_W / PX, chh = CAR_H / PX, yt = yb - chh;
  if (yt > lo.height + 40 || yb < -40) return;
  if (!e.facade) {
    // motvikt och bärlinor
    const span = Math.max(1, e.maxF - e.minF), frac = (e.pos - e.minF) / span;
    const st = Y(shaftTop(e)), sb = Y(shaftBot(e)), cwH = 23, cwX = X(shaftX(e.id) + SHAFT_W - 15);
    const cwY = Math.round(st + 4 + frac * (sb - st - cwH - 8));
    R(cwX + 2, st, 1, cwY - st, INK);
    box(cwX, cwY, 5, cwH, PAL.basement); for (let k = 1; k < 5; k++) R(cwX + 1, cwY + k * 4, 3, 1, '#4a4170');
    for (const dx of [-6, -2, 2, 6]) R(x + cw / 2 + dx, st, 1, yt - st, INK);
    R(x + cw / 2 - 9, yt - 4, 19, 1, INK); R(x + cw / 2 - 9, yt - 4, 1, 4, INK); R(x + cw / 2 + 9, yt - 4, 1, 4, INK);
  }
  const off = e.off || e.mode === 'locked' || e.sleep || e.zoneLock;
  const body = off ? PAL.carOff : e.color;
  // korgen
  R(x, yt + (e.facade ? 2 : 0), cw, chh - (e.facade ? 2 : 0), INK);
  if (e.facade) { R(x + 2, yt, cw - 4, 2, INK); R(x + 1, yt + 1, cw - 2, 1, INK); }
  R(x + 1, yt + 1, cw - 2, chh - 2, body);
  R(x + 1, yt + 1, cw - 2, 1, light(body, 0.4)); R(x + 1, yb - 2, cw - 2, 1, dark(body, 0.3));
  const ix = x + 2, iy = yt + 7, iw = cw - 4, ih = chh - 9;
  R(ix - 1, iy - 1, iw + 2, ih + 2, INK);
  const inner = e.facade ? PAL.cabinGlass : e.freight ? PAL.cabinFreight : PAL.cabin;
  R(ix, iy, iw, ih, inner);
  R(ix, iy + ih - 6, iw, 6, dark(inner, 0.12));
  if (e.freight) for (let k = 0; k < 4; k++) R(ix, iy + 5 + k * 8, iw, 1, 'rgba(27,16,51,.18)');
  else for (let k = 1; k < 4; k++) R(ix + k * Math.round(iw / 4), iy, 1, ih - 6, dark(inner, 0.08));
  if (e.facade) { line(ix + 3, iy + ih - 3, ix + 10, iy + 3, '#ffffff'); line(ix + 7, iy + ih - 3, ix + 14, iy + 3, '#ffffff'); }
  // passagerarna: bakre raden först
  g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
  const ps = e.passengers;
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => Number(a.i >= 4) - Number(b.i >= 4));
  for (const { p, i } of order) {
    // bakre raden står högre upp och lite i skugga, så att huvudena syns ovanför främre raden
    const back = i < 4, px = x + Math.round(carSlotX(i) / PX) - PERSON_W / 2 + (back ? 0 : 2), py = yb - (back ? 9 : 1) - PERSON_H;
    if (back) g.filter = 'brightness(0.82)';
    g.drawImage(personSprite(p, 'front', 0, 1, { blink: blinkOf(p), hot: hotOf(p) }), px, py);
    g.filter = 'none';
  }
  g.restore();
  // dörrarna
  const half = iw / 2, open = Math.round(half * (1 - e.door));
  // dörrarna är av tonat glas, så att man ser vilka som åker med
  if (open > 0) for (const side of [0, 1]) {
    const px = side ? ix + iw - open : ix;
    R(px, iy, open, ih, PAL.doorGlass);
    R(px, iy + ih - 7, open, 7, PAL.doorLow);
    R(px, iy, open, 1, PAL.doorTop);
    R(side ? px : px + open - 1, iy, 1, ih, PAL.doorEdge);
    if (open > 4) R(side ? px + 2 : px + open - 3, iy + 3, 1, Math.min(10, ih - 12), 'rgba(255,255,255,.6)');
  }
  // namn, riktning, last
  // överkant: namn och färdriktning till vänster, lasten till höger
  const nw = text(g, e.name, x + 1, yt, '#ffffff', 'left', 1, INK);
  if (e.dir && e.state === 'moving') text(g, e.dir > 0 ? '▲' : '▼', x + nw + 2, yt + 1, '#ffffff');
  const kg = cabinKg(e);
  text(g, `${Math.round(kg)}KG`, x + cw - 2, yt + 1, kg >= e.ratedKg * FULL_LOAD ? '#ffffff' : dark(body, 0.65), 'right');
  const fr = Math.min(1, kg / e.ratedKg);
  R(ix, yb - 3, iw, 2, 'rgba(27,16,51,.6)');
  R(ix, yb - 3, Math.round(iw * fr), 2, kg > e.ratedKg ? '#ff2d55' : kg >= e.ratedKg * FULL_LOAD ? '#ff8c42' : '#7cf06b');
  if (VIEW.follow === e.id) ants(x - 3, yt - 3, cw + 6, chh + 6, '#7dff9a');
  if (e.overloadFlash > 0) { if (Math.sin(S.anim * 18) > -0.2) label('ÖVERLAST!', x + cw / 2, yt - 11, '#ff2d55', '#ffffff'); }
  else if (e.fullFlash > 0) label('FULLT!', x + cw / 2, yt - 11, '#ffffff', '#ff2d55');
  if (e.off) label('UR DRIFT', x + cw / 2, yt + chh / 2 - 4, '#ffe14d');
  if (e.sleep) {
    R(ix, iy, iw, ih, 'rgba(20,14,60,.45)');
    for (let i = 0; i < 3; i++) {
      const k = (S.anim * 0.5 + i / 3) % 1;
      g.globalAlpha = 1 - k; text(g, 'Z', x + cw / 2 + 3 + Math.round(k * 7), yt - 3 - Math.round(k * 13), '#bfeaff', 'left', i === 2 ? 2 : 1, INK); g.globalAlpha = 1;
    }
  }
  if (e.zoneLock) label('SPÄRRAD', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  if (e.mode === 'locked') label('AVSTÄNGD', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  if (e.mode === 'recall') label('→ TILL E', x + cw / 2, yt - 11, '#ff8c42');
  if (e.mode === 'rescue') label('NÖDSÄNK', x + cw / 2, yt - 11, '#7dff9a');
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
    const walking = p.state !== 'wait';
    const dir = walking && lp.dir ? lp.dir : (p.face || 1);
    const frame = walking ? Math.floor(((p.walkPhase || 0) % (Math.PI * 2)) / (Math.PI / 2)) % 4 : 0;
    const fx = X(lp.x), fy = Y(surf(p.floor) + p.depth * 0.6);
    g.globalAlpha = lp.a;
    const cg = walking && p.cargo ? cargoSprite(p.cargo.kind, dir) : null;
    if (cg && p.cargo.kind === 'resväska') g.drawImage(cg.c, fx + cg.dx, fy - cg.c.height + 1 - cg.lift);
    g.drawImage(personSprite(p, 'side', frame, dir, { blink: blinkOf(p), hot: hotOf(p) }), fx - PERSON_W / 2, fy - PERSON_H + 1);
    if (cg && p.cargo.kind !== 'resväska') g.drawImage(cg.c, fx + cg.dx, fy - cg.c.height + 1 - cg.lift);
    // ånga ur öronen när någon är riktigt sur
    if ((p.mood || 0) === 2) for (let i = 0; i < 2; i++) {
      const k = (S.anim * 1.4 + i * 0.5 + p.id * 0.13) % 1;
      R(fx + (i ? 4 : -5), fy - 25 - Math.round(k * 7), k < 0.5 ? 2 : 1, k < 0.5 ? 2 : 1, `rgba(255,255,255,${1 - k})`);
    }
    g.globalAlpha = 1;
  }
  for (const { p, lp } of list) if (p.state === 'wait') thought(p, X(lp.x) + 3, Y(surf(p.floor) + p.depth * 0.6) - 30);
  if (S.tags) for (const { p, lp } of list) if (p.state !== 'wait' && lp.a > 0.5) label(p.name, X(lp.x), Y(surf(p.floor) + p.depth * 0.6) - 36);
}
/** tankebubblan: mål och tilldelad hiss */
function thought(p, x, y) {
  const e = p.assigned !== null ? S.elevators[p.assigned] : null;
  const txt = plain((S.tags ? p.name + ' ' : '') + '→' + fl(p.dest));
  const tw = textW(txt), chip = e ? textW(e.name) + 4 : 0;
  const w = tw + 6 + (e ? chip + 2 : 0), h = 9, bx = x - Math.round(w / 2), by = y - h;
  R(x - 1, y + 2, 2, 2, INK); R(x + 1, y, 2, 2, INK); R(x + 1, y, 1, 1, '#ffffff');
  pill(bx, by, w, h, p === S.sel ? '#ffe14d' : '#ffffff');
  text(g, txt, bx + 3, by + 1, INK);
  if (e) { const cx = bx + tw + 5; R(cx, by + 1, chip, 7, e.color); text(g, e.name, cx + 2, by + 1, PAL.on(e.color)); }
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
let gags = [], gagT = 2;
function drawGagsPx(dt) {
  if (S.started && !S.paused) {
    gagT -= dt;
    if (gagT <= 0) {
      gagT = vrand(1.8, 4);
      const lo2 = VIEW.camY, hi = VIEW.camY + VIEW.viewH;
      const cands = S.people.filter(p => p.state === 'office' && !p.sleeping && p.spot && p.spot.k !== 'door' && floorY(p.floor) > lo2 + 40 && floorY(p.floor) < hi + 40 && !gags.some(q => q.p.floor === p.floor));
      if (cands.length) {
        const p = vpick(cands), th = FL[p.floor].theme;
        const own = GAGS[th] && GAGS[th].length ? GAGS[th] : null;
        const list = own && Math.random() < 0.75 ? own : GAGS._;
        if (list.length) gags.push({ p, text: vpick(list), life: 3.2 });
      }
    }
  }
  for (const q of gags) {
    q.life -= dt;
    if (q.p.state !== 'office' || q.p.dead) { q.life = 0; continue; }
    const s = plain(q.text), w = textW(s) + 7, x = clamp(X(DOOR_X) + 6 - Math.round(w / 2), X(LAND_X0) + 1, X(INNER_X1) - w - 1), y = Y(floorY(q.p.floor) - 50) - 17;
    g.globalAlpha = clamp(q.life * 2, 0, 1);
    pill(x, y, w, 10, '#ffffff'); text(g, s, x + 4, y + 2, INK);
    R(X(DOOR_X) + 2, y + 10, 3, 1, INK); R(X(DOOR_X) + 3, y + 11, 1, 1, INK); R(X(DOOR_X) + 3, y + 9, 1, 1, '#ffffff');
    g.globalAlpha = 1;
  }
  gags = gags.filter(q => q.life > 0);
}

// ---------- Taket, helikoptern, incidenter ----------
function drawRoofPx() {
  const n = nightness(hour());
  box(X(SHAFT_X0 - 8), Y(ROOF_Y - 50), Math.round((BX1 - SHAFT_X0 + 4) / PX), 24, PAL.machine);
  R(X(SHAFT_X0 - 8) + 1, Y(ROOF_Y - 50) + 1, Math.round((BX1 - SHAFT_X0 + 4) / PX) - 2, 1, PAL.machineHi);
  text(g, 'MASKINRUM', X(SHAFT_X0), Y(ROOF_Y - 50) + 2, INK);
  const wheel = (e, cx, cy) => g.drawImage(wheelSprite(e.color, Math.floor(((e.distance * 2.2) % (Math.PI / 3)) / (Math.PI / 3) * 6)), X(cx) - 8, Y(cy) - 8);
  for (const e of S.elevators) {
    const cx = shaftCX(e.id);
    if (EL[e.id].facade) { box(X(BX1 + 4), Y(ROOF_Y - 26), Math.round((cx - BX1 + 2) / PX), 4, PAL.steel); wheel(e, cx, ROOF_Y - 20); continue; }
    if (EL[e.id].maxF >= TOP) { wheel(e, cx, ROOF_Y - 20); continue; }
    const y = shaftTop(EL[e.id]);
    box(X(shaftX(e.id) + 6), Y(y - 34), Math.round((SHAFT_W - 12) / PX), 15, PAL.machine);
    wheel(e, cx, y - 19);
  }
  // skylten på taket
  const sx0 = SHAFT_X0 + 40, sx1 = BX1 - 60;
  for (const px of [sx0 + 60, sx1 - 60]) R(X(px) - 1, Y(96), 3, Y(ROOF_Y - 50) - Y(96), INK);
  const bx = X(sx0), by = Y(24), bw = X(sx1) - bx, bh = 36;
  box(bx, by, bw, bh, PAL.sign); R(bx + 1, by + 1, bw - 2, 1, PAL.signHi); R(bx + 1, by + bh - 2, bw - 2, 1, PAL.signLo);
  const nb = Math.floor((bw - 12) / 10);
  for (let i = 0; i < nb; i++) {
    const on = S.power && (Math.floor(S.anim * 4) + i) % 3 === 0;
    for (const yy of [by + 3, by + bh - 5]) R(bx + 6 + i * 10, yy, 2, 2, on ? PAL.bulbOn : PAL.bulbOff);
  }
  text(g, 'SKYSKRAPAN', bx + bw / 2, by + 7, '#ffffff', 'center', 4, INK);
  const ax = X(BX1 - 24);
  R(ax, Y(24), 2, Y(ROOF_Y - 50) - Y(24), INK); R(ax - 7, Y(60), 16, 2, INK); R(ax - 5, Y(80), 12, 2, INK);
  const blink = Math.sin(S.anim * 4) > 0;
  if (blink) R(ax - 4, Y(20) - 4, 10, 10, `rgba(255,45,85,${0.35 + n * 0.3})`);
  box(ax - 2, Y(20) - 2, 6, 6, blink ? '#ff2d55' : '#7a2033');
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
function drawSmokePx() {
  const F = S.fire; if (!F) return;
  const prog = F.brigade ? clamp(1 - (F.outAt - S.t) / 28, 0, 1) : 0;
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
  if (S.power) return;
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
    const x = X(shaftX(e.id) + 4), yt = Y(floorY(e.pos) - 4 - CAR_H);
    if (Math.sin(S.anim * 4 + e.id) > 0) label('HJÄLP!', x + CAR_W / PX / 2, yt - 11, '#ffffff', '#ff2d55');
  }
  if (O && O.gen) {
    const gx = X(BX1 - 40), gy = Y(ROOF_Y - 70);
    box(gx - 15, gy, 30, 11, PAL.green); text(g, 'RESERV', gx, gy + 2, '#ffffff', 'center');
    for (let i = 0; i < 2; i++) { const k = (S.anim * 0.9 + i * 0.5) % 1; g.globalAlpha = 1 - k; g.drawImage(PUFF(2 + Math.round(k * 2)), gx + 9, gy - 4 - Math.round(k * 10)); g.globalAlpha = 1; }
  }
}
function drawBannersPx() {
  const list = [];
  if (S.fire) list.push([`🔥 BRAND PÅ VÅNING ${fl(S.fire.floor)}${S.fire.brigade ? ' – BRANDKÅREN SLÄCKER' : ''}`, '#ff2d55']);
  if (!S.power) list.push([`⚡ STRÖMAVBROTT${S.outage && S.outage.gen ? ' – RESERVKRAFT' : ''}`, '#6366f1']);
  list.forEach(([t, c], i) => {
    const s = plain(t), on = Math.sin(S.anim * 6) > -0.3, w = textW(s) * 2 + 16, x = Math.round(lo.width / 2 - w / 2), y = Math.round(VIEW.camY / PX) - CY + 6 + i * 18;
    pill(x, y, w, 16, on ? c : INK);
    text(g, s, lo.width / 2, y + 2, on ? '#ffffff' : c, 'center', 2);
  });
}
function drawFxPx(dt) {
  for (const f of S.fx) {
    f.life -= dt; f.y -= 30 * dt;
    g.globalAlpha = clamp(f.life, 0, 1);
    text(g, plain(f.text), X(f.x), Y(f.y) - 6, f.color, 'center', (f.size || 22) > 24 ? 3 : 2, INK);
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
  const hr = hour();
  OCC = new Array(FLOORS).fill(0); OCC_IN = new Array(FLOORS).fill(0);
  for (const p of S.people) {
    if (p.dead) continue;
    if (p.state !== 'ride' && p.state !== 'away' && p.state !== 'incar') OCC[p.floor]++;
    if (p.state === 'office' || p.state === 'instairs') OCC_IN[p.floor]++;
  }
  drawSkyAll(hr);
  drawGroundPx();
  drawShell(hr);
  for (let f = 0; f < FLOORS; f++) {
    if (floorY(f) < VIEW.camY - 10 || floorY(f + 1) > VIEW.camY + VIEW.viewH + 10) continue;
    drawHall(f, hr); floorOverlays(f, hr);
  }
  drawSlabsPx();
  for (const e of S.elevators) drawCarPx(e);
  drawHallPeople();
  drawHeliPx();
  drawSmokePx();
  drawOutagePx();
  drawRoofPx();
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
