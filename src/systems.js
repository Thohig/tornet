// Registret över husets delsystem och incidenter: en post per delsystem, i den ordning de tickar.
// sim.js (tick, nollställning, dygnsskifte), incidents.js (framkallning, tidtabell, förvarning), chief.js
// (driftchefens beslut och när de upphör) och chaos.js (när det har lugnat sig) går igenom listan i stället
// för att räkna upp delsystemen var för sig. En ny incident = en ny modul och en post här (plus kortet i
// hud.js, regissören, knappen i panels.js och texterna i lang-en.js).
//
// Ordningen är simuleringens: posterna tickar, nollställs och rullar i listans ordning, och tidtabellen
// väger incidenterna i listans ordning (dragningen ur slumpen beror på den). Lägg nya poster sist om det
// inte finns skäl till annat – att flytta en post ändrar dygnen (facit larmar).
//
// Översikt:
// registret över delsystemen och incidenterna: `systems()` = en post per delsystem i tickordning (`System`): hur det
// tickar, nollställs och rullar (`tick`, `reset`, `roll`); incidenten – `on` (pågår), `trigger`, tidtabellens
// `weight`/`pick`, förvarningen `warnS`/`warn`/`hit`, driftchefens `chief` (`tick`/`done`/`cleared`), kaosknappens
// `chaos` (steg, namn, `run`) och rundvisningens `detour`; folket och hissarna – `roles` (rollens nästa mål,
// `sysRole`), `next` (delsystemet bestämmer vart någon går), `spot` (var hen står), `arrive` (timern när hen är
// framme), `blocks` (får inte kliva på här) och `out` (varför hissen inte tar nya: kapad, blött schakt). `sim.js`,
// `incidents.js`, `chief.js`, `chaos.js`, `visning.js`, `people.js` och `dispatch.js` frågar registret i stället för
// att känna till incidenterna (snabbtabellerna i `index()`). Listans ordning är simuleringens – en ny post läggs
// sist (att flytta en ändrar dygnen). Brand och strömavbrott är kärnans egna och läses direkt (`S.fire`, `S.outage`)
import { S, hour } from './state.js';
import { fl } from './util.js';
import { floorOpen, floorWith, LOBBY, OFFICE_FLOORS } from './config.js';
import { lifeReset, lifeRoll, lifeTick } from './life.js';
import { trainReset, trainTick } from './train.js';
import { medicNext, moverNext, startMedical, visitsReset, visitsRoll, visitsTick } from './visits.js';
import { tourReset, tourTick } from './tour.js';
import { visningReset, visningTick } from './visning.js';
import { BANK, HEIST_WARN, heistOn, heistPossible, heistReset, heistSpot, heistTick, hostageNext, orderHeist, robberNext, startHeist } from './heist.js';
import { hoistReset, hoistTick } from './hoist.js';
import { gondolaCandidate, gondolaCrewNext, gondolaReset, gondolaTick, triggerGondola } from './gondola.js';
import { chaseNext, chaseSpot, dogArrived, dogLockFloor, dogNext, dogPossible, dogReset, dogSpot, dogTick, dogTimer, groomerNext, startDog } from './dog.js';
import { leakPossible, leakReset, leakTick, startLeak } from './leak.js';
import { startStorm, stormTick, weatherReset } from './weather.js';
import { PANO, panoCandidate, rescueNext, triggerPano } from './pano.js';
import { cableCandidate, foremanNext, techNext, triggerCable, triggerFault, triggerHeat } from './service.js';
import { busyCars, cableRisk, ffNext, FIRE_FLOORS, incidentStarted, incPick, startFire, startOutage } from './incidents.js';
import { crashChiefTick, tunnelChiefTick, panicChiefTick, partyChiefTick, rulltrappaChiefTick, dogChiefTick, gondolaChiefTick, leakChiefTick, panoChiefTick } from './chief.js';
import { arrivalRate } from './sim.js';
import { sv } from './sv.js';
import { crashPossible, crashReset, crashTick, startCrash } from './crash.js';
import { tunnelPossible, tunnelReset, tunnelTick, startTunnel } from './tunnel.js';
import { panicPossible, panicReset, panicTick, startPanic } from './panic.js';
import { partyArrive, partyNext, partyPossible, partyReset, partyTick, startParty } from './party.js';
import { rulltrappaPossible, rulltrappaReset, rulltrappaTick, startRulltrappa } from './rulltrappa.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./incidents.js').IncPick} IncPick */
/** @typedef {import('./people.js').Person} Person */

/**
 * Ett delsystem. Allt är frivilligt utom key.
 * - tick(dt): varje steg, före folket (i listans ordning)
 * - reset(): nytt dygn från början (resetDay); roll(): mjukt dygnsskifte (rollDay) – utan roll fortsätter delsystemet som det är
 * - on(): incidenten pågår (kaosknappen väntar tills ingen gör det)
 * - trigger(target, e): framkalla den (act('trigger', key, target)); e = hissen target när target är ett hiss-id
 * - weight(): hur troligt tidtabellen väljer den just nu (0/false = går inte); pick(): var den händer (våning/hiss)
 * - warnS, warn(e, W): förvarningens längd (s) och loggrad; hit(W, e): förvarningen är slut – incidenten bryter ut
 * - chief: driftchefens del – tick() (när chefen är på), done() (beslutet gäller inte längre), cleared() (städa efter)
 * Folket och hissarna (people.js och dispatch.js frågar registret i stället för att känna till incidenterna):
 * - roles: rollens nästa mål (roll → (p, h) => [våning, varför] | null; undefined = inte min sak, nästa post frågas)
 * - next(p): delsystemet bestämmer vart p går (före rollen; undefined = inte min sak)
 * - spot(p, f): var p står på våningen (undefined = inte min sak); arrive(p): p är framme – sätter p.timer (true = klart)
 * - blocks(e, p): p får inte kliva på e där p står
 * - out: varför en hiss inte tar nya ({ id, text, test(e) }; seized = ingen kan använda den, inte ens för att ta trappan i stället)
 * Kaosknappen och rundvisningen:
 * - chaos: steget i Murphys lag där incidenten startas (chaos.js: 'cars' = hissarna, 'guests' = besökarna), namnet i
 *   sammanfattningen och run() = starta den nu (sant om den blev av)
 * - detour(here): guiden lägger om rutten hit ({ k, f, title, oj, there, over, missed, hold? } – Detour i visning.js utan at/t)
 * @typedef {any[]|null} NextGoal [våning, varför, …] eller null (stanna)
 * @typedef {{ id: string, text: string, test: (e: Elevator) => boolean, seized?: boolean }} OutRule
 * @typedef {{ key: string, tick?: (dt: number) => void, reset?: () => void, roll?: () => void, on?: () => boolean,
 *   trigger?: (target: number|null, e: Elevator|null) => any, weight?: () => number|false, pick?: () => Partial<IncPick>,
 *   warnS?: number, warn?: (e: Elevator|null, W: IncPick) => string, hit?: (W: IncPick, e: Elevator|null) => void,
 *   chief?: { tick?: () => void, done: () => boolean, cleared?: () => void },
 *   roles?: Record<string, (p: Person, h: number) => NextGoal|undefined>, next?: (p: Person) => NextGoal|undefined,
 *   spot?: (p: Person, f: number) => any, arrive?: (p: Person) => boolean, blocks?: (e: Elevator, p: Person) => boolean,
 *   out?: OutRule, chaos?: { step: string, name: string, run: () => any },
 *   detour?: (here: number) => { k: string, f: number, title: string, oj: string, there: () => string, over: () => boolean, missed: string, hold?: boolean }|null }} System
 */

/** @type {System[]|null} */
let list = null;
/** Alla delsystem i tickordning. (Byggs första gången den anropas: modulerna importerar varandra i en ring.) */
export function systems() {
  return list ??= [
    { key: 'life', tick: lifeTick, reset: lifeReset, roll: lifeRoll },
    { key: 'train', tick: dt => trainTick(dt, arrivalRate), reset: trainReset, roll: () => { if (!S.train) trainReset(); } },
    { key: 'visits', tick: visitsTick, reset: visitsReset, roll: visitsRoll, roles: { 'flyttgubbe': moverNext, 'ambulans': medicNext } },
    { key: 'medical', trigger: () => startMedical() }, // (ingen incident – bara en händelse som rutan berättar om)
    { key: 'tour', tick: tourTick, reset: tourReset },
    { key: 'visning', tick: visningTick, reset: visningReset },
    // --- incidenterna i incidents.js och service.js ---
    { key: 'fire', on: () => !!S.fire, trigger: t => startFire(FIRE_FLOORS.includes(t) ? t : undefined),
      weight: () => !S.fire && 1, pick: () => ({ floor: incPick(OFFICE_FLOORS.slice(1)) }),
      warnS: 10, warn: (_e, W) => sv`👃 Det luktar bränt på våning ${fl(W.floor)}…`, hit: W => startFire(W.floor),
      roles: { 'brandman': ffNext } },
    { key: 'power', on: () => !!S.outage, trigger: () => startOutage(), weight: () => S.power && 1,
      warnS: 6, warn: () => '💡 Lamporna i huset flimrar…', hit: () => startOutage() },
    { key: 'fault', trigger: (_t, e) => triggerFault(e), weight: () => busyCars().length > 0 && 1.2,
      pick: () => { const busy = busyCars(), act = busy.filter(e => e.passengers.length || e.carCalls.size); return { car: incPick(act.length ? act : busy).id }; },
      warnS: 8, warn: e => sv`🔩 ${e.name} låter konstigt – det gnisslar i korgen…`, hit: (_W, e) => { if (e) triggerFault(e); },
      roles: { 'hisstekniker': techNext, 'arbetsledare': foremanNext }, chaos: { step: 'cars', name: '🔧 hissfel', run: () => triggerFault() } },
    { key: 'storm', on: () => !!S.storm, trigger: () => { if (startStorm()) incidentStarted(null); }, weight: () => !S.storm && 0.8,
      warnS: 14, warn: () => '🌥️ Det mörknar över staden och vinden friskar i…', hit: () => { if (startStorm()) incidentStarted(null); } },
    // motorvärme: varmare dag och hissar som redan går varma gör det troligare
    { key: 'heat', trigger: (_t, e) => triggerHeat(e),
      weight: () => { const busy = busyCars(); return busy.length > 0 && 0.4 + Math.max(0, S.weather.temp - 15) * 0.06 + Math.max(...busy.map(e => e.heat)) * 0.6; },
      pick: () => ({ car: [...busyCars()].sort((a, b) => b.heat - a.heat || b.passengers.length - a.passengers.length)[0].id }),
      warnS: 10, warn: e => sv`🌡️ Motorn i ${e.name}s maskinrum brummar ansträngt…`, hit: (_W, e) => { if (e) triggerHeat(e); } },
    // linorna i den mest slitna hissen kan gå av (bara om de är rejält slitna)
    { key: 'cable', trigger: (_t, e) => triggerCable(e), weight: () => { const cr = cableRisk(); return !!cr && cr.w; },
      pick: () => ({ car: cableRisk().e.id }),
      warnS: 40, warn: e => sv`🪢 Det knarrar i bärlinorna på ${e.name} – de är slitna (${Math.round(e.wear * 100)} %)…`,
      hit: (_W, e) => { if (!e) return; e.creak = false; if (cableCandidate(e)) triggerCable(e); },
      chaos: { step: 'cars', name: '🪢 linbrott', run: () => triggerCable() } },
    // panoramahissen kan fastna på fasaden (bara när den kör med folk)
    { key: 'pano', on: () => !!S.pano, trigger: () => triggerPano(),
      weight: () => { const P = PANO ? S.elevators[PANO.id] : null; return panoCandidate(P) && P.passengers.length > 0 && !S.pano && 0.3; },
      pick: () => ({ car: PANO.id }),
      warnS: 10, warn: e => sv`🔩 ${e.name} hackar på fasaden – det luktar hydraulolja…`,
      hit: (_W, e) => { if (e && panoCandidate(e) && !S.pano) e.panoNext = true; },
      chief: { tick: panoChiefTick, done: () => !S.pano || S.pano.ph === 'done' },
      roles: { 'räddare': p => (p.gondola ? undefined : rescueNext(p)) }, chaos: { step: 'cars', name: '🧗 fast på fasaden', run: () => triggerPano() },
      detour: () => (S.pano && S.pano.ph !== 'done' ? { k: `pano:${S.pano.t0}`, f: LOBBY, title: 'Fast på fasaden', oj: 'Panoramahissen sitter fast på fasaden! Kom, vi går ut på gatan och tittar',
        there: () => 'Titta upp! Panoramahissen sitter fast utanpå huset. Räddningstjänsten tar ner folk – med rep från taket eller stegbilens stege.',
        over: () => !S.pano || S.pano.ph === 'done', missed: 'Räddningstjänsten hann få ner alla innan vi kom ut.' } : null) },
    // Kuppen på 5:an: sällsynt, högst en gång per dygn, när lastkajen är ledig (heist.js)
    { key: 'heist', tick: heistTick, reset: heistReset, on: () => !!S.heist, trigger: () => orderHeist(),
      weight: () => heistPossible() && S.heistDay !== S.day && (S.incLevel === 'kaos' ? 0.5 : 0.2), pick: () => ({ floor: BANK }),
      warnS: 18, warn: () => HEIST_WARN, hit: () => { if (startHeist(true)) S.heistDay = S.day; },
      // (polisens insatsledare bestämmer under kuppen – heistChiefTick i chief.js, även när chefen är på rast)
      chief: { done: () => !S.heist || S.heist.ph === 'done', cleared: () => { const s = S.chief.seen; delete s.heistWait; delete s.heistPlan; delete s.heistSignal; } },
      // hjälten går dit kuppen säger, gisslan samlas i Sky Café; gänget står synligt i hallen och åker bara varuhissen
      next: p => (p.hero && heistOn() ? null : p.hostage ? hostageNext(p) : undefined),
      roles: { 'rånare': robberNext }, spot: (p, f) => (p.robber ? heistSpot(p, f) : undefined),
      arrive: p => { if (!p.robber) return false; p.timer = 3; return true; },
      out: { id: 'hijack', text: 'är kapad av rånarna', test: e => e.hijack, seized: true } },
    { key: 'hoist', tick: hoistTick, reset: hoistReset },
    // fönsterputsarens gondol kärvar (bara när han är ute och putsar, gondola.js)
    { key: 'gondola', tick: gondolaTick, reset: gondolaReset, on: () => !!S.gondola, trigger: () => triggerGondola(),
      weight: () => gondolaCandidate() && 0.35,
      warnS: 8, warn: () => '🔩 Det gnisslar i gondolens vinsch uppe på taket…', hit: () => triggerGondola(),
      chief: { tick: gondolaChiefTick, done: () => !S.gondola || S.gondola.ph === 'done' },
      roles: { 'räddare': p => (p.gondola ? gondolaCrewNext(p) : undefined) }, chaos: { step: 'cars', name: '🪟 fönsterputsaren fast', run: () => triggerGondola() } },
    // en pudel rymmer (dog.js)
    { key: 'dog', tick: dogTick, reset: dogReset, on: () => !!S.dog, trigger: () => startDog(),
      weight: () => dogPossible() && floorOpen(floorWith('spa'), hour()) && 0.4,
      warnS: 6, warn: () => '🐕 Det skäller ilsket uppe på Vovve Spa…', hit: () => startDog(),
      chief: { tick: dogChiefTick, done: () => !S.dog || S.dog.ph === 'done' },
      // hunden och de som jagar den: syns i hallen, stannar en stund; hissarna kan spärras där hunden är
      roles: { 'hund': dogNext, 'hundfrisör': groomerNext }, next: p => (p.chase && !p.role ? chaseNext(p) : undefined),
      spot: p => (p.dog ? dogSpot(p) : p.chase ? chaseSpot(p) : undefined),
      arrive: p => { if (p.dog) { p.timer = dogTimer(); dogArrived(p); return true; } if (p.chase || p.role === 'hundfrisör') { p.timer = 1.5; return true; } return false; },
      blocks: (_e, p) => p.floor === dogLockFloor() && p.state !== 'ride' && p.state !== 'boarding' && !p.chase && !p.duty,
      chaos: { step: 'guests', name: '🐕 lös hund', run: () => startDog() } },
    // ett vattenrör spricker (leak.js)
    { key: 'leak', tick: leakTick, reset: leakReset, on: () => !!S.leak, trigger: t => startLeak(t), weight: () => leakPossible() && 0.5,
      warnS: 10, warn: () => '💧 Det droppar från taket någonstans… och det knackar i rören', hit: () => startLeak(),
      chief: { tick: leakChiefTick, done: () => !S.leak },
      out: { id: 'wet', text: 'står still – det rinner vatten i schaktet', test: e => e.wetLock },
      chaos: { step: 'cars', name: '🚿 vattenläcka', run: () => startLeak() } },
    // Hiss-O-Matic 3000 kraschar (crash.js): hissarna går i nödläge (elevators.js och dispatch.js frågar crashRun/crashed)
    { key: 'crash', tick: crashTick, reset: crashReset, on: () => !!S.crash, trigger: () => startCrash(), weight: () => crashPossible() && 0.3,
      warnS: 8, warn: () => '🖥️ Skärmarna i driftcentralen fryser till en sekund… och en till', hit: () => startCrash(),
      chief: { tick: crashChiefTick, done: () => !S.crash },
      chaos: { step: 'cars', name: '🖥️ Hiss-O-Matic kraschar', run: () => startCrash() } },
    // tåget står i tunneln (tunnel.js): perrongen fylls, ersättningsbussar eller vänta
    { key: 'tunnel', tick: tunnelTick, reset: tunnelReset, on: () => !!S.tunnel, trigger: () => startTunnel(),
      weight: () => tunnelPossible() && hour() >= 7 && hour() < 21 && 0.3,
      warnS: 8, warn: () => '🚇 Det skrapar och gnisslar långt inne i tunneln…', hit: () => startTunnel(),
      chief: { tick: tunnelChiefTick, done: () => !S.tunnel || S.tunnel.ph !== 'stuck' },
      chaos: { step: 'guests', name: '🚇 tåget i tunneln', run: () => startTunnel() } },
    // panik i en fullsatt hiss som tvärstannar (panic.js): prata i nödtelefonen eller veva ner korgen
    { key: 'panic', tick: panicTick, reset: panicReset, on: () => !!S.panic && S.panic.ph !== 'wait', trigger: () => startPanic(),
      weight: () => panicPossible() && 0.3,
      warnS: 6, warn: () => '😰 Det är trångt och varmt i hissarna i dag…', hit: () => startPanic(),
      chief: { tick: panicChiefTick, done: () => !S.panic || S.panic.ph !== 'on' },
      chaos: { step: 'cars', name: '😱 panik i hissen', run: () => startPanic() } },
    // firmafesten (party.js): gästerna med ballonger och tårtan – varuhissen eller vilken hiss som helst
    { key: 'party', tick: partyTick, reset: partyReset, on: () => !!S.party, trigger: () => startParty(),
      weight: () => partyPossible() && 0.35,
      warnS: 8, warn: () => '🎈 Någon blåser upp ballonger på ett av kontoren…', hit: () => startParty(),
      chief: { tick: partyChiefTick, done: () => !S.party },
      next: partyNext, arrive: partyArrive,
      chaos: { step: 'guests', name: '🎈 firmafest', run: () => startParty() } },
    // rulltrappan stannar (rulltrappa.js): gå i den stillastående rulltrappan eller spärra av; people.js läser läget
    { key: 'rulltrappa', tick: rulltrappaTick, reset: rulltrappaReset, on: () => !!S.rulltrappa, trigger: () => startRulltrappa(),
      weight: () => rulltrappaPossible() && hour() >= 7 && hour() < 20 && 0.3,
      warnS: 8, warn: () => '🪜 Det gnisslar och skrapar i rulltrappan i entrén…', hit: () => startRulltrappa(),
      chief: { tick: rulltrappaChiefTick, done: () => !S.rulltrappa },
      chaos: { step: 'guests', name: '🪜 rulltrappan stannar', run: () => startRulltrappa() } },
    // vädret: stormen blåser (stormen som incident är posten storm ovan); en storm som pågår följer med över dygnsskiftet
    { key: 'weather', tick: stormTick, reset: weatherReset, roll: () => { const st = S.storm; weatherReset(); S.storm = st; } },
  ];
}
/** Snabbtabeller ur registret (frågas många gånger per steg) */
/** @type {{ roles: Map<string, ((p: Person, h: number) => NextGoal|undefined)[]>, next: System[], spot: System[], arrive: System[], blocks: System[], out: OutRule[] }|null} */
let idx = null;
function index() {
  if (idx) return idx;
  const all = systems(), roles = new Map();
  for (const s of all) for (const [r, fn] of Object.entries(s.roles || {})) { if (!roles.has(r)) roles.set(r, []); roles.get(r).push(fn); }
  return idx = { roles, next: all.filter(s => s.next), spot: all.filter(s => s.spot), arrive: all.filter(s => s.arrive),
    blocks: all.filter(s => s.blocks), out: all.filter(s => s.out).map(s => s.out) };
}
/** rollens nästa mål ur registret (undefined = rollen hör inte till något delsystem) @param {Person} p */
export function sysRole(p, h) {
  const fns = (idx || index()).roles.get(p.role);
  if (!fns) return undefined;
  for (const fn of fns) { const r = fn(p, h); if (r !== undefined) return r; }
  return null;
}
/** bestämmer något delsystem vart p går? (undefined = nej) @param {Person} p */
export function sysNext(p) {
  for (const s of (idx || index()).next) { const r = s.next(p); if (r !== undefined) return r; }
  return undefined;
}
/** var p står enligt ett delsystem (undefined = inget delsystem bryr sig) @param {Person} p */
export function sysSpot(p, f) {
  for (const s of (idx || index()).spot) { const r = s.spot(p, f); if (r !== undefined) return r; }
  return undefined;
}
/** p är framme: sätter något delsystem timern? @param {Person} p */
export const sysArrive = p => (idx || index()).arrive.some(s => s.arrive(p));
/** får p inte kliva på e där p står (ett delsystem spärrar)? @param {Elevator} e @param {Person} p */
export const sysBlocks = (e, p) => { const b = (idx || index()).blocks; for (let i = 0; i < b.length; i++) if (b[i].blocks(e, p)) return true; return false; };
/** varför tar e inga nya enligt delsystemen ('' = inget hinder) @param {Elevator} e */
export function sysOut(e) {
  const o = (idx || index()).out;
  for (let i = 0; i < o.length; i++) if (o[i].test(e)) return o[i].id;
  return '';
}
/** är e tagen av ett delsystem så att ingen kan använda den (kapad)? @param {Elevator} e */
export const sysSeized = e => (idx || index()).out.some(o => o.seized && o.test(e));
/** loggtexterna för delsystemens orsaker (OUT_TEXT i dispatch.js) */
let outTexts = null;
export const sysOutText = () => outTexts ??= Object.fromEntries(index().out.map(o => [o.id, o.text]));
/** incidenterna som kaosknappen startar i steget step, i registrets ordning (chaos.js) */
export const chaosIn = step => systems().filter(s => s.chaos && s.chaos.step === step);
/** platserna dit guiden kan lägga om rundvisningen (visning.js) @returns {ReturnType<System['detour']>[]} */
export const detours = here => systems().filter(s => s.detour).map(s => s.detour(here)).filter(Boolean);
/** posten för en nyckel (eller undefined) */
export const system = key => systems().find(s => s.key === key);
/** pågår någon incident? */
export const anyIncident = () => systems().some(s => s.on && s.on());
