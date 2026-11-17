// En arbetare i den parallella testkörningen (run.mjs): laddar sviten en gång och kör de tester
// huvudtråden skickar, ett i taget. Varje arbetare har egna moduler och alltså ett eget tillstånd S.
import { parentPort, workerData } from 'node:worker_threads';
import { tests, Fail, setGolden } from './suite.js';

setGolden(workerData.golden);
parentPort.on('message', i => {
  const start = performance.now();
  let ok = true, detail = '';
  try { detail = tests[i].fn() || ''; } catch (e) { ok = false; detail = e instanceof Fail ? e.message : `${e.name}: ${e.message}\n${e.stack}`; }
  parentPort.postMessage({ i, ok, detail: String(detail), ms: performance.now() - start });
});
