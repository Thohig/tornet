// Husmusiken: chiptune som följer dygnet (ragtime i rusningen, vals på förmiddagen, jazz till lunch, lounge på
// kvällen, speldosa på natten) och byter mjukt mellan styckena. Ovanpå det korta inslag: förvarningen, fanfaren
// när en incident är över, brandkårens dum-dum-dum (musiken tystnar), guidens visselmelodi när Stadsturen syns,
// tubatemat medan hissbalken jobbar på flyttdagen, Berit som nynnar huvudtemat i rundvisningen och tunnelbanans
// signal som musiken svarar på. Noterna står i scoreData.js.
// Hörs när ingen hissmusik spelar (music.js – följer du en hiss är det kassetten i korgen som låter).
// Rent gränssnitt: läser S, ändrar aldrig simuleringen; slump bara med vrand.
import { FLOOR_H, STATION, floorY } from './config.js';
import { S, hour } from './state.js';
import { vrand } from './rng.js';
import { VIEW, seeH } from './view.js';
import { personHead } from './render.js';
import { trafficMode } from './dispatch.js';
import { hz } from './music.js';
import { CUES, PIECES, layout, partOf } from './scoreData.js';

const VOL = 0.2;            // husmusiken ligger under hissmusiken och ljudeffekterna
const AHEAD = 0.25;         // så långt i förväg tonerna läggs ut (sekunder)
const FADE_S = 2.2;         // så lång tid ett stycke tar på sig att tona ut och nästa att tona in
const HUSH_S = 6;           // så länge musiken tystnar när brandkåren kommer

/** @typedef {import('./scoreData.js').Piece} Piece */
/** @type {Record<string, import('./scoreData.js').ScoreEv[][]>} */
const EVENTS = Object.fromEntries(Object.entries(PIECES).map(([k, P]) => [k, layout(P)]));

// ---------- Ljudkedjan ----------
/** @type {AudioContext|null} */
let ac = null;
/** @typedef {{ gain: GainNode, lvl: number, next: number|null, step: number }} Slot */
/** @type {{ bus: GainNode, cue: GainNode, pulse: PeriodicWave, noise: AudioBuffer, slots: Record<string, Slot> }|null} */
let M = null;

function pulseWave(duty) {
  const n = 32, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return /** @type {AudioContext} */ (ac).createPeriodicWave(re, im);
}
function init(ctx, dest) {
  if (M && ac === ctx) return;
  ac = ctx;
  const bus = ac.createGain(); bus.gain.value = VOL; bus.connect(dest);
  const cue = ac.createGain(); cue.gain.value = 1.3; cue.connect(bus);
  const noise = ac.createBuffer(1, ac.sampleRate / 2, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = vrand(-1, 1);
  /** @type {Record<string, Slot>} */
  const slots = {};
  for (const [k, P] of Object.entries(PIECES)) {
    const gain = ac.createGain(); gain.gain.value = 0; gain.connect(bus);
    if (P.echo) { // eko: fördröjning med återkoppling
      const dl = ac.createDelay(1); dl.delayTime.value = P.echo.time;
      const fb = ac.createGain(); fb.gain.value = P.echo.fb;
      const wet = ac.createGain(); wet.gain.value = P.echo.mix;
      gain.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(bus);
    }
    slots[k] = { gain, lvl: 0, next: null, step: 0 };
  }
  M = { bus, cue, pulse: pulseWave(0.25), noise, slots };
}

// ---------- Instrumenten ----------
/** Envelopp: attack, sedan klingar av mot sustain och släpps efter dur. */
function env(g, t, dur, vol, att = 0.01, sus = 0.6, rel = 0.05) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.setTargetAtTime(vol * sus, t + att + 0.02, Math.max(0.02, dur * 0.4));
  g.gain.setTargetAtTime(0, t + dur, rel);
}
/** Vibrato i cent som kommer in efter en stund. */
function vibrato(o, t, dur, cents, rate = 5.5) {
  const a = /** @type {AudioContext} */ (ac);
  const lfo = a.createOscillator(); lfo.frequency.value = rate;
  const lg = a.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(cents, t + Math.min(0.35, dur));
  lfo.connect(lg); lg.connect(o.detune); lfo.start(t); lfo.stop(t + dur + 0.3);
}
/** Oscillator → (filter) → envelopp → dst. Städar efter sig. */
function osc(dst, type, f, t, dur, vol, o = {}) {
  const a = /** @type {AudioContext} */ (ac), m = /** @type {NonNullable<typeof M>} */ (M);
  const n = a.createOscillator();
  if (type === 'pulse') n.setPeriodicWave(m.pulse); else n.type = type;
  n.frequency.value = f;
  if (o.detune) n.detune.value = o.detune;
  if (o.scoop) { n.frequency.setValueAtTime(f * o.scoop, t); n.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
  if (o.vib) vibrato(n, t, dur, o.vib, o.rate);
  const g = a.createGain();
  if (o.decay) { // anslag som klingar ut (vibrafon, speldosa, signal)
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + o.decay);
  } else env(g, t, dur, vol, o.att, o.sus, o.rel);
  let head = /** @type {AudioNode} */ (n);
  /** @type {BiquadFilterNode|null} */
  let lp = null;
  if (o.lp) { lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp; lp.Q.value = 0.8; n.connect(lp); head = lp; }
  head.connect(g); g.connect(dst);
  const end = t + (o.decay || dur + (o.rel || 0.05) * 6) + 0.05;
  n.start(t); n.stop(end);
  n.onended = () => { g.disconnect(); if (lp) lp.disconnect(); };
}
/** Brus genom ett bandpassfilter (virvel, visp, hihat). */
function noiseHit(dst, t, f, q, dur, vol) {
  const a = /** @type {AudioContext} */ (ac), m = /** @type {NonNullable<typeof M>} */ (M);
  const src = a.createBufferSource(); src.buffer = m.noise;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(dst);
  src.start(t, vrand(0, 0.3)); src.stop(t + dur + 0.02);
  src.onended = () => { g.disconnect(); bp.disconnect(); };
}

/** Ett instrument spelar tonen f med start t och längd dur (sekunder). */
function play(dst, inst, f, t, dur) {
  switch (inst) {
    case 'sq': return osc(dst, 'square', f, t, dur * 0.85, 0.09);
    case 'pulse': return osc(dst, 'pulse', f, t, dur * 0.9, 0.12, { vib: 12 });
    case 'tri': return osc(dst, 'triangle', f, t, dur * 0.85, 0.42);
    case 'comp': return osc(dst, 'triangle', f, t, dur * 0.7, 0.06);
    case 'vib': // vibrafon: sinus med en ljus överton som klingar ut
      osc(dst, 'sine', f, t, dur, 0.2, { decay: 1.4 + dur, vib: 8, rate: 4.5 });
      return osc(dst, 'sine', f * 4, t, dur, 0.03, { decay: 0.25 });
    case 'mute': return osc(dst, 'square', f, t, Math.min(dur, 0.16), 0.1, { lp: 1100, sus: 0.4 });
    case 'soft': return osc(dst, 'triangle', f, t, dur * 0.95, 0.2, { att: 0.06, vib: 10 });
    case 'pad': return osc(dst, 'triangle', f, t, dur, 0.06, { att: 0.5, sus: 0.9, rel: 0.6, vib: 6, rate: 3 });
    case 'box': // speldosans kam: ren ton och en metallisk överton
      osc(dst, 'sine', f, t, dur, 0.17, { decay: 2.2 });
      return osc(dst, 'sine', f * 3.01, t, dur, 0.025, { decay: 0.4 });
    case 'boxlo': return osc(dst, 'sine', f, t, dur, 0.08, { decay: 2.6 });
    case 'tuba': return osc(dst, 'square', f, t, dur * 0.9, 0.3, { lp: 380, scoop: 0.94, att: 0.03, sus: 0.8 });
    case 'hum': // Berit nynnar – varje ton hamnar lite fel och vibratot är bredare än det borde
      return osc(dst, 'triangle', f, t, dur * 0.95, 0.2, { detune: vrand(-35, 35), att: 0.07, sus: 0.8, vib: 22, rate: 4.8, lp: 1500 });
    case 'whistle': return osc(dst, 'sine', f, t, dur, 0.14, { scoop: 0.93, vib: 18, rate: 6.5, att: 0.02, sus: 0.9 });
    case 'chime': // tågets signal
      osc(dst, 'triangle', f, t, dur, 0.3, { decay: dur + 0.6 });
      return osc(dst, 'sine', f * 2, t, dur, 0.06, { decay: 0.3 });
    case 'sn': return noiseHit(dst, t, 1800, 0.8, 0.11, 0.35);
    case 'brush': return noiseHit(dst, t, 3200, 0.5, 0.2, 0.12);
    case 'hat': return noiseHit(dst, t, 8000, 1.2, 0.04, 0.12);
    case 'thump':
      noiseHit(dst, t, 200, 1, 0.08, 0.5);
      return osc(dst, 'sine', 70, t, 0.18, 0.5, { scoop: 1.6 });
  }
}
/** Ett kort inslag ur CUES med start t. */
function cue(name, t) {
  const m = /** @type {NonNullable<typeof M>} */ (M);
  for (const [inst, n, at, dur] of CUES[name]) play(m.cue, inst, hz(n), t + at, dur);
}

// ---------- Vad som ska höras ----------
/** Vilket stycke som spelar just nu. */
function current(intro) {
  if (intro) return 'hum';
  const H = S.hoist;
  if (S.move && H && H.phase !== 'idle' && !H.halted) return 'tuba';
  const h = hour();
  return partOf(h, trafficMode(h));
}
/** Syns våning f i bilden (med marginal i våningar)? */
function inView(y, margin = 0) {
  return y > VIEW.camY - margin * FLOOR_H && y < VIEW.camY + seeH() + margin * FLOOR_H;
}
/** Syns guiden för Stadsturen just nu? */
function guideSeen() {
  const T = S.tour;
  if (!T || T.guide < 0) return false;
  const p = S.people.find(q => q.id === T.guide && !q.dead);
  if (!p || p.state === 'office' || p.state === 'away') return false;
  const h = personHead(p);
  return !!h && !h.hidden && inView(h.y);
}

// ---------- Varje bildruta ----------
let lastNow = 0, primed = false;
let heardWarn = -1, heardInc = -1, heardBrigade = -1;
/** @type {object|null} */
let heardTrain = null;
let hushUntil = 0, whistleAt = 0;

/** Brandkåren tystar all musik en stund (0 = tyst, 1 = som vanligt). Hissmusiken läser den också. */
export const musicHush = () => (ac && ac.currentTime < hushUntil ? 0 : 1);

/**
 * Anropas varje bildruta från sound.js. house = husmusiken får höras (ingen hissmusik spelar),
 * on = musiken är påslagen, intro = rundvisningen pågår.
 * @param {AudioContext} ctx @param {AudioNode} dest @param {boolean} on @param {boolean} house @param {boolean} intro
 */
export function updateScore(ctx, dest, on, house, intro) {
  init(ctx, dest);
  const m = /** @type {NonNullable<typeof M>} */ (M);
  const now = ctx.currentTime, dt = Math.min(0.1, Math.max(0, now - lastNow)); lastNow = now;
  const live = on && S.started && !S.paused;
  // det som redan hänt när musiken slås på (eller ett nytt dygn laddas) spelas inte upp i efterhand
  if (!live || !primed) {
    heardWarn = S.warn ? S.warn.t0 : -1; heardInc = S.lastInc ? S.lastInc.id : -1;
    heardBrigade = S.brigade ? S.brigade.t0 : -1; heardTrain = S.train;
    primed = live;
  }
  if (live) {
    if (S.warn && S.warn.t0 !== heardWarn) { heardWarn = S.warn.t0; cue('warn', now + 0.05); }
    if (S.lastInc && S.lastInc.id !== heardInc) { heardInc = S.lastInc.id; cue('clear', now + 0.05); }
    if (S.brigade && S.brigade.t0 !== heardBrigade) {
      heardBrigade = S.brigade.t0; hushUntil = now + HUSH_S; cue('brigade', now + 0.6);
    }
  }

  const want = live && house && now >= hushUntil ? current(intro) : null;
  for (const [k, sl] of Object.entries(m.slots)) {
    const target = k === want ? 1 : 0;
    sl.lvl = target > sl.lvl ? Math.min(1, sl.lvl + dt / FADE_S) : Math.max(0, sl.lvl - dt / (now < hushUntil ? 0.4 : FADE_S));
    sl.gain.gain.setTargetAtTime(sl.lvl * sl.lvl, now, 0.05);
    if (!live || (sl.lvl === 0 && !target)) { sl.next = null; continue; }
    schedule(k, sl, now);
  }

  // tunnelbanan: tåget som stannar vid perrongen ger signal på slaget, och musiken svarar
  const Tr = S.train;
  if (live && Tr && Tr.state === 'stop' && Tr !== heardTrain) {
    heardTrain = Tr;
    if (STATION >= 0 && inView(floorY(STATION), 1.5)) trainSignal(now, want);
  }
  // Stadsturen: guiden visslar när gruppen är i bild
  if (live && guideSeen()) {
    if (now >= whistleAt) { cue('whistle', now + 0.05); whistleAt = now + vrand(9, 15); }
  } else whistleAt = Math.max(whistleAt, now + vrand(0.5, 2));
}

/** Lägger ut stycket k:s toner fram till AHEAD. */
function schedule(k, sl, now) {
  const P = PIECES[k], ev = EVENTS[k], st = 60 / P.bpm / 4;
  if (sl.next === null || sl.next < now - 0.1) { sl.next = now + 0.05; sl.step = 0; }
  while (sl.next < now + AHEAD) {
    const swing = P.swing && sl.step % 4 === 2 ? P.swing * st : 0;
    for (const e of ev[sl.step]) {
      const dur = e.len * st;
      if (!e.f.length) play(sl.gain, e.inst, 0, sl.next + swing, dur);
      else for (const f of e.f) play(sl.gain, e.inst, f, sl.next + swing, dur);
    }
    sl.step = (sl.step + 1) % ev.length;
    sl.next += st;
  }
}

/** Tågets två toner på nästa slag i stycket som spelar, och stycket svarar med två egna toner. */
function trainSignal(now, want) {
  const m = /** @type {NonNullable<typeof M>} */ (M);
  const sl = want ? m.slots[want] : null, P = want ? PIECES[want] : PIECES.waltz;
  const beat = 60 / P.bpm;
  let t = now + 0.05;
  if (sl && sl.next !== null && sl.lvl > 0.3) { // på slaget
    const st = beat / 4, left = (4 - (sl.step % 4)) % 4;
    t = sl.next + left * st;
    if (t < now + 0.03) t += beat;
  }
  cue('train', t);
  const [a, b] = P.ans;
  const at = t + Math.max(1.4, beat * 2);
  play(m.cue, 'pulse', hz(a), at, beat * 0.5);
  play(m.cue, 'pulse', hz(b), at + beat * 0.5, beat);
}
