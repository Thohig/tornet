// Korta beskrivningar av personer för gränssnittet (HUD och spårlappen i bilden).
// Läser bara tillståndet – ändrar ingenting.
import { fl } from './util.js';
import { FL } from './config.js';
import { S } from './state.js';
import { eta } from './dispatch.js';

/** @returns {[string, string]} etikett och färg för personens läge */
export function stateInfo(p) {
  if (p.dead) return ['HAR GÅTT', '#8d96c9'];
  switch (p.state) {
    case 'toQueue': return ['GÅR TILL HISSARNA', '#9fb3ff'];
    case 'wait': return [p.mood === 2 ? 'VÄNTAR – ARG!' : 'VÄNTAR', p.mood === 2 ? '#ff5d52' : '#ffe14d'];
    case 'boarding': return [`KLIVER PÅ ${p.car.name}`, p.car.color];
    case 'ride': return [!S.power && p.car.mode === 'normal' ? `INSTÄNGD I ${p.car.name}!` : `ÅKER I ${p.car.name}`, p.car.color];
    case 'exiting': return ['KLIVER AV', '#7cf06b'];
    case 'stairs': case 'instairs': return ['TAR TRAPPAN', '#22c55e'];
    case 'office': return [p.sleeping ? 'SOVER' : 'INNE', '#b388ff'];
    case 'away': return ['BORTA', '#8d96c9'];
    case 'incar': return ['KÖR BIL', '#94a3b8'];
  }
  return ['?', '#ffffff'];
}

/** En rad om vad personen gör just nu – till spårlappen som följer personen i bilden */
export function noteDetail(p) {
  if (p.dead) return 'Har lämnat huset';
  const via = p.goal !== p.dest && p.state !== 'office' ? ` (byter på ${fl(p.dest)})` : '';
  switch (p.state) {
    case 'toQueue': return `Ska till ${fl(p.goal ?? p.dest)}${via}`;
    case 'wait': {
      let s = `→ ${fl(p.goal ?? p.dest)}${via} · väntat ${Math.round(S.t - p.waitStart)} s`;
      if (p.assigned !== null) { const e = S.elevators[p.assigned]; s += ` · ${e.name} om ~${Math.round(eta(e, p.floor, p.dir))} s`; }
      return s;
    }
    case 'boarding': case 'ride': return `→ ${fl(p.dest)}${p.goal !== p.dest ? ` (sedan ${fl(p.goal)})` : ''} · åkt ${Math.round(S.t - (p.rideStart || S.t))} s`;
    case 'exiting': return p.spot ? p.spot.desc : 'På väg ut';
    case 'stairs': case 'instairs': return `Trappan till ${fl(p.dest)}`;
    case 'office': return p.spot ? `${p.spot.desc} (${FL[p.floor].short})` : FL[p.floor].short;
    case 'away': return 'Inte i huset just nu';
    case 'incar': return `Kör in i garaget på ${fl(p.floor)}`;
  }
  return '';
}
