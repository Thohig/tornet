// Driftchefen: husets självständiga beslutsfattare. Huset sköter sig självt – chefen i kontrollrummet
// tar varje beslut som spelaren annars hade fått ta (svajläge i stormen, brandzon, reservkraft och
// räddning, extrafläkt, beställd service, rusningsläge, flyttens vägval) och säger varför. Spelaren kan
// när som helst ta över ett beslut via act(): då gäller spelarens val tills incidenten är över
// (`S.chief.manual`), och knappen "Låt driftchefen bestämma" lämnar tillbaka det.
// Allt här är simulering: beslut fattas ur simuleringens tillstånd (aldrig slump), så samma frö ger
// samma beslut. Chefen gör samma anrop som spelarens åtgärder men går inte via act() – act() är spelaren.
// Cheferna är också personer i huset (crew.js): de sitter vid kontrollbordet, fikar i personalrummet och
// byter skift – men besluten fattas var de än är (walkie-talkien), så huset sköter sig lika bra för det.
import { fl } from './util.js';
import { CREW, LOBBY } from './config.js';
import { S, clockStr, hour, log } from './state.js';
import { alarm, crewPerson, lookUp } from './crew.js';
import { ladderReach, ropeWindy, setPanoHow } from './pano.js';
import { setStormMode, windAt, windMs } from './weather.js';
import { setFireMode, startGenerator, toggleAutoRescue } from './incidents.js';
import { orderService, startFan, WARM_AT } from './service.js';
import { setMoveWind } from './visits.js';
import { hoistHalt } from './hoist.js';
import { heistChoice } from './heist.js';
import { changeStrategy } from './actions.js';
import { STRAT_NAMES } from './config.js';

/** dagens och nattens driftchef (personalen i CREW, config.js – kontrollrummet byter skift klockan 22) */
export const CHIEFS = CREW.filter(c => c.post === 'chief');
/** vem som sitter i kontrollrummet just nu */
export const chiefOnDuty = (h = hour()) => (h >= CHIEFS[1].from ? CHIEFS[1] : CHIEFS[0]);

/**
 * Ett beslut (eller något chefen konstaterar). by = 'chief' eller 'player'; inc = incidenten det hör till
 * (för efterspelet), outcome = hur det gick (fylls i när incidenten är över).
 * @typedef {{ key: string, text: string, why: string, t: number, time: string, by: 'chief'|'player', info: boolean,
 *   inc: string|null, floor: number|null, car: number|null, outcome: string|null }} Decision
 */
/**
 * Driftchefens tillstånd i S.chief: på/rast, gällande beslut, dagens beslut och repliken i kontrollrummet.
 * @typedef {{ on: boolean, strat: boolean, manual: Record<string, boolean>, dec: Record<string, Decision>, log: Decision[],
 *   say: { text: string, t0: number, until: number, dec: boolean, who?: string }|null, stormT: number, fireT0: number|null,
 *   svcN: number, svcT: number, rushT: number, stratBy: string|null, seen: Record<string, boolean>, incSeen: number|null,
 *   alarmed?: boolean }} Chief
 */
/** Nollställ chefen för ett nytt dygn (på/av och strategibyten följer med). */
export function chiefReset() {
  const C = S.chief;
  S.chief = { on: C ? C.on : true, strat: C ? C.strat : true,
    manual: /** @type {Record<string, boolean>} */ ({}), dec: /** @type {Record<string, Decision>} */ ({}),
    log: /** @type {Decision[]} */ ([]), say: /** @type {{ text: string, t0: number, until: number, dec: boolean, who?: string }|null} */ (null),
    stormT: -99, fireT0: null, svcN: 0, svcT: 0, rushT: 0, stratBy: /** @type {string|null} */ (null),
    seen: /** @type {Record<string, boolean>} */ ({}), incSeen: /** @type {number|null} */ (null) };
}

/** Mjukt dygnsskifte: en ny beslutslogg (beslut om incidenter som pågår följer med) och nya servicebeställningar */
export function chiefRoll() {
  const C = S.chief;
  C.log = C.log.filter(d => d.inc && !d.outcome && !d.info);
  C.svcN = 0;
}

function record(key, text, why, by, o = {}) {
  const C = S.chief;
  /** @type {Decision} */
  const d = { key, text, why, t: S.t, time: clockStr(), by, info: !!o.info, inc: o.inc ?? null, floor: o.floor ?? null, car: o.car ?? null, outcome: null };
  if (!d.info) C.dec[key] = d;
  C.log.push(d);
  if (C.log.length > 60) C.log.shift();
  return d;
}
/** chefen bestämmer något och säger varför (loggen, kontrollrummets pratbubbla och incidentkortet) */
function decide(key, text, why, o = {}) {
  const C = S.chief, who = o.who || chiefOnDuty().name;
  record(key, text, why, 'chief', o);
  // (who = någon annan än chefen – polisens insatsledare under kuppen: det står på skylten, inte i chefens pratbubbla)
  C.say = { text: o.say || text, t0: S.t, until: S.t + 10, dec: !o.info, ...(o.who ? { who: o.who } : {}) };
  const color = o.car !== undefined && o.car !== null ? S.elevators[o.car].color : null;
  log(`🧑‍💼 ${who}: ${text}${why ? ` – ${why}` : ''}`, 'chief', color);
}
/** chefen konstaterar något (inget beslut, men det berättas) */
const note = (key, text, why = '', o = {}) => decide(key, text, why, { ...o, info: true });
/** chefen berättar något som ett annat delsystem bestämde (rundvisningens reservguide, visning.js) – bara när chefen är på */
export function chiefNote(key, text, why = '') { if (S.chief && S.chief.on) note(key, text, why); }

/** Spelaren tog ett beslut (anropas av act()): det gäller tills incidenten är över. */
export function playerChose(key, text, o = {}) {
  const C = S.chief;
  if (!C) return;
  C.manual[key] = true;
  record(key, text, '', 'player', o);
  if (C.on) C.say = { text: 'Okej – du bestämmer!', t0: S.t, until: S.t + 4, dec: false };
}
/** Spelaren lämnar tillbaka beslutet till chefen (knappen på incidentkortet). */
export function chiefBack(key) {
  const C = S.chief;
  if (!C || !C.manual[key]) return;
  delete C.manual[key];
  if (C.dec[key] && C.dec[key].by === 'player') delete C.dec[key];
  if (key === 'strategy') C.stratBy = null;
  if (C.on) C.say = { text: 'Tack – jag tar det härifrån.', t0: S.t, until: S.t + 4, dec: false };
}
/** Driftchefen på/av (spelarens inställning). Av: allt väntar på spelaren, som förr. */
export function setChief(on) {
  const C = S.chief;
  if (!C || C.on === !!on) return;
  C.on = !!on;
  log(on ? `🧑‍💼 ${chiefOnDuty().name} går tillbaka till kontrollbordet – huset sköter sig självt` : `🧑‍💼 ${chiefOnDuty().name} går på rast – alla beslut väntar på dig`, 'chief');
  lookUp(p => p.role === 'driftchef'); // (cheferna reser sig direkt)
}
/** beslutet om en incident gäller inte längre: korten visar inget, och spelaren har inte längre tagit över */
function clear(key) { delete S.chief.dec[key]; delete S.chief.manual[key]; }
const free = key => !S.chief.manual[key];

// ---------- Varje steg ----------
export function chiefTick(dt) {
  const C = S.chief;
  if (!C) return;
  // larmet går: chefen på fikarast reser sig direkt (i stället för vid nästa titt på klockan)
  const a = alarm();
  if (a && !C.alarmed) lookUp(p => p.onBreak);
  C.alarmed = a;
  outcomes();
  // när incidenten är över gäller varken chefens eller spelarens beslut längre
  if (!S.storm) clear('storm');
  if (!S.fire) { clear('fire'); C.fireT0 = null; }
  if (!S.outage) clear('power');
  for (const e of S.elevators) if (!e.hot && !e.fan && (C.dec[`heat${e.id}`] || C.manual[`heat${e.id}`])) clear(`heat${e.id}`);
  if (!S.move || S.move.state === 'done') clear('move');
  if (!S.pano || S.pano.ph === 'done') clear('pano');
  if (!S.heist || S.heist.ph === 'done') { clear('heist'); delete C.seen.heistWait; delete C.seen.heistPlan; delete C.seen.heistSignal; }
  // kuppen: polisens insatsledare bestämmer (chefen sitter bunden i driftcentralen och tar inga egna beslut)
  if (S.heist && S.heist.police && S.heist.ph !== 'done') heistChiefTick();
  if (S.heist && S.heist.tied) return;
  if (!C.on) return;
  stormTick();
  fireTick();
  powerTick();
  heatTick();
  serviceTick(dt);
  strategyTick(dt);
  moveTick();
  panoChiefTick();
  watchTick();
}

// --- Stormen: full fart tills det blåser upp, svajläge när linorna börjar slå, normal drift när det mojnar ---
const SWAY_AT = 0.5, CALM_AT = 0.38;
function stormTick() {
  const St = S.storm, C = S.chief;
  if (!St || !free('storm')) return;
  const w = windAt(), u = (S.t - St.t0) / St.len;
  if (St.mode === 'none' && w > SWAY_AT && u < 0.75 && S.t - C.stormT > 6) {
    C.stormT = S.t; setStormMode('sway');
    decide('storm', 'Svajläge', `vinden är uppe i ${windMs()} m/s – de höga hissarna saktar in innan linorna börjar slå i schaktet`, { inc: 'storm', say: 'Svajläge! Sakta i höga zonen.' });
  } else if (St.mode === 'sway' && w < CALM_AT && u > 0.5 && S.t - C.stormT > 6) {
    C.stormT = S.t; setStormMode('none');
    decide('storm', 'Normal drift igen', `vinden har mojnat till ${windMs()} m/s`, { inc: 'storm', say: 'Det mojnar – full fart igen.' });
  } else if (!C.dec.storm) {
    decide('storm', 'Full fart så länge', `${windMs()} m/s – svajläge först när det blåser över ${Math.round(SWAY_AT * 32)} m/s`, { inc: 'storm', say: 'Vi kör på tills det blåser upp.' });
  }
}

// --- Brand: larmet återkallar hissarna; ligger branden högt kör hissarna under brandzonen folk ut ---
function fireTick() {
  const F = S.fire, C = S.chief;
  if (!F || !free('fire') || C.dec.fire) return;
  if (C.fireT0 === null) C.fireT0 = S.t;
  if (S.t - C.fireT0 < 3) return; // (larmet hinner gå och återkallningen börja)
  const zmax = F.floor - 2;
  if (zmax - LOBBY >= 3 && F.mode !== 'zone') {
    setFireMode('zone');
    decide('fire', `Brandzon: hissarna kör E–${fl(zmax)}`, `branden är på ${fl(F.floor)}, högt upp – hissarna under zonen kan köra ut folk medan de över tar trappan`, { inc: 'fire', floor: F.floor, say: `Brandzon! Hissarna under ${fl(F.floor - 1)} kör.` });
  } else {
    decide('fire', 'Alla hissar återkallade', `branden är på ${fl(F.floor)}, för nära entrén för att köra hissar under den – alla tar trappan`, { inc: 'fire', floor: F.floor, say: 'Alla hissar ner – trapporna gäller!' });
  }
}

// --- Strömavbrott: reservkraften och auto-räddningen (ambulansen först, sedan fullaste hissen) ---
function powerTick() {
  const O = S.outage;
  if (!O || !free('power')) return;
  const trapped = S.elevators.reduce((a, e) => a + (e.mode === 'normal' || e.mode === 'recall' ? e.passengers.length : 0), 0);
  if (O.genAt === null && S.t - O.t0 > 3) {
    if (trapped) {
      startGenerator();
      decide('power', 'Reservkraften startas', `${trapped} sitter fast – reservkraften räcker till att nödsänka en hiss i taget`, { inc: 'power', say: 'Starta reservkraften!' });
    } else if (!S.chief.dec.power) decide('power', 'Väntar ut avbrottet', 'ingen sitter fast i hissarna – reservkraften behövs inte', { inc: 'power', say: 'Ingen fast – vi väntar.' });
  }
  if (O.gen && !O.auto) {
    toggleAutoRescue(true);
    decide('power', 'Auto-räddning', 'reservkraften är igång – ambulanspersonalen först, sedan den fullaste hissen', { inc: 'power', say: 'Nödsänk – fullaste hissen först.' });
  }
}

// --- Motorvärme: extrafläkten när motorn är överhettad, eller redan när den går varm mitt i rusningen ---
function heatTick() {
  const h = hour(), rush = (h >= 7 && h < 10.3) || (h >= 15.8 && h < 18.6);
  for (const e of S.elevators) {
    const key = `heat${e.id}`;
    if (e.fan || !free(key) || e.mode === 'dead') continue;
    if (e.hot) {
      startFan(e);
      decide(key, `Extrafläkten i ${e.name}`, `motorn är överhettad (${Math.round(35 + e.heat * 65)} °C) – fläkten kyler ungefär fyra gånger snabbare`, { inc: 'heat', car: e.id, say: `Fläkten på i ${e.name}!` });
    } else if (rush && e.heat >= WARM_AT + 0.12 && e.mode === 'normal') {
      startFan(e);
      decide(key, `Extrafläkten i ${e.name}`, `motorn går varm (${Math.round(35 + e.heat * 65)} °C) mitt i rusningen – kyler innan skyddet löser ut`, { inc: 'heat', car: e.id, say: `${e.name} går varm – fläkten på.` });
    }
  }
}

// --- Service: en sliten hiss får service när det är lugnt (hellre nu än ett fel mitt i rusningen) ---
const SVC_WEAR = 0.62, SVC_MAX = 2;
const calm = h => (h >= 10.3 && h < 11.2) || (h >= 13.6 && h < 15.6) || (h >= 19.5 && h < 21.5);
function serviceTick(dt) {
  const C = S.chief;
  C.svcT -= dt;
  if (C.svcT > 0) return;
  C.svcT = 5;
  if (C.svcN >= SVC_MAX || !calm(hour()) || S.fire || !S.power || S.storm || S.elevators.some(e => e.serviceAsap)) return;
  const e = S.elevators.filter(x => x.mode === 'normal' && !x.hold && !x.indep && !x.serviceAsap && x.wear >= SVC_WEAR)
    .sort((a, b) => b.wear - a.wear)[0];
  if (!e) return;
  C.svcN++;
  orderService(e);
  decide('service', `Service för ${e.name}`, `slitaget är ${Math.round(e.wear * 100)} % – bättre en service nu i lugnet än ett hissfel i rusningen`, { car: e.id, say: `Ring teknikern – ${e.name} behöver service.` });
}

// --- Rusningsläge: Smart → Rusning när kön växer i en rusning, tillbaka när den är över ---
const RUSH_WAIT = 22, RUSH_HOLD = 12;
function strategyTick(dt) {
  const C = S.chief, h = hour();
  if (!C.strat || !free('strategy')) return;
  const rush = (h >= 7 && h < 10.3) || (h >= 15.8 && h < 18.6);
  if (S.strategy === 'smart' && rush) {
    const w = S.people.filter(p => p.state === 'wait');
    const avg = w.length >= 6 ? w.reduce((a, p) => a + (S.t - p.waitStart), 0) / w.length : 0;
    C.rushT = avg > RUSH_WAIT ? C.rushT + dt : 0;
    if (C.rushT > RUSH_HOLD) {
      C.rushT = 0; C.stratBy = 'chief';
      changeStrategy('peak');
      decide('strategy', `Byter till ${STRAT_NAMES.peak}`, `${w.length} väntar i snitt ${Math.round(avg)} s – rusningsläget kör hissarna dit folket kommer`, { say: 'Kön växer – rusningsläge!' });
    }
  } else if (S.strategy === 'peak' && C.stratBy === 'chief' && !rush) {
    C.stratBy = null;
    changeStrategy('smart');
    decide('strategy', `Tillbaka till ${STRAT_NAMES.smart}`, 'rusningen är över', { say: 'Rusningen är över – Smart igen.' });
  }
}

// --- Flytten: chefen berättar planen, och väljer vad som händer med det vid lastluckan när det blåser ---
function moveTick() {
  const M = S.move, C = S.chief;
  if (!M || M.state !== 'on') return;
  if (!C.seen.movePlan && M.route === 'auto' && free('move')) {
    C.seen.movePlan = true;
    decide('move', 'Flytten: vägen planeras möbel för möbel', M.hoist
      ? `XL-möblerna tar hissbalken utanpå, de stora när det är kö till varuhissen – resten i ${M.smart ? 'varuhissen, som bara låses för de tunga lassen' : 'varuhissen'}`
      : 'allt går i varuhissen', { say: 'Flyttdag – jag håller koll på varuhissen.' });
  }
  if (M.windChoice === null && free('move') && hoistHalt() === 'blåst' && M.items.some(it => it.st === 'hatch')) {
    const V = S.elevators.find(e => e.freight);
    const ok = V && V.mode === 'normal';
    setMoveWind(ok ? 'varu' : 'wait');
    decide('move', ok ? 'Lasset vid luckan går i varuhissen' : 'Lasset vid luckan får vänta', ok ? 'blåsten stoppar hissbalken, men varuhissen går' : 'blåsten stoppar balken och varuhissen går inte', { say: 'Balken står still – ta varuhissen!' });
  }
}

// --- Panoramahissen sitter fast på fasaden: rep från taket eller stegbilen från gatan ---
function panoChiefTick() {
  const P = S.pano, C = S.chief;
  if (!P || P.ph === 'done' || !free('pano')) return;
  const e = S.elevators[P.car], windy = ropeWindy(), reach = ladderReach(e);
  // första beslutet när korgen fastnar; sedan byter chefen till stegbilen om det blåser upp och den når
  if (C.dec.pano && !(P.how === 'rope' && windy && reach && !P.rider)) return;
  if (S.t - P.t0 < 2) return; // (chefen hinner se det på skärmen)
  const how = windy && reach ? 'ladder' : 'rope';
  if (!setPanoHow(how, 'chief')) return;
  const where = P.toF === LOBBY ? 'ner till gatan' : 'in på takterrassen';
  if (how === 'ladder') decide('pano', 'Stegbilen från gatan', `${windMs()} m/s är för blåsigt för repet, och stegen når upp till ${e.name}`, { inc: 'pano', car: e.id, say: 'Stegbilen – det blåser för mycket för rep!' });
  else if (windy) decide('pano', 'Firas ner – när vinden mojnar', `stegbilen når inte upp till ${e.name}, och i ${windMs()} m/s kan räddarna inte fira någon – de väntar på taket`, { inc: 'pano', car: e.id, say: 'Vi får vänta ut vinden…' });
  else decide('pano', 'Firas ner med rep från taket', `hydrauliken går inte att veva – räddningstjänsten firar ner dem en i taget ${where}`, { inc: 'pano', car: e.id, say: `Fira ner dem från taket!` });
}

// --- Kuppen: polisens insatsledare – vänta ut dem (strömmen klipps inte), gå in via garaget där skåpbilen står ---
/** den som bestämmer under kuppen (visas på incidentkortet) */
export const INSATS = 'Insatsledaren';
function heistChiefTick() {
  const Hs = S.heist, C = S.chief;
  if (!Hs || !free('heist')) return;
  const o = { inc: 'heist', who: INSATS };
  if (!C.seen.heistWait) {
    C.seen.heistWait = true;
    heistChoice('wait'); heistChoice('garage');
    decide('heist', 'Vi väntar ut dem – strömmen stannar på', 'klipper vi strömmen släpper valvets magnetlås, och det är precis vad de vill', { ...o, say: 'Ingen klipper strömmen!' });
  } else if (!C.seen.heistPlan && S.t - Hs.policeAt > 12) {
    C.seen.heistPlan = true;
    decide('heist', 'Insatsstyrkan går in via garaget', 'skåpbilen står vid lastkajen – utan den kommer de ingenstans', { ...o, say: 'Vi tar dem vid lastkajen.' });
  } else if (Hs.signal && !C.seen.heistSignal) {
    C.seen.heistSignal = true;
    decide('heist', 'Ljussignal från taket – vi går in tidigare', `${Hs.heroWho || 'någon'} vet var de är`, { ...o, say: 'Vi har kontakt – snart går vi in!' });
  }
}

// --- Det chefen ser på skärmarna och berättar (inga beslut) ---
function watchTick() {
  const C = S.chief;
  for (const e of S.elevators) {
    const k = `b${e.id}`;
    const broken = e.mode === 'broken' || e.mode === 'snapped';
    if (broken && !C.seen[k]) {
      C.seen[k] = true;
      if (e.mode === 'snapped') note(k, `Linbrott i ${e.name}!`, 'fångapparaten håller – teknikern larmas för utrymning genom takluckan', { car: e.id });
      else if (e.fault && e.fault.trapped) note(k, `${e.name} står mellan två våningar`, `${e.passengers.length} sitter fast – teknikern går före allt annat`, { car: e.id });
      else note(k, `${e.name} är trasig`, 'teknikern är larmad – trafiken tar de andra hissarna', { car: e.id });
    } else if (!broken && C.seen[k]) delete C.seen[k];
  }
  if (S.medic && S.medic.state !== 'done' && !C.seen.medic) { C.seen.medic = true; note('medic', 'Ambulansen får förtur', `${S.medic.pname} har svimmat på ${fl(S.medic.floor)} – en hiss reserveras åt båren`); }
  if (!S.medic || S.medic.state === 'done') delete C.seen.medic;
  if (S.techCall && !C.seen.call) { C.seen.call = true; note('call', 'Hissjouren skickar en extra tekniker', `${S.techCall.n} trasiga hissar står i kö`); }
  if (!S.techCall) delete C.seen.call;
}

/** när en incident är över: hur det gick skrivs in på besluten som hörde till den (dagens sammanfattning) */
function outcomes() {
  const C = S.chief, L = S.lastInc;
  if (!L || C.incSeen === L.id) return;
  C.incSeen = L.id;
  const n = [...S.notices].reverse().find(x => x.kind === L.type && x.t0 === L.t);
  if (!n) return;
  for (const d of C.log) if (d.inc === L.type && !d.outcome && !d.info) d.outcome = n.text;
}

// ---------- Driftcheferna som personer (crew.js) ----------
/** chefen i(CHIEFS) som person, om hen är i huset */
export const chiefPerson = i => crewPerson(CHIEFS[i].id);
export { alarm };
