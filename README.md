# Tornet

En skyskrapa i 16-bitars pixelgrafik där åtta hissar, ett par hundra människor och en driftchef lever sitt eget liv – ett dockhus att titta på snarare än ett spel att vinna. Husets styrsystem heter **Hiss-O-Matic 3000**, och allt ritas i 90-talspaletten *Kontor 95*.

Huset sköter sig självt: driftchefen i kontrollrummet fattar alla beslut och berättar varför, och en regissör klipper kameran dit där något händer. Du kan när som helst ta över ett beslut, följa en person eller hiss, eller framkalla det mesta – en brand, ett strömavbrott, en storm eller en flyttdag.

## Kom igång

Det finns ingen byggprocess. Webbläsaren laddar källkoden som ES-moduler direkt.

```bash
python3 serve.py
```

Öppna sedan <http://localhost:8123>. Servern skickar inga cachehuvuden, så ändringar i koden syns direkt vid omladdning.

- `?seed=123` ger samma dygn varje gång.
- `?tempo=kort` ger ett 6-minutersdygn i stället för det långa på ungefär 15 minuter.

## Huset

- **19 våningar**, från tunnelbanestationen **TB** under garaget, via entrén **E** och sky lobbyn på **6**, upp till takterrassen **T** med helikopterplatta.
- **Låg zon** L1–L2 (TB–5) och **hög zon** H1–H2 (6–T) är staplade i samma schakt.
- **Expresshissarna** X1–X2 är dubbeldäckare mellan entrén och sky lobbyn. X1 går ända ner till tunnelbanan.
- **Varuhissen V** tar städvagnar, paket, flyttlass och brandkåren.
- **Panoramahissen P** åker i ett glasrör utanpå fasaden, hela vägen från perrongen upp till taket.
- **Folket:** anställda, besökare, boende, nattpersonal och stamgäster med egna egenheter. Bland stamgästerna finns Gunnar som hatar att vänta, Doris som håller upp dörren och Majken, 87, som pratar med alla i hissen.
- **Personalen:** driftchefer, bildproducenter, en receptionist och en fönsterputsare. De har skift, raster och poster.
- **Händelser:** brand med brandkår och återsamlingsplats, strömavbrott med reservkraft, storm och blixtar, hissfel och linbrott, överhettade motorer, ambulans, flyttdag med hissbalke, VIP-helikopter och tunnelbanetåg som kommer i klump.

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
| ↑ ↓ PgUp PgDn | Scrolla |
| Esc | Sluta följa eller stäng vyn |

Allt annat finns i kontrollpanelen till vänster. Varje ikon förklaras när du håller muspekaren över den.

## Utveckling

Node behövs bara för tester och typkontroll.

```bash
npm test            # hela testsviten i Node (några minuter)
npm run typecheck   # tsc på JSDoc-typerna
npm run check       # båda
npm run golden      # skriv om facit efter avsiktliga beteendeändringar
npm run bench       # simuleringens fart
npm run league      # styrlogikerna mot varandra: väntetid, kWh, trappa …
```

Samma testsvit körs i webbläsaren på `/tests.html`.

**Upplägg.** Simuleringen i `src/` rör aldrig DOM eller canvas och kör headless i Node med fast tidssteg och seedad slump i namngivna strömmar. Samma frö ger alltid exakt samma dygn. Grafiken läser bara simuleringens tillstånd, och allt spelaren gör går via `act()`. Huset beskrivs som data i `BUILDING` i `config.js`, och resten räknas ut därifrån. Mer om arkitekturen och reglerna finns i [CLAUDE.md](CLAUDE.md).

All text i spelet och i koden är på svenska.
