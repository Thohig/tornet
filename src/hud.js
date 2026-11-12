// HUD: topplist, hisspopup, flytande incidentruta och lådan med spårning, register, logg och resultat.
import { ARR, esc, fl } from './util.js';
import { CAP, CAR_H, EL, FIRE_HINT, FL, LOBBY, TOP, ROLE_NAMES, activityRate, FULL_LOAD, floorY, shaftX, timeScale } from './config.js';
import { S, hour, log, phaseName } from './state.js';
import { liftsAvailable } from './people.js';
import { costBased, costLine, eta, isFull, pickTotal, pickersAt, loadKg, cabinKg, slotsFull } from './dispatch.js';
import { canRescue } from './incidents.js';
import { plannedRoute, resetDay } from './sim.js';
import { VIEW, camTarget, cv, nightness, pctx, resize, stage } from './view.js';
import { personSprite } from './pixpeople.js';
import { PAL } from './pixpal.js';
import { stateInfo } from './describe.js';
export { stateInfo };
import { residentDesc } from './life.js';
import { STORM_HINT, windMs } from './weather.js';
import { FAN_KW, jobFloor, tech } from './service.js';
import { updatePauseBtn } from './input.js';
import { SIM_VERSION } from './replay.js';

// ---------- HUD: DOM ----------
export function $(id) { return document.getElementById(id); }
// Hisspopupen: öppnas när man klickar på en hiss och visar allt som förr stod på hisskorten.
let carEl = null;
export function buildHud() {
  const el = $('carPop');
  el.innerHTML = `<div class="car-head"><span class="nm"></span><span class="st"></span><span class="fl"></span><button class="tk-x" data-act="carpop:close" title="Stäng (Esc)">✕</button></div>
    <div class="zone"></div><div class="load"><i></i><span></span></div><div class="plan"></div><div class="why"></div><div class="svc" hidden></div>
    <div class="who"></div><div class="acts"></div><div class="meta"></div>`;
  carEl = {
    nm: el.querySelector('.nm'), st: el.querySelector('.st'), fl: el.querySelector('.fl'), zone: el.querySelector('.zone'),
    bar: el.querySelector('.load i'), ld: el.querySelector('.load span'), plan: el.querySelector('.plan'), why: el.querySelector('.why'), svc: /** @type {HTMLElement} */ (el.querySelector('.svc')),
    who: el.querySelector('.who'), acts: el.querySelector('.acts'), meta: el.querySelector('.meta'), whoKey: '', actKey: '', id: -1,
  };
}
export function openCarPop(e) {
  VIEW.carPop = e ? e.id : null;
  $('carPop').hidden = !e;
  if (e) { updateCarPop(); placeCarPop(); }
}
function updateCarPop() {
  if (VIEW.carPop === null) return;
  const e = S.elevators[VIEW.carPop], c = carEl;
  if (c.id !== e.id) { c.id = e.id; c.whoKey = ''; c.actKey = ''; $('carPop').style.setProperty('--c', e.color); $('carPop').style.setProperty('--ct', PAL.on(e.color)); c.nm.textContent = e.name; c.zone.textContent = zoneText(EL[e.id]); }
  c.st.textContent = stateLabel(e);
  c.fl.textContent = fl(Math.round(e.pos));
  const n = e.passengers.length, kg = cabinKg(e), pct = kg / e.ratedKg;
  c.bar.style.width = Math.min(100, pct * 100) + '%';
  c.bar.parentElement.classList.toggle('heavy', pct >= FULL_LOAD);
  c.ld.textContent = `${Math.round(kg)} kg (${Math.round(pct * 100)} %) · ${n}/${CAP} · hämtar ${pickTotal(e)}`;
  const route = plannedRoute(e);
  c.plan.textContent = 'Plan: ' + (route.length ? route.map(fl).join(' → ') : '—');
  c.why.textContent = whyText(e);
  const svc = serviceStatus(e);
  c.svc.hidden = !svc; if (svc) c.svc.textContent = svc;
  const key = e.passengers.map(p => p.id).join(',');
  if (key !== c.whoKey) {
    c.whoKey = key;
    c.who.innerHTML = n ? 'Ombord: ' + e.passengers.map(p => `<span data-pid="${p.id}">${esc(p.name)}</span>→${fl(p.dest)}${p.goal !== p.dest && !p.viaStairs ? `↹${fl(p.goal)}` : ''}`).join(', ') : 'Ombord: –';
  }
  const acts = carActs(e);
  if (acts !== c.actKey) { c.actKey = acts; c.acts.innerHTML = acts; }
  const kw = e.kw > 0.05 ? `⚡ drar ${e.kw.toFixed(0)} kW` : e.kw < -0.05 ? `♻ återmatar ${(-e.kw).toFixed(0)} kW` : e.state === 'moving' ? '⚡ 0 kW' : '⚡ vila';
  c.meta.textContent = `${Math.round(e.distance)} vån · ${e.trips} stopp · slitage ${Math.round(e.wear * 100)} % · 🌡️ motor ${motorC(e)} °C${e.fan ? ' 🌀' : ''} · ${kw} · ${e.kwh.toFixed(1)} kWh i dag`;
}
/** Placerar popupen bredvid hissen (anropas varje bildruta så att den följer med korgen) */
export function placeCarPop() {
  if (VIEW.carPop === null) return;
  const el = $('carPop'), e = S.elevators[VIEW.carPop];
  const sw = stage.clientWidth, sh = stage.clientHeight, pw = el.offsetWidth, ph = el.offsetHeight;
  const left = cv.offsetLeft + (shaftX(e.id) - VIEW.x0) * VIEW.scale, right = left + (CAR_H + 20) * VIEW.scale;
  let x = left - pw - 12 >= 4 ? left - pw - 12 : right + 8;
  let y = cv.offsetTop + (floorY(e.pos) - CAR_H - VIEW.camY) * VIEW.scale;
  x = Math.max(4, Math.min(sw - pw - 4, x)); y = Math.max(4, Math.min(sh - ph - 4, y));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
/** Kort beskrivning av hissens zon, t.ex. "P2–6 · låg zon" eller "E⇄6 express" */
/** motorns temperatur i °C (värmen 0–1 där 1 = överhettningsskyddet löser ut vid 100 °C) */
export const motorC = e => Math.round(35 + e.heat * 65);
export function zoneText(d) {
  if (d.deck2) return `${fl(d.minF)} ⇄ ${fl(d.maxF)} nedre · ${fl(d.upper[0])} ⇄ ${fl(d.upper[d.upper.length - 1])} övre · dubbeldäck`;
  if (d.express) return `${fl(d.minF)} ⇄ ${fl(d.maxF)} · express`;
  if (d.facade) return `${d.serves.map(fl).join(' · ')} · panorama i glas`;
  if (d.freight) return `${fl(d.minF)}–${fl(d.maxF)} · varuhiss ${d.ratedKg} kg`;
  return `${fl(d.minF)}–${fl(d.maxF)} · ${d.group} zon`;
}
export function stateLabel(e) {
  if (e.mode === 'broken') return 'TRASIG 🔧';
  if (e.mode === 'service') return 'SERVICE 🔧';
  if (e.hold) return 'TILL SERVICE';
  if (e.hot) return 'ÖVERHETTAD 🌡️';
  if (e.windLock) return 'STÄNGD – STORM 🌬️';
  if (e.indep) return 'OBEROENDE DRIFT 🔑';
  if (e.zoneLock) return 'SPÄRRAD 🚧';
  if (e.sleep) return 'NATTLÄGE 🌙';
  if (e.mode === 'recall') return 'BRANDÅTERKALLAD';
  if (e.mode === 'locked') return 'AVSTÄNGD';
  if (e.mode === 'rescue') return 'NÖDSÄNKS';
  if (e.mode === 'dead') return 'UTRYMD';
  if (!S.power) return 'STRÖMLÖS';
  if (e.off && e.state !== 'moving' && !e.passengers.length) return 'UR DRIFT';
  if (e.state === 'doors') return { opening: 'ÖPPNAR', open: 'LASTAR', closing: 'STÄNGER' }[e.doorPhase];
  if (e.state === 'moving') return e.targetKind === 'park' ? `PARKERAR ${ARR(e.dir)}` : `ÅKER ${ARR(e.dir)}`;
  return 'VILAR';
}
export const nameList = list => (list.length > 2 ? `${list.length} st` : list.map(p => p.name).join(' & '));
export function reasonAt(e, f, d) {
  const r = [];
  const off = e.passengers.filter(p => p.dest === f);
  if (off.length) r.push(`${nameList(off)} ska av`);
  const up = pickersAt(e, f, d), back = pickersAt(e, f, -d);
  if (up.length) r.push(`hämtar ${nameList(up)} ${ARR(d)}`);
  else if (back.length) r.push(`vänder & hämtar ${nameList(back)} ${ARR(-d)}`);
  return r.join(' + ') || '—';
}
export function whyText(e) {
  if (e.zoneLock) return `Når ingen våning utanför brandzonen – står spärrad på ${fl(e.minF)} tills branden är släckt`;
  if (e.mode === 'broken') {
    const t = S.people.find(p => p.role === 'hisstekniker' && p.job === e.id);
    return `Trasig på ${fl(e.floor)}: ${e.fault.what} · ${t ? (t.state === 'office' && t.floor === e.floor ? `${t.name} lagar den (${Math.round(100 * Math.min(1, t.workT / e.fault.need))} %)` : `${t.name} är på väg`) : 'väntar på hisstekniker'}`;
  }
  const svcName = e.serviceAsap ? 'Beställd service' : 'Nattservice';
  if (e.mode === 'service') return `${svcName} på ${fl(e.home)} – slitaget nollställs`;
  if (e.hold) return `Ska på ${svcName.toLowerCase()} – tar inga nya resenärer och kör hem till ${fl(e.home)}`;
  if (e.sleep) return `Sover på ${fl(Math.round(e.pos))} för att spara energi – vaknar om det bildas kö`;
  if (e.hot) return `Motorn är överhettad (${motorC(e)} °C) – kör klart sina passagerare men tar inga nya tills den har svalnat${e.fan ? ' · extrafläkten går' : ''}`;
  if (e.windLock) return `Stängd för stormen – parkerar på ${fl(e.home)} tills det mojnar`;
  if (e.indep && !e.passengers.length) return 'Oberoende drift (flyttdag): nyckelstyrd, svarar inte på anrop – bara flyttgubbarna åker';
  if (e.mode === 'recall') return `Brandåterkallning: kör direkt till ${fl(e.home)} utan stopp och släpper ut alla`;
  if (e.mode === 'locked') return `Avstängd i ${fl(e.home)} med öppna dörrar tills branden är släckt`;
  if (e.mode === 'rescue') return `Krypkör på reservkraft till ${fl(e.rescueTarget)} för att släppa ut ${e.passengers.length} instängda`;
  if (e.mode === 'dead') return 'Utrymd – väntar på att strömmen ska komma tillbaka';
  if (!S.power) return e.passengers.length ? `Står still ${Math.abs(e.pos - Math.round(e.pos)) > 0.05 ? 'mellan våningar' : `på ${fl(Math.round(e.pos))}`} – ${e.passengers.length} instängda!` : 'Står still utan ström';
  if (e.state === 'doors') {
    const parts = [];
    if (e.lastOff) parts.push(`${e.lastOff} av`);
    if (e.lastOn) parts.push(`${e.lastOn} på`);
    let s = `Vån ${fl(e.floor)}: ${parts.join(', ') || 'ingen av/på än'}`;
    s += e.dir ? ` · kör ${ARR(e.dir)} härnäst` : ' · ingen riktning – första passageraren bestämmer';
    if (isFull(e)) s += slotsFull(e) ? ' · FULLT!' : ` · FULL LAST (${Math.round(cabinKg(e) / e.ratedKg * 100)} %)`;
    return s;
  }
  if (e.state === 'moving' && e.target !== null) {
    if (e.targetKind === 'halt') return `Inga mål ${ARR(e.dir)} längre – bromsar vid ${fl(e.target)}`;
    if (isFull(e) && pickTotal(e)) return `FULL LAST ${Math.round(loadKg(e) / e.ratedKg * 100)} % – passerar hämtningar, stannar bara för avstigning (${fl(e.target)})`;
    if (e.targetKind === 'park') return `Ledig – kör till parkering ${fl(e.target)}`;
    return `Nästa stopp ${fl(e.target)}: ${reasonAt(e, e.target, e.dir)}`;
  }
  if (e.off) return 'Ur drift – tar inga nya resenärer';
  return `Ledig vid ${fl(Math.round(e.pos))} – väntar på uppdrag`;
}
/** grov uppskattning av en resa genom huset (gång, väntan och åktur) i sekunder */
const tripGuess = (from, to) => (from === to ? 4 : 12 + Math.abs(to - from) * 2.5);
const secs = s => `${Math.max(1, Math.round(s))} s`;
/** Teknikerns tidplan för hissen e (beställd service, nattservice eller hissfel) – null om ingen är på gång.
 *  Bara en uppskattning för gränssnittet: simuleringen slumpar arbetstiden först när arbetet börjar. */
export function serviceStatus(e) {
  const broken = e.mode === 'broken';
  if (!broken && !e.serviceAsap && !e.hold && e.mode !== 'service') return null;
  const t = tech(), mine = !!t && t.job === e.id, f = jobFloor(e);
  // arbetstid: känd när den har börjat, annars mitt i intervallet (0,3–0,5 h speltid)
  const work = broken ? e.fault.need : e.mode === 'service' ? e.serviceNeed : 0.4 * 3600 / timeScale(hour());
  const verb = broken ? 'lagar' : 'servar';
  if (mine && t.state === 'office' && t.floor === f) {
    if (e.mode === 'normal') return `🔧 ${t.name} väntar på ${fl(f)} tills hissen har kört hem tom · arbetet tar ~${secs(work)}`;
    return `🔧 ${t.name} ${verb} (${Math.round(100 * Math.min(1, t.workT / work))} %) · klar om ${secs(work - t.workT)}`;
  }
  let arrive, who;
  if (mine) { arrive = tripGuess(t.floor, f); who = `${t.name} är på väg till ${fl(f)}`; }
  else if (t) return `🔧 Teknikern ${t.name} är upptagen${t.job !== null && t.job !== undefined ? ` med ${S.elevators[t.job].name}` : ''} – ${e.name} står i kö`;
  else if (S.techCallAt !== null) { arrive = Math.max(0, S.techCallAt - S.t) + tripGuess(LOBBY, f); who = 'Teknikern är larmad'; }
  else return `🔧 Väntar på hissteknikern${!S.power ? ' (strömavbrott)' : S.fire ? ' (brand)' : ''}`;
  return `🔧 ${who} · framme om ~${secs(arrive)} · klar om ~${secs(arrive + work)}`;
}
export function carActs(e) {
  const b = [];
  b.push(`<button class="btn xs${VIEW.follow === e.id ? ' on' : ''}" data-act="follow:${e.id}">📹 ${VIEW.follow === e.id ? 'Följer' : 'Följ hissen'}</button>`);
  b.push(`<button class="btn xs" data-act="car:off:${e.id}">${e.off ? 'Sätt i drift' : 'Ta ur drift'}</button>`);
  if (e.mode === 'normal' && !e.serviceAsap && !e.hold && S.started) b.push(`<button class="btn xs" data-act="level:${e.id}" title="Hissteknikern kommer direkt, även på dagen">🔧 Beställ service</button>`);
  if (!S.power && e.mode === 'normal' && e.passengers.length && !(e.state === 'doors' && e.door >= 0.95))
    b.push(`<button class="btn xs hot2" data-act="pow:rescue:${e.id}" ${canRescue(e) ? '' : 'disabled'}>🔋 Nödsänk (${e.passengers.length})</button>`);
  return b.join('');
}
// ---------- Kamerareglaget i topplisten: 📹-knappen visar vad kameran följer och kopplar loss/på (som F),
// en knapp per hiss följer hissen (klick igen kopplar loss) ----------
let camKey = '';
function camName(t, short = false) {
  if (t.kind === 'car') return short ? esc(S.elevators[t.id].name) : `hiss ${esc(S.elevators[t.id].name)}`;
  if (t.kind === 'floor') return short ? `vån ${fl(t.id)}` : `våning ${fl(t.id)}`;
  const p = S.people.find(q => q.id === t.id);
  return p ? esc(short ? p.name.split(' ')[0] : p.name) : null;
}
function updateCamBar() {
  const el = $('camBar'), t = camTarget(), last = VIEW.lastCam, lastName = !t && last ? camName(last) : null;
  const cars = S.elevators.map(e => `<button class="btn xs car-b${VIEW.follow === e.id ? ' on' : ''}" data-act="follow:${e.id}" style="--c:${e.color};--ct:${PAL.on(e.color)}" title="${VIEW.follow === e.id ? 'Sluta följa' : 'Följ'} hiss ${esc(e.name)}">${esc(e.name)}</button>`).join('');
  const cam = t
    ? `<button class="btn cam-b on" data-act="cam:off" title="Kameran följer ${camName(t)} – klicka för att koppla loss (F)">📹 <span>${camName(t, true)}</span></button>`
    : lastName ? `<button class="btn cam-b" data-act="cam:on" title="Fri kamera – klicka för att följa ${lastName} igen (F)">📹 <span>fri</span></button>`
    : '<button class="btn cam-b" disabled title="Fri kamera – välj en hiss, en person eller en våning att följa">📹 <span>fri</span></button>';
  const html = !S.started ? '' : `${cam}<div class="cam-cars">${cars}</div>`;
  if (html === camKey) return;
  camKey = html; el.innerHTML = html; el.hidden = !html;
}
export function updateHud() {
  updateCamBar();
  const h = hour();
  // ingen klocka – bara sol på dagen och måne på natten (samma gräns som himlen i bilden)
  const night = nightness(h) > 0.5;
  setText('clock', night ? '🌙' : '☀️');
  $('clock').title = night ? 'Natt' : 'Dag';
  const wx = `${S.weather.cold > 0 ? '❄️' : S.weather.temp >= 20 ? '🌤️' : ''} ${S.weather.temp} °C${S.storm ? ' · 🌬️ storm' : ''}`;
  setText('phase', `${phaseName(h)} · ${wx.trim()}`);
  $('day').textContent = `Dag ${S.day} · ${S.people.length} pers · frö ${S.seed}`;
  updateCarPop();
  if (S.logDirty && isOpen('log')) {
    S.logDirty = false;
    const f = S.logFilter, sid = S.sel ? S.sel.id : -1;
    const rows = S.log.filter(l => f === 'all' || (f === 'person' ? l.kind === 'person' : f === 'button' ? l.kind === 'button' : f === 'lift' ? l.kind !== 'person' && l.kind !== 'button' : l.pid === sid)).slice(0, 80);
    $('log').innerHTML = rows.map(l =>
      `<div class="le k-${l.kind}${l.pid != null && l.pid === sid ? ' sel' : ''}"${l.pid != null ? ` data-pid="${l.pid}"` : ''}><span class="lt">${l.time}</span>${l.color ? `<span class="ld" style="background:${l.color}"></span>` : ''}<span>${esc(l.text)}</span></div>`).join('')
      || '<div class="le">–</div>';
  }
  const st = S.stats;
  const avg = st.waitN ? st.waitSum / st.waitN : 0;
  const ride = st.rideN ? st.rideSum / st.rideN : 0;
  const waitingNow = S.wl ? S.wl.reduce((a, w) => a + w.u.length + w.d.length, 0) : 0;
  const g = grade(avg), sg = safetyGrade();
  setText('tbStats', `${st.waitN ? g.letter : '–'} · ${st.served} resor · ${waitingNow} väntar · snitt ${avg.toFixed(0)} s`);
  setText('sum-roster', `· ${S.people.length} i huset`);
  if (isOpen('stats')) $('stats').innerHTML = `
    <div class="stat">Resor klara <b>${st.served}</b></div>
    <div class="stat">Väntar nu <b>${waitingNow}</b></div>
    <div class="stat">Snittväntan <b>${avg.toFixed(1)}s</b></div>
    <div class="stat">Längsta väntan <b>${Math.round(st.waitMax)}s</b></div>
    <div class="stat">Snitt åktid <b>${ride.toFixed(1)}s</b></div>
    <div class="stat">Arga resenärer <b>${st.angry}</b></div>
    <div class="stat">Överlaster <b>${st.overloads}</b></div>
    <div class="stat">Rökexponerade <b>${st.smoked}</b></div>
    <div class="stat">Instängd-sek <b>${Math.round(st.trappedSec)}</b></div>
    <div class="stat">Trapp-resor <b>${st.stairs}</b></div>
    <div class="stat">…varav frivilliga 🚶 <b>${st.stairsChoice}</b></div>
    <div class="stat">★ Gunnar gnällde <b>${st.gripes}</b></div>
    <div class="stat">★ Kurts kaffekoppar ☕ <b>${st.cups}</b></div>
    <div class="stat">Höll upp dörren (★ Doris m.fl.) <b>${st.holds}</b></div>
    <div class="stat">Avstod – kändes för trångt <b>${st.crowdSkips}</b></div>
    <div class="stat">Tryckte på STÄNG <b>${st.closePresses}</b></div>
    <div class="stat">★ Majken pratade 💬 <b>${st.chats}</b></div>
    <div class="stat">Hissfel 🔧 <b>${st.faults}</b></div>
    <div class="stat">Lagade / servade <b>${st.repairs} / ${st.serviced}</b></div>
    <div class="stat">Stillestånd <b>${Math.round(st.downSec)} s</b></div>
    <div class="stat">Överhettade motorer 🌡️ <b>${st.heatStops}</b></div>
    <div class="stat">Vajerlarm i storm 🌬️ <b>${st.stormFaults}</b></div>
    <div class="stat">Nivåjusteringar <b>${st.relevels}</b></div>
    <div class="stat">Snubblade på tröskeln 🦶 <b>${st.stumbles}</b></div>
    <div class="stat">Dörren tog emot i kylan ❄️ <b>${st.doorFights}</b></div>
    <div class="stat">Ambulans 🚑 <b>${st.medical}</b></div>
    <div class="stat">Flyttlass 🚚 <b>${st.moveLoads}</b></div>
    <div class="stat">Övre däcket / rulltrappan <b>${st.upperDeck} / ${st.escalator}</b></div>
    <div class="stat">Inlärda parkeringar 🧠 <b>${st.learnedParks}</b></div>
    <div class="stat">Energi ⚡ <b>${st.energy.toFixed(1)} kWh</b></div>
    <div class="stat">…varav körning <b>${st.energyRun.toFixed(1)} kWh</b></div>
    <div class="stat">Återmatat ♻ <b>${st.regen.toFixed(1)} kWh</b></div>
    <div class="stat">Hissbyten <b>${st.transfers}</b></div>
    <div class="stat">Bilar in i garaget <b>${st.carsIn}</b></div>
    <div class="stat">Tunnelbanan 🚇 <b>${st.trainIn} av · ${st.trainOut} på</b></div>
    <div class="stat">Paketleveranser <b>${st.deliveries}</b></div>
    <div class="stat">VIP-besök 🚁 <b>${st.vips}</b></div>
    <div class="stat">Felknappar 🙈 <b>${st.wrongPress}</b></div>
    <div class="stat">Barn på alla knappar <b>${st.kidPresses}</b></div>
    <div class="stat">Spökstopp 👻 <b>${st.ghostStops}</b></div>
    <div class="stat">Bus rensat (antinuisance) <b>${st.nuisance}</b></div>
    ${learnMap()}
    <div class="grade">Service: ${st.waitN ? g.letter : '–'} <span class="stars">${st.waitN ? '★'.repeat(g.stars) + '☆'.repeat(5 - g.stars) : ''}</span> · Säkerhet: ${sg}</div>`;
  updateIncidents();
}
/** värmekartan över det styrningen har lärt sig: köer per våning (rader) och timme (kolumner) */
function learnMap() {
  const m = S.learnMem;
  if (!m) return `<div class="learn"><div class="learn-h">🧠 Inlärd trafik</div><div class="learn-e">Styrningen lär sig var det brukar bli kö – kartan fylls i från dag 2.</div></div>`;
  const max = Math.max(1, ...m.flat()), hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], b = hour() - 6;
  const rows = [];
  for (let f = TOP; f >= 0; f--) {
    const cells = hours.map(hh => { const v = m[hh - 6][f] / max; return `<i style="opacity:${(0.06 + v * 0.94).toFixed(2)}"${Math.floor(b) === hh - 6 ? ' class="now"' : ''}></i>`; }).join('');
    rows.push(`<div class="lr"><span>${fl(f)}</span>${cells}</div>`);
  }
  return `<div class="learn"><div class="learn-h">🧠 Inlärd trafik (kö per våning och timme, 07–19)</div>${rows.join('')}</div>`;
}
export function incidentHtml() {
  const parts = [];
  // ---------- stormen (incident med val, som branden) ----------
  if (S.storm) {
    const St = S.storm, P = S.elevators.find(e => e.facade);
    const b = (m, txt) => `<button class="btn sm${St.mode === m ? ' on' : ''}" data-act="storm:${m}">${txt}</button>`;
    parts.push(`<div class="inc storm"><div class="inc-h">🌬️ Storm – <span class="lv">${windMs()}</span> m/s</div>
      <div class="inc-s">De höga schakten och panoramahissen på fasaden svajar. Bedarrar om ~${cd(St.t0 + St.len - S.t)}s.${St.faults ? ` Vajerlarm: <b>${num(St.faults)}</b>` : ''}</div>
      <div class="inc-q">Hur ska hissarna köras?</div>
      <div class="inc-acts">${b('sway', '🌬️ Svajläge')}${b('none', 'Kör som vanligt')}</div>
      <div class="inc-hint">${STORM_HINT[St.mode]}</div>
      ${P ? `<div class="inc-acts"><button class="btn xs" data-act="follow:${P.id}">📹 Visa panoramahissen</button></div>` : ''}</div>`);
  }
  // ---------- överhettade motorer (incident: extrafläkt) ----------
  for (const e of S.elevators) {
    if (!e.hot) continue;
    parts.push(`<div class="inc heat"><div class="inc-h">🌡️ Motorn i hiss ${esc(e.name)} är överhettad</div>
      <div class="inc-s">Överhettningsskyddet har löst ut (<span class="lv">${motorC(e)}</span> °C): ${esc(e.name)} kör klart sina passagerare men tar inga nya förrän motorn har svalnat.</div>
      <div class="inc-acts"><button class="btn sm${e.fan ? ' on' : ''}" data-act="fan:${e.id}" ${e.fan ? 'disabled' : ''}>🌀 ${e.fan ? 'Extrafläkten går' : 'Starta extrafläkt'}</button><button class="btn xs" data-act="follow:${e.id}">📹 Visa hissen</button></div>
      <div class="inc-hint">Fläkten kyler ungefär fyra gånger snabbare men drar ${FAN_KW} kW. Smart och Energisnål undviker varma motorer, Rusning tar risken längre, och Närmast, Kaos och Knappar bryr sig inte alls.</div></div>`);
  }
  // ---------- händelser som spelaren bara informeras om ----------
  const V = S.elevators.find(e => e.freight);
  const info = (key, cls, title, body, acts) => {
    if (S.dismissed.has(key)) return;
    parts.push(`<div class="inc info ${cls}"><div class="inc-h">${title}<button class="inc-x" data-act="dismiss:${key}" title="Stäng">✕</button></div>
      <div class="inc-s">${body}</div>${acts ? `<div class="inc-acts">${acts}</div>` : ''}</div>`);
  };
  // replay-länkens kontroll: avviker uppspelningen, eller är länken från en annan version?
  const R = S.replay ? S.replayCheck : null;
  if (R) {
    const other = R.sv !== null && R.sv !== SIM_VERSION;
    const ver = other ? `Länken gjordes med simuleringsversion ${R.sv}, den här är version ${SIM_VERSION}.` : '';
    if (R.drift !== null) {
      info(`drift-${S.day}`, 'drift', '⚠️ Replayen avviker',
        `Uppspelningen stämmer inte längre med inspelningen (efter ${Math.round(R.drift)} s). `
        + (other ? ver : 'Länken gjordes med samma version – troligen räknar den här webbläsaren en aning annorlunda än den som spelade in.')
        + ' Resten av dygnet kan bli annorlunda än när det spelades in.');
    } else if (other) info(`oldver-${S.day}`, 'drift', '🔁 Replay från en annan version', `${ver} Dygnet kan bli annorlunda än när det spelades in – det märks i så fall här.`);
    else if (!R.checks) info(`nocheck-${S.day}`, 'drift', '🔁 Äldre replay-länk', 'Länken saknar kontrollsummor, så det går inte att se om uppspelningen blir exakt samma dygn.');
  }
  const M = S.move;
  if (M && (M.state === 'on' || (M.state === 'done' && S.t - M.t1 < 20))) {
    info(`move-${S.day}`, 'move', `🚚 Flyttdag på ${fl(M.floor)}`,
      M.state === 'on'
        ? `Flyttfirman Lyft & Bär bär ut från ${fl(M.floor)} – lass <b>${num(M.done)}</b> av ${M.loads}. Varuhissen ${V ? esc(V.name) : ''} går i <b>oberoende drift</b>: nyckelstyrd, svarar inte på några anrop, bara flyttgubbarna åker med. ${M.smart ? 'Flytten är bokad efter lunch, när förmiddagens leveranser är klara – paketbuden hade varuhissen för sig själva.' : 'Flytten bokades på förmiddagen, mitt i leveranserna – paketbuden får vänta på varuhissen.'}`
        + (S.power ? '' : ' Strömavbrott: flyttgubbarna väntar ut det med möblerna vid hissen – den som har tomma händer tar trapporna.')
        : `Flytten är klar (${M.done} lass) – varuhissen går i vanlig trafik igen.`,
      `${V ? `<button class="btn xs" data-act="follow:${V.id}">📹 Följ varuhissen</button>` : ''}<button class="btn xs" data-act="show:${M.floor}">Visa våningen</button>`);
  }
  const A = S.medic;
  if (A && (A.state !== 'done' || S.t - A.t1 < 20)) {
    // strömavbrott: hissarna står still, så personalen bär båren i trapporna (eller sitter fast och räddas först)
    const dark = !S.power && (A.state === 'onway' || A.state === 'transport');
    const stuck = S.people.some(p => p.medic && p.state === 'ride');
    const what = { called: `${esc(A.pname)} har svimmat på ${esc(A.where)} (${fl(A.floor)}). Ambulansen är på väg.`,
      onway: dark ? 'Ambulanspersonalen är i huset med bår.' : 'Ambulanspersonalen är i huset med bår. Båren får bara plats i varuhissen, som går med förtur – VIP-läge för ambulansen.',
      transport: `${esc(A.pname)} bärs ut på båren till ambulansen.`,
      done: `Ambulansen har kört${A.taken ? ` med ${esc(A.pname)}` : ''} – ${Math.round(A.t1 - A.t0)} s från larm till avfärd.` }[A.state];
    const how = dark
      ? (stuck ? ' Strömavbrott: personalen sitter fast i hissen – reservkraftens auto-räddning tar den hissen först.' : ' Strömavbrott: hissarna står still, så personalen bär båren i trapporna.')
      : A.state === 'onway' || A.state === 'transport'
      ? (S.strategy === 'smart' || S.strategy === 'peak' || S.strategy === 'eco' ? ' Kostnadsstyrningen låter dem i varuhissen som ändå ska åt samma håll åka klart.' : ' Alla andra i varuhissen får kliva av vid nästa stopp.') : '';
    // ambulansen i huset = den som bär båren (annars den andra sjukvårdaren)
    const crew = S.people.filter(p => p.medic && !p.dead);
    const amb = crew.find(p => p.cargo && p.cargo.kind.startsWith('bår')) || crew[0];
    const on = amb && VIEW.camSel && S.sel === amb;
    info(`medic-${Math.round(A.t0)}`, 'medic', '🚑 Ambulans', what + how,
      (amb ? `<button class="btn xs${on ? ' on' : ''}" data-act="person:${amb.id}" title="${on ? 'Sluta följa' : 'Följ'} ${esc(amb.name)} med båren">📹 ${on ? 'Följer ambulansen' : 'Följ ambulansen'}</button>` : '')
      + `<button class="btn xs" data-act="show:${A.floor}">Visa våningen</button>${V ? `<button class="btn xs" data-act="follow:${V.id}">📹 Följ varuhissen</button>` : ''}`);
  }
  for (const n of S.notices) {
    if (S.t - n.t0 > 30) continue;
    const svcCar = n.act && n.act.startsWith('level:') ? S.elevators[+n.act.split(':')[1]] : null;
    const svc = svcCar ? serviceStatus(svcCar) : null;
    const acts = (n.car !== null ? `<button class="btn xs" data-act="follow:${n.car}">📹 Visa hissen</button>` : n.floor !== null ? `<button class="btn xs" data-act="show:${n.floor}">Visa våningen</button>` : '')
      + (n.act && !svc ? `<button class="btn xs" data-act="${n.act}">${n.actLabel}</button>` : '');
    info(`n${n.id}`, n.kind, esc(n.title), esc(n.text) + (svc ? `<div class="svc">${esc(svc)}</div>` : ''), acts);
  }
  if (S.fire) {
    const F = S.fire, zmax = Math.max(0, F.floor - 2);
    const status = F.brigade ? `Brandkåren släcker – klart om ${cd(F.outAt - S.t)}s` : `Brandkåren är på väg – framme om ${cd(F.brigadeAt - S.t)}s`;
    const b = (m, txt) => `<button class="btn sm${F.mode === m ? ' on' : ''}" data-act="fire:${m}">${txt}</button>`;
    parts.push(`<div class="inc fire"><div class="inc-h">🔥 Brand på våning ${fl(F.floor)}</div>
      <div class="inc-s">${status}. Våning ${fl(F.floor - 1)}–${fl(TOP)} utryms.</div>
      <div class="inc-s">Rökexponerade: <b>${num(F.smoked)}</b> · Utrymda: <b>${num(F.evac)}</b></div>
      <div class="inc-q">Hur ska hissarna köras?</div>
      <div class="inc-acts">${b('recall', '🚒 Brandåterkallning')}${b('zone', `🚧 Bara E–${fl(zmax)}`)}${b('none', 'Normal drift')}</div>
      <div class="inc-hint">${FIRE_HINT[F.mode]}</div>
      <div class="inc-acts"><button class="btn xs" data-act="show:${F.floor}">Visa våningen</button></div></div>`);
  }
  if (!S.power && S.outage) {
    const O = S.outage;
    const trapped = S.elevators.filter(e => e.mode === 'normal').reduce((a, e) => a + e.passengers.length, 0);
    const gen = O.gen ? `<button class="btn sm on" disabled>🔋 Reservkraft igång</button>`
      : O.genAt !== null ? `<button class="btn sm" disabled>🔋 Startar… ${cd(O.genAt - S.t)}s</button>`
        : `<button class="btn sm" data-act="pow:gen">🔋 Starta reservkraft</button>`;
    const busy = O.busy !== null ? `Nödsänker hiss ${EL[O.busy].name} just nu…` : O.gen ? 'Välj vilken hiss som ska nödsänkas nedan – eller slå på auto.' : '';
    parts.push(`<div class="inc power"><div class="inc-h">⚡ Strömavbrott</div>
      <div class="inc-s">Strömmen tillbaka om ~${cd(O.backAt - S.t)}s · Instängda nu: <b>${num(trapped)}</b> · Instängd-sek idag: <b>${num(S.stats.trappedSec)}</b></div>
      <div class="inc-q">Vad gör du?</div>
      <div class="inc-acts">${gen}<button class="btn sm${O.auto ? ' on' : ''}" data-act="pow:auto" ${O.gen ? '' : 'disabled'}>Auto-räddning: ${O.auto ? 'PÅ' : 'AV'}</button></div>
      <div class="inc-acts">${S.elevators.filter(e => e.mode === 'normal' && e.passengers.length && !(e.state === 'doors' && e.door >= 0.95)).map(e =>
        `<button class="btn xs hot2" data-act="pow:rescue:${e.id}" ${canRescue(e) ? '' : 'disabled'}>Nödsänk ${e.name} (${e.passengers.length} inne)</button>`).join('')}</div>
      <div class="inc-hint">${busy || 'Utan åtgärd sitter folk fast tills strömmen kommer tillbaka. Reservkraften räcker till EN hiss i taget – välj ordning, t.ex. fullaste först.'}</div></div>`);
  }
  return parts.join('');
}
// Siffror som ändras hela tiden (nedräkningar, sekunder) ligger i <span class="lv">. Panelen byggs bara
// om när något annat ändras – annars uppdateras bara siffrorna, så att knapparna går att klicka på.
const cd = sec => `<span class="lv">${Math.max(0, Math.ceil(sec))}</span>`;
const num = n => `<span class="lv">${Math.round(n)}</span>`;
const LV = /<span class="lv">([^<]*)<\/span>/g;
export function updateIncidents() {
  const html = incidentHtml();
  const shape = html.replace(LV, '<span class="lv"></span>');
  if (shape !== S.incHtml) { S.incHtml = shape; $('incBody').innerHTML = html; }
  else {
    const vals = [...html.matchAll(LV)].map(m => m[1]);
    $('incBody').querySelectorAll('.lv').forEach((el, i) => { if (el.textContent !== vals[i]) el.textContent = vals[i]; });
  }
  // rutan syns bara när något händer; den blinkar bara för incidenter (inte för information)
  const alerting = !!(S.fire || !S.power || S.storm || S.elevators.some(e => e.hot));
  const shown = alerting || html.includes('class="inc ');
  if ($('incPanel').hidden === shown) $('incPanel').hidden = !shown;
  $('incPanel').classList.toggle('calm', !alerting);
}
export function updateRoster() {
  if (!isOpen('roster')) return;
  const f = S.rosterFilter;
  const ok = p => f === 'all' || (f === 'wait' ? (p.state === 'wait' || p.state === 'toQueue')
    : f === 'ride' ? (p.state === 'ride' || p.state === 'boarding') : (p.state === 'office' || p.state === 'exiting'));
  const order = { wait: 0, toQueue: 1, boarding: 2, ride: 3, stairs: 4, instairs: 4, exiting: 5, office: 6, incar: 7, away: 8 };
  const list = S.people.filter(ok).sort((a, b) => (order[a.state] - order[b.state]) || (a.state === 'wait' ? a.waitStart - b.waitStart : a.id - b.id));
  const sid = S.sel ? S.sel.id : -1;
  $('roster').innerHTML = list.slice(0, 150).map(p => {
    const [, col] = stateInfo(p);
    let where, t = '';
    if (p.state === 'office') where = `${p.sleeping ? 'sover' : 'inne'} ${fl(p.floor)}`;
    else if (p.state === 'away') where = 'borta';
    else if (p.state === 'incar') where = `bil ${fl(p.floor)}`;
    else if (p.state === 'ride' || p.state === 'boarding') where = `${p.car.name} →${fl(p.dest)}`;
    else if (p.state === 'wait') where = `${fl(p.floor)}→${fl(p.dest)}${p.goal !== p.dest ? '↹' + fl(p.goal) : ''} ${p.assigned !== null ? EL[p.assigned].name : '?'}`;
    else if (p.state === 'stairs' || p.state === 'instairs') where = `trappa→${fl(p.dest)}`;
    else where = `${fl(p.floor)}→${fl(p.dest)}`;
    if (p.state === 'wait') t = Math.round(S.t - p.waitStart) + 's';
    return `<div class="rr${p.id === sid ? ' sel' : ''}" data-pid="${p.id}"><i style="background:${col}"></i><span>${p.cast ? '★ ' : ''}${esc(p.name)} <span class="rd">${p.id}</span></span><span>${where}</span><span class="rt">${t}</span></div>`;
  }).join('') || '<div class="rr"><i></i><span>–</span></div>';
}
export function updateTracker() {
  const p = S.sel;
  if (!isOpen('track')) return;
  $('trackEmpty').hidden = !!p; $('trackBody').hidden = !p;
  if (!p) return;
  const [label, col] = stateInfo(p);
  $('tkName').innerHTML = `${esc(p.name)} <span>#${p.id}</span>`;
  $('tkRole').textContent = p.kind === 'emp' ? `Anställd · ${FL[p.home].name} (${fl(p.home)})${p.overtime ? ' · jobbar över' : ''}`
    : p.kind === 'res' ? residentDesc(p) : p.vip ? 'VIP-besök med helikopter 🚁' : p.role ? ROLE_NAMES[p.role] : 'Besökare';
  if (p.cast) $('tkRole').textContent = `★ Stamgäst · ${p.title}`;
  if (p.auto) $('tkRole').textContent += ` · bil på ${fl(p.auto.floor)}`;
  $('tkRole').textContent += ` · ${p.kg} kg${p.cargo ? ` + ${p.cargo.name} ${p.cargo.kg} kg` : ''}`;
  const stEl = $('tkState'); stEl.textContent = label; stEl.style.setProperty('--c', col); stEl.style.setProperty('--ct', PAL.on(col));
  $('tkWhy').textContent = p.dead ? 'Har lämnat huset' : `${p.why} → våning ${fl(p.goal ?? p.dest)}${p.goal !== p.dest && p.state !== 'office' ? ` (byter hiss på ${fl(p.dest)})` : ''}`;
  let now = '', logic = '–';
  if (p.dead) now = 'Ute ur huset';
  else switch (p.state) {
    case 'toQueue': now = `Går mot hissarna på ${fl(p.floor)}`; logic = 'Får en hiss tilldelad när hen kommer fram'; break;
    case 'wait': {
      now = `Väntar på ${fl(p.floor)} (${ARR(p.dir)} mot ${fl(p.dest)}) i ${Math.round(S.t - p.waitStart)}s`;
      if (S.strategy === 'buttons' && !p.vip) {
        const lit = p.bank && S.calls[`${p.bank}|${p.floor}|${p.dir}`];
        const e = p.assigned !== null ? S.elevators[p.assigned] : null;
        now += p.fixAt ? ' · tryckte fel knapp' : lit ? ` · knappen ${ARR(p.dir)} lyser` : '';
        logic = `Styrsystemet ser bara ${ARR(p.dir)} på ${fl(p.floor)} – inte vart hen ska.${e ? ` ${e.name} tar anropet (~${Math.round(eta(e, p.floor, p.dir))}s)` : ''}`;
      } else if (p.assigned !== null) {
        const e = S.elevators[p.assigned];
        now += ` · ${e.name} är här om ~${Math.round(eta(e, p.floor, p.dir))}s`;
        logic = costBased() ? `Kostnad hämtning+resa${S.strategy === 'eco' ? '+energi' : ''}: ${costLine(p, e.id)}`
          : S.strategy === 'nearest' ? `Närmaste hiss: ${e.name} (${Math.abs(Math.round(e.pos - p.floor))} vån bort)` : `Slumpen valde ${e.name}`;
      } else if (!liftsAvailable()) { now += ' · hissarna går inte'; logic = `Tar trapporna om ~${Math.max(0, Math.ceil(p.patience - (S.t - p.waitStart)))}s`; }
      else { now += ' · alla hissar fulla'; logic = 'Väntar på att en hiss får plats'; }
      break;
    }
    case 'boarding': now = `Går in i hiss ${p.car.name}`; logic = 'Dörrarna hålls öppna tills hen är inne'; break;
    case 'ride': {
      const e = p.car, r = plannedRoute(e), idx = r.indexOf(p.dest);
      now = `I hiss ${e.name} vid våning ${fl(Math.round(e.pos))} · åkt ${Math.round(S.t - p.rideStart)}s`;
      if (!S.power && e.mode === 'normal') { now = `INSTÄNGD i hiss ${e.name} i ${Math.round(p.trapT || 0)}s`; logic = 'Väntar på ström eller nödsänkning'; }
      else logic = `Rutt: ${r.map(f => (f === p.dest ? `<u>${fl(f)}</u>` : fl(f))).join(' → ')} · ${idx <= 0 ? 'nästa stopp är målet' : idx + ' stopp före målet'}`;
      break;
    }
    case 'exiting': now = `Kliver av på ${fl(p.floor)}`; logic = p.spot ? `På väg: ${p.spot.desc.toLowerCase()}` : 'På väg ut genom entrén'; break;
    case 'stairs': now = `Går mot trapphuset på ${fl(p.floor)}`; logic = `Ska gå ${Math.abs(p.dest - p.floor)} våningar till ${fl(p.dest)}`; break;
    case 'instairs': now = `I trapphuset på väg till ${fl(p.dest)}`; logic = `Framme om ~${Math.max(0, Math.ceil(p.timer))}s`; break;
    case 'office': now = p.sleeping && p.spot.bed ? `Sover i sängen (${fl(p.floor)}) 💤` : `${p.spot.desc} (${FL[p.floor].short})`; logic = `Nästa beslut om ~${Math.max(0, Math.round(p.timer / activityRate(hour())))}s`; break;
    case 'away': now = 'Är inte i huset just nu'; logic = `Kommer tillbaka: ${phaseName(p.returnAt).toLowerCase()}`; break;
    case 'incar': now = `Kör in i garaget på ${fl(p.floor)}`; logic = 'Parkerar och går sedan till hissarna'; break;
  }
  $('tkNow').textContent = now;
  $('tkLogic').innerHTML = logic;
  $('tkDay').textContent = `${p.trips} resor · väntat ${Math.round(p.totalWait)}s · åkt ${Math.round(p.totalRide)}s${p.smoked ? ' · 💨 fick rök' : ''}`;
  if (S.trackDirty) {
    S.trackDirty = false;
    $('tkHist').innerHTML = p.hist.map(h => `<div><span>${h.time}</span>${esc(h.text)}</div>`).join('');
  }
  const d = VIEW.dpr;
  pctx.setTransform(d, 0, 0, d, 0, 0);
  pctx.clearRect(0, 0, 64, 76);
  pctx.fillStyle = col + '33'; pctx.fillRect(0, 0, 64, 76);
  // porträtt: pixelfiguren framifrån, förstorad 5 gånger (huvud och överkropp syns)
  pctx.imageSmoothingEnabled = false;
  const spr = personSprite({ ...p, mood: p.dead ? 0 : p.mood }, 'front', 0, 1);
  pctx.drawImage(spr, 2, 4, spr.width * 5, spr.height * 5);
}
export function select(p) {
  S.sel = p; S.trackDirty = true; S.logDirty = true;
  if (p) { VIEW.follow = null; VIEW.camFloor = null; VIEW.camSel = true; } else VIEW.camSel = false;
  updateTracker(); updateRoster();
}

// ---------- Lådan med flikar (spårad, register, logg, resultat) ----------
// Stängd från början; samma flik igen stänger lådan.
export const TABS = ['track', 'roster', 'log', 'stats'];
S.tab = (() => { try { const t = localStorage.getItem('hiss.tab'); return TABS.includes(t) ? t : null; } catch (e) { return null; } })();
export function setTab(name) {
  S.tab = S.tab === name ? null : name;
  try { localStorage.setItem('hiss.tab', S.tab || ''); } catch (e) { /* ingen lagring – strunta i det */ }
  applyTab();
  S.logDirty = true; S.trackDirty = true;
  updateHud(); updateTracker(); updateRoster();
}
export function applyTab() {
  $('drawer').hidden = !S.tab;
  document.querySelectorAll('#drawer .pane').forEach(el => { /** @type {HTMLElement} */ (el).hidden = el.getAttribute('data-pane') !== S.tab; });
  document.querySelectorAll('#tabs .tab').forEach(el => el.classList.toggle('on', el.getAttribute('data-act') === 'tab:' + S.tab));
  resize();
}
export const isOpen = n => S.tab === n;
export function setText(id, t) { const el = $(id); if (el.textContent !== t) el.textContent = t; }
export function grade(avg) {
  if (avg < 10) return { letter: 'A', stars: 5, msg: 'Hissguru! Ingen hann ens titta på klockan.' };
  if (avg < 17) return { letter: 'B', stars: 4, msg: 'Snyggt jobbat – nästan inga sura miner.' };
  if (avg < 26) return { letter: 'C', stars: 3, msg: 'Helt okej, men kaffet hann kallna.' };
  if (avg < 40) return { letter: 'D', stars: 2, msg: 'Det muttrades i korridorerna…' };
  return { letter: 'F', stars: 1, msg: 'Folk tar trapporna nu. Alla sjutton våningarna.' };
}
export function safetyGrade() {
  const st = S.stats;
  const pen = st.smoked * 3 + st.trappedSec / 15;
  return pen < 4 ? 'A' : pen < 12 ? 'B' : pen < 25 ? 'C' : pen < 45 ? 'D' : 'F';
}

// ---------- Overlays ----------
export function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.add('show'); }
export function hideOverlay() { $('overlay').classList.remove('show'); }
export function showIntro() {
  showOverlay(`<div class="card"><h1>HISS-O-MATIC 3000</h1>
    <p>Välkommen till <b>Skyskrapan</b>! Tunnelbana, garage och lastkaj i källaren, kontor från tandläkare till labb, en sky lobby på 6:an, bostäder högst upp och en takterrass med helikopterplatta – åtta hissar och en massa folk med bråttom.</p>
    <ul>
      <li>Det finns <b>inga knappar</b> på våningarna. Varje person har ett eget mål och får en egen hiss. Tankebubblan visar målet och hissen.</li>
      <li>Hissarna är <b>zonindelade</b>: L1–L2 går i låg zon (TB–5) och H1–H2 i hög zon (6–T) – <b>staplade i samma schakt</b>. Expresshissarna X1–X2 kör E ⇄ 6 utan stopp, och X1 går ända ner till <b>tunnelbanan</b> (TB) – där kommer folk i klump varje gång ett tåg stannar. Den som ska mellan zonerna <b>byter hiss</b> (↹) i entrén och i sky lobbyn. Varuhissen V tar städvagnar och paket, och panoramahissen P åker utanpå fasaden.</li>
      <li>Huset <b>lever</b>: bilar kör in i garaget, leveransbilen lastar av vid kajen, de boende sover, jobbar och går på taket, en fönsterputsare jobbar sig nedåt och ibland landar en VIP-helikopter på taket.</li>
      <li>Ett <b>dygn</b> tar ungefär 6 minuter – ☀️ dag och 🌙 natt syns uppe till vänster. Trafiken följer dygnet – rusning på morgonen, lunch, hemgång – och på natten är det bara väktare, städare och nattugglor. Vissa våningar stänger (caféet, banken …).</li>
      <li><b>Incidenter</b> händer: brand, strömavbrott och hissfel – då kommer en hisstekniker och lagar. Slitna hissar går oftare sönder, och utan nattservice följer slitaget med till nästa dygn. Då dyker en ruta upp med dina val. Under <b>⋯</b> kan du utlösa dem själv.</li>
      <li>Bilden visar <b>hallen framför hissarna</b> – rummen ligger bakom korridoren, och folk syns när de kommer ut för att vänta på hissen. Siffran vid korridoren är hur många som är inne.</li>
      <li><b>Klicka på en person</b> för att spåra hen – en lapp följer personen och 👤 visar allt, även när hen är inne i rummen. <b>Klicka på en korridor</b> för att spåra någon som är därinne. <b>Klicka på en hiss</b> för dess plan, last och knappen 📹 Följ.</li>
      <li>Klicka på en tom yta på en våning för att släppa in en besökare. <b>BUSS!</b> släpper in en busslast.</li>
      <li><b>Scrolla</b> med mushjulet eller piltangenterna, eller klicka i översikten till höger. Kameran följer den du spårar.</li>
      <li>📋 register, 📜 logg och 🏆 resultat öppnas i en låda till höger.</li>
      <li><kbd>Mellanslag</kbd> paus · <kbd>1</kbd>–<kbd>4</kbd> hastighet · <kbd>S</kbd> styrlogik · <kbd>Z</kbd> hela huset · <kbd>T</kbd> namnbrickor · <kbd>F</kbd> koppla loss/på kameran · <kbd>Esc</kbd> stäng/sluta spåra</li>
    </ul>
    <button class="btn" id="go">KÖR!</button></div>`);
  $('go').onclick = () => { hideOverlay(); S.started = true; log('Dag 1 börjar – dörrarna öppnas!', 'sys'); };
}
export function showSummary() {
  S.summaryShown = true; S.paused = true;
  const st = S.stats, avg = st.waitN ? st.waitSum / st.waitN : 0, g = grade(avg);
  const names = { smart: 'Smart', peak: 'Rusning', eco: 'Energisnål', nearest: 'Närmast', random: 'Kaos', buttons: 'Knappar' };
  showOverlay(`<div class="card"><h1>DYGNET ÄR SLUT!</h1>
    <div class="bigGrade">${st.waitN ? g.letter : '–'} <span style="font-size:48px">· säkerhet ${safetyGrade()}</span></div>
    <p><b>${g.msg}</b></p>
    <div class="sumgrid">
      <div>Resor klara: <b>${st.served}</b></div><div>Styrlogik: <b>${names[S.strategy]}</b></div>
      <div>Snittväntan: <b>${avg.toFixed(1)}s</b></div><div>Längsta väntan: <b>${Math.round(st.waitMax)}s</b></div>
      <div>Arga resenärer: <b>${st.angry}</b></div><div>Incidenter: <b>${st.incidents}</b></div>
      <div>Rökexponerade: <b>${st.smoked}</b></div><div>Utrymda: <b>${st.evacuated}</b></div>
      <div>Instängd-sekunder: <b>${Math.round(st.trappedSec)}</b></div><div>Trapp-resor: <b>${st.stairs}</b></div>
      <div>Överlaster: <b>${st.overloads}</b></div><div>Hissbyten: <b>${st.transfers}</b></div>
      <div>Bilar i garaget: <b>${st.carsIn}</b></div><div>Leveranser: <b>${st.deliveries}</b></div>
      <div>Felknappar: <b>${st.wrongPress}</b> (barn: ${st.kidPresses})</div><div>Spökstopp: <b>${st.ghostStops}</b></div>
      <div>Hissfel: <b>${st.faults}</b> (stillestånd ${Math.round(st.downSec)} s)</div><div>Nattservice: <b>${st.serviced}</b> hissar</div>
      <div>Energi: <b>${st.energy.toFixed(1)} kWh</b> (körning ${st.energyRun.toFixed(1)})</div><div>Återmatat: <b>${st.regen.toFixed(1)} kWh</b></div>
      <div>★ Gunnar gnällde: <b>${st.gripes}</b> gånger</div><div>★ Kurts kaffekoppar: <b>${st.cups}</b></div>
      <div>Höll upp dörren: <b>${st.holds}</b> gånger</div><div>★ Majken pratade: <b>${st.chats}</b> gånger</div>
      <div>Väder: <b>${S.weather.temp} °C</b>${S.weather.cold > 0 ? ` (dörren tog emot ${st.doorFights} ggr)` : ''}</div><div>Vajerlarm i storm: <b>${st.stormFaults}</b></div>
      <div>Överhettade motorer: <b>${st.heatStops}</b></div><div>Snubbel på tröskeln: <b>${st.stumbles}</b></div>
      <div>Ambulans: <b>${st.medical}</b></div><div>Flyttlass: <b>${st.moveLoads}</b></div>
      <div>Övre däcket: <b>${st.upperDeck}</b> resor</div><div>Inlärda parkeringar: <b>${st.learnedParks}</b></div>
      <div>Tåg vid perrongen: <b>${st.trains}</b></div><div>Med tunnelbanan: <b>${st.trainIn}</b> in · <b>${st.trainOut}</b> hem</div>
      <div>Tog trappan frivilligt: <b>${st.stairsChoice}</b></div><div>Mest sliten: <b>${S.elevators.reduce((a, e) => (e.wear > a.wear ? e : a)).name} ${Math.round(Math.max(...S.elevators.map(e => e.wear)) * 100)} %</b></div>
    </div>
    <button class="btn" id="next">NÄSTA DAG ▶</button></div>`);
  $('next').onclick = () => { hideOverlay(); newDay(); };
}
export function newDay() {
  S.day++;
  resetDay();
  S.paused = false;
  updatePauseBtn();
  log(`Dag ${S.day} börjar!`, 'sys');
}
