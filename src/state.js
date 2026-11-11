// Speltillståndet S, statistik, logg och krokar mot gränssnittet.
import { START_H } from './config.js';

// ---------- Tillstånd ----------
export const S = {
  started: false, paused: false, speed: 1, strategy: 'smart', tags: false, zoom: (() => { try { return localStorage.getItem('hiss.zoom') || 'wide'; } catch (e) { return 'wide'; } })(),
  t: 0, clock: 0, day: 1, anim: 0,
  people: [], elevators: [], log: [], fx: [], wl: null,
  nextId: 1, reoptT: 0, summaryShown: false, stats: null, logDirty: true,
  sel: null, hover: null, hoverDoor: null, carCycle: 0,
  rosterFilter: 'all', logFilter: 'all',
  // incidenter
  autoInc: true, nextInc: 0, power: true, fire: null, outage: null,
  // KNAPPAR-läget: hallanrop { 'grupp|våning|riktning': anrop } och hur ofta folk trycker fel (av/lite/mycket)
  calls: /** @type {Record<string, import('./buttons.js').HallCall>} */ ({}), mistakes: 'lite',
  // drift: underhåll 'natt' (nattservice) eller 'fel' (bara när något går sönder), när teknikern kommer, rusningsläge
  maint: 'natt', techCallAt: /** @type {number|null} */ (null), peakMode: /** @type {string|null} */ (null),
};
// Krokar som gränssnittet kopplar in sig på. Simuleringen rör aldrig DOM själv.
/** @type {{ incident: (floor: number|null) => void, dayEnd: () => void }} */
export const hooks = { incident() {}, dayEnd() {} };
export function newStats() {
  return { served: 0, waitSum: 0, waitN: 0, waitMax: 0, rideSum: 0, rideN: 0, angry: 0,
    smoked: 0, trappedSec: 0, stairs: 0, evacuated: 0, incidents: 0, overloads: 0, transfers: 0, carsIn: 0, deliveries: 0, vips: 0,
    wrongPress: 0, kidPresses: 0, nuisance: 0, ghostStops: 0,
    faults: 0, repairs: 0, serviced: 0, downSec: 0, stairsChoice: 0, energy: 0, energyRun: 0, regen: 0,
    gripes: 0, cups: 0, holds: 0, chats: 0 };
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
}
