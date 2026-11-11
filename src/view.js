// Canvas, skalning, kamera och översiktsremsa.
import { vrand } from './rng.js';
import { clamp, fl, mix } from './util.js';
import { FL, FLOORS, FLOOR_H, H, LAND_X0, ROOF_Y, TOP, W, floorY, floorOpen } from './config.js';
import { S, hour } from './state.js';
import { allowed } from './dispatch.js';
import { personHead } from './render.js';

// ---------- Grafik: setup ----------
/** @param {string} id */
const canvas = id => /** @type {HTMLCanvasElement} */ (document.getElementById(id));
export const cv = canvas('game'), ctx = cv.getContext('2d');
export const portrait = canvas('portrait'), pctx = portrait.getContext('2d');
export const stage = document.getElementById('stage');
// översiktsremsan skapas om sidan saknar den (t.ex. en gammal cachad index.html)
export const overview = canvas('overview') || (() => {
  const c = document.createElement('canvas'); c.id = 'overview'; stage.appendChild(c); return c;
})();
export const octx = overview.getContext('2d');
// camY = världskoordinaten högst upp i bilden, viewH = hur mycket av huset som syns (i världsenheter)
// x0 = världens x vid bildens vänsterkant: bilden börjar vid hallen, rummen till vänster syns inte
export const VIEW = { scale: 1, dpr: 1, camY: 0, viewH: H, x0: LAND_X0, ow: 84, oh: 400, follow: /** @type {number|null} */ (null), carPop: /** @type {number|null} */ (null) };
export function resize() {
  // Stor vy: huset fyller bredden och kameran visar en del i taget (översikten visar resten).
  // Hela huset: allt syns, men i liten skala eftersom huset är så högt.
  const wide = S.zoom === 'wide';
  const stacked = window.innerWidth <= 800;
  stage.style.height = stacked ? '80vh' : '';
  stage.classList.toggle('wide', wide);
  const r = stage.getBoundingClientRect();
  const innerW = r.width - (wide ? 104 : 0) - 20, innerH = r.height - 20;
  const VW = W - VIEW.x0; // synlig bredd i världsenheter
  let s, cssW, cssH;
  if (wide) {
    s = Math.max(0.3, Math.min(innerW / VW, 1.4));
    cssW = VW * s; cssH = Math.min(H * s, innerH);
  } else {
    s = Math.max(0.2, Math.min(innerW / VW, innerH / H));
    cssW = VW * s; cssH = H * s;
  }
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  VIEW.scale = s; VIEW.dpr = dpr; VIEW.viewH = cssH / s;
  VIEW.camY = clamp(VIEW.camY, 0, H - VIEW.viewH);
  // översiktsremsan: lika hög som spelytan, högst 640 px
  VIEW.ow = 84; VIEW.oh = Math.round(Math.min(innerH, 640));
  overview.style.height = VIEW.oh + 'px';
  overview.width = VIEW.ow * dpr; overview.height = VIEW.oh * dpr;
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
export function scrollToFloor(f) { if (S.zoom === 'wide') lookAt(floorY(f) - FLOOR_H / 2, 5); }
export function updateCamera(dt) {
  if (S.zoom !== 'wide') { VIEW.camY = 0; return; }
  const p = S.sel;
  if (VIEW.follow !== null && S.anim > (S.followHold || 0)) {
    // följ en hiss: håll korgen mitt i bild
    const y = floorY(S.elevators[VIEW.follow].pos) - FLOOR_H / 2;
    S.camTarget = clamp(y - VIEW.viewH * 0.5, 0, camMax());
  } else if (p && !p.dead && S.anim > (S.followHold || 0)) {
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
  S.camTarget = null; S.followHold = S.anim + 4;
  VIEW.camY = clamp(VIEW.camY + dy, 0, camMax());
}
cv.addEventListener('wheel', ev => {
  if (S.zoom !== 'wide') return;
  ev.preventDefault();
  scrollBy(ev.deltaY / VIEW.scale);
}, { passive: false });
// översikten: klicka eller dra för att hoppa
export const ovRowH = () => (VIEW.oh - 8) / FLOORS;
export const ovY = worldY => 4 + ((worldY - ROOF_Y) / FLOOR_H) * ovRowH();
export let ovDrag = false;
export function ovJump(ev) {
  const r = overview.getBoundingClientRect();
  const worldY = ROOF_Y + ((ev.clientY - r.top - 4) / ovRowH()) * FLOOR_H;
  S.camTarget = null; S.followHold = S.anim + 4;
  VIEW.camY = clamp(worldY - VIEW.viewH / 2, 0, camMax());
}
overview.addEventListener('pointerdown', ev => { ovDrag = true; overview.setPointerCapture(ev.pointerId); ovJump(ev); });
overview.addEventListener('pointermove', ev => { if (ovDrag) ovJump(ev); });
overview.addEventListener('pointerup', () => { ovDrag = false; });
export function drawOverview() {
  if (S.zoom !== 'wide') return;
  const g = octx, w = VIEW.ow, h = VIEW.oh, d = VIEW.dpr, rowH = ovRowH();
  g.setTransform(d, 0, 0, d, 0, 0);
  g.fillStyle = '#000000'; g.fillRect(0, 0, w, h);
  const blink = Math.floor(S.anim * 3) % 2 === 0;
  g.textBaseline = 'middle';
  for (let f = 0; f < FLOORS; f++) {
    const y = 4 + (TOP - f) * rowH;
    g.fillStyle = FL[f].acc + (!S.power ? '2a' : floorOpen(f, hour()) ? '66' : '24'); g.fillRect(2, y, w - 4, rowH - 1);
    if (S.fire && f === S.fire.floor) { g.fillStyle = blink ? 'rgba(255,75,31,.8)' : 'rgba(255,75,31,.45)'; g.fillRect(2, y, w - 4, rowH - 1); }
    else if (S.fire && !allowed(f)) { g.fillStyle = 'rgba(255,45,85,.25)'; g.fillRect(2, y, w - 4, rowH - 1); }
    g.fillStyle = '#fff'; g.font = `${Math.min(15, rowH * 0.8)}px VT323, monospace`; g.textAlign = 'left';
    g.fillText(fl(f), 5, y + rowH / 2);
    const n = S.wl ? S.wl[f].u.length + S.wl[f].d.length : 0;
    if (n) { g.fillStyle = '#ffe14d'; g.fillRect(20, y + rowH * 0.3, Math.min(n * 2, 26), rowH * 0.4); }
  }
  // hissar som små färgade block, en fil per hiss
  for (const e of S.elevators) {
    const N = S.elevators.length, lw = Math.min(8, (w - 50) / N);
    const x = w - 2 - (N - e.id) * lw, y = 4 + (TOP - e.pos) * rowH + 1;
    g.fillStyle = e.mode !== 'normal' || e.off || e.sleep || e.zoneLock || !S.power ? '#808080' : e.color;
    g.fillRect(x, y, lw - 1.5, rowH - 3);
  }
  // spårad person
  if (S.sel && !S.sel.dead) {
    const hd = personHead(S.sel);
    if (hd) { g.fillStyle = '#ffe14d'; g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText('★', w - 4 - Math.min(8, (w - 50) / S.elevators.length) * S.elevators.length - 6, ovY(hd.y + 50)); }
  }
  // det som syns i spelytan just nu
  const y0 = clamp(ovY(VIEW.camY), 1, h - 1), y1 = clamp(ovY(VIEW.camY + VIEW.viewH), 1, h - 1);
  g.strokeStyle = '#ffe14d'; g.lineWidth = 2; g.strokeRect(1, y0, w - 2, Math.max(6, y1 - y0));
  g.fillStyle = 'rgba(255,225,77,.08)'; g.fillRect(1, y0, w - 2, Math.max(6, y1 - y0));
}

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
