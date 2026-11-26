# Tekniska förbättringar

Förslag som inte är gjorda än, ungefär i den ordning de ger mest. Stryk det som blir gjort.

- **Facit för bilderna** ligger bara lokalt (`tools/playtest-out/ögon/bas/`). Behövs det i CI eller på en annan dator kan det checkas in, men varje avsiktlig grafikändring blir då en binär ändring i repot.

Det som fortfarande läser enskilda incidenter direkt, med avsikt:
- Brand och strömavbrott är kärnans egna (`S.fire`, `S.outage`): brandzonen och strömmen påverkar hissarnas logik på för många ställen för att bli en registerpost.
