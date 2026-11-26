// Speltillståndet S, statistik, logg och krokar mot gränssnittet.
import { START_H } from './config.js';

// ---------- Tillstånd ----------
/** En rad i loggen (S.log, nyast först) @typedef {{ time: string, text: string, kind: string, color: string|null, pid: number|null }} LogLine */
/** En ljudeffekt/text som flyter upp i bilden (S.fx; bara grafiken räknar ner life och sätter band = våningsbandet där lika texter slås ihop) @typedef {{ x: number, y: number, text: string, color: string, life: number, size?: number, band?: number }} Fx */
/** Kvälls- och nattpersonalens schema och stamgästerna (sim.js) @typedef {{ at: number, run: () => void, done?: boolean }} SchedEv */
/** Väntande per våning och riktning, byggs om varje steg (sim.js) @typedef {{ u: import('./people.js').Person[], d: import('./people.js').Person[] }[]} WaitLists */

// Alla fält i S deklareras här, även de som bara ett delsystem använder: S har typen av den här literalen
// (GameState), så typkontrollen larmar för fält som inte finns (S.felstavat). Nytt fält = ny rad här.
const INIT = {
  started: false, paused: false, speed: 1, strategy: 'smart', tags: false,
  t: 0, clock: 0, day: 1, anim: 0, tempo: 'lang', // tempo: dygnets längd (TEMPOS i config)
  seed: 0, acc: 0, // dygnets frö (newSim) och tid som inte hunnit bli ett steg (advance)
  // hur simuleringen startades (newSim): det som behövs för att starta om exakt samma dygn (repro.js)
  origin: /** @type {import('./repro.js').Origin|null} */ (null),
  people: /** @type {import('./people.js').Person[]} */ ([]), elevators: /** @type {import('./elevators.js').Elevator[]} */ ([]),
  log: /** @type {LogLine[]} */ ([]), fx: /** @type {Fx[]} */ ([]), wl: /** @type {WaitLists|null} */ (null),
  sched: /** @type {SchedEv[]} */ ([]), wakeAt: 0, // wakeAt: tidigast när en sovande hiss får väckas igen (nattläget)
  nextId: 1, reoptT: 0, summaryShown: false, stats: /** @type {Stats|null} */ (null), logDirty: true,
  // nytt dygn: 'mjuk' = huset rullar vidare kl 06 (rollDay i sim.js), 'ny' = dygnet börjar om från början (resetDay);
  // yesterday = gårdagens statistik efter ett mjukt dygnsskifte
  roll: 'ny', yesterday: /** @type {{ day: number, stats: Stats }|null} */ (null),
  sel: /** @type {import('./people.js').Person|null} */ (null), hover: /** @type {import('./people.js').Person|null} */ (null), hoverDoor: /** @type {number|null} */ (null), carCycle: 0,
  rosterFilter: 'all', logFilter: 'all',
  // bara gränssnittet: kamerans mål (världs-y), hur länge kameran håller kvar det man klickat på, spårlappen behöver ritas om
  camTarget: /** @type {number|null} */ (null), followHold: 0, trackDirty: false,
  // incidenter
  // slumpen: hur ofta incidenterna kommer av sig själva (av/lugn/normal/kaos, se INC_LEVELS i incidents.js)
  incLevel: 'normal', power: true, fire: /** @type {import('./incidents.js').Fire|null} */ (null), outage: /** @type {import('./incidents.js').Outage|null} */ (null),
  // driftchefen i kontrollrummet (chief.js) och driftradion: det som händer och besluten, i klartext
  chief: /** @type {import('./chief.js').Chief|null} */ (null), feed: /** @type {{ t: number, time: string, text: string, kind: string, color: string|null }[]} */ ([]),
  // dygnets tidtabell för slumpade incidenter, förvarningen som pågår och den senaste incidenten (efterspelet)
  powerBack: /** @type {number|null} */ (null), brigade: /** @type {import('./incidents.js').Brigade|null} */ (null),
  incPlan: /** @type {{ at: number, night: boolean }[]} */ ([]), warn: /** @type {import('./incidents.js').Warn|null} */ (null), lastInc: /** @type {{ id: number, type: string, t: number }|null} */ (null),
  // KNAPPAR-läget: hallanrop { 'grupp|våning|riktning': anrop } och hur ofta folk trycker fel (av/lite/mycket)
  calls: /** @type {Record<string, import('./buttons.js').HallCall>} */ ({}), mistakes: 'lite',
  // drift: underhåll 'natt' (nattservice) eller 'fel' (bara när något går sönder), när teknikern kommer, rusningsläge
  maint: 'natt', techCallAt: /** @type {number|null} */ (null), foreman: /** @type {{ car: number, at: number }|null} */ (null), pano: /** @type {import('./pano.js').Pano|null} */ (null),
  // extra tekniker: samtalet till hissjouren (syns i grafiken) och när kollegan kommer
  techCall: /** @type {{ by: number, t0: number, until: number, n: number, cars: number[], trapped?: string|null }|null} */ (null), extraAt: /** @type {number|null} */ (null), peakMode: /** @type {string|null} */ (null),
  // väder (temperatur, stormen som incident), flyttdag, ambulans och informationsrutor (se notice)
  weather: /** @type {{ temp: number, cold: number }} */ ({ temp: 15, cold: 0 }), storm: /** @type {import('./weather.js').Storm|null} */ (null),
  move: /** @type {import('./visits.js').Move|null} */ (null), medic: /** @type {import('./visits.js').Medic|null} */ (null),
  // Stadsturen: turistbussen och den guidade gruppen (tour.js)
  tour: /** @type {import('./tour.js').Tour|null} */ (null),
  // rundvisningen: Berit visar en gäst runt i huset medan vikarien Kicki sköter disken (visning.js)
  visning: /** @type {import('./visning.js').Visning|null} */ (null),
  // Kuppen på 5:an: rånargänget, gisslan, hjälten och polisen (heist.js)
  heist: /** @type {import('./heist.js').Heist|null} */ (null), heistDay: 0, // (dygnet då slumpen senast gav en kupp: högst en per dygn)
  heistWait: /** @type {number|null} */ (null), // (framkallad men lastkajen var upptagen: gänget väntar runt hörnet sedan S.t)
  // Murphys lag: kaosknappens kedja som pågår och dygnet då knappen senast trycktes (en gång per dygn, chaos.js)
  chaos: /** @type {import('./chaos.js').Chaos|null} */ (null), chaosDay: 0,
  // tunnelbanan (train.js): tåget som är inne, nästa och förra avgången, förseningen och om sista tåget har gått
  train: /** @type {import('./train.js').Train|null} */ (null), trainNext: 0, trainLast: /** @type {number|null} */ (null),
  trainDelay: /** @type {{ t0: number, until: number }|null} */ (null), trainDone: false,
  // garaget, leveransbilen, VIP-helikoptern och ambulansens klockslag (life.js, visits.js)
  autos: /** @type {import('./life.js').Auto[]} */ ([]), nextAutoId: 1, truck: /** @type {import('./life.js').Truck|null} */ (null),
  heli: /** @type {import('./life.js').Heli|null} */ (null), vipVisits: /** @type {import('./life.js').VipVisit[]} */ ([]),
  medicAt: /** @type {number|null} */ (null),
  // takskenan: fönsterputsarens gondol och hissbalken (hoist.js)
  cleaner: /** @type {import('./hoist.js').Cleaner|null} */ (null), hoist: /** @type {import('./hoist.js').Hoist|null} */ (null),
  // olyckorna som vaktmästaren rycker ut till: gondolen som fastnat (gondola.js), den lösa hunden (dog.js), vattenläckan (leak.js)
  gondola: /** @type {import('./gondola.js').Gondola|null} */ (null), dog: /** @type {import('./dog.js').Dog|null} */ (null), leak: /** @type {import('./leak.js').Leak|null} */ (null),
  // Hiss-O-Matic som kraschar (crash.js), tåget i tunneln (tunnel.js), panik i hissen (panic.js) och firmafesten (party.js, en gång per dygn: partyDay)
  crash: /** @type {import('./crash.js').Crash|null} */ (null), tunnel: /** @type {import('./tunnel.js').Tunnel|null} */ (null),
  panic: /** @type {import('./panic.js').Panic|null} */ (null), party: /** @type {import('./party.js').Party|null} */ (null), partyDay: -1,
  notices: /** @type {Notice[]} */ ([]), noticeId: 1,
  // lärande parkering: dagens anrop per timme och våning, och minnet från tidigare dygn (följer med som slitaget)
  learnToday: /** @type {number[][]|null} */ (null), learnMem: /** @type {number[][]|null} */ (null),
  // bara gränssnittet: informationsrutor som spelaren har stängt (läses aldrig av simuleringen)
  dismissed: /** @type {Set<string>} */ (new Set()),
  // vem som sitter på vilken plats (plats i SPOTS → personens id). Ligger i tillståndet, inte i config,
  // så att config förblir ren data och flera simuleringar i samma process inte delar beläggning.
  occ: /** @type {Map<import('./config.js').Spot, number>} */ (new Map()),
};
/** (mappad typ: typeof INIT ensam är öppen i en JS-fil och godtar vilket fält som helst) @typedef {{ [K in keyof typeof INIT]: (typeof INIT)[K] }} GameState */
/** Speltillståndet. @type {GameState} */
export const S = INIT;
/**
 * En händelse som spelaren bara informeras om (snubbel, kall dag …). Ritas som en ruta i incidentpanelen.
 * @typedef {{ id: number, kind: string, title: string, text: string, t0: number, floor: number|null, car: number|null, act?: string, actLabel?: string }} Notice
 */
/** visa en informationsruta (sparas i tillståndet, inte i gränssnittet) */
export function notice(kind, title, text, opts = {}) {
  S.notices.push({ id: S.noticeId++, kind, title, text, t0: S.t, floor: opts.floor ?? null, car: opts.car ?? null, act: opts.act, actLabel: opts.actLabel });
  if (S.notices.length > 8) S.notices.shift();
}
/** något som hörde till dygnet (en incident som tog slut, flytten, ambulansen): sparas för dagens sammanfattning */
export function dayEvent(type, title, text) {
  S.stats.events.push({ time: clockStr(), type, title, text });
}
/** en incident är över: en sammanfattning i en informationsruta, och folk pratar om den en stund (cast.js) */
export function incidentOver(type, title, text, opts = {}) {
  notice(type, title, text, opts);
  dayEvent(type, title, text);
  S.lastInc = { id: S.noticeId, type, t: S.t };
}
/** id för den som sitter på platsen, eller null */
export const occOf = s => S.occ.get(s) ?? null;
/** sätt (id) eller töm (null) platsen */
export function setOcc(s, id) { if (id === null) S.occ.delete(s); else S.occ.set(s, id); }
// Krokar som gränssnittet kopplar in sig på. Simuleringen rör aldrig DOM själv.
/** @type {{ incident: (floor: number|null) => void, dayEnd: () => void }} */
export const hooks = { incident() {}, dayEnd() {} };
/** @typedef {ReturnType<typeof newStats>} NewStats */
/** Dygnets siffror (S.stats). Alla räknare deklareras i newStats – en ny räknare = en ny rad där (mappad typ, se GameState).
 * @typedef {{ [K in keyof NewStats]: NewStats[K] }} Stats */
export function newStats() {
  return { served: 0, waitSum: 0, waitN: 0, waitMax: 0, rideSum: 0, rideN: 0, angry: 0,
    smoked: 0, trappedSec: 0, stairs: 0, evacuated: 0, incidents: 0, overloads: 0, transfers: 0, carsIn: 0, deliveries: 0, vips: 0,
    wrongPress: 0, kidPresses: 0, nuisance: 0, ghostStops: 0,
    faults: 0, cables: 0, repairs: 0, extraTechs: 0, serviced: 0, serviceOrdered: 0, downSec: 0, stairsChoice: 0, energy: 0, energyRun: 0, regen: 0,
    gripes: 0, cups: 0, holds: 0, chats: 0,
    crowdSkips: 0, closePresses: 0, heatStops: 0, relevels: 0, stumbles: 0, doorFights: 0,
    medical: 0, medicSec: 0, moveLoads: 0, moves: 0, moveBroken: 0, stormFaults: 0, learnedParks: 0, upperDeck: 0, escalator: 0,
    trains: 0, trainIn: 0, trainOut: 0, panoStuck: 0,
    // styrningens förutsagda väntan (vid senaste tilldelningen) mot den faktiska: summa fel, summa |fel|, antal
    etaErr: 0, etaAbs: 0, etaN: 0,
    // dygnets händelser i tidsordning (dayEvent): det sammanfattningen berättar om
    events: /** @type {{ time: string, type: string, title: string, text: string }[]} */ ([]) };
}
// S.clock = spelsekunder sedan 06:00. hour() går från 6 till 30 (06:00 nästa morgon).
export const hour = () => START_H + S.clock / 3600;
export function clockStr(h = hour()) {
  const m = Math.floor(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function phaseName(h) {
  if (h < 7) return 'Tidig morgon';
  if (h < 9.5) return 'Morgonrusning';
  if (h < 11.2) return 'Förmiddag';
  if (h < 13.4) return 'Lunchrusning';
  if (h < 15.8) return 'Eftermiddag';
  if (h < 18.5) return 'Hemgång';
  if (h < 22) return 'Kväll';
  return 'Natt';
}
export function log(text, kind = 'sys', color = null, pid = null) {
  S.log.unshift({ time: clockStr(), text, kind, color, pid });
  if (S.log.length > 300) S.log.pop();
  S.logDirty = true;
  // driftradion: chefens beslut och husets larm (inte det som bara gäller en person)
  if (kind === 'chief' || (kind === 'alert' && pid === null)) {
    S.feed.push({ t: S.t, time: clockStr(), text, kind, color });
    if (S.feed.length > 40) S.feed.shift();
  }
}
