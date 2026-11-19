// Husets personal: driftcheferna, bildproducenterna, receptionisten och kvällsvärden, fönsterputsaren och lastaren (CREW i config).
// Var och en är en person i huset med en egen post (en plats i SPOTS med post), ett skift och raster på bestämda
// ställen (personalrummet, Sky Café, takträdgården, kiosken, godisautomaten, perrongen). Raster tas bara när det är
// lugnt; den som är "urgent" (kontrollrummet) skyndar tillbaka när larmet går, och den som ska täcka för någon
// (cover) går inte förrän den andra sitter på sin post. Allt här är simulering och drar inga slumptal.
import { BREAK, CAFE, CONTROL, CREW, DOCK, LOBBY, ROOF, SPOTS, START_H, STATION, TERRACE_F } from './config.js';
import { S, hour, log, occOf } from './state.js';
import { blankPerson, gotoSpot, pev, pn, releaseSpot, setTrip } from './people.js';
import { inFireZone } from './dispatch.js';
import { windAt } from './weather.js';
import { WIND_STOP } from './hoist.js';
import { visningSpot } from './visning.js';
/** @typedef {import('./people.js').Person} Person */

/** @typedef {import('./config.js').CrewDef} CrewDef */
/** hur ofta (rumstid, se activityRate) personalen tittar upp: rast, larm, skiftbyte */
export const CREW_LOOK = 3;
/** personalens data efter id */
export const CREW_BY = Object.fromEntries(CREW.map(c => [c.id, c]));
/** postens våning */
const POST_F = { chief: CONTROL, producer: CONTROL, reception: LOBBY, gondola: ROOF, terrace: TERRACE_F };
/** rastmålens våningar */
const WHERE_F = { break: BREAK, cafe: CAFE, roof: ROOF, kiosk: STATION, vending: LOBBY, platform: STATION, dock: DOCK };
export const postFloor = post => POST_F[post] ?? -1;
export const postSpot = post => { const f = postFloor(post); return f >= 0 ? SPOTS[f].find(s => s.post === post) || null : null; };
/** något som kontrollrummet är mitt uppe i (larmljuset snurrar, ingen där fikar) */
export const alarm = () => !!(S.fire || S.outage || S.storm || S.warn
  || S.elevators.some(e => e.mode === 'snapped' || e.hot || (e.mode === 'broken' && e.fault && e.fault.trapped)));
/** personen ur personalen med id, om hen är i huset */
export const crewPerson = id => S.people.find(p => p.crewId === id && !p.dead) || null;
/** sitter p på sin post just nu? @param {Person} p */
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
 *  annars stående i hallen. Drar inga slumptal. @param {Person} p */
export function crewSpot(p, f) {
  const c = CREW_BY[p.crewId], mine = s => occOf(s) === null || occOf(s) === p.id;
  // (guiden på rundvisning står med gästen i hallen, visning.js)
  const vs = p.touring ? visningSpot(p, f) : null;
  if (vs) return vs;
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

// ---------- Besluten ----------
/** fönsterputsaren: får gondolen användas just nu? ('' = ja) */
function gondolaOff() {
  if (windAt() > WIND_STOP * 0.8) return 'Blåsigt – gondolen hissas upp, väntar i personalrummet';
  if (S.hoist && S.hoist.phase !== 'idle') return 'Hissbalken har takskenan – väntar i personalrummet';
  if (S.move && S.move.state === 'on' && S.move.hoist && S.move.items.some(it => it.st === 'hatch' || it.st === 'hoist')) return 'Hissbalken behöver takskenan – väntar i personalrummet';
  return '';
}
/** varför personen inte ska vara på posten just nu ('' = hen ska vara där) @param {Person} p */
function offReason(p, h) {
  const c = CREW_BY[p.crewId];
  if (c.post === 'chief' && S.chief && !S.chief.on) return 'Går på rast – du får ta besluten så länge';
  // (nattskiftet efter ett mjukt dygnsskifte sitter kvar på posten tills avlösaren är i huset)
  if (h < c.from && !(p.shiftEnd && !relieved(c))) return `Hänger av sig jackan i personalrummet – passet börjar kl ${Math.floor(c.from)}`;
  if (c.post === 'gondola') return gondolaOff();
  return '';
}
/** den som tar över posten när c:s pass är slut (nattskiftet: dagskiftet som börjar kl 06, annars den första som
 *  kommer på morgonen – kvällsvärden lämnar receptionen till Berit) */
const relief = c => {
  const same = CREW.filter(x => x !== c && !x.sub && x.post === c.post);
  return same.find(x => x.from === (c.until ?? START_H))
    || (c.until === null ? same.filter(x => x.until !== null).sort((a, b) => a.from - b.from)[0] : null) || null;
};
/**
 * Mjukt dygnsskifte: nattskiftet går hem när dagskiftet har kommit, och dagskiftet (som annars sitter på posten
 * när dygnet börjar) kommer in genom entrén.
 */
export function crewRoll() {
  for (const p of S.people) if (p.crewId && CREW_BY[p.crewId].until === null && !CREW_BY[p.crewId].sub) { p.shiftEnd = true; p.timer = Math.min(p.timer, CREW_LOOK); }
  for (const c of CREW) if (c.arrive === null && !crewPerson(c.id)) spawnCrew(c.id);
}
/** någon annan på vikariens post har passet och är i huset (inte ute och visar runt) */
const deskRelief = (c, h) => CREW.some(x => x !== c && !x.sub && x.post === c.post && h >= x.from && h < (x.until ?? 31)
  && (q => !!q && !q.touring && !q.shiftEnd)(crewPerson(x.id)));
/** är c:s avlösare i huset (eller har c ingen)? */
const relieved = c => { const nx = relief(c); return !nx || !!crewPerson(nx.id); };
/** passet är slut? @param {Person} p */
function shiftOver(p, h, busy) {
  const c = CREW_BY[p.crewId];
  if (c.post === 'terrace') return !S.move || S.move.state === 'done' || !S.move.hoist;
  // vikarien går när hon inte behövs längre: rundvisningen är slut (visning.js), eller nästa skift i receptionen har
  // kommit medan guiden fortfarande är ute (kvällsvärden visar runt när Berit kommer på morgonen)
  if (c.sub) return !S.visning || S.visning.ph === 'done' || deskRelief(c, h);
  // nattskiftet efter ett mjukt dygnsskifte: går när avlösaren är i huset (inte mitt i ett larm)
  if (p.shiftEnd) return relieved(c) && !(busy && c.urgent);
  return c.until !== null && h >= c.until && (!busy || !c.urgent || h >= c.until + 0.5);
}
/** den vikarien har vikarierat för: guiden på rundvisningen (visning.js) */
const subFor = () => { const id = S.visning ? S.visning.host : -1, g = S.people.find(q => q.id === id); return g ? g.name : 'Receptionisten'; };
/** får personen lämna posten just nu? fönsterputsaren måste först hissas upp till taket @param {Person} p */
function mayLeave(p) {
  if (CREW_BY[p.crewId].post !== 'gondola' || !atPost(p)) return true;
  const C = S.cleaner;
  if (!C || C.parked) return true;
  if (!C.recall) { C.recall = true; pev(p, 'Hissar upp gondolen till taket'); }
  return false;
}
/**
 * Vart personen ska härnäst (som roleNext i people.js): posten, ett rastmål eller hem. Drar inga slumptal.
 * Returnerar [våning, varför] eller null (stanna).
 * @param {Person} p
 */
export function crewNext(p, h) {
  const c = CREW_BY[p.crewId], busy = alarm(), pf = postFloor(c.post);
  // (guiden på rundvisning: rundvisningen bestämmer vart hen går, visning.js; under kuppen sitter personalen still)
  if (p.touring || (S.heist && S.heist.tied)) return null;
  const ok = f => f >= 0 && !inFireZone(f);
  // (resor inom huset: entrén är personalens utgång, men dit går man också på rast – det är ingen hemgång)
  const there = (f, why) => (p.floor === f || !ok(f) ? null : [f, why, false]);
  if (shiftOver(p, h, busy)) {
    if (!mayLeave(p)) return null;
    const next = relief(c);
    return [p.exitFloor, c.post === 'terrace' ? 'Flytten är klar – åker med flyttbilen' : c.sub ? `${subFor()} är tillbaka – tackar för sig och går` : `Passet är slut${next ? ` – ${next.name} tar över` : ''}`];
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
/** byt plats på samma våning (från posten till rastmålet eller tvärtom) @param {Person} p */
function sitDown(p, f) {
  releaseSpot(p); p.state = 'exiting'; gotoSpot(p, f);
  pev(p, p.spot.desc);
  return null;
}
