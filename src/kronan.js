// Kronans hissar kraschar: Hiss-O-Matic 4000 i granntornet går ner, och Kronans folk står i sin sky lobby utan
// hissar. Göran (Kronans driftchef) ropar i driftradion. Valet (driftchefen i chief.js eller spelaren,
// act('kronan', …)):
//   open – grannsämja: Kronans folk får gå över bron och ta Tornets hissar ner till gatan och tunnelbanan. Det
//          blir en rusning från fel håll – ner från sky lobbyn mitt på dagen.
//   own  – bara Tornets egna: bron stängs för inkommande, Kronans folk får gå trappan i sitt eget hus.
// Kronans support hittar felet efter en stund (len).
// (Simulering: läget ligger i S.kronan; skywalk.js läser det. Egen slumpström: `kronan`, och `kronanfolk` för
// utseendet på dem som kommer över bron.)
import { stream } from './rng.js';
const { rand, rng, pick } = stream('kronan'), KF = stream('kronanfolk');
import { S, hour, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';
import { sv } from './sv.js';
import { LOBBY, SKYWALK_F, STATION } from './config.js';
import { makePerson, pev, pn } from './people.js';
import { GORAN, KRONAN, SKYWALK_DOOR, canGoOut } from './skywalk.js';
import { fl } from './util.js';

/**
 * Kronans hissar kraschar (S.kronan): t0 = när den började, ph = 'on' → 'done', len = hur länge den håller på (s);
 * mode = '' (inget beslut), 'open' (Kronans folk tar Tornets hissar) eller 'own' (bara Tornets egna); by = vem som
 * bestämde; came = hur många som kom över bron; stayed = hur många som fick gå trappan i Kronan i stället.
 * @typedef {{ t0: number, ph: string, len: number, mode: string, by: string, came: number, stayed: number }} Kronan
 */
/** Kronans folk som vill ner (per sekund i början – det mattas av när de första har kommit ner) */
const RUSH = 0.45, FADE_S = 45;
/** vad som gick sönder i Kronan */
const WHY = ['en uppdatering som ingen bad om', 'en kaffekopp på serverskåpet', 'skottårsbuggen', 'en fladdermus i maskinrummet', 'licensen som gick ut i natt'];

/** kan den börja just nu? (bron finns och är öppen, Kronan har öppet) */
export const kronanPossible = () => SKYWALK_F >= 0 && !S.kronan && !S.fire && S.power && canGoOut() && hour() >= 7.5 && hour() < 20;

/** Slumpen eller spelaren (act('trigger', 'kronan')): Kronans hissar kraschar. false om det inte kan hända nu. */
export function startKronan() {
  if (!kronanPossible()) return false;
  S.kronan = { t0: S.t, ph: 'on', len: rand(70, 120), mode: '', by: '', came: 0, stayed: 0 };
  log(sv`🏢 ${KRONAN}s hissar har kraschat – Hiss-O-Matic 4000 svarar inte`, 'alert');
  log(sv`📻 ${GORAN} i ${KRONAN}: Hallå Tornet? Alla våra hissar står still. Kan vårt folk låna era?`, 'chief');
  incidentStarted(SKYWALK_F);
  return true;
}
/** Beslutet: 'open' (Kronans folk får ta Tornets hissar) eller 'own' (bara Tornets egna). by = 'chief' eller 'player'. */
export function setKronanMode(mode, by) {
  const X = S.kronan;
  if (!X || X.ph !== 'on' || (mode !== 'open' && mode !== 'own')) return false;
  if (X.mode === mode) return true;
  X.mode = mode; X.by = by;
  log(mode === 'open' ? sv`🌉 ${KRONAN}s folk får gå över bron och ta Tornets hissar ner` : sv`🚧 Bron stängs för ${KRONAN}s folk – Tornet tar bara sina egna`, 'alert');
  return true;
}

/** @param {number} dt */
export function kronanTick(dt) {
  const X = S.kronan;
  if (!X) return;
  // Kronans folk vill ner (dras varje steg medan det pågår – beslutet ändrar bara vem som kommer över bron)
  const r = rng();
  if (X.ph === 'on' && r < RUSH * Math.exp(-(S.t - X.t0) / FADE_S) * dt) {
    if (X.mode === 'open' && canGoOut() && !S.fire) refugee(X);
    else X.stayed++;
  }
  if (X.ph === 'on' && S.t - X.t0 >= X.len) {
    X.ph = 'done';
    const what = pick(WHY);
    log(sv`📻 ${GORAN} i ${KRONAN}: Hissarna går igen! Det var ${what}. Tack, grannar!`, 'chief');
    const how = X.mode === 'open' ? sv`${X.came} av ${KRONAN}s folk gick över bron och tog Tornets hissar ner.`
      : sv`Bron var stängd för dem – ${X.stayed} fick gå trappan i ${KRONAN}.`;
    incidentOver('kronan', sv`✅ ${KRONAN}s hissar går igen`, sv`De stod still i ${Math.round(S.t - X.t0)} s. Felet: ${what}. ${how}`, { floor: SKYWALK_F });
    S.kronan = null;
  }
}
/** en från Kronan kommer över bron och ska ner till gatan (eller tunnelbanan) genom Tornet @param {Kronan} X */
function refugee(X) {
  const p = makePerson('vis', SKYWALK_F, SKYWALK_DOOR, KF);
  const out = STATION >= 0 && KF.rng() < 0.3 ? STATION : LOBBY;
  p.kronan = true; p.refugee = true; p.exitFloor = out;
  p.state = 'bridge'; p.bridgeT = 1; p.bridgeDir = -1; p.spot = null;
  p.bridgeGoal = out; p.bridgeWhy = sv`${KRONAN}s hissar står still – tar Tornets hissar ner`;
  S.people.push(p); X.came++; S.stats.bridge++;
  pev(p, sv`Kommer över bron från ${KRONAN} · ${p.bridgeWhy} (${fl(out)})`);
  log(sv`${pn(p)} kommer över bron från ${KRONAN} – deras hissar står still`, 'person', null, p.id);
}

export function kronanReset() { S.kronan = null; }
