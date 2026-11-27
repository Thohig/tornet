// Kalendern: Tornet har samma datum som spelarens dator. Gränssnittet läser dagens datum (start.js) och lämnar
// det till simuleringen som en sträng ('2026-11-27' i S.date) – simuleringen läser aldrig väggklockan, så samma
// frö och samma datum ger samma dygn (?date= i adressen, repro.js). Allt annat räknas ur datumet här: veckodagen,
// månadens temperatur, soluppgången och solnedgången i Stockholm (med sommartid) och hur ljus sommarnatten är.
// Utan datum (testerna, ligan, facit) är dagen neutral: en vardag med ljus från 7 till 19, som det alltid har varit.
// Drar inga slumptal.
//
// Översikt:
// `parseDate`, `dayInfo(date)` → `Cal` (veckodag, helg, månad, `tempMean`, `sunrise`/`sunset` i lokal tid,
// `nightMax`, faktorerna för ankomsterna), `NEUTRAL`, `sunWarp` (grafikens timme efter solen), `dateParts`, `ymd`

/**
 * Dygnets kalender (S.cal)
 * @typedef {{ date: string|null, wd: number|null, weekend: boolean, month: number|null, day: number|null,
 *   tempMean: number|null, sunrise: number, sunset: number, nightMax: number,
 *   empMul: number, visMul: number, tourMul: number }} Cal
 */

/** veckodagarna (0 = måndag) och månaderna, som de skrivs i rubriker */
export const WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
export const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
/** dygnets medeltemperatur i Stockholm per månad (°C) */
const TEMP_MEAN = [-1, -1, 2, 6, 11, 16, 19, 18, 13, 8, 4, 1];
/** Stockholm */
const LAT = 59.33, LON = 18.07;
/** soluppgång och solnedgång när datumet saknas: grafikens gamla dygn (ljust från 7, mörkt efter 19) */
const SUNRISE0 = 7.0, SUNSET0 = 19.2;
/** på helgen: få anställda, färre besökare, fler turister till takterrassen */
const WEEKEND = { empMul: 0.2, visMul: 0.6, tourMul: 1.6 };

/** @type {Cal} */
export const NEUTRAL = Object.freeze({ date: null, wd: null, weekend: false, month: null, day: null, tempMean: null,
  sunrise: SUNRISE0, sunset: SUNSET0, nightMax: 1, empMul: 1, visMul: 1, tourMul: 1 });

/** '2026-11-27' → { y, m (1–12), d }, eller null om det inte är ett riktigt datum @param {string|null|undefined} s */
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
/** veckodagen, 0 = måndag (Date.UTC räknar bara ut den – ingen klocka läses) */
const weekday = (y, m, d) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
/** dagen i månaden för sista söndagen */
const lastSunday = (y, m) => { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return last - ((weekday(y, m, last) + 1) % 7); };
/** sommartid (CEST) från sista söndagen i mars till sista söndagen i oktober */
function summerTime(y, m, d) {
  if (m < 3 || m > 10) return false;
  if (m > 3 && m < 10) return true;
  const ls = lastSunday(y, m);
  return m === 3 ? d >= ls : d < ls;
}
const RAD = Math.PI / 180;
/**
 * Solen i Stockholm: soluppgång och solnedgång (lokal tid, timmar) och hur långt under horisonten den står vid midnatt.
 * Deklinationen och tidsekvationen som enkla formler – på några minuter när, vilket räcker för himlen i bilden.
 */
function sun(y, m, d) {
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const decl = -23.44 * Math.cos(2 * Math.PI * (n + 10) / 365);
  const B = 2 * Math.PI * (n - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const noon = 12 + (15 - LON) / 15 - eot / 60 + (summerTime(y, m, d) ? 1 : 0);
  const c = (Math.sin(-0.833 * RAD) - Math.sin(LAT * RAD) * Math.sin(decl * RAD)) / (Math.cos(LAT * RAD) * Math.cos(decl * RAD));
  const half = Math.acos(Math.max(-1, Math.min(1, c))) / RAD / 15;
  return { sunrise: noon - half, sunset: noon + half, below: 90 - LAT - decl };
}

/** Dygnets kalender ur datumet. Utan (giltigt) datum: den neutrala dagen. @param {string|null|undefined} date @returns {Cal} */
export function dayInfo(date) {
  const p = parseDate(date);
  if (!p) return NEUTRAL;
  const wd = weekday(p.y, p.m, p.d), weekend = wd >= 5, s = sun(p.y, p.m, p.d);
  return {
    date: /** @type {string} */ (date), wd, weekend, month: p.m, day: p.d, tempMean: TEMP_MEAN[p.m - 1],
    sunrise: s.sunrise, sunset: s.sunset,
    // ljusa sommarnätter: solen går bara några grader under horisonten och himlen blir aldrig helt mörk
    nightMax: Math.min(1, Math.max(0.3, s.below / 13)),
    ...(weekend ? WEEKEND : { empMul: 1, visMul: 1, tourMul: 1 }),
  };
}

/**
 * Grafikens timme efter solen: klockslaget h flyttas styckvis linjärt så att soluppgången hamnar där det gamla
 * dygnet ljusnade (7.0) och solnedgången där det mörknade (19.2). Himlen och nattljuset (view.js) är ritade för de
 * tiderna, så en decemberdag blir mörk redan vid 15.30 och en midsommarnatt ljus till efter 22. Neutralt: samma timme.
 * @param {number} h klockslag (vilket dygn som helst, räknas om till 0–24) @param {Cal} cal
 */
export function sunWarp(h, cal) {
  h = ((h % 24) + 24) % 24;
  const sr = cal.sunrise, ss = cal.sunset;
  if (sr === SUNRISE0 && ss === SUNSET0) return h;
  if (h < sr) return (h / sr) * SUNRISE0;
  if (h < ss) return SUNRISE0 + ((h - sr) / (ss - sr)) * (SUNSET0 - SUNRISE0);
  return SUNSET0 + ((h - ss) / (24 - ss)) * (24 - SUNSET0);
}

/** rubrikens datum: ”Fredag 27 november”, eller null utan datum @param {Cal} cal */
export const dateParts = cal => (cal.wd === null || cal.month === null ? null : { wd: WEEKDAYS[cal.wd], day: cal.day, month: MONTHS[cal.month - 1] });
/** dagens datum i datorns tid som '2026-11-27' (bara gränssnittet anropar den: simuleringen får datumet som data) @param {Date} d */
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
