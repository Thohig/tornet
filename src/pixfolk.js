// Pixelgrafik: folket i hallarna (köer, gång, hundar), pratbubblor och tankebubblor, teknikerns
// telefonsamtal, spårningen och muspekaren, repliker i hallen och ljudeffekterna ("STÄNG!" …).
import { S } from './state.js';
import { inWindow, landPos, peopleBehindDoor, personHead } from './render.js';
import { CAR_H, CAR_W, DOOR_X, FL, FLOOR_H, floorY, INNER_X1, LAND_X0, shaftX, surf } from './config.js';
import { cargoSprite, PERSON_H, PERSON_W, personSprite } from './pixpeople.js';
import { buttonsMode } from './buttons.js';
import { plain, PX, text, textW } from './pixart.js';
import { ARR, clamp, fl } from './util.js';
import { PAL } from './pixpal.js';
import { CALL_REPLY } from './service.js';
import { noteDetail, stateInfo } from './describe.js';
import { CREW_BY } from './crew.js';
import { vpick, vrand } from './rng.js';
import { VIEW, tinyText } from './view.js';
import { ants, ARROW, box, g, INK, label, line, lo, pill, place, R, X, Y } from './pixcore.js';
import { blinkOf, hoseSpray } from './pixcars.js';
/** @typedef {import('./people.js').Person} Person */

/** @param {Person} p */
export const hotOf = p => (p.mood || 0) === 2 && Math.sin(S.anim * 8 + p.id) > 0;

// ---------- Folket i hallarna ----------
export function drawHallPeople() {
  const list = [];
  for (const p of S.people) {
    if (p.dead) continue;
    const lp = landPos(p);
    if (lp) list.push({ p, lp });
  }
  list.sort((a, b) => (a.p.depth - b.p.depth) || (a.p.id - b.p.id));
  for (const { p, lp } of list) {
    const walking = p.state !== 'wait' && p.state !== 'office'; // (office: står på en plats i hallen, crew.js)
    const dir = walking && lp.dir ? lp.dir : (lp.face || p.face || 1);
    const frame = walking ? Math.floor(((p.walkPhase || 0) % (Math.PI * 2)) / (Math.PI / 2)) % 4 : 0;
    const fx = X(lp.x), fy = Y(surf(p.floor) + p.depth * 0.6);
    g.globalAlpha = lp.a;
    // den lösa hunden (dog.js) är en person som ritas som en pudel
    if (p.dog) { looseDog(p, fx, fy, dir, walking, frame); g.globalAlpha = 1; continue; }
    const dog = p.cargo ? DOGS[p.cargo.kind] : null;
    // (lasten syns även i kön – städvagnar och paketkärror vid varuhissen ska synas)
    const cg = dog ? cargoSprite(dog + (walking ? (frame % 2 ? '2' : '') : 'S'), dir) : p.cargo ? cargoSprite(p.cargo.kind, dir) : null;
    if (cg && p.cargo.kind === 'resväska') g.drawImage(cg.c, fx + cg.dx, fy - cg.c.height + 1 - cg.lift);
    g.drawImage(personSprite(p, 'side', frame, dir, { blink: blinkOf(p), hot: hotOf(p) }), fx - PERSON_W / 2, fy - PERSON_H + 1);
    phoneOn(p, fx - PERSON_W / 2, fy - PERSON_H + 1, dir);
    if (cg && p.cargo.kind !== 'resväska') g.drawImage(cg.c, fx + cg.dx, fy - cg.c.height + 1 - cg.lift);
    if (dog && cg) poodleExtras(p, fx, fy, dir, cg);
    // brandmannen på brandvåningen: slangen längs golvet och vattenstrålen mot lågorna vid korridoren
    if (p.ff && lp.face && S.fire && p.floor === S.fire.floor && p.state === 'office') hoseSpray(p, fx, fy);
    // guiden på Stadsturen håller upp flaggan som gruppen följer
    if (p.guide) {
      const px = fx + (dir > 0 ? 6 : -7), wv = Math.sin(S.anim * 6 + p.id) > 0 ? 1 : 0, fw = dir > 0 ? 1 : -6;
      R(px, fy - 33, 1, 23, '#c8a46e'); box(px + fw, fy - 34 + wv, 7, 5, '#ff8c42');
    }
    // ånga ur öronen när någon är riktigt sur
    if ((p.mood || 0) === 2) for (let i = 0; i < 2; i++) {
      const k = (S.anim * 1.4 + i * 0.5 + p.id * 0.13) % 1;
      R(fx + (i ? 4 : -5), fy - 25 - Math.round(k * 7), k < 0.5 ? 2 : 1, k < 0.5 ? 2 : 1, `rgba(255,255,255,${1 - k})`);
    }
    g.globalAlpha = 1;
  }
  // (mobilens helbild: texten går inte att läsa – bara den man följer får sin bubbla)
  const tiny = tinyText();
  // pratbubblor från stamgästerna först (de är viktigast), sedan tankebubblorna och namnbrickorna
  for (const { p, lp } of list) if ((!tiny || p === S.sel) && talking(p) && lp.a > 0.5) speech(p, X(lp.x), Y(surf(p.floor) + p.depth * 0.6) - 38 - (p.state === 'wait' ? 12 : 0));
  // tankebubblorna: de som väntar på samma hiss till samma våning delar en bubbla ("→6 L1 ×3"),
  // utom den som spåras och när namnbrickorna är på
  const groups = new Map();
  for (const { p, lp } of list) {
    if (p.state !== 'wait' || (tiny && p !== S.sel)) continue;
    const k = S.tags || p === S.sel ? `p${p.id}` : `${p.floor}|${p.dest}|${p.assigned}|${buttonsMode() ? p.dir : ''}|${p.fixAt ? 1 : 0}`;
    const gr = groups.get(k);
    if (gr) gr.push({ p, lp }); else groups.set(k, [{ p, lp }]);
  }
  for (const gr of groups.values()) {
    const lead = gr.find(q => q.p === S.sel) || gr.reduce((a, b) => (b.lp.x > a.lp.x ? b : a));
    thought(lead.p, X(lead.lp.x) + 3, Y(surf(lead.p.floor) + lead.p.depth * 0.6) - 30, gr.length);
  }
  // namnbrickor: alla med ID-knappen, stamgästerna alltid (med en stjärna)
  for (const { p, lp } of list) {
    if (tiny || !(S.tags || p.cast) || p.state === 'wait' || lp.a <= 0.5 || talking(p)) continue;
    const s = plain((p.cast ? '* ' : '') + p.name), w = textW(s) + 5, cx = X(lp.x), y = place(Math.round(cx - w / 2), Y(surf(p.floor) + p.depth * 0.6) - 36, w, 9, [0, -10]);
    if (y !== null) label(s, cx, y, p.cast ? '#ffe14d' : '#ffffff');
  }
}
/** hundar i koppel: bagagesorten → figurernas namn (gång, gång2, S = sitter, F = framifrån) */
export const DOGS = { pudel: 'pudel', raggig: 'ragg' };
/** pudelns koppel (från handen till halsbandet) och ett "VOV!" då och då @param {Person} p */
function poodleExtras(p, fx, fy, dir, cg) {
  const hx = fx + dir * 2, hy = fy - 9;
  const cx = fx + cg.dx + (dir > 0 ? 6 : cg.c.width - 7), cy = fy - cg.c.height + 5;
  line(hx, hy, cx, cy, '#ff4fa3');
  if (Math.sin(S.anim * 0.8 + p.id * 2.3) > 0.97) bark(fx + cg.dx + Math.round(cg.c.width / 2), fy - cg.c.height - 1);
}
/** den lösa pudeln: springer (två gångsteg), sitter när den stannar, och skäller ibland @param {Person} p */
function looseDog(p, fx, fy, dir, walking, frame) {
  const d = cargoSprite(walking ? (frame % 2 ? 'pudel2' : 'pudel') : 'pudelS', dir);
  if (!d) return;
  g.drawImage(d.c, fx - Math.round(d.c.width / 2), fy - d.c.height + 1);
  if (Math.sin(S.anim * 1.7 + p.id) > 0.9) bark(fx, fy - d.c.height);
}
export function bark(cx, y) { text(g, 'VOV!', cx, y - 6, '#ffffff', 'center', 1, INK); }
/** @param {Person} p */
export const talking = p => !!(p.say && S.t < p.say.until);
/** pratbubbla med namn och replik, med en liten pil ner mot personen @param {Person} p */
export function speech(p, cx, y) { bubble(`${p.name}: "${p.say.text}"`, cx, y); }
export function bubble(str, cx, y0, fill = '#ffffff', optional = false) {
  const s = plain(str);
  // (bubblan hålls inom bilden – pilen pekar ändå på personen)
  const w = Math.min(textW(s) + 6, 260), x = clamp(Math.round(cx - w / 2), 1, Math.max(1, lo.width - w - 1));
  // repliker är viktiga: de flyttas uppåt om platsen är tagen, men ritas alltid – utom de som också syns
  // någon annanstans (optional: driftchefen vid bordet, vars replik rullar i driftcentralens textremsa)
  const py = place(x, y0, w, 9, [0, -11, -22]);
  if (py === null && optional) return;
  const y = py ?? y0;
  if (y < y0) R(cx, y + 9, 1, y0 - y, INK);
  pill(x, y, w, 9, fill);
  g.save(); g.beginPath(); g.rect(x + 1, y, w - 2, 9); g.clip();
  text(g, s, x + 3, y + 1, INK);
  g.restore();
  R(cx - 1, y0 + 9, 3, 1, INK); R(cx, y0 + 10, 1, 1, INK);
}
/** tankebubblan: mål och tilldelad hiss (n = hur många som tänker samma sak) @param {Person} p */
function thought(p, x, y, n = 1) {
  // KNAPPAR: personen vet bara vilken knapp hen tryckt – ingen hiss är "hens"
  const buttons = buttonsMode() && !p.vip;
  const e = !buttons && p.assigned !== null ? S.elevators[p.assigned] : null;
  const txt = plain((S.tags ? p.name + ' ' : '') + (buttons ? (p.fixAt ? '?! ' : ARR(p.dir) + ' ') : '') + '→' + fl(p.dest));
  const tw = textW(txt), chip = e ? textW(e.name) + 4 : 0, many = n > 1 ? `x${n}` : '', mw = many ? textW(many) + 3 : 0;
  const w = tw + 6 + (e ? chip + 2 : 0) + mw, h = 9, bx = x - Math.round(w / 2), y0 = y - h;
  const by = place(bx, y0, w, h, [0, -10, -20]) ?? (p === S.sel ? y0 : null);
  if (by === null) return; // ingen plats: personen syns ändå i kön, och spåras man syns bubblan alltid
  R(x - 1, y + 2, 2, 2, INK); R(x + 1, y, 2, 2, INK); R(x + 1, y, 1, 1, '#ffffff');
  if (by < y0) for (let yy = by + h + 1; yy < y; yy += 3) R(x + 1, yy, 1, 1, INK);
  pill(bx, by, w, h, p === S.sel ? '#ffe14d' : '#ffffff');
  text(g, txt, bx + 3, by + 1, INK);
  if (e) { const cx = bx + tw + 5; R(cx, by + 1, chip, 7, e.color); text(g, e.name, cx + 2, by + 1, PAL.on(e.color)); }
  if (many) text(g, many, bx + w - mw, by + 1, '#606878');
}

// ---------- Telefonsamtalet: teknikern ringer in en extra tekniker ----------
/** var den som ringer ritades i den här bildrutan (låg upplösning), null = syns inte */
let callAt = /** @type {{ x: number, y: number }|null} */ (null);
export const resetCallAt = () => { callAt = null; };
/** @param {Person} p */
// (guiden ringer också – efter en vikarie när hon ska visa runt, visning.js)
const calling = p => (!!S.techCall && S.techCall.by === p.id && S.t < S.techCall.until)
  || (!!S.visning && S.visning.host === p.id && S.visning.ph === 'call' && S.t < S.visning.callUntil);
/** mobiltelefonen vid örat; (px, py) = figurens övre vänstra hörn, dir = sidovyns riktning (0 = framifrån) @param {Person} p */
export function phoneOn(p, px, py, dir = 0) {
  if (!calling(p)) return;
  const hx = dir ? px + PERSON_W / 2 + (dir > 0 ? 1 : -3) : px + PERSON_W - 4, hy = py + 3;
  R(hx - 1, hy - 1, 4, 8, INK); R(hx, hy, 2, 6, '#3a3f4a'); R(hx, hy + 1, 2, 2, '#7cf06b'); R(hx + 1, hy - 4, 1, 3, INK);
  callAt = { x: hx + 1, y: hy };
}
/** ringvågor från telefonen och samtalet i två pratbubblor: teknikern, sedan hissjourens svar */
export function drawCallPx() {
  const C = S.techCall;
  if (!C || S.t >= C.until) return;
  const p = S.people.find(q => q.id === C.by);
  if (!p || p.dead) return;
  let at = callAt;
  if (!at) {
    // teknikern syns inte (i ett rum eller i trappan): en telefon vid korridoren på hens våning
    const h = personHead(p);
    if (!h) return;
    at = h.hidden ? { x: X(DOOR_X) + 12, y: Y(floorY(p.floor)) - 30 } : { x: X(h.x) + 3, y: Y(h.y) + 3 };
    R(at.x - 3, at.y - 1, 6, 9, INK); R(at.x - 2, at.y, 4, 7, '#3a3f4a'); R(at.x - 2, at.y + 1, 4, 2, '#7cf06b'); R(at.x + 1, at.y - 4, 1, 3, INK);
  }
  // ringvågorna växer ut från luren
  const n = Math.floor(S.anim * 5) % 4;
  for (let k = 1; k <= n; k++) {
    const x = at.x + 2 + k * 2;
    R(x, at.y - k + 2, 1, 2 * k - 1, '#ffe14d'); R(x - 1, at.y - k + 1, 1, 1, '#ffe14d'); R(x - 1, at.y + k + 1, 1, 1, '#ffe14d');
  }
  const reply = S.t - C.t0 >= CALL_REPLY;
  const str = reply ? 'Hissjouren: "Uppfattat – vi skickar en kollega direkt!"'
    : C.trapped ? `${p.name}: "Jouren? Folk sitter fast i ${C.trapped} – skicka en till!"` : `${p.name}: "Jouren? ${C.n} hissar trasiga i kö – skicka en till!"`;
  bubble(str, at.x, at.y - 18, reply ? '#fff6a8' : '#ffffff');
}

// ---------- Spårning, muspekare, pratbubblor ----------
export function drawSelectionPx() {
  const p = S.sel;
  if (!p || p.dead) return;
  if (p.state === 'wait' && p.assigned !== null) {
    const e = S.elevators[p.assigned], x = X(shaftX(e.id) + 4), yt = Y(floorY(e.pos) - 4 - CAR_H);
    ants(x - 2, yt - 2, CAR_W / PX + 4, CAR_H / PX + 4, '#ffe14d');
    label(`→ ${p.name}`, x + CAR_W / PX / 2, yt - 12, '#ffe14d');
  }
  const h = personHead(p);
  if (!h) return;
  if (h.hidden) { trackNote(p, X(DOOR_X) + 14, Y(floorY(p.floor)) - 14, true); return; }
  const bob = Math.round(Math.sin(S.anim * 6) * 1.5);
  const hx = X(h.x), hy = Y(h.y) - (p.state === 'wait' ? 17 : 8) + bob;
  g.drawImage(ARROW(), hx - 3, hy - 7);
  trackNote(p, hx, hy - 9, false);
}
/** @param {Person} p */
function trackNote(p, x, yb, side) {
  const [lab, col] = stateInfo(p);
  const name = plain(`${p.name}${p.state === 'instairs' ? ' (i trapphuset)' : ''}`), detail = plain(noteDetail(p)), sl = plain(lab);
  const w1 = textW(name), w2 = textW(sl) + 5, w3 = textW(detail);
  const w = Math.max(w1 + w2 + 4, w3) + 8, h = 18;
  const bx = side ? x + 4 : clamp(x - Math.round(w / 2), 2, lo.width - w - 2), by = yb - h;
  pill(bx, by, w, h, PAL.note);
  if (side) { R(bx - 3, by + 7, 4, 1, INK); R(bx - 2, by + 6, 1, 3, INK); R(bx - 1, by + 5, 1, 5, INK); R(bx, by + 6, 1, 3, PAL.note); }
  else { R(x - 2, by + h, 5, 1, INK); R(x - 1, by + h + 1, 3, 1, INK); R(x, by + h + 2, 1, 1, INK); R(x - 1, by + h - 1, 3, 1, PAL.note); R(x, by + h, 1, 1, PAL.note); }
  text(g, name, bx + 4, by + 1, INK);
  R(bx + 7 + w1, by + 2, w2, 7, col); text(g, sl, bx + 10 + w1, by + 1, PAL.on(col));
  text(g, detail, bx + 4, by + 9, PAL.noteText);
}
export function drawHoverPx() {
  if (S.hoverDoor !== null && S.hoverDoor !== undefined && !S.hover) {
    const f = S.hoverDoor, n = peopleBehindDoor(f).length;
    const t = n ? `${FL[f].short}: ${n} inne – klicka för att spåra` : `${FL[f].short}: ingen inne`;
    label(t, X(LAND_X0) + 3, Y(floorY(f) - 80) - 4, '#ffffff', INK, 'left');
  }
  const p = S.hover;
  if (!p || p === S.sel) return;
  const h = personHead(p);
  if (!h || h.hidden) return;
  const t = p.state === 'office' ? `${p.name} · ${FL[p.floor].short}` : `${p.name} · ${fl(p.floor)}→${fl(p.dest)}`;
  label(t, X(h.x), Y(h.y) - (p.state === 'wait' ? 20 : 10));
}
// pratbubblor: hörs ut genom korridoren, en åt gången per våning (repliker per våningstema)
const GAGS = {
  _: ['Har någon sett min häftapparat?', 'Snart fredag!', 'Vem tog min yoghurt?!', 'Kopiatorn har papperstrassel IGEN', 'Min Tamagotchi är hungrig', 'Har du fått mitt fax?', 'Kaffet är slut!'],
  dentist: ['Gapa stooort!', 'Det känns bara lite…', 'Glöm inte tandtråden!'],
  game: ['Det är ingen bugg – det är en feature!', 'En bana till…', 'Vem skrev över min sparfil?'],
  ad: ['Tänk utanför boxen!', 'Mer neonrosa!', 'Kunden vill ha en delfin i filmen'],
  law: ['Invändning!', 'Enligt paragraf 12…', 'Faktureras per kvart'],
  radio: ['Ni lyssnar på Kanal 97!', 'Ring in och tävla!', 'Nästa låt är en riktig dänga!'],
  aerobic: ['Och KNÄLYFT!', 'Känn hur det bränner!', 'Fem till!'],
  server: ['Har du testat att starta om?', 'Modemet piper konstigt…', 'Y2K blir lugnt… va?'],
  spa: ['Vilken fin pudel!', 'Vem släppte ut taxen?', 'Vov!'],
  bank: ['Räntan är 7 %!', 'Ta en nummerlapp, tack', 'I tre exemplar!'],
  lab: ['Det borde inte bubbla så…', 'Eureka!', 'Varför glöder den?'],
  sky: ['Vilken utsikt!', 'En latte, tack', 'Byter hiss här – smart!'],
  apartments: ['Vad blir det till middag?', 'Var är fjärrkontrollen?', 'Dags att vattna blommorna', 'Spelar in på video!', 'Mamma, får jag spela Nintendo?'],
  roof: ['Vilken utsikt!', 'Tomaterna växer så det knakar', 'Kolla, en helikopter!'],
  dock: ['Paket till våning 9!', 'Var är följesedeln?'],
  lobby: [],
  garage: ['Var parkerade jag nu?'],
  cafe: [],
};
// personalen och de andra som jobbar i huset säger saker som hör till jobbet – aldrig kontorsrepliker
// (husets personal har sina repliker i CREW i config: lines.post och lines.break)
const ROLE_GAGS = {
  'väktare': ['Allt lugnt på min runda', 'Vem lämnade dörren olåst?', 'Ficklampan behöver nya batterier', 'Klockan tre – dags för nästa runda'],
  'städare': ['Vem har tappat konfetti här?', 'Torka fötterna!', 'Dammsugaren låter konstigt', 'Tre papperskorgar kvar'],
  'vaktmästare': ['Ett lysrör till…', 'Det knarrar i den här dörren', 'Var är skiftnyckeln?', 'Pannan ska ses över i morgon'],
  'nattdj': ['Ni lyssnar på Kanal 97!', 'Nästa låt är en riktig dänga!', 'Ring in och önska!', 'Klockan är mycket – stanna kvar!'],
  'nattekniker': ['Har du testat att starta om?', 'Modemet piper igen', 'Kaffe nummer fem', 'Servern lever – än så länge'],
  'hisstekniker': ['Den här bromsen har sett bättre dagar', 'Var är tretton-nyckeln?', 'Smörj, smörj', 'Vem har tryckt på alla knappar?!'],
  'arbetsledare': ['Det här ska rapporteras', 'Vem servade den här senast?', 'Linorna ska bytas var tionde år!', 'Jag vill se loggboken'],
  'bud': ['Paket till våning nio!', 'Kvittera här, tack', 'Var ligger 402?'],
  'flyttgubbe': ['PIVOT!', 'Lyft med benen!', 'Vem packar böcker i en enda låda?!', 'Ett, två, tre – LYFT!'],
  'ambulans': ['Försiktigt med båren', 'Ta det lugnt, vi är här nu', 'Puls och andning – bra'],
  'brandman': ['Ur vägen!', 'Rökdykare på väg upp', 'Släckt här – vidare!'],
  'lastare': [],
};
const DUTY_GAGS = {
  gondola: ['Håll i dig, Hasse!', 'Den här veven har inte rörts sen -79', 'En våning till…', 'Hasse, sluta vinka och håll i dig!'],
  dog: ['Hit med dig, vovven!', 'Fifi! FIFI!', 'Någon har sett en pudel?', 'Den är snabbare än den ser ut'],
  leak: ['Huvudkranen – var är den nu igen?', 'Medsols eller motsols…', 'Det forsar!', 'Hinkar! Någon!'],
};
const STUCK_GAGS = ['HALLÅ! Kan nån ringa nån?', 'Jag har i alla fall utsikt…', 'Titta inte ner, Hasse', 'Fönstren på 13:an är skinande rena nu iaf!', 'Kaffe vore inte fel nu'];
/** vad den här personen kan säga i rummet, eller null = kontorets/våningens vanliga repliker @param {Person} p */
function workLines(p) {
  // (olyckorna: vaktmästaren på uppdrag och fönsterputsaren som sitter fast – gondola.js, dog.js, leak.js)
  if (p.duty) return DUTY_GAGS[p.duty.kind] || ROLE_GAGS['vaktmästare'];
  if (p.role === 'fönsterputsare' && S.gondola && S.gondola.ph === 'stuck') return STUCK_GAGS;
  if (p.crewId) { const L = CREW_BY[p.crewId].lines; return p.onBreak || (p.spot && p.spot.brk) ? L.break : L.post; }
  return p.role ? ROLE_GAGS[p.role] || [] : null;
}
let gags = [], gagT = 2;
export function drawGagsPx(dt) {
  if (S.started && !S.paused) {
    gagT -= dt;
    if (gagT <= 0) {
      gagT = vrand(1.8, 4);
      const lo2 = VIEW.camY, hi = VIEW.camY + VIEW.viewH;
      // (vid kontrollbordet pratar chefen själv – S.chief.say; personalen och andra i tjänst bara om jobbet)
      // (mobilens helbild: småpratet går inte att läsa – inget nytt)
      const cands = tinyText() ? [] : S.people.filter(p => p.state === 'office' && !p.sleeping && p.spot && p.spot.k !== 'door' && p.spot.post !== 'chief'
        && !p.touring && (workLines(p) === null || workLines(p).length > 0)
        && floorY(p.floor) > lo2 + 40 && floorY(p.floor) < hi + 40 && !gags.some(q => q.p.floor === p.floor));
      if (cands.length) {
        const p = vpick(cands), work = workLines(p), th = FL[p.floor].theme;
        const own = GAGS[th] && GAGS[th].length ? GAGS[th] : null;
        const list = work || (own && vrand(0, 1) < 0.75 ? own : GAGS._);
        if (list.length) gags.push({ p, text: vpick(list), life: 3.2 });
      }
    }
  }
  for (const q of gags) {
    q.life -= dt;
    if (q.p.state !== 'office' || q.p.dead) { q.life = 0; continue; }
    // den som syns där hen är (personalrummet, receptionen, gondolen, i hallen): bubblan över huvudet – småprat,
    // så den hoppas över hellre än att läggas över skyltarna (DRIFTCENTRAL, PERSONALRUM) när platsen är tagen
    if (inWindow(q.p) || q.p.spot?.win === 'hall') { const hd = personHead(q.p); if (hd) { g.globalAlpha = clamp(q.life * 2, 0, 1); bubble(plain(q.text), X(hd.x), Y(hd.y) - 3, '#ffffff', true); g.globalAlpha = 1; } continue; }
    // repliken hörs från rummen: bubblan sitter till höger om trappskylten med en pil mot korridoren
    const s = plain(q.text), w = textW(s) + 7, x = Math.min(X(DOOR_X) + 56, X(INNER_X1) - w - 1), y0 = Y(floorY(q.p.floor + 1) + 4) + 24;
    const y = place(x, y0, w, 10, [0, 10]);
    if (y === null) { q.life = Math.min(q.life, 0.3); continue; }
    g.globalAlpha = clamp(q.life * 2, 0, 1);
    pill(x, y, w, 10, '#ffffff'); text(g, s, x + 4, y + 2, INK);
    R(x - 2, y + 4, 2, 1, INK); R(x - 3, y + 5, 1, 1, INK);
    g.globalAlpha = 1;
  }
  gags = gags.filter(q => q.life > 0);
}
/** Ljudeffekterna ("STÄNG!", "FSSSS!" …): samma effekt på samma våning visas en gång, med "×n" när
 *  flera hissar säger samma sak – annars staplas de och täcker displayerna. */
export function drawFxPx(dt) {
  const groups = new Map();
  for (const f of S.fx) {
    f.life -= dt; f.y -= 30 * dt;
    if (f.band === undefined) f.band = Math.round(f.y / FLOOR_H);
    const k = `${f.text}|${f.band}`, gr = groups.get(k);
    if (gr) gr.push(f); else groups.set(k, [f]);
  }
  // (mobilens helbild: ljudeffekterna blir bara fläckar – de räknas ner men ritas inte)
  if (!tinyText()) for (const gr of groups.values()) {
    const f = gr.reduce((a, b) => (b.life > a.life ? b : a));
    const x = gr.reduce((a, b) => a + b.x, 0) / gr.length;
    const n = new Set(gr.map(q => Math.round(q.x))).size;
    g.globalAlpha = clamp(f.life, 0, 1);
    text(g, plain(f.text) + (n > 1 ? ` x${n}` : ''), X(x), Y(f.y) - 6, f.color, 'center', (f.size || 22) > 24 ? 3 : 2, INK);
    g.globalAlpha = 1;
  }
  S.fx = S.fx.filter(f => f.life > 0);
}
