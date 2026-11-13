// Kontrollpanelen: hela gränssnittet utom bilden, i kolumnen till vänster. Panelen består av block som vart
// och ett får ett läge efter vad som händer just nu – 'full' (utfällt), 'row' (en rad) eller 'link' (en länk
// längst ner) – eller inte syns alls:
//   lugnt     → allt är utfällt: framkalla, styrning, kameran, driftchefen och dagens siffror
//   incident  → korten tar över överst; framkalla och styrning krymper till länkar
//   följer    → det du följer (person, hiss eller våning) får ett eget block högt upp
// Får något inte plats krymper de minst viktiga blocken. Länkarna längst ner öppnar vyer i panelen
// (register, logg, inställningar, resultat). Biografläget (H) döljer panelen och visar en textskylt i bilden.
// Bara gränssnitt: läser tillståndet och går via doAction/act() för allt som ändrar något.
import { esc, fl } from './util.js';
import { CONTROL, END_H, FL, LOBBY, ROOF, START_H, STRAT_HINT, STRAT_NAMES, TEMPOS, TOP, tempoName } from './config.js';
import { S, hour, phaseName } from './state.js';
import { FIRE_FLOORS, INC_LEVELS, INC_LEVEL_NAMES } from './incidents.js';
import { VIEW, nightness, resize } from './view.js';
import { crewNow, toggleAuto } from './director.js';
import { chiefOnDuty } from './chief.js';
import { $, carHtml, dayNumbers, drawPortrait, incidentPanel, logHtml, personHtml, rosterHtml, statsHtml } from './hud.js';
import { peopleBehindDoor } from './render.js';
import { soundOn } from './sound.js';
import { SPEEDS, extraActions, uiHooks } from './input.js';

const side = $('side'), portrait = $('portrait');

// ---------- Vyer och utfällda länkar (bara gränssnittets tillstånd) ----------
/** @type {{ view: null|'roster'|'log'|'stats'|'set', open: Set<string>, fireFloor: string, squeezed: Set<string>, key: string }} */
const UI = { view: null, open: new Set(), fireFloor: '', squeezed: new Set(), key: '' };
const VIEWS = { roster: '📋 Register', log: '📜 Logg', set: '⚙️ Inställningar', stats: '🏆 Resultat' };
extraActions.view = b => { UI.view = UI.view === b || b === 'back' ? null : /** @type {any} */ (b); S.logDirty = true; };
extraActions.open = b => { UI.open.add(b); UI.view = null; };
extraActions.fold = b => { UI.open.delete(b); UI.squeezed.add(b); };
extraActions.rf = b => { S.rosterFilter = b; };
extraActions.lf = b => { S.logFilter = b; S.logDirty = true; };
side.addEventListener('change', ev => {
  const t = /** @type {HTMLSelectElement} */ (ev.target);
  if (t.name === 'fireFloor') { UI.fireFloor = t.value; repaint(); }
});

// ---------- Dygnets stapel: banden i den takt dygnet spelas, markören för nu och dagens incidenter ----------
/** del av dygnet (0–1) i verklig tid vid klockslaget h, med dygnets tempo */
function dayFrac(h) {
  const ph = TEMPOS[tempoName()].phases;
  let t = 0, tot = 0;
  for (let i = 0; i < ph.length; i++) {
    const from = ph[i][0], to = i + 1 < ph.length ? ph[i + 1][0] : END_H, sec = ph[i][1];
    tot += sec;
    t += sec * Math.max(0, Math.min(1, (h - from) / (to - from)));
  }
  return tot ? t / tot : 0;
}
const BAND_CUTS = [START_H, 7, 9.5, 11.2, 13.4, 15.8, 18.5, 22, END_H]; // samma gränser som phaseName
const bandCls = n => (/rusning|Hemgång/i.test(n) ? 'rush' : n === 'Natt' || n === 'Tidig morgon' ? 'night' : n === 'Kväll' ? 'eve' : 'day');
const pct = v => `${(v * 100).toFixed(2)}%`;
function bandsHtml() {
  return BAND_CUTS.slice(0, -1).map((h0, i) => {
    const n = phaseName(h0 + 0.01), a = dayFrac(h0), b = dayFrac(BAND_CUTS[i + 1]);
    return `<div class="tl-b ${bandCls(n)}" style="left:${pct(a)};width:${pct(b - a)}" data-hint="${n}"></div>`;
  }).join('');
}
// Dagens händelser samlas här när de börjar (gränssnittet ser dem i tillståndet; simuleringen vet inget om listan)
/** @type {{ h: number, icon: string, text: string, act: string }[]} */
let marks = [];
const markSeen = new Set(), was = new Map();
let markDay = -1;
function scanMarks() {
  if (S.day !== markDay) { marks = []; markSeen.clear(); was.clear(); markDay = S.day; }
  const h = hour();
  const add = (key, icon, text, act) => { if (markSeen.has(key)) return; markSeen.add(key); marks.push({ h, icon, text, act }); };
  // det som saknar starttid märks när det slår om från av till på
  const rise = (key, on, icon, text, act) => { if (on && !was.get(key)) add(`${key}@${S.t}`, icon, text, act); was.set(key, on); };
  const top = ROOF >= 0 ? ROOF : TOP;
  if (S.fire) add(`fire${S.fire.t0}`, '🔥', `Brand på ${fl(S.fire.floor)}`, `show:${S.fire.floor}`);
  if (S.outage) add(`out${S.outage.t0}`, '⚡', 'Strömavbrott', `show:${LOBBY}`);
  if (S.storm) add(`storm${S.storm.t0}`, '🌬️', 'Storm', `show:${top}`);
  if (S.storm && S.storm.struck !== null) add(`strike${S.storm.struck}`, '🌩️', 'Blixten slog ner', `show:${top}`);
  if (S.medic) add(`medic${S.medic.t0}`, '🚑', `Ambulans till ${S.medic.pname}`, `show:${S.medic.floor}`);
  rise('move', !!(S.move && S.move.state === 'on'), '🚚', 'Flyttdag', `show:${LOBBY}`);
  rise('heli', !!S.heli, '🚁', 'VIP-helikopter', `show:${top}`);
  for (const e of S.elevators) {
    if (e.mode === 'snapped') add(`snap${e.id}:${e.snap.t0}`, '🪢', `Linbrott i ${e.name}`, `follow:${e.id}`);
    if (e.mode === 'broken' && e.fault && !e.fault.cable) add(`fault${e.id}:${e.fault.t0}`, '🔧', e.fault.trapped ? `${e.name} stannade mellan två våningar` : `${e.name} gick sönder`, `follow:${e.id}`);
    rise(`hot${e.id}`, !!e.hot, '🌡️', `${e.name} överhettad`, `follow:${e.id}`);
  }
}
function timelineHtml() {
  scanMarks();
  const now = dayFrac(hour());
  const m = marks.map(k => `<button class="tl-m" style="left:${pct(dayFrac(k.h))}" data-act="${k.act}" data-hint="${esc(k.text)} – klicka för att visa">${k.icon}</button>`).join('');
  return `<div class="tl">${bandsHtml()}<div class="tl-now" style="left:${pct(now)}"></div>${m}</div>`;
}

// ---------- Förvarningen: en gul rad överst i händelseblocket ----------
function warnHtml() {
  const W = S.warn;
  if (!W) return '';
  const car = W.car !== undefined && W.car !== null ? S.elevators[W.car] : null;
  const text = { fire: `👃 Det luktar bränt på ${fl(W.floor)}`, power: '💡 Lamporna flimrar …', storm: '🌥️ Ett oväder drar in',
    heat: `🌡️ Motorn i ${car ? car.name : 'en hiss'} brummar`, cable: `🪢 Linorna i ${car ? car.name : 'en hiss'} knarrar`, fault: `🔩 ${car ? car.name : 'En hiss'} gnisslar` }[W.type] || '⚠️ Något är på gång';
  const act = car ? `follow:${car.id}` : `show:${W.floor ?? (W.type === 'storm' ? (ROOF >= 0 ? ROOF : TOP) : LOBBY)}`;
  return `<button class="warnrow" data-act="${act}" data-hint="<b>Förvarning:</b> något är på gång – klicka för att visa var">${esc(text)}<span>visa</span></button>`;
}

// ---------- Blocken ----------
const on = b => (b ? ' on' : '');
const btn = (act, label, isOn = false, hint = '', extra = '') => `<button class="btn xs${on(isOn)}" data-act="${act}"${hint ? ` data-hint="${hint}"` : ''}${extra}>${label}</button>`;
/** vad du följer just nu: hiss, våning eller person (i den ordningen) */
function followed() {
  if (VIEW.follow !== null) return { kind: 'car', e: S.elevators[VIEW.follow] };
  if (VIEW.camFloor !== null) return { kind: 'floor', f: VIEW.camFloor };
  if (S.sel && !S.sel.dead) return { kind: 'person', p: S.sel };
  return null;
}
function playHtml() {
  const h = hour(), night = nightness(h) > 0.5;
  const wx = `${S.weather.cold > 0 ? '❄️ ' : S.weather.temp >= 20 ? '🌤️ ' : ''}${S.weather.temp} °C${S.storm ? ' · 🌬️ storm' : ''}`;
  const speeds = SPEEDS.map(v => btn(`spd:${v}`, { 0.25: '¼×', 0.5: '½×', 1: '1×', 2: '2×' }[v], S.speed === v, 'Fart (− och +)')).join('');
  return `<div class="pl-top"><span class="pl-logo">HISS-O-MATIC <b>3000</b></span><span class="pl-sun">${night ? '🌙' : '☀️'}</span>`
    + `<span class="pl-ph"><b>${phaseName(h)}</b> · ${wx}<br><span class="dim">Dag ${S.day} · ${S.people.length} i huset · frö ${S.seed}</span></span></div>`
    + `<div class="pl-ctl">${btn('pause', S.paused ? '▶' : '❚❚', S.paused, '<b>Paus</b> (mellanslag)')}${speeds}<span class="sp"></span>`
    + `${btn('help', '?', false, '<b>Hjälp:</b> handgreppen, tangenterna och mer om huset')}</div>${timelineHtml()}`;
}
function camHtml(mode) {
  const c = crewNow();
  const tools = btn('auto', '🎬 Regissör', VIEW.auto, '<b>Regissören</b> klipper bilden till det mest sevärda (A)')
    + btn('cinema', '🎞️ Biograf', false, '<b>Biografläget:</b> bara bilden och en textskylt (H)')
    + btn('tags', 'ID', S.tags, '<b>Namnbrickor</b> över alla (T)') + btn('sound', soundOn() ? '🔊' : '🔇', soundOn(), '<b>Ljud</b> (M)');
  if (!c) return `<div class="row">${tools}</div>`;
  if (mode === 'row') return `<div class="cam-line" data-act="auto" data-hint="${c.auto ? 'Klicka (A) för att ta kameran själv' : 'Klicka (A) så klipper bevakaren bilden åt dig'}"><span class="rec${on(c.auto)}">${c.auto ? '●' : '❚❚'}</span> 📹 ${esc(c.who.name)}: <b>${esc(c.show)}</b></div>`;
  return `<div class="cam${on(c.auto)}${c.cut ? ' cut' : ''}" data-act="auto" data-hint="${c.auto ? `<b>${esc(c.who.name)}</b> klipper bilden. Klicka (A) för att ta kameran själv.` : `Du har kameran. Klicka (A) så klipper <b>${esc(c.who.name)}</b> bilden åt dig.`}">`
    + `<div class="cam-h"><span class="rec">${c.auto ? '● REC' : '❚❚ AV'}</span>📹 <b>${esc(c.who.name)}</b> <span class="dim">${esc(c.who.title)} · ${esc(c.doing)}</span></div>`
    + `<div class="cam-show">${esc(c.show)}</div><div class="cam-th">💭 ${esc(c.thought)}</div></div><div class="row">${tools}</div>`;
}
function chiefText() {
  const C = S.chief, who = esc(chiefOnDuty().name);
  if (!C || !C.on) return `🧑‍💼 <b>Driftchefen har rast</b> – alla beslut är dina.`;
  if (C.say && S.t < C.say.until) return `🧑‍💼 <b>${who}:</b> ${esc(C.say.text)}`;
  const d = C.log.length ? C.log[C.log.length - 1] : null;
  return d ? `🧑‍💼 <b>${who}</b> <span class="dim">senast:</span> ${esc(d.text)}${d.why ? ` <span class="dim">– ${esc(d.why)}</span>` : ''}`
    : `🧑‍💼 <b>${who}</b> håller ögonen på skärmarna …`;
}
const RADIO_N = 3, RADIO_QUIET_S = 25;
function chiefHtml(mode) {
  if (mode === 'row') return `<div class="chief one">${chiefText()}</div>`;
  const F = S.feed.slice(-RADIO_N);
  const quiet = !F.length || S.t - F[F.length - 1].t > RADIO_QUIET_S;
  const radio = quiet ? '<div class="r dim">📻 Lugnt på radion.</div>'
    : F.map((f, i) => `<div class="r${i === F.length - 1 ? ' new' : ''}${f.kind === 'chief' ? ' chief' : ''}${S.t - f.t > 60 ? ' old' : ''}"><span class="lt">${f.time}</span>${f.color ? `<span class="ld" style="background:${f.color}"></span>` : ''}<span>${esc(f.text)}</span></div>`).join('');
  return `<div class="chief">${chiefText()}</div><div class="radio" data-act="view:log" data-hint="<b>Driftradion:</b> det senaste som hänt. Klicka för hela loggen.">${radio}</div>`;
}
function followHtml(F) {
  if (F.kind === 'car') return { head: `📹 Följer hiss ${esc(F.e.name)}`, body: carHtml(F.e) };
  if (F.kind === 'floor') {
    const f = F.f, w = S.wl && S.wl[f] ? S.wl[f].u.length + S.wl[f].d.length : 0, inside = peopleBehindDoor(f).length;
    const acts = [
      inside ? btn(`inside:${f}`, `👤 Följ någon därinne (${inside})`) : '',
      FIRE_FLOORS.includes(f) ? btn(`trig:fire:${f}`, '🔥 Brand här', false, '', S.fire ? ' disabled' : '') : '',
      btn(`visit:${f}`, '🚶 Släpp in en besökare', false, 'En besökare kommer till våningen', S.fire ? ' disabled' : ''),
      f === LOBBY ? btn('bus', '👥 BUSS!', false, 'En busslast turister väller in i entrén', S.fire ? ' disabled' : '') : '',
    ].join('');
    return { head: `📹 Våning ${fl(f)} · ${esc(FL[f].name)}`, body: `<div class="fl-info">${w} väntar på hiss · ${inside} inne${f === CONTROL ? ' · driftcentralen' : ''}</div><div class="row">${acts}</div>` };
  }
  const p = F.p, cam = VIEW.camSel;
  return { head: `${cam ? '📹 Följer' : '🔎 Spårar'} ${esc(p.name)}`,
    body: personHtml(p) + (cam ? '' : `<div class="row">${btn(`person:${p.id}`, '📹 Följ med kameran (F)')}</div>`) };
}
function trigHtml() {
  const fire = `<select name="fireFloor" data-hint="Våningen som börjar brinna"><option value="">slumpad</option>${FIRE_FLOORS.map(f => `<option value="${f}"${String(f) === UI.fireFloor ? ' selected' : ''}>${fl(f)} · ${esc(FL[f].short)}</option>`).join('')}</select>`;
  const t = (k, label, hint) => btn(`trig:${k}`, label, false, hint);
  return `<div class="row"><span class="trig-fire">${btn(`trig:fire:${UI.fireFloor}`, '🔥 Brand', false, 'Det börjar brinna – på vald våning eller en slumpad', S.fire ? ' disabled' : '')}${fire}</span>`
    + `${t('power', '⚡ Ström', 'Strömavbrott i hela huset')}${t('storm', '🌬️ Storm', 'Ett oväder: de höga schakten svajar')}${t('lightning', '⛈️ Blixt', 'Blixten slår ner (och ibland ut strömmen)')}</div>`
    + `<div class="row">${t('fault', '🔧 Hissfel', 'En slumpad hiss går sönder')}${t('heat', '🌡️ Het motor', 'En motor överhettas')}${t('cable', '🪢 Linbrott', 'Linorna går av i en hiss')}</div>`
    + `<div class="row">${t('medical', '🚑 Ambulans', 'Någon svimmar')}${t('move', '🚚 Flytt', 'Ett hushåll flyttar')}${t('vip', '🚁 VIP', 'VIP-helikoptern landar')}${t('train', '🚇 Tågstörning', 'Tåget blir försenat')}</div>`
    + `<div class="row">${t('cold', '❄️ Kyla', 'En kall dag: dörrarna i entrén tar emot')}${t('heatwave', '☀️ Värme', 'Värmebölja: motorerna kyls sämre')}${btn('bus', '👥 BUSS!', false, 'En busslast turister väller in i entrén', S.fire ? ' disabled' : '')}</div>`
    + `<div class="dim small">Följ en hiss eller våning för att framkalla något just där.</div>`;
}
function stratHtml() {
  const chief = S.chief && S.chief.on;
  return `<div class="lbl">Driftchefen</div><div class="row">${btn('chiefon:on', 'Sköter huset', chief, 'Driftchefen tar alla beslut och berättar varför')}${btn('chiefon:off', 'Rast – jag bestämmer', !chief, 'Incidentkorten frågar dig')}</div>`
    + `<div class="lbl">Styrlogik <span class="dim">(S)</span></div><div class="row">${Object.keys(STRAT_NAMES).map(k => btn(`strat:${k}`, STRAT_NAMES[k], S.strategy === k)).join('')}</div>`
    + `<div class="hint">${STRAT_HINT[S.strategy]}</div>`
    + `<div class="lbl">Slumpen</div><div class="row">${INC_LEVELS.map(v => btn(`inclevel:${v}`, INC_LEVEL_NAMES[v], S.incLevel === v, 'Hur ofta incidenter och hissfel kommer av sig själva')).join('')}</div>`;
}
function dayHtml() {
  const d = dayNumbers();
  return `<div class="day-line" data-act="view:stats" data-hint="Dagens resultat – klicka för allt"><b class="grade-l">${d.letter}</b> ${d.served} resor · ${d.waiting} väntar · snitt ${d.avg.toFixed(0)} s · säkerhet ${d.safety}</div>`;
}
function viewHtml(v) {
  const chips = (act, cur, list) => `<div class="row">${list.map(([k, t]) => btn(`${act}:${k}`, t, cur === k)).join('')}</div>`;
  if (v === 'roster') return chips('rf', S.rosterFilter, [['all', 'Alla'], ['wait', 'Väntar'], ['ride', 'Åker'], ['in', 'Inne']]) + `<div class="roster">${rosterHtml()}</div>`;
  if (v === 'log') return chips('lf', S.logFilter, [['all', 'Allt'], ['lift', 'Hissar'], ['person', 'Personer'], ['button', 'Knappar'], ['sel', 'Följd']]) + `<div class="log">${logHtml()}</div>`;
  if (v === 'stats') return `<div class="stats">${statsHtml()}</div>`;
  const set = (key, list) => `<div class="row">${list.map(([k, t]) => btn(`setting:${key}:${k}`, t, S[key] === k)).join('')}</div>`;
  return `<div class="lbl">Felknappar</div>${set('mistakes', [['av', 'Av'], ['lite', 'Lite'], ['mycket', 'Mycket']])}`
    + `<div class="hint">Hur ofta folk trycker på fel knapp (och barn på alla) – syns med styrlogiken Knappar.</div>`
    + `<div class="lbl">Underhåll</div>${set('maint', [['natt', 'Nattservice'], ['fel', 'Bara vid fel']])}`
    + `<div class="hint">Nattservice håller nere slitaget – utan den slits hissarna dag för dag och går oftare sönder.</div>`
    + `<div class="lbl">Visa</div><div class="row">${btn('tags', 'Namnbrickor (T)', S.tags)}${btn('sound', `Ljud (M) ${soundOn() ? '🔊' : '🔇'}`, soundOn())}</div>`;
}
const TITLES = { cam: '📹 Kameran', chief: '🧑‍💼 Driftchefen', trig: '⚡ Framkalla', strat: '🎛️ Styrning', day: '🏆 Dagen' };

// ---------- Layouten: vilket läge varje block får just nu ----------
// ordning uppifrån och ner; de som krymper först när det inte får plats står sist i SQUEEZE
const ORDER = ['play', 'events', 'follow', 'cam', 'chief', 'trig', 'strat', 'day', 'view', 'links'];
const SQUEEZE = ['strat', 'trig', 'day', 'chief', 'cam'];
function layout(busy, F, inc) {
  const calm = !busy && !F;
  /** @type {Record<string, string|null>} */
  const m = { play: 'full', events: null, follow: F ? 'full' : null, view: UI.view ? 'full' : null, links: 'full',
    cam: calm ? 'full' : 'row', chief: calm ? 'full' : 'row', trig: calm ? 'full' : 'link', strat: calm ? 'full' : 'link', day: busy ? 'link' : 'row' };
  if (S.started && (inc.n || S.warn)) m.events = 'full';
  for (const k of UI.open) if (m[k] === 'link' || m[k] === 'row') m[k] = 'full';
  for (const k of UI.squeezed) if (!UI.open.has(k) && m[k]) m[k] = k === 'cam' || k === 'chief' ? 'row' : 'link';
  // en vy (register, logg …) tar platsen under händelserna: verktygen blir länkar
  if (UI.view) for (const k of ['follow', 'cam', 'chief', 'trig', 'strat', 'day']) if (m[k]) m[k] = k === 'follow' ? 'row' : 'link';
  if (!S.started) for (const k of ['trig', 'strat', 'day']) m[k] = null;
  return m;
}

// ---------- Rita: ett element per block, byggs bara om när innehållet ändras ----------
// Siffror i <span class="lv"> (nedräkningar) uppdateras på plats så att knapparna går att klicka på.
const LV = /<span class="lv">([^<]*)<\/span>/g;
const els = /** @type {Record<string, HTMLElement>} */ ({}), last = /** @type {Record<string, string>} */ ({});
function el(k) {
  if (!els[k]) { els[k] = document.createElement('section'); els[k].dataset.b = k; }
  return els[k];
}
function paint(k, cls, html) {
  const e = el(k);
  if (e.className !== cls) e.className = cls;
  const shape = html.replace(LV, '<span class="lv"></span>');
  if (shape !== last[k]) { last[k] = shape; e.innerHTML = html; return true; }
  const vals = [...html.matchAll(LV)].map(m => m[1]);
  e.querySelectorAll('.lv').forEach((x, i) => { if (x.textContent !== vals[i]) x.textContent = vals[i]; });
  return false;
}
const head = (title, acts = '') => `<div class="blk-h"><span>${title}</span>${acts}</div>`;
function render(m, F, inc) {
  const links = [];
  const shown = [];
  for (const k of ORDER) {
    const mode = m[k];
    if (!mode) continue;
    if (mode === 'link') { links.push(btn(`open:${k}`, TITLES[k] || k, false, 'Fäll ut')); continue; }
    let html = '', cls = `blk b-${k} m-${mode}`;
    const fold = k in TITLES && mode === 'full' && (UI.open.has(k) || k === 'trig' || k === 'strat') ? `<button class="blk-x" data-act="fold:${k}" data-hint="Fäll ihop">▁</button>` : '';
    if (k === 'play') html = playHtml();
    else if (k === 'events') html = warnHtml() + inc.html;
    else if (k === 'follow') {
      const f = followHtml(F);
      html = head(f.head, `<button class="blk-x" data-act="unfollow" data-hint="Sluta följa (Esc)">✕</button>`) + (mode === 'full' ? f.body : '');
    }
    else if (k === 'cam') html = (mode === 'full' ? head(TITLES.cam) : '') + camHtml(mode);
    else if (k === 'chief') html = (mode === 'full' ? head(TITLES.chief) : '') + chiefHtml(mode);
    else if (k === 'trig') html = head(TITLES.trig, fold) + trigHtml();
    else if (k === 'strat') html = head(TITLES.strat, fold) + stratHtml();
    else if (k === 'day') html = dayHtml();
    else if (k === 'view') html = head(VIEWS[UI.view], `<button class="blk-x" data-act="view:back" data-hint="Tillbaka (Esc)">✕</button>`) + viewHtml(UI.view);
    else if (k === 'links') {
      const views = Object.entries(VIEWS).map(([v, t]) => btn(`view:${v}`, t, UI.view === v));
      html = `<div class="row">${[...links, ...views].join('')}</div>`; cls += links.length ? ' has-links' : '';
    }
    if (paint(k, cls, html) && k === 'follow' && F && F.kind === 'person') el(k).querySelector('.pic')?.appendChild(portrait);
    shown.push(el(k));
  }
  // rätt block i rätt ordning (flytta bara det som har ändrats)
  shown.forEach((e, i) => { if (side.children[i] !== e) side.insertBefore(e, side.children[i] || null); });
  while (side.children.length > shown.length) side.lastChild.remove();
  if (F && F.kind === 'person') drawPortrait(F.p);
}
/** Rita panelen. Läget räknas om när situationen ändras (incident, det du följer, en vy); får något inte
 *  plats krymper de minst viktiga blocken tills det gör det (och står kvar så tills situationen ändras). */
export function updatePanel() {
  updateLower();
  if (document.body.classList.contains('cinema')) return;
  const inc = S.started ? incidentPanel() : { html: '', n: 0, open: 0, alert: false };
  const F = S.started ? followed() : null, busy = inc.alert || !!S.warn;
  // (när ett kort fälls ihop blir det plats igen: då får blocken fällas ut på nytt)
  const key = `${busy}|${F ? F.kind : ''}|${UI.view}|${inc.n}|${inc.open}`;
  if (key !== UI.key) { UI.key = key; UI.squeezed.clear(); if (busy || F) UI.open.clear(); }
  for (let i = 0; i <= SQUEEZE.length; i++) {
    render(layout(busy, F, inc), F, inc);
    if (side.scrollHeight <= side.clientHeight + 1) break;
    const next = SQUEEZE.find(k => { const m = layout(busy, F, inc)[k]; return m && m !== 'link' && !(m === 'row' && (k === 'cam' || k === 'chief')) && !UI.open.has(k) && !UI.squeezed.has(k); });
    if (!next) break;
    UI.squeezed.add(next);
  }
}
function repaint() { updatePanel(); }
uiHooks.repaint = repaint;

// ---------- Förklaringar: data-hint blir en vanlig verktygstips (ingen statusrad) ----------
const plain = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
document.addEventListener('pointerover', ev => {
  const t = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-hint]'));
  if (t && t.title !== plain(t.dataset.hint)) t.title = plain(t.dataset.hint);
});

// ---------- Biografläget: bara bilden och en textskylt med vad bevakaren visar ----------
let cinema = false;
export function setCinema(v) {
  cinema = v;
  document.body.classList.toggle('cinema', v);
  if (v && !VIEW.auto) toggleAuto();
  resize();
  updatePanel();
}
extraActions.cinema = () => setCinema(!cinema);
let lowerKey = '';
function updateLower() {
  const e = $('lower'), c = cinema ? crewNow() : null;
  if (e.hidden === !!c) e.hidden = !c;
  if (!c) return;
  const C = S.chief, say = C && C.on && C.say && S.t < C.say.until ? `🧑‍💼 ${esc(chiefOnDuty().name)}: ${esc(C.say.text)}` : '';
  const html = `<div class="lw-tag">${c.auto ? '● LIVE' : '📹'} · ${esc(c.who.name)}</div><div class="lw-show">${esc(c.show)}</div>`
    + `<div class="lw-sub">${say || `💭 ${esc(c.thought)}`}</div><div class="lw-key">H / Esc = tillbaka</div>`;
  if (html !== lowerKey) { lowerKey = html; e.innerHTML = html; }
}
// H slår av/på biografläget; Esc lämnar biografläget eller vyn (fångas före input.js, som annars slutar följa)
window.addEventListener('keydown', ev => {
  if (ev.target instanceof Element && ev.target.closest('select,input')) return;
  if (ev.code === 'KeyH') { setCinema(!cinema); return; }
  if (ev.code !== 'Escape') return;
  if (cinema) { setCinema(false); ev.stopImmediatePropagation(); return; }
  if (UI.view) { UI.view = null; ev.stopImmediatePropagation(); updatePanel(); }
}, true);
