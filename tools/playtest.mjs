// Provspelning i webbläsaren: npm run playtest [-- --del=kaos,ögon --seeds=21,5 --lang=en --keep --godta]
//
// Testsviten kör simuleringen i Node, men panelen, incidentkorten och pixelgrafiken behöver en webbläsare. Det här
// skriptet startar serve.py på en egen port och öppnar spelet i Chromium (Playwright). Två delar:
//
//   kaos – trycker på Murphys lag och spolar fram ett dygn i taget medan kameran följer personer och hissar.
//          Letar efter fel i sidan (pageerror, console.error – även felrutan #err från main.js), svenska som
//          blivit kvar i det engelska gränssnittet (panelen, textskylten, verktygstipsen) och text i bilden som
//          ritas över annan text (TEXTLOG i pixart.js).
//   ögon – skärmdumpar av fasta ögonblick (?seed=…&h=…&follow=…, repro.js) på datorn, mobilen och mobilen på
//          tvären, med samma kontroller av felen och texten. Varje bild jämförs pixel för pixel med facit i
//          tools/playtest-out/ögon/bas/; skillnaderna ritas i …/diff/ och samlas i …/ögon/index.html, så att
//          en ändring i grafiken syns utan att man spelar själv. Första gången (eller med --godta) blir bilderna
//          facit. En skillnad är ingen felkod – den kan vara avsiktlig – men den står i utskriften.
//
// Avslutas med kod 1 vid fel i sidan, svenska kvar eller text över text. Skärmdumpar från kaos med --keep.
// Playwright är inget beroende i package.json (CI behöver det inte): npm i --no-save playwright && npx playwright install chromium
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const SEEDS = arg('seeds', '21,5,77').split(',').map(Number);
const LANG = arg('lang', 'en');
const PARTS = arg('del', 'kaos,ögon').split(',');
const KEEP = process.argv.includes('--keep');
const ACCEPT = process.argv.includes('--godta');
const PORT = 8100 + Math.floor(Math.random() * 80);
const OUT = new URL('./playtest-out/', import.meta.url).pathname;
const EYES = `${OUT}ögon/`;
// Snöflingor och regndroppar hamnar olika mellan körningar (en handfull pixlar långt isär). Bilden delas därför i
// rutor om 8×8 pixlar, och bara rutor där minst 12 pixlar har ändrats räknas – det gör en ändrad bokstav, men inte
// en snöflinga. Ingen sådan ruta = oförändrad.
const BLOCK = 8, BLOCK_MIN = 12;

let chromium;
// (import för en lokal installation, require för en global – NODE_PATH gäller bara require)
try { ({ chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'))); } catch {
  console.error('Playwright saknas: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

// namnen (personer, företag, husets personal) räknas inte som svenska
const NAMEISH = /\p{Lu}[\p{L}-]*/gu;
const PLACES = /Guldbanken|Glada Tanden|Rymdkakan|Kvarnström|Modemkungen|Vovve|Svettis|Fasad & Fönster|Lyft & Bär|Klart Glas|Tornplan|Hiss-O-Matic|Sky Café|Pixel & Planka|Kanal 97|Quasar|Spelet på svenska|Svenska/g;
const SWEDISH = /[åäö]|\b(och|är|på|nu|med|till|inte|för|som|har|kommer|går|om|ja|nej|av|ett|det|den|vid|hos|ingen|alla|sig|hon|han|hen|var|blir|ska|stopp|våning|hiss)\b/;
const swedish = line => SWEDISH.test(line.replace(PLACES, '').replace(NAMEISH, ''));

// Skärmarna: datorn, en mobil på höjden och samma mobil på tvären (pekskärm → body.mob, view.js). Mobilen visar bara
// bilden och en list, så två ögonblick räcker där: rusningen (höjden och tvären) och en incident (höjden).
const VIEWS = {
  dator: { viewport: { width: 1366, height: 860 } },
  mobil: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  tvären: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
};
// Ögonblicken: fasta klockslag i två dygn (rusningen, lunchen, natten) och de två första incidenterna i ett
// kaosdygn (inc=kaos). Klockslaget för incidenterna läses ur dygnets tidtabell (S.incPlan) – samma frö ger samma.
const MOMENTS = [
  { name: 'frö21-rusning', q: 'seed=21&h=8.3&follow=X1', views: ['dator', 'mobil', 'tvären'] },
  { name: 'frö21-lunch', q: 'seed=21&h=12.4&follow=6', views: ['dator'] },
  { name: 'frö21-kväll', q: 'seed=21&h=17.6&follow=E', views: ['dator'] },
  { name: 'frö21-taket', q: 'seed=21&h=19.5&follow=T', views: ['dator'] },
  { name: 'frö5-natt', q: 'seed=5&h=23.2', views: ['dator'] },
  { name: 'frö5-perrong', q: 'seed=5&h=7.9&follow=TB', views: ['dator'] },
  { name: 'frö7-incident1', seed: 7, inc: 0, views: ['dator', 'mobil'] },
  { name: 'frö7-incident2', seed: 7, inc: 1, views: ['dator'] },
  { name: 'frö33-incident1', seed: 33, inc: 0, views: ['dator'] },
];

/** Texten i bilden i senaste bildrutan (TEXTLOG i pixart.js): det som ritas över annan text, och alla texter
 * (för svenskan som blivit kvar – DOM-kontrollen ser inte bilden). */
const CANVAS_JS = async () => {
  const pa = await import('/src/pixart.js'), pc = await import('/src/pixcore.js');
  const W = pc.lo.width, H = pc.lo.height, seen = new Set(), boxes = [];
  for (const b of pa.TEXTLOG.list) {
    const k = `${b.s}|${b.x}|${b.y}`;
    if (!b.s.trim() || seen.has(k)) continue;
    if (b.x + b.w <= 0 || b.y + b.h <= 0 || b.x >= W || b.y >= H) continue; // (utanför bilden)
    seen.add(k); boxes.push(b);
  }
  // Text som får täcka annan text för att det är så det ser ut i huset: [den som ritas ovanpå, den under]
  const FRONT = [
    [/pixcars\.js/, /^lantern /], // korgen åker framför våningsdisplayen ovanför schaktdörren
    [/^drawCarPx /, /^cabinPx /], // korgens egna skyltar (zzz, FULLT!) över vågen på korgens överkant
    [/^drawFireTruckPx /, /^dockTruck /], // brandbilen ställer sig framför bilen vid lastkajen
    // det som ska synas över allt annat: ljudeffekterna, incidentbanderollerna överst och det spelaren följer
    [/^(drawFxPx|drawBannersPx|trackNote|drawSelectionPx) /, /./],
  ];
  const hits = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.s === b.s) continue; // (samma text ritad två gånger – skugga, kontur)
    if (FRONT.some(([up, down]) => up.test(b.at) && down.test(a.at))) continue;
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    // (minst ett par pixlar i båda led: kanter som nuddar varandra räknas inte)
    if (w >= 2 && h >= 3) hits.push({ key: `${b.at.split(' ')[0]} över ${a.at.split(' ')[0]}`, text: `»${b.s}« (${b.at}) över »${a.s}« (${a.at})` });
  }
  return { hits, texts: boxes.map(b => b.s) };
};

/** Vänta tills spelet har startat (ett ögonblick i adressen: dygnet är framspolat och står pausat). */
const STARTED_JS = async () => {
  const st = await import('/src/state.js');
  if (!st.S.started) throw new Error('spelet startade inte');
};

/** Texterna i panelen, textskylten, felrutan och verktygstipsen (översatta som när de visas). */
const TEXTS_JS = async () => {
  const L = await import('/src/lang.js');
  // verktygstipsen översätts när de visas (trDom per textnod) – samma sak här, tagg för tagg
  const hints = [...document.querySelectorAll('[data-hint]')].flatMap(e => e.getAttribute('data-hint').split(/<[^>]+>/).map(t => L.tr(t)));
  return [...document.querySelectorAll('#side, #lower, #err')].map(e => e.innerText).concat(hints);
};

const server = spawn('python3', ['serve.py', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch();
const errors = [], left = new Map(), overlaps = new Map(), diffs = [];
const watch = (page, where) => {
  page.on('pageerror', e => errors.push(`${where}: ${e.message} ${(e.stack || '').split('\n')[1] || ''}`.trim()));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${where}: ${m.text()}`); });
};
const noteTexts = (texts, where) => {
  for (const t of texts) for (const line of t.split('\n')) if (LANG === 'en' && swedish(line)) left.set(line.trim(), where);
};
// Kända krockar som inte är åtgärdade (TODO.md): skrivs ut men ger ingen felkod. Stryk det som rättas.
const KNOWN = new Set([]);
// grupperade efter vilka två ritfunktioner som krockar: hur många gånger, och första exemplet
const noteOverlaps = (hits, where) => {
  for (const h of hits) {
    const o = overlaps.get(h.key);
    if (o) o.n++; else overlaps.set(h.key, { n: 1, text: h.text, where });
  }
};

try {
  if (PARTS.includes('kaos')) await chaosDays();
  if (PARTS.includes('ögon')) await eyes();
} finally {
  await browser.close();
  server.kill();
}

console.log('');
for (const e of new Set(errors)) console.log(`✗ fel: ${e}`);
for (const [l, s] of left) console.log(`✗ svenska (${s}): ${l}`);
for (const [k, o] of overlaps) console.log(`${KNOWN.has(k) ? '· känt:' : '✗'} text över text: ${k} ×${o.n} – t.ex. ${o.where}: ${o.text}`);
const fresh = [...overlaps.keys()].filter(k => !KNOWN.has(k)).length;
for (const d of diffs) console.log(`△ ändrad bild: ${d}`);
if (diffs.length) console.log(`  jämför i ${EYES}index.html – avsiktligt? npm run playtest -- --del=ögon --godta`);
const bad = errors.length + left.size + fresh;
console.log(bad ? `\n${errors.length} fel, ${left.size} rader på svenska och ${fresh} nya sorters text över text`
  : `\n✓ inga fel, ingen svenska kvar och ingen ny text över text${overlaps.size ? ` (${overlaps.size} kända)` : ''}${diffs.length ? ` (${diffs.length} bilder ändrade)` : ''}`);
process.exit(bad ? 1 : 0);

// ---------- kaos: Murphys lag, ett dygn per frö ----------
async function chaosDays() {
  for (const seed of SEEDS) {
    const page = await browser.newPage(VIEWS.dator);
    watch(page, `frö ${seed}`);
    await page.goto(`http://localhost:${PORT}/?seed=${seed}&lang=${LANG}`);
    try { await page.waitForSelector('#go', { timeout: 15000 }); await page.click('#go'); } catch { /* (välkomstrutan visades inte) */ }
    await page.evaluate(async () => {
      const st = await import('/src/state.js'), sim = await import('/src/sim.js'), a = await import('/src/actions.js');
      (await import('/src/pixart.js')).TEXTLOG.on = true;
      // (vänta tills starten har byggt huset – utan välkomstruta kan sidan vara här innan newSim har körts)
      for (let i = 0; i < 300 && !st.S.elevators.length; i++) await new Promise(r => setTimeout(r, 50));
      while (st.hour() < 8.5) sim.step(sim.DT);
      a.act('chaos');
    });
    for (let k = 0; k < 40; k++) {
      // ett tag i dygnet, sedan en person eller en hiss att följa (deras rutor i panelen kommer också med)
      const h = await page.evaluate(async k => {
        const sim = await import('/src/sim.js'), st = await import('/src/state.js'), inp = await import('/src/input.js');
        for (let i = 0; i < 600; i++) sim.step(sim.DT);
        const ps = st.S.people.filter(p => !p.dead);
        if (k % 3 === 1 && ps.length) inp.followPerson(ps[(k * 7919) % ps.length]);
        if (k % 3 === 2) inp.followCarOnly(k % st.S.elevators.length);
        return st.hour().toFixed(2);
      }, k);
      await page.waitForTimeout(400);
      noteTexts(await page.evaluate(TEXTS_JS), `frö ${seed}`);
      const cv = await page.evaluate(CANVAS_JS);
      noteOverlaps(cv.hits, `frö ${seed} kaos kl ${h}`);
      noteTexts(cv.texts, `frö ${seed}, i bilden`);
      if (KEEP && k % 8 === 0) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}frö${seed}-${k}.png` }); }
    }
    await page.close();
    process.stdout.write(`kaos frö ${seed} ✓  `);
  }
}

// ---------- ögon: fasta ögonblick, jämförda med facit ----------
async function eyes() {
  for (const d of ['ny', 'diff']) rmSync(EYES + d, { recursive: true, force: true });
  for (const d of ['ny', 'diff', 'bas']) mkdirSync(EYES + d, { recursive: true });
  const rows = [];
  const cmp = await browser.newPage(); // (bilderna jämförs i en egen sida: canvas läser png utan beroenden)
  for (const m of MOMENTS) {
    let q = m.q;
    if (m.inc != null) {
      // klockslaget för incidenten ur dygnets tidtabell (en kvart in i den: förvarningen är över, det händer)
      const p = await browser.newPage();
      await p.goto(`http://localhost:${PORT}/?seed=${m.seed}&inc=kaos&h=6.05&lang=${LANG}`);
      await p.evaluate(STARTED_JS);
      const at = await p.evaluate(async i => (await import('/src/state.js')).S.incPlan[i]?.at, m.inc);
      await p.close();
      if (at == null) { console.log(`(${m.name}: ingen incident ${m.inc + 1} i tidtabellen)`); continue; }
      q = `seed=${m.seed}&inc=kaos&h=${(at + 0.25).toFixed(3)}`;
    }
    for (const v of m.views) {
      const name = `${m.name}-${v}`, where = `${name} (?${q})`;
      const page = await browser.newPage({ ...VIEWS[v], deviceScaleFactor: 1 });
      watch(page, name);
      // Samma ögonblick ska ge samma bild: grafikens slump (vrand = Math.random) får ett fast frö och klockan
      // (requestAnimationFrame, timers, performance.now) är Playwrights, som bara går när skriptet säger till.
      await page.addInitScript(() => {
        let a = 0x9e3779b9;
        Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      });
      await page.clock.install({ time: new Date('2026-01-01T12:00:00') });
      await page.clock.pauseAt(new Date('2026-01-01T12:00:01'));
      await page.goto(`http://localhost:${PORT}/?${q}&lang=${LANG}`);
      await page.evaluate(async () => { await document.fonts.ready; (await import('/src/pixart.js')).TEXTLOG.on = true; });
      await page.evaluate(STARTED_JS);
      await page.clock.runFor(1500); // (kameran hinner fram till det den följer, panelen ritas)
      // en sista bildruta med fast animationstid (S.anim räknas upp med bildrutornas tid: tv:n som flimrar …);
      // klockan står still, så ingen ny bildruta hinner ritas före skärmdumpen
      await page.evaluate(async () => {
        const st = await import('/src/state.js'), rn = await import('/src/render.js');
        st.S.anim = 100;
        rn.render(0);
      });
      noteTexts(await page.evaluate(TEXTS_JS), name);
      const { hits, texts } = await page.evaluate(CANVAS_JS);
      noteOverlaps(hits, where);
      noteTexts(texts, `${name}, i bilden`);
      await page.screenshot({ path: `${EYES}ny/${name}.png`, animations: "disabled" }); // (css: kortet som blinkar)
      await page.close();
      const base = `${EYES}bas/${name}.png`;
      let pct = null;
      if (ACCEPT || !existsSync(base)) cpSync(`${EYES}ny/${name}.png`, base);
      else {
        const r = await cmp.evaluate(diffPng, [readFileSync(base).toString('base64'), readFileSync(`${EYES}ny/${name}.png`).toString('base64'), BLOCK, BLOCK_MIN]);
        pct = r.png ? r.pct : 0;
        if (r.png) {
          writeFileSync(`${EYES}diff/${name}.png`, Buffer.from(r.png, 'base64'));
          diffs.push(`${name}: ${r.pct < 0.01 ? '<0,01' : r.pct.toFixed(2).replace('.', ',')} % av pixlarna, ${r.blocks} rutor (x,y ${r.box})`);
        }
      }
      rows.push({ name, q, pct, hits });
      process.stdout.write(`${name} ${pct ? '△' : '✓'}  `);
    }
  }
  await cmp.close();
  writeFileSync(`${EYES}index.html`, report(rows));
}

/** Jämför två png (base64) i webbläsaren: andelen ändrade pixlar och en bild där de är röda. */
async function diffPng([a, b, BLOCK, BLOCK_MIN]) {
  const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = `data:image/png;base64,${src}`; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  const px = img => { const c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h); };
  const da = px(ia), db = px(ib), out = new ImageData(w, h);
  let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const same = da.data[i] === db.data[i] && da.data[i + 1] === db.data[i + 1] && da.data[i + 2] === db.data[i + 2];
    const grey = (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 3 * 0.35 + 150;
    if (!same) { n++; const x = (i / 4) % w, y = Math.floor(i / 4 / w); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    out.data.set(same ? [grey, grey, grey, 255] : [230, 20, 40, 255], i);
  }
  // rutorna med många ändrade pixlar (snön ger bara enstaka pixlar per ruta)
  const bw = Math.ceil(w / BLOCK), cnt = new Uint16Array(bw * Math.ceil(h / BLOCK));
  for (let i = 0; i < out.data.length; i += 4) if (out.data[i] === 230 && out.data[i + 1] === 20) {
    const x = (i / 4) % w, y = Math.floor(i / 4 / w); cnt[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)]++;
  }
  const blocks = cnt.filter(c => c >= BLOCK_MIN).length;
  if (!blocks) return { n, blocks, pct: 0, png: null };
  const c = new OffscreenCanvas(w, h); c.getContext('2d').putImageData(out, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { n, blocks, pct: n / (w * h) * 100, png: btoa(s), box: `${x0},${y0}–${x1},${y1}` };
}

/** Rapporten: facit, nu och skillnaden bredvid varandra, ändrade bilder först. */
function report(rows) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  rows.sort((a, b) => (b.pct || 0) - (a.pct || 0));
  const row = r => `<section><h2>${esc(r.name)} <small>${r.pct == null ? 'nytt facit' : r.pct ? `${r.pct.toFixed(2)} % ändrat` : 'oförändrad'}</small>
  <a href="http://localhost:8123/?${esc(r.q)}">?${esc(r.q)}</a></h2>
  ${r.hits.length ? `<p class="bad">Text över text: ${r.hits.map(h => esc(h.text)).join(' · ')}</p>` : ''}
  <div class="row"><figure><img src="bas/${r.name}.png"><figcaption>facit</figcaption></figure>
  <figure><img src="ny/${r.name}.png"><figcaption>nu</figcaption></figure>
  ${r.pct ? `<figure><img src="diff/${r.name}.png"><figcaption>skillnad</figcaption></figure>` : ''}</div></section>`;
  return `<!doctype html><meta charset="utf-8"><title>Tornet – provspelning med ögon</title>
<style>body{font:14px system-ui;background:#008080;margin:0;padding:16px;color:#000}section{background:#c0c0c0;border:2px outset #fff;margin:0 0 16px;padding:8px}
h2{font-size:15px;margin:0 0 6px;background:#000080;color:#fff;padding:3px 6px}h2 small{font-weight:normal;opacity:.8}h2 a{color:#ff0;font-weight:normal;font-size:12px;margin-left:8px}
.row{display:flex;gap:8px;align-items:flex-start;overflow-x:auto}figure{margin:0}img{max-height:70vh;max-width:46vw;border:2px inset #fff;image-rendering:pixelated}
figcaption{font-size:12px}.bad{color:#a00;font-weight:bold;margin:4px 0}</style>
<h1 style="color:#fff;font-size:18px">Provspelning med ögon – ${new Date().toLocaleString('sv-SE')}</h1>
${rows.map(row).join('\n')}`;
}
