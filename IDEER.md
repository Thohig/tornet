# Idéer till spelet

Idéer som vi har pratat om men inte byggt. Stryk det som blir gjort eller som du inte vill ha. De tekniska förbättringarna står i `TODO.md`.

## En enklare start – huset bara går

Startmenyn har vuxit till en uppsättning lägen (scenarier, Ny dag med Egenskaper, Dagens Torn, två tempon, två sorters dygnsskifte). Dockhusprincipen säger att huset sköter sig självt: man trycker på KÖR! och tittar, och allt annat görs i kontrollpanelen medan huset går. Scenarierna bryter dessutom principen – de spolar fram, stänger av slumpen och framkallar en färdig händelse – trots att allt de visar kan hända på en vanlig dag eller framkallas från panelen.

**Bort ur spelet:**

- **Scenarierna:** `SCENARIOS`, `scenHtml`, `s:`-valen i `pickItem`, fram-spolningen (`M.spin`, `SPIN_MS`, `.mn-spin`/`.mn-bar` i `style.css`) och händelselistan (`M.plan` i `menuTick`). `start(o)` tar inget scenario längre.
- **Ny dag:** `newHtml` (Egenskaper), `opts`, `dice`/`go`/`back` i `pickItem`, `.mn-props`/`.mn-radios`/`.mn-seed` i CSS. `defaults()` blir bara de sparade valen från panelen plus ett slumpat frö.
- **Dagens Torn:** `todaySeed` och `today` i `pickItem`.
- **Det korta dygnet i gränssnittet:** `?tempo=` i main.js och tempovalet. Det långa dygnet (`lang`) är det enda spelet visar. **Kvar i `TEMPOS`** för testerna, ligan och `npm run bench`, som kör det korta för att gå fort (alternativt: döp om det till ett testtempo så att det syns att det inte är ett spelval).
- **Dygnsskiftet ”Börjar om”:** spelet rullar alltid vidare (`'mjuk'`). Bort: valet `roll` i panelens inställningar (panels.js), radion i menyn, `?dygn=ny` i main.js och grenen i hud.js som stannar spelet för sammanfattningen när dygnet tar slut. Sammanfattningen visas fortfarande som vyn `yesterday` och informationsrutan ”Dag n börjar”. **`'ny'` finns kvar i simuleringen** (`newSim`s standard, `resetDay`) – testerna och ligan kör ett dygn i taget och behöver det. Rubriken i CLAUDE.md om dygnsskiftet ändras: spelet = alltid mjukt, `'ny'` = bara tester/liga.

- **Spela om:** raden ”Senast: dag n · betyg … ↻ Spela om” (`lastLine`, `replay` i `pickItem`, `.mn-last` i CSS) och det som bara finns för den: `rememberDay` (anropas från hud.js när dygnet tar slut) och `KEY.last` i `localStorage`. Med mjuka skiften finns inget naturligt ”förra dygnet” att spela om, och ett dygn ska kännas som en del av husets liv, inte en omgång.

**Ingen startmeny:** spelet startar direkt efter uppstarten i DOS-svart (första gången). Hur funkar det finns redan som ?-knappen i panelen, och rundvisningen sker i husets vanliga gång (se nästa förslag). Bort: hela `menu.js` utom uppstarten, och menyvyn bakom (`menuDemo`).

**Kvar i panelen** (det enda stället att ställa in något): styrlogiken (blocket Styrning), slumpen (Av/Lugnt/Normalt/Kaos, gäller resten av dygnet och följer med nästa), driftchefen på/rast, framkalla (ersätter scenarierna) och inställningarna ⚙️ (felknappar, underhåll). Valen sparas i `localStorage` som i dag och används av nästa KÖR!.

**Kvar för utvecklaren:** `?seed=` (ett bestämt frö utan meny) – bra för felsökning och för att dela ett dygn.

**Att tänka på:** README (startmenyn, scenarierna, tempot), CLAUDE.md (raderna om `menu.js`, Dygnsskiftet och Dygnets tempo), `showIntro` i hud.js (nämner dygnets längd – blir alltid ~15 min) och testerna för menyn om några finns. Rundvisningen (`intro.js`) har egna stopp och påverkas inte.

## Rundvisningen i husets vanliga gång

I dag är rundvisningen ett eget dygn med fast frö (`INTRO_SEED`) som spolas fram till klockslag, framkallar ett hissfel och en VIP och sedan slängs. Förslag: **Berit visar runt på riktigt, i det dygn som pågår**, och huset fortsätter som vanligt omkring henne. Det blir dockhusprincipen fullt ut – det man ser på rundvisningen är det som faktiskt händer just nu.

**Hur den börjar.** Spelaren beställer den med `act('rundvisning')` från två ställen: en knapp i ?-rutan (”🛎️ Be Berit visa runt”) och Berits block i panelen när man följer henne. Första gången spelet startas erbjuder Berit det själv när hon kommer till disken (informationsrutan ”Berit: Vill du att jag visar runt?” med Ja/Nej). Utanför hennes skift (07–19) står beställningen kvar och hon börjar när hon kommer på morgonen (rutan säger det).

**Vikarien.** Berit lämnar inte disken obemannad: hon ringer bemanningen (samma telefonsamtal i grafiken som teknikerns `S.techCall`) och en vikarie kommer – ny post i `CREW`, t.ex. **Kicki från Kontorsservice**, med egna repliker (`'Berit är på rundvisning, kan jag hjälpa till?'`, `'Hur funkar den här telefonen?'`). Kicki kommer genom karuselldörren (eller med tåget), sätter sig i receptionen och Berit går först när Kicki sitter – samma regel som `cover` i crew.js. När rundvisningen är slut tackar Berit, Kicki går hem. Ett larm under rundvisningen (`alarm()`) gör att Berit avbryter och går till sin post som vanligt.

**Berit går rutten.** Hon är en person med en rutt, som guiden i tour.js: entrén → driftcentralen (P1) → perrongen (TB) → expressen till Sky Café (6) → takterrassen → tillbaka till entrén. Kameran följer henne (`VIEW.follow`, regissören av under tiden). Stoppen i `introStops.js` blir **platser i stället för klockslag**: varje stopp har en text som börjar när hon kommer fram, och texter för vägen (”Medan vi åker expressen …”). Inga framkallade händelser – i stället läser stoppen av huset just nu:

- står tåget inne / kommer tåget snart / är tunnelbanan stängd för natten
- vilket beslut chefen fattade senast (`S.chief.log`) och vem som sitter där (Gun-Britt eller Rune)
- om en hiss är trasig och var teknikern är (”Ser du L2? Där jobbar Bosse just nu”)
- dagens händelser hittills (`S.stats.events`): ”I morse brann det på 9:an, du skulle ha sett det”
- har inget hänt: hon visar framkalla-blocket och säger att man kan prova själv

Knapparna i berättelseblocket (`setTour`) blir ”Gå vidare” (hon slutar prata och går till nästa stopp), ”Säg igen” och ”Avsluta” (hon går tillbaka till disken). Panelblocken som lyfts fram (`focus`, `spot`) finns kvar.

**Berit pratar högt.** Repliken läses upp med **Web Speech API** (`speechSynthesis` i webbläsaren). På en Mac använder den samma röster som `say` – svenska Alva/Klara – utan att servern behöver göra något, och den fungerar likadant i Safari på mobilen. Välj en `sv-SE`-röst om det finns, annars är rundvisningen bara text. Ljudknappen styr den som de andra ljuden; hissmusiken och husmusiken (score.js) sänks medan hon pratar. Pratbubblan över Berit och textraden i panelen följer uppläsningen (`onboundary`), och ”Gå vidare” avbryter talet (`speechSynthesis.cancel()`). Alternativet att låta `serve.py` köra macOS `say` och skicka ljudet fungerar bara på Mac och bara lokalt – Web Speech räcker. (Senare: stamgästerna kan få var sin röst för sina repliker.)

**Regler:** rundvisningen är simulering (Berit och Kicki är personer) och går därför via `act()`, finns i `PLAYER_ACTIONS`, drar inga slumptal (`blankPerson`, eller en egen ström `rundvisning`) och följer med över dygnsskiftet (`crewRoll`). Talet och kameran är bara gränssnitt. Test: rundvisningen tar slut av sig själv inom en viss tid även om spelaren inte trycker på något; `watcher()`: receptionen är aldrig tom under Berits skift (Berit eller Kicki sitter där, utom vid larm). Bort: `INTRO_SEED`, `INTRO_OPTS`, fram-spolningen i intro.js och de framkallade händelserna i stoppen.

## Kuppen på 5:an (actionincident)

**Kommer när som helst**, som de andra incidenterna: en post i `chooseIncident` (incidents.js) med låg vikt (~0,2, som fasaden), bara på dagtid när banken har öppet eller på kvällen efter stängning – aldrig samtidigt som brand eller pågående flytt, och högst en gång per dygn. Förvarningen (`WARN`) är en skåpbil som står för länge vid lastkajen: ”🚐 En skåpbil från Fasad & Fönster AB har stått vid lastkajen länge…”. Med slumpen på Kaos blir den vanligare; med Av kommer den bara om den framkallas (`act('trigger', 'heist')`). Mjukt dygnsskifte: en kupp som pågår kl 06 fortsätter (`heistRoll`). Brasklapp: om rånarna kommer på dagen är det fler i huset som blir gisslan – samlingen i Sky Café måste klara ett fullt hus (köer i trappan, några stannar på sin våning).

En kväll tar ett rånargäng över tornet för att tömma valvet i Guldbanken – och en enda person som rånarna missat smyger runt i huset och sätter käppar i hjulet. Lånar genrens upplägg (huset är fällan, hjälten är ensam och barfota, polisen står utanför och gör fel), inte någon films figurer eller repliker. Tonen är tornets: ingen skjuter, ingen dör – rånarna är klantiga yrkesmän i overall från ”Fasad & Fönster AB”, gisslan sitter och fikar i Sky Café och tycker att det är spännande.

**Förlopp** (här på kvällen, med firmafest i Sky Café):

1. **Ankomsten.** En skåpbil backar in vid lastkajen (`DOCK`). Fem rånare åker varuhissen upp; en stannar i kontrollrummet (P1). Driftchefen blir bunden vid stolen (`S.chief.on = false`, repliken i fönstret byts mot rånarledarens) – **spelaren förlorar Hiss-O-Matic**: rånarna låser alla hissar utom varuhissen i oberoende drift (`e.indep`, nytt läge `hijack` i `outReason`).
2. **Gisslan.** Alla i huset kallas till Sky Café (6) – samma rörelse som utrymningen men uppåt (`assembly` på en annan plats). De boende på 12–14 låser in sig.
3. **Hjälten.** En person som var på fel ställe – hisstekniker i ett schakt, Hasse i gondolen, en boende i duschen – blir över (`p.hero`). Hen rör sig bara i **trappan, schakten och på korgtaken** (stegar i schaktet finns redan för linbrottets takluckeutrymning). Kameran/regissören följer hen som huvudperson.
4. **Valvet.** Två rånare borrar i valvet på 5:an (borrens framsteg i `S.heist.drill`, ljudeffekter i hallen). Valvet har tidlås – borren måste köras tills tidlåset släpper.
5. **Utanför.** Polisen spärrar gatan (blåljus finns), en förhandlare ringer kontrollrummet (telefonsamtalet från `S.techCall`). Polischefen vill ”klippa strömmen” – vilket är precis vad rånarna vill, för då släpper valvets elektromagnetiska lås.
6. **Upplösningen.** Rånarna planerar att fly med helikoptern från taket (`helipad`) eller tunnelbanan (sista tåget). Hjälten kan: skicka tom korg till fel våning, stoppa varuhissen mellan två våningar (`trapBreak` – rånarna sitter fast!), tända alla displayer, stänga av borren genom pannrummet, låta fönsterputsarens gondol hänga framför Sky Cafés fönster som signal till polisen, eller falla genom ett schakt och landa på en korg.

**Val och driftchefen** (nyckeln `heist` i chief.js; chefen är bunden, så besluten fattas av polisens insatsledare, med skäl som vanligt):

- *Klipp strömmen* / *vänta ut dem* (strömavbrottet återanvänder `power` – reservkraften håller nödljuset men öppnar valvet)
- *Storma via garaget* / *storma via taket* (räddningstjänstens repfiring från pano.js återanvänds för insatsstyrkan)
- *Låt tåget gå* / *stoppa tåget i tunneln*

Spelaren kan, som alltid, ta över ett beslut via `act('heist', …)`. Gör spelaren ingenting löser huset det självt: hjälten saboterar på egen hand och polisen tar rånarna vid lastkajen när skåpbilen inte kommer härifrån.

**Detaljer som gör det roligt att titta på:**

- Hjälten har inga skor – varje trappsteg ger ett ”aj”, och glassplitter i hallen på 6:an när hen springer förbi.
- Rånarna förstår inte destinationsstyrningen: de trycker på hallknapparna som i KNAPPAR-läget och blir irriterade när fel hiss kommer.
- Natt-DJ:n på Kanal 97 (7) sänder allt live; husmusiken byts mot ett eget actiontema i `score.js`.
- Firmafestens gäster i Sky Café byter repliker (`say`) om hur det går – stamgästerna har egna.
- Sammanfattningen dagen efter: ”Guldtackor kvar i valvet: 412 av 412”, ”Trappsteg barfota: 1 340”.

**Teknik:** egen modul `heist.js` med typen `Heist` i `S.heist`, egen slumpström `kuppen` (ankomsten får inte påverka andra strömmar), `heistReset`/`heistRoll`, en post i `TRIGGERS` och i `chooseIncident`. Regler i `watcher()`: en hiss i `hijack` tar aldrig folk ur `assembly`; gisslan lämnar aldrig Sky Café förrän `S.heist.ph === 'done'`; ingen dör. Dockhustestet: kuppen ska ta slut av sig själv.
