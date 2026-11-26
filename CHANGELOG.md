# Ändringar

## 2026-11-26 – provspelning med ögon, git-kroken, kortare rader och CLAUDE.md
- **`npm run playtest` tittar på bilden** (`npm run check:ui`). Delen `ögon` tar skärmdumpar av fasta ögonblick (`?seed=…&h=…&follow=…`) på datorn, mobilen och mobilen på tvären. Playwrights klocka och ett fast frö för grafikens slump gör att samma ögonblick ger samma bild. Varje bild jämförs pixel för pixel med facit i `tools/playtest-out/ögon/bas/`, skillnaderna ritas i rött och samlas i `…/ögon/index.html`, och `--godta` gör de nya bilderna till facit. Delarna väljs med `--del=kaos,ögon`.
- **Text över text:** `TEXTLOG` i pixart.js sparar var varje text i bilden hamnade och vilken ritfunktion som ritade den. Provspelningen grupperar krockarna efter ritfunktionerna. Det som får täcka (korgen framför våningsdisplayen, ljudeffekterna, det spelaren följer) står i `FRONT`, och kända krockar som inte är rättade står i `KNOWN` (TODO.md). Svenska som blivit kvar i bilden letas nu också upp, inte bara i panelen.
- **Det provspelningen hittade:** flytten började medan kuppens skåpbil stod vid lastkajen, och leveransbilen kunde backa in bredvid den. Nu väntar båda på gatan tills skåpbilen har kört (test). Polisens och brandkårens skyltar i entrén låg på varandra. Takskylten SKYSKRAPAN gick ner över maskinrummet och texten satt i underkanten. Den väntande flyttbilen syns inte medan turistbussen eller en annan bil är på gatan. Spårlappens ”H1 om 1 s” översattes inte, eftersom `plain()` tog bort `~` före översättningen (nu översätts texten först). Flyttkortets ”En möbel har fått vändas …, 1 fastnade helt” blev halvsvensk.
- **`npm run hooks`** kopplar in `.githooks/pre-commit`: `npm run quick` före varje commit och `npm run check:ui` när gränssnittet, grafiken eller texterna ändrats (`git commit --no-verify` hoppar över, `SKIP_UI=1` hoppar över provspelningen).
- **`npm run lines`** (tools/lines.mjs) listar kodrader över 200 tecken där själva koden, utan text och kommentarer, är över 200 tecken. `quick` och `check` stoppar nya sådana rader. De 21 som fanns är brutna.
- **Incidentkorten** byggs av `line`, `acts`, `hint`, `choice` och `followCar` (hud.js) i stället för html med egna knappfunktioner i varje kort.
- **Ljudet i registret:** varje incident säger i `incUi()` vilket ljud förvarningen gör, vilka ljud som spelas när något händer (brandlarmet, sirenen, blixten) och om husmusiken byter stycke (kuppens ragtime). `sound.js` och `score.js` känner inte längre till enskilda incidenter.
- **`npm run new-incident -- <nyckel> "<Namn>" "<English>" [emoji]`** skapar skelettet till en ny incident: modulen med egen slumpström, `S.<nyckel>`, posterna i `systems()` och `incUi()`, engelska mallar och ett test. Skelettet går att framkalla och tar slut av sig självt; resten står som TODO.
- **CLAUDE.md** har en mening per fil i tabellerna. Detaljerna står i en översikt överst i varje modul, där de ändras tillsammans med koden. Rubrikerna i CHANGELOG har datum.

## 2026-11-26 – förslagen från provspelningen: fel syns, kuppen väntar, helbilden på mobilen, npm run playtest
- **Fel i en bildruta** fångas steg för steg (uppspelningen, simuleringen, kameran, bilden, ljudet, panelen – `guard` i main.js). Ett fel i ritningen stoppar inte längre panelen eller simuleringen. Felet visas en gång i en röd ruta nere till vänster (`#err`, klick stänger), eftersom det inte finns någon konsol på mobilen.
- **Kuppen när lastkajen är upptagen:** förut hände ingenting när man framkallade kuppen medan flyttbilen eller leveransbilen stod vid lastkajen. Nu kör skåpbilen runt kvarteret (`orderHeist`, `S.heistWait`), ett informationskort säger vad gänget väntar på, och de backar in när kajen är ledig. Knappen är grå så länge.
- **Flyttgubbarna** har en text i personrutan och spårlappen (”Lastar flyttbilen”, ”Ställer av lasset vid flyttbilen”) i stället för bara våningens namn (`roomDesc` i describe.js).
- **Mobilens helbild (🔍):** texten är för liten för att läsas, så pratbubblorna, tankebubblorna, namnbrickorna, småpratet och ljudeffekterna ritas inte (`tinyText()` i view.js). Den man följer behåller sin bubbla.
- **`npm run playtest`** (tools/playtest.mjs): provspelar i Chromium med Playwright (inget beroende i package.json). Tre kaosdygn på engelska medan kameran följer personer och hissar. Skriptet letar efter fel i sidan och svenska som blivit kvar i panelen, textskylten och verktygstipsen. Det hittade direkt hissens ”ska av + hämtar”.
- **Översättningen:** ett värde först i en mall (`{0} stopp …`) sväljer inte längre en avskiljare som mallen saknar (` · `, ` – `, ` → `) – raden delas först. ` + ` är en avskiljare (hissens nästa stopp: ”Isak ska av + hämtar Zainab”).
- `cap()` finns i util.js i stället för i fyra moduler.

## 2026-11-26 – provspelning: spelet fryser inte, flyttgubbarna, nedräkningarna på engelska
- **Spelloopen** beställer nästa bildruta först. Förut stoppade ett enda fel i ritningen eller panelen hela spelet (bilden frös), eftersom `requestAnimationFrame` kom sist i `frame()`.
- **Följer du en flyttgubbe** vid lastkajen kraschade personrutan: de är ”inne” utan en plats (`p.spot`). Nu står våningen där, som i spårlappen.
- **En tom text** i pixelgrafiken (spårlappen över en person) kastade ett fel i `drawImage` – `text()` ritar inget i stället.
- **Engelska:** nedräkningarna i korten (”arriving nu”, ”om en halv minut”) uppdateras på plats och översattes inte – nu gör de det. Kuppkortet saknade en punkt efter borren (”21 % Polisen spärrar gatan …”) och ”via taket”, sammanfattningen ”signalerade till polisen från taket”, flyttkortet ”Skyddsfiltar: ja”, regissörens skylt ”kassaskåp i hissbalken” och personrutans ”1 stopp före målet” blev kvar på svenska. Bitar som börjar med ” och ” passar nu mallen utan ”och” när en text delas.
- **Skylten för expressens övre däck** på mellanplanet var bredare än sin platta och krockade med företagsskylten (”GLADA TANDEN DENTAL”). Plattan får bredden av texten och flyttar ner en rad när de skulle krocka.
- **Uppspelningsraden** i en smal panel (skärmar runt 1280 px): när ⏩ kom på kvällen hamnade ? på en egen rad. Knapparna krymper i stället.

## 2026-11-25 – provspelning: läckkortet, kortens ordning, ”The lobby”, mobilen på tvären, nedräkningar i ord
- **Vattenläckans kort** bad spelaren ”ta över beslutet” med gråa knappar och driftchefens rad ”hissarna i de blöta schakten står still” även efter att huvudkranen stängts – då kör hissarna igen. Nu säger kortet att hissarna kör som vanligt, slutar blinka och fälls ihop som en informationsruta.
- **Incidentkorten** står med de som går att åtgärda först och de farligaste överst (brand, strömavbrott, kuppen, fasaden). Under Murphys lag hamnade branden förut längst ner under hunden och läckan.
- **Engelska:** en översättning med samma ord men andra versaler (”entrén”/”Entrén”) tog den som kom först i lang-en.js, så textskylten visade ”the lobby”. Mallar med exakt samma skiftläge går nu före, och en text som börjar med versal gör det även på engelska.
- **Nedräkningarna i korten** är ord i stället för sekunder (”framme om en halv minut”, ”alldeles strax”) – spelet visar ingen klocka (`cd` i hud.js).
- **Berits erbjudande** om en rundvisning drar sig tillbaka efter en och en halv minut, eller när något händer i huset. Det går att be om en rundvisning sedan (? i panelen). Före kl 07 säger hon att passet inte har börjat än, i stället för att bara vänta tyst.
- **Informationsrutorna** ligger kvar som ihopfällda rader en stund (90 s, ”Dag n börjar” 4 min) i stället för att försvinna efter 30 s – på 2× hann man knappt se dem.
- **Panoramahissen som hackar:** när den framkallats (eller förvarnats) och väntar på att fastna kommer ett informationskort som säger att den fastnar nästa gång den kör med folk. Knappen är grå så länge.
- **Gråa knappar i Framkalla** säger varför i verktygstipset (”Går inte just nu: det brinner i huset”) – `why` i `incUi()`.
- **Mobilen på tvären:** Berits fråga om en rundvisning tog en kolumn på 340 px i hela höjden. Nu är kolumnen smal (knapparna under varandra) så att bilden får platsen.

## 2026-11-25 – förslagen från provspelningen
- **⏩ Spola fram natten** (knappen bredvid farterna, på mobilen i listen, eller N): på kvällen och natten (från kl 21) spelas huset upp i 12× till morgonen. Det stannar av sig självt kl 05:54, när en förvarning eller en ny incident kommer, eller när spelaren väljer en fart. Bara uppspelningen går fortare – simuleringen tar samma steg (`toggleSkip`/`skipTick` i input.js).
- **Panelen under Murphys lag:** informationsrutorna (ambulansen, tågstörningen, värmeböljan …) fälls ihop till en rad direkt medan en incident som går att åtgärda pågår, så att den får platsen. Spelaren kan fortfarande fälla ut dem.
- **Under stationen** syns husets grund: berget, bottenplattan med pålar och schaktgroparna med buffertar under hissarna som går ner till stationen. Förut var det bara jord.
- **Skylten ”ÖVRE DÄCK: VÅN 1”** i entrén och på mellanplanet sitter över huvudhöjd, så folk på väg till rulltrappan skymmer den inte.
- **Engelska plural:** de sista texterna som byggde plural av svenska ändelser (hämtningar, hissar, våningar, incidenter) skriver hela meningar i båda grenarna.
- **Testet Språket** letar efter engelska ord med en svensk ändelse (”on their owna”, ”3 incidenter”). `npm run lang` listar ändelser som eget värde (`hiss${n > 1 ? 'ar' : ''}`), och räknar inte längre slumpströmmarnas namn och konsolens meddelanden som texter. Förklaringar som själva innehåller `<b>` (Murphys lag-knappen) läses rätt.

## 2026-11-25 – provspelning: skyltar, banderoller och engelska plural
- Incidentbanderollerna överst i bilden (BRAND, STRÖMAVBROTT, STORM) centrerades på hela bilden. På mobilen i närbild, där bilden är bredare än skärmen och flyttad i sidled, hamnade de halvvägs utanför. Nu sitter de mitt i det som syns, och texten blir mindre om den inte får plats.
- Avgångsskylten på perrongen bokar sin plats, så tankebubblorna lägger sig inte längre över ”STIG PÅ!”. Småpratet från personalen i fönstren (driftcentralen, personalrummet) hoppas över när platsen är tagen, i stället för att ritas över DRIFTCENTRAL-skylten.
- Ljudeffekterna från de spolade timmarna i en `?h=`/`?t=`-länk (”STÄNG! STÄNG!” ×50) flög upp på en gång när spelet startade. Nu töms listan efter spolningen.
- Engelska: dygnets rubrikmening slutade på ”3 incidenter.” och guiden sa ”find the bus on their owna”. Båda bygger nu hela meningar i varje gren. Driftchefens skäl för svajläget säger ”vinden passerade 16 m/s” (vinden när beslutet togs), eftersom kortet bredvid visar vinden just nu.

## 2026-11-23 – rundvisningen är ingen incident
- Rundvisningen är en hjälp för nya spelare och kommer bara när någon ber om den. Den finns inte längre i *Framkalla* (`act('trigger', 'visning')` finns inte), och Murphys lag skickar bara turistbussen i steget med besökarna.
- Man beställer den genom Berits erbjudande första gången, knappen *🛎️ Be Berit visa runt* som nu står överst i hjälpen (?), och knappen hos guiden eller i entrén. Knapparna använder `act('visning', 'now')`: guiden avbryter rasten, och finns ingen guide i huset tar väktaren eller driftchefen den.
- Räddningstjänsten vid panoramahissen på fasaden har förtur till hissen (`prio`, VIP-låset) som ambulansen. Förut kunde räddarna stå i kö till varuhissen bakom flyttgubbar och städare medan folk satt fast i korgen.

## 2026-11-23 – buggletning: var det hände, och länken dit
- Vakten i testerna (`watcher()` i `tests/suite.js`) sparar första gången varje regel bröts, och rekordet för längsta väntan, åktur, instängning med flera: dygn, klockslag, hissen (läge och tillstånd) och personen. Fallerar ett test skrivs fynden ut under felet med en länk som öppnar just det steget i spelet. Förut stod det bara hur många gånger något hände.
- Länken kontrolleras innan den skrivs ut: dygnet spelas om från fröet till samma steg. Har testet gjort något annat än att köra dygnet (spelaråtgärder, framkallade incidenter) står det vid länken att den bara visar samma frö och klockslag.
- Ögonblicket i adressen (`src/repro.js`): `?seed=…&t=…` (simuleringstid) eller `&h=17.5` (klockslag) spolar fram dygnet med fasta steg, som i testerna, och spelet står pausat. `follow=` sätter kameran på en hiss (`H2`), en våning (`12`) eller en person (namn eller id). `strategy`, `inc`, `chief`, `chiefStrat`, `mistakes`, `maint`, `roll` och `tempo` går före spelarens val, och de sparas inte. Ingen uppstart, välkomstruta eller regissör i det läget. Bara `?seed=` utan tid är som förut ett vanligt dygn.
- `newSim` sparar hur simuleringen startades i `S.origin`.
- Första bildrutan kunde få negativ `dt`, och då fick rökpuffen ur en het motor storleken 0 och ritningen kastade ett fel. `dt` är nu aldrig negativ.

## 2026-11-21 – ikonen i Safari
- Ikonlänkarna i `index.html` har `?v=2`, så att Safari hämtar ikonen på nytt i stället för att hålla fast vid en gammal (eller tom) favicon i sin cache. `tornet-180.png` finns nu också som `rel="icon"` för webbläsare som vill ha en större ikon.

## 2026-11-21 – startappen borttagen
- Startappen `Tornet.app` behövs inte längre: spelet öppnas på GitHub Pages eller med `serve.py`. Ikonen finns kvar i `ikon/Tornet.icns` (samma bild som `ikon/tornet-1024.png`).
- Kommentarerna i `serve.py` och `main.js` och CLAUDE.md nämner inte appen längre. README och CLAUDE.md berättar vad som ligger i `ikon/`.

## 2026-11-20 – småfel från ett provspel
- Pannrumsdörren på P1 ligger till höger om trappskylten, som förut täckte ”P” i ”PANNA”. Skylten är lika bred som texten, så att ”BOILER” får plats på engelska. Driftcentralens fönster flyttar sig så att det inte krockar med dörren.
- Driftchefens pratbubbla vid kontrollbordet ritas inte ovanpå våningsskylten och driftcentralens rubrik när det saknas plats. Repliken rullar redan i fönstrets textremsa.
- Panoramahissen på fasaden: när alla är nere säger kortet att korgen hänger tom och att räddarna packar ihop, och knapparna rep/stegbil är borta. Räddningen avslutas när den sista är nere, även om det har blåst upp. Förut väntade den på att vinden skulle mojna, fast det inte fanns någon kvar att fira ner.

## 2026-11-20 – regissören är på från start
- Regissören 🎬 klipper bilden från första sekunden. Stänger du av den (🎬 eller A) minns spelet det till nästa gång.
- Den kommer tillbaka av sig själv när du släpper kameran: direkt när du slutar följa någon (Esc, ✕ eller klick på samma person eller hiss igen), och efter 25 sekunder när du har scrollat fritt eller tittar på en våning. Bryter något nytt ut (förvarning, blixten, brand) medan du har scrollat bort dig klipper den in direkt. Följer du en person eller hiss rör den inte kameran.
- När rundvisningen är slut går kameran tillbaka till regissören i stället för att stanna kvar på guiden.
- Verktygstipset på 🎬 och hjälpen berättar det.

## 2026-11-20 – vattenläckan: risken följer schaktet
- Kortslutningsrisken för en blöt hiss som kör vidare räknas på de blöta våningarna i hissens eget schakt (`wetIn` i leak.js), inte på alla blöta våningar i huset. Uppehissarna och varuhissen, som går förbi mest vatten, är nu mest utsatta; låga zonen klarar sig med en droppe på 5:an.

## 2026-11-20 – ny mobilvy
- På mobilen fyller bilden skärmen (ungefär tre fjärdedelar i stället för knappt hälften) och sidan scrollar aldrig – bara bilden.
- Kontrollpanelens staplade fönster är borta på mobilen. I stället: en list nertill med paus, fart (en knapp som byter), 🔍 och flikarna 🚨 händelser, 📻 nu (dygnet, stapeln, radion, dagens siffror), ⚡ framkalla, 🎛️ styrning, 👤 det du följer och ☰ mer (kameran, ljudet, flaggorna, hjälpen, register, logg, inställningar, resultat). En flik öppnas som ett ark ovanför listen och bilden krymper medan den är öppen – inget ligger över bilden.
- Textskylten, driftradion och dagens rad är en enda rad ovanför listen. Den visar vad regissören visar och driftchefens beslut, annars det senaste på radion eller det du följer. Tryck på raden för att öppna fliken som hör till.
- En incident eller förvarning öppnar 🚨 av sig själv och stänger den när det är över. Rundvisningen öppnar fliken med det Berit pratar om.
- Berits fråga om rundvisning är en liten bubbla (”Ska jag visa dig runt i huset?”) i stället för ett helt fönster.
- 🔍 eller dubbeltryck i bilden växlar mellan närbild (som förut, scrollar i sidled) och hela husets bredd. Valet minns.
- På tvären (telefon i liggande läge) ligger listen som en smal kolumn till höger och arket bredvid. Textskylten är kvar i bilden.
- Hjälpen beskriver listen på mobilen. Skrivbordet är oförändrat.

## 2026-11-20 – spela på GitHub Pages
- Spelet ligger på GitHub Pages: <https://thohig.github.io/tornet/> (byggs från `main`, cachas 10 min). Ingen lokal server behövs för att spela; `serve.py` behövs bara när man utvecklar.
- Startappen `Tornet.app` öppnar Pages-adressen i Safari i stället för att starta `serve.py --auto-stop`.
- README och CLAUDE.md beskriver det.

## 2026-11-20 – incidentregistret
- Nytt: `src/systems.js`, ett register med en post per delsystem i tickordning. Varje post säger hur delsystemet tickar, nollställs och rullar över dygnsskiftet, och för incidenterna hur de framkallas, hur troliga de är i dygnets tidtabell, deras förvarning och driftchefens del.
- `sim.js` (tick, `resetDay`, `rollDay`), `incidents.js` (framkallning, tidtabell, förvarningar), `chief.js` (när besluten upphör, olyckornas beslut), `chaos.js` (när det har lugnat sig) och `actions.js` (`triggers()`) går igenom registret i stället för att räkna upp incidenterna. Incidentkortens knappar (`gondola:crank`, `dog:lock` …) når `act()` utan egen rad i input.js.
- Folket och hissarna frågar också registret: rollerna (tekniker, räddare, hund, flyttgubbe, brandman, rånare …) står i posterna (`roles`), liksom var de står (`spot`), timern när de är framme (`arrive`), vart delsystemet skickar någon (`next` – kuppens hjälte och gisslan, den som jagar hunden), spärrade våningar (`blocks` – hunden) och varför en hiss inte tar nya (`out` – kapad, blött schakt). `people.js` och `dispatch.js` känner inte längre till kuppen, hunden eller läckan.
- Kaosknappens steg för hissarna och besökarna och rundvisningens omläggning till panoramahissen kommer ur registret (`chaos`, `detour`).
- Gränssnittet har ett eget register, `src/incui.js`: knapparna i *Framkalla*, incidentkorten och regissörens klipp (förvarningen och det sevärda) är en post per incident. hud.js, director.js och panels.js går igenom listan.
- Inget beteende är ändrat: facit är identiskt. Vinsten: en ny incident berör ungefär 5–6 filer i stället för omkring 20, och sju filer behöver inte röras alls (`sim.js`, `people.js`, `dispatch.js`, `input.js`, `actions.js`, `chaos.js`, `director.js`). Registret kostar under 1 % av simuleringens körtid.

## 2026-11-20 – snabbare tester i vardagen
- `npm run quick` (och `/tests.html?quick`): typkontrollen och testsviten i snabbläget – två dygn i stället för tio i varje block av invarianttesterna, två i stället för sex med slumpade spelaråtgärder, färre frön i dockhuset, kaosknappen och flyttvalen, facit för första dygnet per styrlogik, och utan de statistiska jämförelserna mellan styrlogikerna. Ungefär halva tiden (2,3 min mot 4,5 min på fyra kärnor). `npm run check` kör allt som förut, och CI kör hela sviten.
- I sviten: `test(namn, fn, { slow: true })` körs bara i hela sviten, `some(lista, n)` ger de n första i snabbläget.

## 2026-11-19 – färre CI-körningar
- GitHub Actions (`.github/workflows/check.yml`) körs vid push bara på `main` (samma commit testades annars två gånger, på arbetsgrenen och på main) och vid pull request. Ändringar som bara rör `.md`-filer startar ingen körning (`paths-ignore`).
- CLAUDE.md: `npm run check` körs lokalt före varje commit – CI ska inte vara det som hittar felen.

## 2026-11-19 – skyltarna på engelska
- Våningsskyltarna har engelska namn när spelet visas på engelska: namnet står kvar och verksamheten översätts (Glada Tanden Dental, Pixel & Planka Game Studio, Rymdkakan Advertising, Kvarnström Attorneys, Quasar Laboratory, Tornplan Metro). Gunnars och Doris titlar använder samma namn.
- Språket byts med två pixelflaggor (svensk och brittisk) längst upp till höger i panelen, ovanför ?-knappen; den valda är intryckt med marinblå ram. Valet under Inställningar ⚙️ finns kvar.
- Språkknappen heter Svenska på båda språken, och brandvåningens ”slumpad” under Framkalla heter ”random” på engelska.

## 2026-11-19 – vaktmästaren och vardagsolyckorna
- **Pannrummet och dagvaktmästaren Bosse** (07–16): pannrummets dörr syns i hallen på P1 (driftcentralens fönster flyttade en bit åt höger). Bosse står vid pannan, gör småjobb på våningarna, fikar och äter lunch på stationen. Kvällsvaktmästaren börjar sin runda vid pannan. Vid en olycka får husets vaktmästare ett uppdrag (`callJanitor` i crew.js) – finns ingen i huset rings en jourvaktmästare in.
- **🪟 Fönsterputsaren fastnar** (`src/gondola.js`): vinschen kärvar mitt på fasaden. Vaktmästaren vevar upp gondolen för hand, öppnar lastluckan på 12–14 eller så firar räddningstjänsten ner Hasse till takterrassen. Hissbalken står så länge, och Hasse går av passet efteråt.
- **🐕 Hunden som rymmer** (`src/dog.js`): en pudel sliter sig ur kopplet (eller smiter ut ur kenneln på Vovve Spa), springer och åker hiss. Ägaren eller hundfrisören och vaktmästaren jagar den. Driftchefen kan spärra hissarna på hundens våning – då får de som väntar där ta trappan.
- **🚿 Vattenläckan** (`src/leak.js`): ett rör spricker och vattnet rinner nedåt våning för våning och in i schakten tills vaktmästaren stänger huvudkranen i pannrummet. De blöta hissarna står still eller kör vidare med risk för kortslutning. Pölar, dropp och VÅTT GOLV i hallarna, folk halkar, och från labbet är vattnet grönt.
- Alla tre kommer i dygnets slumpade tidtabell med förvarning, kan framkallas i panelen (vattenläckan även på en vald våning) och ingår i Murphys lag. Var och en har ett incidentkort med driftchefens beslut, regissören klipper dit och sammanfattningen berättar hur det gick.
- Dokumenterat i README, hjälprutan (?) i spelet, CLAUDE.md (arkitekturtabellen: `gondola.js`, `dog.js`, `leak.js`, vaktmästaren i `crew.js`) och IDEER.md (det som är byggt är struket).
- Rättat: en ny simulering nollställer `S.heistDay`, så att en kupp i en tidigare simulering i samma process (testerna, ligan) inte stänger av kuppen i nästa.
- Den som är på uppdrag tar trappan när ingen hiss går. Två nya regler i testvakten: ingen kliver på en hiss som står still för vattnet, och ingen utom de som jagar kliver på där hissarna är spärrade för hunden.

## 2026-11-19 – Murphys lag (kaosknappen)
- En röd knapp under ett gul-svart plastlock i *Framkalla*: första klicket fäller upp locket (knappen blinkar), ett andra klick inom tre sekunder utlöser kaoset. Går att trycka **en gång per dygn**; locket plomberas om kl 06.
- Allt går inte att ha igång samtidigt (kuppen kräver ström, ingen brand och en ledig lastkaj), så knappen startar en kedjereaktion (`src/chaos.js`, `S.chaos`): värmebölja, ambulans, tågstörning och VIP → storm med blixt som slår ut strömmen → het motor när strömmen är tillbaka → hissfel, linbrott och panoramahissen fast på fasaden → turistbuss och rundvisning → brand → kuppen som final → flyttbilen. Ett steg som inte kan börja inom sin väntetid hoppas över.
- Driftchefen tar besluten som vanligt. När allt har lugnat sig sammanfattar en informationsruta (och dagens sammanfattning) vad som gick fel och vad som aldrig hann hända. En egen siren i husmusiken när kedjan startar.
- `triggerFault`, `triggerHeat`, `triggerCable` och `triggerPano` returnerar nu om något hände.

## 2026-11-19 – svenska som standard
- Spelet visas på svenska igen om inget annat är valt; engelska väljs under Inställningar ⚙️ (eller `?lang=en`). Ett sparat val gäller som förut.

## 2026-11-19 – huset bara går, rundvisningen, kuppen och engelska

### Ingen startmeny – ett enda Tornet
- Startmenyn är borttagen. Huset startar direkt (`src/start.js`); första gången visas uppstarten i DOS-svart och välkomstrutan, och sedan erbjuder Berit en rundvisning.
- Borta: scenarierna, Ny dag (Egenskaper), Dagens Torn, Spela om, det korta 6-minutersdygnet och dygnsskiftet ”Börjar om”. Dygnet rullar alltid vidare kl 06.
- Allt som går att ställa in görs i kontrollpanelen: styrlogik, slumpen, driftchefen, felknappar, underhåll och språk. Valen sparas i `localStorage`.
- Kvar för utvecklaren: `?seed=` (ett bestämt frö) och, internt, det korta tempot och `'ny'`-skiftet för testerna, ligan och `npm run bench`.

### Rundvisningen i husets vanliga gång (`src/visning.js`, `src/intro.js`)
- Berit visar en gäst (spelaren) runt i det dygn som pågår: entrén, driftcentralen, perrongen, Sky Café, takterrassen och tillbaka.
- Hon ringer bemanningen, och vikarien **Kicki** sköter receptionen under tiden – även larmen.
- Stoppen är platser, inte klockslag, och Berit berättar om det som händer där just då (tåget, chefens senaste beslut, trasiga hissar, dagens händelser).
- Händer något lägger hon om rutten dit – brand, storm, strömavbrott, hissfel, linbrott, panoramahissen på fasaden, flytten – aldrig in i brandzonen, och fortsätter sedan.
- Beställs från ?-rutan, entrén eller Berits ruta.
- Berit pratar högt med webbläsarens talsyntes (svensk eller engelsk röst efter språket); musiken sänks medan hon pratar.

### Rundvisningen dygnet runt
- Kvällsvärden **Yvonne** (19–07) sitter i receptionen när Berit har gått hem och tar rundvisningarna då. Hon sitter kvar på morgonen tills Berit är i huset, och Kicki lämnar över till nästa skift om guiden fortfarande är ute.
- Rundvisningen går att framkalla (🛎️ under Framkalla): den börjar direkt, och guiden avbryter rasten. Finns ingen receptionist i huset tar väktaren eller driftchefen den – chefen säger varför.
- Stängda stopp – takterrassen, Sky Café, perrongen när tågen inte går – låses upp av den som har nycklarna: vaktmästaren, väktaren eller en inringd jourvaktmästare. Gallret är uppe bara för gruppen, och nyckelbäraren låser efter dem.
- Knappar, repliker och loggen visar guidens namn. Yvonne har också en kvinnlig röst.
- Nästa rundvisning börjar först när förra gästen har lämnat huset, så att två gäster aldrig är ute samtidigt.

### Kuppen på 5:an (`src/heist.js`)
- En sällsynt incident i slumpen (högst en per dygn, kräver ledig lastkaj) och en knapp under Framkalla.
- Ett gäng från ”Fasad & Fönster AB” tar driftcentralen och kapar alla hissar utom varuhissen (`e.hijack`). Gisslan samlas i Sky Café; de som kommer under tiden vänds i dörren.
- Den som blev över – Berit på rundvisning, en boende, en tekniker eller den högst upp i huset – smyger i trapporna, slår av borren och signalerar till polisen från taket.
- Polisens insatsledare bestämmer (eller spelaren): vänta eller klippa strömmen (då släpper valvets lås), gå in via garaget eller taket, stoppa tåget, gå in nu. Gänget flyr den väg som inte är spärrad – skåpbilen, en helikopter eller tunnelbanan – eller grips. Ingen skjuter, ingen dör.
- Grafik: skåpbilen på rampen, gänget i overall, polisens blåljus, BRRRRR i valvet; ragtime och siren; utfallet i dagens sammanfattning.

### Engelska som standard (`src/lang.js`, `src/lang-en.js`)
- Spelet visas på engelska; svenska väljs under Inställningar ⚙️ och byts sömlöst mitt i ett dygn (`?lang=sv/en` i adressen).
- Koden och simuleringen skriver svenska; gränssnittet översätter allt när det visas (panelen, textskylten, verktygstips, overlayer, pixelgrafikens text, rundvisningen). Även gamla loggrader byter språk, och simuleringen påverkas inte.
- Omkring 2 500 mallar (svensk → engelsk, med värden `{0}` …). Texter utan egen mall delas vid avskiljarna och sätts ihop av bitarna.
- `npm run lang` (`tools/lang.mjs`) listar svenska texter i koden som saknar engelsk mall.

### Rättade fel
- Ett byte av brandläge från brandzon lade inte tillbaka passagerarnas stopp – hissen kunde åka förbi deras våningar.
- En väntande som var tilldelad en hiss hen inte längre fick åka (brandmännen och brandhissen) släpps nu direkt.

### Tester
Nya tester för rundvisningen (stoppen, vikarien, larmen, beställning över dygnsskiftet, avbeställning), kuppen (av sig själv, polisens val och flyktvägarna, under rundvisningen) och språket. Nya vaktregler: ingen kliver på en kapad hiss, gisslan lämnar inte Sky Café mitt i kuppen. 131 tester.
