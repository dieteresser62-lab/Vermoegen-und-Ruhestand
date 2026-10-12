import { planTrialContextFor } from './simulator-plan-trial.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { overviewScope, storeSimulationSummary } from '../overview/overview-storage.js';
import { FINGERPRINT_VERSION, fingerprint, sourceFingerprint } from '../overview/overview-simulation-summary.js';
import { effectiveRunAssumptions } from './simulator-run-assumptions.js';
import { personDataContextFor } from './simulator-person-overrides.js';
import { quantile } from './simulator-utils.js';

const generations = new Map();
const workshopProvenanceByInputs = new WeakMap();
export const workshopProvenanceFor = inputs => workshopProvenanceByInputs.get(inputs) || null;
/** Nur ein vorhandener Laufbeleg darf den isolierten Anzeigeklon begleiten. */
export function cloneWorkshopInputsForDisplay(inputs) {
    const clone = structuredClone(inputs || {});
    const provenance = workshopProvenanceFor(inputs);
    if (provenance) workshopProvenanceByInputs.set(clone, provenance);
    return clone;
}
const numeric = value => Number.isFinite(value) ? value : null;
function liveValues(storage) {
    return Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean)
        .map(key => [key, storage.getItem(key)]));
}

/** Eingefrorene Quellenbasis am tatsächlichen Laufbeginn, vor fachlicher Rechnung. */
export function beginSimulationSummary(kind, inputs, settings = {}, { storage = persistenceStorage, workshopProvenance = null } = {}) {
    try {
        // Ein neuer MC-Start darf keinen Beleg eines früheren Starts wiederverwenden.
        if (kind === 'montecarlo' && inputs && typeof inputs === 'object') workshopProvenanceByInputs.delete(inputs);
        const planDeviationApplied = Boolean(planTrialContextFor(inputs)?.deviationApplied);
        const activeId = storage.getItem('rs_current_profile'), registry = loadProfileRegistry(storage).value;
        if (!registry?.profiles[activeId] || PersistenceFacade.hasSyncWriteBlocks() || globalThis.window?.__profileRecoveryBlocker) return null;
        const ids = Object.keys(registry.profiles).filter(id => registry.profiles[id].meta.belongsToHousehold !== false);
        const scope = overviewScope(ids.length === 1 && ids[0] === activeId ? 'single' : 'household', ids);
        const liveData = liveValues(storage);
        const source = sourceFingerprint({ registry, activeId, liveData, scope, kind });
        if (!source) return null;
        if (kind === 'montecarlo' && !planDeviationApplied && inputs && typeof inputs === 'object') {
            const workshopSource = sourceFingerprint({ registry, activeId, liveData, scope, kind: 'workshop' });
            if (workshopSource) workshopProvenanceByInputs.set(inputs, Object.freeze({
                expectedProfileId: activeId, fingerprintVersion: FINGERPRINT_VERSION,
                scope: Object.freeze({ ...scope, ids: Object.freeze([...scope.ids]) }), sourceFingerprint: workshopSource
            }));
        }
        if (kind === 'workshop' && (!workshopProvenance
            || workshopProvenance.fingerprintVersion !== FINGERPRINT_VERSION
            || workshopProvenance.expectedProfileId !== activeId
            || fingerprint(workshopProvenance.scope) !== fingerprint(scope)
            || workshopProvenance.sourceFingerprint !== source)) return null;
        const generation = Symbol(kind);
        generations.set(kind, generation);
        return Object.freeze({ kind, scope, planDeviationApplied, expectedProfileId: activeId, sourceFingerprint: kind === 'workshop' ? workshopProvenance.sourceFingerprint : source,
            fingerprintVersion: FINGERPRINT_VERSION, runFingerprint: fingerprint(effectiveRunAssumptions(kind === 'workshop' ? 'backtest' : kind, inputs, settings)),
            deviationApplied: kind === 'workshop' || Boolean(personDataContextFor(inputs)?.deviationApplied), generation });
    } catch (error) { console.error('Ausgangsbasis der Ergebnisablage nicht verfügbar:', error); return null; }
}

export function buildSimulationSummary(context, result, { completedAt = new Date(), requestedRuns, preferredVariantId } = {}) {
    if (!context || context.planDeviationApplied) return null;
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
        statement = 'Floor gedeckt bis Laufende';
        priceBasis = 'nominal, am Laufende, ohne Pflegereserve';
    } else if (context.kind === 'workshop') {
        const candidates = (result?.variantOrder || []).filter(id => result.pairwise?.some(pair => pair.variantId === id && pair.comparable));
        const id = candidates.includes(preferredVariantId) ? preferredVariantId : candidates.at(-1);
        const variant = result?.variants?.find(item => item.variantId === id);
        const outcomeLabels = { ruin: 'Floor nicht gedeckt', all_dead: 'Haushalt verstorben', horizon_exhausted: 'Zeitraum überstanden' };
        if (!variant || !outcomeLabels[variant.terminalStatus]) return null;
        const baseline = result.variants.find(item => item.variantId === 'baseline');
        statement = `${String(variant.label || 'Alternative').slice(0, 65)} gegen ${String(baseline?.label || 'Baseline').slice(0, 45)}: ${outcomeLabels[variant.terminalStatus]}`.slice(0, 180).replace(/[\x00-\x1f]/g, ' ');
        metrics = { endWealthReal: numeric(variant.summary?.finalValueRealEur) };
        priceBasis = 'hypothetischer Vergleich auf einem fixierten Pfad · real, Preise zum Pfadstart';
    } else return null;
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
