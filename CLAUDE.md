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
npm test            # hela sviten i Node (~1 min)
npm run typecheck   # tsc på JSDoc-typer (jsconfig.json)
npm run check       # båda
npm run golden      # skriv om tests/golden.json efter AVSIKTLIGA beteendeändringar
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
| `dispatch.js` | destinationsstyrning: kostnadsfunktion, tilldelning, omfördelning, parkering, brandzon, Rusning (`trafficMode`, `peakHold`) och Energisnål (`ecoCost`) |
| `buttons.js` | styrlogiken KNAPPAR (hallknappar ▲/▼ + våningsknappar, styrningen ser aldrig `p.dest`), felknappar, barn, antinuisance |
| `elevators.js` | hissens rörelse (SCAN med "committed" stopp), dörrar, lastning, överlast |
| `incidents.js` | brand, strömavbrott och slumpade hissfel + spelarens åtgärder |
| `service.js` | drift: slitage, hissfel, hisstekniker, nattservice (`S.maint`) och energi (effekt efter last mot motvikt, återmatning) |
| `cast.js` | stamgästerna (data i `CAST` i config): återkommande karaktärer med egenheter och repliker (`say`) |
| `life.js` | garage/bilar, leveransbil, boendes dygnsrutiner, VIP-helikopter |

**Gränssnitt:** `render.js` (grafikens ingång + `landPos`/`personHead`: var folk syns), `pixel.js` (hela bilden i pixelgrafik), `pixart.js` (rutnätsfigurer med automatisk kontur, bitmapstypsnitt 3×5, färghjälp), `pixpeople.js` (människor ur `p.look`: sido-/framvy, gångsteg, humör, bagage), `pixpal.js` (paletten `PAL`), `view.js` (canvas, kamera, översikt, `VIEW.follow/carPop`), `hud.js` (topplist, hisspopup, flytande incidentruta, låda med flikar), `describe.js` (texter om personer för HUD och spårlapp), `input.js`, `main.js`.

Bilden börjar vid `LAND_X0` och varje våning ritas som en hall framför schakten med en korridor (`DOOR_X`) in mot rummen. Folk i rummen ritas inte; `landPos` räknar ut var de syns i hallen (kön pressas ihop mot korridoren, gång in/ut syns bara sista/första biten) – ren grafik, simuleringens `p.x` ändras aldrig. Allt ritas på ett rutnät i låg upplösning (1 pixel = `PX` = 2 världsenheter) som skalas upp utan utjämning; skärmkoordinater räknas om med `VIEW.x0` (se `toWorld`, `placeCarPop`).

Allt följer paletten **Kontor 95**: byggnadsfärger i `PAL` (`pixpal.js`), hissarnas `color` och våningarnas `acc` i `config.js`, och gränssnittet i `style.css` (blågrönt skrivbord, grå fönster med upphöjda/nedsänkta kanter, marinblå titelrader, DOS-svarta skärmar). Text på en färgad yta får färg via `PAL.on(färg)`.

HUD:en är medvetet liten: allt om en hiss visas på hissen eller i popupen när man klickar på den, incidentrutan syns bara under en incident, och spårning/register/logg/resultat ligger i en låda som är stängd från början.

## Regler som inte får brytas

- **Determinism.** Simuleringen får bara använda `rng.js`-slumpen (`rng/rand/pick…`), aldrig `Math.random`/`vrand` eller väggklocka. Grafik får bara använda `vrand/vpick` och får aldrig ändra simuleringstillstånd. Samma frö (`?seed=`) ⇒ identiskt dygn; testet för bildfrekvens och facit vaktar detta.
- **Fast tidssteg:** `DT = 1/30`. Logik som beror på tid använder `dt`/`S.t`, aldrig bildrutor.
- **Simuleringsmoduler importerar aldrig** `render/view/hud/input/scenery`.
- **Huset är data.** Lägg till/ändra våningar och hissar i `BUILDING`; använd härledda värden (`LOBBY`, `SKY`, `ROOF`, `DOCK`, `HOME_FLOORS`, `idx('7')`, `floorWith('bank')`) – hårdkoda aldrig våningsindex. Index ≠ etikett: index 0 är `P2`, `fl(i)` ger etiketten.
- En hiss stannar bara på `e.serves`, stannar aldrig utanför `minF..maxF`, kör aldrig över `e.ratedKg`, och åker aldrig förbi en passagerares mål.

## Domänbegrepp

- `p.goal` = slutmål, `p.dest` = nuvarande delresa (kan vara `SKY` för hissbyte). `p.exitFloor` = var personen lämnar huset (E, garage eller lastkaj).
- Personer: `kind` = `emp` / `vis` / `staff` / `res` (boende, stannar över natten), `role` för nattpersonal/bud, `vip`.
- Last ≥ 22 kg → bara varuhissen; varuhissen tar bara last och personal (`elevatorAllows`).
- Styrlogiker (`S.strategy`): `smart`, `peak` (Rusning), `eco` (Energisnål), `nearest`, `random`, `buttons`. `costBased()` = de tre som använder kostnadsfunktionen.
- Hisslägen (`e.mode`): `normal`, `recall`, `locked`, `rescue`, `dead`, `broken` (trasig, väntar på tekniker), `service`. `e.hold` = på väg till nattservice (tar inga nya). `e.wear` följer med till nästa dygn.
- Trappan: `stairsChoice` (korta resor/otåliga, `p.fit`), `p.stairsByChoice` skiljer frivilliga trappresor från utrymning m.m.
- Brandlägen: `recall` / `zone` / `none`; i zonläge spärras hissar som inte når någon säker våning (`e.zoneLock`).
- Nytt våningstema = post i `THEME_INFO` (config) med namn, `acc` i Kontor 95-tappning och platser – hallen ritas automatiskt.

## Arbetssätt

- Kör `npm run check` efter ändringar i simuleringen. Ändras beteendet avsiktligt larmar facit-testet – kontrollera skillnaden och kör sedan `npm run golden`.
- Nya simuleringsfunktioner får ett test i `tests/suite.js`; regler som alltid ska gälla läggs i `watcher()` (kontrolleras varje steg över 40 slumpade dygn).
- Kontrollera grafik i webbläsaren. För att spola fram tiden i konsolen: `const st = await import('/src/state.js'), sim = await import('/src/sim.js'); while (st.hour() < 21) sim.step(sim.DT);`
- Höj `?v=` på `style.css` i `index.html` när CSS ändras.
