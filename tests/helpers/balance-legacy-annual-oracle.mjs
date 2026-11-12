/** Eingefrorene Ablaufprobe des DOM-Jahreswegs vor H3; kein Speicherleser/Jahresentwurf. */
import { completeAnnualPeriodCommit } from '../../app/balance/balance-annual-period.js';
import { createBalanceWealthHistoryService } from '../../app/balance/balance-wealth-history.js';
import { setExpensesActiveYear } from '../../app/balance/balance-expenses-storage.js';
import { buildBalanceOverviewSummary } from '../../app/overview/overview-model.js';
import { overviewScope, storeOverviewSummary } from '../../app/overview/overview-storage.js';
import { appNow } from '../../app/shared/app-clock.js';
import { CONFIG } from '../../app/balance/balance-config.js';
import { UIReader } from '../../app/balance/balance-reader.js';
import { StorageManager } from '../../app/balance/balance-storage.js';
import { createInflationHandlers } from '../../app/balance/balance-annual-inflation.js';
import { createMarketdataHandlers } from '../../app/balance/balance-annual-marketdata.js';
import { createAnnualOrchestrator, createAnnualNavigationLifecycle } from './balance-legacy-annual-handlers.mjs';
import { createProfilverbundHandlers } from '../../app/balance/balance-main-profilverbund.js';
import { evaluateBalanceFileInputs } from '../../app/balance/balance-file-service.js';
import { loadProfilverbundProfiles } from '../../app/profile/profilverbund-balance.js';
import { readBalanceHouseholdPlan, stageBalancePlanPatch, stripBalancePlanInputs } from '../../app/profile/household-plan.js';
import { projectBalancePlanHistory, persistBalanceUpdate, BALANCE_UPDATE_MODE, createBalanceFingerprint,
    createBalanceCommitBaseFingerprint } from '../../app/balance/balance-update-pipeline.js';
import { PersistenceFacade, persistenceStorage } from '../../app/shared/persistence-facade.js';
import { HOUSEHOLD_CARE_VALUES_KEY } from '../../app/shared/household-care-values.js';
import { OWN_CARE_PRICES_KEY, careDriftPercent, projectCarePrices, projectCareValuesForYear, resolveCarePrices } from '../../app/shared/care-prices.js';
import { annualCareProfileId, careSettingsStorage, sharesHouseholdCareValues } from '../../app/shared/care-profile-settings.js';

export async function legacyAnnualOracle({ dom, marketData, engineApi, targetYear }) {
    const handlers = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
    let captured;
    const update = ({ mode, periodId } = {}) => {
        const plan = readBalanceHouseholdPlan(), state = StorageManager.loadState();
        const profiles = loadProfilverbundProfiles();
        const inputData = UIReader.readAllInputs();
        // Den früheren DOM-Lesepfad unabhängig von der heutigen Jahresquelle
        // festhalten: Die alten Handler stellen hier die gerundete Jahresrate ein.
        inputData.inflation = parseFloat(dom.inputs.inflation?.value) || 0;
        handlers.updateProfilverbundGlobals(profiles, inputData);
        const history = projectBalancePlanHistory(state, profiles, plan);
        if (mode !== BALANCE_UPDATE_MODE.PREVIEW) {
            stageBalancePlanPatch({ scope: plan.scope, patch: UIReader.readHouseholdPlanPatch(plan) });
            StorageManager.saveState({ ...state, inputs: stripBalancePlanInputs(inputData) });
        }
        const evaluator = { runProfilverbundProfileSimulations: (...args) => handlers.runProfilverbundProfileSimulations(...args,
            { engineApi, withdrawalMode: plan.entry.values.householdWithdrawalMode }) };
        const result = evaluateBalanceFileInputs({ inputData, persistentState: history.persistentState, profiles: history.profiles,
            profileId: persistenceStorage.getItem('rs_current_profile'), profilverbundHandlers: evaluator, engineApi });
        const currentState = StorageManager.loadState();
        const currentPlan = readBalanceHouseholdPlan();
        const multi = profiles.length > 1 || profiles.length === 1 && profiles[0].profileId !== persistenceStorage.getItem('rs_current_profile');
        const fingerprints = { inputFingerprint: createBalanceFingerprint(inputData),
            baseStateFingerprint: createBalanceCommitBaseFingerprint({ persistentState: currentState, profilverbundProfiles: multi ? loadProfilverbundProfiles() : [],
                householdPlan: { scope: currentPlan.scope, values: currentPlan.entry.values } }),
            candidateStateFingerprint: createBalanceFingerprint({ householdState: result.modelResult.newState,
                profileStates: result.profilverbundRuns ? result.profilverbundRuns.map(run => ({ profileId: run.profileId, newState: run.newState })) : null }) };
        persistBalanceUpdate({ mode, periodId, ...result, profilverbundHandlers: handlers, storageManager: StorageManager,
            persistentState: currentState, inputData, fingerprints, householdPlan: currentPlan });
        captured = { ok: true, inputData, ...result, fingerprints };
        return captured;
    };
    const navigationLifecycle = createAnnualNavigationLifecycle({ guard: null, flush: async () => {} });
    const inflation = createInflationHandlers({ dom, update, debouncedUpdate() {}, navigationLifecycle });
    const market = createMarketdataHandlers({ dom, appState: {}, debouncedUpdate() {}, applyAnnualInflation: inflation.applyAnnualInflation, navigationLifecycle });
    const orchestration = createAnnualOrchestrator({ dom, debouncedUpdate() {}, navigationLifecycle,
        handleFetchInflation: inflation.handleFetchInflation, handleNachrueckenMitETF: market.handleNachrueckenMitETF,
        handleFetchCapeAuto: market.handleFetchCapeAuto, showUpdateResultModal() {}, setLastUpdateResults() {} });
    const annual = await orchestration.handleJahresUpdate({ preparedMarketData: marketData, nested: true });
    if (!annual.ok) throw annual.error || new Error(JSON.stringify(annual.results.errors));
    inflation.applyAnnualInflation();
    // FR-73 Punkt 9: Der Jahresweg schreibt die fortgeschriebenen Pflegewerte vor der Jahresrechnung (wie der Speicherweg).
    // PFA-6 (Argon FR73A B2): Preisbesitzer wie im Speicherweg; im Einzelprofil einer Außenperson schreibt der Abschluss ihren
    // eigenen Preisblock fort und lässt die Preise des Haushaltsrecords stehen.
    const careProfileId = annualCareProfileId(persistenceStorage), careLegacy = careSettingsStorage(persistenceStorage, careProfileId);
    const careShared = sharesHouseholdCareValues(persistenceStorage, careProfileId);
    const careRates = { inflationRate: marketData.inflation.rate, driftPercent: careDriftPercent(careLegacy), priceYear: targetYear + 1 };
    const careBase = persistenceStorage.getItem(HOUSEHOLD_CARE_VALUES_KEY);
    const careNext = projectCareValuesForYear(careBase, { ...careRates, legacySource: careLegacy, shared: careShared });
    if (!careShared) {
        const own = JSON.stringify(projectCarePrices(resolveCarePrices(null, careLegacy, { shared: false }), careRates));
        careNext.prices = careBase ? JSON.parse(careBase).prices : undefined;
        const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        registry.profiles[careProfileId].data[OWN_CARE_PRICES_KEY] = own;
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        persistenceStorage.setItem(OWN_CARE_PRICES_KEY, own);
    }
    persistenceStorage.setItem(HOUSEHOLD_CARE_VALUES_KEY, JSON.stringify(careNext));
    update({ mode: BALANCE_UPDATE_MODE.COMMIT_PERIOD, periodId: `calendar-year:${targetYear}` });
    await PersistenceFacade.flush();
    const pending = StorageManager.loadState().annualPeriodMetadata;
    const completed = completeAnnualPeriodCommit({ periodId: `calendar-year:${targetYear}`, metadata: pending });
    if (!completed.metadata) throw new Error('Das DOM-Orakel kann die Jahresperiode nicht bestätigen.');
    setExpensesActiveYear(targetYear + 1);
    const wealth = createBalanceWealthHistoryService({ guard: null });
    await wealth.runAnnual((context, navigationOperation) => wealth.finalizeAnnual({ context, navigationOperation,
        result: captured, targetYear, metadata: completed.metadata, expectedPending: pending }));
    const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
    const members = Object.keys(registry.profiles).filter(id => registry.profiles[id].meta.belongsToHousehold !== false);
    const activeId = persistenceStorage.getItem('rs_current_profile');
    const scope = overviewScope(members.length > 1 || members.length === 1 && members[0] !== activeId ? 'household' : 'single',
        members.length ? members : [activeId]);
    const summary = buildBalanceOverviewSummary({ modelResult: captured.modelResult,
        monthlyBudget: captured.modelResult.ui.spending.monatlicheEntnahme + Math.round(captured.inputData.renteMonatlich * 12) / 12,
        metadata: completed.metadata, scope, now: appNow(), captureSources: true, activeId,
        profileActions: captured.profilverbundRuns?.map(run => ({ profileId: run.profileId, action: run.ui.action,
            input: run.input, spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet })) });
    if (!await storeOverviewSummary(summary, { expectedProfileId: activeId, guard: null })) throw new Error('DOM-Orakel-Summary unbestätigt.');
    return { ...captured, records: PersistenceFacade.exportAllSync().records, summary };

}
