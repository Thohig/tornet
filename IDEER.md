# Idéer till spelet

Idéer som vi har pratat om men inte byggt. Stryk det som blir gjort eller som du inte vill ha. De tekniska förbättringarna står i `TODO.md`.

Pannrummet, fönsterputsaren som fastnar, hunden som rymmer och vattenläckan är byggda (se `CHANGELOG.md`). En ny olycka byggs som de: `act('trigger', …)`, en plats i dygnets tidtabell (`chooseIncident` i incidents.js) med förvarning, ett steg i Murphys lag (`STEPS` i chaos.js), en egen slumpström, ett beslut i `chief.js` med skäl och `chiefLine(nyckel, …)` på kortet, `incidentOver()` när den är över och poäng hos regissören. Behövs vaktmästaren: `callJanitor` i crew.js.

## Fler olyckor att fundera på

- 🖥️ **Hiss-O-Matic 3000 kraschar:** styrsystemet startar om och hissarna kör i nödläge (stannar på varje våning) några minuter. Leverantören: ”Har du testat att starta om?”
- 🎈 **Firmafest:** hissarna fylls av ballonger och tårta – skrymmande last, ballonger som fastnar i dörrarna.
- 😱 **Panik i en fullsatt hiss:** någon med cellskräck trycker på alla knappar i en stoppad korg och ringer larmet (bygger på korgen mellan två våningar).
- 💥 **Rulltrappan stannar tvärt:** folk måste gå upp till mellanplanet och expressens övre däck blir trångt.
- 🚇 **Tåget stannar i tunneln:** tågtrafiken står länge, perrongen blir proppfull och folk går upp genom huset i stället.
