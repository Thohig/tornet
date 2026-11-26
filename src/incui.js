// Incidenterna i gränssnittet: en post per incident (eller händelse som kan framkallas) med det som visas –
// knappen i Framkalla (panels.js), kortet i incidentrutan (hud.js) och vad regissören klipper till (director.js).
// Simuleringens sida står i registret i systems.js; en ny incident får en post där och en här.
// Rör aldrig simuleringens tillstånd: knapparna går via data-act och act().
//
// Översikt:
// `incui.js` – incidenterna i gränssnittet: `incUi()` = en post per incident eller händelse som kan framkallas –
// knappen i *Framkalla* `trig` (`off` = grå, `why` = varför, i verktygstipset), kortet `card` (`late` = efter
// informationsrutorna), förvarningens klipp `warn` och det sevärda `shots`; panels.js, hud.js och director.js går
// igenom listan
import { esc, fl } from './util.js';
import { DOCK, EL, FIRE_HINT, LOBBY, ROOF, TOP, CONTROL, STATION, FL, floorWith } from './config.js';
import { S } from './state.js';
import { canRescue } from './incidents.js';
import { STORM_HINT, windMs } from './weather.js';
import { FAN_KW } from './service.js';
import { LADDER_MAX, PANO, ladderReach, panoCandidate, ropeWindy } from './pano.js';
import { gondolaCandidate, gondolaWindy } from './gondola.js';
import { dogPossible } from './dog.js';
import { leakPossible, SPREAD_S } from './leak.js';
import { BANK, GOLD, VAN_NAME, heistBlock } from './heist.js';
import { sv } from './sv.js';
import { sh } from './lang.js';
import { BOOT_S, crashPossible } from './crash.js';
import { onPlatform, tunnelPossible } from './tunnel.js';
import { panicPossible, panicWhere } from './panic.js';
import { partyPossible } from './party.js';
/** panoramahissen (null om huset saknar en) */
const panoCar = () => (PANO ? S.elevators[PANO.id] || null : null);

/**
 * En incident i gränssnittet. Allt är frivilligt utom key (= nyckeln i registret systems.js och i act('trigger', key)).
 * - trig: knappen i Framkalla (ikon, namn, förklaring; off() = går inte nu) – i listans ordning
 * - card(h, parts): lägger kortet i incidentrutan (h = hjälpen i hud.js: card, chiefLine, cd, num, ikon och byggstenarna
 *   line = en rad text, acts = raden med knappar, hint = förklaringen, choice = ett val, followCar = kameran på hissen); late = efter informationsrutorna
 * - warn(W, add, h): förvarningen – vart regissören klipper (add som i director.js)
 * - shots(add, h): det som är sevärt medan incidenten pågår (h = visible, name1)
 * - sound: ljudet (sound.js, score.js) – warn = ljudeffekten när förvarningen kommer, on = [stämpel, ljudeffekt]: effekten
 *   spelas när stämpeln (en tid, null = inget) ändras, piece = husmusikens stycke medan den pågår (null = som vanligt)
 * @typedef {'thunder'|'strike'|'buzz'|'strain'|'alarm'|'siren'} IncSound
 * @typedef {{ key: string, late?: boolean, trig?: { icon: string, name: string, hint: string, off?: () => boolean, why?: () => string },
 *   card?: (h: any, parts: any[]) => void, warn?: (W: any, add: Function, h: any) => void, shots?: (add: Function, h: any) => void,
 *   sound?: { warn?: IncSound, on?: [() => number|null|undefined|false, IncSound][], piece?: () => string|null } }} IncUi
 */

const top = () => (ROOF >= 0 ? ROOF : TOP);

/** @type {IncUi[]|null} */
let list = null;
/** alla poster (i knapparnas ordning) */
export function incUi() {
  return list ??= [
    // (brandens knapp står för sig i Framkalla, med våningsväljaren – trigHtml i panels.js)
  {
    key: 'fire',
    late: true,
    sound: { on: [[() => S.fire && S.fire.t0, 'alarm'], [() => S.brigade && S.brigade.t0, 'siren']] },
    warn: (W, add) => add('warn', 90, 'floor', W.floor, sv`👃 Det luktar bränt på ${fl(W.floor)}`, true),
    card: (h, parts) => {
      const { card, chiefLine, cd, num, bold, ikon, line, acts, hint, choice } = h;
      if (S.fire) {
        const F = S.fire, zmax = Math.max(0, F.floor - 2);
        const status = !F.brigade ? sh`Brandkåren är på väg – framme ${cd(F.brigadeAt - S.t)}`
          : F.outAt === null ? sv`Brandmännen är på väg upp${S.brigade && S.brigade.car !== null ? ` i brandhissen ${esc(S.elevators[S.brigade.car].name)}` : ' i trapphuset'}`
          : sh`Brandkåren släcker – klart ${cd(F.outAt - S.t)}`;
        const outside = S.people.filter(p => p.state === 'assembly').length;
        const b = (m, txt) => choice(`fire:${m}`, txt, { on: F.mode === m });
        parts.push(card('fire', 'fire', sv`🔥 Brand på våning ${fl(F.floor)}`, `
          ${line(sh`${status}. Våning ${fl(F.floor - 1)}–${fl(TOP)} utryms.`)}
          ${line(sh`Rökexponerade: ${bold(num(F.smoked))} · Utrymda: ${bold(num(F.evac))}${outside ? sh` · På återsamlingsplatsen: ${bold(num(outside))}` : ''}`)}
          ${chiefLine('fire', 'Larmet återkallade hissarna – vill du köra dem annorlunda?')}
          ${acts(b('recall', '🚒 Brandåterkallning'), b('zone', sv`🚧 Bara E–${fl(zmax)}`), b('none', 'Normal drift'))}
          ${hint(FIRE_HINT[F.mode])}
          ${acts(ikon(`show:${F.floor}`, '📍', 'Visa våningen', 'Kameran går till våningen som brinner'))}`, true));
      }
    },
    shots: (add, h) => {
      const { visible } = h;
      // (samma nyckel hela branden: när brandmännen är framme visar våningen dem med slangen – eller stegbilens stege)
      if (S.fire) add('fire', 100, 'floor', S.fire.floor, S.fire.outAt === null ? sv`🔥 Brand på ${fl(S.fire.floor)}`
        : S.people.some(p => p.ff && p.state === 'office' && p.floor === S.fire.floor) ? sv`🚒 Brandmännen släcker på ${fl(S.fire.floor)}`
        : sv`🚒 Stegbilen släcker ${fl(S.fire.floor)} utifrån`, S.t - S.fire.t0 < 2);
      // brandbilen kör in med blåljus på gatan (pixbuilding.js) strax innan kåren är framme
      if (S.fire && Math.abs(S.fire.brigadeAt + 1.5 - S.t) < 5) add('engine', 104, 'street', 0, S.fire.brigade ? '🚒 Brandmännen springer in' : '🚒 Brandbilen kommer', !S.fire.brigade);
      // brandmännen på väg upp (i brandhissen eller trapphuset), och tillbaka till bilen när det är släckt
      const ff = S.people.find(p => p.ff && !p.dead && p.state !== 'office' && visible(p));
      if (ff && S.fire) add('ff', 92, 'person', ff.id, '🚒 Brandmännen går in');
      else if (ff && S.brigade) add('ffout', 48, 'person', ff.id, '🚒 Brandmännen går tillbaka till bilen');
    },
  },
  {
    key: 'power',
    late: true,
    sound: { warn: 'buzz' },
    trig: { icon: '⚡', name: 'Strömavbrott', hint: 'Strömmen går i hela huset' },
    warn: (_W, add) => add('warn', 80, 'floor', LOBBY, '💡 Lamporna flimrar…', true),
    card: (h, parts) => {
      const { card, chiefLine, chiefOn, cd, num, bold, line, acts, hint, choice } = h;
      if (!S.power && S.outage) {
        const O = S.outage;
        const trapped = S.elevators.filter(e => e.mode === 'normal').reduce((a, e) => a + e.passengers.length, 0);
        const gen = O.gen ? choice('pow:gen', '🔋 Reservkraft igång', { on: true, off: true })
          : O.genAt !== null ? choice('pow:gen', sh`🔋 Startar ${cd(O.genAt - S.t)}`, { off: true })
            : choice('pow:gen', '🔋 Starta reservkraft');
        const stuck = S.elevators.filter(e => e.mode === 'normal' && e.passengers.length && !(e.state === 'doors' && e.door >= 0.95));
        const busy = O.busy !== null ? sv`Nödsänker hiss ${EL[O.busy].name} just nu…` : O.gen ? 'Välj vilken hiss som ska nödsänkas nedan – eller slå på auto.' : '';
        parts.push(card('power', 'power', '⚡ Strömavbrott', `
          ${line(sh`Strömmen tillbaka ${cd(O.backAt - S.t)} · Instängda nu: ${bold(num(trapped))} · Instängd-sek idag: ${bold(num(S.stats.trappedSec))}`)}
          ${chiefLine('power', 'Vad gör du?')}
          ${acts(gen, choice('pow:auto', sv`Auto-räddning: ${O.auto ? 'PÅ' : 'AV'}`, { on: O.auto, off: !O.gen }))}
          ${acts(...stuck.map(e => choice(`pow:rescue:${e.id}`, sv`Nödsänk ${e.name} (${e.passengers.length} inne)`, { off: !canRescue(e), size: 'xs hot2' })))}
          ${hint(busy || (chiefOn() ? 'Reservkraften räcker till EN hiss i taget – driftchefen nödsänker fullaste hissen först (ambulanspersonalen allra först).'
            : 'Utan åtgärd sitter folk fast tills strömmen kommer tillbaka. Reservkraften räcker till EN hiss i taget – välj ordning, t.ex. fullaste först.'))}`, true));
      }
    },
  },
  {
    key: 'storm',
    sound: { warn: 'thunder', on: [[() => S.storm && S.storm.struck, 'strike']] }, // (blixten slår ner: nära åska)
    trig: { icon: '🌬️', name: 'Storm', hint: 'Ett oväder: de höga schakten svajar' },
    warn: (_W, add) => add('warn', 80, 'floor', top(), '🌥️ Ovädret drar in', true),
    card: (h, parts) => {
      const { card, chiefLine, cd, num, bold, line, acts, hint, choice, followCar } = h;
      // ---------- stormen (incident med val, som branden) ----------
      if (S.storm) {
        const St = S.storm, P = S.elevators.find(e => e.facade);
        const b = (m, txt) => choice(`storm:${m}`, txt, { on: St.mode === m });
        parts.push(card('storm', 'storm', sh`🌬️ Storm – ${num(windMs())} m/s`, `
          ${line(sh`De höga schakten och panoramahissen på fasaden svajar. Bedarrar ${cd(St.t0 + St.len - S.t)}.${St.faults ? sh` Vajerlarm: ${bold(num(St.faults))}` : ''}`)}
          ${chiefLine('storm', 'Hur ska hissarna köras?')}
          ${acts(b('sway', '🌬️ Svajläge'), b('none', 'Kör som vanligt'))}
          ${hint(STORM_HINT[St.mode])}
          ${P ? acts(followCar(P, 'Visa panoramahissen')) : ''}`, true));
      }
    },
  },
  {
    key: 'lightning',
    trig: { icon: '⛈️', name: 'Blixt', hint: 'Blixten slår ner (och ibland ut strömmen)' },
  },
  {
    key: 'fault',
    sound: { warn: 'strain' },
    trig: { icon: '🔧', name: 'Hissfel', hint: 'En slumpad hiss går sönder' },
    warn: (W, add) => add('warn', 86, 'car', W.car, sv`🔩 ${S.elevators[W.car].name} gnisslar`, true),
  },
  {
    key: 'heat',
    sound: { warn: 'strain' },
    trig: { icon: '🌡️', name: 'Het motor', hint: 'En motor överhettas' },
    warn: (W, add) => add('warn', 82, 'floor', Math.min(top(), S.elevators[W.car].maxF), sv`🌡️ Motorn i ${S.elevators[W.car].name} brummar`, true),
    card: (h, parts) => {
      const { card, chiefLine, motorC, line, acts, hint, choice, followCar } = h;
      // ---------- överhettade motorer (incident: extrafläkt) ----------
      for (const e of S.elevators) {
        if (!e.hot) continue;
        parts.push(card(`heat-${e.id}`, 'heat', sv`🌡️ Motorn i hiss ${esc(e.name)} är överhettad`, `
          ${line(`Överhettningsskyddet har löst ut (<span class="lv">${motorC(e)}</span> °C): ${esc(e.name)} kör klart sina passagerare men tar inga nya förrän motorn har svalnat.`)}
          ${chiefLine(`heat${e.id}`, 'Starta extrafläkten?')}
          ${acts(choice(`fan:${e.id}`, `🌀 ${e.fan ? 'Extrafläkten går' : 'Starta extrafläkt'}`, { on: e.fan, off: e.fan }), followCar(e))}
          ${hint(sv`Fläkten kyler ungefär fyra gånger snabbare men drar ${FAN_KW} kW. Smart och Energisnål undviker varma motorer, Rusning tar risken längre, och Närmast, Kaos och Knappar bryr sig inte alls.`)}`, true));
      }
    },
  },
  {
    key: 'cable',
    sound: { warn: 'strain' },
    trig: { icon: '🪢', name: 'Linbrott', hint: 'Linorna går av i en hiss' },
    warn: (W, add) => add('warn', 86, 'car', W.car, sv`🪢 Linorna i ${S.elevators[W.car].name} knarrar`, true),
  },
  {
    key: 'pano',
    trig: { icon: '🧗', name: 'Fast på fasaden', hint: 'Panoramahissen fastnar utanför huset – de instängda måste firas ner',
      off: () => { const P = panoCar(); return !P || !!S.pano || !!P.panoNext || !panoCandidate(P); },
      why: () => { const P = panoCar(); return S.pano ? 'panoramahissen sitter redan fast' : P && P.panoNext ? 'den hackar redan – den fastnar nästa gång den kör med folk' : 'panoramahissen kör inte som vanligt just nu'; } },
    warn: (W, add) => add('warn', 86, 'car', W.car, sv`🔩 ${S.elevators[W.car].name} hackar på fasaden`, true),
    card: (h, parts) => {
      const { card, chiefLine, cd, line, acts, hint, choice, followCar } = h;
      // ---------- panoramahissen sitter fast på fasaden (incident med val: rep eller stegbil) ----------
      const Pn = S.pano, P = panoCar();
      // framkallad (eller förvarnad) men inte fast än: den fastnar nästa gång den kör med folk mellan två våningar
      if (!Pn && P && P.panoNext) parts.push(card('pano-wait', 'info pano', sv`🔩 ${esc(P.name)} hackar på fasaden`, `
          ${line(sv`Det luktar hydraulolja. Nästa gång ${esc(P.name)} kör med folk utanpå huset låser sig hydrauliken${P.passengers.length ? ' – det har den folk i nu' : ' – just nu står den och väntar på resenärer'}.`)}
          ${acts(followCar(P))}`));
      if (Pn && Pn.ph !== 'done') {
        const e = S.elevators[Pn.car], reach = ladderReach(e), windy = ropeWindy();
        const b = (how, txt, ok, why) => choice(`pano:${how}`, txt, { on: Pn.how === how, off: !ok, why });
        // alla är ute (räddarna packar ihop innan det är klart, pano.js): inga val kvar
        const left = e.passengers.length + (Pn.rider ? 1 : 0), allOut = Pn.n > 0 && left === 0 && Pn.out >= Pn.n;
        const status = allOut ? sv`Alla ${Pn.n} är ute – räddarna packar ihop.`
          : !Pn.crew ? sh`Räddningstjänsten är på väg – framme ${cd(Pn.crewAt - S.t)}.`
          : !Pn.how ? 'Räddningstjänsten är på plats och väntar på besked.'
          : Pn.ph === 'stuck' ? (Pn.how === 'rope' ? 'Räddarna är på väg upp på taket med repet.' : 'Stegbilen ställer sig under korgen.')
          : Pn.ph === 'rig' ? (Pn.how === 'rope' ? 'Räddarna riggar repet ovanför korgen.' : 'Stegen reses mot korgen.')
          : Pn.rider ? sv`${esc((S.people.find(p => p.id === Pn.rider.id) || { name: 'Någon' }).name)} ${Pn.setup === 'rope' ? 'firas ner' : 'klättrar ner'} – ${Pn.out}/${Pn.n} ute.`
          : Pn.setup === 'rope' && windy ? sv`För blåsigt för repet (${windMs()} m/s) – räddarna väntar på taket. ${Pn.out}/${Pn.n} ute.` : `${Pn.out}/${Pn.n} ute.`;
        parts.push(card('pano', 'pano', sv`🧗 ${esc(e.name)} sitter fast på fasaden`, `
          ${allOut ? line(sv`Hydrauliken har låst sig och korgen hänger tom utanpå huset. ${status}`)
          : line(`Hydrauliken har låst sig och korgen hänger utanpå huset med <span class="lv">${left}</span> instängda. Den går inte att veva ner – de måste ut utanpå huset. ${status}`)}
          ${chiefLine('pano', 'Hur ska de instängda ut?')}
          ${acts(allOut ? '' : b('rope', '🧗 Rep från taket', true, sv`Räddarna firar ner en i taget ${Pn.toF === LOBBY ? 'till gatan' : 'till takterrassen'} – stannar i hård vind`),
            allOut ? '' : b('ladder', '🚒 Stegbilen', reach, reach ? 'Stegen från gatan – fungerar i blåst' : sv`Stegen når bara ${LADDER_MAX} våningar upp`), followCar(e))}
          ${hint('Repet går fortare när det är lugnt; stegbilen klarar blåsten men når inte högt. Teknikern kan inte laga hydrauliken förrän alla är ute.')}`, true));
      }
    },
    shots: (add) => {
      // panoramahissen fast på fasaden: korgen, repet och den som firas ner (pano.js)
      const Pn = S.pano;
      if (Pn && Pn.ph !== 'done') {
        const pe = S.elevators[Pn.car], rider = Pn.rider ? S.people.find(p => p.id === Pn.rider.id) : null;
        if (rider) add('pano', 94, 'person', rider.id, `🧗 ${rider.name} ${Pn.setup === 'rope' ? 'firas ner längs fasaden' : 'klättrar nerför stegen'} (${Pn.out + 1}/${Pn.n})`, S.t - Pn.rider.t0 < 0.6);
        else add('pano', Pn.ph === 'stuck' ? 86 : 84, 'car', pe.id, Pn.ph === 'rig' ? (Pn.how === 'rope' ? sv`🧗 Räddarna riggar repet ovanför ${pe.name}` : sv`🚒 Stegbilen reser stegen mot ${pe.name}`)
          : sv`🛗 ${pe.name} sitter fast på fasaden · ${pe.passengers.length} instängda`, S.t - Pn.t0 < 2);
      }
    },
  },
  {
    key: 'medical',
    trig: { icon: '🚑', name: 'Ambulans', hint: 'Någon svimmar' },
  },
  {
    key: 'move',
    trig: { icon: '🚚', name: 'Flytt', hint: 'Ett hushåll flyttar' },
  },
  {
    key: 'vip',
    trig: { icon: '🚁', name: 'VIP', hint: 'VIP-helikoptern landar' },
  },
  {
    key: 'train',
    trig: { icon: '🚇', name: 'Tågstörning', hint: 'Tåget blir försenat' },
  },
  {
    key: 'cold',
    trig: { icon: '❄️', name: 'Kyla', hint: 'En kall dag: dörrarna i entrén tar emot' },
  },
  {
    key: 'heatwave',
    trig: { icon: '☀️', name: 'Värmebölja', hint: 'Motorerna kyls sämre' },
  },
  {
    key: 'heist',
    // polisens siren när de kommer, och ragtime som i en stumfilmsjakt medan kuppen pågår
    sound: { on: [[() => S.heist && S.heist.police ? S.heist.policeAt : null, 'siren']], piece: () => (S.heist && S.heist.ph !== 'done' ? 'rag' : null) },
    trig: { icon: '🚐', name: 'Kupp!', hint: 'Ett rånargäng tar över huset för att tömma valvet på 5:an. Är lastkajen upptagen väntar gänget tills den är ledig', off: () => !!(S.heist || S.heistWait !== null), why: () => (S.heist ? 'kuppen pågår redan' : 'gänget väntar redan på sin chans') },
    warn: (_W, add) => add('warn', 84, 'floor', DOCK, '🚐 En skåpbil vid lastkajen…', true),
    card: (h, parts) => {
      const { card, chiefLine, cd, num, bold, ikon, line, acts, hint, choice } = h;
      // ---------- Kuppen på 5:an (incident med val: polisens insatsledare – eller du) ----------
      // framkallad men lastkajen är upptagen: skåpbilen kör runt kvarteret (heist.js, orderHeist)
      if (S.heistWait !== null && !S.heist) parts.push(card('heist-wait', 'info heist', '🚐 En skåpbil kör runt kvarteret', `
          ${line(sv`Fem män i overall från ${esc(VAN_NAME)} väntar ${heistBlock()}. Sedan backar de in vid lastkajen.`)}
          ${acts(ikon(`show:${DOCK}`, '📍', 'Visa lastkajen', 'Kameran går till lastkajen'))}`));
      const Hs = S.heist;
      if (Hs && Hs.ph !== 'done') {
        const gang = S.people.filter(p => p.robber && !p.dead).length, host = S.people.filter(p => p.hostage).length;
        const hero = S.people.find(p => p.id === Hs.hero && !p.dead);
        const status = Hs.ph === 'in' ? sv`En skåpbil från ${esc(VAN_NAME)} vid lastkajen – fem män i overall är på väg in.`
          : Hs.ph === 'flee' ? `<b>Valvet är öppet!</b> Gänget flyr med ${GOLD} guldtackor.`
          : sh`Gänget har driftcentralen och hissarna. Borren i valvet: ${num(Hs.drill * 100)} %${S.t < Hs.drillOff ? sh` – ${bold('tyst')}, någon har slagit av strömmen till den!` : '.'}`;
        const pol = !Hs.police ? 'Polisen är på väg.' : sh`Polisen spärrar gatan – insatsstyrkan går in via ${Hs.plan === 'garage' ? 'garaget' : 'taket'} ${cd(Hs.stormAt - S.t)}.`;
        const b = (a, txt, on, why, off = false) => choice(`heist:${a}`, txt, { on, off, why });
        const off = !Hs.police;
        parts.push(card('heist', 'heist', sv`🚐 Rån i Tornet – ${gang} rånare, ${host} gisslan`, `
          ${line(`${status} ${pol}${hero ? sh` ${bold(esc(hero.name))} blev över och smyger i trapporna.` : ''}`)}
          ${chiefLine('heist', 'Vad ska polisen göra?')}
          ${acts(b('wait', '⏳ Vänta ut dem', Hs.power === 'wait', 'Strömmen stannar på – borren tar tid', off),
            b('cut', '🔌 Klipp strömmen', Hs.power === 'cut', 'Hissarna stannar – men valvets magnetlås släpper också!', off || Hs.power === 'cut'))}
          ${acts(b('garage', '🚓 In via garaget', Hs.plan === 'garage', 'Insatsstyrkan går in vid lastkajen – skåpbilen kommer ingenstans', off),
            b('tak', '🚁 In via taket', Hs.plan === 'tak', 'Polishelikoptern på taket – ingen flykt den vägen', off),
            b('storm', '⚡ Gå in nu!', false, 'Insatsstyrkan går in direkt', off))}
          ${acts(b('stop', '🚇 Stoppa tåget', Hs.train === 'stop', 'Tunnelbanan stannar i tunneln – ingen flykt den vägen', off || Hs.train === 'stop'),
            ikon(`show:${BANK}`, '💰', 'Visa valvet', 'Kameran visar banken'),
            hero ? ikon(`person:${hero.id}`, '🤫', sv`Följ ${esc(hero.name)}`, 'Kameran följer den som blev över') : '')}
          ${hint('Gänget flyr med skåpbilen, en helikopter på taket eller tunnelbanan – den väg som inte är spärrad. Ingen skjuter och ingen dör.')}`, true));
      }
    },
    shots: (add, h) => {
      const { visible, name1 } = h;
      // kuppen: skåpbilen och gänget, borren i valvet, den som blev över i trapporna, flykten och polisen
      const Hs = S.heist;
      if (Hs) {
        const hero = S.people.find(p => p.id === Hs.hero && !p.dead);
        if (Hs.ph === 'in') add('heist', 99, 'floor', DOCK, '🚐 Fem män i overall vid lastkajen', S.t - Hs.t0 < 1);
        else if (Hs.ph === 'hold' && S.t - Hs.holdT < 6) add('heist', 100, 'floor', CONTROL, '🚐 RÅN! Gänget tar driftcentralen', S.t - Hs.holdT < 1);
        else if (Hs.ph === 'flee') add('heist', 100, 'floor', Hs.fleeF, '💰 Gänget flyr med guldet', S.t - Hs.fleeT < 1);
        else if (Hs.ph === 'done' && Hs.caught) add('heist', 70, 'floor', LOBBY, '🚓 Gänget leds ut i handfängsel');
        else if (Hs.ph === 'hold') {
          if (hero && hero.state !== 'office' && visible(hero)) add('hero', 94, 'person', hero.id, sv`🤫 ${name1(hero)} smyger i trapporna`);
          else if (hero && Hs.heroStep === 4) add('hero', 92, 'person', hero.id, sv`🔦 ${name1(hero)} signalerar till polisen`);
          add('vault', 80, 'floor', BANK, S.t < Hs.drillOff ? '🔌 Borren har tystnat!' : sv`💰 Borren i valvet: ${Math.round(Hs.drill * 100)} %`);
          if (Hs.police && Hs.stormAt - S.t < 8) add('storm', 98, 'floor', Hs.plan === 'garage' ? DOCK : ROOF >= 0 ? ROOF : TOP, '🚓 Insatsstyrkan går in!', true);
        }
      }
    },
  },
  {
    key: 'gondola',
    trig: {
      icon: '🪟', name: 'Gondolen kärvar', hint: 'Fönsterputsarens gondol fastnar mitt på fasaden – bara när han är ute och putsar (ungefär 08–16)',
      off: () => !!S.gondola || !gondolaCandidate(),
      why: () => (S.gondola ? 'gondolen sitter redan fast' : S.fire ? 'det brinner i huset' : !S.power ? 'strömmen är borta' : 'fönsterputsaren är inte ute och putsar just nu'),
    },
    warn: (_W, add) => add('warn', 82, 'cleaner', 0, '🔩 Det gnisslar i gondolens vinsch', true),
    card: (h, parts) => {
      const { card, chiefLine, cd, line, acts, hint, choice } = h;
      // ---------- fönsterputsaren sitter fast i gondolen (incident med val: veva, lastluckan eller rep) ----------
      const Gd = S.gondola;
      if (Gd && Gd.ph === 'stuck') {
        const hn = esc((S.people.find(p => p.role === 'fönsterputsare' && p.crewId && !p.dead) || { name: 'Fönsterputsaren' }).name);
        const jan = S.people.find(p => p.id === Gd.jan && !p.dead), windy = gondolaWindy();
        const b = (how, txt, ok, why) => choice(`gondola:${how}`, txt, { on: Gd.how === how, off: !ok, why });
        const status = !Gd.how ? sh`${hn} väntar på besked – annars ringer han själv vaktmästaren ${cd(Gd.t0 + 16 - S.t)}.`
          : Gd.how === 'rope' ? (Gd.ropeY !== null ? sv`${hn} firas ner till takterrassen.` : !Gd.crew ? 'Räddningstjänsten är på väg.' : Gd.rigged ? (windy ? 'För blåsigt för repet – räddarna väntar.' : 'Repet är riggat.') : 'Räddarna riggar ett rep på taket.')
          : !jan ? 'Vaktmästaren är på väg.'
          : jan.floor !== jan.duty?.f || jan.state !== 'office' ? sv`${esc(jan.name)} är på väg ${Gd.how === 'hatch' ? sv`till lastluckan på ${fl(Gd.hatchF)}` : 'upp på taket'}.`
          : Gd.how === 'hatch' ? (windy ? sv`För blåsigt för att öppna luckan – ${esc(jan.name)} väntar.` : sv`${esc(jan.name)} öppnar lastluckan.`) : sv`${esc(jan.name)} vevar upp gondolen för hand.`;
        parts.push(card('gondola', 'gondola', sv`🪟 ${hn} sitter fast i gondolen`, `
          ${line(sv`Vinschen har kärvat och gondolen hänger utanför våning ${fl(Gd.f)}. Stegbilen når inte så högt, och takskenan är upptagen så länge – hissbalken kan inte köra. ${status}`)}
          ${chiefLine('gondola', 'Hur ska han ner?')}
          ${acts(b('crank', '🔧 Veva upp', true, 'Vaktmästaren vevar upp gondolen för hand från taket – säkert men långsamt, går i blåst'),
            b('hatch', '🪟 Lastluckan', Gd.hatchF >= 0, Gd.hatchF >= 0 ? sv`Vaktmästaren öppnar lastluckan på ${fl(Gd.hatchF)} och Hasse kliver in – snabbt, men inte i blåst` : 'Gondolen hänger inte vid någon lastlucka'),
            b('rope', '🧗 Räddningstjänsten', true, 'Räddarna firar ner honom med rep från taket till takterrassen – stannar i hård vind'))}
          ${hint('När Hasse är nere går han av passet för dagen, och gondolen vevas upp tom.')}`, true));
      }
    },
    shots: (add) => {
      // fönsterputsaren som sitter fast (gondola.js): gondolen, och Hasse i repet
      const Gs = S.gondola;
      if (Gs && Gs.ph === 'stuck') {
        const h = S.people.find(p => p.role === 'fönsterputsare' && p.crewId && !p.dead);
        if (Gs.ropeY !== null && h) add('gondola', 92, 'person', h.id, sv`🧗 ${h.name} firas ner till takterrassen`);
        else add('gondola', 84, 'cleaner', 0, Gs.how === 'crank' && S.t - Gs.t0 > 20 ? '🪟 Gondolen vevas upp – en våning i taget' : sv`🪟 ${h ? h.name : 'Fönsterputsaren'} sitter fast i gondolen`, S.t - Gs.t0 < 2);
      }
    },
  },
  {
    key: 'dog',
    trig: { icon: '🐕', name: 'Hunden rymmer', hint: 'En pudel sliter sig ur kopplet (eller smiter ut ur kenneln på Vovve Spa) och springer runt i huset', off: () => !!S.dog || !dogPossible(), why: () => (S.dog ? 'en hund är redan lös' : S.fire ? 'det brinner i huset' : 'strömmen är borta') },
    warn: (_W, add) => add('warn', 78, 'floor', floorWith('spa'), '🐕 Det skäller på Vovve Spa', true),
    card: (h, parts) => {
      const { card, chiefLine, ikon, line, acts, hint, choice } = h;
      // ---------- den lösa hunden (incident med val: låt den åka eller spärra hissarna där den är) ----------
      const Dg = S.dog;
      if (Dg && Dg.ph === 'loose') {
        const dog = S.people.find(p => p.id === Dg.dog && !p.dead);
        const chasers = S.people.filter(p => !p.dead && (p.chase || (p.duty && p.duty.kind === 'dog')));
        const riding = dog && (dog.state === 'ride' || dog.state === 'boarding');
        const task = dog && dog.state === 'office' && dog.task ? ` – ${esc(dog.task)}` : '';
        const where = riding ? sv`åker ${dog.car ? esc(dog.car.name) : 'hiss'} mot ${fl(dog.dest)}` : sv`är på ${fl(Dg.f)}${task}`;
        const b = (w, txt, on, why) => choice(`dog:${w}`, txt, { on, why });
        parts.push(card('dog', 'dog', sv`🐕 ${esc(Dg.name)} är lös i huset`, `
          ${line(sv`Pudeln ${where}. ${chasers.map(p => esc(p.name)).join(' och ') || 'Ingen'} jagar henne.${Dg.tired ? ' Hon är trött och har lagt sig.' : ''} Våningar: ${Dg.floors.length} · hissresor: ${Dg.rides}.`)}
          ${chiefLine('dog', 'Ska hissarna spärras där hunden är?')}
          ${acts(b('free', '🐕 Låt henne åka', !Dg.lock, 'Hissarna går som vanligt – jakten kan ta en stund'),
            b('lock', sv`🚫 Spärra hissarna på ${fl(Dg.f)}`, Dg.lock, 'Ingen ny kliver på där hunden är – den kommer ingenstans, men den som väntar där får ta trappan'),
            dog ? ikon(`person:${dog.id}`, '📹', sv`Följ ${esc(Dg.name)}`, 'Kameran följer hunden') : '')}
          ${hint('Hunden fångas när någon som jagar henne hinner fram medan hon står still. Till slut blir hon trött och lägger sig.')}`, true));
      }
    },
    shots: (add) => {
      // den lösa hunden (dog.js): följ pudeln
      const Dg = S.dog;
      if (Dg && Dg.ph === 'loose') {
        const dog = S.people.find(p => p.id === Dg.dog && !p.dead);
        if (dog) add('dog', 80, 'person', dog.id, sv`🐕 ${Dg.name} springer runt i huset${Dg.tired ? ' – nu ligger hon och flämtar' : ''}`, S.t - Dg.t0 < 2);
      }
    },
  },
  {
    key: 'leak',
    trig: { icon: '🚿', name: 'Vattenläcka', hint: 'Ett vattenrör spricker på en slumpad våning – vattnet rinner nedåt och in i hisschakten', off: () => !!S.leak || !leakPossible(), why: () => 'en läcka pågår redan' },
    warn: (_W, add) => add('warn', 76, 'floor', DOCK, '💧 Det knackar i rören', true),
    card: (h, parts) => {
      const { card, chiefLine, cd, bold, ikon, line, acts, hint, choice } = h;
      // ---------- vattenläckan (incident med val: de blöta hissarna står still eller kör vidare) ----------
      const Lk = S.leak;
      if (Lk && Lk.ph === 'leak') {
        const jan = S.people.find(p => p.id === Lk.jan && !p.dead);
        const cars = Lk.cars.map(id => esc(S.elevators[id].name)).join(', ') || 'inga';
        const green = Lk.green ? ' i labbet – vattnet är grönt' : '';
        const shorts = Lk.shorts.length ? sh` Kortslutna: ${bold(Lk.shorts.map(id => esc(S.elevators[id].name)).join(', '))}.` : '';
        const status = Lk.shut ? sv`Huvudkranen är stängd – golven torkar.${Lk.cars.length ? ' Teknikern går igenom de blöta schakten.' : ''}`
          : !jan ? 'Vaktmästaren är på väg.'
          : jan.floor === DOCK && jan.state === 'office' ? sv`${esc(jan.name)} vrider om huvudkranen i pannrummet.`
          : sh`${esc(jan.name)} springer ner till pannrummet på ${fl(DOCK)} för att stänga huvudkranen. Vattnet når nästa våning ${cd(Lk.nextAt - S.t)}.`;
        const b = (m, txt, why) => choice(`leak:${m}`, txt, { on: Lk.mode === m, off: Lk.shut, why });
        const showLeak = ikon(`show:${Lk.src}`, '📹', 'Visa läckan', 'Kameran visar våningen där röret sprack');
        parts.push(card('leak', 'leak', sv`🚿 Vattenläcka på ${fl(Lk.src)}`, `
          ${line(sh`Ett rör har spruckit${green}. Blött: ${bold(Lk.wet.map(fl).join(', '))}. Hissar i blöta schakt: ${cars}.${shorts} ${status}`)}
          ${Lk.shut ? hint('Hissarna kör som vanligt igen.') + acts(showLeak) : `${chiefLine('leak', 'Ska hissarna i de blöta schakten köra?')}
          ${acts(b('stop', '🛑 Stoppa de blöta hissarna', 'De tas ur drift tills kranen är stängd – säkert, men köerna växer och fler tar trappan'),
            b('run', '▶ Kör vidare', 'Bättre flöde – men vattnet kan kortsluta styrningen och ge ett riktigt hissfel'),
            showLeak, ikon(`show:${DOCK}`, '🔧', 'Visa pannrummet', 'Kameran visar pannrummet där huvudkranen sitter'))}
          ${hint(sv`Vattnet rinner en våning nedåt var ${SPREAD_S}:e sekund tills huvudkranen är stängd. Det är halt på de blöta golven.`)}`}`, !Lk.shut));
      }
    },
    shots: (add) => {
      // vattenläckan (leak.js): där röret sprack, sedan vaktmästaren som springer till pannrummet
      const Lk = S.leak;
      if (Lk && Lk.ph === 'leak') {
        const jan = S.people.find(p => p.id === Lk.jan && !p.dead);
        if (S.t - Lk.t0 < 8) add('leak', 88, 'floor', Lk.src, sv`🚿 Ett rör har spruckit på ${fl(Lk.src)}`, S.t - Lk.t0 < 1);
        else if (!Lk.shut && jan) add('leak', 80, 'person', jan.id, sv`🔧 ${jan.name} springer till huvudkranen`);
        else add('leak', 50, 'floor', Math.min(...Lk.wet), '🚿 Det droppar fortfarande');
      }
    },
  },
  {
    key: 'crash',
    sound: { warn: 'buzz' },
    trig: { icon: '🖥️', name: 'Hiss-O-Matic kraschar', hint: 'Styrsystemet går ner: hissarna går i nödläge och stannar på varje våning', off: () => !crashPossible(),
      why: () => (S.crash ? 'systemet ligger redan nere' : S.fire ? 'det brinner i huset' : 'strömmen är borta') },
    warn: (_W, add) => add('warn', 76, 'floor', CONTROL, '🖥️ Skärmarna i driftcentralen fryser', true),
    card: (h, parts) => {
      const { card, chiefLine, cd, num, bold, line, acts, hint, choice } = h;
      const X = S.crash;
      if (!X) return;
      const b = (m, txt, why) => choice(`crash:${m}`, txt, { on: X.mode === m, off: X.ph === 'boot', why });
      const status = X.ph === 'boot' ? sh`Hiss-O-Matic startar om – alla hissar står still. Uppe ${cd(X.bootEnd - S.t)}.`
        : sh`Hissarna går i nödläge: de pendlar och stannar på varje våning, och folk kliver på den första som öppnar åt rätt håll. Stopp hittills: ${bold(num(X.stops))}.`;
      parts.push(card('crash', 'crash', '🖥️ Hiss-O-Matic har kraschat', `
          ${line(status)}
          ${X.failed ? line(sh`Omstarten misslyckades – ${bold('blå skärm')}.`) : ''}
          ${chiefLine('crash', 'Vad gör vi med styrsystemet?')}
          ${acts(b('nod', '🐢 Kör i nödläge', 'Hissarna fortsätter stanna överallt tills supporten har hittat felet – långsamt, men inget står still'),
            b('boot', '🔁 Starta om', sv`Alla hissar står still i ${BOOT_S} s medan systemet startar – och det är inte säkert att det lyckas`))}
          ${hint('Supporten är i telefonen. Nödläget är långsamt men säkert; en omstart går fort om den lyckas.')}`, X.ph === 'nod'));
    },
    shots: (add) => {
      const X = S.crash;
      if (X && S.t - X.t0 < 10) add('crash', 84, 'floor', CONTROL, '🖥️ Hiss-O-Matic har kraschat', S.t - X.t0 < 1);
      else if (X && X.ph === 'boot') add('crash', 70, 'floor', CONTROL, '🔁 Hiss-O-Matic startar om');
      else if (X) {
        const e = S.elevators.find(q => q.passengers.length > 2 && q.mode === 'normal');
        if (e) add('crash', 56, 'car', e.id, sv`🐢 ${e.name} stannar på varje våning`);
      }
    },
  },
  {
    key: 'tunnel',
    trig: { icon: '🚇', name: 'Tåget står i tunneln', hint: 'Signalfel: tåget fastnar i tunneln och perrongen fylls', off: () => !tunnelPossible(),
      why: () => (S.tunnel ? 'tåget står redan i tunneln' : S.fire ? 'det brinner i huset' : 'inga tåg går just nu') },
    warn: (_W, add) => add('warn', 74, 'floor', STATION, '🚇 Det gnisslar i tunneln', true),
    card: (h, parts) => {
      const { card, chiefLine, num, bold, line, acts, hint, choice, ikon } = h;
      const X = S.tunnel;
      if (!X || X.ph !== 'stuck') return;
      const b = (m, txt, why) => choice(`tunnel:${m}`, txt, { on: X.mode === m, why });
      const n = onPlatform().length;
      const how = X.mode === 'bus' ? sh` Ersättningsbussarna har tagit ${bold(num(X.bussed))} upp genom huset.`
        : X.gaveUp ? sh` ${bold(num(X.gaveUp))} har tröttnat och gått upp till gatan.` : '';
      parts.push(card('tunnel', 'tunnel', '🚇 Tåget står i tunneln', `
          ${line(sh`Signalfel – inga tåg kommer på en stund. På perrongen: ${bold(num(n))}.${how}`)}
          ${chiefLine('tunnel', 'Vänta på tåget eller sätta in bussar?')}
          ${acts(b('wait', '⏳ Vänta på tåget', 'Folk står kvar på perrongen – den som tröttnar går upp till gatan själv'),
            b('bus', '🚌 Ersättningsbussar', 'Alla som ska med tåget går upp genom huset till entrén direkt – en rusning uppåt'),
            ikon(`show:${STATION}`, '📹', 'Visa perrongen', 'Kameran går ner till perrongen'))}
          ${hint('När tåget till slut kommer kliver alla av som har samlats längs linjen – en klump som ska upp genom huset.')}`, true));
    },
    shots: (add) => {
      const X = S.tunnel;
      if (X && X.ph === 'stuck') add('tunnel', S.t - X.t0 < 8 ? 82 : 58, 'floor', STATION, '🚇 Perrongen fylls – tåget står i tunneln', S.t - X.t0 < 1);
      else if (X) add('tunnel', 78, 'floor', STATION, '🚇 Tåget rullar in – äntligen');
    },
  },
  {
    key: 'panic',
    sound: { warn: 'strain' },
    trig: { icon: '😱', name: 'Panik i hissen', hint: 'En fullsatt hiss tvärstannar mellan två våningar – och någon får cellskräck', off: () => !panicPossible(),
      why: () => (S.panic ? 'någon har redan panik' : S.fire ? 'det brinner i huset' : 'ingen hiss är fullsatt och på väg just nu') },
    warn: (_W, add) => add('warn', 70, 'floor', LOBBY, '😰 Trångt i hissarna', true),
    card: (h, parts) => {
      const { card, chiefLine, num, bold, line, acts, hint, choice, followCar } = h;
      const X = S.panic;
      if (!X || X.ph !== 'on') return;
      const e = S.elevators[X.car], who = S.people.find(p => p.id === X.who);
      const b = (m, txt, why) => choice(`panic:${m}`, txt, { on: X.mode === m, why });
      const how = X.level > 0.6 ? 'Paniken sprider sig i korgen.' : X.level > 0.25 ? 'Det är oroligt i korgen.' : 'Det har lugnat sig lite.';
      parts.push(card('panic', 'panic', sv`😱 Panik i ${e.name}`, `
          ${line(sh`${bold(esc(who ? who.name : 'Någon'))} har panik i ${esc(e.name)} mellan två våningar (vid ${panicWhere(X)}). Larmet har ringt ${bold(num(X.alarms))} gånger och ${bold(num(X.pressed.length))} knappar är intryckta. ${how}`)}
          ${chiefLine('panic', 'Hur får vi ut dem?')}
          ${acts(b('talk', '📞 Prata med dem', 'Driftcentralen lugnar dem i nödtelefonen tills hissen är lagad – men sedan stannar den på alla våningar hen tryckte på'),
            b('crank', '🔧 Veva ner korgen', 'Teknikern vevar ner korgen till närmaste våning så fort hen är där och släpper ut dem – lagningen får vänta'),
            followCar(e))}
          ${hint(sv`${X.n} sitter fast. Hissteknikern är på väg.`)}`, true));
    },
    shots: (add) => {
      const X = S.panic;
      if (X && X.ph === 'on') add('panic', X.onT < 8 ? 90 : 66, 'car', X.car, sv`😱 Panik i ${S.elevators[X.car].name}`, X.onT < 1);
      else if (X && X.ph === 'ride') add('panic', 60, 'car', X.car, sv`🔘 ${S.elevators[X.car].name} stannar överallt`);
    },
  },
  {
    key: 'party',
    trig: { icon: '🎈', name: 'Firmafest', hint: 'Ett företag har fest: kollegor med ballonger och en tårta på väg genom huset (eftermiddag, en gång per dygn)',
      off: () => !partyPossible(), why: () => (S.party ? 'festen pågår redan' : S.partyDay === S.day ? 'det har redan varit fest i dag' : 'det är inte eftermiddag på kontoren') },
    warn: (_W, add) => add('warn', 66, 'floor', LOBBY, '🎈 Det blåses upp ballonger', true),
    card: (h, parts) => {
      const { card, chiefLine, num, bold, line, acts, hint, choice, ikon } = h;
      const X = S.party;
      if (!X) return;
      const b = (m, txt, why) => choice(`party:${m}`, txt, { on: X.mode === m, why });
      const there = X.guests.filter(id => S.people.some(p => p.id === id && p.floor === X.f && p.state === 'office')).length;
      const status = X.ph === 'on' ? sh`${bold(num(there))} av ${num(X.guests.length)} gäster är framme${X.caked ? ' och tårtan har kommit' : ' – tårtan är på väg i varuhissen'}.`
        : 'Festen är slut – gästerna går tillbaka med ballongerna.';
      const stuck = X.stuck ? sh` Ballongerna har fastnat i dörrarna ${bold(num(X.stuck))} gånger${X.popped ? sh` (${num(X.popped)} smällde)` : ''}.` : '';
      parts.push(card('party', 'party', sv`🎈 Firmafest hos ${FL[X.f].name}`, `
          ${line(status + stuck)}
          ${chiefLine('party', 'Vilken hiss tar ballongerna?')}
          ${acts(b('varu', '🛗 Varuhissen', 'Breda dörrar – inget fastnar. Men den är långsam och delas med godset'),
            b('alla', '🎈 Vilken hiss som helst', 'Fortare – men ballongerna fastnar i dörrarna och håller upp alla andra'),
            ikon(`show:${X.f}`, '📍', 'Visa festen', 'Kameran går till festvåningen'))}
          ${hint('Tårtan väger 25 kg och åker alltid varuhissen.')}`, X.ph === 'on' && X.mode === ''));
    },
    shots: (add) => {
      const X = S.party;
      if (X && X.ph === 'on') {
        const cake = S.people.find(p => p.id === X.cake && !p.dead && p.cargo);
        if (S.t - X.t0 < 6) add('party', 72, 'floor', X.f, sv`🎈 Firmafest hos ${FL[X.f].name}`, S.t - X.t0 < 1);
        else if (cake && (cake.state === 'ride' || cake.state === 'wait')) add('party', 60, 'person', cake.id, '🎂 Tårtan är på väg');
        else add('party', 50, 'floor', X.f, sv`🎈 Fest på ${fl(X.f)}`);
      }
    },
  },
  ];
}
