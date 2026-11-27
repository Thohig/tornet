// Spelarens åtgärder. Allt spelaren gör som påverkar simuleringen går via act(), så att gränssnittet aldrig
// ändrar simuleringens tillstånd direkt. Rör aldrig DOM – gränssnittet anropar act().
//
// Översikt:
// spelarens åtgärder via `act()` (tabellen `ACTIONS`), `changeStrategy`, `triggers()` (registrets incidenter och
// händelserna i `EXTRA_TRIGGERS` – allt som kan framkallas: `act('trigger', typ, mål)` där mål är våning för brand
// och hiss-id för fel/värme/linbrott)
import { setBridgeStorm } from './skywalk.js';
import { setKronanMode } from './kronan.js';
import { STRAT_NAMES } from './config.js';
import { S, log } from './state.js';
import { pev, spawnVisitor } from './people.js';
import { spawnBus } from './tour.js';
import { endVisning, nextVisning, orderVisning } from './visning.js';
import { heistChoice } from './heist.js';
import { systems } from './systems.js';
import { rebuildPicks } from './dispatch.js';
import { setFireMode, setIncLevel, startGenerator, startRescue, toggleAutoRescue, toggleOff, trigger } from './incidents.js';
import { dateWeather, setStormMode, setWeather, strikeNow } from './weather.js';
import { dateParts, dayInfo, parseDate } from './calendar.js';
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
import { setCrashMode } from './crash.js';
import { setTunnelMode } from './tunnel.js';
import { setRulltrappaMode } from './rulltrappa.js';
import { setPanicMode } from './panic.js';
import { setPartyMode } from './party.js';
import { sv } from './sv.js';

/** Byt styrlogik: hallknapparna nollställs och alla väntande fördelas om. */
export function changeStrategy(k) {
  if (S.strategy === k) return;
  S.strategy = k;
  S.calls = {};
  for (const p of S.people) if (p.state === 'wait') { p.assigned = null; p.bank = null; p.fixAt = 0; pev(p, 'Styrlogiken byttes – får en ny hiss'); }
  for (const e of S.elevators) { e.parkTarget = null; e.sleep = false; }
  S.peakMode = null;
  rebuildPicks();
  log(sv`Styrlogik bytt till ${STRAT_NAMES[k]} – alla väntande fördelas om`, 'sys');
}
/** inställningar som spelaren kan ändra under dygnet */
const SETTINGS = ['mistakes', 'maint'];
/** Händelser som bara kan framkallas (de har ingen post med trigger i registret, systems.js). */
const EXTRA_TRIGGERS = {
  move: () => moveNow(), lightning: () => strikeNow(), cold: () => setWeather('cold'), heatwave: () => setWeather('heatwave'),
  train: () => delayTrain(), vip: () => vipNow(),
};
/** Allt spelaren kan framkalla: registrets incidenter och händelserna ovan.
 * target = våning (brand, vattenläcka) eller hiss (hissfel, het motor, linbrott); utelämnat = slumpen väljer. */
export const triggers = () => [...systems().filter(s => s.trigger).map(s => s.key), ...Object.keys(EXTRA_TRIGGERS)];
function triggerAny(type, target = null) {
  return EXTRA_TRIGGERS[type] ? EXTRA_TRIGGERS[type]() : trigger(type, target);
}
const FIRE_TEXT = { recall: 'Brandåterkallning', zone: 'Brandzon', none: 'Normal drift i branden' };
const car = id => S.elevators[id];

/** Alla spelaråtgärder. Argumenten är rena data (id, våningsindex, strängar). */
export const ACTIONS = {
  trigger: (type, target = null) => triggerAny(type, target),
  fireMode: m => { if (!S.fire) return; setFireMode(m); playerChose('fire', FIRE_TEXT[m], { inc: 'fire' }); },
  generator: () => { if (!S.outage) return; startGenerator(); playerChose('power', 'Reservkraften startad', { inc: 'power' }); },
  autoRescue: () => { if (!S.outage) return; toggleAutoRescue(); playerChose('power', sv`Auto-räddning ${S.outage.auto ? 'på' : 'av'}`, { inc: 'power' }); },
  rescue: id => { if (!S.outage) return; startRescue(car(id), 'manual'); playerChose('power', sv`Nödsänk ${car(id).name}`, { inc: 'power', car: id }); },
  carOff: id => toggleOff(car(id)),
  strategy: k => { changeStrategy(k); playerChose('strategy', STRAT_NAMES[k]); },
  setting: (key, v) => { if (SETTINGS.includes(key)) S[key] = v; },
  incLevel: v => setIncLevel(v),
  chief: on => setChief(on),
  chiefBack: key => chiefBack(key),
  stormMode: m => { if (!S.storm) return; setStormMode(m); playerChose('storm', m === 'sway' ? 'Svajläge' : 'Kör som vanligt', { inc: 'storm' }); },
  fan: id => { startFan(car(id)); if (car(id).hot) playerChose(`heat${id}`, sv`Extrafläkten i ${car(id).name}`, { inc: 'heat', car: id }); },
  service: id => orderService(car(id)),
  visitor: (f, x) => spawnVisitor(f, x),
  bus: () => spawnBus(),
  // Murphys lag: kaosknappen – allt som kan gå fel går fel, en gång per dygn (chaos.js)
  chaos: () => startChaos(),
  // kuppen: polisens val – strömmen (cut/wait), var insatsstyrkan går in (garage/tak), tåget (stop/go), gå in nu (storm)
  heist: what => { const H = S.heist; if (!heistChoice(what)) return false; if (what === 'stop') delayTrain();
    playerChose('heist', { cut: 'Klipp strömmen', wait: 'Vänta ut dem', garage: 'Storma via garaget', tak: 'Storma via taket', stop: 'Stoppa tunnelbanan', go: 'Låt tåget gå', storm: 'Gå in nu!', 'spärr': 'Polisen spärrar bron', 'bakhåll': 'Bakhåll i Kronan – bron står öppen' }[what], { inc: 'heist', floor: H ? null : null }); return true; },
  // rundvisningen (ingen incident – den beställs): beställ hos guiden (start), direkt – guiden avbryter rasten (now),
  // gå vidare till nästa stopp (next), avsluta (end)
  visning: what => (what === 'start' ? orderVisning() : what === 'now' ? orderVisning(true) : what === 'next' ? nextVisning() : what === 'end' ? endVisning() : undefined),
  moveRoute: r => { if (!S.move) return; setMoveRoute(r); playerChose('move', `Flytten: ${{ auto: 'låt styrningen planera', varu: 'allt i varuhissen', balk: 'tungt med hissbalken' }[r]}`); },
  moveBlankets: on => setMoveBlankets(on),
  // fönsterputsaren som sitter fast: vevas upp (crank), in genom lastluckan (hatch) eller räddningstjänstens rep (rope)
  gondola: how => { if (!setGondolaHow(how, 'player')) return false; playerChose('gondola', gondolaText(how), { inc: 'gondola' }); return true; },
  // den lösa hunden: spärra hissarna på hundens våning (lock) eller släpp dem (free)
  dog: what => { if (!setDogLock(what === 'lock', 'player')) return false; playerChose('dog', what === 'lock' ? 'Spärra hissarna där hunden är' : 'Låt hunden åka', { inc: 'dog' }); return true; },
  // vattenläckan: hissarna i de blöta schakten ur drift (stop) eller kör vidare (run)
  leak: m => { if (!setLeakMode(m, 'player')) return false; playerChose('leak', m === 'stop' ? 'Hissarna i de blöta schakten står still' : 'Hissarna i de blöta schakten kör vidare', { inc: 'leak' }); return true; },
  // Hiss-O-Matic har kraschat: nödläge (nod) eller omstart (boot)
  crash: m => { if (!setCrashMode(m, 'player')) return false; playerChose('crash', m === 'boot' ? 'Hiss-O-Matic startas om' : 'Hissarna går i nödläge', { inc: 'crash' }); return true; },
  // rulltrappan stannar: gå i den (walk) eller spärra av (close)
  rulltrappa: m => { if (!setRulltrappaMode(m, 'player')) return false; playerChose('rulltrappa', m === 'close' ? 'Rulltrappan spärras av' : 'Folk får gå i rulltrappan', { inc: 'rulltrappa' }); return true; },
  // tåget i tunneln: vänta (wait) eller ersättningsbussar (bus)
  tunnel: m => { if (!setTunnelMode(m, 'player')) return false; playerChose('tunnel', m === 'bus' ? 'Ersättningsbussar på gatan' : 'Vi väntar på tåget', { inc: 'tunnel' }); return true; },
  // panik i hissen: prata i nödtelefonen (talk) eller veva ner korgen (crank)
  panic: m => { if (!setPanicMode(m, 'player')) return false; playerChose('panic', m === 'crank' ? 'Teknikern vevar ner korgen' : 'Vi pratar med dem i nödtelefonen', { inc: 'panic' }); return true; },
  // firmafesten: ballongerna i varuhissen (varu) eller i vilken hiss som helst (alla)
  party: m => { if (!setPartyMode(m, 'player')) return false; playerChose('party', m === 'varu' ? 'Ballongerna tar varuhissen' : 'Gästerna åker vilken hiss som helst', { inc: 'party' }); return true; },
  // ett annat datum (Framkalla, eller dagens när spelaren har spelat över midnatt): årstiden, veckodagen och ljuset
  // gäller direkt; temperaturen ligger lika långt från månadens medel som förut (inget nytt slumptal)
  date: d => setDate(d),
  // skywalken i stormen: stäng bron (close) eller håll den öppen med vakt (open)
  skywalk: m => { if (!setBridgeStorm(m, 'player')) return false; playerChose('skywalk', m === 'close' ? 'Bron till Kronan stängs' : 'Bron till Kronan hålls öppen med vakt', { inc: 'storm' }); return true; },
  // Kronans hissar har kraschat: släpp in Kronans folk (open) eller bara Tornets egna (own)
  kronan: m => { if (!setKronanMode(m, 'player')) return false; playerChose('kronan', m === 'open' ? 'Kronans folk får ta våra hissar' : 'Vi tar bara våra egna', { inc: 'kronan' }); return true; },
  panoRescue: how => { if (!S.pano || !setPanoHow(how, 'player')) return; playerChose('pano', panoText(how), { inc: 'pano', car: S.pano.car }); },
  moveWind: c => { if (!S.move) return; setMoveWind(c); playerChose('move', c === 'varu' ? 'Lasset vid luckan i varuhissen' : 'Lasset vid luckan väntar'); },
};

/** @param {string} d '2026-12-13' */
function setDate(d) {
  if (!parseDate(d) || d === S.date) return false;
  S.date = d; S.cal = dayInfo(d);
  dateWeather();
  const p = dateParts(S.cal);
  if (p) log(sv`📅 ${p.wd} ${p.day} ${p.month} i Tornet – ${S.weather.temp} °C ute`, 'sys');
  return true;
}

/** Utför en spelaråtgärd. */
export function act(name, ...args) {
  return ACTIONS[name](...args);
}
