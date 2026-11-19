// Panoramahissen fastnar utanför huset. Hydraulventilen låser sig och korgen hänger fast mellan två våningar på
// fasaden. Den går varken att köra eller veva ner – de instängda måste ut utanpå huset:
//  - rep: räddningstjänsten åker upp på taket, riggar ett rep ovanför korgen och firar ner en i taget längs fasaden
//    (till takterrassen om korgen hänger ovanför den, annars ner till gatan). Repet stannar i hård vind.
//  - stegbil: stegen reses från gatan upp till korgen och de klättrar ner en i taget. Fungerar i blåst men når
//    bara de nedre våningarna.
// Driftchefen väljer (chief.js), spelaren kan ta över (act('panoRescue', …)), och har ingen valt när räddarna är
// på plats väljer räddningsledaren själv. När alla är ute lagar hissteknikern hydrauliken.
// (Simulering: läget ligger i S.pano – grafiken i pixcars.js läser bara.)
import { stream } from './rng.js';
const { rand, rng } = stream('panorama');
import { CAR_H, CAR_W, EL, FLOOR_H, GROUND_Y, INNER_X1, LOBBY, ROOF, SEAM_F, TERRACE_F, floorY, shaftCX } from './config.js';
import { S, incidentOver, log } from './state.js';
import { makePerson, pev, pn, rerouteStranded, setTrip } from './people.js';
import { inFireZone, rebuildPicks } from './dispatch.js';
import { bounceBoarders, exitOne, setMode } from './elevators.js';
import { incidentStarted } from './incidents.js';
import { nextOut } from './service.js';
import { windAt } from './weather.js';
import { WIND_STOP, TERRACE_Y } from './hoist.js';
import { say } from './cast.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

/** panoramahissen (på fasaden), om huset har någon */
export const PANO = EL.find(d => d.facade) || null;
/** räddningstjänsten är på plats så här länge efter att korgen fastnade (s) */
export const PANO_CREW_S = 14;
/** har ingen valt metod så här länge efter att räddarna kom väljer räddningsledaren själv (s) */
export const PANO_DEFAULT_S = 18;
export const RIG_T = 6, RAISE_T = 8;
/** repet hänger så här långt till vänster om korgens mitt: mellan fasaden och glasröret */
export const ROPE_DX = -(CAR_W / 2 + 10);
const ROPE_V = 95, RETURN_T = 3, CLIMB_PER_FLOOR = 1.6;
/** så många våningar över entrén når stegbilen */
export const LADDER_MAX = 5;

/** kan panoramahissen fastna nu (den kör med folk i)? @param {Elevator} e */
export const panoCandidate = e => !!e && e.facade && e.mode === 'normal' && !e.hold && !e.indep && !e.panoNext;
/** korgen är mitt emellan två våningar (som i service.js) – och ovanför gatan: under jord, där röret går ner till
 *  tunnelbanan, når varken repet eller stegbilen fram, så där fastnar den inte @param {Elevator} e */
const midFloor = e => { const fr = e.pos - Math.floor(e.pos); return fr > 0.35 && fr < 0.75 && e.pos > Math.max(e.minF, LOBBY) + 0.6; };
/** ska korgen fastna just nu? @param {Elevator} e */
export const panoDue = e => !!e.panoNext && e.mode === 'normal' && e.state === 'moving' && midFloor(e) && e.passengers.length > 0;
/** Spelaren (eller slumpen) framkallar det: panoramahissen fastnar nästa gång den kör med folk mellan två våningar */
export function triggerPano() {
  const e = PANO ? S.elevators[PANO.id] : null;
  if (!panoCandidate(e) || S.pano) return false;
  e.panoNext = true;
  log(`🔩 ${e.name} hackar på fasaden – det luktar hydraulolja…`, 'alert', e.color);
  return true;
}
/** når stegbilen korgen? @param {Elevator} e */
export const ladderReach = e => e.pos <= LOBBY + LADDER_MAX;
/** blåser det för mycket för att fira ner någon i rep? */
export const ropeWindy = () => windAt() > WIND_STOP;
/** vad räddningstjänsten väljer själv: rep när det är lugnt, annars stegbilen om den når – annars rep när vinden mojnar @param {Elevator} e */
export function autoHow(e) { return !ropeWindy() || !ladderReach(e) ? 'rope' : 'ladder'; }

/**
 * Räddningen av de instängda i panoramahissen (S.pano). ph: stuck → rig → lower → done; how: 'rope'|'ladder';
 * rider = den som är på väg ner just nu.
 * @typedef {{ car: number, t0: number, ph: string, how: string|null, by: string, setup: string, crew: boolean, crewAt: number,
 *   n: number, out: number, t: number, next: number, t1: number, toF: number, noted: string,
 *   rider: { id: number, t0: number, dur: number, y0: number, y1: number, how: string }|null }} Pano
 */
/** Korgen tvärstannar på fasaden: de instängda väntar på räddningstjänsten. @param {Elevator} e */
export function panoStick(e) {
  e.panoNext = false; e.breakNext = false; e.trapNext = false;
  bounceBoarders(e);
  setMode(e, 'broken'); e.hold = false; e.parkTarget = null; e.target = null; e.targetKind = null; e.v = 0; e.dir = 0; e.state = 'idle';
  e.floor = Math.round(e.pos); e.carCalls.clear();
  e.fault = { what: 'hydraulventilen har låst sig – korgen hänger fast på fasaden', kind: 'hydraul', tool: 'Byter hydraulventilen', t0: S.t,
    need: rand(20, 30), trapped: true, pano: true, n: e.passengers.length, nextTalk: S.t + rand(2, 4) };
  const high = TERRACE_F >= 0 && e.pos >= SEAM_F;
  S.pano = { car: e.id, t0: S.t, ph: 'stuck', how: null, by: '', setup: '', crew: false, crewAt: S.t + PANO_CREW_S,
    n: e.passengers.length, out: 0, t: 0, next: 0, t1: 0, toF: high ? TERRACE_F : LOBBY, noted: '',
    rider: null };
  S.stats.faults++; S.stats.panoStuck++;
  for (const p of e.passengers) pev(p, `Hiss ${e.name} tvärstannade utanpå huset – vi hänger på fasaden! (hydrauliken)`);
  log(`🛗 ${e.name} sitter fast på fasaden mellan två våningar – ${e.passengers.length} instängda, räddningstjänsten larmas`, 'alert', e.color);
  S.fx.push({ x: shaftCX(e.id), y: floorY(e.pos) - CAR_H - 30, text: 'KLONK!', color: '#ff9f1c', life: 1.6 });
  rerouteStranded();
  rebuildPicks();
  incidentStarted(null);
}
const PANO_TEXT = { rope: 'Firas ner med rep från taket', ladder: 'Stegbilen från gatan' };
/** Välj hur de instängda ska ut (by = 'chief', 'player' eller 'crew'). Returnerar false om det inte går. */
export function setPanoHow(how, by) {
  const P = S.pano;
  if (!P || P.ph === 'done' || !PANO_TEXT[how]) return false;
  const e = S.elevators[P.car];
  if (how === 'ladder' && !ladderReach(e)) return false;
  if (P.how === how) return true;
  P.how = how; P.by = by;
  if (by === 'crew') log(`🚒 Räddningsledaren bestämmer: ${PANO_TEXT[how].toLowerCase()}`, 'alert', e.color);
  // räddarna går dit metoden kräver
  for (const p of S.people) if (p.rescue && p.state === 'office') p.timer = 0;
  return true;
}
export const panoText = how => PANO_TEXT[how] || '';

// ---------- Varje steg ----------
export function panoTick() {
  const P = S.pano;
  if (!P) return;
  const e = S.elevators[P.car];
  if (P.ph === 'done') {
    if (!S.people.some(p => p.rescue && !p.dead)) { S.pano = null; log('🚒 Räddningsbilen åker iväg', 'alert'); }
    return;
  }
  // räddningstjänsten kommer (och kommer tillbaka om räddarna fick gå, t.ex. vid brand)
  if (S.t >= P.crewAt && !S.fire && !S.people.some(p => p.rescue && !p.dead)) {
    if (P.crew) log('🚒 Räddningstjänsten är tillbaka vid panoramahissen', 'alert', e.color);
    else log(`🚒 Räddningstjänsten är på plats vid ${e.name}`, 'alert', e.color);
    P.crew = true;
    for (let i = 0; i < 2; i++) spawnRescuer(i);
  }
  if (!P.how && P.crew && S.t >= P.crewAt + PANO_DEFAULT_S) setPanoHow(autoHow(e), 'crew');
  if (!P.how) return;
  // metoden byttes: den som är på väg ner kommer ner först, sedan riggas det nya
  if (P.setup && P.setup !== P.how && !P.rider) { P.setup = ''; P.ph = 'stuck'; }
  if (P.how === 'ladder' && !ladderReach(e)) { P.how = 'rope'; return; }
  const crewAt = f => S.people.some(p => p.rescue && !p.dead && p.state === 'office' && p.floor === f);
  if (P.ph === 'stuck') {
    if (P.how === 'rope' ? !crewAt(ROOF) : !crewAt(LOBBY)) return;
    P.ph = 'rig'; P.t = S.t + (P.how === 'rope' ? RIG_T : RAISE_T); P.setup = P.how;
    log(P.how === 'rope' ? `🧗 Räddarna riggar ett rep på taket ovanför ${e.name}` : `🚒 Stegbilen reser stegen upp mot ${e.name}`, 'alert', e.color);
    for (const p of e.passengers) pev(p, P.how === 'rope' ? 'Räddningstjänsten är på taket ovanför oss!' : 'Stegbilen kommer – de reser stegen mot oss!');
    return;
  }
  if (P.ph === 'rig') { if (S.t >= P.t) { P.ph = 'lower'; P.next = S.t; } return; }
  // ---- en i taget ner ----
  if (P.rider) {
    const r = P.rider, p = S.people.find(q => q.id === r.id);
    if (!p || S.t < r.t0 + r.dur) return;
    land(P, e, p);
    P.rider = null; P.next = S.t + (P.setup === 'rope' ? RETURN_T : 1);
    return;
  }
  if (S.t < P.next) return;
  if (P.setup === 'rope' && ropeWindy()) {
    if (P.noted !== 'wind') { P.noted = 'wind'; log(`🌬️ För blåsigt för repet – räddarna väntar ut vinden på taket`, 'alert', e.color); }
    return;
  }
  P.noted = '';
  const p = nextOut(e);
  if (!p) { finish(P, e); return; }
  // ner: med repet till terrassen eller gatan, eller nerför stegen till gatan
  const toF = P.setup === 'rope' ? P.toF : LOBBY, y0 = floorY(e.pos), y1 = toF === LOBBY ? GROUND_Y : TERRACE_Y;
  const dur = P.setup === 'rope' ? 1 + Math.abs(y1 - y0) / ROPE_V : 2 + (Math.abs(y1 - y0) / FLOOR_H) * CLIMB_PER_FLOOR;
  e.passengers = e.passengers.filter(q => q !== p);
  p.state = 'rope'; p.ropeF = toF;
  P.rider = { id: p.id, t0: S.t, dur, y0, y1, how: P.setup };
  pev(p, P.setup === 'rope' ? `Selen på – firas ner längs fasaden till ${toF === LOBBY ? 'gatan' : 'takterrassen'}` : 'Klättrar ut på stegen och ner mot gatan');
  if (p.cast) say(p, 'rope');
}
/** framme på terrassen eller gatan: vidare dit hen skulle @param {Person} p @param {Elevator} e */
function land(P, e, p) {
  const f = p.ropeF ?? LOBBY;
  p.ropeF = undefined;
  P.out++;
  exitOne(e, p, f, P.setup === 'rope' ? 'Nedfirad från panoramahissen' : 'Nedklättrad från panoramahissen');
  // (från gatan in genom entrén, från terrassen in genom panoramahissens lastdörr)
  p.x = f === LOBBY ? -30 : INNER_X1 - 8;
  pev(p, `${P.setup === 'rope' ? 'Firad ner' : 'Nere på gatan'} efter ${Math.round(S.t - P.t0)} s på fasaden – ${rng() < 0.5 ? 'benen skakar' : 'aldrig mer panoramahiss'}`);
  log(`🧗 ${pn(p)} är nere ${f === LOBBY ? 'på gatan' : 'på takterrassen'} (${P.out}/${P.n})`, 'alert', e.color, p.id);
}
/** @param {Elevator} e */
function finish(P, e) {
  P.ph = 'done'; P.t1 = S.t;
  e.fault.trapped = false; // (nu kan teknikern laga hydrauliken)
  for (const p of S.people) if (p.rescue && p.state === 'office') p.timer = Math.min(p.timer, 1);
  const how = P.setup === 'rope' ? `räddningstjänsten firade ner ${P.n === 1 ? 'hen' : 'dem en i taget'} med rep från taket` : `${P.n === 1 ? 'hen' : 'de'} klättrade ner för stegbilens stege`;
  log(`✅ Alla ute ur ${e.name} – ${P.out} räddade på ${Math.round(S.t - P.t0)} s`, 'alert', e.color);
  incidentOver('pano', `✅ Alla är ute ur ${e.name}`,
    `${P.n} satt fast på fasaden i ${Math.round(S.t - P.t0)} s – ${how}. Hissteknikern byter hydraulventilen innan ${e.name} går igen.`, { car: e.id });
}

// ---------- Räddarna ----------
const RESCUE_LOOK = { shirt: '#c81e3a', pants: '#2b2f45', tie: false, acc: 0, hair: 1, hairC: '#ffd23f', stripe: true };
function spawnRescuer(i) {
  const p = makePerson('staff', LOBBY, -30 - i * 18);
  p.role = 'räddare'; p.rescue = true; p.fit = 1; p.exitFloor = LOBBY;
  Object.assign(p.look, RESCUE_LOOK);
  p.nearX = INNER_X1 - 22 - i * 16;
  p.task = 'Räddningstjänsten: tar ut de instängda ur panoramahissen';
  const first = rescueNext(p) || [LOBBY, 'Räddningstjänsten: vid panoramahissen', false];
  setTrip(p, first[0], first[1], false);
  S.people.push(p);
  pev(p, `Kliver ur räddningsbilen med rep och sele · ${p.why}`);
  log(`🚒 ${pn(p)} (räddningstjänsten) går in`, 'person', null, p.id);
}
/** räddarens nästa beslut (rollogiken i people.js): taket för repet, gatan (entrén) för stegbilen, hem när det är klart @param {Person} p */
export function rescueNext(p) {
  const P = S.pano;
  if (!P || P.ph === 'done') return [p.exitFloor, 'Alla är ute – tillbaka till räddningsbilen'];
  const want = P.how === 'rope' ? ROOF : LOBBY;
  if (inFireZone(want)) return null;
  if (p.floor === want) return null;
  return [want, P.how === 'rope' ? 'Räddningstjänsten: upp på taket med repet' : 'Räddningstjänsten: ut till stegbilen', false];
}

// ---------- Var den som är på väg ner syns (grafiken och träffytorna) ----------
/** x (figurens mitt) och y (huvudets överkant) i världen för den som firas ner eller klättrar, eller null @param {Person} p */
export function riderPos(p) {
  const P = S.pano;
  if (!P || !P.rider || P.rider.id !== p.id) return null;
  const r = P.rider, k = Math.min(1, Math.max(0, (S.t - r.t0) / r.dur)), cx = shaftCX(P.car);
  const y = r.y0 + (r.y1 - r.y0) * k - 50;
  if (r.how === 'ladder') return { x: cx - 30 * k, y };
  // repet hänger mellan fasaden och korgen – till terrassen svänger hen in sista biten
  const toTerr = r.y1 !== GROUND_Y, swing = toTerr ? Math.max(0, (k - 0.6) / 0.4) : 0;
  return { x: cx + ROPE_DX - swing * 30, y };
}
