// Stamgästerna: återkommande karaktärer med samma namn, utseende och egenheter varje dag.
// Datan (namn, utseende, repliker) ligger i CAST i config.js; här finns deras beteenden.
// Allt slumpas med simuleringens rng, så stamgästerna gör samma sak varje gång med samma frö.
import { pick, rng } from './rng.js';
import { CAST, CAFE, LOBBY, OFFICE_FLOORS, SPOTS, floorOpen, floorWith, idx } from './config.js';
import { S, log } from './state.js';
import { makePerson, pev, setTrip } from './people.js';

/** @typedef {import('./config.js').CastDef} CastDef */
export const castDef = id => CAST.find(c => c.id === id);
/** våningsindex för en karaktärs hemvåning: en etikett ('3') eller en tagg ('law') */
const homeOf = c => { const t = floorWith(c.home); return t >= 0 ? t : idx(c.home); };

/**
 * Repliken visas i en pratbubbla en stund och hamnar i loggen och personens historik.
 * later = personen är inne i ett rum (syns inte) – repliken sägs när hen kommer ut i kön.
 */
export function say(p, key, vars = {}, later = false) {
  const c = castDef(p.cast);
  if (!c || !c.lines[key]) return;
  const text = pick(c.lines[key]).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  if (later) { p.sayLater = text; return; }
  speak(p, text);
}
/** säg en sparad replik (anropas när personen ställer sig i kön) */
export function flushSay(p) { if (p.sayLater) { speak(p, p.sayLater); p.sayLater = null; } }
function speak(p, text) {
  p.say = { text, until: S.t + 5 };
  pev(p, `Säger: "${text}"`);
  log(`💬 ${p.name}: "${text}"`, 'person', null, p.id);
}
function castify(p, c) {
  p.name = c.name; p.cast = c.id; p.quirk = c.quirk; p.title = c.title;
  Object.assign(p.look, c.look);
  if (c.speed) p.speedMul = c.speed;
  return p;
}

// ---------- De anställda stamgästerna kommer på sina vanliga tider ----------
export function castSchedule() {
  return CAST.filter(c => c.kind === 'emp').map(c => ({ at: c.at, run: () => spawnCastEmployee(c) }));
}
function spawnCastEmployee(c) {
  const p = castify(makePerson('emp', LOBBY, -30), c);
  p.home = homeOf(c);
  if (!OFFICE_FLOORS.includes(p.home)) return null;
  const staff = SPOTS[p.home].map((s, i) => (s.staff ? i : -1)).filter(i => i >= 0);
  p.homeSpot = staff[0];
  p.leaveAt = c.leaveAt; p.lunchAt = c.lunchAt; p.lunched = false; p.cups = 0;
  if (p.look.acc === 1) p.cargo = { kind: 'portfölj', name: 'portfölj', kg: 3 };
  setTrip(p, p.home, `Till jobbet – ${p.title}`);
  S.people.push(p);
  pev(p, `Kliver in i entrén som vanligt · ${p.title}`);
  log(`★ ${p.name} kommer till jobbet (${p.title.split(' –')[0]})`, 'person', null, p.id);
  return p;
}
/** Boende som blir stamgäster (Majken, Lill-Olle) – anropas när de boende flyttar in på morgonen */
export function castResident(p) {
  const c = CAST.find(x => x.resident === p.rtype && !S.people.some(q => q.cast === x.id));
  if (c) castify(p, c);
}
/** Pizzabudet är alltid Pizza-Pelle */
export function castPizza(p) {
  const c = castDef('pelle');
  if (!p || !c) return;
  castify(p, c);
  say(p, 'arrive', {}, true);
}

// ---------- Egenheterna ----------
/** Gunnar gnäller högre ju längre han väntar */
const GRIPE_AT = [15, 35, 60];
export function castWaitTick(p) {
  if (p.quirk !== 'gnäll') return;
  const n = p.gripes || 0;
  if (n < GRIPE_AT.length && p.waited > GRIPE_AT[n]) {
    p.gripes = n + 1; S.stats.gripes++;
    say(p, 'wait');
    if (n === GRIPE_AT.length - 1) p.mood = 2;
  }
}
/** Påstigning: Gunnar muttrar, Majken pratar med de andra, Lill-Olle jublar */
export function castBoard(p, e) {
  if (p.quirk === 'gnäll' && (p.gripes || 0) > 0) say(p, 'board');
  p.gripes = 0;
  if (p.quirk === 'pratig') {
    const others = e.passengers.filter(q => q !== p);
    if (!others.length || rng() > 0.7) return;
    const who = pick(others);
    S.stats.chats++;
    say(p, 'chat', { who: who.name });
    pev(who, `Majken pratar med mig i hissen`);
  }
  if (p.quirk === 'bus' && rng() < 0.4) say(p, 'ride');
}
/** Fia tar alltid trappan (så länge hissarna går – annars gör alla det ändå) */
export const alwaysStairs = p => p.quirk === 'trappa';
/** Kurt hämtar kaffe så fort han sitter vid sin plats en stund */
export function castNext(p, h) {
  if (p.quirk !== 'kaffe' || p.floor !== p.home || h >= 17.5 || !floorOpen(CAFE, h) || rng() > 0.55) return null;
  p.cups = (p.cups || 0) + 1; S.stats.cups++;
  say(p, 'coffee', { n: p.cups }, true);
  return [CAFE, `Kaffe nummer ${p.cups}`];
}
/** Doris håller upp dörren när någon är på väg till kön på våningen (en gång per stopp) */
export function doorHold(e, f) {
  if (e.heldTrip === e.trips) return 0;
  const doris = S.people.find(p => p.quirk === 'dörr' && p.car === e && (p.state === 'ride' || p.state === 'boarding'));
  if (!doris) return 0;
  if (!S.people.some(q => q.state === 'toQueue' && q.floor === f && q !== doris)) return 0;
  e.heldTrip = e.trips; S.stats.holds++;
  say(doris, 'hold');
  return 2.5;
}
/** Lill-Olle trycker på alla knappar mycket oftare än andra barn */
export const kidRate = p => (p.quirk === 'bus' ? 0.6 : 0.15);
export function kidPressed(p) { if (p.quirk === 'bus') say(p, 'buttons'); }
