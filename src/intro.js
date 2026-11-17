// Rundvisningen: receptionisten Berit visar runt i ett eget dygn innan spelet börjar. Stoppen (klockslag,
// händelser, kamera, vad som lyfts fram i panelen och Berits repliker) står i introStops.js; här spelas de upp.
// Berättelsen står i ett eget block överst i kontrollpanelen (setTour i panels.js) – inget läggs över bilden.
// Bara gränssnitt: dygnet startas med newSim, händelserna framkallas via act(), och dygnet slängs efteråt.
import { DEFAULT_TEMPO, LOBBY } from './config.js';
import { S, hour } from './state.js';
import { DT, newSim, step } from './sim.js';
import { act } from './actions.js';
import { VIEW, camMax } from './view.js';
import { toggleAuto } from './director.js';
import { extraActions, followCarOnly, followFloor, followPerson, unfollow } from './input.js';
import { setTour } from './panels.js';
import { INTRO_OPTS, INTRO_SEED, STOPS, introPerson } from './introStops.js';
import { esc } from './util.js';

const SPIN_MS = 30; // så länge per bildruta som fram-spolningen får räkna
/** @type {{ on: boolean, i: number, max: number, spin: { to: number, until?: () => boolean }|null, who: string, done: ((how: 'go'|'menu') => void)|null }} */
const T = { on: false, i: 0, max: -1, spin: null, who: 'någon', done: null };

/** Pågår rundvisningen? */
export const introOn = () => T.on;

/** Starta rundvisningen. done('go') = spelaren vill börja spela, done('menu') = tillbaka till menyn. */
export function startIntro(done) {
  T.on = true; T.done = done; T.who = 'någon'; T.max = -1;
  newSim(INTRO_SEED, { ...INTRO_OPTS, tempo: DEFAULT_TEMPO });
  S.started = true; S.paused = false; S.speed = 1;
  VIEW.camY = camMax();
  addEventListener('keydown', keys, true);
  go(0);
}

/** gå till stopp i; ett stopp vi redan sett visar bara kameran och texten igen (inga händelser, ingen spolning) */
function go(i) {
  const back = i <= T.max;
  T.i = i;
  const s = STOPS[i];
  const early = s.at !== undefined && hour() < s.at, waiting = !!s.until && !s.until();
  if (!back && (early || waiting)) {
    T.spin = { to: s.at ?? hour() + (s.max ?? 0.5), until: s.until };
    paint();
  } else arrive(back);
}
function arrive(back) {
  T.spin = null;
  const s = STOPS[T.i];
  // (räknas som sett först när vi är framme: går man bakåt under spolningen spolas det om nästa gång)
  T.max = Math.max(T.max, T.i);
  if (!back) for (const [name, ...args] of s.ev || []) act(name, ...args);
  camera(s.cam);
  paint();
}
/** @param {import('./introStops.js').IntroCam} c */
function camera(c) {
  if (c.auto) { unfollow(); if (!VIEW.auto) toggleAuto(); return; }
  if (VIEW.auto) toggleAuto();
  if (c.person) {
    const p = introPerson();
    if (p) { T.who = p.name; followPerson(p); return; }
    T.who = 'någon'; followFloor(LOBBY); return;
  }
  if (c.car !== undefined && c.car >= 0) followCarOnly(c.car);
  else if (c.floor !== undefined && c.floor >= 0) followFloor(c.floor);
}

/** Varje bildruta (main.js): spola fram till nästa stopp. */
export function introTick() {
  const sp = T.spin;
  if (!T.on || !sp) return;
  const t0 = performance.now();
  while (performance.now() - t0 < SPIN_MS) {
    if (hour() >= sp.to || (sp.until && sp.until())) { arrive(false); return; }
    step(DT);
  }
}

function paint() {
  const s = STOPS[T.i], n = STOPS.length, last = T.i === n - 1;
  const dots = STOPS.map((_, j) => `<i class="${j < T.i ? 'was' : j === T.i ? 'now' : ''}"></i>`).join('');
  const say = T.spin ? '<div class="tour-say dim">⏩ Ett ögonblick, vi går dit …</div>'
    : `<div class="tour-say"><b>Berit:</b> ${esc(s.text({ who: T.who }))}</div>`;
  const nav = (T.i > 0 ? '<button class="btn xs" data-act="tour:back" data-hint="Föregående stopp (←)">◀</button>' : '') + '<span class="sp"></span>'
    + (last ? '<button class="btn xs" data-act="tour:menu" data-hint="Tillbaka till startmenyn">Till menyn</button><button class="btn tour-go" data-act="tour:go" data-hint="Ett nytt dygn börjar (Enter)">KÖR!</button>'
      : `<button class="btn tour-next" data-act="tour:next" data-hint="Nästa stopp (Enter eller →)"${T.spin ? ' disabled' : ''}>Nästa ▶</button>`);
  const html = `<div class="blk-h"><span>🛎️ Rundvisning · ${T.i + 1}/${n} · ${esc(s.title)}</span><button class="blk-x" data-act="tour:menu" data-hint="Avsluta rundvisningen">✕</button></div>`
    + `${say}<div class="tour-dots">${dots}</div><div class="row tour-nav">${nav}</div>`;
  setTour({ key: `${T.i}|${!!T.spin}`, html, focus: T.spin ? [] : s.focus || [], spot: T.spin ? [] : s.spot || [] });
}

function end(how) {
  T.on = false; T.spin = null;
  removeEventListener('keydown', keys, true);
  setTour(null);
  unfollow();
  if (VIEW.auto) toggleAuto();
  S.started = false;
  const d = T.done;
  T.done = null;
  if (d) d(how);
}
function next() {
  if (T.spin) return;
  if (T.i < STOPS.length - 1) go(T.i + 1); else end('go');
}
extraActions.tour = b => {
  if (!T.on) return;
  if (b === 'next') next();
  else if (b === 'back' && T.i > 0) go(T.i - 1);
  else if (b === 'go') end('go');
  else if (b === 'menu') end('menu');
};
// Enter/→ = nästa, ← = tillbaka (fångas före spelets tangenter; pilarna åt sidan används inte annars)
function keys(ev) {
  if (ev.target instanceof Element && ev.target.closest('select,input')) return;
  if (['Enter', 'NumpadEnter', 'ArrowRight'].includes(ev.code)) next();
  else if (ev.code === 'ArrowLeft') { if (T.i > 0) go(T.i - 1); }
  else return;
  ev.preventDefault(); ev.stopImmediatePropagation();
}
