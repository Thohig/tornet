// Start och huvudloop.
import { S, hooks } from './state.js';
import { advance } from './sim.js';
import { VIEW, camMax, peekFloor, resize, updateCamera } from './view.js';
import { render } from './render.js';
import { saveDay } from './summary.js';
import { updateSound } from './sound.js';
import { slowmo, updateDirector } from './director.js';
import { updatePanel } from './panels.js';
import { followToday, rememberPrefs, startGame } from './start.js';
import { beritTalking, introOn, introTick } from './intro.js';
import { lap, profFrame } from './prof.js';
import { parseRepro } from './repro.js';
import { skipTick } from './input.js';
import { tr } from './lang.js';

// ---------- Start ----------
// Ingen startmeny: huset startar direkt (start.js). ?seed=123 i adressen ger ett bestämt frö – samma dygn varje gång;
// med t= eller h= spolas det fram till ett ögonblick (repro.js – testerna skriver sådana länkar när något går fel).
hooks.incident = floor => {
  if (floor !== null) peekFloor(floor);
};
hooks.dayEnd = () => { saveDay(); followToday(); }; // (spelat över midnatt: Tornet får dagens datum före dygnsskiftet)
resize();
VIEW.camY = camMax(); // börja nere vid entrén
startGame(parseRepro(location.search));
/** @type {any} */ (window).S = S; // för felsökning i konsolen

let last = performance.now(), hudT = 0;
// ---------- Fel i en bildruta ----------
// Varje steg fångar sina egna fel: ett fel i ritningen ska inte stoppa simuleringen eller panelen (och tvärtom).
// Felet syns i konsolen och i en liten ruta nere till vänster – på mobilen finns ingen konsol att titta i.
const seenErr = new Set();
let errBox = /** @type {HTMLElement|null} */ (null);
/** @param {string} where @param {unknown} err */
function showError(where, err) {
  const msg = err instanceof Error ? err.message : String(err), key = `${where}|${msg}`;
  if (seenErr.has(key)) return;
  seenErr.add(key);
  console.error(`Tornet: fel i ${where}`, err);
  if (!errBox) {
    errBox = document.createElement('div'); errBox.id = 'err';
    errBox.addEventListener('click', () => { errBox?.remove(); errBox = null; });
    document.body.appendChild(errBox);
  }
  const line = document.createElement('div');
  line.textContent = `⚠️ ${tr(`Fel i ${where}`)}: ${msg}`;
  errBox.appendChild(line);
  errBox.title = tr('Klicka för att stänga');
}
/** @param {string} where @param {() => void} fn */
function guard(where, fn) { try { fn(); } catch (err) { showError(where, err); } }

function frame(now) {
  // (nästa bildruta beställs först: inget fel får frysa spelet)
  requestAnimationFrame(frame);
  // (första bildrutans tidsstämpel kan ligga före last – en negativ dt ger negativ S.anim och rökpuffar i storlek 0)
  const dt = Math.max(0, Math.min(0.25, (now - last) / 1000)); last = now;
  profFrame(); // ?prof=1: tid per del, ritas i bilden (prof.js)
  let slow = 1;
  guard('uppspelningen', () => {
    slow = slowmo(dt);
    introTick();
    lap('rundvisning');
    skipTick(); // (⏩ natten: stannar på morgonen eller när något händer)
  });
  guard('simuleringen', () => { if (S.started && !S.paused) advance(dt, S.speed * slow); });
  S.anim += dt;
  lap('simulering');
  guard('kameran', () => { updateDirector(); updateCamera(dt); });
  lap('regissör/kamera');
  guard('bilden', () => render(dt));
  guard('ljudet', () => updateSound(introOn(), beritTalking()));
  lap('ljud');
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.15; guard('panelen', () => { updatePanel(); rememberPrefs(); }); }
  lap('panelen');
}
document.fonts && document.fonts.ready.then(() => resize());
requestAnimationFrame(frame);

// Säg till servern att spelet är öppet: serve.py --auto-stop stänger av sig själv
// när pingarna har tystnat. Finns ingen server som svarar händer ingenting.
const ping = () => fetch('/ping', { cache: 'no-store' }).catch(() => {});
ping();
setInterval(ping, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
