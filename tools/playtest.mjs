// Provspelning i webbläsaren: npm run playtest [-- --seeds=21,5 --lang=en --keep]
//
// Testsviten kör simuleringen i Node, men panelen, incidentkorten och pixelgrafiken behöver en webbläsare. Det här
// skriptet startar serve.py på en egen port, öppnar spelet i Chromium (Playwright), trycker på Murphys lag och spolar
// fram ett dygn i taget medan kameran följer personer och hissar. Det letar efter:
//   - fel i sidan (pageerror, console.error – även felrutan #err från main.js),
//   - svenska som blivit kvar i det engelska gränssnittet: panelen, textskylten och verktygstipsen.
// Avslutas med kod 1 om något hittades. Skärmdumpar sparas i tools/playtest-out/ med --keep.
//
// Playwright är inget beroende i package.json (CI behöver det inte): npm i --no-save playwright && npx playwright install chromium
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const SEEDS = arg('seeds', '21,5,77').split(',').map(Number);
const LANG = arg('lang', 'en');
const KEEP = process.argv.includes('--keep');
const PORT = 8100 + Math.floor(Math.random() * 80);
const OUT = new URL('./playtest-out/', import.meta.url).pathname;

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

const server = spawn('python3', ['serve.py', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch();
const errors = [], left = new Map();
try {
  for (const seed of SEEDS) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
    page.on('pageerror', e => errors.push(`frö ${seed}: ${e.message} ${(e.stack || '').split('\n')[1] || ''}`.trim()));
    page.on('console', m => { if (m.type() === 'error') errors.push(`frö ${seed}: ${m.text()}`); });
    await page.goto(`http://localhost:${PORT}/?seed=${seed}&lang=${LANG}`);
    try { await page.waitForSelector('#go', { timeout: 15000 }); await page.click('#go'); } catch { /* (välkomstrutan visades inte) */ }
    await page.evaluate(async () => {
      const st = await import('/src/state.js'), sim = await import('/src/sim.js'), a = await import('/src/actions.js');
      while (st.hour() < 8.5) sim.step(sim.DT);
      a.act('chaos');
    });
    for (let k = 0; k < 40; k++) {
      // ett tag i dygnet, sedan en person eller en hiss att följa (deras rutor i panelen kommer också med)
      await page.evaluate(async k => {
        const sim = await import('/src/sim.js'), st = await import('/src/state.js'), inp = await import('/src/input.js');
        for (let i = 0; i < 600; i++) sim.step(sim.DT);
        const ps = st.S.people.filter(p => !p.dead);
        if (k % 3 === 1 && ps.length) inp.followPerson(ps[(k * 7919) % ps.length]);
        if (k % 3 === 2) inp.followCarOnly(k % st.S.elevators.length);
      }, k);
      await page.waitForTimeout(400);
      const texts = await page.evaluate(async () => {
        const L = await import('/src/lang.js');
        // verktygstipsen översätts när de visas (trDom per textnod) – samma sak här, tagg för tagg
        const hints = [...document.querySelectorAll('[data-hint]')].flatMap(e => e.getAttribute('data-hint').split(/<[^>]+>/).map(t => L.tr(t)));
        return [...document.querySelectorAll('#side, #lower, #err')].map(e => e.innerText).concat(hints);
      });
      for (const t of texts) for (const line of t.split('\n')) if (LANG === 'en' && swedish(line)) left.set(line.trim(), seed);
      if (KEEP && k % 8 === 0) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}frö${seed}-${k}.png` }); }
    }
    await page.close();
    process.stdout.write(`frö ${seed} ✓  `);
  }
} finally {
  await browser.close();
  server.kill();
}
console.log('');
for (const e of new Set(errors)) console.log(`✗ fel: ${e}`);
for (const [l, s] of left) console.log(`✗ svenska (frö ${s}): ${l}`);
const bad = errors.length + left.size;
console.log(bad ? `\n${errors.length} fel och ${left.size} rader på svenska` : `\n✓ inga fel och ingen svenska kvar (${SEEDS.length} kaosdygn på ${LANG})`);
process.exit(bad ? 1 : 0);
