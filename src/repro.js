// Återskapa ett ögonblick: adressen ?seed=…&t=… startar exakt samma dygn som en simulering och spolar fram till
// samma steg, så att det man såg i ett test (eller någon annanstans) går att titta på i spelet.
// Simuleringen är deterministisk (rng.js), så fröet och inställningarna från newSim (S.origin) räcker – så länge
// inget annat än stegen har ändrat dygnet (spelaråtgärder, framkallade incidenter). Ingen DOM: används både
// av testerna (tests/suite.js skriver länken när en invariant bryts) och av spelet (start.js läser den).
//
// Översikt:
// ögonblicket i adressen: `reproQuery` (fröet, newSim-inställningarna ur `S.origin` med datumet `date`, `t`, `follow`), `parseRepro`,
// `fastForward` (fasta steg till `t` eller klockslaget `h`). Spelet (start.js) startar dygnet ur adressen, spolar
// fram och pausar; testerna skriver länken när en regel bryts
import { S, hour } from './state.js';
import { DT, step } from './sim.js';
import { TEMPOS } from './config.js';
import { INC_LEVELS } from './incidents.js';
import { parseDate } from './calendar.js';

/**
 * Hur simuleringen startades (newSim sparar det i S.origin).
 * @typedef {{ seed: number, strategy: string, incLevel: string, chief: boolean, chiefStrat: boolean,
 *   mistakes: string, maint: string, roll: string, tempo: string, date: string|null }} Origin
 */
/** Ett ögonblick ur adressen: newSim-inställningarna, vart det ska spolas och vad kameran ska följa
 * @typedef {{ seed: number, opts: Record<string, any>, t: number|null, h: number|null, follow: string|null }} Repro */

// adressens namn på inställningarna (kortare än fälten i Origin)
const KEYS = /** @type {const} */ ([['strategy', 'strategy'], ['inc', 'incLevel'], ['chief', 'chief'], ['chiefStrat', 'chiefStrat'],
  ['mistakes', 'mistakes'], ['maint', 'maint'], ['roll', 'roll'], ['tempo', 'tempo'], ['date', 'date']]);

/**
 * Adressens fråga för ögonblicket just nu (eller tiden t i simuleringen origin): fröet, newSim-inställningarna,
 * S.t och det kameran ska följa.
 * @param {{ origin?: Origin|null, t?: number, follow?: string|null }} [o]
 */
export function reproQuery(o = {}) {
  const g = o.origin ?? S.origin;
  if (!g) return '';
  const q = new URLSearchParams({ seed: String(g.seed) });
  // (date=0: utan datum, den neutrala dagen – annars tar spelet dagens datum och dygnet blir ett annat)
  for (const [k, f] of KEYS) q.set(k, f === 'date' ? g.date ?? '0' : typeof g[f] === 'boolean' ? (g[f] ? '1' : '0') : String(g[f]));
  q.set('t', (o.t ?? S.t).toFixed(4));
  if (o.follow) q.set('follow', o.follow);
  return `?${q}`;
}

/**
 * Läs ett ögonblick ur adressen. null om det inte finns något frö.
 * @param {string} search location.search
 * @returns {Repro|null}
 */
export function parseRepro(search) {
  const q = new URLSearchParams(search), seed = parseInt(q.get('seed') ?? '', 10);
  if (!Number.isFinite(seed)) return null;
  /** @type {Record<string, any>} */
  const opts = {};
  for (const [k, f] of KEYS) {
    const v = q.get(k);
    if (v === null) continue;
    if (f === 'chief' || f === 'chiefStrat') opts[f] = v === '1' || v === 'true';
    else if (f === 'tempo' && !(v in TEMPOS)) continue;
    else if (f === 'incLevel' && !INC_LEVELS.includes(v)) continue;
    else if (f === 'date' && v === '0') opts.date = null; // (den neutrala dagen, som testerna kör)
    else if (f === 'date' && !parseDate(v)) continue;
    else opts[f] = v;
  }
  const num = /** @param {string} k */ k => { const n = parseFloat(q.get(k) ?? ''); return Number.isFinite(n) ? n : null; };
  return { seed, opts, t: num('t'), h: num('h'), follow: q.get('follow') };
}

/** Bara inställningar som påverkar dygnet – ett frö utan t/h/inställningar är ett vanligt dygn i spelet. @param {Repro} r */
export const isMoment = r => r.t !== null || r.h !== null;

/**
 * Spola fram med fasta steg (samma som testerna) till simuleringstiden t eller klockslaget h.
 * Stannar om dygnet tar slut. Returnerar antalet steg.
 * @param {{ t?: number|null, h?: number|null }} to
 */
export function fastForward(to) {
  let n = 0;
  // (S.t växer med DT per steg – samma flyttal som i testet, så steget blir exakt detsamma)
  const more = () => !S.summaryShown && (to.t != null ? S.t < to.t - DT / 2 : to.h != null ? hour() < to.h : false);
  while (more() && n < 5e6) { step(DT); n++; }
  return n;
}
