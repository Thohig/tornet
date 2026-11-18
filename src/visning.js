// Rundvisningen: receptionisten Berit visar en gäst runt i huset, i det dygn som pågår. Spelaren beställer den
// (act('visning', 'start')); Berit ringer bemanningen och vikarien Kicki tar över receptionen – även larmen – medan
// Berit och gästen går rutten: entrén, driftcentralen, perrongen, Sky Café, takterrassen och tillbaka. Stoppen är
// platser, inte klockslag, och Berit berättar om det som händer där just nu. Händer något i huset under tiden lägger
// hon om rutten dit (aldrig in i brandzonen) och fortsätter sedan där hon var. Läget ligger i S.visning; Berit, gästen
// och Kicki är personer i huset. Drar inga slumptal – allt bestäms av huset och spelaren. Repliken i S.visning.line
// läses upp och visas av gränssnittet (intro.js).
import { CAFE, CONTROL, DOCK, DOOR_X, FL, LOBBY, ROOF, STATION, BUILDING, floorOpen } from './config.js';
import { S, dayEvent, hour, log, notice } from './state.js';
import { blankPerson, pev, releaseSpot, setTrip } from './people.js';
import { inFireZone } from './dispatch.js';
import { speak } from './cast.js';
import { CREW_BY, alarm, atPost, crewPerson, spawnCrew } from './crew.js';
import { chiefOnDuty } from './chief.js';
import { nextTrainMin } from './train.js';
import { techOf } from './service.js';
import { fl } from './util.js';
/** @typedef {import('./people.js').Person} Person */
/** @typedef {import('./elevators.js').Elevator} Elevator */

/** den sista timmen Berit börjar en rundvisning (hennes pass slutar kl 19) */
export const LAST_START = 17.25;
/** hur länge (verkliga sekunder) innan vikarien kliver in i entrén efter samtalet */
const KICKI_S = 20;
/** hur länge Berit pratar vid ett stopp: ord per sekund (uppläst) och minst så här många sekunder */
const WPS = 2.4, STAY_MIN = 9;
/** längst tid en förflyttning får ta innan Berit ger upp och går vidare (verkliga sekunder) */
const GO_MAX = 260;
/** hur länge de stannar vid en händelse (verkliga sekunder, minst) och längst (om den inte är över) */
const DETOUR_MIN = 22, DETOUR_MAX = 90;
/** högst så här många omvägar på en rundvisning – sedan blir det rutten */
const DETOURS = 3;

/**
 * Rundvisningen (S.visning). ph: order (beställd, väntar på Berit) → call (ringer vikarien) → swap (väntar på Kicki)
 * → go/at (på väg till / vid ett stopp) → done (slut: Kicki går hem, Berit sätter sig). stop = stoppet (index i
 * STOPS) eller händelsen (detour) som gruppen är på väg till eller står vid; line/lineN = Berits replik.
 * @typedef {{ ph: string, t0: number, berit: number, guest: number, kicki: number, si: number, goT: number, stay: number,
 *   callAt: number, callUntil: number, detour: Detour|null, seen: string[], seenStops: string[], line: string, lineN: number,
 *   lineK: string, focus: string[], spot: string[], log: string[], ended: string, kickiSaid: boolean, paused: boolean }} Visning
 */
/** En händelse som Berit lägger om rutten för: oj = vad hon utbrister, hold = stanna tills den är över (brand,
 *  strömavbrott – då går ändå inga hissar) @typedef {{ k: string, f: number, title: string, oj: string, there: () => string, over: () => boolean, missed: string, hold: boolean, at: boolean, t: number }} Detour */

/**
 * Rutten. f = våningen (eller -1 = finns inte i huset), text = vad Berit säger där (läser av huset just nu),
 * way = vad hon säger på väg dit, focus/spot = panelens block som lyfts fram och det som blinkar (bara gränssnitt).
 * @typedef {{ k: string, title: string, f: () => number, way: () => string, text: () => string, focus?: string[], spot?: string[] }} Stop
 */
/** @type {Stop[]} */
export const STOPS = [
  { k: 'entre', title: 'Entrén', f: () => LOBBY, way: () => '',
    text: () => `Välkommen till Tornet! Det här är entrén – karuselldörren, min disk och rulltrappan upp till mellanplanet. Här finns inga hissknappar: man säger vart man ska, och Hiss-O-Matic 3000 ger en en egen hiss. Bubblan över huvudet visar målet och hissen. ${BUILDING.elevators.length} hissar, ${FL.length} våningar – och i dag sköter ${kickiName()} disken medan jag visar dig runt.`,
    focus: ['follow'] },
  { k: 'drift', title: 'Driftcentralen', f: () => CONTROL, way: () => 'Först ner till driftcentralen på P1 – hjärtat i huset.',
    text: () => driftText(), spot: ['#lower'] },
  { k: 'perrong', title: 'Perrongen', f: () => STATION, way: () => 'Nu går vi ner till tunnelbanan. Hissarna i låga zonen och expressen X1 går ända ner.',
    text: () => perrongText() },
  { k: 'sky', title: 'Sky Café', f: () => CAFE, way: () => 'Upp till sky lobbyn på 6:an! Expressen går raka vägen – där byter man till H-hissarna i höga zonen.',
    text: () => skyText(), focus: ['strat'] },
  { k: 'tak', title: 'Takterrassen', f: () => (ROOF >= 0 && floorOpen(ROOF, hour()) ? ROOF : -1), way: () => 'Sista biten upp till taket – H-hissarna går ända upp.',
    text: () => takText(), focus: ['trig'] },
  { k: 'slut', title: 'Tillbaka i entrén', f: () => LOBBY, way: () => 'Nu åker vi ner till entrén igen.',
    text: () => slutText(), focus: ['trig', 'strat', 'links'] },
];

const kickiName = () => CREW_BY.kicki.name;
const V = () => S.visning;
const byId = id => S.people.find(p => p.id === id && !p.dead) || null;
/** alla i gruppen: Berit och gästen (de som finns kvar) */
const group = v => [byId(v.berit), byId(v.guest)].filter(p => p);
/** framme på våning f (den som har utrymts vid brand och står på återsamlingsplatsen utanför entrén räknas) @param {Person} p */
const there = (p, f) => p.floor === f && ((p.state === 'office' && !p.evac) || p.state === 'assembly');
/** går rundvisningen just nu (Berit är ute med gästen)? */
export const touring = () => !!S.visning && (S.visning.ph === 'go' || S.visning.ph === 'at');
/** är p Berit eller gästen under en rundvisning? @param {Person} p */
export const onTour = p => touring() && (p.id === S.visning.berit || p.id === S.visning.guest);

/** ny replik (gränssnittet läser upp den) */
function line(v, text, k = '') {
  v.line = text; v.lineN++; v.lineK = k;
  const b = byId(v.berit);
  if (b) speak(b, short(text));
}
/** första meningen (pratbubblan i bilden); hela repliken står i panelen */
const short = t => { const m = t.match(/^.*?[.!?…](\s|$)/); const s = (m ? m[0] : t).trim(); return s.length > 70 ? `${s.slice(0, 67)}…` : s; };
/** hur länge Berit pratar (verkliga sekunder) */
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

// ---------- Händelserna som Berit lägger om rutten för ----------
/** brand, storm, strömavbrott, hissfel … som pågår och som Berit kan visa just nu (första som passar). urgent = bara
 *  det som inte kan vänta (brand, strömavbrott, kuppen): Berit pratar klart vid stoppet först. @returns {Detour|null} */
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
  if (S.pano && S.pano.ph !== 'done') {
    list.push(mk(`pano:${S.pano.t0}`, LOBBY, 'Fast på fasaden', 'Panoramahissen sitter fast på fasaden! Kom, vi går ut på gatan och tittar',
      () => 'Titta upp! Panoramahissen sitter fast utanpå huset. Räddningstjänsten tar ner folk – med rep från taket eller stegbilens stege.',
      () => !S.pano || S.pano.ph === 'done', 'Räddningstjänsten hann få ner alla innan vi kom ut.'));
  }
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
export function orderVisning() {
  if (S.visning) return false;
  S.visning = { ph: 'order', t0: S.t, berit: -1, guest: -1, kicki: -1, si: 0, goT: 0, stay: 0, callAt: 0, callUntil: 0,
    detour: null, seen: [], seenStops: [], line: '', lineN: 0, lineK: '', focus: [], spot: [], log: [], ended: '', kickiSaid: false, paused: false };
  const h = hour(), soon = startable(h);
  const when = soon ? 'Hon ringer efter en vikarie till disken och börjar sedan.' : h < 7 ? 'Hon börjar när hon kommer till disken i morgon bitti.'
    : h < LAST_START ? 'Hon börjar så fort hon sitter i receptionen.' : 'Det är för sent i dag – hon börjar när hon kommer till disken i morgon bitti.';
  notice('visning', '🛎️ Rundvisning beställd', `Berit visar runt. ${when}`, { floor: LOBBY });
  log('🛎️ En rundvisning är beställd hos Berit i receptionen', 'sys');
  return true;
}
/** Gå vidare till nästa stopp (Berit slutar prata) */
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
/** kan Berit börja just nu? */
function startable(h) {
  const b = crewPerson('berit');
  return !!b && atPost(b) && h >= 7 && h < LAST_START && !S.fire && !alarmHeist();
}
const alarmHeist = () => !!S.heist && S.heist.ph !== 'done';
/** gästen kliver in i entrén */
function spawnGuest() {
  const g = blankPerson('vis', LOBBY, -40, { name: 'Gästen', look: { skin: '#ffdbb8', shirt: '#ffffff', pants: '#2b2d6e', hair: 0, hairC: '#5a3412', tie: true, tieC: '#2a5db0', stripe: false, acc: 3 },
    walkPhase: 1, speedMul: 1, depth: -2, patience: 30, kg: 75, fit: 0, space: 9, polite: true });
  g.guest = true; g.touring = true; g.title = 'Gäst på rundvisning (du)';
  S.people.push(g);
  setTrip(g, LOBBY, 'Rundvisning med Berit', false);
  pev(g, 'Kliver in i entrén · ska gå på rundvisning med Berit');
  return g;
}
/** Berit och gästen går till stoppet (eller händelsen) – de som redan är där står kvar */
function toStop(v, say) {
  const d = v.detour, st = STOPS[v.si];
  const f = d ? d.f : st.f();
  v.ph = 'go'; v.goT = 0;
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
/** gruppen är framme: Berit berättar */
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
    log(`🛎️ Rundvisningen: Berit visar ${d.title.toLowerCase()}`, 'person', null, v.berit);
    return;
  }
  const st = STOPS[v.si], txt = st.text();
  v.seenStops.push(st.k);
  line(v, txt, `at:${st.k}`);
  v.stay = talkS(txt);
  v.focus = st.focus || []; v.spot = st.spot || [];
  log(`🛎️ Rundvisningen: ${st.title} (${fl(st.f())})`, 'person', null, v.berit);
}
/** nästa stopp på rutten (hoppar över dem som inte finns just nu) */
function nextStop(from) {
  let i = from;
  while (i < STOPS.length - 1 && STOPS[i].f() < 0) i++;
  return i;
}
/** rundvisningen är slut: gästen går, Berit tillbaka till disken, Kicki går hem när Berit sitter */
function finish(v, how) {
  v.ph = 'done'; v.ended = v.ended || how;
  const g = byId(v.guest), b = byId(v.berit);
  if (g) {
    g.touring = false;
    if (g.state === 'office' && !g.evac) { releaseSpot(g); setTrip(g, g.exitFloor, 'Tackar för rundvisningen och går', true); }
  }
  if (b) { b.touring = false; b.timer = Math.min(b.timer, 1); }
  const what = v.log.length ? ` och fick se ${v.log.map(s => s.toLowerCase()).join(', ')}` : '';
  if (v.seenStops.length) dayEvent('visning', '🛎️ Rundvisningen', `Berit visade runt: ${v.seenStops.length} stopp${what}. ${kickiName()} skötte disken under tiden.`);
  log(`🛎️ Rundvisningen är ${how === 'klar' ? 'slut' : how}`, 'sys');
}

/** varje steg (sim.js) */
export function visningTick(dt) {
  const v = V();
  if (!v) return;
  const h = hour();
  if (v.ph === 'order') {
    if (!startable(h)) return;
    const b = /** @type {Person} */ (crewPerson('berit'));
    // (Berit lämnar inte disken för en rast nu – rundvisningen bestämmer vart hon går)
    v.berit = b.id; v.ph = 'call'; b.touring = true; v.callAt = S.t + KICKI_S; v.callUntil = S.t + 7;
    speak(b, 'Hej, Berit på Tornet – kan ni skicka en vikarie till disken?');
    v.line = 'Hej! Jag ringer bara efter en vikarie till disken – sedan går vi.'; v.lineN++; v.lineK = 'call';
    v.guest = spawnGuest().id;
    log(`☎️ Berit ringer Kontorsservice: ${kickiName()} ska sköta receptionen under rundvisningen`, 'person', null, b.id);
    return;
  }
  if (v.ph === 'call') {
    if (S.t < v.callAt) return;
    const k = crewPerson('kicki') || spawnCrew('kicki');
    if (k) { v.kicki = k.id; pev(k, 'Ska sköta receptionen medan Berit visar runt'); }
    v.ph = 'swap';
    return;
  }
  const b = byId(v.berit), g = byId(v.guest), k = crewPerson('kicki');
  if (v.ph === 'swap') {
    // Berit går inte från disken förrän Kicki står i entrén
    if (!b || !g) { finish(v, 'avbruten'); return; }
    if (!k || k.floor !== LOBBY || k.state !== 'office' || S.fire || alarmHeist()) return;
    b.touring = true; g.touring = true; b.onBreak = false;
    speak(k, 'Hej! Kicki från Kontorsservice – jag tar disken!');
    v.si = 0; v.detour = null;
    toStop(v, '');
    return;
  }
  if (v.ph === 'done') {
    // Kicki går när Berit sitter på sin post igen (crew.js), sedan är rundvisningen över
    if (!k && (!b || atPost(b) || b.state === 'away')) S.visning = null;
    return;
  }
  // ---- go / at ----
  if (!b) { finish(v, 'avbruten'); return; }
  if (!g || g.state === 'away' || (g.leaving && !g.evac && g.state !== 'assembly')) { finish(v, 'avbruten'); return; }
  // Kicki tar hand om larmen i entrén (en replik när larmet går)
  if (k && alarm() && !v.kickiSaid && k.floor === LOBBY) { v.kickiSaid = true; speak(k, S.fire ? 'Lugnt, lugnt – den här vägen ut!' : 'Oj, larm! Jag har koll här – Berit, fortsätt du!'); }
  if (!alarm()) v.kickiSaid = false;
  // kuppen: Berit och gästen gömmer sig och smyger (heist.js flyttar dem) – rundvisningen fortsätter efteråt
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
    if (group(v).every(p => there(p, f))) { arrived(v); return; }
    if (v.goT > GO_MAX) {
      // det tar för lång tid (någon sitter fast, en kö …): Berit börjar ändå om hon själv är framme
      if (there(b, f)) { arrived(v); return; }
      if (v.goT > GO_MAX * 3) { finish(v, 'avbruten'); return; }
    }
    return;
  }
  // ---- at ----
  if (d) {
    // vid händelsen: stå kvar tills Berit har sagt sitt – vid brand och strömavbrott tills det är över
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

/** Var Berit och gästen står vid ett stopp: synligt i hallen, Berit närmast korridoren och gästen bredvid. @param {Person} p */
export function visningSpot(p, f) {
  const v = V();
  if (!v || !onTour(p)) return null;
  const isB = p.id === v.berit;
  const x = f === LOBBY ? (isB ? 300 : 322) : DOOR_X + (isB ? 26 : 48);
  return { x, k: 'stand', face: isB ? 1 : -1, temp: true, win: 'hall', tour: true,
    desc: isB ? 'Visar runt – berättar för gästen' : 'Lyssnar på Berit' };
}
/** vad gästen bestämmer sig för i ett rum (decideNext i people.js): stannar så länge rundvisningen pågår @param {Person} p */
export function guestNext(p) {
  if (p.touring && S.visning) return null;
  return [p.exitFloor, 'Tackar för rundvisningen och går'];
}
export function visningReset() { S.visning = null; }
