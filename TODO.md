# Tekniska förbättringar

Förslag som inte är gjorda än, ungefär i den ordning de ger mest. Stryk det som blir gjort.

- **Text över text i bilden** (`KNOWN` i tools/playtest.mjs): repliker och tankebubblor från folk i korgarna bokar ingen plats, så de kan hamna över vågen på korgens överkant, över varandra och över korgens skyltar (LINBYTE). Blåljusens skyltar i entrén (BRANDKÅREN, POLISEN) och de instängdas HJÄLP! bokar heller ingen plats. Repliken från rummen ritas efter spårlappen. Låt korgarna och blåljusen boka plats (`reserve`), eller rita bubblorna efter dem – och stryk raden i `KNOWN`.
- **Långa kodrader:** `npm run lines -- --code=120` visar ett fyrtiotal rader med mycket kod på en rad (hud.js, panels.js, incui.js, visning.js). Bryt dem när modulen ändras ändå.
- **Facit för bilderna** ligger bara lokalt (`tools/playtest-out/ögon/bas/`). Behövs det i CI eller på en annan dator kan det checkas in, men varje avsiktlig grafikändring blir då en binär ändring i repot.

Det som fortfarande läser enskilda incidenter direkt, med avsikt:
- Brand och strömavbrott är kärnans egna (`S.fire`, `S.outage`): brandzonen och strömmen påverkar hissarnas logik på för många ställen för att bli en registerpost.
