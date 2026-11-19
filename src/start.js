// Starten: spelet har ingen startmeny – det finns ett enda Tornet och det går hela tiden. Första gången visas
// uppstarten i DOS-svart och välkomstrutan, och Berit erbjuder en rundvisning (intro.js) när hon kommer till disken.
// Spelarens val i panelen (styrlogik, slumpen, driftchefen, felknappar, underhåll) minns till nästa gång.
// Bara gränssnitt: dygnet startas med newSim, och allt spelaren gör sedan går via act().
import { BUILDING, FL, STRAT_NAMES } from './config.js';
import { S, log } from './state.js';
import { newSim } from './sim.js';
import { INC_LEVELS } from './incidents.js';
import { fl } from './util.js';
import { showIntro, showOverlay, hideOverlay } from './hud.js';
import { offerVisning } from './intro.js';
import { getLang, setLang, tr } from './lang.js';
import { extraActions } from './input.js';
import { repaintAll } from './panels.js';

const KEY = { boot: 'tornet.boot', seen: 'tornet.intro', offer: 'tornet.visning', prefs: 'tornet.val', lang: 'tornet.lang' };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat fönster m.m. */ } },
};

/** valen från förra gången (de som fortfarande finns) */
function prefs() {
  const o = store.get(KEY.prefs) || {};
  return {
    strategy: o.strategy in STRAT_NAMES ? o.strategy : 'smart',
    incLevel: INC_LEVELS.includes(o.incLevel) ? o.incLevel : 'normal',
    chief: o.chief ?? true,
    mistakes: ['av', 'lite', 'mycket'].includes(o.mistakes) ? o.mistakes : undefined,
    maint: ['natt', 'fel'].includes(o.maint) ? o.maint : undefined,
  };
}
let saved = '';
/** Spara spelarens val när de ändras (anropas med panelen, main.js). */
export function rememberPrefs() {
  if (!S.started || !S.chief) return;
  const now = JSON.stringify({ strategy: S.strategy, incLevel: S.incLevel, chief: S.chief.on, mistakes: S.mistakes, maint: S.maint });
  if (now === saved) return;
  saved = now;
  store.set(KEY.prefs, JSON.parse(now));
}

/**
 * Huset startar. seed = ett bestämt frö (?seed= i adressen, för felsökning och för att dela ett dygn),
 * annars ett slumpat. Dygnet rullar alltid vidare kl 06 (mjukt dygnsskifte).
 * @param {number|null} seed
 */
export function startGame(seed) {
  // språket: svenska om inget annat är valt (?lang=en i adressen går före)
  const q = new URLSearchParams(location.search).get('lang'), saved = store.get(KEY.lang);
  useLang(q === 'sv' || q === 'en' ? q : saved === 'en' ? 'en' : 'sv');
  const o = prefs();
  newSim(seed ?? Math.floor(Math.random() * 1e6), { roll: 'mjuk', strategy: o.strategy, incLevel: o.incLevel, chief: o.chief,
    ...(o.mistakes ? { mistakes: o.mistakes } : {}), ...(o.maint ? { maint: o.maint } : {}) });
  const first = !store.get(KEY.seen);
  boot(() => {
    if (first) { store.set(KEY.seen, 1); showIntro('start', go); } else go();
  });
}
function go() {
  S.started = true;
  log('Dag 1 börjar – dörrarna öppnas!', 'sys');
  // första gången: Berit erbjuder en rundvisning (i panelen – hon börjar när hon har kommit till disken)
  if (!store.get(KEY.offer)) { store.set(KEY.offer, 1); offerVisning(); }
}

// ---------- Språket ----------
/** byt språk i gränssnittet (bara det som visas – simuleringen påverkas inte) @param {'en'|'sv'} l */
function useLang(l) {
  setLang(l);
  document.documentElement.lang = l;
  document.title = l === 'sv' ? 'Tornet – Hiss-O-Matic 3000' : 'The Tower – Hiss-O-Matic 3000';
}
extraActions.lang = l => {
  if (l !== 'en' && l !== 'sv' || l === getLang()) return;
  useLang(l);
  store.set(KEY.lang, l);
  repaintAll();
};

// ---------- Uppstarten (en gång) ----------
function bootLines() {
  const cars = BUILDING.elevators.map(e => e.name);
  return ['HISS-O-MATIC 3000 BIOS v3.11  (C) Tornet Fastighets AB 1995', '',
    `Minnestest ......... 640K OK`, `Våningar ........... ${FL.length} (${fl(0)}–${fl(FL.length - 1)})`,
    ...cars.map(n => `Kontrollerar hiss ${n.padEnd(3)} ..... OK`),
    'Laddar KONTOR95.PAL ........ OK', 'Driftchefen ............ på plats', '', 'Startar Hiss-O-Matic 3000_'].map(l => tr(l));
}
function boot(done) {
  if (store.get(KEY.boot)) { done(); return; }
  store.set(KEY.boot, 1);
  const lines = bootLines();
  showOverlay(`<div class="mn-boot" id="mn-boot"><pre id="mn-bootx"></pre><div class="mn-skip">tryck på valfri tangent</div></div>`);
  const pre = /** @type {HTMLElement} */ (document.getElementById('mn-bootx'));
  let i = 0, over = false;
  // (spelets tangenter ska inte märka något medan uppstarten rullar: mellanslag pausar, H, S …)
  const finish = ev => {
    if (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    if (over) return; over = true;
    removeEventListener('keydown', finish, true); removeEventListener('pointerdown', finish, true);
    hideOverlay();
    done();
  };
  addEventListener('keydown', finish, true); addEventListener('pointerdown', finish, true);
  const next = () => {
    if (over) return;
    if (i >= lines.length) { setTimeout(() => finish(null), 700); return; }
    pre.textContent += `${lines[i++]}\n`;
    setTimeout(next, i < 3 ? 260 : 110);
  };
  next();
}
