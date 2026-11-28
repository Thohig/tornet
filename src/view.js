// Canvas, skalning och kamera.
import { vrand } from './rng.js';
import { clamp, mix } from './util.js';
import { EL, FLOOR_H, H, LOBBY, NCOL, SHAFT_GAP, SHAFT_W, SHAFT_X0, TOWER_W, VIEW_X0, W, floorY, shaftCX, shaftX } from './config.js';
import { S } from './state.js';
import { sunWarp } from './calendar.js';
import { personHead } from './render.js';
import { PX } from './pixart.js';

// ---------- Grafik: setup ----------
/** @param {string} id */
const canvas = id => /** @type {HTMLCanvasElement} */ (document.getElementById(id));
export const cv = canvas('game'), ctx = cv.getContext('2d');
export const portrait = canvas('portrait'), pctx = portrait.getContext('2d');
export const stage = document.getElementById('stage');
// camY = världskoordinaten högst upp i bilden, viewH = hur mycket av huset som syns (i världsenheter)
// x0 = världens x vid bildens vänsterkant: i Våningarna utanför tornets vägg (rummen syns), i Hissarna vid schakten
// Kameran kan vara kopplad till en hiss (follow), till den spårade personen (camSel) eller stå på en våning
// (camFloor). Manuell scrollning kopplar loss den; lastCam minns vad den senast följde så att den kan kopplas på igen.
/** @typedef {{ kind: 'car'|'person'|'floor', id: number }} CamTarget */
export const VIEW = { scale: 1, dpr: 1, camY: 0, viewH: H, x0: VIEW_X0, follow: /** @type {number|null} */ (null),
  camSel: false, camFloor: /** @type {number|null} */ (null), lastCam: /** @type {CamTarget|null} */ (null),
  // regissören (director.js): automatisk kamera och den tagning den visar just nu. autoWant = spelaren vill ha
  // regissören (🎬/A, minns i start.js): auto slås av när spelaren tar kameran, och på igen när hen släpper den –
  // direkt när hen slutar följa något, efter en stund (AUTO_IDLE) när hen har scrollat fritt eller tittar på en våning. freeAt = när kameran
  // senast flyttades för hand (S.anim)
  auto: false, autoWant: false, freeAt: -1e9, shot: /** @type {(import('./director.js').Shot & { t0: number })|null} */ (null),
  // sidled (smal skärm): bilden är bredare än spelytan och flyttas panX css-pixlar åt vänster; panTo = dit den glider
  panX: 0, panW: 0, panTo: /** @type {number|null} */ (null),
  // textskylten längst ner i bilden (#lower) täcker padB världsenheter: kameran räknar med att bara
  // viewH − padB syns, och kan scrolla padB längre ner så att även stationen hamnar ovanför skylten
  padB: 0,
  // De två vyerna (se nedan): 'floors' = Våningarna (rummen och hallarna, inga hissar), 'lifts' = Hissarna (schakten med
  // korgarna, som huset alltid har ritats, men utan hallarna). swap = övergången mellan vyerna (0 → 1), swapDir = åt
  // vilket håll den gamla bilden glider ut
  mode: /** @type {'floors'|'lifts'} */ ('floors'), swap: 1, swapDir: 1 };
/** css-pixlar som textskylten tar längst ner i bilden (vanligt läge / biografläget) */
const LOWER_PX = { std: 62, cinema: 118 };

// ---------- Våningarna och Hissarna ----------
// Samma värld ritas i båda vyerna, men olika delar av den. Hissarna börjar vid hallens innerkant (LIFTS_X0) och visar
// schakten, korgarna, linorna och fasaden som de alltid har sett ut. Våningarna börjar utanför tornets vänstervägg
// (VIEW_X0) och visar rummen och hallarna – där syns inga hissar (liftsShown): schaktkolumnerna fälls ihop till en
// tunn vägg i hallens högerkant (SHUT_K av sin bredd) – utom kolumner där ingen hiss går under entrén, för där ligger
// garagerampen och lastkajen (och ovanför dem terrassen): de behåller sin bredd och visas som fasad. Ren grafik:
// världens x avbildas (mapX) innan det ritas; rummen och hallen till vänster och fasaden till höger behåller sin bredd.
/** var bilden börjar i Hissarna: vid hallens innervägg, precis framför schakten */
export const LIFTS_X0 = SHAFT_X0 - 8;
/** ritas hissarna (schakten, korgarna, displayerna)? Bara i Hissarna – i Våningarna bara panoramahissen på fasaden */
export const liftsShown = () => VIEW.mode === 'lifts';
export const SHUT_K = 0.025;
const COL_W = SHAFT_W + SHAFT_GAP, COLS_END = SHAFT_X0 + NCOL * COL_W;
/** varje schaktkolumns bredd i Våningarna (andel av den riktiga) */
const COL_K = Array.from({ length: NCOL }, (_, c) => {
  const els = EL.filter(e => !e.facade && Math.round((shaftX(e.id) - SHAFT_X0) / COL_W) === c);
  return els.length && els.every(e => e.minF >= LOBBY) ? 1 : SHUT_K;
});
/** schaktkolumnen för världens x (−1 utanför schakten) */
export const colAt = x => (x < SHAFT_X0 || x >= COLS_END ? -1 : Math.floor((x - SHAFT_X0) / COL_W));
/** världens x → x i bilden (världsenheter): i Våningarna är schakten ihopfällda */
export function mapX(x) {
  if (x <= SHAFT_X0 || VIEW.mode === 'lifts') return x;
  let m = SHAFT_X0;
  for (let c = 0; c < NCOL; c++) {
    const a = SHAFT_X0 + c * COL_W, k = COL_K[c];
    if (x < a + COL_W) return m + (x - a) * k;
    m += COL_W * k;
  }
  return m + (x - COLS_END);
}
/** x i bilden → världens x (omvänt mot mapX) */
export function unmapX(m) {
  if (m <= SHAFT_X0 || VIEW.mode === 'lifts') return m;
  let a = SHAFT_X0;
  for (let c = 0; c < NCOL; c++) {
    const w = COL_W * COL_K[c];
    if (m < a + w) return SHAFT_X0 + c * COL_W + (m - a) / COL_K[c];
    a += w;
  }
  return COLS_END + (m - a);
}
/** är kolumnen ihopfälld (en hisskolumn) i Våningarna? */
export const colShut = c => c >= 0 && COL_K[c] < 1 && VIEW.mode !== 'lifts';

// ---------- Byta vy ----------
/** Byt till Våningarna eller Hissarna. Bilden glider över (VIEW.swap) och spelytan räknas om. @param {'floors'|'lifts'} mode */
export function setMode(mode) {
  if (VIEW.mode === mode) return;
  // (den som följer en hiss i Våningarna ser den inte: släpp hissen – utom panoramahissen på fasaden)
  if (mode === 'floors' && VIEW.follow !== null && !EL[VIEW.follow].facade) { VIEW.lastCam = { kind: 'car', id: VIEW.follow }; VIEW.follow = null; }
  snapshot();
  VIEW.swapDir = mode === 'lifts' ? -1 : 1;
  VIEW.mode = mode; VIEW.swap = 0; VIEW.x0 = mode === 'lifts' ? LIFTS_X0 : VIEW_X0; VIEW.panX = 0;
  resize(true);
  S.trackDirty = true;
}
/** den gamla bilden under övergången (ritas ovanpå den nya och glider ut, render.js) */
export const SNAP = document.createElement('canvas');
function snapshot() {
  SNAP.width = cv.width; SNAP.height = cv.height;
  const c = SNAP.getContext('2d');
  if (c && cv.width && cv.height) c.drawImage(cv, 0, 0);
}
// Minsta skala: på en telefon blir huset annars så litet att folk är prickar och skyltarna oläsliga.
// Är spelytan smalare scrollar bilden i sidled. Skalan avrundas så att en pixel i pixelgrafiken (PX = 2
// världsenheter) blir ett helt antal skärmpixlar.
const MIN_SCALE = 0.7;
// Mobilläget (body.mob): smal skärm, eller en telefon på tvären (body.land). Bilden fyller skärmen och
// kontrollpanelen är bara en list (panels.js) – nertill, eller som en smal list till höger på tvären.
// Textskylten ligger då i listen i stället för i bilden (padB = 0), utom på tvären och i biografläget.
const LAND_MAX_H = 500;
/** mobilläget just nu: { mob, land } (läses av panels.js) */
export function screenMode() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const land = coarse && window.innerHeight <= LAND_MAX_H && window.innerWidth > window.innerHeight;
  return { mob: window.innerWidth <= 800 || land, land };
}
export function resize(force = false) {
  // huset fyller hela bredden och kameran visar en del i taget (scrolla eller låt kameran följa)
  const { mob, land } = screenMode(), B = document.body.classList;
  B.toggle('mob', mob); B.toggle('land', mob && land);
  const cinema = B.contains('cinema');
  // (spelytans höjd sköts av css: i mobilläget tar listen sin plats och bilden resten – ResizeObserver nedan)
  const r = stage.getBoundingClientRect();
  const innerW = r.width - 4, innerH = r.height - 4; // (ramen runt spelytan)
  const VW = mapX(W) - VIEW.x0; // hela bredden i världsenheter (som den ritas i Våningarna)
  const dpr = window.devicePixelRatio || 1;
  const fit = innerW / (mapX(TOWER_W) - VIEW.x0);
  const s = fit >= MIN_SCALE ? fit : Math.max(fit, Math.round(MIN_SCALE * 2 * dpr) / (2 * dpr));
  const padB = mob && !land && !cinema ? 0 : (cinema ? LOWER_PX.cinema : LOWER_PX.std) / s;
  const fH = Math.max(1, Math.min((H + padB) * s, innerH));
  const cssW = VW * s, cssH = fH;
  // samma storlek som förut (Safari skickar resize när adressfältet fälls in): rita inte om canvasen
  if (!force && cv.width === Math.round(cssW * dpr) && cv.height === Math.round(cssH * dpr) && VIEW.dpr === dpr && VIEW.panW === innerW && VIEW.padB === padB) return;
  VIEW.padB = padB;
  VIEW.panW = innerW;
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  VIEW.scale = s; VIEW.dpr = dpr; VIEW.viewH = fH / s;
  VIEW.camY = clamp(VIEW.camY, 0, camMax());
  setPan(VIEW.panX);
  // går det att scrolla i bilden tar den ett finger själv (två fingrar zoomar sidan som vanligt);
  // syns hela huset får ett finger scrolla sidan i stället
  cv.style.touchAction = camMax() > 0 || panMax() > 0 ? 'pinch-zoom' : 'auto';
  portrait.width = 64 * dpr; portrait.height = 76 * dpr;
  S.trackDirty = true;
}
/** Är pixelgrafikens text för liten för att läsas (en pixel i bilden mindre än 1,2 skärmpixlar)?
 * Då hoppar bilden över prat- och tankebubblorna, namnbrickorna, småpratet och ljudeffekterna – de blir bara fläckar. */
export const tinyText = () => VIEW.scale * PX < 1.2;
// listen nertill ändrar höjd (raden med det som händer): då ändras spelytan och bilden räknas om
if (typeof ResizeObserver === 'function') new ResizeObserver(() => resize()).observe(stage);
window.addEventListener('resize', () => resize());
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
  const cx = (mapX(wx) - VIEW.x0) * VIEW.scale, l = VIEW.panX + VIEW.panW * 0.2, r = VIEW.panX + VIEW.panW * 0.8;
  if (cx < l || cx > r) VIEW.panTo = clamp(cx - VIEW.panW * 0.5, 0, panMax());
}
export function lookAt(worldY, hold = 4) {
  // centrera kameran på en punkt; pausa följ-läget en stund så att den inte drar iväg direkt
  S.camTarget = clamp(worldY - seeH() / 2, 0, camMax());
  S.followHold = S.anim + hold;
}
export function scrollToFloor(f) {
  setMode('floors');
  detachCam(); VIEW.camFloor = f; VIEW.freeAt = S.anim;
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
/** följ en hiss (hissarna syns i Hissarna – panoramahissen på fasaden även i Våningarna) */
export function followCar(id) {
  detachCam(); VIEW.follow = id; S.followHold = 0;
  if (!EL[id].facade) setMode('lifts');
}
export function updateCamera(dt) {
  if (VIEW.swap < 1) VIEW.swap = Math.min(1, VIEW.swap + dt / SWAP_S);
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
/** övergången mellan vyerna (sekunder) */
const SWAP_S = 0.4;
export function scrollBy(dy, dx = 0) {
  // manuell scrollning kopplar loss kameran
  detachCam(); S.camTarget = null; VIEW.panTo = null; VIEW.freeAt = S.anim;
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
  if (ev.button !== 0 || (camMax() <= 0 && panMax() <= 0 && ev.pointerType !== 'touch')) return;
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
/** ljus sommarnatt: skymningsblått med en glöd vid horisonten i norr */
const WHITE_NIGHT = ['#33407e', '#c9847e'];
export function skyAt(h) {
  const w = sunWarp(h, S.cal); // (dygnet räknas 6–30; himlen följer dagens sol, calendar.js)
  let sky = /** @type {[string, string]} */ (['#120d2e', '#2a1d55']);
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, a0, b0] = SKY[i], [h1, a1, b1] = SKY[i + 1];
    if (w >= h0 && w <= h1) { const t = (w - h0) / (h1 - h0); sky = [mix(a0, a1, t), mix(b0, b1, t)]; break; }
  }
  const k = S.cal.nightMax < 1 ? (1 - S.cal.nightMax) * (nightness(h) / S.cal.nightMax) : 0;
  return k > 0 ? [mix(sky[0], WHITE_NIGHT[0], Math.min(1, k * 1.6)), mix(sky[1], WHITE_NIGHT[1], Math.min(1, k * 1.6))] : sky;
}
/** hur mörkt det är ute (0–1) efter dagens sol; en ljus sommarnatt blir aldrig helt mörk (S.cal.nightMax) */
export function nightness(h) {
  h = sunWarp(h, S.cal);
  const n = h < 6.6 ? 1 : h < 7.6 ? 7.6 - h : h > 19 ? Math.min(1, (h - 19) / 0.8) : 0;
  return n * S.cal.nightMax;
}
