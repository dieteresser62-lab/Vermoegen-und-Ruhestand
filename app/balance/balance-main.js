import { initBalancePlanTrial, getBalancePlanTrial } from './balance-plan-trial.js';
import { renderBalanceInflationSource } from './balance-inflation-source.js';
import { buildBalanceEngineInputFromStorage } from './balance-input-storage.js';
import { HOUSEHOLD_PLAN_KEY, stripBalancePlanInputs, readBalanceHouseholdPlan, stageBalancePlanPatch } from '../profile/household-plan.js';
import { initializeHouseholdPlanPage } from '../profile/household-plan-dialog.js';
import { migrateHouseholdPlans } from '../profile/household-plan-migration.js';
import { evaluateBalanceFileInputs } from './balance-file-service.js';
import { readBalancePersonStatus, showPersonDataStatus } from '../shared/person-data-status.js';
import { buildBalanceOverviewSummary, parseOverviewTarget } from '../overview/overview-model.js';
import { storeOverviewSummary, overviewScope } from '../overview/overview-storage.js';
import { getCurrentProfileId } from '../profile/profile-registry.js';
import { whenProfileDisplayReady, initializeProfilePage } from '../profile/profile-navigation.js';
/**
 * Module: Balance Main
 * Purpose: The central entry point and orchestrator for the Balance App (ES6 version).
 *          It initializes the application, handles the main update loop, manages state, and coordinates
 *          interactions between the UI, Storage, and the Calculation Engine.
 * Usage: Loaded as the main script in the HTML file.
 * Dependencies: balance-config.js, balance-storage.js, balance-reader.js, balance-renderer.js, balance-binder.js, engine.js (global)
 */
"use strict";

/**
 * ===================================================================================
 * BALANCE-APP HAUPTMODUL - ES6 VERSION
 * ===================================================================================
 */

import { BALANCE_UPDATE_DEBOUNCE_MS, CONFIG, REQUIRED_ENGINE_API_VERSION_PREFIX } from './balance-config.js';
import { StorageManager, initStorageManager } from './balance-storage.js';
import { UIReader, initUIReader } from './balance-reader.js';
import { displayDiagnosisText } from './balance-diagnosis-transaction.js';
import { withGuardrailCardValues } from './balance-diagnosis-guardrails.js';
import { UIRenderer, initUIRenderer } from './balance-renderer.js';
import { consumeAnnualRetry } from './balance-binder-snapshots.js';
import { UIBinder, initUIBinder, openBalanceDataTarget } from './balance-binder.js';
import { syncTranchenToInputs } from '../tranches/depot-tranchen-status.js';
import { loadProfilverbundProfiles } from '../profile/profilverbund-balance.js';
import { createProfilverbundHandlers } from './balance-main-profilverbund.js';
import { createProfileSyncHandlers } from './balance-main-profile-sync.js';
import { UIUtils } from './balance-utils.js';
import { initDynamicFlexControls, syncDynamicFlexPresetSelection, refreshDynamicFlexControls } from '../simulator/simulator-main-dynamic-flex.js';
import { PersistenceFacade, getPersistenceStatus, init as initPersistence, persistenceStorage } from '../shared/persistence-facade.js';
import { PROFILE_VALUE_KEYS } from '../profile/profile-state.js';
import { postprocessBalanceAction } from './balance-action-postprocessor.js';
import { ANNUAL_MARKET_DATA_META_KEY } from './balance-annual-marketdata.js';
import { initializeBalanceWealthHistory, refreshBalanceWealthHistory } from './balance-wealth-history-renderer.js';
import {
    BALANCE_UPDATE_MODE,
    BALANCE_UPDATE_STATUS,
    assertActiveEngineHandshake,
    assertBalanceCommitStillCurrent,
    assertBalanceCandidateFresh,
    assertBalancePeriodCommit,
    buildBalanceRendererPayload,
    createBalanceDisplayEngineApi,
    calculateExpensesBudget,
    cloneBalanceState,
    createBlockedUpdateResult,
    createBalanceFingerprint,
    createEngineHandshake,
    createUpdateFailureResult,
    createUpdateSuccessResult,
    enrichBalanceDiagnosisPayload,
    persistBalanceUpdate,
    resolveBalanceUpdateRequest,
    validateBalanceInputs
} from './balance-update-pipeline.js';

// ==================================================================================
// APPLICATION STATE & DOM REFERENCES
// ==================================================================================

const appState = {
    debounceTimer: null,
    snapshotHandle: null,
    diagnosisData: null,
    lastUpdateTimestamp: null,
    lastMarktData: null,
    engineHandshake: null,
    pendingInputMetadata: {}
};

const PROFILVERBUND_STORAGE_KEYS = {
    mode: 'household_withdrawal_mode'
};

const dom = {
    outputs: {
        balanceExpensesSummary: document.getElementById('balanceExpensesSummary'),
        balanceNextAnnual: document.getElementById('balanceNextAnnual'),
        balanceOverview: document.getElementById('results'),
        balancePlanningYear: document.getElementById('balancePlanningYear'),
        balanceScope: document.getElementById('balanceScope'),
        balanceScopeText: document.getElementById('balanceScopeText'),
        balanceActiveProfile: document.getElementById('balanceActiveProfile'),
        balancePlanningYearPill: document.getElementById('balancePlanningYearPill'),
        balanceMarketDate: document.getElementById('balanceMarketDate'),
        balanceMarketSource: document.getElementById('balanceMarketSource'),
        balanceActionPeriod: document.getElementById('balanceActionPeriod'),
        balanceStepCount: document.getElementById('balanceStepCount'),
        balanceMarketAlarm: document.getElementById('balanceMarketAlarm'),
        balanceMarketAlarmText: document.getElementById('balanceMarketAlarmText'),
        balanceActionIcon: document.getElementById('balanceActionIcon'),

        balanceMonthlyBudget: document.getElementById('balanceMonthlyBudget'),
        balanceAnnualBudget: document.getElementById('balanceAnnualBudget'),
        balanceMonthlyIncome: document.getElementById('balanceMonthlyIncome'),
        balanceBudgetBar: document.getElementById('balanceBudgetBar'),
        balanceBudgetCut: document.getElementById('balanceBudgetCut'),
        balanceBudgetChips: document.getElementById('balanceBudgetChips'),
        balanceNextSteps: document.getElementById('balanceNextSteps'),
        balanceMarketScale: document.getElementById('balanceMarketScale'),
        balanceMarketFacts: document.getElementById('balanceMarketFacts'),
        balanceNeedRows: document.getElementById('balanceNeedRows'),
        balanceReserveRows: document.getElementById('balanceReserveRows'),
        balanceAnnualRecovery: document.getElementById('balanceAnnualRecovery'),
        balanceActionTitle: document.getElementById('balanceActionTitle'),
        balanceActionAmount: document.getElementById('balanceActionAmount'),
        balanceActionNote: document.getElementById('balanceActionNote'),
        balanceActionPurpose: document.getElementById('balanceActionPurpose'),
        balanceActionCoverage: document.getElementById('balanceActionCoverage'),
        balanceActionFootnote: document.getElementById('balanceActionFootnote'),
        balanceBudgetCutLegend: document.getElementById('balanceBudgetCutLegend'),
        balanceBudgetCutAmount: document.getElementById('balanceBudgetCutAmount'),
        balanceNeedProfiles: document.getElementById('balanceNeedProfiles'),
        balanceNextAnnualLabel: document.getElementById('balanceNextAnnualLabel'),
        balanceActionTransfer: document.getElementById('balanceActionTransfer'),
        miniSummary: document.getElementById('miniSummary'),
        depotwert: document.getElementById('displayDepotwert'),
        neuerBedarf: document.getElementById('neuerBedarf'),
        zielLiquiditaet: document.getElementById('zielLiquiditaet'),
        liquiditaetBalken: document.getElementById('liquiditaetBalken'),
        balkenContainer: document.querySelector('.progress-bar-container'),
        marktstatusText: document.getElementById('marktstatusText'),
        monatlicheEntnahme: document.getElementById('monatlicheEntnahme'),
        handlungsanweisung: document.getElementById('handlungsanweisung'),
        actionDetailsTitle: document.getElementById('actionDetailsTitle'),
        actionDetailsAmountLabel: document.getElementById('actionDetailsAmountLabel'),
        actionDetailsAmount: document.getElementById('actionDetailsAmount'),
        actionDetailsNote: document.getElementById('actionDetailsNote'),
        actionManagerLink: document.getElementById('actionManagerLink'),
        actionPurposeContent: document.getElementById('actionPurposeContent'),

        minGoldDisplay: document.getElementById('minGoldDisplay'),
        entnahmeDetailsContent: document.getElementById('entnahmeDetailsContent'),
        entnahmeBreakdown: document.getElementById('entnahme-breakdown'),
        healthBucketSummary: document.getElementById('healthBucketSummary'),
        marketDataProvenance: document.getElementById('marketDataProvenance'),
        snapshotList: document.getElementById('snapshotList'),
        printFooter: document.getElementById('print-footer')
    },
    inputs: {}, // Wird in init() gefüllt
    controls: {
        exportBtn: document.getElementById('exportBtn'),
        importBtn: document.getElementById('importBtn'),
        importFile: document.getElementById('importFile'),
        btnJahresUpdate: document.getElementById('btnJahresUpdate'),
        btnJahresUpdateLog: document.getElementById('btnJahresUpdateLog'),
        copyAction: document.getElementById('copyAction'),
        jahresabschlussBtn: document.getElementById('jahresabschlussBtn'),
        connectFolderBtn: document.getElementById('connectFolderBtn'),
        snapshotStatus: document.getElementById('snapshotStatus'),
        goldPanel: document.getElementById('goldPanel'),
        captureWealthBtn: document.getElementById('captureWealthBtn')
    },
    containers: {
        error: document.getElementById('error-container'),
        toast: document.getElementById('toast-container'),
        actionError: document.getElementById('action-error-container'),
        bedarfAnpassung: document.getElementById('bedarfAnpassungContainer'),
        tabButtons: document.querySelector('.tab-buttons'),
        tabPanels: document.querySelectorAll('.tab-panel'),
        form: document.querySelector('.form-column'),
        versionAlert: document.getElementById('engine-version-alert')
    },
    diagnosis: {
                openBtn: document.getElementById('openDiagnosisBtn'),
        copyBtn: document.getElementById('copyDiagnosisBtn'),
        filterToggle: document.getElementById('diagFilterToggle'),
        content: document.getElementById('diagContent'),
        chips: document.getElementById('diag-chips'),
        decisionTree: document.getElementById('diag-decision-tree'),
        guardrails: document.getElementById('diag-guardrails'),
        transaction: document.getElementById('diag-transaction'),
        keyParams: document.getElementById('diag-key-params')
    },
    wealthHistory: {
        panel: document.getElementById('tab-history'),
        date: document.getElementById('wealthHistoryDate'),
        count: document.getElementById('wealthHistoryCount'),
        title: document.getElementById('wealthHistoryTitle'),
        profileContext: document.getElementById('suiteProfileContext'),
        metrics: document.getElementById('wealthHistoryMetrics'),
        chart: document.getElementById('wealthHistoryChart'),
        table: document.getElementById('wealthHistoryTable'),
        hint: document.getElementById('wealthHistoryHint'),
        scrollHint: document.getElementById('wealthHistoryScrollHint'),
        status: document.getElementById('wealthHistoryStatus')
    }
};

const profilverbundHandlers = createProfilverbundHandlers({
    dom,
    PROFILVERBUND_STORAGE_KEYS
});
const profileSyncHandlers = createProfileSyncHandlers({
    dom,
    PROFILE_VALUE_KEYS
});

// ==================================================================================
// CORE APPLICATION FUNCTIONS
// ==================================================================================

/**
 * Haupt-Update-Funktion - Kern der Balance-App
 *
 * Diese Funktion orchestriert den kompletten Update-Zyklus:
 * 1. Erfasst valide Formularrohwerte und baut Recheneingaben aus dem Speicher
 * 2. Lädt persistenten Zustand (Guardrail-History)
 * 3. Ruft die externe Engine auf (engine.js)
 * 4. Rendert alle Ergebnisse in der UI
 * 5. Persistiert je nach explizitem Modus keine Daten, nur Eingaben oder den Perioden-State
 *
 * Wird aufgerufen bei:
 * - Initialisierung der App
 * - Änderung von Input-Feldern (debounced)
 * - Import von Daten
 * - Jahresabschluss
 */
export function update(options = {}) {
    refreshBalanceWealthHistory(dom.wealthHistory);
    let phase = 'update_contract';
    try {
        const personStatus = readBalancePersonStatus();
        if (personStatus.status === 'corrupt') throw personStatus.error;
        if (!personStatus.ready) {
            showPersonDataStatus(personStatus);
            return createBlockedUpdateResult('person_data_incomplete');
        }
        const summaryProfileId = getCurrentProfileId();
        // Ein Abschluss beginnt immer beim bestätigten Plan.
        if (options.mode === BALANCE_UPDATE_MODE.COMMIT_PERIOD || options.confirmedAnnualResult) {
            getBalancePlanTrial(document).reset(); UIReader.applyHouseholdPlanInputs();
        }
        const trialActive = getBalancePlanTrial(document).read().active;
        const request = resolveBalanceUpdateRequest(trialActive ? { ...options, mode: BALANCE_UPDATE_MODE.PREVIEW } : options);
        phase = 'engine_gate';
        const engineApi = assertActiveEngineHandshake(appState.engineHandshake, window.EngineAPI);
        UIRenderer.clearError();

        // Keep profile-derived values in sync before reading inputs.
        profileSyncHandlers.syncProfileDerivedInputs();

        // 1. Read Inputs & State
        // Liest alle Formular-Eingaben und den letzten gespeicherten Zustand
        phase = 'validation';
        const draft = options.confirmedAnnualResult ? { calculation: buildBalanceEngineInputFromStorage({ storage: persistenceStorage }), source: null } : UIReader.captureStorageDraft(appState.pendingInputMetadata || {},
            { includePreviewBase: request.mode === BALANCE_UPDATE_MODE.PREVIEW });
        let calculation = draft.calculation;
        const formSource = draft.source;
        const metadataSource = createBalanceFingerprint(appState.pendingInputMetadata || {});
        let inputData = calculation.inputData;
        const engineHistory = calculation.history;
        validateBalanceInputs(inputData);
        if (!inputData.aktuellesAlter) return createBlockedUpdateResult('initial_state');
        // Bestätigte Eingaben gehören vor der Rechnung ihren bestehenden Speicherbesitzern.
        // Die Vorschau verwendet ausschließlich den isolierten Rohrecordadapter.
        if (request.mode !== BALANCE_UPDATE_MODE.PREVIEW) {
            options.navigationOperation?.check();
            if (request.mode === BALANCE_UPDATE_MODE.COMMIT_PERIOD) assertBalancePeriodCommit(calculation.persistentState, request.periodId);
            if (draft.plan.status === 'valid') stageBalancePlanPatch({ scope: draft.plan.scope,
                patch: draft.patch, navigationOperation: options.navigationOperation });
            StorageManager.saveState({ ...StorageManager.loadState(),
                inputs: draft.plan.status === 'valid' ? stripBalancePlanInputs(inputData) : inputData,
                balanceInputFields: draft.fields });
            calculation = buildBalanceEngineInputFromStorage({ scope: draft.plan.scope, storage: persistenceStorage });
        }
        inputData = options.confirmedAnnualResult ? cloneBalanceState(options.confirmedAnnualResult.inputData) : calculation.inputData;
        const profilverbundProfiles = calculation.profiles;
        if (!options.confirmedAnnualResult && !trialActive) profilverbundHandlers.updateProfilverbundGlobals(profilverbundProfiles, inputData);

        UIRenderer.renderContext(inputData);

        const persistentState = calculation.persistentState;
        const householdPlan = calculation.householdPlan;
        const isMultiProfileHousehold = profilverbundProfiles.length > 1
            || profilverbundProfiles.length === 1 && profilverbundProfiles[0].profileId !== summaryProfileId;
        const baseStateFingerprint = calculation.baseStateFingerprint;
        const sourceFingerprint = calculation.sourceFingerprint;
        phase = 'engine';
        const history = engineHistory;
        // Trace nur für diese Anzeige anfordern; Export-/Runnerpfade bleiben beim Standard.
        const displayEngineApi = createBalanceDisplayEngineApi(engineApi);
        const calculationHandlers = { ...profilverbundHandlers,
            runProfilverbundProfileSimulations: (...args) => profilverbundHandlers.runProfilverbundProfileSimulations(...args,
                { engineApi: displayEngineApi, publish: !trialActive, withdrawalMode: householdPlan.status === 'valid' ? householdPlan.entry.values.householdWithdrawalMode
                    : persistenceStorage.getItem(PROFILVERBUND_STORAGE_KEYS.mode) || 'tax_optimized' }) };
        const { profilverbundRuns, modelResult } = options.confirmedAnnualResult
            ? { profilverbundRuns: options.confirmedAnnualResult.profilverbundRuns, modelResult: options.confirmedAnnualResult.modelResult } : evaluateBalanceFileInputs({ inputData: calculation.inputData,
            persistentState: history.persistentState, profiles: history.profiles, profileId: summaryProfileId,
            profilverbundHandlers: calculationHandlers, engineApi: displayEngineApi, publish: !trialActive });

        if (options.confirmedAnnualResult && typeof window !== 'undefined') {
            // Erst nach Readback die bestätigte Profilattribution veröffentlichen.
            window.__profilverbundDistribution = profilverbundRuns?.distribution || null;
            window.__profilverbundActionResults = profilverbundRuns?.map(run => ({
                profileId: run.profileId, name: run.name, action: run.ui.action,
                input: run.input, spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet
            })) || null;
        }

        // 2. Render Bedarfsanpassungs-UI
        // Bedarfsanpassung folgt dem Planungsjahr, auch bei festem Altalter-Fallback.
        UIRenderer.renderBedarfAnpassungUI(inputData, persistentState);

        appState.lastUpdateTimestamp = Date.now();

        // 3. Call Engine
        // Die externe Engine (engine.js) berechnet alle Werte
        // Input: Benutzereingaben + letzter State
        // Output: {input, newState, diagnosis, ui} oder {error}
        phase = 'render';
        const { threeBucketDiagnosis } = postprocessBalanceAction({
            inputData,
            modelResult,
            profilverbundRuns,
            mergeProfilverbundActions: profilverbundHandlers.mergeProfilverbundActions
        });

        // 5. Prepare data for Renderer
        // Kombiniert Engine-Output mit Eingaben für vollständige UI-Darstellung
        const uiDataForRenderer = { ...buildBalanceRendererPayload(modelResult, inputData),
            balanceAlarmActive: modelResult.diagnosis?.general?.alarmActive === true };

        // 6. Render & Save
        // Rendert alle UI-Komponenten: Summary, Liquiditätsbalken, Handlungsanweisung, etc.
        UIRenderer.render(uiDataForRenderer);
        const trialResult = document.getElementById('balancePlanTrialResult');
        if (trialResult) { trialResult.hidden = !draft.deviationApplied; trialResult.textContent = 'Versuch · mit Abweichung vom Plan'; }
        renderBalanceInflationSource(document, { scope: calculation.scope });

        // Bereitet Diagnose-Daten auf und rendert das Diagnose-Panel
        const formattedDiagnosis = enrichBalanceDiagnosisPayload({
            formattedDiagnosis: withGuardrailCardValues(UIRenderer.formatDiagnosisPayload(modelResult.diagnosis), modelResult.diagnosis),
            modelResult,
            inputData,
            threeBucketDiagnosis
        });
        if (formattedDiagnosis) {
            formattedDiagnosis.keyParams = formattedDiagnosis.keyParams || {};
            formattedDiagnosis.keyParams.marketDataProvenance =
                persistentState?.[ANNUAL_MARKET_DATA_META_KEY] || null;
        }

        appState.diagnosisData = formattedDiagnosis;
        UIRenderer.renderDiagnosis(appState.diagnosisData);
        UIReader.renderMarketDataProvenance(
            persistentState?.[ANNUAL_MARKET_DATA_META_KEY] || null
        );

        // Budget bleibt Teil der Plan-Zusammenfassung, ohne Ausgabenansicht zu initialisieren.
        const { monthlyBudget } = calculateExpensesBudget({
            fixedIncomeAnnual: UIUtils.parseCurrency(dom.inputs.fixedIncomeAnnual?.value || 0),
            monthlyWithdrawal: modelResult.ui?.spending?.monatlicheEntnahme
        });
        const fingerprints = {
            inputFingerprint: createBalanceFingerprint(inputData),
            baseStateFingerprint,
            candidateStateFingerprint: createBalanceFingerprint({
                householdState: modelResult.newState,
                profileStates: profilverbundRuns
                    ? profilverbundRuns.map(run => ({
                        profileId: run.profileId,
                        newState: run.newState
                    }))
                    : null
            })
        };
        const result = createUpdateSuccessResult({
            inputData,
            modelResult,
            updateMode: request.mode,
            fingerprints
        });

        // Ergebnis- und LastState-Persistenz erst nach erfolgreicher Engine-Ausführung.
        if (request.mode !== BALANCE_UPDATE_MODE.PREVIEW && result.status === BALANCE_UPDATE_STATUS.SUCCESS) {
            phase = 'persistence';
            const current = buildBalanceEngineInputFromStorage({ scope: calculation.scope, storage: persistenceStorage });
            assertBalanceCandidateFresh(sourceFingerprint, current.sourceFingerprint);
            assertBalanceCandidateFresh(formSource, UIReader.readInputSourceFingerprint());
            assertBalanceCandidateFresh(metadataSource, createBalanceFingerprint(appState.pendingInputMetadata || {}));
            options.navigationOperation?.check();
            const persistentStateForWrite = request.mode === BALANCE_UPDATE_MODE.COMMIT_PERIOD
                ? assertBalanceCommitStillCurrent({ expectedBaseFingerprint: baseStateFingerprint,
                    currentBaseFingerprint: current.baseStateFingerprint, currentPersistentState: current.persistentState, periodId: request.periodId })
                : current.persistentState;
            result.persistence = persistBalanceUpdate({
                mode: request.mode,
                periodId: request.periodId,
                profilverbundRuns,
                profilverbundHandlers,
                storageManager: StorageManager,
                persistentState: persistentStateForWrite,
                inputData,
                modelResult,
                fingerprints,
                householdPlan: householdPlan.status === 'valid' ? householdPlan : null
            });
            appState.pendingInputMetadata = {};
            if (householdPlan.status === 'valid') UIReader.applyHouseholdPlanInputs();

            profilverbundHandlers.refreshProfilverbundBalance();
        }

        try {
            if (options.confirmedAnnualResult || trialActive) { result.overviewPersistence = Promise.resolve(true); return result; }
            const scope = overviewScope(isMultiProfileHousehold ? 'household' : 'single',
                isMultiProfileHousehold ? profilverbundProfiles.map(p => p.profileId) : [summaryProfileId]);
            const summary = buildBalanceOverviewSummary({ modelResult, monthlyBudget, scope,
                metadata: StorageManager.loadState()?.annualPeriodMetadata,
                captureSources: true, activeId: summaryProfileId, profileActions: typeof window !== 'undefined' ? window.__profilverbundActionResults : null });
            const overviewPersistence = storeOverviewSummary(summary, { expectedProfileId: summaryProfileId, navigationOperation: options.navigationOperation });
            result.overviewNavigationOwner = overviewPersistence.navigationOwner;
            result.overviewPersistence = overviewPersistence
                .catch(error => { console.error('Plananzeige konnte nicht dauerhaft gespeichert werden:', error); return false; });
        } catch (error) {
            console.error('Plananzeige konnte nicht gespeichert werden:', error);
            result.overviewPersistence = Promise.resolve(false);
        }

        // Auch noch nicht entprellte Formulareingaben binden die Verlaufsvorschau.
        if (request.mode === BALANCE_UPDATE_MODE.PREVIEW) {
            const previewInputs = UIReader.readInputSourceFingerprint();
            result.validateWealthHistorySource = () => {
                if (UIReader.readInputSourceFingerprint() !== previewInputs
                    || buildBalanceEngineInputFromStorage({ scope: calculation.scope, storage: persistenceStorage }).sourceFingerprint !== draft.baseSourceFingerprint) {
                    throw new Error('Die Vorschaueingaben wurden während der Verlaufserfassung verändert.');
                }
            };
        }
        return result;

    } catch (error) {
        console.error("Update-Fehler:", error);
        UIRenderer.handleError(error);
        return createUpdateFailureResult(error, { phase });
    }
}

/**
 * Debounced Update-Funktion
 *
 * Verzögert den Update-Aufruf um 250ms, um bei schnellen Eingaben
 * (z.B. Tippen in Zahlenfeldern) nicht zu viele Updates auszulösen.
 * Spart Performance und reduziert Flackern.
 */
export function debouncedUpdate() {
    clearTimeout(appState.debounceTimer);
    appState.debounceTimer = setTimeout(
        () => update({ mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS }),
        BALANCE_UPDATE_DEBOUNCE_MS
    );
}

/**
 * Führt den Engine-Handshake beim Start durch
 *
 * Überprüft:
 * 1. Ob engine.js geladen wurde
 * 2. Ob die API-Version kompatibel ist (v31.x erforderlich)
 * 3. Zeigt ggf. Warnbanner bei Versionsinkompatibilität
 *
 * @throws {Error} Wenn Engine nicht geladen oder ungültig
 */
export function initVersionHandshake() {
    appState.engineHandshake = null;
    try {
        const handshake = createEngineHandshake(window.EngineAPI, REQUIRED_ENGINE_API_VERSION_PREFIX);
        appState.engineHandshake = handshake;
        const alertBanner = dom.containers.versionAlert;
        if (alertBanner) {
            alertBanner.textContent = '';
            alertBanner.style.display = 'none';
        }
        return handshake;
    } catch (e) {
        const alertBanner = dom.containers.versionAlert;
        if (alertBanner) {
            alertBanner.textContent = `FATALER FEHLER: ${e.message} Die Anwendung kann nicht gestartet werden.`;
            alertBanner.style.display = 'block';
            alertBanner.classList.remove('ds-note-warning');
            alertBanner.classList.add('ds-note', 'ds-note-error');
            alertBanner.style.backgroundColor = 'var(--bad-soft)';
            alertBanner.style.color = 'var(--bad)';
            alertBanner.tabIndex = -1;
        }
        throw e;
    }
}

export function renderPersistenceStartupWarning(status, target = dom.containers.versionAlert) {
    const warning = status?.migrationWarning;
    if (!warning || !target) return false;

    const backend = String(status.backend || 'unknown');
    const warningMessage = warning.code === 'tauri-state-corrupt'
        ? 'Gespeicherter Zustand konnte nicht sicher geladen werden.'
        : (warning.message || 'Gespeicherte Daten konnten nicht sicher uebernommen werden.');
    const quarantineHint = warning.quarantinePath
        ? ' Die beschaedigte Quelldatei wurde durch den Persistenzadapter quarantiniert.'
        : '';
    target.textContent = displayDiagnosisText(`Persistenzwarnung – betroffener Datenbereich: Gesamtspeicher; Backend: ${backend}. ${warningMessage}${quarantineHint} Ohne ausdrueckliche Recovery- oder Reset-Entscheidung werden keine Altdaten ersetzt.`);
    target.dataset.kind = 'persistence-warning';
    target.style.display = 'block';
    target.classList.remove('ds-note-error');
    target.classList.add('ds-note', 'ds-note-warning');
    target.style.backgroundColor = 'var(--warn-soft)';
    target.style.color = 'var(--warn)';
    target.tabIndex = -1;
    return true;
}

/**
 * Initialisiert die Anwendung - Entry Point
 *
 * Ablauf:
 * 1. Engine-Handshake (Versions-Check)
 * 2. Debug-Modus initialisieren
 * 3. DOM-Referenzen sammeln
 * 4. Alle Module initialisieren (mit Dependency Injection)
 * 5. Gespeicherten Zustand laden und anwenden
 * 6. Event-Listener binden
 * 7. Theme anwenden
 * 8. Snapshot-System initialisieren
 * 9. Erstes Update durchführen
 *
 * Module-Architektur:
 * - UIReader: Liest DOM-Eingaben
 * - StorageManager: localStorage + File System API
 * - UIRenderer: Rendert alle UI-Komponenten
 * - UIBinder: Event-Handler für alle Interaktionen
 */
let tranchenStorageBound = false;

let overviewTargetSelection = false;
export async function init() {
    if (window.__personMigrationDeferred) { showPersonDataStatus(readBalancePersonStatus()); return createBlockedUpdateResult('person_data_deferred'); }
    await initPersistence();
    // Derselbe einmalige Start wird auch vom Profil-Bridge benutzt. So wartet
    // Balance auf die Migration und bleibt als eigener Einstieg startfähig.
    const profileReady = initializeProfilePage({ doc: document, win: window });
    if (!await profileReady) {
        const host = document.getElementById('balanceAnnualRecovery');
        if (host) {
            host.hidden = false; host.textContent = 'Profilbestand nicht sicher verfügbar. Sicherung oder Wiederherstellungspunkt auf der Sicherungsseite prüfen. ';
            const link = document.createElement('a'); link.href = 'Daten-Sicherung.html#wiederherstellung';
            link.dataset.profileHandoff = ''; link.dataset.profileHandoffExport = 'false'; link.textContent = 'Daten & Sicherung öffnen'; host.appendChild(link);
        }
        return createBlockedUpdateResult('profile_recovery');
    }
    if (window.__personMigrationDeferred) { showPersonDataStatus(readBalancePersonStatus()); return createBlockedUpdateResult('person_data_deferred'); }
    if (await UIBinder.initializeWealthHistoryNavigation?.({ doc: document, win: window })) {
        return createBlockedUpdateResult('wealth_history_navigation');
    }
    const initialExpensesTarget = await UIBinder.initializeExpensesNavigation?.({ doc: document, win: window });
    if (initialExpensesTarget) {
        return createBlockedUpdateResult('expenses_navigation');
    }
    let planRefreshReady = false;
    await initializeHouseholdPlanPage({ doc: document, win: window, migrate: async options => {
        const result = await migrateHouseholdPlans(options);
        if (result.status === 'migrated' && planRefreshReady) {
            // Der bestätigte Write bleibt erfolgreich, auch wenn seine Anzeige fehlschlägt.
            try {
                UIReader.applyHouseholdPlanInputs();
                update({ mode: BALANCE_UPDATE_MODE.PREVIEW });
            } catch (error) { UIRenderer.handleError(error); }
        }
        return result;
    } });
    // Geschützte Navigation erst nach bestätigter Profilbereitschaft installieren.
    const forwardLegacyBackup = () => {
        if (window.location.hash === '#snapshot-management') openBalanceDataTarget('#wiederherstellung');
    };
    window.addEventListener('hashchange', forwardLegacyBackup);
    forwardLegacyBackup();
    const annualRetry = consumeAnnualRetry();
    const persistenceStatus = getPersistenceStatus();
    let engineHandshake;
    try {
        // 1. Engine Handshake
        // Prüft ob engine.js geladen ist und die Version kompatibel ist
        engineHandshake = initVersionHandshake();
        console.info("Engine ready and handshake successful.", engineHandshake.version);
    } catch (e) {
        console.error("Initialisierung abgebrochen wegen Engine-Fehler.");
        return createUpdateFailureResult(e, { phase: 'engine_gate' });
    }
    renderPersistenceStartupWarning(persistenceStatus);

    // 2. Populate DOM inputs
    // Sammelt alle input/select-Elemente mit ID in dom.inputs{}
    document.querySelectorAll('input, select').forEach(el => {
        if (el.id && !el.hasAttribute('data-annual-transient')) dom.inputs[el.id] = el;
    });

    initializeBalanceWealthHistory(dom.wealthHistory);

    // 4. Initialize all modules with their dependencies
    // Dependency Injection Pattern: Jedes Modul erhält seine Abhängigkeiten
    initUIReader(dom);
    initStorageManager(dom, appState, UIRenderer);
    initUIRenderer(dom, StorageManager);
    initUIBinder(dom, appState, update, debouncedUpdate);


    // Der Renderer ergänzt den aktuellen fachlichen Kontext bei jedem Plan.
    dom.outputs.printFooter.dataset.engineVersion = engineHandshake.version.api;
    dom.outputs.printFooter.textContent = '';

    // 6. Load and apply saved state
    // Lädt letzten Zustand aus localStorage und wendet ihn auf die Formular-Felder an
    refreshBalanceWealthHistory(dom.wealthHistory);
    let persistentState;
    try { persistentState = StorageManager.loadState(); }
    catch (error) {
        // Auch bei beschädigter Historie bleibt die Anzeige samt Fehlermeldung bedienbar.
        UIBinder.bindUI();
        UIRenderer.handleError(error);
        return createUpdateFailureResult(error, { phase: 'persistence' });
    }
    UIReader.applyStoredInputs(persistentState.inputs);
    try { UIReader.applyHouseholdPlanInputs(); }
    catch (error) { UIRenderer.handleError(error); return createUpdateFailureResult(error, { phase: 'plan_recovery' }); }
    UIReader.renderMarketDataProvenance(
        persistentState?.[ANNUAL_MARKET_DATA_META_KEY] || null
    );
    profileSyncHandlers.syncProfileDerivedInputs();
    syncTranchenToInputs({ silent: true });
    initBalancePlanTrial({ doc: document, refresh: () => { clearTimeout(appState.debounceTimer); appState.debounceTimer = null; syncDynamicFlexPresetSelection(); refreshDynamicFlexControls(); UIReader.applySideEffectsFromInputs(); update({ mode: BALANCE_UPDATE_MODE.PREVIEW }); } });
    initDynamicFlexControls({ enableLocalPersistence: false });

    // 7. Bind UI events
    // Registriert alle Event-Listener (input, change, click, keyboard shortcuts)
    UIBinder.bindUI();

    // 8. Initialize snapshots
    // Prüft die Ordner-API und lädt gespeicherte Handles ohne Balance-Listenhosts.
    StorageManager.initSnapshots();

    // 9. Initial update
    // Führt ersten Berechnungs- und Render-Zyklus durch
    const initialUpdateResult = update({ mode: BALANCE_UPDATE_MODE.PREVIEW });
    // Befüllung, Bindung und Erstvorschau sind bis hier synchron; eine spätere
    // Dialogbestätigung kann daher keinen halb initialisierten Reader erreichen.
    planRefreshReady = initialUpdateResult?.ok === true;

    // Erhaltene Tranchen-Synchronisierung ohne Badgehost oder Badgetimer.
    if (!tranchenStorageBound) {
        window.addEventListener('storage', event => {
            if (event.key === 'depot_tranchen') syncTranchenToInputs({ silent: true });
            if (event.key === HOUSEHOLD_PLAN_KEY) UIReader.applyHouseholdPlanInputs();
            if (event.key === HOUSEHOLD_PLAN_KEY || event.key === 'depot_tranchen' || event.key === 'rs_profiles_v1') update({ mode: BALANCE_UPDATE_MODE.PREVIEW });
        });
        tranchenStorageBound = true;
    }

    profilverbundHandlers.initProfilverbundBalance();
    if (initialUpdateResult?.ok && annualRetry) await UIBinder.resumeAnnualRetry(annualRetry);
    if (initialUpdateResult?.ok && !annualRetry && parseOverviewTarget('balance', window.location)) {
        await initialUpdateResult.overviewPersistence;
        const ready = await whenProfileDisplayReady(document);
        overviewTargetSelection = true;
        try {
            if (parseOverviewTarget('balance', window.location)?.target === 'handlungsanweisung') {
                if (ready && !window.__profileRecoveryBlocker && !PersistenceFacade.hasSyncWriteBlocks()) {
                    document.getElementById('balanceTabOverview')?.click();
                    document.getElementById('balanceActionArea')?.scrollIntoView({ block: 'center' });
                }
            } else await UIBinder.openOverviewTarget(window.location, { ready });
        }
        finally { overviewTargetSelection = false; }
    }
    return initialUpdateResult;
}

// ==================================================================================
// APPLICATION ENTRY POINT
// ==================================================================================

document.addEventListener('DOMContentLoaded', init);
