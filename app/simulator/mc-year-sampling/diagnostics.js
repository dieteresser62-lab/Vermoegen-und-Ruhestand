/** @import {Sampler,SamplingConfig,SamplingPublicContract,SamplingResolution,SamplingDiagnostics,HistoricalYear,SimulatorInputs,SimulationState,Random,StressContext} from '../../../typcheck/rechenkern' */
import { MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION, MONTE_CARLO_SAMPLING_CONTRACT_VERSION, MONTE_CARLO_METHODS } from './schema.js';

const SAMPLING_TAIL_COUNTER_FIELDS = Object.freeze([
    'runsActiveCount',
    'runsAppliedCount',
    'eventCount',
    'evaluatedYears',
    'activeYears',
    'appliedYears',
    'skippedHistoricalCrisisYears'
]);

/** @param {Record<string,number>} target
 * @param {string|number} key */
function incrementCounter(target, key, amount = 1) {
    const normalizedKey = String(key);
    target[normalizedKey] = (target[normalizedKey] || 0) + amount;
}

/** @param {Record<string,number>|null|undefined} values */
function sumCounterMap(values) {
    return Object.values(values || {}).reduce((sum, value) => sum + value, 0);
}

/** @param {unknown} values
 * @param {string} label */
function assertCounterMap(values, label) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: ${label} must be an object.`);
    }
    for (const [key, value] of Object.entries(values)) {
        if (!key || !Number.isSafeInteger(value) || value < 0) {
            throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: ${label}.${key} must be a non-negative integer.`);
        }
    }
}

/** @param {{contract:SamplingPublicContract;dataVersion?:Record<string,unknown>}} options
 * @returns {SamplingDiagnostics} */
export function createMonteCarloSamplingDiagnosticsV1({ contract, dataVersion } = /** @type {NonNullable<Parameters<typeof createMonteCarloSamplingDiagnosticsV1>[0]>} */ ({})) {
    if (contract?.schemaVersion !== MONTE_CARLO_SAMPLING_CONTRACT_VERSION) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: sampling contract is missing or incompatible.`);
    }
    return {
        schemaVersion: MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION,
        contract: {
            ...contract,
            ignoredOptions: [...contract.ignoredOptions],
            warnings: [...contract.warnings],
            ...(Array.isArray(contract.drawableRegimes)
                ? { drawableRegimes: [...contract.drawableRegimes] }
                : {}),
            precedence: [...contract.precedence]
        },
        dataVersion: { ...(dataVersion || {}) },
        requestedRuns: 0,
        sampledYears: 0,
        initialStartYearCounts: {},
        historicalYearCounts: {},
        sourceCounts: {},
        regimeCounts: {},
        stationaryRestartCounts: {
            initial: 0,
            random: 0,
            data_end: 0
        },
        tailRisk: Object.fromEntries(SAMPLING_TAIL_COUNTER_FIELDS.map(field => [field, 0]))
    };
}

/** @param {SamplingDiagnostics} diagnostics
 * @param {HistoricalYear} yearData */
export function recordMonteCarloSamplingStartV1(diagnostics, yearData) {
    diagnostics.requestedRuns += 1;
    incrementCounter(diagnostics.initialStartYearCounts, yearData?.jahr ?? 'unknown');
    return diagnostics;
}

/** @param {SamplingDiagnostics} diagnostics
 * @param {{yearData:HistoricalYear;source:string;stationaryRestartReason?:string|null}} options */
export function recordMonteCarloSampledYearV1(diagnostics, {
    yearData,
    source,
    stationaryRestartReason = null
} = /** @type {NonNullable<Parameters<typeof recordMonteCarloSampledYearV1>[1]>} */ ({})) {
    diagnostics.sampledYears += 1;
    incrementCounter(diagnostics.historicalYearCounts, yearData?.jahr ?? 'unknown');
    incrementCounter(diagnostics.sourceCounts, source || 'unknown');
    incrementCounter(diagnostics.regimeCounts, yearData?.regime || 'UNKNOWN');
    if (stationaryRestartReason && stationaryRestartReason in diagnostics.stationaryRestartCounts) {
        diagnostics.stationaryRestartCounts[stationaryRestartReason] += 1;
    }
    return diagnostics;
}

/** @param {SamplingDiagnostics} diagnostics
 * @param {Record<string,number>} totals */
export function finalizeMonteCarloSamplingDiagnosticsV1(diagnostics, totals = {}) {
    diagnostics.tailRisk = {
        runsActiveCount: Number(totals.tailRiskRunsActiveCount) || 0,
        runsAppliedCount: Number(totals.tailRiskRunsAppliedCount) || 0,
        eventCount: Number(totals.tailRiskEventCount) || 0,
        evaluatedYears: Number(totals.tailRiskEvaluatedYears) || 0,
        activeYears: Number(totals.tailRiskActiveYears) || 0,
        appliedYears: Number(totals.tailRiskAppliedYears) || 0,
        skippedHistoricalCrisisYears: Number(totals.tailRiskSkippedHistoricalCrisisYears) || 0
    };
    return assertMonteCarloSamplingDiagnosticsV1(diagnostics);
}

/** @param {SamplingDiagnostics} diagnostics
 * @param {{expectedRuns?:number|null}} options */
export function assertMonteCarloSamplingDiagnosticsV1(diagnostics, { expectedRuns = null } = {}) {
    if (!diagnostics || diagnostics.schemaVersion !== MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: diagnostics are missing or incompatible.`);
    }
    if (diagnostics.contract?.schemaVersion !== MONTE_CARLO_SAMPLING_CONTRACT_VERSION) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: contract is missing or incompatible.`);
    }
    if (!MONTE_CARLO_METHODS.has(diagnostics.contract.method)) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: method is invalid.`);
    }
    for (const field of /** @type {('requestedRuns'|'sampledYears')[]} */ (['requestedRuns', 'sampledYears'])) {
        if (!Number.isSafeInteger(diagnostics[field]) || diagnostics[field] < 0) {
            throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: ${field} must be a non-negative integer.`);
        }
    }
    if (expectedRuns !== null && diagnostics.requestedRuns !== expectedRuns) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: requestedRuns does not match the chunk range.`);
    }
    for (const [label, values] of Object.entries({
        initialStartYearCounts: diagnostics.initialStartYearCounts,
        historicalYearCounts: diagnostics.historicalYearCounts,
        sourceCounts: diagnostics.sourceCounts,
        regimeCounts: diagnostics.regimeCounts,
        stationaryRestartCounts: diagnostics.stationaryRestartCounts,
        tailRisk: diagnostics.tailRisk
    })) {
        assertCounterMap(values, label);
    }
    if (sumCounterMap(diagnostics.initialStartYearCounts) !== diagnostics.requestedRuns) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: initial start counts must classify every run.`);
    }
    if (sumCounterMap(diagnostics.historicalYearCounts) !== diagnostics.sampledYears
        || sumCounterMap(diagnostics.sourceCounts) !== diagnostics.sampledYears
        || sumCounterMap(diagnostics.regimeCounts) !== diagnostics.sampledYears) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: sampled-year counters are inconsistent.`);
    }
    if (!diagnostics.dataVersion || typeof diagnostics.dataVersion !== 'object') {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: dataVersion must be an object.`);
    }
    return diagnostics;
}

/** @param {SamplingDiagnostics} target
 * @param {SamplingDiagnostics} source */
export function mergeMonteCarloSamplingDiagnosticsV1(target, source) {
    assertMonteCarloSamplingDiagnosticsV1(target);
    assertMonteCarloSamplingDiagnosticsV1(source);
    if (JSON.stringify(target.contract) !== JSON.stringify(source.contract)
        || JSON.stringify(target.dataVersion) !== JSON.stringify(source.dataVersion)) {
        throw new TypeError(`${MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION}: chunks use incompatible sampling contracts or data versions.`);
    }
    target.requestedRuns += source.requestedRuns;
    target.sampledYears += source.sampledYears;
    for (const field of /** @type {('initialStartYearCounts'|'historicalYearCounts'|'sourceCounts'|'regimeCounts'|'stationaryRestartCounts'|'tailRisk')[]} */ (['initialStartYearCounts', 'historicalYearCounts', 'sourceCounts', 'regimeCounts', 'stationaryRestartCounts', 'tailRisk'])) {
        for (const [key, value] of Object.entries(source[field])) incrementCounter(target[field], key, value);
    }
    return assertMonteCarloSamplingDiagnosticsV1(target);
}
