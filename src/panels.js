// Kontrollpanelen: hela gränssnittet utom bilden, i kolumnen till vänster. Panelen består av block som vart
// och ett får ett läge efter vad som händer just nu – 'full' (utfällt), 'row' (en rad) eller 'link' (en länk
// längst ner) – eller inte syns alls:
//   lugnt     → allt är utfällt: framkalla, styrning, kameran, driftchefen och dagens siffror
//   incident  → korten tar över överst; framkalla och styrning krymper till länkar
//   följer    → det du följer (person, hiss eller våning) får ett eget block högt upp
// Får något inte plats krymper de minst viktiga blocken. Länkarna längst ner öppnar vyer i panelen
// (register, logg, inställningar, resultat). Biografläget (H) döljer panelen och visar en textskylt i bilden.
// Bara gränssnitt: läser tillståndet och går via doAction/act() för allt som ändrar något.
//
// Översikt:
// `panels.js` – kontrollpanelen `#side`, se nedan; driftradion ur `S.feed`, dygnets stapel med banden i verklig tid
// efter tempot (`dayFrac`) och dagens incidenter; textskylten `#lower` längst ner i bilden med vad regissören visar
// (`crewNow()` – regissören är en person, `CREW` i director.js) och driftchefens beslut (`S.chief.say` med `dec`),
// biografläget (H, `body.cinema`: panelen döljs och skylten blir större); verktygstipset `.tip` som visar
// `data-hint` vid hovring eller långt tryck med fingret (input.js trycker då inte på knappen)
//
// Kontrollpanelen:
// Det finns ingen topplist, statusrad, låda eller högerklicksmeny: hela gränssnittet utom bilden är
// **kontrollpanelen** `#side` till vänster (fast bredd, så att bilden inte skalas om; aldrig flytande över bilden –
// den får inte täcka hallarna). Enda undantaget är den halvgenomskinliga textskylten `#lower` längst ner i bilden:
// kameran räknar med den (`VIEW.padB`, `seeH()` i view.js – det man följer hålls ovanför skylten, och bilden kan
// scrollas `padB` längre ner). Knapparna är ikoner (`ikon()` i hud.js) med namn och förklaring i verktygstipset; val
// mellan lägen (styrlogik, slumpen, incidentkortens val) och incidentkortens huvudknappar behåller texten. Panelen
// består av block (`ORDER` i panels.js: uppspelning med paus/fart (och ⏩ på kvällen och natten: `toggleSkip` i
// input.js spelar upp i `SKIP_SPEED`× till morgonen och stannar när något händer – bara uppspelningen, simuleringen
// tar samma steg), kamerans verktyg (regissör, biograf, namnbrickor, ljud), ? hjälp och dygnets stapel – händelser –
// det du följer – driftradion – framkalla – styrning – dagen – vy – länkar) som vart och ett får läget `full`, `row`
// eller `link` efter situationen (`layout`): lugnt = allt utfällt; en incident eller förvarning = korten överst,
// driftradion på en rad, framkalla och styrning som länkar längst ner; följer du en person, hiss eller våning får
// den ett eget block med det som går att göra just där (framkalla fel i hissen, brand/besökare/buss på våningen).
// Får något inte plats krymper blocken i `SQUEEZE`-ordning; läget räknas om när situationen ändras (`UI.key`).
// Länkarna öppnar vyer i panelen (register, logg, inställningar, resultat); Esc stänger vyn eller slutar följa.
// Incidentkorten är utfällda tills spelaren fäller ihop dem (`foldInc`), informationsrutor fälls ihop av sig själva
// efter en stund – och direkt medan en incident som går att åtgärda pågår. Incidentrutan har två sorters kort:
// **incidenter** som spelaren kan åtgärda (brand, ström, storm, överhettad motor – rutan blinkar) och
// **informationsrutor** som bara berättar och kan stängas (flyttdag, ambulans och `S.notices` via `notice()` i
// state.js: kall dag, snubbel, extra tekniker). Varje kort har knappar som visar händelsen (`show:våning` följer
// våningen, `follow:hiss`). Stängda rutor ligger i `S.dismissed` (bara gränssnittet).
//
// Mobilläget:
// **Mobilläget** (`body.mob`, satt i `resize()` i view.js via `screenMode()`: smal skärm ≤ 800 px, eller en pekskärm
// på tvären – då även `body.land`): på telefonen tittar man, styr gör man på datorn. Det finns ingen kontrollpanel,
// bara bilden och listen `renderMob` (nertill, på tvären en smal kolumn till höger): `m-tick` (textskyltens innehåll –
// vad regissören visar och driftchefens beslut, annars driftradion eller det du följer; textskylten i bilden döljs
// och `padB` = 0) och `m-bar` (paus, regissören 🎬 eller fri kamera, ⏩, hjälpen och språket; ingen fart – alltid 1×). Listen ligger aldrig över bilden –
// bilden krymper (css-flex, en `ResizeObserver` på `#stage` räknar om bilden). Välkomstrutan varnar vid varje start.
import { esc, fl } from './util.js';
import { CONTROL, CREW, END_H, FL, LOBBY, ROOF, START_H, STRAT_HINT, STRAT_NAMES, TEMPOS, TOP, tempoName } from './config.js';
import { S, hour, phaseName } from './state.js';
import { FIRE_FLOORS, INC_LEVELS, INC_LEVEL_NAMES } from './incidents.js';
import { VIEW, nightness, resize } from './view.js';
import { crewNow, startAuto } from './director.js';
import { chiefOnDuty } from './chief.js';
import { $, ikon, carHtml, dayNumbers, drawPortrait, incidentPanel, logHtml, personHtml, rosterHtml, statsHtml } from './hud.js';
import { peopleBehindDoor } from './render.js';
import { soundOn } from './sound.js';
import { getLang, tr, trDom } from './lang.js';
import { musicOn } from './music.js';
import { lastDay, summaryHtml } from './summary.js';
import { guideName } from './visning.js';
import { SKIP_SPEED, SPEEDS, canSkip, extraActions, skipping, toggleSkip, uiHooks } from './input.js';
import { act } from './actions.js';
import { chaosReady } from './chaos.js';
import { LEAK_FLOORS } from './leak.js';
import { incUi } from './incui.js';
import { sv } from './sv.js';

const side = $('side'), portrait = $('portrait');

// ---------- Vyer och utfällda länkar (bara gränssnittets tillstånd) ----------
/** @typedef {{ key: string, html: string, focus: string[], spot: string[] }} TourPanel */
/** @type {{ view: null|'roster'|'log'|'stats'|'set'|'yesterday', open: Set<string>, fireFloor: string, squeezed: Set<string>, key: string, tour: TourPanel|null, chaosArm: number }} */
const UI = { view: null, open: new Set(), fireFloor: '', squeezed: new Set(), key: '', tour: null, chaosArm: 0 };
/** knappen som beställer en rundvisning hos den som guidar härnäst (Berit på dagen, kvällsvärden annars) */
const tourBtn = () => { const n = guideName(); return ikon('visning:now', '🛎️', sv`Be ${n} visa runt`, sv`${n} ringer efter en vikarie till disken och visar en gäst runt i huset – du följer med`, false, S.visning ? ' disabled' : ''); };
/** Rundvisningen (intro.js): ett eget block överst, blocken i focus fälls ut och lyfts fram, och det som
 *  matchar väljarna i spot blinkar (även textskylten i bilden). null = ingen rundvisning. */
export function setTour(t) { UI.tour = t; UI.view = null; updatePanel(); }
const focused = k => !!UI.tour && UI.tour.focus.includes(k);
/** vyerna: ikon, namn och förklaring (länkarna längst ner är ikoner) */
const VIEWS = { roster: ['📋', 'Register', 'Alla i huset just nu – klicka på någon för att följa hen'], log: ['📜', 'Logg', 'Allt som har hänt, med filter'],
  set: ['⚙️', 'Inställningar', 'Felknappar, underhåll och vad som händer när dygnet tar slut'], stats: ['🏆', 'Resultat', 'Dagens siffror och betyg'] };
/** vyer som inte har en egen länk: gårdagens sammanfattning (öppnas från informationsrutan eller resultatet) */
const VIEW_TITLE = v => (v === 'yesterday' ? sv`🌅 Dag ${lastDay()?.day ?? ''}` : VIEWS[v].slice(0, 2).join(' '));
extraActions.view = b => { UI.view = UI.view === b || b === 'back' ? null : /** @type {any} */ (b); S.logDirty = true; };
extraActions.yesterday = () => { if (lastDay()) { UI.view = 'yesterday'; S.logDirty = true; } };
extraActions.open = b => { UI.open.add(b); UI.view = null; };
extraActions.fold = b => { UI.open.delete(b); UI.squeezed.add(b); };
extraActions.rf = b => { S.rosterFilter = b; };
// Murphys lag: första klicket fäller upp plastlocket, ett andra klick inom ARM_MS trycker på knappen
const ARM_MS = 3000;
const armed = () => UI.chaosArm > 0 && performance.now() - UI.chaosArm < ARM_MS;
extraActions.chaos = () => {
  if (!S.started || !chaosReady()) return;
  if (armed()) { UI.chaosArm = 0; act('chaos'); } else UI.chaosArm = performance.now();
};
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
  if (S.fire) add(`fire${S.fire.t0}`, '🔥', sv`Brand på ${fl(S.fire.floor)}`, `show:${S.fire.floor}`);
  if (S.outage) add(`out${S.outage.t0}`, '⚡', 'Strömavbrott', `show:${LOBBY}`);
  if (S.storm) add(`storm${S.storm.t0}`, '🌬️', 'Storm', `show:${top}`);
  if (S.storm && S.storm.struck !== null) add(`strike${S.storm.struck}`, '🌩️', 'Blixten slog ner', `show:${top}`);
  if (S.medic) add(`medic${S.medic.t0}`, '🚑', sv`Ambulans till ${S.medic.pname}`, `show:${S.medic.floor}`);
  rise('move', !!(S.move && S.move.state === 'on'), '🚚', 'Flyttdag', `show:${LOBBY}`);
  rise('heli', !!S.heli, '🚁', 'VIP-helikopter', `show:${top}`);
  for (const e of S.elevators) {
    if (e.mode === 'snapped') add(`snap${e.id}:${e.snap.t0}`, '🪢', `Linbrott i ${e.name}`, `follow:${e.id}`);
    if (e.mode === 'broken' && e.fault && !e.fault.cable) {
      add(`fault${e.id}:${e.fault.t0}`, '🔧', e.fault.trapped ? sv`${e.name} stannade mellan två våningar` : sv`${e.name} gick sönder`, `follow:${e.id}`);
    }
    rise(`hot${e.id}`, !!e.hot, '🌡️', sv`${e.name} överhettad`, `follow:${e.id}`);
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
  const text = { fire: sv`👃 Det luktar bränt på ${fl(W.floor)}`, power: '💡 Lamporna flimrar …', storm: '🌥️ Ett oväder drar in',
    heat: sv`🌡️ Motorn i ${car ? car.name : 'en hiss'} brummar`, cable: sv`🪢 Linorna i ${car ? car.name : 'en hiss'} knarrar`, fault: sv`🔩 ${car ? car.name : 'En hiss'} gnisslar`, heist: '🚐 En skåpbil står vid lastkajen med motorn igång' }[W.type] || '⚠️ Något är på gång';
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
  const speeds = SPEEDS.map(v => {
    const t = { 0.25: '¼×', 0.5: '½×', 1: '1×', 2: '2×' }[v];
    return ikon(`spd:${v}`, t, `Fart ${t}`, 'Snabbare och långsammare med + och −', S.speed === v);
  }).join('');
  return `<div class="pl-top"><span class="pl-logo" data-hint="Hissarna styrs av Hiss-O-Matic 3000">TORNET</span><span class="pl-sun">${night ? '🌙' : '☀️'}</span>`
    + `<span class="pl-ph"><b>${phaseName(h)}</b> · ${wx}<br><span class="dim">Dag ${S.day} · ${S.people.length} i huset · frö ${S.seed}</span></span>${flagsHtml()}</div>`
    + `<div class="pl-ctl">${ikon('pause', S.paused ? '▶' : '❚❚', S.paused ? 'Spela' : 'Paus', 'Mellanslag', S.paused)}${speeds}${skipBtn()}<span class="sp"></span><span class="pl-cam">${camTools()}</span>`
    + `${ikon('help', '?', 'Hjälp', 'Handgreppen, tangenterna och mer om huset')}</div>${timelineHtml()}`;
}
// ---------- Språket: två pixelflaggor längst upp till höger ----------
// (ritade som SVG i 16×10 rutor utan utjämning; texterna står på respektive språk och översätts inte)
const FLAG_SV = '<rect width="16" height="10" fill="#006aa7"/><rect x="5" width="2" height="10" fill="#fecc00"/><rect y="4" width="16" height="2" fill="#fecc00"/>';
const FLAG_EN = '<rect width="16" height="10" fill="#012169"/>'
  + '<path d="M0 0L16 10M16 0L0 10" stroke="#fff" stroke-width="2.4"/><path d="M0 0L16 10M16 0L0 10" stroke="#c8102e" stroke-width="0.9"/>'
  + '<rect x="6" width="4" height="10" fill="#fff"/><rect y="3" width="16" height="4" fill="#fff"/>'
  + '<rect x="7" width="2" height="10" fill="#c8102e"/><rect y="4" width="16" height="2" fill="#c8102e"/>';
/** @param {'sv'|'en'} l */
function flagBtn(l) {
  const on = getLang() === l, name = l === 'sv' ? 'Svenska' : 'English', hint = l === 'sv' ? 'Spelet på svenska' : 'The game in English';
  return `<button class="btn flag${on ? ' on' : ''}" data-act="lang:${l}" lang="${l}" aria-label="${name}" aria-pressed="${on}" data-hint="<b>${name}</b><br>${hint}">`
    + `<svg viewBox="0 0 16 10" shape-rendering="crispEdges" aria-hidden="true">${l === 'sv' ? FLAG_SV : FLAG_EN}</svg></button>`;
}
const flagsHtml = () => `<span class="pl-lang">${flagBtn('sv')}${flagBtn('en')}</span>`;
/** kamerans verktyg: ikoner i uppspelningsraden (vad regissören visar står på textskylten i bilden) */
function camTools() {
  const c = crewNow(), who = c ? esc(c.who.name) : 'Regissören';
  return ikon('auto', '🎬', 'Regissören', VIEW.auto ? sv`${who} klipper bilden till det mest sevärda. Klicka i bilden för att ta kameran själv – ${who} tar den igen när du släpper den. (A) stänger av regissören.`
    : VIEW.autoWant ? sv`Du har kameran – ${who} tar den igen när du slutar följa eller har låtit bli att scrolla en stund. (A) stänger av regissören.`
    : sv`Du har kameran. Klicka (A) så klipper ${who} bilden åt dig.`, VIEW.autoWant)
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
    : F.map((f, i) => `<div class="r${i === F.length - 1 ? ' new' : ''}${f.kind === 'chief' ? ' chief' : ''}${S.t - f.t > 60 ? ' old' : ''}">`
      + `<span class="lt">${f.time}</span>${f.color ? `<span class="ld" style="background:${f.color}"></span>` : ''}<span>${esc(f.text)}</span></div>`).join('');
  return `<div class="radio${mode === 'row' ? ' one' : ''}" data-act="view:log" data-hint="<b>Driftradion:</b> det senaste som hänt. Klicka för hela loggen.">${radio}</div>`;
}
function followHtml(F) {
  if (F.kind === 'car') return { head: sv`📹 Följer hiss ${esc(F.e.name)}`, body: carHtml(F.e) };
  if (F.kind === 'floor') {
    const f = F.f, w = S.wl && S.wl[f] ? S.wl[f].u.length + S.wl[f].d.length : 0, inside = peopleBehindDoor(f).length;
    const acts = [
      inside ? ikon(`inside:${f}`, '👤', 'Följ någon därinne', sv`${inside} är inne på våningen – klicka igen för nästa`) : '',
      FIRE_FLOORS.includes(f) ? ikon(`trig:fire:${f}`, '🔥', 'Brand här', 'Det börjar brinna på den här våningen', false, S.fire ? ' disabled' : '') : '',
      LEAK_FLOORS.includes(f) ? ikon(`trig:leak:${f}`, '🚿', 'Vattenläcka här', 'Ett vattenrör spricker på den här våningen – vattnet rinner nedåt', false, S.leak ? ' disabled' : '') : '',
      ikon(`visit:${f}`, '🚶', 'Släpp in en besökare', 'En besökare kommer till våningen', false, S.fire ? ' disabled' : ''),
      f === LOBBY ? tourBtn() : '',
      f === LOBBY ? ikon('bus', '🚌', 'Turistbuss!', 'Stadsturen: en guide och fjorton turister ska se takterrassen och Sky Café. Kommer bara när de har öppet (ungefär 07:30–16)', false, S.fire || S.tour ? ' disabled' : '') : '',
    ].join('');
    return { head: sv`📹 Våning ${fl(f)} · ${esc(FL[f].name)}`, body: `<div class="fl-info">${w} väntar på hiss · ${inside} inne${f === CONTROL ? ' · driftcentralen' : ''}</div><div class="row">${acts}</div>` };
  }
  const p = F.p, cam = VIEW.camSel;
  return { head: `${cam ? '📹 Följer' : '🔎 Spårar'} ${esc(p.name)}`,
    body: personHtml(p) + `<div class="row">${cam ? '' : ikon(`person:${p.id}`, '📹', 'Följ med kameran', 'Kameran håller personen i bild (F)')}`
      + `${p.crewId && CREW.some(c => c.id === p.crewId && c.guide) ? tourBtn() : ''}</div>` };
}
function trigHtml() {
  const fire = `<select name="fireFloor" data-hint="<b>Brandvåning</b><br>Våningen som börjar brinna"><option value="">slumpad</option>${FIRE_FLOORS.map(f => `<option value="${f}"${String(f) === UI.fireFloor ? ' selected' : ''}>${fl(f)} · ${esc(FL[f].short)}</option>`).join('')}</select>`;
  // (en grå knapp säger varför i verktygstipset)
  const why = (hint, w) => (w ? `${hint}<br><i>Går inte just nu: ${w}</i>` : hint);
  return `<div class="row ico-grid"><span class="trig-fire">${ikon(`trig:fire:${UI.fireFloor}`, '🔥', 'Brand', why('Det börjar brinna – på vald våning eller en slumpad', S.fire && 'det brinner redan'), false, S.fire ? ' disabled' : '')}${fire}</span>`
    + incUi().filter(u => u.trig).map(u => { // (registret, incui.js)
      const off = !!(u.trig.off && u.trig.off());
      const hint = why(u.trig.hint, off && (u.trig.why ? u.trig.why() : 'den pågår redan'));
      return ikon(`trig:${u.key}`, u.trig.icon, u.trig.name, hint, false, off ? ' disabled' : '');
    }).join('')
    + ikon('bus', '🚌', 'Turistbuss!', why('Stadsturen: en guide och fjorton turister ska se takterrassen och Sky Café. Kommer bara när de har öppet (ungefär 07:30–16)', S.fire ? 'det brinner i huset' : S.tour && 'bussen är redan här'), false, S.fire || S.tour ? ' disabled' : '')
    + `</div><div class="row">${chaosBtn()}</div><div class="dim small">Följ en hiss eller våning för att framkalla något just där.</div>`;
}
/** kaosknappen under sitt plastlock: stängt, uppfällt (blinkar), använd i dag eller kedjan pågår */
function chaosBtn() {
  const hint = 'Allt som kan gå fel går fel – det ena efter det andra: storm, blixt, strömavbrott, hissfel, linbrott, brand, kupp … Går bara att trycka en gång per dygn';
  if (S.chaos) return `<button class="btn chaos" disabled data-hint="<b>Murphys lag</b><br>Kedjan pågår – huset får klara sig så gott det går">💥 Murphys lag pågår…</button>`;
  if (!chaosReady()) return `<button class="btn chaos" disabled data-hint="<b>Murphys lag</b><br>Redan använd i dag – locket plomberas om kl 06">💥 Murphys lag · använd i dag</button>`;
  if (armed()) return `<button class="btn chaos armed" data-act="chaos" data-hint="<b>Murphys lag</b><br>Locket är uppfällt – tryck igen för att utlösa! (${hint})">💥 TRYCK FÖR KAOS!</button>`;
  return `<button class="btn chaos lid" data-act="chaos" data-hint="<b>Murphys lag</b><br>Fäll upp locket – och tryck en gång till inom tre sekunder. ${hint}">🛡️ Murphys lag</button>`;
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
    + `<div class="lbl">Language / Språk</div><div class="row">${btn('lang:en', 'English', getLang() === 'en')}${btn('lang:sv', 'Svenska', getLang() === 'sv')}</div>`
    + `<div class="lbl">Visa</div><div class="row">${btn('tags', 'Namnbrickor (T)', S.tags)}${btn('sound', sv`Ljud (M) ${soundOn() ? '🔊' : '🔇'}`, soundOn())}${btn('music', 'Musik ♪', musicOn())}</div>`
    + `<div class="hint">När ljudet är på: husmusiken följer dygnet (ragtime i rusningen, vals på förmiddagen, jazz till lunch, lounge på kvällen, speldosa på natten) med korta inslag när något händer. Följer du en hiss hörs i stället kassetten i korgen.</div>`;
}
/** blocken som kan bli länkar: ikon, namn och förklaring */
const BLOCKS = { chief: ['📻', 'Driftradion', 'Det senaste som hänt i huset'], trig: ['⚡', 'Framkalla', 'Brand, strömavbrott, storm, hissfel …'],
  strat: ['🎛️', 'Styrning', 'Driftchefen, styrlogiken och slumpen'], day: ['📊', 'Dagen', 'Dagens siffror i korthet'] };
const TITLES = Object.fromEntries(Object.entries(BLOCKS).map(([k, v]) => [k, `${v[0]} ${v[1]}`]));

// ---------- Layouten: vilket läge varje block får just nu ----------
// ordning uppifrån och ner; de som krymper först när det inte får plats står sist i SQUEEZE
const ORDER = ['tour', 'play', 'events', 'follow', 'chief', 'trig', 'strat', 'day', 'view', 'links'];
const SQUEEZE = ['strat', 'trig', 'day', 'chief'];
function layout(busy, F, inc) {
  const calm = !busy && !F;
  /** @type {Record<string, string|null>} */
  const m = { tour: UI.tour ? 'full' : null, play: 'full', events: null, follow: F ? 'full' : null, view: UI.view ? 'full' : null, links: 'full',
    chief: calm ? 'full' : 'row', trig: calm ? 'full' : 'link', strat: calm ? 'full' : 'link', day: busy ? 'link' : 'row' };
  if (S.started && (inc.n || S.warn)) m.events = 'full';
  for (const k of UI.open) if (m[k] === 'link' || m[k] === 'row') m[k] = 'full';
  for (const k of UI.squeezed) if (!UI.open.has(k) && !focused(k) && m[k]) m[k] = k === 'chief' ? 'row' : 'link';
  // en vy (register, logg …) tar platsen under händelserna: verktygen blir länkar
  if (UI.view) for (const k of ['follow', 'chief', 'trig', 'strat', 'day']) if (m[k]) m[k] = k === 'follow' ? 'row' : 'link';
  if (!S.started) for (const k of ['trig', 'strat', 'day']) m[k] = null;
  // rundvisningen: det Berit pratar om är utfällt (om det finns just nu)
  if (UI.tour) for (const k of UI.tour.focus) if (m[k]) m[k] = 'full';
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
  if (shape !== last[k]) { last[k] = shape; e.innerHTML = html; trDom(e); return true; }
  // (nedräkningarna är ord – "om en halv minut" – och översätts som resten av panelen)
  const vals = [...html.matchAll(LV)].map(m => tr(m[1]));
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
    if (mode === 'link') { const [i, n, h] = BLOCKS[k]; links.push(ikon(`open:${k}`, i, n, sv`${h} – klicka för att fälla ut`)); continue; }
    let html = '', cls = `blk b-${k} m-${mode}`;
    const fold = k in TITLES && mode === 'full' && (UI.open.has(k) || k === 'trig' || k === 'strat') ? `<button class="blk-x" data-act="fold:${k}" data-hint="Fäll ihop">▁</button>` : '';
    if (focused(k)) cls += ' tour-hi';
    if (k === 'tour') html = UI.tour.html;
    else if (k === 'play') html = playHtml();
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
  tourSpots();
}
/** rundvisningen: resten av panelen tonas ner och det som visas blinkar (läggs på igen när blocken byggs om) */
function tourSpots() {
  const T = UI.tour, want = new Set(T ? T.spot.flatMap(q => [...document.querySelectorAll(q)]) : []);
  side.classList.toggle('touring', !!T && (T.focus.length > 0 || T.spot.length > 0));
  for (const e of document.querySelectorAll('.tour-spot')) if (!want.has(e)) e.classList.remove('tour-spot');
  for (const e of want) e.classList.add('tour-spot');
}
/** Rita panelen. Läget räknas om när situationen ändras (incident, det du följer, en vy); får något inte
 *  plats krymper de minst viktiga blocken tills det gör det (och står kvar så tills situationen ändras). */
export function updatePanel() {
  updateLower();
  if (document.body.classList.contains('cinema')) return;
  const inc = S.started ? incidentPanel() : { html: '', n: 0, open: 0, alert: false };
  const F = S.started ? followed() : null, busy = inc.alert || !!S.warn;
  if (document.body.classList.contains('mob')) { UI.key = ''; renderMob(F, inc); return; }
  side.classList.remove('sheet');
  // (när ett kort fälls ihop blir det plats igen: då får blocken fällas ut på nytt)
  const key = `${busy}|${F ? F.kind : ''}|${UI.view}|${inc.n}|${inc.open}|${UI.tour ? UI.tour.key : ''}`;
  if (key !== UI.key) { UI.key = key; UI.squeezed.clear(); if (busy || F) UI.open.clear(); }
  for (let i = 0; i <= SQUEEZE.length; i++) {
    render(layout(busy, F, inc), F, inc);
    if (side.scrollHeight <= side.clientHeight + 1) break;
    const next = SQUEEZE.find(k => { const m = layout(busy, F, inc)[k]; return m && m !== 'link' && !(m === 'row' && k === 'chief') && !UI.open.has(k) && !focused(k) && !UI.squeezed.has(k); });
    if (!next) break;
    UI.squeezed.add(next);
  }
}
function repaint() { updatePanel(); }
uiHooks.repaint = repaint;

// ---------- Mobilen: bara bilden och en list (på telefonen tittar man – styr gör man på datorn) ----------
// Nertill (på tvären: till höger) ligger listen: paus, regissören, ⏩ till morgonen, hjälpen och språket. Ovanför den en rad med det
// som händer (textskyltens innehåll: vad regissören visar och driftchefens beslut, annars radion eller det du följer).
extraActions.skip = () => toggleSkip();
/** ⏩ till morgonen: knappen syns bara på kvällen och natten (och medan det spolas) */
const skipBtn = () => (skipping() ? ikon('skip', '⏩', 'Sluta spola', sv`Spolar natten i ${SKIP_SPEED}× – tryck för att sluta (N)`, true)
  : canSkip() ? ikon('skip', '⏩', 'Till morgonen', sv`Spola fram natten i ${SKIP_SPEED}× – stannar på morgonen eller när något händer (N)`) : '');
/** raden ovanför listen: det som händer (samma innehåll som textskylten i bilden) */
function tickHtml(F, inc) {
  const c = S.started && !S.summaryShown ? crewNow() : null, C = S.chief;
  const dec = C && C.on && C.say && C.say.dec && S.t < C.say.until;
  const show = S.warn ? warnText() : c ? `<span class="lw-tag">${c.auto ? '● LIVE' : '❚❚'}</span>${esc(c.show)}` : '<span class="dim">Tornet</span>';
  const last = S.feed[S.feed.length - 1], fresh = last && S.t - last.t <= RADIO_QUIET_S;
  const sub = dec ? `${C.say.who ? '🚓' : '🧑‍💼'} <b>${esc(C.say.who || chiefOnDuty().name)}:</b> ${esc(C.say.text)}`
    : F && !c ? followHtml(F).head : fresh ? `📻 ${esc(last.text)}` : '';
  return `<div class="m-tick${S.warn || inc.alert ? ' alert' : ''}"><div class="m-t1">${show}</div>${sub ? `<div class="m-t2">${sub}</div>` : ''}</div>`;
}
/** förvarningens text (utan knappen) */
function warnText() { const m = warnHtml().match(/^<button[^>]*>([^<]*)/); return m ? m[1] : ''; }
/** listen: paus, regissören, till morgonen, hjälpen och språket */
function barHtml() {
  const c = crewNow(), who = c ? esc(c.who.name) : 'Regissören';
  return ikon('pause', S.paused ? '▶' : '❚❚', S.paused ? 'Spela' : 'Paus', 'Pausa eller spela', S.paused)
    + ikon('auto', '🎬', 'Regissören', VIEW.autoWant ? sv`${who} klipper bilden åt dig – tryck för fri kamera` : 'Fri kamera: dra i bilden och tryck på det du vill följa – tryck så klipper regissören åt dig', VIEW.autoWant)
    + (skipping() ? ikon('skip', '⏩', 'Sluta spola', sv`Spolar natten i ${SKIP_SPEED}× – tryck för att sluta`, true)
      : canSkip() ? ikon('skip', '⏩', 'Till morgonen', sv`Spola fram natten i ${SKIP_SPEED}× – stannar på morgonen eller när något händer`) : '')
    + `<span class="m-sep"></span>` + ikon('help', '?', 'Hjälp', 'Vad du tittar på – och varför Tornet gör sig bäst på en dator')
    + `<span class="sp"></span>` + flagsHtml();
}
function renderMob(F, inc) {
  const land = document.body.classList.contains('land');
  const shown = [];
  if (!land) { paint('m-tick', 'blk m-tickb', tickHtml(F, inc)); shown.push(el('m-tick')); }
  paint('m-bar', 'blk m-bar', barHtml()); shown.push(el('m-bar'));
  side.classList.remove('sheet', 'offer', 'touring');
  shown.forEach((e, i) => { if (side.children[i] !== e) side.insertBefore(e, side.children[i] || null); });
  while (side.children.length > shown.length) side.lastChild.remove();
}

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
  tip.innerHTML = t.dataset.hint; trDom(tip); tip.hidden = false;
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
  if (v && !VIEW.auto) startAuto();
  resize();
  updatePanel();
}
extraActions.cinema = () => setCinema(!cinema);
let lowerKey = '';
/** Språket byttes (lang.js): rita om hela panelen och textskylten nästa gång. */
export function repaintAll() {
  for (const k of Object.keys(last)) delete last[k];
  lowerKey = ''; UI.key = '';
  updatePanel();
}
function updateLower() {
  const e = $('lower'), c = S.started && !S.summaryShown ? crewNow() : null;
  if (e.hidden === !!c) e.hidden = !c;
  if (!c) return;
  const C = S.chief, dec = C && C.on && C.say && C.say.dec && S.t < C.say.until;
  const chief = dec ? `<div class="lw-sub">${C.say.who ? '🚓' : '🧑‍💼'} <b>${esc(C.say.who || chiefOnDuty().name)}:</b> ${esc(C.say.text)}</div>` : '';
  const close = !cinema ? '' : matchMedia('(pointer: coarse)').matches ? '<button class="lw-key lw-x btn" data-act="cinema">✕ Tillbaka</button>' : '<div class="lw-key">H / Esc = tillbaka</div>';
  const html = `<div class="lw-show"><span class="lw-tag">${c.auto ? '● LIVE' : '❚❚'} ${esc(c.who.name)}</span> ${esc(c.show)}</div>${chief}${close}`;
  e.classList.toggle('quiet', !c.auto && !dec);
  // nertill i bilden (syns hela huset är bilden lägre än spelytan)
  const cv = $('game'), gap = Math.max(0, cv.parentElement.clientHeight - cv.offsetTop - cv.offsetHeight), b = `${gap + (cinema ? 24 : 6)}px`;
  if (e.style.bottom !== b) e.style.bottom = b;
  if (html !== lowerKey) { lowerKey = html; e.innerHTML = html; trDom(e); }
}
// H slår av/på biografläget; Esc lämnar biografläget eller vyn (fångas före input.js, som annars slutar följa)
window.addEventListener('keydown', ev => {
  if (ev.target instanceof Element && ev.target.closest('select,input')) return;
  if (ev.code === 'KeyH') { setCinema(!cinema); return; }
  if (ev.code !== 'Escape') return;
  if (cinema) { setCinema(false); ev.stopImmediatePropagation(); return; }
  if (UI.view) { UI.view = null; ev.stopImmediatePropagation(); updatePanel(); }
}, true);
