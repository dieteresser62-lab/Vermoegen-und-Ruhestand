// Ausschließlich synthetische Muster: gepaarte Pfade für FR-64.
import { writeFileSync, readFileSync } from 'node:fs';
import { measurementInputs, parameters, hash } from '../tests/helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { quantile } from '../app/simulator/simulator-utils.js';
import { EngineAPI } from '../engine/index.mjs';
import { lifetimeUseMultiplier } from '../app/shared/life-expectancy.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { computeAdjPctForYear } from '../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';

const count = Number(process.argv[3] || 2000), results = {};
const counterOnly = process.argv.includes('--countercheck');
for (const mode of counterOnly ? [] : ['33-prozent', 'testament', 'minus30', 'plus30']) {
    const inputs = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    if (mode === '33-prozent') {
        delete inputs.partnership.testament;
        inputs.partnership.inheritance.muster_martin = 33;
    } else if (mode !== 'testament') {
        const factor = mode === 'minus30' ? .7 : 1.3;
        inputs.partnership.testament.muster_martin.minimum *= factor;
        inputs.partnership.testament.muster_martin.maximumPercent *= factor;
    }
    let failed = 0, technical = 0, taxes = 0, estates = 0, sales = 0, martinFirst = 0, zeroHomeDeath = null;
    const petraEndReal = [], chunks = [];
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: count },
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, index) => start + index) });
        failed += chunk.totals.failCount; technical += chunk.technicalInventory.technicalError; chunks.push(hash(chunk));
        for (const run of chunk.runMeta) {
            const rows = run.logDataRows || [], death = rows.find(row => row.inheritance);
            for (const row of rows) if (row.immobilien_notverkauf) sales += row.immobilienverkauf_personen?.length || 0;
            if (!death) continue;
            taxes += death.erbschaftsteuer; estates++;
            if (death.inheritance.deceasedProfileId !== 'muster_martin') continue;
            martinFirst++;
            const last = rows.findLast(row => row.financiallyEvaluable);
            petraEndReal.push(run.failed ? 0 : last ? last.portfolio_total_end / (last.inflation_factor_cum * (1 + last.inflation / 100)) : 0);
            if (!zeroHomeDeath && death.immobilien_wert_end === 0) zeroHomeDeath = { runIndex: run.index, year: death.jahr };
        }
        console.log(`${mode}: ${start + size}/${count}`);
    }
    results[mode] = { inputHash: hash(inputs), chunks, evaluable: count - technical, technical, coveredPct: 100 * (count - technical - failed) / (count - technical),
        ruin: failed, petraAfterMartinPaths: martinFirst, petraEndRealP10: quantile(petraEndReal, .1), petraEndRealMedian: quantile(petraEndReal, .5),
        inheritanceEvents: estates, meanInheritanceTaxNominal: taxes / estates, emergencyHomeSales: sales, zeroHomeDeath };
}
const report = counterOnly ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : { testDate: '2026-10-23', parameters: { ...parameters, anzahl: count },
    metricBasis: 'Petras letztes Geldvermögen vor ihrem Tod bzw. Horizontende, real in Startkaufkraft; nur Martin-zuerst-Pfade, bei Ruin 0. Steuer nominal über alle Erbfälle. Notverkäufe zählen Immobilien.',
    multipliers: Object.fromEntries([60, 70, 80].map(age => [age, lifetimeUseMultiplier(age)])), results };
report.counterchecks = [];
for (const [startYear, endYear] of [[2000, 2025], [1930, 1964]]) for (const mode of ['33-prozent', 'testament']) {
    const inputs = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    if (mode === '33-prozent') { delete inputs.partnership.testament; inputs.partnership.inheritance.muster_martin = 33; }
    // Der normale Backtest zieht keine Todesfälle. Diese Gegenprobe setzt den Tod
    // ausdrücklich im elften Jahr und verwendet ansonsten den echten Jahrespfad.
    const result = runHistoricalBacktest({ inputs, period: { startYear, endYear },
        historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
        simulateYear: (state, current, data, index) => simulateOneYear(state, current, data, index, null, 0,
            index >= 10 ? { p1Alive: false, p2Alive: true } : null, 1, EngineAPI),
        computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon, totalPortfolio: portfolioTotal, breakOnRuin: true });
    const estate = result.rows.find(entry => entry.row.inheritance)?.row.inheritance;
    report.counterchecks.push({ mode, period: `${startYear}-${endYear}`, deathYear: startYear + 10, outcome: result.outcome.kind,
        rowCount: result.rows.length, finalMoney: result.rows.at(-1)?.row.portfolio_total_end, tax: estate?.tax, hash: hash(result) });
}
writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([mode, { chunks, ...metrics }]) => [mode, metrics]))));
