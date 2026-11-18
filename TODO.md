# Tekniska förbättringar

Förslag som inte är gjorda än, ungefär i den ordning de ger mest. Stryk det som blir gjort.

## Dela upp testet med 40 slumpade dygn
”Invarianter över 40 slumpade dygn” tar ensam ~58 s och sätter golvet för hela sviten nu när den körs parallellt (~94 s på 10 kärnor). Delas det i fyra tester om tio dygn var bör sviten gå ner mot 30–40 s. Samma sak gäller i mindre skala ”Spelaråtgärder … över 24 dygn” (~34 s) och ”Samma frö ger exakt samma dag” (~28 s).

## Stäng `S` för typkontrollen
`Person`, `Elevator` och incidenternas tillstånd (`S.fire`, `S.pano`, `S.move` …) har typer, men `S` själv är ett öppet objekt i en JS-fil: `tsc` godtar vilket fält som helst på `S` (även `S.felstavat`), och fält som `S.train`, `S.autos` och `S.heli` läggs till utanför `state.js`. En handskriven typ för hela `S` (ungefär 110 fält) stänger det. Även `S.stats` (`ReturnType<typeof newStats>`) är öppen. På sikt kan `strict` slås på fil för fil.

## Mät ritningen
`npm run bench` mäter simuleringen men inte grafiken, och `renderPixel` gör mycket per bildruta. Ett profilläge (t.ex. `?prof=1`) som visar tid per del (hallar, folk, text, lager) direkt i bilden – särskilt nyttigt på mobilen.
