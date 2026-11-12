// Synthetische FR-73-Gegenprobe: node scripts/measure-pfa1.mjs <Basisordner> <Ausgabe.json> [Läufe=2000]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [baseline, output, countRaw = '2000'] = process.argv.slice(2), count = Number(countRaw);
if (!baseline || !output || !Number.isInteger(count) || count < 1) throw new Error('Basis, Ausgabe und positive Laufzahl angeben.');
const load = (root, file) => import(pathToFileURL(resolve(root, file)));
const roots = [baseline, '.'];
const runtimes = await Promise.all(roots.map(async root => ({
    fixture: (await load(root, 'tests/extended/parity-replay-fixture.mjs')).inputs,
    run: (await load(root, 'app/simulator/monte-carlo-runner.js')).runMonteCarloChunk,
    engine: (await load(root, 'engine/index.mjs')).EngineAPI
})));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = values => { const a = values.filter(Number.isFinite).sort((a, b) => a - b); return a.length ? a[Math.floor(a.length / 2)] : null; };
// Einseitige exakte 95-%-Obergrenze; seltene Pfadfehler als Zählwert mit Unsicherheit ausweisen.
const upper95 = (events, trials) => {
    if (events === trials) return 100;
    let low = 0, high = 1;
    for (let step = 0; step < 70; step++) {
        const p = (low + high) / 2;
        let term = (1 - p) ** trials, cdf = term;
        for (let k = 1; k <= events; k++) { term *= (trials - k + 1) / k * p / (1 - p); cdf += term; }
        if (cdf > .05) low = p; else high = p;
    }
    return high * 100;
};
const newCosts = [3600, 6000, 18000, 32000, 60000], oldCosts = [6000, 12000, 18000, 32000, 60000];
const scenarios = [
    { name: 'staffel', costs: [oldCosts, newCosts], drift: [.035, .035] },
    { name: 'drift', costs: [newCosts, newCosts], drift: [.035, .05] },
    { name: 'drift-minus30', costs: [newCosts, newCosts], drift: [.035, .035] },
    { name: 'drift-plus30', costs: [newCosts, newCosts], drift: [.065, .065] },
    { name: 'heute-grad3', costs: [newCosts, newCosts], drift: [.05, .05], care: { grade: 3, form: 'home-support', progression: 'usual' } },
    { name: 'heute-heim', costs: [newCosts, newCosts], drift: [.05, .05], care: { grade: 4, form: 'residential', progression: 'usual' } },
    { name: 'heute-heim-seit', costs: [newCosts, newCosts], drift: [.05, .05], care: { grade: 4, form: 'residential', progression: 'usual', residentialSince: '2023-01' } }
];
const result = { basis: '5a3fbc1d', runs: count, horizon: 35, seeds: [12345, 67890], scenarios: [] };
for (const seed of result.seeds) for (const scenario of scenarios) {
    const metrics = [0, 1].map(() => ({ technicalErrors: 0, failures: 0, terminalReal: [], taxes: [], hashes: [] }));
    let comparedYears = 0, mismatches = 0;
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start), chunks = [];
        for (const side of [0, 1]) {
            const runtime = runtimes[side], inputs = { ...structuredClone(runtime.fixture),
                careReferenceDate: '2026-10-23', startFloorBedarf: 36000, startFlexBedarf: 12000,
                pflegeKostenDrift: scenario.drift[side], pflegeMaxFloor: 120000, pflegeRampUp: 5,
                pflegeStufe1Zusatz: scenario.costs[side][0], pflegefallLogikAktivieren: true,
                pflegeGradeConfigs: Object.fromEntries(scenario.costs[side].map((zusatz, i) => [i + 1,
                    { zusatz, flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: [1.5, 2, 3, 4, 5][i] }])),
                ...(scenario.care ? { careToday: scenario.care } : {}) };
            const chunk = await runtime.run({ inputs, engine: runtime.engine, useCapeSampling: false,
                monteCarloParams: { anzahl: count, maxDauer: 35, methode: 'block', blockSize: 3, seed,
                    rngMode: 'per-run-seed', startYearMode: 'UNIFORM' }, widowOptions: inputs.widowOptions,
                runRange: { start, count: size }, logIndices: Array.from({ length: size }, (_, i) => start + i) });
            chunks.push(chunk);
            const m = metrics[side]; m.technicalErrors += chunk.technicalInventory.technicalError;
            m.failures += chunk.totals.failCount; m.terminalReal.push(...chunk.pathSummaries.finalValueRealEur);
            m.hashes.push(hash(chunk));
            for (const run of chunk.runMeta) m.taxes.push(run.logDataRows.reduce((sum, row) => sum + (row.steuern_gesamt || 0), 0));
        }
        // Finanzielle Abbrüche können früher kommen; exogene Jahresfolgen bis zum gemeinsamen Horizont prüfen.
        for (const a of chunks[0].runMeta) {
            const b = chunks[1].runMeta.find(run => run.index === a.index);
            const rows = [a, b].map(run => run?.logDataRows.filter(row => row.recordType === 'financial_year') || []);
            for (let i = 0; i < Math.min(rows[0].length, rows[1].length); i++) {
                const exogenous = row => [row.histJahr, row.inflation, row.Person1Alive, row.Person2Alive,
                    row.CareP1_Grade, row.CareP2_Grade, row.CareP1_Form, row.CareP2_Form];
                comparedYears++;
                if (hash(exogenous(rows[0][i])) !== hash(exogenous(rows[1][i]))) mismatches++;
            }
        }
    }
    const summary = metrics.map(m => ({ technicalErrors: m.technicalErrors, failures: m.failures,
        failuresUpper95Pct: upper95(m.failures, count), terminalRealMedian: median(m.terminalReal),
        taxesMedian: median(m.taxes), fullResultHash: hash(m.hashes) }));
    result.scenarios.push({ name: scenario.name, seed, before: summary[0], after: summary[1], comparedYears, mismatches });
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(`${scenario.name}, Seed ${seed}: ${count} je Stand, ${comparedYears} gemeinsame Jahre, ${mismatches} exogene Abweichungen.`);
}
