// Seedad slump för simuleringen + visuell slump för grafiken.

// ---------- Slump ----------
// Simuleringen använder en seedad generator (mulberry32): samma frö ger exakt samma dag.
// Grafiken använder vanlig Math.random (vrand m.fl.) så att den aldrig påverkar simuleringen.
export let rngState = 1;
export function setSeed(seed) { rngState = (seed >>> 0) || 1; }
export function rng() {
  rngState = (rngState + 0x6D2B79F5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rand = (a, b) => a + rng() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = a => a[Math.floor(rng() * a.length)];
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const vrand = (a, b) => a + Math.random() * (b - a);
export const vrandi = (a, b) => Math.floor(vrand(a, b + 1));
export const vpick = a => a[Math.floor(Math.random() * a.length)];
