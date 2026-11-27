/** @import {JsonRecord} from '../../typcheck/runtime-contracts.js' */
/** @import {SourceFingerprint} from '../../typcheck/simulator-ui.js' */
import { planTrialContextFor } from './simulator-plan-trial.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { overviewScope, storeSimulationSummary } from '../overview/overview-storage.js';
import { FINGERPRINT_VERSION, fingerprint, sourceFingerprint } from '../overview/overview-simulation-summary.js';
import { effectiveRunAssumptions } from './simulator-run-assumptions.js';
import { personDataContextFor } from './simulator-person-overrides.js';
import { projectMinimumFlexDisplay } from './results-metrics.js';
import { quantile } from './simulator-utils.js';
import { appNow } from '../shared/app-clock.js';

const generations = new Map();
const numeric = value => Number.isFinite(value) ? value : null;
function liveValues(storage) {
    return Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean)
        .map(key => [key, storage.getItem(key)]));
}

/** Eingefrorene Quellenbasis am tatsächlichen Laufbeginn, vor fachlicher Rechnung.
 *
 * @param kind Laufart.
 * @param inputs Wirksame Simulationseingaben.
 * @param [settings]
 * @param {object} [options]
 * @param [options.storage]
 * @returns Ergebnis der Operation.
 */
export function beginSimulationSummary(kind, inputs, settings = {}, { storage = persistenceStorage } = {}) {
    try {
        const planDeviationApplied = Boolean(planTrialContextFor(inputs)?.deviationApplied);
        const activeId = storage.getItem('rs_current_profile'), registry = loadProfileRegistry(storage).value;
        if (!registry?.profiles[activeId] || PersistenceFacade.hasSyncWriteBlocks() || globalThis.window?.__profileRecoveryBlocker) return null;
        const ids = Object.keys(registry.profiles);
        const scope = overviewScope(ids.length === 1 && ids[0] === activeId ? 'single' : 'household', ids);
        const liveData = liveValues(storage);
        const source = /** @type {SourceFingerprint} */ (sourceFingerprint)({ registry, activeId, liveData, scope, kind });
        if (!source) return null;
        const generation = Symbol(kind);
        generations.set(kind, generation);
        return Object.freeze({ kind, scope, planDeviationApplied, expectedProfileId: activeId, sourceFingerprint: source,
            fingerprintVersion: FINGERPRINT_VERSION, runFingerprint: fingerprint(effectiveRunAssumptions(kind, inputs, settings)),
            deviationApplied: Boolean(personDataContextFor(inputs)?.deviationApplied), generation });
    } catch (error) { console.error('Ausgangsbasis der Ergebnisablage nicht verfügbar:', error); return null; }
}

/** @param {ReturnType<typeof beginSimulationSummary>} context @param {JsonRecord} result
 * @param {{completedAt?: Date; requestedRuns?: number}} [options] @returns Ergebnisbeleg oder null, wenn keine gültige Ablage möglich ist. */
export function buildSimulationSummary(context, result, { completedAt = appNow(), requestedRuns } = {}) {
    if (!context || context.planDeviationApplied) return null;
    /** @type {Record<string, number | null>} */
    let metrics, statement, priceBasis;
    if (context.kind === 'backtest') {
        if (!['completed', 'ruin'].includes(result?.outcome?.kind)) return null;
        metrics = { startYear: result.request?.startYear, endYear: result.request?.endYear,
            failureYear: numeric(result.ruinYear ?? result.outcome.ruinYear), endWealthReal: numeric(result.metrics?.values?.wealth_end_real_eur) };
        statement = result.outcome.kind;
        priceBasis = 'real, Preise zum Backteststart';
    } else if (context.kind === 'montecarlo') {
        const inventory = result?.outcomeInventory;
        const runs = inventory?.requestedRuns ?? requestedRuns;
        if (inventory?.schemaVersion !== 'MonteCarloOutcomeInventoryV1' || inventory.technical_error !== 0
            || !Number.isInteger(runs) || runs < 1 || (requestedRuns !== undefined && runs !== requestedRuns)
            || ![inventory.ruin, inventory.all_dead, inventory.horizon_exhausted].every(value => Number.isInteger(value) && value >= 0)
            || inventory.ruin + inventory.all_dead + inventory.horizon_exhausted !== runs
            || !Number.isFinite(inventory.floorCoveragePct) || result.financialMetricsValid === false
            || result.batchStatus === 'technical_error') return null;
        const values = result.finalOutcomes?.distribution?.values;
        const complete = Array.isArray(values) && values.length === runs && values.every(Number.isFinite);
        metrics = { runs, covered: inventory.all_dead + inventory.horizon_exhausted, successPct: inventory.floorCoveragePct,
            median: complete ? numeric(quantile(values, .5)) : null, p5: complete ? numeric(quantile(values, .05)) : null };
        statement = 'Grundbedarf gedeckt bis Laufende';
        priceBasis = 'Geldvermögen nominal, am Laufende einschließlich Pflegereserve';
    } else return null;
    const backtest = context.kind === 'backtest';
    const display = projectMinimumFlexDisplay(result, { backtest });
    const block = backtest ? result?.metrics?.minimumFlexRestriction ?? result?.minimumFlexRestriction : result?.minimumFlexRestriction;
    if (display.legacy) {
        const value = backtest ? result?.metrics?.values?.flex_reduction_years_gte_10_pct : result?.cutYearSharePct?.p50;
        if (Number.isFinite(value)) metrics[backtest ? 'legacyFlexCutYearCount' : 'legacyFlexCutYearSharePct'] = value;
    }
    if (block) {
        metrics.minimumFlexStartNominalEur = numeric(block.startMinimumFlexAnnual);
        const path = backtest ? block.path : block;
        metrics.minimumFlexYearSharePct = display.valid ? numeric(backtest ? path.yearSharePct : block.yearSharePctP50) : null;
        if (backtest) {
            metrics.minimumFlexAffectedYearCount = display.valid ? numeric(path.affectedYearCount) : null;
            metrics.minimumFlexObservationCount = display.valid ? numeric(path.observationCount) : null;
        } else metrics.minimumFlexAffectedRunSharePct = display.valid ? numeric(block.affectedRunSharePct) : null;
        metrics.flexPaidMedianNominalEur = display.valid ? numeric(backtest ? path.paidMedianNominalEur : block.paidMedianNominalEurP50) : null;
        metrics.flexDesiredMedianNominalEur = display.valid ? numeric(backtest ? path.desiredMedianNominalEur : block.desiredMedianNominalEurP50) : null;
        metrics.flexPaidMinimumNominalEur = display.valid ? numeric(backtest ? path.paidMinimumNominalEur : block.paidMinimumNominalEurP50) : null;
    }
    const { kind, scope, sourceFingerprint: source, runFingerprint, fingerprintVersion, deviationApplied } = context;
    return { kind, scope, sourceFingerprint: source, runFingerprint, fingerprintVersion, deviationApplied,
        completedAt: completedAt.toISOString(), statement, priceBasis, metrics };
}

/** Ablagefehler ändern weder Fachresultat noch dessen Veröffentlichung. */
function reportSimulationSummaryError(error) {
    // Der Store wirft diesen exakten Sentinel nach seiner bedingten Rücknahme.
    if (error?.message !== 'OVERVIEW_CONTEXT_CHANGED') {
        console.error('Simulationsergebnis konnte nicht dauerhaft gespeichert werden:', error);
    }
    return false;
}

/**
 * @param context
 * @param result Ergebnis des Simulationslaufs.
 * @param {object} [options]
 * @param [dependencies] Injizierbare Abhängigkeiten des Ablaufs.
 * @returns Ergebnis der Operation.
 */
export function completeSimulationSummary(context, result, options = {}, dependencies = {}) {
    const summary = buildSimulationSummary(context, result, options);
    if (!summary) return Promise.resolve(false);
    const callerCurrent = dependencies.isCurrent || (() => true);
    const isCurrent = () => generations.get(context.kind) === context.generation && callerCurrent();
    if (!isCurrent()) return Promise.resolve(false);
    try {
        return Promise.resolve((dependencies.store || storeSimulationSummary)(summary, {
            ...dependencies, expectedProfileId: context.expectedProfileId, isCurrent
        })).catch(reportSimulationSummaryError);
    } catch (error) { return Promise.resolve(reportSimulationSummaryError(error)); }
}
