// Husets liv: bilar i garaget, leveranser vid lastkajen, de boendes dygnsrutiner och VIP-besök med helikopter.
import { stream } from './rng.js';
import { sv } from './sv.js';
const { pick, rand, rng } = stream('liv');
// buden är ankomster: en egen ström, som dras lika många gånger oavsett hur det går för hissarna
const BUD = stream('bud');
import { fl } from './util.js';
import { DOCK, FL, GARAGE_FLOORS, HOME_FLOORS, LOBBY, OFFICE_FLOORS, ROOF, SPOTS, floorOpen, floorWith, pace } from './config.js';
import { S, clockStr, hour, log, occOf, setOcc } from './state.js';
import { makePerson, openFloors, pev, pn, setTrip } from './people.js';
import { castResident } from './cast.js';
import { movingResNext } from './visits.js';
/** @typedef {import('./people.js').Person} Person */

// ---------- Garaget ----------
// Parkeringsplatser per garagevåning (P1 har lastkaj till vänster och färre platser)
export const SLOTS = { P2: [130, 200, 270, 340, 410, 480], P1: [330, 400, 470] };
const CAR_COLORS = ['#ff5d52', '#36c5d6', '#ffc93c', '#7c5cff', '#22c55e', '#f97316', '#e11d74', '#94a3b8'];
const slotList = () => GARAGE_FLOORS.flatMap(f => (SLOTS[FL[f].label] || []).map(x => ({ floor: f, x })));
function freeSlot() {
  const free = slotList().filter(s => !S.autos.some(a => a.floor === s.floor && a.slot === s.x));
  return free.length ? pick(free) : null;
}
/** En bil i garaget @typedef {{ id: number, floor: number, slot: number, x: number, state: string, color: string, owner: number }} Auto */
/** Leveransbilen vid lastkajen (S.truck) @typedef {{ x: number, state: string, sent: number }} Truck */
/** Ett VIP-besök som kommer med helikopter (S.vipVisits) @typedef {{ at: number, goal: number, done?: boolean }} VipVisit */
/** VIP-helikoptern (S.heli) @typedef {{ state: string, y: number, visit: VipVisit }} Heli */
/** Personen kommer med bil: bilen kör in i garaget och personen kliver ur. Falskt om garaget är fullt. @param {Person} p */
export function arriveByCar(p, parked = false) {
  const s = freeSlot();
  if (!s) return false;
  const auto = { id: S.nextAutoId++, floor: s.floor, slot: s.x, x: parked ? s.x : -140, state: parked ? 'parked' : 'in', color: pick(CAR_COLORS), owner: p.id };
  S.autos.push(auto);
  p.auto = auto; p.exitFloor = s.floor; p.floor = s.floor;
  if (!parked) {
    setTrip(p, p.goal, p.why);
    p.state = 'incar'; p.x = auto.x;
    S.stats.carsIn++;
    pev(p, sv`Kör in i garaget på ${fl(s.floor)} och parkerar`);
  }
  return true;
}
/** Personen lämnar huset: med bil (bilen kör ut), till fots – eller för de boende: är borta en stund @param {Person} p */
export function leaveBuilding(p) {
  // utrymd vid brand: väntar på återsamlingsplatsen utanför entrén och går in igen när branden är släckt
  // (även den som kom med bil eller tåg: bilen står kvar i garaget)
  if (p.evac && S.fire && p.floor === LOBBY && !p.role && !p.vip && !p.movedOut && ['emp', 'vis', 'res'].includes(p.kind)) {
    p.state = 'assembly'; p.backAt = undefined; S.fire.assembled++;
    pev(p, 'Ute! Väntar på återsamlingsplatsen utanför entrén tills branden är släckt');
    return;
  }
  if (p.auto) { p.auto.state = 'out'; p.auto = null; }
  if (p.kind === 'res' && !p.movedOut) {
    const ev = p.sched.find(e => !e.done && e.go === 'home');
    p.state = 'away'; p.returnAt = ev ? ev.at : 99; p.spot = null;
    pev(p, sv`Går ut · ${p.why}${ev ? sv` – tillbaka ca ${clockStr(ev.at)}` : ''}`);
    log(sv`${pn(p)} går hemifrån · ${p.why}`, 'person', null, p.id);
    return;
  }
  // en flyttgubbe som går (utrymd vid brand) lämnar det hen packade eller bar i lägenheten – samma steg, så att
  // lasset aldrig står utan bärare (visits.js hämtar det igen när flyttgubbarna kommer tillbaka)
  if (p.mover && p.item !== null && p.item !== undefined && S.move) {
    const it = S.move.items[p.item];
    if (it && (it.st === 'packing' || it.st === 'carried')) it.st = 'home';
    p.item = null;
  }
  p.dead = true;
  pev(p, p.movedOut ? 'Flyttar härifrån – hejdå huset!' : 'Lämnar huset – hejdå!');
  log(sv`${pn(p)} lämnar huset${p.exitFloor !== LOBBY ? sv` (från ${fl(p.exitFloor)})` : ''}`, 'person', null, p.id);
}
/** Branden är släckt: tillbaka in från återsamlingsplatsen – dit man var på väg, eller hem om det har blivit sent @param {Person} p */
export function backFromAssembly(p) {
  p.evac = false; p.state = 'toQueue'; p.floor = LOBBY; p.x = -30 - rand(0, 30);
  // (gästen på rundvisningen går in i entrén igen – guiden väntar där, visning.js)
  if (p.guest && p.touring) { p.evacFrom = undefined; setTrip(p, LOBBY, 'Tillbaka in efter branden – guiden väntar', false); return; }
  if (!fireReturn(p, 'Tillbaka in efter branden')) leaveBuilding(p);
}
/** Efter branden: p går tillbaka dit hen var (evacFrom). Falskt om det inte finns något att gå tillbaka till –
 *  hen var på väg ut, det har blivit sent eller våningen har stängt. @param {Person} p */
export function fireReturn(p, why) {
  const h = hour(), to = p.evacFrom;
  p.evacFrom = undefined;
  if (to === undefined || to === LOBBY || to === p.exitFloor || h >= 21 || !floorOpen(to, h) && to !== p.home) return false;
  setTrip(p, to, why, false);
  pev(p, sv`Branden är släckt – går in igen till ${fl(to)}`);
  return true;
}
function autoTick(dt) {
  for (const a of S.autos) {
    if (a.state === 'in') {
      a.x = Math.min(a.slot, a.x + 170 * dt);
      if (a.x >= a.slot) {
        a.state = 'parked';
        const p = S.people.find(q => q.id === a.owner);
        if (p && p.state === 'incar') { p.state = 'toQueue'; p.x = a.x + 22; }
      }
    } else if (a.state === 'out') a.x -= 170 * dt;
  }
  S.autos = S.autos.filter(a => a.x > -170);
}

// ---------- Lastkajen ----------
function truckTick(dt) {
  const h = hour(), T = S.truck;
  if (!T && h >= 8 && h < 11.5) {
    // lastkajen har plats för en bil: står flyttbilen där får leveransbilen (och buden) vänta på gatan
    if (S.move && S.move.state === 'on') {
      if (!S.move.notes.truck) { S.move.notes.truck = true; log('🚚 Leveransbilen får vänta på gatan – flyttbilen står vid lastkajen, buden kommer senare', 'alert'); }
      return;
    }
    if (S.heist && S.heist.van !== 'gone') return; // (kuppens skåpbil står vid kajen – heist.js)
    S.truck = { x: -260, state: 'in', sent: 0 }; log('🚚 Leveransbilen backar in vid lastkajen på P1', 'sys'); return;
  }
  if (!T) return;
  if (T.state === 'in') { T.x = Math.min(70, T.x + 150 * dt); if (T.x >= 70) T.state = 'parked'; }
  else if (T.state === 'parked') {
    const busy = S.people.filter(p => p.role === 'bud').length;
    if (h < 11.5) { const r = BUD.rng(); if (busy < 3 && r < 0.03 * pace(h) * dt) spawnCourier(); } // (per speltimme)
    if (h >= 12 && busy === 0) { T.state = 'out'; log('🚚 Leveransbilen kör iväg', 'sys'); }
  } else if (T.state === 'out') { T.x -= 150 * dt; if (T.x < -300) S.truck = null; }
}
function spawnCourier() {
  const goals = openFloors().filter(f => f !== floorWith('sky'));
  if (!goals.length) return;
  const p = makePerson('staff', DOCK, S.truck.x + 150);
  p.role = 'bud'; p.exitFloor = DOCK; p.cargo = { kind: 'paket', name: 'paketkärra', kg: 40 };
  const g = BUD.pick(goals);
  setTrip(p, g, sv`Levererar paket till ${FL[g].short}`);
  S.people.push(p); S.truck.sent++;
  pev(p, sv`Lastar av paket vid lastkajen · ${p.why} (${fl(g)})`);
  log(sv`📦 ${pn(p)} levererar till ${fl(g)} – tar varuhissen`, 'person', null, p.id);
}

// ---------- De boende ----------
// Hushåll per bostadsvåning: [vänster lägenhet, höger lägenhet]
const HOUSEHOLDS = [
  [['worker:bil', 'worker', 'child'], ['student']],
  [['pensioner'], ['worker:bil', 'worker']],
  [['vd:bil'], ['artist']],
];
const R = (a, b) => rand(a, b);
// Rutiner: go = 'out' (lämnar huset), 'home', eller en våningstagg (roof …)
function routine(type) {
  switch (type) {
    case 'worker': return { wake: R(6.2, 6.8), sleep: R(22.5, 23.5), ev: [
      { at: R(7, 8.3), go: 'out', why: 'Till jobbet' }, { at: R(16.5, 18.3), go: 'home', why: 'Hem från jobbet' },
      ...(rng() < 0.35 ? [{ at: R(18.6, 19.2), go: 'roof', why: 'Kvällssol på takterrassen' }, { at: R(19.4, 19.9), go: 'home', why: 'Hem från takterrassen' }] : [])] };
    case 'child': return { wake: R(6.6, 7), sleep: R(19.8, 20.3), ev: [
      { at: R(7.4, 7.8), go: 'out', why: 'Till skolan' }, { at: R(15, 15.5), go: 'home', why: 'Hem från skolan' },
      { at: R(16, 16.8), go: 'roof', why: 'Leker på takterrassen' }, { at: R(17.5, 18), go: 'home', why: 'Middag!' }] };
    case 'student': return { wake: R(8.3, 9), sleep: R(25.5, 27.5), ev: [
      { at: R(9.3, 10.5), go: 'out', why: 'Till föreläsningen' }, { at: R(15.5, 17), go: 'home', why: 'Hem från skolan' },
      { at: R(21, 22), go: 'out', why: 'Ut och festar' }, { at: R(24, 25.5), go: 'home', why: 'Hem från festen (tyst i hissen …)' }] };
    case 'pensioner': return { wake: R(6.5, 7.2), sleep: R(21, 22), ev: [
      { at: R(10, 10.8), go: 'out', why: 'Handlar på torget' }, { at: R(11.5, 12.2), go: 'home', why: 'Hem med matkassarna' },
      { at: R(14, 14.5), go: 'roof', why: 'Vattnar tomaterna på taket' }, { at: R(15, 15.6), go: 'home', why: 'Eftermiddagskaffe hemma' }] };
    case 'vd': return { wake: R(5.9, 6.2), sleep: R(23.2, 24), ev: [
      { at: R(6.5, 7), go: 'out', why: 'Tidigt frukostmöte på stan' }, { at: R(20, 21), go: 'home', why: 'Hem efter en lång dag' }] };
    case 'artist': return { wake: R(10.5, 11.5), sleep: R(26.5, 28), ev: [
      { at: R(12.5, 13), go: 'roof', why: 'Skissar utsikten från taket' }, { at: R(14, 14.5), go: 'home', why: 'Tillbaka till ateljén' },
      { at: R(21.5, 22.5), go: 'out', why: 'Vernissage på stan' }, { at: R(24.5, 26), go: 'home', why: 'Hem från vernissagen' }] };
  }
  return { wake: 7, sleep: 23, ev: [] };
}
const TYPE_NAMES = { worker: 'jobbar inne i stan', child: 'går i skolan', student: 'pluggar', pensioner: 'pensionär', vd: 'VD med långa dagar', artist: 'konstnär – nattuggla' };
/** @param {Person} p */
export const residentDesc = p => sv`Bor på ${fl(p.home)} (${p.apt ? 'höger' : 'vänster'} lägenhet) · ${TYPE_NAMES[p.rtype] || ''}`;
/** de boende i husets lägenheter; only(f, apt) = bara de lägenheter där det inte bor någon (dygnsskiftet) */
function makeResidents(only = (/** @type {number} */ _f, /** @type {number} */ _apt) => true) {
  HOUSEHOLDS.forEach((apts, i) => {
    const f = HOME_FLOORS[i];
    if (f === undefined) return;
    apts.forEach((members, apt) => only(f, apt) && members.forEach(m => {
      const [type, bil] = m.split(':');
      const p = makePerson('res', f, 0);
      Object.assign(p, { home: f, apt, rtype: type, child: type === 'child', goal: f, dest: f });
      castResident(p); // Majken och Lill-Olle
      const r = routine(type);
      p.wake = r.wake; p.sleepAt = r.sleep; p.sched = r.ev.sort((a, b) => a.at - b.at);
      p.why = 'Hemma';
      p.sleeping = true;
      if (bil) { p.hasCar = true; arriveByCar(p, true); }           // bilen står redan i garaget på morgonen
      p.floor = f;
      const s = homeSpot(p);
      p.spot = s; setOcc(s, p.id); p.x = s.x; p.state = 'office'; p.timer = rand(1, 5); p.face = s.face || 1;
      S.people.push(p);
    }));
  });
}
/** En plats i den egna lägenheten: sängen när man sover, annars soffa/kök/dator @param {Person} p */
export function homeSpot(p) {
  const mine = SPOTS[p.home].filter(s => s.apt === p.apt);
  const want = mine.filter(s => !!s.bed === !!p.sleeping && (occOf(s) === null || occOf(s) === p.id));
  return pick(want.length ? want : mine);
}
/** Nästa beslut för en boende (anropas när tiden på platsen är slut) @param {Person} p */
export function resNext(p, h) {
  // flyttdag: hushållet som flyttar packar hemma och går när lägenheten är tom (visits.js)
  if (p.moving) {
    const r = movingResNext(p);
    if (r !== undefined) { for (const e of p.sched) if (e.at <= h) e.done = true; return r; }
  }
  const ev = p.sched.find(e => !e.done && e.at <= h);
  if (ev) {
    ev.done = true;
    if (ev.go === 'out') { p.sleeping = false; return [p.exitFloor, ev.why]; }
    if (ev.go === 'home') return p.floor !== p.home ? [p.home, ev.why] : null;
    const f = floorWith(ev.go);
    if (f >= 0 && (floorOpen(f, h) || ev.go === 'roof') && p.floor !== f) return [f, ev.why];
    return null;
  }
  if (p.floor !== p.home) return null; // t.ex. på takterrassen: väntar på nästa händelse
  // hemma: sova, vakna eller byta plats i lägenheten
  const shouldSleep = h >= p.sleepAt || h < p.wake;
  if (shouldSleep !== !!p.sleeping) {
    p.sleeping = shouldSleep;
    pev(p, shouldSleep ? 'Lägger sig och somnar 💤' : 'Vaknar och gäspar ☀️');
  }
  const s = homeSpot(p);
  if (s !== p.spot) { if (p.spot && occOf(p.spot) === p.id) setOcc(p.spot, null); p.spot = s; setOcc(s, p.id); p.x = s.x; p.face = s.face || 1; }
  return null;
}
/** @param {Person} p */
function awayTick(p) {
  if (hour() < p.returnAt || S.fire) return; // vid brand släpps ingen in
  const ev = p.sched.find(e => !e.done && e.go === 'home');
  if (ev) ev.done = true;
  p.floor = LOBBY; p.exitFloor = LOBBY; p.x = -30 - rand(0, 20);
  setTrip(p, p.home, ev ? ev.why : 'Hem');
  if (p.hasCar && !arriveByCar(p)) p.exitFloor = LOBBY; // garaget fullt – går in genom entrén
  pev(p, sv`Kommer hem · ${p.why}`);
  log(sv`${pn(p)} kommer hem till ${fl(p.home)}`, 'person', null, p.id);
}

// ---------- VIP-besök med helikopter ----------
const VIP_NAMES = ['VD Gunilla', 'Ministern', 'Rockstjärnan Ziggy', 'Arvtagaren', 'Astronauten'];
function heliTick(dt) {
  const h = hour();
  const H = S.heli;
  if (!H) {
    const due = S.fire ? null : S.vipVisits.find(v => !v.done && h >= v.at); // (vid brandlarm väntar helikoptern)
    if (due) { due.done = true; S.heli = { state: 'land', y: -260, visit: due }; log(sv`🚁 En helikopter närmar sig takterrassen – VIP-besök till ${FL[due.goal].short}!`, 'alert'); }
    return;
  }
  if (H.state === 'land') {
    H.y = Math.min(0, H.y + 90 * dt);
    if (H.y >= 0) { H.state = 'parked'; spawnVips(H.visit); }
  } else if (H.state === 'parked') {
    if (!S.people.some(p => p.vip)) { H.state = 'leave'; log('🚁 Helikoptern lyfter från taket', 'sys'); }
  } else if (H.state === 'leave') {
    H.y -= 110 * dt;
    if (H.y < -300) S.heli = null;
  }
}
/** Spelaren: en helikopter med VIP-besök landar nu (om taket är ledigt) */
export function vipNow() {
  if (ROOF < 0 || S.heli || S.fire || S.people.some(p => p.vip)) return false;
  const v = { at: hour(), goal: pick(OFFICE_FLOORS), done: true };
  S.heli = { state: 'land', y: -260, visit: v };
  log(sv`🚁 En helikopter närmar sig takterrassen – oanmält VIP-besök till ${FL[v.goal].short}!`, 'alert');
  return true;
}
function spawnVips(v) {
  const n = 3;
  for (let i = 0; i < n; i++) {
    const p = makePerson('vis', ROOF, 470 - i * 26);
    p.vip = true; p.exitFloor = ROOF;
    if (i === 0) { p.name = pick(VIP_NAMES); p.look.tie = true; p.look.shirt = '#1b1033'; }
    else { p.name = `Livvakt ${i}`; p.look.acc = 3; p.look.shirt = '#2b2d6e'; }
    setTrip(p, v.goal, i === 0 ? sv`VIP-besök på ${FL[v.goal].short}` : `Eskorterar ${S.people.find(q => q.vip && q.name && !q.name.startsWith('Livvakt'))?.name || 'VIP:en'}`);
    S.people.push(p);
    pev(p, sv`Kliver ur helikoptern på taket · ${p.why}`);
  }
  S.stats.vips++;
  log(sv`👔 VIP-gruppen kliver ur helikoptern och ska till ${fl(v.goal)}`, 'alert');
}

// ---------- Dygnets start och varje steg ----------
/**
 * Mjukt dygnsskifte (rollDay i sim.js): bilarna, leveransbilen och helikoptern är kvar, de boende får en ny dag
 * att leva och tomma lägenheter (hushållet flyttade i går) får nya hyresgäster.
 */
export function lifeRoll() {
  const bank = floorWith('bank'), law = floorWith('law');
  S.vipVisits = ROOF < 0 ? [] : [{ at: rand(10.8, 11.6), goal: bank >= 0 ? bank : OFFICE_FLOORS[0] }, { at: rand(15, 15.8), goal: law >= 0 ? law : OFFICE_FLOORS[0] }];
  for (const p of S.people) if (p.kind === 'res' && !p.dead) {
    const r = routine(p.rtype);
    p.wake = r.wake; p.sleepAt = r.sleep; p.sched = r.ev.sort((a, b) => a.at - b.at);
    // ute över natten: kommer hem på gårdagens tid (24 timmar tidigare på den nya klockan), inte på dagens hemkomst
    if (p.state === 'away') {
      // (den som gick utan bokad hemkomst – returnAt 99, t.ex. utrymd sent på kvällen – kommer hem på morgonen)
      p.returnAt = Math.max(6, Math.min(p.returnAt, 30.5) - 24);
      p.sched.unshift({ at: p.returnAt, go: 'home', why: 'Hem efter natten ute' });
    }
  }
  const lives = (f, apt) => S.people.some(p => p.kind === 'res' && !p.dead && p.home === f && p.apt === apt);
  const before = S.people.length;
  makeResidents((f, apt) => !lives(f, apt));
  if (S.people.length > before) log(`🏠 Nya hyresgäster har flyttat in i den tomma lägenheten`, 'sys');
}
export function lifeReset() {
  S.autos = []; S.nextAutoId = 1; S.truck = null; S.heli = null;
  const bank = floorWith('bank'), law = floorWith('law');
  S.vipVisits = [{ at: rand(10.8, 11.6), goal: bank >= 0 ? bank : OFFICE_FLOORS[0] }, { at: rand(15, 15.8), goal: law >= 0 ? law : OFFICE_FLOORS[0] }];
  if (ROOF < 0) S.vipVisits = [];
  makeResidents();
}
export function lifeTick(dt) {
  autoTick(dt);
  if (DOCK >= 0) truckTick(dt);
  if (ROOF >= 0) heliTick(dt);
  for (const p of S.people) if (p.state === 'away') awayTick(p);
}
