// Pixelgrafikens grund: ritytan i låg upplösning, de statiska lagren (layer), platsbokningen för
// text (reserve/place), ritverktygen och figurer som byggs en gång. Alla pix*.js ritar härigenom.
// (g, lo, X0 och CY byts bara här: av layer() och beginFrame() – de andra modulerna läser dem.)
import { PAL } from './pixpal.js';
import { ellipseSprite, fromCells, light, plain, PX, sprite, text, textW } from './pixart.js';
import { H } from './config.js';
import { clamp } from './util.js';
import { cv, nightness, VIEW } from './view.js';
import { S } from './state.js';
import { profLayer, profOn } from './prof.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

export const INK = PAL.ink;

// ---------- Ritytan i låg upplösning ----------
const LO = document.createElement('canvas');
const G = /** @type {CanvasRenderingContext2D} */ (LO.getContext('2d'));
// lo/g är ritytan som ritfunktionerna skriver till just nu: bilden, eller ett statiskt lager (se layer)
export let lo = LO, g = G;
export let X0 = 0, CY = 0;
/** världens x/y → pixel i ritytan */
export const X = x => Math.round((x - X0) / PX);
export const Y = y => Math.round(y / PX) - CY;
/** så länge det tar för våningarna att tändas igen efter ett strömavbrott (s) */
export const RELIGHT_S = 2.4;
export const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
// ---------- Statiska lager ----------
// Det som nästan aldrig ändras (stadssiluetten, tegel, fasadfönster, schakt, garagerampen) ritas en gång
// i ett eget lager som täcker hela världens höjd, och kopieras sedan in varje bildruta. Lagret ritas om
// bara när nyckeln ändras (natten i 32 steg, strömmen, bredden). Ritfunktionerna är desamma: medan
// lagret ritas pekar lo/g på lagret och CY är 0, så Y() ger världens y i lagret.
/** @type {Map<string, { c: HTMLCanvasElement, g: CanvasRenderingContext2D, key: string }>} */
const layers = new Map();
export function layer(name, key, draw) {
  let L = layers.get(name);
  const full = `${key}|${LO.width}|${X0}`;
  if (!L || L.key !== full) {
    if (!L) { const c = document.createElement('canvas'); L = { c, g: /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), key: '' }; layers.set(name, L); }
    L.c.width = LO.width; L.c.height = Math.ceil(H / PX) + 4; // (att sätta storleken tömmer lagret)
    L.key = full;
    const kLo = lo, kG = g, kCY = CY;
    lo = L.c; g = L.g; CY = 0; g.imageSmoothingEnabled = false;
    const t0 = profOn() ? performance.now() : 0;
    try { draw(); } finally { lo = kLo; g = kG; CY = kCY; }
    if (t0) profLayer(performance.now() - t0);
  }
  // bara den synliga biten kopieras
  const sy = clamp(CY, 0, L.c.height), sh = Math.min(LO.height, L.c.height - sy);
  if (sh > 0) G.drawImage(L.c, 0, sy, L.c.width, sh, 0, sy - CY, L.c.width, sh);
}
/** nattfaktorn i 32 steg (för lagrens nycklar – skillnaden syns inte i pixelgrafiken) */
export const nightStep = h => Math.round(nightness(h) * 32) / 32;
/** ruta med kontur */
export function box(x, y, w, h, fill, outline = INK) { R(x, y, w, h, outline); R(x + 1, y + 1, w - 2, h - 2, fill); }
/** ruta med kontur och "fasade" hörn (pixelkonstens rundade hörn) */
export function pill(x, y, w, h, fill, outline = INK) {
  R(x + 1, y, w - 2, h, outline); R(x, y + 1, w, h - 2, outline);
  R(x + 1, y + 1, w - 2, h - 2, fill);
}
/** marscherande myror runt en ruta (spårning, följ) */
export function ants(x, y, w, h, c, speed = 8) {
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
export function line(x0, y0, x1, y1, c) {
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
export function label(str, cx, y, fill = '#ffffff', color = INK, align = 'center') {
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
export function reserve(x, y, w, h) { taken.push({ x, y, w, h }); }
/** En ny bildruta: ritytan får fönstrets storlek, kameran läses av och platsbokningen töms.
 *  Ger skalan (skärmpixlar per världsenhet) och ritytans storlek i låga pixlar. */
export function beginFrame() {
  const s = VIEW.scale * VIEW.dpr;
  const w = Math.ceil(cv.width / s / PX) + 1, h = Math.ceil(cv.height / s / PX) + 2;
  if (lo.width !== w || lo.height !== h) { lo.width = w; lo.height = h; }
  X0 = VIEW.x0; CY = Math.floor(VIEW.camY / PX);
  g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.globalAlpha = 1;
  taken = [];
  return { s, w, h };
}
/** närmaste lediga y för rutan (bokas), eller null om allt är upptaget */
export function place(x, y, w, h, steps = [0, -11, 11, -22]) {
  for (const d of steps) if (!hits(x, y + d, w, h)) { reserve(x, y + d, w, h); return y + d; }
  return null;
}

// ---------- Figurer som byggs en gång ----------
const memo = new Map();
export const once = (key, fn) => { let v = memo.get(key); if (!v) { v = fn(); memo.set(key, v); } return v; };
/** stjärnan med våningsnumret */
export function starSprite(c) {
  return once('star' + c, () => {
    const r1 = 9.5, r0 = 5, n = 19, cells = [];
    const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? r0 : r1; pts.push([9 + Math.cos(a) * r, 9.5 + Math.sin(a) * r]); }
    const inside = (x, y) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
    for (let y = 0; y < n; y++) { const row = []; for (let x = 0; x < n; x++) row.push(inside(x + 0.5, y + 0.5) ? (y < 6 ? light(c, 0.25) : c) : null); cells.push(row); }
    return fromCells(cells, n, n, 1, INK);
  });
}
export const SUN = () => once('sun', () => {
  const cells = [], n = 15, c = 7;
  for (let y = 0; y < n; y++) { const row = []; for (let x = 0; x < n; x++) { const d = Math.hypot(x - c, y - c); row.push(d <= 7.2 ? (y === 6 && (x >= 3 && x <= 6 || x >= 8 && x <= 11) ? INK : y === 7 && (x === 7) ? INK : y === 10 && x >= 5 && x <= 9 ? INK : y === 9 && (x === 4 || x === 10) ? INK : d > 5.6 ? '#ffb627' : '#ffe14d') : null); } cells.push(row); }
  return fromCells(cells, n, n, 1, INK);
});
export const MOON = () => once('moon', () => {
  const cells = [], n = 20;
  for (let y = 0; y < n; y++) { const row = []; for (let x = 0; x < n; x++) row.push(Math.hypot(x - 9.5, y - 9.5) <= 9.5 && Math.hypot(x - 14, y - 6) > 8 ? (x < 6 ? '#fff6c9' : '#efe2a0') : null); cells.push(row); }
  return fromCells(cells, n, n, 1, INK);
});
export function cloudSprite(s) {
  return once('cloud' + s.toFixed(2), () => {
    const parts = [[0, 0, 18], [18, -8, 20], [36, 0, 16], [16, 6, 16]].map(([x, y, r]) => [(x + 20) * s / PX, (y + 30) * s / PX, r * s / PX]);
    const w = Math.ceil(76 * s / PX), h = Math.ceil(56 * s / PX), cells = [];
    for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) { const inside = parts.some(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r); row.push(inside ? (y > h * 0.62 ? '#dfe7f5' : '#ffffff') : null); } cells.push(row); }
    return fromCells(cells, w, h, 1, INK);
  });
}
/** linhjul i maskinrummet – ekrarna i några vridningslägen */
export function wheelSprite(color, k) {
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
export const FLAMES = () => once('flames', () => [
  ['....R.....', '...RR.....', '...RRR..R.', '..RROR.RR.', '..ROORRRR.', '.RROYORRR.', '.ROOYYOOR.', 'RROYYYYORR', 'ROOYYYYOOR', 'ROOYYYYOOR', '.ROOYYOOR.', '..RROORR..'],
  ['.....R....', '....RR..R.', '..R.RRR.R.', '..RRROR.RR', '.RRORRORR.', '.ROOYOORR.', 'RROOYYOORR', 'ROOYYYYOOR', 'ROOYYYYOOR', 'ROOYYYYOOR', '.ROOYYOOR.', '..RROORR..'],
  ['...R......', '...RR.R...', '.R.RRRRR..', '.RRRORRR..', '.RROORORR.', 'RROOYYORR.', 'ROOYYYOORR', 'ROOYYYYOOR', 'ROOYYYYOOR', 'ROOYYYYOOR', '.ROOYYOOR.', '..RROORR..'],
].map(r => sprite(r, { R: '#ff4b1f', O: '#ff9f1c', Y: '#ffe14d' })));
export const PUFF = r => once('puff' + r, () => ellipseSprite(r * 2, r * 2, '#5a5068', null, '#4a4058'));
export const ARROW = () => once('arrow', () => sprite(['.YYY.', '.YYY.', '.YYY.', 'YYYYY', '.YYY.', '..Y..'], { Y: '#ffe14d' }));
export const STAIR_ICON = () => once('stair', () => sprite(['....WW', '...WW.', '..WW..', '.WW...', 'WW....'], { W: '#ffffff' }, null));
export const HELI = () => once('heli', () => sprite([
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
