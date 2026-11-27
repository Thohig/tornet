// Tågen under huset: tunnelbanan (TB) och pendeltåget djupt i berget (PT). Tåg enligt tidtabell som lämnar av folk
// i klump och tar med dem som ska hem. Tåget kör in från vänster längs perrongens bakvägg, stannar, öppnar dörrarna
// och kör vidare åt höger. Allt ligger i simuleringen (S.train för tunnelbanan, S.pendel för pendeln) – grafiken i
// pixhall.js läser bara läget.
//
// Översikt:
// två linjer (`LINES`: `TB`, `PT`) med var sin tidtabell (`headway`, `pendelHeadway`, första och sista tåget), var sin
// slumpström och var sin andel av morgonens anställda (`TRAIN_SHARE`, `PENDEL_SHARE`); tåget (`lineTick`), folk som
// kliver av i klump och på, de som byter mellan tunnelbanan och pendeln (`TRANSFER`: de går aldrig in i huset, bara
// genom pendelhissen, X1 eller den långa rulltrappan) och sista tåget (alla med `exitFloor` perrongen går ut genom
// entrén). Tunnelbanans fält ligger kvar direkt på S (`S.train`, `S.trainNext` …), pendelns i `S.pendel`.
import { stream } from './rng.js';
import { sv } from './sv.js';
import { CAFE, LOBBY, MAXP, PENDEL, STATION, TRAIN_LEN, TRAIN_X0, TRAIN_X1, floorOpen, timeScale } from './config.js';
import { S, hour, log, notice } from './state.js';
import { makePerson, pev, pn, setTrip, spawnEmployee, spawnVisitor } from './people.js';
import { fl } from './util.js';

/** första och sista tåget (klockslag 6–30) */
export const FIRST_H = 6.05, LAST_H = 24.5;
/** första och sista pendeltåget */
export const PENDEL_FIRST = 6.1, PENDEL_LAST = 24.8;
/** andelen av morgonens anställda som kommer med tunnelbanan respektive pendeln i stället för genom entrén */
export const TRAIN_SHARE = 0.4, PENDEL_SHARE = 0.2;
/** andelen av morgonens anställda som kommer med något tåg (sim.js släpper in resten genom entrén) */
export const RAIL_SHARE = (STATION >= 0 ? TRAIN_SHARE : 0) + (PENDEL >= 0 ? PENDEL_SHARE : 0);
/** dörrarna sitter här längs tåget (andel av längden) */
export const TRAIN_DOORS = [0.18, 0.5, 0.82];
const DWELL = 6.5, OPEN_AT = 0.7, CLOSE_BEFORE = 1.2, VMAX_T = 300;

/** tid mellan tågen i sekunder simuleringstid: tätt i rusningen, glest på kvällen */
export function headway(h) {
  if ((h >= 6.5 && h < 9.5) || (h >= 15.5 && h < 18.5)) return 18;
  if (h < 20) return 24;
  return 30;
}
/** pendeln går glesare men med längre tåg: var tredje till var femte minut i rusningen, glest på kvällen */
export function pendelHeadway(h) {
  if ((h >= 6.5 && h < 9.5) || (h >= 15.5 && h < 18.5)) return 34;
  if (h < 20) return 46;
  return 60;
}

/** Tåget vid perrongen: läge och fart, tid i läget, hur många som ska av (n, varav emp anställda och tr som byter
 * till den andra linjen) och har klivit av
 * @typedef {{ x: number, v: number, state: 'in'|'stop'|'out', t: number, off: number, spawned: number, n: number, emp?: number, tr?: number, nextOff?: number }} Train */
/** En linjes tillstånd: tåget som är inne, nästa och förra ankomsten och om sista tåget har gått
 * @typedef {{ train: Train|null, next: number, last: number|null, done: boolean }} LineState */
/** En linje: våningen med perrongen, tidtabellen, andelen av de anställda och slumpströmmarna (ankomsterna, och
 * påstigningen för sig – vilka som står på perrongen beror på styrlogiken och får inte flytta hur många som kliver
 * av nästa tåg)
 * @typedef {{ key: 'tb'|'pt', f: number, icon: string, name: string, first: number, lastH: number, share: number,
 *   headway: (h: number) => number, st: () => LineState, R: ReturnType<typeof stream>, B: ReturnType<typeof stream>,
 *   other: () => Line|null }} Line */
/** tunnelbanans tillstånd ligger kvar direkt på S (resten av huset läser S.train, S.trainNext …) */
const TB_STATE = {
  get train() { return S.train; }, set train(v) { S.train = v; },
  get next() { return S.trainNext; }, set next(v) { S.trainNext = v; },
  get last() { return S.trainLast; }, set last(v) { S.trainLast = v; },
  get done() { return S.trainDone; }, set done(v) { S.trainDone = v; },
};
/** @type {Line} */
export const TB = { key: 'tb', f: STATION, icon: '🚇', name: 'Tunnelbanan', first: FIRST_H, lastH: LAST_H, share: TRAIN_SHARE,
  headway: h => headway(h), st: () => TB_STATE, R: stream('tåg'), B: stream('påstigning'), other: () => (PENDEL >= 0 ? PT : null) };
/** @type {Line} */
export const PT = { key: 'pt', f: PENDEL, icon: '🚆', name: 'Pendeltåget', first: PENDEL_FIRST, lastH: PENDEL_LAST, share: PENDEL_SHARE,
  headway: pendelHeadway, st: () => S.pendel, R: stream('pendlare'), B: stream('pendelpåstigning'), other: () => (STATION >= 0 ? TB : null) };
/** linjerna som huset har */
export const LINES = [TB, PT].filter(l => l.f >= 0);
/** linjen vid perrongen på våning f, eller null */
export const lineAt = f => LINES.find(l => l.f === f) || null;
/** de som byter mellan linjerna får egna utseenden (en egen ström: de flyttar inga andra dragningar) */
const BYT = stream('bytare');

/** finns det fler tåg i dag? (utan linje: tunnelbanan) */
export const trainsRunning = (h = hour(), ln = TB) => ln.f >= 0 && h >= ln.first - 0.3 && h < ln.lastH;

export function trainReset() {
  S.train = null;
  S.trainNext = 0; // första tåget går när klockan når FIRST_H
  S.trainDone = false;
  S.trainLast = null;
  S.pendel = { train: null, next: 0, last: null, done: false };
}
/** dygnsskiftet: en linje vars tåg inte står inne börjar om på den nya tidtabellen */
export function trainRoll() {
  if (!S.train) { S.train = null; S.trainNext = 0; S.trainDone = false; S.trainLast = null; }
  if (!S.pendel.train) S.pendel = { train: null, next: 0, last: null, done: false };
}

/**
 * Ett steg för tågen. rate(h) = husets ankomster till fots (personer/sekund) – tågen tar med sig
 * en del av dem (TRAIN_SHARE, PENDEL_SHARE), så att det totala inflödet blir ungefär detsamma som utan station.
 */
export function trainTick(dt, rate) {
  for (const ln of LINES) lineTick(ln, dt, rate);
}
/** @param {Line} ln */
function lineTick(ln, dt, rate) {
  const h = hour(), L = ln.st();
  if (!L.done && h >= ln.lastH) lastTrainGone(ln);
  const T = L.train;
  if (!T) {
    if (!trainsRunning(h, ln) || h < ln.first) return;
    if (S.t < L.next || (ln === TB && S.tunnel && S.tunnel.ph === 'stuck')) return; // (tåget står i tunneln – tunnel.js)
    L.train = { x: TRAIN_X0 - TRAIN_LEN, v: VMAX_T, state: 'in', t: 0, off: 0, spawned: 0, n: 0 };
    return;
  }
  T.t += dt;
  if (T.state === 'in') {
    // bromsar in mot perrongen
    const left = TRAIN_X0 - T.x;
    T.v = Math.max(18, Math.min(VMAX_T, left * 2.2));
    T.x = Math.min(TRAIN_X0, T.x + T.v * dt);
    if (T.x >= TRAIN_X0) arrive(ln, T, h, rate);
  } else if (T.state === 'stop') {
    // dörrarna öppnas: först kliver folk av, sedan på
    if (T.t >= OPEN_AT && T.spawned < T.n && S.t >= (T.nextOff || 0)) {
      T.spawned++; T.nextOff = S.t + ln.R.rand(0.15, 0.4);
      alight(ln, T);
    }
    if (T.t >= OPEN_AT + 0.6) board(ln);
    if (T.t >= DWELL) depart(ln, T);
  } else if (T.state === 'out') {
    T.v = Math.min(VMAX_T, T.v + 160 * dt);
    T.x += T.v * dt;
    if (T.x >= TRAIN_X1) L.train = null;
  }
}
/** dörrarna öppnas om en stund (grafiken: 0 = stängda, 1 = öppna) */
export function trainDoors(T = S.train) {
  if (!T || T.state !== 'stop') return 0;
  const a = (T.t - OPEN_AT + 0.4) / 0.4, b = (DWELL - CLOSE_BEFORE + 0.4 - T.t) / 0.4;
  return Math.max(0, Math.min(1, a, b));
}
/** tåget står vid perrongen: hur många som kliver av beror på tiden på dygnet @param {Line} ln @param {Train} T */
function arrive(ln, T, h, rate) {
  T.state = 'stop'; T.t = 0; T.v = 0;
  const L = ln.st(), { rand, randi } = ln.R, pt = ln === PT;
  if (pt) S.stats.pendelTrains++; else S.stats.trains++;
  // tidtabellen räknas från ankomst till ankomst; med sig har tåget dem som samlats sedan förra tåget
  const since = L.last !== null ? S.t - L.last : ln.headway(h);
  L.last = S.t; L.next = S.t + ln.headway(h);
  // (slumptalen dras alltid, även vid brand – så att alla styrlogiker ser samma tåg)
  const f0 = rand(0.7, 1.3), vis = h >= 9 && h < 19 ? randi(0, pt ? 2 : 3) : h >= 19 && h < 23 ? randi(0, 1) : 0;
  // de som byter till den andra linjen: fler i rusningen
  const rush = (h >= 6.5 && h < 9.5) || (h >= 15.5 && h < 18.5), tr0 = randi(0, rush ? 4 : 2);
  if (S.fire) { T.n = 0; log(sv`${ln.icon} Tåget stannar men ingen kliver av – brandlarm i huset`, 'alert'); return; }
  // anställda: tågets andel av det som annars hade kommit genom entrén sedan förra tåget
  const emp = rate(h) * ln.share * since * f0;
  const other = ln.other(), tr = other && trainsRunning(h + 0.3, other) ? tr0 : 0;
  T.emp = Math.round(emp); T.tr = tr; T.n = T.emp + tr + vis;
  T.n = Math.max(0, Math.min(T.n, MAXP - S.people.length));
  T.emp = Math.min(T.emp, T.n); T.tr = Math.min(T.tr, T.n - T.emp);
  if (T.n > 0) log(pt ? sv`🚆 Pendeltåget stannar på ${fl(ln.f)} – ${T.n} kliver av` : sv`🚇 Tåget stannar på ${fl(ln.f)} – ${T.n} kliver av`, 'sys');
}
/** en person kliver av vid en av dörrarna @param {Line} ln @param {Train} T */
function alight(ln, T) {
  const { rand, randi, rng } = ln.R;
  const door = TRAIN_DOORS[randi(0, TRAIN_DOORS.length - 1)];
  const x = T.x + door * TRAIN_LEN + rand(-6, 6), visR = rng();
  let p;
  if (T.off < T.emp) p = spawnEmployee(x, ln.f);
  else if (T.off < T.emp + (T.tr || 0)) p = spawnTransfer(ln, x);
  else {
    const h = hour();
    // dagtid: en del går upp till caféet, resten till ett ärende i huset eller rakt upp till gatan
    p = spawnVisitor(ln.f, x, h >= 11 && h < 13.5 && floorOpen(CAFE, h) && visR < 0.4 ? CAFE : null, null);
    if (p) {
      if (p.goal !== LOBBY) p.exitFloor = ln.f;
      else p.why = ln === PT ? 'Genväg från pendeln upp till gatan' : 'Genväg från tunnelbanan upp till gatan';
      pev(p, ln === PT ? sv`Kliver av pendeltåget · ${p.why}` : sv`Kliver av tåget · ${p.why}`);
    }
  }
  T.off++;
  if (p) { p.fromTrain = true; if (ln === PT) S.stats.pendelIn++; else S.stats.trainIn++; }
}
/** Någon som byter tåg: kliver av den här linjen och ska till den andra linjens perrong – genom pendelhissen, X1 eller
 *  den långa rulltrappan, aldrig in i huset @param {Line} ln */
function spawnTransfer(ln, x) {
  const to = ln.other();
  const p = makePerson('vis', ln.f, x, BYT);
  p.exitFloor = to.f;
  setTrip(p, to.f, ln === PT ? 'Byter från pendeln till tunnelbanan' : 'Byter från tunnelbanan till pendeln', true);
  S.people.push(p);
  S.stats.transferRail++;
  pev(p, sv`Kliver av ${ln === PT ? 'pendeltåget' : 'tunnelbanan'} · ${p.why}`);
  log(sv`${pn(p)} byter tåg på ${fl(ln.f)} · ska till ${fl(to.f)}`, 'person', null, p.id);
  return p;
}
/** de som väntar på perrongen kliver på (en i taget, i den ordning de kom) @param {Line} ln */
function board(ln) {
  for (const p of S.people) {
    if (p.state !== 'platform' || p.dead || p.floor !== ln.f) continue;
    if (p.boardAt === undefined) { p.boardAt = S.t + ln.B.rand(0, 1.8); continue; }
    if (S.t < p.boardAt) continue;
    p.dead = true; p.state = 'gone';
    if (ln === PT) S.stats.pendelOut++; else S.stats.trainOut++;
    pev(p, ln === PT ? 'Kliver på pendeltåget – hejdå!' : 'Kliver på tåget – hejdå!');
    log(ln === PT ? sv`${pn(p)} tar pendeln hem` : sv`${pn(p)} tar tåget hem`, 'person', null, p.id);
  }
}
/** @param {Line} ln @param {Train} T */
function depart(ln, T) {
  T.state = 'out'; T.t = 0; T.v = 20;
  // den som var nästan framme vid perrongen hann inte med
  for (const p of S.people) {
    if (p.dead || p.floor !== ln.f) continue;
    if (p.state === 'platform' && p.boardAt !== undefined) { p.boardAt = undefined; continue; }
    if (p.toTrain && p.state === 'exiting' && Math.abs(p.tx - p.x) < 140) {
      p.mood = Math.max(p.mood, 1);
      pev(p, 'Missade tåget med en hårsmån – väntar på nästa');
    }
  }
}
/** Den som tänkte åka tåg går ut genom entrén i stället (sista tåget har gått, eller tåget står i tunneln – tunnel.js)
 * @param {import('./people.js').Person} p */
export function toStreet(p, why) {
  const was = p.exitFloor;
  p.exitFloor = LOBBY;
  if (p.state === 'platform') { p.toTrain = false; p.boardAt = undefined; setTrip(p, LOBBY, why, true); }
  else if (p.leaving && p.goal === was && (p.state === 'wait' || p.state === 'toQueue')) setTrip(p, LOBBY, why, true);
  else if (p.toTrain && p.state === 'exiting') { p.toTrain = false; setTrip(p, LOBBY, why, true); }
  pev(p, why);
}
/** efter sista tåget: alla som tänkte åka med linjen går ut genom entrén i stället @param {Line} ln */
function lastTrainGone(ln) {
  ln.st().done = true;
  let n = 0;
  for (const p of S.people) if (!p.dead && p.exitFloor === ln.f) { toStreet(p, ln === PT ? 'Sista pendeltåget har gått – tar sig ut genom entrén' : 'Sista tåget har gått – tar sig ut genom entrén'); n++; }
  if (ln === PT) log(sv`🚆 Sista pendeltåget har gått${n ? sv` – ${n} får ta sig ut genom entrén` : ''}`, 'sys');
  else log(sv`🚇 Sista tåget har gått${n ? sv` – ${n} får ta sig ut genom entrén` : ''}`, 'sys');
}
/** Spelaren: tågstörning – nästa tåg blir försenat och kommer med dubbelt så många (alla som samlats sedan förra) */
export function delayTrain() {
  if (STATION < 0 || !trainsRunning() || S.trainDone || (S.train && S.train.state !== 'out')) return false;
  const d = TB.R.rand(30, 45);
  S.trainNext = Math.max(S.trainNext, S.t) + d;
  S.trainDelay = { t0: S.t, until: S.trainNext };
  notice('train', '🚇 Tågstörning', sv`Signalfel i tunneln: nästa tåg är ${Math.round(d)} s försenat. Folk samlas på stationerna längs linjen – när tåget väl kommer kliver dubbelt så många av på perrongen.`, { floor: STATION });
  log('🚇 Tågstörning: signalfel i tunneln – nästa tåg är försenat', 'alert');
  return true;
}
/** speltid till nästa tåg i minuter (för skylten på perrongen), eller null om inga fler går i dag @param {Line} ln */
export function nextTrainMin(ln = TB) {
  const L = ln.st();
  if (!trainsRunning(hour(), ln) || L.train) return L.train ? 0 : null;
  const h = hour(), first = Math.max(0, (ln.first - h) * 3600 / timeScale(h));
  return Math.max(0, Math.round(Math.max(first, L.next - S.t) * timeScale(h) / 60));
}
