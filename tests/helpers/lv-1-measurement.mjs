// Nur synthetische Musterwerte; außerhalb der Suite, ein Messprozess je Aufruf.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output, selection = 'main', factorArg = '.5', countArg = '2000'] = process.argv.slice(2);
assert(root && output, 'Quellordner und Ausgabedatei erforderlich.');
assert(['main', 'sensitivity', 'historical'].includes(selection));
const factor = Number(factorArg), count = Number(countArg);
assert([.35, .5, .65].includes(factor));
assert(Number.isSafeInteger(count) && count > 0);
if (factor !== .5) {
    const loader = `export async function load(url, context, nextLoad) {
        const result = await nextLoad(url, context);
        if (!url.endsWith('/simulator-engine-helpers.js')) return result;
        const source = String(result.source), target = "careToday.progression === 'slower' ? .5";
        if (!source.includes(target)) throw new Error('Verlaufsfaktor fehlt.');
        return { ...result, source: source.replace(target, "careToday.progression === 'slower' ? ${factor}") };
    }`;
    register(`data:text/javascript,${encodeURIComponent(loader)}`);
}
const from = file => import(pathToFileURL(resolve(root, file)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { measurementInputs, backtest, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await from('engine/index.mjs');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { annualData } = await from('app/simulator/simulator-data.js');
const base = await measurementInputs(0, undefined, '2026-10-24');
assert.equal(base.simulationPeople[1].name, 'Erika');
assert.equal(base.pflegefallLogikAktivieren, true);
const params = { ...parameters, anzahl: count };
if (selection === 'historical') {
    const period = annualData.filter(year => year.jahr >= 1925 && year.jahr <= 1999);
    assert.equal(period.length, 75);
    annualData.splice(0, annualData.length, ...period);
    params.methode = 'block';
}
const result = { synthetic: true, baseline: 'aaec0829', testDate: '2026-10-24',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    selection, slowerFactor: factor, parameters: params, inputs: base,
    definitions: {
        yearsToGrade4: 'Jahre ab Start bis zum ersten Grad >=4, nur erreichte Pfade; Anzahl separat, Tod/Horizont konkurrieren.',
        careYearsTotal: 'Summe Pflegepersonenjahre Max + Erika, auch nach Ruin; Sterbejahr halb.',
        grade5Years: 'Pflegejahre Erika in Grad 5, auch nach Ruin; Sterbejahr halb.',
        lifeYears: 'Verbleibende Lebensjahre Erika ab Start, Sterbejahr halb, bei Horizont rechtszensiert.',
        money: 'Endvermögen real in Euro zum Start; Grundbedarf gedeckt = 100 % minus Ruinquote.',
        historical: 'Unabhängige Gegenprobe: Blockbootstrap aus 1925–1999, Blockgröße 3; kein Marktregime.'
    }, scenarios: {} };
const variants = selection === 'main' ? ['usual', 'slower', 'much_slower', 'none'] : ['slower'];
for (const progression of variants) {
    const inputs = structuredClone(base);
    if (progression !== 'none') inputs.partner.careToday = { grade: 2, progression };
    const paths = Array.from({ length: count }, () => ({ p1Alive: true, p2Alive: true,
        firstGrade4: null, careYearsTotal: 0, erikaCareYears: 0, grade5Years: 0, lifeYears: 0 }));
    const chunks = [], real = [];
    let ruin = 0, maxFlowDelta = 0;
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: params,
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, i) => start + i),
            comparisonPairing: { mode: 'record', tapes: new Map(), continuationYears: new Map(),
                onYear({ runIndex, yearIndex, p1Alive, p2Alive, careP1, careP2 }) {
                const p = paths[runIndex], w1 = p.p1Alive ? (p1Alive ? 1 : .5) : 0,
                    w2 = p.p2Alive ? (p2Alive ? 1 : .5) : 0;
                if (w2 && careP2 >= 4 && p.firstGrade4 === null) p.firstGrade4 = yearIndex;
                p.careYearsTotal += (careP1 ? w1 : 0) + (careP2 ? w2 : 0);
                p.erikaCareYears += careP2 ? w2 : 0;
                p.grade5Years += careP2 === 5 ? w2 : 0;
                p.lifeYears += w2;
                p.p1Alive = p1Alive; p.p2Alive = p2Alive;
            } } });
        assert.equal(chunk.technicalInventory.technicalError, 0);
        assert.equal(chunk.financialMetricsValid, true);
        chunks.push(hash(chunk)); ruin += chunk.totals.failCount;
        real.push(...chunk.pathSummaries.finalValueRealEur);
        for (const run of chunk.runMeta) for (const row of run.logDataRows)
            maxFlowDelta = Math.max(maxFlowDelta, Math.abs(row.portfolio_flow_delta || 0));
        if ((start + size) % 500 === 0) console.log(`${selection}/${progression}/${factor}: ${start + size}/${count}`);
    }
    const reached = paths.filter(p => p.firstGrade4 !== null), sorted = real.sort((a, b) => a - b);
    const mean = key => paths.reduce((sum, p) => sum + p[key], 0) / count;
    const counterchecks = (selection === 'historical' ? [] : [[2000, 2025], [1929, 1963], [1965, 1999]]).map(([start, end]) => {
        const run = backtest(inputs, start, end);
        assert(['completed', 'ruin'].includes(run.outcome.kind), `${start}–${end}: ${JSON.stringify(run.outcome)}`);
        return { period: `${start}–${end}`, outcome: run.outcome.kind, sha256: hash(run) };
    });
    result.scenarios[progression] = { inputsSha256: hash(inputs), coveredPct: 100 * (count - ruin) / count, ruin,
        meanYearsToGrade4: reached.reduce((sum, p) => sum + p.firstGrade4, 0) / reached.length,
        reachedGrade4: reached.length, meanCareYearsTotal: mean('careYearsTotal'), meanErikaCareYears: mean('erikaCareYears'),
        meanGrade5Years: mean('grade5Years'), meanErikaLifeYears: mean('lifeYears'),
        meanErikaDeathAgeRestricted: inputs.partner.startAlter + mean('lifeYears'),
        erikaCensored: paths.filter(p => p.p2Alive).length,
        realEndP50: (sorted[Math.floor((count - 1) / 2)] + sorted[Math.ceil((count - 1) / 2)]) / 2,
        completeChunksSha256: hash(chunks), chunks, lifePathsSha256: hash(paths), maxFlowDelta, counterchecks };
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}
process.exit(0);
