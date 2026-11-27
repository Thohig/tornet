// Pixelgrafik (16-bit): hela bilden i den förenklade vyn, ritad på ett rutnät i låg upplösning
// som sedan skalas upp utan utjämning. Samma världskoordinater som den tecknade grafiken – bara
// avrundade till rutor om PX världsenheter – så klick, kamera och spårning fungerar som vanligt.
// Bara grafik: läser simuleringens tillstånd men ändrar det aldrig (utom S.fx-listan, som den
// tecknade grafiken också räknar ner).
//
// Här sätts bilden ihop (renderPixel). Delarna ritas i:
//   pixcore.js     ritytan, lagren (layer), platsbokningen (reserve/place) och ritverktygen
//   pixbuilding.js himlen, gatan, fasaden, schakten, rampen, terrassen och lastkajen
//   pixhall.js     hallarna på varje våning, kontrollrummet, personalrummet och perrongen
//   pixcars.js     hisskorgarna, linorna och panoramahissen på fasaden
//   pixfolk.js     folket i hallarna, pratbubblor, telefonsamtalet, spårning och ljudeffekter
//   pixroof.js     taket, gondolen och hissbalken, flyttlassen, rök, väder och blåljus
//
// Översikt:
// `pixel.js` – hela bilden i pixelgrafik: `renderPixel` sätter ihop den; delarna ritas i `pixcore.js` – ritytan,
// lagren, platsbokningen och ritverktygen –, `pixbuilding.js` – himlen, gatan, fasaden, schakten, rampen, terrassen,
// lastkajen –, `pixhall.js` – hallarna, kontrollrummet, personalrummet, perrongen –, `pixcars.js` – korgarna,
// linorna, panoramahissen –, `pixfolk.js` – folket i hallarna, bubblor, telefonsamtalet, spårning, ljudeffekter –
// och `pixroof.js` – taket, gondolen och hissbalken, flyttlassen, rök, väder, blåljus
import { hour, S } from './state.js';
import { FLOORS, LOBBY, MEZZ, floorY } from './config.js';
import { ctx, VIEW } from './view.js';
import { PX } from './pixart.js';
import { beginFrame, CY, lo } from './pixcore.js';
import { drawCallPx, drawFxPx, drawGagsPx, drawHallPeople, drawHoverPx, drawSelectionPx, resetCallAt } from './pixfolk.js';
import { countOcc, deckSign, drawBridgeTalkPx, drawChiefPx, drawEscalatorPx, drawHall, drawLeakPx, floorOverlays, resetChiefAt } from './pixhall.js';
import { drawGroundPx, drawLanternsPx, drawShell, drawSkyAll, drawSlabsPx, drawStreetPx, drawTerracePx, terminal } from './pixbuilding.js';
import { drawCarPx, drawPanoPx, drawRopesPx, reserveCarSigns } from './pixcars.js';
import { drawProf, lap } from './prof.js';
import {
  drawBannersPx, drawBrigadePx, reserveLobbySigns, drawPolicePx, drawCleanerPx, drawHeliPx, drawHoistPx, drawLightningPx, drawMedicPx,
  drawMovePilesPx, drawOutagePx, drawRoofPx, drawSmokePx, drawSnowPx, drawWeatherPx,
} from './pixroof.js';

// ---------- Hela bilden ----------
export function renderPixel(dt) {
  const { s, w, h } = beginFrame();
  resetCallAt(); resetChiefAt();
  const hr = hour();
  countOcc();
  lap('grafik: förbered');
  drawSkyAll(hr);
  drawGroundPx();
  drawShell(hr);
  lap('himmel/fasad');
  for (let f = 0; f < FLOORS; f++) {
    if (floorY(f) < VIEW.camY - 10 || floorY(f + 1) > VIEW.camY + VIEW.viewH + 10) continue;
    drawHall(f, hr); terminal(f); floorOverlays(f, hr);
  }
  lap('hallar');
  drawSlabsPx();
  drawEscalatorPx();
  // (skyltarna om övre däcket efter rulltrappan: de som går i den skymmer dem inte)
  for (const f of [LOBBY, MEZZ]) if (f >= 0 && floorY(f) >= VIEW.camY - 10 && floorY(f + 1) <= VIEW.camY + VIEW.viewH + 10) deckSign(f);
  drawTerracePx(hr);
  for (const e of S.elevators) drawRopesPx(e);
  drawLanternsPx();
  reserveCarSigns();
  for (const e of S.elevators) drawCarPx(e);
  drawLeakPx();
  lap('schakt/korgar');
  drawMovePilesPx();
  drawStreetPx(dt, hr);
  lap('gatan');
  reserveLobbySigns();
  drawHallPeople();
  drawBridgeTalkPx();
  lap('folk');
  drawPanoPx();
  drawHeliPx();
  drawSnowPx(dt);
  drawWeatherPx();
  drawMedicPx();
  drawBrigadePx();
  drawPolicePx();
  drawSmokePx();
  drawOutagePx();
  drawLightningPx();
  drawRoofPx();
  drawCleanerPx();
  drawHoistPx();
  lap('tak/väder/incidenter');
  drawCallPx();
  drawChiefPx();
  drawSelectionPx();
  drawHoverPx();
  drawGagsPx(dt);
  drawFxPx(dt);
  drawBannersPx();
  lap('text/bubblor');
  // skala upp till skärmen utan utjämning
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const k = PX * s;
  ctx.drawImage(lo, 0, Math.round((CY * PX - VIEW.camY) * s), Math.round(w * k), Math.round(h * k));
  lap('skala upp');
  drawProf(ctx);
  lap('profilen');
}
