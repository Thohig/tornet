// Höjdskräck på bron: någon som går över glasbron till Kronan tittar ner – 90 meter rakt ner till gatan – och
// vågar inte ta ett steg till. Hen står still mitt på bron (p.frozen) medan de andra går förbi. Vaktmästaren
// går ut från sky lobbyn, pratar lugnt och leder hen över, ett steg i taget, åt det håll hen skulle. Inget val:
// det enda som hjälper är någon som tar en i armen. När det blåser på bron (stormen) händer det oftare.
// (Simulering: läget ligger i S.hojd; skywalk.js flyttar folket på bron. Egen slumpström.)
import { stream } from './rng.js';
const H = stream('hojd');
const { pick } = H;
import { S, incidentOver, log } from './state.js';
import { incidentStarted } from './incidents.js';
import { sv } from './sv.js';
import { SKYWALK_F } from './config.js';
import { pev, pn } from './people.js';
import { callJanitor, dutyDone, onDuty } from './crew.js';
import { speak } from './cast.js';
import { KRONAN, SKYWALK_DOOR, canGoOut, onBridge, spawnNeighbor } from './skywalk.js';

/**
 * Höjdskräck på bron (S.hojd): t0 = när hen stannade, ph = 'frusen' (står still, vaktmästaren är på väg) → 'ut'
 * (vaktmästaren går ut på bron) → 'leder' (de går tillsammans) → 'klar'; pid = den höjdrädda, who = namnet;
 * jan = vaktmästarens id.
 * @typedef {{ t0: number, ph: 'frusen'|'ut'|'leder'|'klar', pid: number, who: string, jan: number }} Hojd
 */
/** vad den höjdrädda säger */
const SAYS = ['Det är glas. Under mig. Hela vägen ner.', 'Jag tittade ner. Varför tittade jag ner?', 'Jag står här. Jag står bra här.', 'Svajar den?! Den svajar!'];

/** de på bron som kan få höjdskräck (inte personalen, rånarna eller den som leder någon) */
const candidates = () => onBridge().filter(p => !p.role && !p.robber && !p.bridgeHelp && !p.frozen && p.bridgeT > 0.25 && p.bridgeT < 0.75);
/** kan den börja just nu? (bron är öppen; finns ingen ute på bron kommer det en granne – Framkalla) */
export const hojdPossible = () => SKYWALK_F >= 0 && !S.hojd && !S.fire && canGoOut();
/** hur troligt i dygnets tidtabell: bara när någon är på bron, mer i blåst */
export const hojdWeight = () => hojdPossible() && candidates().length > 0 && (S.storm ? 0.9 : 0.25);

/** Slumpen eller spelaren (act('trigger', 'hojd')): någon stannar mitt på bron. false om det inte kan hända nu. */
export function startHojd() {
  if (!hojdPossible()) return false;
  let c = candidates();
  if (!c.length) {
    // ingen på bron: en granne är på väg över och stannar halvvägs
    const p = spawnNeighbor();
    if (!p) return false;
    p.bridgeT = 0.5; c = [p];
  }
  const p = pick(c);
  p.frozen = true; p.mood = 2;
  S.hojd = { t0: S.t, ph: 'frusen', pid: p.id, who: p.name, jan: -1 };
  S.hojd.jan = callJanitor('hojd', SKYWALK_F, 'Går ut på bron – någon har fastnat av höjdskräck', 'Står vid dörren till bron', SKYWALK_DOOR).id;
  pev(p, 'Tittar ner genom glasgolvet – vågar inte gå vidare');
  speak(p, pick(SAYS));
  log(sv`😨 ${pn(p)} har stannat mitt på bron till ${KRONAN} – höjdskräck`, 'alert', null, p.id);
  incidentStarted(SKYWALK_F);
  return true;
}

/** @param {number} _dt */
export function hojdTick(_dt) {
  const X = S.hojd;
  if (!X) return;
  const p = S.people.find(q => q.id === X.pid && !q.dead);
  // den höjdrädda är borta (över bron, eller huset utryms): klart
  if (!p || p.state !== 'bridge') { if (X.ph !== 'klar') finish(X, p); return; }
  let jan = S.people.find(q => q.id === X.jan && !q.dead) || null;
  if (X.ph === 'frusen') {
    // vaktmästaren ringas in igen om hen försvann
    if (!jan || ((!jan.duty || jan.duty.kind !== 'hojd') && jan.state !== 'bridge')) {
      jan = callJanitor('hojd', SKYWALK_F, 'Går ut på bron – någon har fastnat av höjdskräck', 'Står vid dörren till bron', SKYWALK_DOOR);
      X.jan = jan.id;
    }
    if (onDuty(jan, 'hojd')) {
      X.ph = 'ut';
      jan.state = 'bridge'; jan.bridgeT = 0; jan.bridgeDir = 1; jan.bridgeHelp = true; jan.spot = null;
      speak(jan, 'Ta det lugnt. Titta på mig, inte ner.');
      log(sv`🔧 ${pn(jan)} går ut på bron och pratar lugnt med ${p.name}`, 'person', null, jan.id);
    }
  }
}
/** den höjdrädda är över bron: vaktmästaren går tillbaka, och det är över @param {Hojd} X @param {import('./people.js').Person|undefined} p */
function finish(X, p) {
  X.ph = 'klar';
  const jan = S.people.find(q => q.id === X.jan && !q.dead);
  if (jan) { if (jan.state !== 'bridge') dutyDone(jan); else jan.bridgeDir = -1; }
  if (p) p.frozen = false;
  const sec = Math.round(S.t - X.t0);
  log(sv`🌉 ${X.who} tog sig över bron med vaktmästaren i armen`, 'sys');
  S.hojd = null;
  incidentOver('hojd', '✅ Över bron', sv`${X.who} stod still på glasbron i ${sec} s innan vaktmästaren ledde hen över, ett steg i taget.`, { floor: SKYWALK_F });
  if (jan && jan.state !== 'bridge') dutyDone(jan);
}
export function hojdReset() { S.hojd = null; }
