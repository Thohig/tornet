// Språket i gränssnittet: svenska är standard, engelska går att byta till – sömlöst, mitt i ett dygn.
// Koden och simuleringen skriver svenska (loggen, dagböckerna, rutorna, besluten, replikerna); gränssnittet
// översätter allt det visar i samma ögonblick som det visas: panelens text (trDom efter varje innerHTML),
// verktygstipset, textskylten, rundvisningen och pixelgrafikens text (textW/textSprite i pixart.js). Därför byter
// även det som skrevs för en timme sedan språk direkt, och simuleringen vet aldrig vilket språk som visas
// (determinismen och facit påverkas inte). Översättningarna står i lang-en.js: svensk mall → engelsk mall, där
// {0}, {1} … (och {n}, {who} … i repliker) är värden – namn, våningar, siffror eller andra texter, som i sin tur
// översätts. En text utan egen mall ("A · B – C") delas vid avskiljarna och sätts ihop av de bitar som har mallar.
// Saknas en mall visas svenskan. Matchningen bryr sig inte om emoji, stora/små bokstäver eller extra mellanslag.
import EN from './lang-en.js';

/** @type {'en'|'sv'} */
let lang = 'sv';
export const getLang = () => lang;
/** byt språk (bara gränssnittet – start.js sparar valet) @param {'en'|'sv'} l */
export function setLang(l) { if (l !== 'en' && l !== 'sv') return; lang = l; }

const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;
/** jämförelseform: utan emoji och med enkla mellanslag (pixelgrafikens text saknar emoji) */
const norm = s => s.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
/** ett mellanslag i mallen: ett eller flera (aldrig inget – då delas "Gun-Britt" och "L1" mellan två värden) */
const GAP = '\\s+';
const PH = /\{(\w+)\}/g;

// ---------- Mallarna ----------
/** @typedef {{ re: RegExp, slots: string[], en: string, w: number, emo: boolean, lead: boolean, seps: string }} Tpl */
/** alla poster: lang-en.js, plus bitar som visas för sig (utan inledande avskiljare, eller bara delen före ett tankstreck) */
const entries = Object.entries(EN);
for (const [sv, en] of Object.entries(EN)) {
  if (!en) continue;
  // ", ska redan till {0}" passar också "ska redan till 6" när en text delas i bitar
  // (och " och signalerade …" när en text delas vid " och ")
  const cut = t => t.replace(/^\s*[,·–—:]\s*/, '').replace(/^(?:och|and) /, '');
  if (cut(sv) !== sv && cut(sv) && !(cut(sv) in EN)) entries.push([cut(sv), cut(en)]);
  // "Bestämmer sig: {0} ({1})" – början ("Bestämmer sig") passar också för sig när en text delas vid kolonet
  const pre = sv.match(/^([^{:]{3,}): \{\w+\}/), preEn = en.match(/^([^{:]{3,}): \{\w+\}/);
  if (pre && preEn && !(pre[1] in EN)) entries.push([pre[1], preEn[1]]);
  // en text i panelen delas där ett värde står i en egen tagg (nedräkningen i <span class="lv">): början fram till
  // ett värde och slutet efter det passar också för sig – om värdena står i samma ordning i engelskan
  const svP = sv.split(/(\{\w+\})/), enP = en.split(/(\{\w+\})/);
  const order = a => a.filter((_, i) => i % 2).join();
  if (svP.length > 1 && order(svP) === order(enP)) for (let i = 1; i < svP.length; i += 2) {
    const head = svP.slice(0, i).join(''), tail = svP.slice(i + 1).join('');
    const eHead = enP.slice(0, i).join(''), eTail = enP.slice(i + 1).join('');
    if ((head.match(/\p{L}/gu) || []).length >= 6 && !(head in EN)) entries.push([head, eHead]);
    if ((tail.match(/\p{L}/gu) || []).length >= 6 && !(tail in EN)) entries.push([tail, eTail]);
    // (och biten mellan två värden: "{0} kvar i lägenheten, {1} nere …" när värdena står i <b>)
    if (i + 2 < svP.length) { const mid = svP[i + 1], eMid = enP[i + 1]; if ((mid.match(/\p{L}/gu) || []).length >= 6 && !(mid in EN)) entries.push([mid, eMid]); }
  }
  // meningarna för sig (Berits pratbubbla visar bara den första) – när översättningen har lika många meningar
  const svS = sv.split(/(?<=[.!?]) (?=\p{Lu})/u), enS = en.split(/(?<=[.!?]) (?=\p{Lu})/u);
  if (svS.length > 1 && svS.length === enS.length) svS.forEach((x, i) => { if (!(x in EN) && /\p{L}{3}/u.test(x)) entries.push([x, enS[i]]); });
  // "Instruktör på Svettis Aerobic – tar ALLTID trappan" visas ibland bara med första delen
  if (sv.includes(' – ')) {
    const a = sv.split(' – '), b = en.split(' – ');
    if (a.length === b.length && !PH.test(a[0]) && !(a[0] in EN)) entries.push([a[0], b[0]]);
    PH.lastIndex = 0;
  }
}
const exact = new Map();
/** samma mallar med stora och små bokstäver som i lang-en.js ("Entrén" → "The lobby", "entrén" → "the lobby") */
const exactCase = new Map();
/** @type {Map<string, Tpl[]>} mallar efter sina två första bokstäver; wild = mallar som börjar med ett värde */
const bucket = new Map();
/** @type {Tpl[]} */
const wild = [];
for (const [sv, en] of entries) {
  const n = norm(sv);
  const hasPh = /\{\w+\}/.test(n);
  // (en strukturmall som "{0} · {1}" står kvar men översätter värdena – men inte om den har emoji, som skulle
  // läggas till i texter som saknar dem)
  if (!en || (en === sv && (!hasPh || n !== sv.trim()))) continue;
  if (!hasPh) { if (!exact.has(n.toLowerCase())) exact.set(n.toLowerCase(), en); if (!exactCase.has(n) && norm(en) === en.replace(/\s+/g, ' ').trim()) exactCase.set(n, en); continue; }
  const parts = n.split(/\{(\w+)\}/), slots = [];
  let src = '', w = 0;
  parts.forEach((p, i) => {
    // (ett värde först i mallen är aldrig tomt – annars passar "{0} åker{1}" på vad som helst)
    if (i % 2) { slots.push(p); src += i === 1 && !parts[0] ? '(.+?)' : '(.*?)'; } else { src += esc(p).replace(/ /g, GAP); w += (p.match(/\p{L}/gu) || []).length * 2 + p.replace(/[\s\p{L}]/gu, '').length; }
  });
  if (!w) continue; // (bara värden: "{0}{1}" passar på allt)
  /** @type {Tpl} */
  const t = { re: new RegExp(`^${src}$`, 'iu'), slots, en, w, emo: EMOJI.test(sv), lead: !parts[0], seps: n };
  EMOJI.lastIndex = 0;
  const lead = parts[0].toLowerCase();
  if (lead.length >= 2) { const k = lead.slice(0, 2); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(t); } else wild.push(t);
}
for (const l of bucket.values()) l.sort((a, b) => b.w - a.w);
wild.sort((a, b) => b.w - a.w);

// ---------- Översättningen ----------
// Varje översättning får ett mått på hur mycket som blev kvar på svenska (miss = bokstäver i bitar som ingen mall
// passade, utom namn och korta etiketter). Passar flera mallar vinner den som lämnar minst kvar.
/** @type {Map<string, [string, number]>} */
const cache = new Map();
/** Översätt en text som visas (ingenting händer på svenska). @param {string} s @returns {string} */
export function tr(s) { return lang === 'sv' || !s ? s : tr2(s, 0)[0]; }
/** ser ut som ett namn, en etikett eller en siffra – står kvar utan att räknas som missad */
const NAMEISH = /^(?:\p{Lu}[\p{L}-]*(?: [A-Z])?(?: \(\d+\))?|[\p{Lu}\d]{1,3}|[\d\s.,:%°/–-]*\S{0,2})$/u;
/** @returns {[string, number]} översättningen och hur mycket som blev kvar */
function tr2(s, depth) {
  if (!s || !/\p{L}/u.test(s)) return [s, 0];
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  /** @type {[string, number]} */
  const out = depth > 5 ? [s, miss0(s)] : find(s, depth);
  if (cache.size > 30000) cache.clear();
  cache.set(s, out);
  return out;
}
const miss0 = s => (NAMEISH.test(norm(s)) ? 0 : (norm(s).match(/\p{L}/gu) || []).length);
/** @returns {[string, number]} */
function find(s, depth) {
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
  // emoji först i texten står kvar (mallen kanske saknar dem, eller har tagits bort i pixelgrafiken)
  const emo = (s.trim().match(/^(?:[\p{Extended_Pictographic}\u200d\ufe0f]+\s*)+/u) || [''])[0];
  const n = norm(s);
  const caps = /\p{Lu}/u.test(n) && n === n.toUpperCase() && /\p{L}{2}/u.test(n);
  // en bit som börjar med en avskiljare ("– utan den kommer de ingenstans"): avskiljaren står kvar
  const sep = n.match(/^([–—·,:;]\s*)(.+)$/u);
  if (sep) { const [r, ms] = tr2(sep[2], depth + 1); return [lead + emo + sep[1] + r + trail, ms]; }
  let best = direct(n, depth, !!emo || caps);
  if (!best || best[1] > 0) { const sp = split(n, depth); if (sp && (!best || sp[1] < best[1])) best = sp; }
  if (!best) return [s, miss0(s)];
  let r = best[0];
  if (caps) r = r.toUpperCase();
  if (emo && !r.replace(EMOJI, 'X').startsWith('X')) r = emo + r.replace(/^\s+/, '');
  return [lead + r.trim() + trail, best[1]];
}
/** hela mallar: den bästa översättningen [text, miss], eller null. anyEmoji = texten hade emoji (eller är en skylt i versaler) */
function direct(n, depth, anyEmoji = true) {
  const key = n.toLowerCase();
  if (!/\p{L}/u.test(n)) return null;
  const exc = exactCase.get(n);
  if (exc !== undefined) return [exc, 0];
  const ex = exact.get(key);
  // (en text som börjar med stor bokstav fortsätter göra det: "Entrén" i skylten är inte "the lobby")
  if (ex !== undefined) return [/^\p{Lu}/u.test(n) ? ex.replace(/^\p{Ll}/u, c => c.toUpperCase()) : ex, 0];
  // (ett utropstecken eller en punkt för mycket: "Brandlarm! … som alla andra!")
  const end = key.match(/^(.*\p{L})([!.?…]+)$/u);
  if (end && exact.has(end[1])) return [exact.get(end[1]) + end[2], 0];
  /** @type {[string, number]|null} */
  let best = null, tries = 0;
  for (const list of [bucket.get(key.slice(0, 2)) || [], wild]) for (const t of list) {
    // (en mall med emoji passar inte en loggrad utan emoji – "🚌 {0} åker{1}" är inte "… – åker hem")
    if (t.emo && !anyEmoji) continue;
    const m = n.match(t.re);
    if (!m) continue;
    // (ett värde först i mallen sväljer inte en avskiljare som mallen själv saknar: i "TB · ett stopp …" ska
    // "{0} stopp …" inte få "TB · ett" – raden delas först vid avskiljaren, split nedan)
    if (t.lead && LEAD_SEP.some(x => m[1].includes(x) && !t.seps.includes(x))) continue;
    const vals = {};
    t.slots.forEach((k, j) => { vals[k] = m[j + 1]; });
    let miss = 0;
    const r = t.en.replace(PH, (_, k) => { if (vals[k] === undefined) return ''; const [v, ms] = tr2(vals[k], depth + 1); miss += ms; return v; });
    if (r === n) continue;
    if (!best || miss < best[1]) best = [r, miss];
    if (best[1] === 0 || ++tries >= 8) return best;
  }
  return best;
}
/** avskiljare som ett inledande värde inte får innehålla (om inte mallen har dem) */
const LEAD_SEP = [' · ', ' – ', ' — ', ' → '];
/** avskiljare som en text utan egen mall delas vid */
const SEP = /( · | – | — |: | → | \+ |, | och | \(|(?<=[.!?…]) )/;
/**
 * En text utan egen mall: dela vid avskiljarna och välj den indelning som lämnar minst kvar på svenska (färre,
 * större bitar vinner vid lika). null = inget gick att översätta. @returns {[string, number]|null}
 */
function split(n, depth) {
  if (depth > 3) return null;
  const parts = n.split(SEP);
  if (parts.length < 3 || parts.length > 25) return null;
  const segs = parts.filter((_, i) => i % 2 === 0), seps = parts.filter((_, i) => i % 2 === 1);
  const m = segs.length;
  /** @type {{ cost: number, miss: number, out: string }[]} */
  const best = [{ cost: 0, miss: 0, out: '' }];
  for (let i = 1; i <= m; i++) {
    best[i] = { cost: Infinity, miss: 0, out: '' };
    for (let j = i - 1; j >= 0; j--) {
      let chunk = segs[j];
      for (let k = j + 1; k < i; k++) chunk += seps[k - 1] + segs[k];
      const open = j > 0 && seps[j - 1] === ' (' && chunk.endsWith(')');
      const d = direct(norm(open ? `(${chunk}` : chunk), depth + 1);
      const piece = d ? (open ? d[0].replace(/^\(/, '') : d[0]) : chunk, ms = d ? d[1] : miss0(chunk);
      const cost = best[j].cost + 1 + ms * 10;
      if (cost < best[i].cost) best[i] = { cost, miss: best[j].miss + ms, out: best[j].out + (j ? (seps[j - 1] === ' och ' ? ' and ' : seps[j - 1]) : '') + piece };
    }
  }
  const r = best[m].out;
  return r && r !== n ? [r, best[m].miss] : null;
}

/** Översätt all text i ett element (efter innerHTML): textnoderna. @param {Element} root */
export function trDom(root) {
  if (lang === 'sv' || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let nd = w.nextNode(); nd; nd = w.nextNode()) {
    const v = nd.nodeValue;
    if (!v || !/\p{L}/u.test(v)) continue;
    const t = tr(v);
    if (t !== v) nd.nodeValue = t;
  }
}
