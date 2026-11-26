// Pixelgrafik: hallen på varje våning (korridoren, glimten av rummet, entrén med karuselldörr och
// reception), driftcentralen med driftchefen, personalrummet, perrongen och skyltarna i hallen.
//
// Driftcentralen och personalrummet:
// Driftcentralen (kontrollrummet) ritas i hallen på våningen med taggen `control` (`CONTROL` i config, P1): en skärm
// per hiss, larmljus, kontrollbordet med driftchefen och bildproducentens skärm; repliken (`S.chief.say`) rullar i
// fönstrets textremsa och syns som pratbubbla (`drawChiefPx`, där chefen är). Regissören klipper dit när chefen
// fattar ett beslut. Personalrummet ritas likadant på våningen med taggen `break` (`BREAK`, P2). Personalen syns på
// sin plats efter `spot.win` (`inWindow`/`winPos` i render.js): i fönstren (`control`, `break`), bakom
// receptionsdisken, i gondolen, på takterrassen eller stående i hallen (`hall`).
//
// Hallarna:
// Bilden börjar vid `LAND_X0` och varje våning ritas som en hall framför schakten med en korridor (`DOOR_X`) in mot
// rummen (längst in syns en glimt av rummet, `GLIMPSE`; i entrén en karuselldörr, reception och rulltrappan till
// mellanplanet). Hallens bredd är bara grafik – `TRAIN_X0` är fast eftersom simuleringen använder det. Schakten har
// stängda landningsdörrar vid varje hållplats, och våningsdisplayerna lyser bara där något händer. Folk i rummen
// ritas inte; `landPos` räknar ut var de syns i hallen (kön pressas ihop mot korridoren, gång in/ut syns bara
// sista/första biten) – ren grafik, simuleringens `p.x` ändras aldrig. Text i hallen bokar plats (`reserve`/`place`
// i pixcore.js): skyltar först, sedan pratbubblor, tankebubblor (de som väntar på samma hiss till samma våning delar
// en bubbla) och repliker – det som inte får plats flyttas eller ritas inte. Ljudeffekter i `S.fx` med samma text på
// samma våning slås ihop till en ("×n"). Allt ritas på ett rutnät i låg upplösning (1 pixel = `PX` = 2
// världsenheter) som skalas upp utan utjämning; skärmkoordinater räknas om med `VIEW.x0` (se `toWorld`,
// `placeCarPop`).
import { S } from './state.js';
import {
  BOILER_X, BREAK, CONTROL, DOCK, DOOR_X, EL, SHAFT_W, shaftX, FL, FLOOR_HOURS, floorOpen, FLOORS, floorY, INNER_X1,
  LAND_X0, LOBBY, MEZZ, SPOTS, STATION, TRAIN_LEN, TRAIN_X0, TRAIN_X1,
} from './config.js';
import { blend, dark, light, plain, PX, sprite, text, textW } from './pixart.js';
import { PAL } from './pixpal.js';
import { nightness } from './view.js';
import { inWindow, personHead, winPos } from './render.js';
import { PERSON_W, personSprite } from './pixpeople.js';
import { clamp, fl } from './util.js';
import { alarm, chiefOnDuty, chiefPerson, CHIEFS } from './chief.js';
import { nextTrainMin, TRAIN_DOORS, trainDoors } from './train.js';
import { allowed } from './dispatch.js';
import { ants, box, FLAMES, g, INK, line, lo, once, pill, R, reserve, STAIR_ICON, starSprite, X, Y } from './pixcore.js';
import { blinkOf } from './pixcars.js';
import { bubble } from './pixfolk.js';
import { unlockedFloor } from './visning.js';
import { fireProg } from './pixroof.js';
import { wetFloor, wetShaft } from './leak.js';
/** @typedef {import('./people.js').Person} Person */

// ---------- Hallen på varje våning ----------
/** Kvällsljus i hallen: väggarna blir blåare, och där någon är (eller i entrén, hemma, i garaget) lyser
 *  taklamporna i varma koner. Ritas före folket, så att de står i ljuset. */
const ALWAYS_LIT = ['lobby', 'apartments', 'garage', 'dock', 'station', 'sky'];
function nightLight(f, th, x0, x1, top, bot, n) {
  if (n < 0.05) return;
  R(x0, top, x1 - x0, bot - top, `rgba(18,22,70,${(0.3 * n).toFixed(3)})`);
  if (!S.power || !(OCC[f] > 0 || ALWAYS_LIT.includes(th))) return;
  const warm = th === 'apartments' ? '255,214,140' : '255,240,190', a = 0.11 * n;
  for (let lx = x0 + 40; lx < x1 - 8; lx += 52) {
    R(lx - 3, top, 7, 1, INK); R(lx - 2, top + 1, 5, 1, '#fff3b0');
    for (let r = 0; r < bot - top - 5; r++) {
      const w = 5 + Math.round(r * 0.7);
      R(lx - (w >> 1), top + 2 + r, w, 1, `rgba(${warm},${a.toFixed(3)})`);
    }
    R(lx - 14, bot - 4, 29, 1, `rgba(${warm},${(a * 2).toFixed(3)})`);
  }
}
/** gallret för en stängd verksamhet och skylten med öppettiden (ritas på korridoren) */
function closedGate(f, cx, cy, cw, ch) {
  for (let x = cx + 1; x < cx + cw; x += 3) R(x, cy, 1, ch, '#8a909a');
  for (let y = cy + 2; y < cy + ch; y += 6) R(cx, y, cw, 1, '#6b7280');
  const oh = FLOOR_HOURS[f], o = (oh[0] % 1 ? `${Math.floor(oh[0])}:30` : `${oh[0]}:00`).padStart(5, '0');
  pill(cx - 1, cy + 4, cw + 2, 9, '#ff5d52'); text(g, 'STÄNGT', cx + cw / 2, cy + 5, '#ffffff', 'center');
  pill(cx + 2, cy + 14, cw - 4, 9, '#ffffff'); text(g, o, cx + cw / 2, cy + 15, '#c81e3a', 'center');
}
/** Glimtar av rummen längst in i korridoren: en möbel eller pryl som visar vad som finns där, och ibland
 *  en skugga som går förbi. Ren grafik ur våningens tema. */
const GLIMPSE = {
  dentist: [['......KK', '.....KYK', '......KK', '..TTTTT.', 'TTTTTTT.', '...SS...', '..SSSS..'], { K: INK, Y: '#ffe14d', T: '#409991', S: '#9aa3ad' }],
  game: [['.KKKKKK.', '.KGGGGK.', '.KGgGGK.', '.KGGGGK.', '.KKKKKK.', '...KK...', '.KKKKKK.'], { K: '#3a3f48', G: '#38d9a9', g: '#ffffff' }],
  ad: [['RRYYBB..', 'RRYYBB..', 'PPGGOO..', 'PPGGOO..', '.K..K...', 'K....K..'], { R: '#ff5d52', Y: '#ffe14d', B: '#3f7cff', P: '#ff4fa3', G: '#7cf06b', O: '#ff9f1c', K: INK }],
  law: [['BBBBBBBB', 'RGrBRgGB', 'BBBBBBBB', 'gRBGrRBg', 'BBBBBBBB', 'RrGBgRGr', 'BBBBBBBB'], { B: '#6b4a2b', R: '#8a2a2a', G: '#2f5d3a', r: '#c0392b', g: '#d4a017' }],
  radio: [['RRRRRR..', 'RWWWWR..', 'RRRRRR..', '........', '...K....', '..KKK...', '...K....', '...K....', '..KKK...'], { R: '#c81e3a', W: '#ffffff', K: INK }],
  aerobic: [['MMMMMMMM', 'MmMMMMmM', 'MMMMMMMM', 'MMMMMMMM', '........', '.PPPPPP.', '.K....K.'], { M: '#bfeaff', m: '#ffffff', P: '#ff4fa3', K: INK }],
  server: [['KKKKKKKK', 'KgKrKgKK', 'KKKKKKKK', 'KgKgKrKK', 'KKKKKKKK', 'KrKgKgKK', 'KKKKKKKK'], { K: '#2b2f36', g: '#7cf06b', r: '#ffb000' }],
  spa: [['..w..w..', '.w..w...', '..BBBB..', '.BBBBBB.', '.BbbbbB.', '.BBBBBB.'], { w: '#ffffff', B: '#a64eb3', b: '#bfeaff' }],
  bank: [['.YYYY...', 'YKKKKY..', 'YKYYKY..', 'YKKKKY..', '.YYYY...', 'WWWWWWWW', 'BBBBBBBB'], { Y: '#d4a017', K: '#5a4a20', W: '#e8e2d0', B: '#8a6a46' }],
  lab: [['..KK....', '..GG....', '..GG..K.', '.GgGG.G.', 'GGGGGGGG', 'WWWWWWWW', 'K......K'], { K: INK, G: '#38d9a9', g: '#ffffff', W: '#d4d0c8' }],
  sky: [['.KKKK...', '.KSSK...', '.KKKK...', '..CC.ww.', '.CCCCw..', '.CCCC...', 'WWWWWWWW'], { K: '#3a3f48', S: '#9aa3ad', C: '#8a5a2b', w: '#ffffff', W: '#bd6659' }],
  apartments: [['.KKKKK..', '.KTTTK..', '.KTTTK..', '.KKKKK..', '........', 'SSSSSSSS', 'S.SSSS.S'], { K: '#2b2f36', T: '#6fa8ff', S: '#c0392b' }],
  garage: [['..KKKK..', '.KCCCCK.', 'CCCCCCCC', 'CRCCCCRC', '.K....K.'], { K: INK, C: '#5b8fb9', R: '#ff5d52' }],
  dock: [['BBB.BBB.', 'BYB.BYB.', 'BBB.BBB.', 'BBBBBBB.', 'BBYBBYB.', 'BBBBBBB.'], { B: '#b07a45', Y: '#e8d27a' }],
  station: [['YYYYYYYY', 'YKKKKKKY', 'YYYYYYYY', '...KK...', '...KK...'], { Y: '#ffd23f', K: INK }],
  roof: [['..GG....', '.GGGG...', 'GGGGGG..', '..BB....', '..BB....'], { G: '#389a5c', B: '#8a5a2b' }],
};
const glimpseSprite = th => once('glimpse' + th, () => (GLIMPSE[th] ? sprite(GLIMPSE[th][0], GLIMPSE[th][1], null) : null));
function glimpse(f, th, ix, iy, iw, ih, n) {
  const sp = glimpseSprite(th);
  g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
  if (sp) g.drawImage(sp, ix + Math.round((iw - sp.width) / 2), iy + ih - sp.height);
  // tv:n hemma och skärmarna i spelstudion flimrar på kvällen
  if (th === 'apartments' && n > 0.4) R(ix, iy, iw, ih, `rgba(111,168,255,${(0.12 + 0.12 * Math.abs(Math.sin(S.anim * 5.3 + f))).toFixed(3)})`);
  if (th === 'server' && Math.sin(S.anim * 9 + f) > 0.6) R(ix + 4, iy + ih - 6, 1, 1, '#7cf06b');
  // en skugga som går förbi längst in (någon är inne)
  if (OCC_IN[f] > 0) {
    const per = 7 + (f % 3) * 2, t = (S.anim / per + f * 0.37) % 1;
    if (t < 0.45) {
      const k = t / 0.45, dir = f % 2 ? 1 : -1, sx = dir > 0 ? ix - 4 + Math.round(k * (iw + 8)) : ix + iw + 4 - Math.round(k * (iw + 8));
      const by = iy + ih - 1, bob = Math.floor(S.anim * 8) % 2;
      R(sx - 1, by - 9 - bob, 3, 3, 'rgba(27,16,51,.55)'); R(sx - 2, by - 6 - bob, 5, 6 + bob, 'rgba(27,16,51,.55)');
    }
  }
  g.restore();
}
/** Inredning i hallen (bakom folket): en tavla på väggen, en krukväxt och något som hör till våningen.
 *  Platserna räknas ut ur våningens nummer, så att varje hall ser lite olika ut men aldrig ändras. */
const PICS = ['#ff5d52', '#3f7cff', '#ffe14d', '#7cf06b', '#ff4fa3', '#38d9a9'];
function hallProps(f, th, top, bot) {
  if (th === 'roof') return;
  const base = X(DOOR_X) + 60 + (f * 7) % 14;
  const plantPot = (px, big) => {
    box(px, bot - 9, 7, 6, '#a65e3a'); R(px + 1, bot - 9, 5, 1, '#c27a54');
    for (let k = 0; k < (big ? 4 : 3); k++) R(px - 2 + k * 3, bot - 16 - (big ? 4 : 0) + (k % 2) * 3, 3, 8 + (big ? 3 : 0), ['#389a5c', '#2f7d4a', '#4caf6a'][k % 3]);
  };
  if (th === 'garage' || th === 'dock' || th === 'station') {
    // betong: gula stolpar och en skylt
    for (const px of [base, base + 46]) { R(px, bot - 14, 3, 11, '#ffd23f'); for (let y = bot - 13; y < bot - 3; y += 4) R(px, y, 3, 2, INK); }
    if (th !== 'station') { box(base + 12, top + 20, 22, 9, PAL.sign); text(g, th === 'dock' ? 'KAJ' : 'P', base + 23, top + 22, '#ffffff', 'center'); }
    return;
  }
  // tavla
  const pw = 16, py = top + 20, c1 = PICS[f % PICS.length], c2 = PICS[(f + 2) % PICS.length];
  box(base, py, pw, 11, '#6b4a2b'); R(base + 1, py + 1, pw - 2, 9, '#fff8e0');
  R(base + 2, py + 6, pw - 4, 3, c1); R(base + 4 + (f % 5), py + 2, 4, 4, c2);
  if (th === 'apartments') {
    // postlådor och en dörrmatta
    for (let k = 0; k < 3; k++) { box(base + 22 + k * 7, py + 2, 6, 5, '#9aa3ad'); R(base + 24 + k * 7, py + 3, 2, 1, INK); }
    R(base + 2, bot - 4, 18, 1, '#8a2a2a');
    plantPot(base + 50, false);
    return;
  }
  if (th === 'sky') {
    // soffa med utsikt
    box(base + 22, bot - 10, 26, 7, '#4695b8'); R(base + 22, bot - 13, 26, 4, INK); R(base + 23, bot - 12, 24, 2, '#5aa9cc');
    plantPot(base + 54, true);
    return;
  }
  // kontor: vattenautomat och en växt
  const wx = base + 26;
  box(wx, bot - 12, 7, 9, '#d4d0c8'); box(wx + 1, bot - 20, 5, 8, '#bfeaff'); R(wx + 2, bot - 18, 3, 1, '#ffffff'); R(wx + 2, bot - 9, 2, 1, '#3f7cff');
  plantPot(base + 40, (f % 2) === 0);
}
/** entréns golv: rutigt marmorgolv */
function lobbyFloor(x0, x1, bot) {
  R(x0, bot - 3, x1 - x0, 3, '#d4d0c8');
  for (let x = x0; x < x1; x += 4) R(x, bot - 3 + ((x - x0) / 4) % 2, 4, 1, '#8a8475');
  R(x0, bot - 3, x1 - x0, 1, '#ffffff');
}
/** karuselldörren i entrén: gatan syns genom glaset och vingarna snurrar när folk går ut och in */
function revolvingDoor(cx, cy, cw, ch, h) {
  const n = nightness(h);
  R(cx, cy, cw, ch, blend('#bfe3f2', '#26324a', n));
  // gatan utanför: trottoar, och en gatlykta i mörkret
  R(cx, cy + ch - 6, cw, 6, blend('#c0c0c0', '#4a5060', n));
  if (n > 0.4) { R(cx + cw - 6, cy + 4, 1, ch - 10, INK); R(cx + cw - 8, cy + 3, 5, 2, '#ffe14d'); }
  // vingarna (fyra, sedda från sidan): x = cos(vinkeln)
  // (inte personHead/landPos här: de räknar gångriktningen och får bara anropas en gång per bildruta och person)
  const busy = S.people.some(p => p.floor === LOBBY && (p.state === 'exiting' || p.state === 'toQueue'));
  const a = (busy ? S.anim * 2.2 : 0) % (Math.PI / 2);
  for (let k = 0; k < 4; k++) {
    const c = Math.cos(a + k * Math.PI / 2), wx = cx + cw / 2 + Math.round(c * (cw / 2 - 3));
    if (Math.sin(a + k * Math.PI / 2) < 0) continue; // bara de främre vingarna
    R(wx, cy + 1, 1, ch - 2, '#606878'); R(wx + 1, cy + 1, 1, ch - 2, 'rgba(255,255,255,.5)');
  }
  R(cx + cw / 2, cy, 1, ch, INK); // axeln
  R(cx, cy, cw, 2, PAL.steel); R(cx, cy + ch - 1, cw, 1, PAL.steel);
  // reflex i glaset
  line(cx + 3, cy + ch - 4, cx + 9, cy + 4, 'rgba(255,255,255,.55)');
}
/** entréns inredning: receptionsdisken, krukväxter och en lampa i taket (rulltrappan ritas för sig) */
function lobbyProps(top, bot) {
  const dx = X(DOOR_X) + 46;
  // receptionen: disk med dator och klocka, receptionisten (crew.js) bakom – eller en skylt när hon är borta
  const rec = sitters(LOBBY, 'reception')[0];
  if (rec) {
    const w = winPos(rec);
    g.drawImage(personSprite(winFig(rec, 0), 'front', 0, 1, { blink: blinkOf(rec) }), X(w.x) - PERSON_W / 2, Y(w.y));
  }
  // godisautomaten (där den högra krukväxten stod)
  const vx = dx + 24;
  box(vx, bot - 22, 9, 19, '#c81e3a'); R(vx + 1, bot - 21, 7, 9, '#bfeaff');
  for (let k = 0; k < 3; k++) R(vx + 2 + k * 2, bot - 20 + (k % 2) * 3, 1, 2, ['#ffd23f', '#7cf06b', '#ff4fa3'][k]);
  R(vx + 2, bot - 9, 5, 2, INK); R(vx + 6, bot - 15, 1, 1, S.power ? '#7cf06b' : '#3a3f48');
  box(dx, bot - 14, 20, 11, '#8a6a46'); R(dx + 1, bot - 13, 18, 1, '#b08a5a'); R(dx + 2, bot - 9, 16, 1, '#6b4a2b');
  box(dx + 12, bot - 19, 6, 5, '#d4d0c8'); R(dx + 13, bot - 18, 4, 3, S.power ? '#38d9a9' : '#2b2f36');
  R(dx + 3, bot - 16, 3, 2, '#ffe14d');
  const berit = !rec && S.people.find(p => p.role === 'receptionist' && !p.dead);
  if (berit && berit.onBreak) { const t = /lunch/i.test(berit.breakWhy) ? 'LUNCH' : 'FIKA'; pill(dx, bot - 21, 21, 8, '#ffffff'); text(g, t, dx + 10, bot - 20, '#c81e3a', 'center'); }
  reserve(dx, bot - 22, 20, 19);
  // krukväxt
  for (const px of [dx - 10]) {
    box(px, bot - 9, 7, 6, '#a65e3a');
    for (let k = 0; k < 3; k++) R(px - 1 + k * 3, bot - 15 + (k % 2) * 2, 3, 6, ['#389a5c', '#2f7d4a', '#4caf6a'][k]);
  }
  // ljuskrona i taket
  const lx = X(DOOR_X) + 56;
  R(lx, top, 1, 5, INK); R(lx - 5, top + 5, 11, 1, '#d4a017');
  for (let k = -4; k <= 4; k += 4) R(lx + k, top + 6, 1, 2, S.power ? '#fff3b0' : '#5a5a5a');
}
/** rulltrappan från entrén upp till mellanplanet (övre däcket), ritas genom bjälklaget efter hallarna */
export function drawEscalatorPx() {
  if (MEZZ < 0) return;
  const xb = X(DOOR_X) + 84, yb = Y(floorY(LOBBY) - 4) - 3, xt = xb + 70, yt = Y(floorY(MEZZ) - 4) - 3;
  if (yb < -10 || yt > lo.height + 10) return;
  const L = xt - xb, ph = Math.floor(S.anim * 10) % 4;
  for (let i = -8; i <= L + 8; i++) {
    const k = clamp(i / L, 0, 1), x = xb + i, y = Math.round(yb + (yt - yb) * k);
    R(x, y - 9, 1, 8, 'rgba(191,234,255,.35)'); // glasräcket
    R(x, y - 10, 1, 1, INK);                     // ledstången
    R(x, y, 1, 1, '#8a909a');                    // stegen
    R(x, y + 1, 1, 3, '#5b6b80'); R(x, y + 4, 1, 1, INK); // fackverket under
    if (i >= 0 && i <= L && (i + ph) % 4 === 0) R(x, y - 1, 1, 1, '#d4d0c8');
  }
}

let OCC = [], OCC_IN = [];
/** hur många som är på varje våning (i hallen, respektive inne i rummen) – räknas en gång per bildruta */
export function countOcc() {
  OCC = new Array(FLOORS).fill(0); OCC_IN = new Array(FLOORS).fill(0);
  for (const p of S.people) {
    if (p.dead) continue;
    if (p.state !== 'ride' && p.state !== 'away' && p.state !== 'incar' && p.state !== 'assembly') OCC[p.floor]++;
    if ((p.state === 'office' && !(p.spot && p.spot.win)) || p.state === 'instairs') OCC_IN[p.floor]++;
  }
}
export function drawHall(f, h) {
  const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) - 4), x0 = X(LAND_X0), x1 = X(INNER_X1);
  const th = FL[f].theme, acc = FL[f].acc;
  if (th === 'roof') {
    // takterrassen: räcke och trall under öppen himmel
    R(x0, bot - 17, x1 - x0, 1, INK);
    for (let x = x0 + 2; x < x1; x += 12) R(x, bot - 17, 1, 15, INK);
    R(x0, bot - 4, x1 - x0, 4, '#94a3b8'); for (let x = x0; x < x1; x += 6) R(x, bot - 4, 1, 4, '#7a889e');
  } else {
    const wall = blend(PAL.wall, acc, 0.16);
    R(x0, top, x1 - x0, bot - top, wall);
    for (let x = x0 + 4; x < x1; x += 11) R(x, top, 1, bot - top - 15, blend(PAL.wall, acc, 0.3));
    R(x0, bot - 15, x1 - x0, 15, blend(PAL.wain, acc, 0.28));
    R(x0, bot - 15, x1 - x0, 1, blend(PAL.wainLine, acc, 0.3));
    R(x0, bot - 14, x1 - x0, 1, light(blend(PAL.wain, acc, 0.28), 0.3));
    for (let x = x0 + 8; x < x1 - 2; x += 16) R(x, bot - 12, Math.min(10, x1 - 2 - x), 8, blend(PAL.panel, acc, 0.3));
  }
  if (th === 'lobby') lobbyFloor(x0, x1, bot);
  else { R(x0, bot - 3, x1 - x0, 3, blend(PAL.floor, acc, 0.25)); R(x0, bot - 3, x1 - x0, 1, light(blend(PAL.floor, acc, 0.25), 0.25)); }
  // korridoren in mot rummen (perspektiv: mörk gång, ljus längst in) – i entrén en karuselldörr mot gatan
  const cw = 28, ch = 31, cx = X(DOOR_X) - cw / 2, cy = bot - ch;
  const n = nightness(h), lit = S.power && (OCC[f] > 0 || n < 0.5);
  R(cx - 4, cy - 4, cw + 8, ch + 4, INK); R(cx - 3, cy - 3, cw + 6, ch + 3, acc); R(cx - 3, cy - 3, cw + 6, 1, light(acc, 0.35));
  R(cx - 1, cy - 1, cw + 2, ch + 1, INK);
  if (th === 'lobby') revolvingDoor(cx, cy, cw, ch, h);
  else {
    R(cx, cy, cw, ch, PAL.corridor);
    const ix = cx + 7, iy = cy + 7, iw = cw - 14, ih = ch - 13;
    R(ix, iy, iw, ih, lit ? blend(acc, '#fff8d0', 0.55) : PAL.dim);
    if (lit) glimpse(f, th, ix, iy, iw, ih, n);
    for (let r = 0; r < ch - (iy - cy) - ih; r++) {
      const yy = iy + ih + r, k = r / (ch - (iy - cy) - ih);
      const xa = Math.round(ix - k * 7), xb = Math.round(ix + iw + k * 7);
      R(xa, yy, xb - xa, 1, r % 2 ? PAL.corrA : PAL.corrB);
    }
    line(cx, cy, ix, iy, PAL.corrEdge); line(cx + cw - 1, cy, ix + iw - 1, iy, PAL.corrEdge);
    // stängt: ett galler för korridoren och skylten på gallret (i stället för en lapp mitt i hallen)
    // (upplåst åt rundvisningen: gallret är uppe, visning.js)
    if (FLOOR_HOURS[f] && !floorOpen(f, h) && unlockedFloor() !== f) closedGate(f, cx, cy, cw, ch);
  }
  if (th === 'lobby') lobbyProps(top, bot);
  else if (f === CONTROL) controlRoom(top, bot);
  else if (f === BREAK) breakRoom(top, bot, h);
  else hallProps(f, th, top, bot);
  if (f === DOCK) boilerDoor(top, bot);
  // spårad person därinne / muspekaren över korridoren
  const sel = S.sel && !S.sel.dead && S.sel.floor === f && S.sel.state !== 'ride' && personHead(S.sel)?.hidden;
  if (sel || S.hoverDoor === f) ants(cx - 6, cy - 6, cw + 12, ch + 6, sel ? '#ffe14d' : '#ffffff');
  // antal inne på våningen
  // antal inne: en liten skylt bredvid korridoren, som ett dörrnummer
  if (OCC_IN[f]) {
    const s = String(OCC_IN[f]), w = Math.max(9, textW(s) + 5);
    pill(cx + cw + 4, bot - 13, w, 9, '#ffffff'); text(g, s, cx + cw + 4 + w / 2, bot - 12, INK, 'center');
    reserve(cx + cw + 4, bot - 13, w, 9);
  }
  // våningsnummer och företagsskylt
  const st = starSprite(acc); g.drawImage(st, X(DOOR_X) - 10, top + 1);
  text(g, fl(f), X(DOOR_X) + 1, top + 7, '#ffffff', 'center', 1, INK);
  const name = plain(FL[f].name), nx = X(DOOR_X) + 13, nw = Math.min(x1 - nx - 2, textW(name) + 7);
  reserve(X(DOOR_X) - 10, top, nw + 23, 17);
  pill(nx, top + 6, nw, 10, acc); R(nx + 1, top + 7, nw - 2, 1, light(acc, 0.35));
  g.save(); g.beginPath(); g.rect(nx + 1, top + 6, nw - 2, 10); g.clip();
  text(g, name, nx + 4, top + 7, '#ffffff', 'left', 1, dark(acc, 0.55));
  g.restore();
  stairSign(f, false);
  if (f === STATION) drawPlatformPx(top, bot, h);
}
// ---------- Pannrummet: dörren i hallen på P1 ----------
// En ståldörr med varningsrand och en skylt, rör längs väggen och ratten till huvudkranen (vattenläckan, leak.js:
// ratten är röd när kranen är stängd). Vaktmästaren står bredvid dörren (BOILER_STAND i config).
/** dörrens vänsterkant och bredd: skylten får plats med texten (även på engelska), och dörren börjar
 * till höger om trappskylten (stairSign, med glöden) – den ritas efter och skulle annars täcka skylten */
const boilerBox = () => {
  const dw = Math.max(22, textW('PANNA') + 4);
  return { dx: Math.max(Math.round(X(BOILER_X) - dw / 2), X(DOOR_X) + 19 + 33 + 3), dw };
};
function boilerDoor(top, bot) {
  const { dx, dw } = boilerBox(), dh = Math.min(26, bot - top - 21), dy = bot - 3 - dh;
  // rören längs väggen ovanför dörren
  R(dx - 2, dy - 4, dw + 4, 2, '#8a6a46'); R(dx - 2, dy - 4, dw + 4, 1, '#b08a5a');
  // dörren
  box(dx, dy, dw, dh, '#7a828c'); R(dx + 1, dy + 1, dw - 2, 1, '#9aa3ad');
  R(dx + dw - 5, dy + Math.floor(dh / 2), 2, 2, '#ffd23f'); // handtaget
  for (let x = dx + 1; x < dx + dw - 1; x++) R(x, dy + dh - 4, 1, 3, Math.floor((x - dx) / 2) % 2 ? INK : '#ffd23f');
  // skylten
  R(dx + 1, dy + 3, dw - 2, 7, '#ffffff'); text(g, 'PANNA', dx + dw / 2, dy + 4, INK, 'center');
  // ratten till huvudkranen på röret
  const L = S.leak, shut = !!(L && L.shut), wx = dx + 2, wy = dy + dh - 10;
  box(wx - 2, wy - 2, 6, 6, shut ? '#c0392b' : '#5a2a2a'); R(wx, wy, 2, 2, shut ? '#ff6b5a' : '#8a3a3a');
  reserve(dx, dy, dw, 12);
}
// ---------- Driftcentralen: kontrollrummet där driftchefen sitter ----------
// Ett fönster i hallens bakvägg: en skärm per hiss (korgens läge i schaktet, rött när den är trasig),
// ett larmljus som snurrar under incidenter, kontrollbordet och driftchefen (Gun-Britt på dagen, Rune på
// natten) – cheferna är personer (chief.js): den som sitter vid bordet ritas här. Chefen står upp under larm;
// är chefen på rast eller på väg står stolen tom. Pratbubblan ritas i drawChiefPx.
/** var chefens huvud ritades i den här bildrutan (låg upplösning), null = syns inte */
let chiefAt = /** @type {{ x: number, y: number }|null} */ (null);
export const resetChiefAt = () => { chiefAt = null; };
/** den som sitter i ett fönster ritas med en egen figur (humöret efter larmet – personens eget p.mood rörs inte) @param {Person} p */
export const winFig = (p, mood) => ({ id: p.id, mood, child: false, smoked: false, look: p.look });
const sitters = (f, win) => S.people.filter(p => !p.dead && p.floor === f && inWindow(p) && p.spot.win === win);
function controlRoom(top, bot) {
  // (fönstret börjar en bit in i hallen: till vänster om det sitter pannrummets dörr, boilerDoor)
  const bb = CONTROL === DOCK ? boilerBox() : null;
  const wx = Math.max(X(DOOR_X) + 76, bb ? bb.dx + bb.dw + 3 : 0), ww = Math.min(108, X(INNER_X1) - 14 - wx), wy = top + 18, wh = bot - 3 - wy;
  if (ww < 50) return;
  const power = S.power || (S.outage && S.outage.gen), alarmed = alarm(), blink = Math.floor(S.anim * 3) % 2 === 0;
  // ramen och rummet (mörkt, upplyst av skärmarna)
  box(wx - 2, wy - 2, ww + 4, wh + 3, PAL.steel);
  R(wx, wy, ww, wh, power ? '#1d2433' : '#0d1018');
  // skylten i fönstrets överkant: när chefen säger något rullar det som en textremsa
  const C0 = S.chief, say = C0 && C0.on && C0.say && S.t < C0.say.until ? C0.say : null;
  R(wx, wy, ww, 7, say ? '#000000' : '#000080');
  g.save(); g.beginPath(); g.rect(wx + 1, wy, ww - 9, 7); g.clip();
  if (say) {
    const str = plain(say.text.toUpperCase()), tw = textW(str), room = ww - 10;
    const off = tw <= room ? 0 : Math.floor(((S.t - say.t0) * 22) % (tw + 24)) - 12;
    text(g, str, wx + 2 - Math.max(0, off), wy + 1, say.dec ? '#ffd23f' : '#7dff9a');
  } else text(g, 'DRIFTCENTRAL', wx + 3, wy + 1, '#ffffff');
  g.restore();
  reserve(wx - 2, wy - 2, ww + 4, 9);
  // larmljuset: snurrar rött under incidenter och färgar rummet
  const lx = wx + ww - 6;
  if (alarmed) {
    const sp = Math.sin(S.anim * 9);
    box(lx, wy + 1, 4, 4, sp > 0 ? '#ff2d55' : '#7a2033');
    if (sp > 0.2) R(wx, wy + 6, ww, wh - 6, 'rgba(255,45,85,.14)');
  } else box(lx, wy + 1, 4, 4, '#4a2a33');
  // en skärm per hiss: korgens läge i schaktet
  const n = S.elevators.length, mw = Math.max(6, Math.min(12, Math.floor((ww - 6) / n) - 1)), my = wy + 9, mh = 10;
  const mx0 = wx + Math.round((ww - n * (mw + 1)) / 2);
  S.elevators.forEach((e, i) => {
    const x = mx0 + i * (mw + 1);
    box(x, my, mw, mh, '#3a3f48');
    const bad = e.mode === 'broken' || e.mode === 'snapped' || e.mode === 'dead';
    if (!power) { R(x + 1, my + 1, mw - 2, mh - 2, '#15171c'); return; }
    R(x + 1, my + 1, mw - 2, mh - 2, bad && blink ? '#5a0f1a' : '#0b1a10');
    R(x + 1, my + 1, mw - 2, 1, e.color); // hissens färg upptill
    const cx = x + Math.floor(mw / 2);
    R(cx, my + 2, 1, mh - 3, '#1f3a28');
    const k = clamp((e.pos - e.minF) / Math.max(1, EL[e.id].topF - e.minF), 0, 1), dy = my + mh - 2 - Math.round(k * (mh - 4));
    const dot = bad ? '#ff2d55' : e.hot ? '#ff9f1c' : e.mode === 'service' || e.hold ? '#ffe14d' : e.sleep ? '#2f6b47' : light(e.color, 0.35);
    R(cx - 1, dy - 1, 3, 2, dot);
  });
  // kontrollbordet med knappar som blinkar (och en kaffekopp)
  const dy = wy + wh - 6;
  const C = S.chief, on = !!(C && C.on), seat = post => SPOTS[CONTROL].find(s => s.post === post);
  const desk = seat('chief'), prod = seat('producer'), here = sitters(CONTROL, 'control');
  const P = here.find(p => p.spot === desk), Q = here.find(p => p.spot === prod);
  const px = X(desk.x) - PERSON_W / 2, qx = prod ? X(prod.x) - PERSON_W / 2 : 0;
  chiefAt = null;
  g.save(); g.beginPath(); g.rect(wx, wy + 6, ww, wh - 6); g.clip();
  // stolarna (syns bakom dem som sitter – tomma när de har rast eller är på väg)
  R(px + 1, dy - 7, 2, 7, '#3a3f48'); R(px + 1, dy - 1, 9, 1, '#3a3f48');
  if (prod) { R(qx + PERSON_W - 3, dy - 7, 2, 7, '#3a3f48'); R(qx + 1, dy - 1, 9, 1, '#3a3f48'); }
  // bildproducentens egen skärm (det regissören visar) med en blinkande REC-lampa
  if (prod) {
    const mx = qx - 11;
    box(mx, dy - 9, 10, 9, '#d4d0c8'); R(mx + 1, dy - 8, 8, 6, power ? '#10243a' : '#15171c');
    if (power) { R(mx + 2, dy - 6, 6, 2, '#3f7cff'); if (Q && Math.floor(S.anim * 1.5) % 2) R(mx + 7, dy - 8, 1, 1, '#ff2d55'); }
  }
  // under larm står de upp (framifrån) och följer skärmarna, annars sitter de vid bordet
  for (const p of here) {
    const view = alarmed ? 'front' : 'side', bob = alarmed ? Math.round(Math.sin(S.anim * 3 + p.id)) : 0;
    const spr = personSprite(winFig(p, alarmed ? 1 : 0), view, 0, p.spot.face || 1, { blink: Math.sin(S.anim * 0.8 + p.id) > 0.97 });
    const sx = X(winPos(p).x) - PERSON_W / 2, sy = Y(winPos(p).y) - (alarmed ? 5 : 0) + bob;
    g.drawImage(spr, sx, sy);
    if (p === P) chiefAt = { x: sx + PERSON_W / 2, y: sy };
  }
  // rast: stolsryggen syns
  if (!P) { R(px + 2, dy - 12, 6, 6, '#3a3f48'); R(px + 3, dy - 11, 4, 4, '#5a6070'); }
  if (prod && !Q) { R(qx + 3, dy - 12, 6, 6, '#3a3f48'); R(qx + 4, dy - 11, 4, 4, '#5a6070'); }
  g.restore();
  box(wx + 2, dy, ww - 4, 6, '#8a909a'); R(wx + 3, dy + 1, ww - 6, 1, '#c0c6cc');
  for (let i = 0; i < 6; i++) if (power) R(wx + 40 + i * 4, dy + 3, 2, 1, (Math.floor(S.anim * 2 + i * 1.7) % 3) ? ['#7cf06b', '#ffe14d', '#ff5d52'][i % 3] : '#3a3f48');
  // skärmen på bordet: chefens senaste beslut som en blinkande rad (eller RAST)
  const tx = px + 13, ty = dy - 8;
  box(tx, ty, 14, 9, '#d4d0c8'); R(tx + 1, ty + 1, 12, 6, power ? '#0b1a10' : '#15171c');
  const away = !P && on && CHIEFS.some((_, i) => { const q = chiefPerson(i); return q && q.onBreak; });
  if (power) {
    if (!on) text(g, 'RAST', tx + 7, ty + 1, '#ffd23f', 'center');
    else if (away) text(g, 'FIKA', tx + 7, ty + 1, '#ffd23f', 'center');
    else if (C.say && S.t < C.say.until && blink) R(tx + 2, ty + 3, 10, 2, '#7dff9a');
    else { R(tx + 2, ty + 2, 6, 1, '#7dff9a'); R(tx + 2, ty + 4, 8, 1, '#2f6b47'); }
  }
  R(tx + 6, ty + 9, 2, 1, INK);
  R(px + 30, dy - 3, 3, 3, '#ffffff'); R(px + 31, dy - 2, 1, 1, '#8a5a2b'); // kaffekoppen
  // reflex i glaset
  line(wx + 3, wy + wh - 2, wx + 9, wy + 8, 'rgba(255,255,255,.12)');
}
/** driftchefens pratbubbla (efter folket, så att den hamnar överst): ovanför fönstret, och bara de första
 *  sekunderna – sedan står det kvar i textremsan */
export function drawChiefPx() {
  const C = S.chief;
  if (!C || !C.on || !C.say || C.say.who || S.t - C.say.t0 > 3.5) return;
  const who = chiefOnDuty();
  let at = chiefAt;
  // chefen är inte vid bordet (fikar, är på väg): det sägs i walkie-talkien där hen är
  const p = chiefPerson(CHIEFS.indexOf(who));
  if (p && !(chiefAt && inWindow(p) && p.spot.post === 'chief')) {
    const hd = personHead(p);
    at = hd && !hd.hidden ? { x: X(hd.x), y: Y(hd.y) + 11 } : chiefAt;
  }
  if (!at) return;
  // (vid bordet rullar repliken redan i fönstrets textremsa: får bubblan ingen ledig plats ritas den inte,
  // i stället för ovanpå våningsskylten och fönstrets rubrik)
  bubble(`${who.name}: "${C.say.text}"`, at.x, at.y - 14, C.say.dec ? '#fff6a8' : '#ffffff', at === chiefAt);
}
// ---------- Personalrummet: där driftcheferna fikar ----------
// Ett fönster i hallens bakvägg, som kontrollrummet: soffa, bord med korsord, kaffebryggare och kylskåp.
// De som sitter där ritas på sina platser (SPOTS[BREAK], config.js); kaffet ångar när någon är inne.
function breakRoom(top, bot, h) {
  const wx = X(DOOR_X) + 58, ww = Math.min(108, X(INNER_X1) - 14 - wx), wy = top + 18, wh = bot - 3 - wy;
  if (ww < 50) return;
  const lit = S.power || (S.outage && S.outage.gen), who = sitters(BREAK, 'break'), n = nightness(h);
  box(wx - 2, wy - 2, ww + 4, wh + 3, PAL.steel);
  R(wx, wy, ww, wh, lit ? (who.length || n < 0.5 ? '#d9c9a0' : '#a89a78') : '#26221c');
  R(wx, wy, ww, 7, '#000080');
  text(g, 'PERSONALRUM', wx + 3, wy + 1, '#ffffff');
  reserve(wx - 2, wy - 2, ww + 4, 9);
  const fy = wy + wh - 1; // golvet i rummet
  g.save(); g.beginPath(); g.rect(wx, wy + 7, ww, wh - 7); g.clip();
  // tapet, golvlist och golv
  if (lit) for (let x = wx + 3; x < wx + ww; x += 6) R(x, wy + 7, 1, wh - 10, '#cbb98c');
  R(wx, fy - 2, ww, 3, lit ? '#8a6a46' : '#3a2f24');
  const B = SPOTS[BREAK].filter(s => s.brk), sofa = B.filter(s => s.k === 'chair').slice(0, 3), [c1, c2] = B.filter(s => s.k === 'chair').slice(3), fridge = B.find(s => s.k === 'stand');
  // hyllan över soffan med kaffebryggaren och muggarna
  const sa = Math.max(wx + 1, X(sofa[0].x) - 9), sb = X(sofa[sofa.length - 1].x) + 9;
  R(sa + 4, wy + 15, sb - sa - 8, 1, '#6b4a2b');
  const kx = sa + 6;
  box(kx, wy + 8, 6, 7, '#2b2f36'); R(kx + 1, wy + 11, 4, 3, lit ? '#8a5a2b' : '#3a2a1a');
  R(kx + 4, wy + 9, 1, 1, lit && Math.floor(S.anim * 2) % 2 ? '#ff5d52' : '#5a2a2a');
  for (let k = 0; k < 3; k++) R(kx + 9 + k * 4, wy + 12, 2, 3, ['#ffffff', '#ffd23f', '#3f7cff'][k]);
  // en affisch och väggklockan (visar husets klocka) ovanför bordet
  const ax = X(c1.x) + 4, cx = X(c2.x) + 5, cy = wy + 12;
  box(ax, wy + 9, 11, 9, '#fff8e0'); R(ax + 2, wy + 11, 7, 2, '#c81e3a'); R(ax + 2, wy + 14, 5, 1, '#3f7cff'); R(ax + 2, wy + 16, 6, 1, '#9aa3ad');
  R(cx - 2, cy - 3, 5, 7, INK); R(cx - 3, cy - 2, 7, 5, INK); R(cx - 2, cy - 2, 5, 5, '#ffffff');
  const hh = h % 12, a1 = (hh / 12) * Math.PI * 2, a2 = (h % 1) * Math.PI * 2;
  R(cx + Math.round(Math.sin(a1) * 1.2), cy - Math.round(Math.cos(a1) * 1.2), 1, 1, INK);
  R(cx + Math.round(Math.sin(a2) * 2), cy - Math.round(Math.cos(a2) * 2), 1, 1, '#c81e3a'); R(cx, cy, 1, 1, INK);
  // soffryggen (bakom folket) och kylskåpet
  R(sa, fy - 13, sb - sa, 8, INK); R(sa + 1, fy - 12, sb - sa - 2, 7, '#7a3f5a'); R(sa + 1, fy - 12, sb - sa - 2, 1, '#9a5f7a');
  const fx = wx + ww - 8;
  const open = fridge && who.some(p => p.spot === fridge);
  box(fx, fy - 20, 8, 18, '#e8e8e8'); R(fx + 1, fy - 13, 6, 1, '#9aa3ad');
  if (open) { R(fx + 1, fy - 19, 6, 5, lit ? '#fff6c0' : '#8a8a70'); R(fx + 2, fy - 16, 2, 2, '#ff5d52'); } // (dörren står öppen)
  else { R(fx + 6, fy - 18, 1, 3, '#9aa3ad'); R(fx + 6, fy - 10, 1, 4, '#9aa3ad'); }
  // folket: sittande i soffan och vid bordet, stående vid kylskåpet
  for (const p of who) {
    const sp = p.spot, sit = sp.k !== 'stand', dir = sp.face || 1, w = winPos(p);
    const spr = personSprite(winFig(p, 0), 'side', 0, dir, { blink: Math.sin(S.anim * 0.7 + p.id) > 0.97 });
    g.drawImage(spr, X(w.x) - PERSON_W / 2, Y(w.y) + (sit ? Math.round(Math.sin(S.anim * 1.3 + p.id) * 0.4) : 0));
    // ångan ur koppen
    if (sit && lit && Math.sin(S.anim * 2 + p.id) > -0.3) {
      const ux = X(sp.x) + dir * 6, uy = fy - 13 - (Math.floor(S.anim * 4 + p.id) % 3);
      R(ux, uy, 1, 1, 'rgba(255,255,255,.7)');
    }
  }
  // soffans sits och armstöd framför benen, och bordet mellan stolarna
  R(sa, fy - 6, sb - sa, 5, INK); R(sa + 1, fy - 5, sb - sa - 2, 3, '#9a5f7a');
  R(sa, fy - 10, 3, 9, INK); R(sb - 3, fy - 10, 3, 9, INK);
  const ta = X(c1.x) + 5, tb = X(c2.x) - 5;
  R(ta, fy - 8, tb - ta, 2, '#6b4a2b'); R(ta + 1, fy - 6, 1, 5, '#6b4a2b'); R(tb - 2, fy - 6, 1, 5, '#6b4a2b');
  R(ta + 2, fy - 10, 5, 2, '#f4f1e8'); R(tb - 4, fy - 11, 2, 3, '#ffffff'); // korsordet och en kopp
  R(X(c1.x) - 3, fy - 6, 1, 5, '#3a3f48'); R(X(c2.x) + 3, fy - 6, 1, 5, '#3a3f48'); // stolsbenen
  if (!lit) R(wx, wy + 7, ww, wh - 7, 'rgba(0,0,0,.35)');
  g.restore();
  line(wx + 3, wy + wh - 2, wx + 9, wy + 8, 'rgba(255,255,255,.12)');
}
// ---------- Tunnelbanan ----------
// Spåret ligger längs perrongens bakvägg mellan två tunnelmynningar; tåget är längre än perrongens synliga
// del, så bara mitten syns. Allt läses ur S.train (simuleringen) – här ritas bara.
const TRAIN_BODY = '#b8c0cc', TRAIN_STRIPE = '#2a5db0', TRAIN_GLASS = '#26324a';
function drawPlatformPx(top, bot, h) {
  const tx0 = X(TRAIN_X0), tx1 = X(TRAIN_X1), ty0 = bot - 26, ty1 = bot - 3;
  // spårgropen och tunnelväggen bakom, med kakel ovanför
  R(tx0 - 4, ty0 - 2, tx1 - tx0 + 6, ty1 - ty0 + 2, '#1e2430');
  for (let x = tx0 - 4; x < tx1 + 2; x += 6) R(x, ty0 - 2, 1, ty1 - ty0 + 2, '#262d3b');
  for (let x = tx0 - 4; x < tx1 + 2; x += 4) for (let y = top + 28 - 9; y < ty0 - 2; y += 3) R(x, y, 3, 2, (x + y) % 7 ? '#d9e2ec' : '#c3cfdc');
  const T = S.train;
  if (T) {
    const doors = trainDoors(T);
    g.save(); g.beginPath(); g.rect(tx0, ty0 - 1, tx1 - tx0, ty1 - ty0 + 1); g.clip();
    // tåget: vagnar à 70 världsenheter, nosen långt bort i tunneln åt båda hållen
    const x0 = X(T.x - 160), x1 = X(T.x + TRAIN_LEN + 160), y0 = ty0 + 1, y1 = ty1 - 1;
    R(x0, y0, x1 - x0, y1 - y0, INK); R(x0, y0 + 1, x1 - x0, y1 - y0 - 2, TRAIN_BODY);
    R(x0, y0 + 1, x1 - x0, 1, light(TRAIN_BODY, 0.4));
    R(x0, y1 - 7, x1 - x0, 2, TRAIN_STRIPE);
    // vagnskarvar och fönster
    for (let wx = X(T.x - 140); wx < x1; wx += 35) R(wx, y0, 1, y1 - y0, dark(TRAIN_BODY, 0.45));
    for (let wx = X(T.x - 160) + 3; wx < x1 - 4; wx += 7) {
      R(wx, y0 + 4, 5, 6, TRAIN_GLASS);
      if (S.power || nightness(h) < 0.5) R(wx, y0 + 4, 5, 1, '#ffe9a8');
    }
    // dörrarna glider isär när tåget står inne
    for (const d of TRAIN_DOORS) {
      const cx = X(T.x + d * TRAIN_LEN), gap = Math.round(doors * 3);
      R(cx - 4, y0 + 2, 8, y1 - y0 - 3, dark(TRAIN_BODY, 0.18));
      R(cx - 4, y0 + 3, 3, 7, TRAIN_GLASS); R(cx + 1, y0 + 3, 3, 7, TRAIN_GLASS);
      if (gap) R(cx - gap, y0 + 2, gap * 2, y1 - y0 - 3, '#ffe9a8');
      R(cx, y0 + 2, 1, y1 - y0 - 3, INK);
    }
    // hjulen
    for (let wx = X(T.x - 150); wx < x1; wx += 35) { R(wx + 4, y1 - 1, 4, 2, INK); R(wx + 26, y1 - 1, 4, 2, INK); }
    g.restore();
  }
  // tunnelmynningarna (ovanpå tåget, så att det glider in och ut ur mörkret)
  for (const [mx, w] of [[tx0 - 6, 6], [tx1, 4]]) {
    R(mx, ty0 - 4, w, ty1 - ty0 + 4, '#0d1018');
    R(mx, ty0 - 5, w, 1, INK);
  }
  // perrongkanten med gul linje
  R(tx0 - 6, ty1, tx1 - tx0 + 10, 1, '#ffd23f'); R(tx0 - 6, ty1 + 1, tx1 - tx0 + 10, 1, INK);
  // avgångsskylten: DOS-svart med gul text (ingen klocka – bara minuter kvar i speltid)
  const m = nextTrainMin(), msg = m === null ? 'INGA FLER TÅG' : T ? (T.state === 'in' ? 'TÅGET KOMMER' : T.state === 'stop' ? 'STIG PÅ!' : 'AVGÅR') : `TÅG OM ${m} MIN`;
  const bw = textW(msg) + 6, bx = tx1 - bw, by = top + 16;
  box(bx, by, bw, 9, '#101418'); text(g, msg, bx + 3, by + 2, m === null ? '#ff5d52' : '#ffd23f');
  reserve(bx, by, bw, 9); // (tankebubblorna vid perrongen lägger sig inte över avgångsskylten)
}
export function stairSign(f, glow) {
  const x = X(DOOR_X) + 19, y = Y(floorY(f + 1) + 4) + 24;
  reserve(x, y, 33, 9);
  if (glow) R(x - 2, y - 2, 37, 13, 'rgba(34,197,94,.45)');
  pill(x, y, 33, 9, PAL.green);
  g.drawImage(STAIR_ICON(), x + 2, y + 2);
  text(g, 'TRAPPA', x + 9, y + 1, '#ffffff');
}
export function floorOverlays(f, h) {
  const top = Y(floorY(f + 1) + 4), bot = Y(floorY(f) - 4), x0 = X(LAND_X0), x1 = X(INNER_X1);
  const NO_DIM = ['lobby', 'apartments', 'roof', 'garage', 'dock', 'station'];
  const th = FL[f].theme, n = nightness(h);
  if (!NO_DIM.includes(th) && floorOpen(f, h)) {
    if (n > 0.05 && !OCC[f]) R(x0, top, x1 - x0, bot - top, `rgba(10,6,34,${0.45 * n})`);
  }
  if (f !== LOBBY && !FL[f].open && !floorOpen(f, h)) {
    const someone = S.people.some(p => p.floor === f && (p.state === 'office' || p.state === 'exiting'));
    R(x0, top, x1 - x0, bot - top, `rgba(10,6,34,${someone ? 0.38 : 0.62})`);
  }
  if (th !== 'roof') nightLight(f, th, x0, x1, top, bot, n);
  if (wetFloor(f)) wetHall(f, x0, x1, top, bot);
  if (S.fire) {
    const on = Math.sin(S.anim * 10) > 0;
    box(x1 - 10, top + 3, 5, 5, on ? '#ff2d55' : '#7a2033');
    if (on) R(x1 - 12, top + 1, 9, 9, 'rgba(255,45,85,.3)');
    if (S.fire.mode === 'zone' && !allowed(f)) R(x0, top, x1 - x0, bot - top, 'rgba(255,45,85,.08)');
    if (f === S.fire.floor) {
      const F = S.fire, prog = fireProg(F);
      R(x0, top, x1 - x0, bot - top, `rgba(255,100,20,${(0.2 + 0.08 * Math.sin(S.anim * 7)) * (1 - prog * 0.85)})`);
      // lågorna slocknar en i taget medan brandmännen släcker (den närmast dem först), och det ångar där de var
      const fr = FLAMES();
      [DOOR_X - 10, DOOR_X + 10, DOOR_X + 46].forEach((wx, i) => {
        if (prog < 0.9 - (2 - i) * 0.15) g.drawImage(fr[(Math.floor(S.anim * 9) + i) % 3], X(wx) - 6, bot - 13 - (i === 1 ? 4 : 0));
        else if (prog < 1) for (let j = 0; j < 3; j++) {
          const k = (S.anim * 0.8 + j / 3 + i * 0.29) % 1;
          R(X(wx) - 2 + Math.round(Math.sin(k * 6 + j) * 2), bot - 6 - Math.round(k * 16), 3, 2, `rgba(235,240,245,${(0.7 * (1 - k)).toFixed(2)})`);
        }
      });
    }
  }
}
// ---------- Vattenläckan (leak.js): pölar, dropp från taket och en skylt ----------
const waterC = a => (S.leak && S.leak.green ? `rgba(80,220,120,${a})` : `rgba(63,124,255,${a})`);
function wetHall(f, x0, x1, top, bot) {
  const L = S.leak, src = !!L && f === L.src, shut = !!L && L.shut;
  // pölarna på golvet (glänser lite)
  R(x0, bot - 3, x1 - x0, 2, waterC(0.35));
  for (let i = 0; i < 6; i++) {
    const px = x0 + 8 + ((i * 53 + f * 17) % Math.max(1, x1 - x0 - 30));
    R(px, bot - 4, 14 + (i % 3) * 6, 2, waterC(0.5));
    if (Math.sin(S.anim * 2 + i + f) > 0.7) R(px + 3, bot - 4, 2, 1, '#ffffff');
  }
  // dropp från taket (forsar där röret sprack, tills kranen är stängd)
  if (!shut) for (let i = 0; i < (src ? 7 : 4); i++) {
    const dx = x0 + 20 + ((i * 41 + f * 29) % Math.max(1, x1 - x0 - 40)), k = (S.anim * (src ? 1.6 : 0.9) + i * 0.37) % 1;
    if (src && i < 2) R(dx, top + 2, 2, bot - top - 5, waterC(0.55));
    else R(dx, top + 2 + Math.round(k * (bot - top - 8)), 1, 2, waterC(0.8));
  }
  // VÅTT GOLV – en gul skylt på golvet
  const sx = X(DOOR_X) + 44;
  R(sx, bot - 13, 1, 10, INK); R(sx + 9, bot - 13, 1, 10, INK);
  box(sx - 1, bot - 15, 12, 8, '#ffd23f'); text(g, '!', sx + 5, bot - 14, INK, 'center');
}
/** vatten som rinner längs schaktväggarna där hissarna går förbi blöta våningar (efter korgarna) */
export function drawLeakPx() {
  const L = S.leak;
  if (!L || L.ph === 'done' || L.shut) return;
  for (const e of S.elevators) {
    if (!wetShaft(e)) continue;
    const sx = X(shaftX(e.id));
    for (const f of L.wet) {
      if (f < e.minF || f > e.maxF) continue;
      const ya = Y(floorY(f + 1)), yb = Y(floorY(f));
      for (const ox of [2, Math.round(SHAFT_W / PX) - 4]) for (let y = ya; y < yb; y += 4) {
        const k = (S.anim * 3 + y * 0.07 + ox) % 1;
        R(sx + ox, y + Math.round(k * 4), 2, 3, waterC(0.75));
      }
    }
  }
}
/** skylt i entrén och på mellanplanet: övre däcket nås via rulltrappan */
export function deckSign(f) {
  if (MEZZ < 0 || (f !== LOBBY && f !== MEZZ)) return;
  const label = f === LOBBY ? 'ÖVRE DÄCK: VÅN 1' : 'EXPRESS ÖVRE DÄCK', w = textW(label) + 6;
  const x = X(INNER_X1) - 4 - w;
  // (över huvudhöjd: folk på väg till rulltrappan skymmer den annars – men under företagsskylten om den är så
  // lång att de skulle krocka, som "GLADA TANDEN DENTAL" på engelska)
  const nameEnd = X(DOOR_X) + 13 + textW(plain(FL[f].name)) + 7;
  const y = Y(floorY(f + 1) + 4) + (nameEnd + 3 > x ? 16 : 5);
  pill(x, y, w, 9, PAL.sign); reserve(x, y, w, 9);
  text(g, label, x + w / 2, y + 1, '#ffffff', 'center');
}
