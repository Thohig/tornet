// Dygnets siffror och sammanfattningen av ett dygn (bara gränssnittet – läser tillståndet, ändrar inget).
// En gemensam lista (STATS) som både resultatvyn och sammanfattningen läser ur: varje siffra har en grupp,
// en vikt (3 = nyckeltal i sammanfattningen) och vilket håll som är bättre (för jämförelsen med dagen innan).
// När dygnet tar slut sparas en ögonblicksbild (daySnap), så att sammanfattningen kan visas även när huset
// har rullat vidare in i nästa dygn.
//
// Översikt:
// `summary.js` – dygnets siffror i en gemensam lista `STATS` med grupp, vikt och bättre-håll – resultatvyn och
// sammanfattningen läser båda ur den; `saveDay()` sparar en ögonblicksbild när dygnet tar slut och `summaryHtml()`
// berättar om den: betyg, dygnets händelser ur `S.stats.events` (`dayEvent`/`incidentOver` i state.js), nyckeltal
// med pilar mot dagen innan, stamgästerna, infällt chefens beslut och alla siffror; visas som vyn `yesterday` i
// panelen eller som kort när dygnet börjar om
import { esc } from './util.js';
import { STRAT_NAMES } from './config.js';
import { S } from './state.js';

// ---------- Betygen ----------
export function grade(avg) {
  if (avg < 10) return { letter: 'A', stars: 5, msg: 'Hissguru! Ingen hann ens titta på klockan.' };
  if (avg < 17) return { letter: 'B', stars: 4, msg: 'Snyggt jobbat – nästan inga sura miner.' };
  if (avg < 26) return { letter: 'C', stars: 3, msg: 'Helt okej, men kaffet hann kallna.' };
  if (avg < 40) return { letter: 'D', stars: 2, msg: 'Det muttrades i korridorerna…' };
  return { letter: 'F', stars: 1, msg: 'Folk tar trapporna nu. Alla sjutton våningarna.' };
}
export function safetyGrade(st = S.stats) {
  const pen = st.smoked * 3 + st.trappedSec / 15;
  return pen < 4 ? 'A' : pen < 12 ? 'B' : pen < 25 ? 'C' : pen < 45 ? 'D' : 'F';
}
export const avgWait = st => (st.waitN ? st.waitSum / st.waitN : 0);

// ---------- Siffrorna ----------
/**
 * @typedef {{ k: string, label: string, g: string, w: number, v?: (st: any) => number, fmt?: (x: number) => string,
 *   better?: 1|-1, fun?: (n: number) => string }} StatDef
 * k = fältet i S.stats (om v saknas), g = grupp (GROUPS), w = vikt: 3 = nyckeltal (alltid med), 2 = viktigt,
 * 1 = bara under ”Alla siffror”. better = 1 om mer är bättre, -1 om mindre är bättre (jämförelsen).
 * fun = stamgästernas rad i sammanfattningen.
 */
export const GROUPS = { trafik: '🚶 Trafiken', drift: '🔧 Driften', inc: '🚨 Incidenter', folk: '★ Folket', hus: '🏢 Huset' };
const s = x => `${Math.round(x)} s`, s1 = x => `${x.toFixed(1)} s`, kwh = x => `${x.toFixed(1)} kWh`;
/** @type {StatDef[]} */
export const STATS = [
  { k: 'served', label: 'Resor klara', g: 'trafik', w: 3, better: 1 },
  { k: 'avg', label: 'Snittväntan', g: 'trafik', w: 3, v: avgWait, fmt: s1, better: -1 },
  { k: 'waitMax', label: 'Längsta väntan', g: 'trafik', w: 3, fmt: s, better: -1 },
  { k: 'ride', label: 'Snitt åktid', g: 'trafik', w: 1, v: st => (st.rideN ? st.rideSum / st.rideN : 0), fmt: s1, better: -1 },
  { k: 'angry', label: 'Arga resenärer', g: 'trafik', w: 2, better: -1 },
  { k: 'overloads', label: 'Överlaster', g: 'trafik', w: 1, better: -1 },
  { k: 'stairs', label: 'Trapp-resor', g: 'trafik', w: 1 },
  { k: 'stairsChoice', label: '…varav frivilliga 🚶', g: 'trafik', w: 1 },
  { k: 'crowdSkips', label: 'Avstod – för trångt', g: 'trafik', w: 1, better: -1 },
  { k: 'transfers', label: 'Hissbyten', g: 'trafik', w: 1 },
  { k: 'upperDeck', label: 'Övre däcket', g: 'trafik', w: 1 },
  { k: 'escalator', label: 'Rulltrappan', g: 'trafik', w: 1 },
  { k: 'trainIn', label: 'Av tåget 🚇', g: 'trafik', w: 1 },
  { k: 'trainOut', label: 'På tåget 🚇', g: 'trafik', w: 1 },
  { k: 'wrongPress', label: 'Felknappar 🙈', g: 'trafik', w: 1, better: -1 },
  { k: 'kidPresses', label: 'Barn på alla knappar', g: 'trafik', w: 1 },
  { k: 'ghostStops', label: 'Spökstopp 👻', g: 'trafik', w: 1, better: -1 },
  { k: 'nuisance', label: 'Bus rensat', g: 'trafik', w: 1 },
  { k: 'energy', label: 'Energi ⚡', g: 'drift', w: 3, fmt: kwh, better: -1 },
  { k: 'energyRun', label: '…varav körning', g: 'drift', w: 1, fmt: kwh },
  { k: 'regen', label: 'Återmatat ♻', g: 'drift', w: 1, fmt: kwh, better: 1 },
  { k: 'downSec', label: 'Stillestånd', g: 'drift', w: 3, fmt: s, better: -1 },
  { k: 'faults', label: 'Hissfel 🔧', g: 'drift', w: 2, better: -1 },
  { k: 'cables', label: 'Linbrott 🪢', g: 'drift', w: 2, better: -1 },
  { k: 'repairs', label: 'Lagade', g: 'drift', w: 1 },
  { k: 'serviced', label: 'Servade på natten', g: 'drift', w: 1 },
  { k: 'extraTechs', label: 'Extra tekniker', g: 'drift', w: 1 },
  { k: 'heatStops', label: 'Överhettade motorer 🌡️', g: 'drift', w: 2, better: -1 },
  { k: 'stormFaults', label: 'Vajerlarm i storm 🌬️', g: 'drift', w: 1, better: -1 },
  { k: 'relevels', label: 'Nivåjusteringar', g: 'drift', w: 1 },
  { k: 'learnedParks', label: 'Inlärda parkeringar 🧠', g: 'drift', w: 1 },
  { k: 'incidents', label: 'Incidenter', g: 'inc', w: 2, better: -1 },
  { k: 'smoked', label: 'Rökexponerade', g: 'inc', w: 2, better: -1 },
  { k: 'evacuated', label: 'Utrymda', g: 'inc', w: 2 },
  { k: 'trappedSec', label: 'Instängda', g: 'inc', w: 2, fmt: s, better: -1 },
  { k: 'medical', label: 'Ambulans 🚑', g: 'inc', w: 1 },
  { k: 'moveLoads', label: 'Flyttlass 🚚', g: 'inc', w: 1 },
  { k: 'stumbles', label: 'Snubblade 🦶', g: 'inc', w: 1, better: -1 },
  { k: 'doorFights', label: 'Dörren tog emot ❄️', g: 'inc', w: 1 },
  { k: 'gripes', label: '★ Gunnar gnällde', g: 'folk', w: 1, fun: n => `Gunnar gnällde ${n} ${n === 1 ? 'gång' : 'gånger'}` },
  { k: 'cups', label: '★ Kurts kaffekoppar ☕', g: 'folk', w: 1, fun: n => `Kurt drack ${n} ${n === 1 ? 'kopp' : 'koppar'} kaffe` },
  { k: 'chats', label: '★ Majken pratade 💬', g: 'folk', w: 1, fun: n => `Majken pratade ${n} ${n === 1 ? 'gång' : 'gånger'} i hissen` },
  { k: 'holds', label: 'Höll upp dörren', g: 'folk', w: 1, fun: n => `${n} höll upp dörren åt någon` },
  { k: 'closePresses', label: 'Tryckte på STÄNG', g: 'folk', w: 1, fun: n => `${n} tryckte otåligt på STÄNG` },
  { k: 'carsIn', label: 'Bilar in i garaget', g: 'hus', w: 1 },
  { k: 'deliveries', label: 'Paketleveranser', g: 'hus', w: 1 },
  { k: 'vips', label: 'VIP-besök 🚁', g: 'hus', w: 1 },
  { k: 'trains', label: 'Tåg vid perrongen', g: 'hus', w: 1 },
];
export const statVal = (d, st) => (d.v ? d.v(st) : st[d.k] || 0);
const fmtVal = (d, x) => (d.fmt ? d.fmt(x) : String(Math.round(x)));
/** pilen mot dagen innan: ↑/↓ och om det är bättre eller sämre ('' = ingen jämförelse eller ingen skillnad) */
function delta(d, st, prev) {
  if (!prev) return '';
  const a = statVal(d, st), b = statVal(d, prev), diff = a - b;
  if (Math.abs(diff) < (d.fmt === s1 || d.fmt === kwh ? 0.05 : 0.5)) return '<i class="dl">±0</i>';
  const cls = !d.better ? '' : Math.sign(diff) === d.better ? ' good' : ' bad';
  return `<i class="dl${cls}">${diff > 0 ? '↑' : '↓'}${fmtVal(d, Math.abs(diff)).replace(' kWh', '').replace(' s', '')}</i>`;
}
const row = (d, st, prev) => `<div class="stat"><span>${d.label}</span><b>${fmtVal(d, statVal(d, st))}</b>${delta(d, st, prev)}</div>`;
/** alla siffror grupperade; rader som är 0 visas inte (utom nyckeltalen) */
export function allStatsHtml(st, prev = null) {
  return Object.entries(GROUPS).map(([g, title]) => {
    const rows = STATS.filter(d => d.g === g && (d.w >= 3 || statVal(d, st) > 0.04)).map(d => row(d, st, prev)).join('');
    return rows ? `<div class="sgroup">${title}</div>${rows}` : '';
  }).join('');
}

// ---------- Ögonblicksbilden när dygnet tar slut ----------
/** de senaste dygnens ögonblicksbilder (för gårdagen och jämförelsen) */
const days = [];
/** Spara dygnet som tar slut (anropas när klockan når 06, innan huset rullar vidare eller börjar om) */
export function saveDay() {
  const st = S.stats, worst = S.elevators.reduce((a, e) => (e.wear > a.wear ? e : a));
  const C = S.chief, ds = C ? C.log.filter(d => !d.info) : [];
  days.push({ day: S.day, st: { ...st, events: [...st.events] }, strategy: S.strategy, temp: S.weather.temp, cold: S.weather.cold,
    worst: { name: worst.name, pct: Math.round(worst.wear * 100) },
    chief: ds.map(d => ({ time: d.time, by: d.by, text: d.text, why: d.why, outcome: d.outcome })) });
  if (days.length > 2) days.shift();
}
/** gårdagen (den senast sparade) och dagen innan den, för jämförelsen */
export const lastDay = () => days[days.length - 1] || null;
const dayBefore = () => (days.length > 1 ? days[days.length - 2] : null);

// ---------- Sammanfattningen ----------
/** dygnets rubrikmening */
function headline(D) {
  // (hur dygnet kändes: incidenterna och allt annat som tog slut under dygnet; antalet är incidenterna, som i nyckeltalen)
  const st = D.st, n = st.incidents, busy = Math.max(n, st.events.filter(e => e.type !== 'move' && e.type !== 'medical').length);
  const kind = busy === 0 ? 'Lugnt dygn' : busy <= 2 ? 'Händelserikt dygn' : 'Kaosdygn';
  // (hela meningar i varje gren: lang-en.js översätter mallarna, en svensk ändelse som eget värde blir kvar på svenska)
  const wait = avgWait(st).toFixed(1);
  if (!n) return `${kind} – ${st.served} resor med snittväntan ${wait} s.`;
  return n === 1 ? `${kind} – ${st.served} resor med snittväntan ${wait} s, 1 incident.`
    : `${kind} – ${st.served} resor med snittväntan ${wait} s, ${n} incidenter.`;
}
/** stamgästernas rad: de två mest anmärkningsvärda */
function funLine(st) {
  const f = STATS.filter(d => d.fun && statVal(d, st) > 0).sort((a, b) => statVal(b, st) - statVal(a, st)).slice(0, 2);
  return f.length ? `<p class="fun">★ ${f.map(d => d.fun(statVal(d, st))).join(', ')}.</p>` : '';
}
/**
 * Sammanfattningen av dygnet D (en ögonblicksbild från saveDay): betyget och en mening, dagens händelser,
 * nyckeltalen med pilar mot dagen innan, stamgästerna – och resten (alla siffror, chefens beslut) infällt.
 */
export function summaryHtml(D = lastDay(), prev = dayBefore()) {
  if (!D) return '<p>Inget dygn är slut än.</p>';
  const st = D.st, g = grade(avgWait(st)), sg = safetyGrade(st);
  if (prev && prev.day !== D.day - 1) prev = null;
  const pst = prev ? prev.st : null;
  const ev = st.events.length
    ? `<ul class="sevents">${st.events.map(e => `<li><span class="ct">${e.time}</span> <b>${esc(e.title)}</b><div class="out">${esc(e.text)}</div></li>`).join('')}</ul>`
    : '<p class="calm">Inga incidenter – huset skötte sig självt.</p>';
  const keys = STATS.filter(d => d.w >= 3 || (d.w === 2 && statVal(d, st) > 0)).map(d => row(d, st, pst)).join('');
  const mine = D.chief.filter(d => d.by === 'player').length;
  const chief = D.chief.length
    ? `<details class="sdet"><summary>🧑‍💼 Beslut: ${D.chief.length - mine} av driftchefen${mine ? `, ${mine} av dig` : ''}</summary><ul class="sevents">${D.chief.map(d =>
      `<li><span class="ct">${d.time}</span> ${d.by === 'player' ? '👤' : '🧑‍💼'} <b>${esc(d.text)}</b>${d.why ? ` <span class="why">– ${esc(d.why)}</span>` : ''}</li>`).join('')}</ul></details>`
    : '';
  return `<div class="summary">
    <div class="sgrade"><b>${st.waitN ? g.letter : '–'}</b><span>säkerhet ${sg}</span></div>
    <p class="shead">${headline(D)} <i>${g.msg}</i></p>
    <div class="sgroup">📅 Dagens händelser</div>${ev}
    <div class="sgroup">📊 Nyckeltal${prev ? ` <span class="cmp">mot dag ${prev.day}</span>` : ''}</div><div class="stats skeys">${keys}</div>
    ${funLine(st)}
    <p class="smeta">${STRAT_NAMES[D.strategy] || D.strategy} · ${D.temp} °C · mest sliten ${D.worst.name} ${D.worst.pct} %</p>
    ${chief}
    <details class="sdet"><summary>Alla siffror</summary><div class="stats">${allStatsHtml(st, pst)}</div></details>
  </div>`;
}
