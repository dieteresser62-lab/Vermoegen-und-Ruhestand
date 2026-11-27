// MS-1: Stationary und Block ziehen zirkulär (NG-9), der CAPE-Filter gilt nur für den ersten Block (NG-8).
// Synthetischer Zufallsstrom mit festem Startwert, keine Nutzerdaten.
import { annualData } from '../app/simulator/simulator-data.js';
import { prepareHistoricalData } from '../app/simulator/simulator-portfolio.js';
import { sampleNextYearData } from '../app/simulator/simulator-engine-helpers.js';
import { getStartYearCandidates } from '../app/shared/cape-utils.js';
import {
    initializeMonteCarloSamplingStateV1,
    pickMonteCarloStartYearIndex,
    resolveMonteCarloSamplingContractV1,
    sampleMonteCarloYearV1
} from '../app/simulator/mc-year-sampling.js';

console.log('--- MS-1 Ziehung Tests ---');

prepareHistoricalData();

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Zieht Pfade über denselben Weg wie der Monte-Carlo-Lauf: Vertrag, Startjahr, Zustand, Jahresziehung. */
function drawPaths({ method, blockSize = 5, startYearMode = 'UNIFORM', startYearFilter = 1970, useCapeSampling = false,
    capeRatio = 25, paths, years, seed }) {
    const rand = mulberry32(seed);
    const inputs = { capeRatio, marketCapeRatio: capeRatio, stressPreset: 'NONE' };
    const resolution = resolveMonteCarloSamplingContractV1({ method, inputs, annualData, useCapeSampling,
        startYearMode, startYearFilter, blockSize });
    const counts = new Map();
    const draws = [];
    for (let path = 0; path < paths; path++) {
        const startYearIndex = pickMonteCarloStartYearIndex({ rand, inputs, annualData, useCapeSampling, samplingContract: resolution });
        const state = { samplerState: {} };
        initializeMonteCarloSamplingStateV1({ state, method, blockSize, rand, startYearIndex, samplingResolution: resolution, annualData });
        for (let year = 0; year < years; year++) {
            const sample = sampleMonteCarloYearV1({ state, method, blockSize, rand, stressContext: null,
                samplingResolution: resolution, annualData, sampleNextYearData });
            const jahr = Number(sample.yearData.jahr);
            counts.set(jahr, (counts.get(jahr) || 0) + 1);
            draws.push({ jahr, source: sample.source, year });
        }
    }
    return { resolution, counts, draws };
}

const lastYear = annualData.at(-1).jahr;
const windows = [
    { label: 'alle Jahre', startYearMode: 'UNIFORM', firstYear: annualData[4].jahr },
    { label: 'ab 1951', startYearMode: 'FILTER', startYearFilter: 1951, firstYear: 1951 },
    { label: 'ab 1970', startYearMode: 'FILTER', startYearFilter: 1970, firstYear: 1970 }
];

// NG-9: Jedes Fensterjahr hat dieselbe Randwahrscheinlichkeit, auch die ersten und letzten Jahre.
for (const method of ['stationary', 'block']) {
    for (const window of windows) {
        const { counts, resolution } = drawPaths({ method, ...window, paths: 8000, years: 50, seed: 4711 });
        const poolYears = resolution.effectiveYearSamplingConfig.allowedIndices.map(index => annualData[index].jahr);
        assertEqual(poolYears[0], window.firstYear, `${method}, ${window.label}: Fenster beginnt im erwarteten Jahr`);
        assertEqual(poolYears.at(-1), lastYear, `${method}, ${window.label}: Fenster endet im letzten Datenjahr`);
        assert([...counts.keys()].every(jahr => jahr >= window.firstYear && jahr <= lastYear),
            `${method}, ${window.label}: Ziehung bleibt im Fenster`);
        const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
        const mean = total / poolYears.length;
        const ratios = poolYears.map(jahr => (counts.get(jahr) || 0) / mean);
        const worst = ratios.reduce((max, ratio) => Math.max(max, Math.abs(ratio - 1)), 0);
        assert(worst < 0.1, `${method}, ${window.label}: jedes Jahr innerhalb ±10 % der Gleichverteilung (größte Abweichung ${(worst * 100).toFixed(1)} %)`);
        assert(ratios[0] > 0.9, `${method}, ${window.label}: erstes Fensterjahr ${window.firstYear} nicht untergewichtet (${(ratios[0] * 100).toFixed(1)} % der Mitte)`);
    }
}

// NG-9: Am Datenende läuft der Block zum Fensteranfang weiter statt neu zu starten.
{
    const { draws } = drawPaths({ method: 'stationary', startYearMode: 'FILTER', startYearFilter: 1970, paths: 4000, years: 40, seed: 99 });
    const afterLast = [];
    for (let i = 1; i < draws.length; i++) {
        if (draws[i].year > 0 && draws[i - 1].jahr === lastYear) afterLast.push(draws[i]);
    }
    const wrapped = afterLast.filter(draw => draw.source === 'stationary_continuation');
    assert(afterLast.length > 0, 'Stationary erreicht das Datenende');
    assert(wrapped.every(draw => draw.jahr === 1970), 'Fortsetzung nach dem letzten Datenjahr ist der Fensteranfang 1970');
    assert(wrapped.length > afterLast.length * 0.7, 'nach dem Datenende setzt der Block meist fort (Neustart nur mit 1/L)');
}

// NG-8: Mit „Startjahre nach CAPE“ gilt der Filter nur für den ersten Block; spätere Blockstarts ziehen aus dem normalen Pool.
{
    const capeRatio = 38;
    const capeYears = new Set(getStartYearCandidates(capeRatio, annualData, 0.2, { fallbackToAll: false }));
    assert(capeYears.size > 0 && capeYears.size < 20, 'CAPE 38 ergibt eine kleine Kandidatenmenge');
    for (const method of ['stationary', 'block']) {
        const { resolution, draws } = drawPaths({ method, useCapeSampling: true, capeRatio, paths: 3000, years: 40, seed: 2024 });
        assertEqual(resolution.contract.startSource, 'cape', `${method}: CAPE ist Startquelle`);
        assert(resolution.initialStartSampler.indices.every(index => capeYears.has(annualData[index].jahr)),
            `${method}: erster Block startet in einem CAPE-Jahr`);
        const pool = resolution.effectiveYearSamplingConfig.allowedIndices;
        assertEqual(JSON.stringify(resolution.blockStartSampler?.indices), JSON.stringify(pool),
            `${method}: spätere Blockstarts nutzen den normalen Pool`);
        if (method === 'block') {
            assertEqual(JSON.stringify(resolution.effectiveYearSamplingConfig.blockStartIndices), JSON.stringify(pool),
                'block: Blockstarts nach dem ersten Block kommen aus allen Fensterjahren');
        }
        const initial = draws.filter(draw => draw.source === 'initial_start');
        const restarts = draws.filter(draw => draw.source === (method === 'block' ? 'fixed_block_restart' : 'stationary_restart'));
        assertEqual(initial.length, 3000, `${method}: ein CAPE-Start je Pfad`);
        assert(initial.every(draw => capeYears.has(draw.jahr)), `${method}: jeder Pfad beginnt in einem CAPE-Jahr`);
        const capeShare = restarts.filter(draw => capeYears.has(draw.jahr)).length / restarts.length;
        assert(restarts.length > 10000, `${method}: genug spätere Blockstarts gezählt`);
        assert(capeShare < 0.2, `${method}: spätere Blockstarts nur selten in CAPE-Jahren (${(capeShare * 100).toFixed(1)} %, erwartet etwa ${(capeYears.size / pool.length * 100).toFixed(1)} %)`);
    }
}

// NG-8 gilt nicht für regime_markov: CAPE wirkt dort wie bisher nur im Jahr 0.
{
    const resolution = resolveMonteCarloSamplingContractV1({ method: 'regime_markov',
        inputs: { capeRatio: 38, marketCapeRatio: 38, stressPreset: 'NONE' }, annualData, useCapeSampling: true });
    assertEqual(resolution.blockStartSampler, null, 'regime_markov hat keinen Blockstart-Pool');
    assertEqual(resolution.contract.startSource, 'cape', 'regime_markov nutzt CAPE für das Startjahr');
}

console.log('--- MS-1 Ziehung Tests Completed ---');
