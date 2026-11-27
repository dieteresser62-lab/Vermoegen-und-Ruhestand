// KR-1 Teil B (NG-2): Der Crash-Zuschlag zieht aus einem eigenen, fest abgezweigten Strom. Mit dem Startwert der
// Jahresziehung fiel ein Crash im Jahr 0 nur in wenige Startjahre (Gutachten: 207 von 207 auf zwei Jahrespaare).
import { inputs as simulatorSample } from './extended/parity-replay-fixture.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { createTailRiskSchedule } from '../app/simulator/tail-risk-overlay.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { EngineAPI } from '../engine/index.mjs';

prepareHistoricalDataOnce();
// In der Vorgabe ist der Crash-Zuschlag aus; für die Probe fest eingeschaltet (2 % je Jahr, ein Jahr Dauer).
const tailRisk = { tailRiskEnabled: true, tailRiskAnnualProbabilityPct: 2, tailRiskReturnShockPct: -35,
    tailRiskInflationShockPct: 6, tailRiskDurationYears: 1, tailRiskCooldownYears: 10 };
const inputs = { ...structuredClone(simulatorSample), ...tailRisk };
const runs = 10000;
const chunk = await runMonteCarloChunk({ inputs, widowOptions: { mode: 'stop' }, useCapeSampling: false, engine: EngineAPI,
    monteCarloParams: { anzahl: runs, maxDauer: 1, blockSize: 3, seed: 12345, methode: 'regime_markov',
        rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
    runRange: { start: 0, count: runs }, logIndices: Array.from({ length: runs }, (_, index) => index) });
const firstYears = chunk.runMeta.map(run => run.logDataRows[0]).filter(Boolean);
assertEqual(firstYears.length, runs, 'Jeder Lauf hat eine erste Jahreszeile');
const crashed = firstYears.filter(row => row.tailRiskActive === true);
const startYears = new Set(crashed.map(row => row.histJahr));
assert(crashed.length > 100 && crashed.length < 300, `Etwa 2 % der Läufe mit Crash im Jahr 0 (${crashed.length})`);
assert(startYears.size >= 20, `Crash im Jahr 0 verteilt sich auf mindestens 20 Startjahre (${startYears.size})`);

// Die Abzweigung bleibt reproduzierbar: gleicher Startwert, gleicher Plan.
const planA = createTailRiskSchedule(4242, tailRisk, 30), planB = createTailRiskSchedule(4242, tailRisk, 30);
assertEqual(JSON.stringify(planA), JSON.stringify(planB), 'Gleicher Startwert ergibt denselben Crash-Plan');
console.log(`KR-1 Teil B: ${crashed.length} Läufe mit Crash im Jahr 0 in ${startYears.size} Startjahren.`);
