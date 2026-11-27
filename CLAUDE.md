# Tornet

Simulering av skyskrapan Tornet med 8 hissar (styrsystemet heter Hiss-O-Matic 3000) i 16-bitars pixelgrafik och 90-talsstil (paletten "Kontor 95"). Fokus är en **rolig och detaljerad simulering att titta på**, inte spelmekanik. Dockhusprincipen: huset sköter sig självt – driftchefen (`chief.js`) tar alla beslut och berättar varför – och spelaren kan ta över ett beslut eller framkalla vad som helst. All text i koden (kommentarer, loggar, simuleringens texter) skrivs på **svenska**; spelet visar dem på **svenska** som standard och kan byta till engelska sömlöst (`lang.js`, se nedan). **Tala alltid svenska med användaren** – svar, sammanfattningar och frågor – även när en fråga eller ett kommando skrivs på engelska.

## Köra

```bash
python3 serve.py          # http://localhost:8123 (no-cache-server, krävs för att ändringar ska synas)
```

Servern lyssnar bara på den egna datorn (`--lan` = även nätverket, t.ex. mobilen) och lämnar bara ut spelets filer: `ALLOWED` i `serve.py` – **en ny mapp som spelet laddar måste läggas till där**, annars ger den 404. `python3 serve.py --auto-stop` stänger dessutom av sig själv 5 min efter att spelet tystnat (spelet anropar `/ping` var 30:e sekund, `main.js`) eller efter 12 h. Spelet hämtar inget utifrån: typsnittet VT323 ligger i `fonts/` (OFL). Ikonerna ligger i `ikon/` (`tornet-32.png` = favicon, `tornet-180.png` = apple-touch-icon, `tornet-1024.png` = originalet, `Tornet.icns` = samma bild i macOS-format); byts en ikon ut, höj `?v=` på ikonlänkarna i `index.html` – Safari håller annars fast vid den gamla). Spelet ligger också på GitHub Pages (https://thohig.github.io/tornet/, byggs från `main`, cachas 10 min).

Ingen byggprocess: webbläsaren laddar `src/*.js` som ES-moduler direkt. Förhandsvisning: `.claude/launch.json` → konfigurationen `hiss`.

Node (Homebrew) behövs bara för tester/typkontroll. I ett skal utan profil måste brew läsas in först (på en Intel-Mac ligger brew i `/usr/local/bin/brew`):

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
npm test            # hela sviten i Node, parallellt, en tråd per kärna (--jobs=N, --jobs=1 = en tråd)
npm run typecheck   # tsc på JSDoc-typer (jsconfig.json)
npm run check       # typkontroll, långa kodrader och hela sviten
npm run quick       # snabbläget: typkontroll, långa kodrader + sviten med färre slumpade dygn, utan styrlogikernas statistiska jämförelser (ungefär halva tiden)
npm run golden      # skriv om tests/golden.json efter AVSIKTLIGA beteendeändringar
npm run bench       # simuleringens fart (steg/s per styrlogik)
npm run lang        # svenska texter i koden som saknar engelsk mall i lang-en.js, och svenska ändelser som eget värde (`hiss${n > 1 ? 'ar' : ''}`); --check = varje sv`…` har sin mall (quick och check kör den)
npm run playtest    # provspelning i Chromium (= npm run check:ui; Playwright, inget beroende): kaosdygn och fasta ögonblick – fel i sidan, svenska kvar, text över text, bilder mot facit; --del=kaos,ögon --godta --seeds=21,5 --keep
npm run lines       # kodrader över 200 tecken där koden (inte texten) är över 200 tecken (--code=120 visar nästa att städa)
npm run new-incident -- <nyckel> "<Namn>" "<English>" [emoji]   # skelettet till en ny incident i alla register, med test
npm run hooks       # git-kroken: npm run quick före varje commit, och check:ui när gränssnittet ändrats (git commit --no-verify hoppar över)
npm run league      # styrlogikerna mot varandra: väntetid (p50/p95/p99), kWh, trappa, ETA-fel; --save=x / --cmp=x; --flytt --flyttval=auto|varu|balk; --utanchef
```

Panelen och pixelgrafiken går inte att köra i Node – det gör `npm run playtest` (tools/playtest.mjs) i en riktig webbläsare; kör det efter ändringar i gränssnittet eller texterna. Allt körs med `date=0` (den neutrala dagen, calendar.js), så att bilderna inte beror på dagens datum. Delen `ögon` tar skärmdumpar av fasta ögonblick (`MOMENTS`) på datorn och mobilen och jämför dem pixel för pixel med facit i `tools/playtest-out/ögon/bas/` (bara lokalt; jämför i `…/ögon/index.html`, `--godta` gör de nya till facit). Text som ritas över annan text hittas via `TEXTLOG` i pixart.js; det som får täcka står i `FRONT` och kända krockar som inte är åtgärdade i `KNOWN` (playtest.mjs, tom just nu). Samma testsvit körs i webbläsaren på `/tests.html` (`/tests.html?quick` = snabbläget). På GitHub kör `.github/workflows/check.yml` `npm run check` vid push till `main` och vid pull request (inte när bara `.md`-filer ändrats) – Actions-minuterna räcker inte till mer, så CI är ingen ersättning för att köra testerna själv.

## Arkitektur

**Simulering** (rör aldrig DOM eller canvas, körs headless i Node):

| Fil | Ansvar |
|---|---|
| `config.js` | `BUILDING` (våningar + hissar som data), `THEME_INFO` (namn, platser), all härledd geometri och konstanter |
| `state.js` | globala tillståndet `S`, klockan (`hour()` 6–30), `log`, `hooks` (incident, dayEnd) |
| `rng.js` | seedad slump i namngivna strömmar: `const { rng, rand, pick } = stream('namn')` en gång per modul, ett namn per delsystem; `setSeed` seedar om dem ur dygnets frö; grafikens slump är `vrand/vpick` |
| `sv.js` | sv`…`: en svensk text med värden som vet sin mall (`MADE`) – samma sträng som utan sv, men lang.js översätter den exakt; inga beroenden, påverkar aldrig simuleringen |
| `util.js` | små hjälpfunktioner som både simuleringen och grafiken använder: `fl` (våningens etikett), `clamp`, `ARR`/`K` (riktning), `esc` (html), `hex2rgb`/`mix` (färger) |
| `sim.js` | `step(DT)`, `advance`, schemaläggning, ankomster, nattläge, VIP-lås, `resetDay`, `rollDay`, `newSim` |
| `people.js` | personer: tillståndsmaskin, delresor/hissbyten (`legDest`, `setTrip`), lastregler |
| `dispatch.js` | destinationsstyrning: kostnadsfunktion, tilldelning, omfördelning, parkering (även lärande), brandzon, Rusning (`trafficMode`, känner till tidtabellen) och Energisnål (`ecoCost`); dubbeldäck via `posOf`/`deckOf`/`allowedPos` |
| `buttons.js` | styrlogiken KNAPPAR (hallknappar ▲/▼ + våningsknappar, styrningen ser aldrig `p.dest`), felknappar, barn, antinuisance |
| `elevators.js` | hissens rörelse (SCAN med "committed" stopp), dörrar, lastning, överlast; alla lägesbyten via `setMode` (släpper hämtningarna) |
| `incidents.js` | slumpen (`S.incLevel`, `INC_LEVELS`), dygnets tidtabell (`planIncidents` → `S.incPlan`) med förvarning (`S.warn`), brand med brandkår och återsamlingsplats, strömavbrott, `incidentOver()` (state.js) när det är över |
| `service.js` | drift: slitage, hissfel (`FAULT_KIND`, `trapBreak`), hisstekniker och hissjouren (`techs()`, `S.techCall`, extra tekniker), nattservice, beställd service, energi, motorvärme, nivåfel och linbrott (`snapCable`); arbetsledaren `S.foreman` |
| `calendar.js` | Tornets datum (`S.date`, samma som datorns – gränssnittet lämnar det till `newSim`, simuleringen läser aldrig klockan): `dayInfo` → `S.cal` med veckodag, helg (färre anställda), månadens temperatur, sol i Stockholm med sommartid och ljusa sommarnätter; `sunWarp` flyttar himlen efter solen; utan datum en neutral dag |
| `weather.js` | dygnets temperatur efter månaden (kyla → dörrarna i entrén tar emot; värme → motorerna kyls sämre) och stormen (svajläge, `windAt`, blixten `strikeAt`) |
| `train.js` | tunnelbanan under huset: tidtabell (`headway`), tåget i `S.train`, folk som kliver av i klump (`TRAIN_SHARE`) och på, sista tåget (`S.trainDone`) |
| `visits.js` | flyttdagen (`BOHAG`, bärare och lastare, vägvalet `viaHoist`/`moveRoute`, varuhissen i oberoende drift `e.indep`, `moveBoard`) och ambulansen (bår, förtur via VIP-låset) |
| `tour.js` | Stadsturen: turistbussen (`act('bus')`, `S.tour`) och guiden som leder 14 turister till takterrassen och Sky Café och tillbaka; egen slumpström `turistbuss` |
| `hoist.js` | takskenan: fönsterputsarens gondol (`S.cleaner`) och hissbalken (`S.hoist`) som hissar XL-möbler ner till takterrassen och panoramahissen i lastläge (`e.mode === 'lift'`) |
| `crew.js` | husets personal (`CREW` i config): skift, poster (`SPOTS` med `post`), raster, `crewNext`/`crewSpot`, och vaktmästarens uppdrag vid olyckorna (`callJanitor`, `p.duty`, `dutyDone`); drar inga slumptal |
| `pano.js` | panoramahissen fastnar på fasaden (`S.pano`, `panoStick`): räddningstjänsten firar ner folk med rep eller tar dem med stegbilen; driftchefen eller `act('panoRescue', …)` väljer |
| `visning.js` | rundvisningen (`S.visning`, beställs med `act('visning', …)`, ingen incident): guiden (`guideNow`), vikarien Kicki, rutten `STOPS`, nycklarna (`v.unlock`) och omvägarna när något händer; drar inga slumptal |
| `heist.js` | Kuppen på 5:an (`S.heist`): skåpbilen vid lastkajen (`orderHeist`, `S.heistWait`), gänget, gisslan, den som blev över (`p.hero`) och polisens insatsledare (`heistChiefTick`, `act('heist', …)`); egen slumpström `kuppen` |
| `gondola.js` | fönsterputsaren fastnar (`S.gondola`, bara när Hasse är ute): veva, lastluckan eller rep (`act('gondola', …)`); egen slumpström `gondolen` |
| `dog.js` | hunden som rymmer (`S.dog`): pudeln (`p.dog`) åker hiss, ägaren och vaktmästaren jagar och fångar den när den står still (`dogStill`: i hallen eller i hisskön), hissarna kan spärras där den är (`dogLockFloor`, `act('dog', …)`); egen slumpström `hunden` |
| `leak.js` | vattenläckan (`S.leak`): vattnet rinner nedåt och in i schakten tills vaktmästaren stänger huvudkranen; de blöta hissarna står still eller kör vidare (`act('leak', …)`); egen slumpström `vattenläcka` |
| `crash.js` | Hiss-O-Matic kraschar (`S.crash`): nödläget (`crashRun`, `sweepDir`/`sweepStop` i elevators.js) där hissarna pendlar och stannar på varje våning utan tilldelningar (`crashed()` i dispatch.js), eller en omstart som kan ge blå skärm (`act('crash', …)`); egen slumpström `krasch` |
| `tunnel.js` | tåget står i tunneln (`S.tunnel`): inga tåg (train.js väntar), perrongen fylls; vänta eller ersättningsbussar (`toStreet` i train.js, `act('tunnel', …)`); egen slumpström `tunnel` |
| `panic.js` | panik i en fullsatt hiss som tvärstannar (`S.panic`, bygger på `trapNext` i service.js): larmet, alla knappar; prata i nödtelefonen eller veva ner korgen (`crankDown` i service.js, `act('panic', …)`); egen slumpström `panik` |
| `party.js` | firmafesten (`S.party`, en gång per dygn: `S.partyDay`): gäster med ballonger (`p.party`, `balloonFreight` i people.js) och tårtan i varuhissen; ballongerna fastnar i dörrarna (`act('party', …)`); egen slumpström `firmafest` |
| `rulltrappa.js` | rulltrappan stannar (`S.rulltrappa`): nödstoppet, vaktmästaren som startar den igen, folk som går i den stillastående rulltrappan (`escalatorStopped`, `escalatorTime` i people.js) eller tar nedre däcket när den är avspärrad (`escalatorClosed`, `act('rulltrappa', …)`); egen slumpström `rulltrappa` |
| `chaos.js` | Murphys lag: kaosknappen (`act('chaos')`, en gång per dygn) startar en kedja (`S.chaos`, `STEPS`) av allt som kan gå fel; egen slumpström `kaos` |
| `cast.js` | stamgästerna (data i `CAST` i config): återkommande karaktärer med egenheter och repliker (`say`) |
| `life.js` | garage/bilar, leveransbil, boendes dygnsrutiner, VIP-helikopter |
| `chief.js` | driftchefen: husets beslut med skäl (`S.chief`: `dec`, `log`, `say`), spelarens val via `act()` (`playerChose`, gäller tills incidenten är över; `chiefBack`), `S.chief.on`/`S.chief.strat` |
| `systems.js` | registret över delsystemen och incidenterna (`systems()`, typen `System`): tick/reset/roll, incidentens `on`/`trigger`/`weight`/förvarning/`chief`/`chaos`/`detour`, och det folket och hissarna behöver (`roles`, `next`, `spot`, `arrive`, `blocks`, `out`). Listans ordning är simuleringens – en ny post läggs sist (att flytta en ändrar dygnen). Brand och strömavbrott är kärnans egna (`S.fire`, `S.outage`) |
| `repro.js` | ögonblicket i adressen: `reproQuery`, `parseRepro`, `fastForward` (`?seed=…&t=…&follow=…&date=…`) |
| `actions.js` | spelarens åtgärder via `act()` (tabellen `ACTIONS`), `changeStrategy`, `triggers()` (allt som kan framkallas: `act('trigger', typ, mål)`) |

**Gränssnitt** (läser simuleringen, ändrar den bara via `act()`; detaljerna står överst i varje modul):

| Fil | Ansvar |
|---|---|
| `render.js` | grafikens ingång; `landPos`/`personHead`: var folk syns |
| `pixel.js` | hela bilden i pixelgrafik: `renderPixel` sätter ihop delarna i `pixcore.js` (ritytan, lagren, platsbokningen), `pixbuilding.js`, `pixhall.js`, `pixcars.js`, `pixfolk.js` och `pixroof.js` |
| `pixart.js` | rutnätsfigurer med automatisk kontur, bitmapstypsnittet 3×5, färghjälp; `TEXTLOG` = textrutorna i bilden för provspelningen |
| `pixpeople.js` | människor ur `p.look`: sido-/framvy, gångsteg, humör, bagage |
| `pixpal.js` | paletten `PAL` |
| `view.js` | canvas, kamera, `VIEW.follow`; `detachCam`, manuell scrollning kopplar loss |
| `incui.js` | incidenterna i gränssnittet (`incUi()`): knappen i Framkalla, kortet, förvarningens klipp, det sevärda och ljudet |
| `director.js` | regissören: den automatiska kameran (`VIEW.auto`) som poängsätter det sevärda och klipper dit; `slowmo` |
| `summary.js` | dygnets siffror (`STATS`), `saveDay()` och sammanfattningen `summaryHtml()` |
| `hud.js` | html för panelens innehåll: hissen och personen man följer, incidentkorten med kortens byggstenar (`line`, `acts`, `hint`, `choice`), välkomstrutan |
| `panels.js` | kontrollpanelen `#side` (blocken i `ORDER`, `layout`), textskylten `#lower`, verktygstipset och mobilens `renderMob` |
| `describe.js` | texter om personer för HUD och spårlapp |
| `sound.js` | ljudeffekterna (Web Audio) i musikens takt; incidenternas ljud står i registret (`sound` i incui.js) |
| `music.js` | hissmusiken: kassetten i hissen man följer, avstängd tills spelaren slår på den |
| `score.js` | husmusiken: dygnets stycken (noterna i `scoreData.js`) och korta inslag; testas i Node |
| `start.js` | starten: ingen startmeny, `newSim` och mjukt dygnsskifte, uppstarten och välkomstrutan, spelarens val i `localStorage`, `?seed=`; datorns datum till simuleringen (`followToday` byter det efter midnatt) |
| `intro.js` | rundvisningen i gränssnittet: guidens berättelse i panelen, kameran och rösten (Web Speech API) |
| `lang.js` | språket: svenska som standard, engelska ett klick bort; gränssnittet översätter när det visas (`trDom`, `tr`) ur mallarna i `lang-en.js`; sh`…` = panelens html med värden i taggar |
| `input.js` | klick, tangenter och alla knappar: `doAction` för `data-act`, `extraActions`, vänsterklick följer |
| `main.js` | huvudloopen: varje steg fångar sina fel i `guard` och visar dem i `#err` |

Driftcentralen (`CONTROL`, P1) och personalrummet (`BREAK`, P2) ritas i hallen på sina våningar (pixhall.js); personalen syns på sin plats efter `spot.win` (`inWindow`/`winPos` i render.js). På stationen ligger platserna ute på perrongen (`win: 'hall'`): kiosken, tidtabellen och bänken ritas i `stationHall` (pixhall.js), och den som sitter på bänken ritas av `seated` i pixfolk.js. Det simuleringen vet om folket och hissarna ska synas i bilden: last har en figur i `CARGO_ROWS` (pixpeople.js), ett läge som tar hissen ur vanlig trafik får en korgskylt i `carSigns` (pixcars.js), och utseenden som beror på läget (rånarnas luvor, `masked`) avgörs i `personSprite`.

Det statiska (stadssiluetten, tegel, fasadfönster, schakt, rampen) ritas i lager via `layer()` i `pixcore.js` och ritas bara om när nyckeln ändras (natten i 32 steg, strömmen, bredden). Något som rör sig eller beror på personer får aldrig ritas i ett lager. Ritytan (`g`, `lo`, `X0`, `CY`) byts bara i pixcore.js (`layer`, `beginFrame`); de andra pix-modulerna läser den, och tillstånd för en bildruta nollställs via funktioner i modulen som äger det (`resetCallAt`, `countOcc` …).

Varje våning ritas som en hall framför schakten med en korridor in mot rummen (pixhall.js). Folk i rummen ritas inte; `landPos` räknar ut var de syns i hallen – ren grafik, simuleringens `p.x` ändras aldrig. Text i bilden bokar plats (`reserve`/`place` i pixcore.js): skyltar först, sedan bubblor och repliker – det som inte får plats flyttas eller ritas inte (`npm run playtest` hittar text som ritas över annan text). Skyltar som ritas efter folket bokar sin plats innan folket ritas (`reserveLobbySigns`, `reserveCarSigns` i pixel.js), och korgarnas repliker ritas efter folket i hallarna (`drawCarTalkPx`); korgens skyltar (överkanten, däcken och de två skyltplatserna, `slot`) väljs i `carSigns` i pixcars.js, och samma val bokar platsen och ritar. Text hålls inom det som syns med `keepIn`/`visibleX` (på mobilen är bilden bredare än skärmen). Allt ritas på ett rutnät i låg upplösning (1 pixel = `PX` = 2 världsenheter) som skalas upp utan utjämning.

Allt följer paletten **Kontor 95**: byggnadsfärger i `PAL` (`pixpal.js`), hissarnas `color` och våningarnas `acc` i `config.js`, och gränssnittet i `style.css` (blågrönt skrivbord, grå fönster med upphöjda/nedsänkta kanter, marinblå titelrader, DOS-svarta skärmar). Text på en färgad yta får färg via `PAL.on(färg)`.

Det finns ingen topplist, statusrad, låda eller högerklicksmeny: hela gränssnittet utom bilden är **kontrollpanelen** `#side` till vänster (fast bredd; aldrig flytande över bilden – den får inte täcka hallarna). Enda undantaget är den halvgenomskinliga textskylten `#lower` längst ner i bilden, som kameran räknar med (`VIEW.padB`, `seeH()`). Knapparna är ikoner (`ikon()` i hud.js) med namn och förklaring i verktygstipset; val mellan lägen och incidentkortens huvudknappar behåller texten. Panelen består av block (`ORDER`) som får läget `full`, `row` eller `link` efter situationen (`layout`). Incidentrutan har **incidenter** som spelaren kan åtgärda (rutan blinkar) och **informationsrutor** som bara berättar och kan stängas (`notice()` i state.js).

**Mobilläget** (`body.mob`, `screenMode()` i view.js: smal skärm eller en pekskärm på tvären): på telefonen tittar man – styr gör man på datorn. Det finns ingen kontrollpanel, bara bilden och en list nertill (`renderMob` i panels.js: det som händer, paus, regissören 🎬/fri kamera, ⏩, hjälp och språk – ingen fart; på tvären en smal kolumn till höger). Sidan scrollar aldrig och listen ligger aldrig över bilden. Välkomstrutan visas vid varje start och varnar att spelet gör sig bäst på en dator, och regissören är på som på datorn.

## Regler som inte får brytas

- **Determinism.** Simuleringen får bara använda `rng.js`-slumpen (`rng/rand/pick…` ur en `stream`), aldrig `Math.random`/`vrand` eller väggklocka. Strömmarna är oberoende: ett slumptal till i ett delsystem flyttar inte de andra, så du behöver inte vakta på hur många slumptal något drar. Nytt delsystem som kan ändras för sig = ny ström (ett namn får bara användas en gång). Ankomsterna (`anställda`, `besökare`, `gestalt`, `tåg`, `bud` …) får aldrig dela ström med något som beror på styrlogiken, och får inte dras bakom ett villkor som gör det (`if (kö < 3 && rng() …)`) – då ser alla styrlogiker samma dygn: samma personer på samma sekunder (testet Slumpströmmar). `makePerson` drar ur `inkallade` om inget annat sägs; bara `spawnEmployee`/`spawnVisitor` använder `gestalt`. Grafik får bara använda `vrand/vpick` och får aldrig ändra simuleringstillstånd. Samma frö (`?seed=`) och datum (`?date=`) ⇒ identiskt dygn; datumet är data som gränssnittet lämnar till `newSim` (start.js) och `act('date')` (vid midnatt, main.js) – testerna och facit kör utan datum (neutral dag); testet för bildfrekvens, determinismtestet och facit vaktar detta.
- **Fast tidssteg:** `DT = 1/30`. Logik som beror på tid använder `dt`/`S.t`, aldrig bildrutor.
- **Dygnsskiftet** (`S.roll`): `'mjuk'` (spelet – alltid, start.js; spelaren kan inte välja) = kl 06 kör `rollDay()` – klockan och dygnets planer (ankomster, incidenter, besök, väder, tåg, VIP) görs om och slumpen seedas om ur dygnets frö, men huset fortsätter: `S.t`, hissarna, folket, fel/linbyten, pågående incidenter och chefens beslut om dem. Gårdagens statistik i `S.yesterday`; sammanfattningen öppnas som vyn `yesterday` i panelen (informationsrutan ”Dag n börjar”). Varje delsystem har en `…Roll()` bredvid sin `…Reset()` (`lifeRoll`, `visitsRoll`, `chiefRoll`, `crewRoll`: nattskiftet `p.shiftEnd` går när dagskiftet är i huset). `'ny'` (bara standard i `newSim`, testerna och ligan) = spelet stannar för sammanfattningen och `resetDay()` börjar om; bara slitaget och ohjälpta hissfel (`keptFault`/`restoreFault` i service.js) följer med. Klockslag som sparas på personer (`p.returnAt`, rutiner) gäller dygnet de skapades – nya sådana fält måste flyttas i `…Roll()`.
- **Dygnets tempo** står i `TEMPOS` (config): sekunder per del av dygnet. Spelet har bara det långa dygnet (~15 min, `lang`) där rusningarna och lunchen får mest tid; det korta 6-minutersdygnet (`kort`) finns kvar för testerna, ligan och `npm run bench`. Tempot väljs i `newSim` (`setTempo`), sparas i `S.tempo`. `timeScale(h)` = klockans takt, `pace(h)` = takten mot 6-minutersdygnets dag: flöden som ska följa speltiden (besökare, bud, incidenter) multipliceras med den, anställda med `pace ** EMP_K` (sim.js), slitaget med `tempoWear()`. Hissar och gång sker i verklig tid, så en resa genom huset tar en halv till en speltimme – planera efter det (öppettider, hemgång på natten). Vistelser i rummen (`p.timer` i läget `office`) räknas i speltid via `activityRate(h)`. Gränssnittet visar ingen klocka, bara ☀️/🌙.
- **Kalendern** (calendar.js): Tornet har datorns datum (`S.date`, `S.cal = dayInfo(S.date)` i `resetDay`/`rollDay`). Det styr veckodagen (helgen: `empMul`/`visMul`/`tourMul` i ankomsterna, dragningen sker ändå ovillkorligt), månadens temperatur (weather.js) och solen: grafiken går genom `sunWarp`, så himlen, nattljuset och solens bana ritas för den neutrala dagens tider (ljust 7, mörkt efter 19.2) och flyttas efter dagens sol – rita aldrig efter `hour()` direkt när något ska följa dagsljuset, använd `nightness`/`skyAt`. `act('date', 'ÅÅÅÅ-MM-DD')` byter datum (Framkalla, midnatt). Utan datum (null, `date=0` i adressen) är dagen neutral – testerna, ligan och facit; ett test som behöver ett datum skickar `sim(frö, { date })`.
- **Simuleringsmoduler importerar aldrig** `render/view/hud/input/scenery`.
- **Allt spelaren gör som påverkar simuleringen går via `act()`** (actions.js) – gränssnittet ändrar aldrig simuleringens tillstånd direkt. Platsbeläggningen ligger i `S.occ`, aldrig i config-datan.
- **Huset är data.** Lägg till/ändra våningar och hissar i `BUILDING`; använd härledda värden (`LOBBY`, `SKY`, `ROOF`, `DOCK`, `STATION`, `HOME_FLOORS`, `idx('7')`, `floorWith('bank')`) – hårdkoda aldrig våningsindex. Index ≠ etikett: index 0 är tunnelbanestationen `TB`, `fl(i)` ger etiketten.
- En hiss stannar bara på `e.stops`, stannar aldrig utanför `minF..maxF`, kör aldrig över `e.ratedKg`, och åker aldrig förbi en passagerares mål.
- **Dubbeldäck:** hissens läge (`e.pos`, `e.floor`, `carCalls`, `pick`, `stops`) räknas alltid i nedre däckets våningar; folkets våningar (`p.floor`, `p.dest`, `e.serves`) är riktiga våningar. Översätt med `posOf(e, f)` (personens våning → korgens läge) och `deckFloor(e, p, f)`, och låt en hiss bara köra inom ett däck (`e.legs`).

## Domänbegrepp

- `p.goal` = slutmål, `p.dest` = nuvarande delresa (kan vara `SKY` för hissbyte). `p.exitFloor` = var personen lämnar huset (E, garage, lastkaj eller stationen `STATION`).
- Tunnelbanan: stationen (`TB`) ligger under P2. Stationsexpressen X1 (egen grupp `tbana`) går TB ⇄ E ⇄ 6 med övre däcket P2 ⇄ 1 ⇄ 7; låga zonen och varuhissen går också ner. Den som ska med tåget går ut på perrongen (`p.toTrain`, läget `platform`) och kliver på när tåget står inne; de som kliver av har `p.fromTrain` (syns från tågets dörr i hallen). Perrongen ritas i `drawPlatformPx` (pixhall.js).
- Hissteknikern på väg till ett jobb (`onCall` i elevators.js) går före kön och kliver på även när hissen känns trång.
- Personer: `kind` = `emp` / `vis` / `staff` / `res` (boende, stannar över natten), `role` för nattpersonal/bud, `vip`. Husets personal har `crewId` (crew.js); deras resor inom huset har `leaving = false` (entrén är deras utgång). Platser med `post`, `where` eller `brk` väljer ingen annan (`pickSpot`).
- Last ≥ 22 kg → bara varuhissen; varuhissen tar bara last och personal (`elevatorAllows`).
- Driftchefen: `newSim(seed, { chief, chiefStrat, incLevel })` – chefen är på från början; `autoInc: true/false` betyder slumpen Normalt/Av som förr.
- Styrlogiker (`S.strategy`): `smart`, `peak` (Rusning), `eco` (Energisnål), `nearest`, `random`, `buttons`. `costBased()` = de tre som använder kostnadsfunktionen.
- Hisslägen (`e.mode`): `normal`, `recall`, `locked`, `rescue`, `dead`, `lift` (panoramahissen kör ett flyttlass; `e.liftWant` = beställd, tar inga nya), `broken` (trasig, väntar på tekniker; `e.fault.cable` = linbyte, korgen står mellan två våningar), `service`, `snapped` (linbrott: `e.snap.ph` = `fall`/`trapped`/`evac`). `e.hold` = på väg till nattservice (tar inga nya). `e.hijack` = kapad av rånarna under kuppen (tar inga nya, heist.js). `e.wear` följer med till nästa dygn. `outReason(e)` = varför hissen inte tar nya ('' = den tar), grunden för `operational`/`servesNow`/`outLong`. `benched(e)` = tar inga nya just nu (`e.off`, `e.hot`, `e.windLock`, `e.wetLock` – vattenläckan); `e.indep` = oberoende drift (bara flyttgubbarna och ambulansen).
- `keyed(p)` = har nyckel och använder aldrig hallknapparna (VIP, ambulans, flyttgubbar); `prio(p)` = får en hiss för sig (VIP-låset: VIP, ambulans och räddningstjänsten vid fasaden).
- Hissetikett: `p.space` (hur trångt man står ut med, 9 = bryr sig inte), `p.polite` (håller upp dörren). Ett fullt däck hämtar ingen (`e.deckFull`).
- Mellanplanet `MEZZ` (våning 1): dit åker man rulltrappa från entrén till expressens övre däck (`p.escalator`).
- Trappan: `stairsChoice` (korta resor/otåliga, `p.fit`), `p.stairsByChoice` skiljer frivilliga trappresor från utrymning m.m.
- Brandlägen: `recall` (larmets standard) / `zone` / `none` (`startFire(f, false)` startar utan återkallning); i zonläge spärras hissar som inte når någon säker våning (`e.zoneLock`).
- Nytt våningstema = post i `THEME_INFO` (config) med namn, `acc` i Kontor 95-tappning och platser – hallen ritas automatiskt.

## Arbetssätt

- **Kör `npm run quick` lokalt före varje commit** (även när ändringen ser liten ut – `npm run hooks` gör det åt dig, och kör `npm run check:ui` när gränssnittet ändrats) och **hela `npm run check` innan något hamnar på `main`** och efter ändringar i styrningen (`dispatch.js`, `buttons.js`, `elevators.js` – de statistiska jämförelserna mellan styrlogikerna körs bara där). CI körs bara på `main` och i pull requests och ska inte vara det som hittar felen. Snabbläget i sviten: `test(namn, fn, { slow: true })` hoppas över, `some(lista, n)` = de n första; ett nytt tungt test (många hela dygn) ska ha ett snabbläge.
- Kör testerna efter ändringar i simuleringen. Ändras beteendet avsiktligt larmar facit-testet – kontrollera skillnaden och kör sedan `npm run golden`.
- Ändringar i styrningen mäts med `npm run league -- 40 --save=fore` före och `--cmp=fore` efter. Ett dygn sprider ±1,5 s i snittväntan, så små skillnader är brus. Mer exakt ETA ≠ kortare väntan (se kommentaren i `eta()`).
- Typerna: personer är `Person` (people.js), hissar `Elevator` (elevators.js) och incidenternas tillstånd har var sin typ i sin modul (`Fire`, `Outage`, `Pano`, `Move` …, se `S` i state.js). `S` och `S.stats` är stängda: alla fält deklareras i `INIT` respektive `newStats()` i state.js (även de som bara ett delsystem använder, som `S.train` och `S.autos`). Ett nytt fält på `S`, i statistiken, på en person eller hiss läggs till där – annars larmar `npm run typecheck`. Funktioner som tar en person eller hiss får `@param {Person} p` / `@param {Elevator} e`.
- Nya simuleringsfunktioner får ett test i `tests/suite.js`; regler som alltid ska gälla läggs i `watcher()` (kontrolleras varje steg över 40 slumpade dygn och över 24 dygn med slumpade spelaråtgärder). Ny spelaråtgärd = post i `ACTIONS` (actions.js) och i `PLAYER_ACTIONS` (suite.js). **Ny incident** (`npm run new-incident` gör skelettet) = en egen modul med egen slumpström och ett fält på `S` (state.js), en post sist i `systems()`, före vädret (systems.js: tick/reset, `on`, `trigger`, `weight` för tidtabellen, förvarningen, `chief` om den har val, `chaos` för Murphys lag, och det folket och hissarna behöver: `roles`, `spot`, `blocks`, `out` …) och en post i `incUi()` (incui.js: knappen, kortet med `chiefLine(nyckel, …)`, regissörens klipp, ljudet `sound`) – plus texterna i `lang-en.js`. Kortets knappar `data-act="nyckel:val"` når `act(nyckel, val)` utan egen rad i input.js. Har den val: beslutet i `chief.js` (med skäl, exporteras och kopplas in som `chief.tick`). Testernas `sim()` har driftchefen på rast (`chief: false`) om inget annat sägs; dockhustestet kör kaosdygn utan spelaren och kräver att incidenterna tar slut av sig själva.
- **Var det hände:** vakten sparar första gången varje regel bröts (`w.hit(nyckel, e, p, text)`) och rekordet för maxvärdena (`w.top`). När ett test fallerar skrivs de ut under felet med en länk till steget i spelet (`?seed=…&t=…&follow=…`, repro.js), kontrollerad genom en omspelning. En ny regel i `watcher()` räknar med `w.hit` i stället för `w.x++`. Ett ögonblick för hand: `?seed=7&h=17.5&follow=H2` (spelet tar dagens datum – `&date=0` = testernas neutrala dag, `&date=2026-12-13` = ett visst datum).
- Kontrollera grafik i webbläsaren. `?prof=1` visar tid per del av bildrutan (simulering, hallar, folk, text, lager som ritas om …) uppe till vänster i bilden (`prof.js`; nya delar mäts med `lap('namn')`) – fungerar även på mobilen. För att spola fram tiden i konsolen: `const st = await import('/src/state.js'), sim = await import('/src/sim.js'); while (st.hour() < 21) sim.step(sim.DT);`
- Ny text som visas för spelaren skrivs på svenska i koden och får en engelsk mall i `lang-en.js` (samma värden `{0}` …). En text med värden skrivs sv`…` (`import { sv } from './sv.js'`): mallen står då exakt i `lang-en.js` (`npm run lang -- --check` kräver det) och översätts utan att gissa. Html i panelen delas i textnoder när den översätts, så en mening med värden i taggar (`num()`, `cd()`, `bold()` i hud.js) skrivs sh`…` (lang.js): mallen skrivs utan taggar, taggarna hör till värdena, och hela meningen översätts ur `lang-en.js` innan den blir html. Låt värden vara hela ord: inte svenska ändelser som eget värde (`hiss${n > 1 ? 'ar' : ''}`) eller en bokstav för sig – skriv hela orden i båda grenarna (`npm run lang` listar sådana, och testet Språket letar efter engelska ord med en svensk ändelse, som ”owna”). Testet Språket kör ett kaosdygn och kräver att loggen och dagböckerna blir engelska.
- Höj `?v=` på `style.css` i `index.html` när CSS ändras.
- Varje modul börjar med en kommentar om vad den gör (de stora med en översikt); tabellerna ovan har en mening per fil – detaljerna hör hemma i modulen och ändras med koden.
- Det som har gjorts står i `CHANGELOG.md` (rubriker med datum). Planerade tekniska förbättringar står i `TODO.md` och idéer till spelet som inte är byggda i `IDEER.md` – stryk det som blir gjort.
