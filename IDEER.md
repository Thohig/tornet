# Idéer till spelet

Idéer som vi har pratat om men inte byggt. Stryk det som blir gjort eller som du inte vill ha. De tekniska förbättringarna står i `TODO.md`.

Gemensamt för de nya olyckorna: var och en framkallas med `act('trigger', …)`, kan komma av sig själv i dygnets tidtabell (`planIncidents`/`chooseIncident` i incidents.js) med en förvarning, och kan läggas in i kedjan i Murphys lag (`STEPS` i chaos.js). Var och en får en egen slumpström, ett beslut i `chief.js` med skäl och `chiefLine(nyckel, …)` på kortet, en sammanfattning via `incidentOver()` när den är över, och poäng hos regissören (director.js). Föreslagen ordning: 1. pannrummet (litet förarbete), 2. fönsterputsaren, 3. hunden, 4. vattenläckan.

## 0. Pannrummet syns (förarbete till vattenläckan)

I dag finns pannrummet bara som en plats i datan: dörren `PANNRUM` på P1 (`dock` i `THEME_INFO`, config.js), reserverad för vaktmästaren. Platsen ligger inne i rummen, som inte ritas, och glimten längst in i korridoren på P1 visar lastkajens trälådor. Vaktmästaren (kommer 20:30, `makeSchedule` i sim.js) har bara kontoren och Sky Café i sin runda (`spawnStaff`/`roleNext` i people.js) och går aldrig dit.

- Rita pannrummet: en egen dörr märkt PANNRUM i hallen på P1, eller en glimt av pannan (rör, manometer, ratt) längst in i korridoren.
- Vaktmästaren tittar till pannan på sin kvällsrunda (P1 först eller sist i `p.route`), med en replik (”Pannan ska ses över i morgon” finns redan).

## 1. 🪟 Fönsterputsaren fastnar

Bygger på gondolen i `hoist.js` (`S.cleaner`, Hasse putsar tornets fasad ovanför takterrassen kl 08–16) och räddarna i `pano.js` (repet från taket). Stegbilen når bara `LADDER_MAX` våningar och kommer inte åt honom.

- **Vad som händer:** gondolens vinsch kärvar mitt mellan två våningar. Förvarning: ”🔩 Det gnisslar i gondolens vinsch…”, gondolen rycker till innan den stannar. Bara när Hasse är ute och putsar.
- **Det man ser:** gondolen gungar i vinden (mer i storm). Hasse vinkar och ropar (”HALLÅ! Kan nån ringa nån?”, ”Jag har i alla fall utsikt…”). Boende tittar ut och räcker ut en kopp kaffe; turister på takterrassen fotograferar.
- **Räddningen (driftchefens beslut, spelaren kan ta över):**
  1. 🔧 **Nödvev från taket:** hissteknikern vevar upp gondolen för hand (som `fireCrank` i service.js). Säkert men långsamt, fungerar i blåst.
  2. 🪟 **In genom lastluckan:** på 12–14 (`HATCH_FLOORS`) vevas gondolen till luckan, en boende öppnar och Hasse kliver in. Snabbt, men kräver att någon är hemma och att det inte blåser för mycket.
  3. 🚒 **Räddningstjänsten:** firar sig ner från taket med rep och tar Hasse till takterrassen. Samma rep som för panoramahissen; stannar i hård vind (`ropeWindy`).
  Chefen väljer lastluckan om det går, annars nödvev, och ringer räddningstjänsten om det dröjer.
- **Följder:** hissbalken är spärrad så länge gondolen sitter fast (de delar skena) – på flyttdagen väntar pianot och kassaskåpet. Hasse går av passet när han är räddad (”Jag tar inte gondolen mer i dag, Gun-Britt”) och dricker kaffe i personalrummet. Gondolen är ur drift tills teknikern har lagat vinschen.
- **Slut:** Hasse står på fast mark. Sammanfattningen: hur länge han hängde, hur han kom ner, vem som hjälpte till, om flytten blev försenad.
- **Tekniskt:** `act('trigger', 'gondola')`, läget i `S.cleaner` (`stuck`, `how`, `rescueBy`), slumpströmmen `gondolen`. Den minsta av de tre: gondolen, räddarna och repet finns redan.

## 2. 🐕 Hunden som rymmer

Bygger på hundsalongen Vovve Spa (våning 10) och hundägarna med pudel i koppel (`spawnDogOwner` i people.js, pudeln ritas i pixpeople.js).

- **Vad som händer:** en pudel sliter sig ur kopplet – i hissköen, i hallen på 10 eller i entrén – och blir en egen figur som springer runt i huset.
- **Hundens beteende:** springer fortare än folk och byter riktning hela tiden. Smiter in i hissar som står öppna och åker med vart som helst (utan att byta hiss). Stannar ibland: nosar på någon, äter en munk i Sky Café, gömmer sig bakom receptionsdisken. Skäller (VOFF!) som ljudeffekt.
- **Jakten:** ägaren ropar (”FIFI! FIFI, KOM HIT!”). Efter en stund hjälper frisören från hundsalongen, Berit i receptionen och väktaren på kvällen till. Folk i hallen reagerar: vissa vill klappa, andra backar, barn springer efter. Stamgästerna har egna repliker (den allergiske nyser hela vägen upp).
- **Driftchefens beslut:** spärra hissarna där hunden är (den stängs in på en våning och är lättare att fånga, men folk får vänta) eller låt den åka (jakten tar längre tid).
- **Slut:** någon fångar hunden när den står still en stund (äter, nosar, i ett hörn). Ägaren och hunden går ut ihop, ägaren skäms. Sammanfattningen: hur många våningar och hissresor hunden hann med, och vem som fångade den.
- **Regissören:** hunden får hög poäng – en jakt mellan våningar är lätt att följa.
- **Tekniskt:** `act('trigger', 'dog')`, slumpströmmen `hunden`. Hunden får inte räknas som passagerare i lastreglerna på fel sätt (vikt, `e.ratedKg`) och får aldrig få en hiss att åka förbi någons mål.

## 3. 🚿 Vattenläckan

Kräver pannrummet (punkt 0).

- **Vad som händer:** ett vattenrör spricker på en våning (köket i en bostad, labbet på 11, Sky Café). Förvarning: ”Det droppar från taket på 9:an…”. Vattnet rinner nedåt, en våning i taget med ungefär en halv minuts mellanrum, och in i hisschakten som passerar.
- **Det man ser:** vatten längs schaktväggarna och pölar i hallarna (blå glans i pixelgrafiken), en gul skylt VÅTT GOLV, folk som halkar eller hoppar runt pölarna (snubbelsystemet vid nivåfel kan återanvändas). Den som har nycklarna springer ner till pannrummet och stänger huvudkranen: vaktmästaren på kvällen, på dagen hissteknikern, driftchefen eller en inringd jourvaktmästare (som i rundvisningen, `keyNext` i visning.js). Hissteknikern kommer och kontrollerar schakten.
- **Driftchefens beslut:**
  - **Stäng av hissarna i de våta schakten direkt:** säkert, men köerna växer och fler tar trappan.
  - **Kör vidare tills vattnet når maskinrummet:** bättre flöde, men hinner vattnet fram blir det kortslutning och ett riktigt hissfel – ibland stannar korgen mellan två våningar med folk i.
  Chefen väljer efter hur långt vattnet har kommit och hur mycket folk som åker.
- **Slut:** kranen är stängd och vattnet slutar sprida sig. Teknikern går igenom schakten ett i taget innan hissarna tas i drift igen. Sammanfattningen: hur många våningar som blev blöta, hur många hissar som stod still, om någon kortslöts.
- **Bonus:** läcker det i labbet på 11 följer den ”misstänkt gröna vätskan” med, så vattnet blir grönt.
- **Tekniskt:** `act('trigger', 'leak', våning)`, läget i `S.leak` (våningarna som är blöta, kranen, schakten som är kontrollerade), slumpströmmen `vattenläcka`. Den största av de tre: ny grafik för vattnet i hallar och schakt.

## Fler olyckor att fundera på

- 🧯 **Sprinklern löser ut av misstag:** någon bränner popcorn på 7:an. Våningen blir blöt men brandkåren behöver inte komma – en lättsam variant av branden.
- 💨 **Gaslukt i ventilationen:** en våning utryms medan någon från gasbolaget letar. Utrymning utan återkallning av hissarna.
- 🖥️ **Hiss-O-Matic 3000 kraschar:** styrsystemet startar om och hissarna kör i nödläge (stannar på varje våning) några minuter. Leverantören: ”Har du testat att starta om?”
- 🐦 **En duva i hallen:** kommer in genom takterrassen och flyger runt så att folk flyr åt alla håll.
- 🎈 **Firmafest:** hissarna fylls av ballonger och tårta – skrymmande last, ballonger som fastnar i dörrarna.
- 😱 **Panik i en fullsatt hiss:** någon med cellskräck trycker på alla knappar i en stoppad korg och ringer larmet (bygger på korgen mellan två våningar).
- 🚨 **Falsklarm:** en skolklass trycker på brandlarmsknappen – huset utryms i onödan, sura miner i hissen efteråt.
- 🧊 **Is från taket:** en kall dag lossnar istappar; gatan och hållplatsen spärras, bussen och leveransbilen stannar längre bort.
- 🌫️ **Rök från grannhuset:** det brinner i kvarteret bredvid, ventilationen stängs, folk tittar från takterrassen.
- 💥 **Rulltrappan stannar tvärt:** folk måste gå upp till mellanplanet och expressens övre däck blir trångt.
- 🚇 **Tåget stannar i tunneln:** tågtrafiken står länge, perrongen blir proppfull och folk går upp genom huset i stället.
