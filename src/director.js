// Regissören: automatisk kamera som letar upp det mest sevärda i huset och klipper dit.
// Rent gränssnitt: läser S, ändrar aldrig simuleringen (slumpen är vrand). Kameran rör sig via S.camTarget
// precis som när man följer en hiss. Allt manuellt (scrolla, följa, klicka på någon) stänger av regissören.
import { DOCK, FLOOR_H, LOBBY, ROOF, STATION, floorY } from './config.js';
import { S } from './state.js';
import { fl } from './util.js';
import { vrand } from './rng.js';
import { VIEW, camMax, camTarget } from './view.js';
import { personHead } from './render.js';
import { cleanerAt } from './pixel.js';

const HOLD = 10;     // sekunder (verklig tid) en vanlig tagning varar
const MIN_HOLD = 6;  // så kort får en tagning bli innan något viktigare får klippa in
const CUT_OVER = 25; // så mycket intressantare måste det nya vara för att klippa före tiden
const MEMORY = 6;    // så många tidigare tagningar som får straff (inte samma sak hela tiden)
const BORED = 1.5;   // poängavdrag per sekund som något redan har visats (helikoptern på taket blir tråkig)
const FORGET = 120;  // sekunder tills det tråkiga är glömt (avtar exponentiellt)

/** @typedef {{ key: string, score: number, kind: 'car'|'person'|'floor'|'cleaner', id: number, why: string }} Shot */

/** Slår på/av regissören. */
export function toggleAuto() {
  if (VIEW.auto) { VIEW.auto = false; return false; }
  // koppla loss allt annat först – detachCam stänger av regissören, så den slås på sist
  const t = camTarget();
  if (t) VIEW.lastCam = t;
  VIEW.follow = null; VIEW.camSel = false; VIEW.camFloor = null;
  VIEW.auto = true; VIEW.shot = null; S.followHold = 0;
  return true;
}

const recent = /** @type {string[]} */ ([]);
/** sekunder som varje sak har visats, avtar med tiden */
const seen = /** @type {Map<string, number>} */ (new Map());
let lastAnim = 0, cleanerShown = -1e9;
const name1 = p => p.name.split(' ')[0];
const visible = p => { const h = personHead(p); return h && !h.hidden; };

/** Allt som är värt att titta på just nu, med poäng. */
function shots() {
  /** @type {Shot[]} */
  const out = [];
  const add = (key, score, kind, id, why) => out.push({ key, score, kind, id, why });
  // ---------- incidenter och händelser ----------
  if (S.fire) add('fire', 100, 'floor', S.fire.floor, `🔥 Brand på ${fl(S.fire.floor)}`);
  if (S.medic && S.medic.state !== 'done') {
    const crew = S.people.filter(p => p.medic && !p.dead && visible(p));
    const amb = crew.find(p => p.cargo && p.cargo.kind.startsWith('bår')) || crew[0];
    if (amb) add('medic', 90, 'person', amb.id, '🚑 Ambulansen');
    else add('medicF', 80, 'floor', S.medic.floor, `🚑 ${S.medic.pname} har svimmat`);
  }
  if (S.heli && ROOF >= 0) add('heli', 75, 'floor', ROOF, '🚁 Helikoptern');
  for (const e of S.elevators) {
    const n = e.passengers.length;
    if (!S.power && n) add(`dark${e.id}`, 70 + n, 'car', e.id, `⚡ Fast i ${e.name}`);
    if (e.mode === 'snapped') add(`snap${e.id}`, e.snap.ph === 'evac' ? 92 : 96, 'car', e.id, e.snap.ph === 'evac' ? `🧗 Utrymning ur ${e.name}` : `🪢 Linbrott i ${e.name}`);
    else if (e.mode === 'broken' && e.fault.cable && e.techId !== null) add(`cable${e.id}`, 22, 'car', e.id, `🔧 Linbyte i ${e.name}`);
    if ((e.mode === 'broken' || e.mode === 'rescue') && n) add(`broken${e.id}`, 70, 'car', e.id, `🔧 ${e.name} har stannat`);
    if (e.hot) add(`hot${e.id}`, 45, 'car', e.id, `🌡️ ${e.name} är överhettad`);
    if ((e.overloadFlash || 0) > 1) add(`over${e.id}`, 50, 'car', e.id, `⚖️ Överlast i ${e.name}`);
    if (S.storm && e.facade) add('storm', 55, 'car', e.id, `🌬️ ${e.name} i stormen`);
    if (S.move && S.move.state === 'on' && e.freight) add('move', 35, 'car', e.id, '🚚 Flyttgubbarna');
    if (e.mode === 'service') add(`svc${e.id}`, 12, 'car', e.id, `🔧 Service på ${e.name}`);
    // fullsatt hiss i fart
    if (n >= 4 && Math.abs(e.v || 0) > 0.5) add(`full${e.id}`, 14 + n * 1.5, 'car', e.id, `🛗 ${e.name} med ${n} pers`);
  }
  if (S.train && STATION >= 0) add('train', 48, 'floor', STATION, '🚇 Tåget kommer');
  if (S.truck && DOCK >= 0) add('truck', 28, 'floor', DOCK, '🚚 Leveransbilen');
  // fönsterputsaren utanför tornet: ett lugnt avbrott då och då (bara medan putsaren skrapar, och inte när det brinner)
  const G = cleanerAt();
  // poängen växer ju längre sedan putsaren visades, så att den dyker upp ett par gånger per dag
  if (G && G.scrub && !S.fire) {
    const since = S.anim - cleanerShown;
    add('cleaner', Math.min(60, 20 + since / 3) + (S.storm ? 10 : 0), 'cleaner', 0, S.storm ? '🧽 Putsaren i blåsten' : '🧽 Fönsterputsaren');
  }
  // ---------- folk ----------
  const queue = new Map();
  for (const p of S.people) {
    if (p.dead) continue;
    if (p.say && p.say.until > S.t + 1 && visible(p)) add(`say${p.id}`, 52, 'person', p.id, `💬 ${name1(p)}`);
    if (p.vip && p.state !== 'office' && visible(p)) add(`vip${p.id}`, 40, 'person', p.id, `⭐ ${name1(p)} (VIP)`);
    if (p.state === 'wait') {
      queue.set(p.floor, (queue.get(p.floor) || 0) + 1);
      if (p.mood >= 2) add(`sur${p.id}`, Math.min(45, 22 + p.waited / 4), 'person', p.id, `😤 ${name1(p)} har väntat ${Math.round(p.waited)} s`);
    }
    if (p.cast && p.state !== 'office' && visible(p)) add(`cast${p.id}`, 18, 'person', p.id, `★ ${name1(p)}`);
  }
  for (const [f, n] of queue) if (n >= 5) add(`q${f}`, 16 + n, 'floor', f, `👥 ${n} väntar på ${fl(f)}`);
  // reserv: entrén och en slumpad hiss i rörelse
  add('lobby', 6, 'floor', LOBBY, '🚪 Entrén');
  const moving = S.elevators.filter(e => Math.abs(e.v || 0) > 0.5);
  if (moving.length) { const e = moving[Math.floor(vrand(0, moving.length))]; add(`ride${e.id}`, 8, 'car', e.id, `🛗 ${e.name}`); }
  return out;
}

/** Poäng efter hur nyligen vi visade samma sak (och lite slump så att det inte blir förutsägbart). */
function rate(s, current = false) {
  // det som visas just nu straffas inte för att det nyss visats (då klipps det bort i förtid)
  const i = current ? -1 : recent.indexOf(s.key);
  // incidenter (100) tål att visas länge, vardagssaker tröttnar man snabbare på
  const bored = Math.min(s.score * 0.6, (seen.get(s.key) || 0) * BORED);
  return s.score - bored - (i < 0 ? 0 : (MEMORY - i) * 6) + vrand(0, 6);
}

/** Var tagningen är just nu (världens y), eller null om den inte längre går att visa. */
function shotY(s) {
  if (s.kind === 'floor') return floorY(s.id) - FLOOR_H / 2;
  if (s.kind === 'cleaner') { const G = cleanerAt(); return G && G.crew ? G.y - 30 : null; }
  if (s.kind === 'car') { const e = S.elevators[s.id]; return e ? floorY(e.pos) - FLOOR_H / 2 : null; }
  const p = S.people.find(q => q.id === s.id);
  if (!p || p.dead) return null;
  const h = personHead(p);
  return h && !h.hidden ? h.y + 40 : null;
}

/** Varje bildruta: byt tagning vid behov och styr kameran. */
export function updateDirector() {
  if (!VIEW.auto) return;
  // något manuellt har tagit över kameran
  if (camTarget()) { VIEW.auto = false; return; }
  if (!S.started || S.anim < (S.followHold || 0)) return;
  const dt = Math.max(0, Math.min(0.25, S.anim - lastAnim)); lastAnim = S.anim;
  let s = VIEW.shot;
  if (!S.paused) {
    const k = Math.exp(-dt / FORGET);
    for (const [key, v] of seen) { if (v * k < 0.5) seen.delete(key); else seen.set(key, v * k); }
    if (s) seen.set(s.key, (seen.get(s.key) || 0) + dt);
  }
  const age = s ? S.anim - s.t0 : Infinity;
  const y = s ? shotY(s) : null;
  if (!S.paused && (y === null || age > MIN_HOLD)) {
    const all = shots();
    const cur = s && all.find(c => c.key === s.key);
    let best = null, bv = -Infinity;
    for (const c of all) { const v = rate(c); if (v > bv) { bv = v; best = c; } }
    const done = y === null || age > HOLD || !cur;
    if (best && best.key !== (s && s.key) && (done || rate(best) > rate(cur, true) + CUT_OVER)) {
      if (s && s.key === 'cleaner') cleanerShown = S.anim; // räknas från när kameran lämnar putsaren
      VIEW.shot = s = { ...best, t0: S.anim };
      recent.unshift(best.key); recent.length = Math.min(recent.length, MEMORY);
    } else if (s && cur) s.why = cur.why; // texten kan ändras (väntetid, antal)
  }
  if (!s) return;
  const sy = shotY(s);
  if (sy === null) return;
  // hissar hålls mitt i bild; folk och våningar får röra sig lite innan kameran följer efter
  const top = VIEW.camY + VIEW.viewH * 0.3, bot = VIEW.camY + VIEW.viewH * 0.7;
  if (s.kind === 'car' || sy < top || sy > bot || S.anim - s.t0 < 0.1)
    S.camTarget = Math.max(0, Math.min(camMax(), sy - VIEW.viewH * 0.5));
}
/** Text till kameraknappen: vad regissören visar. */
export const autoWhy = () => (VIEW.auto && VIEW.shot ? VIEW.shot.why : '');
