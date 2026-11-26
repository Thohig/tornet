// Pixelgrafik: taket med maskinrummen, helikoptern, fönsterputsarens gondol och hissbalken,
// flyttlassen, rök och brand, strömavbrottet, väder och blixt, ambulansen och brandkåren.
import { cleanerAt, HOIST_OK, PARK_Y, TERRACE_Y } from './hoist.js';
import { hour, S } from './state.js';
import { BX1, DOCK, DOOR_X, EL, FL, FLOOR_H, FLOORS, floorY, GROUND_Y, H, HATCH_FLOORS, INNER_X1, LAND_X0, LOBBY, ROOF_Y, SHAFT_X0, shaftCX, surf, TOP, W } from './config.js';
import { windAt } from './weather.js';
import { cargoSprite, PERSON_H, PERSON_W, personSprite } from './pixpeople.js';
import { inWindow } from './render.js';
import { clamp, fl } from './util.js';
import { PAL } from './pixpal.js';
import { plain, PX, text, textW } from './pixart.js';
import { nightness, VIEW } from './view.js';
import { WARM_AT } from './service.js';
import { vrand } from './rng.js';
import { box, CY, g, HELI, INK, label, line, lo, pill, PUFF, R, RELIGHT_S, reserve, visibleX, wheelSprite, X, Y } from './pixcore.js';
import { BASE_Y, SEAM_Y, shaftTop, stackedAbove, UX1 } from './pixbuilding.js';
import { stairSign, winFig } from './pixhall.js';
import { blinkOf, drawTrappedPx } from './pixcars.js';
import { sv } from './sv.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */

// ---------- Flyttdagen ----------
/** hissbalken: balken på taket med block och talja, kroken (med lasten) och lastluckorna i tornets fasad */
export function drawHoistPx() {
  if (!HOIST_OK || !S.hoist) return;
  const H = S.hoist, M = S.move, wall = X(UX1 + 7), wind = S.storm ? windAt() : 0;
  // lastluckorna: en liten dörr i fasaden på varje bostadsvåning (öppen när kroken är där)
  for (const f of HATCH_FLOORS) {
    const yy = Y(floorY(f)) - 1;
    if (yy < -40 || yy > lo.height + 40) continue;
    const open = M && M.state === 'on' && M.floor === f && (H.phase === 'fetch' || H.phase === 'hook' || M.items.some(it => it.st === 'hatch'));
    R(wall - 6, yy - 22, 7, 22, INK); R(wall - 5, yy - 21, 5, 21, open ? '#2b2f36' : '#8a5a2b');
    if (!open) R(wall - 2, yy - 11, 1, 2, '#ffd23f');
    // möbler som står och väntar i luckan
    if (open && M) {
      const wait = M.items.find(it => it.st === 'hatch');
      const cg = wait ? cargoSprite(wait.sprite, -1) : null;
      if (cg) g.drawImage(cg.c, wall - 8 - cg.c.width + 4, yy - cg.c.height + 1);
    }
  }
  // terrassen: det som väntar på panoramahissen
  if (M && M.state === 'on') {
    const ty = Y(TERRACE_Y) - 2;
    let x = X(BX1) - 30;
    for (const it of M.items.filter(i => i.st === 'terrace')) {
      const cg = cargoSprite(it.sprite, 1); if (!cg) continue;
      g.drawImage(cg.c, x - cg.c.width, ty - cg.c.height + 1); x -= cg.c.width + 3;
    }
    const mona = S.people.find(p => p.role === 'lastare' && inWindow(p));
    if (mona) g.drawImage(personSprite(winFig(mona, 0), 'side', 0, 1, { blink: blinkOf(mona) }), X(BX1) - 22, ty - PERSON_H + 1);
  }
  if (H.phase === 'idle') return;
  // balken: en gul bom ut från taket med blocket längst ut
  const ay = Y(ROOF_Y - 10), bx0 = wall - 6, bx1 = wall + 34;
  const out = H.phase === 'rig' ? clamp(H.t / 4, 0, 1) : H.phase === 'unrig' && H.y <= PARK_Y + 1e-6 ? clamp(1 - H.t / 4, 0, 1) : 1;
  const tip = Math.round(bx0 + (bx1 - bx0) * out);
  R(bx0, ay - 13, tip - bx0 + 2, 4, INK); R(bx0 + 1, ay - 12, tip - bx0, 2, '#ffd23f');
  for (let x = bx0 + 3; x < tip - 2; x += 6) R(x, ay - 12, 2, 2, INK);
  R(tip - 2, ay - 10, 5, 5, INK); R(tip - 1, ay - 9, 3, 3, PAL.steel); // blocket
  if (out < 1) return;
  // linorna (talja: två parter) och kroken – svänger i blåsten
  const sway = Math.round(Math.sin(S.anim * 2.1) * wind * 8);
  const hy = Y(H.y), hx = tip + sway;
  if (hy < -60 || ay > lo.height + 60) return;
  line(tip - 1, ay - 7, hx - 1, hy - 8, '#3a3f4a'); line(tip + 1, ay - 7, hx + 1, hy - 8, '#3a3f4a');
  R(hx - 2, hy - 9, 5, 4, INK); R(hx - 1, hy - 8, 3, 2, PAL.steel); // underblocket
  R(hx, hy - 5, 1, 3, INK); R(hx - 1, hy - 3, 1, 1, INK); // kroken
  const it = H.item !== null && M ? M.items[H.item] : null;
  if (it) {
    const cg = cargoSprite(it.sprite, 1);
    if (cg) {
      const lx = hx - Math.round(cg.c.width / 2), ly = hy + 2;
      line(hx, hy - 2, lx + 1, ly, '#ff8c42'); line(hx, hy - 2, lx + cg.c.width - 2, ly, '#ff8c42'); // lyftstroppar
      g.drawImage(cg.c, lx, ly);
    }
  }
  if (H.halted && Math.sin(S.anim * 5) > -0.2) label(H.halted === 'blåst' ? 'VINDSTOPP' : 'STOPP', hx, hy - 24, '#ff5d52', '#ffffff');
}

/** det som står packat i trapphallen utanför lägenheten och det som väntar vid flyttbilen på lastkajen */
export function drawMovePilesPx() {
  const M = S.move;
  if (!M || M.state !== 'on') return;
  movePile(DOCK, M.items.filter(it => it.st === 'dock'));
  movePile(M.floor, M.items.filter(it => it.st === 'home'));
}
function movePile(f, items) {
  if (!items.length) return;
  const fy = Y(surf(f)), top = Y(floorY(f + 1) + 4);
  if (fy < 0 || top > lo.height) return;
  let x = X(DOOR_X) + 20;
  const show = items.slice(0, 4);
  for (const it of show) {
    const cg = cargoSprite(it.sprite, 1); if (!cg) continue;
    g.drawImage(cg.c, x, fy - cg.c.height + 1);
    x += cg.c.width + 2;
  }
  if (items.length > show.length) text(g, `+${items.length - show.length}`, x + 2, fy - 8, '#ffffff', 'left', 1, INK);
}

// ---------- Taket, helikoptern, incidenter ----------
export function drawRoofPx() {
  const n = nightness(hour());
  box(X(SHAFT_X0 - 8), Y(ROOF_Y - 50), Math.round((UX1 - SHAFT_X0 + 4) / PX), 24, PAL.machine);
  R(X(SHAFT_X0 - 8) + 1, Y(ROOF_Y - 50) + 1, Math.round((UX1 - SHAFT_X0 + 4) / PX) - 2, 1, PAL.machineHi);
  text(g, 'MASKINRUM', X(SHAFT_X0), Y(ROOF_Y - 50) + 2, INK);
  /** @param {Elevator} e */
  const wheel = (e, cx, cy) => {
    g.drawImage(wheelSprite(e.color, Math.floor(((e.distance * 2.2) % (Math.PI / 3)) / (Math.PI / 3) * 6)), X(cx) - 8, Y(cy) - 8);
    // varm motor: det ångar och lyser rött i maskinen; extrafläkten snurrar bredvid
    if (e.heat >= WARM_AT * 0.85) {
      const k = Math.min(1, (e.heat - WARM_AT * 0.85) / 0.4);
      R(X(cx) - 9, Y(cy) + 7, 18, 2, `rgba(255,${Math.round(140 - k * 100)},40,${0.4 + k * 0.5})`);
      for (let i = 0; i < 3; i++) {
        const t = (S.anim * 0.8 + i / 3) % 1;
        g.globalAlpha = (1 - t) * (0.4 + k * 0.6);
        g.drawImage(PUFF(2 + Math.round(t * 2)), X(cx) - 4 + i * 3, Y(cy) - 12 - Math.round(t * 12));
        g.globalAlpha = 1;
      }
    }
    // överhettad: luften dallrar över maskinen
    if (e.hot) for (let i = 0; i < 6; i++) { const t = (S.anim * 1.2 + i / 6) % 1; R(X(cx) - 6 + i * 2 + Math.round(Math.sin(S.anim * 6 + i) * 1.5), Y(cy) - 10 - Math.round(t * 10), 1, 2, 'rgba(255,220,160,.45)'); }
    // förvarning: motorn brummar ansträngt och börjar glöda
    if (S.warn && S.warn.type === 'heat' && S.warn.car === e.id) {
      const k = clamp((S.t - S.warn.t0) / (S.warn.until - S.warn.t0), 0, 1);
      R(X(cx) - 9, Y(cy) + 7, 18, 2, `rgba(255,140,40,${(0.2 + 0.5 * k * (0.6 + 0.4 * Math.sin(S.anim * 9))).toFixed(2)})`);
      if (Math.sin(S.anim * 5) > 0) label('BRUMMM…', X(cx), Y(cy) - 20, '#ffe9a8', INK);
    }
    if (e.fan) {
      const fx = X(cx) + 11, fy = Y(cy) - 3, a = S.anim * 14;
      box(fx - 4, fy - 4, 9, 9, PAL.steel);
      for (let i = 0; i < 3; i++) { const b = a + i * 2.094; R(fx + Math.round(Math.cos(b) * 2.5), fy + Math.round(Math.sin(b) * 2.5), 1, 1, INK); }
      R(fx, fy, 1, 1, INK);
    }
  };
  for (const e of S.elevators) {
    const cx = shaftCX(e.id);
    if (EL[e.id].facade) { box(X(UX1 + 4), Y(ROOF_Y - 26), Math.round((cx - UX1 + 2) / PX), 4, PAL.steel); wheel(e, cx, ROOF_Y - 20); continue; }
    if (EL[e.id].maxF >= TOP) { wheel(e, cx, ROOF_Y - 20); continue; }
    if (stackedAbove(EL[e.id])) continue; // maskinen sitter i mellanbjälklaget under höga zonen
    const y = shaftTop(EL[e.id]);
    box(X(cx) - 11, Y(y - 34), 23, 15, PAL.machine); // litet maskinhus – resten av taket är terrass
    wheel(e, cx, y - 19);
  }
  // skylten på taket
  const sx0 = SHAFT_X0 - 16, sx1 = UX1 + 16; // skylten får skjuta ut lite över det smala tornet
  // (skylten slutar ovanför maskinrummet: 16 + 36 låga pixlar = 88 < ROOF_Y - 50)
  for (const px of [sx0 + 60, sx1 - 60]) R(X(px) - 1, Y(88), 3, Y(ROOF_Y - 50) - Y(88), INK);
  const bx = X(sx0), by = Y(16), bw = X(sx1) - bx, bh = 36;
  box(bx, by, bw, bh, PAL.sign); R(bx + 1, by + 1, bw - 2, 1, PAL.signHi); R(bx + 1, by + bh - 2, bw - 2, 1, PAL.signLo);
  const nb = Math.floor((bw - 12) / 10);
  for (let i = 0; i < nb; i++) {
    const on = S.power && (Math.floor(S.anim * 4) + i) % 3 === 0;
    for (const yy of [by + 3, by + bh - 5]) R(bx + 6 + i * 10, yy, 2, 2, on ? PAL.bulbOn : PAL.bulbOff);
  }
  const ts = Math.max(1, Math.min(4, Math.floor((bw - 10) / textW('SKYSKRAPAN'))));
  // (textens överkant är accentraden och konturen – två rader ovanför bokstäverna)
  text(g, 'SKYSKRAPAN', bx + bw / 2, by + Math.round((bh - 5 * ts) / 2) - 2 * ts, '#ffffff', 'center', ts, INK);
  const ax = X(UX1 - 24);
  R(ax, Y(16), 2, Y(ROOF_Y - 50) - Y(16), INK); R(ax - 7, Y(60), 16, 2, INK); R(ax - 5, Y(80), 12, 2, INK);
  // vimpel i masten: står rakt ut i stormen
  const w = windAt(), fl0 = Y(40), flen = 5 + Math.round(w * 16);
  for (let i = 0; i < flen; i++) {
    const wave = Math.round(Math.sin(S.anim * (3 + w * 9) - i * 0.6) * (1.5 - w) * (i / flen) * 2 + (1 - w) * i * 0.5);
    R(ax + 2 + i, fl0 + wave, 1, Math.max(1, 4 - Math.floor(i * 3 / flen)), i % 6 < 3 ? '#ffe14d' : '#2a5db0');
  }
  const blink = Math.sin(S.anim * 4) > 0;
  if (blink) R(ax - 4, Y(20) - 4, 10, 10, `rgba(255,45,85,${0.35 + n * 0.3})`);
  box(ax - 2, Y(20) - 2, 6, 6, blink ? '#ff2d55' : '#7a2033');
}
// ---------- Fönsterputsaren och hissbalken ----------
// En gondol hänger i en arm på taket utanför det smala tornet; på flyttdagen tar hissbalken samma skena
// (läget räknas i simuleringen – hoist.js – här ritas bara).
// (putsaren och lastaren på terrassen är personer i huset – crew.js)
export function drawCleanerPx() {
  const G0 = cleanerAt(); // (null: huset har inget smalt torn att putsa)
  if (!G0) return;
  const wind = S.storm ? windAt() : 0;
  const wall = X(UX1 + 7), ay = Y(ROOF_Y - 10), ax0 = wall - 4, ax1 = wall + 26;
  // armen på taket med två linor
  R(ax0, ay - 8, 2, 9, INK); R(ax0, ay - 1, ax1 - ax0 + 2, 3, INK); R(ax0 + 1, ay, ax1 - ax0, 1, PAL.steel);
  const sway = Math.round(Math.sin(S.anim * 2.6) * wind * 6);
  const gx = wall + 3 + sway, gw = 22, gy = Y(G0.y);
  if (gy < -20 || ay > lo.height + 20) return;
  for (const cx of [gx + 3, gx + gw - 4]) line(cx - sway, ay + 2, cx, gy - 12, '#3a3f4a');
  // putsaren (vänd mot fasaden) och hinken
  const hasse = G0.crew ? S.people.find(p => p.role === 'fönsterputsare' && inWindow(p)) : null;
  // vinschen har kärvat (gondola.js): gondolen rycker till, och i repet firas Hasse ner bredvid den
  const GS = S.gondola, ropeY = GS && GS.ph === 'stuck' ? GS.ropeY : null;
  if (hasse && ropeY !== null) {
    const ry = Y(ropeY), rx = gx + gw + 6;
    line(rx, ay + 2, rx, ry - PERSON_H + 2, '#ff8c42');
    g.drawImage(personSprite(winFig(hasse, 2), 'front', 0, 1, { blink: blinkOf(hasse) }), rx - PERSON_W / 2, ry - PERSON_H + 1);
  } else if (hasse) {
    const bob = G0.scrub ? Math.round(Math.sin(S.anim * 5) * 1) : 0;
    g.drawImage(personSprite(winFig(hasse, wind > 0.5 ? 1 : 0), 'side', 0, -1, { blink: blinkOf(hasse) }), gx + 4, gy - PERSON_H + 1 + bob);
    if (G0.scrub && wind < 0.5) {
      // skrapan går upp och ner mot fasaden; det glittrar där det blivit rent
      const sy = gy - 16 + Math.round(Math.sin(S.anim * 4) * 6);
      line(gx + 6, gy - 11, wall + 1, sy, '#8a5a2b'); R(wall, sy - 3, 2, 7, INK); R(wall + 1, sy - 2, 1, 5, '#36c5d6');
      if (Math.sin(S.anim * 7) > 0.6) R(wall - 2 + Math.round(vrand(0, 3)), sy + Math.round(vrand(-8, 8)), 1, 1, '#ffffff');
    }
  }
  if (GS && GS.ph === 'stuck') { box(gx + gw / 2 - 3, gy - 22, 7, 7, '#ffd23f'); text(g, '!', gx + gw / 2, gy - 21, INK, 'center'); }
  // korgen: räcke, golv och en hink
  R(gx, gy - 12, gw, 1, INK); R(gx, gy - 12, 1, 12, INK); R(gx + gw - 1, gy - 12, 1, 12, INK);
  R(gx + gw - 7, gy - 5, 4, 4, INK); R(gx + gw - 6, gy - 4, 2, 3, '#3f7cff');
  box(gx - 1, gy - 6, gw + 2, 7, PAL.steel);
  text(g, 'PUTS', gx + gw / 2, gy - 5, INK, 'center');
  // droppar från skrapan
  if (G0.scrub) for (let i = 0; i < 3; i++) {
    const k = (S.anim * 0.9 + i / 3) % 1;
    R(gx + 4 + i * 6, gy + 2 + Math.round(k * 40), 1, 2, `rgba(120,200,255,${1 - k})`);
  }
}
const ROOF_F = FL.findIndex(f => f.theme === 'roof');
export function drawHeliPx() {
  const Hh = S.heli; if (!Hh || ROOF_F < 0) return;
  const bot = floorY(ROOF_F) - 4, x = X(476), y = Y(bot - 30 + Hh.y);
  const s = HELI();
  g.drawImage(s, x - 17, y - 8);
  const span = Math.round(28 * Math.abs(Math.cos(S.anim * (Hh.state === 'parked' ? 4 : 25))));
  R(x - span + 2, y - 10, span * 2, 2, INK); R(x - span + 3, y - 10, span * 2 - 2, 1, '#94a3b8');
  R(x + 2, y - 9, 2, 2, INK);
  text(g, 'VIP', x - 2, y - 2, '#ffe14d', 'left', 1, INK);
  if (Hh.state !== 'parked') for (let i = 0; i < 4; i++) { const k = (S.anim * 2 + i / 4) % 1; const r = Math.round(15 + k * 25); R(x - r, Y(bot) - 2 - i, 4, 1, 'rgba(255,255,255,.6)'); R(x + r, Y(bot) - 2 - i, 4, 1, 'rgba(255,255,255,.6)'); }
}
/** hur långt släckningen har kommit (0–1): från att brandmännen är framme tills branden är ute */
export const fireProg = F => (F.outAt !== null ? clamp(1 - (F.outAt - S.t) / 28, 0, 1) : 0);
export function drawSmokePx() {
  const F = S.fire;
  // förvarning: det luktar bränt – tunna rökslingor ur korridoren på våningen
  if (!F) {
    const W = S.warn;
    if (!W || W.type !== 'fire') return;
    const k0 = clamp((S.t - W.t0) / (W.until - W.t0), 0, 1), top = floorY(W.floor + 1) + 4;
    for (let i = 0; i < 4; i++) {
      const k = (S.anim * 0.3 + i / 4) % 1, x = DOOR_X + 6 + i * 9 + Math.sin(S.anim * 1.5 + i) * 4;
      g.globalAlpha = (1 - k) * 0.25 * (0.4 + k0); g.drawImage(PUFF(2 + Math.round(k * 2)), X(x) - 2, Y(top + 40 - k * 40) - 2);
    }
    g.globalAlpha = 1;
    return;
  }
  const prog = fireProg(F);
  const top = floorY(F.floor + 1) + 4;
  for (let i = 0; i < 14; i++) {
    const k = (S.anim * 0.35 + i / 14) % 1;
    const x = 120 + (i * 37) % 820 + Math.sin(S.anim + i) * 10;
    if (x < LAND_X0 - 20) continue;
    const y = top + 30 - k * FLOOR_H * 1.8, r = Math.round((10 + k * 22) / PX);
    g.globalAlpha = (1 - k) * 0.55 * (1 - prog);
    g.drawImage(PUFF(r), X(x) - r, Y(y) - r);
  }
  g.globalAlpha = 1;
}
export function drawOutagePx() {
  // strömmen är tillbaka: våningarna tänds en i taget nerifrån och upp
  if (S.power) {
    // förvarning: lamporna flimrar
    if (S.warn && S.warn.type === 'power' && vrand(0, 1) < 0.3) R(X(LAND_X0 - 20), Y(ROOF_Y - 4), lo.width, Y(BASE_Y) - Y(ROOF_Y - 4), `rgba(8,4,28,${vrand(0.15, 0.45).toFixed(2)})`);
    const k = S.powerBack === null ? 1 : (S.t - S.powerBack) / RELIGHT_S;
    if (k >= 1) return;
    for (let f = Math.floor(k * FLOORS); f < FLOORS; f++) {
      const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) + 4);
      if (bot < 0 || top > lo.height) continue;
      R(X(LAND_X0 - 20), top, lo.width, bot - top, 'rgba(8,4,28,.55)');
    }
    return;
  }
  const O = S.outage;
  R(X(LAND_X0 - 20), Y(ROOF_Y - 4), lo.width, Y(BASE_Y) - Y(ROOF_Y - 4), `rgba(8,4,28,${O && O.gen ? 0.48 : 0.62})`);
  const on = Math.sin(S.anim * 5) > 0;
  for (let f = 0; f < FLOORS; f++) {
    const top = Y(floorY(f + 1) + 4);
    if (top < -60 || top > lo.height) continue;
    if (on) R(X(INNER_X1) - 15, top + 2, 7, 7, 'rgba(255,93,82,.35)');
    R(X(INNER_X1) - 13, top + 4, 3, 3, on ? '#ff5d52' : '#5a1e2a');
    stairSign(f, true);
  }
  drawTrappedPx();
  if (O && O.gen) {
    const gx = X(UX1 - 40), gy = Y(ROOF_Y - 70);
    box(gx - 15, gy, 30, 11, PAL.green); text(g, 'RESERV', gx, gy + 2, '#ffffff', 'center');
    for (let i = 0; i < 2; i++) { const k = (S.anim * 0.9 + i * 0.5) % 1; g.globalAlpha = 1 - k; g.drawImage(PUFF(2 + Math.round(k * 2)), gx + 9, gy - 4 - Math.round(k * 10)); g.globalAlpha = 1; }
  }
}
export function drawBannersPx() {
  const list = [];
  if (S.fire) list.push([sv`🔥 BRAND PÅ VÅNING ${fl(S.fire.floor)}${!S.fire.brigade ? '' : S.fire.outAt === null ? ' – BRANDKÅREN GÅR IN' : ' – BRANDKÅREN SLÄCKER'}`, '#ff2d55']);
  if (!S.power) list.push([sv`⚡ STRÖMAVBROTT${S.outage && S.outage.gen ? ' – RESERVKRAFT' : ''}`, '#6366f1']);
  if (S.storm) list.push([sv`🌬️ STORM${S.storm.mode === 'sway' ? ' – SVAJLÄGE' : ''}`, '#2a5db0']);
  // mitt i det som syns: på mobilen i närbild är bilden bredare än skärmen och flyttad panX css-pixlar i sidled
  // (view.js) – mitt i hela bilden hamnar skylten halvvägs utanför. Får den inte plats blir texten mindre.
  const [vx0, vx1] = visibleX(), vw = vx1 - vx0;
  list.forEach(([t, c], i) => {
    const s = plain(t), on = Math.sin(S.anim * 6) > -0.3, y = Math.round(VIEW.camY / PX) - CY + 6 + i * 18;
    const sc = textW(s) * 2 + 16 <= vw - 4 ? 2 : 1, w = textW(s) * sc + 16, h = sc === 2 ? 16 : 11;
    const cx = Math.round(clamp(vx0 + vw / 2, vx0 + w / 2 + 2, vx0 + vw - w / 2 - 2)), x = Math.round(cx - w / 2);
    pill(x, y, w, h, on ? c : INK);
    text(g, s, cx, y + 2, on ? '#ffffff' : c, 'center', sc);
  });
}
// ---------- Väder och ambulans (bara grafik) ----------
/** snöflingor när det är kallt – bara utanför huset (himlen, ovanför taket och terrassen, fasaden) */
const snow = [];
export function drawSnowPx(dt) {
  const c = S.weather.cold;
  if (c <= 0) { snow.length = 0; return; }
  const want = Math.round(40 + c * 120), w = windAt();
  while (snow.length < want) snow.push({ x: vrand(LAND_X0, W), y: vrand(VIEW.camY - 40, VIEW.camY + VIEW.viewH), v: vrand(18, 40), p: vrand(0, 6) });
  if (snow.length > want) snow.length = want;
  const outside = (x, y) => y < ROOF_Y - 6 || x > BX1 + 8 || (x > UX1 + 8 && y < SEAM_Y - 6) || y > GROUND_Y + 2 && x > BX1;
  for (const f of snow) {
    if (S.started && !S.paused) { f.y += f.v * dt * S.speed; f.x += (Math.sin(S.anim + f.p) * 8 + w * 90) * dt * S.speed; }
    if (f.y > VIEW.camY + VIEW.viewH + 20 || f.x > W + 10) { f.y = VIEW.camY - vrand(0, 40); f.x = vrand(LAND_X0 - 100, W); }
    if (outside(f.x, f.y)) R(X(f.x), Y(f.y), 1, 1, 'rgba(255,255,255,.85)');
  }
}
/** Blåljusskyltarna i entrén: en rad var, i ordningen brandkåren, ambulansen, polisen (de kan vara där samtidigt). */
function lobbySigns() {
  const top = Y(floorY(LOBBY + 1) + 4), x1 = X(INNER_X1), A = S.medic, Hs = S.heist;
  /** @type {{ k: string, s: string, cx: number, fill: string, color: string }[]} */
  const out = [];
  if (S.brigade || (S.fire && S.fire.brigade)) out.push({ k: 'brigade', s: 'BRANDKÅREN', cx: x1 - 58, fill: '#ffffff', color: '#c81e3a' });
  if (A && A.state !== 'done' && A.state !== 'called') out.push({ k: 'medic', s: 'AMBULANS', cx: x1 - 50, fill: '#ffffff', color: '#2ec4b6' });
  if (Hs && Hs.police && !(Hs.ph === 'done' && !Hs.caught)) out.push({ k: 'police', s: 'POLISEN', cx: x1 - 50, fill: '#ffffff', color: '#2a5db0' });
  return out.map((o, i) => ({ ...o, y: top + 12 + i * 11 }));
}
/** skyltarna bokar sin plats innan folket i hallen ritas (namnbrickor och bubblor flyttar sig) */
export function reserveLobbySigns() {
  for (const o of lobbySigns()) { const w = textW(plain(o.s)) + 5; reserve(Math.round(o.cx - w / 2), o.y, w, 9); }
}
/** @param {string} k */
function lobbySign(k) { const o = lobbySigns().find(q => q.k === k); if (o) label(o.s, o.cx, o.y, o.fill, o.color); }
/** ambulansen: blått blinkljus i entrén medan personalen är i huset */
export function drawMedicPx() {
  const A = S.medic;
  if (!A || A.state === 'done' || A.state === 'called') return;
  const top = Y(floorY(LOBBY + 1) + 4), bot = Y(floorY(LOBBY) - 4), x0 = X(LAND_X0);
  if (bot < 0 || top > lo.height) return;
  const on = Math.sin(S.anim * 12) > 0;
  if (on) R(x0, top, X(INNER_X1) - x0, bot - top, 'rgba(60,120,255,.12)');
  const x1 = X(INNER_X1);
  box(x1 - 22, top + 3, 7, 5, on ? '#3f7cff' : '#1b2a6e');
  lobbySign('medic');
}
/** Stormen: mörkare himmel (även som förvarning), regn och blixtar – och blixten som slår ut strömmen */
export function drawWeatherPx() {
  const St = S.storm, W = S.warn && S.warn.type === 'storm' ? S.warn : null;
  const dim = St ? 0.18 * clamp(windAt() / 0.8, 0.3, 1) : W ? 0.18 * clamp((S.t - W.t0) / (W.until - W.t0), 0, 1) : 0;
  if (dim > 0) R(0, 0, lo.width, lo.height, `rgba(20,24,48,${dim.toFixed(3)})`);
  if (!St) return;
  // regnet piskar snett i vinden
  const w = windAt(), n = Math.round(40 + w * 80), slant = Math.round(1 + w * 3);
  for (let i = 0; i < n; i++) {
    const rx = ((i * 97 + S.anim * (60 + w * 90)) % (lo.width + 40)) - 20, ry = ((i * 53 + S.anim * 260) % (lo.height + 20)) - 10;
    R(Math.round(rx), Math.round(ry), 1, 3, 'rgba(180,200,255,.35)'); R(Math.round(rx) + slant, Math.round(ry) + 3, 1, 2, 'rgba(180,200,255,.25)');
  }
}
/** blixten ritas sist (ovanpå strömavbrottets mörker): vitt sken och en blixt ner i taket, eller blixtar långt borta */
export function drawLightningPx() {
  const St = S.storm;
  if (!St) return;
  const since = St.struck !== null ? S.t - St.struck : Infinity;
  if (since < 0.6) {
    R(0, 0, lo.width, lo.height, `rgba(255,255,255,${(0.55 * (1 - since / 0.6)).toFixed(2)})`);
    let bx = X(SHAFT_X0 + 60), by = Y(ROOF_Y - 400);
    const ty = Y(ROOF_Y - 40);
    while (by < ty) { const nx = bx + Math.round(vrand(-5, 5)), ny = Math.min(ty, by + Math.round(vrand(4, 9))); line(bx, by, nx, ny, '#ffffff'); bx = nx; by = ny; }
  } else if (vrand(0, 1) < 0.006) R(0, 0, lo.width, lo.height, 'rgba(255,255,255,.25)'); // blixtar långt borta
}
/** Kuppen: polisens blåljus i entrén (och vid lastkajen när insatsstyrkan väntar i garaget) */
export function drawPolicePx() {
  const Hs = S.heist;
  if (!Hs || !Hs.police || (Hs.ph === 'done' && !Hs.caught)) return;
  const on = Math.sin(S.anim * 10) > 0;
  for (const f of Hs.plan === 'garage' && DOCK >= 0 ? [LOBBY, DOCK] : [LOBBY]) {
    const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) - 4);
    if (bot < 0 || top > lo.height) continue;
    const x0 = X(LAND_X0), x1 = X(INNER_X1);
    R(x0, top, x1 - x0, bot - top, on ? 'rgba(60,120,255,.12)' : 'rgba(60,120,255,.04)');
    box(x1 - 32, top + 3, 7, 5, on ? '#3f7cff' : '#1b2a6e'); box(x1 - 22, top + 3, 7, 5, on ? '#1b2a6e' : '#3f7cff');
    if (f === LOBBY) lobbySign('police'); // (under brandkårens och ambulansens skyltar, lobbySigns)
    else label('INSATSSTYRKAN', x1 - 66, top + 12, '#ffffff', '#2a5db0');
  }
}
/** Brandkåren: blåljus i entrén och folket på återsamlingsplatsen utanför entrédörren */
export function drawBrigadePx() {
  const top = Y(floorY(LOBBY + 1) + 4), bot = Y(floorY(LOBBY) - 4);
  if (bot < 0 || top > lo.height) return;
  const x0 = X(LAND_X0), x1 = X(INNER_X1);
  if (S.brigade || (S.fire && S.fire.brigade)) {
    const on = Math.sin(S.anim * 11) > 0;
    R(x0, top, x1 - x0, bot - top, on ? 'rgba(255,45,85,.10)' : 'rgba(60,120,255,.10)');
    box(x1 - 32, top + 3, 7, 5, on ? '#ff2d55' : '#7a2033'); box(x1 - 22, top + 3, 7, 5, on ? '#1b2a6e' : '#3f7cff');
    lobbySign('brigade');
  }
  const out = S.people.filter(p => p.state === 'assembly');
  if (!out.length) return;
  // utanför glasdörren: en klunga som väntar (de närmast ritas, resten syns i siffran)
  const fy = Y(surf(LOBBY)) + 1;
  out.slice(0, 7).forEach((p, i) => {
    g.globalAlpha = 0.85;
    g.drawImage(personSprite(p, 'side', 0, 1, { blink: blinkOf(p) }), x0 + 1 + i * 5 - (i % 2), fy - PERSON_H - (i % 2) * 2);
    g.globalAlpha = 1;
  });
  label(sv`ÅTERSAMLING ${out.length}`, x0 + 2, fy - PERSON_H - 12, '#ffffff', '#c81e3a', 'left');
}
