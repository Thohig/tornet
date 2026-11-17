# Idéer till spelet

Idéer som vi har pratat om men inte byggt. Stryk det som blir gjort eller som du inte vill ha. De tekniska förbättringarna står i `TODO.md`.

## Musik

Hissmusiken (`music.js`) är byggd. Resten görs på samma sätt: chiptune som syntetiseras med Web Audio från notdata i koden, utan ljudfiler.

### Musik som följer dygnet
Varje del av dygnet har sitt eget stycke, och musiken byter mjukt när ☀️/🌙 eller rusningen byter läge.

| Tid | Stämning | Instrument |
|---|---|---|
| Morgonrusning | Lite stressad ragtime med snabba åttondelar | Fyrkantsvåg + virvel av brus |
| Förmiddag | Lugn kontorsvals i 3/4 | Triangelvåg + pling som från en vibrafon |
| Lunch | Jazz i Sky Café med walking bass | Triangelvåg i basen, sordinerad fyrkantsvåg |
| Kväll | Långsam lounge med mjuka ackord | Långa ackord |
| Natt | Speldosa: tre–fyra toner med lång efterklang | Sinus- eller triangelvåg |

### Korta musikaliska inslag
- **Förvarning:** tre stigande toner, som ett ”oj då?”.
- **Incidenten är över:** en kort fanfar på fyra toner, som tv-spelens ”bana klar”.
- **Brandkåren kommer:** musiken tystnar och en tuba-bas (låg fyrkantsvåg) spelar ”dum-dum-dum”.
- **Stadsturen:** guiden har en egen visselmelodi som hörs när gruppen är i bild.
- **Flyttdag:** ett tungt tuba-tema i otakt, som låter som att bära, medan pianot hissas.
- **Rundvisningen:** Berit nynnar huvudtemat långsammare och lite falskt.
- **Tunnelbanan:** tågets signal på två toner blir en del av melodin, och musiken svarar med två toner.

### Rytmen i huset blir musik
Det här är mer experimentellt. Engångsljuden (dörrar som öppnas och stängs, plingen, stegen) skjuts fram till närmaste sextondel i musikens takt, så att hela huset spelar med. Det blir särskilt roligt att titta på i rusningen. Detta är bara grafik och ljud, så simuleringen ändras inte.
