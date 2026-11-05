import { historicalSurvivorInput, historicalSurvivorNeeds } from './historical-survivor-inputs.mjs';
// Synthetischer Seitenweg und reproduzierbare Messung, keine Nutzerdaten.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EngineAPI } from '../../engine/index.mjs';
import { createMusterHaushaltRecords } from '../../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../../app/shared/persistence-facade.js';
import { setAppTestDate } from '../../app/shared/app-clock.js';
import { simulatorDocument } from '../simulator-page-fixture.mjs';
import { initInputPersistence } from '../../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../../app/simulator/simulator-main-dynamic-flex.js';
import { initSimulatorProfileSelection } from '../../app/simulator/simulator-main-profiles.js';
import { initSimulatorPlanTrial } from '../../app/simulator/simulator-plan-trial.js';
import { getCommonInputs, initializePortfolio } from '../../app/simulator/simulator-portfolio.js';
import { prepareHistoricalDataOnce } from '../../app/simulator/simulator-engine-helpers.js';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { simulateOneYear } from '../../app/simulator/simulator-engine-direct.js';
import { runHistoricalBacktest } from '../../app/simulator/historical-backtest-runner.js';
import { createHistoricalBacktestContractProvider } from '../../app/simulator/historical-backtest-contract.js';
import { computeAdjPctForYear } from '../../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../../app/simulator/dynamic-flex-runner-horizon.js';
import { portfolioTotal } from '../../app/simulator/simulator-results.js';
import { INCOME_KEY, writeIncome } from '../../app/profile/profile-income.js';
import { quantile } from '../../app/simulator/simulator-utils.js';

export const parameters = { anzahl: 2000, maxDauer: 35, blockSize: 3, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function measurementInputs(salary = 0, householdId = undefined, testDate = '2026-10-16', variantId = 'grund') {
    const records = createMusterHaushaltRecords(testDate, householdId, variantId);
    if (salary) {
        const registry = JSON.parse(records.rs_profiles_v1);
        const entries = [{ id: 'gehalt', art: 'sonstige', bezeichnung: 'Gehalt', betragMonat: salary,
            ab: null, bis: '2030-12', anpassung: 'keine' }];
        registry.profiles.muster_a.data[INCOME_KEY] = writeIncome(entries);
        if (registry.activeProfileId === 'muster_a') records[INCOME_KEY] = writeIncome(entries);
        records.rs_profiles_v1 = JSON.stringify(registry);
    }
    const store = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'EK-1b memory', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    setAppTestDate(testDate);
    const doc = simulatorDocument();
    globalThis.document = doc;
    globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
    initInputPersistence(); initDynamicFlexControls({ enableLocalPersistence: false });
    initSimulatorProfileSelection(); initSimulatorPlanTrial();
    if (window.__profileRecoveryBlocker) throw new Error(JSON.stringify(window.__profileRecoveryBlocker));
    prepareHistoricalDataOnce();
    return getCommonInputs();
}
export function backtest(inputs, startYear = 2000, endYear = 2025) {
    return runHistoricalBacktest({ inputs, period: { startYear, endYear },
        historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
        simulateYear: (...args) => simulateOneYear(...args, null, 0, null, 1, EngineAPI),
        computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon,
        totalPortfolio: portfolioTotal, breakOnRuin: true });
}
export async function measure(salary = 0, count = 2000, { historicalSurvivor = false } = {}) {
    const current = await measurementInputs(salary);
    const inputs = historicalSurvivor ? historicalSurvivorInput(current) : current;
    const historical = backtest(inputs);
    const chunk = await runMonteCarloChunk({ inputs: historicalSurvivor ? historicalSurvivorNeeds(inputs) : inputs, monteCarloParams: { ...parameters, anzahl: count },
        widowOptions: inputs.widowOptions, useCapeSampling: false,
        runRange: { start: 0, count }, engine: EngineAPI });
    return { inputs, historical, chunk };
}
export async function measureMetrics(salary = 0, count = 2000) {
    const inputs = await measurementInputs(salary), real = [], nominalAtFive = [], realAtFive = [], chunks = [];
    let failed = 0, technicalError = 0;
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: { ...parameters, anzahl: count },
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, i) => start + i), engine: EngineAPI });
        chunks.push(hash(chunk));
        real.push(...chunk.pathSummaries.finalValueRealEur);
        failed += chunk.totals.failCount; technicalError += chunk.technicalInventory.technicalError;
        for (const run of chunk.runMeta) {
            const row = run.logDataRows.find(row => row.jahr === 5 && row.financiallyEvaluable === true);
            if (!row) continue;
            const wealth = row.wertAktien + row.wertGold + row.liquiditaet + (row.health_bucket_end || 0);
            nominalAtFive.push(wealth);
            realAtFive.push(wealth / (row.inflation_factor_cum * (1 + row.inflation / 100)));
        }
        console.log(`Gehalt ${salary}: ${start + size}/${count}`);
    }
    return { parameters: { ...parameters, anzahl: count }, salary, salaryPeriod: '2026-01 bis einschließlich 2030-12',
        inputsHash: hash(inputs), chunks, technicalError, evaluable: count - technicalError,
        successPct: (count - technicalError - failed) / (count - technicalError) * 100,
        terminalRealP10: quantile(real, .1), terminalRealP50: quantile(real, .5),
        salaryEndYear: { financialYearCount: nominalAtFive.length, nominalP50: quantile(nominalAtFive, .5), realP50: quantile(realAtFive, .5) },
        counterchecks: [ [2000, 2025], [1965, 1999] ].map(([start, end]) => {
            const result = backtest(inputs, start, end), last = result.rows.at(-1);
            if (result.outcome.kind !== 'completed') throw new Error(`Gegenprobe ${start}–${end}: ${result.outcome.kind}`);
            return { period: `${start}–${end}`, hash: hash(result), rowCount: result.rows.length,
                lastWealth: last ? last.wertAktien + last.wertGold + last.liquiditaet : null };
        }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const salary = Number(process.argv[3] || 0);
    if (process.argv[5] === 'metrics') {
        const result = await measureMetrics(salary, Number(process.argv[4] || 2000));
        writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result));
        process.exit(0);
    }
    const { inputs, historical, chunk } = await measure(salary, Number(process.argv[4] || 2000));
    const result = { parameters, salary, inputsHash: hash(inputs), backtestHash: hash(historical), monteCarloHash: hash(chunk),
        chunkKeys: Object.keys(chunk), exampleRun: chunk.runMeta?.[0],
        summary: Object.fromEntries(Object.entries(chunk).filter(([key]) => !['runMeta', 'results'].includes(key))) };
    writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ inputsHash: result.inputsHash, backtestHash: result.backtestHash, monteCarloHash: result.monteCarloHash, chunkKeys: result.chunkKeys }));
}
