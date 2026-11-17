// Rundvisningens stopp: Berit visar runt i ett eget dygn innan spelet börjar. Ren data utan DOM, så att
// testerna kan köra stoppen headless (intro.js är gränssnittet som spelar upp dem).
// Varje stopp: at = spola fram till klockslaget, until = spola fram tills det gäller (högst till max),
// ev = spelaråtgärder via act(), cam = vad kameran visar, focus = panelens block som lyfts fram,
// spot = css-väljare som blinkar, auto = regissören på, text = Berits replik (ctx.who = personen vi följer).
import { BUILDING, CONTROL, FL, LOBBY, ROOF, STATION, TOP } from './config.js';
import { S } from './state.js';
/** @typedef {import('./people.js').Person} Person */

/** rundvisningens dygn: samma frö varje gång, ingen slump (alla incidenter framkallas) */
export const INTRO_SEED = 19951117;
export const INTRO_OPTS = { roll: 'mjuk', incLevel: 'av', chief: true, strategy: 'smart' };
const carId = name => BUILDING.elevators.findIndex(e => e.name === name);
const TOP_F = ROOF >= 0 ? ROOF : TOP;

/** personen som rundvisningen följer: en anställd som väntar på hiss i entrén (annars någon som väntar) */
export function introPerson() {
  /** @param {Person} p */
  const ok = p => !p.dead && p.state === 'wait' && !p.crewId && p.kind === 'emp';
  return S.people.find(p => ok(p) && p.floor === LOBBY && p.dest !== LOBBY) || S.people.find(ok) || null;
}

/** @typedef {{ floor?: number, car?: number, person?: boolean, auto?: boolean }} IntroCam */
/** @typedef {{ k: string, title: string, at?: number, until?: () => boolean, max?: number, ev?: any[][], cam: IntroCam, focus?: string[], spot?: string[], text: (ctx: { who: string }) => string }} IntroStop */
/** @type {IntroStop[]} */
export const STOPS = [
  { k: 'tornet', title: 'Tornet', at: 7.05, cam: { floor: TOP_F },
    text: () => `Hej och välkommen till Tornet! Jag heter Berit och sitter i receptionen. Härifrån taket är det ${FL.length} våningar ner till tunnelbanan, och ${BUILDING.elevators.length} hissar styrda av Hiss-O-Matic 3000. Följ med, så visar jag runt!` },
  { k: 'entre', title: 'Entrén', cam: { floor: LOBBY },
    text: () => 'Här är entrén – karuselldörren, min disk och rulltrappan upp till mellanplanet. Det finns inga hissknappar här: man talar om vart man ska, och Hiss-O-Matic ger en en egen hiss. Bubblan över huvudet visar målet och hissen.' },
  { k: 'person', title: 'Följ en person', until: () => !!introPerson(), max: 0.6, cam: { person: true }, focus: ['follow'],
    text: c => `Nu följer vi ${c.who} en stund. I kontrollpanelen står vart hen ska och varför. Du kan klicka på vem som helst i bilden – eller på en hiss eller en våning – så följer kameran den.` },
  { k: 'hiss', title: 'Hissarna', cam: { car: carId('X1') }, focus: ['follow'],
    text: () => 'Det här är expressen X1. Hissarna har zoner: L-hissarna går i den låga zonen och H-hissarna i den höga – staplade i samma schakt! X1 och X2 går raka vägen till sky lobbyn på 6:an där man byter hiss, och X1 har två däck och går ända ner till tunnelbanan.' },
  { k: 'tag', title: 'Tunnelbanan', until: () => !!S.train && S.train.state === 'in', max: 0.5, cam: { floor: STATION },
    text: () => 'Under huset ligger tunnelbanan. Varje gång ett tåg stannar kliver en hel klump folk av på en gång – då får hissarna brått. På morgonen går tågen tätt.' },
  { k: 'drift', title: 'Driftcentralen', cam: { floor: CONTROL }, spot: ['#lower'],
    text: () => 'På P1 ligger driftcentralen. Där sitter Gun-Britt – driftchefen – och på natten Rune. När något händer tar hon besluten och säger varför. Det hon bestämmer står på skylten längst ner i bilden.' },
  { k: 'kamera', title: 'Kameran', cam: { auto: true }, focus: ['play'], spot: ['.pl-cam'],
    text: () => 'Bredvid henne sitter Ludde och klipper bilden. När regissören 🎬 är på visar han det mest sevärda – som nu. Biografläget 🎞️ döljer panelen, 🏷️ sätter namnbrickor på alla, och vilar du musen på en knapp står det vad den gör.' },
  { k: 'stapel', title: 'Dygnet', cam: { auto: true }, focus: ['play'], spot: ['.tl', '.pl-ctl'],
    text: () => 'Stapeln är dygnet: morgonrusning, lunch, hemgång och natt. Det som händer dyker upp som små ikoner på den. Med ❚❚ pausar du, och farten väljer du bredvid.' },
  { k: 'fel', title: 'Ett hissfel', ev: [['trigger', 'fault', carId('L2')]], cam: { car: carId('L2') }, focus: ['events', 'follow'],
    text: () => 'Nu ska ni få se – jag ber L2 att krångla! I panelen står vad som är fel, vilka som är ombord och när hissteknikern är framme. Vid brand, storm eller strömavbrott kommer ett kort överst där Gun-Britt säger vad hon bestämt – och där kan du ta över beslutet.' },
  { k: 'framkalla', title: 'Framkalla', ev: [['trigger', 'vip']], cam: { floor: TOP_F }, focus: ['trig'],
    text: () => 'Allt sådant kan du framkalla själv: brand, strömavbrott, storm, linbrott, en flyttbil … Jag har just ringt efter en VIP-helikopter till taket. Följer du en hiss eller en våning finns knapparna för just den i panelen.' },
  { k: 'styrning', title: 'Styrningen', cam: { auto: true }, focus: ['strat', 'links'],
    text: () => 'Under Styrning väljer du hur hissarna tänker – Smart, Rusning, Energisnål och några till – och hur ofta det händer saker av sig själva. Längst ner ligger registret, loggen, inställningarna och dagens resultat.' },
  { k: 'slut', title: 'Din tur', cam: { floor: LOBBY },
    text: () => 'Det var allt! Huset sköter sig självt, så luta dig tillbaka och titta – eller ställ till det lite. Nu är det din tur. Välkommen åter!' },
];
