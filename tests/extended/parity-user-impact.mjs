/** Reproduce the synthetic before/after examples with a complete private pre-PA-A1 copy. */
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dynamicFlexPresetPatch, DYNAMIC_FLEX_OPTIONS } from '../../app/shared/dynamic-flex-presets.js';

const baseline = process.env.PARITY_IMPACT_BASELINE_DIR;
assert(baseline, 'PARITY_IMPACT_BASELINE_DIR must contain the complete pre-PA-A1 sources and tests/extended/.');
const parameters = { anzahl: 100, maxDauer: 26, blockSize: 3, seed: 12345,
    methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };

async function measure(directory) {
    const load = path => import(pathToFileURL(join(directory, path)));
    const fixture = await load('tests/extended/parity-replay-fixture.mjs');
    const { EngineAPI } = await load('engine/index.mjs');
    const { createParityReplayCollector } = await load('app/simulator/parity-replay-collector.js');
    const { createParityCase } = await load('app/balance/parity-case.js');
    const { createParitySequenceSeed } = await load('tests/extended/parity-balance-sequence.mjs');
    const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
    const { normalizeWidowOptions } = await load('app/simulator/simulator-sweep-utils.js');
    const unchanged = JSON.stringify({ inputs: fixture.inputs, records: fixture.records });
    const scenarios = [];
    const period = { startYear: 2000, endYear: 2025 };
    const levels = fixture.provider.preparePeriod(period).initialMarketHistory.levels;
    const history = fixture.provider.preparePeriod(period).initialMarketHistory;
    const scale = 100 / levels.endeVJ.value;
    const market = { ...Object.fromEntries(['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3'].map(key => [key, levels[key].value * scale])),
        ath: history.allTimeHigh.value * scale, jahreSeitAth: history.yearsSinceAllTimeHigh };
    for (const [key, label] of DYNAMIC_FLEX_OPTIONS.filter(([key]) => key !== 'custom')) {
        const inputs = { ...structuredClone(fixture.inputs), ...dynamicFlexPresetPatch(key) };
        const initialRecords = createParitySequenceSeed(fixture.records, dynamicFlexPresetPatch(key), market, inputs.referenceYear);
        const collector = createParityReplayCollector({ source: fixture.source, initialRecords });
        const backtest = fixture.runFixture({ collector, input: inputs, selectedPeriod: period });
        assert.equal(backtest.outcome.kind, 'completed', `${label}: historical path must complete`);
        const log = collector.toLog();
        const decisions = [0, 1].map(index => {
            const value = createParityCase(log, index, { engineApi: EngineAPI });
            const balance = value.measured.balance;
            return { historicalYear: value.historicalYear, logicalPlanningYear: value.logicalPlanningYear,
                simulator: { monthlyBudget: value.expected.newState.lastTotalBudget / 12,
                    monthlyWithdrawal: value.expected.ui.spending.monatlicheEntnahme },
                balance: { monthlyBudget: balance.annualMonthlyBudget,
                    monthlyWithdrawal: balance.decision.ui.spending.monatlicheEntnahme } };
        });
        let success;
        try {
            const mc = await runMonteCarloChunk({ inputs, monteCarloParams: parameters,
                widowOptions: normalizeWidowOptions(inputs.widowOptions), useCapeSampling: true, engine: EngineAPI });
            assert.equal(mc.financialMetricsValid, true, `${label}: no technical MC failures`);
            assert.equal(mc.technicalInventory.financiallyEvaluable, parameters.anzahl);
            const successes = mc.totals.outcomeAllDeadCount + mc.totals.outcomeHorizonExhaustedCount;
            assert.equal(successes + mc.totals.outcomeRuinCount, parameters.anzahl);
            success = { status: 'completed', successes, requested: parameters.anzahl,
                percent: 100 * successes / parameters.anzahl, ruin: mc.totals.outcomeRuinCount,
                allDead: mc.totals.outcomeAllDeadCount, horizonExhausted: mc.totals.outcomeHorizonExhaustedCount };
        } catch (error) {
            success = { status: 'technical_error', percent: null, requested: parameters.anzahl,
                error: error.message, class: error.message.startsWith('SIM_PERSONAL_TAX_LIQUIDITY_SHORTFALL:')
                    ? 'MC_PERSOENLICHE_STEUERDECKUNG' : 'MC_TECHNISCH_UNKLASSIFIZIERT' };
        }
        scenarios.push({ key, label, decisions, success });
        console.error(`${label}: ${success.status === 'completed' ? `${success.successes}/${parameters.anzahl}` : success.error}`);
    }
    assert.equal(JSON.stringify({ inputs: fixture.inputs, records: fixture.records }), unchanged);
    return { records: fixture.records, scenarios };
}

const before = await measure(resolve(baseline));
const after = await measure(resolve('.'));
assert.deepEqual(before.records, after.records, 'Both versions read exactly the same synthetic household.');
const failed = [...before.scenarios, ...after.scenarios].some(scenario => scenario.success.status !== 'completed');
console.log(JSON.stringify({ schemaVersion: 'ParityUserImpactV1', failed, household: 'Max und Erika Mustermann',
    node: process.version, platform: process.platform, parameters, useCapeSampling: true,
    successDefinition: 'all_dead_or_horizon_exhausted_without_prior_ruin',
    historicalPeriod: { startYear: 2000, endYear: 2025 }, initialPlanningYear: 2026,
    before: before.scenarios, after: after.scenarios }, null, 2));
if (failed) process.exitCode = 1;
