// Start och huvudloop.
import { S, hooks } from './state.js';
import { advance } from './sim.js';
import { VIEW, camMax, peekFloor, resize, updateCamera } from './view.js';
import { render } from './render.js';
import { saveDay } from './summary.js';
import { updateSound } from './sound.js';
import { slowmo, updateDirector } from './director.js';
import { updatePanel } from './panels.js';
import { rememberPrefs, startGame } from './start.js';
import { beritTalking, introOn, introTick } from './intro.js';
import { lap, profFrame } from './prof.js';
import { parseRepro } from './repro.js';

// ---------- Start ----------
// Ingen startmeny: huset startar direkt (start.js). ?seed=123 i adressen ger ett bestämt frö – samma dygn varje gång;
// med t= eller h= spolas det fram till ett ögonblick (repro.js – testerna skriver sådana länkar när något går fel).
hooks.incident = floor => {
  if (floor !== null) peekFloor(floor);
};
hooks.dayEnd = saveDay;
resize();
VIEW.camY = camMax(); // börja nere vid entrén
startGame(parseRepro(location.search));
/** @type {any} */ (window).S = S; // för felsökning i konsolen

let last = performance.now(), hudT = 0;
function frame(now) {
  // (första bildrutans tidsstämpel kan ligga före last – en negativ dt ger negativ S.anim och rökpuffar i storlek 0)
  const dt = Math.max(0, Math.min(0.25, (now - last) / 1000)); last = now;
  profFrame(); // ?prof=1: tid per del, ritas i bilden (prof.js)
  const slow = slowmo(dt);
  introTick();
  lap('rundvisning');
  if (S.started && !S.paused) advance(dt, S.speed * slow);
  S.anim += dt;
  lap('simulering');
  updateDirector();
  updateCamera(dt);
  lap('regissör/kamera');
  render(dt);
  updateSound(introOn(), beritTalking());
  lap('ljud');
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.15; updatePanel(); rememberPrefs(); }
  lap('panelen');
  requestAnimationFrame(frame);
}
document.fonts && document.fonts.ready.then(resize);
requestAnimationFrame(frame);

// Säg till servern att spelet är öppet: serve.py --auto-stop stänger av sig själv
// när pingarna har tystnat. Finns ingen server som svarar händer ingenting.
const ping = () => fetch('/ping', { cache: 'no-store' }).catch(() => {});
ping();
setInterval(ping, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
