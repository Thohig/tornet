// Spelarens åtgärder. Allt spelaren gör som påverkar simuleringen går via act(), så att gränssnittet aldrig
// ändrar simuleringens tillstånd direkt. Rör aldrig DOM – gränssnittet anropar act().
import { STRAT_NAMES } from './config.js';
import { S, log } from './state.js';
import { pev, spawnBus, spawnVisitor } from './people.js';
import { rebuildPicks } from './dispatch.js';
import { setFireMode, startGenerator, startRescue, toggleAutoRescue, toggleOff, trigger } from './incidents.js';
import { setStormMode } from './weather.js';
import { setMoveBlankets, setMoveRoute, setMoveWind } from './visits.js';
import { orderService, startFan } from './service.js';

/** Byt styrlogik: hallknapparna nollställs och alla väntande fördelas om. */
export function changeStrategy(k) {
  if (S.strategy === k) return;
  S.strategy = k;
  S.calls = {};
  for (const p of S.people) if (p.state === 'wait') { p.assigned = null; p.bank = null; p.fixAt = 0; pev(p, 'Styrlogiken byttes – får en ny hiss'); }
  for (const e of S.elevators) { e.parkTarget = null; e.sleep = false; }
  S.peakMode = null;
  rebuildPicks();
  log(`Styrlogik bytt till ${STRAT_NAMES[k]} – alla väntande fördelas om`, 'sys');
}
/** inställningar som spelaren kan ändra under dygnet */
const SETTINGS = ['autoInc', 'mistakes', 'maint'];

/** Alla spelaråtgärder. Argumenten är rena data (id, våningsindex, strängar). */
export const ACTIONS = {
  trigger: type => trigger(type),
  fireMode: m => setFireMode(m),
  generator: () => startGenerator(),
  autoRescue: () => toggleAutoRescue(),
  rescue: id => startRescue(S.elevators[id], 'manual'),
  carOff: id => toggleOff(S.elevators[id]),
  strategy: k => changeStrategy(k),
  setting: (key, v) => { if (SETTINGS.includes(key)) S[key] = v; },
  stormMode: m => setStormMode(m),
  fan: id => startFan(S.elevators[id]),
  service: id => orderService(S.elevators[id]),
  visitor: (f, x) => spawnVisitor(f, x),
  bus: () => spawnBus(),
  moveRoute: r => setMoveRoute(r),
  moveBlankets: on => setMoveBlankets(on),
  moveWind: c => setMoveWind(c),
};

/** Utför en spelaråtgärd. */
export function act(name, ...args) {
  return ACTIONS[name](...args);
}
