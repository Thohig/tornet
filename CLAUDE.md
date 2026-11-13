# Hiss-O-Matic 3000

Simulering av en skyskrapa med 8 hissar i 16-bitars pixelgrafik och 90-talsstil (paletten "Kontor 95"). Fokus är en **rolig och detaljerad simulering att titta på**, inte spelmekanik. Dockhusprincipen: huset sköter sig självt – driftchefen (`chief.js`) tar alla beslut och berättar varför – och spelaren kan ta över ett beslut eller framkalla vad som helst. All text i spelet och i koden (kommentarer, loggar) är på **svenska**.

## Köra

```bash
python3 serve.py          # http://localhost:8123 (no-cache-server, krävs för att ändringar ska synas)
```

Ingen byggprocess: webbläsaren laddar `src/*.js` som ES-moduler direkt. Förhandsvisning: `.claude/launch.json` → konfigurationen `hiss`.

Node (Homebrew) behövs bara för tester/typkontroll. I ett skal utan profil måste brew läsas in först:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
npm test            # hela sviten i Node (~2 min)
npm run typecheck   # tsc på JSDoc-typer (jsconfig.json)
npm run check       # båda
npm run golden      # skriv om tests/golden.json efter AVSIKTLIGA beteendeändringar
npm run bench       # simuleringens fart (steg/s per styrlogik)
npm run league      # styrlogikerna mot varandra: väntetid (p50/p95/p99), kWh, trappa, ETA-fel; --save=x / --cmp=x; --flytt --flyttval=auto|varu|balk; --utanchef
```

Samma testsvit körs i webbläsaren på `/tests.html`.

## Arkitektur

**Simulering** (rör aldrig DOM eller canvas, körs headless i Node):

| Fil | Ansvar |
|---|---|
| `config.js` | `BUILDING` (våningar + hissar som data), `THEME_INFO` (namn, platser), all härledd geometri och konstanter |
| `state.js` | globala tillståndet `S`, klockan (`hour()` 6–30), `log`, `hooks` (incident, dayEnd) |
| `rng.js` | seedad slump (`rng/rand/randi/pick/shuffle`) + visuell slump (`vrand/vpick`) |
| `sim.js` | `step(DT)`, `advance`, schemaläggning, ankomster, nattläge, VIP-lås, `resetDay`, `newSim` |
| `people.js` | personer: tillståndsmaskin, delresor/hissbyten (`legDest`, `setTrip`), lastregler |
| `dispatch.js` | destinationsstyrning: kostnadsfunktion, tilldelning, omfördelning, parkering (även lärande: `learnBlend`, `learnedFloor`), brandzon, Rusning (`trafficMode`, `peakHold`; känner till tidtabellen: väntar in tågklumpen vid perrongen, möter tåget, väntar inte i entrén när tåget kommer) och Energisnål (`ecoCost`); dubbeldäck via `posOf`/`deckOf`/`allowedPos` |
| `buttons.js` | styrlogiken KNAPPAR (hallknappar ▲/▼ + våningsknappar, styrningen ser aldrig `p.dest`), felknappar, barn, antinuisance |
| `elevators.js` | hissens rörelse (SCAN med "committed" stopp), dörrar, lastning, överlast; alla lägesbyten via `setMode` (släpper hämtningarna) |
| `incidents.js` | slumpen `S.incLevel` (`INC_LEVELS`: av/lugn/normal/kaos, `setIncLevel` slumpar om resten av dygnet; Av drar samma slumptal som Normalt så att dygnets slumpföljd inte flyttas), dygnets tidtabell (`planIncidents` → `S.incPlan`: 1–3 incidenter spridda över dagen med tyngd i rusningarna, ibland ett strömavbrott på natten) med förvarning (`S.warn`, `WARN_S`) före varje; brand (larmet återkallar hissarna automatiskt; brandkåren `S.brigade`: brandmän `p.ff` åker varuhissen som brandhiss `e.ffCar` och springer sista biten, branden släcks när de är framme; utrymda väntar på återsamlingsplatsen, läget `assembly`, och går in igen), strömavbrott (de instängda pratar, hissarna startar om en i taget `e.restartAt`, startströmmen kan överhetta en motor) + spelarens åtgärder. När en incident är över: `incidentOver()` (state.js) ger en sammanfattningsruta och folk pratar om den i hissen en stund (`incidentTalk` i cast.js) |
| `service.js` | drift: slitage, hissfel (feltyper i `FAULT_KIND` med egen lagningstid och grafik; ibland stannar korgen mellan två våningar med folk i, `trapBreak`), hisstekniker (`techs()`, `techOf(e)`; med `EXTRA_QUEUE` trasiga hissar i kö ringer teknikern hissjouren – `S.techCall`, syns som telefonsamtal i grafiken – och en extra tekniker `p.extra` kommer, tar bara fel och åker hem när kön är tom), nattservice (`S.maint`), beställd service (`orderService`), energi (effekt efter last mot motvikt, återmatning), motorvärme (`heat`, överhettningsskydd, extrafläkt), nivåfel (`level`, snubbel) och linbrott (`snapCable`: fritt fall → fångapparaten → utrymning genom takluckan till `e.snap.exitF` → linbyte i speltimmar). Instängda (linbrott eller korgen mellan två våningar) går före teknikerns andra jobb: teknikern lämnar det hen håller på med och arbetet sparas (`fault.done`) |
| `weather.js` | dygnets temperatur (kyla → skorstenseffekt: dörrarna i entrén tar emot; värme → motorerna kyls sämre) och stormen (incident med val: svajläge/normal drift, `windAt`, `exposure`; ibland slår blixten ut strömmen, `strikeAt`) |
| `train.js` | tunnelbanan under huset: tidtabell (`headway`, `FIRST_H`/`LAST_H`), tåget i `S.train`, folk som kliver av i klump (en andel `TRAIN_SHARE` av morgonens anställda) och på, sista tåget (`S.trainDone`: alla med `exitFloor` stationen går ut genom entrén) |
| `visits.js` | händelser som spelaren bara informeras om: flyttdag (ett hushåll flyttar med sitt bohag – `BOHAG` i config – bärare och lastare, vägen för varje möbel i `viaHoist` – spelarens val på flyttkortet via `act` (`moveRoute`: auto/varu/balk, `moveBlankets`, `moveWind`), annars Smarts plan efter kön och vinden; varuhissen i oberoende drift `e.indep` medan bärarna jobbar, eller med Smart bara för de stora möblerna; händelser i `moveBoard`: vänds/fastnar i dörren, repor utan filtar; tappade lass; lastkajen har plats för en bil) och ambulans (bår, förtur via VIP-låset, `medicClear`) |
| `hoist.js` | takskenan på tornets tak: fönsterputsarens gondol (`S.cleaner`, schemat i `cleanerPlan`) och hissbalken (`S.hoist`) som delar den – XL-möbler (piano, kassaskåp) hissas ut genom lastluckan (`hatch` i `BUILDING`) ner till takterrassen och åker panoramahissen i lastläge (`e.mode === 'lift'`, lastdörr `terrace` i `BUILDING`) till entrén; gondolen parkerar medan balken är ute, balken stannar i blåst/brand/strömavbrott |
| `cast.js` | stamgästerna (data i `CAST` i config): återkommande karaktärer med egenheter och repliker (`say`) |
| `life.js` | garage/bilar, leveransbil, boendes dygnsrutiner, VIP-helikopter |
| `chief.js` | driftchefen: husets självständiga beslutsfattare (svajläge, brandzon, reservkraft/auto-räddning, extrafläkt, beställd service, Smart ⇄ Rusning i rusningen, flyttens vägval i blåst). Varje beslut sparas med skäl i `S.chief` (`dec` = gällande beslut per nyckel, `log` = dagens beslut med `outcome` när incidenten är över, `say` = repliken i kontrollrummet). Spelarens val via `act()` registreras med `playerChose` och gäller tills incidenten är över (`S.chief.manual`); `chiefBack` lämnar tillbaka beslutet. `S.chief.on` = på/rast, `S.chief.strat` = får byta styrlogik (av i ligan). Dagskiftet: `chiefOnDuty()` |
| `actions.js` | spelarens åtgärder via `act()` (tabellen `ACTIONS`), `changeStrategy`, `TRIGGERS` (allt som kan framkallas: `act('trigger', typ, mål)` där mål är våning för brand och hiss-id för fel/värme/linbrott) |

**Gränssnitt:** `render.js` (grafikens ingång + `landPos`/`personHead`: var folk syns), `pixel.js` (hela bilden i pixelgrafik), `pixart.js` (rutnätsfigurer med automatisk kontur, bitmapstypsnitt 3×5, färghjälp), `pixpeople.js` (människor ur `p.look`: sido-/framvy, gångsteg, humör, bagage), `pixpal.js` (paletten `PAL`), `view.js` (canvas, kamera, `VIEW.follow/carPop`; kameran kopplas till hiss/person/våning och loss med `detachCam`, manuell scrollning kopplar loss), `director.js` (regissören: automatisk kamera `VIEW.auto` som poängsätter det sevärda – incidenter (förvarningar och blixten är `urgent` och klipper in direkt), brandmännen, återsamlingsplatsen, tåget, repliker, teknikerns telefonsamtal, köer, fönsterputsaren och hissbalken (`cleanerAt`/`S.hoist` i hoist.js) – och klipper dit; allt manuellt med kameran stänger av den; `slowmo(dt)` saktar in uppspelningen i dramatiska ögonblick – fritt fall, blixten, branden bryter ut – och ändrar aldrig simuleringen), `hud.js` (topplist, hisspopup med "Framkalla", flytande incidentruta med driftchefens rad `chiefLine`, driftradion `#feed` (ur `S.feed`, som `log()` fyller med `chief`- och husets `alert`-rader), regissörens bildtext `#caption`, låda med flikar, dagens sammanfattning med driftchefens beslut), `describe.js` (texter om personer för HUD och spårlapp), `input.js`, `main.js`.

Driftcentralen (kontrollrummet) ritas i hallen på våningen med taggen `control` (`CONTROL` i config, P1): en skärm per hiss, larmljus, kontrollbordet och driftchefen; repliken (`S.chief.say`) rullar i fönstrets textremsa och syns som pratbubbla (`drawChiefPx`). Regissören klipper dit när chefen fattar ett beslut.

Det statiska (stadssiluetten, tegel, fasadfönster, schakt, rampen) ritas i lager via `layer()` i `pixel.js` och ritas bara om när nyckeln ändras (natten i 32 steg, strömmen, bredden). Något som rör sig eller beror på personer får aldrig ritas i ett lager.

Bilden börjar vid `LAND_X0` och varje våning ritas som en hall framför schakten med en korridor (`DOOR_X`) in mot rummen (längst in syns en glimt av rummet, `GLIMPSE`; i entrén en karuselldörr, reception och rulltrappan till mellanplanet). Hallens bredd är bara grafik – `TRAIN_X0` är fast eftersom simuleringen använder det. Schakten har stängda landningsdörrar vid varje hållplats, och våningsdisplayerna lyser bara där något händer. Folk i rummen ritas inte; `landPos` räknar ut var de syns i hallen (kön pressas ihop mot korridoren, gång in/ut syns bara sista/första biten) – ren grafik, simuleringens `p.x` ändras aldrig. Text i hallen bokar plats (`reserve`/`place` i pixel.js): skyltar först, sedan pratbubblor, tankebubblor (de som väntar på samma hiss till samma våning delar en bubbla) och repliker – det som inte får plats flyttas eller ritas inte. Ljudeffekter i `S.fx` med samma text på samma våning slås ihop till en ("×n"). Allt ritas på ett rutnät i låg upplösning (1 pixel = `PX` = 2 världsenheter) som skalas upp utan utjämning; skärmkoordinater räknas om med `VIEW.x0` (se `toWorld`, `placeCarPop`).

Allt följer paletten **Kontor 95**: byggnadsfärger i `PAL` (`pixpal.js`), hissarnas `color` och våningarnas `acc` i `config.js`, och gränssnittet i `style.css` (blågrönt skrivbord, grå fönster med upphöjda/nedsänkta kanter, marinblå titelrader, DOS-svarta skärmar). Text på en färgad yta får färg via `PAL.on(färg)`.

HUD:en är medvetet liten: allt om en hiss visas på hissen eller i popupen när man klickar på den, incidentrutan syns bara när något händer och är en list längs nederkanten (korten fälls ut över den och ihop till flikar, `foldInc`; incidenter är utfällda tills spelaren fäller ihop dem, informationsrutor fälls ihop av sig själva efter en stund), och spårning/register/logg/resultat ligger i en låda som är stängd från början. Incidentrutan har två sorters kort: **incidenter** som spelaren kan åtgärda (brand, ström, storm, överhettad motor – rutan blinkar) och **informationsrutor** som bara berättar och kan stängas (flyttdag, ambulans och `S.notices` via `notice()` i state.js: kall dag, snubbel, extra tekniker). Varje kort har knappar som visar händelsen (`show:våning`, `follow:hiss`). Stängda rutor ligger i `S.dismissed` (bara gränssnittet).

## Regler som inte får brytas

- **Determinism.** Simuleringen får bara använda `rng.js`-slumpen (`rng/rand/pick…`), aldrig `Math.random`/`vrand` eller väggklocka. Grafik får bara använda `vrand/vpick` och får aldrig ändra simuleringstillstånd. Samma frö (`?seed=`) ⇒ identiskt dygn; testet för bildfrekvens, determinismtestet och facit vaktar detta.
- **Fast tidssteg:** `DT = 1/30`. Logik som beror på tid använder `dt`/`S.t`, aldrig bildrutor.
- **Dygnets tempo** står i `TEMPOS` (config): sekunder per del av dygnet. Standard är det långa dygnet (~15 min, `lang`) där rusningarna och lunchen får mest tid; `?tempo=kort` ger det ursprungliga 6-minutersdygnet. Tempot väljs i `newSim` (`setTempo`), sparas i `S.tempo`. `timeScale(h)` = klockans takt, `pace(h)` = takten mot 6-minutersdygnets dag: flöden som ska följa speltiden (besökare, bud, incidenter) multipliceras med den, anställda med `pace ** EMP_K` (sim.js), slitaget med `tempoWear()`. Hissar och gång sker i verklig tid, så en resa genom huset tar en halv till en speltimme – planera efter det (öppettider, hemgång på natten). Vistelser i rummen (`p.timer` i läget `office`) räknas i speltid via `activityRate(h)`. Gränssnittet visar ingen klocka, bara ☀️/🌙.
- **Simuleringsmoduler importerar aldrig** `render/view/hud/input/scenery`.
- **Allt spelaren gör som påverkar simuleringen går via `act()`** (actions.js) – gränssnittet ändrar aldrig simuleringens tillstånd direkt. Platsbeläggningen ligger i `S.occ`, aldrig i config-datan.
- **Huset är data.** Lägg till/ändra våningar och hissar i `BUILDING`; använd härledda värden (`LOBBY`, `SKY`, `ROOF`, `DOCK`, `STATION`, `HOME_FLOORS`, `idx('7')`, `floorWith('bank')`) – hårdkoda aldrig våningsindex. Index ≠ etikett: index 0 är tunnelbanestationen `TB`, `fl(i)` ger etiketten.
- En hiss stannar bara på `e.stops`, stannar aldrig utanför `minF..maxF`, kör aldrig över `e.ratedKg`, och åker aldrig förbi en passagerares mål.
- **Dubbeldäck:** hissens läge (`e.pos`, `e.floor`, `carCalls`, `pick`, `stops`) räknas alltid i nedre däckets våningar; folkets våningar (`p.floor`, `p.dest`, `e.serves`) är riktiga våningar. Översätt med `posOf(e, f)` (personens våning → korgens läge) och `deckFloor(e, p, f)`, och låt en hiss bara köra inom ett däck (`e.legs`).

## Domänbegrepp

- `p.goal` = slutmål, `p.dest` = nuvarande delresa (kan vara `SKY` för hissbyte). `p.exitFloor` = var personen lämnar huset (E, garage, lastkaj eller stationen `STATION`).
- Tunnelbanan: stationen (`TB`) ligger under P2. Stationsexpressen X1 (egen grupp `tbana`) går TB ⇄ E ⇄ 6 med övre däcket P2 ⇄ 1 ⇄ 7; låga zonen och varuhissen går också ner. Den som ska med tåget går ut på perrongen (`p.toTrain`, läget `platform`) och kliver på när tåget står inne; de som kliver av har `p.fromTrain` (syns från tågets dörr i hallen). Perrongen ritas i `drawPlatformPx` (pixel.js).
- Personer: `kind` = `emp` / `vis` / `staff` / `res` (boende, stannar över natten), `role` för nattpersonal/bud, `vip`.
- Last ≥ 22 kg → bara varuhissen; varuhissen tar bara last och personal (`elevatorAllows`).
- Driftchefen: `newSim(seed, { chief, chiefStrat, incLevel })` – chefen är på från början; `autoInc: true/false` betyder slumpen Normalt/Av som förr.
- Styrlogiker (`S.strategy`): `smart`, `peak` (Rusning), `eco` (Energisnål), `nearest`, `random`, `buttons`. `costBased()` = de tre som använder kostnadsfunktionen.
- Hisslägen (`e.mode`): `normal`, `recall`, `locked`, `rescue`, `dead`, `lift` (panoramahissen kör ett flyttlass; `e.liftWant` = beställd, tar inga nya), `broken` (trasig, väntar på tekniker; `e.fault.cable` = linbyte, korgen står mellan två våningar), `service`, `snapped` (linbrott: `e.snap.ph` = `fall`/`trapped`/`evac`). `e.hold` = på väg till nattservice (tar inga nya). `e.wear` följer med till nästa dygn. `outReason(e)` = varför hissen inte tar nya ('' = den tar), grunden för `operational`/`servesNow`/`outLong`. `benched(e)` = tar inga nya just nu (`e.off`, `e.hot`, `e.windLock`); `e.indep` = oberoende drift (bara flyttgubbarna och ambulansen).
- `keyed(p)` = har nyckel och använder aldrig hallknapparna (VIP, ambulans, flyttgubbar); `prio(p)` = får en hiss för sig (VIP-låset: VIP och ambulans).
- Hissetikett: `p.space` (hur trångt man står ut med, 9 = bryr sig inte), `p.polite` (håller upp dörren). Ett fullt däck hämtar ingen (`e.deckFull`).
- Mellanplanet `MEZZ` (våning 1): dit åker man rulltrappa från entrén till expressens övre däck (`p.escalator`).
- Trappan: `stairsChoice` (korta resor/otåliga, `p.fit`), `p.stairsByChoice` skiljer frivilliga trappresor från utrymning m.m.
- Brandlägen: `recall` (larmets standard) / `zone` / `none` (`startFire(f, false)` startar utan återkallning); i zonläge spärras hissar som inte når någon säker våning (`e.zoneLock`).
- Nytt våningstema = post i `THEME_INFO` (config) med namn, `acc` i Kontor 95-tappning och platser – hallen ritas automatiskt.

## Arbetssätt

- Kör `npm run check` efter ändringar i simuleringen. Ändras beteendet avsiktligt larmar facit-testet – kontrollera skillnaden och kör sedan `npm run golden`.
- Ändringar i styrningen mäts med `npm run league -- 40 --save=fore` före och `--cmp=fore` efter. Ett dygn sprider ±1,5 s i snittväntan, så små skillnader är brus. Mer exakt ETA ≠ kortare väntan (se kommentaren i `eta()`).
- Nya simuleringsfunktioner får ett test i `tests/suite.js`; regler som alltid ska gälla läggs i `watcher()` (kontrolleras varje steg över 40 slumpade dygn och över 24 dygn med slumpade spelaråtgärder). Ny spelaråtgärd = post i `ACTIONS` (actions.js) och i `PLAYER_ACTIONS` (suite.js). Ny incident med val = ett beslut i `chief.js` (med skäl) och `chiefLine(nyckel, …)` på kortet. Testernas `sim()` har driftchefen på rast (`chief: false`) om inget annat sägs; dockhustestet kör kaosdygn utan spelaren och kräver att incidenterna tar slut av sig själva.
- Kontrollera grafik i webbläsaren. För att spola fram tiden i konsolen: `const st = await import('/src/state.js'), sim = await import('/src/sim.js'); while (st.hour() < 21) sim.step(sim.DT);`
- Höj `?v=` på `style.css` i `index.html` när CSS ändras.
