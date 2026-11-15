// Start och huvudloop.
import { S, hooks } from './state.js';
import { advance, newSim } from './sim.js';
import { VIEW, camMax, peekFloor, resize, updateCamera } from './view.js';
import { render } from './render.js';
import { showIntro, showSummary } from './hud.js';
import { updateSound } from './sound.js';
import { slowmo, updateDirector } from './director.js';
import { updatePanel } from './panels.js';
import { menuDemo, menuTick, showMenu } from './menu.js';

// ---------- Start ----------
// Startmenyn (menu.js) väljer frö, tempo, slumpen … Adressen går före: ?seed=123 spelar om exakt samma dag
// och hoppar då över menyn, liksom ?tempo= och ?dygn=.
const params = new URLSearchParams(location.search);
const direct = ['seed', 'tempo', 'dygn'].some(k => params.has(k));
const urlSeed = parseInt(params.get('seed'), 10);
// ?tempo=kort ger det ursprungliga 6-minutersdygnet (TEMPOS i config.js)
const urlTempo = params.get('tempo');
// ?dygn=ny: dygnet börjar om från början kl 06 (som i testerna) i stället för att huset rullar vidare
if (direct) newSim(Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 1e6), { ...(urlTempo ? { tempo: urlTempo } : {}), roll: params.get('dygn') === 'ny' ? 'ny' : 'mjuk' });
hooks.incident = floor => {
  if (floor !== null) peekFloor(floor);
};
hooks.dayEnd = showSummary;
resize();
VIEW.camY = camMax(); // börja nere vid entrén
if (direct) showIntro('start'); else showMenu();
/** @type {any} */ (window).S = S; // för felsökning i konsolen

let last = performance.now(), hudT = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  const slow = slowmo(dt);
  menuTick();
  if ((S.started || menuDemo()) && !S.paused) advance(dt, S.speed * slow);
  S.anim += dt;
  updateDirector();
  updateCamera(dt);
  render(dt);
  updateSound();
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.15; updatePanel(); }
  requestAnimationFrame(frame);
}
document.fonts && document.fonts.ready.then(resize);
requestAnimationFrame(frame);
