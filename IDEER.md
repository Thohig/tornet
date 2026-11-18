# Idéer till spelet

Idéer som vi har pratat om men inte byggt. Stryk det som blir gjort eller som du inte vill ha. De tekniska förbättringarna står i `TODO.md`.

## Kuppen på 5:an (actionfilmsscenario)

En kväll tar ett rånargäng över tornet för att tömma valvet i Guldbanken – och en enda person som rånarna missat smyger runt i huset och sätter käppar i hjulet. Lånar genrens upplägg (huset är fällan, hjälten är ensam och barfota, polisen står utanför och gör fel), inte någon films figurer eller repliker. Tonen är tornets: ingen skjuter, ingen dör – rånarna är klantiga yrkesmän i overall från ”Fasad & Fönster AB”, gisslan sitter och fikar i Sky Café och tycker att det är spännande.

**Förlopp** (scenario i `SCENARIOS`, kl ~20, helst en fredag med firmafest i Sky Café):

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

**Teknik:** egen modul `heist.js` med typen `Heist` i `S.heist`, egen slumpström `kuppen` (ankomsten får inte påverka andra strömmar), `heistReset`/`heistRoll`, en post i `TRIGGERS` och `INC_LEVELS` bara i kaosnivån (eller enbart som scenario och framkallning). Regler i `watcher()`: en hiss i `hijack` tar aldrig folk ur `assembly`; gisslan lämnar aldrig Sky Café förrän `S.heist.ph === 'done'`; ingen dör. Dockhustestet: kuppen ska ta slut av sig själv.
