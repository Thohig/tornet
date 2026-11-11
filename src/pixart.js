// Pixelgrafik (16-bit): grundverktyg. Allt ritas på ett rutnät där en pixel = PX världsenheter.
// Figurer byggs upp som rutnät av färgkoder och får sin svarta kontur automatiskt (varje tom ruta
// som gränsar till en fylld blir kontur) – så ser alla figurer ut att höra ihop.
// Bara grafik: rör aldrig simuleringens tillstånd och använder ingen simuleringsslump.
import { PAL } from './pixpal.js';

const INK = PAL.ink;

/** världsenheter per pixel (alla husets mått är jämna, så våningar och schakt hamnar exakt på rutnätet) */
export const PX = 2;

// ---------- Färger ----------
const CACHE_RGB = new Map();
/** '#rrggbb', '#rgb' eller 'rgb(r,g,b)' → [r,g,b] */
export function rgbOf(c) {
  let v = CACHE_RGB.get(c);
  if (v) return v;
  if (c[0] === '#') {
    const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1, 7);
    const n = parseInt(h, 16); v = [n >> 16, (n >> 8) & 255, n & 255];
  } else v = (c.match(/\d+/g) || ['0', '0', '0']).slice(0, 3).map(Number);
  CACHE_RGB.set(c, v);
  return v;
}
const hex = (/** @type {number[]} */ [r, g, b]) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
/** blanda två färger (t = 0 → a, 1 → b) */
export function blend(a, b, t) { const A = rgbOf(a), B = rgbOf(b); return hex([0, 1, 2].map(i => A[i] + (B[i] - A[i]) * t)); }
export const dark = (c, k = 0.3) => blend(c, '#1b1033', k);
export const light = (c, k = 0.35) => blend(c, '#ffffff', k);

// ---------- Rutnätsfigurer ----------
/**
 * Bygg en figur från rader av tecken. pal: tecken → färg ('.' och ' ' = tomt).
 * outline: konturfärg runt allt (null = ingen). Returnerar en liten canvas.
 */
export function sprite(rows, pal, outline = INK) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const pad = outline ? 1 : 0;
  const cells = rows.map(r => [...r.padEnd(w, '.')].map(ch => (ch === '.' || ch === ' ' ? null : pal[ch] || null)));
  return fromCells(cells, w, h, pad, outline);
}
/** samma som sprite men från en färdig matris cells[y][x] (färg eller null) */
export function fromCells(cells, w, h, pad, outline) {
  const c = document.createElement('canvas');
  c.width = w + pad * 2; c.height = h + pad * 2;
  const g = c.getContext('2d');
  if (outline) {
    g.fillStyle = outline;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!cells[y][x]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !cells[ny][nx]) g.fillRect(nx + pad, ny + pad, 1, 1);
      }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = cells[y][x];
    if (col) { g.fillStyle = col; g.fillRect(x + pad, y + pad, 1, 1); }
  }
  return c;
}
/** spegelvänd kopia (för figurer som går åt vänster) */
export function flipped(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
  return c;
}
/** fylld ellips som figur (till moln, helikopter, rök …) */
export function ellipseSprite(w, h, fill, outline = INK, shade = null) {
  const cells = [];
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / (w / 2), dy = (y - cy) / (h / 2);
      const d = dx * dx + dy * dy;
      row.push(d <= 1 ? (shade && dy > 0.35 ? shade : fill) : null);
    }
    cells.push(row);
  }
  return fromCells(cells, w, h, outline ? 1 : 0, outline);
}

// ---------- Bitmapstypsnitt (3×5, versaler) ----------
const G = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  ' ': ['..', '..', '..', '..', '..'], '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'], ':': ['.', '#', '.', '#', '.'],
  ';': ['.', '#', '.', '#', '#'], '!': ['#', '#', '#', '.', '#'], '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['..', '..', '##', '..', '..'], '–': ['...', '...', '###', '...', '...'], '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'], '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'],
  "'": ['#', '#', '.', '.', '.'], '"': ['#.#', '#.#', '...', '...', '...'], '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '&': ['.#.', '#.#', '.#.', '#.#', '.##'], '#': ['#.#', '###', '#.#', '###', '#.#'], '·': ['.', '.', '#', '.', '.'],
  '•': ['..', '##', '##', '..', '..'], '×': ['...', '#.#', '.#.', '#.#', '...'], '=': ['...', '###', '...', '###', '...'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'], '>': ['#..', '.#.', '..#', '.#.', '#..'], '*': ['...', '#.#', '.#.', '#.#', '...'],
  '_': ['...', '...', '...', '...', '###'], '@': ['###', '#.#', '#.#', '#..', '.##'],
  '→': ['..#..', '...#.', '#####', '...#.', '..#..'], '←': ['..#..', '.#...', '#####', '.#...', '..#..'],
  '↑': ['.#.', '###', '.#.', '.#.', '.#.'], '↓': ['.#.', '.#.', '.#.', '###', '.#.'],
  '▲': ['.....', '..#..', '.###.', '#####', '.....'], '▼': ['.....', '#####', '.###.', '..#..', '.....'],
  '⇄': ['..#..', '#####', '.....', '#####', '..#..'], '↹': ['#..#', '####', '#..#', '####', '#..#'],
  '⚡': ['.##', '##.', '###', '.##', '##.'], '🔥': ['.#.', '##.', '###', '###', '.#.'], '⏩': ['#.#.', '####', '#.#.', '....', '....'],
};
// prickar och ringar över Å, Ä, Ö, É (raden ovanför versalen)
const ACCENT = { Å: ['A', '.#.'], Ä: ['A', '#.#'], Ö: ['O', '#.#'], É: ['E', '..#'], Ü: ['U', '#.#'] };
export const FONT_H = 5;
function glyph(ch) {
  const u = ch.toUpperCase();
  if (ACCENT[u]) return { rows: G[ACCENT[u][0]], acc: ACCENT[u][1] };
  return G[u] ? { rows: G[u], acc: null } : null;
}
/** textens bredd i pixlar */
export function textW(str) {
  let w = 0, n = 0;
  for (const ch of str) { const gl = glyph(ch); if (!gl) continue; w += gl.rows[0].length + 1; n++; }
  return Math.max(0, w - (n ? 1 : 0));
}
const TEXT_CACHE = new Map();
/**
 * Text som en liten canvas. scale = pixelstorlek, outline = konturfärg (1 pixel × scale runtom).
 * Höjd: (5 + 1 accentrad) × scale, + kontur.
 */
export function textSprite(str, color = INK, scale = 1, outline = null) {
  const key = `${str}|${color}|${scale}|${outline}`;
  let c = TEXT_CACHE.get(key);
  if (c) return c;
  if (TEXT_CACHE.size > 900) TEXT_CACHE.clear();
  const w = textW(str), h = FONT_H + 1, pad = outline ? 1 : 0;
  const cells = Array.from({ length: h + pad * 2 }, () => new Array(w + pad * 2).fill(null));
  let x = pad;
  for (const ch of str) {
    const gl = glyph(ch); if (!gl) continue;
    gl.rows.forEach((r, y) => [...r].forEach((b, i) => { if (b === '#') cells[y + 1 + pad][x + i] = color; }));
    if (gl.acc) [...gl.acc].forEach((b, i) => { if (b === '#') cells[pad][x + i] = color; });
    x += gl.rows[0].length + 1;
  }
  const base = fromCells(cells, w + pad * 2, h + pad * 2, 0, null);
  if (outline) {
    // kontur: rita texten förskjuten åt alla håll i konturfärgen, sedan texten ovanpå
    const o = document.createElement('canvas'); o.width = base.width; o.height = base.height;
    const og = o.getContext('2d');
    const tint = document.createElement('canvas'); tint.width = base.width; tint.height = base.height;
    const tg = tint.getContext('2d'); tg.drawImage(base, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = outline; tg.fillRect(0, 0, tint.width, tint.height);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) og.drawImage(tint, dx, dy);
    og.drawImage(base, 0, 0);
    c = scaleUp(o, scale);
  } else c = scaleUp(base, scale);
  TEXT_CACHE.set(key, c);
  return c;
}
function scaleUp(src, k) {
  if (k === 1) return src;
  const c = document.createElement('canvas'); c.width = src.width * k; c.height = src.height * k;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
/** rita text; align 'left' | 'center' | 'right'; y = textens överkant (accentraden) */
export function text(g, str, x, y, color = INK, align = 'left', scale = 1, outline = null) {
  const s = textSprite(str, color, scale, outline);
  const dx = align === 'center' ? Math.round(s.width / 2) : align === 'right' ? s.width : 0;
  g.drawImage(s, Math.round(x - dx), Math.round(y));
  return s.width;
}
/** emoji och tecken som saknas i typsnittet tas bort, dubbla mellanslag slås ihop */
export const plain = str => [...str].filter(ch => glyph(ch)).join('').replace(/\s+/g, ' ').trim();

// ---------- LED-siffror (4×7) för våningsdisplayer och hissnamn ----------
// Större och tydligare än brödtexten (3×5): siffror, våningsbokstäverna P/E/T, hissarnas bokstäver och pilar.
const LED = {
  0: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'], 1: ['..#.', '.##.', '..#.', '..#.', '..#.', '..#.', '.###'],
  2: ['.##.', '#..#', '...#', '..#.', '.#..', '#...', '####'], 3: ['###.', '...#', '...#', '.##.', '...#', '...#', '###.'],
  4: ['#..#', '#..#', '#..#', '####', '...#', '...#', '...#'], 5: ['####', '#...', '###.', '...#', '...#', '#..#', '.##.'],
  6: ['.##.', '#...', '#...', '###.', '#..#', '#..#', '.##.'], 7: ['####', '...#', '..#.', '..#.', '.#..', '.#..', '.#..'],
  8: ['.##.', '#..#', '#..#', '.##.', '#..#', '#..#', '.##.'], 9: ['.##.', '#..#', '#..#', '.###', '...#', '...#', '.##.'],
  P: ['###.', '#..#', '#..#', '###.', '#...', '#...', '#...'], E: ['####', '#...', '#...', '###.', '#...', '#...', '####'],
  T: ['####', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.'], L: ['#...', '#...', '#...', '#...', '#...', '#...', '####'],
  H: ['#..#', '#..#', '#..#', '####', '#..#', '#..#', '#..#'], X: ['#..#', '#..#', '.##.', '.##.', '.##.', '#..#', '#..#'],
  V: ['#..#', '#..#', '#..#', '#..#', '#..#', '.##.', '.##.'], K: ['#..#', '#.#.', '##..', '#...', '##..', '#.#.', '#..#'],
  G: ['.###', '#...', '#...', '#.##', '#..#', '#..#', '.###'], ' ': ['..', '..', '..', '..', '..', '..', '..'],
  '▲': ['..#..', '.###.', '#####', '.###.', '.###.', '.###.', '.....'], '▼': ['.....', '.###.', '.###.', '.###.', '#####', '.###.', '..#..'],
};
export const LED_H = 7;
/** bredd i pixlar för LED-text (tecken som saknas hoppas över) */
export function ledW(str) {
  let w = 0, n = 0;
  for (const ch of str) { const r = LED[ch.toUpperCase()]; if (!r) continue; w += r[0].length + 1; n++; }
  return Math.max(0, w - (n ? 1 : 0));
}
const LED_CACHE = new Map();
/** rita LED-text; y = överkant; shadow = färg för en pixels skugga nedåt-höger (ökar kontrasten) */
export function led(g, str, x, y, color, align = 'left', shadow = null) {
  const key = `${str}|${color}|${shadow}`;
  let c = LED_CACHE.get(key);
  if (!c) {
    const w = ledW(str) + (shadow ? 1 : 0), h = LED_H + (shadow ? 1 : 0);
    const cells = Array.from({ length: h }, () => new Array(Math.max(1, w)).fill(null));
    const put = (dx, dy, col) => {
      let cx = 0;
      for (const ch of str) {
        const r = LED[ch.toUpperCase()]; if (!r) continue;
        r.forEach((row, yy) => [...row].forEach((b, i) => { if (b === '#' && cells[yy + dy]) cells[yy + dy][cx + i + dx] = col; }));
        cx += r[0].length + 1;
      }
    };
    if (shadow) put(1, 1, shadow);
    put(0, 0, color);
    c = fromCells(cells, Math.max(1, w), h, 0, null);
    if (LED_CACHE.size > 400) LED_CACHE.clear();
    LED_CACHE.set(key, c);
  }
  const dx = align === 'center' ? Math.round(c.width / 2) : align === 'right' ? c.width : 0;
  g.drawImage(c, Math.round(x - dx), Math.round(y));
  return c.width;
}
