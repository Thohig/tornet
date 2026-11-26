// Fönsterputsaren fastnar: gondolens vinsch kärvar mitt på tornets fasad med Hasse ombord (S.gondola).
// Gondolen går varken upp eller ner, och stegbilen når inte så högt. Tre sätt att få ner honom:
//   crank – vaktmästaren går upp på taket och vevar upp gondolen för hand (säkert men långsamt, går i blåst)
//   hatch – hänger gondolen vid en bostad med lastlucka (12–14) öppnar vaktmästaren luckan och Hasse kliver in
//           (snabbt, men inte i blåst)
//   rope  – räddningstjänsten firar ner honom från taket till takterrassen (stannar i hård vind, som i pano.js)
// Driftchefen väljer (chief.js), spelaren via act('gondola', how), annars ringer Hasse själv vaktmästaren.
// Så länge gondolen sitter fast är takskenan upptagen: hissbalken kan inte köra (flyttdagen väntar). När Hasse
// är nere går han av passet för dagen (p.offDuty, crew.js) och gondolen vevas upp tom.
// (Simulering: läget ligger i S.gondola, grafiken i pixroof.js läser bara. Egen slumpström.)
//
// Översikt:
// fönsterputsaren fastnar (`S.gondola`, incident i slumpen och `act('trigger', 'gondola')`, bara när Hasse är ute
// och putsar – `gondolaCandidate`): vinschen kärvar och gondolen hänger kvar (`hoistTick` flyttar den inte,
// takskenan är upptagen så hissbalken står). Driftchefen väljer (`gondolaChiefTick` i chief.js), spelaren via
// `act('gondola', 'crank'|'hatch'|'rope')`, annars ringer Hasse själv vaktmästaren efter `GONDOLA_DEFAULT_S`:
// `crank` = vaktmästaren vevar upp den för hand från taket, `hatch` = vaktmästaren öppnar lastluckan på 12–14
// bredvid gondolen (inte i blåst), `rope` = räddningstjänsten (`p.gondola`, rollen `räddare`, `gondolaCrewNext`)
// firar ner honom till takterrassen (`ropeY`, stannar i blåst). Hasse går sedan av passet (`p.offDuty` →
// personalrummet) och gondolen vevas upp tom. Egen slumpström `gondolen`
import { stream } from './rng.js';
const { rand } = stream('gondolen');
import { fl } from './util.js';
import { FL, floorY, FLOORS, HATCH_FLOORS, INNER_X1, LOBBY, ROOF, TERRACE_F } from './config.js';
import { S, incidentOver, log } from './state.js';
import { HAS_TOWER, PARK_Y, TERRACE_Y, WIND_STOP, hatchY } from './hoist.js';
import { windAt } from './weather.js';
import { callJanitor, dutyDone, moveDuty, onDuty } from './crew.js';
import { makePerson, pev, pn, releaseSpot, setTrip } from './people.js';
import { inFireZone } from './dispatch.js';
import { incidentStarted } from './incidents.js';
/** @typedef {import('./people.js').Person} Person */

/**
 * Gondolen sitter fast (S.gondola). ph: stuck (väntar på hjälp) → done (Hasse är nere); how = hur han tas ner,
 * by = vem som valde; hatchF = bostaden med lastlucka bredvid gondolen (-1 = ingen); jan = vaktmästaren (id);
 * crewAt = när räddningstjänsten är på plats; t = nedräkning (luckan, riggen); ropeY = där Hasse hänger i repet.
 * @typedef {{ t0: number, ph: string, how: string, by: string, y0: number, f: number, hatchF: number, jan: number,
 *   crew: boolean, crewAt: number, rigged: boolean, t: number, ropeY: number|null, noted: string, t1: number, how0: string }} Gondola
 */
/** vevas upp (världsenheter per sekund – en våning på ungefär tolv sekunder) */
export const CRANK_V = 9;
/** firas ner med repet */
export const ROPE_V = 26;
/** luckan öppnas och Hasse kliver in (s) */
export const HATCH_T = 6;
/** räddarna riggar repet på taket (s) */
export const RIG_T = 6;
/** räddningstjänsten är på plats efter (s) */
export const GONDOLA_CREW_S = 14;
/** utan beslut ringer Hasse själv vaktmästaren efter (s) */
export const GONDOLA_DEFAULT_S = 16;
/** så nära en lastlucka (världsenheter) måste gondolen hänga för att Hasse ska kunna kliva in */
const HATCH_NEAR = 60;
const HOW_TEXT = { crank: 'Vaktmästaren vevar upp gondolen', hatch: 'In genom lastluckan', rope: 'Räddningstjänsten firar ner honom' };
export const gondolaText = how => HOW_TEXT[how] || '';

/** fönsterputsaren (Hasse) om han är i huset */
export const cleanerPerson = () => S.people.find(p => p.role === 'fönsterputsare' && p.crewId && !p.dead) || null;
/** sitter gondolen fast (med Hasse kvar i den)? */
export const gondolaStuck = () => !!S.gondola && S.gondola.ph === 'stuck';
/** kan vinschen kärva just nu: Hasse är ute och putsar (inte parkerad) och strömmen är på */
export const gondolaCandidate = () => HAS_TOWER && !S.gondola && !!S.cleaner && S.cleaner.crew && !S.cleaner.parked && S.power && !S.fire;
/** våningen som gondolen hänger utanför */
const floorAt = y => { let f = 0; for (let i = 0; i < FLOORS; i++) if (floorY(i) >= y) f = i; return f; };
/** lastluckan bredvid gondolen, eller -1 */
const hatchNear = y => HATCH_FLOORS.find(f => Math.abs(hatchY(f) - y) <= HATCH_NEAR) ?? -1;
/** för blåsigt för luckan och repet */
export const gondolaWindy = () => windAt() > WIND_STOP;

/** Spelaren eller slumpen: vinschen kärvar och gondolen fastnar där den hänger. Returnerar false om det inte går. */
export function triggerGondola() {
  if (!gondolaCandidate()) return false;
  const C = S.cleaner, y = C.y, f = floorAt(y);
  S.gondola = { t0: S.t, ph: 'stuck', how: '', by: '', y0: y, f, hatchF: hatchNear(y), jan: -1, crew: false, crewAt: 0, rigged: false,
    t: 0, ropeY: null, noted: '', t1: 0, how0: '' };
  C.scrub = false;
  const h = cleanerPerson();
  if (h) pev(h, 'Vinschen kärvar – gondolen sitter fast mitt på fasaden!');
  log(`🪟 Gondolens vinsch kärvar – ${h ? h.name : 'fönsterputsaren'} sitter fast utanför våning ${fl(f)}`, 'alert');
  S.fx.push({ x: INNER_X1 + 60, y: y - 40, text: 'KNARRK!', color: '#ff9f1c', life: 1.6 });
  incidentStarted(f);
  return true;
}
/** Välj hur Hasse ska ner (by = 'chief', 'player' eller 'hasse'). Returnerar false om det inte går. */
export function setGondolaHow(how, by) {
  const G = S.gondola;
  if (!G || G.ph !== 'stuck' || !HOW_TEXT[how]) return false;
  if (how === 'hatch' && G.hatchF < 0) return false;
  if (G.how === how) return true;
  const was = G.how;
  G.how = how; G.by = by; G.t = 0; G.noted = '';
  if (!G.how0) G.how0 = how;
  const jan = S.people.find(p => p.id === G.jan && !p.dead) || null;
  if (how === 'rope') {
    // vaktmästaren behövs inte längre – räddningstjänsten tar över
    dutyDone(jan); G.jan = -1;
    if (!G.crew && !G.crewAt) G.crewAt = S.t + GONDOLA_CREW_S;
  } else if (jan && was !== 'rope') moveDuty(jan, dutyFloor(G), dutyWhy(G), dutyDesc(G));
  if (by === 'hasse') log(`🪟 Ingen säger något – Hasse ringer själv vaktmästaren: ${HOW_TEXT[how].toLowerCase()}`, 'alert');
  return true;
}
const dutyFloor = G => (G.how === 'hatch' ? G.hatchF : ROOF);
const dutyWhy = G => (G.how === 'hatch' ? `Till ${fl(G.hatchF)} – öppnar lastluckan åt fönsterputsaren` : 'Upp på taket – vevar upp gondolen för hand');
const dutyDesc = G => (G.how === 'hatch' ? 'Öppnar lastluckan och sträcker ut en hand åt Hasse' : 'Vevar upp gondolen för hand – en våning i taget');

// ---------- Varje steg ----------
export function gondolaTick(dt) {
  const G = S.gondola;
  if (!G) return;
  if (G.ph === 'done') {
    if (!S.people.some(p => p.gondola && !p.dead)) S.gondola = null;
    return;
  }
  const C = S.cleaner, h = cleanerPerson();
  // Hasse gick hem eller försvann (dygnsskiftet): gondolen vevas upp tom
  if (!h) { finish(G, null, ''); return; }
  if (!G.how && S.t - G.t0 >= GONDOLA_DEFAULT_S) setGondolaHow(G.hatchF >= 0 && !gondolaWindy() ? 'hatch' : 'crank', 'hasse');
  if (!G.how) return;
  if (G.how === 'rope') { ropeTick(G, C, h, dt); return; }
  // vaktmästaren: ringas in om ingen har uppdraget
  let jan = S.people.find(p => p.id === G.jan && !p.dead) || null;
  if (!jan || !jan.duty || jan.duty.kind !== 'gondola') {
    jan = callJanitor('gondola', dutyFloor(G), dutyWhy(G), dutyDesc(G));
    G.jan = jan.id;
  }
  if (!onDuty(jan, 'gondola')) return;
  if (G.how === 'crank') {
    // för hand: upp en bit i taget (strömmen behövs inte)
    C.y = Math.max(PARK_Y, C.y - CRANK_V * dt);
    if (C.y <= PARK_Y + 1e-6) { C.y = PARK_Y; finish(G, h, 'crank'); }
    return;
  }
  // luckan: öppnas och Hasse kliver in – men inte i blåsten
  if (gondolaWindy()) {
    if (G.noted !== 'wind') { G.noted = 'wind'; log('🌬️ För blåsigt för att öppna lastluckan – vaktmästaren väntar', 'alert'); }
    return;
  }
  G.noted = '';
  G.t += dt;
  if (G.t >= HATCH_T) finish(G, h, 'hatch');
}
/** @param {Gondola} G @param {Person} h */
function ropeTick(G, C, h, dt) {
  // räddningstjänsten kommer (och kommer tillbaka om de fick gå, t.ex. vid brand)
  if (!S.people.some(p => p.gondola && !p.dead) && S.t >= G.crewAt && !S.fire) {
    log(G.crew ? '🚒 Räddningstjänsten är tillbaka för fönsterputsaren' : '🚒 Räddningstjänsten är på plats – de ska fira ner fönsterputsaren från taket', 'alert');
    G.crew = true;
    for (let i = 0; i < 2; i++) spawnRescuer(i);
  }
  const onRoof = S.people.some(p => p.gondola && !p.dead && p.state === 'office' && p.floor === ROOF);
  if (!G.rigged) {
    if (!onRoof) return;
    G.t += dt;
    if (G.t < RIG_T) return;
    G.rigged = true;
    log('🧗 Repet är riggat på taket – Hasse får selen på sig', 'alert');
    pev(h, 'Selen på – nu firas jag ner till takterrassen');
  }
  if (gondolaWindy()) {
    if (G.noted !== 'wind') { G.noted = 'wind'; log('🌬️ För blåsigt för repet – räddarna väntar ut vinden på taket', 'alert'); }
    return;
  }
  G.noted = '';
  G.ropeY = Math.min(TERRACE_Y, (G.ropeY ?? C.y) + ROPE_V * dt);
  if (G.ropeY >= TERRACE_Y) finish(G, h, 'rope');
}
/** Hasse är nere: på taket, inne genom luckan eller på takterrassen. Han går av passet för dagen. */
function finish(G, h, how) {
  const to = how === 'hatch' ? G.hatchF : how === 'rope' ? TERRACE_F : ROOF;
  G.ph = 'done'; G.t1 = S.t; G.ropeY = null;
  const jan = S.people.find(p => p.id === G.jan && !p.dead) || null;
  dutyDone(jan);
  for (const p of S.people) if (p.gondola && p.state === 'office') p.timer = Math.min(p.timer, 1);
  if (!h) { log('🪟 Gondolen vevas upp tom', 'alert'); return; }
  // Hasse kliver ur gondolen där han är och går till personalrummet (crew.js: offDuty)
  releaseSpot(h);
  h.floor = to; h.offDuty = true; h.state = 'office'; h.x = INNER_X1 - 30; h.timer = 1;
  h.spot = { x: INNER_X1 - 30, k: 'stand', face: -1, temp: true, win: 'hall', desc: 'Står på fast mark igen – benen skakar' };
  const sec = Math.round(G.t1 - G.t0), who = jan ? jan.name : 'vaktmästaren';
  const line = how === 'crank' ? `${who} vevade upp gondolen till taket för hand`
    : how === 'hatch' ? `${who} öppnade lastluckan på ${fl(to)} och Hasse klev in`
    : 'räddningstjänsten firade ner honom med rep till takterrassen';
  pev(h, `Nere efter ${sec} s – jag tar inte gondolen mer i dag`);
  log(`✅ Fönsterputsaren är nere – ${line}`, 'alert', null, h.id);
  incidentOver('gondola', '✅ Fönsterputsaren är nere',
    `${h.name} hängde fast utanför våning ${fl(G.f)} i ${sec} s – ${line}. Han putsar inget mer i dag, och gondolen vevas upp tom.`
    + (S.move && S.move.state === 'on' && S.move.hoist ? ' Hissbalken fick vänta på takskenan under tiden.' : ''), { floor: to });
}

// ---------- Räddarna ----------
const RESCUE_LOOK = { shirt: '#c81e3a', pants: '#2b2f45', tie: false, acc: 0, hair: 1, hairC: '#ffd23f', stripe: true };
function spawnRescuer(i) {
  const p = makePerson('staff', LOBBY, -30 - i * 18 - rand(0, 6));
  p.role = 'räddare'; p.gondola = true; p.fit = 1; p.exitFloor = LOBBY;
  Object.assign(p.look, RESCUE_LOOK);
  p.nearX = INNER_X1 - 22 - i * 16;
  p.task = 'Räddningstjänsten: firar ner fönsterputsaren från taket';
  const first = gondolaCrewNext(p) || [ROOF, 'Räddningstjänsten: upp på taket med repet', false];
  setTrip(p, first[0], first[1], false);
  S.people.push(p);
  pev(p, `Kliver ur räddningsbilen med rep och sele · ${p.why}`);
  log(`🚒 ${pn(p)} (räddningstjänsten) går in`, 'person', null, p.id);
}
/** räddarens nästa beslut (rollogiken i people.js): upp på taket, hem när Hasse är nere @param {Person} p */
export function gondolaCrewNext(p) {
  const G = S.gondola;
  if (!G || G.ph === 'done' || G.how !== 'rope') return [p.exitFloor, 'Fönsterputsaren är nere – tillbaka till räddningsbilen'];
  if (inFireZone(ROOF) || p.floor === ROOF) return null;
  return [ROOF, 'Räddningstjänsten: upp på taket med repet', false];
}
/** dygnet börjar om (resetDay) */
export function gondolaReset() { S.gondola = null; }
/** våningens namn för korten */
export const gondolaPlace = G => `${fl(G.f)} · ${FL[G.f].short}`;
