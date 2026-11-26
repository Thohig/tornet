// Kuppen på 5:an: ett rånargäng tar över tornet för att tömma valvet i Guldbanken. En skåpbil från "Fasad &
// Fönster AB" backar in vid lastkajen; ledaren tar driftcentralen och kapar hissarna (alla utom varuhissen, som
// gänget själva åker), två borrar i valvet, en vaktar gisslan i Sky Café och en sitter kvar i bilen. Den som
// var på fel ställe – guiden på rundvisning, en boende som var hemma, en tekniker – blir över och smyger runt i
// trapporna: slår av strömmen till borren och signalerar till polisen från taket. Polisens insatsledare
// bestämmer (chief.js): klippa strömmen eller vänta, storma via garaget eller taket, stoppa tunnelbanan eller
// inte. Klipps strömmen släpper valvets magnetlås – precis vad rånarna vill. Ingen skjuter och ingen dör.
// Läget i S.heist; gänget är personer med rollen rånare. Egen slumpström: vilken flyktväg gänget väljer.
//
// Översikt:
// Kuppen på 5:an (`S.heist`, incident i slumpen och `act('trigger', 'heist')`): skåpbilen från ”Fasad & Fönster AB”
// vid lastkajen (framkallad när lastkajen är upptagen kör den runt kvarteret tills den är ledig – `orderHeist`,
// `S.heistWait`, `heistBlock`), gänget (`p.robber`, rollen `rånare`, bara varuhissen) tar driftcentralen och kapar
// hissarna (`e.hijack`, `outReason` 'hijack'), gisslan (`p.hostage`) samlas i Sky Café, de som kommer under tiden
// vänds i dörren, den som blev över (`p.hero` – Berit på rundvisning, en boende, en tekniker …) smyger i trapporna
// och slår av borren och signalerar från taket. Polisens insatsledare bestämmer (`heistChiefTick` i chief.js,
// `act('heist', cut/wait/garage/tak/stop/go/storm)`): klipps strömmen släpper valvets magnetlås. Gänget flyr den väg
// som inte är spärrad (skåpbilen, helikopter på taket, tunnelbanan – egen slumpström `kuppen`) eller grips. Ingen
// skjuter, ingen dör
import { stream } from './rng.js';
import { sv } from './sv.js';
const { pick } = stream('kuppen');
import { CAFE, CONTROL, DOCK, DOOR_X, LOBBY, ROOF, STATION, TOP, floorWith, floorY } from './config.js';
import { S, incidentOver, log, notice } from './state.js';
import { blankPerson, pev, pn, releaseSpot, setTrip, toStairs } from './people.js';
import { speak } from './cast.js';
import { crewPerson } from './crew.js';
import { startOutage, incidentStarted } from './incidents.js';
import { trainsRunning } from './train.js';
import { touring } from './visning.js';
import { inFireZone } from './dispatch.js';
import { fl } from './util.js';
/** @typedef {import('./people.js').Person} Person */

/** våningen med valvet */
export const BANK = floorWith('bank');
/** elcentralen där hjälten slår av strömmen till borren: våningen under banken */
const ELEC = BANK - 1 > LOBBY ? BANK - 1 : BANK + 1;
/** guldtackor i valvet */
export const GOLD = 412;
/** verkliga sekunder: tills polisen är på plats, tills insatsstyrkan går in (efter polisen), borrens tid genom valvet,
 *  hur länge hjältens elavbrott håller borren tyst, hur mycket tidigare polisen går in efter signalen, och längst
 *  tid för hela kuppen och för flykten */
const POLICE_S = 30, STORM_S = 190, DRILL_S = 270, DRILL_PAUSE = 75, SIGNAL_S = 55, HEIST_MAX = 720, FLEE_MAX = 240;
/** hur länge hjälten jobbar på ett ställe (verkliga sekunder) */
const HERO_WORK = 10;
/** trappsteg per våning (sammanfattningen räknar hjältens steg) */
const STEPS = 18;
/** gänget: namn, uppgift och utseende (overaller från "Fasad & Fönster AB") */
const GANG = [
  { name: 'Ronny', job: 'ledare', task: 'Håller driftcentralen – "ingen rör hissarna!"', shirt: '#5b6b3a' },
  { name: 'Roger', job: 'borr', task: 'Borrar i valvet', shirt: '#5b6b3a' },
  { name: 'Tompa', job: 'borr', task: 'Håller i borren och svettas', shirt: '#5b6b3a' },
  { name: 'Benke', job: 'vakt', task: 'Vaktar gisslan i Sky Café', shirt: '#5b6b3a' },
  { name: 'Jojje', job: 'bil', task: 'Sitter i skåpbilen med motorn igång', shirt: '#5b6b3a' },
];
export const VAN_NAME = 'Fasad & Fönster AB';
/** flyktvägarna: våning och namn */
const ROUTES = { van: { f: DOCK, name: 'skåpbilen vid lastkajen' }, heli: { f: ROOF >= 0 ? ROOF : TOP, name: 'en helikopter på taket' }, train: { f: STATION, name: 'tunnelbanan' } };

/**
 * Kuppen (S.heist). ph: in (skåpbilen backar in, gänget tar sina platser) → hold (huset är kapat, borren går)
 * → flee (valvet är öppet, gänget på väg till flyktvägen) → done (gripna eller borta; väntar tills gänget har gått).
 * @typedef {{ ph: string, t0: number, van: string, vanX: number, gang: number[], hero: number, heroWho: string, heroStep: number,
 *   heroT: number, steps: number, holdT: number, police: boolean, policeAt: number, plan: string, train: string, power: string,
 *   drill: number, drillOff: number, gold: number, route: string, fleeF: number, fleeT: number, stormAt: number, signal: boolean,
 *   outcome: string, caught: boolean, hostages: number, idFrom: number, talkT: number, talkN: number, tied: boolean }} Heist
 */

const H = () => S.heist;
/** pågår kuppen (gänget är i huset och hissarna kapade)? */
export const heistOn = () => !!S.heist && S.heist.ph !== 'done';
const byId = id => S.people.find(p => p.id === id && !p.dead) || null;
const gang = () => S.people.filter(p => p.robber && !p.dead);
const robber = job => gang().find(p => p.task && GANG.find(g => g.job === job && g.name === p.name)) || null;
/** @param {Person} p */
const there = (p, f) => p.floor === f && p.state === 'office';

/** kan kuppen börja just nu? (lastkajen ledig, ingen brand, ström) */
export function heistPossible() {
  return BANK >= 0 && DOCK >= 0 && CAFE >= 0 && CONTROL >= 0 && !S.heist && !S.fire && S.power && !S.truck && !(S.move && S.move.state === 'on');
}

/** vad gänget väntar på när kuppen är framkallad men inte kan börja ('' = den kan börja) – hela bisatser */
export function heistBlock() {
  if (S.fire) return 'tills branden är släckt';
  if (!S.power) return 'tills strömmen är tillbaka';
  if (S.truck) return 'tills leveransbilen har kört från lastkajen';
  if (S.move && S.move.state === 'on') return 'tills flyttbilen har kört från lastkajen';
  return '';
}
/** Spelaren framkallar kuppen: börjar direkt, eller väntar gänget runt hörnet tills lastkajen är ledig (S.heistWait) */
export function orderHeist() {
  if (S.heist || S.heistWait !== null) return false;
  if (startHeist()) return true;
  if (!heistBlock()) return false;
  S.heistWait = S.t;
  log(sv`🚐 En skåpbil från ${VAN_NAME} kör runt kvarteret – gänget väntar ${heistBlock()}`, 'alert');
  return true;
}

/** Kuppen börjar: skåpbilen backar in vid lastkajen. Returnerar false om den inte kan börja nu. */
/** @param {boolean} [warned] förvarningen har redan visat bilen vid kajen */
export function startHeist(warned = false) {
  if (!heistPossible()) return false;
  S.heistWait = null;
  S.heist = { ph: 'in', t0: S.t, van: 'in', vanX: warned ? 70 : -260, gang: [], hero: -1, heroWho: '', heroStep: 0, heroT: 0, steps: 0,
    holdT: 0, police: false, policeAt: 0, plan: 'garage', train: 'go', power: 'wait', drill: 0, drillOff: 0, gold: GOLD,
    route: '', fleeF: -1, fleeT: 0, stormAt: 0, signal: false, outcome: '', caught: false, hostages: 0, idFrom: S.nextId,
    talkT: 0, talkN: 0, tied: false };
  log(sv`🚐 En skåpbil från ${VAN_NAME} backar in vid lastkajen – fem män i overall kliver ur`, 'alert');
  incidentStarted(DOCK);
  return true;
}

// ---------- Gänget ----------
function spawnGang() {
  const Hs = /** @type {Heist} */ (H());
  GANG.forEach((g, i) => {
    const p = blankPerson('staff', DOCK, 150 + i * 16, { name: g.name, kg: 88, fit: 0.6, speedMul: 1.05, walkPhase: i * 1.7, depth: -2 - i,
      patience: 10, space: 9, polite: false,
      look: { skin: ['#f6c48f', '#ffdbb8', '#d9a066', '#e0ac7a', '#ffe4c8'][i], shirt: g.shirt, pants: g.shirt, hair: 0, hairC: '#1b1033', tie: false, tieC: '#ffe14d', stripe: true, acc: 4 } });
    p.role = 'rånare'; p.robber = true; p.exitFloor = DOCK; p.task = g.task; p.title = sv`Rånare (${g.job === 'ledare' ? 'ledaren' : g.job === 'borr' ? 'borrar' : g.job === 'vakt' ? 'vaktar gisslan' : 'chaufför'})`;
    if (g.job === 'borr') p.cargo = { kind: 'verktygslåda', name: 'borrmaskin', kg: 14 };
    S.people.push(p);
    Hs.gang.push(p.id);
    setTrip(p, postOf(g.job), g.task, false);
    pev(p, sv`Kliver ur skåpbilen vid lastkajen · ${g.task}`);
  });
  const L = robber('ledare');
  if (L) speak(L, 'Okej grabbar – precis som vi övade. Varuhissen!');
}
/** var i huset rånaren ska vara (under kuppen) */
function postOf(job) {
  return job === 'ledare' ? CONTROL : job === 'borr' ? BANK : job === 'vakt' ? CAFE : DOCK;
}
const jobOf = p => (GANG.find(g => g.name === p.name) || GANG[0]).job;
/** vad en rånare bestämmer i ett rum (roleNext i people.js): heistTick flyttar gänget, här står man kvar
 * @param {Person} p @returns {[number, string, boolean]|null} */
export function robberNext(p) {
  const Hs = H();
  if (!Hs || Hs.ph === 'done') return p.caught ? [LOBBY, 'Gripen – leds ut till polisbilen', true] : [p.exitFloor, 'Härifrån – fort!', true];
  return null;
}
/** var gänget står: synligt i hallen (ledaren vid kontrollbordet, borrarna vid valvet, vakten vid caféets dörr) @param {Person} p */
export function heistSpot(p, f) {
  const j = jobOf(p), i = GANG.findIndex(g => g.name === p.name);
  const x = DOOR_X + (j === 'borr' && f === BANK ? 22 + i * 22 : j === 'ledare' && f === CONTROL ? 70 : j === 'vakt' && f === CAFE ? 30 : j === 'bil' && f === DOCK ? 120 : 40 + i * 18);
  const desc = p.caught ? 'Gripen – väntar på polisen' : f === postOf(j) ? (GANG[i] || GANG[0]).task : 'Smyger med bytet';
  return { x, k: 'stand', face: j === 'borr' ? -1 : 1, desc, temp: true, win: 'hall' };
}

// ---------- Huset tas över ----------
/** hissarna kapas: alla utom varuhissen (gänget kör den själva) */
function hijack(on) {
  for (const e of S.elevators) if (!e.freight) e.hijack = on;
}
/** alla som jobbar eller är på besök samlas i Sky Café (inte de boende – de låser in sig – och inte personalen) @param {Person} p */
const eligible = p => !p.dead && (p.kind === 'emp' || p.kind === 'vis') && !p.role && !p.vip && !p.guest && !p.touring && !p.robber && !p.hero
  && !p.leaving && !['away', 'incar', 'platform', 'assembly'].includes(p.state);
function roundUp() {
  const Hs = /** @type {Heist} */ (H());
  for (const p of S.people) {
    if (!eligible(p) || p.hostage) continue;
    p.hostage = true; Hs.hostages++;
    if (p.state === 'office') p.timer = Math.min(p.timer, 0.3 + (p.id % 9) * 0.2);
    pev(p, 'RÅN! Rånarna samlar alla i Sky Café');
  }
}
/** vad gisslan gör (decideNext i people.js): till Sky Café och stanna där; undefined = som vanligt @param {Person} p */
export function hostageNext(p) {
  if (!heistOn()) { p.hostage = false; return undefined; }
  if (p.floor === CAFE) return null;
  return [CAFE, 'Rånarna samlar alla i Sky Café', false];
}
/** de som kommer till huset under kuppen: blir gisslan, eller vänds i dörren när polisen har spärrat av */
function newcomers() {
  const Hs = /** @type {Heist} */ (H());
  for (const p of S.people) {
    if (p.id < Hs.idFrom || p.hostage || !eligible(p) || p.trips > 0) continue;
    if (!Hs.police) { p.hostage = true; Hs.hostages++; pev(p, 'RÅN! Rånarna samlar alla i Sky Café'); continue; }
    if (p.state !== 'toQueue' && p.state !== 'wait') continue;
    setTrip(p, p.exitFloor, 'Polisen har spärrat av huset – vänder', true);
    pev(p, 'Polisen har spärrat av – kommer tillbaka en annan dag');
  }
}

// ---------- Hjälten: den som rånarna missade ----------
function pickHero() {
  const v = S.visning;
  if (touring() && v) { const b = byId(v.host); if (b) return b; }
  const res = S.people.find(p => p.kind === 'res' && p.state === 'office' && p.floor === p.home && !p.sleeping && !p.dead);
  if (res) return res;
  const other = S.people.find(p => p.role === 'hisstekniker' && (p.job === null || p.job === undefined) && p.state === 'office' && !p.dead)
    || S.people.find(p => p.role === 'väktare' && p.state === 'office' && !p.dead);
  if (other) return other;
  // annars den som satt högst upp i huset när det hände (på toaletten, i ett möte som drog ut på tiden …)
  const far = S.people.filter(p => eligible(p) && p.state === 'office' && p.floor !== CAFE && p.floor !== BANK && p.floor !== CONTROL)
    .sort((a, b) => b.floor - a.floor || a.id - b.id);
  return far[0] || null;
}
/** hjälten (och gästen, på rundvisningen) går dit – bara trapporna, hissarna är kapade @param {Person} p */
function heroGo(p, f, why) {
  const Hs = /** @type {Heist} */ (H());
  if (inFireZone(f)) return; // (ingen går in dit det brinner – hjälten väntar)
  const mates = [p];
  const v = S.visning;
  if (v && p.id === v.host) { const g = byId(v.guest); if (g) mates.push(g); }
  for (const q of mates) {
    if (q.state !== 'office' || q.floor === f) continue;
    Hs.steps += q === p ? Math.abs(f - q.floor) * STEPS : 0;
    q.x = q.spot ? q.spot.x : q.x;
    releaseSpot(q);
    setTrip(q, f, why, false);
    if (/** @type {string} */ (q.state) === 'toQueue') toStairs(q, why);
  }
}
/** Guiden berättar för gästen (rundvisningen läser upp det) */
function tell(text) {
  const v = S.visning, Hs = H();
  if (!v || !Hs || Hs.hero !== v.host) return;
  v.line = text; v.lineN++; v.lineK = 'heist';
}
function heroTick() {
  const Hs = /** @type {Heist} */ (H());
  const p = byId(Hs.hero);
  if (!p) return;
  const winded = Hs.steps > 300 ? ' (flåsar)' : '';
  if (Hs.heroStep === 1) {
    heroGo(p, ELEC, 'Smyger i trappan till elcentralen');
    if (there(p, ELEC)) { Hs.heroStep = 2; Hs.heroT = S.t + HERO_WORK; speak(p, sv`Puh${winded}… här är elcentralen. Vilken säkring är borren?`); }
  } else if (Hs.heroStep === 2 && S.t >= Hs.heroT) {
    Hs.drillOff = S.t + DRILL_PAUSE; Hs.heroStep = 3;
    speak(p, 'Säkring 5B – borta! Nu får de vänta.');
    tell(sv`Säkring 5B – där! Nu tystnar borren på ${fl(BANK)}:an en stund. Nästa: upp på taket, så polisen ser oss.`);
    log(sv`🔌 ${pn(p)} slår av strömmen till borren i elcentralen på ${fl(ELEC)} – borren tystnar`, 'alert', null, p.id);
  } else if (Hs.heroStep === 3) {
    const top = ROOF >= 0 ? ROOF : TOP;
    heroGo(p, top, 'Smyger upp till taket – ska signalera till polisen');
    if (there(p, top)) { Hs.heroStep = 4; Hs.heroT = S.t + HERO_WORK; speak(p, sv`${Hs.steps} trappsteg${winded}… Ficklampan – kort, kort, kort, lång!`); }
  } else if (Hs.heroStep === 4 && S.t >= Hs.heroT) {
    Hs.heroStep = 5; Hs.signal = true;
    if (Hs.police) Hs.stormAt = Math.max(S.t + 15, Hs.stormAt - SIGNAL_S);
    speak(p, 'De blinkar tillbaka! De har sett oss!');
    tell('De blinkar tillbaka från gatan – polisen vet var rånarna är. Nu väntar vi här uppe, där ingen letar.');
    log(sv`🔦 ${pn(p)} signalerar med ficklampan från taket – insatsstyrkan vet var gänget är`, 'alert', null, p.id);
  }
}

// ---------- Förloppet ----------
function hold() {
  const Hs = /** @type {Heist} */ (H());
  Hs.ph = 'hold'; Hs.holdT = S.t; Hs.tied = true;
  hijack(true);
  const h = pickHero();
  if (h) h.hero = true;
  roundUp();
  const L = robber('ledare');
  if (L) speak(L, 'Ingen rör sig – och ingen rör hissarna!');
  log('🚐 RÅN! Gänget har tagit driftcentralen – hissarna är kapade, alla samlas i Sky Café', 'alert');
  notice('heist', '🚐 Rån i Tornet', sv`Ett gäng från ${VAN_NAME} har tagit driftcentralen och kapat hissarna. Alla som jobbar och är på besök samlas som gisslan i Sky Café; de boende låser in sig. Två av dem borrar i valvet på ${fl(BANK)}:an.`, { floor: BANK });
  if (h) {
    Hs.hero = h.id; Hs.heroWho = h.name; Hs.heroStep = 1;
    const v = S.visning;
    if (v && h.id === v.host) {
      tell('Psst – rånare! De har tagit driftcentralen och kapat hissarna. Men mig har de missat, och dig. Följ med – jag kan trapporna i det här huset utan och innan.');
      const k = crewPerson('kicki');
      if (k) speak(k, sv`${h.name}?! Det är rånare här! … Ja, jag sitter under disken.`);
    } else speak(h, 'Vad var det där? … Rånare?! Inte i mitt hus.');
    log(sv`🤫 ${pn(h)} blev över – rånarna missade hen`, 'alert', null, h.id);
  }
}
function flee() {
  const Hs = /** @type {Heist} */ (H());
  Hs.ph = 'flee'; Hs.fleeT = S.t;
  const open = Object.keys(ROUTES).filter(k => !blocked(k) && ROUTES[k].f >= 0);
  if (!open.length) { caught('Valvet var öppet, men alla vägar ut var spärrade – gänget gav upp.'); return; }
  Hs.route = open.length === 1 ? open[0] : pick(open);
  Hs.fleeF = ROUTES[Hs.route].f;
  Hs.gold = 0;
  const L = robber('ledare');
  if (L) speak(L, sv`Valvet är öppet! Ta guldet – vi drar med ${ROUTES[Hs.route].name}!`);
  log(sv`💰 Valvet är öppet! Gänget tar ${GOLD} guldtackor och flyr mot ${ROUTES[Hs.route].name} (${fl(Hs.fleeF)})`, 'alert');
  for (const p of gang()) if (jobOf(p) === 'borr') p.cargo = { kind: 'guld', name: 'guldtackor', kg: 14 };
}
/** är flyktvägen spärrad? (polisen vid lastkajen eller på taket, tåget stoppat, stormen) */
function blocked(k) {
  const Hs = /** @type {Heist} */ (H());
  if (k === 'van') return Hs.police && Hs.plan === 'garage';
  if (k === 'heli') return (Hs.police && Hs.plan === 'tak') || !!S.storm;
  if (k === 'train') return Hs.train === 'stop' || !trainsRunning() || STATION < 0;
  return true;
}
/** gänget grips */
function caught(how) {
  const Hs = /** @type {Heist} */ (H());
  if (Hs.ph === 'done') return;
  Hs.caught = true;
  for (const p of gang()) { p.caught = true; p.exitFloor = LOBBY; p.cargo = null; }
  Hs.gold = GOLD;
  end(sv`${how} Alla fem är gripna.`);
}
/** gänget kom undan */
function escaped() {
  const Hs = /** @type {Heist} */ (H());
  // (alla står vid flyktvägen: in i bilen, helikoptern eller tåget – och borta)
  const how = { van: 'Hoppar in i skåpbilen', heli: 'Klättrar in i helikoptern', train: 'Kliver på tunnelbanan' }[Hs.route];
  for (const p of gang()) { releaseSpot(p); pev(p, sv`${how} – borta med guldet`); p.dead = true; }
  if (Hs.route === 'van') Hs.van = 'out';
  end(sv`Gänget kom undan med ${ROUTES[Hs.route].name} och ${GOLD} guldtackor.`);
}
/** kuppen är över: hissarna släpps, gisslan går, sammanfattningen */
function end(text) {
  const Hs = /** @type {Heist} */ (H());
  Hs.ph = 'done'; Hs.tied = false;
  hijack(false);
  for (const p of S.people) {
    if (p.hostage) { p.hostage = false; if (p.state === 'office') p.timer = Math.min(p.timer, 0.5 + (p.id % 11) * 0.3); }
    if (p.hero) p.hero = false;
  }
  for (const p of gang()) if (p.state === 'office') { releaseSpot(p); const r = robberNext(p); if (r) setTrip(p, r[0], r[1], r[2]); }
  const hero = Hs.heroWho ? sv` ${Hs.heroWho} blev över och smög ${Hs.steps} trappsteg${Hs.heroStep >= 3 ? ', slog av strömmen till borren' : ''}${Hs.signal ? ' och signalerade till polisen från taket' : ''}.` : '';
  const sum = sv`${text} Guldtackor kvar i valvet: ${Hs.gold} av ${GOLD}. ${Hs.hostages} var gisslan i Sky Café.${hero}`;
  Hs.outcome = sum;
  log(Hs.caught ? '🚓 Kuppen är över – gänget är gripet' : '🚐 Kuppen är över – gänget kom undan', 'alert');
  incidentOver('heist', Hs.caught ? '🚓 Kuppen på 5:an – gripna' : '🚐 Kuppen på 5:an – borta', sum, { floor: BANK });
}

/** Spelarens (eller insatsledarens) val: cut/wait (strömmen), garage/tak (var insatsstyrkan går in), stop/go (tåget), storm (gå in nu) */
export function heistChoice(what) {
  const Hs = H();
  if (!Hs || Hs.ph === 'done' || Hs.ph === 'in') return false;
  if (what === 'cut') { Hs.power = 'cut'; if (!S.outage) startOutage(); log('🔌 Strömmen till Tornet klipps – valvets magnetlås släpper!', 'alert'); }
  else if (what === 'wait') Hs.power = 'wait';
  else if (what === 'garage' || what === 'tak') Hs.plan = what;
  else if (what === 'stop' || what === 'go') Hs.train = what;
  else if (what === 'storm') { if (!Hs.police) return false; Hs.stormAt = S.t; }
  else return false;
  return true;
}

/** varje steg (sim.js) */
export function heistTick(dt) {
  // (framkallad medan lastkajen var upptagen: skåpbilen backar in så fort det går)
  if (S.heistWait !== null && !S.heist && heistPossible()) startHeist();
  const Hs = H();
  if (!Hs) return;
  // skåpbilen
  if (Hs.van === 'in') { Hs.vanX = Math.min(70, Hs.vanX + 150 * dt); if (Hs.vanX >= 70) { Hs.van = 'park'; if (Hs.ph === 'in' && !Hs.gang.length) spawnGang(); } }
  else if (Hs.van === 'out') { Hs.vanX -= 150 * dt; if (Hs.vanX < -300) Hs.van = 'gone'; }
  if (Hs.ph === 'done') {
    // sedan gänget har gått (gripna eller borta) är kuppen över
    // (skåpbilen som blev kvar bärgas av polisen)
    if (!gang().length) { if (Hs.van === 'park') Hs.van = 'out'; else if (Hs.van !== 'in') S.heist = null; }
    return;
  }
  // gänget går till sina platser (heistSpot), eller mot flyktvägen
  for (const p of gang()) {
    if (p.state !== 'office') continue;
    const want = Hs.ph === 'flee' ? Hs.fleeF : postOf(jobOf(p));
    if (p.floor !== want) { releaseSpot(p); setTrip(p, want, Hs.ph === 'flee' ? 'Flyr med guldet' : (GANG.find(g => g.name === p.name) || GANG[0]).task, false); }
  }
  if (Hs.ph === 'in') {
    const L = robber('ledare');
    if (L && there(L, CONTROL)) hold();
    else if (S.t - Hs.t0 > 150 && Hs.gang.length) hold(); // (ledaren kom inte fram – kuppen börjar ändå)
    return;
  }
  // ---- hold / flee ----
  roundUp();
  newcomers();
  heroTick();
  if (!Hs.police && S.t - Hs.holdT >= POLICE_S) {
    Hs.police = true; Hs.policeAt = S.t; Hs.stormAt = S.t + STORM_S - (Hs.signal ? SIGNAL_S : 0);
    log('🚓 Polisen är på plats – gatan spärras av', 'alert');
    notice('heist-police', '🚓 Polisen är här', 'Polisen har spärrat av gatan. Insatsledaren bestämmer: klippa strömmen eller vänta, och var insatsstyrkan ska gå in.', { floor: LOBBY });
  }
  // lite liv: gisslan, natt-DJ:n och vakten pratar
  Hs.talkT -= dt;
  if (Hs.talkT <= 0) { Hs.talkT = 14; talk(Hs); }
  if (Hs.ph === 'hold') {
    const drillers = gang().filter(p => jobOf(p) === 'borr' && there(p, BANK));
    // klipps strömmen släpper valvets magnetlås: dörren går att bända upp, mycket fortare än att borra (men inte direkt)
    if (!S.power && drillers.length) Hs.drill = Math.min(1, Hs.drill + dt * drillers.length / 2 / (DRILL_S / 5));
    else if (drillers.length && S.t >= Hs.drillOff) {
      Hs.drill = Math.min(1, Hs.drill + dt * drillers.length / 2 / DRILL_S);
      if (Math.floor(S.t * 0.7) !== Math.floor((S.t - dt) * 0.7)) S.fx.push({ x: 175, y: floorY(BANK) - 40, text: 'BRRRRR', color: '#ffd23f', life: 1, size: 12 });
    }
    if (Hs.drill >= 1) { flee(); return; }
  }
  if (Hs.police && S.t >= Hs.stormAt) {
    caught(Hs.ph === 'hold' ? sv`Insatsstyrkan gick in via ${Hs.plan === 'garage' ? 'garaget' : 'taket'} och tog gänget innan valvet var öppet.` : sv`Insatsstyrkan gick in via ${Hs.plan === 'garage' ? 'garaget' : 'taket'} och tog gänget på väg ut.`);
    return;
  }
  if (S.t - Hs.t0 > HEIST_MAX) { caught('Gänget gav upp efter förhandlingar med polisen.'); return; }
  if (Hs.ph === 'flee') {
    if (blocked(Hs.route)) { caught(sv`Polisen väntade vid ${ROUTES[Hs.route].name}.`); return; }
    const g = gang();
    if (g.length && g.every(p => there(p, Hs.fleeF))) { escaped(); return; }
    if (S.t - Hs.fleeT > FLEE_MAX) caught('Gänget hann aldrig ut – polisen tog dem i trapphuset.');
  }
}
/** gisslan, vakten och natt-DJ:n säger något (en replik i taget, efter tur) */
function talk(Hs) {
  const n = Hs.talkN++;
  const host = S.people.filter(p => p.hostage && p.floor === CAFE && p.state === 'office');
  const dj = S.people.find(p => p.role === 'nattdj' && p.state === 'office');
  const guard = robber('vakt');
  const lines = [
    () => host.length && speak(host[n % host.length], ['Tror du de hinner till lunch?', 'Kanelbullarna tar slut snart', 'Det här ska jag berätta för barnbarnen', 'Han där borta ser nervös ut', 'Undrar om banken är försäkrad'][n % 5]),
    () => guard && speak(guard, ['Sitt still nu!', 'Ingen tittar ut genom fönstret!', 'Är det kaffe där? … Nej, sitt still!'][n % 3]),
    () => dj && speak(dj, ['Kanal 97 – live från Tornet: rånare i huset!', 'Vi sänder direkt: polisen på gatan!', 'Nästa låt tillägnas gisslan på 6:an!'][n % 3]),
    () => S.heist && S.heist.drill > 0 && S.heist.ph === 'hold' && robber('borr') && speak(/** @type {Person} */ (robber('borr')), S.t < S.heist.drillOff ? 'Vem drog ur sladden?!' : sv`${Math.round(S.heist.drill * 100)} % – snart igenom!`),
  ];
  lines[n % lines.length]();
}
export function heistReset() { S.heist = null; S.heistWait = null; }
/** förvarningen: skåpbilen har stått länge (incidents.js) */
export const HEIST_WARN = sv`🚐 En skåpbil från ${VAN_NAME} står vid lastkajen med motorn igång…`;
