# Tornet

En skyskrapa i 16-bitars pixelgrafik där nio hissar, ett par hundra människor och en driftchef lever sitt eget liv – ett dockhus att titta på snarare än ett spel att vinna. Husets styrsystem heter **Hiss-O-Matic 3000**, och allt ritas i 90-talspaletten *Kontor 95*.

Huset sköter sig självt: driftchefen i kontrollrummet fattar alla beslut och berättar varför, och en regissör klipper kameran dit där något händer. Du kan när som helst ta över ett beslut, följa en person eller hiss, eller framkalla det mesta – en brand, ett strömavbrott, en storm eller en flyttdag.

## Kom igång

Spela direkt i webbläsaren på **<https://thohig.github.io/tornet/>** (GitHub Pages, byggs från `main`). Där behövs ingen server, men sidan cachas i 10 minuter, så en ny push kan dröja en stund innan den syns.

För att köra koden lokalt: det finns ingen byggprocess. Webbläsaren laddar källkoden som ES-moduler direkt.

```bash
python3 serve.py
```

Öppna sedan <http://localhost:8123>. Servern skickar inga cachehuvuden, så ändringar i koden syns direkt vid omladdning. Den lyssnar bara på den egna datorn och lämnar bara ut spelets filer. Spelet hämtar inget utifrån, och typsnittet ligger i `fonts/`. Ikonerna ligger i `ikon/`: flikens ikon, ikonen för hemskärmen på mobilen och `Tornet.icns`, samma bild i macOS-format.

- `python3 serve.py --lan` släpper in andra på nätverket, till exempel mobilen på samma wifi.
- `python3 serve.py --auto-stop` stänger av servern själv en stund efter att spelet stängts.

Det finns ingen startmeny – det finns ett enda Tornet, och det går hela tiden. Första gången visas uppstarten i DOS-svart och en kort välkomstruta, och sedan erbjuder receptionisten **Berit** en **rundvisning**. Den sker i dygnet som pågår: Berit ringer efter vikarien Kicki till disken och visar en gäst (du) runt i huset, och händer det något – en brand, ett hissfel, en storm – går ni dit och tittar. Berit pratar högt med webbläsarens svenska talsyntes när ljudet är på. Du kan be henne visa runt igen från hjälpen (?), entrén eller hennes ruta när du följer henne.

Allt som går att ställa in görs i kontrollpanelen medan huset går: styrlogik, slumpen (hur ofta incidenter kommer), driftchefen, felknappar och underhåll. Valen minns till nästa gång. Dygnet rullar alltid vidare kl 06.

Spelet visas på **svenska** som standard; med flaggorna längst upp till höger i panelen (eller under Inställningar ⚙️) byter du till **engelska** (och tillbaka) mitt i ett dygn – allt i panelen och bilden, även det som redan hänt, byter språk direkt. Koden och simuleringen är skrivna på svenska; översättningen sker när texten visas (`src/lang.js`, `src/lang-en.js`). Texter med värden skrivs sv`…` (`src/sv.js`) och vet då sin mall, så att översättningen inte behöver gissa var värdena börjar och slutar. Panelens meningar med värden i fetstil eller nedräkningar skrivs sh`…` och översätts som hela meningar.

Adressparametrar:

- `?seed=123` ger samma dygn varje gång (bra för felsökning och för att dela ett dygn). Med `&h=17.5` (klockslag) eller `&t=` (simuleringstid) spolas dygnet fram och spelet står pausat där; `&follow=H2` följer en hiss, en våning eller en person. Fallerar en regel i testerna skriver de ut en sådan länk.
- `?lang=sv` eller `?lang=en` väljer språk.
- `?prof=1` visar hur lång tid varje del av bildrutan tar att rita.

## Huset

- **21 våningar**, från pendeltågets perrong **PT** djupt i berget, via skyddsrummet **SR**, tunnelbanestationen **TB** under garaget, entrén **E** och sky lobbyn på **6**, upp till takterrassen **T** med helikopterplatta.
- **Låg zon** L1–L2 (TB–5) och **hög zon** H1–H2 (6–T) är staplade i samma schakt.
- **Expresshissarna** X1–X2 är dubbeldäckare mellan entrén och sky lobbyn. X1 går ända ner till pendeltåget.
- **Djupt i berget** under tunnelbanan ligger skyddsrummet och pendeltågets perrong. Pendelhissen och en lång rulltrappa genom berget går mellan pendeln och tunnelbanan, och folk byter tåg utan att gå in i huset. Första måndagen i kvartalet kl 15 provas Hesa Fredrik, och efteråt övar huset att gå ner i skyddsrummet.
- **Pendelhissen PH** går med en stor korg genom berget mellan pendeln, skyddsrummet och tunnelbanan.
- **Varuhissen V** tar städvagnar, paket, flyttlass och brandkåren.
- **Panoramahissen P** åker i ett glasrör utanpå fasaden, hela vägen från perrongen upp till taket.
- **Tunnelbanestationen** Tornplan T-bana ligger under huset: perrongen har kiosk, tidtabell och en bänk, och tåget kommer med folk i klump.
- **Skywalken:** en inglasad gångbro från sky lobbyn till granntornet **Kronan**, som syns i bildens högerkant (dra i bilden eller låt regissören glida dit). Grannarna kommer över bron med ärenden och för att äta i Sky Café, Tornets folk äter lunch på Kronans Krog, och Kronans driftchef Göran pratar i radion. Bron har öppet 06.30–22.
- **Kalendern:** Tornet har samma datum som datorn. Årstiden styr temperaturen, solen styr ljuset (mörkt halv fyra i december, ljusa nätter vid midsommar), och på helgen är huset glesare. Framkalla har ett datumval för att prova en annan dag.
- **Folket:** anställda, besökare, boende, nattpersonal och stamgäster med egna egenheter. Bland stamgästerna finns Gunnar som hatar att vänta, Doris som håller upp dörren och Majken, 87, som pratar med alla i hissen.
- **Personalen:** driftchefer, bildproducenter, en receptionist (med vikarien Kicki när hon visar runt) och en fönsterputsare. De har skift, raster och poster.
- **Händelser:** brand med brandkår och återsamlingsplats, strömavbrott med reservkraft, storm och blixtar, hissfel och linbrott, överhettade motorer, panoramahissen som fastnar på fasaden (räddningstjänsten firar ner folk eller tar dem med stegbilen), ambulans, flyttdag med hissbalke, VIP-helikopter, tunnelbanetåg som kommer i klump – och ibland **Kuppen på 5:an** (framkallar du den när lastkajen är upptagen kör skåpbilen runt kvarteret tills den är ledig): ett rånargäng från ”Fasad & Fönster AB” kapar hissarna för att tömma valvet i Guldbanken, gisslan samlas i Sky Café, den som blev över smyger i trapporna och polisens insatsledare bestämmer (ingen skjuter och ingen dör). Du kan också skicka en turistbuss: en guide leder en grupp på stadstur upp till takterrassen och Sky Café. Husets vaktmästare Bosse rycker ut när något går snett i vardagen: när fönsterputsarens gondol fastnar på fasaden, när en pudel från hundsalongen rymmer och åker hiss runt huset, och när ett vattenrör spricker och vattnet rinner ner genom våningarna och schakten tills han hunnit stänga huvudkranen i pannrummet. Ibland kraschar **Hiss-O-Matic 3000** själv: hissarna går i nödläge och stannar på varje våning medan supporten frågar om man har testat att starta om. Tåget kan fastna i tunneln så att perrongen fylls, någon kan få panik i en fullsatt hiss som tvärstannat, och på eftermiddagen kan ett företag ha firmafest med ballonger som fastnar i hissdörrarna och en tårta som måste åka varuhissen. Pumparna i berget kan stanna, så att grundvattnet stiger mot pendelhissens grop tills vaktmästaren fått igång dem. Rulltrappan till expressens övre däck kan tvärstanna, och då får folk antingen gå i den eller ta nedre däcket medan vaktmästaren letar efter det som löste ut nödstoppet. Från sky lobbyn går en inglasad **skywalk** till granntornet Kronan: grannarna kommer över bron och äter i Sky Café, Tornets folk äter lunch på Kronans Krog, och Kronans driftchef Göran pratar i radion. Kraschar Kronans hissar ber Göran att få låna Tornets, någon kan få höjdskräck mitt på glasbron, i stormen stängs bron eller hålls öppen med vakt, vid brand utryms de ovanför över bron – och rånarna kan försöka fly den vägen, rakt i polisens bakhåll. Och en gång per dygn kan du fälla upp plastlocket och trycka på den röda knappen **Murphys lag**: då går allt som kan gå fel fel, det ena efter det andra – storm, blixt och strömavbrott, hissfel, linbrott, brand och till sist kuppen – och huset får klara sig så gott det går.
- **Musik:** husmusik som följer dygnet (ragtime i rusningen, vals, lunchjazz, lounge, speldosa) med korta inslag när något händer, och en egen hissmusik inne i hissen du följer. Dörrarna och plingen hamnar i musikens takt, så hela huset spelar med. Musiken är avstängd tills du slår på den i panelen.

Styrlogiken kan bytas medan huset kör:

| Styrlogik | Hur den väljer hiss |
|---|---|
| **Smart** | Destinationsstyrning med kostnadsfunktion (hämtning, resa, stopp och last), omfördelning och lärande parkering |
| **Rusning** | Som Smart, men känner av trafikmönstret och tågtidtabellen |
| **Energisnål** | Väger in kWh mot väntetid |
| **Närmast** | Den hiss som är närmast |
| **Kaos** | En slumpad hiss |
| **Knappar** | Gammaldags hallknappar ▲/▼ – styrningen vet inte vart folk ska |

## Kontroller

| | |
|---|---|
| Klick i bilden | Följ en person, hiss eller våning |
| Mellanslag | Paus |
| 1 / 2, − / + | Hastighet (¼× ½× 1× 2×) |
| N | ⏩ Spola fram natten (kvällen och natten, stannar på morgonen eller när något händer) |
| F | Koppla loss eller på kameran |
| A | Regissören (automatisk kamera) – på från start, tar kameran igen när du släpper den; A stänger av den |
| H | Biografläge |
| T | Namnbrickor |
| S | Byt styrlogik |
| M | Ljud |
| ↑ ↓ PgUp PgDn Home End | Scrolla |
| Esc | Sluta följa eller stäng vyn |

Allt annat finns i kontrollpanelen till vänster. Varje ikon förklaras när du håller muspekaren över den. Går något fel i spelet fryser det inte: felet visas i en röd ruta nere till vänster (klicka för att stänga) – skicka gärna texten om du ser den.

**Tornet gör sig bäst på en dator.** På mobilen tittar man: bilden fyller skärmen, regissören väljer vad som visas om du inte tar kameran själv, och det finns ingen kontrollpanel. Nertill finns en rad med det som händer och en list med ❚❚ paus, 🎬 regissören (intryckt: regissören klipper åt dig, uppsläppt: fri kamera), ⏩ spola fram natten (på kvällen och natten), ? hjälp och språket. Spelet går alltid i 1×. Tryck på en person, en hiss eller en våning så följer kameran den, och dra i bilden för att se resten av huset. Välkomstrutan varnar vid varje start att framkalla, styrning och driftchefens beslut bara finns på datorn. På tvären ligger listen som en smal kolumn till höger.

## Utveckling

Node behövs bara för tester och typkontroll.

```bash
npm test            # hela testsviten i Node, parallellt (--jobs=N)
npm run typecheck   # tsc på JSDoc-typerna
npm run check       # typkontroll, långa kodrader och hela sviten
npm run quick       # snabbläget: färre slumpade dygn, ungefär halva tiden
npm run golden      # skriv om facit efter avsiktliga beteendeändringar
npm run bench       # simuleringens fart
npm run league      # styrlogikerna mot varandra: väntetid, kWh, trappa …
npm run playtest    # provspelning i Chromium (= npm run check:ui): kaosdygn och fasta ögonblick, se nedan
npm run lines       # kodrader som är för långa (texten räknas inte)
npm run new-incident -- duva "Duvan i hallen" "Pigeon in the hall" 🐦   # skelettet till en ny incident
npm run hooks       # git-kroken: npm run quick före varje commit
```

Samma testsvit körs i webbläsaren på `/tests.html`. Panelen och pixelgrafiken testas inte i Node – det gör `npm run playtest` i en riktig webbläsare. Den spelar kaosdygn och letar efter fel, svenska som blivit kvar i det engelska gränssnittet och text som ritas över annan text i bilden. Den tar också skärmdumpar av fasta ögonblick på datorn (och två på mobilen) och jämför dem med förra facit: öppna `tools/playtest-out/ögon/index.html` för att se vad som ändrats, och kör `npm run playtest -- --del=ögon --godta` när ändringen är avsiktlig. Det behöver Playwright, som inte är ett beroende i projektet: `npm i --no-save playwright && npx playwright install chromium`. Kör det efter ändringar i gränssnittet eller texterna (`--seeds=21,5`, `--lang=en`, `--keep` sparar skärmdumpar i `tools/playtest-out/`). På GitHub kör `npm run check` vid push till `main` och vid pull request (inte när bara `.md`-filer ändrats). Kör `npm run quick` lokalt före varje commit och hela `npm run check` innan något hamnar på `main`. `npm run hooks` kopplar in en git-krok som gör det åt dig, och som kör provspelningen när gränssnittet ändrats (`git commit --no-verify` hoppar över).

**Upplägg.** Simuleringen i `src/` rör aldrig DOM eller canvas och kör headless i Node med fast tidssteg och seedad slump i namngivna strömmar. Samma frö ger alltid exakt samma dygn. Grafiken läser bara simuleringens tillstånd, och allt spelaren gör går via `act()`. Huset beskrivs som data i `BUILDING` i `config.js`, och resten räknas ut därifrån. Husets delsystem och incidenter står i två register: `src/systems.js` (simuleringen – hur de tickar, startar, förvarnar, vad driftchefen gör och vad folket och hissarna behöver veta) och `src/incui.js` (gränssnittet – knappen i *Framkalla*, incidentkortet och regissörens klipp). En ny incident är en egen modul och en post i vart och ett av registren. Mer om arkitekturen och reglerna finns i [CLAUDE.md](CLAUDE.md).

All text i spelet och i koden är på svenska.

Vad som har ändrats står i [CHANGELOG.md](CHANGELOG.md).
