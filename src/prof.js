// Profilläget (?prof=1): hur lång tid varje del av bildrutan tar, ritat direkt i bilden – särskilt nyttigt på
// mobilen, där det inte finns några utvecklarverktyg till hands. Mäter JavaScript-tiden (det som ger
// webbläsaren ritkommandona); själva pixlarna ritas sedan av grafikkortet och syns i bildfrekvensen.
// Bara gränssnitt: simuleringen importerar aldrig den här modulen. Avstängt kostar varje anrop ett villkor.
import { VIEW } from './view.js';

const on = typeof location !== 'undefined' && new URLSearchParams(location.search).get('prof') === '1';
export const profOn = () => on;

const EVERY_MS = 1000;        // så ofta siffrorna räknas om (de visar snittet över den senaste sekunden)
const FULL_MS = 1000 / 60;    // en hel stapel = en bildruta i 60 bilder/s

/** tid denna mätperiod per del (ms), i den ordning delarna dök upp */
const acc = new Map();
/** lagren som ritats om: tid och antal (ingår redan i den del där lagret används) */
let layerMs = 0, layerN = 0;
let t = 0, frameT0 = 0, frames = 0, worst = 0, periodT0 = 0;
/** det som visas: [del, ms per bildruta] */
let shown = /** @type {[string, number][]} */ ([]);
let shownFps = 0, shownWorst = 0, shownLayer = 0, shownLayerN = 0, shownTotal = 0;

/** En ny bildruta börjar (main.js). */
export function profFrame() {
  if (!on) return;
  const now = performance.now();
  if (frameT0) { frames++; worst = Math.max(worst, now - frameT0); }
  frameT0 = t = now;
  if (!periodT0) periodT0 = now;
  if (now - periodT0 >= EVERY_MS && frames) {
    shown = [...acc].map(([k, ms]) => /** @type {[string, number]} */ ([k, ms / frames]));
    shownTotal = shown.reduce((a, [, ms]) => a + ms, 0);
    shownFps = frames * 1000 / (now - periodT0); shownWorst = worst;
    shownLayer = layerMs / frames; shownLayerN = layerN;
    acc.clear(); layerMs = 0; layerN = 0; frames = 0; worst = 0; periodT0 = now;
  }
}
/** Tiden sedan förra lap() (eller bildrutans början) hör till delen name. */
export function lap(name) {
  if (!on) return;
  const now = performance.now();
  acc.set(name, (acc.get(name) || 0) + now - t);
  t = now;
}
/** Ett lager i pixcore.js ritades om (ms). */
export function profLayer(ms) {
  if (!on) return;
  layerMs += ms; layerN++;
}

/** Tabellen uppe till vänster i bilden: del, ms per bildruta och en stapel. @param {CanvasRenderingContext2D} c */
export function drawProf(c) {
  if (!on) return;
  const d = VIEW.dpr || 1, fs = Math.round(16 * d), lh = Math.round(fs * 1.05), pad = Math.round(6 * d);
  const rows = shown.length + 3, wTxt = Math.round(118 * d), wBar = Math.round(90 * d), wNum = Math.round(44 * d);
  const W = pad * 2 + wTxt + wNum + wBar, Hh = pad * 2 + rows * lh;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 0.85; c.fillStyle = '#000'; c.fillRect(pad, pad, W, Hh); c.globalAlpha = 1;
  c.font = `${fs}px VT323, monospace`; c.textBaseline = 'top';
  const x0 = pad * 2, num = ms => ms.toFixed(ms < 10 ? 2 : 1);
  let y = pad * 2;
  const row = (label, ms, color, bar = true) => {
    c.fillStyle = color; c.textAlign = 'left'; c.fillText(label, x0, y);
    c.textAlign = 'right'; c.fillText(num(ms), x0 + wTxt + wNum - Math.round(4 * d), y);
    if (bar) {
      const bw = Math.max(1, Math.min(1, ms / FULL_MS) * wBar);
      c.fillStyle = ms > FULL_MS / 3 ? '#ff5555' : ms > FULL_MS / 10 ? '#ffff55' : '#55ff55';
      c.fillRect(x0 + wTxt + wNum, y + Math.round(lh * 0.25), bw, Math.round(lh * 0.5));
    }
    y += lh;
  };
  c.fillStyle = '#aaa'; c.textAlign = 'left';
  c.fillText(`${shownFps.toFixed(0)} bilder/s · värsta ${shownWorst.toFixed(0)} ms`, x0, y); y += lh;
  for (const [k, ms] of shown) row(k, ms, '#ddd');
  row('summa', shownTotal, '#fff');
  row(`lager ritas om ×${shownLayerN}`, shownLayer, '#aaa', false);
  c.restore();
}
