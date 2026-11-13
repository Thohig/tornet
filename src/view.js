// Canvas, skalning och kamera.
import { vrand } from './rng.js';
import { clamp, mix } from './util.js';
import { FLOOR_H, H, LAND_X0, W, floorY } from './config.js';
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
  auto: false, shot: /** @type {(import('./director.js').Shot & { t0: number })|null} */ (null) };
export function resize() {
  // huset fyller hela bredden och kameran visar en del i taget (scrolla eller låt kameran följa)
  const stacked = window.innerWidth <= 800;
  stage.style.height = stacked ? '80vh' : '';
  const r = stage.getBoundingClientRect();
  const innerW = r.width - 4, innerH = r.height - 4; // (ramen runt spelytan)
  const VW = W - VIEW.x0; // synlig bredd i världsenheter
  const s = Math.max(0.3, innerW / VW);
  const cssW = VW * s, cssH = Math.min(H * s, innerH);
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  VIEW.scale = s; VIEW.dpr = dpr; VIEW.viewH = cssH / s;
  VIEW.camY = clamp(VIEW.camY, 0, H - VIEW.viewH);
  portrait.width = 64 * dpr; portrait.height = 76 * dpr;
  S.trackDirty = true;
}
window.addEventListener('resize', resize);
// ---------- Kamera ----------
export const camMax = () => Math.max(0, H - VIEW.viewH);
export function lookAt(worldY, hold = 4) {
  // centrera kameran på en punkt; pausa följ-läget en stund så att den inte drar iväg direkt
  S.camTarget = clamp(worldY - VIEW.viewH / 2, 0, camMax());
  S.followHold = S.anim + hold;
}
export function scrollToFloor(f) {
  detachCam(); VIEW.camFloor = f;
  lookAt(floorY(f) - FLOOR_H / 2, 0);
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
    S.camTarget = clamp(y - VIEW.viewH * 0.5, 0, camMax());
  } else if (VIEW.camSel && p && S.anim > (S.followHold || 0)) {
    const h = personHead(p);
    if (h) {
      const y = h.y + 40, top = VIEW.camY + VIEW.viewH * 0.22, bot = VIEW.camY + VIEW.viewH * 0.78;
      if (y < top || y > bot) S.camTarget = clamp(y - VIEW.viewH * 0.5, 0, camMax());
    }
  }
  if (S.camTarget != null) {
    VIEW.camY += (S.camTarget - VIEW.camY) * Math.min(1, dt * 5);
    if (Math.abs(S.camTarget - VIEW.camY) < 0.5) { VIEW.camY = S.camTarget; S.camTarget = null; }
  }
  VIEW.camY = clamp(VIEW.camY, 0, camMax());
}
export function scrollBy(dy) {
  // manuell scrollning kopplar loss kameran
  detachCam(); S.camTarget = null;
  VIEW.camY = clamp(VIEW.camY + dy, 0, camMax());
}
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  scrollBy(ev.deltaY / VIEW.scale);
}, { passive: false });
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
