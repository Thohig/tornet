// Pixelgrafik: hisskorgarna med passagerare och dörrar, linor och motvikter, hissfel och linbrott,
// och panoramahissen som fastnat på fasaden (räddningstjänsten med rep eller stegbil).
import { S } from './state.js';
import { CAR_H, CAR_W, DOOR_X, EL, floorY, FULL_LOAD, GROUND_Y, SHAFT_W, shaftCX, shaftX } from './config.js';
import { RAISE_T, riderPos, RIG_T, ROPE_DX } from './pano.js';
import { dark, led, light, PX, text, textW } from './pixart.js';
import { clamp, fl } from './util.js';
import { cargoSprite, PERSON_H, PERSON_W, personSprite } from './pixpeople.js';
import { PAL } from './pixpal.js';
import { exposure, windAt } from './weather.js';
import { vpick, vrand } from './rng.js';
import { nextOut, techOf, WARM_AT } from './service.js';
import { VIEW } from './view.js';
import { carSlot, carSlotX } from './render.js';
import { cabinKg } from './dispatch.js';
import { ants, box, CY, g, INK, label, line, lo, PUFF, R, X, Y } from './pixcore.js';
import { winFig } from './pixhall.js';
import { shaftBot, shaftTop } from './pixbuilding.js';
import { bark, DOGS, hotOf, phoneOn, speech, talking } from './pixfolk.js';
/** @typedef {import('./elevators.js').Elevator} Elevator */
/** @typedef {import('./people.js').Person} Person */

// ---------- Panoramahissen fast på fasaden (pano.js) ----------
// Repet från taket ovanför korgen och den som firas ner i sele, eller stegbilen på gatan med stegen rest mot
// korgen och den som klättrar ner. Läget räknas i simuleringen (S.pano) – här ritas bara.
export function drawPanoPx() {
  const P = S.pano;
  if (!P || !P.crew) return;
  const e = S.elevators[P.car], cx = X(shaftCX(e.id)), gy = Y(GROUND_Y), carBot = Y(floorY(e.pos));
  const way = P.setup || P.how, rider = P.rider ? S.people.find(p => p.id === P.rider.id) : null, rp = rider ? riderPos(rider) : null;
  if (way === 'ladder') {
    // stegbilen under korgen: hytt, flak och blåljus
    const tx = cx - 44, on = Math.sin(S.anim * 11) > 0;
    box(tx, gy - 12, 34, 10, '#c81e3a'); box(tx + 33, gy - 16, 11, 14, '#c81e3a'); R(tx + 35, gy - 15, 7, 5, '#bfeaff');
    R(tx + 2, gy - 9, 30, 1, '#ffd23f'); text(g, '112', tx + 17, gy - 10, '#ffffff', 'center');
    box(tx + 36, gy - 19, 5, 3, on ? '#3f7cff' : '#1b2a6e');
    for (const wx of [tx + 4, tx + 26, tx + 36]) { R(wx, gy - 3, 5, 3, INK); R(wx + 1, gy - 2, 3, 1, '#5a5a5a'); }
    // stegen reses från flaket mot korgens golv
    const k = P.ph === 'stuck' ? 0 : P.ph === 'rig' ? clamp(1 - (P.t - S.t) / RAISE_T, 0, 1) : 1;
    const x0 = tx + 8, y0 = gy - 13, x1 = Math.round(x0 + (cx - 6 - x0) * k), y1 = Math.round(y0 + (carBot - y0) * k);
    if (k > 0) {
      line(x0, y0, x1, y1, INK); line(x0 + 3, y0, x1 + 3, y1, INK);
      const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 4));
      for (let i = 1; i < n; i++) { const t = i / n; R(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 4, 1, '#d4d0c8'); }
    }
  } else if (way === 'rope' && P.ph !== 'stuck') {
    // blocket på taket ovanför panoramahissen och repet ner till korgen (eller till den som firas ner)
    // (repet hänger mellan fasaden och glasröret, bredvid korgen)
    const rx = X(shaftCX(e.id) + ROPE_DX), ay = Y(floorY(EL[e.id].topF) - CAR_H - 30), k = P.ph === 'rig' ? clamp(1 - (P.t - S.t) / RIG_T, 0, 1) : 1;
    box(rx - 3, ay - 3, 7, 5, '#ffd23f'); R(rx - 6, ay - 6, 13, 2, INK);
    const endY = rp ? Y(rp.y) + 2 : Math.round(ay + (carBot - ay) * k), endX = rp ? X(rp.x) : rx;
    line(rx, ay + 2, endX, endY, '#ff8c42');
    if (!rp && k >= 1) { R(rx - 1, carBot - 2, 3, 2, '#ff8c42'); } // (selen väntar vid korgens dörr)
  }
  // den som är på väg ner: framifrån, i sele (repet) eller med händerna på stegen
  if (rider && rp) {
    const sx = X(rp.x) - PERSON_W / 2, sy = Y(rp.y) + Math.round(Math.sin(S.anim * 3 + rider.id) * (way === 'rope' ? 1 : 0));
    g.drawImage(personSprite(winFig(rider, rider.mood || 0), 'front', 0, 1, { blink: blinkOf(rider) }), sx, sy);
    if (way === 'rope') { R(sx + 2, sy + 11, PERSON_W - 4, 1, '#ff8c42'); R(sx + PERSON_W / 2, sy + 9, 1, 4, '#ff8c42'); }
  }
}

// ---------- Hissarna ----------
/** korgens läge i lågupplösta pixlar, null om den är utanför bilden @param {Elevator} e */
function carGeom(e) {
  // nivåfel: korgen står en aning för lågt eller högt när linorna töjer sig (överdrivet så att det syns)
  const lv = (e.level || 0) * 2.5 + (e.mode === 'broken' && e.fault && e.fault.kind === 'level' ? Math.sin(S.anim * 9) * 0.03 : 0);
  const x = X(shaftX(e.id) + 4), cw = CAR_W / PX, chh = CAR_H / PX;
  const ybOf = k => Y(floorY(e.pos + k + lv) - 4);
  const top = e.deck2 ? 1 : 0, yb = ybOf(0), yt = ybOf(top) - chh; // yt = överkanten på den översta korgen
  if (yt > lo.height + 40 || yb < -40) return null;
  return { x, cw, chh, ybOf, top, yb, yt };
}
/** motvikt och bärlinor: ritas före våningsdisplayerna (som sitter framför schakten) och korgarna @param {Elevator} e */
export function drawRopesPx(e) {
  const G = carGeom(e);
  if (!G || e.facade) return;
  const { x, cw, yt } = G;
  {
    // motvikt och bärlinor – i stormen svänger linorna i de höga schakten
    const span = Math.max(1, e.maxF - e.minF), frac = (e.pos - e.minF) / span;
    const st = Y(shaftTop(e)), sb = Y(shaftBot(e)), cwH = 23, cwX = X(shaftX(e.id) + SHAFT_W - 15);
    const cut = ropesCut(e);
    // linbrott: motvikten har rasat ner på sin buffert i schaktets botten
    const cwY = cut === null ? Math.round(st + 4 + frac * (sb - st - cwH - 8)) : sb - cwH - 4;
    if (cut !== null) {
      // avslitna linor hänger från taket (under linbytet blir de nya längre och längre)
      const end = Math.round(st + (yt - 4 - st) * cut);
      R(cwX + 2, st, 1, Math.round((cwY - st) * 0.2), INK); frayed(cwX + 2, st + Math.round((cwY - st) * 0.2));
      for (const dx of [-6, -2, 2, 6]) { R(x + cw / 2 + dx, st, 1, end - st, INK); if (end < yt - 6) frayed(x + cw / 2 + dx, end); }
      box(cwX, cwY, 5, cwH, PAL.basement); for (let k = 1; k < 5; k++) R(cwX + 1, cwY + k * 4, 3, 1, '#4a4170');
      // linfästet på korgtaket med stumparna kvar
      R(x + cw / 2 - 9, yt - 4, 19, 1, INK); R(x + cw / 2 - 9, yt - 4, 1, 4, INK); R(x + cw / 2 + 9, yt - 4, 1, 4, INK);
      if (cut < 0.99) for (const dx of [-6, 6]) { R(x + cw / 2 + dx, yt - 7, 1, 3, INK); frayed(x + cw / 2 + dx, yt - 8, -1); }
      return;
    }
    const ropeFault = e.mode === 'broken' && e.fault && e.fault.kind === 'rope';
    const amp = exposure(e) * Math.max(0, windAt() - 0.3) * 7 + (ropeFault ? 1.5 : 0);
    const sway = y => (amp ? Math.round(Math.sin((y + CY) / 23 + S.anim * 2.3) * amp * Math.sin(Math.PI * (y - st) / Math.max(1, yt - st))) : 0);
    if (amp) for (let y = st; y < cwY; y++) R(cwX + 2 + sway(y), y, 1, 1, INK); else R(cwX + 2, st, 1, cwY - st, INK);
    box(cwX, cwY, 5, cwH, PAL.basement); for (let k = 1; k < 5; k++) R(cwX + 1, cwY + k * 4, 3, 1, '#4a4170');
    for (const dx of [-6, -2, 2, 6]) {
      if (amp) for (let y = st; y < yt - 4; y++) R(x + cw / 2 + dx + sway(y), y, 1, 1, INK);
      else R(x + cw / 2 + dx, st, 1, yt - st, INK);
    }
    R(x + cw / 2 - 9, yt - 4, 19, 1, INK); R(x + cw / 2 - 9, yt - 4, 1, 4, INK); R(x + cw / 2 + 9, yt - 4, 1, 4, INK);
    // linorna slår i schaktväggen i stormen
    if (amp > 3.5 && Math.sin(S.anim * 3.1 + e.id * 1.3) > 0.85) {
      const sy = Math.round(st + (yt - st) * 0.45);
      for (let n = 0; n < 4; n++) R(x - 2 + Math.round(vrand(0, 3)), sy + Math.round(vrand(-4, 4)), 1, 1, vpick(['#ffffff', '#ffd23f']));
      label('SMACK!', x - 4, sy - 4, '#ffffff', INK);
    }
    // förvarning: slitna linor fransar sig och knarrar
    if (e.creak) {
      const fy = Math.round(st + (yt - st) * 0.5);
      for (const dx of [-6, -2, 2, 6]) { R(x + cw / 2 + dx - 1, fy, 3, 1, '#c9a26b'); if (Math.sin(S.anim * 5 + dx) > 0.5) R(x + cw / 2 + dx + 1, fy + 1, 1, 1, '#c9a26b'); }
      if (Math.sin(S.anim * 2.7) > 0.3) label('KNARR…', x + cw / 2, fy - 10, '#ffe9a8', INK);
    }
  }
}
/** Ett hissfel syns på sitt sätt: rök ur motorn, ERR på styrkortet, gnistor från bromsen, nivåpilar –
 *  och vid ett fel mellan två våningar sitter folk fast med nödljuset tänt och knackar @param {Elevator} e */
function faultPx(e, x, cw, chh, yt, yb) {
  const F = e.fault, kind = F ? F.kind : '';
  if (F && F.trapped) {
    R(x + 2, yt + 2, cw - 4, chh - 4, 'rgba(255,214,120,.14)'); R(x + Math.round(cw / 2) - 2, yt + 1, 5, 1, '#ffe9a8');
    if (Math.sin(S.anim * 4 + e.id) > 0) label('INSTÄNGDA!', x + cw / 2, yt - 11, '#ffffff', '#ff2d55');
    else if (Math.sin(S.anim * 2.3 + e.id) > 0.4) label('KNACK KNACK', x + cw / 2, yt + chh / 2, '#ffffff', INK);
    else label('FEL!', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  } else if (Math.sin(S.anim * 6) > -0.4) label('FEL!', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  if (kind === 'motor') for (let i = 0; i < 3; i++) { const k = (S.anim * 0.7 + i / 3) % 1; g.globalAlpha = (1 - k) * 0.6; g.drawImage(PUFF(2 + Math.round(k * 3)), x + cw / 2 - 4 + i * 3, yt - 8 - Math.round(k * 14)); g.globalAlpha = 1; }
  if (kind === 'board' && Math.sin(S.anim * 8) > 0) label('ERR 0x1F', x + cw / 2, yt + chh / 2 - 4, '#7cf06b', INK);
  if (kind === 'brake' && Math.sin(S.anim * 9) > 0.2) for (const sx of [x - 2, x + cw + 1]) for (let n = 0; n < 3; n++) R(sx + Math.round(vrand(-1, 1)), yb - Math.round(vrand(2, chh - 2)), 1, 1, vpick(['#ffd23f', '#ffffff', '#ff9f1c']));
  if (kind === 'level') { const up = Math.sin(S.anim * 3) > 0; text(g, up ? '▲' : '▼', x + cw + 3, yt + chh / 2 - 3, '#ffe14d', 'left', 1, INK); }
}
/** Linbrott: hur långt ner i schaktet linorna når (0–1 av vägen till korgen), null = hela linor @param {Elevator} e */
function ropesCut(e) {
  if (e.mode === 'snapped') return 0.22;
  if (e.mode !== 'broken' || !e.fault || !e.fault.cable) return null;
  const t = techOf(e), on = t && t.state === 'office' && t.floor === e.fault.exitF;
  return 0.22 + 0.78 * (on ? Math.min(1, t.workT / e.fault.need) : 0);
}
/** en fransig linända (dir = 1 nedåt, -1 uppåt) */
function frayed(x, y, dir = 1) { R(x - 1, y + dir, 1, 1, INK); R(x + 1, y + dir, 1, 1, INK); R(x, y + 2 * dir, 1, 1, '#7a6f9a'); }
/** Linbrott: gnistor från fångapparaten, takluckan, stegen upp till schaktdörren och teknikern på korgtaket @param {Elevator} e */
function drawCableRescue(e, G) {
  const { x, cw, yt, yb } = G;
  const s = e.snap, F = e.mode === 'broken' && e.fault && e.fault.cable ? e.fault : null;
  if (!s && !F) return;
  // gnistor längs styrskenorna medan korgen faller och en kort stund efter att fångapparaten tog
  if (s && (s.ph === 'fall' || S.t - s.caughtT < 1.2)) {
    for (const sx of [x - 2, x + cw + 1]) for (let n = 0; n < 5; n++)
      R(sx + Math.round(vrand(-2, 2)), yb - Math.round(vrand(0, 10)) - (s.ph === 'fall' ? Math.round(vrand(0, 14)) : 0), 1, 1, vpick(['#ffd23f', '#ffffff', '#ff9f1c', '#ff5d52']));
  }
  const exitF = s ? s.exitF : F.exitF, top = Y(floorY(exitF) - 4);
  const t = techOf(e), here = t && t.state === 'office' && t.floor === exitF ? t : null;
  // avspärrning vid schaktdörren på våningen ovanför
  if (here || F) for (let k = 0; k < cw; k += 4) R(x + k, top - 18, 2, 2, (k / 4) % 2 ? INK : '#ffd23f');
  const evac = s && s.ph === 'evac';
  if (!evac && !here) return;
  // takluckan står öppen
  const hx = x + Math.round(cw / 2) - 14;
  R(hx, yt - 1, 8, 2, INK); R(hx + 1, yt - 4, 1, 3, '#8a8f99');
  // stegen från korgtaket upp till schaktdörren
  const lx = x + cw - 10;
  // (kraftiga sidostänger med kontur – en tunn linje syns inte när man scrollar snabbt)
  if (top < yt - 2) {
    for (const sx of [lx - 1, lx + 4]) { R(sx - 1, top, 4, yt - top, INK); R(sx, top, 2, yt - top, '#e0b83a'); }
    for (let y = top + 2; y < yt - 1; y += 4) { R(lx + 1, y - 1, 3, 3, INK); R(lx + 1, y, 3, 1, '#e0b83a'); }
  }
  // teknikern på korgtaket (med pannlampa); vid linbytet står hen och drar i de nya linorna
  if (here) {
    const px = x + Math.round(cw / 2) - PERSON_W / 2 + (evac ? 2 : (Math.sin(S.anim * 2) > 0 ? 1 : 0)), py = yt - 1 - PERSON_H;
    g.drawImage(personSprite(here, 'front', 0, 1, { blink: blinkOf(here) }), px, py);
    R(px + PERSON_W / 2, py + 2, 1, 1, '#fff6a8');
    phoneOn(here, px, py);
    if (!evac && Math.sin(S.anim * 9 + e.id) > 0.4) for (let n = 0; n < 3; n++) R(px - 2 - Math.round(vrand(0, 3)), py + 6 + Math.round(vrand(0, 5)), 1, 1, vpick(['#ffd23f', '#ffffff']));
  }
  // den som är på väg ut klättrar uppför stegen
  const c = evac ? climber(e) : null;
  if (c && top < yt) {
    const k = clamp(1 - (s.nextOut - S.t) / s.climb, 0, 1), py = Math.round(yt - PERSON_H - (yt - top) * k);
    g.drawImage(personSprite(c, 'front', 0, 1, { blink: blinkOf(c) }), lx - 2, py);
  }
}
/** den som klättrar ut genom takluckan just nu (ritas på stegen, inte i korgen) @param {Elevator} e */
const climber = e => (e.snap && e.snap.ph === 'evac' && S.t > e.snap.nextOut - e.snap.climb * 0.7 ? nextOut(e) : null);
/** @param {Elevator} e */
export function drawCarPx(e) {
  const G = carGeom(e);
  if (!G) return;
  const { x, cw, chh, ybOf, top, yb, yt } = G;
  const off = e.off || e.mode === 'locked' || e.sleep || e.zoneLock || e.mode === 'broken' || e.mode === 'snapped' || e.mode === 'service' || e.hold || e.hot || e.windLock;
  const body = off ? PAL.carOff : e.color;
  // dubbeldäck: ramen mellan korgarna
  if (e.deck2) {
    const y0 = ybOf(1), y1 = yb - chh;
    R(x, y0 - 1, cw, y1 - y0 + 2, INK); R(x + 1, y0, cw - 2, y1 - y0, dark(body, 0.35));
    for (let k = 0; k < cw - 8; k += 8) { line(x + 2 + k, y0, x + 8 + k, y1 - 1, dark(body, 0.6)); line(x + 8 + k, y0, x + 2 + k, y1 - 1, dark(body, 0.6)); }
  }
  for (let k = 0; k <= top; k++) cabinPx(e, k, x, ybOf(k), body, k === top);
  drawCableRescue(e, G);
  if (VIEW.follow === e.id) ants(x - 3, yt - 3, cw + 6, yb - yt + 6, '#7dff9a');
  if (e.overloadFlash > 0) { if (Math.sin(S.anim * 18) > -0.2) label('ÖVERLAST!', x + cw / 2, yt - 11, '#ff2d55', '#ffffff'); }
  else if (e.fullFlash > 0) label('FULLT!', x + cw / 2, yt - 11, '#ffffff', '#ff2d55');
  if (e.off) label('UR DRIFT', x + cw / 2, yt + chh / 2 - 4, '#ffe14d');
  if (e.sleep) for (let i = 0; i < 3; i++) {
    const k = (S.anim * 0.5 + i / 3) % 1;
    g.globalAlpha = 1 - k; text(g, 'Z', x + cw / 2 + 3 + Math.round(k * 7), yt - 3 - Math.round(k * 13), '#bfeaff', 'left', i === 2 ? 2 : 1, INK); g.globalAlpha = 1;
  }
  if (e.zoneLock) label('SPÄRRAD', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  if (e.mode === 'locked') label('AVSTÄNGD', x + cw / 2, yt - 11, '#ff2d55', '#ffffff');
  if (e.mode === 'recall') label(`→ TILL ${fl(e.home)}`, x + cw / 2, yt - 11, '#ff8c42');
  if (e.mode === 'rescue') label('NÖDSÄNK', x + cw / 2, yt - 11, '#7dff9a');
  if (e.mode === 'normal' && S.power && e.restartAt && S.t < e.restartAt) label('OMSTART', x + cw / 2, yt - 11, '#7dff9a');
  if (e.mode === 'lift' || e.liftWant) label(e.mode === 'lift' ? 'FLYTTLASS' : '→ FLYTTLASS', x + cw / 2, yt - 11, '#ff8c42');
  if (e.mode === 'snapped') { if (Math.sin(S.anim * 7) > -0.3) label('LINBROTT!', x + cw / 2, yt + chh / 2 - 4, '#ff2d55', '#ffffff'); }
  if (e.mode === 'broken' && e.fault && e.fault.cable) label('LINBYTE', x + cw / 2, yt + chh / 2 - 4, '#ffd23f');
  else if (e.mode === 'broken') { faultPx(e, x, cw, chh, yt, yb); }
  // förvarning: det gnisslar och hackar i korgen
  if (S.warn && S.warn.type === 'fault' && S.warn.car === e.id && e.mode === 'normal') {
    if (Math.sin(S.anim * 6) > 0) label('GNISSEL…', x + cw / 2, yt - 11, '#ffe9a8', INK);
    if (Math.sin(S.anim * 13) > 0.6) for (let n = 0; n < 2; n++) R(x - 1 + (n ? cw + 1 : 0), yt + Math.round(vrand(4, chh - 4)), 1, 1, '#ffd23f');
  }
  if (e.mode === 'service') label(e.serviceAsap ? 'NIVÅJUSTERING' : 'SERVICE', x + cw / 2, yt - 11, '#ffd23f');
  if (e.hold && e.mode === 'normal') label('→ SERVICE', x + cw / 2, yt - 11, '#ffd23f');
  if (e.mode === 'normal' && !e.hold) {
    if (e.hot) { if (Math.sin(S.anim * 5) > -0.3) label('ÖVERHETTAD!', x + cw / 2, yt - 11, '#ff5d52', '#ffffff'); }
    else if (e.windLock) label('STÄNGD – STORM', x + cw / 2, yt - 11, '#5b8fb9', '#ffffff');
    else if (e.ffCar) label('BRANDHISS', x + cw / 2, yt - 11, '#ffffff', '#c81e3a');
    else if (e.indep) label('FLYTT · NYCKEL', x + cw / 2, yt - 11, '#d4a017');
    else if (e.medicHold) label('AMBULANS · VÄNTAR', x + cw / 2, yt - 11, '#2ec4b6');
    else if (e.heat >= WARM_AT && e.state === 'moving') label('VARM', x + cw / 2, yt - 11, '#ff8c42');
  }
  // en stamgäst i korgen som pratar
  const talker = e.passengers.find(talking);
  if (talker) speech(talker, x + cw / 2, yt - 23);
}
/** En korg (dubbeldäck: k = 0 nedre, 1 övre) med sina passagerare och dörrar. head = översta korgen (namn och våg). @param {Elevator} e */
function cabinPx(e, k, x, yb, body, head) {
  const cw = CAR_W / PX, chh = CAR_H / PX, yt = yb - chh;
  R(x, yt + (e.facade ? 2 : 0), cw, chh - (e.facade ? 2 : 0), INK);
  if (e.facade) { R(x + 2, yt, cw - 4, 2, INK); R(x + 1, yt + 1, cw - 2, 1, INK); }
  R(x + 1, yt + 1, cw - 2, chh - 2, body);
  R(x + 1, yt + 1, cw - 2, 1, light(body, 0.4)); R(x + 1, yb - 2, cw - 2, 1, dark(body, 0.3));
  const ix = x + 2, iy = yt + 9, iw = cw - 4, ih = chh - 11; // överkanten (9 px) har namn och våg
  R(ix - 1, iy - 1, iw + 2, ih + 2, INK);
  const inner = e.facade ? PAL.cabinGlass : e.freight ? PAL.cabinFreight : PAL.cabin;
  R(ix, iy, iw, ih, inner);
  R(ix, iy + ih - 6, iw, 6, dark(inner, 0.12));
  if (e.freight && S.move && S.move.state === 'on' && S.move.blankets) {
    // flyttdag: väggarna kläs med blå skyddsfiltar (hela flytten, även när hissen inte är låst)
    R(ix, iy, iw, ih - 6, '#3f5f9f');
    for (let yy = 0; yy < ih - 6; yy += 6) for (let xx = (yy / 6) % 2 ? 3 : 0; xx < iw; xx += 6) R(ix + xx, iy + yy, 3, 3, '#5577b8');
  } else if (e.freight) for (let n = 0; n < 4; n++) R(ix, iy + 5 + n * 8, iw, 1, 'rgba(27,16,51,.18)');
  else for (let n = 1; n < 4; n++) R(ix + n * Math.round(iw / 4), iy, 1, ih - 6, dark(inner, 0.08));
  if (e.facade) { line(ix + 3, iy + ih - 3, ix + 10, iy + 3, '#ffffff'); line(ix + 7, iy + ih - 3, ix + 14, iy + 3, '#ffffff'); }
  // passagerarna: hörnen först (hissetikett), bakre raden först
  g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
  const out = climber(e);
  const ps = e.passengers.filter(p => (!e.deck2 || (p.deck || 0) === k) && p !== out);
  const order = ps.map((p, i) => ({ p, s: carSlot(i) })).sort((a, b) => Number(a.s >= 4) - Number(b.s >= 4));
  for (const { p, s } of order) {
    if (p.dog) continue; // (den lösa hunden sitter på golvet, nedan)
    // bakre raden står högre upp och lite i skugga, så att huvudena syns ovanför främre raden
    const back = s < 4, px = x + Math.round(carSlotX(s) / PX) - PERSON_W / 2 + (back ? 0 : 2), py = yb - (back ? 7 : 1) - PERSON_H;
    if (back) g.filter = 'brightness(0.82)';
    // last (städvagn, paketkärra, flyttlåda, bår …) står bredvid ägaren – resväskan bakom, resten framför
    // (lasten vänds in mot korgens mitt, annars klipps den av väggen)
    const cx = px + PERSON_W / 2, cy = py + PERSON_H - 1; // (fötterna, som i hallen)
    const cg = p.cargo && !DOGS[p.cargo.kind] ? cargoSprite(p.cargo.kind, cx > ix + iw / 2 ? -1 : 1) : null;
    if (cg && p.cargo.kind === 'resväska') g.drawImage(cg.c, cx + cg.dx, cy - cg.c.height + 1 - cg.lift);
    g.drawImage(personSprite(p, 'front', 0, 1, { blink: blinkOf(p), hot: hotOf(p) }), px, py);
    if (cg && p.cargo.kind !== 'resväska') g.drawImage(cg.c, cx + cg.dx, cy - cg.c.height + 1 - cg.lift);
    g.filter = 'none';
    phoneOn(p, px, py);
  }
  // pudlar i korgen sitter längst fram vid matte/husses fötter
  for (const { p, s } of order) {
    const dog = p.dog ? 'pudel' : p.cargo ? DOGS[p.cargo.kind] : null; if (!dog) continue;
    const d = cargoSprite(dog + 'F', 1); if (!d) continue;
    const px = x + Math.round(carSlotX(s) / PX) + 2, py = yb - 1 - d.c.height;
    g.drawImage(d.c, px, py);
    if (Math.sin(S.anim * 0.8 + p.id * 2.3) > 0.97) bark(px + 4, py);
  }
  // flyttlasset från terrassen (panoramahissen i lastläge)
  if (k === 0 && e.mode === 'lift' && S.hoist && S.hoist.liftItem !== null && S.move) {
    const cg = cargoSprite(S.move.items[S.hoist.liftItem].sprite, 1);
    if (cg) g.drawImage(cg.c, x + Math.round((cw - cg.c.width) / 2), yb - 1 - cg.c.height);
  }
  // hissteknikern står i den öppna korgen och skruvar
  const fixer = k === 0 && (e.mode === 'broken' || e.mode === 'service') && e.techId !== null ? S.people.find(p => p.id === e.techId && p.state === 'office' && p.floor === e.floor) : null;
  if (fixer) {
    const px = x + Math.round(cw / 2) - PERSON_W / 2 + (Math.sin(S.anim * 3) > 0 ? 1 : 0), py = yb - 1 - PERSON_H;
    g.drawImage(personSprite(fixer, 'front', 0, 1, { blink: blinkOf(fixer) }), px, py);
    phoneOn(fixer, px, py);
    // gnistor från verktyget
    if (Math.sin(S.anim * 11 + e.id) > 0.3) for (let n = 0; n < 3; n++) R(px + PERSON_W + 1 + Math.round(vrand(0, 4)), py + 10 + Math.round(vrand(0, 6)), 1, 1, vpick(['#ffd23f', '#ffffff', '#ff9f1c']));
  }
  g.restore();
  // dörrarna är av tonat glas, så att man ser vilka som åker med
  // dörrfel: dörrarna slår upp och igen
  const flap = e.mode === 'broken' && e.fault && e.fault.kind === 'door' && !e.fault.trapped;
  const half = iw / 2, open = Math.round(half * (1 - (flap ? 0.5 + 0.5 * Math.sin(S.anim * 7) : e.door)));
  if (open > 0) for (const side of [0, 1]) {
    const px = side ? ix + iw - open : ix;
    R(px, iy, open, ih, PAL.doorGlass);
    R(px, iy + ih - 7, open, 7, PAL.doorLow);
    R(px, iy, open, 1, PAL.doorTop);
    R(side ? px : px + open - 1, iy, 1, ih, PAL.doorEdge);
    if (open > 4) R(side ? px + 2 : px + open - 3, iy + 3, 1, Math.min(10, ih - 12), 'rgba(255,255,255,.6)');
  }
  if (e.sleep) R(ix, iy, iw, ih, 'rgba(20,14,60,.45)');
  const sh = dark(body, 0.65);
  if (!head) { text(g, k ? 'ÖVRE DÄCK' : 'NEDRE DÄCK', x + 3, yt + 2, '#ffffff', 'left', 1, sh); return; }
  // överkanten: hissens namn och färdriktning i stora LED-tecken, vågen som en liten display till höger
  const nw = led(g, e.name, x + 2, yt + 1, '#ffffff', 'left', sh);
  if (e.dir && e.state === 'moving') led(g, e.dir > 0 ? '▲' : '▼', x + 3 + nw, yt + 1, '#ffffff', 'left', sh);
  const kg = cabinKg(e), ks = String(Math.round(kg)), kw = textW(ks) + textW('KG') + 6;
  const hot = kg > e.ratedKg ? '#ff5d52' : kg >= e.ratedKg * FULL_LOAD ? '#ff9f1c' : '#ffd23f';
  box(x + cw - kw - 1, yt + 1, kw, 8, '#101418');
  text(g, ks, x + cw - kw + 2, yt + 1, hot);
  text(g, 'KG', x + cw - 3, yt + 1, '#8a8f99', 'right');
  const fr = Math.min(1, kg / e.ratedKg);
  R(ix, yb - 3, iw, 2, 'rgba(27,16,51,.6)');
  R(ix, yb - 3, Math.round(iw * fr), 2, kg > e.ratedKg ? '#ff2d55' : kg >= e.ratedKg * FULL_LOAD ? '#ff8c42' : '#7cf06b');
}
/** @param {Person} p */
export const blinkOf = p => Math.sin(S.anim * 0.9 + p.id * 1.7) > 0.985;
/** brandmannens vattenstråle: en båge av droppar från munstycket mot lågorna (fx, fy = fötterna, figuren tittar åt vänster).
 *  Innan släckningen börjat (kåren väntar på att alla ska vara framme) sprutar bara den första. @param {Person} p */
export function hoseSpray(p, fx, fy) {
  const F = S.fire;
  R(fx + 2, fy - 1, 26, 1, '#c81e3a'); // slangen bakåt längs golvet (mot trapphuset)
  const nx = fx - 6, ny = fy - 15, tx = X(DOOR_X + 4 + (p.id % 3) * 14), len = nx - tx;
  R(nx - 2, ny, 3, 2, '#9aa3ad');
  if (len < 6 || (F.outAt === null && p.id % 3)) return;
  for (let i = 0; i < 12; i++) {
    const k = ((S.anim * 1.6 + i / 12 + p.id * 0.37) % 1);
    const x = Math.round(nx - 2 - k * len), y = Math.round(ny - Math.sin(k * Math.PI) * 9 + k * 8);
    R(x, y, k < 0.8 ? 2 : 1, 1, k < 0.85 ? '#9fd3ff' : '#ffffff');
  }
}
