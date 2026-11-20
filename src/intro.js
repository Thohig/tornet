// Rundvisningen i gränssnittet: guidens (Berit eller kvällsvärden Yvonne) berättelse i ett block överst i panelen (setTour i panels.js), kameran som
// följer henne och hennes röst. Själva rundvisningen är simulering (visning.js): spelaren beställer den med
// act('visning', 'start') och den går i det dygn som pågår. Här visas och läses repliken i S.visning.line upp med
// webbläsarens talsyntes (Web Speech API, en svensk röst – på en Mac samma röster som `say`). Finns ingen svensk
// röst, eller är ljudet av, blir det bara text. Bara gränssnitt: ändrar aldrig simuleringen utom via act().
import { S } from './state.js';
import { act } from './actions.js';
import { STOPS, guideName, nextGuide, touring } from './visning.js';
import { CREW } from './config.js';
import { crewPerson, atPost } from './crew.js';
import { VIEW } from './view.js';
import { extraActions, followPerson, unfollow } from './input.js';
import { setTour } from './panels.js';
import { soundOn } from './sound.js';
import { esc } from './util.js';
import { getLang, tr } from './lang.js';

const U = {
  /** guiden som kameran följer för rundvisningens skull (id, −1 = ingen) */
  cam: -1,
  /** Berit erbjuder en rundvisning (första gången spelet startas) */
  offer: false,
  /** panelens nyckel senast (ritas bara om när den ändras) */
  key: '',
  /** rundvisningen (t0) som kameran redan har kopplats till */
  followed: -1,
  /** repliken (lineN) som senast lästes upp, och var i den rösten är (tecken) */
  spoken: -1, at: -1, speaking: false, paused: false,
};

/** Pågår rundvisningen (guiden är ute med gästen)? Då nynnar hon i husmusiken (score.js). */
export const introOn = () => touring();
/** Pratar guiden just nu? Musiken sänks under tiden (sound.js). */
export const beritTalking = () => U.speaking;
/** Berit erbjuder en rundvisning i panelen (start.js, första gången). */
export function offerVisning() { U.offer = true; paint(); }

extraActions.visning = b => {
  if (b === 'nej') { U.offer = false; }
  else if (b === 'ja' || b === 'start') { U.offer = false; act('visning', 'start'); }
  else if (b === 'again') { U.spoken = -1; }
  else if (b === 'follow') { const p = beritP(); if (p) { followPerson(p); U.cam = p.id; } }
  else if (b === 'next' || b === 'end') { hush(); act('visning', b); }
  paint();
};

const beritP = () => (S.visning ? S.people.find(p => p.id === S.visning.host && !p.dead) || null : null);

/** Varje bildruta (main.js) */
export function introTick() {
  const v = S.visning;
  // rundvisningen börjar: kameran följer guiden (regissören av så länge)
  if (v && v.ph === 'go' && U.followed !== v.t0) {
    U.followed = v.t0;
    const p = beritP();
    if (p) { followPerson(p); U.cam = p.id; }
  }
  // rundvisningen är slut: följer kameran fortfarande guiden tar regissören tillbaka den (om spelaren vill ha den)
  if (U.cam >= 0 && (!v || v.ph === 'done')) {
    if (VIEW.autoWant && VIEW.camSel && S.sel && S.sel.id === U.cam) unfollow();
    U.cam = -1;
  }
  voice(v);
  paint();
}

/** guiden som sitter i receptionen just nu (Berit eller kvällsvärden), eller null */
const deskGuide = () => CREW.filter(c => c.guide).map(c => crewPerson(c.id)).find(p => p && atPost(p)) || null;

// ---------- Panelen ----------
function paint() {
  const v = S.visning;
  if (!v && !U.offer) { if (U.key) { U.key = ''; setTour(null); } return; }
  const btn = (a, t, hint, cls = '', dis = false) => `<button class="btn xs ${cls}" data-act="visning:${a}" data-hint="${hint}"${dis ? ' disabled' : ''}>${t}</button>`;
  let who = guideName(), head = '🛎️ Rundvisning', say = '', nav = '', dots = '', focus = [], spot = [], key = '';
  if (!v) {
    // (mobilen: en kort bubbla i stället för hela hälsningen)
    const mob = document.body.classList.contains('mob');
    key = mob ? 'offer-mob' : 'offer';
    say = mob ? 'Ska jag visa dig runt i huset?'
      : `Hej och välkommen till Tornet! Jag heter ${who} och sitter i receptionen. Vill du att jag visar dig runt? Huset fortsätter som vanligt under tiden – händer det något går vi och tittar.`;
    nav = `<span class="sp"></span>${btn('nej', 'Nej tack', `${who} sitter kvar i receptionen – du kan fråga henne sedan (?)`)}${btn('ja', 'Ja tack!', `${who} ringer efter en vikarie och visar sedan runt`, 'tour-go')}`;
  } else if (v.ph === 'order') {
    key = 'order';
    // den som sitter i receptionen svarar: guiden själv, eller den som går hem snart och lämnar över
    const next = nextGuide(S.clock / 3600 + 6), desk = deskGuide();
    if (!desk || desk.crewId === next.id) { who = next.name; say = 'Det ordnar jag! Jag börjar så fort jag sitter i receptionen.'; }
    else { who = desk.name; say = `Gärna! Men mitt pass slutar snart – ${next.name} visar dig runt när hon har börjat.`; }
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
    nav = btn('follow', '📹', `Följ ${who} med kameran`) + btn('again', '↻', 'Säg det igen', '', !v.line)
      + `<span class="sp"></span>${on ? btn('next', 'Gå vidare ▶', `${who} slutar prata och går till nästa stopp`, 'tour-next', v.ph !== 'at' || !!v.detour) : ''}`;
    if (v.ph === 'at') { focus = v.focus; spot = v.spot; }
  }
  if (key === U.key) return;
  U.key = key;
  const html = `<div class="blk-h"><span>${head}</span><button class="blk-x" data-act="visning:${v ? 'end' : 'nej'}" data-hint="${v ? 'Avsluta rundvisningen' : 'Nej tack'}">✕</button></div>`
    + `<div class="tour-say"><b>${esc(who)}:</b> <span id="tour-txt">${esc(say)}</span></div>${dots}<div class="row tour-nav">${nav}</div>`;
  setTour({ key, html, focus, spot });
  mark();
}
/** stryk under det guiden redan har sagt (rösten berättar var den är) */
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
// Guiderna (Berit och Yvonne) är kvinnor: kvinnliga röster i önskeordning (Mac, Windows/Edge, Chrome, Android), och mansröster
// (och Macens lekröster) som aldrig får bli guidens om det finns något annat.
const FEMALE = {
  sv: ['alva', 'klara', 'sofie', 'hillevi', 'female', 'kvinna'],
  en: ['serena', 'kate', 'stephanie', 'martha', 'libby', 'sonia', 'maisie', 'hazel', 'susan', 'flo', 'shelley', 'sandy',
    'female', 'samantha', 'karen', 'moira', 'tessa', 'allison', 'ava', 'zira', 'aria', 'jenny', 'tara'],
};
const NOT_BERIT = /\b(male|man|daniel|oliver|arthur|george|thomas|ryan|eddy|reed|rocko|grandpa|grandma|alex|fred|ralph|albert|aaron|rishi|aman|david|mark|guy|bengt|mattias|oskar|bells|boing|bubbles|cellos|wobble|jester|junior|organ|superstar|trinoids|whisper|zarvox|bahh|bad news|good news)\b/i;
/** Guidens röst på spelarens språk: en kvinnlig röst på svenska eller (helst brittisk) engelska; null = ingen finns */
function beritVoice() {
  if (!SYN) return null;
  const l = getLang();
  if (voices[l]) return voices[l];
  const all = SYN.getVoices();
  if (!all.length) return null; // (rösterna laddas när sidan startat – försök igen nästa gång)
  const mine = all.filter(x => (l === 'sv' ? /^sv([-_]|$)/i : /^en([-_]|$)/i).test(x.lang));
  const gb = (/** @type {SpeechSynthesisVoice} */ x) => /en[-_]GB/i.test(x.lang);
  const named = (/** @type {SpeechSynthesisVoice[]} */ list) => {
    for (const n of FEMALE[l === 'sv' ? 'sv' : 'en']) {
      const re = new RegExp(`\\b${n}\\b`, 'i');
      const hit = list.find(x => re.test(x.name) && x.localService) || list.find(x => re.test(x.name));
      if (hit) return hit;
    }
    return null;
  };
  const ok = mine.filter(x => !NOT_BERIT.test(x.name));
  voices[l] = (l === 'sv' ? named(mine) : named(mine.filter(gb)) || named(mine))
    || ok.find(x => x.localService) || ok[0] || mine[0] || null;
  return voices[l];
}
/** ingen känd kvinnlig röst fanns: lyft tonläget lite mer så att det låter mer som guiden */
const unsure = (/** @type {SpeechSynthesisVoice} */ vo) => !FEMALE[getLang() === 'sv' ? 'sv' : 'en'].some(n => new RegExp(`\\b${n}\\b`, 'i').test(vo.name));
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
  const vo = beritVoice();
  hush();
  if (!vo) return;
  const u = new SpeechSynthesisUtterance(tr(v.line));
  u.voice = vo; u.lang = vo.lang; u.rate = 1.02; u.pitch = unsure(vo) ? 1.3 : 1.08;
  u.onstart = () => { U.speaking = true; U.at = 0; };
  u.onboundary = e => { U.at = e.charIndex; mark(); };
  u.onend = () => { U.speaking = false; U.at = -1; mark(); };
  u.onerror = () => { U.speaking = false; U.at = -1; };
  SYN.speak(u);
}
