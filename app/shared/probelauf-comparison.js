import { overviewScope } from '../overview/overview-storage.js';
import { readSimulationRecord, simulationEntryKey, OVERVIEW_SIMULATION_KEY, fingerprint } from '../overview/overview-simulation-summary.js';
import { planScope } from '../profile/household-plan.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { annualEngineLoader } from './annual-engine-loader.js';
import { probelaufRecordContext, probelaufDomainChecksum, summarizeProbelaufChanges } from './probelauf-records.js';

/** Balance-Bausteine erst beim Öffnen laden: Statisch eingebunden schließen sie über den Seitenrahmen einen Ladezyklus (Balance.html). */
export async function loadProbelaufBalance() {
    const [input, household, action] = await Promise.all([import('../balance/balance-input-storage.js'),
        import('../balance/balance-main-profilverbund.js'), import('../balance/balance-action-summary.js')]);
    return { buildBalanceEngineInputFromStorage: input.buildBalanceEngineInputFromStorage,
        evaluateStoredAnnualHousehold: household.evaluateStoredAnnualHousehold, summarizeBalanceAction: action.summarizeBalanceAction };
}

export function probelaufMonteCarloRuns(records) {
    const { registry, liveData } = probelaufRecordContext(records);
    return [...new Set([liveData, ...Object.values(registry.profiles).map(profile => profile.data)].flatMap(data =>
        Object.values(readSimulationRecord(data?.[OVERVIEW_SIMULATION_KEY]).entries).filter(entry => entry.kind === 'montecarlo').map(fingerprint)))];
}

/** Fehlende Startbelege werden nie nachträglich als unverändert ausgegeben. */
export function probelaufTransferability(state, realRecords) {
    if (state?.source === 'demo') return { eligible: false, reason: 'demo' };
    if (state?.hasDateJump || state?.testDate != null) return { eligible: false, reason: 'date' };
    if (!state?.realDomainChecksum || state.realDomainChecksum !== probelaufDomainChecksum(realRecords)) return { eligible: false, reason: 'real-changed' };
    return { eligible: true, reason: null };
}

export const probelaufEndNeedsComparison = state => state?.source !== 'demo' && !state?.hasDateJump && state?.testDate == null;

/** Vorschau aus isolierten Rohrecords; der Adapter bietet absichtlich keinen Schreibweg. */
export function projectProbelaufComparison(records, { now = new Date(), state = null, play = false, engineApi, balance, calculationError } = {}) {
    const context = probelaufRecordContext(records), { registry, activeId, liveData } = context;
    const ids = Object.keys(registry.profiles).filter(id => registry.profiles[id].meta?.belongsToHousehold !== false);
    if (!ids.length && registry.profiles[activeId]) ids.push(activeId);
    const scope = overviewScope(ids.length === 1 && ids[0] === activeId ? 'single' : 'household', ids);
    const data = id => id === activeId ? liveData : registry.profiles[id]?.data || {};
    const year = now.getFullYear();
    // Personenreader nutzen die Registry. Liveänderungen des aktiven Profils
    // deshalb auch dort überlagern, ausschließlich in dieser privaten Kopie.
    const sources = { ...records, ...(records.rs_profiles_v1 ? { rs_profiles_v1: JSON.stringify(registry) } : {}) };
    const storage = { getItem: key => sources[key] ?? null };
    const receiptScope = scope && planScope(ids.some(id => registry.profiles[id].meta?.belongsToHousehold !== false) ? 'household' : 'single', ids);
    const receipt = receiptScope ? readAnnualPlanRecord({ year, scope: receiptScope, storage }) : null;
    const runs = scope ? ids.map(id => readSimulationRecord(data(id)[OVERVIEW_SIMULATION_KEY]).entries[simulationEntryKey(scope, 'montecarlo')]) : [];
    let monteCarlo = runs.length && runs.every(entry => entry && fingerprint(entry) === fingerprint(runs[0])) ? runs[0] : null;
    // Ein mitkopierter Lauf ist kein Lauf innerhalb dieser Spielsitzung.
    if (play && monteCarlo && (!state?.initialMonteCarloRuns || state.initialMonteCarloRuns.includes(fingerprint(monteCarlo)))) monteCarlo = null;
    const result = { year, scope, monthlyBudget: null, action: null, liquidity: null, calculatedAt: null,
        status: 'pending', error: null,
        fixedPlan: receipt?.adopted ? { ...structuredClone(receipt.adopted), committedAt: receipt.committedAt } : null,
        monteCarlo: monteCarlo ? { successPct: monteCarlo.metrics.successPct, completedAt: monteCarlo.completedAt } : null };
    if (!engineApi && !calculationError) return result;
    try {
        if (calculationError) throw calculationError;
        if (!scope) throw new Error('Für die Vorschau fehlt ein berechenbarer Haushalt.');
        if (!balance) throw new Error('Die Balance-Bausteine für die Vorschau sind nicht geladen.');
        const { buildBalanceEngineInputFromStorage, evaluateStoredAnnualHousehold, summarizeBalanceAction } = balance;
        const calculation = buildBalanceEngineInputFromStorage({ storage, referenceYear: year });
        const { inputData, profiles, profileId, engineLastState, householdPlan } = calculation;
        const multi = profiles.length > 1 || profiles.length === 1 && profiles[0].profileId !== profileId;
        const runs = multi ? evaluateStoredAnnualHousehold(inputData, profiles, engineLastState,
            { engineApi, withdrawalMode: householdPlan.entry?.values.householdWithdrawalMode || storage.getItem('household_withdrawal_mode') || 'tax_optimized' }) : null;
        const model = runs?.householdResult || engineApi.simulateSingleYear(calculation.engineInput, engineLastState);
        if (model?.error) throw model.error;
        const monthlyBudget = model?.ui?.spending?.monatlicheEntnahme + Math.round(inputData.renteMonatlich * 12) / 12;
        const liquidity = model?.ui?.liquiditaet?.deckungVorher;
        if (!Number.isFinite(monthlyBudget) || !Number.isFinite(liquidity) || !model.ui.action) throw new Error('Die Vorschau liefert kein vollständiges Ergebnis.');
        const action = summarizeBalanceAction(model.ui.action, model.ui.action, runs?.map(run => ({ action: run.ui.action })));
        return { ...result, status: 'ready', monthlyBudget, action, liquidity, calculatedAt: now.toISOString() };
    } catch (error) {
        return { ...result, status: 'error', error: error.message || String(error) };
    }
}

export function buildProbelaufEndReview({ state, realRecords, playRecords, now = new Date(), engineApi, balance, calculationError }) {
    const comparison = probelaufEndNeedsComparison(state);
    const real = comparison ? projectProbelaufComparison(realRecords, { now, engineApi, balance, calculationError }) : null;
    const play = projectProbelaufComparison(playRecords, { now, state, play: true, engineApi, balance, calculationError });
    return { state, real, play, playDomainChecksum: probelaufDomainChecksum(playRecords), changes: comparison ? summarizeProbelaufChanges(realRecords, playRecords) : null,
        madeChanges: state?.initialDomain ? summarizeProbelaufChanges({}, playRecords, { beforeDomain: state.initialDomain }) : null,
        transfer: probelaufTransferability(state, realRecords),
        budgetDelta: real?.monthlyBudget != null && play.monthlyBudget !== null ? play.monthlyBudget - real.monthlyBudget : null };
}

/** Engine erst für den geöffneten Vergleich laden; auch Ladefehler bleiben sichtbar. */
export async function calculateProbelaufEndReview(options, { engineLoader = annualEngineLoader, balanceLoader = loadProbelaufBalance } = {}) {
    try {
        const [engineApi, balance] = await Promise.all([engineLoader.load(), balanceLoader()]);
        return buildProbelaufEndReview({ ...options, engineApi, balance });
    }
    catch (calculationError) { return buildProbelaufEndReview({ ...options, calculationError }); }
}
