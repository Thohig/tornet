# Tekniska förbättringar

Förslag som inte är gjorda än, ungefär i den ordning de ger mest. Stryk det som blir gjort.

- **X1 är den enda vägen från höga zonen ner till perrongerna.** Med pendeln åker den längre och fler ska ner med den. På sex dygn utan incidenter blev väntan i sky lobbyn för dem som ska till tunnelbanan eller pendeln längre (p95 före → efter): Smart 19 → 27 s, Rusning 18 → 34 s, Närmast 25 → 48 s. Med Murphys lag kan det bli över 100 s i kvällsrusningen. Idéer: låta den som ska ner byta till X2 och entrén när kön till X1 är lång (som `upperDeckChoice` i people.js), eller låta X1 möta pendeln i Rusning (`trainNear`/`meetTrain` i dispatch.js). Mät med `npm run league` före och efter.

Mätt och avfärdat:
- Att Murphys lag (chaos.js) skulle vänta in strömmen före branden: på 24 kaosdygn (frö 1–24, kl 10) brann det under ett strömavbrott ett enda dygn i 34 s. Långa stillastående dygn kommer från vanliga strömavbrott i tidtabellen, inte från kedjan.

Det som fortfarande läser enskilda incidenter direkt, med avsikt:
- Brand och strömavbrott är kärnans egna (`S.fire`, `S.outage`): brandzonen och strömmen påverkar hissarnas logik på för många ställen för att bli en registerpost.
