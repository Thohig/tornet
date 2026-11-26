// Tunnelbanan under huset: tåg enligt tidtabell som lämnar av folk i klump och tar med dem som ska hem.
// Tåget kör in från vänster längs perrongens bakvägg, stannar, öppnar dörrarna och kör vidare åt höger.
// Allt ligger i simuleringen (S.train) – grafiken i pixhall.js läser bara läget.
//
// Översikt:
// tunnelbanan under huset: tidtabell (`headway`, `FIRST_H`/`LAST_H`), tåget i `S.train`, folk som kliver av i klump
// (en andel `TRAIN_SHARE` av morgonens anställda) och på, sista tåget (`S.trainDone`: alla med `exitFloor` stationen
// går ut genom entrén)
import { stream } from './rng.js';
import { sv } from './sv.js';
const { rand, randi, rng } = stream('tåg');
// påstigningen har en egen ström: vilka som står på perrongen beror på styrlogiken, och får inte flytta hur många
// som kliver av nästa tåg
const BOARD = stream('påstigning');
import { CAFE, LOBBY, MAXP, STATION, TRAIN_LEN, TRAIN_X0, TRAIN_X1, floorOpen, timeScale } from './config.js';
import { S, hour, log, notice } from './state.js';
import { pev, pn, setTrip, spawnEmployee, spawnVisitor } from './people.js';
import { fl } from './util.js';

/** första och sista tåget (klockslag 6–30) */
export const FIRST_H = 6.05, LAST_H = 24.5;
/** andelen av morgonens anställda som kommer med tåget i stället för genom entrén */
export const TRAIN_SHARE = 0.5;
/** dörrarna sitter här längs tåget (andel av längden) */
export const TRAIN_DOORS = [0.18, 0.5, 0.82];
const DWELL = 6.5, OPEN_AT = 0.7, CLOSE_BEFORE = 1.2, VMAX_T = 300;

/** tid mellan tågen i sekunder simuleringstid: tätt i rusningen, glest på kvällen */
export function headway(h) {
  if ((h >= 6.5 && h < 9.5) || (h >= 15.5 && h < 18.5)) return 18;
  if (h < 20) return 24;
  return 30;
}
/** finns det fler tåg i dag? */
export const trainsRunning = (h = hour()) => STATION >= 0 && h >= FIRST_H - 0.3 && h < LAST_H;

/** Tåget vid perrongen (S.train): läge och fart, tid i läget, hur många som ska av (n, varav emp anställda) och har klivit av
 * @typedef {{ x: number, v: number, state: 'in'|'stop'|'out', t: number, off: number, spawned: number, n: number, emp?: number, nextOff?: number }} Train */
export function trainReset() {
  S.train = null;
  S.trainNext = 0; // första tåget går när klockan når FIRST_H
  S.trainDone = false;
  S.trainLast = null;
}

/**
 * Ett steg för tunnelbanan. rate(h) = husets ankomster till fots (personer/sekund) – tåget tar med sig
 * en del av dem (TRAIN_SHARE), så att det totala inflödet blir ungefär detsamma som utan station.
 */
export function trainTick(dt, rate) {
  if (STATION < 0) return;
  const h = hour();
  if (!S.trainDone && h >= LAST_H) lastTrainGone();
  const T = S.train;
  if (!T) {
    if (!trainsRunning(h) || h < FIRST_H) return;
    if (S.t < S.trainNext || (S.tunnel && S.tunnel.ph === 'stuck')) return; // (tåget står i tunneln – tunnel.js)
    S.train = { x: TRAIN_X0 - TRAIN_LEN, v: VMAX_T, state: 'in', t: 0, off: 0, spawned: 0, n: 0 };
    return;
  }
  T.t += dt;
  if (T.state === 'in') {
    // bromsar in mot perrongen
    const left = TRAIN_X0 - T.x;
    T.v = Math.max(18, Math.min(VMAX_T, left * 2.2));
    T.x = Math.min(TRAIN_X0, T.x + T.v * dt);
    if (T.x >= TRAIN_X0) arrive(T, h, rate);
  } else if (T.state === 'stop') {
    // dörrarna öppnas: först kliver folk av, sedan på
    if (T.t >= OPEN_AT && T.spawned < T.n && S.t >= (T.nextOff || 0)) {
      T.spawned++; T.nextOff = S.t + rand(0.15, 0.4);
      alight(T);
    }
    if (T.t >= OPEN_AT + 0.6) board();
    if (T.t >= DWELL) depart(T);
  } else if (T.state === 'out') {
    T.v = Math.min(VMAX_T, T.v + 160 * dt);
    T.x += T.v * dt;
    if (T.x >= TRAIN_X1) S.train = null;
  }
}
/** dörrarna öppnas om en stund (grafiken: 0 = stängda, 1 = öppna) */
export function trainDoors(T = S.train) {
  if (!T || T.state !== 'stop') return 0;
  const a = (T.t - OPEN_AT + 0.4) / 0.4, b = (DWELL - CLOSE_BEFORE + 0.4 - T.t) / 0.4;
  return Math.max(0, Math.min(1, a, b));
}
/** tåget står vid perrongen: hur många som kliver av beror på tiden på dygnet */
function arrive(T, h, rate) {
  T.state = 'stop'; T.t = 0; T.v = 0;
  S.stats.trains++;
  // tidtabellen räknas från ankomst till ankomst; med sig har tåget dem som samlats sedan förra tåget
  const since = S.trainLast !== null ? S.t - S.trainLast : headway(h);
  S.trainLast = S.t; S.trainNext = S.t + headway(h);
  if (S.fire) { T.n = 0; log('🚇 Tåget stannar men ingen kliver av – brandlarm i huset', 'alert'); return; }
  // anställda: tågets andel av det som annars hade kommit genom entrén sedan förra tåget
  const emp = rate(h) * TRAIN_SHARE * since * rand(0.7, 1.3);
  // besökare dagtid (en del går bara igenom huset upp till gatan)
  const vis = h >= 9 && h < 19 ? randi(0, 3) : h >= 19 && h < 23 ? randi(0, 1) : 0;
  T.emp = Math.round(emp); T.n = T.emp + vis;
  T.n = Math.max(0, Math.min(T.n, MAXP - S.people.length));
  T.emp = Math.min(T.emp, T.n);
  if (T.n > 0) log(sv`🚇 Tåget stannar på ${fl(STATION)} – ${T.n} kliver av`, 'sys');
}
/** en person kliver av vid en av dörrarna */
function alight(T) {
  const door = TRAIN_DOORS[randi(0, TRAIN_DOORS.length - 1)];
  const x = T.x + door * TRAIN_LEN + rand(-6, 6);
  let p;
  if (T.off < T.emp) p = spawnEmployee(x);
  else {
    const h = hour();
    // dagtid: en del går upp till caféet, resten till ett ärende i huset eller rakt upp till gatan
    p = spawnVisitor(STATION, x, h >= 11 && h < 13.5 && floorOpen(CAFE, h) && rng() < 0.4 ? CAFE : null, null);
    if (p) {
      if (p.goal !== LOBBY) p.exitFloor = STATION;
      else p.why = 'Genväg från tunnelbanan upp till gatan';
      pev(p, sv`Kliver av tåget · ${p.why}`);
    }
  }
  T.off++;
  if (p) { p.fromTrain = true; S.stats.trainIn++; }
}
/** de som väntar på perrongen kliver på (en i taget, i den ordning de kom) */
function board() {
  for (const p of S.people) {
    if (p.state !== 'platform' || p.dead) continue;
    if (p.boardAt === undefined) { p.boardAt = S.t + BOARD.rand(0, 1.8); continue; }
    if (S.t < p.boardAt) continue;
    p.dead = true; p.state = 'gone';
    S.stats.trainOut++;
    pev(p, 'Kliver på tåget – hejdå!');
    log(sv`${pn(p)} tar tåget hem`, 'person', null, p.id);
  }
}
function depart(T) {
  T.state = 'out'; T.t = 0; T.v = 20;
  // den som var nästan framme vid perrongen hann inte med
  for (const p of S.people) {
    if (p.dead) continue;
    if (p.state === 'platform' && p.boardAt !== undefined) { p.boardAt = undefined; continue; }
    if (p.toTrain && p.state === 'exiting' && p.floor === STATION && Math.abs(p.tx - p.x) < 140) {
      p.mood = Math.max(p.mood, 1);
      pev(p, 'Missade tåget med en hårsmån – väntar på nästa');
    }
  }
}
/** Den som tänkte åka tåg går ut genom entrén i stället (sista tåget har gått, eller tåget står i tunneln – tunnel.js)
 * @param {import('./people.js').Person} p */
export function toStreet(p, why) {
  p.exitFloor = LOBBY;
  if (p.state === 'platform') { p.toTrain = false; p.boardAt = undefined; setTrip(p, LOBBY, why, true); }
  else if (p.leaving && p.goal === STATION && (p.state === 'wait' || p.state === 'toQueue')) setTrip(p, LOBBY, why, true);
  else if (p.toTrain && p.state === 'exiting') { p.toTrain = false; setTrip(p, LOBBY, why, true); }
  pev(p, why);
}
/** efter sista tåget: alla som tänkte åka tåg går ut genom entrén i stället */
function lastTrainGone() {
  S.trainDone = true;
  let n = 0;
  for (const p of S.people) if (!p.dead && p.exitFloor === STATION) { toStreet(p, 'Sista tåget har gått – tar sig ut genom entrén'); n++; }
  log(sv`🚇 Sista tåget har gått${n ? sv` – ${n} får ta sig ut genom entrén` : ''}`, 'sys');
}
/** Spelaren: tågstörning – nästa tåg blir försenat och kommer med dubbelt så många (alla som samlats sedan förra) */
export function delayTrain() {
  if (STATION < 0 || !trainsRunning() || S.trainDone || (S.train && S.train.state !== 'out')) return false;
  const d = rand(30, 45);
  S.trainNext = Math.max(S.trainNext, S.t) + d;
  S.trainDelay = { t0: S.t, until: S.trainNext };
  notice('train', '🚇 Tågstörning', sv`Signalfel i tunneln: nästa tåg är ${Math.round(d)} s försenat. Folk samlas på stationerna längs linjen – när tåget väl kommer kliver dubbelt så många av på perrongen.`, { floor: STATION });
  log('🚇 Tågstörning: signalfel i tunneln – nästa tåg är försenat', 'alert');
  return true;
}
/** speltid till nästa tåg i minuter (för skylten på perrongen), eller null om inga fler går i dag */
export function nextTrainMin() {
  if (!trainsRunning() || S.train) return S.train ? 0 : null;
  const h = hour(), first = Math.max(0, (FIRST_H - h) * 3600 / timeScale(h));
  return Math.max(0, Math.round(Math.max(first, S.trainNext - S.t) * timeScale(h) / 60));
}
