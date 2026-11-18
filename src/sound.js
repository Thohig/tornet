// Ljud: allt syntetiseras med Web Audio (fyrkant, triangel, brus) – inga ljudfiler.
// Rent gränssnitt: läser S varje bildruta och letar efter förändringar (dörrar, ankomst, överlast),
// ändrar aldrig simuleringen. Ljudet är avstängt från början; webbläsaren kräver ett klick innan något får låta.
import { CAR_H, FLOOR_H, VMAX, W, floorY, shaftCX } from './config.js';
import { S } from './state.js';
import { VIEW, camTarget } from './view.js';
import { musicOn, updateMusic } from './music.js';
import { musicHush, updateScore } from './score.js';
import { vrand } from './rng.js';

const KEY = 'hiss.sound';
const MAX_VOICES = 4;      // tak för samtidiga engångsljud (rusningen ska inte låta som en flipper)
const MIN_GAP = 4;         // sekunder mellan två engångsljud från samma hiss
const ALL_GAP = 0.8;       // sekunder mellan två engångsljud över huvud taget (alla hissar)
const MIN_NEAR = 0.5;      // engångsljud bara från hissar i bild eller strax utanför

/** @type {AudioContext|null} */
let ac = null;
/** @type {GainNode|null} */
let master = null;
/** @type {AudioBuffer|null} */
let noise = null;
let on = false, voices = 0, lastAny = -1;
/** Per hiss: motorbrum + vad vi såg förra bildrutan. */
/** @type {{ osc: OscillatorNode, sub: OscillatorNode, gain: GainNode, pan: StereoPannerNode, phase: string|null, flash: number, last: number }[]} */
let cars = [];

try { on = localStorage.getItem(KEY) === '1'; } catch { /* privat fönster m.m. */ }
export const soundOn = () => on;

/** Slår på/av ljudet. Måste anropas från ett klick eller en tangent (webbläsarens krav). */
export function toggleSound() {
  on = !on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignoreras */ }
  if (on) { init(); ac.resume(); } else if (ac) ac.suspend();
  return on;
}
/** Väcker ljudet om det är påslaget men står still: efter en omladdning, eller när det slogs på med ett
 *  pekfinger (anropas vid varje tryck – billigt när ljudet redan går). */
export function unlockSound() { if (on && !document.hidden) { init(); if (ac.state !== 'running') ac.resume(); } }

function init() {
  if (ac) return;
  ac = new AudioContext();
  // kompressor sist så att många pling samtidigt inte klipper
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 6;
  comp.connect(ac.destination);
  master = ac.createGain(); master.gain.value = 0.5; master.connect(comp);
  // en sekund vitt brus att spela delar ur (dörrar, duns)
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = vrand(-1, 1);
  document.addEventListener('visibilitychange', () => {
    if (!on) return;
    if (document.hidden) ac.suspend(); else ac.resume();
  });
}

/** Motorbrummet byggs när hissarna finns (och om när ett nytt hus laddas). */
function ensureCars() {
  if (cars.length === S.elevators.length) return;
  for (const c of cars) { c.osc.stop(); c.sub.stop(); c.gain.disconnect(); }
  cars = S.elevators.map(e => {
    const pan = ac.createStereoPanner(); pan.connect(master);
    const gain = ac.createGain(); gain.gain.value = 0; gain.connect(pan);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2; lp.connect(gain);
    const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 50; osc.connect(lp);
    const sub = ac.createOscillator(); sub.type = 'triangle'; sub.frequency.value = 25; sub.connect(lp);
    osc.start(); sub.start();
    return { osc, sub, gain, pan, phase: e.doorPhase, flash: e.overloadFlash || 0, last: -1 };
  });
}

// ---------- Var hörs hissen? ----------
/** 1 inne i bilden, sedan avtagande ju fler våningar utanför den korgen är. */
function nearness(e) {
  const y = floorY(e.pos) - CAR_H / 2;
  const half = VIEW.viewH / 2, cy = VIEW.camY + half;
  const out = Math.max(0, Math.abs(y - cy) - half) / FLOOR_H;
  return Math.exp(-out / 2.5);
}
/** -1 vänster … 1 höger, efter schaktets plats i bilden. */
function panOf(e) {
  const mid = (VIEW.x0 + W) / 2, half = (W - VIEW.x0) / 2;
  return Math.max(-0.8, Math.min(0.8, ((shaftCX(e.id) - mid) / half) * 0.8));
}
/** Grundtonen skiljer lite mellan hissarna; varuhissen är djupare, expressen ljusare. */
const pitchOf = e => (e.freight ? 0.75 : e.express ? 1.2 : 1) * (1 + ((e.id * 7) % 5) * 0.03);

// ---------- Byggstenar ----------
/** Ny utgång med volym och panorering; släpps när ljudet är slut. */
function out(vol, pan, dur) {
  if (voices >= MAX_VOICES) return null;
  voices++;
  const g = ac.createGain(); g.gain.value = vol;
  const p = ac.createStereoPanner(); p.pan.value = pan;
  g.connect(p); p.connect(master);
  setTimeout(() => { voices--; g.disconnect(); p.disconnect(); }, (dur + 0.1) * 1000);
  return g;
}
/** Ton med snabb attack och avklingning. */
function tone(dst, type, f, t0, dur, vol = 1) {
  const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(dst);
  o.start(t0); o.stop(t0 + dur + 0.02);
  return o;
}
/** Brus genom ett bandpassfilter som sveper från f0 till f1. */
function sweep(dst, f0, f1, t0, dur, vol = 1) {
  const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
  bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.25);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(bp); bp.connect(g); g.connect(dst);
  src.start(t0, vrand(0, 0.5)); src.stop(t0 + dur + 0.02);
}

// ---------- Ljuden ----------
/** Ankomstpling: två toner, uppåt stigande och nedåt fallande (som riktiga hissar). */
function ding(e, vol, pan) {
  const g = out(vol * 0.32, pan, 1.3); if (!g) return;
  const t = ac.currentTime, k = pitchOf(e);
  const [a, b] = e.dir < 0 ? [1046.5, 784] : e.dir > 0 ? [784, 1046.5] : [880, 880];
  for (const [f, t0] of [[a, 0], [b, 0.2]]) {
    tone(g, 'triangle', f * k, t + t0, 1.0);
    tone(g, 'square', f * k * 2, t + t0, 0.12, 0.12); // lite 16-bitarsglans i anslaget
  }
}
/** Dörrarna glider: brus som sveper upp (öppnas) eller ner (stängs). */
function door(e, opening, vol, pan) {
  const g = out(vol * 0.22, pan, 0.6); if (!g) return;
  const t = ac.currentTime, k = pitchOf(e);
  if (opening) sweep(g, 500 * k, 1600 * k, t, 0.5);
  else sweep(g, 1500 * k, 450 * k, t, 0.5);
}
/** Dörrarna slår ihop. */
function thud(e, vol, pan) {
  const g = out(vol * 0.5, pan, 0.25); if (!g) return;
  const t = ac.currentTime;
  const o = tone(g, 'sine', 110 * pitchOf(e), t, 0.18);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
  sweep(g, 300, 200, t, 0.06, 0.6);
}
/** Överlast: vågen i golvet piper envist så länge varningen lyser. */
function buzzer(vol, pan) {
  const n = 7, dur = n * 0.26;
  const g = out(vol * 0.18, pan, dur); if (!g) return;
  const t = ac.currentTime;
  for (let i = 0; i < n; i++) tone(g, 'square', 1320, t + i * 0.26, 0.15);
}

// ---------- Incidenterna: förvarningar, larm, siren, blixt ----------
/** Lågt muller som rullar in (åska långt borta inför stormen, eller blixtnedslaget på nära håll). */
function thunder(near) {
  const dur = near ? 1.6 : 2.6, g = out(near ? 0.9 : 0.45, 0, dur); if (!g) return;
  const t = ac.currentTime;
  if (near) sweep(g, 4000, 300, t, 0.35, 1);
  sweep(g, near ? 220 : 160, 50, t + (near ? 0.05 : 0), dur - 0.1, 1);
}
/** Elektriskt surr som hackar (lamporna flimrar). */
function buzz() {
  const g = out(0.12, 0, 0.9); if (!g) return;
  const t = ac.currentTime;
  for (let i = 0; i < 5; i++) tone(g, 'sawtooth', 100, t + i * 0.17, 0.09, 0.6);
}
/** Brandlarmet: en klocka som ringer i två toner. */
function alarm() {
  const g = out(0.2, 0, 2.2); if (!g) return;
  const t = ac.currentTime;
  for (let i = 0; i < 8; i++) tone(g, 'square', i % 2 ? 660 : 880, t + i * 0.26, 0.2);
}
/** Brandbilens siren som sveper upp och ner. */
function siren() {
  const g = out(0.14, -0.4, 3); if (!g) return;
  const t = ac.currentTime, o = ac.createOscillator(), gg = ac.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(600, t);
  for (let i = 0; i < 6; i++) o.frequency.linearRampToValueAtTime(i % 2 ? 600 : 950, t + 0.45 * (i + 1));
  gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(1, t + 0.4); gg.gain.linearRampToValueAtTime(0, t + 2.9);
  o.connect(gg); gg.connect(g); o.start(t); o.stop(t + 3);
}
/** Motorn brummar ansträngt / det gnisslar i korgen / linorna knarrar. */
function strain(kind) {
  const g = out(0.25, 0, 1.4); if (!g) return;
  const t = ac.currentTime;
  if (kind === 'heat') { const o = tone(g, 'sawtooth', 55, t, 1.3, 0.5); o.frequency.linearRampToValueAtTime(70, t + 1.2); }
  else if (kind === 'fault') sweep(g, 2200, 3400, t, 0.7, 0.8);
  else for (let i = 0; i < 3; i++) sweep(g, 320, 170, t + i * 0.35, 0.3, 0.9); // knarr
}
let heardWarn = -1, heardFire = -1, heardBrigade = -1, heardStrike = -1;
function incidentSounds() {
  const W = S.warn;
  if (W && W.t0 !== heardWarn) {
    heardWarn = W.t0;
    if (W.type === 'storm') thunder(false);
    else if (W.type === 'power') buzz();
    else if (W.type === 'heat' || W.type === 'fault' || W.type === 'cable') strain(W.type);
  }
  if (S.fire && S.fire.t0 !== heardFire) { heardFire = S.fire.t0; alarm(); }
  if (S.brigade && S.brigade.t0 !== heardBrigade) { heardBrigade = S.brigade.t0; siren(); }
  if (S.storm && S.storm.struck !== null && S.storm.struck !== heardStrike) { heardStrike = S.storm.struck; thunder(true); }
}

/** Hissen vars musik hörs: den man följer, eller den som personen man följer åker i. */
function listenCar() {
  const t = camTarget();
  if (t?.kind === 'car') return S.elevators[t.id];
  if (t?.kind === 'person' && S.sel?.state === 'ride' && S.sel.car) return S.sel.car;
  return null;
}

// ---------- Varje bildruta ----------
/** @param {boolean} [intro] rundvisningen pågår (Berit nynnar) */
export function updateSound(intro = false) {
  if (!on || !ac || ac.state !== 'running') return;
  ensureCars();
  incidentSounds();
  const lc = listenCar();
  updateMusic(ac, master, lc, lc ? panOf(lc) : 0, musicHush());
  updateScore(ac, master, musicOn(), !lc, intro);
  const now = ac.currentTime;
  const still = S.paused || !S.started;
  for (const e of S.elevators) {
    const c = cars[e.id];
    const near = nearness(e), pan = panOf(e);
    // motorbrum efter farten; strömlöst eller paus = tyst
    const v = still || !S.power ? 0 : Math.min(1, Math.abs(e.v) / VMAX);
    const k = pitchOf(e);
    c.osc.frequency.setTargetAtTime((42 + 38 * v) * k, now, 0.08);
    c.sub.frequency.setTargetAtTime((21 + 19 * v) * k, now, 0.08);
    c.gain.gain.setTargetAtTime(v > 0.01 ? (0.04 + 0.1 * v) * near : 0, now, 0.12);
    c.pan.pan.setTargetAtTime(pan, now, 0.1);

    // engångsljud: bara vid förändringar sedan förra bildrutan
    const ph = e.doorPhase, was = c.phase, fl = e.overloadFlash || 0;
    c.phase = ph;
    const flashUp = fl > c.flash + 0.5; c.flash = fl;
    if (still || near < MIN_NEAR) continue;
    // överlastsummern är en varning och får alltid låta; resten glesas ut
    if (flashUp) { buzzer(near, pan); c.last = lastAny = now; continue; }
    if (now - c.last < MIN_GAP || now - lastAny < ALL_GAP) continue;
    let played = true;
    if (ph === 'opening' && was !== 'opening') { ding(e, near, pan); door(e, true, near, pan); }
    else if (ph === 'closing' && was !== 'closing') door(e, false, near, pan);
    else if (ph === null && was === 'closing') thud(e, near, pan);
    else played = false;
    if (played) c.last = lastAny = now;
  }
}
