// Start och huvudloop.
import { S, hooks } from './state.js';
import { advance, newSim, startReplay } from './sim.js';
import { decodeReplay } from './replay.js';
import { VIEW, camMax, peekFloor, resize, updateCamera } from './view.js';
import { render } from './render.js';
import { applyTab, buildHud, placeCarPop, showIntro, showSummary, updateHud, updateRoster, updateTracker } from './hud.js';
import { setSpeed, syncControls } from './input.js';
import { updateSound } from './sound.js';
import { updateDirector } from './director.js';

// ---------- Start ----------
// Fröet kan väljas med ?seed=123 i adressen för att spela om exakt samma dag.
// ?replay=… spelar upp ett inspelat dygn (frö + spelarens åtgärder), se replay.js.
const params = new URLSearchParams(location.search);
const urlSeed = parseInt(params.get('seed'), 10);
// ?tempo=kort ger det ursprungliga 6-minutersdygnet (TEMPOS i config.js)
const urlTempo = params.get('tempo');
const rec = params.get('replay') ? decodeReplay(params.get('replay')) : null;
if (rec) startReplay(rec);
else newSim(Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 1e6), urlTempo ? { tempo: urlTempo } : {});
hooks.incident = floor => {
  if (S.speed > 2) setSpeed(1);
  if (floor !== null) peekFloor(floor);
};
hooks.dayEnd = showSummary;
buildHud();
applyTab();
resize();
VIEW.camY = camMax(); // börja nere vid entrén
showIntro();
/** @type {any} */ (window).S = S; // för felsökning i konsolen

let last = performance.now(), hudT = 0, rosterT = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (S.started && !S.paused) advance(dt, S.speed);
  S.anim += dt;
  updateDirector();
  updateCamera(dt);
  render(dt);
  placeCarPop();
  updateSound();
  hudT -= dt; rosterT -= dt;
  if (hudT <= 0) { hudT = 0.15; updateHud(); updateTracker(); syncControls(); }
  if (rosterT <= 0) { rosterT = 0.4; updateRoster(); }
  requestAnimationFrame(frame);
}
document.fonts && document.fonts.ready.then(resize);
requestAnimationFrame(frame);
