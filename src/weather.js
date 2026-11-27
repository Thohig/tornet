// Väder: dygnets temperatur och stormen.
// Kyla ger skorstenseffekt: den varma luften i schakten trycker mot entrén, så dörrarna där stänger
// trögt och tar ibland emot (elevators.js). Stormen är en incident med val, som branden: höga schakt
// och panoramahissen på fasaden svajar. I SVAJLÄGE kör de höga hissarna långsammare och panoramahissen
// parkerar i entrén; i normal drift kör allt som vanligt – och linorna kan slå i schaktet (hissfel).
//
// Översikt:
// dygnets temperatur (kyla → skorstenseffekt: dörrarna i entrén tar emot; värme → motorerna kyls sämre) och stormen
// (incident med val: svajläge/normal drift, `windAt`, `exposure`; ibland slår blixten ut strömmen, `strikeAt`)
import { stream } from './rng.js';
import { sv } from './sv.js';
const { rand, rng } = stream('väder');
import { clamp, fl } from './util.js';
import { LOBBY, SKY } from './config.js';
import { S, incidentOver, log, notice } from './state.js';
import { incidentStarted, startOutage } from './incidents.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */

/** hur lätt linorna slår i schaktet i normal drift i storm (vajerlarm per sekund och vindstyrka) */
export const STORM_FAULT_K = 0.3;
export const STORM_HINT = {
  none: 'Hissarna kör som vanligt i full fart. Linorna i de höga schakten svänger – risk för vajerlarm och hissfel.',
  sway: 'Svajläge: höga zonen, expressen och varuhissen kör långsammare och panoramahissen parkerar i entrén tills det mojnar. Säkert, men långsammare.',
};
/** Dygnets väder (anropas av resetDay). Kalla dagar visas som en informationsruta. */
export function weatherReset() {
  // med datum: månadens medeltemperatur ± 7 °C (calendar.js); utan: vilken temperatur som helst, som förr
  const mean = S.cal.tempMean, temp = mean === null ? Math.round(rand(-18, 24)) : Math.round(mean + rand(-7, 7));
  setTemp(temp);
  S.storm = null;
  if (S.weather.cold > 0) notice('cold', sv`❄️ Kall dag: ${temp} °C`,
    'Skorstenseffekten: varm luft stiger i schakten och suger in kall luft genom entrén. Hissdörrarna på E stänger trögt och tar ibland emot.',
    { floor: LOBBY });
}
/** dygnets temperatur; dev = hur långt från månadens medel (eller mitten av det gamla spannet) den ligger @param {number} temp */
function setTemp(temp) {
  S.weather = { temp, cold: clamp((2 - temp) / 18, 0, 1), dev: temp - (S.cal.tempMean ?? TEMP0) };
}
/** mitten av temperaturspannet utan datum */
const TEMP0 = 3;
/** Ett nytt datum (spelaren, act('date')): samma avvikelse från månadens medel, utan nytt slumptal */
export function dateWeather() {
  setTemp(Math.round((S.cal.tempMean ?? TEMP0) + S.weather.dev));
}
/** hur utsatt hissen är för vinden: panoramahissen på fasaden mest, sedan de höga schakten @param {Elevator} e */
export const exposure = e => (e.facade ? 1 : e.maxF >= SKY ? 0.65 : 0);
/** vinden 0–1 just nu (deterministisk: byar räknas ur simuleringstiden, inte ur slumpen) */
export function windAt() {
  const gust = 0.06 * Math.sin(S.t * 1.7) * Math.sin(S.t * 0.53);
  if (!S.storm) return 0.12 + gust;
  const u = clamp((S.t - S.storm.t0) / S.storm.len, 0, 1);
  return clamp(0.12 + (S.storm.peak - 0.12) * Math.min(1, Math.sin(Math.PI * u) * 1.5) + gust * 2, 0, 1);
}
/** vindstyrka i m/s (bara för texter) */
export const windMs = () => Math.round(windAt() * 32);
/** svajläget sänker farten i de höga schakten när det blåser @param {Elevator} e */
export function windMul(e) {
  if (!S.storm || S.storm.mode !== 'sway' || windAt() < 0.45) return 1;
  return 1 - 0.45 * exposure(e);
}
/** Stormen (S.storm): förlopp, svajläge (mode), fel den orsakat och blixten (strikeAt, struck = när den slog ner)
 * @typedef {{ t0: number, len: number, peak: number, mode: string, faults: number, strikeAt: number|null, struck: number|null }} Storm */
export function startStorm() {
  if (S.storm) return false;
  const len = rand(50, 75);
  // ibland slår blixten ner i ställverket mitt i stormen och strömmen går (en kedja av incidenter)
  S.storm = { t0: S.t, len, peak: rand(0.85, 1), mode: 'none', faults: 0, strikeAt: rng() < 0.35 ? S.t + len * rand(0.35, 0.6) : null, struck: null };
  log('🌬️ STORM! Vinden tar i – de höga schakten och panoramahissen börjar svaja', 'alert');
  return true;
}
/** Spelaren: blixten slår ner. Pågår en storm slår den ner direkt, annars drar ett oväder in och slår ner strax. */
export function strikeNow() {
  if (!S.storm) { startStorm(); if (!S.storm) return false; incidentStarted(null); S.storm.strikeAt = S.t + 4; }
  else if (S.storm.struck === null) S.storm.strikeAt = S.t + 0.5;
  else return false;
  log('⛈️ Åskan mullrar – blixten är på väg', 'alert');
  return true;
}
/** Spelaren: en kall dag (skorstenseffekten i entrén) eller en värmebölja (motorerna kyls sämre) */
export function setWeather(kind) {
  const temp = kind === 'cold' ? Math.round(rand(-22, -14)) : Math.round(rand(29, 34));
  if (S.weather.temp === temp) return false;
  setTemp(temp);
  if (kind === 'cold') notice('cold', sv`❄️ Kall dag: ${temp} °C`,
    'Skorstenseffekten: varm luft stiger i schakten och suger in kall luft genom entrén. Hissdörrarna på E stänger trögt och tar ibland emot.', { floor: LOBBY });
  else notice('heatwave', sv`☀️ Värmebölja: ${temp} °C`,
    'Maskinrummen kyls sämre i värmen – motorerna blir lättare överhettade, och driftchefen startar extrafläktarna tidigare.');
  log(kind === 'cold' ? sv`❄️ Kölden slår till: ${temp} °C` : sv`☀️ Värmebölja: ${temp} °C i skuggan`, 'alert');
  return true;
}
export function setStormMode(m) {
  if (!S.storm || S.storm.mode === m) return;
  S.storm.mode = m;
  log(m === 'sway' ? '🌬️ Svajläge: de höga hissarna kör långsamt, panoramahissen parkerar i entrén' : '🌬️ Stormen: hissarna kör som vanligt i full fart', 'alert');
}
export function stormTick(dt) {
  const St = S.storm;
  if (!St) return;
  const w = windAt();
  for (const e of S.elevators) {
    // panoramahissen stängs i svajläget: kör klart sina passagerare och parkerar i entrén
    const lock = e.facade && St.mode === 'sway' && w > 0.45;
    if (lock !== !!e.windLock) {
      e.windLock = lock;
      // utan passagerare ska den hem direkt (även om den var på väg att hämta någon när vinden stängde den)
      if (lock && !e.passengers.length && !e.carCalls.size) e.parkTarget = e.home;
      log(lock ? sv`🌬️ ${e.name} stängs för vinden – parkerar på ${fl(e.home)}` : sv`🌬️ ${e.name} öppnar igen – vinden har mojnat`, 'alert', e.color);
    }
    if (e.windLock && e.mode === 'normal' && e.state === 'idle' && !e.passengers.length && !e.carCalls.size && Math.round(e.pos) !== e.home) e.parkTarget = e.home;
    // normal drift i storm: linorna slår i schaktet – hissen går sönder vid nästa stopp
    const x = exposure(e);
    if (St.mode === 'none' && x > 0 && w > 0.55 && e.state === 'moving' && e.mode === 'normal' && !e.breakNext && S.power) {
      if (rng() < STORM_FAULT_K * x * (w - 0.4) * dt) {
        e.breakNext = true; e.stormFault = true; St.faults++; S.stats.stormFaults++;
        log(sv`🌬️ Linorna i ${e.name}s schakt slår i stormen – vajerlarm, hissen går sönder vid nästa stopp`, 'alert', e.color);
      }
    }
  }
  if (St.strikeAt !== null && !St.struck && S.t >= St.strikeAt) {
    St.struck = S.t;
    if (S.power) {
      log('⚡ Blixten slår ner i ställverket – strömmen går!', 'alert');
      startOutage();
      if (S.outage) S.outage.cause = 'blixt';
    }
  }
  if (S.t - St.t0 >= St.len) {
    log(sv`✅ Stormen har bedarrat${St.faults ? sv` · ${St.faults} vajerlarm` : ''}`, 'alert');
    incidentOver('storm', '✅ Stormen har bedarrat',
      sv`Stormen varade ${Math.round(St.len)} s. ${St.faults ? sv`Linorna slog i schaktet och gav ${St.faults} vajerlarm.` : 'Inga vajerlarm.'}`
      + (St.mode === 'sway' ? ' Svajläget höll de höga hissarna lugna.' : '') + (St.struck ? ' Blixten slog ut strömmen mitt i ovädret.' : ''));
    for (const e of S.elevators) e.windLock = false;
    S.storm = null;
  }
}
