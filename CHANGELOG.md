# Ändringar

## November 2026 – huset bara går, rundvisningen, kuppen och engelska

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
- Beställs från ?-rutan, entrén eller Berits ruta; beställd på kvällen börjar den nästa morgon.
- Berit pratar högt med webbläsarens talsyntes (svensk eller engelsk röst efter språket); musiken sänks medan hon pratar.

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
