import { createMusterHaushaltRecords } from '../../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../../app/balance/balance-input-storage.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../../app/simulator/simulator-profile-inputs.js';
import { runHistoricalBacktest } from '../../app/simulator/historical-backtest-runner.js';
import { createHistoricalBacktestContractProvider, HISTORICAL_TEMPORAL_CONVENTION_ID } from '../../app/simulator/historical-backtest-contract.js';
import { initializePortfolio } from '../../app/simulator/simulator-portfolio.js';
import { computeAdjPctForYear } from '../../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../../app/simulator/dynamic-flex-runner-horizon.js';
import { portfolioTotal } from '../../app/simulator/simulator-results.js';
import { simulateOneYear } from '../../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../../engine/index.mjs';
import { hashParityReplayValue } from '../../app/simulator/parity-replay-contract.js';

export const records = createMusterHaushaltRecords('2026-01-01');
export const recordBytes = JSON.stringify(records);
const storage = { getItem: key => records[key] ?? null,
    setItem() { throw new Error('READ_ONLY_STORAGE'); }, removeItem() { throw new Error('READ_ONLY_STORAGE'); } };
const balance = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
const registry = JSON.parse(records.rs_profiles_v1);
const profiles = Object.entries(registry.profiles).map(([profileId, entry]) => ({ profileId, name: entry.meta.name,
    inputs: buildSimulatorInputsFromProfileData(entry.data, { referenceYear: 2026, planValues: balance.householdPlan.entry.values }) }));
export const inputs = combineSimulatorProfiles(profiles, records.rs_current_profile, { planValues: balance.householdPlan.entry.values }).combined;
export const provider = createHistoricalBacktestContractProvider();
export const period = { startYear: 2000, endYear: 2002 };
export const source = {
    // Synthetic source identity for contract tests. Benchmark supplies an actual source-content hash.
    sourceHash: hashParityReplayValue({ fixture: 'synthetic-parity-collector-source-v1' }),
    engineVersion: EngineAPI.getVersion(),
    datasetHash: hashParityReplayValue(provider.preparePeriod(period)),
    temporalConventionId: HISTORICAL_TEMPORAL_CONVENTION_ID
};

export function runFixture({ collector = null, simulate = simulateOneYear, engine = EngineAPI,
    input = inputs, selectedPeriod = period } = {}) {
    return runHistoricalBacktest({ inputs: input, period: selectedPeriod, historicalDataProvider: provider,
        initializePortfolio, computeAdjustmentPct: computeAdjPctForYear,
        resolveHorizon: resolveDynamicFlexRunnerHorizon, totalPortfolio: portfolioTotal, breakOnRuin: true,
        simulateYear(state, adjustedInputs, yearData, yearIndex) {
            return simulate(state, adjustedInputs, yearData, yearIndex, null, 0, null, 1, engine, collector);
        }
    });
}
