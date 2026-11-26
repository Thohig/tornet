// Firmafesten: ett företag i huset har fest på eftermiddagen (högst en gång per dygn). Kollegor från de andra
// våningarna kommer dit med ballonger, och Konditoriets bud kommer med tårtan – 25 kg, så den åker varuhissen.
// Ballongerna fastnar i hissdörrarna (dörren glider upp igen, och ibland smäller en: POFF!). När festen är slut
// går alla tillbaka till jobbet med ballongerna (den som har en kvar). Driftchefen (chief.js) eller spelaren
// (act('party', …)) väljer:
//   varu – gästerna med ballonger tar varuhissen (breda dörrar, inget fastnar – men den är långsam och delas med godset)
//   alla – de åker vilken hiss som helst (fortare, men ballongerna fastnar i dörrarna och håller upp alla andra)
// (Simulering: läget ligger i S.party; gästerna har p.party, people.js och systems.js frågar partyNext/partyArrive.
// Egen slumpström.)
import { stream } from './rng.js';
const { pick, rand, rng, shuffle } = stream('firmafest');
import { S, hour, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';
import { CAR_H, FL, LOBBY, OFFICE_FLOORS, floorOpen, floorY, shaftCX } from './config.js';
import { CARGO, makePerson, pev, pn, setTrip } from './people.js';
import { fl } from './util.js';
import { sv } from './sv.js';
/** @typedef {import('./people.js').Person} Person */
/** @typedef {import('./elevators.js').Elevator} Elevator */

/**
 * Festen (S.party): f = våningen; ph = 'on' (gästerna kommer, festen pågår till endAt) → 'home' (alla går
 * tillbaka); mode = '' (inget beslut – de åker vilken hiss som helst), 'varu' eller 'alla'; guests = gästerna (id);
 * cake = tårtbudet (id), caked = tårtan är framme; stuck = gånger ballongerna fastnade i en dörr; popped = smällda
 * ballonger; seen = hissarnas stopp som redan har haft ballonger i dörren (hiss-id → e.trips).
 * @typedef {{ t0: number, f: number, ph: 'on'|'home', mode: string, by: string, endAt: number, guests: number[],
 *   cake: number, caked: boolean, stuck: number, popped: number, seen: Record<number, number>, homeAt: number }} Party
 */
/** så många gäster med ballonger som mest */
const GUESTS = 10;
/** chansen att ballongerna fastnar när dörren stänger (per stopp, i en vanlig hiss) – och att en smäller då */
const STUCK_P = 0.4, POP_P = 0.3;
/** festen pågår så länge (s) efter att den börjat */
const LEN = [150, 210];

/** har personen ballonger? @param {Person} p */
export const balloons = p => !!p.cargo && p.cargo.kind === 'ballonger';
/** gästerna med ballonger tar bara varuhissen (people.js: elevatorAllows) @param {Person} p */
export const balloonFreight = p => balloons(p) && !!S.party && S.party.mode === 'varu';
/** de som kan bli bjudna: anställda som sitter på sina kontor (inte på festvåningen) */
const invitable = f => S.people.filter(p => p.kind === 'emp' && !p.role && !p.crewId && !p.dead && !p.leaving && p.state === 'office'
  && p.floor === p.home && p.home !== f && !p.party && !p.cast);
/** våningar där en fest kan hållas: kontor som har öppet en stund till och där någon är på jobbet */
const hosts = h => OFFICE_FLOORS.filter(f => f !== LOBBY && floorOpen(f, h) && floorOpen(f, h + 1.5)
  && S.people.some(p => p.kind === 'emp' && p.home === f && p.floor === f && !p.dead));
/** kan en fest börja nu? (eftermiddag, en gång per dygn) */
export const partyPossible = () => !S.party && S.partyDay !== S.day && S.power && !S.fire && hour() >= 13 && hour() < 18.5
  && hosts(hour()).length > 0 && invitable(-1).length >= 4;

/** Slumpen eller spelaren (act('trigger', 'party')): ett företag har fest. false om det inte går nu. */
export function startParty() {
  if (!partyPossible()) return false;
  const f = pick(hosts(hour()));
  const guests = shuffle(invitable(f)).slice(0, GUESTS);
  if (guests.length < 3) return false;
  S.partyDay = S.day;
  S.party = { t0: S.t, f, ph: 'on', mode: '', by: '', endAt: S.t + rand(LEN[0], LEN[1]), guests: guests.map(p => p.id), cake: -1,
    caked: false, stuck: 0, popped: 0, seen: {}, homeAt: 0 };
  for (const p of guests) {
    p.party = true; p.partyBag = p.cargo; p.cargo = { ...CARGO.ballonger };
    setTrip(p, f, sv`Firmafest hos ${FL[f].name} – med ballonger`);
    pev(p, sv`Bjuden på firmafest hos ${FL[f].name}! Tar med ballonger`);
  }
  // tårtan kommer med bud genom entrén – den väger för mycket för en vanlig hiss
  const c = makePerson('vis', LOBBY, -30 - rand(0, 20));
  c.cargo = { ...CARGO.tårta }; c.title = 'Bud från Konditoriet'; c.cake = true;
  S.people.push(c);
  setTrip(c, f, 'Levererar tårtan till firmafesten', false);
  S.party.cake = c.id;
  log(sv`🎈 Firmafest hos ${FL[f].name} på ${fl(f)}! ${guests.length} kollegor är på väg dit med ballonger, och tårtan kommer med bud`, 'alert');
  incidentStarted(f);
  return true;
}
/** Beslutet: 'varu' (ballongerna i varuhissen) eller 'alla' (vilken hiss som helst). by = 'chief' eller 'player'. */
export function setPartyMode(mode, by) {
  const P = S.party;
  if (!P || (mode !== 'varu' && mode !== 'alla')) return false;
  if (P.mode === mode) return true;
  P.mode = mode; P.by = by;
  // de som väntar på en hiss med sina ballonger planerar om resan (en annan hiss – eller bara varuhissen)
  for (const p of S.people) if (balloons(p) && (p.state === 'wait' || p.state === 'toQueue') && p.goal !== undefined) setTrip(p, p.goal, p.why, p.leaving);
  log(mode === 'varu' ? '🎈 Gästerna med ballonger tar varuhissen' : '🎈 Gästerna med ballonger åker vilken hiss som helst', 'alert');
  return true;
}

/** Gästerna: till festen medan den pågår, och kvar där (systems.js: next) @param {Person} p */
export function partyNext(p) {
  const P = S.party;
  if (!p.party || !P || P.ph !== 'on') return undefined;
  return p.floor === P.f ? null : [P.f, sv`Firmafest hos ${FL[P.f].name}`];
}
/** Framme: gästen minglar, budet lämnar tårtan, och ballongerna följer med hem (systems.js: arrive) @param {Person} p */
export function partyArrive(p) {
  const P = S.party;
  if (p.cake && P && p.floor === P.f && p.cargo) {
    p.cargo = null; P.caked = true; p.timer = 2;
    pev(p, 'Lämnar tårtan – grattis!');
    log(sv`🎂 Tårtan är framme hos ${FL[P.f].name}`, 'alert', null, p.id);
    return true;
  }
  if (p.party && P && P.ph === 'on' && p.floor === P.f) { p.timer = rand(20, 40); pev(p, 'Minglar på festen med en ballong i handen'); return true; }
  // tillbaka på sitt kontor: ballongen binds fast vid skrivbordet
  if (balloons(p) && p.partyBag !== undefined && p.floor === p.home) {
    p.cargo = p.partyBag; p.partyBag = undefined;
    pev(p, 'Binder fast ballongen vid skrivbordet');
  }
  return false;
}

/** @param {number} _dt */
export function partyTick(_dt) {
  const P = S.party;
  if (!P) return;
  // ballongerna fastnar i dörrarna (inte i varuhissens breda dörrar)
  for (const e of S.elevators) {
    if (e.state !== 'doors' || e.doorPhase !== 'closing' || e.freight || e.door > 0.7 || P.seen[e.id] === e.trips) continue;
    const who = e.passengers.find(balloons);
    if (!who) continue;
    P.seen[e.id] = e.trips;
    if (rng() >= STUCK_P) continue;
    e.bounce = 0.6; P.stuck++; S.stats.doorFights++;
    if (rng() < POP_P) {
      P.popped++; who.cargo = who.partyBag ?? null; who.partyBag = undefined;
      pev(who, 'POFF! Ballongen smällde i dörren');
      S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 26, text: 'POFF!', color: '#ff5d52', life: 1.2, size: 14 });
      log(sv`🎈 POFF! ${pn(who)}s ballong smällde i dörren på ${e.name}`, 'move', e.color, who.id);
    } else {
      S.fx.push({ x: shaftCX(e.id), y: floorY(e.floor) - CAR_H - 26, text: 'BOING!', color: '#ffe14d', life: 1, size: 14 });
      log(sv`🎈 Ballongerna fastnade i dörren på ${e.name} – den glider upp igen`, 'move', e.color);
    }
  }
  if (P.ph === 'on' && S.t >= P.endAt) {
    P.ph = 'home'; P.homeAt = S.t;
    // festen är slut: alla går tillbaka till jobbet (den som inte hann fram vänder)
    for (const id of P.guests) {
      const p = S.people.find(q => q.id === id && !q.dead);
      if (!p) continue;
      p.party = false;
      if (p.state === 'office') p.timer = Math.min(p.timer, rand(0.5, 6));
      else if (p.state === 'wait' || p.state === 'toQueue') setTrip(p, p.home, 'Festen är slut – tillbaka till jobbet', false);
    }
    log(sv`🎈 Festen hos ${FL[P.f].name} är slut – alla går tillbaka med ballongerna`, 'alert');
  }
  if (P.ph === 'home') {
    const left = P.guests.some(id => S.people.some(q => q.id === id && !q.dead && balloons(q)));
    if (!left || S.t - P.homeAt > 240) finish(P);
  }
}
/** @param {Party} P */
function finish(P) {
  // (den som fortfarande bär på en ballong får behålla den – men ingen räknas som gäst längre)
  for (const id of P.guests) { const p = S.people.find(q => q.id === id); if (p) p.party = false; }
  S.party = null;
  const how = P.mode === 'varu' ? 'Ballongerna åkte varuhissen.' : sv`Ballongerna fastnade i hissdörrarna ${P.stuck} gånger${P.popped ? sv` och ${P.popped} smällde` : ''}.`;
  incidentOver('party', sv`🎈 Festen hos ${FL[P.f].name} är över`, sv`${P.guests.length} gäster kom med ballonger${P.caked ? ' och tårtan kom fram' : ''}. ${how}`, { floor: P.f });
}

export function partyReset() { S.party = null; S.partyDay = -1; }
