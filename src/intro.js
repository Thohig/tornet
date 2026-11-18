// Rundvisningen i gränssnittet: Berits berättelse i ett block överst i panelen (setTour i panels.js), kameran som
// följer henne och hennes röst. Själva rundvisningen är simulering (visning.js): spelaren beställer den med
// act('visning', 'start') och den går i det dygn som pågår. Här visas och läses repliken i S.visning.line upp med
// webbläsarens talsyntes (Web Speech API, en svensk röst – på en Mac samma röster som `say`). Finns ingen svensk
// röst, eller är ljudet av, blir det bara text. Bara gränssnitt: ändrar aldrig simuleringen utom via act().
import { S } from './state.js';
import { act } from './actions.js';
import { LAST_START, STOPS, touring } from './visning.js';
import { VIEW } from './view.js';
import { toggleAuto } from './director.js';
import { extraActions, followPerson } from './input.js';
import { setTour } from './panels.js';
import { soundOn } from './sound.js';
import { esc } from './util.js';
import { getLang, tr } from './lang.js';

const U = {
  /** Berit erbjuder en rundvisning (första gången spelet startas) */
  offer: false,
  /** panelens nyckel senast (ritas bara om när den ändras) */
  key: '',
  /** rundvisningen (t0) som kameran redan har kopplats till */
  followed: -1,
  /** repliken (lineN) som senast lästes upp, och var i den rösten är (tecken) */
  spoken: -1, at: -1, speaking: false, paused: false,
};

/** Pågår rundvisningen (Berit är ute med gästen)? Då nynnar hon i husmusiken (score.js). */
export const introOn = () => touring();
/** Pratar Berit just nu? Musiken sänks under tiden (sound.js). */
export const beritTalking = () => U.speaking;
/** Berit erbjuder en rundvisning i panelen (start.js, första gången). */
export function offerVisning() { U.offer = true; paint(); }

extraActions.visning = b => {
  if (b === 'nej') { U.offer = false; }
  else if (b === 'ja' || b === 'start') { U.offer = false; act('visning', 'start'); }
  else if (b === 'again') { U.spoken = -1; }
  else if (b === 'follow') { const p = beritP(); if (p) { if (VIEW.auto) toggleAuto(); followPerson(p); } }
  else if (b === 'next' || b === 'end') { hush(); act('visning', b); }
  paint();
};

const beritP = () => (S.visning ? S.people.find(p => p.id === S.visning.berit && !p.dead) || null : null);

/** Varje bildruta (main.js) */
export function introTick() {
  const v = S.visning;
  // rundvisningen börjar: kameran följer Berit (regissören av så länge)
  if (v && v.ph === 'go' && U.followed !== v.t0) {
    U.followed = v.t0;
    const p = beritP();
    if (p) { if (VIEW.auto) toggleAuto(); followPerson(p); }
  }
  voice(v);
  paint();
}

// ---------- Panelen ----------
function paint() {
  const v = S.visning;
  if (!v && !U.offer) { if (U.key) { U.key = ''; setTour(null); } return; }
  const btn = (a, t, hint, cls = '', dis = false) => `<button class="btn xs ${cls}" data-act="visning:${a}" data-hint="${hint}"${dis ? ' disabled' : ''}>${t}</button>`;
  let head = '🛎️ Rundvisning', say = '', nav = '', dots = '', focus = [], spot = [], key = '';
  if (!v) {
    key = 'offer';
    say = 'Hej och välkommen till Tornet! Jag heter Berit och sitter i receptionen. Vill du att jag visar dig runt? Huset fortsätter som vanligt under tiden – händer det något går vi och tittar.';
    nav = `<span class="sp"></span>${btn('nej', 'Nej tack', 'Berit sitter kvar i receptionen – du kan fråga henne sedan (?)')}${btn('ja', 'Ja tack!', 'Berit ringer efter en vikarie och visar sedan runt', 'tour-go')}`;
  } else if (v.ph === 'order') {
    key = 'order';
    const h = S.clock / 3600 + 6;
    say = h >= 7 && h < LAST_START ? 'Det ordnar jag! Jag börjar så fort jag sitter i receptionen.' : 'Gärna! Men nu är det för sent – jag börjar när jag kommer till disken i morgon bitti.';
    nav = `<span class="sp"></span>${btn('end', 'Avbeställ', 'Ingen rundvisning den här gången')}`;
  } else if (v.ph === 'done') {
    if (U.key) { U.key = ''; setTour(null); }
    return;
  } else {
    const on = v.ph === 'go' || v.ph === 'at', st = STOPS[v.si];
    key = `${v.ph}|${v.si}|${v.lineN}|${v.detour ? v.detour.k : ''}|${U.speaking}`;
    if (on) head = `🛎️ Rundvisning · ${v.detour ? v.detour.title : st.title}${v.ph === 'go' ? ' <span class="dim">· på väg</span>' : ''}`;
    say = v.line || '…';
    dots = `<div class="tour-dots">${STOPS.map((s, j) => `<i class="${v.seenStops.includes(s.k) ? 'was' : j === v.si && !v.detour ? 'now' : ''}"></i>`).join('')}</div>`;
    nav = btn('follow', '📹', 'Följ Berit med kameran') + btn('again', '↻', 'Säg det igen', '', !v.line)
      + `<span class="sp"></span>${on ? btn('next', 'Gå vidare ▶', 'Berit slutar prata och går till nästa stopp', 'tour-next', v.ph !== 'at' || !!v.detour) : ''}`;
    if (v.ph === 'at') { focus = v.focus; spot = v.spot; }
  }
  if (key === U.key) return;
  U.key = key;
  const html = `<div class="blk-h"><span>${head}</span><button class="blk-x" data-act="visning:${v ? 'end' : 'nej'}" data-hint="${v ? 'Avsluta rundvisningen' : 'Nej tack'}">✕</button></div>`
    + `<div class="tour-say"><b>Berit:</b> <span id="tour-txt">${esc(say)}</span></div>${dots}<div class="row tour-nav">${nav}</div>`;
  setTour({ key, html, focus, spot });
  mark();
}
/** stryk under det Berit redan har sagt (rösten berättar var den är) */
function mark() {
  const el = document.getElementById('tour-txt'), v = S.visning;
  if (!el || !v || !v.line) return;
  const i = U.speaking && U.at >= 0 ? U.at : -1;
  const line = tr(v.line); // (rösten läser den översatta repliken, så tecknen stämmer)
  el.innerHTML = i > 0 ? `<span class="said">${esc(line.slice(0, i))}</span>${esc(line.slice(i))}` : esc(line);
}

// ---------- Rösten ----------
const SYN = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
/** @type {Record<string, SpeechSynthesisVoice|null>} */
const voices = {};
/** en röst på spelarens språk: svenska (helst Alva eller Klara, som på en Mac) eller brittisk engelska; null = ingen finns */
function swedish() {
  if (!SYN) return null;
  const l = getLang();
  if (voices[l]) return voices[l];
  const all = SYN.getVoices();
  if (!all.length) return null; // (rösterna laddas när sidan startat – försök igen nästa gång)
  const mine = all.filter(x => (l === 'sv' ? /^sv([-_]|$)/i : /^en([-_]|$)/i).test(x.lang));
  voices[l] = l === 'sv' ? mine.find(x => /alva/i.test(x.name)) || mine.find(x => /klara/i.test(x.name)) || mine.find(x => x.localService) || mine[0] || null
    : mine.find(x => /en[-_]GB/i.test(x.lang) && x.localService) || mine.find(x => /en[-_]GB/i.test(x.lang)) || mine.find(x => x.localService) || mine[0] || null;
  return voices[l];
}
function hush() {
  if (SYN && (U.speaking || SYN.speaking)) SYN.cancel();
  U.speaking = false; U.at = -1;
}
function voice(v) {
  if (!SYN) return;
  if (!v || !soundOn() || !v.line || v.ph === 'order' || v.ph === 'done') { if (U.speaking) hush(); if (v) U.spoken = v.lineN; return; }
  // pausat spel: rösten pausar också
  if (S.paused !== U.paused) { U.paused = S.paused; if (S.paused) SYN.pause(); else SYN.resume(); }
  if (v.lineN === U.spoken) return;
  U.spoken = v.lineN;
  const vo = swedish();
  hush();
  if (!vo) return;
  const u = new SpeechSynthesisUtterance(tr(v.line));
  u.voice = vo; u.lang = vo.lang; u.rate = 1.02; u.pitch = 1.08;
  u.onstart = () => { U.speaking = true; U.at = 0; };
  u.onboundary = e => { U.at = e.charIndex; mark(); };
  u.onend = () => { U.speaking = false; U.at = -1; mark(); };
  u.onerror = () => { U.speaking = false; U.at = -1; };
  SYN.speak(u);
}
