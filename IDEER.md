# Idéer till spelet

Idéer som vi har pratat om men inte byggt. Stryk det som blir gjort eller som du inte vill ha. De tekniska förbättringarna står i `TODO.md`.

# Samlat förslag: huset bara går

Tre delar som hör ihop: **(1)** startmenyn och spellägena försvinner, **(2)** rundvisningen sker i husets vanliga gång, **(3)** Kuppen på 5:an kommer som en vanlig incident. Gemensam tanke: dockhusprincipen fullt ut. Det finns ett enda Tornet som går hela tiden; allt man ser – även rundvisningen och kuppen – händer i det dygn som pågår. Inget spolas fram, inget framkallas bakom kulisserna, ingen slump stängs av.

Byggordning: 1 → 2 → 3. Del 1 tar mest bort och gör de andra enklare; del 2 behöver inget av del 3, men del 3 får en bonus om del 2 finns (se ”Berit och kuppen”).

---

## 1. Ingen startmeny – ett enda sätt att spela

**Spelet startar direkt.** Första gången visas uppstarten i DOS-svart, sedan går huset. Allt som går att ställa in görs i kontrollpanelen medan huset går.

**Bort ur spelet:**

| Vad | Varför | I koden |
|---|---|---|
| Scenarierna | Spolar fram, stänger av slumpen och framkallar en färdig händelse. Allt de visar kan hända på en vanlig dag eller framkallas i panelen. | `SCENARIOS`, `scenHtml`, `s:` i `pickItem`, `M.spin`/`SPIN_MS`, `M.plan` i `menuTick`, `.mn-spin`/`.mn-bar` i CSS |
| Ny dag (Egenskaper) | Allt den ställer in finns i panelen eller försvinner. | `newHtml`, `opts`, `dice`/`go`/`back`, `.mn-props`/`.mn-radios`/`.mn-seed` |
| Dagens Torn | Bygger på att ett dygn är en omgång. | `todaySeed`, `today` |
| Spela om | Med mjuka skiften finns inget ”förra dygnet” att spela om; ett dygn är en del av husets liv, inte en omgång. | `lastLine`, `replay`, `rememberDay` (anropas från hud.js), `KEY.last`, `.mn-last` |
| Det korta dygnet | Ett tempo räcker: det långa (~15 min). | tempovalet, `?tempo=` i main.js |
| Dygnsskiftet ”Börjar om” | Huset rullar alltid vidare kl 06. | valet `roll` i panels.js, `?dygn=` i main.js, grenen i hud.js som stannar spelet när dygnet tar slut |
| Startmenyn själv | Inget kvar att välja. | `mainHtml`, `offerHtml`, visningsdygnet bakom menyn (`menuDemo`); uppstarten (`boot`) flyttas till main.js eller blir det enda i menu.js |

**Kvar i simuleringen** (för tester, ligan och `npm run bench`): det korta tempot i `TEMPOS` och dygnsskiftet `'ny'` (`newSim`s standard, `resetDay`). Inget av det syns i spelet. Döp gärna om det korta tempot så att det syns att det är ett testtempo.

**Kvar i panelen** – det enda stället att ställa in något: styrlogiken (Styrning), slumpen (Av/Lugnt/Normalt/Kaos – kontrollera att den har en knapp, annars lägg till en), driftchefen på/rast, framkalla (ersätter scenarierna), inställningarna ⚙️ och ?-knappen (Hur funkar det – välkomstrutan visas av sig själv första gången, som i dag). Valen sparas i `localStorage` och gäller nästa gång spelet startas.

**Kvar för utvecklaren:** `?seed=` – ett bestämt frö, för felsökning och för att dela ett dygn.

**Att uppdatera:** README (startmenyn, scenarierna, tempot), CLAUDE.md (raderna om `menu.js` och `intro.js`, ”Dygnsskiftet”: spelet = alltid mjukt, `'ny'` = bara tester/liga; ”Dygnets tempo”), `showIntro` i hud.js och eventuella menytester.

---

## 2. Rundvisningen i husets vanliga gång

I dag är rundvisningen ett eget dygn med fast frö (`INTRO_SEED`) som spolas fram och framkallar ett hissfel och en VIP. Nu: **Berit visar runt på riktigt, i dygnet som pågår.**

**Gästen.** Berit visar runt en synlig gäst – en besökare med en bricka ”GÄST” som går bredvid henne. Det är spelarens figur i huset; man ser sig själv åka hiss, stå i kö och kliva av på perrongen.

**Hur den börjar.** `act('rundvisning')` från ?-rutan (”🛎️ Be Berit visa runt”) eller från Berits block i panelen när man följer henne. Första gången spelet startas erbjuder Berit det själv när hon kommer till disken (informationsrutan ”Berit: Vill du att jag visar runt?” med Ja/Nej). Beställs den utanför hennes skift (07–19) står beställningen kvar och hon börjar när hon kommer på morgonen.

**Vikarien Kicki.** Berit lämnar aldrig disken obemannad. Hon ringer bemanningen (telefonsamtalet i grafiken, som teknikerns `S.techCall`) och **Kicki från Kontorsservice** – ny post i `CREW` – kommer genom karuselldörren eller med tåget och sätter sig i receptionen. Berit och gästen går först när Kicki sitter (regeln `cover` i crew.js). **Kicki sköter allt som hör till receptionen medan Berit är borta – även larm**: Kicki tar över receptionistens `urgent`-roll (vid brand är det hon som visar ut folk genom entrén), Berit fortsätter rundvisningen. Kicki har egna repliker (”Berit är på rundvisning, kan jag hjälpa till?”, ”Hur funkar den här telefonen?”, vid larm: ”Lugnt, lugnt – den här vägen!”). När rundvisningen är slut tackar Berit, Kicki går hem.

**Rutten.** Berit och gästen går en rutt som guiden i tour.js: entrén → driftcentralen (P1) → perrongen (TB) → expressen till Sky Café (6) → takterrassen → tillbaka till entrén. Kameran följer dem (`VIEW.follow`, regissören av under tiden). Stoppen i `introStops.js` blir **platser i stället för klockslag**: varje stopp har en text som börjar när de kommer fram och texter för vägen (”Medan vi åker expressen …”). Inga framkallade händelser; stoppen läser av huset just nu:

- tåget står inne / kommer snart / tunnelbanan är stängd för natten
- chefens senaste beslut (`S.chief.log`) och vem som sitter i driftcentralen
- en trasig hiss och var teknikern är (”Ser du L2? Där jobbar Bosse just nu”)
- dagens händelser hittills (`S.stats.events`): ”I morse brann det på 9:an, du skulle ha sett det”
- har inget hänt: hon visar framkalla-blocket och säger att man kan prova själv

**Berit anpassar rundturen efter larmen.** När en incident börjar (eller förvarnas, `S.warn`) lägger Berit om rutten och gör händelsen till rundvisningens höjdpunkt – säkert, utan att gå in där det är farligt:

| Händelse | Berit gör |
|---|---|
| Brand | Leder gästen ut med de andra till återsamlingsplatsen och förklarar utrymningen, brandhissen och brandmännen. Går aldrig in i brandzonen (`fireDivert`). Rundvisningen fortsätter när det är släckt. |
| Strömavbrott | Stannar där de är, förklarar reservkraften och hur hissarna startar om en i taget. Tar trappan om det dröjer. |
| Storm | Går till driftcentralen och tittar på när chefen väljer svajläge eller normal drift. |
| Hissfel / linbrott / instängda | Går till våningen där teknikern jobbar (eller utrymningen genom takluckan syns) och berättar. |
| Fast på fasaden | Går till takterrassen eller gatan och tittar på räddningstjänsten. |
| Flyttdag, ambulans, VIP, stadsturen | Lägger in ett stopp där det händer. |
| Kuppen | Se del 3. |

Stoppen får alltså en lista med **avbrott** som tar företräde framför rutten (`{ when: () => !!S.fire, go: () => assemblyFloor, text: … }`); när händelsen är över fortsätter hon där hon var (”Nå, var var vi?”). Hinner hon inte till platsen innan det är över blir det en replik i stället (”Synd, du missade brandkåren!”).

**Knappar i berättelseblocket** (`setTour` i panels.js): ”Gå vidare” (hon slutar prata och går till nästa stopp), ”Säg igen”, ”Avsluta” (de går tillbaka till disken). Panelblocken som lyfts fram (`focus`, `spot`) finns kvar.

**Berit pratar högt.** Repliken läses upp med **Web Speech API** (`speechSynthesis`). På en Mac använder den samma röster som `say` – svenska Alva/Klara – utan att servern gör något, och den fungerar även i Safari på mobilen. Välj en `sv-SE`-röst om det finns, annars blir det bara text. Ljudknappen styr talet som de andra ljuden; hissmusiken och husmusiken (score.js) sänks medan hon pratar. Pratbubblan och panelens textrad följer uppläsningen (`onboundary`); ”Gå vidare” avbryter (`speechSynthesis.cancel()`). (`serve.py` + macOS `say` skulle bara fungera på Mac och lokalt – Web Speech räcker.) Senare: Kicki och stamgästerna kan få var sin röst för sina repliker.

**Regler:** Berit, gästen och Kicki är personer i simuleringen, så rundvisningen går via `act()` (post i `ACTIONS` och `PLAYER_ACTIONS`), drar inga slumptal (`blankPerson`, eller en egen ström `rundvisning`) och följer med över dygnsskiftet (`crewRoll`). Talet och kameran är bara gränssnitt. Tester: rundvisningen tar slut av sig själv även om spelaren inte trycker på något, också med incidenter under tiden; `watcher()`: receptionen är aldrig tom under Berits skift (Berit eller Kicki sitter där eller sköter ett larm), Berit och gästen är aldrig i brandzonen. Bort: `INTRO_SEED`, `INTRO_OPTS`, fram-spolningen i intro.js och de framkallade händelserna i stoppen.

---

## 3. Kuppen på 5:an

Ett rånargäng tar över tornet för att tömma valvet i Guldbanken – och en enda person som rånarna missat smyger runt i huset och sätter käppar i hjulet. Lånar actionfilmsgenrens upplägg (huset är fällan, hjälten är ensam, polisen står utanför och gör fel), inte någon films figurer, repliker eller scener. Tonen är tornets: ingen skjuter, ingen dör – rånarna är klantiga yrkesmän i overall från ”Fasad & Fönster AB”, gisslan fikar i Sky Café och tycker att det är spännande.

**Kommer när som helst**, som de andra incidenterna: en post i `chooseIncident` (incidents.js) med låg vikt (~0,2, som fasaden), högst en gång per dygn, aldrig samtidigt som brand eller flytt. Förvarningen (`WARN`): ”🚐 En skåpbil från Fasad & Fönster AB har stått vid lastkajen länge…”. Vanligare på Kaos; på Av bara om den framkallas (`act('trigger', 'heist')`). En kupp som pågår kl 06 fortsätter (`heistRoll`). På kvällen är det firmafest i Sky Café och få i huset; på dagen blir många fler gisslan – samlingen måste klara ett fullt hus (köer i trappan, några stannar på sin våning).

**Förlopp:**

1. **Ankomsten.** Skåpbilen backar in vid lastkajen (`DOCK`). Fem rånare åker varuhissen upp; en stannar i kontrollrummet (P1). Driftchefen blir bunden vid stolen (`S.chief.on = false`, repliken i fönstret byts mot rånarledarens) – **spelaren förlorar Hiss-O-Matic**: alla hissar låses utom varuhissen i oberoende drift (`e.indep`, nytt läge `hijack` i `outReason`).
2. **Gisslan.** Alla i huset kallas till Sky Café (6) – som utrymningen men uppåt (`assembly` på en annan plats). De boende på 12–14 låser in sig.
3. **Hjälten.** En person som var på fel ställe – en tekniker i ett schakt, Hasse i gondolen, en boende i duschen – blir över (`p.hero`). Hen rör sig bara i **trappan, schakten och på korgtaken** (stegarna från linbrottets takluckeutrymning). Regissören följer hen.
4. **Valvet.** Två rånare borrar i valvet på 5:an (`S.heist.drill`, ljudeffekter i hallen). Valvet har tidlås; borren måste gå tills det släpper.
5. **Utanför.** Polisen spärrar gatan (blåljusen finns), en förhandlare ringer kontrollrummet (telefonsamtalet). Insatsledaren vill klippa strömmen – precis vad rånarna vill, för då släpper valvets elektromagnetiska lås.
6. **Upplösningen.** Rånarna vill fly med helikoptern från taket (`helipad`) eller med sista tåget. Hjälten kan skicka en tom korg till fel våning, stoppa varuhissen mellan två våningar (`trapBreak` – rånarna sitter fast), tända alla displayer, stänga av borren i pannrummet eller hänga fönsterputsarens gondol framför Sky Cafés fönster som signal till polisen.

**Besluten** (nyckeln `heist` i chief.js; chefen är bunden, så polisens insatsledare beslutar, med skäl som vanligt; spelaren kan ta över via `act('heist', …)`):

- *Klipp strömmen* / *vänta ut dem* (återanvänder strömavbrottet – reservkraften håller nödljuset men öppnar valvet)
- *Storma via garaget* / *storma via taket* (repfiringen från pano.js för insatsstyrkan)
- *Låt tåget gå* / *stoppa tåget i tunneln*

Gör spelaren ingenting löser huset det självt: hjälten saboterar på egen hand och polisen tar rånarna vid lastkajen när skåpbilen inte kommer därifrån.

**Berit och kuppen.** Pågår en rundvisning när kuppen börjar har rånarna missat Berit och gästen – de blir hjältarna. Berit känner huset utan och innan (”Personaltrappan, den vet ingen om”) och berättar för gästen vad hon tänker göra. Kicki i receptionen blir gisslan med de andra och pratar i telefon med Berit.

**Detaljer som gör det roligt att titta på:**

- Rånarna förstår inte destinationsstyrningen: de trycker på hallknapparna som i KNAPPAR-läget och blir irriterade när fel hiss kommer.
- Natt-DJ:n på Kanal 97 (7) sänder allt live; husmusiken byts mot ett eget actiontema i score.js.
- Gisslan i Sky Café pratar om hur det går (`say`); stamgästerna har egna repliker.
- Hjälten är andfådd efter alla trappor – repliker och långsammare gång ju fler våningar hen har gått.
- Sammanfattningen dagen efter: ”Guldtackor kvar i valvet: 412 av 412”, ”Trappsteg: 1 340”.

**Teknik:** egen modul `heist.js` med typen `Heist` i `S.heist`, egen slumpström `kuppen`, `heistReset`/`heistRoll`, poster i `TRIGGERS` och `chooseIncident`, beslutet i chief.js och `chiefLine('heist', …)` på kortet. `watcher()`: en hiss i `hijack` tar aldrig folk ur `assembly`; gisslan lämnar inte Sky Café förrän `S.heist.ph === 'done'`; ingen dör. Dockhustestet: kuppen tar slut av sig själv.
