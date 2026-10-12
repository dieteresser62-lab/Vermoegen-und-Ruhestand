import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EngineAPI } from '../engine/index.mjs';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { createMonteCarloChunkAccumulatorV1, mergeMonteCarloChunkResultV1, finalizeMonteCarloChunkAccumulatorV1 } from '../app/simulator/monte-carlo-chunk-result.js';

export const benchmarkInputs = {
    startAlter: 65, geschlecht: 'm', startVermoegen: 900000, depotwertAlt: 300000,
    einstandAlt: 250000, zielLiquiditaet: 50000, startFloorBedarf: 24000,
    startFlexBedarf: 12000, rebalancingBand: 25, maxSkimPctOfEq: 10,
    maxBearRefillPctOfEq: 5, liquidityRunwayYears: 3, goldAktiv: false,
    goldZielProzent: 0, goldFloorProzent: 0, goldSteuerfrei: true, startSPB: 1000,
    kirchensteuerSatz: 0, rentAdjMode: 'fix', rentAdjPct: 0, renteMonatlich: 0,
    renteStartOffsetJahre: 0, dynamicFlex: false, horizonMethod: 'survival_quantile',
    horizonYears: 30, survivalQuantile: 0.85, goGoActive: false, goGoMultiplier: 1,
    capeRatio: 0, marketCapeRatio: 0, stressPreset: 'NONE',
    pflegefallLogikAktivieren: false, partner: { aktiv: false },
    accumulationPhase: { enabled: false }, transitionYear: 0
};
export const benchmarkWidowOptions = { mode: 'stop', percent: 0, marriageOffsetYears: 0, minMarriageYears: 0 };
export function legacyDigest(value) {
    return createHash('sha256').update(JSON.stringify(value, (key, item) =>
        key === 'wealthFan' ? undefined : ArrayBuffer.isView(item) ? Array.from(item) : item)).digest('hex');
}
export async function benchmark({ runs = 10000, years = 35, seed = 12345, phase = 'before' } = {}) {
    if (runs !== 10000 || years !== 35 || seed !== 12345 || !['before', 'after'].includes(phase)) throw new Error('Messvertrag: 10000 Läufe, 35 Jahre, Saat 12345, before/after.');
    prepareHistoricalDataOnce();
    const monteCarloParams = { anzahl: runs, maxDauer: years, seed, blockSize: 5,
        methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
    let calls = 0;
    const engine = { ...EngineAPI, simulateSingleYear(...args) { calls++; return EngineAPI.simulateSingleYear(...args); } };
    const options = { inputs: benchmarkInputs, widowOptions: benchmarkWidowOptions,
        monteCarloParams, useCapeSampling: false, logIndices: [], engine, collectWealthFan: phase === 'after' };
    await runMonteCarloChunk({ ...options, runRange: { start: 0, count: 500 } });
    const measurements = [];
    for (let repeat = 0; repeat < 3; repeat++) {
        globalThis.gc?.(); calls = 0;
        const memoryBefore = process.memoryUsage();
        const start = performance.now();
        const result = await runMonteCarloChunk({ ...options, runRange: { start: 0, count: runs } });
        const computeMs = performance.now() - start;
        const mergeStart = performance.now();
        const accumulator = createMonteCarloChunkAccumulatorV1(runs);
        mergeMonteCarloChunkResultV1(accumulator, result);
        const finalized = finalizeMonteCarloChunkAccumulatorV1(accumulator);
        const mergeMs = performance.now() - mergeStart;
        measurements.push({ computeMs, mergeMs, simulateYearCalls: calls,
            digest: legacyDigest(result), mergedDigest: legacyDigest(finalized),
            memoryBefore, memoryAfter: process.memoryUsage() });
        console.error(`Messung ${phase} ${repeat + 1}/3: ${computeMs.toFixed(0)} ms`);
    }
    const sorted = measurements.map(item => item.computeMs).sort((a, b) => a - b);
    const report = { phase, harnessSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
        inputDigest: legacyDigest({ inputs: benchmarkInputs, monteCarloParams, widowOptions: benchmarkWidowOptions }),
        runtime: process.version, platform: process.platform, arch: process.arch,
        hardware: cpus()[0]?.model, workers: 0, chunks: 1, logIndices: [],
        warmupRuns: 500, runs, years, seed, medianMs: sorted[1], rangeMs: [sorted[0], sorted[2]],
        transferMs: null, transferReason: 'Serieller Pfad; echte Worker extern zu messen.', measurements };
    console.log(JSON.stringify(report, null, 2));
    return report;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const argumentsByName = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
    await benchmark({ runs: Number(argumentsByName.runs || 10000), years: Number(argumentsByName.years || 35),
        seed: Number(argumentsByName.seed || 12345), phase: argumentsByName.phase || 'before' });
}
