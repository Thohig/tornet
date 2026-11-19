// Spelarens åtgärder. Allt spelaren gör som påverkar simuleringen går via act(), så att gränssnittet aldrig
// ändrar simuleringens tillstånd direkt. Rör aldrig DOM – gränssnittet anropar act().
import { STRAT_NAMES } from './config.js';
import { S, log } from './state.js';
import { pev, spawnVisitor } from './people.js';
import { spawnBus } from './tour.js';
import { endVisning, nextVisning, orderVisning } from './visning.js';
import { heistChoice, startHeist } from './heist.js';
import { rebuildPicks } from './dispatch.js';
import { setFireMode, setIncLevel, startGenerator, startRescue, toggleAutoRescue, toggleOff, trigger } from './incidents.js';
import { setStormMode, setWeather, strikeNow } from './weather.js';
import { moveNow, setMoveBlankets, setMoveRoute, setMoveWind } from './visits.js';
import { orderService, startFan } from './service.js';
import { delayTrain } from './train.js';
import { vipNow } from './life.js';
import { chiefBack, playerChose, setChief } from './chief.js';
import { panoText, setPanoHow } from './pano.js';
import { startChaos } from './chaos.js';
import { gondolaText, setGondolaHow } from './gondola.js';
import { setDogLock } from './dog.js';
import { setLeakMode } from './leak.js';

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
export const TRIGGERS = ['fire', 'power', 'fault', 'storm', 'heat', 'cable', 'pano', 'medical', 'move', 'lightning', 'cold', 'heatwave', 'train', 'vip', 'heist', 'visning', 'gondola', 'dog', 'leak'];
function triggerAny(type, target = null) {
  if (type === 'move') return moveNow();
  if (type === 'lightning') return strikeNow();
  if (type === 'cold' || type === 'heatwave') return setWeather(type);
  if (type === 'train') return delayTrain();
  if (type === 'vip') return vipNow();
  if (type === 'heist') return startHeist();
  if (type === 'visning') return orderVisning(true); // (rundvisningen direkt – guiden avbryter rasten, visning.js)
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
  // Murphys lag: kaosknappen – allt som kan gå fel går fel, en gång per dygn (chaos.js)
  chaos: () => startChaos(),
  // rundvisningen med Berit: beställ (start), gå vidare till nästa stopp (next), avsluta (end)
  // kuppen: polisens val – strömmen (cut/wait), var insatsstyrkan går in (garage/tak), tåget (stop/go), gå in nu (storm)
  heist: what => { const H = S.heist; if (!heistChoice(what)) return false; if (what === 'stop') delayTrain();
    playerChose('heist', { cut: 'Klipp strömmen', wait: 'Vänta ut dem', garage: 'Storma via garaget', tak: 'Storma via taket', stop: 'Stoppa tunnelbanan', go: 'Låt tåget gå', storm: 'Gå in nu!' }[what], { inc: 'heist', floor: H ? null : null }); return true; },
  visning: what => (what === 'start' ? orderVisning() : what === 'next' ? nextVisning() : what === 'end' ? endVisning() : undefined),
  moveRoute: r => { if (!S.move) return; setMoveRoute(r); playerChose('move', `Flytten: ${{ auto: 'låt styrningen planera', varu: 'allt i varuhissen', balk: 'tungt med hissbalken' }[r]}`); },
  moveBlankets: on => setMoveBlankets(on),
  // fönsterputsaren som sitter fast: vevas upp (crank), in genom lastluckan (hatch) eller räddningstjänstens rep (rope)
  gondola: how => { if (!setGondolaHow(how, 'player')) return false; playerChose('gondola', gondolaText(how), { inc: 'gondola' }); return true; },
  // den lösa hunden: spärra hissarna på hundens våning (lock) eller släpp dem (free)
  dog: what => { if (!setDogLock(what === 'lock', 'player')) return false; playerChose('dog', what === 'lock' ? 'Spärra hissarna där hunden är' : 'Låt hunden åka', { inc: 'dog' }); return true; },
  // vattenläckan: hissarna i de blöta schakten ur drift (stop) eller kör vidare (run)
  leak: m => { if (!setLeakMode(m, 'player')) return false; playerChose('leak', m === 'stop' ? 'Hissarna i de blöta schakten står still' : 'Hissarna i de blöta schakten kör vidare', { inc: 'leak' }); return true; },
  panoRescue: how => { if (!S.pano || !setPanoHow(how, 'player')) return; playerChose('pano', panoText(how), { inc: 'pano', car: S.pano.car }); },
  moveWind: c => { if (!S.move) return; setMoveWind(c); playerChose('move', c === 'varu' ? 'Lasset vid luckan i varuhissen' : 'Lasset vid luckan väntar'); },
};

/** Utför en spelaråtgärd. */
export function act(name, ...args) {
  return ACTIONS[name](...args);
}
