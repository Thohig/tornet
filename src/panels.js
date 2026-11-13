// Gränssnittets paneler runt bilden: kontrollrummet (bevakaren, driftchefen och driftradion),
// dygnets tidslinje, högerklicksmenyn i bilden, biografläget, statusraden och styrbordet.
// Allt här är bara gränssnitt: det läser tillståndet och går via act()/doAction för allt som ändrar något.
import { esc, fl } from './util.js';
import { BX0, CONTROL, END_H, FL, FLOOR_H, GROUND_Y, INNER_X1, LOBBY, ROOF, ROOF_Y, START_H, TEMPOS, TOP, WAIT_X1, floorY, tempoName } from './config.js';
import { S, hour, phaseName } from './state.js';
import { FIRE_FLOORS } from './incidents.js';
import { VIEW, cv, resize } from './view.js';
import { crewNow, toggleAuto } from './director.js';
import { chiefOnDuty } from './chief.js';
import { $, openCarPop, select, stateLabel } from './hud.js';
import { stateInfo } from './describe.js';
import { act } from './actions.js';
import { extraActions, hitCar, hitDoor, hitPerson, toWorld } from './input.js';

// localStorage kan saknas eller kasta (privat fönster): allt fungerar ändå
const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ingen lagring */ } };

// ---------- Kontrollrummet: bevakaren (kameran), driftchefen (besluten) och driftradionen i ett fönster ----------
let ctlFold = load('hiss.ctlFold', '') === '1';
let ctlKey = '';
const RADIO_N = 3, RADIO_QUIET_S = 25;
function chiefText() {
  const C = S.chief, who = esc(chiefOnDuty().name);
  if (!C || !C.on) return `🧑‍💼 <b>Driftchefen har rast</b> – alla beslut är dina (incidentkorten frågar dig).`;
  if (C.say && S.t < C.say.until) return `🧑‍💼 <b>${who}:</b> ${esc(C.say.text)}`;
  const d = C.log.length ? C.log[C.log.length - 1] : null;
  return d ? `🧑‍💼 <b>${who}</b> <span class="ctl-dim">senast:</span> ${esc(d.text)}${d.why ? ` <span class="ctl-dim">– ${esc(d.why)}</span>` : ''}`
    : `🧑‍💼 <b>${who}</b> håller ögonen på skärmarna…`;
}
function updateCtl() {
  const el = $('ctl'), c = crewNow();
  if (el.hidden === !!c) el.hidden = !c;
  if (!c) return;
  const F = S.feed.slice(-RADIO_N);
  const quiet = !F.length || S.t - F[F.length - 1].t > RADIO_QUIET_S;
  const radio = quiet ? '<div class="ctl-r ctl-dim">📻 Lugnt på radion.</div>'
    : F.map((f, i) => `<div class="ctl-r${i === F.length - 1 ? ' new' : ''}${f.kind === 'chief' ? ' chief' : ''}${S.t - f.t > 60 ? ' old' : ''}"><span class="lt">${f.time}</span>${f.color ? `<span class="ld" style="background:${f.color}"></span>` : ''}<span>${esc(f.text)}</span></div>`).join('');
  const html = `<div class="ctl-t"><span class="ctl-tt">📺 KONTROLLRUMMET · ${esc(fl(CONTROL >= 0 ? CONTROL : LOBBY))}</span>`
    + `<button class="inc-x" data-act="show:${CONTROL >= 0 ? CONTROL : LOBBY}" data-hint="Visa kontrollrummet i bilden">📍</button>`
    + `<button class="inc-x" data-act="ctlfold" data-hint="${ctlFold ? 'Fäll ut kontrollrummet' : 'Fäll ihop kontrollrummet till en rad'}">${ctlFold ? '▔' : '▁'}</button></div>`
    + `<div class="ctl-cam${c.auto ? ' on' : ''}${c.cut ? ' cut' : ''}" data-act="auto" data-hint="${c.auto ? `<b>${esc(c.who.name)}</b> klipper bilden till det mest sevärda. Klicka (eller A) för att ta kameran själv.` : `Du har kameran. Klicka (eller A) så tar <b>${esc(c.who.name)}</b> över och klipper bilden åt dig.`}">`
    + `<div class="ctl-h"><span class="ctl-rec">${c.auto ? '● REC' : '❚❚ AV'}</span>📹 <b>${esc(c.who.name)}</b> <span class="ctl-dim">${esc(c.who.title)} · ${esc(c.doing)}</span></div>`
    + `<div class="ctl-show">${esc(c.show)}</div>`
    + `<div class="ctl-th">💭 ${esc(c.thought)}</div></div>`
    + `<div class="ctl-chief">${chiefText()}</div>`
    + `<div class="ctl-radio" data-act="tab:log" data-hint="<b>Driftradion:</b> det senaste som hänt och driftchefens beslut. Klicka för hela loggen.">${radio}</div>`;
  el.classList.toggle('fold', ctlFold);
  if (html === ctlKey) return;
  ctlKey = html; el.innerHTML = html;
}
extraActions.ctlfold = () => { ctlFold = !ctlFold; save('hiss.ctlFold', ctlFold ? '1' : ''); ctlKey = ''; };

/** våningen vid världens y (högerklicksmenyn och statusraden) */
const floorAtY = y => Math.max(0, Math.min(TOP, Math.floor(LOBBY + (GROUND_Y - y) / FLOOR_H)));
const queueAt = f => (S.wl && S.wl[f] ? S.wl[f].u.length + S.wl[f].d.length : 0);

// ---------- Dygnets tidslinje: banden i den takt dygnet spelas, markören för nu och dagens incidenter ----------
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
let bandKey = '';
function buildBands() {
  const key = tempoName();
  if (key === bandKey) return;
  bandKey = key;
  $('tlBands').innerHTML = BAND_CUTS.slice(0, -1).map((h0, i) => {
    const h1 = BAND_CUTS[i + 1], n = phaseName(h0 + 0.01), a = dayFrac(h0), b = dayFrac(h1);
    return `<div class="tl-b ${bandCls(n)}" style="left:${(a * 100).toFixed(2)}%;width:${((b - a) * 100).toFixed(2)}%"><span>${n === 'Natt' ? '🌙 ' : n === 'Tidig morgon' ? '☀️ ' : ''}${n}</span></div>`;
  }).join('');
}
// Dagens händelser samlas här när de börjar (gränssnittet ser dem i tillståndet; simuleringen vet inget om listan)
/** @type {{ h: number, icon: string, text: string, act: string }[]} */
let marks = [];
const markSeen = new Set(), was = new Map();
let markDay = -1, marksKey = '';
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
const WARN_ICON = { fire: '👃', power: '💡', storm: '🌥️', heat: '🌡️', cable: '🪢', fault: '🔩' };
function updateTimeline() {
  buildBands();
  scanMarks();
  const now = dayFrac(hour());
  $('tlNow').style.left = `${(now * 100).toFixed(2)}%`;
  const W0 = S.warn;
  const warn = W0 ? `<button class="tl-m warn" style="left:${(now * 100).toFixed(2)}%" data-act="${W0.floor !== undefined && W0.floor !== null ? `show:${W0.floor}` : `follow:${W0.car}`}" data-hint="<b>Förvarning:</b> något är på gång – klicka för att visa var">${WARN_ICON[W0.type] || '⚠️'}</button>` : '';
  const html = marks.map(m => `<button class="tl-m" style="left:${(dayFrac(m.h) * 100).toFixed(2)}%" data-act="${m.act}" data-hint="<b>${esc(m.text)}</b> – klicka för att visa">${m.icon}</button>`).join('') + warn;
  if (html !== marksKey) { marksKey = html; $('tlMarks').innerHTML = html; }
}

// ---------- Högerklick i bilden: åtgärder för personen, hissen eller våningen under pekaren ----------
const ctxEl = $('ctx');
function hideCtx() { ctxEl.hidden = true; }
/** @param {string} title @param {{ label: string, act?: string, off?: boolean, info?: boolean }[]} items */
function showCtx(ev, title, items) {
  ctxEl.innerHTML = `<div class="ctx-t">${title}</div>` + items.map(i => i.info ? `<div class="ctx-i">${i.label}</div>`
    : `<button class="ctx-b" ${i.off ? 'disabled' : `data-act="${i.act}"`}>${i.label}</button>`).join('');
  ctxEl.hidden = false;
  const st = $('stage').getBoundingClientRect();
  const x = Math.min(ev.clientX - st.left, st.width - ctxEl.offsetWidth - 4), y = Math.min(ev.clientY - st.top, st.height - ctxEl.offsetHeight - 4);
  ctxEl.style.transform = `translate(${Math.max(4, Math.round(x))}px, ${Math.max(4, Math.round(y))}px)`;
}
cv.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  if (!S.started) return;
  const { x, y } = toWorld(ev);
  const p = hitPerson(x, y);
  if (p) {
    const [st] = stateInfo(p);
    showCtx(ev, `👤 ${esc(p.name)}`, [
      { label: esc(st), info: true },
      { label: '🔎 Spåra', act: `sel:${p.id}` },
      { label: '📹 Följ med kameran', act: `person:${p.id}` },
    ]);
    return;
  }
  const e = hitCar(x, y);
  if (e) {
    const ok = S.started && e.mode === 'normal';
    showCtx(ev, `🛗 Hiss ${esc(e.name)} <span class="ctx-s">${esc(stateLabel(e))}</span>`, [
      { label: '📋 Visa hissen', act: `pop:${e.id}` },
      { label: VIEW.follow === e.id ? '📹 Sluta följa' : '📹 Följ hissen', act: `follow:${e.id}` },
      { label: '🔧 Framkalla hissfel', act: `trig:fault:${e.id}`, off: !ok },
      { label: '🌡️ Het motor', act: `trig:heat:${e.id}`, off: !ok || e.hot },
      ...(e.facade ? [] : [{ label: '🪢 Linbrott', act: `trig:cable:${e.id}`, off: !ok || !!e.snapNext }]),
      { label: e.off ? '▶ Sätt i drift igen' : '⏸ Ta ur drift', act: `car:x:${e.id}` },
    ]);
    return;
  }
  const door = hitDoor(x, y);
  if (y < ROOF_Y || y > floorY(0)) return;
  const f = door !== null ? door : floorAtY(y);
  const inHall = x >= BX0 && x <= INNER_X1;
  showCtx(ev, `🏢 Våning ${fl(f)} <span class="ctx-s">${esc(FL[f].name)}</span>`, [
    { label: '📹 Visa våningen', act: `show:${f}` },
    { label: '🔥 Brand här', act: `trig:fire:${f}`, off: !FIRE_FLOORS.includes(f) || !!S.fire },
    { label: '👤 Släpp in en besökare här', act: `visit:${f}:${Math.round(inHall ? Math.min(Math.max(x, BX0 + 40), WAIT_X1 - 20) : BX0 + 60)}`, off: !!S.fire },
    ...(f === LOBBY ? [{ label: '👥 BUSS! – en busslast i entrén', act: 'bus', off: !!S.fire }] : []),
  ]);
});
document.addEventListener('pointerdown', ev => { if (!ctxEl.hidden && !ctxEl.contains(/** @type {Node} */ (ev.target))) hideCtx(); });
ctxEl.addEventListener('pointerdown', () => setTimeout(hideCtx, 0)); // (efter att åtgärden har körts)
extraActions.sel = b => { const p = S.people.find(q => q.id === +b && !q.dead); if (p) select(p); };
extraActions.pop = b => openCarPop(S.elevators[+b]);
extraActions.visit = (b, c) => { const v = act('visitor', +b, +c); if (v) select(v); };
extraActions.bus = () => $('btnBus').click();

// ---------- Styrbordet: styrlogik, framkalla och inställningar i ett fönster med flikar ----------
let dlgTab = load('hiss.dlgTab', 'strat');
function applyDlg() {
  document.querySelectorAll('#ctlDlg .dlg-pane').forEach(el => { /** @type {HTMLElement} */ (el).hidden = el.getAttribute('data-pane') !== dlgTab; });
  document.querySelectorAll('#dlgTabs .btn').forEach(el => el.classList.toggle('on', el.getAttribute('data-act') === `dlgtab:${dlgTab}`));
  $('btnCtl').classList.toggle('on', !$('ctlDlg').hidden);
}
export function toggleCtlDlg(show = $('ctlDlg').hidden) { $('ctlDlg').hidden = !show; applyDlg(); }
extraActions.ctl = () => toggleCtlDlg();
extraActions.dlgtab = b => { dlgTab = b; save('hiss.dlgTab', b); applyDlg(); };
applyDlg();

// ---------- Biografläget: bara bilden och en textskylt med vad bevakaren visar ----------
let cinema = false;
export function setCinema(on) {
  cinema = on;
  document.body.classList.toggle('cinema', on);
  if (on) { hideCtx(); toggleCtlDlg(false); if (!VIEW.auto) toggleAuto(); }
  $('btnCinema').classList.toggle('on', on);
  resize();
}
extraActions.cinema = () => setCinema(!cinema);
let lowerKey = '';
function updateLower() {
  const el = $('lower'), c = cinema ? crewNow() : null;
  if (el.hidden === !!c) el.hidden = !c;
  if (!c) return;
  const C = S.chief, say = C && C.on && C.say && S.t < C.say.until ? `🧑‍💼 ${esc(chiefOnDuty().name)}: ${esc(C.say.text)}` : '';
  const html = `<div class="lw-tag">${c.auto ? '● LIVE' : '📹'} · ${esc(c.who.name)}</div><div class="lw-show">${esc(c.show)}</div>`
    + `<div class="lw-sub">${say || `💭 ${esc(c.thought)}`}</div><div class="lw-key">H / Esc = tillbaka</div>`;
  if (html !== lowerKey) { lowerKey = html; el.innerHTML = html; }
}
// H slår av/på biografläget; Esc lämnar det (fångas före input.js, som annars kopplar loss kameran)
window.addEventListener('keydown', ev => {
  if (ev.code === 'KeyH') { setCinema(!cinema); return; }
  if (ev.code !== 'Escape') return;
  if (cinema) { setCinema(false); ev.stopImmediatePropagation(); return; }
  if (!ctxEl.hidden) { hideCtx(); ev.stopImmediatePropagation(); return; }
  if (!$('ctlDlg').hidden) { toggleCtlDlg(false); ev.stopImmediatePropagation(); }
}, true);

// ---------- Statusraden: förklaringar (data-hint) och vad som finns under pekaren i bilden ----------
const statusEl = $('statusTxt');
let hintText = '', hoverText = '';
const DEFAULT_STATUS = 'Peka på något för en förklaring · klicka på en person, hiss eller korridor · högerklicka för åtgärder';
function paintStatus() { const t = hintText || hoverText || DEFAULT_STATUS; if (statusEl.innerHTML !== t) statusEl.innerHTML = t; }
/** text från kartan/bilden (hover = true) eller en förklaring */
function status(t, hover = false) { if (hover) hoverText = t; else hintText = t; paintStatus(); }
document.addEventListener('pointerover', ev => {
  const t = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-hint]'));
  status(t ? t.dataset.hint : '');
});
cv.addEventListener('mousemove', ev => {
  if (!S.started) return;
  const { x, y } = toWorld(ev);
  const p = hitPerson(x, y);
  if (p) { status(`<b>${esc(p.name)}</b> · ${esc(stateInfo(p)[0].toLowerCase())} – klicka för att spåra, högerklicka för mer`, true); return; }
  const e = hitCar(x, y);
  if (e) { status(`<b>Hiss ${esc(e.name)}</b> · ${esc(stateLabel(e))} · ${e.passengers.length} pers – klicka för detaljer, högerklicka för åtgärder`, true); return; }
  if (y >= ROOF_Y && y <= floorY(0)) { const f = floorAtY(y); status(`<b>Våning ${fl(f)}</b> · ${esc(FL[f].name)} · ${queueAt(f)} väntar – högerklicka för åtgärder`, true); return; }
  status('', true);
});
cv.addEventListener('mouseleave', () => status('', true));
paintStatus();

/** Panelerna uppdateras med HUD:en (några gånger i sekunden). */
export function updatePanels() {
  updateCtl();
  updateTimeline();
  updateLower();
}
