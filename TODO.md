# Tekniska förbättringar

Förslag som inte är gjorda än, ungefär i den ordning de ger mest. Stryk det som blir gjort.

## CI på GitHub
Repot har ingen `.github/workflows`. En workflow som kör `npm run check` vid push och PR fångar brutet facit och typfel innan de hamnar på `main`. Node behöver bara `npm ci` (TypeScript är enda beroendet).

## Dela upp testet med 40 slumpade dygn
”Invarianter över 40 slumpade dygn” tar ensam ~58 s och sätter golvet för hela sviten nu när den körs parallellt (~94 s på 10 kärnor). Delas det i fyra tester om tio dygn var bör sviten gå ner mot 30–40 s. Samma sak gäller i mindre skala ”Spelaråtgärder … över 24 dygn” (~34 s) och ”Samma frö ger exakt samma dag” (~28 s).

## Typer för `Person` och `Elevator`
`HallCall`, `CastDef`, `Shot` m.fl. har `@typedef`, men inte de två viktigaste objekten – `p` och `e` är otypade överallt. En typ för var och en, plus de 14 `@type {any}` i `S` (`chief`, `storm`, `move`, `pano`, `brigade`, `medic` …), låter `tsc` hitta felstavade fält. På sikt kan `strict` slås på fil för fil.

## Dela upp `pixel.js`
2 265 rader, nästan en femtedel av spelkoden. Dela efter vad som ritas – t.ex. hallar/korridorer/skyltar, schakt/korgar, gatan/perrongen/bilar, kontrollrummet/personalrummet – och behåll `layer()` och `reserve`/`place` i `pixel.js`. Inget beteende ändras.

## Spara och spela upp ett dygn
Simuleringen är deterministisk, så ett dygn kan sparas som frö + inställningar + en lista med `act()`-anrop och tidpunkter. Det ger:
- **Fortsätt där du var** efter omladdning (i dag sparas bara inställningarna i `localStorage`).
- **Dela ett dygn** – någon annan ser exakt samma sak.
- **Felrapporter som går att återskapa** – spelaren skickar loggen, den spelas upp headless i Node.

## Mät ritningen
`npm run bench` mäter simuleringen men inte grafiken, och `renderPixel` gör mycket per bildruta. Ett profilläge (t.ex. `?prof=1`) som visar tid per del (hallar, folk, text, lager) direkt i bilden – särskilt nyttigt på mobilen.
