// sv`…`: en svensk text som vet sin mall. Simuleringen skriver svenska och vet aldrig vilket språk som visas (lang.js);
// sv`Flyttbilen väntar – ${vad} står vid lastkajen` ger exakt samma svenska sträng som utan sv, men sparar också
// mallen ("Flyttbilen väntar – {0} står vid lastkajen") och värdena. När texten visas slår tr() i lang.js upp
// strängen här och översätter mallen ur lang-en.js med värdena – utan att gissa var värdena börjar och slutar.
// En text som inte finns här (eller vars mall saknas i lang-en.js) översätts som förut, genom att matcha mallarna.
// Ingen DOM och inga beroenden: simuleringen och gränssnittet använder samma sv. (Taggen heter sv och inte t,
// eftersom t är ett vanligt namn på en tid i koden och skulle skugga den.) Påverkar aldrig simuleringen.
// npm run lang kontrollerar att varje sv`…` i koden har sin mall i lang-en.js.

/** @typedef {{ key: string, vals: string[] }} Made */
/** strängarna som sv har gjort: strängen → mallen och värdena (töms när den blir stor – då översätts som förut) */
/** @type {Map<string, Made>} */
export const MADE = new Map();
const MAX = 50000;

/**
 * Taggen: samma sträng som en vanlig mallsträng, och mallen sparas. Värdena får platserna {0}, {1} … i ordning.
 * @param {TemplateStringsArray} strings @param {...unknown} vals @returns {string}
 */
export function sv(strings, ...vals) {
  let s = strings[0];
  if (!vals.length) return s;
  let key = s;
  const vs = vals.map(String);
  for (let i = 0; i < vs.length; i++) { s += vs[i] + strings[i + 1]; key += `{${i}}${strings[i + 1]}`; }
  if (!MADE.has(s)) {
    if (MADE.size >= MAX) MADE.clear();
    MADE.set(s, { key, vals: vs });
  }
  return s;
}
