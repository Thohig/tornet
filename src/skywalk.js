// Skywalken: en inglasad gångbro från sky lobbyn till granntornet Kronan (BUILDING.skywalk i config). Kronan
// simuleras inte – bron är en tredje väg in i huset, efter entrén och tunnelbanan. Grannarna kommer över bron
// (besök på kontoren, lunch i Sky Café) och går tillbaka samma väg, och en del av Tornets anställda äter lunch
// på Kronans Krog. Den som går på bron har läget 'bridge' (p.bridgeT = hur långt ut, 0 vid Tornets dörr och 1
// vid Kronans, p.bridgeDir = åt vilket håll); den som är inne i Kronan har läget 'kronan'.
//
// Bron stänger när Kronan stänger för natten, på underhållsnätter, i stormen om driftchefen (chief.js) eller
// spelaren väljer det (act('skywalk', 'close'|'open')), under kuppen om polisen spärrar den (heist.js) och för
// inkommande när Kronans hissar har kraschat och Tornet bara tar sina egna (kronan.js). Under en brand ovanför
// sky lobbyn går de som är ovanför ut över bron i stället för ner genom huset (evacFloor i people.js).
// Kronans driftchef Göran pratar ibland med vår i driftradion, och Kronans fönsterputsare Jörgen hänger på
// Kronans fasad när Hasse är ute.
//
// Översikt:
// bron till Kronan: `canGoOut`/`canComeIn` (varför den är stängd: `closedWhy`), grannarna (`spawnNeighbor`, egen
// ankomstström `grannar` som dras varje steg), lunchen i Kronan (`next`), vägen ut (`bridgeOut` i arriveOnFloor,
// `enterBridge` i exitDone), stegen på bron (`skywalkTick`: fart efter vinden, framme i Kronan/Tornet),
// utrymning över bron (`bridgeEvac`), stormens beslut (`setBridgeStorm`), underhållsnätter och Göran i radion.
// Egna slumpströmmar: `grannar` (ankomsterna), `grannarnas` (grannarnas utseende) och `skywalk` (resten).
import { stream } from './rng.js';
import { sv } from './sv.js';
const NB = stream('grannar'), NG = stream('grannarnas');
const { rng, rand, pick } = stream('skywalk');
import { S, hour, log, notice } from './state.js';
import { CAFE, FL, LOBBY, SKYWALK, SKYWALK_F, WAIT_X1, floorOpen, pace } from './config.js';
import { makePerson, openFloors, pev, pn, releaseSpot, setTrip } from './people.js';
import { fireReturn, leaveBuilding } from './life.js';
import { windAt } from './weather.js';
import { dutyDone } from './crew.js';
import { fl } from './util.js';
/** @typedef {import('./people.js').Person} Person */

/** var dörren ut till bron sitter i sky lobbyns hall (världens x): längst till höger, mot fasaden */
export const SKYWALK_DOOR = WAIT_X1 - 28;
/** Kronan */
export const KRONAN = SKYWALK ? SKYWALK.to : 'Kronan';
/** Kronans driftchef (pratar med vår i driftradion) och fönsterputsare */
export const GORAN = 'Göran', JORGEN = 'Jörgen';
/** hur lång tid det tar att gå över bron (s) i lugnt väder: man tar det lugnt och tittar på utsikten */
export const BRIDGE_S = 6;
/** när bron stänger för underhåll (klockslag): då stänger den tidigare än Kronan */
const MAINT_H = 20;

/**
 * Skywalken (S.skywalk): storm = stormens beslut ('' = inget, 'close' = stängd, 'open' = öppen med vakt), by = vem
 * som bestämde; maint = underhållsnatt i natt (maintNoted = det är sagt); closedNoted = senaste stängningen som är
 * berättad (orsaken); talkAt = när Göran säger något nästa gång (S.t); n = passager över bron i dag; neighbors =
 * grannar som kom i dag; lunch = Tornets anställda som åt i Kronan; evac = utrymda över bron (pågående brand).
 * @typedef {{ storm: string, by: string, maint: boolean, maintNoted: boolean, closedNoted: string, talkAt: number,
 *   n: number, neighbors: number, lunch: number, evac: number }} Skywalk
 */
const SW = () => /** @type {Skywalk} */ (S.skywalk);

// ---------- Öppet eller stängt ----------
/** varför bron är stängd just nu ('' = öppen) – för alla, åt båda hållen */
export function closedWhy(h = hour()) {
  if (SKYWALK_F < 0 || !S.skywalk) return 'ingen bro';
  const [o, c] = SKYWALK.hours, X = SW();
  if (h < o || h >= c) return sv`${KRONAN} har stängt för natten`;
  if (X.maint && h >= MAINT_H) return 'underhåll';
  if (S.storm && X.storm === 'close') return 'stormen';
  if (S.heist && S.heist.ph !== 'done' && S.heist.bridge === 'spärr') return 'polisen';
  return '';
}
/** kan man gå ut över bron till Kronan nu? */
export const canGoOut = () => !closedWhy();
/** kan man komma in över bron från Kronan nu? (inte under en brand, och inte när Tornet bara tar sina egna) */
export const canComeIn = () => canGoOut() && !S.fire && !(S.kronan && S.kronan.ph === 'on' && S.kronan.mode === 'own');
/** blåser det på bron (öppen i stormen): man går långsammare */
const windy = () => !!S.storm && SW().storm !== 'close';
/** de som är på bron just nu */
export const onBridge = () => S.people.filter(p => !p.dead && p.state === 'bridge');

// ---------- Grannarna ----------
/** hur många grannar som kommer per sekund (speltimmen följer pace, som besökarna) */
function neighborRate(h) {
  if (h < 8.5 || h >= 17.5) return 0;
  const lunch = h >= 11.2 && h < 12.8;
  return (0.07 + (lunch ? 0.16 : 0)) * pace(h) * S.cal.visMul; // (färre grannar på helgen, calendar.js)
}
/** En granne från Kronan kommer över bron: ett ärende på ett kontor eller lunch i Sky Café. */
export function spawnNeighbor(why = null, goal = null) {
  const h = hour(), lunch = h >= 11.2 && h < 12.8;
  const open = openFloors(h).filter(f => f !== SKYWALK_F || f === CAFE);
  let dest = goal;
  if (dest === null) {
    if (lunch && floorOpen(CAFE, h) && NG.rng() < 0.7) dest = CAFE;
    else if (open.length) dest = NG.pick(open);
    else return null;
  }
  const p = makePerson('vis', SKYWALK_F, SKYWALK_DOOR, NG);
  p.kronan = true; p.exitFloor = SKYWALK_F;
  p.state = 'bridge'; p.bridgeT = 1; p.bridgeDir = -1; p.spot = null;
  p.bridgeGoal = dest;
  p.bridgeWhy = why || (dest === CAFE ? sv`Lunch i ${FL[CAFE].name} – grannen från ${KRONAN}` : sv`${FL[dest].visit || 'Ett ärende'} – kommer från ${KRONAN}`);
  S.people.push(p);
  SW().neighbors++; S.stats.neighbors++; S.stats.bridge++;
  pev(p, sv`Går över bron från ${KRONAN} · ${p.bridgeWhy} (${fl(dest)})`);
  log(sv`${pn(p)} kommer över bron från ${KRONAN} · ska till ${fl(dest)}`, 'person', null, p.id);
  return p;
}

// ---------- Ut på bron ----------
/** en spot vid dörren till bron (syns i hallen när man går dit) */
const doorSpot = desc => ({ x: SKYWALK_DOOR, k: 'stand', face: 1, desc, temp: true, win: 'hall' });
/**
 * p har kommit fram till sin utgång (arriveOnFloor i people.js): ska hen ut över bron? Sätter i så fall vägen dit
 * och svarar true. Grannar som inte kommer ut (bron stängd) går ut genom entrén i stället.
 * @param {Person} p
 */
export function bridgeOut(p) {
  if (SKYWALK_F < 0 || p.floor !== SKYWALK_F) return false;
  const evac = p.evac && bridgeEvac(p), robber = p.robber && S.heist && S.heist.route === 'bro';
  if (!p.kronan && !evac && !robber) return false;
  if (!canGoOut() && !robber) {
    if (evac) return false;
    p.exitFloor = LOBBY;
    setTrip(p, LOBBY, sv`Bron är stängd (${closedWhy()}) – går ut genom entrén och runt kvarteret`, true);
    return true;
  }
  p.toBridge = true; p.state = 'exiting';
  p.spot = doorSpot(evac ? 'Utrymmer över bron till Kronan' : sv`Går över bron till ${KRONAN}`); p.tx = SKYWALK_DOOR;
  return true;
}
/** p står vid dörren och går ut på bron (exitDone i people.js) @param {Person} p */
export function enterBridge(p) {
  p.toBridge = false; releaseSpot(p);
  p.state = 'bridge'; p.bridgeT = 0; p.bridgeDir = 1; p.spot = null; p.x = SKYWALK_DOOR;
  SW().n++; S.stats.bridge++;
  pev(p, p.evac ? 'Ut på bron – utrymmer till Kronan' : sv`Går ut på bron mot ${KRONAN}`);
}
/** brinner det nedanför sky lobbyn: de som är på eller ovanför den utryms över bron (evacFloor i people.js) @param {Person} p */
export const bridgeEvac = p => SKYWALK_F >= 0 && !!S.fire && S.fire.floor < SKYWALK_F && p.floor >= SKYWALK_F && canGoOut();

// ---------- Lunchen i Kronan ----------
/** var fjärde anställd (efter id, inte slumpen) äter hellre på Kronans Krog när bron är öppen @param {Person} p */
const kronanEater = p => p.id % 4 === 0;
/** next (systems.js): lunchen över bron; undefined = inte min sak @param {Person} p */
export function skywalkNext(p) {
  if (SKYWALK_F < 0 || p.kind !== 'emp' || p.role || p.lunched || p.evac || p.hostage || !kronanEater(p)) return undefined;
  const h = hour();
  if (h < (p.lunchAt ?? 99) || h >= 13.6 || !canGoOut() || h + 1.2 >= SKYWALK.hours[1]) return undefined;
  p.lunched = true; p.kronanLunch = true;
  return [SKYWALK_F, sv`Lunch på ${KRONAN}s Krog – över bron`, false];
}
/** spot (systems.js): den som ska äta i Kronan går till dörren ut till bron @param {Person} p */
export function skywalkSpot(p, f) {
  if (!p.kronanLunch || f !== SKYWALK_F) return undefined;
  if (!canGoOut()) { p.kronanLunch = false; return undefined; } // (stängd: äter i Sky Café i stället)
  p.toBridge = true;
  return doorSpot(sv`Går över bron till ${KRONAN}s Krog`);
}

// ---------- Varje steg ----------
/** @param {number} dt */
export function skywalkTick(dt) {
  if (SKYWALK_F < 0) return;
  const X = SW(), h = hour();
  // grannarna (dras varje steg – samma dygn oavsett styrlogik; bara spawnen beror på om bron är öppen)
  const r = NB.rng();
  if (canComeIn() && !S.fire && r < neighborRate(h) * dt) spawnNeighbor();
  // på bron
  for (const p of S.people) {
    if (p.dead) continue;
    if (p.state === 'bridge') stepBridge(p, dt);
    else if (p.state === 'kronan') inKronanTick(p);
  }
  // stängt: berätta en gång per stängning
  const why = closedWhy();
  if (why !== X.closedNoted) {
    if (why && why !== 'ingen bro' && h >= SKYWALK.hours[0]) log(sv`🚧 Bron till ${KRONAN} är stängd – ${why}`, 'sys');
    else if (!why && X.closedNoted && X.closedNoted !== 'ingen bro') log(sv`🌉 Bron till ${KRONAN} är öppen`, 'sys');
    X.closedNoted = why;
  }
  if (X.maint && !X.maintNoted && h >= MAINT_H) {
    X.maintNoted = true;
    notice('skywalk-maint', '🚧 Bron stängs för underhåll i natt', sv`Arbetare byter tätningslister i glasbron till ${KRONAN}. Den öppnar igen i morgon bitti.`, { floor: SKYWALK_F });
  }
  // Göran i Kronan säger något i driftradion
  if (S.t >= X.talkAt && h >= 7 && h < 21) { X.talkAt = S.t + rand(70, 140); goranTalk(); }
}
/** fart på bron (andel av bron per sekund) @param {Person} p */
function bridgeSpeed(p) {
  let v = p.speedMul / BRIDGE_S;
  if (windy()) v *= 1 - 0.55 * windAt();
  if (p.bridgeHelp || (S.hojd && S.hojd.pid === p.id && S.hojd.ph === 'leder')) v *= 0.5; // (lugnt, en bit i taget)
  if (p.robber) v *= 2;
  return v;
}
/** @param {Person} p @param {number} dt */
function stepBridge(p, dt) {
  if (p.frozen) return; // (höjdskräck: står still mitt på bron, hojd.js)
  if (p.bridgeHelp && helperTick(p, dt)) return;
  p.bridgeT += p.bridgeDir * bridgeSpeed(p) * dt;
  p.walkPhase += dt * 8 * p.speedMul;
  if (p.bridgeDir > 0 && p.bridgeT >= 1) { p.bridgeT = 1; atKronan(p); }
  else if (p.bridgeDir < 0 && p.bridgeT <= 0) { p.bridgeT = 0; atTornet(p); }
}
/** vaktmästaren som leder den höjdrädda (hojd.js): går ut till hen och sedan bredvid hen (true = flyttad här) @param {Person} p @param {number} dt */
function helperTick(p, dt) {
  const H = S.hojd, q = H && S.people.find(x => x.id === H.pid && !x.dead && x.state === 'bridge');
  if (!H || !q || H.ph === 'klar') { p.bridgeDir = -1; return false; }
  if (H.ph === 'ut') {
    p.bridgeDir = Math.sign(q.bridgeT - p.bridgeT) || 1;
    p.bridgeT += p.bridgeDir * bridgeSpeed(p) * 2 * dt; p.walkPhase += dt * 8;
    if (Math.abs(p.bridgeT - q.bridgeT) < 0.04) { p.bridgeT = q.bridgeT - 0.03 * (q.bridgeDir || 1); H.ph = 'leder'; q.frozen = false; }
    return true;
  }
  // leder: följer bredvid den höjdrädda
  p.bridgeDir = q.bridgeDir; p.bridgeT = q.bridgeT - 0.03 * q.bridgeDir; p.walkPhase = q.walkPhase;
  return true;
}
/** framme vid Kronans dörr @param {Person} p */
function atKronan(p) {
  const X = SW();
  if (p.bridgeHelp) { p.bridgeDir = -1; return; }
  if (p.robber) { robberAcross(p); return; }
  if (p.evac && S.fire) {
    p.state = 'kronan'; p.kronanEvac = true; X.evac++; S.stats.evacuated++;
    pev(p, sv`I säkerhet i ${KRONAN} – väntar i deras sky lobby tills branden är släckt`);
    return;
  }
  if (p.kronanLunch) {
    p.state = 'kronan'; p.kronanUntil = hour() + rand(0.7, 1.1); X.lunch++;
    pev(p, sv`Äter lunch på ${KRONAN}s Krog`);
    return;
  }
  // grannen går hem till sitt eget kontor (eller någon annan som skulle ut den vägen)
  pev(p, sv`Tillbaka i ${KRONAN}`);
  leaveBuilding(p);
}
/** framme vid Tornets dörr i sky lobbyn @param {Person} p */
function atTornet(p) {
  p.floor = SKYWALK_F; p.x = SKYWALK_DOOR; p.fromBridgeT = S.t; p.state = 'toQueue';
  if (p.bridgeHelp) {
    p.bridgeHelp = false; p.state = 'office'; p.spot = doorSpot('Står vid dörren till bron'); p.timer = 0;
    dutyDone(p); // (uppdraget är klart: vaktmästaren går vidare med sitt, crew.js)
    return;
  }
  if (p.kronanEvac) {
    p.kronanEvac = false; p.evac = false;
    if (!fireReturn(p, sv`Branden är släckt – tillbaka från ${KRONAN}`)) setTrip(p, p.exitFloor, 'Går hem efter branden', true);
    return;
  }
  if (p.kronanLunch) {
    p.kronanLunch = false;
    setTrip(p, p.home ?? LOBBY, sv`Tillbaka från lunchen i ${KRONAN} – till jobbet på ${FL[p.home ?? LOBBY].short}`, false);
    return;
  }
  const goal = p.bridgeGoal ?? LOBBY;
  setTrip(p, goal, p.bridgeWhy || 'Kommer från Kronan', goal === p.exitFloor && goal !== SKYWALK_F);
  p.bridgeGoal = undefined;
}
/** inne i Kronan: tillbaka när lunchen är slut eller branden släckt @param {Person} p */
function inKronanTick(p) {
  const back = p.kronanEvac ? !S.fire : hour() >= (p.kronanUntil ?? 0);
  if (!back) return;
  if (canComeIn() || (p.kronanEvac && canGoOut())) {
    p.state = 'bridge'; p.bridgeT = 1; p.bridgeDir = -1; SW().n++; S.stats.bridge++;
    pev(p, p.kronanEvac ? sv`Branden är släckt – går tillbaka över bron från ${KRONAN}` : 'Mätt – går tillbaka över bron');
    return;
  }
  // bron är stängd: ner genom Kronan och in genom Tornets entré
  p.state = 'toQueue'; p.floor = LOBBY; p.x = -30 - rand(0, 20);
  const evac = p.kronanEvac;
  p.kronanEvac = false; p.kronanLunch = false; p.evac = false;
  if (evac) { if (!fireReturn(p, 'Tillbaka in efter branden – via entrén')) leaveBuilding(p); return; }
  setTrip(p, p.home ?? LOBBY, sv`Bron är stängd – tillbaka via gatan och entrén`, false);
}

// ---------- Kuppen: bron som flyktväg (heist.js) ----------
/** rånarna springer över bron (heist.js anropar när alla är framme i sky lobbyn) @param {Person[]} gang */
export function gangOverBridge(gang) {
  for (const p of gang) {
    releaseSpot(p);
    p.state = 'bridge'; p.bridgeT = 0; p.bridgeDir = 1; p.spot = null; p.x = SKYWALK_DOOR;
    pev(p, sv`Springer över bron till ${KRONAN} med guldet`);
  }
}
/** hooks till heist.js (sätts där, så att skywalk.js inte behöver importera kuppen) */
export const heistHook = { across: /** @type {(p: Person) => void} */ (() => {}) };
/** @param {Person} p */
function robberAcross(p) { heistHook.across(p); }

// ---------- Stormen: stäng bron eller håll den öppen med vakt ----------
/** Beslutet i stormen: 'close' (stäng bron) eller 'open' (öppen med vakt). by = 'chief' eller 'player'. */
export function setBridgeStorm(mode, by) {
  const X = S.skywalk;
  if (!X || SKYWALK_F < 0 || !S.storm || (mode !== 'close' && mode !== 'open')) return false;
  if (X.storm === mode) return true;
  X.storm = mode; X.by = by;
  log(mode === 'close' ? sv`🚧 Bron till ${KRONAN} stängs i stormen – den som är ute får gå klart`
    : sv`🌉 Bron till ${KRONAN} hålls öppen i stormen – en väktare står vid dörren`, 'alert');
  return true;
}

// ---------- Göran i Kronan ----------
const GORAN_LINES = [
  'Hur går det hos er? Här rullar det på.',
  'Vår Hiss-O-Matic 4000 har ingen musik i hissarna. Era har väl fortfarande kassett?',
  'Er panoramahiss skymmer vår utsikt, bara så ni vet.',
  'Vi fick nya tätningslister i bron i förra veckan. Känns det?',
  'Har ni kanelbullar i Sky Café i dag? Jag frågar åt en kollega.',
  'Fyra hissar i vår höga zon, och alla står still när man behöver dem.',
  'Säg till er fönsterputsare att Jörgen hälsar.',
  'Det drar lite i bron i dag. Ingen fara.',
];
function goranTalk() {
  const h = hour();
  const line = S.storm ? 'Det blåser rejält hos er också? Bron svajar hit.'
    : S.fire ? 'Vi ser röken härifrån! Säg till om ni behöver vår sky lobby.'
      : h >= 11.2 && h < 12.8 ? sv`Kön till ${KRONAN}s Krog går ända ut på bron. Era är välkomna!`
        : pick(GORAN_LINES);
  log(sv`📻 ${GORAN} i ${KRONAN}: ${line}`, 'chief');
}

// ---------- Dygnet ----------
export function skywalkReset() {
  S.skywalk = { storm: '', by: '', maint: SKYWALK_F >= 0 && rng() < 0.25, maintNoted: false, closedNoted: '', talkAt: S.t + rand(60, 120),
    n: 0, neighbors: 0, lunch: 0, evac: 0 };
}
/** mjukt dygnsskifte: en ny underhållsnatt (stormens beslut följer med en storm som pågår) */
export function skywalkRoll() {
  const X = S.skywalk;
  if (!X) { skywalkReset(); return; }
  X.maint = rng() < 0.25; X.maintNoted = false; X.n = 0; X.neighbors = 0; X.lunch = 0;
  if (!S.storm) X.storm = '';
  // (bron stänger på natten: den som var i Kronan över natten går hem därifrån)
  for (const p of S.people) if (!p.dead && p.state === 'kronan' && !p.kronanEvac) { p.kronanLunch = false; leaveBuilding(p); }
}
