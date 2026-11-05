// Max/Erika 99/10, 10.000 Läufe, acht Worker; Ausgabe.json. Kein Bestandteil von npm test.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..'), from = file => import(pathToFileURL(`${root}/${file}`));
const { measurementInputs, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { DecisionNodeWorker } = await from('tests/helpers/decision-worker-adapter.mjs');
const { runTargetBudgetSearch } = await from('app/simulator/target-budget-search.js');
const inputs = await measurementInputs(0,'max-erika');
globalThis.Worker = DecisionNodeWorker;
const started = performance.now();
const result = await runTargetBudgetSearch({inputs,monteCarloParams:{...parameters,anzahl:10000}, useCapeSampling:false,
 workerConfig:{workerCount:8},goals:{coveragePct:99,affectedPct:10},diagnosticRuns:0,
 onProgress(pct,detail){ if(detail.completedRuns===0) console.log(`${pct.toFixed(1)} % ${detail.comparison}`); }});
const elapsedSeconds = (performance.now()-started)/1000;
writeFileSync(process.argv[2],JSON.stringify({elapsedSeconds,monthly:result.monthly,finalVerification:result.finalVerification,metrics:result.comparison.variant.metrics,
 baselineMetrics:result.comparison.baseline.metrics,observations:result.observations,nextMonthly:result.nextMonthly,nextMetrics:result.nextMetrics,params:result.params},null,2));
console.log(JSON.stringify({elapsedSeconds,monthly:result.monthly,finalVerification:result.finalVerification,metrics:result.comparison.variant.metrics}));
process.exit(0);
