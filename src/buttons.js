// Styrlogiken KNAPPAR: vanliga hissknappar som i ett äldre hus. Styrsystemet vet INTE vart folk ska –
// det ser bara anrop i hallen (våning + riktning per hissgrupp) och knapparna inne i korgen.
// Här finns också felknappar: folk som trycker på båda knapparna, åt fel håll, på fel våning, och
// barn som trycker på alla knappar. Felen slumpas med simuleringens rng() (deterministiskt).
import { stream } from './rng.js';
import { sv } from './sv.js';
const { rand, rng } = stream('knappar');
import { ARR, fl } from './util.js';
import { CAR_H, EL, floorY, shaftCX } from './config.js';
import { S, log } from './state.js';
import { elevatorAllows, pev, pn, toStairs } from './people.js';
import { allowed, eta, isFull, operational, outLong, rebuildPicks, posOf } from './dispatch.js';
import { kidPressed, kidRate } from './cast.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

export const buttonsMode = () => S.strategy === 'buttons';
/** Hur ofta folk trycker fel: av / lite / mycket (gäller alla styrlogiker – i de andra slår man in fel våning) */
export const MISTAKE_LEVELS = { av: 0, lite: 1, mycket: 3 };
export const mistakeRate = base => base * (MISTAKE_LEVELS[S.mistakes] ?? 1);
export const GROUP_NAMES = { låg: 'låga zonen', hög: 'höga zonen', express: 'expressen', tbana: 'stationsexpressen', varu: 'varuhissen', panorama: 'panoramahissen', pendel: 'pendelhissen' };

/**
 * @typedef {{ k: string, g: string, f: number, d: number, t: number, car: number|null }} HallCall
 * Ett anrop i hallen: hissgrupp g, våning f, riktning d, när det trycktes och vilken korg som fått det.
 */
export const callKey = (g, f, d) => `${g}|${f}|${d}`;

/** Hissgruppen personen ställer sig vid: en grupp där en hiss tar hen hela delresan. Går flera grupper dit
 *  (t.ex. expressen och stationsexpressen mellan entrén och sky lobbyn) väljer man den som redan står öppen
 *  åt rätt håll, annars på måfå. */
/** grupperna som tar p från våningen till delmålet – helst de där någon hiss går (en skylt säger "ur funktion") @param {Person} p */
function banksFor(p) {
  const groups = [...new Set(EL.filter(x => elevatorAllows(x, p) && x.legs.some(l => l.includes(p.floor) && l.includes(p.dest))).map(x => x.group))];
  const live = groups.filter(g => S.elevators.some(e => e.group === g && !outLong(e)));
  return live.length ? live : groups;
}
/** @param {Person} p */
export function bankFor(p) {
  const groups = banksFor(p);
  if (groups.length <= 1) return groups[0] ?? null;
  const open = groups.find(g => S.elevators.some(e => e.group === g && operational(e) && e.state === 'doors' && e.floor === posOf(e, p.floor) && (e.dir === p.dir || e.dir === 0)));
  return open ?? groups[Math.floor(rng() * groups.length)];
}
/** Finns det en knapp åt det hållet på våningen (går gruppen vidare åt det hållet)? */
function hasButton(g, f, d) {
  return EL.some(x => x.group === g && x.legs.some(l => l.includes(f) && l.some(h => (h - f) * d > 0)));
}
function press(g, f, d) {
  const k = callKey(g, f, d);
  if (S.calls[k]) return false;
  S.calls[k] = { k, g, f, d, t: S.t, car: null };
  return true;
}

// ---------- Personerna: trycker på knappen i hallen ----------
/** Personen kommer fram till hissarna och trycker (ibland fel). @param {Person} p */
export function pressHallButton(p) {
  const g = bankFor(p);
  p.bank = g; p.assigned = null; p.fixAt = 0;
  if (g === null) return;
  const name = GROUP_NAMES[g] || g;
  if (!allowed(p.floor) || !allowed(p.dest)) return; // brand: sköts i buttonWaitTick
  // står en hiss i gruppen redan öppen här åt rätt håll kliver man bara in – ingen knapp behövs
  if (S.elevators.some(e => e.group === g && operational(e) && e.state === 'doors' && e.floor === posOf(e, p.floor) && e.doorPhase !== 'closing' && (e.dir === p.dir || e.dir === 0))) {
    pev(p, sv`Hiss åt rätt håll står redan öppen vid ${name} – kliver in`);
    return;
  }
  if (rng() < mistakeRate(0.03) && hasButton(g, p.floor, -p.dir)) {
    press(g, p.floor, -p.dir);
    p.fixAt = S.t + rand(2, 6);
    S.stats.wrongPress++;
    pev(p, sv`Trycker ${ARR(-p.dir)} vid ${name}… oj, fel knapp!`);
    log(sv`🙈 ${pn(p)} tryckte ${ARR(-p.dir)} i stället för ${ARR(p.dir)} på ${fl(p.floor)}`, 'button', null, p.id);
    return;
  }
  const fresh = press(g, p.floor, p.dir);
  pev(p, fresh ? sv`Trycker på ${ARR(p.dir)} vid ${name}` : sv`Knappen ${ARR(p.dir)} vid ${name} lyser redan – väntar`);
  if (fresh) log(sv`${ARR(p.dir)} ${pn(p)} trycker på ${fl(p.floor)} (${name})`, 'button', null, p.id);
  if (rng() < mistakeRate(0.06) && hasButton(g, p.floor, -p.dir) && press(g, p.floor, -p.dir)) {
    S.stats.wrongPress++;
    pev(p, 'Trycker på båda knapparna – för säkerhets skull');
    log(sv`🙈 ${pn(p)} trycker på båda knapparna på ${fl(p.floor)}`, 'button', null, p.id);
  }
}
/** Varje steg för den som väntar i KNAPPAR-läget (ersätter tilldelningen i de andra lägena). @param {Person} p */
export function buttonWaitTick(p, dt) {
  if (!allowed(p.floor) || !allowed(p.dest)) {
    toStairs(p, S.fire && S.fire.mode === 'recall' ? 'Brandåterkallning – alla hissar avstängda, tar trapporna' : 'Hissarna kör inte hit pga branden – tar trapporna');
    return;
  }
  if (p.bank === undefined || p.bank === null) { pressHallButton(p); return; }
  // hela gruppen är ur drift (trasig, service, avstängd) men en annan grupp går dit: gå dit och tryck där
  if (!S.elevators.some(e => e.group === p.bank && !outLong(e))) {
    const alt = banksFor(p).filter(g => g !== p.bank);
    if (alt.length && S.elevators.some(e => e.group === alt[0] && !outLong(e))) {
      pev(p, sv`${GROUP_NAMES[p.bank] || p.bank} är ur funktion – går till ${GROUP_NAMES[alt[0]] || alt[0]} i stället`);
      pressHallButton(p);
      return;
    }
  }
  if (p.fixAt && S.t >= p.fixAt) {
    p.fixAt = 0;
    press(p.bank, p.floor, p.dir);
    pev(p, sv`Trycker på rätt knapp: ${ARR(p.dir)}`);
  }
  const call = S.calls[callKey(p.bank, p.floor, p.dir)];
  if (!call && !p.fixAt) {
    // anropet besvarades men jag kom inte med (full hiss, fel håll) – tryck igen när hissen har gått
    // (en trasig hiss som står med öppna dörrar räknas inte)
    const here = S.elevators.some(e => e.group === p.bank && operational(e) && e.state === 'doors' && e.floor === posOf(e, p.floor));
    if (!here) { press(p.bank, p.floor, p.dir); pev(p, sv`Trycker på ${ARR(p.dir)} igen`); }
  }
  // bara för bilden och spårlappen – styrsystemet läser aldrig personerna
  const c = S.calls[callKey(p.bank, p.floor, p.dir)];
  p.assigned = c ? c.car : null;
  // otålig: trycker om och om igen (det hjälper inte)
  if (p.waited > 25 && rng() < mistakeRate(0.06) * dt) {
    pev(p, sv`Trycker på ${ARR(p.dir)} igen… och igen… (det hjälper inte)`);
    S.fx.push({ x: p.x, y: floorY(p.floor) - 70, text: 'TRYCK!', color: '#ffe14d', life: 0.9, size: 14 });
  }
}

// ---------- Personerna: knapparna inne i korgen ----------
/** Efter påstigning: rätt knapp trycks alltid (så ingen åker förbi sitt mål) – ibland också fel. @param {Person} p @param {Elevator} e */
export function carButtonMistakes(p, e) {
  const ahead = f => e.stops.has(f) && f !== e.floor && (e.dir === 0 || (f - e.floor) * e.dir > 0);
  if (p.child && rng() < mistakeRate(kidRate(p))) {
    kidPressed(p);
    const all = [...e.stops].filter(ahead);
    for (const f of all) e.carCalls.add(f);
    S.stats.kidPresses++;
    pev(p, 'Trycker på ALLA knappar! Hihi!');
    log(sv`🧒 ${pn(p)} trycker på alla knappar i ${e.name}`, 'button', e.color, p.id);
    S.fx.push({ x: shaftCX(e.id), y: floorY(e.pos) - CAR_H - 24, text: 'PIP PIP PIP!', color: '#ffe14d', life: 1.4, size: 16 });
    for (const q of e.passengers) if (q !== p && !q.child) q.mood = Math.max(q.mood, 1);
  } else if (rng() < mistakeRate(0.04)) {
    const near = [p.dest + 1, p.dest - 1].filter(f => ahead(f) && f !== p.dest);
    if (near.length) {
      const f = near[0];
      e.carCalls.add(f);
      S.stats.wrongPress++;
      pev(p, sv`Kom åt ${fl(f)} också – oj`);
      log(sv`🙈 ${pn(p)} kom åt fel knapp i ${e.name} (${fl(f)})`, 'button', e.color, p.id);
    }
  }
  antiNuisance(e);
}
/**
 * Skydd mot bus ("antinuisance", som i riktiga hissar): fler våningsknappar än rimligt för så få
 * passagerare ⇒ alla knappar rensas, och passagerarna trycker sitt mål igen.
 * @param {Elevator} e
 */
export function antiNuisance(e) {
  if (e.carCalls.size < e.passengers.length + 3) return;
  const n = e.carCalls.size;
  e.carCalls.clear();
  for (const q of e.passengers) e.carCalls.add(posOf(e, q.dest));
  S.stats.nuisance++;
  log(sv`🧹 ${e.name}: ${n} knappar men bara ${e.passengers.length} ombord – rensar och låter alla trycka igen`, 'button', e.color);
}

// ---------- Styrsystemet: fördelar hallanropen ----------
// OBS: assignCalls läser ALDRIG S.people – bara anropen, korgarnas läge, våningsknappar och våg.
// (Ett test kontrollerar det.)
/** kostnad för att korg e tar anropet c: tid till våningen + lite för last och fullt @param {Elevator} e */
const callCost = (e, c) => eta(e, c.f, c.d) + e.passengers.length * 0.3 + (isFull(e) ? 60 : 0);
export function assignCalls(reopt = false) {
  let changed = false;
  for (const c of Object.values(S.calls)) {
    if (!allowed(c.f)) { if (c.car !== null) { c.car = null; changed = true; } continue; }
    const cars = S.elevators.filter(e => e.group === c.g && operational(e) && !e.indep && e.serves.has(c.f) && !e.vipLock);
    const cur = c.car !== null ? S.elevators[c.car] : null;
    if (!cars.length) { if (c.car !== null) { c.car = null; changed = true; } continue; }
    if (cur && cars.includes(cur) && !reopt) continue;
    let best = cars[0], bc = Infinity;
    for (const e of cars) { const x = callCost(e, c); if (x < bc) { bc = x; best = e; } }
    if (cur && cars.includes(cur)) {
      const cc = callCost(cur, c);
      if (!(bc < cc * 0.6 && cc - bc > 6)) continue;
      log(sv`↻ Anropet ${ARR(c.d)} på ${fl(c.f)} flyttas ${cur.name}→${best.name}`, 'reopt', best.color);
    } else log(sv`${best.name} tar anropet ${ARR(c.d)} på ${fl(c.f)} (≈${Math.round(bc)}s)`, 'assign', best.color);
    c.car = best.id; best.parkTarget = null; changed = true;
  }
  return changed;
}
export function dispatchCalls(reopt = false) {
  if (assignCalls(reopt)) rebuildPicks();
}
/** Hissen öppnar på våning f: den besvarar anropet åt sitt håll (eller ett av dem om den är ledig).
 *  Dubbeldäck: anropen på båda däckens våningar. @param {Elevator} e */
export function answerCalls(e, f) {
  const fs = e.deck2 && e.upper.has(f + 1) ? [f, f + 1] : [f];
  const lit = d => fs.some(g => S.calls[callKey(e.group, g, d)]);
  let d = e.dir;
  if (d === 0) d = lit(1) ? 1 : lit(-1) ? -1 : 0;
  if (!d || !lit(d)) return;
  for (const g of fs) delete S.calls[callKey(e.group, g, d)];
  e.dir = d;
  rebuildPicks();
}
/** Släck en knapp i hallen (en hiss står här åt det hållet). */
export function clearCall(g, f, d) { delete S.calls[callKey(g, f, d)]; }
/** Lyser knappen i hallen för gruppen (för bilden)? */
export const hallLit = (g, f, d) => !!S.calls[callKey(g, f, d)];
