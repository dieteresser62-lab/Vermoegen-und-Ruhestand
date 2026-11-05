// AJ-1: reproduzierbare Vorher-/Nachhermessung nur mit synthetischen Haushalten.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw new Error('Aufruf: node scripts/measure-savings-year.mjs <Quellordner> <Ausgabe.json>');
const load = file => import(pathToFileURL(resolve(root, file)));
const { measurementInputs, parameters } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { projectBalanceFlexTrace } = await load('app/balance/balance-flex-trace.js');
const { createMusterHaushaltRecords } = await load('app/demo/muster-haushalt.js');
const { buildBalanceEngineInputFromStorage } = await load('app/balance/balance-input-storage.js');
const { runHistoricalBacktest } = await load('app/simulator/historical-backtest-runner.js');
const { createHistoricalBacktestContractProvider } = await load('app/simulator/historical-backtest-contract.js');
const { initializePortfolio } = await load('app/simulator/simulator-portfolio.js');
const { simulateOneYear } = await load('app/simulator/simulator-engine-direct.js');
const { computeAdjPctForYear } = await load('app/simulator/simulator-main-helpers.js');
const { resolveDynamicFlexRunnerHorizon } = await load('app/simulator/dynamic-flex-runner-horizon.js');
const { portfolioTotal } = await load('app/simulator/simulator-results.js');
const { runMonteCarloSimulation } = await load('app/simulator/monte-carlo-runner.js');
const { decidedIncomeFlex } = await load('app/simulator/simulator-fixed-income.js');
const { compileScenario, getDataVersion } = await load('app/simulator/simulator-engine-helpers.js');
const contracts = await load('app/simulator/monte-carlo-contracts.js');
const exports = await load('app/simulator/monte-carlo-export.js');
const historicalExports = await load('app/simulator/historical-backtest-export.js');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const execution = { mode: 'serial', workerCount: 0, timeBudgetMs: null, compareModeRequested: false,
    chunkConfiguration: { strategy: 'single-chunk-v1', minChunkRuns: null, baseTimeoutMs: null, stallTimeoutMs: null } };
const exportedAt = '2026-10-22T12:00:00.000Z';
const result = { parameters, useCapeSampling: false, exportedAt, households: {} };
for (const id of ['max-erika', 'sophie']) {
    const inputs = await measurementInputs(0, id), decisions = [];
    const engine = { ...EngineAPI, simulateSingleYear(input, state, ...options) {
        const decision = EngineAPI.simulateSingleYear(input, state, ...options);
        if (decision.error) throw decision.error;
        decisions.push({ input: structuredClone(input), decision: structuredClone(decision) });
        return decision;
    } };
    const historical = runHistoricalBacktest({ inputs, period: { startYear: 2000, endYear: 2025 },
        historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
        simulateYear: (...args) => simulateOneYear(...args, null, 0, null, 1, engine),
        computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon,
        totalPortfolio: portfolioTotal, breakOnRuin: true,
        engineProvenance: historicalExports.captureHistoricalBacktestEngineProvenance(EngineAPI,
            { schemaVersion: 'RuntimeBuildProvenanceV1', sourceCommit: 'a'.repeat(40),
                sourceTreeStatus: 'clean', provider: 'synthetic_fixture' }) });
    if (historical.outcome.kind !== 'completed') throw new Error(JSON.stringify(historical.outcome));
    const years = decisions.map(({ input, decision }, index) => {
        const view = projectBalanceFlexTrace({ ...decision.ui, input });
        const row = historical.rows[index].row;
        const annualSaving = row.einkuenfte_gespart || 0;
        const simulatorBudget = (input.renteMonatlich * 12 - annualSaving + row.entnahme_effektiv) / 12;
        return { year: 2026 + index, marketYear: 2000 + index, income: input.renteMonatlich,
            balanceBudget: view.budget, balanceSaving: view.saving ?? 0, simulatorBudget,
            simulatorSaving: annualSaving / 12 };
    });
    const mcSavings = new Map();
    const mcEngine = { ...EngineAPI, simulateSingleYear(input, state, ...options) {
        const decision = EngineAPI.simulateSingleYear(input, state, ...options);
        if (!decision.error) {
            const income = input.renteAktiv ? input.renteMonatlich * 12 : 0;
            const flex = decidedIncomeFlex(decision, input.flexBedarf, Math.max(0, input.floorBedarf - income),
                decision.ui.spending.monatlicheEntnahme * 12);
            if (income > input.floorBedarf + flex + 1e-7) {
                const year = 2026 + input.aktuellesAlter - inputs.startAlter;
                mcSavings.set(year, (mcSavings.get(year) || 0) + 1);
            }
        }
        return decision;
    } };
    console.log(`${id}: Backtest erfasst; Monte Carlo ${parameters.anzahl} Pfade`);
    const mc = await runMonteCarloSimulation({ inputs, monteCarloParams: parameters, widowOptions: inputs.widowOptions,
        useCapeSampling: false, engine: mcEngine });
    if (!mc.financialMetricsValid) throw new Error(JSON.stringify(mc.technicalInventory));
    const { scenarioKey } = compileScenario(inputs, inputs.widowOptions, parameters.methode, false, inputs.stressPreset);
    const request = contracts.createMonteCarloRunRequestV1({ inputs, widowOptions: inputs.widowOptions,
        monteCarloParams: parameters, useCapeSampling: false, samplingDiagnostics: mc.samplingDiagnostics,
        dataVersion: getDataVersion(), execution, scenarioKey });
    const runResult = contracts.createMonteCarloRunResultV1({ aggregatedResults: mc.aggregatedResults,
        samplingDiagnostics: mc.samplingDiagnostics, executionDiagnostics: execution, requestedRuns: parameters.anzahl });
    const provenance = exports.captureMonteCarloEngineProvenance(EngineAPI);
    const bytes = [historicalExports.serializeHistoricalBacktestJson(historical, { exportedAt }),
        historicalExports.serializeHistoricalBacktestCsv(historical),
        exports.serializeMonteCarloExportV1(exports.buildMonteCarloExportV1({ request, result: runResult, engine: provenance, exportedAt })),
        exports.serializeMonteCarloExportV2(exports.buildMonteCarloExportV2({ request,
            result: contracts.projectMonteCarloRunResultV2(runResult), engine: provenance, exportedAt }))];
    const records = createMusterHaushaltRecords('2026-10-16', id);
    const probes = Array.from({ length: 6 }, (_, index) => {
        const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 + index });
        const value = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
        if (value.error) throw value.error;
        return value;
    });
    result.households[id] = { inputsSha256: hash(inputs), balanceEngineSha256: hash(probes),
        backtestSha256: hash(historical), mcSha256: hash(mc), exportsSha256: hash(bytes),
        exportSha256: bytes.map(hash), years, mcSavings: Object.fromEntries([...mcSavings].sort(([a], [b]) => a - b)) };
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(`${id}: Messung abgeschlossen`);
}
