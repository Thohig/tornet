// HUD: texterna i kontrollpanelen (hissen eller personen man följer, incidentkorten, registret, loggen och
// resultatet), välkomstrutan och dygnets sammanfattning. Vilka block som syns i panelen avgörs i panels.js.
import { ARR, esc, fl } from './util.js';
import { CAP, EL, FL, LOBBY, DOCK, TOP, ROLE_NAMES, activityRate, FULL_LOAD, timeScale, dayLength } from './config.js';
import { S, hour, log, phaseName } from './state.js';
import { liftsAvailable } from './people.js';
import { costBased, costLine, eta, isFull, pickTotal, pickersAt, loadKg, cabinKg, slotsFull } from './dispatch.js';
import { canRescue } from './incidents.js';
import { plannedRoute } from './sim.js';
import { VIEW, pctx } from './view.js';
import { personSprite } from './pixpeople.js';
import { PAL } from './pixpal.js';
import { stateInfo } from './describe.js';
export { stateInfo };
import { residentDesc } from './life.js';
import { jobFloor, tech, techOf, cableStatus } from './service.js';
import { hoistHalt, hoistStatus } from './hoist.js';
import { BLANKET_T } from './visits.js';
import { INSATS, chiefOnDuty } from './chief.js';
import { incUi } from './incui.js';
import { CREW_BY } from './crew.js';
import { guideName } from './visning.js';
import { doAction, extraActions } from './input.js';
import { trDom } from './lang.js';
import { allStatsHtml, avgWait, grade, lastDay, safetyGrade } from './summary.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */
export { grade, safetyGrade };

export function $(id) { return document.getElementById(id); }
// ---------- Hissen man följer: allt om hissen (förr hisspopupen) ----------
/** @param {Elevator} e */
export function carHtml(e) {
  const n = e.passengers.length, kg = cabinKg(e), pct = kg / e.ratedKg, svc = serviceStatus(e), route = plannedRoute(e);
  const kw = e.kw > 0.05 ? `⚡ drar ${e.kw.toFixed(0)} kW` : e.kw < -0.05 ? `♻ återmatar ${(-e.kw).toFixed(0)} kW` : e.state === 'moving' ? '⚡ 0 kW' : '⚡ vila';
  const who = n ? e.passengers.map(p => `<span data-pid="${p.id}">${esc(p.name)}</span>→${fl(p.dest)}${p.goal !== p.dest && !p.viaStairs ? `↹${fl(p.goal)}` : ''}`).join(', ') : '–';
  return `<div class="car-head" style="--c:${e.color};--ct:${PAL.on(e.color)}"><span class="nm">${esc(e.name)}</span><span class="st">${esc(stateLabel(e))}</span><span class="fl">${fl(Math.round(e.pos))}</span></div>`
    + `<div class="zone">${esc(zoneText(EL[e.id]))}</div>`
    + `<div class="load${pct >= FULL_LOAD ? ' heavy' : ''}" style="--c:${e.color}"><i style="width:${Math.min(100, pct * 100).toFixed(0)}%"></i><span>${Math.round(kg)} kg (${Math.round(pct * 100)} %) · ${n}/${CAP} · hämtar ${pickTotal(e)}</span></div>`
    + `<div class="plan">Plan: ${route.length ? route.map(fl).join(' → ') : '—'}</div><div class="why">${esc(whyText(e))}</div>`
    + (svc ? `<div class="svc">${esc(svc)}</div>` : '')
    + `<div class="who">Ombord: ${who}</div><div class="acts">${carActs(e)}</div>`
    + `<div class="meta">${Math.round(e.distance)} vån · ${e.trips} stopp · slitage ${Math.round(e.wear * 100)} % · 🌡️ ${motorC(e)} °C${e.fan ? ' 🌀' : ''} · ${kw} · ${e.kwh.toFixed(1)} kWh i dag</div>`;
}
/** Kort beskrivning av hissens zon, t.ex. "P2–6 · låg zon" eller "E⇄6 express" */
/** motorns temperatur i °C (värmen 0–1 där 1 = överhettningsskyddet löser ut vid 100 °C) @param {Elevator} e */
export const motorC = e => Math.round(35 + e.heat * 65);
export function zoneText(d) {
  if (d.deck2) return `${fl(d.minF)} ⇄ ${fl(d.maxF)} nedre · ${fl(d.upper[0])} ⇄ ${fl(d.upper[d.upper.length - 1])} övre · dubbeldäck`;
  if (d.express) return `${fl(d.minF)} ⇄ ${fl(d.maxF)} · express`;
  if (d.facade) return `${d.serves.map(fl).join(' · ')} · panorama i glas`;
  if (d.freight) return `${fl(d.minF)}–${fl(d.maxF)} · varuhiss ${d.ratedKg} kg`;
  return `${fl(d.minF)}–${fl(d.maxF)} · ${d.group} zon`;
}
/** @param {Elevator} e */
export function stateLabel(e) {
  if (e.mode === 'snapped') return e.snap.ph === 'fall' ? 'FALLER! 🪢' : 'LINBROTT 🪢';
  if (e.mode === 'broken' && e.fault.cable) return 'LINBYTE 🔧';
  if (e.mode === 'broken') return 'TRASIG 🔧';
  if (e.mode === 'service') return 'SERVICE 🔧';
  if (e.hold) return 'TILL SERVICE';
  if (e.hot) return 'ÖVERHETTAD 🌡️';
  if (e.windLock) return 'STÄNGD – STORM 🌬️';
  if (e.indep) return 'OBEROENDE DRIFT 🔑';
  if (e.medicHold) return 'VÄNTAR – AMBULANS 🚑';
  if (e.zoneLock) return 'SPÄRRAD 🚧';
  if (e.sleep) return 'NATTLÄGE 🌙';
  if (e.mode === 'recall') return 'BRANDÅTERKALLAD';
  if (e.mode === 'locked') return 'AVSTÄNGD';
  if (e.mode === 'rescue') return 'NÖDSÄNKS';
  if (e.mode === 'lift') return 'FLYTTLASS 🚚';
  if (e.liftWant) return '→ FLYTTLASS';
  if (e.mode === 'dead') return 'UTRYMD';
  if (!S.power) return 'STRÖMLÖS';
  if (e.off && e.state !== 'moving' && !e.passengers.length) return 'UR DRIFT';
  if (e.state === 'doors') return { opening: 'ÖPPNAR', open: 'LASTAR', closing: 'STÄNGER' }[e.doorPhase];
  if (e.state === 'moving') return e.targetKind === 'park' ? `PARKERAR ${ARR(e.dir)}` : `ÅKER ${ARR(e.dir)}`;
  return 'VILAR';
}
export const nameList = list => (list.length > 2 ? `${list.length} st` : list.map(p => p.name).join(' & '));
/** @param {Elevator} e */
export function reasonAt(e, f, d) {
  const r = [];
  const off = e.passengers.filter(p => p.dest === f);
  if (off.length) r.push(`${nameList(off)} ska av`);
  const up = pickersAt(e, f, d), back = pickersAt(e, f, -d);
  if (up.length) r.push(`hämtar ${nameList(up)} ${ARR(d)}`);
  else if (back.length) r.push(`vänder & hämtar ${nameList(back)} ${ARR(-d)}`);
  return r.join(' + ') || '—';
}
/** @param {Elevator} e */
export function whyText(e) {
  if (e.zoneLock) return `Når ingen våning utanför brandzonen – står spärrad på ${fl(e.minF)} tills branden är släckt`;
  if (e.mode === 'snapped' || (e.mode === 'broken' && e.fault.cable)) return cableStatus(e);
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
  if (e.medicHold) return `Står kvar på ${fl(S.medic ? S.medic.floor : Math.round(e.pos))} med ambulansens nyckel – väntar på personalen och båren`;
  if (e.mode === 'recall') return `Brandåterkallning: kör direkt till ${fl(e.home)} utan stopp och släpper ut alla`;
  if (e.mode === 'locked') return `Avstängd i ${fl(e.home)} med öppna dörrar tills branden är släckt`;
  if (e.mode === 'lift') return 'Lastläge: kör flyttlasset från takterrassen ner till entrén – tar inga resenärer';
  if (e.liftWant) return 'Kör klart sina resenärer och hämtar sedan ett flyttlass på takterrassen';
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
 *  Bara en uppskattning för gränssnittet: simuleringen slumpar arbetstiden först när arbetet börjar. @param {Elevator} e */
export function serviceStatus(e) {
  if (e.mode === 'snapped' || (e.mode === 'broken' && e.fault.cable)) return `🔧 ${cableStatus(e)}`;
  const broken = e.mode === 'broken';
  if (!broken && !e.serviceAsap && !e.hold && e.mode !== 'service') return null;
  const t = techOf(e) || tech(), mine = !!t && t.job === e.id, f = jobFloor(e);
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
/** En ikonknapp: bara ikonen syns; namnet och förklaringen står i verktygstipset (panels.js) och namnet
 *  läses upp av skärmläsare. extra = fler attribut (t.ex. ' disabled'). */
export const ikon = (act, icon, name, hint = '', isOn = false, extra = '') =>
  `<button class="btn ico${isOn ? ' on' : ''}" data-act="${act}" aria-label="${name}" data-hint="<b>${name}</b>${hint ? `<br>${hint}` : ''}"${extra}>${icon}</button>`;
/** @param {Elevator} e */
export function carActs(e) {
  const b = [];
  b.push(e.off ? ikon(`car:off:${e.id}`, '▶', 'Sätt i drift', `${e.name} tar nya resenärer igen`) : ikon(`car:off:${e.id}`, '⏸', 'Ta ur drift', `${e.name} lämnar av dem som är ombord och tar inga nya`));
  if (e.mode === 'normal' && !e.serviceAsap && !e.hold && S.started) b.push(ikon(`level:${e.id}`, '🛠️', 'Beställ service', 'Hissteknikern kommer direkt, även på dagen'));
  if (!S.power && e.mode === 'normal' && e.passengers.length && !(e.state === 'doors' && e.door >= 0.95))
    b.push(`<button class="btn xs hot2" data-act="pow:rescue:${e.id}" ${canRescue(e) ? '' : 'disabled'}>🔋 Nödsänk (${e.passengers.length})</button>`);
  // framkalla något i just den här hissen
  if (S.started && e.mode === 'normal') {
    b.push(`<span class="trig-car">Framkalla:${ikon(`trig:fault:${e.id}`, '🔧', 'Hissfel', 'Hissen går sönder vid nästa stopp (ibland mellan två våningar med folk i)')}`
      + ikon(`trig:heat:${e.id}`, '🌡️', 'Het motor', 'Kylningen hakar upp sig och motorn blir het', false, e.hot ? ' disabled' : '')
      + `${e.facade ? ikon('trig:pano', '🧗', 'Fast på fasaden', 'Hydrauliken låser sig nästa gång den kör med folk – korgen fastnar utanpå huset', false, e.panoNext || S.pano ? ' disabled' : '')
        : ikon(`trig:cable:${e.id}`, '🪢', 'Linbrott', 'Linorna går av på nästa åktur', false, e.snapNext ? ' disabled' : '')}</span>`);
  }
  return b.join('');
}
// ---------- Loggen och resultatet (vyer i panelen) ----------
export function logHtml() {
  const f = S.logFilter, sid = S.sel ? S.sel.id : -1;
  const rows = S.log.filter(l => f === 'all' || (f === 'person' ? l.kind === 'person' : f === 'button' ? l.kind === 'button' : f === 'lift' ? l.kind !== 'person' && l.kind !== 'button' : l.pid === sid)).slice(0, 80);
  return rows.map(l =>
    `<div class="le k-${l.kind}${l.pid != null && l.pid === sid ? ' sel' : ''}"${l.pid != null ? ` data-pid="${l.pid}"` : ''}><span class="lt">${l.time}</span>${l.color ? `<span class="ld" style="background:${l.color}"></span>` : ''}<span>${esc(l.text)}</span></div>`).join('')
    || '<div class="le">–</div>';
}
/** dagens siffror i korthet: betyg, resor, väntande och snittväntan */
export function dayNumbers() {
  const st = S.stats, avg = st.waitN ? st.waitSum / st.waitN : 0;
  const waitingNow = S.wl ? S.wl.reduce((a, w) => a + w.u.length + w.d.length, 0) : 0;
  return { letter: st.waitN ? grade(avg).letter : '–', served: st.served, waiting: waitingNow, avg, safety: safetyGrade() };
}
export function statsHtml() {
  const st = S.stats, g = grade(avgWait(st)), D = lastDay();
  return `
    <div class="stat"><span>Väntar nu</span><b>${dayNumbers().waiting}</b></div>
    ${allStatsHtml(st)}
    ${learnMap()}
    <div class="grade">Service: ${st.waitN ? g.letter : '–'} <span class="stars">${st.waitN ? '★'.repeat(g.stars) + '☆'.repeat(5 - g.stars) : ''}</span> · Säkerhet: ${safetyGrade()}</div>
${D ? `    <div class="row"><button class="btn xs" data-act="view:yesterday">🌅 Dag ${D.day} i sammanfattning</button></div>` : ''}`;
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
/** Driftchefens rad på ett incidentkort: chefens beslut och varför, eller spelarens val och knappen tillbaka.
 *  q = frågan till spelaren när chefen inte sköter beslutet. */
function chiefLine(key, q) {
  const C = S.chief, d = C && C.dec[key];
  if (C && C.manual[key]) return `<div class="inc-chief you">👤 <b>Du bestämmer:</b> ${esc(d ? d.text : '')}`
    + ` <button class="btn xs" data-act="chief:${key}" data-hint="Driftchefen tar över beslutet igen">🧑‍💼 Låt driftchefen bestämma</button></div>`;
  // (kuppen: polisens insatsledare bestämmer – chefen sitter bunden i driftcentralen)
  const police = key === 'heist';
  if (!C || (!C.on && !police)) return `<div class="inc-q">${q}</div>`;
  const who = esc(police ? INSATS : chiefOnDuty().name), ico = police ? '🚓' : '🧑‍💼';
  return (d ? `<div class="inc-chief">${ico} <b>${who}:</b> ${esc(d.text)}${d.why ? ` <span class="why">– ${esc(d.why)}</span>` : ''}</div>`
    : `<div class="inc-chief">${ico} <b>${who}</b> ${police ? 'är på väg…' : 'håller ögonen på skärmarna…'}</div>`) + '<div class="inc-q">Ta över beslutet:</div>';
}
const chiefOn = () => !!(S.chief && S.chief.on);
export function incidentHtml() {
  const parts = [];
  // incidenterna med val (kortet i registret, incui.js): stormen, heta motorer, panoramahissen, kuppen, gondolen, hunden, läckan …
  const h = { card, chiefLine, chiefOn, cd, num, ikon, motorC };
  for (const u of incUi()) if (u.card && !u.late) u.card(h, parts);
  // ---------- händelser som spelaren bara informeras om ----------
  const V = S.elevators.find(e => e.freight);
  const info = (key, cls, title, body, acts) => {
    if (S.dismissed.has(key)) return;
    parts.push(card(key, `info ${cls}`, title, `<div class="inc-s">${body}</div>${acts ? `<div class="inc-acts">${acts}</div>` : ''}`, false, true));
  };
  // linbrott: spelaren kan inte göra något – hissjouren räddar de instängda och byter linorna
  for (const e of S.elevators) {
    const cab = e.mode === 'snapped' ? e.snap : e.mode === 'broken' && e.fault.cable ? e.fault : null;
    if (!cab) continue;
    const intro = e.mode === 'snapped' && e.snap.ph === 'fall' ? 'Bärlinorna har gått av – korgen faller!'
      : e.mode === 'snapped' ? 'Bärlinorna gick av och fångapparaten stoppade fallet. Korgen står fast mellan två våningar.'
      : `Alla är ute. Hissen står avstängd medan nya bärlinor dras i schaktet – det tar några timmar.`;
    info(`cable-${e.id}-${Math.round(cab.t0)}`, 'cable', `🪢 Linbrott i ${esc(e.name)}`, `${intro}<div class="svc">${esc(cableStatus(e))}</div>`,
      `${ikon(`follow:${e.id}`, '📹', 'Visa hissen', 'Kameran följer hissen')}`);
  }
  const M = S.move;
  // flyttkortet syns en stund innan flytten börjar (då kan spelaren välja väg och skyddsfiltar) och under den
  if (M && ((M.state === 'planned' && hour() >= M.at - 1.5 && !S.fire) || M.state === 'on' || (M.state === 'done' && S.t - M.t1 < 20))) {
    const out = M.items.filter(it => it.st === 'dock' || it.st === 'truck').length, flat = M.items.filter(it => it.st === 'home' || it.st === 'packing').length;
    const bar = M.items.map(it => (it.st === 'truck' ? '▓' : it.st === 'dock' ? '▒' : it.st === 'home' || it.st === 'packing' ? '·' : '░')).join('');
    const xl = M.items.filter(it => it.size === 'XL').map(it => it.name.replace('(!)', ''));
    const routeTxt = { auto: M.smart ? 'Styrningen planerar: de stora möblerna går utanpå när det är kö till varuhissen, kartongerna väntar in när buden står där.' : 'Styrningen kör XL-möblerna med hissbalken och resten i varuhissen.',
      varu: 'Allt går i varuhissen – även det tyngsta.', balk: 'Alla stora möbler går utanpå med hissbalken; kartongerna i varuhissen.' }[M.route];
    const lock = `Varuhissen ${V ? esc(V.name) : ''} går i <b>oberoende drift</b> ${M.smart ? 'bara medan en stor möbel är på väg ner' : 'så länge bärarna jobbar'}${V && V.indep ? ' (<b>låst nu</b>)' : ''}.`;
    const chip = (r, t) => `<button class="btn xs${M.route === r ? ' on' : ''}" data-act="moveRoute:${r}">${t}</button>`;
    const routes = M.state !== 'done' ? chip('auto', '🤖 Låt styrningen planera') + chip('varu', '🛗 Allt i varuhissen') + (M.hoist ? chip('balk', '🏗️ Tungt utanpå') : '') : '';
    const blank = M.state === 'planned' ? `<button class="btn xs${M.blankets ? ' on' : ''}" data-act="moveBlankets:${M.blankets ? 0 : 1}">🧣 Skyddsfiltar: ${M.blankets ? 'ja' : 'nej'}</button>` : '';
    const windy = M.state === 'on' && hoistHalt() === 'blåst' && M.items.some(it => it.st === 'hatch');
    const wind = windy ? `<button class="btn xs${(M.windChoice ?? (M.smart ? 'varu' : 'wait')) === 'wait' ? ' on' : ''}" data-act="moveWind:wait">⏳ Vänta ut blåsten</button><button class="btn xs${(M.windChoice ?? (M.smart ? 'varu' : 'wait')) === 'varu' ? ' on' : ''}" data-act="moveWind:varu">🛗 Ta varuhissen</button>` : '';
    const body = M.state === 'planned'
      ? `<b>${esc(M.who)}</b> flyttar från ${fl(M.floor)} i dag – Flyttfirman Lyft & Bär kommer ${M.smart ? 'efter lunch, när förmiddagens leveranser är klara' : 'på förmiddagen, mitt i leveranserna'}. Bohaget: <b>${num(M.loads)}</b> lass${xl.length ? `, bland annat ${esc(xl.join(' och '))}` : ''}.`
        + ` <b>Välj väg</b> för möblerna och om varuhissen ska kläs med <b>skyddsfiltar</b> (tar ${BLANKET_T} s i början, men inga repor i väggarna). ${routeTxt}`
        + (M.dockWait > 0 ? ' Flyttbilen väntar på gatan – leveransbilen står vid lastkajen.' : '')
      : M.state === 'on'
        ? `<b>${esc(M.who)}</b> flyttar från ${fl(M.floor)} med Flyttfirman Lyft & Bär. Bohaget: <b>${num(M.loads)}</b> lass – ${num(flat)} kvar i lägenheten, ${num(out)} nere vid flyttbilen, ${num(M.truck)} inlastade.`
          + `<div class="svc" data-hint="▓ i flyttbilen · ▒ på lastkajen · ░ på väg · · i lägenheten">${bar}</div>`
          + (S.t < M.crewAt ? `Flyttgubbarna klär ${V ? esc(V.name) : 'varuhissen'} med skyddsfiltar. ` : '') + `${routeTxt} ${lock}`
          + (hoistStatus(M) ? ` <b>Hissbalken:</b> ${esc(hoistStatus(M))}` : '')
          + (windy ? ' <b>Blåsten stoppar hissbalken</b> – vänta ut den, eller bär ner det som står vid lastluckan i varuhissen?' : '')
          + (M.pivots ? ` ${M.pivots === 1 ? 'En möbel' : `${num(M.pivots)} möbler`} har fått vändas i hissdörren${M.stuck ? `, ${num(M.stuck)} fastnade helt` : ''}.` : '')
          + (M.broken ? ` 💥 ${num(M.broken)} lass tappades.` : '') + (M.scratches ? ` ${num(M.scratches)} repor i varuhissen.` : '')
          + (M.notes.truck ? ' Leveransbilen får vänta på gatan – flyttbilen står vid lastkajen.' : '')
          + (S.power ? '' : ' Strömavbrott: flyttgubbarna väntar ut det med möblerna vid hissen – den som har tomma händer tar trapporna.')
        : `Flytten är klar: ${num(M.loads)} lass på ${Math.round(M.t1 - M.t0)} s${M.hoisted ? ` (${num(M.hoisted)} med hissbalken och panoramahissen)` : ''}, varuhissen var låst i ${Math.round(M.indepSec)} s. Den går i vanlig trafik igen.`;
    const mc = M.state === 'done' ? '' : chiefLine('move', 'Välj väg för möblerna:');
    info(`move-${S.day}`, 'move', `🚚 Flyttdag på ${fl(M.floor)}`, body + mc,
      `${routes}${blank}${wind}${V && M.state !== 'planned' ? `${ikon(`follow:${V.id}`, '📦', 'Följ varuhissen', 'Kameran följer varuhissen')}` : ''}${ikon(`show:${M.floor}`, '📍', 'Visa våningen', 'Kameran går till våningen där flytten är')}${ikon(`show:${DOCK}`, '🚛', 'Lastkajen', 'Kameran går till lastkajen')}`);
  }
  const A = S.medic;
  if (A && (A.state !== 'done' || S.t - A.t1 < 20)) {
    // strömavbrott: hissarna står still, så personalen bär båren i trapporna (eller sitter fast och räddas först)
    const dark = !S.power && (A.state === 'onway' || A.state === 'transport');
    const stuck = S.people.some(p => p.medic && p.state === 'ride');
    const what = { called: `${esc(A.pname)} har svimmat på ${esc(A.where)} (${fl(A.floor)}). Ambulansen är på väg.`,
      onway: dark ? 'Ambulanspersonalen är i huset med bår.' : `Ambulanspersonalen är i huset med bår. Båren får bara plats i varuhissen, som går med förtur – VIP-läge för ambulansen.${A.car !== null && A.car !== undefined ? ` ${esc(S.elevators[A.car].name)} väntar på dem på ${fl(A.floor)}.` : ''}`,
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
      (amb ? `<button class="btn xs${on ? ' on' : ''}" data-act="person:${amb.id}" aria-label="Följ ambulansen" data-hint="<b>${on ? 'Följer ambulansen' : 'Följ ambulansen'}</b><br>${on ? 'Sluta följa' : 'Följ'} ${esc(amb.name)} med båren">📹</button>` : '')
      + `${ikon(`show:${A.floor}`, '📍', 'Visa våningen', 'Kameran går dit ambulansen ska')}${V ? `${ikon(`follow:${V.id}`, '📦', 'Följ varuhissen', 'Kameran följer varuhissen')}` : ''}`);
  }
  for (const n of S.notices) {
    // (de fälls ihop till en rad efter INFO_OPEN_S och ligger kvar en stund till – dygnets början längst)
    if (S.t - n.t0 > (n.kind === 'day' ? NOTICE_DAY_S : NOTICE_S)) continue;
    const svcCar = n.act && n.act.startsWith('level:') ? S.elevators[+n.act.split(':')[1]] : null;
    const svc = svcCar ? serviceStatus(svcCar) : null;
    const acts = (n.car !== null ? `${ikon(`follow:${n.car}`, '📹', 'Visa hissen', 'Kameran följer hissen')}` : n.floor !== null ? `${ikon(`show:${n.floor}`, '📍', 'Visa våningen', 'Kameran går till våningen')}` : '')
      + (n.act && !svc ? `<button class="btn xs" data-act="${n.act}">${n.actLabel}</button>` : '');
    info(`n${n.id}`, n.kind, esc(n.title), esc(n.text) + (svc ? `<div class="svc">${esc(svc)}</div>` : ''), acts);
  }
  // (brand och strömavbrott sist – late i registret)
  for (const u of incUi()) if (u.card && u.late) u.card(h, parts);
  return parts;
}
/** ett kort i incidentrutan: incidenter (alert) kan åtgärdas, informationsrutor (closable) bara stängas */
function card(k, cls, head, body, alert = false, closable = false) { return { k, cls: cls + (alert && chiefOn() ? ' calm' : ''), head, body, alert, closable }; }
// Incidentkorten i panelens händelseblock: incidenter är utfällda tills spelaren fäller ihop dem;
// informationsrutor fälls ut en stund när de dyker upp och fälls sedan ihop till en rad – medan en incident som
// går att åtgärda pågår är de ihopfällda direkt, så att de inte tar platsen från den (Murphys lag: sex kort på rad).
// Spelaren kan alltid fälla ut dem. (Bara gränssnittet.)
const INFO_OPEN_S = 12;
/** hur länge en informationsruta (notice) ligger kvar i panelen, och rutan om att ett nytt dygn börjar */
const NOTICE_S = 90, NOTICE_DAY_S = 240;
const incOpened = new Set(), incFolded = new Set(), incSeen = new Map();
let incAlert = false; // någon incident som går att åtgärda just nu (incidentPanel)
const incIsOpen = c => (incFolded.has(c.k) ? false : incOpened.has(c.k) || c.alert || (!incAlert && S.t - (incSeen.get(c.k) ?? S.t) < INFO_OPEN_S));
let incCards = [];
/** fäll ut eller ihop ett kort (knappen i rubriken eller den ihopfällda raden) */
export function foldInc(k) {
  const c = incCards.find(q => q.k === k);
  if (c && incIsOpen(c)) { incFolded.add(k); incOpened.delete(k); } else { incOpened.add(k); incFolded.delete(k); }
}
// Siffror som ändras hela tiden (nedräkningar, sekunder) ligger i <span class="lv">: panelen bygger bara om
// kortet när något annat ändras och uppdaterar annars bara siffrorna, så att knapparna går att klicka på.
/** nedräkningen i korten i ord – spelet visar ingen klocka (en hel adverbial: "framme ${cd(t)}" = "framme om en halv minut") */
const cd = sec => { const s = Math.ceil(sec); return `<span class="lv">${s <= 0 ? 'nu' : s < 15 ? 'alldeles strax' : s < 45 ? 'om en halv minut' : s < 100 ? 'om någon minut' : 'om en stund'}</span>`; };
const num = n => `<span class="lv">${Math.round(n)}</span>`;
/** korten just nu: html, hur många, och om någon är en incident (inte bara information) */
/** de farligaste incidenterna först (de andra står i registrets ordning): branden ska inte hamna längst ner under Murphys lag */
const INC_RANK = { fire: 0, power: 1, heist: 2, pano: 3 };
export function incidentPanel() {
  const rank = c => (c.alert ? 0 : 10) + (INC_RANK[c.k] ?? 5);
  const cards = incCards = incidentHtml().map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(o => o.c);
  incAlert = cards.some(c => c.alert);
  for (const c of cards) if (!incSeen.has(c.k)) incSeen.set(c.k, S.t);
  // ett kort som försvunnit glöms (nästa brand ska fällas ut igen, även om den förra fälldes ihop)
  const live = new Set(cards.map(c => c.k));
  for (const set of [incOpened, incFolded]) for (const k of set) if (!live.has(k)) set.delete(k);
  for (const k of incSeen.keys()) if (!live.has(k)) incSeen.delete(k);
  const full = c => `<div class="inc ${c.cls}${c.alert ? ' alert' : ''}"><div class="inc-h"><span class="inc-t">${c.head}</span>`
    + `<button class="inc-x" data-act="incfold:${c.k}" data-hint="Fäll ihop">▁</button>`
    + `${c.closable ? `<button class="inc-x" data-act="dismiss:${c.k}" data-hint="Stäng">✕</button>` : ''}</div>${c.body}</div>`;
  const row = c => `<button class="inc chip ${c.cls}${c.alert ? ' alert' : ''}" data-act="incfold:${c.k}" data-hint="Fäll ut"><span class="inc-h">${c.head}</span></button>`;
  const open = cards.filter(incIsOpen), shut = cards.filter(c => !incIsOpen(c));
  return { html: open.map(full).join('') + (shut.length ? `<div class="inc-dock">${shut.map(row).join('')}</div>` : ''),
    n: cards.length, open: open.length, alert: cards.some(c => c.alert) };
}
export function rosterHtml() {
  const f = S.rosterFilter;
  /** @param {Person} p */
  const ok = p => f === 'all' || (f === 'crew' ? !!p.crewId || p.role === 'arbetsledare' : f === 'wait' ? (p.state === 'wait' || p.state === 'toQueue')
    : f === 'ride' ? (p.state === 'ride' || p.state === 'boarding') : (p.state === 'office' || p.state === 'exiting'));
  const order = { wait: 0, toQueue: 1, boarding: 2, ride: 3, rope: 3, stairs: 4, instairs: 4, exiting: 5, office: 6, incar: 7, away: 8, assembly: 8, platform: 4 };
  const list = S.people.filter(ok).sort((a, b) => (order[a.state] - order[b.state]) || (a.state === 'wait' ? a.waitStart - b.waitStart : a.id - b.id));
  const sid = S.sel ? S.sel.id : -1;
  return list.slice(0, 150).map(p => {
    const [, col] = stateInfo(p);
    let where, t = '';
    if (p.state === 'office' && p.crewId) where = `${stateInfo(p)[0].toLowerCase()} ${fl(p.floor)}`;
    else if (p.state === 'office') where = `${p.sleeping ? 'sover' : 'inne'} ${fl(p.floor)}`;
    else if (p.state === 'away') where = 'borta';
    else if (p.state === 'assembly') where = 'ute (brand)';
    else if (p.state === 'incar') where = `bil ${fl(p.floor)}`;
    else if (p.state === 'ride' || p.state === 'boarding') where = `${p.car.name} →${fl(p.dest)}`;
    else if (p.state === 'wait') where = `${fl(p.floor)}→${fl(p.dest)}${p.goal !== p.dest ? '↹' + fl(p.goal) : ''} ${p.assigned !== null ? EL[p.assigned].name : '?'}`;
    else if (p.state === 'stairs' || p.state === 'instairs') where = `trappa→${fl(p.dest)}`;
    else where = `${fl(p.floor)}→${fl(p.dest)}`;
    if (p.state === 'wait') t = Math.round(S.t - p.waitStart) + 's';
    return `<div class="rr${p.id === sid ? ' sel' : ''}" data-pid="${p.id}"><i style="background:${col}"></i><span>${p.cast ? '★ ' : p.crewId ? `${CREW_BY[p.crewId].icon} ` : ''}${esc(p.name)}</span><span>${where}</span><span class="rt">${t}</span></div>`;
  }).join('') || '<div class="rr"><i></i><span>–</span></div>';
}
/** Personen man följer: vem, vart, varför och vad styrningen tänker. Porträttet ritas med drawPortrait. @param {Person} p */
export function personHtml(p) {
  const [label, col] = stateInfo(p);
  let role = p.kind === 'emp' ? `Anställd · ${FL[p.home].name} (${fl(p.home)})${p.overtime ? ' · jobbar över' : ''}`
    : p.kind === 'res' ? residentDesc(p) : p.vip ? 'VIP-besök med helikopter 🚁' : p.role ? ROLE_NAMES[p.role] : 'Besökare';
  if (p.cast) role = `★ Stamgäst · ${p.title}`;
  if (p.crewId) role = `${CREW_BY[p.crewId].icon} ${p.title}`;
  else if (p.role === 'arbetsledare') role = `🦺 ${p.title}`;
  if (p.guide) role = `🚩 ${p.title}`;
  else if (p.tour) role = '🚌 Turist på Stadsturen';
  if (p.auto) role += ` · bil på ${fl(p.auto.floor)}`;
  role += ` · ${p.kg} kg${p.cargo ? ` + ${p.cargo.name} ${p.cargo.kg} kg` : ''}`;
  const why = p.dead ? 'Har lämnat huset' : `${p.why} → våning ${fl(p.goal ?? p.dest)}${p.goal !== p.dest && p.state !== 'office' ? ` (byter hiss på ${fl(p.dest)})` : ''}`;
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
    case 'exiting': now = `Kliver av på ${fl(p.floor)}`; logic = p.spot ? `På väg: ${esc(p.spot.desc.toLowerCase())}` : 'På väg ut genom entrén'; break;
    case 'stairs': now = `Går mot trapphuset på ${fl(p.floor)}`; logic = `Ska gå ${Math.abs(p.dest - p.floor)} våningar till ${fl(p.dest)}`; break;
    case 'instairs': now = `I trapphuset på väg till ${fl(p.dest)}`; logic = `Framme om ~${Math.max(0, Math.ceil(p.timer))}s`; break;
    case 'office': now = p.sleeping && p.spot.bed ? `Sover i sängen (${fl(p.floor)}) 💤` : `${p.spot.desc} (${FL[p.floor].short})`; logic = `Nästa beslut om ~${Math.max(0, Math.round(p.timer / activityRate(hour())))}s`; break;
    case 'away': now = 'Är inte i huset just nu'; logic = `Kommer tillbaka: ${phaseName(p.returnAt).toLowerCase()}`; break;
    case 'incar': now = `Kör in i garaget på ${fl(p.floor)}`; logic = 'Parkerar och går sedan till hissarna'; break;
    case 'assembly': now = 'Väntar på återsamlingsplatsen'; logic = 'Går in igen när branden är släckt'; break;
  }
  return `<div class="track"><div class="tk-top"><div class="pic"></div><div class="tk-id"><div class="tk-name">${esc(p.name)}</div>`
    + `<div class="tk-role">${esc(role)}</div><div class="tk-state" style="--c:${col};--ct:${PAL.on(col)}">${esc(label)}</div></div></div>`
    + `<div class="tk-line"><b>SYFTE</b><span>${esc(why)}</span></div><div class="tk-line"><b>LÄGE</b><span>${esc(now)}</span></div>`
    + `<div class="tk-line"><b>LOGIK</b><span>${logic}</span></div>`
    + `<div class="tk-line"><b>IDAG</b><span>${p.trips} resor · väntat ${Math.round(p.totalWait)}s · åkt ${Math.round(p.totalRide)}s${p.smoked ? ' · 💨 fick rök' : ''}</span></div>`
    + `<div class="tk-hist">${p.hist.slice(0, 12).map(h => `<div><span>${h.time}</span>${esc(h.text)}</div>`).join('')}</div></div>`;
}
/** porträttet: pixelfiguren framifrån, förstorad 5 gånger (huvud och överkropp syns) @param {Person} p */
export function drawPortrait(p) {
  const [, col] = stateInfo(p), d = VIEW.dpr;
  pctx.setTransform(d, 0, 0, d, 0, 0);
  pctx.clearRect(0, 0, 64, 76);
  pctx.fillStyle = col + '33'; pctx.fillRect(0, 0, 64, 76);
  pctx.imageSmoothingEnabled = false;
  const spr = personSprite({ ...p, mood: p.dead ? 0 : p.mood }, 'front', 0, 1);
  pctx.drawImage(spr, 2, 4, spr.width * 5, spr.height * 5);
}
/** följ en person: spåra hen och låt kameran följa (null = sluta) @param {Person} p */
export function select(p) {
  S.sel = p; S.trackDirty = true; S.logDirty = true;
  if (p) { VIEW.follow = null; VIEW.camFloor = null; VIEW.camSel = true; } else VIEW.camSel = false;
}

// ---------- Overlays ----------
export function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; trDom(o); o.classList.add('show'); }
export function hideOverlay() { $('overlay').classList.remove('show'); }
// Välkomstrutan är kort så att KÖR! alltid syns: vad man tittar på, de tre viktigaste handgreppen och
// tangenterna. Resten ligger under "Mer om huset". Samma ruta är hjälpen (?) under spelet – då pausas
// tiden medan den är öppen. Enter, mellanslag och Esc stänger den.
let introKeys = /** @type {((ev: KeyboardEvent) => void)|null} */ (null);
/** mode: 'start' = första gången, innan huset börjar (KÖR! → then), 'help' = under spelet (pausar) */
export function showIntro(mode = S.started ? 'help' : 'start', then = /** @type {(() => void)|null} */ (null)) {
  const help = mode !== 'start', wasPaused = S.paused;
  // pekskärm (telefon, surfplatta): inga tangenter och ingen mus att hålla över
  const touch = matchMedia('(pointer: coarse)').matches, mob = document.body.classList.contains('mob');
  if (mode === 'help') S.paused = true;
  showOverlay(`<div class="card intro"><h1>TORNET${help ? ' · HJÄLP' : ''}</h1>
    <p>Välkommen till <b>Tornet</b> – åtta hissar styrda av <b>Hiss-O-Matic 3000</b>, ${FL.length} våningar och en massa folk med bråttom. <b>Huset sköter sig självt:</b> driftchefen tar besluten och berättar varför, och regissören 🎬 klipper bilden till det som händer. Luta dig tillbaka och titta.</p>
    ${help ? `<div class="intro-tour"><button class="btn" id="tour-go"${S.visning ? ' disabled' : ''}>🛎️ BE ${guideName().toUpperCase()} VISA RUNT</button><span>Ny i huset? ${esc(guideName())} visar dig runt och berättar vad du ser.</span></div>` : ''}
    <ul class="intro-short">
      ${mob ? `<li><b>Tryck</b> på en person, en hiss eller en våning för att följa den – allt om den finns under fliken 👤.</li>
      <li><b>Listen</b> nertill: ❚❚ paus, fart, 🔍 hela bredden (eller dubbeltryck i bilden) och flikarna 📻 nu, ⚡ framkalla, 🎛️ styrning och ☰ mer. Raden ovanför visar vad som händer – när något händer öppnas 🚨 av sig själv.</li>`
      : `<li><b>${touch ? 'Tryck' : 'Klicka'}</b> på en person, en hiss eller en våning för att följa den – allt om den syns i kontrollpanelen till vänster.</li>
      <li><b>Kontrollpanelen</b> anpassar sig efter vad som händer: när det är lugnt kan du framkalla incidenter och byta styrlogik, när något händer visar den bara det.</li>`}
      <li>Hissen eller våningen du följer har egna knappar: framkalla ett hissfel, en brand eller släpp in besökare just där.</li>
      <li>Knapparna är <b>ikoner</b> – ${touch ? 'håll fingret på en' : 'vila musen på en'} så står det vad den gör.</li>
      ${touch ? '<li><b>Dra</b> i bilden med ett finger för att se resten av huset; två fingrar zoomar.</li>' : `<li class="intro-keys"><kbd>Mellanslag</kbd> paus · <kbd>−</kbd>/<kbd>+</kbd> hastighet · <kbd>N</kbd> spola fram natten · <kbd>H</kbd> biografläge · <kbd>S</kbd> styrlogik · <kbd>T</kbd> namnbrickor · <kbd>F</kbd> koppla loss/på kameran · <kbd>A</kbd> regissör (kameran väljer själv) · <kbd>Esc</kbd> sluta följa/tillbaka</li>`}
    </ul>
    <button class="btn" id="go">${help ? 'TILLBAKA' : 'KÖR!'}</button>
    <details class="intro-more"><summary>Mer om huset</summary>
    <ul>
      <li>Det finns <b>inga knappar</b> på våningarna. Varje person har ett eget mål och får en egen hiss. Tankebubblan visar målet och hissen.</li>
      <li>Hissarna är <b>zonindelade</b>: L1–L2 går i låg zon (TB–5) och H1–H2 i hög zon (6–T) – <b>staplade i samma schakt</b>. Expresshissarna X1–X2 kör E ⇄ 6 utan stopp, och X1 går ända ner till <b>tunnelbanan</b> (TB) – där kommer folk i klump varje gång ett tåg stannar. Den som ska mellan zonerna <b>byter hiss</b> (↹) i entrén och i sky lobbyn. Varuhissen V tar städvagnar och paket, och panoramahissen P åker utanpå fasaden – hela vägen från tunnelbanan upp till taket.</li>
      <li>Huset <b>lever</b>: bilar kör in i garaget, leveransbilen lastar av vid kajen, de boende sover, jobbar och går på taket, en fönsterputsare jobbar sig nedåt utanför tornet, hundägare kommer med raggiga pudlar och går hem med nyklippta, och ibland landar en VIP-helikopter på taket.</li>
      <li>Ett <b>dygn</b> tar ungefär ${Math.round(dayLength() / 60)} minuter – stapeln överst i kontrollpanelen visar var i dygnet vi är och dagens incidenter. Trafiken följer dygnet – rusning på morgonen, lunch, hemgång (de får mest tid) – och på natten är det bara väktare, städare och nattugglor. Vissa våningar stänger (caféet, banken …).</li>
      <li><b>Huset sköter sig självt.</b> I <b>driftcentralen</b> på P1 sitter driftchefen (Gun-Britt på dagen, Rune på natten) och tar alla beslut när något händer – svajläge i stormen, brandzon, reservkraft, extrafläkt, service – och säger varför. Textskylten längst ner i bilden visar vad bevakaren (Ludde, på natten Siv) klipper till när regissören är på, och chefens beslut; driftradion står i kontrollpanelen. Vill du bestämma själv tar du över beslutet på incidentkortet.</li>
      <li><b>Incidenter</b> händer av sig själva: brand, strömavbrott, storm och hissfel – då kommer en hisstekniker och lagar. Slitna hissar går oftare sönder, och utan nattservice följer slitaget med till nästa dygn. När det är lugnt väljer du i kontrollpanelen styrlogik, hur ofta incidenter kommer (<b>slumpen</b>) och <b>framkallar</b> allt själv: blixt, flyttdag, VIP, tågstörning, kyla … En gång per dygn kan du fälla upp locket över den röda knappen <b>Murphys lag</b> – då går allt som kan gå fel fel, det ena efter det andra.</li>
      <li><b>Vaktmästaren</b> Bosse har sin post vid pannrummet på P1 och rycker ut när något går snett i vardagen: när fönsterputsarens gondol fastnar på fasaden, när en pudel rymmer från hundsalongen och åker hiss runt huset, och när ett vattenrör spricker – då springer han ner och stänger huvudkranen. På kvällen sköter kvällsvaktmästaren det, och på natten rings jouren in.</li>
      <li>Bilden visar <b>hallen framför hissarna</b> – rummen ligger bakom korridoren, och folk syns när de kommer ut för att vänta på hissen. Siffran vid korridoren är hur många som är inne.</li>
      <li><b>Klicka på en person</b> för att följa hen – kameran följer med och panelen visar vart hen ska och varför, även när hen är inne i rummen. <b>Klicka på en korridor</b> för att följa någon som är därinne, <b>på en hiss</b> för dess plan och last, och <b>på en våning</b> för att framkalla något där.</li>
      <li>${touch ? '<b>Dra</b> i bilden' : '<b>Scrolla</b> med mushjulet eller piltangenterna'} – då kopplas kameran loss, och regissören 🎬 tar den igen när du har låtit bli en stund. Slutar du följa någon tar regissören över direkt.</li>
      <li>Register 📋, logg 📜, inställningar ⚙️ och dagens resultat 🏆 ligger längst ner i kontrollpanelen.</li>
    </ul>
    </details></div>`);
  const go = () => {
    if (introKeys) { removeEventListener('keydown', introKeys, true); introKeys = null; }
    hideOverlay();
    if (help) { S.paused = wasPaused; return; }
    if (then) { then(); return; }
    S.started = true; log('Dag 1 börjar – dörrarna öppnas!', 'sys');
  };
  $('go').onclick = go;
  // (rundvisningen: guiden visar runt i huset som det är just nu, visning.js)
  if ($('tour-go')) $('tour-go').onclick = () => { go(); doAction('visning:now'); };
  /** @type {HTMLElement} */ ($('go')).focus();
  // fångas före spelets tangenter (annars pausar mellanslaget och Esc kopplar loss kameran)
  if (introKeys) removeEventListener('keydown', introKeys, true);
  introKeys = ev => {
    if (!['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(ev.code)) return;
    if (ev.code !== 'Escape' && /** @type {HTMLElement} */ (ev.target).closest('summary')) return; // (fäller ut "Mer om huset")
    ev.preventDefault(); ev.stopImmediatePropagation(); go();
  };
  addEventListener('keydown', introKeys, true);
}
extraActions.help = () => { if (S.started && !$('overlay').classList.contains('show')) showIntro('help'); };
