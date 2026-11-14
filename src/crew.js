// Husets personal: driftcheferna, bildproducenterna, receptionisten, fönsterputsaren och lastaren (CREW i config).
// Var och en är en person i huset med en egen post (en plats i SPOTS med post), ett skift och raster på bestämda
// ställen (personalrummet, Sky Café, takträdgården, kiosken, godisautomaten, perrongen). Raster tas bara när det är
// lugnt; den som är "urgent" (kontrollrummet) skyndar tillbaka när larmet går, och den som ska täcka för någon
// (cover) går inte förrän den andra sitter på sin post. Allt här är simulering och drar inga slumptal.
import { BREAK, CAFE, CONTROL, CREW, DOCK, LOBBY, ROOF, SPOTS, START_H, STATION, TERRACE_F } from './config.js';
import { S, hour, log, occOf } from './state.js';
import { blankPerson, gotoSpot, pev, pn, releaseSpot, setTrip } from './people.js';
import { inFireZone, stopFloors } from './dispatch.js';
import { windAt } from './weather.js';
import { WIND_STOP } from './hoist.js';

/** @typedef {import('./config.js').CrewDef} CrewDef */
/** hur ofta (rumstid, se activityRate) personalen tittar upp: rast, larm, skiftbyte */
export const CREW_LOOK = 3;
/** personalens data efter id */
export const CREW_BY = Object.fromEntries(CREW.map(c => [c.id, c]));
/** postens våning */
const POST_F = { chief: CONTROL, producer: CONTROL, reception: LOBBY, gondola: ROOF, terrace: TERRACE_F, grind: LOBBY };
/** rastmålens våningar */
const WHERE_F = { break: BREAK, cafe: CAFE, roof: ROOF, kiosk: STATION, vending: LOBBY, platform: STATION, dock: DOCK };
export const postFloor = post => POST_F[post] ?? -1;
export const postSpot = post => { const f = postFloor(post); return f >= 0 ? SPOTS[f].find(s => s.post === post) || null : null; };
/** något som kontrollrummet är mitt uppe i (larmljuset snurrar, ingen där fikar) */
export const alarm = () => !!(S.fire || S.outage || S.storm || S.warn
  || S.elevators.some(e => e.mode === 'snapped' || e.hot || (e.mode === 'broken' && e.fault && e.fault.trapped)));
/** personen ur personalen med id, om hen är i huset */
export const crewPerson = id => S.people.find(p => p.crewId === id && !p.dead) || null;
/** sitter p på sin post just nu? */
export const atPost = p => !!p && p.state === 'office' && !!p.spot && p.spot.post === CREW_BY[p.crewId].post && p.floor === postFloor(p.spot.post);
/** sitter någon på posten? */
const manned = post => S.people.some(p => p.crewId && !p.dead && atPost(p) && p.spot.post === post);
/** personalen som sitter (på posten eller på rast) tittar upp direkt
 * @param {(p: any) => boolean} [pred] */
export function lookUp(pred = () => true) {
  for (const p of S.people) if (p.crewId && p.state === 'office' && pred(p)) p.timer = 0;
}

// ---------- Skiftet ----------
/** Personalen när dygnet börjar: de som har passet från morgonen sitter redan på sina poster */
export function crewStart() {
  for (const c of CREW) if (c.arrive === null) spawnCrew(c.id, true);
}
/** Schemat: de som kommer in genom entrén senare under dygnet (sim.js lägger dem i personalschemat) */
export const crewArrivals = () => CREW.filter(c => typeof c.arrive === 'number').map(c => ({ at: /** @type {number} */ (c.arrive), id: c.id }));
/** En ur personalen kommer till jobbet: sitter redan på posten (atPost, när dygnet börjar) eller kliver in i entrén */
export function spawnCrew(id, atStart = false, from = LOBBY) {
  const c = CREW_BY[id], pf = postFloor(c.post);
  if (!c || pf < 0 || crewPerson(id)) return null;
  const i = CREW.indexOf(c);
  const p = blankPerson('staff', from, -30 - (i % 4) * 12, { name: c.name, look: { ...c.look }, kg: c.kg, fit: c.fit, speedMul: c.speed,
    walkPhase: i * 2, depth: -1 - (i % 5) * 1.3, patience: 8, space: c.space, polite: c.polite });
  Object.assign(p, { role: c.role, crewId: id, title: c.title, onBreak: false, breakUntil: 0, breakWhy: '', breakWhere: '',
    breaks: c.breaks.map(([at, len, where, why]) => ({ at, len, where, why, done: false })) });
  if (from !== LOBBY) p.exitFloor = from;
  S.people.push(p);
  if (atStart) {
    // dygnet börjar: på posten (driftchefen i personalrummet om spelaren har skickat hen på rast)
    const off = offReason(p, hour());
    p.floor = off && BREAK >= 0 ? BREAK : pf;
    gotoSpot(p, p.floor);
    p.x = p.spot.x; p.state = 'office'; p.face = p.spot.face || 1; p.timer = CREW_LOOK;
    pev(p, `${c.title} · ${p.spot.desc}`);
  } else {
    const first = crewNext(p, hour()) || [pf, 'Till jobbet'];
    setTrip(p, first[0], first[1], false);
    pev(p, `${from === LOBBY ? 'Kliver in i entrén' : 'Kliver ur flyttbilen vid lastkajen'} · ${c.title} · ${p.why}`);
    log(`${c.icon} ${pn(p)} (${c.role}) kommer till jobbet`, 'person', null, p.id);
  }
  return p;
}

// ---------- Platser ----------
/** Var personen sätter sig på våning f: posten (om den är ledig och det inte är rast), rastmålet, personalrummet,
 *  annars stående i hallen. Drar inga slumptal. */
export function crewSpot(p, f) {
  const c = CREW_BY[p.crewId], mine = s => occOf(s) === null || occOf(s) === p.id;
  const post = SPOTS[f].find(s => s.post === c.post);
  if (post && mine(post) && !p.onBreak && !offReason(p, hour())) return post;
  if (p.onBreak && p.breakWhere) {
    const w = SPOTS[f].find(s => s.where === p.breakWhere && (s.k === 'door' || mine(s)));
    if (w) return w;
    // Sky Café och takträdgården: en ledig stol bland gästernas
    if (p.breakWhere === 'cafe' || p.breakWhere === 'roof') {
      const chair = SPOTS[f].find(s => !s.post && !s.where && !s.brk && !s.staff && s.k !== 'door' && occOf(s) === null);
      if (chair) return chair;
    }
  }
  const brk = SPOTS[f].find(s => s.brk && mine(s));
  if (brk) return brk;
  return { x: 470 - (CREW.indexOf(c) % 4) * 26, k: 'stand', face: -1, temp: true,
    desc: f === LOBBY ? 'Står i entrén och väntar' : p.onBreak ? p.breakWhy : 'Står i hallen och väntar' };
}

// ---------- Hissvärdinnan (Grinden) ----------
/** hissen som personalen med id kör (attendant i BUILDING), om någon */
export const attendedCar = id => S.elevators.find(e => e.attendant === id) || null;
/** kan hissvärdinnan kliva av? Korgen ska stå tom hemma med stängd grind – annars kör den hem först (attLeave). */
function grindFree(p) {
  const e = attendedCar(p.crewId);
  if (!e) return true;
  // sitter hon fast i korgen mellan två våningar går hon ingenstans
  if (e.mode === 'broken' && e.fault && e.fault.trapped) return false;
  if (e.mode !== 'normal') return true;
  const home = e.state === 'idle' && Math.abs(e.pos - e.home) < 1e-6 && !e.passengers.length && !e.reserved && e.door <= 0 && !stopFloors(e).length;
  if (home) return true; // (attLeave står kvar tills attendTick ser att hon har gått – annars ser hissen ledig ut ett steg)
  if (!e.attLeave) { e.attLeave = true; pev(p, `Kör hem ${e.name} till ${e.home === LOBBY ? 'entrén' : 'hemvåningen'} innan jag går`); }
  return false;
}
/** Varje steg: hissar med hissvärdinna kör bara när hon står i korgen (på sin post). */
export function attendTick() {
  for (const e of S.elevators) {
    if (!e.attendant) continue;
    const m = crewPerson(e.attendant), on = atPost(m);
    if (on === e.unmanned) {
      e.unmanned = !on;
      if (on) log(`🛗 ${m.name} kliver in i ${e.name} – "Vilken våning får det lov att vara?"`, 'move', e.color);
      else log(`🛗 ${e.name} står still – ingen hissvärdinna`, 'move', e.color);
    }
    if (!on) e.attLeave = false;
  }
}

// ---------- Besluten ----------
/** fönsterputsaren: får gondolen användas just nu? ('' = ja) */
function gondolaOff() {
  if (windAt() > WIND_STOP * 0.8) return 'Blåsigt – gondolen hissas upp, väntar i personalrummet';
  if (S.hoist && S.hoist.phase !== 'idle') return 'Hissbalken har takskenan – väntar i personalrummet';
  if (S.move && S.move.state === 'on' && S.move.hoist && S.move.items.some(it => it.st === 'hatch' || it.st === 'hoist')) return 'Hissbalken behöver takskenan – väntar i personalrummet';
  return '';
}
/** varför personen inte ska vara på posten just nu ('' = hen ska vara där) */
function offReason(p, h) {
  const c = CREW_BY[p.crewId];
  if (c.post === 'chief' && S.chief && !S.chief.on) return 'Går på rast – du får ta besluten så länge';
  if (h < c.from) return `Hänger av sig jackan i personalrummet – passet börjar kl ${Math.floor(c.from)}`;
  if (c.post === 'gondola') return gondolaOff();
  return '';
}
/** den som tar över posten när c:s pass är slut (nattskiftet: dagskiftet som börjar kl 06) */
const relief = c => CREW.find(x => x !== c && x.post === c.post && x.from === (c.until ?? START_H)) || null;
/**
 * Mjukt dygnsskifte: nattskiftet går hem när dagskiftet har kommit, och dagskiftet (som annars sitter på posten
 * när dygnet börjar) kommer in genom entrén.
 */
export function crewRoll() {
  for (const p of S.people) if (p.crewId && CREW_BY[p.crewId].until === null) { p.shiftEnd = true; p.timer = Math.min(p.timer, CREW_LOOK); }
  for (const c of CREW) if (c.arrive === null && !crewPerson(c.id)) spawnCrew(c.id);
}
/** passet är slut? */
function shiftOver(p, h, busy) {
  const c = CREW_BY[p.crewId];
  if (c.post === 'terrace') return !S.move || S.move.state === 'done' || !S.move.hoist;
  // nattskiftet efter ett mjukt dygnsskifte: går när avlösaren är i huset (inte mitt i ett larm)
  if (p.shiftEnd) { const nx = relief(c); return (!nx || !!crewPerson(nx.id)) && !(busy && c.urgent); }
  return c.until !== null && h >= c.until && (!busy || !c.urgent || h >= c.until + 0.5);
}
/** får personen lämna posten just nu? fönsterputsaren måste först hissas upp till taket, och hissvärdinnan
 *  kör först hem korgen (hon kliver av i entrén när den står tom där) */
function mayLeave(p) {
  if (CREW_BY[p.crewId].post === 'grind' && atPost(p)) return grindFree(p);
  if (CREW_BY[p.crewId].post !== 'gondola' || !atPost(p)) return true;
  const C = S.cleaner;
  if (!C || C.parked) return true;
  if (!C.recall) { C.recall = true; pev(p, 'Hissar upp gondolen till taket'); }
  return false;
}
/**
 * Vart personen ska härnäst (som roleNext i people.js): posten, ett rastmål eller hem. Drar inga slumptal.
 * Returnerar [våning, varför] eller null (stanna).
 */
export function crewNext(p, h) {
  const c = CREW_BY[p.crewId], busy = alarm(), pf = postFloor(c.post);
  const ok = f => f >= 0 && !inFireZone(f);
  // (resor inom huset: entrén är personalens utgång, men dit går man också på rast – det är ingen hemgång)
  const there = (f, why) => (p.floor === f || !ok(f) ? null : [f, why, false]);
  if (shiftOver(p, h, busy)) {
    if (!mayLeave(p)) return null;
    const next = relief(c);
    return [p.exitFloor, c.post === 'terrace' ? 'Flytten är klar – åker med flyttbilen' : `Passet är slut${next ? ` – ${next.name} tar över` : ''}`];
  }
  // rasten är slut (eller larmet går för den som behövs i kontrollrummet)
  if (p.onBreak && ((busy && c.urgent) || S.t >= p.breakUntil)) {
    p.onBreak = false; p.breakWhere = '';
    pev(p, busy && c.urgent ? 'Larm! Rasten får vänta' : 'Rasten är slut');
  }
  if (p.onBreak) return there(WHERE_F[p.breakWhere] ?? BREAK, p.breakWhy);
  const off = offReason(p, h);
  if (off) {
    if (!mayLeave(p)) return null;
    return there(BREAK, off);
  }
  // en rast när det är lugnt (och den man täcker för sitter på sin post)
  const here = atPost(p);
  if (here && !busy) {
    const b = p.breaks.find(x => !x.done && h >= x.at);
    if (b && (!c.cover || manned(c.cover) || !CREW.some(x => x.post === c.cover && crewPerson(x.id)))) {
      if (!mayLeave(p)) return null;
      b.done = true;
      const to = WHERE_F[b.where] ?? BREAK;
      // (en rast som skjutits upp för länge, eller som skulle gå in i nästa skift, blir inte av)
      if (h < b.at + 1 && (c.until === null || h < c.until - 0.5) && ok(to)) {
        p.onBreak = true; p.breakUntil = S.t + b.len; p.breakWhy = b.why; p.breakWhere = b.where;
        return to === p.floor ? sitDown(p, to) : [to, b.why, false];
      }
    } else if (b && h >= b.at + 1) b.done = true;
  }
  if (here) return null;
  // posten är upptagen (skiftbytet: den andra har inte gått än), eller det brinner där: vänta
  const spot = postSpot(c.post);
  const taken = !spot || (occOf(spot) !== null && occOf(spot) !== p.id);
  if (taken || !ok(pf)) return p.floor === BREAK || p.floor === LOBBY || !ok(BREAK) ? null : [BREAK, 'Väntar i personalrummet på att få ta över', false];
  // på våningen men inte på posten (stod och väntade): sätt dig
  if (p.floor === pf) return sitDown(p, pf);
  return [pf, busy && c.urgent ? 'Larm! Skyndar tillbaka till kontrollrummet' : `Tillbaka till jobbet${p.floor === BREAK ? '' : ` på ${c.post === 'gondola' ? 'taket' : 'posten'}`}`, false];
}
/** byt plats på samma våning (från posten till rastmålet eller tvärtom) */
function sitDown(p, f) {
  releaseSpot(p); p.state = 'exiting'; gotoSpot(p, f);
  pev(p, p.spot.desc);
  return null;
}
