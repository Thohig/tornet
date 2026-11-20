// Rundvisningen: den som sitter i receptionen visar en gäst runt i huset, i det dygn som pågår – receptionisten
// Berit på dagen och kvällsvärden Yvonne på kvällen och natten (guide i CREW). Spelaren beställer den
// (act('visning', 'start')); guiden ringer bemanningen och vikarien Kicki tar över receptionen – även larmen – medan
// guiden och gästen går rutten: entrén, driftcentralen, perrongen, Sky Café, takterrassen och tillbaka. Stoppen är
// platser, inte klockslag, och guiden berättar om det som händer där just nu. Händer något i huset under tiden lägger
// hon om rutten dit (aldrig in i brandzonen) och fortsätter sedan där hon var. Läget ligger i S.visning; guiden, gästen
// och Kicki är personer i huset. Drar inga slumptal – allt bestäms av huset och spelaren. Repliken i S.visning.line
// läses upp och visas av gränssnittet (intro.js).
import { CAFE, CONTROL, CREW, DOCK, DOOR_X, FL, FLOOR_HOURS, LOBBY, ROOF, STATION, BUILDING, floorOpen } from './config.js';
import { S, dayEvent, hour, log, notice } from './state.js';
import { blankPerson, pev, releaseSpot, setTrip, spawnStaff } from './people.js';
import { inFireZone } from './dispatch.js';
import { speak } from './cast.js';
import { CREW_BY, alarm, atPost, crewPerson, spawnCrew } from './crew.js';
import { chiefNote, chiefOnDuty } from './chief.js';
import { nextTrainMin } from './train.js';
import { techOf } from './service.js';
import { detours } from './systems.js';
import { fl } from './util.js';
/** @typedef {import('./people.js').Person} Person */
/** @typedef {import('./elevators.js').Elevator} Elevator */

/** hur många timmar före passets slut guiden senast börjar en rundvisning (Berit: kl 17.15, passet slutar kl 19) */
const TOUR_H = 1.75;
/** de som ger rundvisningar (Berit och kvällsvärden) */
const GUIDES = CREW.filter(c => c.guide);
/** sista timmen c börjar en rundvisning (den som går hela natten: dygnets slut) @param {import('./config.js').CrewDef} c */
const lastStart = c => (c.until === null ? 31 : c.until - TOUR_H);
/** Den som visar runt härnäst vid klockan h: den som har passet nu (och hinner), annars den som börjar härnäst.
 *  @returns {import('./config.js').CrewDef} */
export function nextGuide(h) {
  return GUIDES.find(c => h >= c.from && h < lastStart(c)) || GUIDES.filter(c => c.from > h).sort((a, b) => a.from - b.from)[0]
    || [...GUIDES].sort((a, b) => a.from - b.from)[0];
}
/** kan p lämna det hen gör och gå med på en rundvisning (i huset, inte på väg hem, inte utrymd)? @param {Person} p */
const free = p => !!p && !p.dead && p.state !== 'away' && !p.leaving && !p.evac && p.state !== 'assembly' && !p.hero && !p.hostage;
/** Guiden som kan börja nu, eller null. Beställd: den som sitter i receptionen (inte den som snart går hem).
 *  Framkallad (now): även den som har rast – och finns ingen av dem i huset tar väktaren eller driftchefen den. */
function guideNow(h, now = false) {
  for (const c of GUIDES) {
    const p = crewPerson(c.id);
    if (p && atPost(p) && !p.shiftEnd && h < lastStart(c)) return p;
  }
  if (!now) return null;
  const inHouse = GUIDES.map(c => crewPerson(c.id)).filter(free);
  return inHouse.find(p => !p.shiftEnd) || inHouse[0] || null;
}
/** Ingen guide i huset: väktaren (han har nycklarna och går ändå runt) eller driftchefen som har passet */
function standIn() {
  const guard = S.people.find(p => p.role === 'väktare' && !p.crewId && free(p));
  if (guard) return { p: guard, why: 'Berit och kvällsvärden är inte i huset – väktaren går ändå runt i huset och har alla nycklar' };
  const c = chiefOnDuty(), chief = crewPerson(c.id);
  if (free(chief)) return { p: chief, why: 'ingen receptionist eller väktare i huset – chefen tar den själv och har skärmarna i telefonen' };
  return null;
}
/** behöver guiden en vikarie i receptionen (Berit och kvällsvärden – inte väktaren eller chefen)? @param {Person} p */
const needsSub = p => !!p.crewId && CREW_BY[p.crewId].post === 'reception';
/** guidens namn (under rundvisningen den som visar runt, annars den som gör det härnäst) */
export const guideName = () => { const p = S.visning && S.people.find(q => q.id === S.visning.host); return p ? p.name : nextGuide(hour()).name; };

// ---------- Nycklarna: stängda stopp låses upp ----------
/** Ett stopp som har stängt (takterrassen, Sky Café, perrongen när tågen inte går) låses upp åt rundvisningen av
 *  den som har nycklarna: vaktmästaren, väktaren eller – finns ingen av dem i huset – jourvaktmästaren som rings in.
 *  ph: come (på väg) → open (upplåst – gallret är uppe, bara för gruppen) */
/** @typedef {{ f: number, by: number, who: string, ph: string }} Unlock */
/** har stoppet på våning f stängt just nu? */
export function closedStop(f, h = hour()) {
  if (f < 0) return false;
  if (FLOOR_HOURS[f] && !floorOpen(f, h)) return true;
  return f === STATION && nextTrainMin() === null;
}
/** våningen som är upplåst åt rundvisningen just nu (gallret ritas inte där), annars -1 */
export const unlockedFloor = () => (S.visning && S.visning.unlock && S.visning.unlock.ph === 'open' ? S.visning.unlock.f : -1);
const placeName = f => (f === ROOF ? 'takterrassen' : f === STATION ? 'spärrarna till perrongen' : f === CAFE ? 'Sky Café' : FL[f].name);
/** den som har nycklarna och kan komma (inte guiden själv om det finns någon annan) */
function keyHolder(v) {
  for (const role of ['vaktmästare', 'väktare']) {
    const p = S.people.find(q => q.role === role && !q.crewId && q.id !== v.host && free(q) && (q.keys === undefined || q.keys === null));
    if (p) return p;
  }
  return null;
}
/** stoppet på våning f har stängt: ring den som har nycklarna. Returnerar vad guiden säger. */
function startUnlock(v, f) {
  const b = byId(v.host);
  // (väktaren som guidar har nycklarna själv)
  if (b && b.role === 'väktare' && !b.crewId) { v.unlock = { f, by: b.id, who: b.name, ph: 'open' }; return `${cap(placeName(f))} har stängt – men jag har nycklarna.`; }
  let k = keyHolder(v), called = false;
  // (jourvaktmästaren: uppdraget finns redan när hen kliver in, så att första resan går dit – keyNext)
  v.unlock = { f, by: k ? k.id : -1, who: k ? k.name : '', ph: 'come' };
  if (!k) { k = spawnStaff('vaktmästare', false, { keys: f, jour: true, title: 'Jourvaktmästare (inringd med nycklarna)' }); called = true; }
  k.keys = f; v.unlock.by = k.id; v.unlock.who = k.name;
  if (k.state === 'office') k.timer = 0;
  pev(k, `Ska låsa upp ${placeName(f)} åt rundvisningen`);
  log(`🔑 ${k.name} (${called ? 'jourvaktmästare' : k.role}) låser upp ${placeName(f)} åt rundvisningen`, 'person', null, k.id);
  return called ? `${cap(placeName(f))} har stängt nu – jag ringer jourvaktmästaren, som har nycklarna.`
    : `${cap(placeName(f))} har stängt nu – jag ringer ${k.name}, som har nycklarna.`;
}
/** gruppen går vidare: nyckelbäraren låser efter dem och återgår till det hen gjorde */
function relock(v) {
  const u = v.unlock;
  if (!u) return;
  v.unlock = null;
  const k = byId(u.by);
  if (!k || k.id === v.host) return;
  k.keys = null;
  if (u.ph === 'open') speak(k, 'Då låser jag efter er!');
  if (k.state === 'office') k.timer = 0;
}
/** vart nyckelbäraren ska (roleNext i people.js): till stoppet, och stå kvar tills gruppen har gått vidare.
 *  undefined = inget uppdrag längre (vanliga sysslor). @param {Person} p */
export function keyNext(p) {
  const u = S.visning && S.visning.unlock;
  if (u && u.by === -1 && p.keys === u.f) u.by = p.id;
  if (!u || u.by !== p.id) { p.keys = null; return undefined; }
  if (p.floor !== u.f) return [u.f, `Låser upp ${placeName(u.f)} åt rundvisningen`, false];
  return null;
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
/** hur länge (verkliga sekunder) innan vikarien kliver in i entrén efter samtalet */
const KICKI_S = 20;
/** hur länge guiden pratar vid ett stopp: ord per sekund (uppläst) och minst så här många sekunder */
const WPS = 2.4, STAY_MIN = 9;
/** längst tid en förflyttning får ta innan guiden ger upp och går vidare (verkliga sekunder) */
const GO_MAX = 260;
/** hur länge de stannar vid en händelse (verkliga sekunder, minst) och längst (om den inte är över) */
const DETOUR_MIN = 22, DETOUR_MAX = 90;
/** högst så här många omvägar på en rundvisning – sedan blir det rutten */
const DETOURS = 3;

/**
 * Rundvisningen (S.visning). ph: order (beställd, väntar på guiden) → call (ringer vikarien) → swap (väntar på Kicki)
 * – now = framkallad (börjar direkt, guiden avbryter rasten), sub = Kicki behövs i receptionen –
 * → go/at (på väg till / vid ett stopp) → done (slut: Kicki går hem, guiden sätter sig). stop = stoppet (index i
 * STOPS) eller händelsen (detour) som gruppen är på väg till eller står vid; line/lineN = guidens replik.
 * @typedef {{ ph: string, t0: number, host: number, guest: number, kicki: number, si: number, goT: number, stay: number,
 *   callAt: number, callUntil: number, now: boolean, sub: boolean, unlock: Unlock|null, detour: Detour|null, seen: string[], seenStops: string[], line: string, lineN: number,
 *   lineK: string, focus: string[], spot: string[], log: string[], ended: string, kickiSaid: boolean, paused: boolean }} Visning
 */
/** En händelse som guiden lägger om rutten för: oj = vad hon utbrister, hold = stanna tills den är över (brand,
 *  strömavbrott – då går ändå inga hissar) @typedef {{ k: string, f: number, title: string, oj: string, there: () => string, over: () => boolean, missed: string, hold: boolean, at: boolean, t: number }} Detour */

/**
 * Rutten. f = våningen (eller -1 = finns inte i huset), text = vad guiden säger där (läser av huset just nu),
 * way = vad hon säger på väg dit, focus/spot = panelens block som lyfts fram och det som blinkar (bara gränssnitt).
 * @typedef {{ k: string, title: string, f: () => number, way: () => string, text: () => string, focus?: string[], spot?: string[] }} Stop
 */
/** @type {Stop[]} */
export const STOPS = [
  { k: 'entre', title: 'Entrén', f: () => LOBBY, way: () => '',
    text: () => `Välkommen till Tornet! Det här är entrén – karuselldörren, receptionen och rulltrappan upp till mellanplanet. Här finns inga hissknappar: man säger vart man ska, och Hiss-O-Matic 3000 ger en en egen hiss. Bubblan över huvudet visar målet och hissen. ${BUILDING.elevators.length} hissar, ${FL.length} våningar – ${V() && V().sub ? `och i dag sköter ${kickiName()} disken medan jag visar dig runt.` : 'och i dag är det jag som visar dig runt.'}`,
    focus: ['follow'] },
  { k: 'drift', title: 'Driftcentralen', f: () => CONTROL, way: () => 'Först ner till driftcentralen på P1 – hjärtat i huset.',
    text: () => driftText(), spot: ['#lower'] },
  { k: 'perrong', title: 'Perrongen', f: () => STATION, way: () => 'Nu går vi ner till tunnelbanan. Hissarna i låga zonen och expressen X1 går ända ner.',
    text: () => perrongText() },
  { k: 'sky', title: 'Sky Café', f: () => CAFE, way: () => 'Upp till sky lobbyn på 6:an! Expressen går raka vägen – där byter man till H-hissarna i höga zonen.',
    text: () => skyText(), focus: ['strat'] },
  { k: 'tak', title: 'Takterrassen', f: () => ROOF, way: () => 'Sista biten upp till taket – H-hissarna går ända upp.',
    text: () => takText(), focus: ['trig'] },
  { k: 'slut', title: 'Tillbaka i entrén', f: () => LOBBY, way: () => 'Nu åker vi ner till entrén igen.',
    text: () => slutText(), focus: ['trig', 'strat', 'links'] },
];

const kickiName = () => CREW_BY.kicki.name;
const V = () => S.visning;
const byId = id => S.people.find(p => p.id === id && !p.dead) || null;
/** alla i gruppen: guiden och gästen (de som finns kvar) */
const group = v => [byId(v.host), byId(v.guest)].filter(p => p);
/** framme på våning f (den som har utrymts vid brand och står på återsamlingsplatsen utanför entrén räknas) @param {Person} p */
const there = (p, f) => p.floor === f && ((p.state === 'office' && !p.evac) || p.state === 'assembly');
/** går rundvisningen just nu (guiden är ute med gästen)? */
export const touring = () => !!S.visning && (S.visning.ph === 'go' || S.visning.ph === 'at');
/** är p guiden eller gästen under en rundvisning? @param {Person} p */
export const onTour = p => touring() && (p.id === S.visning.host || p.id === S.visning.guest);

/** ny replik (gränssnittet läser upp den) */
function line(v, text, k = '') {
  v.line = text; v.lineN++; v.lineK = k;
  const b = byId(v.host);
  if (b) speak(b, short(text));
}
/** första meningen (pratbubblan i bilden); hela repliken står i panelen */
const short = t => { const m = t.match(/^.*?[.!?…](\s|$)/); const s = (m ? m[0] : t).trim(); return s.length > 70 ? `${s.slice(0, 67)}…` : s; };
/** hur länge guiden pratar (verkliga sekunder) */
const talkS = t => Math.max(STAY_MIN, t.split(/\s+/).length / WPS + 3);

// ---------- Texterna vid stoppen: det som händer just nu ----------
function driftText() {
  const c = chiefOnDuty(), last = S.chief && S.chief.log.filter(d => !d.info).slice(-1)[0];
  const why = last ? last.why.charAt(0).toLowerCase() + last.why.slice(1) : '';
  const said = last ? ` Senast bestämde hen: "${last.text}" – ${why}` : ' I dag har hen inte behövt bestämma något stort än – men skärmarna har hen koll på.';
  const away = S.chief && !S.chief.on ? ' Fast just nu har du tagit över besluten själv – chefen fikar.' : '';
  return `Här sitter ${c.name}, driftchefen. När något händer – brand, storm, strömavbrott – bestämmer hen och säger varför; det står på skylten längst ner i bilden.${said}.${away} Bredvid sitter bildproducenten som klipper bilden när regissören 🎬 är på.`.replace('..', '.');
}
function perrongText() {
  const m = nextTrainMin();
  const now = S.train && S.train.state === 'stop' ? 'Titta – tåget står inne just nu, och en hel klump folk kliver av på en gång. Då får hissarna brått!'
    : S.train ? 'Hör du? Tåget är på väg in.' : m === null ? 'Tunnelbanan har stängt för natten, men i morgon bitti går tågen tätt igen.'
      : `Nästa tåg kommer om ungefär ${m} minuter. När det stannar kliver en hel klump folk av på en gång – då får hissarna brått.`;
  return `Under huset ligger tunnelbanan. ${now} Expressen X1 och panoramahissen går ända ner hit, så man kan åka från perrongen direkt upp till taket.`;
}
function skyText() {
  const open = floorOpen(CAFE, hour());
  const n = S.people.filter(p => p.floor === CAFE && p.state === 'office' && !p.crewId && !onTour(p)).length;
  const cafe = open ? (n > 2 ? `Sky Café har ${n} gäster just nu – kanelbullarna är kända i hela stan.` : 'Sky Café är nästan tomt just nu – passa på!') : 'Sky Café har stängt för i dag, men utsikten är gratis.';
  return `Det här är sky lobbyn på 6:an. Hissarna har zoner: L-hissarna går i den låga zonen och H-hissarna i den höga – staplade i samma schakt! Den som ska mellan zonerna byter hiss här. ${cafe} Under Styrning kan du välja hur hissarna tänker.`;
}
function takText() {
  const w = S.storm ? ' Håll i dig – det blåser rejält i dag!' : '';
  const heli = S.heli ? ' Och där – en helikopter på väg ner!' : '';
  const hasse = S.cleaner && !S.cleaner.parked ? ' Där nere hänger Hasse i gondolen och putsar fönster.' : '';
  return `Takterrassen! Härifrån ser man hela stan.${w}${heli}${hasse} Under Framkalla kan du själv ställa till med något: brand, storm, ett hissfel, en flyttbil … Huset sköter sig ändå.`;
}
function slutText() {
  const n = V() ? V().seen.length : 0;
  const ev = n ? ` Och du fick se ${n === 1 ? 'en riktig händelse' : `${n} riktiga händelser`} på köpet!` : '';
  return `Det var allt – tack för sällskapet!${ev} Huset sköter sig självt, så luta dig tillbaka och titta, eller ställ till det lite. Vill du gå runt igen frågar du bara mig. Välkommen åter!`;
}

// ---------- Händelserna som guiden lägger om rutten för ----------
/** brand, storm, strömavbrott, hissfel … som pågår och som guiden kan visa just nu (första som passar). urgent = bara
 *  det som inte kan vänta (brand, strömavbrott, kuppen): guiden pratar klart vid stoppet först. @returns {Detour|null} */
function happening(v, here, urgent) {
  const mk = (k, f, title, oj, txt, over, missed, hold = false) => ({ k, f, title, oj, there: txt, over, missed, hold, at: false, t: S.t });
  /** @type {Detour[]} */
  const list = [];
  if (S.fire) {
    const F = S.fire;
    list.push(mk(`fire:${F.t0}`, LOBBY, 'Brandlarm', 'Brandlarm! Lugnt – vi går ner till entrén, som alla andra',
      () => `Här ute är vi säkra. Larmet ${F.mode === 'recall' ? 'återkallade alla hissar – de står i entrén med dörrarna öppna, så alla tar trappan' : F.mode === 'zone' ? 'gjorde brandzon: hissarna går bara under branden' : 'gick, men hissarna kör som vanligt'}. Varuhissen blir brandhiss när brandkåren kommer, och ${kickiName()} visar ut folk genom entrén. Ingen går in dit det brinner.`,
      () => !S.fire, 'Brandlarmet hann tystna innan vi kom ut – skönt!', true));
  }
  const heist = S.heist;
  if (heist && heist.ph !== 'done') list.push(mk(`heist:${heist.t0}`, -2, 'Kuppen', '', () => '', () => !heist || heist.ph === 'done', ''));
  if (S.storm) {
    list.push(mk(`storm:${S.storm.t0}`, CONTROL, 'Stormen', 'Hör du hur det viner? Det blir storm – kom, vi går till driftcentralen',
      () => `Nu ska du se på ${chiefOnDuty().name}. I storm svajar tornet, och linorna slår i schakten. ${S.storm.mode === 'sway' ? 'Hissarna går i svajläge – långsamt, och de högsta stannar.' : 'Än så länge kör hissarna som vanligt – men det är chefen som bestämmer om de ska gå i svajläge.'}`,
      () => !S.storm, 'Stormen bedarrade innan vi kom fram.'));
  }
  if (S.outage) {
    list.push(mk(`power:${S.outage.t0}`, here, 'Strömavbrott', 'Oj, mörkt! Strömmen gick',
      () => `Oj – strömmen gick! Hissarna står still, och den som sitter i en korg får vänta. Reservkraften startar, och sedan kör hissarna ner till närmaste våning en i taget. ${S.outage.gen ? 'Där – reservkraften är igång!' : 'Det tar en liten stund.'}`,
      () => !S.outage, '', true));
  }
  for (const e of S.elevators) {
    const stuck = e.mode === 'snapped' || (e.mode === 'broken' && e.fault && (e.fault.trapped || e.fault.cable));
    if ((e.mode !== 'broken' && e.mode !== 'snapped') || (e.fault && e.fault.pano)) continue; // (panoramahissen på fasaden: se nedan)
    const f = e.mode === 'snapped' && e.snap ? e.snap.exitF : nearStop(e);
    const tech = techOf(e);
    list.push(mk(`car:${e.id}:${e.fault ? e.fault.t0 : e.snap ? e.snap.t0 : 0}`, f, `${e.name} står still`, `Oj – ${e.name} har stannat${stuck ? ' med folk i' : ''}! Kom, vi går och tittar`,
      () => e.mode === 'snapped' ? `Det här händer nästan aldrig: linorna i ${e.name} gick av! Fångapparaten tog tag, och nu kryper de instängda ut genom takluckan.`
        : `${e.name} har krånglat${stuck ? ' – och det sitter folk i den' : ''}. ${tech ? `Där är ${tech.name}, hissteknikern – hen lagar den.` : 'Hisstekniker är på väg.'} Det står i panelen vad som är fel och när den går igen.`,
      () => e.mode !== 'broken' && e.mode !== 'snapped', `${e.name} hann bli lagad innan vi kom dit – snabbt jobbat!`));
  }
  // (incidenterna i registret: panoramahissen på fasaden … – systems.js)
  for (const d of detours(here)) list.push(mk(d.k, d.f, d.title, d.oj, d.there, d.over, d.missed, !!d.hold));
  if (S.move && S.move.state === 'on' && DOCK >= 0) {
    list.push(mk(`move:${S.move.at}`, DOCK, 'Flyttdag', 'Flyttbilen är här! Kom, vi tittar till lastkajen',
      () => 'Flyttdag! Bärarna kör varuhissen i oberoende drift – den tar inga andra så länge. Stora möbler kan få åka hissbalken från taket.',
      () => !S.move || S.move.state !== 'on', ''));
  }
  // (flytten är ingen incident: en gång per rundvisning, och bara om inget annat har hänt)
  const minor = k => k.startsWith('move:');
  return list.find(d => !v.seen.includes(d.k) && (d.f === -2 || (d.f >= 0 && !inFireZone(d.f)))
    && (!urgent || d.hold || d.f === -2) && (!minor(d.k) || !v.seen.length)) || null;
}
/** närmaste hållplats där en trasig hiss står (dit man kan gå och titta) @param {Elevator} e */
function nearStop(e) {
  const p = Math.round(e.pos);
  let best = LOBBY, d = 1e9;
  for (const f of e.serves) if (Math.abs(f - p) < d) { d = Math.abs(f - p); best = f; }
  return best;
}

// ---------- Spelarens åtgärder ----------
/** Beställ en rundvisning. Returnerar false om en redan pågår. */
export function orderVisning(now = false) {
  // (en beställd rundvisning som väntar kan framkallas: då börjar den direkt)
  if (S.visning && now && S.visning.ph === 'order' && !S.visning.now) { S.visning.now = true; return true; }
  if (S.visning) return false;
  S.visning = { ph: 'order', t0: S.t, host: -1, guest: -1, kicki: -1, si: 0, goT: 0, stay: 0, callAt: 0, callUntil: 0,
    now, sub: false, unlock: null, detour: null, seen: [], seenStops: [], line: '', lineN: 0, lineK: '', focus: [], spot: [], log: [], ended: '', kickiSaid: false, paused: false };
  const h = hour(), soon = startable(h), c = nextGuide(h);
  if (now) {
    log('🛎️ Rundvisning framkallad – den som kan tar den direkt', 'sys');
    return true;
  }
  const when = soon ? 'Hon ringer efter en vikarie till disken och börjar sedan.' : h < c.from ? `Hon börjar när hon kommer till disken kl ${Math.floor(c.from)}.`
    : 'Hon börjar så fort hon sitter i receptionen.';
  notice('visning', '🛎️ Rundvisning beställd', `${c.name} visar runt. ${when}`, { floor: LOBBY });
  log(`🛎️ En rundvisning är beställd hos ${c.name} i receptionen`, 'sys');
  return true;
}
/** Gå vidare till nästa stopp (guiden slutar prata) */
export function nextVisning() {
  const v = V();
  if (!v) return;
  if (v.ph === 'at') v.stay = 0;
}
/** Avsluta: tillbaka till entrén (eller avbeställ en rundvisning som inte har börjat) */
export function endVisning() {
  const v = V();
  if (!v) return;
  if (v.ph === 'order') { S.visning = null; log('🛎️ Rundvisningen avbeställdes', 'sys'); return; }
  if (v.ph === 'call' || v.ph === 'swap') { finish(v, 'avbeställd'); return; }
  if (v.ph !== 'go' && v.ph !== 'at') return;
  v.detour = null;
  v.si = STOPS.length - 1;
  v.ended = 'avslutad';
  toStop(v, 'Då går vi tillbaka till entrén.');
}

// ---------- Förloppet ----------
/** kan guiden börja just nu? */
function startable(h, now = false) {
  // (förra gästen är fortfarande på väg ut: nästa får vänta en stund)
  if (S.people.some(p => p.guest && !p.dead)) return false;
  return !!(guideNow(h, now) || (now && standIn())) && !S.fire && !alarmHeist();
}
const alarmHeist = () => !!S.heist && S.heist.ph !== 'done';
/** gästen kliver in i entrén */
function spawnGuest() {
  const g = blankPerson('vis', LOBBY, -40, { name: 'Gästen', look: { skin: '#ffdbb8', shirt: '#ffffff', pants: '#2b2d6e', hair: 0, hairC: '#5a3412', tie: true, tieC: '#2a5db0', stripe: false, acc: 3 },
    walkPhase: 1, speedMul: 1, depth: -2, patience: 30, kg: 75, fit: 0, space: 9, polite: true });
  g.guest = true; g.touring = true; g.title = 'Gäst på rundvisning (du)';
  S.people.push(g);
  setTrip(g, LOBBY, `Rundvisning med ${guideName()}`, false);
  pev(g, `Kliver in i entrén · ska gå på rundvisning med ${guideName()}`);
  return g;
}
/** guiden och gästen går till stoppet (eller händelsen) – de som redan är där står kvar */
function toStop(v, say) {
  const d = v.detour, st = STOPS[v.si];
  const f = d ? d.f : st.f();
  v.ph = 'go'; v.goT = 0;
  // nästa ställe: nyckelbäraren låser efter oss – och har nästa stopp stängt ringer guiden efter nycklarna
  if (v.unlock && v.unlock.f !== f) relock(v);
  if (!d && !v.unlock && f >= 0 && !inFireZone(f) && closedStop(f)) say = `${say ? `${say} ` : ''}${startUnlock(v, f)}`;
  for (const p of group(v)) {
    if (p.evac || p.state === 'assembly') continue;
    if (there(p, f) && p.spot && p.spot.temp && p.spot.tour) continue;
    if (p.state !== 'office' && p.goal === f) continue; // (redan på väg dit)
    // (den som är på väg någonstans – i en hiss, i trappan, i kön – får det nya målet när hen är framme)
    if (p.state !== 'office') continue;
    p.x = p.spot ? p.spot.x : p.x;
    releaseSpot(p);
    setTrip(p, f, d ? `Rundvisning: ${d.title}` : `Rundvisning: ${st.title}`, false);
  }
  if (say) line(v, say, d ? `way:${d.k}` : `way:${st.k}`);
}
/** gruppen är framme: guiden berättar */
function arrived(v) {
  const d = v.detour;
  v.ph = 'at';
  if (d) {
    d.at = true;
    const txt = d.there();
    line(v, txt, `at:${d.k}`);
    v.stay = Math.max(talkS(txt), DETOUR_MIN);
    v.log.push(d.title);
    v.focus = ['events', 'follow']; v.spot = [];
    log(`🛎️ Rundvisningen: ${guideName()} visar ${d.title.toLowerCase()}`, 'person', null, v.host);
    return;
  }
  const st = STOPS[v.si], u = v.unlock && v.unlock.f === st.f() && v.unlock.ph === 'open' ? v.unlock : null;
  const txt = (u && u.by !== v.host ? `Tack, ${u.who}, för att du låste upp! ` : '') + st.text();
  v.seenStops.push(st.k);
  line(v, txt, `at:${st.k}`);
  v.stay = talkS(txt);
  v.focus = st.focus || []; v.spot = st.spot || [];
  log(`🛎️ Rundvisningen: ${st.title} (${fl(st.f())})`, 'person', null, v.host);
}
/** nästa stopp på rutten (hoppar över dem som inte finns just nu) */
function nextStop(from) {
  let i = from;
  while (i < STOPS.length - 1 && STOPS[i].f() < 0) i++;
  return i;
}
/** rundvisningen är slut: gästen går, guiden tillbaka till disken, Kicki går hem när guiden sitter */
function finish(v, how) {
  v.ph = 'done'; v.ended = v.ended || how;
  relock(v);
  const g = byId(v.guest), b = byId(v.host);
  if (g) {
    g.touring = false;
    if (g.state === 'office' && !g.evac) { releaseSpot(g); setTrip(g, g.exitFloor, 'Tackar för rundvisningen och går', true); }
  }
  if (b) { b.touring = false; b.timer = Math.min(b.timer, 1); }
  const what = v.log.length ? ` och fick se ${v.log.map(s => s.toLowerCase()).join(', ')}` : '';
  if (v.seenStops.length) dayEvent('visning', '🛎️ Rundvisningen', `${b ? b.name : guideName()} visade runt: ${v.seenStops.length} stopp${what}.${v.sub ? ` ${kickiName()} skötte disken under tiden.` : ''}`);
  log(`🛎️ Rundvisningen är ${how === 'klar' ? 'slut' : how}`, 'sys');
}

/** varje steg (sim.js) */
export function visningTick(dt) {
  const v = V();
  if (!v) return;
  const h = hour();
  if (v.ph === 'order') {
    if (!startable(h, v.now)) return;
    let b = guideNow(h, v.now);
    if (!b) {
      // ingen guide i huset: väktaren eller driftchefen tar den (chefen säger varför)
      const si = /** @type {{ p: Person, why: string }} */ (standIn());
      b = si.p;
      chiefNote('visning', `${b.name} tar rundvisningen`, si.why);
    }
    // (guiden lämnar disken eller rasten – rundvisningen bestämmer vart hen går)
    if (b.onBreak) { b.onBreak = false; b.breakWhere = ''; speak(b, 'Rundvisning nu? Rasten får vänta!'); }
    v.host = b.id; v.ph = 'call'; b.touring = true; v.callAt = S.t + KICKI_S; v.callUntil = S.t + 7;
    v.sub = needsSub(b);
    v.guest = spawnGuest().id;
    if (v.sub) {
      speak(b, `Hej, ${b.name} på Tornet – kan ni skicka en vikarie till disken?`);
      v.line = 'Hej! Jag ringer bara efter en vikarie till disken – sedan går vi.'; v.lineN++; v.lineK = 'call';
      log(`☎️ ${b.name} ringer Kontorsservice: ${kickiName()} ska sköta receptionen under rundvisningen`, 'person', null, b.id);
    } else {
      v.callUntil = S.t;
      v.line = `Hej! Jag heter ${b.name} – i dag är det jag som visar dig runt. Vi börjar i entrén.`; v.lineN++; v.lineK = 'call';
      log(`🛎️ ${b.name} tar rundvisningen`, 'person', null, b.id);
    }
    return;
  }
  if (v.ph === 'call') {
    if (!v.sub) { v.ph = 'swap'; return; }
    if (S.t < v.callAt) return;
    const k = crewPerson('kicki') || spawnCrew('kicki');
    if (k) { v.kicki = k.id; pev(k, `Ska sköta receptionen medan ${guideName()} visar runt`); }
    v.ph = 'swap';
    return;
  }
  const b = byId(v.host), g = byId(v.guest), k = crewPerson('kicki');
  if (v.ph === 'swap') {
    // guiden går inte från disken förrän Kicki står i entrén
    if (!b || !g) { finish(v, 'avbruten'); return; }
    if (S.fire || alarmHeist()) return;
    if (v.sub && (!k || k.floor !== LOBBY || k.state !== 'office')) return;
    b.touring = true; g.touring = true; b.onBreak = false;
    if (v.sub && k) speak(k, 'Hej! Kicki från Kontorsservice – jag tar disken!');
    v.si = 0; v.detour = null;
    toStop(v, '');
    return;
  }
  if (v.ph === 'done') {
    // Kicki går när guiden sitter på sin post igen (crew.js), sedan är rundvisningen över
    if (!k && (!b || !v.sub || atPost(b) || b.state === 'away')) S.visning = null;
    return;
  }
  // ---- go / at ----
  if (!b) { finish(v, 'avbruten'); return; }
  if (!g || g.state === 'away' || (g.leaving && !g.evac && g.state !== 'assembly')) { finish(v, 'avbruten'); return; }
  // Kicki tar hand om larmen i entrén (en replik när larmet går)
  if (k && alarm() && !v.kickiSaid && k.floor === LOBBY) { v.kickiSaid = true; speak(k, S.fire ? 'Lugnt, lugnt – den här vägen ut!' : `Oj, larm! Jag har koll här – ${b ? b.name : guideName()}, fortsätt du!`); }
  if (!alarm()) v.kickiSaid = false;
  // kuppen: guiden och gästen gömmer sig och smyger (heist.js flyttar dem) – rundvisningen fortsätter efteråt
  if (alarmHeist()) { v.paused = true; return; }
  if (v.paused) { v.paused = false; v.detour = null; toStop(v, 'Puh! Det var nog det mest spännande som hänt i det här huset. Nå – var var vi?'); return; }
  const d = v.detour, here = b.floor;
  // något har hänt: lägg om rutten (inte på slutet, och inte mitt i en annan händelse)
  if (!d && v.si < STOPS.length - 1 && !v.ended && v.log.length < DETOURS) {
    const nd = happening(v, b.state === 'office' ? here : -1, v.ph === 'at' && v.stay > 0);
    if (nd && nd.f !== -1) {
      v.seen.push(nd.k);
      if (nd.f === -2) { v.detour = null; return; } // (kuppen sköts i heist.js)
      v.detour = nd;
      if (v.ph === 'at') v.si = nextStop(v.si + 1); // (stoppet vi stod vid är klart)
      toStop(v, `${nd.oj}!`);
      return;
    }
  }
  if (d && !d.at && d.over()) {
    // händelsen hann ta slut innan vi kom fram
    v.detour = null;
    toStop(v, d.missed || 'Det hann ta slut innan vi kom fram. Nå, var var vi?');
    return;
  }
  const f = d ? d.f : STOPS[v.si].f();
  if (v.ph === 'go') {
    v.goT += dt;
    // (stoppet finns inte just nu, eller det brinner där: nästa stopp – ingen går in i brandzonen)
    if (f < 0 || inFireZone(f)) { if (d) { v.detour = null; toStop(v, 'Dit går vi inte nu. Nå, var var vi?'); return; } if (v.si >= STOPS.length - 1) { finish(v, v.ended || 'klar'); return; } v.si = nextStop(v.si + 1); toStop(v, STOPS[v.si].way()); return; }
    // den som blev stående (utrymning, en ny väg) får målet igen när hen är ledig
    for (const p of group(v)) if (p.state === 'office' && !there(p, f) && !p.evac && !inFireZone(f)) {
      releaseSpot(p); setTrip(p, f, d ? `Rundvisning: ${d.title}` : `Rundvisning: ${STOPS[v.si].title}`, false);
    }
    // (stoppet hann stänga medan vi var på väg: guiden ringer efter nycklarna nu)
    if (!d && !v.unlock && closedStop(f)) line(v, startUnlock(v, f), `way:${STOPS[v.si].k}`);
    // stängt: vänta på nyckelbäraren (finns hen inte längre lånar guiden huvudnyckeln i receptionen)
    const u = v.unlock && !d && v.unlock.f === f && v.unlock.ph !== 'open' ? v.unlock : null;
    if (u) {
      const kp = byId(u.by);
      if (!kp || !free(kp)) { u.ph = 'open'; u.by = v.host; }
      else if (there(kp, f)) { u.ph = 'open'; speak(kp, f === STATION ? 'Så – spärrarna är öppna!' : 'Så där, nu är det öppet – för er!'); }
    }
    if (group(v).every(p => there(p, f)) && (!u || u.ph === 'open')) { arrived(v); return; }
    if (v.goT > GO_MAX) {
      // det tar för lång tid (någon sitter fast, en kö …): guiden börjar ändå om hon själv är framme
      if (there(b, f)) { arrived(v); return; }
      if (v.goT > GO_MAX * 3) { finish(v, 'avbruten'); return; }
    }
    return;
  }
  // ---- at ----
  if (d) {
    // vid händelsen: stå kvar tills guiden har sagt sitt – vid brand och strömavbrott tills det är över
    v.stay -= dt;
    if (d.over() || (v.stay <= 0 && !d.hold) || v.stay <= -DETOUR_MAX * 4) {
      v.detour = null;
      toStop(v, d.over() ? 'Där – nu är det över. Nå, var var vi?' : 'Det här tar en stund, så vi går vidare. Nå, var var vi?');
    }
    return;
  }
  v.stay -= dt;
  if (v.stay > 0) return;
  if (v.si >= STOPS.length - 1) { finish(v, v.ended || 'klar'); return; }
  v.si = nextStop(v.si + 1);
  toStop(v, STOPS[v.si].way());
}

/** Var guiden och gästen står vid ett stopp: synligt i hallen, guiden närmast korridoren och gästen bredvid. @param {Person} p */
export function visningSpot(p, f) {
  const v = V();
  if (!v || !onTour(p)) return null;
  const isB = p.id === v.host;
  const x = f === LOBBY ? (isB ? 300 : 322) : DOOR_X + (isB ? 26 : 48);
  return { x, k: 'stand', face: isB ? 1 : -1, temp: true, win: 'hall', tour: true,
    desc: isB ? 'Visar runt – berättar för gästen' : `Lyssnar på ${guideName()}` };
}
/** vad gästen bestämmer sig för i ett rum (decideNext i people.js): stannar så länge rundvisningen pågår @param {Person} p */
export function guestNext(p) {
  if (p.touring && S.visning) return null;
  return [p.exitFloor, 'Tackar för rundvisningen och går'];
}
export function visningReset() { S.visning = null; }
