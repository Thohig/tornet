// Registret över husets delsystem och incidenter: en post per delsystem, i den ordning de tickar.
// sim.js (tick, nollställning, dygnsskifte), incidents.js (framkallning, tidtabell, förvarning), chief.js
// (driftchefens beslut och när de upphör) och chaos.js (när det har lugnat sig) går igenom listan i stället
// för att räkna upp delsystemen var för sig. En ny incident = en ny modul och en post här (plus kortet i
// hud.js, regissören, knappen i panels.js och texterna i lang-en.js).
//
// Ordningen är simuleringens: posterna tickar, nollställs och rullar i listans ordning, och tidtabellen
// väger incidenterna i listans ordning (dragningen ur slumpen beror på den). Lägg nya poster sist om det
// inte finns skäl till annat – att flytta en post ändrar dygnen (facit larmar).
import { S, hour } from './state.js';
import { fl } from './util.js';
import { floorOpen, floorWith, OFFICE_FLOORS } from './config.js';
import { lifeReset, lifeRoll, lifeTick } from './life.js';
import { trainReset, trainTick } from './train.js';
import { startMedical, visitsReset, visitsRoll, visitsTick } from './visits.js';
import { tourReset, tourTick } from './tour.js';
import { visningReset, visningTick } from './visning.js';
import { BANK, HEIST_WARN, heistPossible, heistReset, heistTick, startHeist } from './heist.js';
import { hoistReset, hoistTick } from './hoist.js';
import { gondolaCandidate, gondolaReset, gondolaTick, triggerGondola } from './gondola.js';
import { dogPossible, dogReset, dogTick, startDog } from './dog.js';
import { leakPossible, leakReset, leakTick, startLeak } from './leak.js';
import { startStorm, stormTick, weatherReset } from './weather.js';
import { PANO, panoCandidate, triggerPano } from './pano.js';
import { cableCandidate, triggerCable, triggerFault, triggerHeat } from './service.js';
import { busyCars, cableRisk, FIRE_FLOORS, incidentStarted, incPick, startFire, startOutage } from './incidents.js';
import { dogChiefTick, gondolaChiefTick, leakChiefTick, panoChiefTick } from './chief.js';
import { arrivalRate } from './sim.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./incidents.js').IncPick} IncPick */

/**
 * Ett delsystem. Allt är frivilligt utom key.
 * - tick(dt): varje steg, före folket (i listans ordning)
 * - reset(): nytt dygn från början (resetDay); roll(): mjukt dygnsskifte (rollDay) – utan roll fortsätter delsystemet som det är
 * - on(): incidenten pågår (kaosknappen väntar tills ingen gör det)
 * - trigger(target, e): framkalla den (act('trigger', key, target)); e = hissen target när target är ett hiss-id
 * - weight(): hur troligt tidtabellen väljer den just nu (0/false = går inte); pick(): var den händer (våning/hiss)
 * - warnS, warn(e, W): förvarningens längd (s) och loggrad; hit(W, e): förvarningen är slut – incidenten bryter ut
 * - chief: driftchefens del – tick() (när chefen är på), done() (beslutet gäller inte längre), cleared() (städa efter)
 * @typedef {{ key: string, tick?: (dt: number) => void, reset?: () => void, roll?: () => void, on?: () => boolean,
 *   trigger?: (target: number|null, e: Elevator|null) => any, weight?: () => number|false, pick?: () => Partial<IncPick>,
 *   warnS?: number, warn?: (e: Elevator|null, W: IncPick) => string, hit?: (W: IncPick, e: Elevator|null) => void,
 *   chief?: { tick?: () => void, done: () => boolean, cleared?: () => void } }} System
 */

/** @type {System[]|null} */
let list = null;
/** Alla delsystem i tickordning. (Byggs första gången den anropas: modulerna importerar varandra i en ring.) */
export function systems() {
  return list ??= [
    { key: 'life', tick: lifeTick, reset: lifeReset, roll: lifeRoll },
    { key: 'train', tick: dt => trainTick(dt, arrivalRate), reset: trainReset, roll: () => { if (!S.train) trainReset(); } },
    { key: 'visits', tick: visitsTick, reset: visitsReset, roll: visitsRoll },
    { key: 'medical', trigger: () => startMedical() }, // (ingen incident – bara en händelse som rutan berättar om)
    { key: 'tour', tick: tourTick, reset: tourReset },
    { key: 'visning', tick: visningTick, reset: visningReset },
    // --- incidenterna i incidents.js och service.js ---
    { key: 'fire', on: () => !!S.fire, trigger: t => startFire(FIRE_FLOORS.includes(t) ? t : undefined),
      weight: () => !S.fire && 1, pick: () => ({ floor: incPick(OFFICE_FLOORS.slice(1)) }),
      warnS: 10, warn: (_e, W) => `👃 Det luktar bränt på våning ${fl(W.floor)}…`, hit: W => startFire(W.floor) },
    { key: 'power', on: () => !!S.outage, trigger: () => startOutage(), weight: () => S.power && 1,
      warnS: 6, warn: () => '💡 Lamporna i huset flimrar…', hit: () => startOutage() },
    { key: 'fault', trigger: (_t, e) => triggerFault(e), weight: () => busyCars().length > 0 && 1.2,
      pick: () => { const busy = busyCars(), act = busy.filter(e => e.passengers.length || e.carCalls.size); return { car: incPick(act.length ? act : busy).id }; },
      warnS: 8, warn: e => `🔩 ${e.name} låter konstigt – det gnisslar i korgen…`, hit: (_W, e) => { if (e) triggerFault(e); } },
    { key: 'storm', on: () => !!S.storm, trigger: () => { if (startStorm()) incidentStarted(null); }, weight: () => !S.storm && 0.8,
      warnS: 14, warn: () => '🌥️ Det mörknar över staden och vinden friskar i…', hit: () => { if (startStorm()) incidentStarted(null); } },
    // motorvärme: varmare dag och hissar som redan går varma gör det troligare
    { key: 'heat', trigger: (_t, e) => triggerHeat(e),
      weight: () => { const busy = busyCars(); return busy.length > 0 && 0.4 + Math.max(0, S.weather.temp - 15) * 0.06 + Math.max(...busy.map(e => e.heat)) * 0.6; },
      pick: () => ({ car: [...busyCars()].sort((a, b) => b.heat - a.heat || b.passengers.length - a.passengers.length)[0].id }),
      warnS: 10, warn: e => `🌡️ Motorn i ${e.name}s maskinrum brummar ansträngt…`, hit: (_W, e) => { if (e) triggerHeat(e); } },
    // linorna i den mest slitna hissen kan gå av (bara om de är rejält slitna)
    { key: 'cable', trigger: (_t, e) => triggerCable(e), weight: () => { const cr = cableRisk(); return !!cr && cr.w; },
      pick: () => ({ car: cableRisk().e.id }),
      warnS: 40, warn: e => `🪢 Det knarrar i bärlinorna på ${e.name} – de är slitna (${Math.round(e.wear * 100)} %)…`,
      hit: (_W, e) => { if (!e) return; e.creak = false; if (cableCandidate(e)) triggerCable(e); } },
    // panoramahissen kan fastna på fasaden (bara när den kör med folk)
    { key: 'pano', on: () => !!S.pano, trigger: () => triggerPano(),
      weight: () => { const P = PANO ? S.elevators[PANO.id] : null; return panoCandidate(P) && P.passengers.length > 0 && !S.pano && 0.3; },
      pick: () => ({ car: PANO.id }),
      warnS: 10, warn: e => `🔩 ${e.name} hackar på fasaden – det luktar hydraulolja…`,
      hit: (_W, e) => { if (e && panoCandidate(e) && !S.pano) e.panoNext = true; },
      chief: { tick: panoChiefTick, done: () => !S.pano || S.pano.ph === 'done' } },
    // Kuppen på 5:an: sällsynt, högst en gång per dygn, när lastkajen är ledig (heist.js)
    { key: 'heist', tick: heistTick, reset: heistReset, on: () => !!S.heist, trigger: () => startHeist(),
      weight: () => heistPossible() && S.heistDay !== S.day && (S.incLevel === 'kaos' ? 0.5 : 0.2), pick: () => ({ floor: BANK }),
      warnS: 18, warn: () => HEIST_WARN, hit: () => { if (startHeist(true)) S.heistDay = S.day; },
      // (polisens insatsledare bestämmer under kuppen – heistChiefTick i chief.js, även när chefen är på rast)
      chief: { done: () => !S.heist || S.heist.ph === 'done', cleared: () => { const s = S.chief.seen; delete s.heistWait; delete s.heistPlan; delete s.heistSignal; } } },
    { key: 'hoist', tick: hoistTick, reset: hoistReset },
    // fönsterputsarens gondol kärvar (bara när han är ute och putsar, gondola.js)
    { key: 'gondola', tick: gondolaTick, reset: gondolaReset, on: () => !!S.gondola, trigger: () => triggerGondola(),
      weight: () => gondolaCandidate() && 0.35,
      warnS: 8, warn: () => '🔩 Det gnisslar i gondolens vinsch uppe på taket…', hit: () => triggerGondola(),
      chief: { tick: gondolaChiefTick, done: () => !S.gondola || S.gondola.ph === 'done' } },
    // en pudel rymmer (dog.js)
    { key: 'dog', tick: dogTick, reset: dogReset, on: () => !!S.dog, trigger: () => startDog(),
      weight: () => dogPossible() && floorOpen(floorWith('spa'), hour()) && 0.4,
      warnS: 6, warn: () => '🐕 Det skäller ilsket uppe på Vovve Spa…', hit: () => startDog(),
      chief: { tick: dogChiefTick, done: () => !S.dog || S.dog.ph === 'done' } },
    // ett vattenrör spricker (leak.js)
    { key: 'leak', tick: leakTick, reset: leakReset, on: () => !!S.leak, trigger: t => startLeak(t), weight: () => leakPossible() && 0.5,
      warnS: 10, warn: () => '💧 Det droppar från taket någonstans… och det knackar i rören', hit: () => startLeak(),
      chief: { tick: leakChiefTick, done: () => !S.leak } },
    // vädret: stormen blåser (stormen som incident är posten storm ovan); en storm som pågår följer med över dygnsskiftet
    { key: 'weather', tick: stormTick, reset: weatherReset, roll: () => { const st = S.storm; weatherReset(); S.storm = st; } },
  ];
}
/** posten för en nyckel (eller undefined) */
export const system = key => systems().find(s => s.key === key);
/** pågår någon incident? */
export const anyIncident = () => systems().some(s => s.on && s.on());
