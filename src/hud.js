// HUD: texterna i kontrollpanelen (hissen eller personen man följer, incidentkorten, registret, loggen och
// resultatet), välkomstrutan och dygnets sammanfattning. Vilka block som syns i panelen avgörs i panels.js.
import { ARR, esc, fl } from './util.js';
import { CAP, EL, FIRE_HINT, FL, LOBBY, DOCK, TOP, ROLE_NAMES, activityRate, FULL_LOAD, timeScale, dayLength } from './config.js';
import { S, hour, log, phaseName } from './state.js';
import { liftsAvailable } from './people.js';
import { costBased, costLine, eta, isFull, pickTotal, pickersAt, loadKg, cabinKg, slotsFull } from './dispatch.js';
import { canRescue } from './incidents.js';
import { plannedRoute, resetDay } from './sim.js';
import { VIEW, pctx } from './view.js';
import { personSprite } from './pixpeople.js';
import { PAL } from './pixpal.js';
import { stateInfo } from './describe.js';
export { stateInfo };
import { residentDesc } from './life.js';
import { STORM_HINT, windMs } from './weather.js';
import { FAN_KW, jobFloor, tech, techOf, cableStatus } from './service.js';
import { LADDER_MAX, ladderReach, ropeWindy } from './pano.js';
import { hoistHalt, hoistStatus } from './hoist.js';
import { BLANKET_T } from './visits.js';
import { chiefOnDuty } from './chief.js';
import { CREW_BY } from './crew.js';
import { extraActions } from './input.js';

export function $(id) { return document.getElementById(id); }
// ---------- Hissen man följer: allt om hissen (förr hisspopupen) ----------
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
 *  Bara en uppskattning för gränssnittet: simuleringen slumpar arbetstiden först när arbetet börjar. */
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
export function carActs(e) {
  const b = [];
  b.push(`<button class="btn xs" data-act="car:off:${e.id}">${e.off ? '▶ Sätt i drift' : '⏸ Ta ur drift'}</button>`);
  if (e.mode === 'normal' && !e.serviceAsap && !e.hold && S.started) b.push(`<button class="btn xs" data-act="level:${e.id}" data-hint="Hissteknikern kommer direkt, även på dagen">🔧 Beställ service</button>`);
  if (!S.power && e.mode === 'normal' && e.passengers.length && !(e.state === 'doors' && e.door >= 0.95))
    b.push(`<button class="btn xs hot2" data-act="pow:rescue:${e.id}" ${canRescue(e) ? '' : 'disabled'}>🔋 Nödsänk (${e.passengers.length})</button>`);
  // framkalla något i just den här hissen
  if (S.started && e.mode === 'normal') {
    b.push(`<span class="trig-car">Framkalla:<button class="btn xs" data-act="trig:fault:${e.id}" data-hint="Hissen går sönder vid nästa stopp (ibland mellan två våningar med folk i)">🔧 Fel</button>`
      + `<button class="btn xs" data-act="trig:heat:${e.id}" ${e.hot ? 'disabled' : ''} data-hint="Kylningen hakar upp sig och motorn blir het">🌡️ Het</button>`
      + `${e.facade ? `<button class="btn xs" data-act="trig:pano" ${e.panoNext || S.pano ? 'disabled' : ''} data-hint="Hydrauliken låser sig nästa gång den kör med folk – korgen fastnar utanpå huset">🧗 Fast</button>` : `<button class="btn xs" data-act="trig:cable:${e.id}" ${e.snapNext ? 'disabled' : ''} data-hint="Linorna går av på nästa åktur">🪢 Linbrott</button>`}</span>`);
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
  const st = S.stats;
  const avg = st.waitN ? st.waitSum / st.waitN : 0;
  const ride = st.rideN ? st.rideSum / st.rideN : 0;
  const waitingNow = dayNumbers().waiting;
  const g = grade(avg), sg = safetyGrade();
  return `
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
    <div class="stat">Höll upp dörren <b>${st.holds}</b></div>
    <div class="stat">Avstod – för trångt <b>${st.crowdSkips}</b></div>
    <div class="stat">Tryckte på STÄNG <b>${st.closePresses}</b></div>
    <div class="stat">★ Majken pratade 💬 <b>${st.chats}</b></div>
    <div class="stat">Hissfel 🔧 <b>${st.faults}</b>${st.cables ? ` (linbrott <b>${st.cables}</b>)` : ''}</div>
    <div class="stat">Lagade / servade <b>${st.repairs} / ${st.serviced}</b></div>
${st.extraTechs ? `    <div class="stat">Extra tekniker <b>${st.extraTechs}</b></div>` : ''}
    <div class="stat">Stillestånd <b>${Math.round(st.downSec)} s</b></div>
    <div class="stat">Överhettade motorer 🌡️ <b>${st.heatStops}</b></div>
    <div class="stat">Vajerlarm i storm 🌬️ <b>${st.stormFaults}</b></div>
    <div class="stat">Nivåjusteringar <b>${st.relevels}</b></div>
    <div class="stat">Snubblade 🦶 <b>${st.stumbles}</b></div>
    <div class="stat">Dörren tog emot ❄️ <b>${st.doorFights}</b></div>
    <div class="stat">Ambulans 🚑 <b>${st.medical}</b></div>
    <div class="stat">Flyttlass 🚚 <b>${st.moveLoads}</b></div>
    <div class="stat">Övre däck / rulltrappa <b>${st.upperDeck} / ${st.escalator}</b></div>
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
    <div class="stat">Bus rensat <b>${st.nuisance}</b></div>
    ${learnMap()}
    <div class="grade">Service: ${st.waitN ? g.letter : '–'} <span class="stars">${st.waitN ? '★'.repeat(g.stars) + '☆'.repeat(5 - g.stars) : ''}</span> · Säkerhet: ${sg}</div>
${lastSummary ? `    <div class="row"><button class="btn xs" data-act="yesterday">🌅 Gårdagen (dag ${S.day - 1})</button></div>` : ''}`;
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
    + ` <button class="btn xs" data-act="chief:${key}" title="Driftchefen tar över beslutet igen">🧑‍💼 Låt driftchefen bestämma</button></div>`;
  if (!C || !C.on) return `<div class="inc-q">${q}</div>`;
  const who = esc(chiefOnDuty().name);
  return (d ? `<div class="inc-chief">🧑‍💼 <b>${who}:</b> ${esc(d.text)}${d.why ? ` <span class="why">– ${esc(d.why)}</span>` : ''}</div>`
    : `<div class="inc-chief">🧑‍💼 <b>${who}</b> håller ögonen på skärmarna…</div>`) + '<div class="inc-q">Ta över beslutet:</div>';
}
const chiefOn = () => !!(S.chief && S.chief.on);
export function incidentHtml() {
  const parts = [];
  // ---------- stormen (incident med val, som branden) ----------
  if (S.storm) {
    const St = S.storm, P = S.elevators.find(e => e.facade);
    const b = (m, txt) => `<button class="btn sm${St.mode === m ? ' on' : ''}" data-act="storm:${m}">${txt}</button>`;
    parts.push(card('storm', 'storm', `🌬️ Storm – <span class="lv">${windMs()}</span> m/s`, `
      <div class="inc-s">De höga schakten och panoramahissen på fasaden svajar. Bedarrar om ~${cd(St.t0 + St.len - S.t)}s.${St.faults ? ` Vajerlarm: <b>${num(St.faults)}</b>` : ''}</div>
      ${chiefLine('storm', 'Hur ska hissarna köras?')}
      <div class="inc-acts">${b('sway', '🌬️ Svajläge')}${b('none', 'Kör som vanligt')}</div>
      <div class="inc-hint">${STORM_HINT[St.mode]}</div>
      ${P ? `<div class="inc-acts"><button class="btn xs" data-act="follow:${P.id}">📹 Visa panoramahissen</button></div>` : ''}`, true));
  }
  // ---------- överhettade motorer (incident: extrafläkt) ----------
  for (const e of S.elevators) {
    if (!e.hot) continue;
    parts.push(card(`heat-${e.id}`, 'heat', `🌡️ Motorn i hiss ${esc(e.name)} är överhettad`, `
      <div class="inc-s">Överhettningsskyddet har löst ut (<span class="lv">${motorC(e)}</span> °C): ${esc(e.name)} kör klart sina passagerare men tar inga nya förrän motorn har svalnat.</div>
      ${chiefLine(`heat${e.id}`, 'Starta extrafläkten?')}
      <div class="inc-acts"><button class="btn sm${e.fan ? ' on' : ''}" data-act="fan:${e.id}" ${e.fan ? 'disabled' : ''}>🌀 ${e.fan ? 'Extrafläkten går' : 'Starta extrafläkt'}</button><button class="btn xs" data-act="follow:${e.id}">📹 Visa hissen</button></div>
      <div class="inc-hint">Fläkten kyler ungefär fyra gånger snabbare men drar ${FAN_KW} kW. Smart och Energisnål undviker varma motorer, Rusning tar risken längre, och Närmast, Kaos och Knappar bryr sig inte alls.</div>`, true));
  }
  // ---------- panoramahissen sitter fast på fasaden (incident med val: rep eller stegbil) ----------
  const Pn = S.pano;
  if (Pn && Pn.ph !== 'done') {
    const e = S.elevators[Pn.car], reach = ladderReach(e), windy = ropeWindy();
    const b = (h, txt, ok, hint) => `<button class="btn sm${Pn.how === h ? ' on' : ''}" data-act="pano:${h}" ${ok ? '' : 'disabled'} data-hint="${hint}">${txt}</button>`;
    const status = !Pn.crew ? `Räddningstjänsten är på väg (~${cd(Pn.crewAt - S.t)}s).`
      : !Pn.how ? 'Räddningstjänsten är på plats och väntar på besked.'
      : Pn.ph === 'stuck' ? (Pn.how === 'rope' ? 'Räddarna är på väg upp på taket med repet.' : 'Stegbilen ställer sig under korgen.')
      : Pn.ph === 'rig' ? (Pn.how === 'rope' ? 'Räddarna riggar repet ovanför korgen.' : 'Stegen reses mot korgen.')
      : Pn.rider ? `${esc((S.people.find(p => p.id === Pn.rider.id) || { name: 'Någon' }).name)} ${Pn.setup === 'rope' ? 'firas ner' : 'klättrar ner'} – ${Pn.out}/${Pn.n} ute.`
      : Pn.setup === 'rope' && windy ? `För blåsigt för repet (${windMs()} m/s) – räddarna väntar på taket. ${Pn.out}/${Pn.n} ute.` : `${Pn.out}/${Pn.n} ute.`;
    parts.push(card('pano', 'pano', `🧗 ${esc(e.name)} sitter fast på fasaden`, `
      <div class="inc-s">Hydrauliken har låst sig och korgen hänger utanpå huset med <span class="lv">${e.passengers.length + (Pn.rider ? 1 : 0)}</span> instängda. Den går inte att veva ner – de måste ut utanpå huset. ${status}</div>
      ${chiefLine('pano', 'Hur ska de instängda ut?')}
      <div class="inc-acts">${b('rope', '🧗 Rep från taket', true, `Räddarna firar ner en i taget ${Pn.toF === LOBBY ? 'till gatan' : 'till takterrassen'} – stannar i hård vind`)}${b('ladder', '🚒 Stegbilen', reach, reach ? 'Stegen från gatan – fungerar i blåst' : `Stegen når bara ${LADDER_MAX} våningar upp`)}<button class="btn xs" data-act="follow:${e.id}">📹 Visa hissen</button></div>
      <div class="inc-hint">Repet går fortare när det är lugnt; stegbilen klarar blåsten men når inte högt. Teknikern kan inte laga hydrauliken förrän alla är ute.</div>`, true));
  }
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
      `<button class="btn xs" data-act="follow:${e.id}">📹 Visa hissen</button>`);
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
          + `<div class="svc" title="▓ i flyttbilen · ▒ på lastkajen · ░ på väg · · i lägenheten">${bar}</div>`
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
      `${routes}${blank}${wind}${V && M.state !== 'planned' ? `<button class="btn xs" data-act="follow:${V.id}">📹 Följ varuhissen</button>` : ''}<button class="btn xs" data-act="show:${M.floor}">Visa våningen</button><button class="btn xs" data-act="show:${DOCK}">Lastkajen</button>`);
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
    const status = !F.brigade ? `Brandkåren är på väg – framme om ${cd(F.brigadeAt - S.t)}s`
      : F.outAt === null ? `Brandmännen är på väg upp${S.brigade && S.brigade.car !== null ? ` i brandhissen ${esc(S.elevators[S.brigade.car].name)}` : ' i trapphuset'}`
      : `Brandkåren släcker – klart om ${cd(F.outAt - S.t)}s`;
    const outside = S.people.filter(p => p.state === 'assembly').length;
    const b = (m, txt) => `<button class="btn sm${F.mode === m ? ' on' : ''}" data-act="fire:${m}">${txt}</button>`;
    parts.push(card('fire', 'fire', `🔥 Brand på våning ${fl(F.floor)}`, `
      <div class="inc-s">${status}. Våning ${fl(F.floor - 1)}–${fl(TOP)} utryms.</div>
      <div class="inc-s">Rökexponerade: <b>${num(F.smoked)}</b> · Utrymda: <b>${num(F.evac)}</b>${outside ? ` · På återsamlingsplatsen: <b>${num(outside)}</b>` : ''}</div>
      ${chiefLine('fire', 'Larmet återkallade hissarna – vill du köra dem annorlunda?')}
      <div class="inc-acts">${b('recall', '🚒 Brandåterkallning')}${b('zone', `🚧 Bara E–${fl(zmax)}`)}${b('none', 'Normal drift')}</div>
      <div class="inc-hint">${FIRE_HINT[F.mode]}</div>
      <div class="inc-acts"><button class="btn xs" data-act="show:${F.floor}">Visa våningen</button></div>`, true));
  }
  if (!S.power && S.outage) {
    const O = S.outage;
    const trapped = S.elevators.filter(e => e.mode === 'normal').reduce((a, e) => a + e.passengers.length, 0);
    const gen = O.gen ? `<button class="btn sm on" disabled>🔋 Reservkraft igång</button>`
      : O.genAt !== null ? `<button class="btn sm" disabled>🔋 Startar… ${cd(O.genAt - S.t)}s</button>`
        : `<button class="btn sm" data-act="pow:gen">🔋 Starta reservkraft</button>`;
    const busy = O.busy !== null ? `Nödsänker hiss ${EL[O.busy].name} just nu…` : O.gen ? 'Välj vilken hiss som ska nödsänkas nedan – eller slå på auto.' : '';
    parts.push(card('power', 'power', '⚡ Strömavbrott', `
      <div class="inc-s">Strömmen tillbaka om ~${cd(O.backAt - S.t)}s · Instängda nu: <b>${num(trapped)}</b> · Instängd-sek idag: <b>${num(S.stats.trappedSec)}</b></div>
      ${chiefLine('power', 'Vad gör du?')}
      <div class="inc-acts">${gen}<button class="btn sm${O.auto ? ' on' : ''}" data-act="pow:auto" ${O.gen ? '' : 'disabled'}>Auto-räddning: ${O.auto ? 'PÅ' : 'AV'}</button></div>
      <div class="inc-acts">${S.elevators.filter(e => e.mode === 'normal' && e.passengers.length && !(e.state === 'doors' && e.door >= 0.95)).map(e =>
        `<button class="btn xs hot2" data-act="pow:rescue:${e.id}" ${canRescue(e) ? '' : 'disabled'}>Nödsänk ${e.name} (${e.passengers.length} inne)</button>`).join('')}</div>
      <div class="inc-hint">${busy || (chiefOn() ? 'Reservkraften räcker till EN hiss i taget – driftchefen nödsänker fullaste hissen först (ambulanspersonalen allra först).' : 'Utan åtgärd sitter folk fast tills strömmen kommer tillbaka. Reservkraften räcker till EN hiss i taget – välj ordning, t.ex. fullaste först.')}</div>`, true));
  }
  return parts;
}
/** ett kort i incidentrutan: incidenter (alert) kan åtgärdas, informationsrutor (closable) bara stängas */
function card(k, cls, head, body, alert = false, closable = false) { return { k, cls: cls + (alert && chiefOn() ? ' calm' : ''), head, body, alert, closable }; }
// Incidentkorten i panelens händelseblock: incidenter är utfällda tills spelaren fäller ihop dem;
// informationsrutor fälls ut en stund när de dyker upp och fälls sedan ihop till en rad. (Bara gränssnittet.)
const INFO_OPEN_S = 12;
const incOpened = new Set(), incFolded = new Set(), incSeen = new Map();
const incIsOpen = c => (incFolded.has(c.k) ? false : incOpened.has(c.k) || c.alert || S.t - (incSeen.get(c.k) ?? S.t) < INFO_OPEN_S);
let incCards = [];
/** fäll ut eller ihop ett kort (knappen i rubriken eller den ihopfällda raden) */
export function foldInc(k) {
  const c = incCards.find(q => q.k === k);
  if (c && incIsOpen(c)) { incFolded.add(k); incOpened.delete(k); } else { incOpened.add(k); incFolded.delete(k); }
}
// Siffror som ändras hela tiden (nedräkningar, sekunder) ligger i <span class="lv">: panelen bygger bara om
// kortet när något annat ändras och uppdaterar annars bara siffrorna, så att knapparna går att klicka på.
const cd = sec => `<span class="lv">${Math.max(0, Math.ceil(sec))}</span>`;
const num = n => `<span class="lv">${Math.round(n)}</span>`;
/** korten just nu: html, hur många, och om någon är en incident (inte bara information) */
export function incidentPanel() {
  const cards = incCards = incidentHtml();
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
/** Personen man följer: vem, vart, varför och vad styrningen tänker. Porträttet ritas med drawPortrait. */
export function personHtml(p) {
  const [label, col] = stateInfo(p);
  let role = p.kind === 'emp' ? `Anställd · ${FL[p.home].name} (${fl(p.home)})${p.overtime ? ' · jobbar över' : ''}`
    : p.kind === 'res' ? residentDesc(p) : p.vip ? 'VIP-besök med helikopter 🚁' : p.role ? ROLE_NAMES[p.role] : 'Besökare';
  if (p.cast) role = `★ Stamgäst · ${p.title}`;
  if (p.crewId) role = `${CREW_BY[p.crewId].icon} ${p.title}`;
  else if (p.role === 'arbetsledare') role = `🦺 ${p.title}`;
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
/** porträttet: pixelfiguren framifrån, förstorad 5 gånger (huvud och överkropp syns) */
export function drawPortrait(p) {
  const [, col] = stateInfo(p), d = VIEW.dpr;
  pctx.setTransform(d, 0, 0, d, 0, 0);
  pctx.clearRect(0, 0, 64, 76);
  pctx.fillStyle = col + '33'; pctx.fillRect(0, 0, 64, 76);
  pctx.imageSmoothingEnabled = false;
  const spr = personSprite({ ...p, mood: p.dead ? 0 : p.mood }, 'front', 0, 1);
  pctx.drawImage(spr, 2, 4, spr.width * 5, spr.height * 5);
}
/** följ en person: spåra hen och låt kameran följa (null = sluta) */
export function select(p) {
  S.sel = p; S.trackDirty = true; S.logDirty = true;
  if (p) { VIEW.follow = null; VIEW.camFloor = null; VIEW.camSel = true; } else VIEW.camSel = false;
}

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
// Välkomstrutan är kort så att KÖR! alltid syns: vad man tittar på, de tre viktigaste handgreppen och
// tangenterna. Resten ligger under "Mer om huset". Samma ruta är hjälpen (?) under spelet – då pausas
// tiden medan den är öppen. Enter, mellanslag och Esc stänger den.
let introKeys = /** @type {((ev: KeyboardEvent) => void)|null} */ (null);
export function showIntro() {
  const help = !!S.started, wasPaused = S.paused;
  if (help) S.paused = true;
  showOverlay(`<div class="card intro"><h1>HISS-O-MATIC 3000${help ? ' · HJÄLP' : ''}</h1>
    <p>Välkommen till <b>Skyskrapan</b> – åtta hissar, ${FL.length} våningar och en massa folk med bråttom. <b>Huset sköter sig självt:</b> driftchefen tar besluten och berättar varför, och regissören 🎬 klipper bilden till det som händer. Luta dig tillbaka och titta.</p>
    <ul class="intro-short">
      <li><b>Klicka</b> på en person, en hiss eller en våning för att följa den – allt om den syns i kontrollpanelen till vänster.</li>
      <li><b>Kontrollpanelen</b> anpassar sig efter vad som händer: när det är lugnt kan du framkalla incidenter och byta styrlogik, när något händer visar den bara det.</li>
      <li>Hissen eller våningen du följer har egna knappar: framkalla ett hissfel, en brand eller släpp in besökare just där.</li>
      <li class="intro-keys"><kbd>Mellanslag</kbd> paus · <kbd>−</kbd>/<kbd>+</kbd> hastighet · <kbd>H</kbd> biografläge · <kbd>S</kbd> styrlogik · <kbd>T</kbd> namnbrickor · <kbd>F</kbd> koppla loss/på kameran · <kbd>A</kbd> regissör (kameran väljer själv) · <kbd>Esc</kbd> sluta följa/tillbaka</li>
    </ul>
    <button class="btn" id="go">${help ? 'TILLBAKA' : 'KÖR!'}</button>
    <details class="intro-more"><summary>Mer om huset</summary>
    <ul>
      <li>Det finns <b>inga knappar</b> på våningarna. Varje person har ett eget mål och får en egen hiss. Tankebubblan visar målet och hissen.</li>
      <li>Hissarna är <b>zonindelade</b>: L1–L2 går i låg zon (TB–5) och H1–H2 i hög zon (6–T) – <b>staplade i samma schakt</b>. Expresshissarna X1–X2 kör E ⇄ 6 utan stopp, och X1 går ända ner till <b>tunnelbanan</b> (TB) – där kommer folk i klump varje gång ett tåg stannar. Den som ska mellan zonerna <b>byter hiss</b> (↹) i entrén och i sky lobbyn. Varuhissen V tar städvagnar och paket, och panoramahissen P åker utanpå fasaden.</li>
      <li>Huset <b>lever</b>: bilar kör in i garaget, leveransbilen lastar av vid kajen, de boende sover, jobbar och går på taket, en fönsterputsare jobbar sig nedåt utanför tornet, hundägare kommer med raggiga pudlar och går hem med nyklippta, och ibland landar en VIP-helikopter på taket.</li>
      <li>Ett <b>dygn</b> tar ungefär ${Math.round(dayLength() / 60)} minuter – stapeln överst i kontrollpanelen visar var i dygnet vi är och dagens incidenter. Trafiken följer dygnet – rusning på morgonen, lunch, hemgång (de får mest tid) – och på natten är det bara väktare, städare och nattugglor. Vissa våningar stänger (caféet, banken …).</li>
      <li><b>Huset sköter sig självt.</b> I <b>driftcentralen</b> på P1 sitter driftchefen (Gun-Britt på dagen, Rune på natten) och tar alla beslut när något händer – svajläge i stormen, brandzon, reservkraft, extrafläkt, service – och säger varför. Kontrollpanelen visar bevakaren (Ludde, på natten Siv) som klipper bilden när regissören är på, chefens beslut och driftradion. Vill du bestämma själv tar du över beslutet på incidentkortet.</li>
      <li><b>Incidenter</b> händer av sig själva: brand, strömavbrott, storm och hissfel – då kommer en hisstekniker och lagar. Slitna hissar går oftare sönder, och utan nattservice följer slitaget med till nästa dygn. När det är lugnt väljer du i kontrollpanelen styrlogik, hur ofta incidenter kommer (<b>slumpen</b>) och <b>framkallar</b> allt själv: blixt, flyttdag, VIP, tågstörning, kyla …</li>
      <li>Bilden visar <b>hallen framför hissarna</b> – rummen ligger bakom korridoren, och folk syns när de kommer ut för att vänta på hissen. Siffran vid korridoren är hur många som är inne.</li>
      <li><b>Klicka på en person</b> för att följa hen – kameran följer med och panelen visar vart hen ska och varför, även när hen är inne i rummen. <b>Klicka på en korridor</b> för att följa någon som är därinne, <b>på en hiss</b> för dess plan och last, och <b>på en våning</b> för att framkalla något där.</li>
      <li><b>Scrolla</b> med mushjulet eller piltangenterna – då kopplas kameran loss, och <kbd>F</kbd> kopplar på den igen.</li>
      <li>Register, logg, inställningar och dagens resultat ligger längst ner i kontrollpanelen.</li>
    </ul>
    </details></div>`);
  const go = () => {
    if (introKeys) { removeEventListener('keydown', introKeys, true); introKeys = null; }
    hideOverlay();
    if (help) { S.paused = wasPaused; return; }
    S.started = true; log('Dag 1 börjar – dörrarna öppnas!', 'sys');
  };
  $('go').onclick = go;
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
extraActions.help = () => { if (!$('overlay').classList.contains('show')) showIntro(); };
extraActions.yesterday = () => { if (!$('overlay').classList.contains('show')) showYesterday(); };
/** flyttdagen i resultatet (tom om ingen flyttade i dag) */
function moveSummary() {
  const M = S.move;
  if (!M || M.state === 'planned') return '';
  const dur = M.state === 'done' ? `${Math.round(M.t1 - M.t0)} s` : 'blev inte klar';
  const route = { auto: 'styrningen planerade', varu: 'allt i varuhissen', balk: 'tungt utanpå' }[M.route];
  return `<div>🚚 Flytten (${esc(M.who)}): <b>${dur}</b> · ${route}</div><div>Via varuhissen <b>${M.viaV}</b> · hissbalken <b>${M.hoisted}</b> lass</div>
      <div>Varuhissen låst: <b>${Math.round(M.indepSec)} s</b>${M.blankets ? ' (med skyddsfiltar)' : ` · repor <b>${M.scratches}</b>`}</div><div>Buden väntade som mest: <b>${Math.round(M.budWait)} s</b>${M.dockWait ? ` · flyttbilen väntade ${Math.round(M.dockWait)} s` : ''}</div>
      <div>Vändes i dörren: <b>${M.pivots}</b>${M.stuck ? ` (fastnade helt ${M.stuck})` : ''}</div><div>Tappat: <b>${M.broken}</b> lass 💥</div>`;
}
/** dagens sammanfattning: driftchefens (och spelarens) beslut och hur det gick */
function chiefSummary() {
  const C = S.chief;
  const ds = C ? C.log.filter(d => !d.info) : [];
  if (!ds.length) return `<div class="chiefsum"><h2>🧑‍💼 Driftchefens dag</h2><p>Ett lugnt dygn – inga beslut behövde tas.</p></div>`;
  const rows = ds.slice(-14).map(d => `<li><span class="ct">${d.time}</span> ${d.by === 'player' ? '👤 <b>Du:</b>' : '🧑‍💼'} <b>${esc(d.text)}</b>`
    + `${d.why ? ` <span class="why">– ${esc(d.why)}</span>` : ''}${d.outcome ? `<div class="out">→ ${esc(d.outcome)}</div>` : ''}</li>`).join('');
  const mine = ds.filter(d => d.by === 'player').length;
  return `<div class="chiefsum"><h2>🧑‍💼 Driftchefens dag</h2><p>${ds.length - mine} beslut av driftchefen${mine ? `, ${mine} av dig` : ''}${ds.length > 14 ? ' (de senaste 14)' : ''}.</p><ul>${rows}</ul></div>`;
}
/** gårdagens sammanfattning efter ett mjukt dygnsskifte (visas med knappen på informationsrutan) */
let lastSummary = '';
/** Dygnet är slut. Mjukt dygnsskifte: sammanfattningen sparas och huset rullar vidare (sim.js rollDay);
 *  annars stannar spelet och NÄSTA DAG börjar om från början. */
export function showSummary() {
  if (S.roll === 'mjuk') { lastSummary = summaryHtml(`DAG ${S.day} ÄR SLUT`, '<button class="btn" id="next">FORTSÄTT ▶</button>'); return; }
  S.summaryShown = true; S.paused = true;
  showOverlay(summaryHtml('DYGNET ÄR SLUT!', '<button class="btn" id="next">NÄSTA DAG ▶</button>'));
  $('next').onclick = () => { hideOverlay(); newDay(); };
}
/** visa gårdagens sammanfattning (spelet står still medan den är uppe) */
export function showYesterday() {
  if (!lastSummary) return;
  const was = S.paused;
  S.paused = true;
  showOverlay(lastSummary);
  $('next').onclick = () => { hideOverlay(); S.paused = was; };
}
function summaryHtml(title, button) {
  const st = S.stats, avg = st.waitN ? st.waitSum / st.waitN : 0, g = grade(avg);
  const names = { smart: 'Smart', peak: 'Rusning', eco: 'Energisnål', nearest: 'Närmast', random: 'Kaos', buttons: 'Knappar' };
  return `<div class="card"><h1>${title}</h1>
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
      <div>Hissfel: <b>${st.faults}</b>${st.cables ? `, varav linbrott <b>${st.cables}</b>` : ''} (stillestånd ${Math.round(st.downSec)} s)</div><div>Nattservice: <b>${st.serviced}</b> hissar</div>
      <div>Energi: <b>${st.energy.toFixed(1)} kWh</b> (körning ${st.energyRun.toFixed(1)})</div><div>Återmatat: <b>${st.regen.toFixed(1)} kWh</b></div>
      <div>★ Gunnar gnällde: <b>${st.gripes}</b> gånger</div><div>★ Kurts kaffekoppar: <b>${st.cups}</b></div>
      <div>Höll upp dörren: <b>${st.holds}</b> gånger</div><div>★ Majken pratade: <b>${st.chats}</b> gånger</div>
      <div>Väder: <b>${S.weather.temp} °C</b>${S.weather.cold > 0 ? ` (dörren tog emot ${st.doorFights} ggr)` : ''}</div><div>Vajerlarm i storm: <b>${st.stormFaults}</b></div>
      <div>Överhettade motorer: <b>${st.heatStops}</b></div><div>Snubbel på tröskeln: <b>${st.stumbles}</b></div>
      <div>Ambulans: <b>${st.medical}</b></div><div>Flyttlass: <b>${st.moveLoads}</b></div>
      <div>Övre däcket: <b>${st.upperDeck}</b> resor</div><div>Inlärda parkeringar: <b>${st.learnedParks}</b></div>
      <div>Tåg vid perrongen: <b>${st.trains}</b></div><div>Med tunnelbanan: <b>${st.trainIn}</b> in · <b>${st.trainOut}</b> hem</div>
      ${moveSummary()}
      <div>Tog trappan frivilligt: <b>${st.stairsChoice}</b></div><div>Mest sliten: <b>${S.elevators.reduce((a, e) => (e.wear > a.wear ? e : a)).name} ${Math.round(Math.max(...S.elevators.map(e => e.wear)) * 100)} %</b></div>
    </div>
    ${chiefSummary()}
    ${button}</div>`;
}
export function newDay() {
  S.day++;
  resetDay();
  S.paused = false;
  log(`Dag ${S.day} börjar!`, 'sys');
}
