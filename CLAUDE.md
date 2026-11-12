# Hiss-O-Matic 3000

Simulering av en skyskrapa med 8 hissar i 16-bitars pixelgrafik och 90-talsstil (paletten "Kontor 95"). Fokus är en **rolig och detaljerad simulering att titta på**, inte spelmekanik. All text i spelet och i koden (kommentarer, loggar) är på **svenska**.

## Köra

```bash
python3 serve.py          # http://localhost:8123 (no-cache-server, krävs för att ändringar ska synas)
```

Ingen byggprocess: webbläsaren laddar `src/*.js` som ES-moduler direkt. Förhandsvisning: `.claude/launch.json` → konfigurationen `hiss`.

Node (Homebrew) behövs bara för tester/typkontroll. I ett skal utan profil måste brew läsas in först:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
npm test            # hela sviten i Node (~15 s)
npm run typecheck   # tsc på JSDoc-typer (jsconfig.json)
npm run check       # båda
npm run golden      # skriv om tests/golden.json efter AVSIKTLIGA beteendeändringar
npm run bench       # simuleringens fart (steg/s per styrlogik)
npm run league      # styrlogikerna mot varandra: väntetid (p50/p95/p99), kWh, trappa, ETA-fel; --save=x / --cmp=x
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
| `incidents.js` | brand, strömavbrott och slumpade hissfel + spelarens åtgärder |
| `service.js` | drift: slitage, hissfel, hisstekniker, nattservice (`S.maint`), beställd service (`orderService`), energi (effekt efter last mot motvikt, återmatning), motorvärme (`heat`, överhettningsskydd, extrafläkt) och nivåfel (`level`, snubbel) |
| `weather.js` | dygnets temperatur (kyla → skorstenseffekt: dörrarna i entrén tar emot) och stormen (incident med val: svajläge/normal drift, `windAt`, `exposure`) |
| `train.js` | tunnelbanan under huset: tidtabell (`headway`, `FIRST_H`/`LAST_H`), tåget i `S.train`, folk som kliver av i klump (en andel `TRAIN_SHARE` av morgonens anställda) och på, sista tåget (`S.trainDone`: alla med `exitFloor` stationen går ut genom entrén) |
| `visits.js` | händelser som spelaren bara informeras om: flyttdag (varuhissen i oberoende drift, `e.indep`) och ambulans (bår, förtur via VIP-låset, `medicClear`) |
| `cast.js` | stamgästerna (data i `CAST` i config): återkommande karaktärer med egenheter och repliker (`say`) |
| `life.js` | garage/bilar, leveransbil, boendes dygnsrutiner, VIP-helikopter |
| `replay.js` | spelarens åtgärder via `act()` (spelas in med `S.steps`), `changeStrategy`, länkformatet `?replay=` (`encodeReplay/decodeReplay`, med slitaget och det inlärda minnet `learn`); uppspelningen startas med `startReplay` i `sim.js` |

**Gränssnitt:** `render.js` (grafikens ingång + `landPos`/`personHead`: var folk syns), `pixel.js` (hela bilden i pixelgrafik), `pixart.js` (rutnätsfigurer med automatisk kontur, bitmapstypsnitt 3×5, färghjälp), `pixpeople.js` (människor ur `p.look`: sido-/framvy, gångsteg, humör, bagage), `pixpal.js` (paletten `PAL`), `view.js` (canvas, kamera, `VIEW.follow/carPop`; kameran kopplas till hiss/person/våning och loss med `detachCam`, manuell scrollning kopplar loss), `director.js` (regissören: automatisk kamera `VIEW.auto` som poängsätter det sevärda – incidenter, tåget, repliker, köer – och klipper dit; allt manuellt med kameran stänger av den), `hud.js` (topplist, hisspopup, flytande incidentruta, låda med flikar), `describe.js` (texter om personer för HUD och spårlapp), `input.js`, `main.js`.

Det statiska (stadssiluetten, tegel, fasadfönster, schakt, rampen) ritas i lager via `layer()` i `pixel.js` och ritas bara om när nyckeln ändras (natten i 32 steg, strömmen, bredden). Något som rör sig eller beror på personer får aldrig ritas i ett lager.

Bilden börjar vid `LAND_X0` och varje våning ritas som en hall framför schakten med en korridor (`DOOR_X`) in mot rummen. Folk i rummen ritas inte; `landPos` räknar ut var de syns i hallen (kön pressas ihop mot korridoren, gång in/ut syns bara sista/första biten) – ren grafik, simuleringens `p.x` ändras aldrig. Allt ritas på ett rutnät i låg upplösning (1 pixel = `PX` = 2 världsenheter) som skalas upp utan utjämning; skärmkoordinater räknas om med `VIEW.x0` (se `toWorld`, `placeCarPop`).

Allt följer paletten **Kontor 95**: byggnadsfärger i `PAL` (`pixpal.js`), hissarnas `color` och våningarnas `acc` i `config.js`, och gränssnittet i `style.css` (blågrönt skrivbord, grå fönster med upphöjda/nedsänkta kanter, marinblå titelrader, DOS-svarta skärmar). Text på en färgad yta får färg via `PAL.on(färg)`.

HUD:en är medvetet liten: allt om en hiss visas på hissen eller i popupen när man klickar på den, incidentrutan syns bara när något händer, och spårning/register/logg/resultat ligger i en låda som är stängd från början. Incidentrutan har två sorters kort: **incidenter** som spelaren kan åtgärda (brand, ström, storm, överhettad motor – rutan blinkar) och **informationsrutor** som bara berättar och kan stängas (flyttdag, ambulans och `S.notices` via `notice()` i state.js: kall dag, snubbel). Varje kort har knappar som visar händelsen (`show:våning`, `follow:hiss`). Stängda rutor ligger i `S.dismissed` (bara gränssnittet).

## Regler som inte får brytas

- **Determinism.** Simuleringen får bara använda `rng.js`-slumpen (`rng/rand/pick…`), aldrig `Math.random`/`vrand` eller väggklocka. Grafik får bara använda `vrand/vpick` och får aldrig ändra simuleringstillstånd. Samma frö (`?seed=`) ⇒ identiskt dygn; testet för bildfrekvens och facit vaktar detta.
- **Fast tidssteg:** `DT = 1/30`. Logik som beror på tid använder `dt`/`S.t`, aldrig bildrutor.
- **Ett dygn = 6 minuter** (`timeScale` i config: dag 4 min, kväll 30 s, natt 90 s). Hissar och gång sker i verklig tid, så en resa genom huset tar ungefär en speltimme – planera efter det (öppettider, hemgång på natten). Vistelser i rummen (`p.timer` i läget `office`) räknas i speltid via `activityRate(h)`. Gränssnittet visar ingen klocka, bara ☀️/🌙.
- **Simuleringsmoduler importerar aldrig** `render/view/hud/input/scenery`.
- **Allt spelaren gör som påverkar simuleringen går via `act()`** (replay.js) – annars blir replay-länkarna fel. Platsbeläggningen ligger i `S.occ`, aldrig i config-datan.
- **Huset är data.** Lägg till/ändra våningar och hissar i `BUILDING`; använd härledda värden (`LOBBY`, `SKY`, `ROOF`, `DOCK`, `STATION`, `HOME_FLOORS`, `idx('7')`, `floorWith('bank')`) – hårdkoda aldrig våningsindex. Index ≠ etikett: index 0 är tunnelbanestationen `TB`, `fl(i)` ger etiketten.
- En hiss stannar bara på `e.stops`, stannar aldrig utanför `minF..maxF`, kör aldrig över `e.ratedKg`, och åker aldrig förbi en passagerares mål.
- **Dubbeldäck:** hissens läge (`e.pos`, `e.floor`, `carCalls`, `pick`, `stops`) räknas alltid i nedre däckets våningar; folkets våningar (`p.floor`, `p.dest`, `e.serves`) är riktiga våningar. Översätt med `posOf(e, f)` (personens våning → korgens läge) och `deckFloor(e, p, f)`, och låt en hiss bara köra inom ett däck (`e.legs`).

## Domänbegrepp

- `p.goal` = slutmål, `p.dest` = nuvarande delresa (kan vara `SKY` för hissbyte). `p.exitFloor` = var personen lämnar huset (E, garage, lastkaj eller stationen `STATION`).
- Tunnelbanan: stationen (`TB`) ligger under P2. Stationsexpressen X1 (egen grupp `tbana`) går TB ⇄ E ⇄ 6 med övre däcket P2 ⇄ 1 ⇄ 7; låga zonen och varuhissen går också ner. Den som ska med tåget går ut på perrongen (`p.toTrain`, läget `platform`) och kliver på när tåget står inne; de som kliver av har `p.fromTrain` (syns från tågets dörr i hallen). Perrongen ritas i `drawPlatformPx` (pixel.js).
- Personer: `kind` = `emp` / `vis` / `staff` / `res` (boende, stannar över natten), `role` för nattpersonal/bud, `vip`.
- Last ≥ 22 kg → bara varuhissen; varuhissen tar bara last och personal (`elevatorAllows`).
- Styrlogiker (`S.strategy`): `smart`, `peak` (Rusning), `eco` (Energisnål), `nearest`, `random`, `buttons`. `costBased()` = de tre som använder kostnadsfunktionen.
- Hisslägen (`e.mode`): `normal`, `recall`, `locked`, `rescue`, `dead`, `broken` (trasig, väntar på tekniker), `service`. `e.hold` = på väg till nattservice (tar inga nya). `e.wear` följer med till nästa dygn. `outReason(e)` = varför hissen inte tar nya ('' = den tar), grunden för `operational`/`servesNow`/`outLong`. `benched(e)` = tar inga nya just nu (`e.off`, `e.hot`, `e.windLock`); `e.indep` = oberoende drift (bara flyttgubbarna och ambulansen).
- `keyed(p)` = har nyckel och använder aldrig hallknapparna (VIP, ambulans, flyttgubbar); `prio(p)` = får en hiss för sig (VIP-låset: VIP och ambulans).
- Hissetikett: `p.space` (hur trångt man står ut med, 9 = bryr sig inte), `p.polite` (håller upp dörren). Ett fullt däck hämtar ingen (`e.deckFull`).
- Mellanplanet `MEZZ` (våning 1): dit åker man rulltrappa från entrén till expressens övre däck (`p.escalator`).
- Trappan: `stairsChoice` (korta resor/otåliga, `p.fit`), `p.stairsByChoice` skiljer frivilliga trappresor från utrymning m.m.
- Brandlägen: `recall` / `zone` / `none`; i zonläge spärras hissar som inte når någon säker våning (`e.zoneLock`).
- Nytt våningstema = post i `THEME_INFO` (config) med namn, `acc` i Kontor 95-tappning och platser – hallen ritas automatiskt.

## Arbetssätt

- Kör `npm run check` efter ändringar i simuleringen. Ändras beteendet avsiktligt larmar facit-testet – kontrollera skillnaden och kör sedan `npm run golden`.
- Ändringar i styrningen mäts med `npm run league -- 40 --save=fore` före och `--cmp=fore` efter. Ett dygn sprider ±1,5 s i snittväntan, så små skillnader är brus. Mer exakt ETA ≠ kortare väntan (se kommentaren i `eta()`).
- Nya simuleringsfunktioner får ett test i `tests/suite.js`; regler som alltid ska gälla läggs i `watcher()` (kontrolleras varje steg över 40 slumpade dygn och över 24 dygn med slumpade spelaråtgärder). Ny spelaråtgärd = post i `ACTIONS` (replay.js) och i `PLAYER_ACTIONS` (suite.js).
- Kontrollera grafik i webbläsaren. För att spola fram tiden i konsolen: `const st = await import('/src/state.js'), sim = await import('/src/sim.js'); while (st.hour() < 21) sim.step(sim.DT);`
- Höj `?v=` på `style.css` i `index.html` när CSS ändras.
