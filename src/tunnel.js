// Tåget står i tunneln: ett signalfel stoppar tåget på väg in mot stationen under huset. Inga tåg kommer på en
// lång stund (until), perrongen fylls av dem som ska hem, och när tåget till slut rullar in kliver alla av som har
// samlats längs linjen sedan förra tåget – en klump som ska upp genom huset (train.js räknar dem).
// Driftchefen (chief.js) eller spelaren (act('tunnel', …)) väljer:
//   wait – vänta på tåget: folk står kvar på perrongen; den som tröttnar (efter en stund) går upp genom huset
//          och tar ersättningsbussen från gatan
//   bus  – ersättningsbussar på gatan: alla på perrongen och alla som ska till tåget går upp genom huset till
//          entrén direkt (en rusning uppåt i den låga zonen och expressen)
// (Simulering: läget ligger i S.tunnel; train.js väntar med nästa tåg medan det står still. Egen slumpström.)
import { stream } from './rng.js';
const { rand } = stream('tunnel');
import { S, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';
import { STATION } from './config.js';
import { toStreet, trainsRunning } from './train.js';
import { fl } from './util.js';
import { sv } from './sv.js';
/** @typedef {import('./people.js').Person} Person */

/**
 * Tåget i tunneln (S.tunnel): ph = 'stuck' (står still till until) → 'coming' (tåget rullar in); mode = '' (inget
 * beslut), 'wait' eller 'bus'; give = när var och en på perrongen tröttnar (id → S.t); peak = flest på perrongen;
 * gaveUp/bussed = hur många som gick upp genom huset själva/med ersättningsbussen; n = hur många som klev av.
 * @typedef {{ t0: number, ph: 'stuck'|'coming', mode: string, by: string, until: number, give: Record<number, number>,
 *   peak: number, gaveUp: number, bussed: number, n: number }} Tunnel
 */
/** så länge man står ut på perrongen i väntläget (s) */
const GIVE_UP = [45, 90];

/** de som väntar på perrongen */
export const onPlatform = () => S.people.filter(p => p.state === 'platform' && !p.dead);
/** de som är på väg till tåget (inte framme på perrongen än) @param {Person} p */
const toTrain = p => !p.dead && p.state !== 'platform' && p.exitFloor === STATION && p.leaving;
/** kan tåget fastna nu? (det går tåg, inget står vid perrongen och huset brinner inte) */
export const tunnelPossible = () => !S.tunnel && STATION >= 0 && trainsRunning() && !S.trainDone && !S.fire && (!S.train || S.train.state === 'out');

/** Slumpen eller spelaren (act('trigger', 'tunnel')): tåget fastnar i tunneln. false om det inte går nu. */
export function startTunnel() {
  if (!tunnelPossible()) return false;
  S.tunnel = { t0: S.t, ph: 'stuck', mode: '', by: '', until: S.t + rand(110, 170), give: {}, peak: 0, gaveUp: 0, bussed: 0, n: 0 };
  log(sv`🚇 Signalfel! Tåget har stannat i tunneln före ${fl(STATION)} – ingen vet hur länge`, 'alert');
  incidentStarted(STATION);
  return true;
}
/** Beslutet: 'wait' (vänta på tåget) eller 'bus' (ersättningsbussar på gatan). by = 'chief' eller 'player'. */
export function setTunnelMode(mode, by) {
  const T = S.tunnel;
  if (!T || T.ph !== 'stuck' || (mode !== 'wait' && mode !== 'bus')) return false;
  if (T.mode === mode) return true;
  T.mode = mode; T.by = by;
  log(mode === 'bus' ? '🚌 Ersättningsbussar på gatan – alla som ska med tåget går upp genom huset till entrén'
    : '🚇 Vi väntar på tåget – folk står kvar på perrongen', 'alert');
  return true;
}

/** @param {number} _dt */
export function tunnelTick(_dt) {
  const T = S.tunnel;
  if (!T) return;
  if (T.ph === 'stuck') {
    const plat = onPlatform();
    T.peak = Math.max(T.peak, plat.length);
    if (T.mode === 'bus') {
      // ersättningsbussarna: perrongen töms, och den som är på väg dit vänder upp mot entrén
      for (const p of plat) { toStreet(p, 'Ersättningsbuss från gatan – går upp genom huset'); T.bussed++; }
      for (const p of S.people) if (toTrain(p)) { toStreet(p, 'Tåget står i tunneln – tar ersättningsbussen från gatan'); T.bussed++; }
    } else {
      // väntläget: den som har stått länge nog tröttnar och går upp till gatan
      for (const p of plat) {
        const at = T.give[p.id] ??= S.t + rand(GIVE_UP[0], GIVE_UP[1]);
        if (S.t >= at) { toStreet(p, 'Tröttnar på att vänta – går upp till gatan och tar bussen'); T.gaveUp++; }
      }
    }
    if (S.t >= T.until) {
      T.ph = 'coming';
      // (tåget kör in direkt: med sig har det alla som samlats längs linjen sedan förra tåget)
      S.trainNext = S.t;
      log('🚇 Signalfelet är åtgärdat – tåget rullar in mot perrongen', 'alert');
    }
    return;
  }
  // tåget står vid perrongen (eller trafiken har slutat för i dag): det är över
  if ((S.train && S.train.state === 'stop') || !trainsRunning() || S.trainDone) finish(T);
}
/** @param {Tunnel} T */
function finish(T) {
  T.n = S.train && S.train.state === 'stop' ? S.train.n : 0;
  const sec = Math.round(S.t - T.t0);
  const how = T.mode === 'bus' ? sv`Ersättningsbussarna tog ${T.bussed} upp genom huset.`
    : T.gaveUp ? sv`${T.gaveUp} tröttnade på perrongen och gick upp till gatan.` : 'Alla väntade på perrongen.';
  S.tunnel = null;
  incidentOver('tunnel', '✅ Tåget har kommit fram', sv`Tåget stod i tunneln i ${sec} s. Som mest väntade ${T.peak} på perrongen. ${how} ${T.n} klev av när det väl kom.`, { floor: STATION });
}

export function tunnelReset() { S.tunnel = null; }
