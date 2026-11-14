// Start och huvudloop.
import { S, hooks } from './state.js';
import { advance, newSim } from './sim.js';
import { VIEW, camMax, peekFloor, resize, updateCamera } from './view.js';
import { render } from './render.js';
import { showIntro, showSummary } from './hud.js';
import { updateSound } from './sound.js';
import { slowmo, updateDirector } from './director.js';
import { updatePanel } from './panels.js';

// ---------- Start ----------
// Fröet kan väljas med ?seed=123 i adressen för att spela om exakt samma dag.
const params = new URLSearchParams(location.search);
const urlSeed = parseInt(params.get('seed'), 10);
// ?tempo=kort ger det ursprungliga 6-minutersdygnet (TEMPOS i config.js)
const urlTempo = params.get('tempo');
// ?dygn=ny: dygnet börjar om från början kl 06 (som i testerna) i stället för att huset rullar vidare
newSim(Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 1e6), { ...(urlTempo ? { tempo: urlTempo } : {}), roll: params.get('dygn') === 'ny' ? 'ny' : 'mjuk' });
hooks.incident = floor => {
  if (floor !== null) peekFloor(floor);
};
hooks.dayEnd = showSummary;
resize();
VIEW.camY = camMax(); // börja nere vid entrén
showIntro();
/** @type {any} */ (window).S = S; // för felsökning i konsolen

let last = performance.now(), hudT = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  const slow = slowmo(dt);
  if (S.started && !S.paused) advance(dt, S.speed * slow);
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
