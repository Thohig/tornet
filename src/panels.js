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
import { $, ikon, carHtml, dayNumbers, drawPortrait, incidentPanel, logHtml, personHtml, rosterHtml, statsHtml } from './hud.js';
import { peopleBehindDoor } from './render.js';
import { soundOn } from './sound.js';
import { lastDay, summaryHtml } from './summary.js';
import { SPEEDS, extraActions, uiHooks } from './input.js';

const side = $('side'), portrait = $('portrait');

// ---------- Vyer och utfällda länkar (bara gränssnittets tillstånd) ----------
/** @type {{ view: null|'roster'|'log'|'stats'|'set'|'yesterday', open: Set<string>, fireFloor: string, squeezed: Set<string>, key: string }} */
const UI = { view: null, open: new Set(), fireFloor: '', squeezed: new Set(), key: '' };
/** vyerna: ikon, namn och förklaring (länkarna längst ner är ikoner) */
const VIEWS = { roster: ['📋', 'Register', 'Alla i huset just nu – klicka på någon för att följa hen'], log: ['📜', 'Logg', 'Allt som har hänt, med filter'],
  set: ['⚙️', 'Inställningar', 'Felknappar, underhåll och vad som händer när dygnet tar slut'], stats: ['🏆', 'Resultat', 'Dagens siffror och betyg'] };
/** vyer som inte har en egen länk: gårdagens sammanfattning (öppnas från informationsrutan eller resultatet) */
const VIEW_TITLE = v => (v === 'yesterday' ? `🌅 Dag ${lastDay()?.day ?? ''}` : VIEWS[v].slice(0, 2).join(' '));
extraActions.view = b => { UI.view = UI.view === b || b === 'back' ? null : /** @type {any} */ (b); S.logDirty = true; };
extraActions.yesterday = () => { if (lastDay()) { UI.view = 'yesterday'; S.logDirty = true; } };
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
  const speeds = SPEEDS.map(v => { const t = { 0.25: '¼×', 0.5: '½×', 1: '1×', 2: '2×' }[v]; return ikon(`spd:${v}`, t, `Fart ${t}`, 'Snabbare och långsammare med + och −', S.speed === v); }).join('');
  return `<div class="pl-top"><span class="pl-logo" data-hint="Hissarna styrs av Hiss-O-Matic 3000">TORNET</span><span class="pl-sun">${night ? '🌙' : '☀️'}</span>`
    + `<span class="pl-ph"><b>${phaseName(h)}</b> · ${wx}<br><span class="dim">Dag ${S.day} · ${S.people.length} i huset · frö ${S.seed}</span></span></div>`
    + `<div class="pl-ctl">${ikon('pause', S.paused ? '▶' : '❚❚', S.paused ? 'Spela' : 'Paus', 'Mellanslag', S.paused)}${speeds}<span class="sp"></span>${camTools()}`
    + `${ikon('help', '?', 'Hjälp', 'Handgreppen, tangenterna och mer om huset')}</div>${timelineHtml()}`;
}
/** kamerans verktyg: ikoner i uppspelningsraden (vad regissören visar står på textskylten i bilden) */
function camTools() {
  const c = crewNow(), who = c ? esc(c.who.name) : 'Regissören';
  return ikon('auto', '🎬', 'Regissören', VIEW.auto ? `${who} klipper bilden till det mest sevärda. Klicka (A) för att ta kameran själv.` : `Du har kameran. Klicka (A) så klipper ${who} bilden åt dig.`, VIEW.auto)
    + ikon('cinema', '🎞️', 'Biografläget', 'Bara bilden och textskylten (H)')
    + ikon('tags', '🏷️', 'Namnbrickor', 'Namnen över alla i bild (T)', S.tags)
    + ikon('sound', soundOn() ? '🔊' : '🔇', 'Ljud', soundOn() ? 'Ljudet är på (M)' : 'Ljudet är av (M)', soundOn());
}
const RADIO_N = 3, RADIO_QUIET_S = 25;
/** driftradion: det senaste som hänt (driftchefens beslut står på textskylten i bilden) */
function radioHtml(mode) {
  const F = S.feed.slice(mode === 'row' ? -1 : -RADIO_N);
  const quiet = !F.length || S.t - F[F.length - 1].t > RADIO_QUIET_S;
  const radio = quiet ? '<div class="r dim">📻 Lugnt på radion.</div>'
    : F.map((f, i) => `<div class="r${i === F.length - 1 ? ' new' : ''}${f.kind === 'chief' ? ' chief' : ''}${S.t - f.t > 60 ? ' old' : ''}"><span class="lt">${f.time}</span>${f.color ? `<span class="ld" style="background:${f.color}"></span>` : ''}<span>${esc(f.text)}</span></div>`).join('');
  return `<div class="radio${mode === 'row' ? ' one' : ''}" data-act="view:log" data-hint="<b>Driftradion:</b> det senaste som hänt. Klicka för hela loggen.">${radio}</div>`;
}
function followHtml(F) {
  if (F.kind === 'car') return { head: `📹 Följer hiss ${esc(F.e.name)}`, body: carHtml(F.e) };
  if (F.kind === 'floor') {
    const f = F.f, w = S.wl && S.wl[f] ? S.wl[f].u.length + S.wl[f].d.length : 0, inside = peopleBehindDoor(f).length;
    const acts = [
      inside ? ikon(`inside:${f}`, '👤', 'Följ någon därinne', `${inside} är inne på våningen – klicka igen för nästa`) : '',
      FIRE_FLOORS.includes(f) ? ikon(`trig:fire:${f}`, '🔥', 'Brand här', 'Det börjar brinna på den här våningen', false, S.fire ? ' disabled' : '') : '',
      ikon(`visit:${f}`, '🚶', 'Släpp in en besökare', 'En besökare kommer till våningen', false, S.fire ? ' disabled' : ''),
      f === LOBBY ? ikon('bus', '👥', 'Buss!', 'En busslast turister väller in i entrén', false, S.fire ? ' disabled' : '') : '',
    ].join('');
    return { head: `📹 Våning ${fl(f)} · ${esc(FL[f].name)}`, body: `<div class="fl-info">${w} väntar på hiss · ${inside} inne${f === CONTROL ? ' · driftcentralen' : ''}</div><div class="row">${acts}</div>` };
  }
  const p = F.p, cam = VIEW.camSel;
  return { head: `${cam ? '📹 Följer' : '🔎 Spårar'} ${esc(p.name)}`,
    body: personHtml(p) + (cam ? '' : `<div class="row">${ikon(`person:${p.id}`, '📹', 'Följ med kameran', 'Kameran håller personen i bild (F)')}</div>`) };
}
function trigHtml() {
  const fire = `<select name="fireFloor" data-hint="<b>Brandvåning</b><br>Våningen som börjar brinna"><option value="">slumpad</option>${FIRE_FLOORS.map(f => `<option value="${f}"${String(f) === UI.fireFloor ? ' selected' : ''}>${fl(f)} · ${esc(FL[f].short)}</option>`).join('')}</select>`;
  const t = (k, icon, name, hint) => ikon(`trig:${k}`, icon, name, hint);
  return `<div class="row ico-grid"><span class="trig-fire">${ikon(`trig:fire:${UI.fireFloor}`, '🔥', 'Brand', 'Det börjar brinna – på vald våning eller en slumpad', false, S.fire ? ' disabled' : '')}${fire}</span>`
    + t('power', '⚡', 'Strömavbrott', 'Strömmen går i hela huset') + t('storm', '🌬️', 'Storm', 'Ett oväder: de höga schakten svajar')
    + t('lightning', '⛈️', 'Blixt', 'Blixten slår ner (och ibland ut strömmen)')
    + t('fault', '🔧', 'Hissfel', 'En slumpad hiss går sönder') + t('heat', '🌡️', 'Het motor', 'En motor överhettas')
    + t('cable', '🪢', 'Linbrott', 'Linorna går av i en hiss') + t('pano', '🧗', 'Fast på fasaden', 'Panoramahissen fastnar utanför huset – de instängda måste firas ner')
    + t('coaster', '🎢', 'Svindeln fastnar', 'Nästa tåg med åkare stannar i kedjebacken på taket') + t('mess', '🤢', 'Någon kräks', 'Någon kräks i en hiss med folk i (annars spills kaffe i Sky Café) – driftchefen ringer in städaren')
    + t('medical', '🚑', 'Ambulans', 'Någon svimmar') + t('move', '🚚', 'Flytt', 'Ett hushåll flyttar') + t('vip', '🚁', 'VIP', 'VIP-helikoptern landar')
    + t('train', '🚇', 'Tågstörning', 'Tåget blir försenat') + t('cold', '❄️', 'Kyla', 'En kall dag: dörrarna i entrén tar emot')
    + t('heatwave', '☀️', 'Värmebölja', 'Motorerna kyls sämre') + ikon('bus', '👥', 'Buss!', 'En busslast turister väller in i entrén', false, S.fire ? ' disabled' : '')
    + `</div><div class="dim small">Följ en hiss eller våning för att framkalla något just där.</div>`;
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
  if (v === 'roster') return chips('rf', S.rosterFilter, [['all', 'Alla'], ['wait', 'Väntar'], ['ride', 'Åker'], ['in', 'Inne'], ['crew', 'Personalen']]) + `<div class="roster">${rosterHtml()}</div>`;
  if (v === 'log') return chips('lf', S.logFilter, [['all', 'Allt'], ['lift', 'Hissar'], ['person', 'Personer'], ['button', 'Knappar'], ['sel', 'Följd']]) + `<div class="log">${logHtml()}</div>`;
  if (v === 'stats') return `<div class="stats">${statsHtml()}</div>`;
  if (v === 'yesterday') return summaryHtml();
  const set = (key, list) => `<div class="row">${list.map(([k, t]) => btn(`setting:${key}:${k}`, t, S[key] === k)).join('')}</div>`;
  return `<div class="lbl">Felknappar</div>${set('mistakes', [['av', 'Av'], ['lite', 'Lite'], ['mycket', 'Mycket']])}`
    + `<div class="hint">Hur ofta folk trycker på fel knapp (och barn på alla) – syns med styrlogiken Knappar.</div>`
    + `<div class="lbl">Underhåll</div>${set('maint', [['natt', 'Nattservice'], ['fel', 'Bara vid fel']])}`
    + `<div class="hint">Nattservice håller nere slitaget – utan den slits hissarna dag för dag och går oftare sönder.</div>`
    + `<div class="lbl">Nytt dygn</div>${set('roll', [['mjuk', 'Rullar vidare'], ['ny', 'Börjar om']])}`
    + `<div class="hint">Rullar vidare: kl 06 fortsätter huset som det är – reparationer, incidenter och folk följer med. Börjar om: spelet stannar för dagens resultat och nästa dygn börjar från början (bara slitage och pågående hissfel följer med).</div>`
    + `<div class="lbl">Visa</div><div class="row">${btn('tags', 'Namnbrickor (T)', S.tags)}${btn('sound', `Ljud (M) ${soundOn() ? '🔊' : '🔇'}`, soundOn())}</div>`;
}
/** blocken som kan bli länkar: ikon, namn och förklaring */
const BLOCKS = { chief: ['📻', 'Driftradion', 'Det senaste som hänt i huset'], trig: ['⚡', 'Framkalla', 'Brand, strömavbrott, storm, hissfel …'],
  strat: ['🎛️', 'Styrning', 'Driftchefen, styrlogiken och slumpen'], day: ['📊', 'Dagen', 'Dagens siffror i korthet'] };
const TITLES = Object.fromEntries(Object.entries(BLOCKS).map(([k, v]) => [k, `${v[0]} ${v[1]}`]));

// ---------- Layouten: vilket läge varje block får just nu ----------
// ordning uppifrån och ner; de som krymper först när det inte får plats står sist i SQUEEZE
const ORDER = ['play', 'events', 'follow', 'chief', 'trig', 'strat', 'day', 'view', 'links'];
const SQUEEZE = ['strat', 'trig', 'day', 'chief'];
function layout(busy, F, inc) {
  const calm = !busy && !F;
  /** @type {Record<string, string|null>} */
  const m = { play: 'full', events: null, follow: F ? 'full' : null, view: UI.view ? 'full' : null, links: 'full',
    chief: calm ? 'full' : 'row', trig: calm ? 'full' : 'link', strat: calm ? 'full' : 'link', day: busy ? 'link' : 'row' };
  if (S.started && (inc.n || S.warn)) m.events = 'full';
  for (const k of UI.open) if (m[k] === 'link' || m[k] === 'row') m[k] = 'full';
  for (const k of UI.squeezed) if (!UI.open.has(k) && m[k]) m[k] = k === 'chief' ? 'row' : 'link';
  // en vy (register, logg …) tar platsen under händelserna: verktygen blir länkar
  if (UI.view) for (const k of ['follow', 'chief', 'trig', 'strat', 'day']) if (m[k]) m[k] = k === 'follow' ? 'row' : 'link';
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
    if (mode === 'link') { const [i, n, h] = BLOCKS[k]; links.push(ikon(`open:${k}`, i, n, `${h} – klicka för att fälla ut`)); continue; }
    let html = '', cls = `blk b-${k} m-${mode}`;
    const fold = k in TITLES && mode === 'full' && (UI.open.has(k) || k === 'trig' || k === 'strat') ? `<button class="blk-x" data-act="fold:${k}" data-hint="Fäll ihop">▁</button>` : '';
    if (k === 'play') html = playHtml();
    else if (k === 'events') html = warnHtml() + inc.html;
    else if (k === 'follow') {
      const f = followHtml(F);
      html = head(f.head, `<button class="blk-x" data-act="unfollow" data-hint="Sluta följa (Esc)">✕</button>`) + (mode === 'full' ? f.body : '');
    }
    else if (k === 'chief') html = (mode === 'full' ? head(TITLES.chief) : '') + radioHtml(mode);
    else if (k === 'trig') html = head(TITLES.trig, fold) + trigHtml();
    else if (k === 'strat') html = head(TITLES.strat, fold) + stratHtml();
    else if (k === 'day') html = dayHtml();
    else if (k === 'view') html = head(VIEW_TITLE(UI.view), `<button class="blk-x" data-act="view:back" data-hint="Tillbaka (Esc)">✕</button>`) + viewHtml(UI.view);
    else if (k === 'links') {
      const views = Object.entries(VIEWS).map(([v, [i, n, h]]) => ikon(`view:${v}`, i, n, h, UI.view === v));
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
    const next = SQUEEZE.find(k => { const m = layout(busy, F, inc)[k]; return m && m !== 'link' && !(m === 'row' && k === 'chief') && !UI.open.has(k) && !UI.squeezed.has(k); });
    if (!next) break;
    UI.squeezed.add(next);
  }
}
function repaint() { updatePanel(); }
uiHooks.repaint = repaint;

// ---------- Verktygstips: data-hint visas i en gul ruta vid det man pekar på (ingen statusrad) ----------
// Med mus: efter en kort stund när pekaren vilar på knappen. Med finger: ett långt tryck (input.js låter då
// bli att trycka på knappen) – rutan står kvar en stund och försvinner vid nästa tryck.
const tip = document.createElement('div');
tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
document.body.appendChild(tip);
const TIP_MS = 250, TIP_TOUCH_S = 3000;
// Panelen byggs om flera gånger i sekunden, så knappen under pekaren kan ha bytts ut: tipset gäller platsen
// (och knappens förklaring), inte själva elementet.
let tipKey = '', tipTimer = 0, px = 0, py = 0;
const hintAt = () => /** @type {HTMLElement|null} */ (document.elementFromPoint(px, py)?.closest('[data-hint]') ?? null);
function showTip() {
  const t = hintAt();
  if (!t) { hideTip(); return; }
  tip.innerHTML = t.dataset.hint; tip.hidden = false;
  const r = t.getBoundingClientRect(), w = tip.offsetWidth, hh = tip.offsetHeight;
  const x = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2));
  const y = r.bottom + 6 + hh <= window.innerHeight ? r.bottom + 6 : Math.max(4, r.top - hh - 6);
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
function hideTip() { clearTimeout(tipTimer); tipKey = ''; tip.hidden = true; }
document.addEventListener('pointermove', ev => {
  if (ev.pointerType === 'touch') return;
  px = ev.clientX; py = ev.clientY;
  const t = hintAt(), key = t ? `${t.dataset.act ?? ''}|${t.dataset.hint}` : '';
  if (key === tipKey) return;
  hideTip();
  if (!t) return;
  tipKey = key;
  tipTimer = setTimeout(showTip, TIP_MS);
});
document.addEventListener('pointerleave', hideTip);
document.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'touch' || !tip.hidden) hideTip(); }, true);
/** långt tryck med fingret på en knapp (input.js) */
uiHooks.tip = (x, y) => { hideTip(); px = x; py = y; showTip(); tipTimer = setTimeout(hideTip, TIP_TOUCH_S); };

// ---------- Textskylten längst ner i bilden: vad regissören visar och driftchefens beslut ----------
// Syns alltid när spelet är igång (kameran räknar med den: VIEW.padB i view.js). Biografläget (H) döljer
// panelen och gör skylten större.
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
  const e = $('lower'), c = S.started && !S.summaryShown ? crewNow() : null;
  if (e.hidden === !!c) e.hidden = !c;
  if (!c) return;
  const C = S.chief, dec = C && C.on && C.say && C.say.dec && S.t < C.say.until;
  const chief = dec ? `<div class="lw-sub">🧑‍💼 <b>${esc(chiefOnDuty().name)}:</b> ${esc(C.say.text)}</div>` : '';
  const close = !cinema ? '' : matchMedia('(pointer: coarse)').matches ? '<button class="lw-key lw-x btn" data-act="cinema">✕ Tillbaka</button>' : '<div class="lw-key">H / Esc = tillbaka</div>';
  const html = `<div class="lw-show"><span class="lw-tag">${c.auto ? '● LIVE' : '❚❚'} ${esc(c.who.name)}</span> ${esc(c.show)}</div>${chief}${close}`;
  e.classList.toggle('quiet', !c.auto && !dec);
  // nertill i bilden (syns hela huset är bilden lägre än spelytan)
  const cv = $('game'), gap = Math.max(0, cv.parentElement.clientHeight - cv.offsetTop - cv.offsetHeight), b = `${gap + (cinema ? 24 : 6)}px`;
  if (e.style.bottom !== b) e.style.bottom = b;
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
