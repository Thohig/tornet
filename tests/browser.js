// Kör testsviten i webbläsaren (tests.html) och visar resultatet.
import { tests, Fail, setGolden } from './suite.js';

const list = document.getElementById('list');
async function runAll() {
  list.innerHTML = '';
  try { setGolden(await (await fetch('tests/golden.json', { cache: 'no-store' })).json()); } catch (e) { setGolden(null); }
  const results = [];
  let passed = 0;
  const t0 = performance.now();
  for (const t of tests) {
    const row = document.createElement('div');
    row.className = 't run';
    row.innerHTML = `<span class="ic">…</span><span>${t.name}</span><span class="ms"></span><div class="d"></div>`;
    list.appendChild(row);
    document.getElementById('summary').textContent = `Kör: ${t.name}`;
    await new Promise(r => setTimeout(r, 0));
    const start = performance.now();
    let ok = true, detail = '';
    try { detail = t.fn() || ''; } catch (e) { ok = false; detail = e instanceof Fail ? e.message : `${e.name}: ${e.message}\n${e.stack}`; }
    const ms = performance.now() - start;
    row.className = 't ' + (ok ? 'ok' : 'bad');
    row.querySelector('.ic').textContent = ok ? '✓' : '✗';
    row.querySelector('.ms').textContent = `${(ms / 1000).toFixed(1)} s`;
    row.querySelector('.d').textContent = detail;
    if (ok) passed++;
    results.push({ name: t.name, ok, detail, ms: Math.round(ms) });
  }
  const failed = tests.length - passed;
  document.getElementById('summary').textContent =
    `${failed ? '✗' : '✓'} ${passed} av ${tests.length} tester godkända på ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  document.getElementById('summary').style.color = failed ? 'var(--bad)' : 'var(--ok)';
  /** @type {any} */ (window).testResults = { passed, failed, results };
}
document.getElementById('rerun').onclick = runAll;
runAll();
