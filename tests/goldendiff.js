// Jämför dygnens fingeravtryck mot facit (tests/golden.json) och berättar vad som skiljer:
// vilka dygn, vilka nyckeltal och hur mycket. Används av facit-testet (suite.js) och av
// `npm run golden` (run.mjs), som visar skillnaden innan facit skrivs om.
// Ren data in och text ut – körs både i Node och i webbläsaren.

/** En hiss i fingeravtrycket: "L1@3.0000:134stopp:306.00vån" → delarna. */
function parseCar(s) {
  const m = /^(.+?)@([-\d.]+):(\d+)stopp:([-\d.]+)vån$/.exec(s);
  return m ? { name: m[1], pos: +m[2], trips: +m[3], dist: +m[4] } : null;
}

const num = v => typeof v === 'number' && Number.isFinite(v);
/** Ändringen med tecken och, för stora tal, i procent: "+2", "−21.967 (−0.2 %)". */
function delta(a, b) {
  const d = +(b - a).toFixed(4);
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const pct = a !== 0 && Math.abs(a) >= 10 ? ` (${sign}${Math.abs((d / a) * 100).toFixed(1)} %)` : '';
  return `${sign}${Math.abs(d)}${pct}`;
}

/** Skillnaden i hissarna, en rad per hiss som ändrats. */
function carDiff(want, got) {
  const a = String(want ?? '').split(' ').map(parseCar), b = String(got ?? '').split(' ').map(parseCar);
  if (a.some(x => !x) || b.some(x => !x) || a.length !== b.length) return [`hissar: ${want} → ${got}`];
  const out = [];
  a.forEach((x, i) => {
    const y = b[i], parts = [];
    if (x.name !== y.name) parts.push(`heter ${y.name}`);
    if (x.trips !== y.trips) parts.push(`${x.trips} → ${y.trips} stopp (${delta(x.trips, y.trips)})`);
    if (x.dist !== y.dist) parts.push(`${x.dist} → ${y.dist} vån (${delta(x.dist, y.dist)})`);
    if (x.pos !== y.pos) parts.push(`slutar på ${x.pos} → ${y.pos}`);
    if (parts.length) out.push(`hiss ${x.name}: ${parts.join(', ')}`);
  });
  return out;
}

/** Skillnaderna i ett dygn som rader (tom lista = identiskt). */
export function caseDiff(want, got) {
  if (!want) return ['saknas i facit'];
  if (!got) return ['finns inte längre (togs bort ur GOLDEN_CASES?)'];
  const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])];
  const w = Math.max(...keys.map(k => k.length));
  const out = [];
  for (const k of keys) {
    const a = want[k], b = got[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (k === 'hissar') out.push(...carDiff(a, b));
    else if (num(a) && num(b)) out.push(`${k.padEnd(w)}  ${a} → ${b}  ${delta(a, b)}`);
    else out.push(`${k.padEnd(w)}  ${a === undefined ? '(saknas)' : JSON.stringify(a)} → ${b === undefined ? '(saknas)' : JSON.stringify(b)}`);
  }
  return out;
}

/**
 * Jämför hela facit med de nya fingeravtrycken.
 * @param {Record<string, any>} want facit
 * @param {Record<string, any>} got nya fingeravtryck per dygn
 * @param {{ maxCases?: number }} [opt] hur många dygn som visas i detalj
 * @returns {{ changed: number, total: number, text: string }}
 */
export function goldenDiff(want, got, { maxCases = Infinity } = {}) {
  const keys = [...new Set([...Object.keys(got), ...Object.keys(want)])];
  const per = keys.map(k => ({ k, lines: caseDiff(want[k], got[k]) })).filter(x => x.lines.length);
  if (!per.length) return { changed: 0, total: keys.length, text: `alla ${keys.length} dygn identiska med facit` };
  // Vilka nyckeltal ändrades, och i hur många dygn – ger en snabb bild av vad ändringen rörde.
  const byKey = {};
  for (const k of keys) {
    const a = want[k], b = got[k];
    if (!a || !b) continue;
    for (const f of Object.keys({ ...a, ...b })) if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) byKey[f] = (byKey[f] || 0) + 1;
  }
  const head = `${per.length} av ${keys.length} dygn skiljer sig från facit`
    + (Object.keys(byKey).length ? `\nändrade nyckeltal (antal dygn): ${Object.entries(byKey).sort((x, y) => y[1] - x[1]).map(([f, n]) => `${f} ${n}`).join(', ')}` : '');
  const shown = per.slice(0, maxCases).map(({ k, lines }) => `${k}:\n    ${lines.join('\n    ')}`);
  const more = per.length > maxCases ? `\n… och ${per.length - maxCases} dygn till: ${per.slice(maxCases).map(x => x.k).join(', ')}` : '';
  return { changed: per.length, total: keys.length, text: `${head}\n${shown.join('\n')}${more}` };
}
