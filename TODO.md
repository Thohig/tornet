# Tekniska förbättringar

Förslag som inte är gjorda än, ungefär i den ordning de ger mest. Stryk det som blir gjort.

Inget kvar av incidentregistret. Det som fortfarande läser enskilda incidenter direkt, med avsikt:
- Brand och strömavbrott är kärnans egna (`S.fire`, `S.outage`): brandzonen och strömmen påverkar hissarnas logik på för många ställen för att bli en registerpost.
- Ljudet och husmusiken (`sound.js`, `score.js`) har en rad var för brandlarmet, polisens siren, blixten och kuppens ragtime. Behöver fler incidenter egna ljud kan `incUi()` få fältet `sound`.
