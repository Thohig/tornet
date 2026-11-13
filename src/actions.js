// Spelarens åtgärder. Allt spelaren gör som påverkar simuleringen går via act(), så att gränssnittet aldrig
// ändrar simuleringens tillstånd direkt. Rör aldrig DOM – gränssnittet anropar act().
import { STRAT_NAMES } from './config.js';
import { S, log } from './state.js';
import { pev, spawnBus, spawnVisitor } from './people.js';
import { rebuildPicks } from './dispatch.js';
import { setFireMode, setIncLevel, startGenerator, startRescue, toggleAutoRescue, toggleOff, trigger } from './incidents.js';
import { setStormMode, setWeather, strikeNow } from './weather.js';
import { moveNow, setMoveBlankets, setMoveRoute, setMoveWind } from './visits.js';
import { orderService, startFan } from './service.js';
import { delayTrain } from './train.js';
import { vipNow } from './life.js';
import { chiefBack, playerChose, setChief } from './chief.js';
import { panoText, setPanoHow } from './pano.js';

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
const SETTINGS = ['mistakes', 'maint'];
/** Allt spelaren kan framkalla. target = våning (brand) eller hiss (hissfel, het motor, linbrott); utelämnat = slumpen väljer. */
export const TRIGGERS = ['fire', 'power', 'fault', 'storm', 'heat', 'cable', 'pano', 'medical', 'move', 'lightning', 'cold', 'heatwave', 'train', 'vip'];
function triggerAny(type, target = null) {
  if (type === 'move') return moveNow();
  if (type === 'lightning') return strikeNow();
  if (type === 'cold' || type === 'heatwave') return setWeather(type);
  if (type === 'train') return delayTrain();
  if (type === 'vip') return vipNow();
  return trigger(type, target);
}
const FIRE_TEXT = { recall: 'Brandåterkallning', zone: 'Brandzon', none: 'Normal drift i branden' };
const car = id => S.elevators[id];

/** Alla spelaråtgärder. Argumenten är rena data (id, våningsindex, strängar). */
export const ACTIONS = {
  trigger: (type, target = null) => triggerAny(type, target),
  fireMode: m => { if (!S.fire) return; setFireMode(m); playerChose('fire', FIRE_TEXT[m], { inc: 'fire' }); },
  generator: () => { if (!S.outage) return; startGenerator(); playerChose('power', 'Reservkraften startad', { inc: 'power' }); },
  autoRescue: () => { if (!S.outage) return; toggleAutoRescue(); playerChose('power', `Auto-räddning ${S.outage.auto ? 'på' : 'av'}`, { inc: 'power' }); },
  rescue: id => { if (!S.outage) return; startRescue(car(id), 'manual'); playerChose('power', `Nödsänk ${car(id).name}`, { inc: 'power', car: id }); },
  carOff: id => toggleOff(car(id)),
  strategy: k => { changeStrategy(k); playerChose('strategy', STRAT_NAMES[k]); },
  setting: (key, v) => { if (SETTINGS.includes(key)) S[key] = v; },
  incLevel: v => setIncLevel(v),
  chief: on => setChief(on),
  chiefBack: key => chiefBack(key),
  stormMode: m => { if (!S.storm) return; setStormMode(m); playerChose('storm', m === 'sway' ? 'Svajläge' : 'Kör som vanligt', { inc: 'storm' }); },
  fan: id => { startFan(car(id)); if (car(id).hot) playerChose(`heat${id}`, `Extrafläkten i ${car(id).name}`, { inc: 'heat', car: id }); },
  service: id => orderService(car(id)),
  visitor: (f, x) => spawnVisitor(f, x),
  bus: () => spawnBus(),
  moveRoute: r => { if (!S.move) return; setMoveRoute(r); playerChose('move', `Flytten: ${{ auto: 'låt styrningen planera', varu: 'allt i varuhissen', balk: 'tungt med hissbalken' }[r]}`); },
  moveBlankets: on => setMoveBlankets(on),
  panoRescue: how => { if (!S.pano || !setPanoHow(how, 'player')) return; playerChose('pano', panoText(how), { inc: 'pano', car: S.pano.car }); },
  moveWind: c => { if (!S.move) return; setMoveWind(c); playerChose('move', c === 'varu' ? 'Lasset vid luckan i varuhissen' : 'Lasset vid luckan väntar'); },
};

/** Utför en spelaråtgärd. */
export function act(name, ...args) {
  return ACTIONS[name](...args);
}
