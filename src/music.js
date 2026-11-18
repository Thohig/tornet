// Hissmusiken: en egen liten bossa i 16-bitarsdräkt som går på en kassett inne i hissen man följer
// (eller som personen man följer åker med). Syntetiseras med Web Audio som allt annat ljud.
// Bandet lever med hissen: det drar när korgen bromsar och sätter fart, en sliten hiss hoppar i bandet,
// stängda dörrar dämpar musiken och utan ström saktar bandet ner och tystnar.
// Rent gränssnitt: läser S, ändrar aldrig simuleringen; slump bara med vrand.
import { VMAX } from './config.js';
import { S } from './state.js';
import { vrand } from './rng.js';

const KEY = 'hiss.music';
const BPM = 112;
const STEP = 60 / BPM / 4;   // en sextondel
const AHEAD = 0.2;           // så långt i förväg tonerna läggs ut (sekunder)
const VOL = 0.26;

// ---------- Låten ----------
const SEMI = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
/** 'A4' → Hz */
export const hz = n => {
  const m = /^([A-G][b#]?)(\d)$/.exec(n);
  if (!m) throw new Error(`okänd ton ${n}`);
  return 440 * 2 ** ((SEMI[m[1]] + 12 * (+m[2] + 1) - 69) / 12);
};
/** @typedef {{ next: number, step: number, st: number, swing?: number }} Grid
 *  Musikens rutnät: tiden för nästa sextondel som inte är utlagd än, dess nummer i stycket, en sextondels längd
 *  och swing (hur sent varannan åttondel kommer, andel av en sextondel). */

/**
 * Rytmen i huset: första sextondelen i rutnätet g som kommer minst lat sekunder efter now – dit skjuts
 * engångsljuden (dörrar, pling) så att huset spelar med i musiken. Utan rutnät: genast.
 * @param {number} now @param {Grid|null} g @param {number} [lat] @returns {number}
 */
export function onGrid(now, g, lat = 0.02) {
  const from = now + lat;
  if (!g || !(g.st > 0)) return from;
  let k = Math.ceil((from - g.next) / g.st) - 1; // ett steg tidigare: en svängd åttondel kan ändå hinnas med
  for (let i = 0; i < 4; i++, k++) {
    const sw = g.swing && (((g.step + k) % 4) + 4) % 4 === 2 ? g.swing * g.st : 0;
    const t = g.next + k * g.st + sw;
    if (t >= from) return t;
  }
  return from;
}

/** 'A4:0:3 C5:3:3' → [ton, steg, längd i steg] */
export const mel = s => s.split(' ').map(t => { const [n, a, b] = t.split(':'); return /** @type {[string, number, number]} */ ([n, +a, +b]); });

/** Huvudtemat (husmusiken i score.js lånar melodin). Åtta takter: ackord (mellanläge), bas (grundton, kvint) och melodi i sextondelar. */
export const SONG = [
  { chord: ['F3', 'A3', 'C4', 'E4'], bass: ['F2', 'C3'], mel: mel('A4:0:3 C5:3:3 E5:6:4 D5:10:2 C5:12:4') },
  { chord: ['F3', 'A3', 'C4', 'E4'], bass: ['F2', 'C3'], mel: mel('A4:2:2 G4:4:2 A4:6:6') },
  { chord: ['G3', 'Bb3', 'D4', 'F4'], bass: ['G2', 'D3'], mel: mel('Bb4:0:3 D5:3:3 F5:6:4 E5:10:2 D5:12:4') },
  { chord: ['E3', 'G3', 'Bb3', 'C4'], bass: ['C3', 'G2'], mel: mel('Bb4:2:2 A4:4:2 G4:6:6 E4:12:4') },
  { chord: ['A3', 'C4', 'E4', 'G4'], bass: ['A2', 'E3'], mel: mel('C5:0:3 E5:3:3 G5:6:4 F5:10:2 E5:12:4') },
  { chord: ['F#3', 'A3', 'C4', 'D4'], bass: ['D3', 'A2'], mel: mel('F#5:0:4 E5:4:2 D5:6:2 C5:8:4 A4:12:4') },
  { chord: ['G3', 'Bb3', 'D4', 'F4'], bass: ['G2', 'D3'], mel: mel('Bb4:0:3 A4:3:3 G4:6:2 Bb4:8:2 D5:10:6') },
  { chord: ['E3', 'G3', 'Bb3', 'C4'], bass: ['C3', 'G2'], mel: mel('C5:0:2 Bb4:2:2 A4:4:2 G4:6:4 E4:12:2 G4:14:2') },
];
const LEN = SONG.length * 16;
/** bossabasen: grundton, kvint, kvint, grundton (steg, 0 = grundton / 1 = kvint, längd) */
const BASS = [[0, 0, 6], [6, 1, 2], [8, 1, 6], [14, 0, 2]];
/** gitarrens ackordslag över två takter */
const COMP = [0, 3, 6, 10, 12, 18, 22, 24, 28];
/** kantslag på trumman (bossaklaven) över två takter */
const RIM = [0, 6, 12, 20, 26];

/** @typedef {{ v: 'mel'|'bass'|'comp'|'rim'|'shk', f: number[], len: number, acc?: boolean }} Ev */
/** Låten utlagd per sextondel. @type {Ev[][]} */
const EVENTS = Array.from({ length: LEN }, (_, i) => {
  const bar = SONG[Math.floor(i / 16)], s = i % 16, two = i % 32;
  /** @type {Ev[]} */
  const ev = [];
  for (const [n, at, len] of bar.mel) if (at === s) ev.push({ v: 'mel', f: [hz(n)], len });
  for (const [at, k, len] of BASS) if (at === s) ev.push({ v: 'bass', f: [hz(bar.bass[k])], len });
  if (COMP.includes(two)) ev.push({ v: 'comp', f: bar.chord.map(hz), len: 2 });
  if (RIM.includes(two)) ev.push({ v: 'rim', f: [], len: 1 });
  ev.push({ v: 'shk', f: [], len: 1, acc: s % 4 === 2 });
  return ev;
});

// ---------- På/av ----------
// av som standard: på bara om spelaren har slagit på den
let on = false;
try { on = localStorage.getItem(KEY) === '1'; } catch { /* privat fönster m.m. */ }
export const musicOn = () => on;
export function toggleMusic() {
  on = !on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignoreras */ }
  return on;
}

// ---------- Ljudkedjan ----------
/** @type {AudioContext|null} */
let ac = null;
/** @type {{ bus: GainNode, lp: BiquadFilterNode, pan: StereoPannerNode, fade: GainNode, wow: ConstantSourceNode, pulse: PeriodicWave, noise: AudioBuffer }|null} */
let M = null;

/** Pulsvåg med given pulsbredd – den klassiska 16-bitarsmelodin. */
function pulseWave(duty) {
  const n = 32, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return /** @type {AudioContext} */ (ac).createPeriodicWave(re, im);
}
function init(ctx, dest) {
  if (M && ac === ctx) return;
  ac = ctx;
  const fade = ac.createGain(); fade.gain.value = 0; fade.connect(dest);
  const pan = ac.createStereoPanner(); pan.connect(fade);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.7; lp.connect(pan);
  const bus = ac.createGain(); bus.gain.value = 1; bus.connect(lp);
  // bandets svaj: läggs på varje tons tonhöjd (cent)
  const wow = ac.createConstantSource(); wow.offset.value = 0; wow.start();
  const noise = ac.createBuffer(1, ac.sampleRate / 4, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = vrand(-1, 1);
  M = { bus, lp, pan, fade, wow, pulse: pulseWave(0.25), noise };
}

/** En ton: oscillator med svajet inkopplat och en enkel envelopp. */
function voice(type, f, t, dur, vol, vib = 0) {
  const m = /** @type {NonNullable<typeof M>} */ (M), a = /** @type {AudioContext} */ (ac);
  const o = a.createOscillator();
  if (type === 'pulse') o.setPeriodicWave(m.pulse); else o.type = type;
  o.frequency.value = f;
  m.wow.connect(o.detune);
  /** @type {OscillatorNode|null} */
  let lfo = null;
  if (vib) { // vibrato som kommer in efter en stund, som en sångare
    lfo = a.createOscillator(); lfo.frequency.value = 5.5;
    const lg = a.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(vib, t + Math.min(0.4, dur));
    lfo.connect(lg); lg.connect(o.detune); lfo.start(t); lfo.stop(t + dur + 0.1);
  }
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.setTargetAtTime(vol * 0.6, t + 0.03, dur * 0.4);
  g.gain.setTargetAtTime(0, t + dur, 0.04);
  o.connect(g); g.connect(m.bus);
  o.start(t); o.stop(t + dur + 0.25);
  o.onended = () => { m.wow.disconnect(o.detune); g.disconnect(); };
}
/** Brusslag (shaker, kantslag). */
function hit(t, f, q, dur, vol) {
  const m = /** @type {NonNullable<typeof M>} */ (M), a = /** @type {AudioContext} */ (ac);
  const src = a.createBufferSource(); src.buffer = m.noise;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(m.bus);
  src.start(t, vrand(0, 0.2)); src.stop(t + dur + 0.02);
}

/** Spelar ett steg i låten, transponerat med k. */
function playStep(i, t, k, step) {
  for (const ev of EVENTS[i]) {
    const dur = ev.len * step;
    if (ev.v === 'mel') voice('pulse', ev.f[0] * k, t, dur * 0.92, 0.16, 14);
    else if (ev.v === 'bass') voice('triangle', ev.f[0] * k, t, dur * 0.85, 0.5);
    else if (ev.v === 'comp') for (const f of ev.f) voice('triangle', f * k, t, dur * 0.7, 0.07);
    else if (ev.v === 'rim') hit(t, 1900, 6, 0.05, 0.35);
    else hit(t, 7000, 1.2, ev.acc ? 0.06 : 0.035, ev.acc ? 0.12 : 0.06);
  }
}

// ---------- Varje bildruta ----------
let tape = 0;                 // bandets fart 0..1 (strömavbrott saktar ner det)
let next = /** @type {number|null} */ (null), step = 0;
let carId = -1, lastNow = 0, lastV = 0, dip = 0;
/** @type {Grid|null} */
let grid = null;
/** Kassettens rutnät just nu (null = bandet står eller hörs inte). */
export const musicGrid = () => grid;

/** Grundtonen per hiss: varuhissens band är djupare, expressens ljusare. */
const keyOf = e => 2 ** ((e.freight ? -5 : e.express ? 2 : 0) / 12);

/**
 * Anropas varje bildruta från sound.js med hissen man lyssnar på (null = ingen).
 * hush = 0 när all musik ska tystna (brandkåren kommer, score.js).
 * @param {AudioContext} ctx @param {AudioNode} dest @param {any} e @param {number} panTo @param {number} [hush]
 */
export function updateMusic(ctx, dest, e, panTo, hush = 1) {
  init(ctx, dest);
  const m = /** @type {NonNullable<typeof M>} */ (M);
  const now = ctx.currentTime, dt = Math.min(0.1, Math.max(0, now - lastNow)); lastNow = now;
  const play = on && !!e && S.started && !S.paused;
  if (!play) {
    m.fade.gain.setTargetAtTime(0, now, 0.15);
    next = null; carId = -1; grid = null;
    return;
  }
  // bandet går så länge hissen har ström
  const alive = S.power && e.mode !== 'dead' && e.mode !== 'snapped';
  tape = alive ? Math.min(1, tape + dt / 0.7) : Math.max(0, tape - dt / 1.6);
  if (e.id !== carId) { // ny hiss: hoppa in där dess band är just nu
    carId = e.id; next = null;
    lastV = Math.abs(e.v) / VMAX;
  }
  if (next === null || next < now - 0.1) {
    next = now + 0.05;
    step = Math.floor(now / STEP + e.id * 37) % LEN; // alla band går hela tiden, varje hiss är på sitt ställe i låten
  }
  // bandet drar: tonen sjunker när korgen bromsar och stiger lite när den sätter fart
  const v = Math.abs(e.v) / VMAX;
  const acc = dt > 0 ? (v - lastV) / dt : 0; lastV = v;
  dip += (Math.max(-35, Math.min(25, acc * 30)) - dip) * Math.min(1, dt * 6);
  const wear = e.wear || 0;
  const flutter = (4 + wear * 40) * Math.sin(now * 2 * Math.PI * 0.6);
  const slow = 1200 * Math.log2(Math.max(0.05, tape));
  m.wow.offset.setTargetAtTime(slow + dip + flutter, now, 0.03);

  // stängda dörrar dämpar musiken, öppna släpper ut den
  m.lp.frequency.setTargetAtTime(e.doorPhase ? 5000 : 1300, now, 0.12);
  m.pan.pan.setTargetAtTime(panTo, now, 0.1);
  m.fade.gain.setTargetAtTime(VOL * Math.min(1, tape * 2) * hush, now, hush ? 0.2 : 0.08);

  const k = keyOf(e);
  while (tape > 0.08 && next < now + AHEAD) {
    const st = STEP / tape;
    // en sliten hiss hoppar i bandet: en halv takt spelas om med ett litet hack
    if (step % 16 === 0 && vrand() < Math.max(0, Math.min(0.35, (wear - 0.08) * 0.8))) {
      step = (step - 8 + LEN) % LEN;
      m.wow.offset.setValueAtTime(slow - 140, next);
      m.wow.offset.setTargetAtTime(slow + dip, next + 0.05, 0.02);
      next += st * 2; // ett ögonblick av tystnad när bandet hoppar
    }
    playStep(step, next, k, st);
    step = (step + 1) % LEN;
    next += st;
  }
  grid = tape > 0.08 && hush > 0 && next !== null ? { next, step, st: STEP / tape } : null;
}
