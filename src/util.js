// Små hjälpfunktioner.
import { LABELS } from './config.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** första bokstaven versal ("ett kassaskåp" → "Ett kassaskåp") */
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const K = d => (d > 0 ? 'u' : 'd');
export const ARR = d => (d > 0 ? '▲' : d < 0 ? '▼' : '•');
/** våningens etikett (E, 1, 2 … eller P1, T) */
export const fl = f => LABELS[Math.round(f)] ?? String(f);
export const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}
