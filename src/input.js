// Knappar, tangentbord och klick i spelet.
import { act } from './actions.js';
import { clamp, fl } from './util.js';
import { FIRE_FLOORS } from './incidents.js';
import { FL, BX0, CAR_H, CAR_W, DOOR_X, FLOOR_H, GROUND_Y, H, INNER_X1, ROOF_Y, STRAT_HINT, STRAT_NAMES, TOP, WAIT_X1, floorY, shaftX, surf, LOBBY } from './config.js';
import { S, log } from './state.js';
import { VIEW, camTarget, cv, detachCam, followCar, lookAt, scrollBy, scrollToFloor } from './view.js';
import { personHead, peopleBehindDoor } from './render.js';
import { $, foldInc, openCarPop, select, setTab, updateHud, updateRoster } from './hud.js';
import { soundOn, toggleSound, unlockSound } from './sound.js';
import { toggleAuto } from './director.js';

// ---------- Kontroller ----------
export function updatePauseBtn() { $('btnPause').textContent = S.paused ? '▶' : '❚❚'; $('btnPause').classList.toggle('on', S.paused); }
const SPEEDS = [0.25, 0.5, 1, 2];
export function setSpeed(v) {
  S.speed = v;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#speeds .btn')).forEach(b => b.classList.toggle('on', +b.dataset.s === v));
}
const STRATS = ['smart', 'peak', 'eco', 'nearest', 'random', 'buttons'];
export function cycleStrategy() { setStrategy(STRATS[(STRATS.indexOf(S.strategy) + 1) % STRATS.length]); }
export function setStrategy(k) {
  if (S.strategy === k) return;
  act('strategy', k);
  syncControls();
}
/** Knapparna visar simuleringens inställningar (de kan ändras av ett nytt dygn) */
let shown = '';
export function syncControls() {
  const key = `${S.strategy}|${S.incLevel}|${S.chief && S.chief.on}|${S.mistakes}|${S.maint}`;
  if (key === shown) return;
  shown = key;
  $('strats').querySelectorAll('.btn').forEach(b => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.k === S.strategy));
  $('btnAuto').classList.toggle('on', VIEW.auto);
  for (const [id, key] of [['mistakeChips', 'mistakes'], ['maintChips', 'maint'], ['levelChips', 'incLevel']]) {
    $(id).querySelectorAll('.chip').forEach(c => c.classList.toggle('on', /** @type {HTMLElement} */ (c).dataset.f === S[key]));
  }
  const on = S.chief && S.chief.on ? 'on' : 'off';
  $('chiefChips').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', /** @type {HTMLElement} */ (c).dataset.f === on));
}
export function toggleTags() { S.tags = !S.tags; $('btnTags').classList.toggle('on', S.tags); }
/** koppla på kameran igen på det den senast följde (hiss, person eller våning) */
export function reattachCam() {
  const t = VIEW.lastCam;
  if (!t) return;
  if (t.kind === 'car') followCar(t.id);
  else if (t.kind === 'floor') scrollToFloor(t.id);
  else {
    const p = S.people.find(q => q.id === t.id && !q.dead);
    if (!p) { VIEW.lastCam = null; return; }
    followPerson(p);
  }
}
/** låt kameran följa en person (spårar personen) */
function followPerson(p) {
  if (S.sel !== p) select(p); else { VIEW.camSel = true; S.followHold = 0; }
  lookAt((personHead(p) || { y: GROUND_Y }).y, 0);
}
/** F: koppla loss kameran om den följer något, annars koppla på den igen */
export function toggleCam() { if (camTarget()) detachCam(); else reattachCam(); }
// små popupfönster i topplisten (förklaring av styrlogiken, ⋯-menyn); bara ett öppet åt gången
export function togglePop(id) {
  const el = $(id), show = !el.classList.contains('show');
  document.querySelectorAll('.pop.show').forEach(p => p.classList.remove('show'));
  el.classList.toggle('show', show);
}
export function chipGroup(id, key, after, sim = false) {
  $(id).addEventListener('click', ev => {
    const b = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('.chip')); if (!b) return;
    // inställningar som påverkar simuleringen går via act(), filter i lådan gör det inte
    if (sim) act('setting', key, b.dataset.f); else S[key] = b.dataset.f;
    $(id).querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
    after();
  });
}
export function doAction(cmd) {
  const [a, b, c] = cmd.split(':');
  if (a === 'trig') {
    if (!S.started) return;
    const sel = /** @type {HTMLSelectElement} */ ($('fireFloor'));
    const target = c !== undefined ? +c : b === 'fire' && sel.value !== '' ? +sel.value : null;
    act('trigger', b, target);
  }
  else if (a === 'chief') act('chiefBack', b);
  else if (a === 'fire') act('fireMode', b);
  else if (a === 'storm') act('stormMode', b);
  else if (a === 'fan') act('fan', +b);
  else if (a === 'level') act('service', +b);
  else if (a === 'moveRoute') act('moveRoute', b);
  else if (a === 'moveBlankets') act('moveBlankets', b === '1');
  else if (a === 'moveWind') act('moveWind', b);
  else if (a === 'dismiss') S.dismissed.add(b); // (bara gränssnittet – simuleringen läser det aldrig)
  else if (a === 'incfold') { foldInc(b); return; }
  else if (a === 'show') scrollToFloor(+b);
  else if (a === 'tab') { setTab(b); return; }
  else if (a === 'menu') { togglePop('menu'); return; }
  else if (a === 'carpop') { openCarPop(null); return; }
  else if (a === 'follow') { if (VIEW.follow === +b) detachCam(); else followCar(+b); }
  else if (a === 'person') {
    // följ en person (ambulansen); klick igen kopplar loss
    const p = S.people.find(q => q.id === +b && !q.dead);
    if (p && VIEW.camSel && S.sel === p) detachCam(); else if (p) followPerson(p);
  }
  else if (a === 'auto') toggleAuto();
  else if (a === 'cam') { if (b === 'off') detachCam(); else reattachCam(); }
  else if (a === 'pow') {
    if (b === 'gen') act('generator');
    if (b === 'auto') act('autoRescue');
    if (b === 'rescue') act('rescue', +c);
  } else if (a === 'car') act('carOff', +c);
  S.incHtml = ''; updateHud();
}
$('btnPause').onclick = () => { if (!S.summaryShown) { S.paused = !S.paused; updatePauseBtn(); } };
$('btnTags').onclick = toggleTags;
const syncSound = () => { const b = $('btnSound'); b.textContent = soundOn() ? '🔊' : '🔇'; b.classList.toggle('on', soundOn()); };
const flipSound = () => { toggleSound(); syncSound(); };
$('btnSound').onclick = flipSound;
$('btnAuto').onclick = () => toggleAuto();
syncSound();
// ljudet var påslaget förra gången: webbläsaren släpper fram det först efter ett klick eller en tangent
addEventListener('pointerdown', unlockSound, { once: true });
addEventListener('keydown', unlockSound, { once: true });
// brandvåningen i menyn: slumpad eller en vald våning
$('fireFloor').innerHTML = '<option value="">slumpad våning</option>' + FIRE_FLOORS.map(f => `<option value="${f}">våning ${fl(f)} · ${FL[f].short}</option>`).join('');
/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#speeds .btn')).forEach(b => (b.onclick = () => setSpeed(+b.dataset.s)));
// en knapp per styrlogik; förklaringen visas när musen vilar på knappen
{
  const bar = $('strats'), hint = $('stratHint');
  for (const k of STRATS) {
    const b = document.createElement('button');
    b.className = 'btn sm'; b.dataset.k = k; b.textContent = STRAT_NAMES[k];
    b.onclick = () => { setStrategy(k); b.onmouseenter(null); };
    b.onmouseenter = () => {
      hint.innerHTML = STRAT_HINT[k] + (k === S.strategy ? '<div class="hint-on">✓ Används nu</div>' : '<div class="hint-on">Klicka för att byta (S byter i tur och ordning)</div>');
      hint.style.left = `${Math.max(0, b.offsetLeft + b.offsetWidth / 2 - 150)}px`;
      hint.classList.add('show');
    };
    b.onmouseleave = () => hint.classList.remove('show');
    bar.appendChild(b);
  }
}
// förklaringar i topplisten: element med data-hint visar texten i en ruta under sig när musen vilar på dem
{
  const bar = $('topbar'), hint = $('tbHint');
  let cur = /** @type {HTMLElement|null} */ (null);
  const hide = () => { cur = null; hint.classList.remove('show'); };
  bar.addEventListener('pointerover', ev => {
    const t = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-hint]'));
    if (!t || !bar.contains(t)) { hide(); return; }
    if (t === cur) return;
    cur = t; hint.innerHTML = t.dataset.hint;
    const r = t.getBoundingClientRect(), br = bar.getBoundingClientRect();
    const w = hint.offsetWidth || 300;
    hint.style.left = `${Math.max(0, Math.min(br.width - w, r.left - br.left + r.width / 2 - w / 2))}px`;
    hint.style.top = `${r.bottom - br.top + 4}px`;
    hint.classList.add('show');
  });
  bar.addEventListener('pointerleave', hide);
  bar.addEventListener('pointerdown', hide);
}
chipGroup('rosterChips', 'rosterFilter', updateRoster);
chipGroup('logChips', 'logFilter', () => { S.logDirty = true; updateHud(); });
for (const [id, apply] of /** @type {[string, (v: string) => void][]} */ ([['levelChips', v => act('incLevel', v)], ['chiefChips', v => act('chief', v === 'on')]])) {
  $(id).addEventListener('click', ev => {
    const b = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('.chip')); if (!b) return;
    apply(b.dataset.f); syncControls(); S.incHtml = ''; updateHud();
  });
}
chipGroup('mistakeChips', 'mistakes', () => { log(`Felknappar: ${S.mistakes}`, 'sys'); syncControls(); }, true);
chipGroup('maintChips', 'maint', () => { log(S.maint === 'natt' ? '🔧 Underhåll: nattservice av slitna hissar' : '🔧 Underhåll: bara när något går sönder', 'sys'); syncControls(); }, true);
$('tkClose').onclick = () => select(null);
// pointerdown i stället för click: incidentpanelen ritas om varje sekund (nedräkningar)
document.addEventListener('pointerdown', ev => {
  const t = /** @type {HTMLElement} */ (ev.target);
  // klick utanför en öppen popup stänger den
  if (!t.closest('.pop') && !t.closest('[data-act="menu"]')) document.querySelectorAll('.pop.show').forEach(p => p.classList.remove('show'));
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
  const n = act('bus');
  if (!n) { S.fx.push({ x: 140, y: GROUND_Y - 100, text: 'STÄNGT – KOM IMORGON!', color: '#ff5d52', life: 2, size: 26 }); log('Bussen vände – allt i huset är stängt', 'sys'); return; }
  S.fx.push({ x: 140, y: GROUND_Y - 100, text: 'BUSSLAST!', color: '#ff8c42', life: 2, size: 30 });
  log('En busslast turister väller in i entrén!', 'sys');
};
window.addEventListener('keydown', ev => {
  if (ev.code === 'Space') { ev.preventDefault(); $('btnPause').click(); }
  if (ev.code === 'KeyT') toggleTags();
  if (ev.code === 'KeyM') flipSound();
  if (ev.code === 'KeyF') toggleCam();
  if (ev.code === 'KeyA') toggleAuto();
  if (ev.code === 'KeyS') cycleStrategy();
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(ev.code)) {
    ev.preventDefault();
    const step = { ArrowUp: -FLOOR_H, ArrowDown: FLOOR_H, PageUp: -VIEW.viewH * 0.8, PageDown: VIEW.viewH * 0.8, Home: -H, End: H }[ev.code];
    scrollBy(step);
  }
  if (ev.code === 'Escape') {
    if (document.querySelector('.pop.show')) document.querySelectorAll('.pop.show').forEach(p => p.classList.remove('show'));
    else if (VIEW.carPop !== null) openCarPop(null);
    else if (S.tab) setTab(S.tab); // stänger fönstret med flikarna
    else { select(null); detachCam(); }
  }
  const m = { Digit1: 1, Digit2: 2 }[ev.code];
  if (m) setSpeed(m);
  // − och + stegar mellan farterna (¼× ½× 1× 2×)
  const d = { Minus: -1, NumpadSubtract: -1, Equal: 1, NumpadAdd: 1 }[ev.code];
  if (d) setSpeed(SPEEDS[clamp(SPEEDS.indexOf(S.speed) + d, 0, SPEEDS.length - 1)]);
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
  const v = act('visitor', f, clamp(x, BX0 + 40, WAIT_X1 - 20));
  if (!v) { S.fx.push({ x, y: surf(f) - 70, text: 'STÄNGT!', color: '#ff5d52', life: 1.2 }); return; }
  S.fx.push({ x, y: surf(f) - 70, text: '+1!', color: '#7cf06b', life: 1.2 });
  select(v);
});
