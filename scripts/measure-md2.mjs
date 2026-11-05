// MD-1 erneut mit denselben Parametern; keine zusätzlichen Jahresprotokolle
// für die Rangmessung. Den gewählten Pfad unabhängig aus Jahreslogs nachmessen.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { household, params, EngineAPI, runMonteCarloChunk, ScenarioAnalyzer } from '../auftrag/md1-ergebnis/common.mjs';
import { summarizeRun } from '../auftrag/md1-ergebnis/measure.mjs';

const destination = process.argv[2];
if (!destination) throw new Error('Aufruf: node scripts/measure-md2.mjs <Ausgabe.json> [Laufzahl=5000]');
const count = Number(process.argv[3] || 5000);
const batchLimit = Number(process.argv[4] || 5);
assert(Number.isSafeInteger(count) && count > 0);
const started = performance.now();
const report = existsSync(destination) ? JSON.parse(readFileSync(destination, 'utf8')) : { runtime: { node: process.version, platform: process.platform },
    inputSource: 'tests/fixtures/pe-1-max-erika.json; MD-1 household() variants',
    params: { ...params, anzahl: count }, seeds: Array.from({ length: 10 }, (_, i) => 12345 + i),
    selection: 'Median nominal equity CAGR over financial_year only, ties by absolute run index',
    batches: [], complete: false };
assert.equal(report.params.anzahl, count);
let measuredBatches = 0;

async function measure(name, method, seed) {
    const inputs = household(name), meta = [];
    const hashes = Object.fromEntries(['totals', 'lists', 'pathSummaries', 'heatmap'].map(key => [key, createHash('sha256')]));
    let failures = 0;
    for (let start = 0; start < count; start += 100) {
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI,
            monteCarloParams: { ...params, methode: method, seed, anzahl: count }, widowOptions: inputs.widowOptions,
            useCapeSampling: false, runRange: { start, count: Math.min(100, count - start) }, logIndices: [] });
        assert.equal(chunk.technicalInventory.technicalError, 0);
        assert(chunk.runMeta.every(run => run.logDataRows.length === 0));
        for (const [key, hash] of Object.entries(hashes)) hash.update(JSON.stringify(chunk[key]));
        failures += chunk.totals.failCount;
        meta.push(...chunk.runMeta);
        if (meta.length % 1000 === 0) console.log(`${name}/${method}/${seed}: ${meta.length}/${count}`);
    }
    const analyzer = new ScenarioAnalyzer(count);
    meta.forEach(run => analyzer.addRun(run));
    const picks = analyzer.buildScenarioLogs().characteristic;
    const typical = picks.find(pick => pick.key === 'typicalMarket');
    const oldMedian = picks.find(pick => pick.key === 'p50');
    const sorted = meta.filter(run => Number.isFinite(run.equityCagr))
        .sort((a, b) => a.equityCagr - b.equityCagr || a.index - b.index);
    const rank = index => (sorted.findIndex(run => run.index === index) + .5) / sorted.length * 100;
    const selectedIndex = typical.sourceIdentity.absoluteRunIndex;
    const returnRank = rank(selectedIndex);
    assert(returnRank >= 49 && returnRank <= 51);
    // Echter Log-Nachzug über denselben Runner und unabhängige MD-1-Auswertung.
    const replay = await runMonteCarloChunk({ inputs, engine: EngineAPI,
        monteCarloParams: { ...params, methode: method, seed, anzahl: count }, widowOptions: inputs.widowOptions,
        useCapeSampling: false, runRange: { start: selectedIndex, count: 1 }, logIndices: [selectedIndex] });
    assert.equal(replay.technicalInventory.technicalError, 0);
    const path = summarizeRun(replay.runMeta[0], replay.pathSummaries, 0);
    assert.equal(path.equityCagr, meta[selectedIndex].equityCagr);
    const result = { household: name, method, seed, count, successPct: (count - failures) / count * 100,
        typicalIndex: selectedIndex, typicalReturnRankPct: returnRank,
        typicalCagrPct: path.nominalCagrPct, financialYears: path.financialYears,
        wealthMedianIndex: oldMedian.sourceIdentity.absoluteRunIndex,
        wealthMedianReturnRankPct: rank(oldMedian.sourceIdentity.absoluteRunIndex),
        hashes: Object.fromEntries(Object.entries(hashes).map(([key, hash]) => [key, hash.digest('hex')])) };
    report.batches.push(result);
    writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(result));
}

for (const name of ['muster', 'married50', 'gross']) {
    for (const seed of report.seeds) {
        if (report.batches.some(batch => batch.household === name && batch.method === 'regime_markov' && batch.seed === seed)) continue;
        if (measuredBatches >= batchLimit) break;
        await measure(name, 'regime_markov', seed);
        measuredBatches++;
    }
}
if (measuredBatches < batchLimit && !report.batches.some(batch => batch.method === 'stationary')) await measure('gross', 'stationary', 12345);
report.latestSessionDurationMs = performance.now() - started;
report.complete = report.batches.length === 31;
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(`MD-2: ${report.batches.length}/31 Batches, ${report.batches.length * count} Pfade, Sitzung ${Math.round(report.latestSessionDurationMs / 1000)} s; zum Fortsetzen denselben Befehl erneut aufrufen.`);
