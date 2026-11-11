// HUD: topplist, hisspopup, flytande incidentruta och lådan med spårning, register, logg och resultat.
import { ARR, K, esc, fl } from './util.js';
import { CAP, CAR_H, EL, FIRE_HINT, FL, STRAT_HINT, TOP, ROLE_NAMES, timeScale, FULL_LOAD, floorY, shaftX } from './config.js';
import { S, clockStr, hour, log, phaseName } from './state.js';
import { liftsAvailable } from './people.js';
import { allowed, costLine, eta, isFull, pickTotal, pickersAt, loadKg, cabinKg, slotsFull } from './dispatch.js';
import { canRescue } from './incidents.js';
import { plannedRoute, resetDay } from './sim.js';
import { VIEW, cv, pctx, resize, stage } from './view.js';
import { personSprite } from './pixpeople.js';
import { PAL } from './pixpal.js';
import { stateInfo } from './describe.js';
export { stateInfo };
import { residentDesc } from './life.js';
import { updatePauseBtn } from './input.js';

// ---------- HUD: DOM ----------
export function $(id) { return document.getElementById(id); }
// Hisspopupen: öppnas när man klickar på en hiss och visar allt som förr stod på hisskorten.
let carEl = null;
export function buildHud() {
  const el = $('carPop');
  el.innerHTML = `<div class="car-head"><span class="nm"></span><span class="st"></span><span class="fl"></span><button class="tk-x" data-act="carpop:close" title="Stäng (Esc)">✕</button></div>
    <div class="zone"></div><div class="load"><i></i><span></span></div><div class="plan"></div><div class="why"></div>
    <div class="who"></div><div class="acts"></div><div class="meta"></div>`;
  carEl = {
    nm: el.querySelector('.nm'), st: el.querySelector('.st'), fl: el.querySelector('.fl'), zone: el.querySelector('.zone'),
    bar: el.querySelector('.load i'), ld: el.querySelector('.load span'), plan: el.querySelector('.plan'), why: el.querySelector('.why'),
    who: el.querySelector('.who'), acts: el.querySelector('.acts'), meta: el.querySelector('.meta'), whoKey: '', actKey: '', id: -1,
  };
  $('stratHint').innerHTML = STRAT_HINT[S.strategy];
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
  const key = e.passengers.map(p => p.id).join(',');
  if (key !== c.whoKey) {
    c.whoKey = key;
    c.who.innerHTML = n ? 'Ombord: ' + e.passengers.map(p => `<span data-pid="${p.id}">${esc(p.name)}</span>→${fl(p.dest)}${p.goal !== p.dest && !p.viaStairs ? `↹${fl(p.goal)}` : ''}`).join(', ') : 'Ombord: –';
  }
  const acts = carActs(e);
  if (acts !== c.actKey) { c.actKey = acts; c.acts.innerHTML = acts; }
  c.meta.textContent = `${Math.round(e.distance)} vån åkta · ${e.trips} stopp`;
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
export function zoneText(d) {
  if (d.express) return `${fl(d.minF)} ⇄ ${fl(d.maxF)} · express`;
  if (d.facade) return `${d.serves.map(fl).join(' · ')} · panorama i glas`;
  if (d.freight) return `${fl(d.minF)}–${fl(d.maxF)} · varuhiss ${d.ratedKg} kg`;
  return `${fl(d.minF)}–${fl(d.maxF)} · ${d.group} zon`;
}
export function stateLabel(e) {
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
  if (e.sleep) return `Sover vid ${fl(e.home)} för att spara energi – vaknar om det bildas kö`;
  if (e.mode === 'recall') return 'Brandåterkallning: kör direkt till E utan stopp och släpper ut alla';
  if (e.mode === 'locked') return 'Avstängd i E med öppna dörrar tills branden är släckt';
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
export function carActs(e) {
  const b = [];
  b.push(`<button class="btn xs${VIEW.follow === e.id ? ' on' : ''}" data-act="follow:${e.id}">📹 ${VIEW.follow === e.id ? 'Följer' : 'Följ hissen'}</button>`);
  b.push(`<button class="btn xs" data-act="car:off:${e.id}">${e.off ? 'Sätt i drift' : 'Ta ur drift'}</button>`);
  if (!S.power && e.mode === 'normal' && e.passengers.length && !(e.state === 'doors' && e.door >= 0.95))
    b.push(`<button class="btn xs hot2" data-act="pow:rescue:${e.id}" ${canRescue(e) ? '' : 'disabled'}>🔋 Nödsänk (${e.passengers.length})</button>`);
  return b.join('');
}
export function updateHud() {
  const h = hour();
  $('clock').textContent = clockStr(h);
  $('phase').textContent = phaseName(h) + (timeScale(h) > 30 ? ' ⏩' : '');
  $('day').textContent = `Dag ${S.day} · ${S.people.length} pers · frö ${S.seed}`;
  updateCarPop();
  if (S.logDirty && isOpen('log')) {
    S.logDirty = false;
    const f = S.logFilter, sid = S.sel ? S.sel.id : -1;
    const rows = S.log.filter(l => f === 'all' || (f === 'person' ? l.kind === 'person' : f === 'lift' ? l.kind !== 'person' : l.pid === sid)).slice(0, 80);
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
    <div class="stat">Hissbyten <b>${st.transfers}</b></div>
    <div class="stat">Bilar in i garaget <b>${st.carsIn}</b></div>
    <div class="stat">Paketleveranser <b>${st.deliveries}</b></div>
    <div class="stat">VIP-besök 🚁 <b>${st.vips}</b></div>
    <div class="grade">Service: ${st.waitN ? g.letter : '–'} <span class="stars">${st.waitN ? '★'.repeat(g.stars) + '☆'.repeat(5 - g.stars) : ''}</span> · Säkerhet: ${sg}</div>`;
  updateIncidents();
}
export function incidentHtml() {
  const parts = [];
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
const live = t => `<span class="lv">${esc(t)}</span>`;
const LV = /<span class="lv">([^<]*)<\/span>/g;
export function updateIncidents() {
  const html = incidentHtml();
  const shape = html.replace(LV, '<span class="lv"></span>');
  if (shape !== S.incHtml) { S.incHtml = shape; $('incBody').innerHTML = html; }
  else {
    const vals = [...html.matchAll(LV)].map(m => m[1]);
    $('incBody').querySelectorAll('.lv').forEach((el, i) => { if (el.textContent !== vals[i]) el.textContent = vals[i]; });
  }
  // rutan syns bara när något händer
  const alerting = !!(S.fire || !S.power);
  if ($('incPanel').hidden === alerting) $('incPanel').hidden = !alerting;
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
    return `<div class="rr${p.id === sid ? ' sel' : ''}" data-pid="${p.id}"><i style="background:${col}"></i><span>${esc(p.name)} <span class="rd">${p.id}</span></span><span>${where}</span><span class="rt">${t}</span></div>`;
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
      if (p.assigned !== null) {
        const e = S.elevators[p.assigned];
        now += ` · ${e.name} är här om ~${Math.round(eta(e, p.floor, p.dir))}s`;
        logic = S.strategy === 'smart' ? `Kostnad hämtning+resa: ${costLine(p, e.id)}`
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
    case 'office': now = p.sleeping && p.spot.bed ? `Sover i sängen (${fl(p.floor)}) 💤` : `${p.spot.desc} (${FL[p.floor].short})`; logic = `Nästa beslut om ~${Math.max(0, Math.round(p.timer))}s`; break;
    case 'away': now = 'Är inte i huset just nu'; logic = `Kommer tillbaka ca ${clockStr(p.returnAt)}`; break;
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
  if (p) VIEW.follow = null;
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
    <p>Välkommen till <b>Skyskrapan</b>! Garage och lastkaj i källaren, kontor från tandläkare till labb, en sky lobby på 6:an, bostäder högst upp och en takterrass med helikopterplatta – åtta hissar och en massa folk med bråttom.</p>
    <ul>
      <li>Det finns <b>inga knappar</b> på våningarna. Varje person har ett eget mål och får en egen hiss. Tankebubblan visar målet och hissen.</li>
      <li>Hissarna är <b>zonindelade</b>: L1–L2 går i låg zon (P2–5) och H1–H2 i hög zon (6–T) – <b>staplade i samma schakt</b>. Expresshissarna X1–X2 kör E ⇄ 6 utan stopp. Den som ska mellan zonerna <b>byter hiss</b> (↹) i entrén och i sky lobbyn. Varuhissen V tar städvagnar och paket, och panoramahissen P åker utanpå fasaden.</li>
      <li>Huset <b>lever</b>: bilar kör in i garaget, leveransbilen lastar av vid kajen, de boende sover, jobbar och går på taket, en fönsterputsare jobbar sig nedåt och ibland landar en VIP-helikopter på taket.</li>
      <li>Ett <b>dygn</b> går från 06:00 till 06:00. Trafiken följer klockan – rusning på morgonen, lunch, hemgång – och på natten är det bara väktare, städare och nattugglor. Vissa våningar stänger (caféet, banken …). Natten går fortare ⏩.</li>
      <li><b>Incidenter</b> händer: brand och strömavbrott. Då dyker en ruta upp med dina val. Under <b>⋯</b> kan du utlösa dem själv.</li>
      <li>Bilden visar <b>hallen framför hissarna</b> – rummen ligger bakom korridoren, och folk syns när de kommer ut för att vänta på hissen. Siffran vid korridoren är hur många som är inne.</li>
      <li><b>Klicka på en person</b> för att spåra hen – en lapp följer personen och 👤 visar allt, även när hen är inne i rummen. <b>Klicka på en korridor</b> för att spåra någon som är därinne. <b>Klicka på en hiss</b> för dess plan, last och knappen 📹 Följ.</li>
      <li>Klicka på en tom yta på en våning för att släppa in en besökare. <b>BUSS!</b> släpper in en busslast.</li>
      <li><b>Scrolla</b> med mushjulet eller piltangenterna, eller klicka i översikten till höger. Kameran följer den du spårar.</li>
      <li>📋 register, 📜 logg och 🏆 resultat öppnas i en låda till höger.</li>
      <li><kbd>Mellanslag</kbd> paus · <kbd>1</kbd>–<kbd>4</kbd> hastighet · <kbd>S</kbd> styrlogik · <kbd>Z</kbd> hela huset · <kbd>T</kbd> namnbrickor · <kbd>Esc</kbd> stäng/sluta spåra</li>
    </ul>
    <button class="btn" id="go">KÖR!</button></div>`);
  $('go').onclick = () => { hideOverlay(); S.started = true; log('Dag 1 börjar – dörrarna öppnas!', 'sys'); };
}
export function showSummary() {
  S.summaryShown = true; S.paused = true;
  const st = S.stats, avg = st.waitN ? st.waitSum / st.waitN : 0, g = grade(avg);
  const names = { smart: 'Smart', nearest: 'Närmast', random: 'Kaos' };
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
