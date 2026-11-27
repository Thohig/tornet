// Hunden som rymmer: en pudel sliter sig ur kopplet (eller smiter ut ur kenneln på Vovve Spa) och springer runt
// i huset (S.dog). Hunden är en person i huset (p.dog, rollen 'hund') som springer fortare än folk, åker med
// vilken hiss som helst och stannar en stund på varje våning: nosar, äter någons munk, gömmer sig. Ägaren (p.chase)
// – eller hundfrisören om hunden kom från kenneln – jagar den, och vaktmästaren får uppdraget (crew.js). Hunden
// fångas när någon som jagar den står på samma våning medan den står still. Den tröttnar till slut och lägger sig.
// Driftchefen kan spärra hissarna på hundens våning (lock): då kommer den ingenstans – men den som väntar på
// hiss där får ta trappan (canTake i dispatch.js).
// (Simulering: läget ligger i S.dog. Egen slumpström.)
//
// Översikt:
// hunden som rymmer (`S.dog`, incident och `act('trigger', 'dog')`): en pudel sliter sig ur kopplet hos en ägare i
// hallen – annars smiter den ut ur kenneln på Vovve Spa och hundfrisören (rollen `hundfrisör`) jagar. Hunden är en
// person (`p.dog`, rollen `hund`, ritas som pudel i pixfolk.js och pixcars.js) som springer fortare, åker en hiss
// till en våning den når direkt (`dogNext`) och stannar en stund (`dogTimer`); ägaren/frisören (`p.chase`,
// `chaseNext`) och vaktmästaren (uppdraget `dog`, flyttas med `moveDuty`) jagar den. Fångad när någon som jagar står
// på samma våning medan den står still (`CATCH_T`); trött efter `DOG_TIRED_S`. Driftchefen (`dogChiefTick`) eller
// spelaren (`act('dog', 'lock'|'free')`) kan spärra hissarna på hundens våning (`dogLockFloor`, i `canTake` i
// dispatch.js – bara de som jagar kommer därifrån). Egen slumpström `hunden`
import { stream } from './rng.js';
import { sv } from './sv.js';
const { pick, rand, rng } = stream('hunden');
import { cap, fl } from './util.js';
import { EL, FL, FLOORS, LOBBY, SKY, floorWith } from './config.js';
import { S, incidentOver, log } from './state.js';
import { blankPerson, makePerson, pev, pn, releaseSpot, setTrip } from './people.js';
import { inFireZone, rebuildPicks } from './dispatch.js';
import { callJanitor, dutyDone, moveDuty, onDuty } from './crew.js';
import { incidentStarted } from './incidents.js';
/** @typedef {import('./people.js').Person} Person */

/**
 * Hunden som är lös (S.dog). dog/owner/jan = personernas id; f = våningen den är på (eller senast var på);
 * lock = hissarna på hundens våning tar inga nya; floors = våningarna den hunnit besöka; rides = hissresor;
 * stops = hur många gånger den stannat; catchT = hur länge någon stått bredvid den; ph = loose → done.
 * @typedef {{ t0: number, ph: string, dog: number, owner: number, jan: number, name: string, f: number, lock: boolean, lockBy: string,
 *   floors: number[], rides: number, stops: number, catchT: number, by: string, kennel: boolean, t1: number, tired: boolean, out: string }} Dog
 */
const SPA = floorWith('spa');
/** hundnamnen (pudlarna på Vovve Spa) */
const DOG_NAMES = ['Fifi', 'Pompe', 'Trissan', 'Sixten', 'Bella', 'Kajsa', 'Lord Bubbel'];
/** vad hunden gör när den stannar */
const SNIFF = ['Nosar på en krukväxt', 'Äter upp någons munk', 'Gömmer sig bakom en papperskorg', 'Skäller på hissdörrarna',
  'Jagar sin egen svans', 'Rullar sig på mattan', 'Hälsar glatt på alla', 'Dricker ur någons kaffekopp'];
/** så länge (s) står den som jagar bredvid hunden innan den är fångad */
export const CATCH_T = 2.5;
/** efter så lång tid (s) tröttnar hunden och lägger sig */
export const DOG_TIRED_S = 200;
/** hundens figur (ritas som en pudel, pixfolk.js och pixcars.js) */
const DOG_LOOK = { skin: '#f2f2f2', shirt: '#f2f2f2', pants: '#f2f2f2', hair: 0, hairC: '#f2f2f2', tie: false, tieC: '#ff4fa3', stripe: false, acc: 0 };

/** kan en hund rymma just nu? (hundsalongen har öppet, inte brand) */
export const dogPossible = () => SPA >= 0 && !S.dog && !S.fire && S.power;
const byId = id => S.people.find(p => p.id === id && !p.dead) || null;
/** Spelaren eller slumpen: en pudel sliter sig. Ägaren som har en pudel i koppel i hallen, annars rymmer en ur kenneln. */
export function startDog() {
  if (!dogPossible()) return false;
  // en ägare med pudel i koppel som syns (i kön eller på väg genom hallen) – annars kenneln på Vovve Spa
  const owner = S.people.find(p => !p.dead && p.cargo && (p.cargo.kind === 'pudel' || p.cargo.kind === 'raggig')
    && (p.state === 'wait' || p.state === 'toQueue') && !p.role && !inFireZone(p.floor)) || null;
  const f = owner ? owner.floor : SPA, name = pick(DOG_NAMES);
  const dog = blankPerson('vis', f, owner ? owner.x + 14 : 300, { name, look: { ...DOG_LOOK }, kg: owner && owner.cargo ? owner.cargo.kg : 8,
    fit: 0, speedMul: 1.7, depth: -1, patience: 999, space: 9, polite: false });
  dog.role = 'hund'; dog.dog = true; dog.title = owner ? sv`Pudel – ${owner.name}s` : 'Pudel från kenneln på Vovve Spa';
  dog.task = SNIFF[0];
  let chaser = owner;
  if (owner) {
    owner.cargo = null;
    owner.chase = true;
    // (ägaren lämnar kön och ropar efter hunden)
    const x = owner.x; setTrip(owner, owner.floor, sv`Ropar på ${name}`, false); owner.x = x;
    pev(owner, sv`${name} slet sig ur kopplet! ${name.toUpperCase()}! KOM HIT!`);
  } else {
    // hundfrisören från Vovve Spa springer efter
    chaser = makePerson('staff', SPA, 420);
    chaser.role = 'hundfrisör'; chaser.chase = true; chaser.title = 'Hundfrisör på Vovve Spa'; chaser.exitFloor = LOBBY;
    chaser.state = 'office'; chaser.timer = 0.5;
    chaser.spot = { x: 420, k: 'stand', face: -1, temp: true, win: 'hall', desc: sv`Ropar på ${name}` };
    S.people.push(chaser);
    pev(chaser, sv`${name} smet ut ur kenneln! Efter henne!`);
  }
  S.people.push(dog);
  S.dog = { t0: S.t, ph: 'loose', dog: dog.id, owner: chaser ? chaser.id : -1, jan: -1, name, f, lock: false, lockBy: '',
    floors: [f], rides: 0, stops: 0, catchT: 0, by: '', kennel: !owner, t1: 0, tired: false, out: '' };
  // hunden springer iväg direkt
  const first = dogNext(dog) || [LOBBY, 'Springer!', false];
  setTrip(dog, first[0], first[1], false);
  S.fx.push({ x: dog.x, y: 0, text: 'VOFF!', color: '#ffffff', life: 1.4 });
  log(owner ? sv`🐕 ${name} sliter sig ur kopplet hos ${pn(owner)} på ${fl(f)} – hunden är lös i huset!` : sv`🐕 Pudeln ${name} smiter ut ur kenneln på Vovve Spa (${fl(f)}) – hunden är lös i huset!`, 'alert', null, dog.id);
  incidentStarted(f);
  return true;
}
/** Spärra hissarna på hundens våning (lock = true) eller släpp dem (by = 'chief' eller 'player') */
export function setDogLock(lock, by) {
  const D = S.dog;
  if (!D || D.ph !== 'loose' || D.lock === !!lock) return false;
  D.lock = !!lock; D.lockBy = by;
  log(lock ? sv`🐕 Hissarna på ${fl(D.f)} tar inga nya – ${D.name} ska inte komma därifrån` : sv`🐕 Hissarna på ${fl(D.f)} går som vanligt igen`, 'alert');
  const dog = byId(D.dog);
  // (hunden som står i kön ger upp och nosar runt i hallen)
  if (lock && dog && dog.state === 'wait') { setTrip(dog, dog.floor, 'Hissen kommer inte – nosar runt i hallen', false); }
  rebuildPicks();
  return true;
}
/** hunden står still i hallen – nosar (office) eller står i hisskön (wait): där kan den fångas och hissarna
 *  spärras @param {Person} p */
export const dogStill = p => p.state === 'office' || p.state === 'wait';
/** våningen där hissarna är spärrade för hunden, eller -1 */
export const dogLockFloor = () => (S.dog && S.dog.ph === 'loose' && S.dog.lock ? S.dog.f : -1);
/** hundens nästa beslut (rollogiken i people.js): en ny våning den kan åka till direkt, eller stanna @param {Person} p */
export function dogNext(p) {
  const D = S.dog;
  if (!D || D.ph !== 'loose') return null;
  if (D.lock || D.tired) return null;
  // våningar som någon hiss som tar hunden här går till direkt (den byter aldrig hiss)
  const here = p.floor, opts = new Set();
  for (const d of EL) if (!d.freight && d.stops.includes(here)) for (const f of d.stops) if (f !== here && !inFireZone(f) && f !== SKY) opts.add(f);
  if (!opts.size) return null;
  const f = pick([...opts].sort((a, b) => a - b));
  return [f, sv`Springer till ${fl(f)}`, false];
}
/** hundens plats i hallen när den stannar @param {Person} p */
export function dogSpot(p) {
  p.task = pick(SNIFF);
  return { x: rand(380, 560), k: 'stand', face: rng() < 0.5 ? 1 : -1, temp: true, win: 'hall', desc: p.task };
}
/** den som jagar hunden: dit hunden är (null = stanna) @param {Person} p */
export function chaseNext(p) {
  const D = S.dog;
  if (!D || D.ph !== 'loose') { p.chase = false; return null; }
  if (p.floor === D.f || inFireZone(D.f)) return null;
  return [D.f, sv`Jagar ${D.name} – hunden är på ${fl(D.f)}`, false];
}
/** platsen för den som jagar: nära hunden i hallen @param {Person} p */
export function chaseSpot(p) {
  const D = S.dog, dog = D ? byId(D.dog) : null;
  return { x: dog && dog.floor === p.floor ? Math.max(300, dog.x - 30) : 360, k: 'stand', face: 1, temp: true, win: 'hall',
    desc: D ? sv`Ropar på ${D.name}` : 'Andas ut' };
}
/** hundens rumstid (i speltid, som personalen): lite längre för varje stopp – den börjar bli trött */
export const dogTimer = () => rand(4, 8) * (1 + (S.dog ? S.dog.stops : 0) * 0.15);

// ---------- Varje steg ----------
export function dogTick(dt) {
  const D = S.dog;
  if (!D) return;
  const dog = byId(D.dog);
  if (D.ph === 'done') {
    if (!S.people.some(p => p.chase && !p.dead)) S.dog = null;
    return;
  }
  // hunden sprang ut genom entrén (utrymningen vid brand)
  if (!dog) { finish(D, null, 'out'); return; }
  // hundens våning: där den står, eller dit den är på väg
  const was = D.f;
  if (dog.state !== 'ride' && dog.state !== 'boarding') D.f = dog.floor;
  if (dog.state === 'ride' && D.floors.length && dog.car && D.out !== `r${dog.trips}`) { D.out = `r${dog.trips}`; D.rides++; }
  if (D.f !== was) {
    if (!D.floors.includes(D.f)) D.floors.push(D.f);
    for (const p of S.people) if (p.chase && p.state === 'office') p.timer = 0;
  }
  // vaktmästaren jagar också
  let jan = byId(D.jan);
  if (!jan || !jan.duty || jan.duty.kind !== 'dog') { jan = callJanitor('dog', D.f, sv`Hjälper till att fånga ${D.name}`, sv`Försöker locka till sig ${D.name}`); D.jan = jan.id; }
  else moveDuty(jan, D.f, sv`Jagar ${D.name} – hunden är på ${fl(D.f)}`, sv`Försöker locka till sig ${D.name}`);
  // trött: hunden lägger sig och väntar på att bli hämtad
  if (!D.tired && S.t - D.t0 > DOG_TIRED_S && dog.state !== 'ride' && dog.state !== 'boarding') {
    D.tired = true; log(sv`🐕 ${D.name} är trött och lägger sig på ${fl(dog.floor)}`, 'alert', null, dog.id);
    // (står den i hisskön ger den upp och lägger sig i hallen)
    if (dog.state === 'wait') { setTrip(dog, dog.floor, 'Trött – lägger sig i hallen', false); rebuildPicks(); }
  }
  // fångad: någon som jagar står på samma våning medan hunden står still (nosar i hallen eller står i hisskön)
  const near = dogStill(dog) ? S.people.find(p => !p.dead && p.floor === dog.floor && p.state === 'office' && (p.chase || onDuty(p, 'dog'))) : null;
  D.catchT = near ? D.catchT + dt : 0;
  if (near && D.catchT >= CATCH_T) finish(D, near, 'caught');
}
/** hunden stannar på en våning (exitDone i people.js) @param {Person} p */
export function dogArrived(p) {
  const D = S.dog;
  if (!D) return;
  D.stops++;
  S.fx.push({ x: p.x, y: 0, text: 'VOFF!', color: '#ffffff', life: 1.2 });
}
/** @param {Dog} D @param {Person|null} by */
function finish(D, by, how) {
  D.ph = 'done'; D.t1 = S.t; D.by = by ? by.name : '';
  const dog = byId(D.dog), owner = byId(D.owner), jan = byId(D.jan);
  dutyDone(jan);
  if (dog) { const queued = dog.state === 'wait'; releaseSpot(dog); dog.dead = true; dog.state = 'away'; if (queued) rebuildPicks(); }
  if (owner) {
    // ägaren får tillbaka hunden i koppel (hundfrisören bär tillbaka den till kenneln)
    owner.cargo = { kind: 'pudel', name: D.kennel ? sv`${D.name} (rymlingen)` : 'pudel i koppel', kg: 8 };
    owner.chase = false;
    if (owner.state === 'office') owner.timer = 0;
    pev(owner, how === 'caught' ? sv`Äntligen! ${D.name} är fångad – hem nu, och kopplet sitter KVAR` : sv`${D.name} sprang ut på gatan – där är hon!`);
  }
  for (const p of S.people) if (p.chase && p !== owner) p.chase = false;
  const sec = Math.round(D.t1 - D.t0), n = D.floors.length;
  const line = how === 'caught' ? sv`${by && by.id === D.owner ? (D.kennel ? 'hundfrisören' : 'ägaren') : by ? by.name : 'någon'} fångade ${D.name} på ${fl(D.f)}` : sv`${D.name} sprang ut genom entrén och hittades på gatan`;
  log(sv`🐕 ${cap(line)} efter ${sec} s`, 'alert');
  incidentOver('dog', sv`🐕 ${D.name} är fångad`, sv`${D.name} var lös i ${sec} s, hann till ${n} ${n === 1 ? 'våning' : 'våningar'} och åkte hiss ${D.rides} ${D.rides === 1 ? 'gång' : 'gånger'} – ${line}.`
    + (D.lock ? ' Hissarna på hundens våning var spärrade en stund.' : ''), { floor: D.f });
}
/** hundfrisörens nästa beslut: tillbaka till kenneln med hunden, sedan ut @param {Person} p */
export function groomerNext(p) {
  if (p.chase) return chaseNext(p);
  if (p.cargo && SPA >= 0) {
    if (p.floor !== SPA) return [SPA, sv`Bär tillbaka ${p.cargo.name} till kenneln`, false];
    // (hundfrisören går in i salongen igen – hen jobbar där)
    p.cargo = null; pev(p, 'Pudeln är tillbaka i kenneln – och dörren är LÅST');
    releaseSpot(p); p.dead = true;
    return null;
  }
  return SPA >= 0 ? [SPA, 'Tillbaka till salongen', false] : [p.exitFloor, 'Tillbaka till jobbet'];
}
/** dygnet börjar om (resetDay) */
export function dogReset() { S.dog = null; }
/** våningens namn för korten */
export const dogPlace = D => `${fl(D.f)} · ${FL[Math.min(D.f, FLOORS - 1)].short}`;
