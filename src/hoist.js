// Takskenan på det smala tornets tak: fönsterputsaren och hissbalken delar den.
// Putsarens gondol sänks en våning i taget under dagen och putsar tornets fasad. På flyttdagen tar hissbalken
// skenan: gondolen hissas upp och parkeras, balken svängs ut och de tyngsta möblerna (XL – pianot, kassaskåpet)
// hissas ut genom lastluckan och ner till takterrassen. Där rullas de över till panoramahissen, som i lastläge
// ('lift') kör ner dem till entrén. Ingen hänger under en last: så länge balken är ute står gondolen parkerad.
// Balken stannar i hård vind, vid brand och vid strömavbrott.
// (Simulering: läget ligger i S.cleaner och S.hoist, grafiken i pixel.js läser bara.)
import { fl } from './util.js';
import { BX1, DOOR_T, EL, HATCH_FLOORS, LOBBY, SEAM_F, TOP, TOWER_X1, floorY } from './config.js';
import { S, hour, log } from './state.js';
import { moveTo, restoreElevator, setMode, vmaxOf } from './elevators.js';
import { windAt } from './weather.js';

/** huset har ett smalt torn med fasad att putsa (och en takskena) */
export const HAS_TOWER = TOWER_X1[TOP] < BX1;
/** panoramahissen med lastdörr mot terrassen, om någon */
export const LIFT = EL.find(d => d.terraceF >= 0) || null;
/** kan hissbalken användas (torn, lastluckor och en hiss vid terrassen)? */
export const HOIST_OK = HAS_TOWER && !!LIFT && HATCH_FLOORS.length > 0;
/** går flytten från våning f att göra med hissbalken? */
export const hoistServes = f => HOIST_OK && HATCH_FLOORS.includes(f);

// ---------- Geometri (världens y, nedåt = större) ----------
/** gondolen parkerad strax under taket – där sitter också balkens block */
export const PARK_Y = floorY(TOP) + 34;
const GONDOLA_STOPS = [PARK_Y];
for (let f = TOP - 1; f >= SEAM_F; f--) GONDOLA_STOPS.push(floorY(f) - 18);
/** takterrassen (den breda delens tak) – dit sänks lasten */
export const TERRACE_Y = floorY(SEAM_F);
/** kroken vid lastluckan på våning f */
export const hatchY = f => floorY(f) - 22;

export const CLEAN_H0 = 8, CLEAN_H1 = 16, CLEAN_UP = 17.5;
export const CLEAN_V = 70;   // gondolen hissas (världsenheter per sekund)
export const HOOK_V = 90;    // tom krok
export const HOIST_V = 38;   // med last (ungefär en våning på tre sekunder)
export const WIND_STOP = 0.45;
const RIG_T = 4, HOOK_T = 3, LOAD_T = 4, UNLOAD_T = 3;

const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => k * k * (3 - 2 * k);
/** var putsaren ska vara enligt dagens schema: { y, scrub, crew } */
export function cleanerPlan(h) {
  const P = GONDOLA_STOPS, n = P.length - 1, park = P[0];
  if (h < CLEAN_H0 || h >= CLEAN_UP || !HAS_TOWER) return { y: park, scrub: false, crew: false };
  if (h >= CLEAN_H1) return { y: lerp(P[n], park, smooth((h - CLEAN_H1) / (CLEAN_UP - CLEAN_H1))), scrub: false, crew: true };
  const seg = ((h - CLEAN_H0) / (CLEAN_H1 - CLEAN_H0)) * n, i = Math.min(n - 1, Math.floor(seg)), k = seg - i;
  return k < 0.25 ? { y: lerp(P[i], P[i + 1], smooth(k / 0.25)), scrub: false, crew: true } : { y: P[i + 1], scrub: true, crew: true };
}

export function hoistReset() {
  S.cleaner = { y: PARK_Y, scrub: false, crew: false, parked: true, waiting: false };
  // phase: idle | rig (balken svängs ut) | fetch (kroken till luckan) | hook | lower | unrig
  // lift: panoramahissens lastläge – up | openT | load | closeT | down | openE | unload | closeE | abort (brand)
  S.hoist = { phase: 'idle', y: PARK_Y, t: 0, item: /** @type {number|null} */ (null), halted: '',
    lift: /** @type {string|null} */ (null), liftT: 0, liftItem: /** @type {number|null} */ (null) };
}
/** Putsarens gondol, eller null om huset saknar ett smalt torn (för regissören och grafiken) */
export const cleanerAt = () => (HAS_TOWER && S.cleaner ? S.cleaner : null);

const items = () => (S.move && S.move.state === 'on' ? S.move.items : []);
/** varför balken står still just nu ('' = den kan köra) */
export function hoistHalt() {
  if (!S.power) return 'strömavbrott';
  if (S.fire) return 'brand';
  if (windAt() > WIND_STOP) return 'blåst';
  return '';
}
const approach = (y, target, v) => (Math.abs(target - y) <= v ? target : y + Math.sign(target - y) * v);

export function hoistTick(dt) {
  if (!HAS_TOWER) return;
  const C = S.cleaner, H = S.hoist, it = items();
  const work = HOIST_OK && it.some(x => x.st === 'hatch' || x.st === 'hoist');
  const needRail = work || H.phase !== 'idle';
  // putsaren följer sitt schema, men hissas upp och parkeras när balken behöver skenan
  const plan = cleanerPlan(hour());
  const target = needRail ? PARK_Y : plan.y;
  if (S.power) C.y = approach(C.y, target, CLEAN_V * dt);
  C.crew = plan.crew;
  C.parked = Math.abs(C.y - PARK_Y) < 1e-6;
  C.scrub = plan.scrub && !needRail && Math.abs(C.y - plan.y) < 1;
  if (needRail && plan.crew && !C.waiting) { C.waiting = true; log('🧽 Fönsterputsaren hissas upp och parkerar – hissbalken behöver takskenan', 'move'); }
  if (!needRail && C.waiting) { C.waiting = false; if (plan.crew) log('🧽 Takskenan är ledig – putsaren sänks ner och fortsätter putsa', 'move'); }
  if (HOIST_OK) { balkTick(dt, work, C.parked); liftTick(); }
}

function balkTick(dt, work, parked) {
  const H = S.hoist, M = S.move;
  const halt = hoistHalt();
  if (halt !== H.halted) {
    if (halt && H.phase !== 'idle') log(`🏗️ Hissbalken stannar – ${halt}${H.item !== null && M ? ` (${M.items[H.item].name} hänger kvar)` : ''}`, 'alert');
    else if (!halt && H.halted && H.phase !== 'idle') log('🏗️ Hissbalken kör igen', 'move');
    H.halted = halt;
  }
  if (H.phase === 'idle') {
    if (work && parked) { H.phase = 'rig'; H.t = 0; log(`🏗️ Hissbalken svängs ut över fasaden på ${fl(M.floor)} – de tyngsta möblerna ska ut genom lastluckan`, 'alert'); }
    return;
  }
  if (halt) return; // (står still – lasten hänger kvar där den är)
  if (H.phase === 'rig') { H.t += dt; if (H.t >= RIG_T) H.phase = 'fetch'; return; }
  if (H.phase === 'fetch') {
    const next = M && M.state === 'on' ? M.items.find(x => x.st === 'hatch') : null;
    if (!next) { H.phase = 'unrig'; H.t = 0; return; }
    const y = hatchY(M.floor);
    H.y = approach(H.y, y, HOOK_V * dt);
    if (H.y === y) { H.phase = 'hook'; H.t = 0; }
    return;
  }
  if (H.phase === 'hook') {
    H.t += dt;
    if (H.t < HOOK_T) return;
    const next = M.items.find(x => x.st === 'hatch');
    if (!next) { H.phase = 'fetch'; return; }
    next.st = 'hoist'; H.item = next.id; H.phase = 'lower';
    S.fx.push({ x: TOWER_X1[TOP] + 16, y: H.y - 20, text: 'HÅLL I!', color: '#ffd23f', life: 1.4 });
    log(`🏗️ ${cap(next.name)} lyfts ut genom lastluckan på ${fl(M.floor)} och sänks ner mot terrassen`, 'move');
    return;
  }
  if (H.phase === 'lower') {
    H.y = approach(H.y, TERRACE_Y, HOIST_V * dt);
    if (H.y === TERRACE_Y) {
      const x = M.items[/** @type {number} */ (H.item)];
      x.st = 'terrace'; H.item = null; H.phase = 'fetch';
      log(`🏗️ ${cap(x.name)} står på terrassen – rullas över till panoramahissen`, 'move');
    }
    return;
  }
  if (H.phase === 'unrig') {
    H.y = approach(H.y, PARK_Y, HOOK_V * dt);
    if (H.y !== PARK_Y) return;
    H.t += dt;
    if (H.t >= RIG_T) { H.phase = 'idle'; log('🏗️ Hissbalken fälls in – takskenan är ledig igen', 'move'); }
  }
}

// ---------- Panoramahissen i lastläge ----------
/** panoramahissen beställs när något står på terrassen: den kör klart sina passagerare och tar inga nya */
function liftTick() {
  const P = S.elevators[/** @type {any} */ (LIFT).id], it = items();
  if (!P) return;
  const waiting = it.some(x => x.st === 'terrace');
  if (P.mode === 'lift') {
    // brand: lasset får vänta på terrassen, hissen går tillbaka till brandläget
    // (dörrarna stängs först – vid terrassen har hissen ingen vanlig dörr)
    if (S.fire && S.hoist.lift !== 'abort') {
      const x = S.hoist.liftItem !== null && S.move ? S.move.items[S.hoist.liftItem] : null;
      if (x) x.st = 'terrace';
      S.hoist.liftItem = null; S.hoist.lift = 'abort';
    }
    return;
  }
  P.liftWant = waiting && P.mode === 'normal' && !S.fire;
  if (!P.liftWant || P.passengers.length || P.reserved || P.state === 'moving') return;
  if (P.state === 'doors' && P.doorPhase !== 'open' && P.doorPhase !== 'closing') return; // (öppnar för någon – vänta)
  setMode(P, 'lift');
  P.liftWant = false; P.parkTarget = null; P.sleep = false; P.target = null;
  S.hoist.lift = P.door > 0 ? 'closeE' : 'up'; S.hoist.liftT = 0;
  log(`🚚 ${P.name} går i lastläge – kör upp till terrassen och hämtar flyttlasset`, 'alert', P.color);
}
/** Ett steg för panoramahissen i lastläge (anropas från updateElevator när strömmen är på) */
export function liftStep(e, dt) {
  const H = S.hoist, M = S.move;
  const open = () => { e.state = 'doors'; e.doorPhase = 'opening'; e.door = Math.min(1, e.door + dt / DOOR_T); if (e.door >= 1) e.doorPhase = 'open'; return e.door >= 1; };
  const close = () => { e.state = 'doors'; e.doorPhase = 'closing'; e.door = Math.max(0, e.door - dt / DOOR_T); return e.door <= 0; };
  switch (H.lift) {
    case 'closeE': if (close()) H.lift = 'up'; return;
    case 'abort': if (close()) { H.lift = null; restoreElevator(e); } return;
    case 'up':
      e.state = 'moving'; e.target = e.terraceF; e.targetKind = 'lift';
      if (moveTo(e, e.terraceF, vmaxOf(e), dt)) { e.floor = e.terraceF; H.lift = 'openT'; }
      return;
    case 'openT': if (open()) { H.lift = 'load'; H.liftT = 0; } return;
    case 'load': {
      H.liftT += dt;
      if (H.liftT < LOAD_T) return;
      const x = M && M.state === 'on' ? M.items.find(y => y.st === 'terrace') : null;
      if (x) { x.st = 'lift'; H.liftItem = x.id; log(`🚚 ${cap(x.name)} rullas in i ${e.name} på terrassen`, 'move', e.color); H.lift = 'closeT'; return; }
      // inget att hämta: något hänger fortfarande i balken – vänta, annars ner tom
      if (M && M.state === 'on' && M.items.some(y => y.st === 'hoist' || y.st === 'hatch') && H.liftT < 40) return;
      H.lift = 'closeT';
      return;
    }
    case 'closeT': if (close()) H.lift = 'down'; return;
    case 'down':
      e.state = 'moving'; e.target = LOBBY; e.targetKind = 'lift';
      if (moveTo(e, LOBBY, vmaxOf(e), dt)) { e.floor = LOBBY; H.lift = 'openE'; H.liftT = 0; }
      return;
    case 'openE': if (open()) { H.lift = 'unload'; H.liftT = 0; } return;
    case 'unload': {
      H.liftT += dt;
      if (H.liftT < UNLOAD_T) return;
      if (H.liftItem !== null && M) {
        const x = M.items[H.liftItem];
        x.st = 'truck'; M.truck++; M.done++; M.hoisted++; S.stats.moveLoads++;
        log(`🚚 ${cap(x.name)} rullas ut genom entrén till flyttbilen (${M.truck}/${M.loads})`, 'move', e.color);
      }
      H.liftItem = null;
      // mer på väg? då kör den upp igen, annars tillbaka i vanlig trafik
      if (M && M.state === 'on' && M.items.some(y => y.st === 'terrace' || y.st === 'hoist')) { H.lift = 'closeE'; return; }
      H.lift = null;
      restoreElevator(e);
      log(`🚚 ${e.name} går i vanlig trafik igen`, 'move', e.color);
    }
  }
}
const cap = s => s[0].toUpperCase() + s.slice(1);
/** Hissbalkens läge i klartext för flyttrutan ('' om flytten inte har något för balken) */
export function hoistStatus(M) {
  if (!M || !M.hoist) return '';
  const xl = M.items.filter(x => x.size === 'XL');
  if (!xl.length) return '';
  const H = S.hoist, C = S.cleaner, it = H.item !== null ? M.items[H.item] : null;
  const name = x => x.name.replace('(!)', '');
  if (H.halted && H.phase !== 'idle') return `Hissbalken står still (${H.halted})${it ? ` – ${name(it)} hänger kvar utanför fasaden` : ''}.`;
  const lift = M.items.find(x => x.st === 'lift'), terr = M.items.find(x => x.st === 'terrace'), hatch = M.items.find(x => x.st === 'hatch');
  if (lift) return `${cap(name(lift))} åker panoramahissen ner till entrén.`;
  if (it) return `${cap(name(it))} hänger i hissbalken och sänks ner mot takterrassen.`;
  if (terr) return `${cap(name(terr))} står på terrassen och väntar på panoramahissen.`;
  if (hatch) return H.phase === 'idle' && !C.parked ? `${cap(name(hatch))} står vid lastluckan – putsaren hissas upp så att hissbalken får takskenan.` : `${cap(name(hatch))} står vid lastluckan – hissbalken hämtar.`;
  const done = xl.filter(x => x.st === 'truck');
  if (done.length === xl.length) return `Hissbalken är klar: ${xl.map(name).join(' och ')} gick utanpå fasaden och med panoramahissen.`;
  return `${cap(xl.map(name).join(' och '))} är för tungt för varuhissen – det ska ut genom lastluckan med hissbalken.`;
}
