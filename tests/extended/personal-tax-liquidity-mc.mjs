/** Synthetic FR-16 MC evidence; no baseline checkout, storage or network needed. */
import assert from 'node:assert/strict';
import { EngineAPI } from '../../engine/index.mjs';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { normalizeWidowOptions } from '../../app/simulator/simulator-sweep-utils.js';
import { dynamicFlexPresetPatch, DYNAMIC_FLEX_OPTIONS } from '../../app/shared/dynamic-flex-presets.js';
import { inputs, records } from './parity-replay-fixture.mjs';

const unchanged = JSON.stringify({ inputs, records });
const parameters = { anzahl: 100, maxDauer: 26, blockSize: 3, seed: 12345,
    methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const scenarios = [];
for (const [key, label] of DYNAMIC_FLEX_OPTIONS.filter(([key]) => key !== 'custom')) {
    const input = { ...structuredClone(inputs), ...dynamicFlexPresetPatch(key) };
    const result = await runMonteCarloChunk({ inputs: input, monteCarloParams: parameters,
        widowOptions: normalizeWidowOptions(input.widowOptions), useCapeSampling: true, engine: EngineAPI });
    assert.equal(result.financialMetricsValid, true, `${label}: financially evaluable`);
    assert.equal(result.technicalInventory.technicalError, 0, `${label}: no technical errors`);
    assert.equal(result.technicalInventory.financiallyEvaluable, 100, `${label}: every run evaluable`);
    const successes = result.totals.outcomeAllDeadCount + result.totals.outcomeHorizonExhaustedCount;
    assert.equal(successes + result.totals.outcomeRuinCount, 100, `${label}: complete outcome inventory`);
    scenarios.push({ key, label, successes, requested: 100, percent: successes,
        ruin: result.totals.outcomeRuinCount, allDead: result.totals.outcomeAllDeadCount,
        horizonExhausted: result.totals.outcomeHorizonExhaustedCount,
        technicallyFailed: result.technicalInventory.technicalError });
}
assert.equal(JSON.stringify({ inputs, records }), unchanged, 'Synthetic source records remain unchanged');
console.log(JSON.stringify({ schemaVersion: 'PersonalTaxLiquidityMCV1', household: 'Max und Erika Mustermann',
    node: process.version, platform: process.platform, parameters, useCapeSampling: true,
    successDefinition: 'all_dead_or_horizon_exhausted_without_prior_ruin', scenarios }, null, 2));
