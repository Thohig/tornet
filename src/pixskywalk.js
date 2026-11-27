// Pixelgrafik: skywalken till granntornet Kronan (skywalk.js). Bron är ett inglasat rör med fackverk under,
// från tornets fasad i sky lobbyns höjd, förbi panoramahissens glasrör, till Kronans fasad i bildens högerkant.
// Kronan är ett nyare glastorn i kallare blått än Tornet och syns bara som en remsa: fönsterband, namnet högst
// upp och fönsterputsaren Jörgen i sin gondol när Hasse är ute. På bron går folket (läget 'bridge') efter hur
// långt de har kommit (p.bridgeT); den höjdrädda står still och skakar (hojd.js). Avspärrningsband när bron är
// stängd, en väktare vid dörren när den är öppen i stormen och arbetare med lampor på underhållsnätter.
// Ren grafik: läser simuleringen, ändrar ingenting.
import { S } from './state.js';
import { bridgeX, BRIDGE_X0, FLOOR_H, floorY, GROUND_Y, KRONAN_W, KRONAN_X, ROOF_Y, SKYWALK_F, surf } from './config.js';
import { blend } from './pixart.js';
import { PERSON_H, PERSON_W, personSprite } from './pixpeople.js';
import { nightness } from './view.js';
import { windAt } from './weather.js';
import { cleanerAt } from './hoist.js';
import { box, g, INK, line, lo, R, reserve, X, Y } from './pixcore.js';
import { text, textW } from './pixart.js';
import { bubble, talking } from './pixfolk.js';
import { closedWhy } from './skywalk.js';

/** Kronans färger: kallt blått glas och ljusgrå stomme (Kontor 95 i en nyare tappning) */
const K = { glass: '#5f86a8', glassN: '#1c2a3d', frame: '#c4ccd6', shade: '#8f9aa8', lit: '#ffe9a8', sign: '#1f3f66' };
/** brons höjd (låga pixlar, golv till tak) */
const BH = 34;

/** brons golv i ritytan (låga pixlar) */
const deckY = () => Y(surf(SKYWALK_F)) + 1;
export function drawSkywalkPx(h) {
  if (SKYWALK_F < 0 || !S.skywalk) return;
  const x0 = X(BRIDGE_X0), x1 = X(KRONAN_X), yb = deckY(), yt = yb - BH;
  if (x0 > lo.width || yb + 30 < 0 || Y(ROOF_Y - 300) > lo.height) return;
  const n = nightness(h);
  drawKronan(n);
  if (yt > lo.height + 10 || yb + 20 < 0) return;
  // svaj i stormen: bron gungar lite på mitten
  const wind = S.storm ? windAt() : 0, sway = t => Math.round(Math.sin(Math.PI * t) * Math.sin(S.anim * 2.1) * wind * 3);
  // fackverket under och glaset
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / Math.max(1, x1 - x0), dy = sway(t);
    R(x, yt + dy, 1, BH, n < 0.5 ? 'rgba(191,234,255,.28)' : 'rgba(60,80,120,.45)'); // (glaset)
    R(x, yt + dy - 2, 1, 2, INK); R(x, yt + dy - 1, 1, 1, K.frame); // taket
    R(x, yb + dy, 1, 3, INK); R(x, yb + dy + 1, 1, 1, '#9aa3ad'); // golvet
    R(x, yb + dy + 9, 1, 1, INK); // underramen
    const k = (x - x0) % 12;
    if (k === 0) { R(x, yt + dy, 1, BH, K.shade); line(x, yb + dy + 3, x + 6, yb + dy + 9, INK); }
    if (k === 6) line(x, yb + dy + 9, x + 6, yb + dy + 3, INK);
  }
  // lampor i taket på kvällen
  if (n > 0.3 && S.power) for (let x = x0 + 8; x < x1 - 4; x += 24) { const dy = sway((x - x0) / (x1 - x0)); R(x, yt + dy, 3, 1, '#fff3b0'); R(x - 2, yb + dy - 1, 7, 1, 'rgba(255,240,190,.35)'); }
  // folket på bron
  const X_ = p => X(bridgeX(p.bridgeT ?? 0));
  const list = S.people.filter(p => !p.dead && p.state === 'bridge').sort((a, b) => a.depth - b.depth);
  for (const p of list) {
    const px = X_(p), t = p.bridgeT ?? 0, dy = sway(t) + Math.round(p.depth * 0.3);
    if (p.frozen) {
      const shake = Math.floor(S.anim * 12) % 2;
      g.drawImage(personSprite(p, 'front', 0, 1), px - PERSON_W / 2 + shake, yb + dy - PERSON_H);
    } else {
      const frame = Math.floor(p.walkPhase) % 4;
      g.drawImage(personSprite(p, 'side', frame, p.bridgeDir || 1), px - PERSON_W / 2, yb + dy - PERSON_H);
    }
  }
  // stängd: avspärrningsband vid båda dörrarna (inte när det bara är natt – då är dörrarna låsta)
  const why = closedWhy();
  if (why && why !== 'ingen bro') for (const x of [x0 + 3, x1 - 10]) tape(x, yb);
  // stormen, öppen med vakt: en väktare i gul väst innanför dörren
  if (S.storm && S.skywalk.storm === 'open') guard(x0 + 12, yb);
  // underhållsnatt: två arbetare med pannlampor och en arbetslampa mitt på bron
  if (S.skywalk.maint && h >= 20 && h < 29.5) {
    const mx = Math.round((x0 + x1) / 2);
    R(mx - 30, yt + 4, 60, BH - 4, 'rgba(255,230,140,.18)');
    worker(mx - 14, yb, 0); worker(mx + 10, yb, 1);
    box(mx - 2, yb - 9, 5, 6, '#ffd23f'); R(mx - 1, yb - 8, 3, 2, '#ffffff');
  }
}
/** de som pratar på bron (den höjdrädda, vaktmästaren som leder hen): ritas efter korgarna och folket i hallarna,
 *  så att repliken bokar sin plats efter skyltarna (pixel.js) */
export function drawSkywalkTalkPx() {
  if (SKYWALK_F < 0 || !S.skywalk) return;
  const yt = deckY() - BH;
  if (yt > lo.height + 10 || yt + BH + 20 < 0) return;
  // (valfria: får repliken ingen plats – panoramahissens skyltar står bredvid bron – hoppas den över; den står i loggen)
  for (const p of S.people) if (!p.dead && p.state === 'bridge' && talking(p)) bubble(`${p.name}: "${p.say.text}"`, X(bridgeX(p.bridgeT ?? 0)), yt - 12, '#ffffff', true);
}
/** Kronan: en remsa av granntornet i bildens högerkant */
function drawKronan(n) {
  const kx = X(KRONAN_X), kw = Math.ceil(KRONAN_W / 2) + 4, top = Y(ROOF_Y - 260), bot = Y(GROUND_Y);
  if (kx > lo.width) return;
  // stommen och glaset
  R(kx - 1, top, kw + 2, bot - top, INK);
  R(kx, top + 1, kw, bot - top - 1, blend(K.glass, K.glassN, n));
  // våningsband (samma höjd som Tornets, så att bron möter ett golv) och fönsterposter
  const fh = FLOOR_H / 2, y0 = Y(floorY(SKYWALK_F)) % fh;
  for (let y = top + ((y0 - top) % fh + fh) % fh; y < bot; y += fh) {
    R(kx, y - 3, kw, 3, K.frame); R(kx, y - 1, kw, 1, K.shade);
    for (let x = kx + 6, k = 0; x < kx + kw - 4; x += 12, k++) {
      R(x, y - fh + 4, 1, fh - 8, K.shade);
      // tända fönster på kvällen (efter ett mönster, inte slumpen)
      if (n > 0.25 && S.power && ((Math.round(y / fh) * 5 + k * 3) % 7) < 2) R(x + 1, y - fh + 5, 10, fh - 10, K.lit);
    }
  }
  // dörren där bron möter Kronan
  const yb = deckY();
  R(kx, yb - BH, 4, BH, INK); R(kx + 1, yb - BH + 1, 3, BH - 2, blend('#2a3a50', '#0d1420', n));
  // namnet högst upp
  const sy = top + 8, name = 'KRONAN', tw = textW(name);
  box(kx + 4, sy, tw + 6, 9, K.sign); text(g, name, kx + 7, sy + 2, '#ffffff');
  reserve(kx + 4, sy, tw + 6, 9);
  // en krona i guld ovanför namnet
  for (const [dx, hgt] of [[0, 4], [3, 6], [6, 4]]) R(kx + 6 + dx, sy - 2 - hgt, 2, hgt, '#d4a017');
  R(kx + 6, sy - 3, 8, 2, '#d4a017');
  // Jörgen putsar Kronans fönster när Hasse putsar Tornets
  const G0 = cleanerAt();
  if (G0 && G0.crew) {
    const gy = Math.min(Y(G0.y + 90), yb - BH - 20), gx = kx - 24, wind = S.storm ? windAt() : 0;
    const sw = Math.round(Math.sin(S.anim * 2.4 + 1) * wind * 5);
    line(gx + 4 - sw, top, gx + 4, gy - 12, '#3a3f4a'); line(gx + 18 - sw, top, gx + 18, gy - 12, '#3a3f4a');
    R(gx + sw, gy - 4, 22, 4, INK); R(gx + 1 + sw, gy - 3, 20, 2, '#d4a017');
    jorgen(gx + 10 + sw, gy - 4);
  }
}
/** Kronans fönsterputsare: overall i Kronans blå, vänd mot glaset */
function jorgen(cx, by) {
  R(cx - 2, by - 14, 5, 5, '#f0c8a0'); R(cx - 2, by - 15, 5, 2, '#5a3a20'); // huvud och hår
  R(cx - 3, by - 9, 7, 7, K.sign); R(cx - 3, by - 2, 2, 2, INK); R(cx + 2, by - 2, 2, 2, INK);
  const arm = Math.round(Math.sin(S.anim * 5) * 2);
  R(cx + 4, by - 9 + arm, 4, 1, K.sign); R(cx + 8, by - 11 + arm, 1, 4, '#36c5d6'); // skrapan
}
/** rött och vitt avspärrningsband mellan två stolpar */
function tape(x, yb) {
  R(x, yb - 9, 1, 9, INK); R(x + 7, yb - 9, 1, 9, INK);
  for (let k = 0; k < 6; k++) R(x + 1 + k, yb - 7, 1, 2, k % 2 ? '#ffffff' : '#c81e3a');
}
/** väktaren i gul väst (bara grafik) */
function guard(cx, yb) {
  R(cx - 2, yb - 16, 5, 5, '#d8a47f'); R(cx - 2, yb - 17, 5, 2, '#1d2433');
  R(cx - 3, yb - 11, 7, 6, '#ffd23f'); R(cx - 3, yb - 8, 7, 1, '#c0c0c0');
  R(cx - 2, yb - 5, 2, 5, '#1d2433'); R(cx + 1, yb - 5, 2, 5, '#1d2433');
}
/** arbetare på underhållsnatten: orange overall och pannlampa */
function worker(cx, yb, k) {
  R(cx - 2, yb - 16, 5, 5, '#e0b090'); R(cx - 2, yb - 17, 5, 2, '#ffd23f'); R(cx + 2, yb - 16, 1, 1, '#ffffff');
  R(cx - 3, yb - 11, 7, 6, '#ff8c42'); R(cx - 2, yb - 5, 2, 5, '#ff8c42'); R(cx + 1, yb - 5, 2, 5, '#ff8c42');
  const arm = Math.round(Math.sin(S.anim * 4 + k * 2) * 2);
  R(cx + 4, yb - 10 + arm, 3, 1, '#ff8c42');
}
