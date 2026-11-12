// Väder: dygnets temperatur och stormen.
// Kyla ger skorstenseffekt: den varma luften i schakten trycker mot entrén, så dörrarna där stänger
// trögt och tar ibland emot (elevators.js). Stormen är en incident med val, som branden: höga schakt
// och panoramahissen på fasaden svajar. I SVAJLÄGE kör de höga hissarna långsammare och panoramahissen
// parkerar i entrén; i normal drift kör allt som vanligt – och linorna kan slå i schaktet (hissfel).
import { rand, rng } from './rng.js';
import { clamp, fl } from './util.js';
import { LOBBY, SKY } from './config.js';
import { S, log, notice } from './state.js';

export const STORM_HINT = {
  none: 'Hissarna kör som vanligt i full fart. Linorna i de höga schakten svänger – risk för vajerlarm och hissfel.',
  sway: 'Svajläge: höga zonen, expressen och varuhissen kör långsammare och panoramahissen parkerar i entrén tills det mojnar. Säkert, men långsammare.',
};
/** Dygnets väder (anropas av resetDay). Kalla dagar visas som en informationsruta. */
export function weatherReset() {
  const temp = Math.round(rand(-18, 24));
  S.weather = { temp, cold: clamp((2 - temp) / 18, 0, 1) };
  S.storm = null;
  if (S.weather.cold > 0) notice('cold', `❄️ Kall dag: ${temp} °C`,
    'Skorstenseffekten: varm luft stiger i schakten och suger in kall luft genom entrén. Hissdörrarna på E stänger trögt och tar ibland emot.',
    { floor: LOBBY });
}
/** hur utsatt hissen är för vinden: panoramahissen på fasaden mest, sedan de höga schakten */
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
/** svajläget sänker farten i de höga schakten när det blåser */
export function windMul(e) {
  if (!S.storm || S.storm.mode !== 'sway' || windAt() < 0.45) return 1;
  return 1 - 0.45 * exposure(e);
}
export function startStorm() {
  if (S.storm) return false;
  S.storm = { t0: S.t, len: rand(50, 75), peak: rand(0.85, 1), mode: 'none', faults: 0 };
  log('🌬️ STORM! Vinden tar i – de höga schakten och panoramahissen börjar svaja', 'alert');
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
      log(lock ? `🌬️ ${e.name} stängs för vinden – parkerar på ${fl(e.home)}` : `🌬️ ${e.name} öppnar igen – vinden har mojnat`, 'alert', e.color);
    }
    if (e.windLock && e.mode === 'normal' && e.state === 'idle' && !e.passengers.length && !e.carCalls.size && Math.round(e.pos) !== e.home) e.parkTarget = e.home;
    // normal drift i storm: linorna slår i schaktet – hissen går sönder vid nästa stopp
    const x = exposure(e);
    if (St.mode === 'none' && x > 0 && w > 0.55 && e.state === 'moving' && e.mode === 'normal' && !e.breakNext && S.power) {
      if (rng() < 0.05 * x * (w - 0.4) * dt) {
        e.breakNext = true; e.stormFault = true; St.faults++; S.stats.stormFaults++;
        log(`🌬️ Linorna i ${e.name}s schakt slår i stormen – vajerlarm, hissen går sönder vid nästa stopp`, 'alert', e.color);
      }
    }
  }
  if (S.t - St.t0 >= St.len) {
    log(`✅ Stormen har bedarrat${St.faults ? ` · ${St.faults} vajerlarm` : ''}`, 'alert');
    for (const e of S.elevators) e.windLock = false;
    S.storm = null;
  }
}
