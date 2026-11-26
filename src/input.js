// Klick, tangentbord och alla knappar i kontrollpanelen (data-act).
// Vänsterklick i bilden följer det man klickar på: en person, en hiss, en korridor (nästa person därinne)
// eller en våning. Det finns ingen högerklicksmeny – det som går att göra med det man följer står i panelen.
//
// Översikt:
// `input.js` – klick, tangenter och alla knappar: `doAction` för `data-act`, nya gränssnittsåtgärder läggs i
// `extraActions`; vänsterklick i bilden följer person, hiss, korridor (nästa person därinne) eller våning – det
// finns ingen högerklicksmeny
import { act, ACTIONS } from './actions.js';
import { clamp } from './util.js';
import { BX0, CAR_H, CAR_W, DOOR_X, FLOOR_H, GROUND_Y, H, INNER_X1, LOBBY, ROOF_Y, STRAT_NAMES, TOP, WAIT_X1, floorY, shaftX, surf } from './config.js';
import { S, clockStr, hour, log } from './state.js';
import { busFrom } from './tour.js';
import { VIEW, camTarget, cv, detachCam, followCar, lookAt, scrollBy, scrollToFloor } from './view.js';
import { personHead, peopleBehindDoor } from './render.js';
import { foldInc, select } from './hud.js';
import { toggleSound, unlockSound } from './sound.js';
import { toggleMusic } from './music.js';
import { toggleAuto } from './director.js';
import { sv } from './sv.js';
/** @typedef {import('./people.js').Person} Person */

// ---------- Uppspelning och inställningar ----------
export const SPEEDS = [0.25, 0.5, 1, 2];
export function setSpeed(v) { skip = null; S.speed = v; }
// ⏩ Spola fram natten: kvällen och natten är långa att sitta igenom, så huset kan köras i SKIP_SPEED× till
// morgonen. Det stannar av sig självt kl SKIP_TO, när något händer (förvarning eller ny incident) eller när
// spelaren väljer en fart. Bara uppspelningen går fortare – simuleringen tar samma steg (advance i sim.js).
export const SKIP_SPEED = 12, SKIP_FROM = 21, SKIP_TO = 29.9;
/** @type {{ prev: number, inc: number }|null} */
let skip = null;
export const skipping = () => !!skip;
export const canSkip = () => S.started && !S.summaryShown && hour() >= SKIP_FROM && hour() < SKIP_TO - 0.15;
export function toggleSkip() {
  if (skip) { const p = skip.prev; setSpeed(p); return; }
  if (!canSkip()) return;
  skip = { prev: S.speed, inc: S.stats.incidents };
  S.speed = SKIP_SPEED; S.paused = false;
}
/** varje gång panelen uppdateras (main.js): spolningen stannar på morgonen eller när något händer */
export function skipTick() {
  if (!skip) return;
  if (hour() >= SKIP_TO || hour() < SKIP_FROM || S.warn || S.stats.incidents !== skip.inc || S.summaryShown) setSpeed(skip.prev);
}
export function togglePause() { if (!S.summaryShown) S.paused = !S.paused; }
const STRATS = ['smart', 'peak', 'eco', 'nearest', 'random', 'buttons'];
export function cycleStrategy() { act('strategy', STRATS[(STRATS.indexOf(S.strategy) + 1) % STRATS.length]); }
export function toggleTags() { S.tags = !S.tags; }

// ---------- Följa ----------
/** låt kameran följa en person (och följ hen i panelen) @param {Person} p */
export function followPerson(p) {
  if (S.sel !== p) select(p); else { VIEW.camSel = true; S.followHold = 0; }
  VIEW.follow = null; VIEW.camFloor = null; VIEW.auto = false;
  lookAt((personHead(p) || { y: GROUND_Y }).y, 0);
}
/** följ en hiss eller en våning (den som följdes släpps) */
export function followCarOnly(id) { select(null); followCar(id); }
export function followFloor(f) { select(null); scrollToFloor(f); }
/** sluta följa: kameran står kvar men minns vad den följde (F kopplar på igen); regissören tar över direkt om den är vald */
export function unfollow() { if (camTarget()) { detachCam(); VIEW.freeAt = -1e9; } select(null); }
/** koppla på kameran igen på det den senast följde (hiss, person eller våning) */
export function reattachCam() {
  const t = VIEW.lastCam;
  if (!t) return;
  if (t.kind === 'car') followCarOnly(t.id);
  else if (t.kind === 'floor') followFloor(t.id);
  else {
    const p = S.people.find(q => q.id === t.id && !q.dead);
    if (!p) { VIEW.lastCam = null; return; }
    followPerson(p);
  }
}
/** F: koppla loss kameran om den följer något, annars koppla på den igen */
export function toggleCam() { if (camTarget()) { detachCam(); VIEW.freeAt = S.anim; } else reattachCam(); }
/** följ nästa person som är inne på våningen f (klick på korridoren) */
export function followInside(f) {
  const inside = peopleBehindDoor(f);
  if (inside.length) followPerson(inside[(inside.indexOf(S.sel) + 1) % inside.length]);
}
function bus() {
  if (!S.started || S.fire) return;
  const n = act('bus');
  if (n < 0) return; // (en buss står redan vid hållplatsen)
  const x = VIEW.x0 + 200, y = surf(LOBBY) - 90; // (i hallen – rummen till vänster om VIEW.x0 syns inte)
  if (!n) {
    const h = busFrom();
    const text = h === null ? 'STÄNGT – KOM IMORGON!' : sv`FÖRST KL ${clockStr(h)}!`;
    S.fx.push({ x, y, text, color: '#ff5d52', life: 2.5, size: 24 });
    log(h === null ? 'Bussen vände – takterrassen och Sky Café hinner inte ta emot en tur till i dag'
      : sv`Bussen vände – takterrassen och Sky Café är stängda, Stadsturen kan komma från ${clockStr(h)}`, 'sys');
    return;
  }
  S.fx.push({ x, y, text: 'TURISTBUSS!', color: '#ff8c42', life: 2, size: 30 });
}
function visitor(f, x = BX0 + 60) {
  if (!S.started || S.fire) return;
  const v = act('visitor', f, clamp(x, BX0 + 40, WAIT_X1 - 20));
  if (!v) { S.fx.push({ x, y: surf(f) - 70, text: 'STÄNGT!', color: '#ff5d52', life: 1.2 }); return; }
  S.fx.push({ x, y: surf(f) - 70, text: '+1!', color: '#7cf06b', life: 1.2 });
  followPerson(v);
}

// ---------- Knapparna (data-act) ----------
/** åtgärder som andra gränssnittsmoduler lägger till (panels.js, hud.js): namn → (b, c) => void */
export const extraActions = /** @type {Record<string, (b: string, c: string) => void>} */ ({});
/** panelen ritas om direkt efter en åtgärd (sätts av panels.js) */
export const uiHooks = { repaint: () => {}, /** visa verktygstipset för knappen vid (x, y) (panels.js) */ tip: (/** @type {number} */ _x, /** @type {number} */ _y) => {} };
export function doAction(cmd) {
  const [a, b, c] = cmd.split(':');
  if (extraActions[a]) extraActions[a](b, c);
  else if (a === 'pause') togglePause();
  else if (a === 'spd') setSpeed(+b);
  else if (a === 'strat') act('strategy', b);
  else if (a === 'inclevel') act('incLevel', b);
  else if (a === 'chiefon') act('chief', b === 'on');
  else if (a === 'setting') act('setting', b, c);
  else if (a === 'tags') toggleTags();
  else if (a === 'sound') toggleSound();
  else if (a === 'music') toggleMusic();
  else if (a === 'bus') bus();
  else if (a === 'visit') visitor(+b);
  else if (a === 'trig') { if (S.started) act('trigger', b, c !== undefined && c !== '' ? +c : null); }
  else if (a === 'chief') act('chiefBack', b);
  else if (a === 'fire') act('fireMode', b);
  else if (a === 'storm') act('stormMode', b);
  else if (a === 'fan') act('fan', +b);
  else if (a === 'level') act('service', +b);
  else if (a === 'moveRoute') act('moveRoute', b);
  else if (a === 'moveBlankets') act('moveBlankets', b === '1');
  else if (a === 'moveWind') act('moveWind', b);
  else if (a === 'pano') act('panoRescue', b);
  else if (a === 'dismiss') S.dismissed.add(b); // (bara gränssnittet – simuleringen läser det aldrig)
  else if (a === 'incfold') foldInc(b);
  else if (a === 'show') followFloor(+b);
  else if (a === 'inside') followInside(+b);
  else if (a === 'follow') { if (VIEW.follow === +b) unfollow(); else followCarOnly(+b); }
  else if (a === 'person') {
    const p = S.people.find(q => q.id === +b && !q.dead);
    if (p && VIEW.camSel && S.sel === p) { detachCam(); VIEW.freeAt = -1e9; } else if (p) followPerson(p);
  }
  else if (a === 'unfollow') unfollow();
  else if (a === 'auto') toggleAuto();
  else if (a === 'cam') { if (b === 'off') { detachCam(); VIEW.freeAt = S.anim; } else reattachCam(); }
  else if (a === 'pow') {
    if (b === 'gen') act('generator');
    if (b === 'auto') act('autoRescue');
    if (b === 'rescue') act('rescue', +c);
  } else if (a === 'car') act('carOff', +c);
  // allt annat: knappen heter som spelaråtgärden och har ett argument i text (incidentkortens val: gondola:crank,
  // dog:lock, leak:stop, heist:cut …) – en ny incident med val behöver ingen egen rad här
  else if (Object.hasOwn(ACTIONS, a)) act(a, b);
  uiHooks.repaint();
}
// pointerdown i stället för click: panelen ritas om flera gånger i sekunden (nedräkningar, hissens läge)
// Med fingret: knappen trycks först när fingret släpps, och ett långt tryck visar förklaringen i stället
// (det finns ingen hovring på en pekskärm). Flyttas fingret (panelen scrollas) blir det inget tryck.
const LONG_MS = 450, SLOP_PX = 10;
/** @type {{ act: string, x: number, y: number, timer: number }|null} */
let press = null;
document.addEventListener('pointerdown', ev => {
  if (ev.button !== 0) return;
  const t = /** @type {HTMLElement} */ (ev.target);
  const a = /** @type {HTMLButtonElement} */ (t.closest('[data-act]'));
  if (a && ev.pointerType === 'touch' && a.dataset.hint) {
    clearTimeout(press?.timer);
    press = { act: a.disabled ? '' : a.dataset.act, x: ev.clientX, y: ev.clientY, timer: setTimeout(() => { const p = press; press = null; if (p) uiHooks.tip(p.x, p.y); }, LONG_MS) };
    return;
  }
  if (a && !a.disabled) { ev.preventDefault(); doAction(a.dataset.act); return; }
  const pe = /** @type {HTMLElement} */ (t.closest('[data-pid]'));
  if (pe) {
    const p = S.people.find(q => q.id === +pe.dataset.pid && !q.dead);
    if (p) { ev.preventDefault(); followPerson(p); uiHooks.repaint(); }
  }
});
document.addEventListener('pointerup', () => {
  if (!press) return;
  clearTimeout(press.timer);
  const a = press.act;
  press = null;
  if (a) doAction(a);
});
document.addEventListener('pointermove', ev => {
  if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > SLOP_PX) { clearTimeout(press.timer); press = null; }
});
document.addEventListener('pointercancel', () => { if (press) { clearTimeout(press.timer); press = null; } });
// ljudet släpps fram först efter ett klick eller en tangent. Safari på iPhone räknar bara med fingret när
// det lyfts (pointerup/touchend), inte pointerdown – därför lyssnar vi på dem, vid varje tryck: knappen som
// slår på ljudet reagerar på pointerdown, och då väcks ljudet när fingret släpper.
for (const t of ['pointerup', 'touchend', 'keydown']) addEventListener(t, unlockSound, { passive: true });

// ---------- Tangentbordet ----------
window.addEventListener('keydown', ev => {
  if (ev.target instanceof Element && ev.target.closest('select,input')) return;
  if (ev.code === 'Space') { ev.preventDefault(); togglePause(); }
  if (ev.code === 'KeyT') toggleTags();
  if (ev.code === 'KeyN') toggleSkip();
  if (ev.code === 'KeyM') toggleSound();
  if (ev.code === 'KeyF') toggleCam();
  if (ev.code === 'KeyA') toggleAuto();
  if (ev.code === 'KeyS') { cycleStrategy(); log(`Styrlogik: ${STRAT_NAMES[S.strategy]}`, 'sys'); }
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(ev.code)) {
    ev.preventDefault();
    const step = { ArrowUp: -FLOOR_H, ArrowDown: FLOOR_H, PageUp: -VIEW.viewH * 0.8, PageDown: VIEW.viewH * 0.8, Home: -H, End: H }[ev.code];
    scrollBy(step);
  }
  if (ev.code === 'Escape') unfollow();
  const m = { Digit1: 1, Digit2: 2 }[ev.code];
  if (m) setSpeed(m);
  // − och + stegar mellan farterna (¼× ½× 1× 2×)
  const d = { Minus: -1, NumpadSubtract: -1, Equal: 1, NumpadAdd: 1 }[ev.code];
  if (d) setSpeed(SPEEDS[clamp(SPEEDS.indexOf(S.speed) + d, 0, SPEEDS.length - 1)]);
  uiHooks.repaint();
});

// ---------- Bilden ----------
export function toWorld(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / VIEW.scale + VIEW.x0, y: (ev.clientY - r.top) / VIEW.scale + VIEW.camY };
}
/** vilken våningskorridor (dörr) ligger under muspekaren? */
export function hitDoor(x, y) {
  if (Math.abs(x - DOOR_X) > 26 || y < ROOF_Y || y > floorY(0)) return null;
  const f = Math.floor(LOBBY + (GROUND_Y - y) / FLOOR_H);
  const bot = floorY(f) - 4;
  return f >= 0 && f <= TOP && y > bot - 62 ? f : null;
}
export function hitPerson(x, y) {
  let best = null, bd = 1e9;
  for (const p of S.people) {
    if (p.state === 'ride') continue;
    const h = personHead(p);
    if (!h || h.hidden) continue;
    if (Math.abs(x - h.x) < 15 && y > h.y - 14 && y < h.y + 70) {
      const d = Math.abs(x - h.x) + Math.abs(y - (h.y + 30)) * 0.3;
      if (d < bd) { bd = d; best = p; }
    }
  }
  return best;
}
export function hitCar(x, y) {
  for (const e of S.elevators) {
    const cx = shaftX(e.id) + 4, yb = floorY(e.pos) - 4;
    if (x >= cx && x <= cx + CAR_W && y >= yb - CAR_H && y <= yb) return e;
  }
  return null;
}
/** våningen under en punkt i hallen (null utanför huset) */
export function hitFloor(x, y) {
  if (x < BX0 || x > INNER_X1 || y < ROOF_Y || y > floorY(0)) return null;
  return clamp(LOBBY + Math.floor((GROUND_Y - y) / FLOOR_H), 0, TOP);
}
cv.addEventListener('mousemove', ev => {
  const { x, y } = toWorld(ev);
  S.hover = hitPerson(x, y);
  const car = hitCar(x, y), door = S.hover ? null : hitDoor(x, y);
  S.hoverDoor = door;
  cv.style.cursor = S.hover || car || door !== null || hitFloor(x, y) !== null ? 'pointer' : 'crosshair';
});
cv.addEventListener('mouseleave', () => { S.hover = null; S.hoverDoor = null; });
cv.addEventListener('contextmenu', ev => ev.preventDefault()); // ingen högerklicksmeny
cv.addEventListener('click', ev => {
  if (!S.started) return;
  const { x, y } = toWorld(ev);
  const p = hitPerson(x, y);
  if (p) followPerson(p);
  else {
    const e = hitCar(x, y), door = e ? null : hitDoor(x, y), f = hitFloor(x, y);
    if (e) { if (VIEW.follow === e.id) unfollow(); else followCarOnly(e.id); }
    else if (door !== null) followInside(door);
    else if (f !== null) followFloor(f);
  }
  uiHooks.repaint();
});
