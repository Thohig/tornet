// Destinationsstyrning: kostnadsfunktion, tilldelning, omfördelning, parkering.
//
// Översikt:
// destinationsstyrning: kostnadsfunktion, tilldelning, omfördelning, parkering (även lärande: `learnBlend`,
// `learnedFloor`), brandzon, Rusning (`trafficMode`, `peakHold`; känner till tidtabellen: väntar in tågklumpen vid
// perrongen, möter tåget, väntar inte i entrén när tåget kommer) och Energisnål (`ecoCost`); dubbeldäck via
// `posOf`/`deckOf`/`allowedPos`
import { stream } from './rng.js';
const { pick, rand, rng } = stream('styrning');
import { ARR, K, fl } from './util.js';
import { ACC, CAP, DOOR_T, STOP_COST, TOP, VMAX, FULL_LOAD, LOBBY, EL, STATION, idx } from './config.js';
import { S, hour, log } from './state.js';
import { liftsAvailable, pev, pn, toStairs, elevatorAllows } from './people.js';
import { buttonsMode, mistakeRate, pressHallButton } from './buttons.js';
import { moveKwh, heatMul } from './service.js';
import { windMul } from './weather.js';
import { sysBlocks, sysOut, sysOutText } from './systems.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

// ---------- Destinationsstyrning ----------
// Varje hiss har e.pick: { '3u': antal } = personer den ska hämta på våning 3 som ska uppåt.
export function rebuildPicks() {
  for (const e of S.elevators) { e.pick = {}; e.pickKg = 0; }
  // dubbeldäck: ett fullt däck hämtar ingen (annars öppnar korgen om och om igen för dem som inte får plats)
  const deck2 = S.elevators.filter(e => e.deck2);
  if (deck2.length) {
    for (const e of deck2) e.deckN = [0, 0];
    for (const p of S.people) if ((p.state === 'ride' || p.state === 'boarding') && p.car && p.car.deck2) p.car.deckN[p.deck || 0]++;
    for (const e of deck2) e.deckFull = e.deckN.map(n => n >= CAP);
  }
  /** @param {Elevator} e */
  const roomFor = (e, f) => !e.deck2 || !e.deckFull[deckOf(e, f)];
  // KNAPPAR: hissen vet bara om anropen i hallen (ett per våning och riktning), inte hur många som väntar
  const buttons = buttonsMode();
  if (buttons) for (const c of Object.values(S.calls)) if (c.car !== null) { const e = S.elevators[c.car]; if (roomFor(e, c.f)) e.pick[posOf(e, c.f) + K(c.d)] = 1; }
  for (const p of S.people) {
    if (p.state !== 'wait' || p.assigned === null || (buttons && !keyed(p))) continue;
    const e = S.elevators[p.assigned], k = posOf(e, p.floor) + K(p.dir);
    if (!roomFor(e, p.floor)) continue;
    e.pick[k] = (e.pick[k] || 0) + 1;
    e.pickKg += EST_KG; // styrningen vet inte vad väntande väger – bara vågen i korgen mäter på riktigt
  }
}
/** @param {Elevator} e */
export function assignedTo(e, f, d) { return (e.pick[f + K(d)] || 0) > 0; }
/** @param {Elevator} e */
export function pickTotal(e) { let n = 0; for (const k in e.pick) n += e.pick[k]; return n; }
/** @param {Elevator} e */
export function stopFloors(e) {
  const s = new Set(e.carCalls);
  for (const k in e.pick) s.add(parseInt(k, 10));
  return [...s];
}
/** @param {Elevator} e */
export const aheadOf = (e, f, d) => stopFloors(e).some(g => (g - f) * d > 0);
// Vikt i hissen just nu: passagerare + de som håller på att kliva in
// Uppskattad vikt per väntande person (systemet kan inte väga folk innan de kliver på)
export const EST_KG = 75;
/** @param {Person} p */
export const personKg = p => p.kg + (p.cargo ? p.cargo.kg : 0);
/** @param {Elevator} e */
export function loadKg(e) {
  let kg = e.resKg || 0;
  for (const p of e.passengers) kg += personKg(p);
  return kg;
}
// Vikt som syns på vågen: bara de som redan står i korgen (inte de som är på väg in).
// Används av grafiken – lastreglerna använder loadKg.
/** @param {Elevator} e */
export function cabinKg(e) {
  let kg = 0;
  for (const p of e.passengers) kg += personKg(p);
  // (panoramahissen i lastläge: flyttlasset från terrassen väger också – vågen, energin och motorvärmen)
  if (e.mode === 'lift' && S.hoist && S.hoist.liftItem !== null && S.move) kg += S.move.items[S.hoist.liftItem].kg;
  return kg;
}
/** @param {Elevator} e */
export const slotsFull = e => e.passengers.length + e.reserved >= e.cap;
// "Full" = alla platser tagna eller full last (≥ 80 % av märklasten): hissen tar inga nya hämtningar
/** @param {Elevator} e */
export const isFull = e => slotsFull(e) || loadKg(e) >= e.ratedKg * FULL_LOAD;
/** Går hissen både till personens våning och till målet (för den här delresan)? */
// (en hiss i oberoende drift, som varuhissen på flyttdagen, tar bara flyttgubbarna – som annars får åka varuhissen som alla andra;
// ambulansen har förtur även där; i zonläge går andra hissar också, men brandmännen åker bara brandhissen)
/** @param {Person} p @param {Elevator} e */
export const canTake = (e, p) => e.legs.some(l => l.includes(p.floor) && l.includes(p.dest)) && elevatorAllows(e, p) && (!e.indep || !!(p.mover || p.medic || p.ff))
  // (ett delsystem spärrar – t.ex. hissarna på den lösa hundens våning, där bara de som jagar den kommer därifrån – systems.js)
  && !sysBlocks(e, p)
  && (!p.ff || e.ffCar || !S.elevators.some(x => x.ffCar && x.mode === 'normal')); // (brandmännen åker brandhissen när det finns en)
/** Dubbeldäck: korgens läge när den tar folk på våning f (övre däcket står en våning högre). Annars f. @param {Elevator} e */
export const posOf = (e, f) => (e.deck2 && e.upper.has(f) ? f - 1 : f);
/** vilket däck den som kliver på på våning f åker (0 = nedre, 1 = övre) @param {Elevator} e */
export const deckOf = (e, f) => (e.deck2 && e.upper.has(f) ? 1 : 0);
/** Får hissen stanna med korgen på g? (brandzonen – för dubbeldäck gäller det båda däcken) @param {Elevator} e */
export const allowedPos = (e, g) => (e.ffCar ? ffAllowed(g) : allowed(g)) && (!e.deck2 || allowed(g + 1));
/** Får hissen släppa av p vid målet? (dubbeldäck: i zonläge kan E vara tillåten men inte mellanplanet ovanför,
 *  och då stannar korgen inte där – målet måste läggas om) @param {Person} p @param {Elevator} e */
export const allowedDest = (e, p) => allowedPos(e, posOf(e, p.dest));
/** hissen tar inga nya resenärer: ur drift (spelaren), stängd för vinden eller överhettad motor @param {Elevator} e */
export const benched = e => !!(e.off || e.windLock || e.hot || sysOut(e));
// ---------- Tillgänglighet ----------
// Alla frågor om en hiss kan ta folk utgår från outReason. Undantagen är uttalade:
//   operational – styrningen: även strömmen och nattvilan (en sovande hiss väcks, den tilldelas inte)
//   servesNow   – ruttval, nattläge, strandade: kan p få hissen (VIP-lås, zon, last), ström och vila oräknat
//   outLong     – ruttvalet planerar bara runt längre avbrott; brandlägena sköter allowed() och trappan
/** Varför tar hissen inga nya resenärer? '' = den tar. Strömmen, nattvilan, VIP-låset och oberoende drift räknas inte här. @param {Elevator} e */
export function outReason(e) {
  if (e.mode !== 'normal') return e.mode;
  if (e.hot) return 'hot';
  if (e.windLock) return 'wind';
  const so = sysOut(e); // (delsystemen: kapad av rånarna, blött schakt … – systems.js)
  if (so) return so;
  if (e.off) return 'off';
  if (e.hold) return 'hold';
  if (e.liftWant) return 'liftwant';
  if (e.zoneLock) return 'zone';
  return '';
}
/** hur orsaken skrivs i loggen och i personernas dagbok ("Hiss L1 …") */
const OUT_TEXT = /** @type {Record<string, string>} */ ({
  hot: 'har överhettad motor', wind: 'stängs för vinden', off: 'är ur drift', hold: 'ska på service', zone: 'spärras av branden',
  broken: 'gick sönder', service: 'är på service', recall: 'kallas ner av brandlarmet', locked: 'är låst (brand)',
  rescue: 'nödsänks', dead: 'är strömlös', snapped: 'fick linbrott', lift: 'kör ett flyttlass', liftwant: 'ska köra ett flyttlass',
});
/** orsaken i text (även delsystemens: kapad, blött schakt … – systems.js); undefined = okänd @param {string} r */
export const outText = r => OUT_TEXT[r] ?? sysOutText()[r];
/** @param {Elevator} e */
export const operational = e => S.power && !outReason(e) && !e.sleep;
/** kan p få hissen just nu (bortsett från strömmen och nattvilan)? @param {Person} p @param {Elevator} e */
export const servesNow = (e, p) => !outReason(e) && !(e.vipLock && !prio(p)) && canTake(e, p);
/** hissen är borta en längre stund (fel, service, avstängd, vind, värme) – ruttvalet tar en annan väg @param {Elevator} e */
export const outLong = e => e.mode === 'broken' || e.mode === 'snapped' || e.mode === 'service' || e.hold || benched(e);
/** har egen nyckel/prioritet och använder aldrig hallknapparna (VIP-gruppen, ambulansen, flyttgubbarna) @param {Person} p */
export const keyed = p => !!(p.vip || p.medic || p.mover || p.ff || p.rescue);
/** får en hiss för sig själva (VIP-läge): VIP-gruppen, ambulanspersonalen och räddningstjänsten (panoramahissen på
 *  fasaden – annars står de i kö till varuhissen bakom flyttgubbarna) @param {Person} p */
export const prio = p => !!(p.vip || p.medic || p.rescue);
/** strategier som använder kostnadsfunktionen (Smart och dess varianter) */
export const costBased = (k = S.strategy) => k === 'smart' || k === 'peak' || k === 'eco';

// ---------- Rusningsläge (strategin Rusning) ----------
/** trafikmönstret: 'upp' (morgonrusning in i huset), 'ned' (hemgång), 'lunch' eller null */
export function trafficMode(h) {
  if (h >= 7 && h < 10.3) return 'upp';
  if (h >= 11.2 && h < 13.4) return 'lunch';
  if (h >= 15.8 && h < 18.6) return 'ned';
  return null;
}
export const PEAK_HOLD = 3.2;
// Huset har två ingångar på morgonen: entrén (jämnt flöde) och tunnelbanan (klumpar när tåget stannar).
// Rusning känner till tidtabellen: hissarna som går ner till perrongen väntar inte i entrén när ett tåg
// är på väg, en av dem möter tåget, och vid perrongen väntar hissen in alla som kliver av.
/** står ett tåg inne eller är det strax här? */
export const trainNear = () => STATION >= 0 && !S.trainDone && (S.train ? S.train.state !== 'out' : S.trainNext > 0 && S.trainNext - S.t < 4);
/** UPP-läge: en hiss som öppnar i sin hemvåning (entrén/sky lobbyn) väntar lite längre så att fler hinner med @param {Elevator} e */
export function peakHold(e, f) {
  if (S.strategy !== 'peak' || S.peakMode !== 'upp' || e.dir < 0 || e.freight) return 0;
  const room = e.passengers.length + e.reserved < e.cap / 2;
  // vid perrongen: vänta in hela klumpen medan folk fortfarande kliver av tåget
  if (f === STATION) return room && S.train && S.train.state === 'stop' && S.train.spawned < S.train.n ? PEAK_HOLD : 0;
  if (f !== e.home) return 0;
  // i entrén: en hiss som behövs vid perrongen står inte och väntar när tåget kommer
  if (e.stops.has(STATION) && trainNear()) return 0;
  return room ? PEAK_HOLD : 0;
}
/** UPP-läge: ska den här lediga hissen möta nästa tåg? (en åt gången, och bara när tåget snart är här) @param {Elevator} e */
function meetTrain(e) {
  // (panoramahissen möter inte tåget – den ska finnas i entrén för turisterna)
  if (STATION < 0 || S.trainDone || S.train || !e.stops.has(STATION) || e.freight || e.facade || !(S.trainNext - S.t < 8)) return false;
  return !S.elevators.some(o => o !== e && (o.parkTarget === STATION || (Math.round(o.pos) === STATION && o.state !== 'moving')));
}

// ---------- Energisparläget ----------
// Energin räknas i kWh och vägs mot väntetid: 1 kWh ≈ ECO_S_PER_KWH sekunders väntan.
export const ECO_S_PER_KWH = 400, ECO_START_S = 8;
/** Extra energi för att hiss e ska hämta p: tomkörning till p (med hissens last), om den inte redan är på väg förbi @param {Person} p @param {Elevator} e */
export function fetchKwh(e, p) {
  const stops = stopFloors(e);
  const f = posOf(e, p.floor), d = Math.sign(f - e.pos);
  if (!d) return 0;
  if (e.dir === d && stops.some(g => (g - f) * d >= 0)) return 0; // åker ändå dit
  return moveKwh(loadKg(e), e.ratedKg, f - e.pos);
}
/** energikostnaden i sekunder (bara för energisparläget) @param {Person} p @param {Elevator} e */
export function ecoCost(e, p) {
  const idle = !stopFloors(e).length && !e.passengers.length;
  return ECO_S_PER_KWH * fetchKwh(e, p) + (idle ? ECO_START_S : 0);
}
/** @param {Elevator} e */
export const pickersAt = (e, f, d) => S.people.filter(p => p.state === 'wait' && p.assigned === e.id && posOf(e, p.floor) === f && p.dir === d);
// Får hissarna köra till våning f? (påverkas av brandläget)
export function allowed(f) {
  if (!S.fire) return true;
  if (S.fire.mode === 'recall') return false;
  if (S.fire.mode === 'zone') return f <= S.fire.floor - 2;
  return true;
}
/** Högsta våning hissen går till som ligger utanför brandzonen (null om ingen – t.ex. höghissar vid brand lågt ner). @param {Elevator} e */
export function safeFloor(e) {
  let best = null;
  for (const f of e.stops) if (allowedPos(e, f) && (best === null || f > best)) best = f;
  return best;
}
/** brandkåren (brandmännen och brandhissen) får köra upp till två våningar under branden, även under återkallningen */
export const ffAllowed = f => !S.fire || f <= S.fire.floor - 2;
/** får personen åka hiss mellan våningarna just nu? @param {Person} p */
export const allowedFor = (p, f) => (p.ff ? ffAllowed(f) : allowed(f));
export const inFireZone = f => !!S.fire && f > LOBBY && f >= S.fire.floor - 1;

// ---------- Lärande parkering ----------
// Styrningen räknar hur många som ställer sig i kön per timme och våning. Vid dygnets slut vägs dagens
// siffror ihop med minnet (hälften var), och nästa dygn parkerar Smart och Rusning lediga hissar där det
// brukar bli kö den närmaste timmen. Energisnål parkerar bara UPPÅT dit (en tom hiss som kör upp återmatar
// el). De enkla lägena lär sig ingenting.
export const LEARN_BINS = 24;
export const learnBin = h => Math.max(0, Math.min(LEARN_BINS - 1, Math.floor(h - 6)));
export const emptyLearn = () => Array.from({ length: LEARN_BINS }, () => new Array(EL_FLOORS).fill(0));
const EL_FLOORS = Math.max(...EL.flatMap(d => d.serves)) + 1;
/** dagens anrop → minnet (anropas av resetDay innan ett nytt dygn börjar) */
export function learnBlend() {
  const t = S.learnToday;
  if (!t) return;
  const m = S.learnMem;
  S.learnMem = t.map((row, b) => row.map((v, f) => Math.round((m ? (m[b][f] + v) / 2 : v) * 10) / 10));
}
/** Var brukar det bli kö den närmaste timmen? Den våning (som hissen går till) med störst väntad efterfrågan
 *  och som ingen annan hiss i gruppen redan står vid eller kör till – eller null. @param {Elevator} e */
export function learnedFloor(e, h) {
  const m = S.learnMem;
  if (!m) return null;
  const b = learnBin(h), b2 = learnBin(h + 1);
  const covered = new Set(S.elevators.filter(o => o !== e && o.group === e.group && !o.passengers.length && !stopFloors(o).length)
    .map(o => (o.parkTarget !== null ? o.parkTarget : Math.round(o.pos))));
  let best = null, bv = 1.5;
  for (const f of e.stops) {
    if (covered.has(f) || !allowedPos(e, f)) continue;
    const v = m[b][f] + 0.5 * m[b2][f];
    if (v > bv) { bv = v; best = f; }
  }
  return best;
}

/** @param {Person} p */
export function requestRide(p) {
  pev(p, `Tänker: jag ska till ${fl(p.dest)} ${ARR(p.dir)}`);
  if (!keyed(p)) {
    if (!S.learnToday) S.learnToday = emptyLearn();
    S.learnToday[learnBin(hour())][p.floor]++;
  }
  if (buttonsMode() && !keyed(p)) { pressHallButton(p); return; }
  // ibland slår man in fel våning på terminalen och får börja om
  if (!keyed(p) && rng() < mistakeRate(0.04)) {
    p.retypeAt = S.t + rand(2, 4);
    S.stats.wrongPress++;
    pev(p, 'Slog in fel våning på terminalen – slår in igen');
    log(`🙈 ${pn(p)} slog in fel våning på ${fl(p.floor)} och börjar om`, 'button', null, p.id);
    return;
  }
  const open = S.elevators.find(e => operational(e) && canTake(e, p) && (prio(p) || !e.vipLock) && e.id !== p.avoid
    && e.state === 'doors' && e.floor === posOf(e, p.floor) && e.doorPhase !== 'closing'
    && (e.dir === p.dir || e.dir === 0) && !isFull(e));
  if (open && allowedFor(p, p.dest) && allowedDest(open, p)) {
    p.assigned = open.id;
    pev(p, `Hiss ${open.name} står redan öppen här och ska åt rätt håll – får den direkt`);
    log(`${pn(p)} ${fl(p.floor)}→${fl(p.dest)} · ${open.name} står redan här`, 'assign', open.color, p.id);
    rebuildPicks();
    return;
  }
  dispatchPerson(p);
}

// ---------- Kostnadsberäkning ----------
/** Styrningen antecknar när den tror att hissen är framme (jämförs med verkligheten när personen kliver på). @param {Person} p @param {Elevator} e */
function predict(p, e) { p.etaAt = S.t + eta(e, p.floor, p.dir); }
/** anropas när p kliver på: hur fel blev förutsägelsen? (positivt = hissen kom senare än väntat) @param {Person} p */
export function etaOutcome(p) {
  if (p.etaAt === undefined) return;
  const err = S.t - p.etaAt;
  S.stats.etaErr += err; S.stats.etaAbs += Math.abs(err); S.stats.etaN++;
  p.etaAt = undefined;
}
const travelV = (dist, v) => (dist <= 0.001 ? 0 : dist / v + (v / ACC) * 0.5);
export function travel(dist, v = VMAX) { return dist <= 0.001 ? 0 : dist / v + (v / ACC) * 0.5; }
/** Toppfarten som kostnadsstyrningen räknar med: den vet om svajläget och varma motorer – de enkla lägena gör det inte @param {Elevator} e */
export const etaV = e => (costBased() ? VMAX * windMul(e) * heatMul(e) : VMAX);
// Ett stopp tar längre tid ju fler som kliver på och av (uppmätt: ≈ 0,6 s per påstigande, 0,25 s per avstigande
// utöver dörrarna). Styrningen vet hur många den ska hämta (e.pick) och vart passagerarna ska.
export const BOARD_S = 0.6, ALIGHT_S = 0.25;
/** extra sekunder vid varje stopp (korgens läge) för dem som kliver på och av där @param {Elevator} e */
function stopLoad(e) {
  /** @type {Map<number, number>} */
  const m = new Map();
  for (const k in e.pick) { const g = parseInt(k, 10); m.set(g, (m.get(g) || 0) + e.pick[k] * BOARD_S); }
  for (const p of e.passengers) { const g = posOf(e, p.dest); m.set(g, (m.get(g) || 0) + ALIGHT_S); }
  return m;
}
/** @param {Elevator} e */
export function eta(e, f, d) {
  f = posOf(e, f); // (dubbeldäck: personens våning → korgens läge)
  const stops = stopFloors(e);
  const load = stopLoad(e), sc = (/** @type {number} */ g) => STOP_COST + (load.get(g) || 0);
  const pos = e.pos, v = etaV(e);
  const travel = dist => travelV(dist, v);
  let t = 0;
  if (e.state === 'doors') {
    if (e.floor === f && e.doorPhase !== 'closing' && (e.dir === d || e.dir === 0)) return 0;
    t += e.doorPhase === 'closing' ? e.door * DOOR_T
      : (e.doorPhase === 'opening' ? (1 - e.door) * DOOR_T : 0) + Math.max(0, e.dwellNeed - e.dwell) + e.reserved * BOARD_S + DOOR_T;
  }
  const dir = e.dir;
  if (dir === 0 || stops.length === 0) return t + travel(Math.abs(f - pos));
  const ahead = (f - pos) * dir > 0.01 || (Math.abs(f - pos) <= 0.01 && e.state !== 'moving');
  if (ahead && d === dir) {
    let s = 0;
    for (const g of stops) if ((g - pos) * dir > 0.01 && (f - g) * dir > 0.01) s += sc(g);
    return t + travel(Math.abs(f - pos)) + s;
  }
  let ext = pos;
  for (const g of stops) if ((g - ext) * dir > 0) ext = g;
  if (ahead && (f - ext) * dir > 0) ext = f;
  // (alla hissens stopp räknas, även de bortom f på tillbakavägen: att bara räkna stoppen på vägen gav en
  // träffsäkrare ETA men längre väntan – en hiss med många stopp är sämre än den ser ut, se npm run league)
  let s = 0;
  for (const g of stops) s += sc(g);
  return t + travel(Math.abs(ext - pos)) + travel(Math.abs(ext - f)) + s;
}
/** @param {Person} p @param {Elevator} e */
export function personCost(e, p) {
  const stops = stopFloors(e);
  let c = eta(e, p.floor, p.dir);
  const a = posOf(e, p.floor), b = posOf(e, p.dest), lo = Math.min(a, b), hi = Math.max(a, b);
  c += travel(hi - lo, etaV(e)) + stops.filter(g => g > lo && g < hi).length * STOP_COST * 0.7;
  if (!stops.includes(b)) c += STOP_COST * 0.6; // nytt stopp för hissen = dyrare
  const self = p.assigned === e.id;
  const committed = e.passengers.length + e.reserved + pickTotal(e) - (self ? 1 : 0);
  // Överbokning räknas både i platser och i kilo: varje person utöver kapaciteten kräver i snitt
  // en extra del av en tur. Ett proportionellt straff hindrar att en hiss får 20+ hämtningar.
  // uppmätt vikt i korgen + uppskattning för de som ska hämtas (inklusive den här personen)
  const kg = loadKg(e) + (e.pickKg || 0) - (self ? EST_KG : 0) + EST_KG;
  const over = Math.max(committed + 1 - e.cap, (kg - e.ratedKg * FULL_LOAD) / 80, 0);
  const extraTrip = (2 * TOP / VMAX + 4 * STOP_COST) / CAP;
  c += committed * 0.4 + over * extraTrip + (isFull(e) || (e.deck2 && e.deckFull && e.deckFull[deckOf(e, p.floor)]) ? 120 : 0);
  // upplevd trängsel: folk avstår från en hiss som känns full långt före vågen – Smart och Rusning räknar
  // med det (Rusning mindre: i rusningen tränger man ihop sig), Energisnål bryr sig mindre
  const crowd = Math.max(0, (committed + 1) * CAP / e.cap - 7);
  c += crowd * (S.strategy === 'eco' ? 1 : S.strategy === 'peak' && S.peakMode ? 1 : 2.5);
  // en varm motor kör långsammare och kan lösa ut – bättre att låta den svalna (Rusning tar risken längre)
  const hot = S.strategy === 'peak' ? 0.85 : 0.6;
  if (e.heat > hot) c += (e.heat - hot) * 90;
  if (S.strategy === 'eco') c += ecoCost(e, p);
  return c;
}
/** @param {Person} p */
export function costLine(p, chosenId) {
  return S.elevators.map(e => {
    if (!operational(e)) return `${e.name} –`;
    const c = personCost(e, p);
    const t = `${e.name} ${c > 99 ? 'FULL' : Math.round(c) + 's'}`;
    return e.id === chosenId ? `<u>${t} ✓</u>` : t;
  }).join(' · ');
}
/** @param {Person} p */
export function dispatchPerson(p) {
  if (!allowedFor(p, p.floor) || !allowedFor(p, p.dest)) {
    toStairs(p, S.fire && S.fire.mode === 'recall' ? 'Brandåterkallning – alla hissar avstängda, tar trapporna' : 'Hissarna kör inte hit pga branden – tar trapporna');
    return;
  }
  // (brandzon: en dubbeldäckare får inte ta någon till en våning där dess andra däck skulle stå i zonen)
  let cands = S.elevators.filter(e => operational(e) && !isFull(e) && canTake(e, p) && (prio(p) || !e.vipLock)
    && (!S.fire || (allowedPos(e, posOf(e, p.floor)) && allowedDest(e, p))));
  if (prio(p)) {
    // VIP: samma hiss som resten av gruppen, annars en tom hiss
    const mine = cands.filter(e => e.vipLock), empty = cands.filter(e => !e.passengers.length && !pickTotal(e));
    if (mine.length) cands = mine; else if (empty.length) cands = empty;
  }
  // den som just fick kliva av pga överlast slipper samma hiss om det finns andra
  if (p.avoid !== undefined && cands.some(e => e.id !== p.avoid)) cands = cands.filter(e => e.id !== p.avoid);
  if (!cands.length) {
    if (!p.noLiftNoted) { p.noLiftNoted = true; pev(p, liftsAvailable() ? 'Alla hissar är fulla – väntar på att någon får plats' : 'Inga hissar går just nu…'); }
    return;
  }
  p.noLiftNoted = false;
  let chosen, info, why;
  if (S.strategy === 'random') {
    chosen = pick(cands); info = 'slumpen avgör!'; why = 'slumpvis vald';
  } else if (S.strategy === 'nearest') {
    chosen = cands.reduce((a, b) => (Math.abs(b.pos - posOf(b, p.floor)) < Math.abs(a.pos - posOf(a, p.floor)) ? b : a));
    const dist = Math.abs(Math.round(chosen.pos - posOf(chosen, p.floor)));
    info = `närmast (${dist} vån bort)`; why = `närmast, ${dist} våningar bort`;
  } else {
    const costs = cands.map(e => ({ e, c: personCost(e, p) }));
    const best = costs.reduce((a, b) => (b.c < a.c ? b : a));
    chosen = best.e;
    info = costs.map(x => `${x.e.name}:${Math.round(x.c)}s`).join(' ');
    why = `billigast – hämtning + resa ≈ ${Math.round(best.c)}s` + (stopFloors(chosen).includes(p.dest) ? `, ska redan till ${fl(p.dest)}` : '');
  }
  p.assigned = chosen.id; chosen.parkTarget = null; predict(p, chosen);
  pev(p, `Systemet ger mig hiss ${chosen.name} (${why})`);
  log(`${pn(p)} ${fl(p.floor)}→${fl(p.dest)} · hiss ${chosen.name} · ${info}`, 'assign', chosen.color, p.id);
  rebuildPicks();
}
export function reoptimize() {
  for (const p of S.people) {
    if (p.state !== 'wait' || p.assigned === null) continue;
    const cur = S.elevators[p.assigned];
    if (cur.state === 'doors' && cur.floor === posOf(cur, p.floor)) continue;
    const cc = personCost(cur, p);
    if (cc < 6) continue;
    let best = null, bc = Infinity;
    for (const e of S.elevators) {
      if (e === cur || isFull(e) || !operational(e) || !canTake(e, p) || (e.vipLock && !prio(p))) continue;
      const x = personCost(e, p);
      if (x < bc) { bc = x; best = e; }
    }
    if (best && bc < cc * 0.6 && cc - bc > 6) {
      p.assigned = best.id; best.parkTarget = null; predict(p, best);
      pev(p, `Omfördelning! ${cur.name} → ${best.name} (${Math.round(cc)}s → ${Math.round(bc)}s)`);
      log(`↻ ${pn(p)} flyttas ${cur.name}→${best.name} (${Math.round(cc)}s → ${Math.round(bc)}s)`, 'reopt', best.color, p.id);
      rebuildPicks();
    }
  }
}
// Var hissarna parkerar när de är lediga (bara Smart). Varje hiss har egna parkeringsvåningar i BUILDING.
/** @param {Elevator} e */
export function parkFloor(e, h) {
  const p = /** @type {{ day?: string, lunch?: string, evening?: string }} */ (EL[e.id].park || {});
  const at = label => (label !== undefined ? idx(label) : e.home);
  if (S.strategy === 'peak') {
    const m = trafficMode(h);
    if (m === 'upp' && meetTrain(e)) return [STATION, 'UPP-läge – tåget kommer, möter det vid perrongen'];
    if (m === 'upp') return [e.home, 'UPP-läge – tillbaka till entrén direkt'];
    if (m === 'ned' && !e.freight) return [e.maxF, 'NED-läge – väntar högst upp i zonen'];
  }
  if (h >= 20 || h < 6.5) return [e.home, 'kväll/natt – vila hemma'];
  /** @type {[number, string]} */
  const plan = h < 10.3 ? [e.home, 'morgonrusning – vänta vid entrén']
    : h >= 11.2 && h < 13.4 ? [at(p.lunch), 'lunchrusning']
      : h >= 15.5 ? [at(p.evening), 'hemgång – vänta högt upp'] : [at(p.day), 'jämn fördelning över huset'];
  // det inlärda tar över bara när minnet tydligt säger att det brukar bli mer kö någon annanstans
  const lf = learnedFloor(e, h);
  if (lf !== null && lf !== plan[0] && demand(lf, h) >= 2 * demand(plan[0], h) + 2) return [lf, 'lärt sig: brukar bli kö här så här dags', true];
  return plan;
}
/** väntad efterfrågan på våning f den närmaste timmen enligt minnet */
function demand(f, h) {
  const m = S.learnMem;
  return m ? m[learnBin(h)][f] + 0.5 * m[learnBin(h + 1)][f] : 0;
}
/** @param {Elevator} e */
export function maybePark(e) {
  if (benched(e) || e.indep || e.medicHold || e.zoneLock || e.hold || e.sleep) return;
  // Energisnål: parkerar bara uppåt, dit det brukar bli kö – en tom hiss uppåt återmatar el
  if (S.strategy === 'eco') {
    if (e.idleTime < 3) return;
    e.idleTime = 0;
    const h = hour(), f = Math.round(e.pos), lf = h < 20 && h >= 6.5 ? learnedFloor(e, h) : null;
    if (lf !== null && lf > f) {
      e.parkTarget = lf; S.stats.learnedParks++;
      log(`🧠 ${e.name} parkerar uppåt på ${fl(lf)} (lärt sig att det brukar bli kö där – tom hiss uppåt återmatar el)`, 'park', e.color);
    }
    return;
  }
  if (S.strategy !== 'smart' && S.strategy !== 'peak') return;
  if (e.idleTime < (S.strategy === 'peak' && S.peakMode === 'upp' ? 0.5 : 3)) return;
  const [z, why, learned] = parkFloor(e, hour());
  const f = Math.round(e.pos);
  const target = allowedPos(e, z) && e.stops.has(z) ? z : e.home;
  if (target !== f) {
    e.parkTarget = target;
    if (learned) S.stats.learnedParks++;
    log(`${learned ? '🧠 ' : ''}${e.name} parkerar på ${fl(target)} (${why})`, 'park', e.color);
  }
  e.idleTime = 0;
}
