# Idéer till spelet

Idéer som vi har pratat om men inte byggt. Stryk det som blir gjort eller som du inte vill ha. De tekniska förbättringarna står i `TODO.md`.

## Engelska som andra språk – svenska är standard

Spelet ska gå att spela på engelska. Svenska är standard och förblir källspråket i koden (kommentarer och loggar i koden på svenska som i dag); engelska väljs i inställningarna ⚙️ och minns i `localStorage`.

**Går det att byta språk sömlöst, mitt i ett dygn?** Ja – om texterna lagras som *nyckel + värden* i stället för färdiga meningar. Det mesta i panelen räknas fram varje gång den ritas (`updatePanel`) och kan bytas direkt. Det som inte gör det är texter som simuleringen redan har skrivit och sparat: loggen `S.log`, driftradion `S.feed`, personernas dagbok `p.hist`, informationsrutorna `S.notices`, dagens händelser `S.stats.events`, chefens beslut `S.chief.log`/`say`, pratbubblorna `p.say` och Berits repliker `S.visning.line`. Sparas de som färdig svenska blir gamla rader kvar på svenska efter bytet. Sparas de som `{ k: nyckel, v: { namn, våning … } }` och översätts när de ritas, byter allt språk på en gång – även det som hände för en timme sedan.

**Omfattning:** ungefär 1 400 kodrader med svenska strängar i 45 moduler och drygt 430 anrop som skriver text till tillståndet (`log`, `pev`, `speak`, `notice`, `decide`, `dayEvent` …). Mest i `hud.js`, `config.js` (våningsteman, platser, personal, stamgästernas repliker), `director.js`, `people.js`, `service.js`, `visits.js`, `visning.js` och `heist.js`.

**Förslag:**

1. **`lang.js`** med `t(svensk mall, värden)` – den svenska texten *är* nyckeln (som gettext): `t('Byter hiss på {f} – vidare mot {g}', { f, g })`. Koden förblir läsbar på svenska, och saknas en översättning visas svenskan. Engelskan ligger i `lang/en.js` som en tabell från svensk mall till engelsk mall. `LANG` sätts av gränssnittet.
2. **Simuleringen skriver nycklar, inte meningar.** `log`, `pev`, `notice`, `speak`, `decide` och de andra tar emot mallen och värdena och sparar dem som de är (`{ k, v }`). Det är en ren omskrivning av anropen – inga slumptal flyttas och simuleringen läser aldrig språket, så determinismen och facit påverkas inte. Repliker som slumpas ur listor (stamgästerna, personalen, gisslan) sparar *index*, så att engelskan väljer samma replik.
3. **Gränssnittet översätter när det ritar:** panelen, loggen, dagboken, pratbubblorna, textskylten och sammanfattningen går genom `t()`. Skyltarna i pixelgrafiken (STÄNGT, TRAPPA, POLISEN, FASAD, våningsnamnen …) likaså; lagren (`layer()` i pixcore.js) får språket i nyckeln så att de ritas om vid bytet. Bitmapstypsnittet 3×5 klarar redan engelska.
4. **Egennamn stannar:** personernas namn, Tornet, Hiss-O-Matic 3000, Guldbanken, Kanal 97, Fasad & Fönster AB. Beskrivningar och rollnamn översätts.
5. **Berits röst** byter till en engelsk röst (`en-GB`) med samma Web Speech-kod; hennes repliker är nycklar som allt annat.
6. **Byte i inställningarna:** Svenska / English. Panelen ritas om, lagren ritas om och rösten byts – dygnet fortsätter som om inget hänt.
7. **Tester:** sviten kör på svenska som i dag (många tester läser texterna). Ett nytt test går igenom alla mallar som används och kräver att varje har en engelsk översättning med samma `{platshållare}`; ett annat kör ett dygn med `LANG = 'en'` och letar efter svenska tecken (å, ä, ö) i allt som ritas i panelen.

**Ordning:** (1) `lang.js` och panelens fasta texter (knappar, rubriker, verktygstips) – syns direkt och kan byta sömlöst redan nu. (2) Loggen, dagboken, informationsrutorna och besluten som nycklar. (3) Repliker, skyltar i grafiken, rundvisningen och Berits röst. (4) Testerna. Steg 1 ger ett spelbart engelskt gränssnitt där bara gamla loggrader kan vara kvar på svenska tills steg 2 är klart.
