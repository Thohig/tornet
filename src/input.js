// Knappar, tangentbord och klick i spelet.
import { startGenerator, toggleAutoRescue, toggleOff } from './incidents.js';
import { pick, rng } from './rng.js';
import { clamp } from './util.js';
import { BX0, CAR_H, CAR_W, DOOR_X, FLOOR_H, GROUND_Y, H, INNER_X1, OFFICE_FLOORS, ROOF_Y, STRAT_HINT, TOP, WAIT_X1, floorY, shaftX, surf, LOBBY } from './config.js';
import { S, log } from './state.js';
import { pev, spawnVisitor, spawnBus } from './people.js';
import { rebuildPicks } from './dispatch.js';
import { setFireMode, startRescue, trigger } from './incidents.js';
import { step } from './sim.js';
import { VIEW, cv, lookAt, resize, scrollBy, scrollToFloor } from './view.js';
import { personHead, peopleBehindDoor } from './render.js';
import { $, openCarPop, select, setTab, updateHud, updateRoster } from './hud.js';

// ---------- Kontroller ----------
export function updatePauseBtn() { $('btnPause').textContent = S.paused ? '▶' : '❚❚'; $('btnPause').classList.toggle('on', S.paused); }
export function setSpeed(v) {
  S.speed = v;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#speeds .btn')).forEach(b => b.classList.toggle('on', +b.dataset.s === v));
}
const STRATS = ['smart', 'nearest', 'random', 'buttons'], STRAT_NAMES = { smart: 'SMART', nearest: 'NÄRMAST', random: 'KAOS', buttons: 'KNAPPAR' };
export function cycleStrategy() { setStrategy(STRATS[(STRATS.indexOf(S.strategy) + 1) % STRATS.length]); }
export function setStrategy(k) {
  if (S.strategy === k) return;
  S.strategy = k;
  $('btnStrat').textContent = STRAT_NAMES[k];
  $('stratHint').innerHTML = STRAT_HINT[k];
  // hallknapparna nollställs; i KNAPPAR-läget trycker de väntande på nytt
  S.calls = {};
  for (const p of S.people) if (p.state === 'wait') { p.assigned = null; p.bank = null; p.fixAt = 0; pev(p, 'Styrlogiken byttes – får en ny hiss'); }
  for (const e of S.elevators) e.parkTarget = null;
  rebuildPicks();
  log(`Styrlogik bytt till ${STRAT_NAMES[k]} – alla väntande fördelas om`, 'sys');
}
export function toggleTags() { S.tags = !S.tags; $('btnTags').classList.toggle('on', S.tags); }
export function toggleZoom() {
  S.zoom = S.zoom === 'fit' ? 'wide' : 'fit';
  try { localStorage.setItem('hiss.zoom', S.zoom); } catch (e) { /* ingen lagring */ }
  $('btnZoom').classList.toggle('on', S.zoom === 'fit');
  resize();
  if (S.zoom === 'wide') lookAt(S.sel ? (personHead(S.sel) || { y: GROUND_Y }).y : GROUND_Y - VIEW.viewH / 2, 0);
}
// små popupfönster i topplisten (förklaring av styrlogiken, ⋯-menyn); bara ett öppet åt gången
export function togglePop(id) {
  const el = $(id), show = !el.classList.contains('show');
  document.querySelectorAll('.pop.show').forEach(p => p.classList.remove('show'));
  el.classList.toggle('show', show);
}
export function chipGroup(id, key, after) {
  $(id).addEventListener('click', ev => {
    const b = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('.chip')); if (!b) return;
    S[key] = b.dataset.f;
    $(id).querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
    after();
  });
}
export function doAction(act) {
  const [a, b, c] = act.split(':');
  if (a === 'trig') { if (S.started) trigger(b); }
  else if (a === 'fire') setFireMode(b);
  else if (a === 'show') scrollToFloor(+b);
  else if (a === 'tab') { setTab(b); return; }
  else if (a === 'hint') { togglePop('stratHint'); return; }
  else if (a === 'menu') { togglePop('menu'); return; }
  else if (a === 'carpop') { openCarPop(null); return; }
  else if (a === 'follow') {
    VIEW.follow = VIEW.follow === +b ? null : +b; S.followHold = 0;
    if (VIEW.follow !== null && S.zoom !== 'wide') toggleZoom();
  }
  else if (a === 'pow') {
    if (b === 'gen') startGenerator();
    if (b === 'auto') toggleAutoRescue();
    if (b === 'rescue') startRescue(S.elevators[+c], 'manual');
  } else if (a === 'car') toggleOff(S.elevators[+c]);
  S.incHtml = ''; updateHud();
}
$('btnPause').onclick = () => { if (!S.summaryShown) { S.paused = !S.paused; updatePauseBtn(); } };
$('btnTags').onclick = toggleTags;
$('btnZoom').onclick = toggleZoom;
$('autoInc').onchange = ev => { S.autoInc = /** @type {HTMLInputElement} */ (ev.target).checked; };
/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#speeds .btn')).forEach(b => (b.onclick = () => setSpeed(+b.dataset.s)));
$('btnStrat').onclick = cycleStrategy;
chipGroup('rosterChips', 'rosterFilter', updateRoster);
chipGroup('logChips', 'logFilter', () => { S.logDirty = true; updateHud(); });
chipGroup('mistakeChips', 'mistakes', () => log(`Felknappar: ${S.mistakes}`, 'sys'));
$('tkClose').onclick = () => select(null);
// pointerdown i stället för click: incidentpanelen ritas om varje sekund (nedräkningar)
document.addEventListener('pointerdown', ev => {
  const t = /** @type {HTMLElement} */ (ev.target);
  // klick utanför en öppen popup stänger den
  if (!t.closest('.pop') && !t.closest('[data-act="hint"],[data-act="menu"]')) document.querySelectorAll('.pop.show').forEach(p => p.classList.remove('show'));
  const a = /** @type {HTMLButtonElement} */ (t.closest('[data-act]'));
  if (a && !a.disabled) { ev.preventDefault(); doAction(a.dataset.act); }
});
document.addEventListener('click', ev => {
  if (/** @type {HTMLElement} */ (ev.target).closest('[data-act]')) return;
  const t = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-pid]'));
  if (!t) return;
  const p = S.people.find(q => q.id === +t.dataset.pid);
  if (p) select(p);
});
$('btnBus').onclick = () => {
  if (!S.started || S.fire) return;
  const n = spawnBus();
  if (!n) { S.fx.push({ x: 140, y: GROUND_Y - 100, text: 'STÄNGT – KOM IMORGON!', color: '#ff5d52', life: 2, size: 26 }); log('Bussen vände – allt i huset är stängt', 'sys'); return; }
  S.fx.push({ x: 140, y: GROUND_Y - 100, text: 'BUSSLAST!', color: '#ff8c42', life: 2, size: 30 });
  log('En busslast turister väller in i entrén!', 'sys');
};
window.addEventListener('keydown', ev => {
  if (ev.code === 'Space') { ev.preventDefault(); $('btnPause').click(); }
  if (ev.code === 'KeyT') toggleTags();
  if (ev.code === 'KeyZ') toggleZoom();
  if (ev.code === 'KeyS') cycleStrategy();
  if (S.zoom === 'wide' && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(ev.code)) {
    ev.preventDefault();
    const step = { ArrowUp: -FLOOR_H, ArrowDown: FLOOR_H, PageUp: -VIEW.viewH * 0.8, PageDown: VIEW.viewH * 0.8, Home: -H, End: H }[ev.code];
    scrollBy(step);
  }
  if (ev.code === 'Escape') {
    if (document.querySelector('.pop.show')) document.querySelectorAll('.pop.show').forEach(p => p.classList.remove('show'));
    else if (VIEW.carPop !== null) openCarPop(null);
    else { select(null); VIEW.follow = null; }
  }
  const m = { Digit1: 1, Digit2: 2, Digit3: 4, Digit4: 8 }[ev.code];
  if (m) setSpeed(m);
});
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
cv.addEventListener('mousemove', ev => {
  const { x, y } = toWorld(ev);
  S.hover = hitPerson(x, y);
  const car = hitCar(x, y), door = S.hover ? null : hitDoor(x, y);
  S.hoverDoor = door;
  cv.style.cursor = S.hover || car || door !== null ? 'pointer' : 'crosshair';
});
cv.addEventListener('mouseleave', () => { S.hover = null; S.hoverDoor = null; });
cv.addEventListener('click', ev => {
  if (!S.started) return;
  const { x, y } = toWorld(ev);
  const p = hitPerson(x, y);
  if (p) { select(p); return; }
  const e = hitCar(x, y);
  if (e) { openCarPop(VIEW.carPop === e.id ? null : e); return; }
  // klick på korridoren: spåra nästa person som är inne på våningen
  const door = hitDoor(x, y);
  if (door !== null) {
    const inside = peopleBehindDoor(door);
    if (inside.length) { const i = inside.indexOf(S.sel); select(inside[(i + 1) % inside.length]); }
    return;
  }
  if (x < BX0 || x > INNER_X1 || y < ROOF_Y || y > GROUND_Y || S.fire) return;
  const f = clamp(LOBBY + Math.floor((GROUND_Y - y) / FLOOR_H), 0, TOP);
  const v = spawnVisitor(f, clamp(x, BX0 + 40, WAIT_X1 - 20));
  if (!v) { S.fx.push({ x, y: surf(f) - 70, text: 'STÄNGT!', color: '#ff5d52', life: 1.2 }); return; }
  S.fx.push({ x, y: surf(f) - 70, text: '+1!', color: '#7cf06b', life: 1.2 });
  select(v);
});
