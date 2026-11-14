// Städningen: någon har kräkts i en hiss (oftast efter Svindeln på taket) eller spillt kaffe i Sky Café.
// En skitig korg tar inga nya resenärer förrän den är städad (outReason 'clean' när städaren väntar på den), och
// folk drar sig för att kliva på den så länge. Driftchefen ringer in städaren Sune (chief.js) – en och samma
// person varje gång, med mopp och balja – som tar jobben i tur och ordning och åker hem när allt är rent.
// Allt här är simulering: spillet har en egen slumpström, illamåendet en annan (coaster.js bestämmer vem).
import { stream } from './rng.js';
const SPILL = stream('spill');
import { fl } from './util.js';
import { CAFE, INNER_X1, LOBBY, SUNE, floorOpen, floorY, CAR_H, shaftCX } from './config.js';
import { S, hour, log } from './state.js';
import { blankPerson, pev, pn, setTrip } from './people.js';
import { inFireZone } from './dispatch.js';

/** så länge tar det att städa en korg (s) och en fläck på golvet */
export const CLEAN_CAR_S = 9, CLEAN_FLOOR_S = 6;
/** spill i Sky Café per sekund medan caféet har öppet */
const SPILL_RATE = 0.0035;

/** @typedef {{ id: number, kind: 'car'|'floor', car: number|null, f: number, x: number, what: string, t0: number, prog: number }} Mess */

export function messReset() {
  S.messes = /** @type {Mess[]} */ ([]); S.messId = 1;
}
/** städaren, om han är i huset */
export const sune = () => S.people.find(p => p.sune && !p.dead) || null;

/** Någon kräks i hissen: korgen är skitig tills Sune har städat den. */
export function carMess(e, p = null) {
  if (e.mess) return false;
  e.mess = true;
  S.messes.push({ id: S.messId++, kind: 'car', car: e.id, f: e.home, x: INNER_X1 - 18, what: 'spya', t0: S.t, prog: 0 });
  S.stats.vomits++;
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.pos) - CAR_H - 26, text: 'BLÄÄÄ!', color: '#9bd36a', life: 1.6 });
  log(`🤢 ${p ? `${pn(p)} kräktes` : 'Någon har kräkts'} i ${e.name} – korgen behöver städas`, 'alert', e.color, null);
  if (p) pev(p, `Mår illa … kräks i hiss ${e.name}. Förlåt!`);
  return true;
}
/** En fläck på golvet i hallen (spya eller kaffe) på våning f vid x. */
export function floorMess(f, x, what, p = null) {
  if (S.messes.some(m => m.kind === 'floor' && m.f === f && Math.abs(m.x - x) < 40)) return false;
  S.messes.push({ id: S.messId++, kind: 'floor', car: null, f, x, what, t0: S.t, prog: 0 });
  if (what === 'spya') S.stats.vomits++; else S.stats.spills++;
  S.fx.push({ x, y: floorY(f) - 70, text: what === 'spya' ? 'BLÄÄÄ!' : 'SPLASCH!', color: what === 'spya' ? '#9bd36a' : '#c8a27a', life: 1.4 });
  log(what === 'spya' ? `🤢 ${p ? pn(p) : 'Någon'} kräktes på ${fl(f)}` : `☕ Någon spillde kaffe på golvet i ${fl(f)}`, 'move', null, p ? p.id : null);
  if (p) pev(p, 'Mår illa … kräks på golvet. Usch.');
  return true;
}
/** Framkalla: någon kräks i hiss id (eller i den första hissen med folk i), annars spills det kaffe i Sky Café */
export function triggerMess(target = null) {
  const e = target !== null && target !== undefined ? S.elevators[target] : S.elevators.find(x => x.passengers.length && !x.mess && x.mode === 'normal');
  if (e && !e.mess) return carMess(e, e.passengers[0] || null);
  return CAFE >= 0 && floorMess(CAFE, 300 + (S.messId * 37) % 200, 'kaffe');
}

// ---------- Varje steg ----------
export function messTick(dt) {
  // kaffe i Sky Café (eget slumptal varje steg medan det har öppet)
  if (CAFE >= 0 && floorOpen(CAFE, hour()) && !S.fire && SPILL.rng() < SPILL_RATE * dt) floorMess(CAFE, SPILL.rand(300, 520), 'kaffe');
  // den som mår illa efter Svindeln kräks där hen är när det blir dags (coaster.js bestämmer vem och när)
  for (const p of S.people) {
    if (!p.queasyAt || S.t < p.queasyAt) continue;
    p.queasyAt = 0;
    if (p.state === 'ride' && p.car) carMess(p.car, p);
    else if ((p.state === 'wait' || p.state === 'toQueue' || p.state === 'exiting') && p.floor !== LOBBY) floorMess(p.floor, Math.max(300, Math.min(560, p.x)), 'spya', p);
    else pev(p, 'Magen har lagt sig – puh');
  }
  const s = sune();
  // en korg som ska städas väntar hemma (elevators.js kör hem den): när Sune står där börjar han
  for (const m of S.messes) {
    if (m.kind !== 'car') continue;
    const e = S.elevators[m.car];
    if (!s || s.job !== m.id) continue;
    e.cleanWant = true;
    const ready = e.mode === 'normal' && e.state === 'idle' && Math.abs(e.pos - e.home) < 1e-6 && !e.passengers.length && !e.reserved;
    if (!e.cleaning && ready && s.state === 'office' && s.floor === e.home) {
      e.cleaning = S.t + CLEAN_CAR_S;
      pev(s, `Moppar ur hiss ${e.name}`);
      log(`🧽 ${s.name} städar ${e.name} på ${fl(e.home)}`, 'move', e.color, s.id);
    }
    if (e.cleaning && S.t >= e.cleaning) done(s, m, `${e.name} är ren igen`);
  }
  // fläckar på golvet: Sune står vid fläcken och moppar
  if (s && s.state === 'office') {
    const m = S.messes.find(x => x.id === s.job && x.kind === 'floor');
    if (m && s.floor === m.f) { m.prog += dt; if (m.prog >= CLEAN_FLOOR_S) done(s, m, `golvet på ${fl(m.f)} är torrt`); }
  }
}
function done(s, m, what) {
  S.messes = S.messes.filter(x => x !== m);
  if (m.kind === 'car') { const e = S.elevators[m.car]; e.mess = false; e.cleanWant = false; e.cleaning = 0; }
  S.stats.cleaned++;
  s.job = null; s.timer = 0; // (nästa jobb direkt)
  pev(s, `Klart – ${what}`);
  log(`✨ ${s.name}: ${what}`, 'move', m.kind === 'car' ? S.elevators[m.car].color : null, s.id);
}

// ---------- Sune ----------
/** Ring in Sune (driftchefen eller spelaren). Returnerar personen, eller null om han redan är här. */
export function callSune() {
  if (sune() || S.fire) return null;
  const p = blankPerson('staff', LOBBY, -40, { name: SUNE.name, look: { ...SUNE.look }, kg: SUNE.kg, fit: SUNE.fit, speedMul: SUNE.speed,
    walkPhase: 3, depth: -2, patience: 12, space: SUNE.space, polite: false });
  Object.assign(p, { role: 'städare', sune: true, title: SUNE.title, job: /** @type {number|null} */ (null), cargo: { kind: 'balja', name: 'mopp och balja', kg: 14 } });
  S.people.push(p);
  const first = suneNext(p) || [LOBBY, 'Väntar i entrén', false];
  setTrip(p, first[0], first[1], first[2]);
  pev(p, `Kliver in i entrén med mopp och balja · ${SUNE.title} · ${p.why}`);
  log(`🧽 ${pn(p)} (städaren) kommer med mopp och balja`, 'person', null, p.id);
  return p;
}
/** Sunes nästa beslut (rollogiken i people.js): nästa jobb, eller hem när allt är rent */
export function suneNext(p) {
  let m = S.messes.find(x => x.id === p.job);
  if (!m) {
    // närmast först: det som är på samma våning, annars det äldsta
    m = S.messes.find(x => x.f === p.floor && !inFireZone(x.f)) || S.messes.find(x => !inFireZone(x.f)) || null;
    p.job = m ? m.id : null;
  }
  if (!m) return [p.exitFloor, 'Allt är rent – åker hem', true];
  if (inFireZone(m.f)) return null;
  p.suneSpot = m.kind === 'car'
    ? { x: INNER_X1 - 14, k: 'stand', face: 1, temp: true, win: 'clean', car: m.car, desc: `Städar hiss ${S.elevators[m.car].name} med mopp och balja` }
    : { x: m.x, k: 'stand', face: 1, temp: true, win: 'hall', desc: m.what === 'spya' ? 'Moppar upp spyan' : 'Torkar upp kaffet' };
  if (m.kind === 'car') S.elevators[m.car].cleanWant = true;
  if (p.floor === m.f) return null;
  return [m.f, m.kind === 'car' ? `Till ${fl(m.f)} och städar hiss ${S.elevators[m.car].name}` : `Till ${fl(m.f)}: ${m.what === 'spya' ? 'någon har kräkts' : 'spillt kaffe'}`, false];
}
