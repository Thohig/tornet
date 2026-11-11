// Start och huvudloop.
import { S, hooks } from './state.js';
import { advance, newSim } from './sim.js';
import { VIEW, camMax, drawOverview, resize, scrollToFloor, updateCamera } from './view.js';
import { render } from './render.js';
import { $, applyTab, buildHud, placeCarPop, showIntro, showSummary, updateHud, updateRoster, updateTracker } from './hud.js';
import { setSpeed } from './input.js';

// ---------- Start ----------
// Fröet kan väljas med ?seed=123 i adressen för att spela om exakt samma dag.
const urlSeed = parseInt(new URLSearchParams(location.search).get('seed'), 10);
newSim(Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 1e6));
hooks.incident = floor => {
  if (S.speed > 2) setSpeed(1);
  if (floor !== null) scrollToFloor(floor);
};
hooks.dayEnd = showSummary;
buildHud();
applyTab();
resize();
$('btnZoom').classList.toggle('on', S.zoom === 'fit');
VIEW.camY = camMax(); // börja nere vid entrén
showIntro();
/** @type {any} */ (window).S = S; // för felsökning i konsolen

let last = performance.now(), hudT = 0, rosterT = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (S.started && !S.paused) advance(dt, S.speed);
  S.anim += dt;
  updateCamera(dt);
  render(dt);
  drawOverview();
  placeCarPop();
  hudT -= dt; rosterT -= dt;
  if (hudT <= 0) { hudT = 0.15; updateHud(); updateTracker(); }
  if (rosterT <= 0) { rosterT = 0.4; updateRoster(); }
  requestAnimationFrame(frame);
}
document.fonts && document.fonts.ready.then(resize);
requestAnimationFrame(frame);
