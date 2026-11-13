// Speltillståndet S, statistik, logg och krokar mot gränssnittet.
import { START_H } from './config.js';

// ---------- Tillstånd ----------
export const S = {
  started: false, paused: false, speed: 1, strategy: 'smart', tags: false,
  t: 0, clock: 0, day: 1, anim: 0, tempo: 'lang', // tempo: dygnets längd (TEMPOS i config)
  people: [], elevators: [], log: [], fx: [], wl: null,
  nextId: 1, reoptT: 0, summaryShown: false, stats: null, logDirty: true,
  sel: null, hover: null, hoverDoor: null, carCycle: 0,
  rosterFilter: 'all', logFilter: 'all',
  // incidenter
  // slumpen: hur ofta incidenterna kommer av sig själva (av/lugn/normal/kaos, se INC_LEVELS i incidents.js)
  incLevel: 'normal', power: true, fire: null, outage: null,
  // driftchefen i kontrollrummet (chief.js) och driftradion: det som händer och besluten, i klartext
  chief: /** @type {any} */ (null), feed: /** @type {{ t: number, time: string, text: string, kind: string, color: string|null }[]} */ ([]),
  // dygnets tidtabell för slumpade incidenter, förvarningen som pågår och den senaste incidenten (efterspelet)
  powerBack: /** @type {number|null} */ (null), brigade: /** @type {any} */ (null),
  incPlan: /** @type {{ at: number, night: boolean }[]} */ ([]), warn: /** @type {any} */ (null), lastInc: /** @type {any} */ (null),
  // KNAPPAR-läget: hallanrop { 'grupp|våning|riktning': anrop } och hur ofta folk trycker fel (av/lite/mycket)
  calls: /** @type {Record<string, import('./buttons.js').HallCall>} */ ({}), mistakes: 'lite',
  // drift: underhåll 'natt' (nattservice) eller 'fel' (bara när något går sönder), när teknikern kommer, rusningsläge
  maint: 'natt', techCallAt: /** @type {number|null} */ (null), foreman: /** @type {{ car: number, at: number }|null} */ (null), pano: /** @type {any} */ (null),
  // extra tekniker: samtalet till hissjouren (syns i grafiken) och när kollegan kommer
  techCall: /** @type {{ by: number, t0: number, until: number, n: number, cars: number[], trapped?: string|null }|null} */ (null), extraAt: /** @type {number|null} */ (null), peakMode: /** @type {string|null} */ (null),
  // väder (temperatur, stormen som incident), flyttdag, ambulans och informationsrutor (se notice)
  weather: /** @type {{ temp: number, cold: number }} */ ({ temp: 15, cold: 0 }), storm: /** @type {any} */ (null),
  move: /** @type {any} */ (null), medic: /** @type {any} */ (null),
  // takskenan: fönsterputsarens gondol och hissbalken (hoist.js)
  cleaner: /** @type {any} */ (null), hoist: /** @type {any} */ (null),
  notices: /** @type {Notice[]} */ ([]), noticeId: 1,
  // lärande parkering: dagens anrop per timme och våning, och minnet från tidigare dygn (följer med som slitaget)
  learnToday: /** @type {number[][]|null} */ (null), learnMem: /** @type {number[][]|null} */ (null),
  // bara gränssnittet: informationsrutor som spelaren har stängt (läses aldrig av simuleringen)
  dismissed: /** @type {Set<string>} */ (new Set()),
};
/**
 * En händelse som spelaren bara informeras om (snubbel, kall dag …). Ritas som en ruta i incidentpanelen.
 * @typedef {{ id: number, kind: string, title: string, text: string, t0: number, floor: number|null, car: number|null, act?: string, actLabel?: string }} Notice
 */
/** visa en informationsruta (sparas i tillståndet, inte i gränssnittet) */
export function notice(kind, title, text, opts = {}) {
  S.notices.push({ id: S.noticeId++, kind, title, text, t0: S.t, floor: opts.floor ?? null, car: opts.car ?? null, act: opts.act, actLabel: opts.actLabel });
  if (S.notices.length > 8) S.notices.shift();
}
/** en incident är över: en sammanfattning i en informationsruta, och folk pratar om den en stund (cast.js) */
export function incidentOver(type, title, text, opts = {}) {
  notice(type, title, text, opts);
  S.lastInc = { id: S.noticeId, type, t: S.t };
}
// Vem som sitter på vilken plats (plats i SPOTS → personens id). Ligger i tillståndet, inte i config,
// så att config förblir ren data och flera simuleringar i samma process inte delar beläggning.
/** @type {Map<import('./config.js').Spot, number>} */
S.occ = new Map();
/** id för den som sitter på platsen, eller null */
export const occOf = s => S.occ.get(s) ?? null;
/** sätt (id) eller töm (null) platsen */
export function setOcc(s, id) { if (id === null) S.occ.delete(s); else S.occ.set(s, id); }
// Krokar som gränssnittet kopplar in sig på. Simuleringen rör aldrig DOM själv.
/** @type {{ incident: (floor: number|null) => void, dayEnd: () => void }} */
export const hooks = { incident() {}, dayEnd() {} };
export function newStats() {
  return { served: 0, waitSum: 0, waitN: 0, waitMax: 0, rideSum: 0, rideN: 0, angry: 0,
    smoked: 0, trappedSec: 0, stairs: 0, evacuated: 0, incidents: 0, overloads: 0, transfers: 0, carsIn: 0, deliveries: 0, vips: 0,
    wrongPress: 0, kidPresses: 0, nuisance: 0, ghostStops: 0,
    faults: 0, cables: 0, repairs: 0, extraTechs: 0, serviced: 0, downSec: 0, stairsChoice: 0, energy: 0, energyRun: 0, regen: 0,
    gripes: 0, cups: 0, holds: 0, chats: 0,
    crowdSkips: 0, closePresses: 0, heatStops: 0, relevels: 0, stumbles: 0, doorFights: 0,
    medical: 0, medicSec: 0, moveLoads: 0, moves: 0, moveBroken: 0, stormFaults: 0, learnedParks: 0, upperDeck: 0, escalator: 0,
    trains: 0, trainIn: 0, trainOut: 0,
    // styrningens förutsagda väntan (vid senaste tilldelningen) mot den faktiska: summa fel, summa |fel|, antal
    etaErr: 0, etaAbs: 0, etaN: 0 };
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
