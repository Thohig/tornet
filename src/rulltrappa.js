// Rulltrappan stannar: nödstoppet löser ut och rulltrappan mellan entrén och mellanplanet (expressens övre däck)
// tvärstannar – den som står i den snubblar till. Vaktmästaren går dit, letar efter det som löste ut nödstoppet
// (en paraplyspets i kammen, ett barn som tryckte …) och startar den igen. Driftchefen (chief.js) eller spelaren
// (act('rulltrappa', …)) väljer under tiden:
//   walk  – folk får gå i den stillastående rulltrappan: det går långsamt, uppför flåsar man, och ju fler som går
//           samtidigt desto trängre (people.js: escalatorTime); den som bär något tungt eller ogärna går tar hissen
//   close – rulltrappan spärras av: ingen tar vägen via mellanplanet, alla från entrén tar expressens nedre däck
//           (trängre där), och de som kommer från övre däcket tar den låga zonen ner
// (Simulering: läget ligger i S.rulltrappa; people.js läser det. Egen slumpström.)
import { stream } from './rng.js';
const { pick, rand } = stream('rulltrappa');
import { S, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';
import { DOOR_X, LOBBY, MEZZ, floorY } from './config.js';
import { pev, pn } from './people.js';
import { callJanitor, dutyDone, onDuty } from './crew.js';
import { sv } from './sv.js';
/** @typedef {import('./people.js').Person} Person */

/**
 * Rulltrappan stannar (S.rulltrappa): ph = 'stopp' (står still) → 'klar'; mode = '' (inget beslut), 'walk' eller
 * 'close'; jan = vaktmästarens id; fixT = hur länge hen har letat, fixLen = hur länge det tar; cause = vad som löste
 * ut nödstoppet; stumbled = hur många som snubblade när den stannade; walked = hur många som gick i den; peak = flest
 * i den samtidigt.
 * @typedef {{ t0: number, ph: 'stopp'|'klar', mode: string, by: string, jan: number, fixT: number, fixLen: number,
 *   cause: string, stumbled: number, walked: number, peak: number }} Rulltrappa
 */
/** var vaktmästaren står: vid rulltrappans fot i entrén (pixhall.js ritar den X(DOOR_X) + 84 bildpunkter in) */
export const ESC_FOOT = DOOR_X + 162;
/** det som kan ha löst ut nödstoppet */
const CAUSES = ['en paraplyspets som fastnat i kammen', 'ett barn som tryckte på den röda knappen', 'en tappad mobil mellan stegen',
  'ett skosnöre som drogs in i kammen', 'en resväska som välte längst upp'];

/** står rulltrappan still? */
export const escalatorStopped = () => !!S.rulltrappa && S.rulltrappa.ph === 'stopp';
/** är rulltrappan avspärrad? */
export const escalatorClosed = () => escalatorStopped() && S.rulltrappa.mode === 'close';
/** de som är i rulltrappan just nu (åker, eller går i den när den står still) */
export const onEscalator = () => S.people.filter(p => !p.dead && p.escalator && p.state === 'instairs');
/** kan den stanna nu? (huset har en rulltrappa, strömmen är på och det brinner inte) */
export const rulltrappaPossible = () => MEZZ >= 0 && !S.rulltrappa && !S.fire && S.power;

/** Slumpen eller spelaren (act('trigger', 'rulltrappa')): nödstoppet löser ut. false om det inte går nu. */
export function startRulltrappa() {
  if (!rulltrappaPossible()) return false;
  const X = S.rulltrappa = { t0: S.t, ph: /** @type {'stopp'} */ ('stopp'), mode: '', by: '', jan: -1, fixT: 0, fixLen: rand(25, 45),
    cause: pick(CAUSES), stumbled: 0, walked: 0, peak: 0 };
  // de som står i rulltrappan snubblar till när den tvärstannar – och får gå resten
  for (const p of onEscalator()) {
    X.stumbled++; S.stats.stumbles++;
    p.mood = Math.max(p.mood || 0, 1); p.timer += 2; p.escT = (p.escT || 1.6) + 2;
    pev(p, 'Rulltrappan tvärstannar – snubblar till och får gå resten');
  }
  if (X.stumbled) S.fx.push({ x: ESC_FOOT + 70, y: floorY(LOBBY) - 60, text: 'OJ!', color: '#ffe14d', life: 1.2 });
  X.jan = callJanitor('rulltrappa', LOBBY, 'Går till rulltrappan – nödstoppet har löst ut', 'Letar efter det som löste ut nödstoppet i rulltrappan', ESC_FOOT).id;
  log(X.stumbled ? sv`🪜 Rulltrappan tvärstannade – ${X.stumbled} snubblade till` : '🪜 Rulltrappan tvärstannade – nödstoppet har löst ut', 'alert');
  incidentStarted(LOBBY);
  return true;
}
/** Beslutet: 'walk' (gå i den stillastående rulltrappan) eller 'close' (spärra av). by = 'chief' eller 'player'. */
export function setRulltrappaMode(mode, by) {
  const X = S.rulltrappa;
  if (!X || X.ph !== 'stopp' || (mode !== 'walk' && mode !== 'close')) return false;
  if (X.mode === mode) return true;
  X.mode = mode; X.by = by;
  log(mode === 'close' ? '🚧 Rulltrappan spärras av – alla tar expressens nedre däck från entrén'
    : '🪜 Folk får gå i den stillastående rulltrappan', 'alert');
  return true;
}

/** @param {number} dt */
export function rulltrappaTick(dt) {
  const X = S.rulltrappa;
  if (!X || X.ph !== 'stopp') return;
  X.peak = Math.max(X.peak, onEscalator().length);
  // vaktmästaren letar efter det som löste ut nödstoppet (ringas in igen om hen försvann)
  let jan = S.people.find(p => p.id === X.jan && !p.dead) || null;
  if (!jan || !jan.duty || jan.duty.kind !== 'rulltrappa') {
    jan = callJanitor('rulltrappa', LOBBY, 'Går till rulltrappan – nödstoppet har löst ut', 'Letar efter det som löste ut nödstoppet i rulltrappan', ESC_FOOT);
    X.jan = jan.id;
  }
  if (onDuty(jan, 'rulltrappa') && (X.fixT += dt) >= X.fixLen) restart(X, jan);
}
/** en person börjar gå i den stillastående rulltrappan (people.js) */
export function walkedEscalator() { if (S.rulltrappa) S.rulltrappa.walked++; }
/** @param {Rulltrappa} X @param {Person} jan */
function restart(X, jan) {
  X.ph = 'klar';
  dutyDone(jan);
  pev(jan, sv`Hittade felet: ${X.cause} – rulltrappan rullar igen`);
  log(sv`🔧 ${pn(jan)} hittade ${X.cause} – rulltrappan rullar igen`, 'alert', null, jan.id);
  const sec = Math.round(S.t - X.t0);
  const how = X.mode === 'close' ? 'Den var avspärrad – alla tog expressens nedre däck.'
    : sv`${X.walked} gick i den stillastående rulltrappan, som mest ${X.peak} samtidigt.`;
  S.rulltrappa = null;
  incidentOver('rulltrappa', '✅ Rulltrappan rullar igen', sv`Den stod still i ${sec} s. ${how}`, { floor: LOBBY });
}

export function rulltrappaReset() { S.rulltrappa = null; }
