// Stadsturen: turistbussen med en guidad tur genom huset. Bussen stannar vid hållplatsen på gatan, guiden leder
// gruppen runt en fast rutt (takterrassen, Sky Café, tillbaka till bussen) och räknar in alla vid varje stopp innan
// gruppen går vidare. Bussen har en avgångstid: blir gruppen sen tutar den, och till slut går den utan dem som inte hann.
// Läget ligger i S.tour; turisterna är vanliga besökare med p.tour (guiden har dessutom p.guide).
//
// Översikt:
// Stadsturen: turistbussen som spelaren skickar (`act('bus')`, en i taget i `S.tour`). Bussen stannar vid
// hållplatsen på gatan och en guide (`p.guide`, med flagga) leder 14 turister (`p.tour`) runt en fast rutt –
// takterrassen (där gruppen står synligt, `tourSpot`) och Sky Café om de har öppet – och tillbaka till bussen. Varje
// stopp börjar först när alla är inräknade; eftersläntrare som inte kommit på `WAIT_S` lämnas (`lost`). Bussen har
// en avgångstid (`departH`): blir gruppen sen skyndar guiden på, bussen tutar och går efter `GRACE_S` utan dem som
// inte hann (`missed`). Turisterna tar aldrig trappan själva; i rummen bestämmer de inget (`tourNext`) – guiden
// flyttar gruppen. Egen slumpström `turistbuss`
import { stream } from './rng.js';
const { rand, pick, rng } = stream('turistbuss');
import { fl } from './util.js';
import { BX1, CAFE, END_H, DOOR_X, GROUND_Y, LOBBY, ROOF, activityRate, floorOpen, roomScale, timeScale } from './config.js';
import { S, clockStr, dayEvent, hour, log, notice } from './state.js';
import { makePerson, pev, releaseSpot, setTrip } from './people.js';
import { speak } from './cast.js';
/** @typedef {import('./people.js').Person} Person */

/** hur många turister bussen har med sig (utom guiden) */
export const TOUR_N = 14;
/** hur länge gruppen stannar vid varje stopp (rumsenheter, som p.timer i läget office) */
const STAY = { roof: 30, cafe: 40 };
/** ungefär hur lång tid en förflyttning tar för hela gruppen (verkliga sekunder): gå, vänta, åka, räkna in. Den första
 *  är längst – från entrén upp genom huset (oftast panoramahissen, som tar gruppen i två–tre vändor) */
const FIRST_LEG_S = 100, LEG_S = 55;
/** hur länge guiden väntar på eftersläntrare när minst halva gruppen är framme (verkliga sekunder) */
const WAIT_S = 150;
/** hur länge bussen väntar efter avgångstiden innan den går utan dem som inte hunnit (verkliga sekunder) */
const GRACE_S = 40;
/** bussens läge på gatan (världens x): hållplatsen, var den kommer ifrån och farten */
export const BUS_STOP_X = BX1 + 22, BUS_LEN = 132;
const BUS_FROM = BX1 + 520, BUS_V = 90;
export const BUS_NAME = 'Stadsturen';

/** klockslaget efter s verkliga sekunder från h (klockans takt byts under dygnet) */
function hAfter(h, s) { for (let i = 0; i < s; i++) h += timeScale(h) / 3600; return h; }
/** dagens rutt: takterrassen och Sky Café om de har öppet hela besöket, sist tillbaka till bussen i entrén */
function plan(h) {
  const stops = [];
  for (const f of [ROOF, CAFE]) {
    if (f < 0) continue;
    const k = stopKind(f);
    const end = hAfter(h, FIRST_LEG_S + LEG_S * (stops.length + 1)) + STAY[k] * roomScale(h) / 3600;
    if (floorOpen(f, h) && floorOpen(f, end)) stops.push(f);
  }
  return stops;
}
const stopKind = f => (f === ROOF ? 'roof' : f === CAFE ? 'cafe' : 'bus');
const WHY = { roof: 'Utsikten från takterrassen', cafe: 'Fika i Sky Café', bus: 'Tillbaka till bussen' };
/** stoppens namn i guidens och loggens text */
const PLACE = { roof: 'takterrassen', cafe: 'Sky Café', bus: 'bussen' };
const place = f => PLACE[stopKind(f)];
const route = T => T.stops.slice(0, -1).map(place).join(' och ');
const why = f => `${BUS_NAME}: ${WHY[stopKind(f)]}`;
/** beräknad avgång: alla stopp och förflyttningar, avrundat uppåt till nästa kvart */
function departure(h, stops) {
  for (const [i, f] of stops.entries()) { h = hAfter(h, i ? LEG_S : FIRST_LEG_S); h += STAY[stopKind(f)] * roomScale(h) / 3600; }
  h = hAfter(h, LEG_S);
  return Math.ceil(h * 4) / 4;
}

/** första kvarten från h då bussen har något att visa (samma regel som spawnBus), null = inte mer i dag. Drar inga slumptal. */
export function busFrom(h = hour()) {
  for (let q = h; q < END_H; q = Math.floor(q * 4 + 1) / 4) if (plan(q).length) return q;
  return null;
}
/**
 * Stadsturen (S.tour): bussen, rutten (stops, si = stoppet just nu), gruppen (members, guide) och avgången.
 * @typedef {{ ph: string, x: number, stops: number[], si: number, members: number[], guide: number, n0: number,
 *   stay: number, waitT: number, graceT: number, departH: number, honkT: number, honked: boolean, hurried: boolean,
 *   lost: string[], missed: string[], aboard: number, t0: number, arriveH: number, backH: number }} Tour
 */
/** Spelaren skickar en turistbuss. Returnerar antalet som kommer (0 = inget att se just nu, −1 = en buss står redan här). */
export function spawnBus() {
  if (S.tour) return -1;
  if (S.fire) return 0;
  const h = hour(), stops = plan(h);
  if (!stops.length) return 0;
  stops.push(LOBBY);
  S.tour = { ph: 'in', x: BUS_FROM, stops, si: -1, members: [], guide: -1, n0: 0,
    stay: 0, waitT: 0, graceT: 0, departH: departure(h, stops.slice(0, -1)), honkT: 0, honked: false, hurried: false,
    lost: [], missed: [], aboard: 0, t0: S.t, arriveH: h, backH: 0 };
  log(`🚌 ${BUS_NAME} svänger in mot hållplatsen – en guidad tur med ${TOUR_N} turister`, 'sys');
  return TOUR_N + 1;
}
/** gruppen kliver av bussen och går in i entrén, guiden först */
function arrive(T) {
  const g = makePerson('vis', LOBBY, -30);
  g.guide = true; g.tour = true; g.polite = true; g.space = 9; g.title = `Guide på ${BUS_NAME}`;
  g.look.shirt = '#ff8c42'; g.look.tie = false; // (orange väst, som flaggan)
  // (var och en kommer in i huset direkt, så att nästa får ett namn som ingen annan bär)
  const all = [g];
  S.people.push(g);
  for (let i = 0; i < TOUR_N; i++) {
    const p = makePerson('vis', LOBBY, -54 - i * 22);
    S.people.push(p);
    p.tour = true; p.space = 9; // turistgruppen tränger ihop sig – ingen vill bli lämnad kvar
    if (rng() < 0.3) p.cargo = { kind: 'ryggsäck', name: 'ryggsäck', kg: 8 };
    all.push(p);
  }
  for (const p of all) {
    setTrip(p, T.stops[0], why(T.stops[0]));
    pev(p, p.guide ? `Kliver av bussen med flaggan i högsta hugg · guidar ${TOUR_N} turister` : `Kliver av turistbussen · ${p.why}`);
  }
  T.members = all.map(p => p.id); T.guide = g.id; T.n0 = all.length; T.si = 0; T.ph = 'go';
  speak(g, `Välkomna till Tornet! Följ flaggan – först ${place(T.stops[0])}!`);
  notice('bus', `🚌 ${BUS_NAME}`, `${TOUR_N} turister och guiden ${g.name} ska se ${route(T)}. Bussen går ${clockStr(T.departH)}.`, { floor: LOBBY });
  log(`🚌 ${BUS_NAME} står vid hållplatsen: guiden ${g.name} och ${TOUR_N} turister ska se ${route(T)} – bussen går ${clockStr(T.departH)}`, 'sys');
}
/** gruppens medlemmar som fortfarande är med (inte tappade, inte ute ur huset) */
function crew(T) {
  const by = new Map(S.people.map(p => [p.id, p]));
  return T.members.map(id => by.get(id)).filter(p => p && !p.dead && p.tour);
}
const guideOf = (T, live) => live.find(p => p.id === T.guide && p.guide) || null;
/** @param {Person} p */
const there = (p, f) => p.floor === f && p.state === 'office' && !p.evac;
/** alla är framme: guiden räknar in dem och stoppet börjar */
function gathered(T, live) {
  const f = T.stops[T.si], g = guideOf(T, live);
  T.ph = 'at'; T.waitT = 0;
  T.stay = STAY[stopKind(f)];
  if (g) speak(g, f === ROOF ? pick([`…${live.length - 1}, ${live.length}! Alla här. Där borta ser ni hela stan!`, `${live.length}! Ingen kvar i hissen? Titta, där är tunnelbanebron!`])
    : pick([`${live.length}, alla här! Tjugo minuter fika – sedan samlas vi vid hissarna.`, `…och ${live.length}! Kanelbullarna här är kända i hela stan.`]));
  log(`🚩 ${BUS_NAME}: alla ${live.length} framme på ${place(f)} (${fl(f)})`, 'person', null, T.guide);
}
/** vidare till nästa stopp – eller direkt till bussen om det är bråttom */
function moveOn(T, live, rush) {
  const from = T.stops[T.si];
  T.si = rush ? T.stops.length - 1 : T.si + 1;
  const to = T.stops[T.si], last = to === LOBBY, g = guideOf(T, live);
  for (const p of live) {
    if (p.floor !== from || p.state !== 'office') continue;
    p.x = p.spot ? p.spot.x : p.x;
    releaseSpot(p);
    setTrip(p, to, why(to), last);
  }
  if (g) speak(g, rush ? 'Nu får vi skynda oss – bussen går snart!' : last ? 'Dags att gå tillbaka till bussen, följ flaggan!' : `Följ flaggan – nu ${place(to)}!`);
  T.ph = last ? 'back' : 'go';
  if (last) T.backH = hour();
}
/** eftersläntrarna som guiden inte kan vänta på längre: de får hitta ut själva */
function leaveBehind(T, live) {
  const f = T.stops[T.si], g = guideOf(T, live), left = live.filter(p => !there(p, f));
  for (const p of left) {
    p.tour = false; T.lost.push(p.name);
    pev(p, `Tappade bort ${BUS_NAME} – får klara sig själv`);
  }
  if (g && left.length) speak(g, left.length > 1 ? `Vi kan inte vänta längre – ${left.map(p => p.name).join(' och ')} får hitta bussen själva.` : `Vi kan inte vänta längre – ${left[0].name} får hitta bussen själv.`);
  log(`🚩 ${BUS_NAME} går vidare utan ${left.length} som inte kom fram till ${place(f)}`, 'person', null, T.guide);
  return live.filter(p => p.tour);
}
/** bussen tutar: de som är på väg ut springer sista biten */
function honk(T, live) {
  S.fx.push({ x: BUS_STOP_X + 20, y: GROUND_Y - 44, text: 'TUUT!', color: '#ffd23f', life: 1.4, size: 18 });
  if (!T.honked) {
    T.honked = true;
    log(`🚌 ${BUS_NAME} tutar – det är avgång och ${live.length} är inte ombord än`, 'sys');
  }
  for (const p of live) if (!p.hurry) { p.hurry = true; p.speedMul *= 1.6; pev(p, 'Bussen tutar – springer!'); }
}
/** bussen går: med alla, eller utan dem som inte hann */
function depart(T, live) {
  for (const p of live) {
    p.tour = false; T.missed.push(p.name);
    pev(p, `Missade bussen – ${BUS_NAME} gick utan hen`);
  }
  T.ph = 'out';
  const late = Math.round((hour() - T.departH) * 60), on = T.aboard;
  const when = late > 2 ? `${late} min sent` : 'i tid';
  const miss = T.missed.length ? ` – ${T.missed.length} missade bussen` : '';
  const lost = T.lost.length ? `, ${T.lost.length} tappades bort på vägen` : '';
  log(`🚌 ${BUS_NAME} går ${when} med ${on} av ${T.n0} ombord${miss}`, 'sys');
  dayEvent('bus', `🚌 ${BUS_NAME}`, `${T.n0 - 1} turister och guiden såg ${route(T)}. Bussen gick ${when} med ${on} av ${T.n0} ombord${miss}${lost}.`);
}

/** varje steg (sim.js) */
export function tourTick(dt) {
  const T = S.tour;
  if (!T) return;
  if (T.ph === 'in') {
    T.x = Math.max(BUS_STOP_X, T.x - BUS_V * dt * Math.min(1, (T.x - BUS_STOP_X) / 60 + 0.25));
    if (T.x <= BUS_STOP_X + 0.5) { if (S.fire) return; arrive(T); }
    return;
  }
  if (T.ph === 'out') { T.x -= BUS_V * dt; if (T.x < BX1 - BUS_LEN - 20) S.tour = null; return; }
  // (kuppen: gruppen är gisslan i Sky Café som alla andra – turen står still tills det är över, heist.js)
  if (S.heist && S.heist.ph !== 'done') return;
  let live = crew(T);
  // de som hunnit gå ut ur huset på väg till bussen är ombord
  if (T.ph === 'back') T.aboard = T.n0 - T.lost.length - live.length;
  const h = hour(), late = h >= T.departH;
  if (T.ph === 'back' && !live.length) { depart(T, live); return; }
  if (late && !S.fire && (T.ph === 'back' || T.ph === 'at')) {
    T.honkT -= dt;
    if (T.honkT <= 0) { T.honkT = rand(3, 5); honk(T, T.ph === 'back' ? live : []); }
  }
  if (T.ph === 'back') {
    if (late && !S.fire) T.graceT += dt;
    if (T.graceT > GRACE_S) depart(T, live);
    return;
  }
  const f = T.stops[T.si];
  if (T.ph === 'go') {
    const n = live.filter(p => there(p, f)).length;
    if (live.length && n === live.length) { gathered(T, live); return; }
    // minst halva gruppen är framme: guiden väntar en stund på resten (inte under brand eller strömavbrott)
    if (n * 2 >= live.length && S.power && !S.fire) T.waitT += dt;
    if (T.waitT > WAIT_S) { live = leaveBehind(T, live); if (live.length) gathered(T, live); else T.ph = 'back'; }
    return;
  }
  // T.ph === 'at': gruppen är vid ett stopp
  if (S.fire) return;
  T.stay -= dt * activityRate(h);
  // hinner gruppen inte till bussen om den stannar kvar: direkt dit
  const rush = hAfter(h, LEG_S) >= T.departH;
  if (rush && !T.hurried) { T.hurried = true; moveOn(T, live, true); return; }
  if (T.stay <= 0) moveOn(T, live, false);
}
/** På takterrassen står gruppen ute i det fria och syns: guiden närmast korridoren med flaggan, turisterna runt
 *  guiden och tittar på utsikten. Annars (Sky Café) väljer man plats som vanligt (null). @param {Person} p */
export function tourSpot(p, f) {
  if (f !== ROOF || !S.tour) return null;
  if (p.guide) return { x: DOOR_X + 18, k: 'stand', face: 1, desc: `Berättar om utsikten för ${BUS_NAME}`, temp: true, win: 'hall' };
  return { x: DOOR_X + rand(36, 290), k: 'stand', face: rng() < 0.6 ? -1 : 1, desc: pick(['Tittar på utsikten', 'Fotograferar stan', 'Lyssnar på guiden', 'Pekar ut tunnelbanebron']), temp: true, win: 'hall' };
}
/** vad en turist bestämmer sig för i ett rum (decideNext i people.js): guiden sköter gruppen, man stannar tills hen säger till @param {Person} p */
export function tourNext(p) {
  if (p.tour && S.tour) return null;
  return [p.exitFloor, p.guide ? 'Turen är slut – går hem' : `Har tappat bort ${BUS_NAME} – går ut på egen hand`];
}
export function tourReset() { S.tour = null; }
