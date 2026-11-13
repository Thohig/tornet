// Regissören: automatisk kamera som letar upp det mest sevärda i huset och klipper dit.
// Rent gränssnitt: läser S, ändrar aldrig simuleringen (slumpen är vrand). Kameran rör sig via S.camTarget
// precis som när man följer en hiss. Allt manuellt (scrolla, följa, klicka på någon) stänger av regissören.
import { BREAK, CONTROL, CREW, DOCK, FLOOR_H, LOBBY, ROOF, STATION, TOP, floorY } from './config.js';
import { alarm, chiefOnDuty } from './chief.js';
import { CREW_BY, atPost, crewPerson, postFloor } from './crew.js';
import { S, hour } from './state.js';
import { fl } from './util.js';
import { vpick, vrand } from './rng.js';
import { VIEW, camMax, camTarget } from './view.js';
import { personHead } from './render.js';
import { cleanerAt } from './hoist.js';

const HOLD = 16;     // sekunder (verklig tid) en vanlig tagning varar
const MIN_HOLD = 10; // så kort får en tagning bli innan något viktigare får klippa in
const CUT_OVER = 25; // så mycket intressantare måste det nya vara för att klippa före tiden
const MEMORY = 6;    // så många tidigare tagningar som får straff (inte samma sak hela tiden)
const BORED = 1.5;   // poängavdrag per sekund som något redan har visats (helikoptern på taket blir tråkig)
const FORGET = 120;  // sekunder tills det tråkiga är glömt (avtar exponentiellt)

/** @typedef {{ key: string, score: number, kind: 'car'|'person'|'floor'|'cleaner'|'hoist', id: number, why: string, urgent?: boolean }} Shot */

// ---------- Slowmotion ----------
// I de dramatiska ögonblicken går tiden långsammare en kort stund (bara uppspelningen: samma dygn, samma steg).
// Läser bara tillståndet – ändrar aldrig simuleringen.
const SLOW_IN = 4, SLOW_OUT = 1.2; // hur fort farten glider ner/upp (per sekund verklig tid)
let slow = 1;
/** hur långsamt det dramatiska ögonblicket just nu ska gå (1 = vanlig fart) */
function slowTarget() {
  if (!S.started || S.paused) return 1;
  let m = 1;
  for (const e of S.elevators) {
    if (e.mode !== 'snapped') continue;
    if (e.snap.ph === 'fall') m = Math.min(m, 0.25); // fritt fall
    else if (e.snap.ph === 'trapped' && S.t - e.snap.caughtT < 0.6) m = Math.min(m, 0.35); // fångapparaten tar tag
  }
  if (S.storm && S.storm.struck !== null && S.t - S.storm.struck < 1.5) m = Math.min(m, 0.3); // blixten
  if (S.fire && S.t - S.fire.t0 < 2.5) m = Math.min(m, 0.4); // branden bryter ut
  return m;
}
/** Uppspelningens faktor för slowmotion; glider mjukt ner och upp igen. Anropas en gång per bildruta. */
export function slowmo(dt) {
  const want = slowTarget();
  const rate = want < slow ? SLOW_IN : SLOW_OUT;
  slow += Math.sign(want - slow) * Math.min(Math.abs(want - slow), rate * dt);
  return slow;
}

/** Slår på/av regissören. */
export function toggleAuto() {
  if (VIEW.auto) { VIEW.auto = false; return false; }
  // koppla loss allt annat först – detachCam stänger av regissören, så den slås på sist
  const t = camTarget();
  if (t) VIEW.lastCam = t;
  VIEW.follow = null; VIEW.camSel = false; VIEW.camFloor = null;
  VIEW.auto = true; VIEW.shot = null; S.followHold = 0;
  return true;
}

const recent = /** @type {string[]} */ ([]);
/** sekunder som varje sak har visats, avtar med tiden */
const seen = /** @type {Map<string, number>} */ (new Map());
let lastAnim = 0, cleanerShown = -1e9;
/** nödsänkningar: hiss-id → när regissören först såg den och var den slutade (för tagningen efteråt) */
const rescues = /** @type {Map<number, { t0: number, floor: number, t1: number|null }>} */ (new Map());
const RESCUE_AFTER = 4; // sekunder (speltid) kameran stannar kvar medan de räddade kliver ut
const name1 = p => p.name.split(' ')[0];
const visible = p => { const h = personHead(p); return h && !h.hidden; };

/** Allt som är värt att titta på just nu, med poäng. */
function shots() {
  /** @type {Shot[]} */
  const out = [];
  // urgent: något som just bryter ut (förvarning, blixt) får klippa in direkt, utan att vänta ut MIN_HOLD
  const add = (key, score, kind, id, why, urgent = false) => out.push({ key, score, kind, id, why, urgent });
  // ---------- incidenter och händelser ----------
  // förvarningar: kameran hinner dit innan det händer
  const W = S.warn;
  if (W) {
    const top = ROOF >= 0 ? ROOF : TOP;
    if (W.type === 'fire') add('warn', 90, 'floor', W.floor, `👃 Det luktar bränt på ${fl(W.floor)}`, true);
    else if (W.type === 'power') add('warn', 80, 'floor', LOBBY, '💡 Lamporna flimrar…', true);
    else if (W.type === 'storm') add('warn', 80, 'floor', top, '🌥️ Ovädret drar in', true);
    else if (W.type === 'heat') add('warn', 82, 'floor', Math.min(top, S.elevators[W.car].maxF), `🌡️ Motorn i ${S.elevators[W.car].name} brummar`, true);
    else add('warn', 86, 'car', W.car, W.type === 'cable' ? `🪢 Linorna i ${S.elevators[W.car].name} knarrar` : `🔩 ${S.elevators[W.car].name} gnisslar`, true);
  }
  // driftchefen fattar ett beslut: kameran klipper till kontrollrummet en stund (och sedan tillbaka) – utom
  // medan en hiss nödsänks: då visas sänkningen och beslutet syns i kontrollrumspanelen
  const C = S.chief, lowering = S.elevators.some(e => e.mode === 'rescue');
  if (C && C.on && C.say && C.say.dec && CONTROL >= 0 && S.t - C.say.t0 < 3 && !lowering)
    add('chief', 88, 'floor', CONTROL, `🧑‍💼 ${chiefOnDuty().name}: ${C.say.text}`, S.t - C.say.t0 < 1);
  if (S.fire) add('fire', 100, 'floor', S.fire.floor, `🔥 Brand på ${fl(S.fire.floor)}`, S.t - S.fire.t0 < 2);
  // brandmännen på väg upp (i brandhissen eller trapphuset)
  const ff = S.people.find(p => p.ff && !p.dead && p.state !== 'office' && visible(p));
  if (ff && S.fire) add('ff', 92, 'person', ff.id, '🚒 Brandmännen går in');
  // återsamlingsplatsen och när de utrymda går in igen
  const outside = S.people.filter(p => p.state === 'assembly').length;
  if (outside >= 4) add('assembly', 40 + Math.min(outside, 20), 'floor', LOBBY, `🧍 ${outside} på återsamlingsplatsen`);
  // blixten slår ner, och strömmen kommer tillbaka våning för våning
  if (S.storm && S.storm.struck !== null && S.t - S.storm.struck < 3) add('strike', 97, 'floor', ROOF >= 0 ? ROOF : TOP, '⚡ Blixten slår ner!', true);
  if (S.powerBack !== null && S.t - S.powerBack < 4) add('relight', 66, 'floor', LOBBY, '💡 Strömmen är tillbaka');
  if (S.medic && S.medic.state !== 'done') {
    const crew = S.people.filter(p => p.medic && !p.dead && visible(p));
    const amb = crew.find(p => p.cargo && p.cargo.kind.startsWith('bår')) || crew[0];
    if (amb) add('medic', 90, 'person', amb.id, '🚑 Ambulansen');
    else add('medicF', 80, 'floor', S.medic.floor, `🚑 ${S.medic.pname} har svimmat`);
  }
  if (S.heli && ROOF >= 0) add('heli', 75, 'floor', ROOF, '🚁 Helikoptern');
  // panoramahissen fast på fasaden: korgen, repet och den som firas ner (pano.js)
  const Pn = S.pano;
  if (Pn && Pn.ph !== 'done') {
    const pe = S.elevators[Pn.car], rider = Pn.rider ? S.people.find(p => p.id === Pn.rider.id) : null;
    if (rider) add('pano', 94, 'person', rider.id, `🧗 ${rider.name} ${Pn.setup === 'rope' ? 'firas ner längs fasaden' : 'klättrar nerför stegen'} (${Pn.out + 1}/${Pn.n})`, S.t - Pn.rider.t0 < 0.6);
    else add('pano', Pn.ph === 'stuck' ? 86 : 84, 'car', pe.id, Pn.ph === 'rig' ? (Pn.how === 'rope' ? `🧗 Räddarna riggar repet ovanför ${pe.name}` : `🚒 Stegbilen reser stegen mot ${pe.name}`)
      : `🛗 ${pe.name} sitter fast på fasaden · ${pe.passengers.length} instängda`, S.t - Pn.t0 < 2);
  }
  // husets personal (crew.js): skyndar tillbaka till kontrollrummet när larmet går, byter skift och tar rast
  for (const p of S.people) {
    if (p.dead) continue;
    if (p.role === 'arbetsledare' && visible(p)) { add(`crew${p.id}`, 38, 'person', p.id, `🦺 ${p.name} från hissjouren`); continue; }
    if (!p.crewId) continue;
    const moving = p.state !== 'office' && visible(p), c = CREW_BY[p.crewId], pf = postFloor(c.post);
    if (moving && p.goal === pf && alarm() && c.urgent) add(`crew${p.id}`, 64, 'person', p.id, `🏃 ${p.name} skyndar tillbaka till kontrollrummet`);
    else if (moving && p.leaving) add(`crew${p.id}`, 30, 'person', p.id, `${c.icon} ${p.name} går hem – passet är slut`);
    else if (moving && p.onBreak) add(`crew${p.id}`, 22, 'person', p.id, `☕ ${p.name}: ${p.breakWhy.toLowerCase()}`);
    else if (p.state === 'office' && p.onBreak && p.floor === BREAK && BREAK >= 0) add(`brk${p.id}`, 24, 'floor', BREAK, `☕ ${p.name} fikar i personalrummet`);
  }
  // teknikern ringer in en extra tekniker: korgen hen lagar eller våningen hen står på
  if (S.techCall && S.t < S.techCall.until) {
    const t = S.people.find(p => p.id === S.techCall.by && !p.dead);
    if (t) add('call', 82, t.state === 'ride' ? 'car' : 'floor', t.state === 'ride' ? t.car.id : t.floor, `📞 ${name1(t)} ringer hissjouren`);
  }
  for (const e of S.elevators) {
    const n = e.passengers.length;
    // nödsänkningen på reservkraft: klipper in direkt när korgen börjar krypa ner (före chefens beslut i
    // kontrollrummet – det syns i panelen) och stannar kvar tills de räddade har klivit ut (samma nyckel hela vägen)
    const r = rescues.get(e.id);
    if (e.mode === 'rescue') {
      if (!r || r.t1 !== null) rescues.set(e.id, { t0: S.t, floor: e.rescueTarget, t1: null });
      const t0 = rescues.get(e.id).t0;
      add(`rescue${e.id}`, 96, 'car', e.id, e.rs === 'open' ? `🔋 Dörrarna i ${e.name} går upp – ${n} kliver ut`
        : `🔋 ${e.name} nödsänks till ${fl(e.rescueTarget)} · ${n} instängda`, S.t - t0 < 1);
    } else if (r) {
      if (r.t1 === null) r.t1 = S.t;
      // (efterspelet viker när nästa hiss börjar nödsänkas – sänkningarna är korta och får inte missas)
      if (S.t - r.t1 < RESCUE_AFTER && !lowering) add(`rescue${e.id}`, 90, 'car', e.id, `🔋 Ute ur ${e.name} på ${fl(r.floor)}`);
      else rescues.delete(e.id);
    }
    if (!S.power && n && e.mode !== 'rescue') add(`dark${e.id}`, 70 + n, 'car', e.id, `⚡ Fast i ${e.name}`);
    // linbrottet: hissen vars linor fransar sig följs redan när den kör (samma nyckel som själva linbrottet,
    // så att kameran står kvar när det smäller), fallet och fångapparaten klipper in direkt
    if (e.snapNext && e.mode === 'normal') {
      if (e.state === 'moving') add(`snap${e.id}`, 95, 'car', e.id, `🪢 ${e.name} kör – linorna håller inte länge`, true);
      else add(`snapwait${e.id}`, 30, 'car', e.id, `🪢 Linorna i ${e.name} fransar sig`);
    }
    if (e.mode === 'snapped') {
      const s = e.snap, now = s.ph === 'fall' || (s.ph === 'trapped' && S.t - s.caughtT < 2);
      add(`snap${e.id}`, s.ph === 'evac' ? 92 : now ? 99 : 96, 'car', e.id,
        s.ph === 'evac' ? `🧗 Utrymning ur ${e.name}` : s.ph === 'fall' ? `🪢 ${e.name} faller!` : now ? `🪢 Fångapparaten tog i ${e.name}` : `🪢 Linbrott i ${e.name}`, now);
    }
    else if (e.mode === 'broken' && e.fault.cable && e.techId !== null) add(`cable${e.id}`, 22, 'car', e.id, `🔧 Linbyte i ${e.name}`);
    if (e.mode === 'broken' && n) add(`broken${e.id}`, 70, 'car', e.id, `🔧 ${e.name} har stannat`);
    if (e.hot) add(`hot${e.id}`, 45, 'car', e.id, `🌡️ ${e.name} är överhettad`);
    if ((e.overloadFlash || 0) > 1) add(`over${e.id}`, 50, 'car', e.id, `⚖️ Överlast i ${e.name}`);
    if (S.storm && e.facade) add('storm', 55, 'car', e.id, `🌬️ ${e.name} i stormen`);
    if (S.move && S.move.state === 'on' && e.freight) add('move', 35, 'car', e.id, '🚚 Flyttgubbarna');
    if (e.mode === 'service') add(`svc${e.id}`, 12, 'car', e.id, `🔧 Service på ${e.name}`);
    // fullsatt hiss i fart
    if (n >= 4 && Math.abs(e.v || 0) > 0.5) add(`full${e.id}`, 14 + n * 1.5, 'car', e.id, `🛗 ${e.name} med ${n} pers`);
  }
  if (S.train && STATION >= 0) add('train', 48, 'floor', STATION, '🚇 Tåget kommer');
  if (S.truck && DOCK >= 0) add('truck', 28, 'floor', DOCK, '🚚 Leveransbilen');
  // fönsterputsaren utanför tornet: ett lugnt avbrott då och då (bara medan putsaren skrapar, och inte när det brinner)
  const G = cleanerAt();
  // poängen växer ju längre sedan putsaren visades, så att den dyker upp ett par gånger per dag
  if (G && G.scrub && !S.fire) {
    const since = S.anim - cleanerShown;
    add('cleaner', Math.min(60, 20 + since / 3) + (S.storm ? 10 : 0), 'cleaner', 0, S.storm ? '🧽 Putsaren i blåsten' : '🧽 Fönsterputsaren');
  }
  // hissbalken: möbeln som hänger utanför fasaden, och panoramahissen när den kör flyttlasset
  const HB = S.hoist;
  if (HB && S.move && (HB.phase === 'lower' || HB.phase === 'hook')) {
    const it = HB.item !== null ? S.move.items[HB.item] : S.move.items.find(i => i.st === 'hatch');
    add('hoist', 78, 'hoist', 0, `🏗️ ${it ? it.name.replace(/^(en|ett) /, '').replace('(!)', '') : 'Flyttlasset'} i hissbalken`);
  }
  for (const e of S.elevators) if (e.mode === 'lift' && HB && HB.liftItem !== null) add('liftload', 40, 'car', e.id, `🚚 Flyttlass i ${e.name}`);
  // ---------- folk ----------
  const queue = new Map();
  for (const p of S.people) {
    if (p.dead) continue;
    if (p.say && p.say.until > S.t + 1 && visible(p)) add(`say${p.id}`, 52, 'person', p.id, `💬 ${name1(p)}`);
    if (p.vip && p.state !== 'office' && visible(p)) add(`vip${p.id}`, 40, 'person', p.id, `⭐ ${name1(p)} (VIP)`);
    if (p.state === 'wait') {
      queue.set(p.floor, (queue.get(p.floor) || 0) + 1);
      if (p.mood >= 2) add(`sur${p.id}`, Math.min(45, 22 + p.waited / 4), 'person', p.id, `😤 ${name1(p)} har väntat ${Math.round(p.waited)} s`);
    }
    if (p.cast && p.state !== 'office' && visible(p)) add(`cast${p.id}`, 18, 'person', p.id, `★ ${name1(p)}`);
  }
  for (const [f, n] of queue) if (n >= 5) add(`q${f}`, 16 + n, 'floor', f, `👥 ${n} väntar på ${fl(f)}`);
  // reserv: entrén och en slumpad hiss i rörelse
  add('lobby', 6, 'floor', LOBBY, '🚪 Entrén');
  const moving = S.elevators.filter(e => Math.abs(e.v || 0) > 0.5);
  if (moving.length) { const e = moving[Math.floor(vrand(0, moving.length))]; add(`ride${e.id}`, 8, 'car', e.id, `🛗 ${e.name}`); }
  return out;
}

/** Poäng efter hur nyligen vi visade samma sak (och lite slump så att det inte blir förutsägbart). */
function rate(s, current = false) {
  // det som visas just nu straffas inte för att det nyss visats (då klipps det bort i förtid)
  const i = current ? -1 : recent.indexOf(s.key);
  // incidenter (100) tål att visas länge, vardagssaker tröttnar man snabbare på
  const bored = Math.min(s.score * 0.6, (seen.get(s.key) || 0) * BORED);
  return s.score - bored - (i < 0 ? 0 : (MEMORY - i) * 6) + vrand(0, 6);
}

/** Var tagningen är just nu (världens y), eller null om den inte längre går att visa. */
function shotY(s) {
  if (s.kind === 'floor') return floorY(s.id) - FLOOR_H / 2;
  if (s.kind === 'cleaner') { const G = cleanerAt(); return G && G.crew ? G.y - 30 : null; }
  if (s.kind === 'hoist') return S.hoist && S.hoist.phase !== 'idle' ? S.hoist.y - 10 : null;
  if (s.kind === 'car') { const e = S.elevators[s.id]; return e ? floorY(e.pos) - FLOOR_H / 2 : null; }
  const p = S.people.find(q => q.id === s.id);
  if (!p || p.dead) return null;
  const h = personHead(p);
  return h && !h.hidden ? h.y + 40 : null;
}

/** Varje bildruta: byt tagning vid behov och styr kameran. */
export function updateDirector() {
  if (!VIEW.auto) return;
  // något manuellt har tagit över kameran
  if (camTarget()) { VIEW.auto = false; return; }
  if (!S.started || S.anim < (S.followHold || 0)) return;
  const dt = Math.max(0, Math.min(0.25, S.anim - lastAnim)); lastAnim = S.anim;
  let s = VIEW.shot;
  if (!S.paused) {
    const k = Math.exp(-dt / FORGET);
    for (const [key, v] of seen) { if (v * k < 0.5) seen.delete(key); else seen.set(key, v * k); }
    if (s) seen.set(s.key, (seen.get(s.key) || 0) + dt);
  }
  const age = s ? S.anim - s.t0 : Infinity;
  const y = s ? shotY(s) : null;
  const all = S.paused ? [] : shots();
  // något som just bryter ut får klippa in direkt (om det inte redan visas något sådant – en brådskande tagning
  // som inte längre finns, t.ex. chefens beslut när nödsänkningen börjar, skyddar inte)
  const live = s && all.some(c => c.key === s.key);
  const urgent = all.some(c => c.urgent && (!s || (c.key !== s.key && (!s.urgent || !live))));
  if (!S.paused && (y === null || age > MIN_HOLD || urgent)) {
    const cur = s && all.find(c => c.key === s.key);
    let best = null, bv = -Infinity;
    for (const c of all) { const v = rate(c); if (v > bv) { bv = v; best = c; } }
    const done = y === null || age > HOLD || !cur;
    // något brådskande har brutit ut men det bästa är inte brådskande och räcker inte för att klippa:
    // då vinner det bästa av det brådskande (annars missas t.ex. fallet vid ett linbrott)
    if (urgent && best && !best.urgent && !done && !(rate(best) > rate(cur, true) + CUT_OVER)) {
      let ub = null, uv = -Infinity;
      for (const c of all) if (c.urgent && (!s || c.key !== s.key)) { const v = rate(c); if (v > uv) { uv = v; ub = c; } }
      if (ub) best = ub;
    }
    if (best && best.key !== (s && s.key) && (done || (urgent && best.urgent) || rate(best) > rate(cur, true) + CUT_OVER)) {
      if (s && s.key === 'cleaner') cleanerShown = S.anim; // räknas från när kameran lämnar putsaren
      VIEW.shot = s = { ...best, t0: S.anim };
      recent.unshift(best.key); recent.length = Math.min(recent.length, MEMORY);
    }
  }
  if (!s) return;
  // texten kan ändras medan tagningen pågår (väntetid, antal, "faller!" → "fångapparaten tog")
  const now = all.find(c => c.key === s.key);
  if (now) s.why = now.why;
  const sy = shotY(s);
  if (sy === null) return;
  // hissar hålls mitt i bild; folk och våningar får röra sig lite innan kameran följer efter
  const top = VIEW.camY + VIEW.viewH * 0.3, bot = VIEW.camY + VIEW.viewH * 0.7;
  if (s.kind === 'car' || sy < top || sy > bot || S.anim - s.t0 < 0.1)
    S.camTarget = Math.max(0, Math.min(camMax(), sy - VIEW.viewH * 0.5));
}

// ---------- Bevakningen: personen vid skärmarna i kontrollrummet som klipper bilden ----------
// Regissören är en person: bildproducenten (Ludde på dagen, Siv på natten – personalen i crew.js) sitter
// bredvid driftchefen, väljer vad som visas och tänker högt. Är hen på rast går kameran på automatik.
// (Gränssnittet läser bara: namnen och tankarna påverkar aldrig simuleringen.)
const PRODUCERS = CREW.filter(c => c.post === 'producer').map(c => ({ id: c.id, name: c.name, from: c.from, title: c.title.split(' · ')[0].toLowerCase() }));
/** bevakaren som har passet just nu (byter skift samtidigt som driftchefen, klockan 22) */
export const crewOnDuty = (h = hour()) => (h >= PRODUCERS[1].from ? PRODUCERS[1] : PRODUCERS[0]);
/** är bevakaren borta från skärmen (rast, på väg)? då sköter kameran sig själv */
const awayFromDesk = who => { const p = crewPerson(who.id); return !!p && !atPost(p) ? p : null; };
/** vad bevakaren tänker om en tagning, efter sorten (nyckeln utan id) */
const THOUGHTS = {
  warn: ['Något är på gång – bäst att vara där först.', 'Den där siffran gillar jag inte…', 'Kaffet får vänta.'],
  chief: ['Chefen bestämmer – jag visar varför.', 'Nu blir det beslut i kontrollrummet.', 'Chefen har den där blicken igen.'],
  fire: ['Brand! Alla skärmar på det här.', 'Håll kameran stilla, håll kameran stilla…', 'Det här ska med i kvällsnyheterna.'],
  ff: ['Där kommer brandkåren – snyggt jobbat.', 'Följer brandmännen hela vägen upp.'],
  assembly: ['Alla ute? Räknar huvuden…', 'Fullt på återsamlingsplatsen.'],
  strike: ['Oj! Det smällde i hela huset.', 'Blixten – såg ni det?!'],
  relight: ['Ljuset är tillbaka. Puh.', 'Våning för våning tänds det igen.'],
  medic: ['Ambulansen – fri väg, tack.', 'Håller VIP-låset under uppsikt.'],
  medicF: ['Någon har svimmat – ambulansen är larmad.', 'Hjälpen är på väg.'],
  heli: ['Helikoptern! Alltid lika mäktigt.', 'Vem kommer med helikopter en vardag?'],
  call: ['Teknikern ringer jouren – det blir en lång dag.', 'Hissjouren igen…'],
  dark: ['De sitter i mörkret. Stackars dem.', 'Kommer reservkraften snart?'],
  rescue: ['Krypfart på reservkraft – sakta men säkert.', 'Snart ute nu, håll ut!', 'Där går dörrarna upp. Puh.'],
  snap: ['Linbrott! Fångapparaten måste hålla…', 'Jag vågar knappt titta.', 'Ut genom takluckan – försiktigt nu.'],
  snapwait: ['Det knarrar i linorna… jag håller ett öga på den.', 'Den där hissen skulle jag inte åka med just nu.'],
  cable: ['Linbyte. Det här tar timmar.', 'Teknikern har det tungt i schaktet.'],
  broken: ['Hissen står still – folk sitter fast.', 'Kom igen, teknikern…'],
  hot: ['Motorn är het. Chefen borde kolla fläkten.', 'Det luktar bränd broms härifrån.'],
  pano: ['Fast på fasaden – med utsikt, i alla fall.', 'Firas ner? Jag skulle aldrig våga.', 'Sakta, sakta…', 'Det här blir tv.'],
  over: ['Överlast! Någon får ta nästa.', 'Summern tjuter – det är alltid någon med en kartong.'],
  storm: ['Panoramahissen svajar i blåsten.', 'Inte för de höjdrädda i dag.'],
  move: ['Flyttgubbarna – bara de inte repar dörren.', 'Soffan går aldrig in. Den går aldrig in.'],
  svc: ['Nattservice. Lugnt och skönt.', 'Teknikern smörjer och skruvar.'],
  full: ['Fullsatt hiss – trångt där inne.', 'Sardinburk på väg {dir}.'],
  train: ['Nu väller de in från perrongen.', 'Tunnelbanan i tid, för en gångs skull.'],
  truck: ['Leveransbilen vid lastkajen.', 'Paket till hela huset igen.'],
  cleaner: ['Fönsterputsaren – han är min favorit.', 'Lite lugn och ro där ute på fasaden.'],
  hoist: ['Möbeln dinglar utanför fasaden…', 'Försiktigt med balken nu!'],
  liftload: ['Flyttlasset åker panoramahissen.', 'Lastläge – inga turister i den hissen nu.'],
  say: ['Vad säger hen nu då?', 'Den här vill jag höra.', 'Stamgästerna är bäst.'],
  vip: ['VIP på väg – låset är på.', 'Någon viktig. Se upptagen ut.'],
  sur: ['Den där har väntat länge. Inte bra.', 'Sur min. Smart borde skicka en hiss.'],
  cast: ['Där är ju en stamgäst!', 'Känner igen den där.'],
  q: ['Kö! Var är hissarna?', 'Det klumpar ihop sig här.'],
  lobby: ['Lugnt i entrén.', 'Inget särskilt händer – fint.'],
  ride: ['Jag följer en hiss en stund.', 'Bara rutin.'],
};
let crewKey = '', crewThought = '';
/** Vad bevakaren heter, gör och tänker just nu (null innan dygnet har börjat). */
export function crewNow() {
  if (!S.started) return null;
  const who = crewOnDuty(), s = VIEW.shot;
  if (!VIEW.auto) {
    const t = camTarget();
    return { who, auto: false, cut: false,
      doing: 'Du har kameran',
      show: t ? `📹 Du följer ${t.kind === 'car' ? `hiss ${S.elevators[t.id].name}` : t.kind === 'floor' ? `våning ${fl(t.id)}` : (S.people.find(p => p.id === t.id) || { name: 'någon' }).name}` : '📹 Fri kamera – du scrollar själv',
      thought: S.paused ? 'Pausat. Jag hämtar mer kaffe.' : 'Säg till när jag ska ta över bilden igen (A).' };
  }
  if (!s) return { who, auto: true, cut: false, doing: 'Letar efter något att visa', show: '🎬 …', thought: 'Skärmarna, skärmarna…' };
  const away = awayFromDesk(who);
  const key = `${s.key}|${s.t0}`;
  if (key !== crewKey) {
    crewKey = key; crewThought = vpick(THOUGHTS[s.key.replace(/\d+$/, '')] || ['Hm, vad är det där?']);
    if (s.kind === 'car') crewThought = crewThought.replace('{dir}', S.elevators[s.id].dir < 0 ? 'nedåt' : 'uppåt');
  }
  // den fullsatta hissen glesnar medan kameran följer den: texten och tanken följer med (inga sardiner med en passagerare)
  if (s.key.startsWith('full')) {
    const e = S.elevators[s.id], n = e.passengers.length;
    s.why = `🛗 ${e.name} med ${n} pers`;
    if (n < 4) return { who, auto: true, cut: false, doing: `Följer hiss ${e.name}`, show: s.why,
      thought: n === 0 ? 'Tom nu – alla klev av.' : n === 1 ? 'Nu är det bara en kvar där inne.' : 'Det glesnade fort.' };
  }
  const doing = s.kind === 'car' ? `Följer hiss ${S.elevators[s.id].name}`
    : s.kind === 'person' ? `Följer ${(S.people.find(p => p.id === s.id) || { name: 'någon' }).name.split(' ')[0]}`
    : s.kind === 'floor' ? `Visar våning ${fl(s.id)}`
    : s.kind === 'cleaner' ? 'Zoomar in på fasaden' : 'Följer hissbalken';
  if (away) return { who, auto: true, cut: S.anim - s.t0 < 1.2, doing: away.onBreak ? 'på rast – kameran sköter sig själv' : 'borta från skärmen – kameran sköter sig själv', show: s.why,
    thought: away.onBreak ? `(${away.breakWhy})` : '(på väg tillbaka till skärmen)' };
  return { who, auto: true, cut: S.anim - s.t0 < 1.2, doing, show: s.why, thought: crewThought };
}
