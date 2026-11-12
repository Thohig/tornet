// Världens mått, regler, byggnaden (våningar och hissar), platser och texter.
// Huset beskrivs som DATA i BUILDING längre ner – allt annat (geometri, våningsnummer,
// vilka våningar som är kontor, var caféet ligger …) räknas ut därifrån.

/**
 * En plats på en våning där folk sitter, står eller försvinner in (dörr).
 * @typedef {{ x: number, k: string, desc: string, face?: number, lift?: number, staff?: boolean, label?: string,
 *   style?: string, item?: string, front?: boolean, jump?: boolean, temp?: boolean, role?: string, apt?: number, bed?: boolean }} Spot
 */

// Märklast för vanliga hissar (varuhissen har egen) – används när byggnaden läses in nedan
export const RATED_KG = 800, FULL_LOAD = 0.8;

// ---------- Våningsteman ----------
// Färgerna (acc) är dämpade mot grått i pixelgrafikens palett "Kontor 95" (se pixpal.js).
// Varje tema är ett paket: namn, färg, platser där folk tar vägen och varför besökare kommer dit.
// I bilden syns temat som hallen framför hissarna: namnskylt och korridor i temats färg (acc).
export const THEME_INFO = {
  lobby: { name: 'Entré', short: 'entrén', acc: '#bd6d91', spots: [] },
  dentist: { name: 'Glada Tanden Tandvård', short: 'tandläkaren', acc: '#409991', visit: 'Tandläkartid', spots: [
    { x: 132, k: 'door', staff: true, label: 'PERSONAL', style: 'staff', desc: 'Inne i personalrummet' },
    { x: 240, k: 'chair', face: -1, lift: 14, desc: 'Ligger i tandläkarstolen – gapa stort!' },
    { x: 354, k: 'chair', face: 1, lift: 6, desc: 'Sitter i väntrummet med en tidning från -96' },
    { x: 396, k: 'chair', face: 1, lift: 6, desc: 'Sitter i väntrummet och tittar på fiskarna' },
    { x: 438, k: 'chair', face: 1, lift: 6, desc: 'Sitter i väntrummet och nynnar' },
  ] },
  game: { name: 'Pixel & Planka Spelstudio', short: 'spelstudion', acc: '#bd5386', visit: 'Lämnar ett spelmanus', spots: [
    { x: 122, k: 'chair', face: 1, lift: -4, desc: 'Spelar Game Boy i sittsäcken' },
    { x: 196, k: 'desk', face: 1, lift: 8, staff: true, item: 'crt', desc: 'Kodar vid sin CRT-skärm' },
    { x: 290, k: 'desk', face: 1, lift: 8, staff: true, item: 'crt', desc: 'Ritar pixelgrafik' },
    { x: 384, k: 'desk', face: 1, lift: 8, staff: true, item: 'crt', desc: 'Felsöker en bugg' },
    { x: 470, k: 'stand', face: 1, desc: 'Testar arkadspelet' },
  ] },
  ad: { name: 'Rymdkakan Reklambyrå', short: 'reklambyrån', acc: '#bd913b', visit: 'Kundmöte om en reklamfilm', spots: [
    { x: 212, k: 'stand', front: true, staff: true, desc: 'Brainstormar vid moodboarden' },
    { x: 262, k: 'stand', front: true, staff: true, desc: 'Brainstormar vid moodboarden' },
    { x: 326, k: 'stand', face: 1, desc: 'Spelar pingis' },
    { x: 410, k: 'stand', face: -1, desc: 'Spelar pingis' },
    { x: 482, k: 'door', staff: true, label: 'MÖTE', style: 'porthole', desc: 'Sitter i mötesrummet' },
  ] },
  law: { name: 'Kvarnström Advokater', short: 'advokatbyrån', acc: '#927440', visit: 'Juridisk rådgivning', spots: [
    { x: 196, k: 'stand', face: -1, desc: 'Letar i lagböckerna' },
    { x: 266, k: 'chair', face: 1, lift: 8, desc: 'Läser i Chesterfieldfåtöljen' },
    { x: 340, k: 'door', staff: true, label: '401', style: 'double', desc: 'Inne på kontor 401' },
    { x: 456, k: 'door', staff: true, label: '402', style: 'double', desc: 'Inne på kontor 402' },
  ] },
  radio: { name: 'Kanal 97 FM', short: 'radiostationen', acc: '#ab3569', visit: 'Ska intervjuas i radio', spots: [
    { x: 140, k: 'door', staff: true, label: 'STUDIO B', desc: 'Spelar in en reklamjingel i studio B' },
    { x: 236, k: 'desk', face: 1, lift: 8, staff: true, item: 'mixer', role: 'nattdj', desc: 'Kör direktsändning – "nästa låt är en riktig dänga!"' },
    { x: 330, k: 'desk', face: 1, lift: 8, staff: true, item: 'mixer', desc: 'Mixar jinglar' },
    { x: 452, k: 'chair', face: -1, lift: 6, desc: 'Väntar på att bli intervjuad i radio' },
  ] },
  aerobic: { name: 'Svettis Aerobic', short: 'aerobicstudion', acc: '#389a5c', visit: 'Aerobicpass', spots: [
    { x: 150, k: 'stand', front: true, staff: true, jump: true, desc: 'Leder passet: "Och KNÄLYFT!"' },
    ...[214, 268, 322, 376, 430].map(x => ({ x, k: 'stand', front: true, jump: true, desc: 'Kör aerobics i benvärmare' })),
  ] },
  server: { name: 'Modemkungen ISP', short: 'serverhallen', acc: '#2c87af', visit: 'Klagar på sitt modem', spots: [
    { x: 146, k: 'desk', face: 1, lift: 8, staff: true, item: 'crt', role: 'nattekniker', desc: 'Övervakar 56k-modemen' },
    { x: 262, k: 'stand', front: true, staff: true, desc: 'Byter en nätverkskabel' },
    { x: 372, k: 'stand', front: true, desc: 'Startar om servern – "har du testat att starta om?"' },
    { x: 486, k: 'door', staff: true, label: 'KYLRUM', desc: 'Inne i det iskalla kylrummet' },
  ] },
  spa: { name: 'Vovve Spa', short: 'hundsalongen', acc: '#a64eb3', visit: 'Hämtar sin nyklippta pudel', spots: [
    { x: 140, k: 'door', staff: true, label: 'KENNEL', desc: 'Matar hundarna i kenneln' },
    { x: 344, k: 'stand', face: -1, staff: true, desc: 'Klipper en pudel' },
    { x: 452, k: 'chair', face: 1, lift: 6, desc: 'Lämnar in sin tax för klippning' },
  ] },
  bank: { name: 'Guldbanken', short: 'banken', acc: '#9d7726', visit: 'Ska ta ett lån', spots: [
    { x: 140, k: 'door', staff: true, label: 'VALV', style: 'vault', desc: 'Räknar guldtackor i valvet' },
    { x: 280, k: 'desk', front: true, lift: 8, staff: true, desc: 'Räknar sedlar i kassa 1' },
    { x: 372, k: 'desk', front: true, lift: 8, staff: true, desc: 'Stämplar blanketter i tre exemplar' },
    { x: 482, k: 'stand', face: -1, desc: 'Står i kö till kassan' },
  ] },
  lab: { name: 'Quasar Laboratorium', short: 'labbet', acc: '#309287', visit: 'Levererar provrör', spots: [
    { x: 140, k: 'door', staff: true, label: 'RENRUM', desc: 'Inne i renrummet i skyddsdräkt' },
    { x: 236, k: 'stand', front: true, staff: true, desc: 'Blandar en misstänkt grön vätska' },
    { x: 330, k: 'stand', face: 1, desc: 'Tittar på teslaspolen (på säkert avstånd)' },
    { x: 430, k: 'desk', face: 1, lift: 8, staff: true, item: 'paper', desc: 'Skriver en rapport om den gröna vätskan' },
  ] },
  garage: { name: 'Garage', short: 'garaget', acc: '#606977', spots: [] },
  // tunnelbanestationen under huset: perrongen är hallen, tåget stannar längs bakväggen (se train.js)
  station: { name: 'Tornplan T-bana', short: 'stationen', acc: '#3b6ea5', spots: [
    { x: 150, k: 'door', label: 'KIOSK', desc: 'Köper en kvällstidning i kiosken' },
    { x: 262, k: 'stand', face: -1, desc: 'Läser tidtabellen' },
    { x: 330, k: 'chair', face: 1, lift: 6, desc: 'Sitter på en bänk på perrongen' },
    { x: 380, k: 'chair', face: 1, lift: 6, desc: 'Sitter på en bänk på perrongen' },
  ] },
  dock: { name: 'Garage & lastkaj', short: 'lastkajen', acc: '#6c6865', spots: [
    { x: 262, k: 'door', staff: true, label: 'PANNRUM', role: 'vaktmästare', desc: 'Kollar pannan i pannrummet' },
  ] },
  sky: { name: 'Sky Lobby & Sky Café', short: 'sky lobbyn', acc: '#4695b8', visit: 'Fika i Sky Café',
    spots: [250, 294, 360, 404].map((x, i) => ({ x, k: 'chair', face: i % 2 ? -1 : 1, lift: 12, desc: 'Fikar i Sky Café med utsikt' })) },
  apartments: { name: 'Bostäder', short: 'hemma', acc: '#b7832b', spots: [
    // två lägenheter per våning: apt 0 = vänster (x 60–300), apt 1 = höger (x 312–512); hallen till hissarna ligger till höger
    { x: 122, k: 'chair', face: -1, lift: 6, apt: 0, desc: 'Sitter i soffan och tittar på TV' },
    { x: 186, k: 'stand', face: 1, apt: 0, desc: 'Lagar mat i köket' },
    { x: 266, k: 'chair', face: -1, lift: 4, apt: 0, bed: true, desc: 'Sover i sängen' },
    { x: 358, k: 'chair', face: -1, lift: 6, apt: 1, desc: 'Sitter i soffan och läser' },
    { x: 404, k: 'desk', face: 1, lift: 8, apt: 1, item: 'crt', desc: 'Surfar på nätet med 56k-modem' },
    { x: 486, k: 'chair', face: -1, lift: 4, apt: 1, bed: true, desc: 'Sover i sängen' },
  ] },
  roof: { name: 'Takterrassen', short: 'takterrassen', acc: '#389a5c', visit: 'Utsikt från takterrassen', spots: [
    ...[150, 210, 270].map(x => ({ x, k: 'chair', face: 1, lift: 8, desc: 'Sitter på en bänk i takträdgården' })),
    { x: 330, k: 'stand', face: -1, desc: 'Vattnar tomaterna i takträdgården' },
    { x: 380, k: 'stand', front: true, desc: 'Tar en selfie med utsikten' },
  ] },
  cafe: { name: 'Takcaféet', short: 'Takcaféet', acc: '#bd6659', visit: 'Fika med utsikt',
    spots: [208, 252, 318, 362, 428, 472].map((x, i) => ({ x, k: 'chair', face: i % 2 ? -1 : 1, lift: 12, desc: 'Fikar vid ett bord med utsikt' })) },
};

// ---------- Byggnaden ----------
// Våningarna nerifrån och upp. tags: lobby (entrén), office (arbetsplatser), cafe, radio, server, spa …
// hours: öppettider för besökare [öppnar, stänger] – personalen får jobba över.
// Hissarna: serves = vilka våningar (etiketter) hissen stannar på (utelämnat = alla), start = var den står på morgonen,
// park = var smarta styrningen parkerar den vid olika tider.
export const BUILDING = {
  floors: [
    { label: 'TB', theme: 'station', tags: ['station', 'basement'] },
    { label: 'P2', theme: 'garage', tags: ['garage', 'basement'] },
    { label: 'P1', theme: 'dock', tags: ['garage', 'basement', 'dock'] },
    { label: 'E', theme: 'lobby', tags: ['lobby'] },
    { label: '1', theme: 'dentist', hours: [8, 17], tags: ['office', 'dentist'] },
    { label: '2', theme: 'game', hours: [7, 19], tags: ['office'] },
    { label: '3', theme: 'ad', hours: [7, 19], tags: ['office'] },
    { label: '4', theme: 'law', hours: [7, 19], tags: ['office', 'law'] },
    { label: '5', theme: 'bank', hours: [9, 16], tags: ['office', 'bank'] },
    { label: '6', theme: 'sky', hours: [7.5, 18], lit: true, tags: ['sky', 'cafe'] },
    { label: '7', theme: 'radio', tags: ['office', 'radio'] },
    { label: '8', theme: 'aerobic', hours: [6, 21], tags: ['office', 'aerobic'] },
    { label: '9', theme: 'server', tags: ['office', 'server'] },
    { label: '10', theme: 'spa', hours: [8, 18], tags: ['office', 'spa'] },
    { label: '11', theme: 'lab', hours: [7, 19], tags: ['office'] },
    { label: '12', theme: 'apartments', variant: 0, tags: ['home'] },
    { label: '13', theme: 'apartments', variant: 1, tags: ['home'] },
    { label: '14', theme: 'apartments', variant: 2, tags: ['home'] },
    { label: 'T', theme: 'roof', hours: [9, 20], open: true, tags: ['roof', 'helipad'] },
  ],
  // Zonindelning som i riktiga skyskrapor: låg zon P2–5 och hög zon 6–T är STAPLADE i samma schakt
  // (col = vilken schaktkolumn hissen går i), expresshissar E ⇄ 6 (sky lobbyn), en varuhiss till alla
  // våningar (för vagnar och leveranser) och en panoramahiss i glas på fasaden.
  // Kolumnerna ligger så att tornet blir smalare ovanför sky lobbyn: expresshissarna ytterst, och
  // ovanpå dem en takterrass. Den som ska från låga till höga zonen åker via entrén och expressen.
  elevators: [
    { name: 'L1', color: '#c0392b', group: 'låg', col: 0, start: 'E', serves: ['TB', 'P2', 'P1', 'E', '1', '2', '3', '4', '5'], park: { day: 'E', lunch: '5', evening: '4' } },
    { name: 'L2', color: '#d35400', group: 'låg', col: 1, start: 'P1', serves: ['TB', 'P2', 'P1', 'E', '1', '2', '3', '4', '5'], park: { day: '3', lunch: 'E', evening: 'E' } },
    // dubbeldäck: nedre däcket stannar på serves, övre däcket samtidigt på våningen ovanför (upper).
    // Till övre däcket i entrén tar man rulltrappan upp till mellanplanet (1).
    // X1 går ända ner till tunnelbanan (övre däcket öppnar då mot garaget på P2); under X2 går garagerampen.
    // Den har en egen grupp (egna hallknappar), eftersom den når våningar som X2 inte når.
    { name: 'X1', color: '#d4a017', group: 'tbana', col: 3, start: 'E', serves: ['TB', 'E', '6'], upper: ['P2', '1', '7'], express: true },
    { name: 'X2', color: '#b8860b', group: 'express', col: 4, start: '6', serves: ['E', '6'], upper: ['1', '7'], express: true },
    { name: 'H1', color: '#008080', group: 'hög', col: 0, start: '6', serves: ['6', '7', '8', '9', '10', '11', '12', '13', '14', 'T'], park: { day: '6', lunch: '6', evening: '11' } },
    { name: 'H2', color: '#2a5db0', group: 'hög', col: 1, start: '10', serves: ['6', '7', '8', '9', '10', '11', '12', '13', '14', 'T'], park: { day: '10', lunch: '6', evening: '13' } },
    { name: 'V', color: '#808080', group: 'varu', col: 2, start: 'P1', home: 'P1', freight: true, ratedKg: 1600 },
    { name: 'P', color: '#93379e', group: 'panorama', start: 'E', serves: ['E', '6', 'T'], facade: true },
  ],
};

// ---------- Härlett från byggnaden ----------
const FDEF = BUILDING.floors;
export const FLOORS = FDEF.length, TOP = FLOORS - 1;
export const LABELS = FDEF.map(f => f.label);
/** våningsindex för en etikett, t.ex. idx('E') */
export const idx = label => { const i = LABELS.indexOf(label); if (i < 0) throw new Error(`okänd våning ${label}`); return i; };
export const floorsWith = tag => FDEF.map((f, i) => (f.tags.includes(tag) ? i : -1)).filter(i => i >= 0);
export const floorWith = tag => floorsWith(tag)[0] ?? -1;
export const LOBBY = floorWith('lobby');
export const CAFE = floorWith('cafe');
export const OFFICE_FLOORS = floorsWith('office');
export const SKY = floorWith('sky');          // sky lobbyn: här byter man mellan zonerna
export const ROOF = floorWith('roof');
export const DOCK = floorWith('dock');
export const STATION = floorWith('station'); // tunnelbanan under huset (-1 om huset saknar station)
export const HOME_FLOORS = floorsWith('home');
export const GARAGE_FLOORS = floorsWith('garage');
/** Våningarnas data: temats namn/färg + våningens egna fält (label, theme, hours, tags) */
export const FL = FDEF.map(f => ({ ...THEME_INFO[f.theme], ...f }));
/** Platserna per våning – en egen kopia per våning (occ = vem som sitter där) */
/** @type {Spot[][]} */
export const SPOTS = FL.map(f => (THEME_INFO[f.theme].spots || []).map(s => ({ ...s })));
export const VISIT_WHY = FL.map(f => f.visit || '');
/** @type {Record<number, number[]>} */
export const FLOOR_HOURS = Object.fromEntries(FDEF.map((f, i) => [i, f.hours]).filter(([, h]) => h));
export function floorOpen(f, h) {
  const oh = FLOOR_HOURS[f];
  return !oh || (h >= oh[0] && h < oh[1]);
}
export const EL = BUILDING.elevators.map((e, i) => {
  // stops = våningarna där korgen (nedre däcket) stannar – hissens läge räknas alltid i dem
  const stops = e.serves ? e.serves.map(idx) : FDEF.map((_, k) => k);
  // dubbeldäck: övre däcket står en våning ovanför; folk på de våningarna åker övre däcket
  const upper = e.upper ? e.upper.map(idx) : [];
  if (upper.some((f, k) => f !== stops[k] + 1)) throw new Error(`hiss ${e.name}: övre däcket måste ligga en våning över varje stopp`);
  // serves = våningarna där FOLK kan kliva på och av; legs = vilka våningar man kan åka mellan (ett däck i taget)
  const serves = [...stops, ...upper].sort((a, b) => a - b);
  const legs = upper.length ? [stops, upper] : [stops];
  const minF = Math.min(...stops), maxF = Math.max(...stops), topF = maxF + (upper.length ? 1 : 0);
  // hem = där hissen vilar på natten och dit den kör vid brandåterkallning (entrén om den går dit)
  const home = e.home ? idx(e.home) : stops.includes(LOBBY) ? LOBBY : minF;
  return { ...e, id: i, serves, stops, upper, legs, deck2: upper.length > 0, minF, maxF, topF, startF: idx(e.start), home,
    group: e.group || 'alla', ratedKg: e.ratedKg || RATED_KG * (upper.length ? 2 : 1) };
});
/** korgens läge (nedre däckets våning) när den tar folk på våning f: en våning lägre för övre däcket */
export const carPos = (id, f) => (EL[id].upper.includes(f) ? f - 1 : f);
/** mellanplanet: övre däckets våning ovanför entrén (rulltrappa dit från entrén), eller -1 */
export const MEZZ = EL.some(d => d.upper.includes(LOBBY + 1) && d.stops.includes(LOBBY)) ? LOBBY + 1 : -1;

// ---------- Värld (geometri) ----------
export const FLOOR_H = 112;
export const ROOF_Y = 140, GROUND_Y = ROOF_Y + (FLOORS - LOBBY) * FLOOR_H; // GROUND_Y = entréns golv (gatan)
// schakten är medvetet breda: hissarna är husets huvudpersoner och tar mer plats än rummen
export const SHAFT_W = 104, SHAFT_GAP = 12;
const INSIDE = EL.filter(e => !e.facade);
const HAS_FACADE = EL.some(e => e.facade);
// schaktkolumnen för varje hiss: col i BUILDING (hissar i olika zoner kan dela kolumn), annars i tur och ordning
const COL = EL.map(e => (e.facade ? -1 : e.col ?? INSIDE.indexOf(e)));
for (const a of INSIDE) for (const b of INSIDE) {
  if (a !== b && COL[a.id] === COL[b.id] && a.minF <= b.topF && b.minF <= a.topF) throw new Error(`hissarna ${a.name} och ${b.name} krockar i samma schakt`);
}
export const NCOL = Math.max(...COL) + 1;
// rummen är alltid lika breda (x 60–619); huset växer åt höger med antalet schakt
export const SHAFT_X0 = 624, BX0 = 60;
const colX = c => SHAFT_X0 + c * (SHAFT_W + SHAFT_GAP);
export const BX1 = colX(NCOL) + 6 - SHAFT_GAP;
/** tornets högerkant på våning f: huset är bara så brett som schakten på den våningen behöver (indrag uppåt) */
export const TOWER_X1 = Array.from({ length: FLOORS }, (_, f) => {
  const cols = INSIDE.filter(e => f >= e.minF && f <= e.topF).map(e => COL[e.id]);
  // under sky lobbyn och i källaren behåller huset full bredd
  return f <= SKY ? BX1 : colX(Math.max(0, ...cols) + 1) + 6 - SHAFT_GAP;
});
/** första våningen ovanför sky lobbyn där tornet är smalt (där takterrassen ligger) */
export const SEAM_F = (() => { let f = SKY + 1; while (f < FLOORS && TOWER_X1[f] >= BX1) f++; return f; })();
export const W = BX1 + (HAS_FACADE ? SHAFT_W + 52 : 60), H = GROUND_Y + LOBBY * FLOOR_H + 60;
export const INNER_X1 = SHAFT_X0 - 5;
export const WAIT_X1 = SHAFT_X0 - 34;
export const STAIR_X = BX0 + 6;
// Bara grafik: bilden börjar här (rummen till vänster syns inte), och våningen visas som en
// hall framför schakten med en korridor in mot rummen.
export const LAND_X0 = 370, DOOR_X = LAND_X0 + 32;
// tunnelbanan: tåget stannar längs perrongens bakvägg mellan TRAIN_X0 och TRAIN_X1 (tunnelmynningar i båda ändar)
export const TRAIN_X0 = DOOR_X + 104, TRAIN_X1 = SHAFT_X0 - 8, TRAIN_LEN = TRAIN_X1 - TRAIN_X0;
export const CAR_W = SHAFT_W - 8, CAR_H = 84;
export const floorY = f => GROUND_Y - (f - LOBBY) * FLOOR_H; // golvlinjen för våning f (f får vara ett decimaltal)
export const surf = f => floorY(f) - 4;
/** vänsterkant för hiss i:s schakt (panoramahissen sitter utanpå fasaden) */
export const shaftX = i => (EL[i].facade ? BX1 + 22 : colX(COL[i]));
export const shaftCX = i => shaftX(i) + SHAFT_W / 2;

// ---------- Regler ----------
// Märklast: korgen rymmer 8 personer (platser) och 800 kg. Över 80 % räknas hissen som "full last"
// och passerar nya hämtningar – den stannar bara för att släppa av.
export const CAP = 8, VMAX = 2.6, ACC = 1.9, DOOR_T = 0.55, DWELL = 1.3, WALK = 150;
export const STOP_COST = 2 * DOOR_T + DWELL + VMAX / ACC;
// Energi: motvikten väger korgen + BALANCE × märklasten, och en våning är FLOOR_M meter hög (se service.js)
export const BALANCE = 0.45, FLOOR_M = 3.5;
export const MAXP = 240;
// Ett dygn går från 06:00 till 06:00 (timmarna räknas 6…30). Tiden går fortare på kvällen och natten.
export const START_H = 6, END_H = 30;
// Ett dygn tar 6 minuter i 1×: dagen 06–20 = 4 min, kvällen 20–22 = 30 s och natten 22–06 = 90 s.
// Hissarna rör sig i verklig takt – det är klockan som går fort (en hissresa tar en speltimme eller så).
/** spelsekunder per simuleringssekund */
export function timeScale(h) { return h >= 22 ? 320 : h >= 20 ? 240 : 210; }
// Det folk gör i rummen (jobba, fika, sova) räknas i speltid, som när ett dygn tog en halvtimme:
// rumstimrarna (p.timer i läget office) tickar activityRate(h) gånger fortare än simuleringen.
const ROOM_SCALE = h => (h >= 22 ? 120 : h >= 20 ? 60 : 30);
export const activityRate = h => timeScale(h) / ROOM_SCALE(h);
/** hur mycket en rumstimer hinner ticka ner mellan klockslagen h0 och h1 (tar hänsyn till att takten byts kl 20 och 22) */
export function roomUnits(h0, h1) {
  let u = 0, h = h0;
  for (const b of [20, 22, Infinity]) {
    if (h >= h1) break;
    if (h >= b) continue;
    const e = Math.min(h1, b);
    u += (e - h) * 3600 / ROOM_SCALE(h);
    h = e;
  }
  return u;
}
export const ROLE_NAMES = { 'väktare': 'Väktare', 'städare': 'Städare', 'vaktmästare': 'Vaktmästare', 'nattdj': 'Natt-DJ på Kanal 97', 'nattekniker': 'Nattekniker på Modemkungen', 'bud': 'Bud', 'hisstekniker': 'Hisstekniker', 'flyttgubbe': 'Flyttgubbe på Lyft & Bär', 'ambulans': 'Ambulanssjukvårdare' };

// ---------- Stamgästerna ----------
// Återkommande karaktärer: samma namn, utseende och egenheter varje dag (logiken finns i cast.js).
// at = när de kommer (anställda), resident = vilken boende som blir karaktären, quirk = egenheten.
/** @typedef {{ id: string, name: string, title: string, quirk: string, kind: string, home?: string, at?: number, leaveAt?: number,
 *   lunchAt?: number, resident?: string, speed?: number, look: object, lines: Record<string, string[]> }} CastDef */
/** @type {CastDef[]} */
export const CAST = [
  { id: 'gunnar', name: 'Gunnar', title: 'Delägare på Kvarnström Advokater – hatar att vänta', quirk: 'gnäll', kind: 'emp', home: 'law', at: 7.95, leaveAt: 17.55, lunchAt: 12,
    look: { skin: '#ffdbb8', shirt: '#ffffff', pants: '#3a3a3a', hair: 2, hairC: '#e8e8e8', tie: true, tieC: '#ff5d73', stripe: false, acc: 1 },
    lines: { wait: ['Femton sekunder! Jag debiterar 3 000 kr i timmen!', 'Det här ska jag skriva ett brev om.', 'I mitt förra hus gick hissarna på räls av guld!', 'Har någon ringt hissbolaget?!'],
      board: ['Äntligen.', 'Det var på tiden.', 'Mitt kaffe hann kallna.'] } },
  { id: 'doris', name: 'Doris', title: 'AD på Rymdkakan Reklambyrå – håller alltid upp dörren', quirk: 'dörr', kind: 'emp', home: '3', at: 8.15, leaveAt: 17.2, lunchAt: 11.6,
    look: { skin: '#a8693f', shirt: '#ff6fb5', pants: '#5a2a6e', hair: 4, hairC: '#ff4fa3', tie: false, tieC: '#ffd23f', stripe: true, acc: 0 },
    lines: { hold: ['Vänta, det kommer en till!', 'Spring, jag håller dörren!', 'Ingen fara, vi väntar!'] } },
  { id: 'kurt', name: 'Kurt', title: 'Nätverkstekniker på Modemkungen – lever på kaffe', quirk: 'kaffe', kind: 'emp', home: 'server', at: 7.6, leaveAt: 18.1, lunchAt: 99,
    look: { skin: '#f6c48f', shirt: '#4dd2ff', pants: '#1f6f8b', hair: 0, hairC: '#5a3412', tie: false, tieC: '#4dd2ff', stripe: false, acc: 0 },
    lines: { coffee: ['Kopp nummer {n}. Bara en till.', 'Kaffe nummer {n} – servrarna klarar sig en stund.', 'Kopp {n}! Koffein är också bandbredd.'] } },
  { id: 'fia', name: 'Fia', title: 'Instruktör på Svettis Aerobic – tar ALLTID trappan', quirk: 'trappa', kind: 'emp', home: 'aerobic', at: 7.25, leaveAt: 20.8, lunchAt: 12.4,
    look: { skin: '#d9a066', shirt: '#7cf06b', pants: '#ff5d73', hair: 3, hairC: '#d9a441', tie: false, tieC: '#7cf06b', stripe: true, acc: 0 },
    lines: { stairs: ['Trappan är gratis gym!', 'Hissar är för fusk! Hopp hopp!', 'Knälyft hela vägen upp!'] } },
  { id: 'majken', name: 'Majken', title: '87 år, bor på 13 – pratar med alla i hissen', quirk: 'pratig', kind: 'res', resident: 'pensioner', speed: 0.6,
    look: { skin: '#ffe4c8', shirt: '#b388ff', pants: '#6b4f2a', hair: 5, hairC: '#e8e8e8', tie: false, tieC: '#b388ff', stripe: false, acc: 0 },
    lines: { chat: ['Vad du har vuxit, {who}!', 'Visste du att jag var med när huset byggdes?', 'Det blir regn i morgon, det känner jag i knät.', 'Har du ätit ordentligt, {who}?', 'På min tid fanns det hissförare med mössa!'] } },
  { id: 'olle', name: 'Lill-Olle', title: '8 år, bor på 12 – älskar hissknappar', quirk: 'bus', kind: 'res', resident: 'child',
    look: { skin: '#ffdbb8', shirt: '#ffd23f', pants: '#2b2d6e', hair: 1, hairC: '#b8461f', tie: false, tieC: '#ffd23f', stripe: true, acc: 5 },
    lines: { buttons: ['Hihi! ALLA knappar!', 'Pip pip pip!', 'Jag är hisskapten!'], ride: ['Snabbare!', 'Vi är en raket!', 'Wiii!'] } },
  { id: 'pelle', name: 'Pizza-Pelle', title: 'Pizzabud – levererar till nattsändningen varje natt', quirk: 'pizza', kind: 'vis',
    look: { skin: '#7a4a2a', shirt: '#ff8c42', pants: '#3a3a3a', hair: 0, hairC: '#2a1a10', tie: false, tieC: '#ff8c42', stripe: true, acc: 0 },
    lines: { arrive: ['Pizza! Varm och god!', 'Kanal 97 – din kalzone är här!'] } },
];

export const STRAT_NAMES = { smart: 'SMART', peak: 'RUSNING', eco: 'ENERGISNÅL', nearest: 'NÄRMAST', random: 'KAOS', buttons: 'KNAPPAR' };
export const STRAT_HINT = {
  smart: '<b>Smart:</b> varje person får den hiss som snabbast kan hämta hen <i>och</i> köra till målet (resväg, stopp, last – rabatt om hissen redan ska dit). Omfördelar och parkerar lediga hissar smart.',
  peak: '<b>Rusning:</b> som Smart, men känner av trafikmönstret. På morgonen (UPP) kör lediga hissar direkt tillbaka till entrén och väntar en stund i dörren så att fler hinner med. Vid hemgång (NED) väntar de högst upp i sin zon.',
  eco: '<b>Energisnål:</b> som Smart, men räknar också ström. Varje hämtning kostar kWh efter lasten mot motvikten – en tom hiss som kör ner drar ström, en tom hiss som kör upp återmatar. Väljer helst hissar som redan är på väg, parkerar aldrig och låter lediga hissar sova även på dagen. Lite längre väntan, mindre el.',
  nearest: '<b>Närmast:</b> varje person får den hiss som är närmast just nu – oavsett riktning, mål eller last.',
  random: '<b>Kaos:</b> varje person får en slumpad hiss. Hur illa kan det gå?',
  buttons: '<b>Knappar:</b> vanliga hissknappar som i ett äldre hus. Styrsystemet ser bara ▲/▼ i hallen och våningsknapparna i korgen – inte vart folk ska. Alla kliver på första hissen åt rätt håll.',
};
export const FIRE_HINT = {
  none: 'Hissarna kör som vanligt – folk åker rakt genom röken i schakten. Farligt!',
  recall: 'Alla hissar kör direkt till sin hemvåning (oftast E), släpper ut alla och stängs av. Alla tar trapporna. Säkrast – men ingen hisstrafik alls.',
  zone: 'Hissarna kör bara under brandzonen. Den som ska högre upp tar trapporna. Hissar ovanför kör ner först.',
};
export const NAMES = ['Lisa', 'Omar', 'Kim', 'Sara', 'Johan', 'Fatima', 'Erik', 'Maja', 'Ali', 'Elsa', 'Nils', 'Amira', 'Oskar', 'Linnea', 'Ahmed', 'Ida', 'Viktor', 'Leila', 'Hugo', 'Tove', 'Mehmet', 'Agnes', 'Gustav', 'Noor', 'Emil', 'Saga', 'Pelle', 'Yasmin', 'Kalle', 'Frida', 'Anton', 'Zainab', 'Lars', 'Moa', 'Jonas', 'Hanna', 'Dani', 'Sven', 'Ebba', 'Ivan', 'Märta', 'Robin', 'Klara', 'Bosse', 'Wilma', 'Sami', 'Greta', 'Ludvig', 'Selma', 'Arvid', 'Nadia', 'Olle', 'Vera', 'Theo', 'Alva', 'Kent', 'Jenny', 'Tobbe', 'Sanna', 'Micke', 'Astrid', 'Bilal', 'Cecilia', 'David', 'Elin', 'Farah', 'Gösta', 'Hassan', 'Ingrid', 'Jakob', 'Karin', 'Leo', 'Mira', 'Nora', 'Otto', 'Pia', 'Rasmus', 'Sofia', 'Tariq', 'Ulla', 'Vilhelm', 'Yusuf', 'Åsa', 'Örjan', 'Liam', 'Hedda', 'Isak', 'Juni', 'Malte', 'Stina', 'Felix', 'Lova', 'Samir', 'Tilda', 'Vincent', 'Ellen', 'Kasper', 'Rut', 'Aron', 'Dalia'];
