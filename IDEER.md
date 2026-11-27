# Idéer till spelet

Idéer som vi har pratat om men inte byggt. Stryk det som blir gjort eller som du inte vill ha. De tekniska förbättringarna står i `TODO.md`.

Pannrummet, fönsterputsaren som fastnar, hunden som rymmer, vattenläckan, Hiss-O-Matic som kraschar, tåget i tunneln, panik i hissen, firmafesten, rulltrappan som stannar och pumparna i berget är byggda (se `CHANGELOG.md`). En ny olycka byggs som de: `act('trigger', …)`, en plats i dygnets tidtabell (`chooseIncident` i incidents.js) med förvarning, ett steg i Murphys lag (`STEPS` i chaos.js), en egen slumpström, ett beslut i `chief.js` med skäl och `chiefLine(nyckel, …)` på kortet, `incidentOver()` när den är över och poäng hos regissören. Behövs vaktmästaren: `callJanitor` i crew.js.

## Högtider i kalendern

Tornet följer spelarens datum (calendar.js), och provlarmet Hesa Fredrik går första måndagen i kvartalet (shelter.js), men ingen dag är ännu en högtid. Idéer, i kalenderns ordning: fettisdagen (semlor i Sky Café), påsk (påskkärringar som trycker på alla knappar), valborg och midsommar (stång på takterrassen, halvtomt hus), halloween, advent (ljusstakar i fasadfönstren, julgran i entrén, julbord på festvåningen), lucia (luciatåget våning för våning, ljuskronan som löser ut brandvarnaren), julafton och mellandagarna (nästan tomt hus), nyårsafton (fest på takterrassen, fyrverkerier vid midnatt), löningsdagen den 25:e (kö till banken) och sommartidens byte (displayerna visar fel tid). Semestern i juli med sommarvikarier, och snö på taket på vintern (fönsterputsaren stannar inne).

## Fler olyckor att fundera på

Inga just nu.

## Kronan som en egen byggnad

Kronan simuleras inte: bron och kulverten är dörrar dit folk går. Förslaget är att göra Kronan till ett eget hus i en **egen vy** som man växlar till och från (Tornets bild har inte plats för mer). Båda husen simuleras hela tiden och bara den aktiva vyn ritas.
- **Växeln:** knapparna *Tornet* och *Kronan* högst upp i panelen med köer och incidenter som indikatorer, ett kortkommando och en knapp i mobilens list. Klick på bron byter vy. Kameran följer med den man följer över bron, regissören kan klippa till Kronan när något stort händer där, och incidentkorten säger i vilket hus det händer.
- **Kronans vy:** spegelvänd, med bron åt vänster mot en remsa av Tornet, egna hallar i kallare blått, Kronans Krog, Görans driftcentral och Jörgen på fasaden.
- **Hissarna:** tre korgar med Hiss-O-Matic 4000 och en annan styrlogik än Tornets, så att man ser skillnaden. Kraschen i `kronan.js` får verklig effekt: köerna står i Kronans hallar.
- **Göran som riktig driftchef** med egna beslut och skäl som spelaren kan ta över. Cheferna samarbetar i driftradion (lånar ut en tekniker, tar emot varandras folk vid brand). Incidenter kan gå åt båda hållen, och sammanfattningen får en kolumn per hus.
- **Det tekniska:** husets data (`BUILDING`, `LOBBY`, `idx()` …) förutsätter ett enda hus. Ett sätt att börja är att lägga Kronans våningar efter Tornets i samma index med egna etiketter, och att folk aldrig åker hiss mellan husen.

## Tornet på höjden

Det mesta under jord är byggt. Uppåt finns en hög zon kvar: 5–8 våningar till över bostäderna med en **andra sky lobby** där man byter hiss, en ny expresshiss dit och en lokal grupp högst upp.
- **Våningarna:** ett hotell (receptionen i sky lobby 2, väskor hela dygnet, utcheckning på morgonen), en roterande restaurang, ett penthouse med egen privat hiss, ett tekniskt plan med hissmaskinerna och en vindkraftsdämpare som svajar i stormen, och antennmasten där blixten slår ner.
- Takterrassen, helikopterplattan och fönsterputsarens skena flyttar upp till det nya taket. Översiktsbilden blir högre (kameran scrollar redan i höjdled).

## Mer i djupet

- **Lunch på Kronans Krog genom kulverten** när bron är stängd, och Kronans folk genom kulverten när deras hissar har kraschat.
- **Vattenläckan rinner hela vägen ner** till pumprummet, och pumparna får mer att göra (en länk till i Murphys lag).
- **Skyddsrummet som tillflykt i stormen** för dem som väntar på perrongerna när tågen står still.
- **Skyddsrumsövningen:** ett eget hissläge under övningen, och trappan som val (alla går ner i trappan och hissarna hålls fria).

