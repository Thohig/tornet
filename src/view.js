// Canvas, skalning och kamera.
import { vrand } from './rng.js';
import { clamp, mix } from './util.js';
import { FLOOR_H, H, LAND_X0, W, floorY, shaftCX } from './config.js';
import { S } from './state.js';
import { personHead } from './render.js';

// ---------- Grafik: setup ----------
/** @param {string} id */
const canvas = id => /** @type {HTMLCanvasElement} */ (document.getElementById(id));
export const cv = canvas('game'), ctx = cv.getContext('2d');
export const portrait = canvas('portrait'), pctx = portrait.getContext('2d');
export const stage = document.getElementById('stage');
// camY = världskoordinaten högst upp i bilden, viewH = hur mycket av huset som syns (i världsenheter)
// x0 = världens x vid bildens vänsterkant: bilden börjar vid hallen, rummen till vänster syns inte
// Kameran kan vara kopplad till en hiss (follow), till den spårade personen (camSel) eller stå på en våning
// (camFloor). Manuell scrollning kopplar loss den; lastCam minns vad den senast följde så att den kan kopplas på igen.
/** @typedef {{ kind: 'car'|'person'|'floor', id: number }} CamTarget */
export const VIEW = { scale: 1, dpr: 1, camY: 0, viewH: H, x0: LAND_X0, follow: /** @type {number|null} */ (null),
  camSel: false, camFloor: /** @type {number|null} */ (null), lastCam: /** @type {CamTarget|null} */ (null),
  // regissören (director.js): automatisk kamera och den tagning den visar just nu
  auto: false, shot: /** @type {(import('./director.js').Shot & { t0: number })|null} */ (null),
  // sidled (smal skärm): bilden är bredare än spelytan och flyttas panX css-pixlar åt vänster; panTo = dit den glider
  panX: 0, panW: 0, panTo: /** @type {number|null} */ (null),
  // textskylten längst ner i bilden (#lower) täcker padB världsenheter: kameran räknar med att bara
  // viewH − padB syns, och kan scrolla padB längre ner så att även stationen hamnar ovanför skylten
  padB: 0 };
/** css-pixlar som textskylten tar längst ner i bilden (vanligt läge / biografläget) */
const LOWER_PX = { std: 62, cinema: 118 };
// Minsta skala: på en telefon blir huset annars så litet att folk är prickar och skyltarna oläsliga.
// Är spelytan smalare scrollar bilden i sidled. Skalan avrundas så att en pixel i pixelgrafiken (PX = 2
// världsenheter) blir ett helt antal skärmpixlar.
const MIN_SCALE = 0.7;
export function resize() {
  // huset fyller hela bredden och kameran visar en del i taget (scrolla eller låt kameran följa)
  const stacked = window.innerWidth <= 800;
  // svh: Safari räknar vh med ytan bakom adressfältet
  // staplat (smal skärm): bilden överst och kontrollpanelen under; lämna plats så att panelens översta block
  // (uppspelningen, händelserna och det du följer) syns under bilden utan att man scrollar sidan.
  // svh: Safari räknar vh med ytan bakom adressfältet
  const vh = CSS.supports('height', '1svh') ? 'svh' : 'vh', cinema = document.body.classList.contains('cinema');
  stage.style.height = !stacked ? '' : cinema ? `100${vh}` : `max(50${vh}, calc(100${vh} - 270px))`;
  const r = stage.getBoundingClientRect();
  const innerW = r.width - 4, innerH = r.height - 4; // (ramen runt spelytan)
  const VW = W - VIEW.x0; // hela bredden i världsenheter
  const dpr = window.devicePixelRatio || 1;
  const fit = innerW / VW;
  const s = fit >= MIN_SCALE ? fit : Math.max(fit, Math.round(MIN_SCALE * 2 * dpr) / (2 * dpr));
  const padB = (cinema ? LOWER_PX.cinema : LOWER_PX.std) / s;
  const cssW = VW * s, cssH = Math.min((H + padB) * s, innerH);
  // samma storlek som förut (Safari skickar resize när adressfältet fälls in): rita inte om canvasen
  if (cv.width === Math.round(cssW * dpr) && cv.height === Math.round(cssH * dpr) && VIEW.dpr === dpr && VIEW.panW === innerW && VIEW.padB === padB) return;
  VIEW.padB = padB;
  VIEW.panW = innerW;
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  VIEW.scale = s; VIEW.dpr = dpr; VIEW.viewH = cssH / s;
  VIEW.camY = clamp(VIEW.camY, 0, camMax());
  // går det att scrolla i bilden tar den ett finger själv (två fingrar zoomar sidan som vanligt);
  // syns hela huset får ett finger scrolla sidan i stället
  cv.style.touchAction = camMax() > 0 ? 'pinch-zoom' : 'auto';
  portrait.width = 64 * dpr; portrait.height = 76 * dpr;
  S.trackDirty = true;
}
window.addEventListener('resize', resize);
// ---------- Kamera ----------
export const camMax = () => Math.max(0, H + VIEW.padB - VIEW.viewH);
/** hur mycket av bilden som syns ovanför textskylten (världsenheter) */
export const seeH = () => VIEW.viewH - VIEW.padB;
/** hur långt bilden kan flyttas i sidled (css-pixlar) */
export const panMax = () => Math.max(0, parseFloat(cv.style.width || '0') - VIEW.panW);
function setPan(x) {
  VIEW.panX = clamp(x, 0, panMax());
  cv.style.transform = VIEW.panX ? `translateX(${-VIEW.panX}px)` : '';
}
/** håll en punkt (världens x) i bild i sidled: flytta bara om den är nära kanten */
export function keepX(wx) {
  if (wx == null || panMax() <= 0) return;
  const cx = (wx - VIEW.x0) * VIEW.scale, l = VIEW.panX + VIEW.panW * 0.2, r = VIEW.panX + VIEW.panW * 0.8;
  if (cx < l || cx > r) VIEW.panTo = clamp(cx - VIEW.panW * 0.5, 0, panMax());
}
export function lookAt(worldY, hold = 4) {
  // centrera kameran på en punkt; pausa följ-läget en stund så att den inte drar iväg direkt
  S.camTarget = clamp(worldY - seeH() / 2, 0, camMax());
  S.followHold = S.anim + hold;
}
export function scrollToFloor(f) {
  detachCam(); VIEW.camFloor = f;
  lookAt(floorY(f) - FLOOR_H / 2, 0);
  keepX(VIEW.x0); // (hallen ligger längst till vänster)
}
/** titta på en våning en stund utan att koppla loss kameran (t.ex. när en incident börjar) */
export function peekFloor(f) { lookAt(floorY(f) - FLOOR_H / 2, 5); }
/** vad kameran följer just nu (null = fri kamera) */
export function camTarget() {
  if (VIEW.follow !== null) return /** @type {CamTarget} */ ({ kind: 'car', id: VIEW.follow });
  if (VIEW.camSel && S.sel && !S.sel.dead) return /** @type {CamTarget} */ ({ kind: 'person', id: S.sel.id });
  if (VIEW.camFloor !== null) return /** @type {CamTarget} */ ({ kind: 'floor', id: VIEW.camFloor });
  return null;
}
/** koppla loss kameran (den står kvar där den är) men minns vad den följde */
export function detachCam() {
  const t = camTarget();
  if (t) VIEW.lastCam = t;
  VIEW.follow = null; VIEW.camSel = false; VIEW.camFloor = null; VIEW.auto = false;
}
/** följ en hiss */
export function followCar(id) {
  detachCam(); VIEW.follow = id; S.followHold = 0;
}
export function updateCamera(dt) {
  const p = S.sel;
  if (VIEW.camSel && (!p || p.dead)) VIEW.camSel = false;
  if (VIEW.follow !== null && S.anim > (S.followHold || 0)) {
    // följ en hiss: håll korgen mitt i bild
    const y = floorY(S.elevators[VIEW.follow].pos) - FLOOR_H / 2;
    S.camTarget = clamp(y - seeH() * 0.5, 0, camMax());
    keepX(shaftCX(VIEW.follow));
  } else if (VIEW.camSel && p && S.anim > (S.followHold || 0)) {
    const h = personHead(p);
    if (h) {
      keepX(h.x);
      const y = h.y + 40, top = VIEW.camY + seeH() * 0.22, bot = VIEW.camY + seeH() * 0.78;
      if (y < top || y > bot) S.camTarget = clamp(y - seeH() * 0.5, 0, camMax());
    }
  }
  if (S.camTarget != null) {
    VIEW.camY += (S.camTarget - VIEW.camY) * Math.min(1, dt * 5);
    if (Math.abs(S.camTarget - VIEW.camY) < 0.5) { VIEW.camY = S.camTarget; S.camTarget = null; }
  }
  VIEW.camY = clamp(VIEW.camY, 0, camMax());
  if (VIEW.panTo != null) {
    let x = VIEW.panX + (VIEW.panTo - VIEW.panX) * Math.min(1, dt * 5);
    if (Math.abs(VIEW.panTo - x) < 0.5) { x = VIEW.panTo; VIEW.panTo = null; }
    setPan(x);
  }
}
export function scrollBy(dy, dx = 0) {
  // manuell scrollning kopplar loss kameran
  detachCam(); S.camTarget = null; VIEW.panTo = null;
  VIEW.camY = clamp(VIEW.camY + dy, 0, camMax());
  if (dx) setPan(VIEW.panX + dx * VIEW.scale);
}
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  scrollBy(ev.deltaY / VIEW.scale, ev.deltaX / VIEW.scale);
}, { passive: false });
// Dra i bilden (finger eller mus) för att scrolla. Först när fingret flyttats en bit räknas det som
// ett drag – ett tryck utan rörelse är fortfarande ett klick (följ person/hiss/våning).
const DRAG_PX = 8;
/** @type {{ id: number, x: number, y: number, moved: boolean }|null} */
let drag = null, dragEnded = 0;
cv.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || (camMax() <= 0 && panMax() <= 0)) return;
  drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false };
});
cv.addEventListener('pointermove', ev => {
  if (!drag || ev.pointerId !== drag.id) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
  if (!drag.moved) { drag.moved = true; cv.setPointerCapture(ev.pointerId); }
  scrollBy(-dy / VIEW.scale, -dx / VIEW.scale);
  drag.x = ev.clientX; drag.y = ev.clientY;
});
const endDrag = (/** @type {PointerEvent} */ ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  if (drag.moved) dragEnded = performance.now();
  drag = null;
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
// klicket som följer direkt på ett drag ska inte välja det som råkar ligga under fingret
cv.addEventListener('click', ev => {
  if (performance.now() - dragEnded < 300) ev.stopImmediatePropagation();
}, true);
export const clouds = Array.from({ length: 6 }, (_, i) => ({ x: i * 190 + vrand(0, 80), y: vrand(16, 110), s: vrand(0.7, 1.2), v: vrand(4, 9) }));
export const stars = Array.from({ length: 50 }, () => ({ x: vrand(0, W), y: vrand(0, 130), r: vrand(0.8, 2) }));
export const skyline = [];
for (let x = -20; x < W + 20;) {
  const w = vrand(40, 90);
  skyline.push({ x, w, h: vrand(300, 1200), win: Math.random() });
  x += w + vrand(-10, 6);
}
/** @type {[number, string, string][]} */
export const SKY = [
  [0, '#120d2e', '#2a1d55'], [6, '#2b1f63', '#ff8f7a'], [7.6, '#5bb4ff', '#ffd9a0'],
  [11, '#3fa6ff', '#bfeaff'], [16.5, '#4f8fe6', '#ffd394'], [18.6, '#4a2f86', '#ff7d6b'],
  [19.8, '#191340', '#4a2f7a'], [24, '#120d2e', '#2a1d55'],
];
export function skyAt(h) {
  h = ((h % 24) + 24) % 24; // dygnet räknas 6–30
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, a0, b0] = SKY[i], [h1, a1, b1] = SKY[i + 1];
    if (h >= h0 && h <= h1) { const t = (h - h0) / (h1 - h0); return [mix(a0, a1, t), mix(b0, b1, t)]; }
  }
  return ['#120d2e', '#2a1d55'];
}
export function nightness(h) {
  h = ((h % 24) + 24) % 24;
  if (h < 6.6) return 1;
  if (h < 7.6) return 7.6 - h;
  if (h > 19) return Math.min(1, (h - 19) / 0.8);
  return 0;
}
