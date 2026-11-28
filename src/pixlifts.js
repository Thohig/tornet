// Hissarna: den andra vyn (VIEW.mode === 'lifts', view.js). Hela huset på en gång, schematiskt, som en skärm i
// driftcentralen: våningarna som rader (stationen längst ner, taket överst), köerna till vänster och de åtta
// hissarna i sina schakt – korgarna ritas större än skalan, med folket som små figurer. Det som gör vyn unik är att
// Hiss-O-Matics tankar syns: en streckad linje går från dem som väntar till hissen de har fått (p.assigned), och
// hissens stopp (carCalls) och hämtningar (pick) står som prickar i schaktet. Korgarnas skyltar är desamma som i
// Våningarna (carLabels i pixcars.js). Bara grafik: läser simuleringen och ändrar den aldrig.
//
// Översikt: `renderLifts` ritar allt i ritytan från pixcore.js (beginFrame) med egna koordinater – inte världens.
// `LIFTS` minns var allt hamnade, så att klick (input.js: `liftHit`) och regissören vet var korgarna och raderna är.
import { EL, FL, FLOORS, FULL_LOAD, LOBBY, NCOL, SHAFT_GAP, SHAFT_W, SHAFT_X0, SKY, STRAT_NAMES, shaftX } from './config.js';
import { S } from './state.js';
import { dark, light, plain, text, textW } from './pixart.js';
import { PAL } from './pixpal.js';
import { fl } from './util.js';
import { VIEW } from './view.js';
import { buttonsMode, hallLit } from './buttons.js';
import { assignedTo, cabinKg } from './dispatch.js';
import { carLabels } from './pixcars.js';
import { ants, box, g, INK, label, pill, R, reserve } from './pixcore.js';
import { sv } from './sv.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

/** var allt hamnade i senaste bildrutan (låga pixlar): korgarna, raderna och köernas kant */
export const LIFTS = {
  /** @type {{ x: number, y: number, w: number, h: number, id: number }[]} */ cars: [],
  top: 0, fh: 10, q1: 0, w: 0,
  /** våningsradens överkant och nederkant för våning f */
  row(f) { const yb = this.top + (FLOORS - f) * this.fh; return [yb - this.fh, yb]; },
};
const HEAD = 13;      // titelraden
const LABEL_W = 15;   // våningarnas etiketter
const FIG = 6, FIG_H = 10; // en liten figur är 5 × 9 pixlar, plus mellanrum
const BG = '#0b1020', ROW_A = '#111833', ROW_B = '#0e1429', SHAFT = '#1c2536', RAIL = '#2f3a52';
/** schaktkolumnen för hiss e (panoramahissen sist, utanför tornet) @param {{ id: number, facade?: boolean }} e */
const colOf = e => (e.facade ? NCOL : Math.round((shaftX(e.id) - SHAFT_X0) / (SHAFT_W + SHAFT_GAP)));

/** Hela bilden i Hissarna. w, h = ritytans storlek i låga pixlar; bottom = det textskylten täcker nertill. */
export function renderLifts(w, h, bottom) {
  R(0, 0, w, h, BG);
  // våningsraderna fyller höjden mellan titelraden och textskylten
  const fh = Math.max(11, Math.min(34, Math.floor((h - HEAD - bottom - 6) / FLOORS)));
  const top = HEAD + 3, L = Math.max(58, Math.min(180, Math.round(w * 0.27)));
  const colW = Math.max(18, Math.floor((w - L - 6) / (NCOL + 1)));
  Object.assign(LIFTS, { top, fh, q1: L - 4, w, cars: [] });
  const y0 = f => LIFTS.row(f)[0], y1 = f => LIFTS.row(f)[1];
  const cx0 = c => L + c * colW;
  // ---------- raderna och etiketterna ----------
  for (let f = 0; f < FLOORS; f++) {
    R(0, y0(f), w, fh, f % 2 ? ROW_A : ROW_B);
    if (S.fire && S.fire.floor === f && S.fire.outAt === null && Math.sin(S.anim * 6) > -0.3) R(0, y0(f), w, fh, 'rgba(255,60,40,.28)');
    const acc = FL[f].acc, s = plain(fl(f)), lw = Math.max(11, textW(s) + 4);
    pill(1, y1(f) - Math.min(fh - 1, 8) - Math.max(0, Math.floor((fh - 9) / 2)), lw, Math.min(fh - 1, 8) + 1, acc);
    text(g, s, 1 + lw / 2, y1(f) - 7 - Math.max(0, Math.floor((fh - 9) / 2)), PAL.on(acc), 'center');
  }
  // entrén och sky lobbyn: en tunn linje i radens färg
  for (const f of [LOBBY, SKY]) if (f >= 0) R(LABEL_W, y1(f) - 1, w - LABEL_W, 1, dark(FL[f].acc, 0.2));
  // ---------- köerna: de som väntar på varje våning, närmast hissarna först ----------
  for (let f = 0; f < FLOORS; f++) queueRow(f, LABEL_W + 2, L - 4, y1(f) - 1, fh);
  // ---------- schakten ----------
  for (const e of EL) {
    const x = cx0(colOf(e)) + 2, sw = colW - 4, yt = y0(e.topF), yb = y1(e.minF);
    R(x, yt, sw, yb - yt, SHAFT); R(x, yt, 1, yb - yt, RAIL); R(x + sw - 1, yt, 1, yb - yt, RAIL);
    // hållplatserna: ett märke vid dörren; där hissen inte stannar (expressträckan) en prickad mittlinje
    for (let f = e.minF; f <= e.topF; f++) {
      if (e.serves.includes(f)) R(x + 1, y1(f) - 3, 2, 2, '#5b6b80');
      else for (let y = y0(f); y < y1(f); y += 3) R(x + Math.floor(sw / 2), y, 1, 1, RAIL);
    }
  }
  // stopp och hämtningar: prickar i schaktets högra kant
  for (const e of S.elevators) {
    const x = cx0(colOf(e)) + colW - 6, c = light(e.color, 0.25);
    for (const cp of e.carCalls) for (let k = 0; k <= (e.deck2 ? 1 : 0); k++) {
      if (cp + k > EL[e.id].topF) continue;
      const yy = y0(cp + k) + Math.floor(fh / 2) - 1;
      R(x, yy, 3, 3, INK); R(x + 1, yy + 1, 1, 1, c);
    }
    for (let f = e.minF; f <= e.maxF; f++) if (assignedTo(e, f, 1) || assignedTo(e, f, -1)) { const yy = y0(f) + Math.floor(fh / 2) - 1; R(x, yy, 3, 3, c); R(x + 1, yy + 1, 1, 1, INK); }
  }
  // ---------- tilldelningarna: från kön till hissen ----------
  if (!buttonsMode()) for (let f = 0; f < FLOORS; f++) {
    const by = new Map();
    for (const p of S.people) if (p.floor === f && p.state === 'wait' && p.assigned !== null && !p.dead) by.set(p.assigned, (by.get(p.assigned) || 0) + 1);
    for (const [id] of by) {
      const e = S.elevators[id], G = carBox(e, cx0, colW, fh, y1);
      dashed(L - 3, y0(f) + Math.floor(fh / 2), G.x - 1, Math.round((G.y + G.y + G.h) / 2), light(e.color, 0.3));
    }
  }
  // ---------- korgarna ----------
  for (const e of S.elevators) car(e, carBox(e, cx0, colW, fh, y1));
  // ---------- titelraden ----------
  head(w);
}

/** korgens ruta: botten vid korgens läge, en dubbeldäckare täcker två rader @param {Elevator} e */
function carBox(e, cx0, colW, fh, y1) {
  const yb = Math.round(y1(0) - (e.pos + (e.level || 0) * 2.5) * fh);
  const h = e.deck2 ? fh * 2 : Math.max(18, Math.min(34, fh + 8));
  return { x: cx0(colOf(e)) + 3, y: yb - h, w: colW - 6, h };
}
/** en korg med folket som små figurer, namnet, vågen och skylten (samma som i Våningarna) @param {Elevator} e */
function car(e, G) {
  const { x, y, w, h } = G;
  LIFTS.cars.push({ ...G, id: e.id });
  const off = e.off || e.mode === 'locked' || e.sleep || e.zoneLock || e.mode === 'broken' || e.mode === 'snapped' || e.mode === 'service' || e.hold || e.hot || e.windLock;
  const body = off ? PAL.carOff : e.color;
  box(x, y, w, h, body);
  // överkanten: namnet och riktningen
  text(g, e.name, x + 2, y + 1, PAL.on(body));
  if (e.dir && e.state === 'moving' && w >= textW(e.name) + 9) {
    const ax = x + textW(e.name) + 4, ay = y + 2, c = PAL.on(body);
    if (e.dir > 0) { R(ax + 1, ay, 1, 1, c); R(ax, ay + 1, 3, 1, c); R(ax - 1, ay + 2, 5, 1, c); } else { R(ax - 1, ay, 5, 1, c); R(ax, ay + 1, 3, 1, c); R(ax + 1, ay + 2, 1, 1, c); }
  }
  // insidan: en eller två korgar (dubbeldäck), med dörrarna öppna syns det ljusare
  const decks = e.deck2 ? 2 : 1, ih = Math.floor((h - 8) / decks);
  for (let k = 0; k < decks; k++) {
    const iy = y + h - 1 - (k + 1) * ih, open = e.state === 'doors' && e.door > 0.3;
    R(x + 1, iy, w - 2, ih - (k ? 1 : 0), open ? '#fff8d0' : PAL.cabin);
    if (open) R(x + 1, iy, 1, ih, '#7dff9a');
    const ps = e.passengers.filter(p => !e.deck2 || (p.deck || 0) === (decks - 1 - k ? 0 : 1));
    figures(ps, x + 2, iy + ih - 2, w - 4, ih - 2);
  }
  // vågen: en list längst ner som fylls (röd vid full last)
  const load = Math.min(1, cabinKg(e) / e.ratedKg);
  if (load > 0) R(x + 1, y + h - 2, Math.max(1, Math.round((w - 2) * load)), 1, load >= FULL_LOAD ? '#ff2d55' : '#7dff9a');
  // skylten över korgen (den viktigaste) – blinkar som i Våningarna
  const lab = carLabels(e)[0];
  if (lab && lab.show) {
    const lw = textW(plain(lab.s)) + 5, lx = Math.max(LIFTS.q1 + 2, Math.min(LIFTS.w - lw - 1, Math.round(x + w / 2 - lw / 2)));
    label(lab.s, lx, y - 10, lab.fill, lab.color, 'left');
    reserve(lx, y - 10, lw, 9);
  }
  if (VIEW.follow === e.id) ants(x - 2, y - 2, w + 4, h + 4, '#7dff9a');
  else if (VIEW.auto && VIEW.shot && VIEW.shot.kind === 'car' && VIEW.shot.id === e.id) ants(x - 2, y - 2, w + 4, h + 4, '#ffe14d', 5);
  if (S.sel && S.sel.state === 'ride' && S.sel.car === e) ants(x - 1, y - 1, w + 2, h + 2, '#ffe14d');
}
/** små figurer i en ruta: rader nerifrån, de som inte får plats som "+n" @param {Person[]} ps */
function figures(ps, x, yb, w, h) {
  const per = Math.max(1, Math.floor(w / FIG)), rows = Math.max(1, Math.min(3, Math.floor((h + 1) / FIG_H)));
  const max = per * rows, n = ps.length > max ? max - 1 : ps.length;
  for (let i = 0; i < n; i++) mini(ps[i], x + (i % per) * FIG, yb - Math.floor(i / per) * FIG_H);
  if (ps.length > n) text(g, `+${ps.length - n}`, x + (n % per) * FIG, yb - Math.floor(n / per) * FIG_H - 6, '#ffffff', 'left', 1, INK);
}
/** en liten figur (5 × 9) i personens färger; fötterna på yb @param {Person} p */
function mini(p, x, yb) {
  const L = p.look, y = yb - 8, pants = L.pants || '#3a3f48';
  if (p.cargo && p.cargo.kg >= 22) { R(x + 4, yb - 3, 3, 4, INK); R(x + 5, yb - 2, 1, 2, '#c08a52'); } // tung last bredvid
  R(x + 1, y, 3, 1, L.hairC || INK);
  R(x + 1, y + 1, 3, 2, L.skin || '#e0b08a'); R(x + 1, y + 1, 1, 1, L.hairC || INK);
  R(x, y + 3, 5, 3, L.shirt || '#3f7cff'); R(x + 2, y + 3, 1, 1, light(L.shirt || '#3f7cff', 0.3));
  R(x + 1, y + 6, 1, 3, pants); R(x + 3, y + 6, 1, 3, pants);
  if (p.vip) R(x + 1, y - 2, 3, 1, '#ffd23f');
  if ((p.mood || 0) >= 2 && Math.sin(S.anim * 6 + p.id) > 0) R(x + 1, y + 1, 3, 2, '#ff5d52');
}
/** kön på våning f: de som väntar, närmast hissarna längst till höger; i KNAPPAR-läget lyser hallknapparna */
function queueRow(f, xa, xb, yb, fh) {
  const q = S.people.filter(p => p.floor === f && p.state === 'wait' && !p.dead);
  let x1 = xb;
  if (buttonsMode()) {
    const groups = [...new Set(S.elevators.filter(e => e.serves.has(f)).map(e => e.group))];
    for (const d of [1, -1]) {
      const lit = groups.some(gr => hallLit(gr, f, d)), c = lit ? '#ffe14d' : '#3a3f48', ly = yb - (d > 0 ? 6 : 3);
      if (d > 0) { R(x1 - 2, ly, 1, 1, c); R(x1 - 3, ly + 1, 3, 1, c); } else { R(x1 - 3, ly, 3, 1, c); R(x1 - 2, ly + 1, 1, 1, c); }
    }
    x1 -= 6;
  }
  if (!q.length) return;
  q.sort((a, b) => (a.assigned ?? 99) - (b.assigned ?? 99) || a.id - b.id);
  const fit = Math.max(1, Math.floor((x1 - xa - 10) / FIG)), n = Math.min(q.length, fit);
  for (let i = 0; i < n; i++) {
    const p = q[i], x = x1 - (i + 1) * FIG;
    mini(p, x, yb - 1);
    // under figuren: hissen den har fått, i hissens färg
    if (p.assigned !== null) R(x, yb, 5, 1, S.elevators[p.assigned].color);
    if (S.sel === p) ants(x - 2, yb - 11, 9, 13, '#ffe14d');
  }
  if (q.length > n) text(g, `+${q.length - n}`, x1 - n * FIG - 2, yb - Math.min(fh - 2, 6), '#ffffff', 'right');
}
/** streckad linje som rör sig mot hissen */
function dashed(xa, ya, xb, yb, c) {
  const n = Math.max(Math.abs(xb - xa), Math.abs(yb - ya)), ph = Math.floor(S.anim * 10) % 4;
  g.fillStyle = c;
  for (let i = 0; i <= n; i++) if ((i - ph + 400) % 4 < 2) g.fillRect(Math.round(xa + (xb - xa) * i / n), Math.round(ya + (yb - ya) * i / n), 1, 1);
}
/** titelraden: Hiss-O-Matic, styrlogiken och läget (strömavbrott, krasch) */
function head(w) {
  R(0, 0, w, HEAD, PAL.sign); R(0, HEAD, w, 1, PAL.signHi);
  const wait = S.people.filter(p => p.state === 'wait' && !p.dead).length;
  const ride = S.elevators.reduce((n, e) => n + e.passengers.length, 0);
  const alert = !S.power ? 'STRÖMAVBROTT' : S.crash ? 'NÖDLÄGE' : S.fire ? 'BRANDLARM' : '';
  text(g, sv`HISS-O-MATIC 3000 · ${STRAT_NAMES[S.strategy]}`, 4, 4, '#ffffff');
  const right = sv`${wait} väntar · ${ride} åker`;
  text(g, right, w - 4, 4, '#ffe14d', 'right');
  if (alert && Math.sin(S.anim * 5) > -0.3) {
    const aw = textW(plain(alert)) + 6, ax = Math.round(w / 2 - aw / 2);
    if (ax > textW(plain(sv`HISS-O-MATIC 3000 · ${STRAT_NAMES[S.strategy]}`)) + 8 && ax + aw < w - textW(plain(right)) - 8) { box(ax, 2, aw, 9, '#ff2d55'); text(g, alert, ax + aw / 2, 4, '#ffffff', 'center'); }
  }
}
/** Vad ligger under en punkt (låga pixlar) i Hissarna: en korg, eller en våningsrad (och om det är kön). */
export function liftHit(x, y) {
  for (let i = LIFTS.cars.length - 1; i >= 0; i--) {
    const c = LIFTS.cars[i];
    if (x >= c.x - 1 && x <= c.x + c.w + 1 && y >= c.y - 1 && y <= c.y + c.h + 1) return { car: c.id, floor: null, queue: false };
  }
  for (let f = 0; f < FLOORS; f++) { const [a, b] = LIFTS.row(f); if (y >= a && y < b) return { car: null, floor: f, queue: x <= LIFTS.q1 }; }
  return null;
}
