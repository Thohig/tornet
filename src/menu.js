// Startmenyn: Hiss-O-Matic 3000 startar. Bara gränssnitt – menyn ändrar aldrig simuleringen direkt utan
// startar ett nytt dygn med newSim (som URL:en gjorde förr) och framkallar scenariernas händelser via act().
// Bakom menyn går ett visningsdygn (eget frö, ingen slump) så att huset lever medan man väljer.
// Med ?seed=, ?tempo= eller ?dygn= i adressen hoppar spelet över menyn (gamla länkar och testerna).
import { BUILDING, FL, STRAT_NAMES, STRAT_HINT, TEMPOS, DEFAULT_TEMPO, dayLength, idx } from './config.js';
import { S, hour, log } from './state.js';
import { DT, newSim, step } from './sim.js';
import { INC_LEVELS, INC_LEVEL_NAMES } from './incidents.js';
import { act } from './actions.js';
import { VIEW, camMax, resize } from './view.js';
import { toggleAuto } from './director.js';
import { esc, fl } from './util.js';
import { hideOverlay, showIntro, showOverlay } from './hud.js';
import { startIntro } from './intro.js';

const DEMO_SEED = 19950824;  // visningsdygnet bakom menyn (samma varje gång)
const DEMO_FROM = 7.6;       // …som börjar mitt i morgonrusningen
const SPIN_MS = 30;          // så länge per bildruta som fram-spolningen får räkna
const KEY = { boot: 'tornet.boot', seen: 'tornet.intro', offer: 'tornet.rundvisning', last: 'tornet.senast', opts: 'tornet.val' };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat fönster m.m. */ } },
};

// ---------- Scenarierna ----------
// at = klockslaget dygnet spolas fram till; ev = [sekunder speltid efter start, åtgärd, …argument] (via act).
// Slumpen är av i scenarierna så att just den händelsen får scenen; allt annat i huset går som vanligt.
/** @typedef {{ k: string, icon: string, name: string, text: string, at: number, ev: any[][], strategy?: string }} Scenario */
/** @type {Scenario[]} */
export const SCENARIOS = [
  { k: 'rusning', icon: '🚇', name: 'Morgonrusningen', at: 7.3, ev: [],
    text: 'Tågen kommer tätt och entrén fylls. Inga incidenter – bara Hiss-O-Matic mot folkmassan.' },
  { k: 'brand', icon: '🔥', name: 'Brand i serverhallen', at: 11.5, ev: [[8, 'trigger', 'fire', idx('9')]],
    text: 'Mitt i lunchen börjar det brinna på 9:an. Larmet återkallar hissarna, huset utryms och brandkåren kommer.' },
  { k: 'storm', icon: '⛈️', name: 'Stormnatten', at: 21.2, ev: [[5, 'trigger', 'storm'], [70, 'trigger', 'lightning']],
    text: 'Det blåser upp till storm. Rune bestämmer om hissarna ska gå i svajläge – och sedan slår blixten ner.' },
  { k: 'flytt', icon: '📦', name: 'Flyttdagen', at: 9.2, ev: [[4, 'trigger', 'move']],
    text: 'Flyttbilen backar in vid lastkajen. Soffor, lådor och kanske ett piano ska ut ur huset.' },
  { k: 'lina', icon: '🪢', name: 'Linbrottet', at: 8.2, ev: [[6, 'trigger', 'cable']],
    text: 'Linorna i en hiss går av. Fritt fall, fångapparaten tar tag och de instängda kryper ut genom takluckan.' },
  { k: 'pano', icon: '🧗', name: 'Fast på fasaden', at: 13.1, ev: [[4, 'trigger', 'pano']],
    text: 'Panoramahissen låser sig utanpå huset. Räddningstjänsten firar ner folk med rep – eller tar fram stegbilen.' },
  { k: 'buss', icon: '🚌', name: 'Stadsturen', at: 10.1, ev: [[3, 'bus']],
    text: 'En turistbuss med fjorton turister och en guide. Hinner alla tillbaka innan bussen går?' },
  { k: 'ström', icon: '🔌', name: 'Mörkt vid hemgång', at: 16.1, ev: [[6, 'trigger', 'power']],
    text: 'Strömmen går mitt i hemgången. Folk sitter fast i hissarna tills reservkraften kommer igång.' },
];

// ---------- Tillståndet (bara gränssnittet) ----------
const M = {
  open: false, demo: false,
  /** @type {{ to: number, done: () => void }|null} */ spin: null,
  /** @type {{ t0: number, ev: any[][] }|null} */ plan: null,
  view: 'main',
  sel: 0,
};
/** Ska huset bakom menyn röra sig? (main.js) */
export const menuDemo = () => M.demo && !M.spin;

/** dagens torn: samma frö för alla samma datum */
function todaySeed(d = new Date()) {
  let h = 2166136261;
  for (const c of `tornet-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 1e6;
}
const randSeed = () => Math.floor(Math.random() * 1e6);
/** valen i Egenskaper (minns till nästa gång) */
function defaults() {
  const o = store.get(KEY.opts) || {};
  return { tempo: o.tempo in TEMPOS ? o.tempo : DEFAULT_TEMPO, incLevel: INC_LEVELS.includes(o.incLevel) ? o.incLevel : 'normal',
    chief: o.chief ?? true, strategy: o.strategy in STRAT_NAMES ? o.strategy : 'smart', roll: o.roll === 'ny' ? 'ny' : 'mjuk',
    seed: randSeed() };
}
let opts = defaults();

// ---------- Sparat från förra gången ----------
/** Anropas när ett dygn tar slut (hud.js): menyn visar det nästa gång. */
export function rememberDay(info) { store.set(KEY.last, { ...info, seed: S.seed, tempo: S.tempo, incLevel: S.incLevel, strategy: S.strategy }); }
function lastLine() {
  const L = store.get(KEY.last);
  if (!L) return '';
  const inc = L.incidents ? ` · ${L.incidents} incident${L.incidents === 1 ? '' : 'er'}` : '';
  return `<div class="mn-last"><span>Senast: dag ${L.day} · betyg <b>${esc(L.letter)}</b> · ${L.served} resor${inc}</span>
    <button class="btn xs mi" data-mn="replay" data-hint="Börja om med samma frö (${L.seed})">↻ Spela om</button></div>`;
}

// ---------- Uppstarten (en gång) ----------
function bootLines() {
  const cars = BUILDING.elevators.map(e => e.name);
  return ['HISS-O-MATIC 3000 BIOS v3.11  (C) Tornet Fastighets AB 1995', '',
    `Minnestest ......... 640K OK`, `Våningar ........... ${FL.length} (${fl(0)}–${fl(FL.length - 1)})`,
    ...cars.map(n => `Kontrollerar hiss ${n.padEnd(3)} ..... OK`),
    'Laddar KONTOR95.PAL ........ OK', 'Driftchefen ............ på plats', '', 'Startar Hiss-O-Matic 3000_'];
}
function boot(done) {
  if (store.get(KEY.boot)) { done(); return; }
  store.set(KEY.boot, 1);
  const lines = bootLines();
  showOverlay(`<div class="mn-boot" id="mn-boot"><pre id="mn-bootx"></pre><div class="mn-skip">tryck på valfri tangent</div></div>`);
  const pre = /** @type {HTMLElement} */ (document.getElementById('mn-bootx'));
  let i = 0, over = false;
  const finish = () => {
    if (over) return; over = true;
    removeEventListener('keydown', finish, true); removeEventListener('pointerdown', finish, true);
    done();
  };
  addEventListener('keydown', finish, true); addEventListener('pointerdown', finish, true);
  const next = () => {
    if (over) return;
    if (i >= lines.length) { setTimeout(finish, 700); return; }
    pre.textContent += `${lines[i++]}\n`;
    setTimeout(next, i < 3 ? 260 : 110);
  };
  next();
}

// ---------- Menyn ----------
/** Visar startmenyn med visningsdygnet bakom. */
export function showMenu() {
  M.open = true; M.view = 'main';
  document.body.classList.add('menu');
  resize();
  if (!M.demo) {
    newSim(DEMO_SEED, { roll: 'mjuk', incLevel: 'av', tempo: DEFAULT_TEMPO });
    while (hour() < DEMO_FROM) step(DT);
    M.demo = true;
  }
  VIEW.camY = camMax();
  // första gången: erbjud rundvisningen innan menyn
  boot(() => { if (!store.get(KEY.offer)) { store.set(KEY.offer, 1); M.view = 'offer'; } render(); });
  addEventListener('keydown', keys, true);
}
function close() {
  M.open = false;
  removeEventListener('keydown', keys, true);
  document.body.classList.remove('menu');
  hideOverlay();
  document.getElementById('overlay').classList.remove('menu');
  resize();
}

const item = (k, icon, name, sub) => `<button class="mi mn-item" data-mn="${k}"><span class="mn-ico">${icon}</span><span><b>${name}</b><small>${sub}</small></span></button>`;
function mainHtml() {
  return `<div class="card mn"><h1>Hiss-O-Matic 3000</h1>
    <div class="mn-logo">TORNET</div>
    <div class="mn-tag">${BUILDING.elevators.length} hissar · ${FL.length} våningar · en massa folk med bråttom</div>
    <div class="mn-list">
      ${item('quick', '▶', 'KÖR!', 'Ett vanligt dygn – luta dig tillbaka och titta')}
      ${item('new', '⚙️', 'NY DAG…', 'Välj tempo, slumpen, styrlogik och frö')}
      ${item('scen', '🎬', 'SCENARIER…', 'Spola fram till något som händer')}
      ${item('today', '📅', 'DAGENS TORN', `Samma dygn för alla i dag · frö ${todaySeed()}`)}
      ${item('intro', '🛎️', 'RUNDVISNING', 'Berit visar runt i huset – ungefär 3 minuter')}
      ${item('help', '?', 'HUR FUNKAR DET', 'Klicka, följ, framkalla')}
    </div>
    ${lastLine()}</div>`;
}
const radios = (name, list, cur) => `<div class="mn-radios">${list.map(([v, label, hint]) =>
  `<label class="mn-radio${String(v) === String(cur) ? ' on' : ''}"${hint ? ` data-hint="${esc(hint)}"` : ''}><input type="radio" name="${name}" value="${v}"${String(v) === String(cur) ? ' checked' : ''}> ${label}</label>`).join('')}</div>`;
const plain = h => h.replace(/<[^>]+>/g, '');
function newHtml() {
  const o = opts;
  return `<div class="card mn mn-props"><h1>Egenskaper för Ny dag</h1>
    <fieldset><legend>Dygnet</legend>
      ${radios('tempo', Object.entries(TEMPOS).map(([k, t]) => [k, `${t.name} (~${Math.round(dayLength(k) / 60)} min)`]), o.tempo)}
      ${radios('roll', [['mjuk', 'Huset rullar vidare', 'Klockan slår om kl 06 och huset fortsätter'], ['ny', 'Ny dag varje gång', 'Spelet stannar för sammanfattningen och börjar om']], o.roll)}
    </fieldset>
    <fieldset><legend>Slumpen</legend>
      ${radios('incLevel', INC_LEVELS.map(k => [k, INC_LEVEL_NAMES[k], { av: 'Inga incidenter av sig själva', lugn: 'Någon enstaka', normal: '1–3 om dagen', kaos: 'Räkna med brand före lunch' }[k]]), o.incLevel)}
    </fieldset>
    <fieldset><legend>Driftchefen</legend>
      ${radios('chief', [['1', 'I tjänst', 'Gun-Britt och Rune tar besluten och berättar varför'], ['0', 'På rast', 'Allt väntar på dig']], o.chief ? '1' : '0')}
    </fieldset>
    <fieldset><legend>Styrlogik</legend>
      ${radios('strategy', Object.keys(STRAT_NAMES).map(k => [k, STRAT_NAMES[k], plain(STRAT_HINT[k] || '')]), o.strategy)}
    </fieldset>
    <fieldset><legend>Frö</legend>
      <div class="mn-seed"><input id="mn-seed" type="number" min="0" max="999999" value="${o.seed}"> <button class="btn sm mi" data-mn="dice" data-hint="Slå ett nytt frö">🎲</button>
      <small>Samma frö ger exakt samma dygn.</small></div>
    </fieldset>
    <div class="mn-btns"><button class="btn mi" data-mn="back">Avbryt</button><button class="btn mi mn-ok" data-mn="go">OK – starta</button></div></div>`;
}
function offerHtml() {
  return `<div class="card mn"><h1>Hiss-O-Matic 3000</h1>
    <div class="mn-logo">TORNET</div>
    <div class="mn-tag">Första gången i Tornet? Receptionisten Berit visar gärna runt.</div>
    <div class="mn-list">
      ${item('intro', '🛎️', 'RUNDVISNING', 'Hissarna, folket, driftchefen och allt du kan göra – ungefär 3 minuter')}
      ${item('back', '▶', 'HOPPA ÖVER', 'Direkt till startmenyn')}
    </div></div>`;
}
function scenHtml() {
  return `<div class="card mn mn-scen"><h1>Scenarier</h1>
    <div class="mn-cards">${SCENARIOS.map(s => `<button class="mi mn-cart" data-mn="s:${s.k}"><span class="mn-ico">${s.icon}</span><span><b>${s.name}</b><small>${s.text}</small><i>kl ${String(Math.floor(s.at)).padStart(2, '0')}</i></span></button>`).join('')}</div>
    <div class="mn-btns"><button class="btn mi" data-mn="back">Tillbaka</button></div></div>`;
}
function render() {
  if (!M.open) return;
  showOverlay(M.view === 'new' ? newHtml() : M.view === 'scen' ? scenHtml() : M.view === 'offer' ? offerHtml() : mainHtml());
  const o = /** @type {HTMLElement} */ (document.getElementById('overlay'));
  o.classList.add('menu');
  o.querySelectorAll('[data-mn]').forEach(b => b.addEventListener('click', () => pickItem(/** @type {HTMLElement} */ (b).dataset.mn)));
  o.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => {
    const i = /** @type {HTMLInputElement} */ (r);
    opts[i.name] = i.name === 'chief' ? i.value === '1' : i.value;
    i.closest('.mn-radios').querySelectorAll('.mn-radio').forEach(l => l.classList.toggle('on', l.contains(i)));
  }));
  focusItem(0);
}
function items() { return [...document.querySelectorAll('#overlay .mi, #overlay input')]; }
function focusItem(i) {
  const it = items();
  if (!it.length) return;
  M.sel = (i + it.length) % it.length;
  /** @type {HTMLElement} */ (it[M.sel]).focus();
}

function pickItem(k) {
  if (k === 'quick') return start({ ...defaults() });
  if (k === 'today') return start({ ...defaults(), seed: todaySeed() });
  if (k === 'replay') {
    const L = store.get(KEY.last);
    return start({ ...defaults(), ...(L ? { seed: L.seed, tempo: L.tempo, incLevel: L.incLevel, strategy: L.strategy } : {}) });
  }
  if (k === 'help') { close(); showIntro('menu'); return; }
  if (k === 'intro') { tour(); return; }
  if (k === 'new') { opts = defaults(); M.view = 'new'; return render(); }
  if (k === 'scen') { M.view = 'scen'; return render(); }
  if (k === 'back') { M.view = 'main'; return render(); }
  if (k === 'dice') { opts.seed = randSeed(); /** @type {HTMLInputElement} */ (document.getElementById('mn-seed')).value = String(opts.seed); return; }
  if (k === 'go') {
    const v = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('mn-seed')).value, 10);
    if (Number.isFinite(v) && v >= 0) opts.seed = v;
    store.set(KEY.opts, { tempo: opts.tempo, incLevel: opts.incLevel, chief: opts.chief, strategy: opts.strategy, roll: opts.roll });
    return start(opts);
  }
  if (k.startsWith('s:')) {
    const s = SCENARIOS.find(x => x.k === k.slice(2));
    if (s) start({ ...defaults(), incLevel: 'av', strategy: s.strategy || 'smart' }, s);
  }
}
function keys(ev) {
  if (!M.open) return;
  // (spelets tangenter ska inte märka något medan menyn är öppen: mellanslag pausar, H, S …)
  ev.stopImmediatePropagation();
  if (document.getElementById('mn-boot')) return;
  const t = /** @type {HTMLElement} */ (ev.target), field = t instanceof HTMLInputElement && t.type === 'number';
  if (ev.code === 'ArrowDown' || (ev.code === 'ArrowRight' && !field)) focusItem(M.sel + 1);
  else if (ev.code === 'ArrowUp' || (ev.code === 'ArrowLeft' && !field)) focusItem(M.sel - 1);
  else if (ev.code === 'Escape' && M.view !== 'main') { M.view = 'main'; render(); }
  else if ((ev.code === 'Enter' || ev.code === 'NumpadEnter') && t instanceof HTMLInputElement) {
    if (field) pickItem('go'); else t.click();
  } else return;
  ev.preventDefault();
}

// ---------- Rundvisningen ----------
/** Berit visar runt i ett eget dygn (intro.js); sedan ett nytt dygn (KÖR!) eller tillbaka till menyn. */
function tour() {
  close();
  M.demo = false;
  store.set(KEY.seen, 1); // (välkomstrutan behövs inte efter rundvisningen)
  startIntro(how => { if (how === 'go') start({ ...defaults() }); else showMenu(); });
}

// ---------- Starta ----------
/** Ett nytt dygn med valen o; ett scenario spolas först fram till sitt klockslag. */
function start(o, scen = null) {
  close();
  M.demo = false;
  newSim(o.seed, { tempo: o.tempo, incLevel: o.incLevel, chief: o.chief, strategy: o.strategy, roll: o.roll });
  VIEW.camY = camMax();
  const go = () => {
    S.started = true;
    log(scen ? `Dag 1 · ${scen.name} – kl ${String(Math.floor(hour())).padStart(2, '0')}` : 'Dag 1 börjar – dörrarna öppnas!', 'sys');
    if (scen) {
      M.plan = { t0: S.t, ev: scen.ev.slice() };
      if (!VIEW.auto) toggleAuto(); // regissören letar upp händelsen
    }
  };
  const first = !store.get(KEY.seen);
  const after = () => { if (first) { store.set(KEY.seen, 1); showIntro('start', go); } else go(); };
  if (!scen) { after(); return; }
  M.spin = { to: scen.at, done: after };
  showOverlay(`<div class="card mn mn-spin"><h1>${scen.icon} ${scen.name}</h1><p>${scen.text}</p>
    <div class="mn-bar"><i id="mn-bar"></i></div><small id="mn-clock">Spolar fram till kl ${String(Math.floor(scen.at)).padStart(2, '0')}…</small></div>`);
}
/** Anropas varje bildruta (main.js): fram-spolningen och scenariernas händelser. */
export function menuTick() {
  const sp = M.spin;
  if (sp) {
    const t = performance.now(), from = 6;
    while (hour() < sp.to && performance.now() - t < SPIN_MS) step(DT);
    const bar = document.getElementById('mn-bar');
    if (bar) bar.style.width = `${Math.min(100, (hour() - from) / (sp.to - from) * 100)}%`;
    if (hour() >= sp.to) { M.spin = null; hideOverlay(); sp.done(); }
    return;
  }
  const P = M.plan;
  if (!P || !S.started) return;
  while (P.ev.length && S.t - P.t0 >= P.ev[0][0]) {
    const [, name, ...args] = P.ev.shift();
    act(name, ...args);
  }
  if (!P.ev.length) M.plan = null;
}
