# Tornet

En skyskrapa i 16-bitars pixelgrafik där åtta hissar, ett par hundra människor och en driftchef lever sitt eget liv – ett dockhus att titta på snarare än ett spel att vinna. Husets styrsystem heter **Hiss-O-Matic 3000**, och allt ritas i 90-talspaletten *Kontor 95*.

Huset sköter sig självt: driftchefen i kontrollrummet fattar alla beslut och berättar varför, och en regissör klipper kameran dit där något händer. Du kan när som helst ta över ett beslut, följa en person eller hiss, eller framkalla det mesta – en brand, ett strömavbrott, en storm eller en flyttdag.

## Kom igång

Det finns ingen byggprocess. Webbläsaren laddar källkoden som ES-moduler direkt.

```bash
python3 serve.py
```

Öppna sedan <http://localhost:8123>. Servern skickar inga cachehuvuden, så ändringar i koden syns direkt vid omladdning. Den lyssnar bara på den egna datorn och lämnar bara ut spelets filer. Spelet hämtar inget utifrån, och typsnittet ligger i `fonts/`.

- `python3 serve.py --lan` släpper in andra på nätverket, till exempel mobilen på samma wifi.
- `python3 serve.py --auto-stop` stänger av servern själv en stund efter att spelet stängts.

Det finns ingen startmeny – det finns ett enda Tornet, och det går hela tiden. Första gången visas uppstarten i DOS-svart och en kort välkomstruta, och sedan erbjuder receptionisten **Berit** en **rundvisning**. Den sker i dygnet som pågår: Berit ringer efter vikarien Kicki till disken och visar en gäst (du) runt i huset, och händer det något – en brand, ett hissfel, en storm – går ni dit och tittar. Berit pratar högt med webbläsarens svenska talsyntes när ljudet är på. Du kan be henne visa runt igen från hjälpen (?), entrén eller hennes ruta när du följer henne.

Allt som går att ställa in görs i kontrollpanelen medan huset går: styrlogik, slumpen (hur ofta incidenter kommer), driftchefen, felknappar och underhåll. Valen minns till nästa gång. Dygnet rullar alltid vidare kl 06.

Spelet visas på **svenska** som standard; med flaggorna längst upp till höger i panelen (eller under Inställningar ⚙️) byter du till **engelska** (och tillbaka) mitt i ett dygn – allt i panelen och bilden, även det som redan hänt, byter språk direkt. Koden och simuleringen är skrivna på svenska; översättningen sker när texten visas (`src/lang.js`, `src/lang-en.js`).

Adressparametrar:

- `?seed=123` ger samma dygn varje gång (bra för felsökning och för att dela ett dygn).
- `?lang=sv` eller `?lang=en` väljer språk.
- `?prof=1` visar hur lång tid varje del av bildrutan tar att rita.

## Huset

- **19 våningar**, från tunnelbanestationen **TB** under garaget, via entrén **E** och sky lobbyn på **6**, upp till takterrassen **T** med helikopterplatta.
- **Låg zon** L1–L2 (TB–5) och **hög zon** H1–H2 (6–T) är staplade i samma schakt.
- **Expresshissarna** X1–X2 är dubbeldäckare mellan entrén och sky lobbyn. X1 går ända ner till tunnelbanan.
- **Varuhissen V** tar städvagnar, paket, flyttlass och brandkåren.
- **Panoramahissen P** åker i ett glasrör utanpå fasaden, hela vägen från perrongen upp till taket.
- **Folket:** anställda, besökare, boende, nattpersonal och stamgäster med egna egenheter. Bland stamgästerna finns Gunnar som hatar att vänta, Doris som håller upp dörren och Majken, 87, som pratar med alla i hissen.
- **Personalen:** driftchefer, bildproducenter, en receptionist (med vikarien Kicki när hon visar runt) och en fönsterputsare. De har skift, raster och poster.
- **Händelser:** brand med brandkår och återsamlingsplats, strömavbrott med reservkraft, storm och blixtar, hissfel och linbrott, överhettade motorer, panoramahissen som fastnar på fasaden (räddningstjänsten firar ner folk eller tar dem med stegbilen), ambulans, flyttdag med hissbalke, VIP-helikopter, tunnelbanetåg som kommer i klump – och ibland **Kuppen på 5:an**: ett rånargäng från ”Fasad & Fönster AB” kapar hissarna för att tömma valvet i Guldbanken, gisslan samlas i Sky Café, den som blev över smyger i trapporna och polisens insatsledare bestämmer (ingen skjuter och ingen dör). Du kan också skicka en turistbuss: en guide leder en grupp på stadstur upp till takterrassen och Sky Café. Husets vaktmästare Bosse rycker ut när något går snett i vardagen: när fönsterputsarens gondol fastnar på fasaden, när en pudel från hundsalongen rymmer och åker hiss runt huset, och när ett vattenrör spricker och vattnet rinner ner genom våningarna och schakten tills han hunnit stänga huvudkranen i pannrummet. Och en gång per dygn kan du fälla upp plastlocket och trycka på den röda knappen **Murphys lag**: då går allt som kan gå fel fel, det ena efter det andra – storm, blixt och strömavbrott, hissfel, linbrott, brand och till sist kuppen – och huset får klara sig så gott det går.
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
| F | Koppla loss eller på kameran |
| A | Regissören (automatisk kamera) |
| H | Biografläge |
| T | Namnbrickor |
| S | Byt styrlogik |
| M | Ljud |
| ↑ ↓ PgUp PgDn Home End | Scrolla |
| Esc | Sluta följa eller stäng vyn |

Allt annat finns i kontrollpanelen till vänster. Varje ikon förklaras när du håller muspekaren över den.

## Utveckling

Node behövs bara för tester och typkontroll.

```bash
npm test            # hela testsviten i Node, parallellt (--jobs=N)
npm run typecheck   # tsc på JSDoc-typerna
npm run check       # båda
npm run quick       # snabbläget: färre slumpade dygn, ungefär halva tiden
npm run golden      # skriv om facit efter avsiktliga beteendeändringar
npm run bench       # simuleringens fart
npm run league      # styrlogikerna mot varandra: väntetid, kWh, trappa …
```

Samma testsvit körs i webbläsaren på `/tests.html`. På GitHub kör `npm run check` vid push till `main` och vid pull request (inte när bara `.md`-filer ändrats). Kör `npm run quick` lokalt före varje commit och hela `npm run check` innan något hamnar på `main`.

**Upplägg.** Simuleringen i `src/` rör aldrig DOM eller canvas och kör headless i Node med fast tidssteg och seedad slump i namngivna strömmar. Samma frö ger alltid exakt samma dygn. Grafiken läser bara simuleringens tillstånd, och allt spelaren gör går via `act()`. Huset beskrivs som data i `BUILDING` i `config.js`, och resten räknas ut därifrån. Husets delsystem och incidenter står i två register: `src/systems.js` (simuleringen – hur de tickar, startar, förvarnar, vad driftchefen gör och vad folket och hissarna behöver veta) och `src/incui.js` (gränssnittet – knappen i *Framkalla*, incidentkortet och regissörens klipp). En ny incident är en egen modul och en post i vart och ett av registren. Mer om arkitekturen och reglerna finns i [CLAUDE.md](CLAUDE.md).

All text i spelet och i koden är på svenska.

Vad som har ändrats står i [CHANGELOG.md](CHANGELOG.md).
