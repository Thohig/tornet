// Seedad slump för simuleringen + visuell slump för grafiken.

// ---------- Slump ----------
// Simuleringen drar ur namngivna slumpströmmar, en per delsystem (ankomster, väder, incidenter …).
// Varje ström seedas för sig ur dygnets frö och sitt namn, så strömmarna är oberoende: ett slumptal
// till (eller ett färre) i vädret flyttar inte vilka som kommer till jobbet eller när hissarna går sönder.
// Samma frö ger exakt samma dag. Generatorn är mulberry32.
//
//   const { rng, rand, pick } = stream('väder');   // en gång, överst i modulen
//
// En ström hör till ett delsystem – dela den inte mellan delsystem som kan ändras var för sig.
// Grafiken använder vanlig Math.random (vrand m.fl.) så att den aldrig påverkar simuleringen.

/** @typedef {{ rng: () => number, rand: (a: number, b: number) => number, randi: (a: number, b: number) => number, pick: <T>(a: T[]) => T, shuffle: <T>(a: T[]) => T[] }} Stream */

let seed0 = 1;
/** @type {Map<string, { s: number }>} */
const streams = new Map();

/** FNV-1a över namnet (32 bitar) */
function hashName(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
/** strömmens starttillstånd: dygnets frö och namnet blandas (splitmix32-finalisering) */
function seedOf(name) {
  let z = (seed0 ^ hashName(name)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Seeda om alla strömmar (resetDay: ett nytt dygn). */
export function setSeed(seed) {
  seed0 = (seed >>> 0) || 1;
  for (const [name, st] of streams) st.s = seedOf(name);
}

/**
 * En namngiven slumpström. Anropas en gång per namn (överst i modulen); samma namn två gånger är ett fel,
 * så att två delsystem aldrig delar ström av misstag.
 * @param {string} name
 * @returns {Stream}
 */
export function stream(name) {
  if (streams.has(name)) throw new Error(`slumpströmmen "${name}" finns redan`);
  const st = { s: seedOf(name) };
  streams.set(name, st);
  const rng = () => {
    st.s = (st.s + 0x6D2B79F5) | 0;
    let t = st.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rand = (a, b) => a + rng() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = a => a[Math.floor(rng() * a.length)];
  /** @template T @param {T[]} a */
  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  return { rng, rand, randi, pick, shuffle };
}
/** strömmarnas namn (för testerna) */
export const streamNames = () => [...streams.keys()];

export const vrand = (a, b) => a + Math.random() * (b - a);
export const vrandi = (a, b) => Math.floor(vrand(a, b + 1));
export const vpick = a => a[Math.floor(Math.random() * a.length)];
