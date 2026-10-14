import { appNow } from '../shared/app-clock.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { CONFIG } from './balance-config.js';
import { computeAnnualPlanUpdate, annualRecordStorage, captureAnnualRecords, applyAdoptedPlanPatch } from './balance-annual-storage.js';
import { buildBalanceEngineInputFromStorage } from './balance-input-storage.js';
import { evaluateStoredAnnualHousehold } from './balance-main-profilverbund.js';
import { createBalanceFingerprint, createBalanceCommitBaseFingerprint, persistBalanceUpdate, BALANCE_UPDATE_MODE } from './balance-update-pipeline.js';
import { completeAnnualPeriodCommit } from './balance-annual-period.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, stripBalancePlanInputs } from '../profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY, buildAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { stripBalancePersonInputs } from '../profile/profile-person-data.js';
import { assertCumulativeInflationFactor } from '../../types/cumulative-inflation-contract.js';
import { assertBalanceWealthHistory } from '../../types/wealth-history-contract.js';
import { createProfileOwnedBalanceState } from '../profile/profile-storage.js';
import { setExpensesActiveYear } from './balance-expenses-storage.js';
import { prepareHouseholdCash } from '../profile/profile-cash-update.js';
import { localHistoryDate } from '../tranches/tranchen-history-store.js';
import { createAnnualWealthHistoryEntry, readWealthHistory, upsertAnnualWealthHistory } from '../../types/wealth-history-contract.js';
import { buildBalanceOverviewSummary } from '../overview/overview-model.js';
import { overviewScope, OVERVIEW_SUMMARY_KEY, readOverviewSummaries, summaryEntryKey } from '../overview/overview-storage.js';
import { sourceFingerprint } from '../overview/overview-simulation-summary.js';

/** Beide Rechnungen verwenden dieselbe historische Basis, niemals den Empfehlungs-Neustate. */
export function evaluateAnnualDraft(draft, { engineApi, adoptedPlanPatch, now = appNow } = {}) {
    const adapter = annualRecordStorage(draft.records);
    let values = draft.values, adjustedFields = [];
    if (adoptedPlanPatch !== undefined) {
        ({ values, adjustedFields } = applyAdoptedPlanPatch(values, adoptedPlanPatch));
        adapter.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(adapter.getItem(HOUSEHOLD_PLAN_KEY), [{ scope: draft.scope, values }], { now }).raw);
    }
    const calculation = buildBalanceEngineInputFromStorage({ scope: draft.scope, storage: adapter, referenceYear: draft.planningYear });
    const inputData = calculation.inputData;
    const multi = calculation.profiles.length > 1 || calculation.profiles.length === 1 && calculation.profiles[0].profileId !== calculation.profileId;
    const runs = multi ? evaluateStoredAnnualHousehold(inputData, calculation.profiles, calculation.engineLastState,
        { engineApi, withdrawalMode: values.householdWithdrawalMode }) : null;
    const modelResult = runs?.householdResult || engineApi.simulateSingleYear({ ...inputData, finalizeThreeBucketAction: true }, calculation.engineLastState);
    if (modelResult?.error) throw modelResult.error;
    if (!modelResult?.newState || !modelResult?.ui) throw new Error('Die Jahresrechnung liefert keinen vollständigen Kandidaten.');
    const monthlyWithdrawal = modelResult.ui.spending.monatlicheEntnahme;
    // Der normale Balance-Pfad übernimmt denselben festen Einkommensjahresstand.
    const monthlyBudget = monthlyWithdrawal + Math.round(inputData.renteMonatlich * 12) / 12;
    const outcome = { monthlyWithdrawal, monthlyBudget, liquidityBefore: modelResult.ui.liquiditaet?.deckungVorher,
        liquidityAfter: modelResult.ui.liquiditaet?.deckungNachher, marketPhase: modelResult.ui.market?.szenarioText,
        flexRate: modelResult.diagnosis?.keyParams?.aktuelleFlexRate ?? modelResult.newState.flexRate,
        action: structuredClone(modelResult.ui.action), snapshot: { plan: structuredClone(values),
            inflation: inputData.inflation, ageByPerson: structuredClone(draft.ageByPerson) } };
    return { adapter, calculation, inputData, modelResult, runs, values, adjustedFields, outcome, monthlyBudget };
}

/** Alle Zielrecords werden vor dem einzigen fachlichen Replace in privatem Speicher gebaut. */
export function prepareAnnualCommitRecords(draft, { engineApi, adoptedPlanPatch, cash, now = appNow } = {}) {
    const date = now(), clock = () => date;
    const recommended = evaluateAnnualDraft(draft, { engineApi, now: clock });
    const adopted = adoptedPlanPatch === undefined ? recommended : evaluateAnnualDraft(draft, { engineApi, adoptedPlanPatch, now: clock });
    const { adapter, calculation, inputData, modelResult, runs } = adopted;
    const registry = JSON.parse(adapter.getItem('rs_profiles_v1'));
    const stateKey = CONFIG.STORAGE.LS_KEY;
    const manager = { loadState: () => JSON.parse(adapter.getItem(stateKey)), saveState: state => { assertBalanceWealthHistory(state); if (Object.hasOwn(state.lastState || {}, 'cumulativeInflationFactor')) assertCumulativeInflationFactor(state.lastState.cumulativeInflationFactor, { path: 'lastState.cumulativeInflationFactor' }); adapter.setItem(stateKey, JSON.stringify(stripBalancePersonInputs(state))); } };
    // Der alte Formularbesitzer bestätigt vor COMMIT_PERIOD die endgültigen
    // Nichtplan-Eingaben. Gleiche Basisprojektion, ausschließlich im Entwurf.
    manager.saveState({ ...manager.loadState(), inputs: stripBalancePlanInputs(inputData) });
    const commitState = manager.loadState();
    const fingerprints = { inputFingerprint: createBalanceFingerprint(inputData),
        baseStateFingerprint: createBalanceCommitBaseFingerprint({ persistentState: commitState,
            profilverbundProfiles: runs ? calculation.profiles : [],
            householdPlan: { scope: calculation.householdPlan.scope, values: calculation.householdPlan.entry.values } }),
        candidateStateFingerprint: createBalanceFingerprint({ householdState: modelResult.newState,
            profileStates: runs ? runs.map(run => ({ profileId: run.profileId, newState: run.newState })) : null }) };
    const profileHandlers = { persistProfilverbundProfileStates(profileRuns, { lifecycle }) {
        const householdState = { ...profileRuns.householdResult.newState, taxState: { lossCarry: 0 } };
        for (const run of profileRuns) {
            const state = { ...run.balanceState, inputs: stripBalancePlanInputs(run.persistedInput || run.input), lastState: run.newState,
                profilverbundHouseholdInputs: stripBalancePlanInputs(profileRuns.householdInput), profilverbundHouseholdLastState: householdState };
            registry.profiles[run.profileId].meta.updatedAt = date.toISOString();
            registry.profiles[run.profileId].data[stateKey] = JSON.stringify(createProfileOwnedBalanceState(state));
            if (run.profileId === draft.profileId) manager.saveState({ ...manager.loadState(), inputs: state.inputs,
                lastState: state.lastState, profilverbundHouseholdInputs: state.profilverbundHouseholdInputs,
                profilverbundHouseholdLastState: state.profilverbundHouseholdLastState, balanceStateLifecycle: lifecycle });
        }
    } };
    persistBalanceUpdate({ mode: BALANCE_UPDATE_MODE.COMMIT_PERIOD, periodId: draft.periodId, profilverbundRuns: runs,
        profilverbundHandlers: profileHandlers, storageManager: manager, persistentState: commitState,
        inputData, modelResult, fingerprints, householdPlan: calculation.householdPlan });
    const completed = completeAnnualPeriodCommit({ periodId: draft.periodId, metadata: calculation.persistentState.annualPeriodMetadata });
    if (!completed.metadata) throw new Error('Die vorbereitete Jahresperiode kann nicht bestätigt werden.');
    // Die gespeicherte Ansicht darf bereits das Folgejahr zeigen. Nur der
    // isolierte Entwurf stellt das Auswahljahr auf den bestätigten Planstand.
    // setExpensesActiveYear validiert weiterhin den vorhandenen Store.
    setExpensesActiveYear(draft.planningYear, adapter);
    adapter.setItem('rs_profiles_v1', JSON.stringify(registry));
    const members = Object.keys(registry.profiles).filter(id => registry.profiles[id].meta.belongsToHousehold !== false);
    const cashUpdate = cash ? prepareHouseholdCash({ storage: adapter, registry, activeId: draft.profileId,
        ids: members.length ? members : [draft.profileId], checkMembership: members.length > 0, cash, date: localHistoryDate(date), recordConfirmation: true }) : null;
    const nextRegistry = cashUpdate?.registry || registry;
    for (const [key, raw] of Object.entries(cashUpdate?.records || {})) adapter.setItem(key, raw);
    const state = stripBalancePersonInputs({ ...manager.loadState(), annualPeriodMetadata: completed.metadata });
    if (draft.targetYear >= 2026) {
        const entry = createAnnualWealthHistoryEntry({ ...inputData, ...(cashUpdate ? { tagesgeld: cashUpdate.total } : {}) }, draft.targetYear);
        state.wealthHistory = upsertAnnualWealthHistory(readWealthHistory(state), entry);
    }
    manager.saveState(state);
    nextRegistry.profiles[draft.profileId].data[stateKey] = JSON.stringify(state);
    const summaryScope = overviewScope(members.length > 1 || members.length === 1 && members[0] !== draft.profileId ? 'household' : 'single',
        members.length ? members : [draft.profileId]);
    adapter.setItem('rs_profiles_v1', JSON.stringify(nextRegistry));
    const summary = buildBalanceOverviewSummary({ modelResult, monthlyBudget: adopted.monthlyBudget, scope: summaryScope,
        metadata: completed.metadata, now: date, profileActions: runs?.map(run => ({ profileId: run.profileId, action: run.ui.action,
            input: run.input, spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet })),
        sourceFingerprint: sourceFingerprint({ registry: nextRegistry, activeId: draft.profileId, liveData: adapter.records, scope: summaryScope, kind: 'balance' }) });
    for (const id of summaryScope.ids) {
        const data = nextRegistry.profiles[id].data;
        data[OVERVIEW_SUMMARY_KEY] = JSON.stringify({ version: 1, entries: { ...readOverviewSummaries(id === draft.profileId
            ? adapter.getItem(OVERVIEW_SUMMARY_KEY) : data[OVERVIEW_SUMMARY_KEY]), [summaryEntryKey(summary.year, summaryScope)]: summary } });
        if (id === draft.profileId) adapter.setItem(OVERVIEW_SUMMARY_KEY, data[OVERVIEW_SUMMARY_KEY]);
    }
    adapter.setItem('rs_profiles_v1', JSON.stringify(nextRegistry));
    const receipt = buildAnnualPlanRecord(adapter.getItem(ANNUAL_PLAN_RECORD_KEY), { targetYear: draft.targetYear,
        scope: draft.scope, committedAt: date.toISOString(), recommended: recommended.outcome, adopted: adopted.outcome,
        adjustedFields: adopted.adjustedFields });
    adapter.setItem(ANNUAL_PLAN_RECORD_KEY, receipt.raw);
    const requiredKeys = new Set([HOUSEHOLD_PLAN_KEY, ANNUAL_PLAN_RECORD_KEY, stateKey, 'rs_profiles_v1', 'balance_expenses_v1']);
    const changedKeys = Object.keys(adapter.records).filter(key => requiredKeys.has(key) || adapter.records[key] !== draft.baseRecords[key]);
    return { records: Object.fromEntries(changedKeys.map(key => [key, adapter.records[key]])), receipt: receipt.entry, completed,
        result: { ok: true, inputData, modelResult, profilverbundRuns: runs, fingerprints }, state, nextYear: draft.planningYear };
}

const activeCommits = new WeakSet();
export async function commitAnnualPlanUpdate({ draft, targetYear, marketData, scope, storage = persistenceStorage,
    persistence = PersistenceFacade, engineApi, adoptedPlanPatch, cash, navigationOperation, now = appNow, isCurrent = () => true } = {}) {
    if (activeCommits.has(storage)) throw new Error('Der Jahresabschluss läuft bereits.');
    activeCommits.add(storage);
    try {
        const check = () => {
            navigationOperation?.check();
            if (!isCurrent() || persistence.hasSyncWriteBlocks?.()) throw new Error('Jahresabschluss wegen Kontextwechsel oder Wiederherstellung gesperrt.');
        };
        check();
        if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        check();
        draft ||= computeAnnualPlanUpdate({ targetYear, marketData, scope, storage, now });
        if (draft.status === 'already_committed') return { status: 'already_committed', periodId: draft.periodId };
        const assertBase = () => {
            check();
            if (JSON.stringify(captureAnnualRecords(storage)) !== JSON.stringify(draft.baseRecords)) throw new Error('Die Jahresquellen wurden seit der Vorbereitung verändert.');
        };
        assertBase();
        const prepared = prepareAnnualCommitRecords(draft, { engineApi, adoptedPlanPatch, cash, now });
        assertBase();
        const keys = new Set(Object.keys(prepared.records));
        const expected = Object.fromEntries([...keys].filter(key => draft.baseRecords[key] != null).map(key => [key, draft.baseRecords[key]]));
        navigationOperation?.commit('finalizing');
        try {
            await persistence.replaceRecordsTransactional(prepared.records, { probelaufDomainWrite: true, navigationOperation,
                expectedRecords: expected, allowKey: key => {
                    check();
                    const currentRecords = captureAnnualRecords(storage);
                    if (Object.keys(currentRecords).some(source => !Object.hasOwn(draft.baseRecords, source) && !keys.has(source))) throw new Error('Der Rohbestand wurde vor dem Write erweitert.');
                    for (const [source, raw] of Object.entries(draft.baseRecords)) {
                        const current = storage.getItem(source);
                        if (current !== raw && current !== prepared.records[source]) throw new Error('Die Jahresquellen wurden vor dem Write verändert.');
                    }
                    for (const source of keys) if (storage.getItem(source) !== (draft.baseRecords[source] ?? null)
                        && storage.getItem(source) !== prepared.records[source]) throw new Error('Der Jahreszielrecord wurde vor dem Write verändert.');
                    return keys.has(key);
                }, postValidate: actual => {
                    check();
                    if ([...keys].some(key => actual[key] !== prepared.records[key])) throw new Error('Der Jahresabschluss wurde nicht bytegleich bestätigt.');
                    return true;
                } });
        } catch (error) {
            if (error.code === 'rollback_failed') persistence.blockSyncWrites?.([...keys], 'Jahresabschluss und Rücknahme unbestätigt. Bitte den Wiederherstellungspunkt zurückholen.');
            throw error;
        }
        return { ...prepared, status: 'already_committed', results: { ...draft.results, confirmed: true } };
    } finally { activeCommits.delete(storage); }
}
