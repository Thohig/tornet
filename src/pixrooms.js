// Pixelgrafik: rummen till vänster om hallen i Våningarna (view.js). Varje våning visas i genomskärning: ett
// fönster i ytterväggen, inredning efter våningens tema (skrivbord, tandläkarstolen, valvet, serverhyllorna,
// soffan hemma …) och de som är inne på sina platser (roomPos i render.js). Mörkt när ingen är där på kvällen,
// och när våningen har stängt. Bara grafik – läser simuleringen men ändrar den aldrig.
import { BX0, FL, FLOOR_HOURS, floorOpen, floorY, ROOMS_X1, SHELL_X0 } from './config.js';
import { S } from './state.js';
import { blend, dark, light, text } from './pixart.js';
import { PAL } from './pixpal.js';
import { PERSON_H, PERSON_W, personSprite } from './pixpeople.js';
import { nightness, skyAt } from './view.js';
import { roomPos } from './render.js';
import { blinkOf } from './pixcars.js';
import { hotOf } from './pixfolk.js';
import { box, g, INK, R, X, Y } from './pixcore.js';
import { unlockedFloor } from './visning.js';
/** @typedef {import('./people.js').Person} Person */
/** @typedef {import('./render.js').Seat} Seat */

const PICS = ['#ff5d52', '#3f7cff', '#ffe14d', '#7cf06b', '#ff4fa3', '#38d9a9'];
const WOOD = '#8a5a2b', WOOD_HI = '#b07a44', METAL = '#9aa3ad';

/** Rummet på våning f: väggar, fönster, inredning och folket. */
export function drawRoom(f, h) {
  const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) - 4), x0 = X(BX0), x1 = X(ROOMS_X1);
  if (bot < 0 || top > g.canvas.height) return;
  const th = FL[f].theme, acc = FL[f].acc, n = nightness(h);
  const who = S.people.filter(p => p.floor === f && roomPos(p));
  const closed = !!FLOOR_HOURS[f] && !floorOpen(f, h) && unlockedFloor() !== f;
  const lit = S.power && !closed && (who.length > 0 || n < 0.5 || th === 'lobby' || th === 'station');
  // ytterväggen (tornets kant) och mellanväggen mot hallen
  R(X(SHELL_X0), top - 4, x0 - X(SHELL_X0), bot - top + 8, INK); R(X(SHELL_X0) + 1, top - 3, x0 - X(SHELL_X0) - 1, bot - top + 6, PAL.shell);
  R(x1, top, 3, bot - top, INK); R(x1 + 1, top, 1, bot - top, light(PAL.shell, 0.2));
  if (th === 'roof') { roofGarden(x0, x1, top, bot, h); }
  else {
    const wall = blend(PAL.wall, acc, th === 'garage' || th === 'dock' || th === 'station' ? 0.45 : 0.24);
    R(x0, top, x1 - x0, bot - top, wall);
    R(x0, bot - 3, x1 - x0, 3, blend(PAL.floor, acc, 0.25)); R(x0, bot - 3, x1 - x0, 1, light(blend(PAL.floor, acc, 0.25), 0.25));
    pane(x0, top, bot, h, th);
    BACK[th]?.(x0, x1, top, bot, f);
  }
  // folket: de som står först (bakom möblerna), de som sitter vid skrivbord bakom sina skrivbord
  const seats = who.map(p => ({ p, s: /** @type {Seat} */ (roomPos(p)) })).sort((a, b) => a.s.x - b.s.x);
  for (const { p, s } of seats) person(p, s, bot);
  FRONT[th]?.(x0, x1, top, bot);
  for (const { s } of seats) if (s.pose === 'desk') desk(X(s.x) - 9, bot, th);
  // ljuset: släckt när ingen är där på kvällen, mörkt när våningen har stängt
  const dim = !S.power ? 0.6 : closed ? 0.62 : lit ? 0 : 0.5 * n + 0.1;
  if (dim > 0) R(x0, top, x1 - x0, bot - top, `rgba(14,10,36,${dim.toFixed(2)})`);
}

/** fönstret i ytterväggen: himlen ute (dag, skymning, natt) */
function pane(x0, top, bot, h, th) {
  if (th === 'garage' || th === 'dock' || th === 'station') return;
  const [a, b] = skyAt(h), wy = top + 8, wh = bot - top - 22;
  box(x0 + 2, wy, 12, wh, PAL.frame);
  for (let i = 0; i < wh - 2; i++) R(x0 + 3, wy + 1 + i, 10, 1, blend(a, b, i / (wh - 2)));
  R(x0 + 8, wy + 1, 1, wh - 2, PAL.frame); R(x0 + 3, wy + Math.round(wh / 2), 10, 1, PAL.frame);
  R(x0 + 4, wy + 2, 1, 5, 'rgba(255,255,255,.45)');
  R(x0 + 1, wy + wh, 14, 2, light(PAL.shell, 0.15)); // fönsterbänken
}

/** en person på sin plats: står (från sidan, hoppar i aerobicstudion) eller sitter (framifrån) @param {Person} p @param {Seat} s */
function person(p, s, bot) {
  const cx = X(s.x), extra = { blink: blinkOf(p), hot: hotOf(p) };
  if (s.pose === 'stand') {
    const hop = s.jump ? Math.max(0, Math.round(Math.sin(S.anim * 7 + p.id) * 3)) : 0;
    g.drawImage(personSprite(p, 'side', s.jump ? Math.floor(S.anim * 6) % 2 : 0, s.face, extra), cx - PERSON_W / 2, bot - 2 - PERSON_H - hop);
    return;
  }
  // sitter: framifrån, klippt vid sitsen och med benen böjda framåt (skrivbordet ritas framför)
  const seatY = bot - 8, top = seatY - (PERSON_H - 9);
  g.save(); g.beginPath(); g.rect(cx - PERSON_W, top - 2, PERSON_W * 2, seatY + 1 - (top - 2)); g.clip();
  g.drawImage(personSprite(p, 'front', 0, 1, extra), cx - PERSON_W / 2, top);
  g.restore();
  if (s.pose === 'chair') {
    box(cx - 6, seatY, 12, 2, WOOD); R(cx - 5, seatY + 2, 1, bot - 3 - seatY - 2, INK); R(cx + 4, seatY + 2, 1, bot - 3 - seatY - 2, INK);
    const pants = (p.look && p.look.pants) || '#3a3f48';
    for (const lx of [cx - 3, cx + 1]) { R(lx, seatY + 2, 2, 4, pants); R(lx, bot - 4, 2, 1, INK); }
  }
}
/** skrivbordet framför den som sitter (med skärm, eller det temat har) */
function desk(x, bot, th) {
  const y = bot - 11;
  box(x, y, 18, 4, th === 'bank' ? '#d4a017' : WOOD); R(x + 1, y + 1, 16, 1, th === 'bank' ? '#ffe14d' : WOOD_HI);
  R(x + 2, y + 4, 2, bot - 3 - y - 4, INK); R(x + 14, y + 4, 2, bot - 3 - y - 4, INK);
  if (th === 'radio') { R(x + 4, y - 6, 1, 6, INK); box(x + 2, y - 9, 5, 4, '#3a3f48'); return; } // mikrofonen
  if (th === 'bank') return;
  box(x + 9, y - 7, 8, 6, '#3a3f48'); R(x + 10, y - 6, 6, 4, S.power ? '#2c87af' : '#15171c'); R(x + 12, y - 1, 2, 1, INK);
  if (th === 'game' && S.power) R(x + 11, y - 5, 2, 1, PICS[Math.floor(S.anim * 3) % PICS.length]);
}
const plant = (x, bot) => {
  box(x, bot - 10, 7, 7, '#a65e3a'); R(x + 1, bot - 10, 5, 1, '#c27a54');
  for (let k = 0; k < 3; k++) R(x - 2 + k * 3, bot - 17 + (k % 2) * 3, 3, 8, ['#389a5c', '#2f7d4a', '#4caf6a'][k]);
};
const picture = (x, y, f) => { box(x, y, 14, 10, '#6b4a2b'); R(x + 1, y + 1, 12, 8, '#fff8e0'); R(x + 2, y + 5, 10, 3, PICS[f % 6]); R(x + 3 + (f % 4), y + 2, 3, 3, PICS[(f + 2) % 6]); };
const shelf = (x, top, bot, w) => {
  box(x, top + 6, w, bot - top - 9, WOOD);
  for (let y = top + 9; y < bot - 6; y += 7) {
    R(x + 1, y + 5, w - 2, 1, dark(WOOD, 0.3));
    for (let bx = x + 2; bx < x + w - 2; bx += 3) R(bx, y, 2, 5, PICS[(bx * 7 + y) % 6]);
  }
};
const car = (x, bot, c) => {
  box(x, bot - 10, 30, 7, c); R(x + 6, bot - 15, 16, 6, INK); R(x + 7, bot - 14, 14, 5, '#bfeaff');
  for (const wx of [x + 4, x + 21]) { R(wx, bot - 5, 6, 3, INK); R(wx + 2, bot - 4, 2, 1, METAL); }
};

/** inredningen bakom folket, per tema */
/** @type {Record<string, (x0: number, x1: number, top: number, bot: number, f: number) => void>} */
const BACK = {
  dentist(x0, _x1, top, bot, f) {
    picture(x0 + 34, top + 12, f);
    // tandläkarstolen med lampan på en arm
    const cx = X(152);
    R(cx + 10, top + 6, 1, 14, INK); R(cx - 2, top + 6, 13, 1, INK); box(cx - 6, top + 19, 9, 4, '#ffe14d');
    if (S.power) R(cx - 5, top + 23, 7, 6, 'rgba(255,240,160,.35)');
    box(cx - 10, bot - 12, 22, 4, '#409991'); box(cx + 8, bot - 20, 5, 10, '#409991'); R(cx - 1, bot - 8, 3, 5, INK);
  },
  game(x0, _x1, top, bot, f) {
    picture(x0 + 30, top + 10, f);
    // arkadmaskinen i hörnet
    const ax = X(232) - 6;
    box(ax, bot - 30, 12, 27, '#bd5386'); R(ax + 2, bot - 26, 8, 7, S.power ? PICS[Math.floor(S.anim * 2) % 6] : '#15171c');
    R(ax + 3, bot - 16, 2, 2, '#ffe14d'); R(ax + 7, bot - 16, 2, 2, '#ff2d55');
  },
  ad(x0, _x1, top, bot, f) {
    // whiteboarden med en skiss och mötesbordet
    const wx = X(196) - 4;
    box(wx, top + 8, 26, 18, '#ffffff'); R(wx + 3, top + 12, 8, 1, '#ff5d52'); R(wx + 3, top + 15, 14, 1, '#3f7cff'); R(wx + 14, top + 11, 6, 6, '#ffe14d');
    picture(x0 + 30, top + 12, f);
    const tx = X(142);
    box(tx - 18, bot - 12, 36, 3, WOOD); R(tx - 1, bot - 9, 2, 6, INK);
  },
  law(_x0, _x1, top, bot) { shelf(X(132), top, bot, 18); shelf(X(214), top, bot, 14); },
  bank(_x0, _x1, top, _bot) {
    // valvdörren: rund, med ratt
    const vx = X(214), vy = top + 22;
    for (let dy = -13; dy <= 13; dy++) { const w = Math.round(Math.sqrt(169 - dy * dy)); R(vx - w, vy + dy, w * 2, 1, dy === -13 || dy === 13 ? INK : '#9aa3ad'); }
    for (let dy = -9; dy <= 9; dy++) { const w = Math.round(Math.sqrt(81 - dy * dy)); R(vx - w, vy + dy, w * 2, 1, '#c0c6ce'); }
    R(vx - 6, vy, 13, 1, INK); R(vx, vy - 6, 1, 13, INK); box(vx - 2, vy - 2, 5, 5, '#d4a017');
  },
  radio(_x0, _x1, top, _bot) {
    // studiofönstret och ON AIR-lampan
    const on = S.power && Math.sin(S.anim * 2) > -0.6;
    box(X(140), top + 7, 26, 9, on ? '#ff2d55' : '#5a2030'); text(g, 'ON AIR', X(140) + 13, top + 9, on ? '#ffffff' : '#a06070', 'center');
    box(X(196), top + 10, 18, 14, '#2b2f36'); R(X(196) + 2, top + 12, 14, 10, '#46505e');
  },
  aerobic(x0, x1, top, bot) {
    // speglarna längs väggen och mattorna på golvet
    for (let x = x0 + 18; x < x1 - 10; x += 22) { box(x, top + 6, 18, bot - top - 22, '#d6ecf5'); R(x + 3, top + 8, 1, 10, '#ffffff'); }
    for (let x = x0 + 18; x < x1 - 10; x += 13) R(x, bot - 4, 10, 1, '#389a5c');
  },
  server(_x0, _x1, top, bot) {
    for (const wx of [92, 128, 164]) {
      const x = X(wx) - 7;
      box(x, top + 6, 14, bot - top - 9, '#2b2f36');
      for (let y = top + 9; y < bot - 6; y += 4) { R(x + 2, y, 10, 2, '#3a3f48'); if (S.power && Math.sin(S.anim * 9 + y + x) > 0.3) R(x + 10, y, 1, 1, (x + y) % 3 ? '#7cf06b' : '#ffb000'); }
    }
  },
  spa(_x0, _x1, top, bot) {
    // badkaret för hundarna med bubblor
    const tx = X(136);
    box(tx - 16, bot - 13, 32, 10, '#ffffff'); R(tx - 15, bot - 12, 30, 3, '#7fd0f0');
    for (let i = 0; i < 4; i++) { const k = (S.anim * 0.7 + i / 4) % 1; R(tx - 10 + i * 7, bot - 14 - Math.round(k * 8), 2, 2, 'rgba(255,255,255,.8)'); }
    for (const px of [X(200), X(214)]) R(px, top + 10, 8, 3, '#a64eb3'); // hundkopplen på kroken
  },
  lab(_x0, _x1, top, bot) {
    // labbänken med kolvar och dragskåpet
    box(X(96), bot - 13, 90, 4, '#d4d0c8');
    for (let i = 0; i < 6; i++) { const x = X(100) + i * 12; R(x, bot - 19, 3, 6, INK); R(x + 1, bot - 18, 1, 4, PICS[i % 6]); }
    box(X(200), top + 6, 26, 22, '#bfc8cc'); R(X(200) + 2, top + 8, 22, 14, 'rgba(160,220,230,.6)');
  },
  sky(_x0, _x1, _top, bot) {
    // caféets disk med bakelser och borden
    box(X(214), bot - 16, 26, 13, '#4695b8'); R(X(214) + 2, bot - 20, 22, 4, '#d6ecf5');
    for (let i = 0; i < 3; i++) R(X(214) + 4 + i * 7, bot - 19, 3, 2, PICS[i + 1]);
    for (const tx of [104, 178]) { box(X(tx) - 7, bot - 13, 14, 3, '#ffffff'); R(X(tx) - 1, bot - 10, 2, 7, INK); R(X(tx) - 1, bot - 15, 2, 2, '#8a5a2b'); }
  },
  apartments(x0, _x1, top, bot, f) {
    picture(x0 + 22, top + 10, f);
    // tv:n, soffan och köksbänken (eller sängen)
    box(X(82) - 2, bot - 22, 14, 10, '#2b2f36'); R(X(82), bot - 20, 10, 6, S.power ? '#6fa8ff' : '#15171c'); R(X(82) + 4, bot - 12, 2, 9, INK);
    if (S.power) R(X(82), bot - 20, 10, 6, `rgba(255,255,255,${(0.15 + 0.15 * Math.sin(S.anim * 5 + f)).toFixed(2)})`);
    if (FL[f].variant === 2) { box(X(180), bot - 10, 40, 7, '#ffffff'); box(X(180), bot - 14, 8, 6, '#bfeaff'); }
    else { box(X(186), bot - 16, 34, 13, '#c9c1a8'); R(X(186) + 2, bot - 14, 30, 2, METAL); R(X(186) + 6, bot - 25, 10, 8, '#d6ecf5'); }
  },
  lobby(x0, x1, top, bot) {
    // glasfasaden ut mot gatan och en stor växt
    for (let x = x0 + 18; x < x1 - 30; x += 18) { box(x, top + 6, 16, bot - top - 22, '#a8d0e6'); R(x + 2, top + 8, 1, 12, '#ffffff'); }
    plant(X(228), bot); plant(X(160), bot);
  },
  garage(x0, x1, top, bot) { garage(x0, x1, top, bot, 'P'); },
  dock(x0, x1, top, bot) { garage(x0, x1, top, bot, 'KAJ'); },
  station(x0, x1, top, bot) {
    // perrongen fortsätter in i tunneln: spåret och tunnelmynningen
    R(x0, bot - 4, x1 - x0, 1, '#ffe14d');
    box(x0 + 4, top + 10, 30, bot - top - 16, '#15171c'); R(x0 + 6, top + 12, 26, 2, '#2b2f36');
    for (let x = x0 + 40; x < x1 - 6; x += 24) { box(x, top + 12, 16, 10, '#ffffff'); R(x + 2, top + 14, 12, 2, '#3b6ea5'); R(x + 2, top + 18, 8, 1, '#8a909a'); }
  },
};
/** inredning framför folket */
/** @type {Record<string, (x0: number, x1: number, top: number, bot: number) => void>} */
const FRONT = {
  bank(_x0, _x1, _top, bot) { box(X(96), bot - 13, 84, 10, '#9d7726'); R(X(96) + 1, bot - 12, 82, 1, '#d4a017'); },
  apartments(_x0, _x1, _top, bot) { box(X(104), bot - 9, 36, 6, '#b7832b'); box(X(104), bot - 15, 5, 12, '#b7832b'); box(X(135), bot - 15, 5, 12, '#b7832b'); },
  lobby(_x0, _x1, _top, bot) { box(X(94), bot - 8, 34, 3, WOOD); },
  roof(_x0, _x1, _top, bot) { box(X(102), bot - 8, 34, 3, WOOD); },
  ad(_x0, _x1, _top, bot) { R(X(124) - 1, bot - 8, 40, 1, dark(WOOD, 0.3)); },
};
/** garaget: betongpelare, en parkerad bil och skylten */
function garage(x0, _x1, top, bot, sign) {
  for (const px of [x0 + 20, x0 + 62]) { R(px, top, 4, bot - top - 3, '#9c978c'); R(px, bot - 16, 4, 12, '#ffd23f'); for (let y = bot - 15; y < bot - 4; y += 4) R(px, y, 4, 2, INK); }
  car(x0 + 28, bot, '#3f7cff');
  if (S.autos && S.autos.filter(a => a.state === 'parked').length > 4) car(x0 + 68, bot, '#ff5d52');
  box(x0 + 34, top + 8, 18, 9, PAL.sign); text(g, sign, x0 + 43, top + 10, '#ffffff', 'center');
}
/** takträdgården: öppen himmel, räcke, rabatter och en bänk */
function roofGarden(x0, x1, _top, bot, h) {
  R(x0, bot - 17, x1 - x0, 1, INK);
  for (let x = x0 + 2; x < x1; x += 12) R(x, bot - 17, 1, 15, INK);
  R(x0, bot - 4, x1 - x0, 4, '#94a3b8'); for (let x = x0; x < x1; x += 6) R(x, bot - 4, 1, 4, '#7a889e');
  for (const px of [x0 + 10, x0 + 66, x1 - 14]) plant(px, bot - 1);
  if (nightness(h) > 0.4 && S.power) for (let x = x0 + 8; x < x1 - 4; x += 22) { R(x, bot - 24, 1, 7, INK); R(x - 1, bot - 26, 3, 2, '#ffe14d'); }
}
