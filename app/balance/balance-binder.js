import { initializeWealthHistoryNavigation } from '../shared/wealth-history-navigation.js';
import { projectAnnualCloseResult } from '../shared/annual-close-result.js';
import { registeredPlanTrial } from '../shared/plan-trial.js';
import { annualCloseArchiveReader } from '../shared/annual-close-evidence.js';
import { finalizeAnnualMonth, confirmAnnualMonthSummary } from '../shared/annual-close-session.js';
import { projectAnnualCloseRecovery } from '../shared/annual-close-recovery.js';
import { SnapshotArchive } from '../shared/snapshot-archive.js';
import { createClosePriceActions } from '../shared/close-price-actions.js';
import { readStartupPriceReport } from '../tranches/tranchen-startup-prices.js';
import { parseExpensesTarget, navigateExpenses } from '../shared/expenses-navigation.js';
import { createAnnualOperationLock } from '../shared/annual-operation-lock.js';
import { createAnnualEngineLoader } from '../shared/annual-engine-loader.js';
import { commitAnnualPlanUpdate } from './balance-annual-storage-commit.js';
/** Verwendet die bereits delegierte, geschützte lokale Seitennavigation. */
/**
 * @param target Eingabe für die bestehende Projektion.
 * @param snapshotId Eingabe für die bestehende Projektion.
 * @param doc Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function openBalanceDataTarget(target = '#wiederherstellung', snapshotId, doc = globalThis.document) {
    const link = doc.createElement('a');
    link.setAttribute('href', 'Daten-Sicherung.html' + (snapshotId ? '?punkt=' + encodeURIComponent(snapshotId) : '') + target);
    link.setAttribute('data-profile-handoff', ''); link.setAttribute('data-profile-handoff-export', 'false');
    link.hidden = true; doc.body.appendChild(link); link.click(); link.remove();
}
function openDataRecovery(snapshotId) { openBalanceDataTarget('#wiederherstellung', snapshotId); }
import { reportAnnualActionError, clearAnnualActionError, finishAnnualPreflight } from './balance-annual-modal.js';
import { loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { CONFIG } from './balance-config.js';
import { createBalanceCloseCoordinator, createAnnualMonthSession } from './balance-close-coordinator.js';
import { bindOverviewExampleExpenses, createOverviewExpensesWealthCapture } from '../overview/overview-example-expenses.js';
import { captureCashPeople } from '../profile/profile-cash-update.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { isSyntheticPriceMode } from '../shared/market-price-adapter.js';
import { appNow } from '../shared/app-clock.js';
import { registerProfileInputFlush } from '../profile/profile-navigation.js';
import { displayDiagnosisText } from './balance-diagnosis-transaction.js';
/**
 * Module: Balance Binder (UI Binder)
 * Purpose: Centralizes Event Handling and wiring for the Balance App.
 *          It connects DOM events (clicks, inputs, shortcuts) to the appropriate logic handlers (Annual, Imports, Diagnosis, Snapshots).
 * Usage: Initialized by balance-main.js to set up all event listeners.
 * Dependencies: balance-reader.js, balance-renderer.js, balance-storage.js, balance-binder-*.js
 */
"use strict";

/**
 * ===================================================================================
 * BALANCE-APP EVENT-HANDLER
 * ===================================================================================
 */

import { UIUtils } from './balance-utils.js';
import { UIReader } from './balance-reader.js';
import { UIRenderer } from './balance-renderer.js';
import { StorageManager } from './balance-storage.js';
import { createAnnualHandlers } from './balance-binder-annual.js';
import { createImportExportHandlers } from './balance-binder-imports.js';
import { createDiagnosisHandlers } from './balance-binder-diagnosis.js';
import { bindBalanceInfoPopups } from './balance-renderer-diagnosis.js';
import { createSnapshotHandlers, validateAnnualRetry } from './balance-binder-snapshots.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { createManualAnnualQuote } from './balance-annual-marketdata.js';
import { BALANCE_UPDATE_MODE, createBalanceDisplayEngineApi } from './balance-update-pipeline.js';
import { createBalanceWealthHistoryService, createManualWealthHistoryController } from './balance-wealth-history.js';
import { refreshBalanceWealthHistory } from './balance-wealth-history-renderer.js';
import { createExpensesWealthCaptureController } from './balance-expenses-wealth-capture.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { bindBalancePresentationControls } from './balance-presentation-controls.js';
import { refreshDynamicFlexControls } from '../simulator/simulator-main-dynamic-flex.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { parseOverviewTarget, projectOverviewWithAnnualArchive, projectAnnualClosePreparation } from '../overview/overview-model.js';
import { readOverviewSummary, OVERVIEW_SUMMARY_KEY } from '../overview/overview-storage.js';
import { loadExpensesStoreResult } from './balance-expenses-storage.js';

// Module-level references
let dom = null;
let appState = null;
let update = null;
let debouncedUpdate = null;
let lastUpdateResults = null;
let handlers = null;
let uiBound = false;
let annualEntryInFlight = false;
let annualDialogOpener = null;
let annualRetryInFlight = false;
const consumedRetryRequests = new WeakSet();
const wealthButtonsBound = new WeakSet();
const wealthControllers = new WeakMap();
const tabButtonsBound = new WeakSet();
const presentationDocumentsBound = new WeakSet();

// In-Process-Tests stellen die vorherige Bindung nach ihren isolierten Fixtures wieder her.
/**
 * @returns Ergebnis der bestehenden Operation.
 */
export function preserveUIBinderStateForTests() {
    const previous = { dom, appState, update, debouncedUpdate, lastUpdateResults, handlers,
        uiBound, annualEntryInFlight, annualDialogOpener, annualRetryInFlight };
    const restore = () => {
        ({ dom, appState, update, debouncedUpdate, lastUpdateResults, handlers,
            uiBound, annualEntryInFlight, annualDialogOpener, annualRetryInFlight } = previous);
    };
    // Erlaubt Vorbereitungsbarrieren und Timer-/DOM-Proben am echten Handler im Node-Test.
    restore.handlers = previous.handlers;
    restore.appState = previous.appState;
    restore.dom = previous.dom;
    return restore;
}

// Flüchtige Darstellungszustände; keine Profil- oder Finanzpersistenz.
function bindBalancePresentation() {
    if (presentationDocumentsBound.has(document)) return;
    presentationDocumentsBound.add(document);
    bindBalancePresentationControls(document.getElementById('tab-strategy'), {
        onParametersToggle: open => {
            const advanced = document.getElementById('dynamicFlexShowAdvanced');
            if (advanced) advanced.checked = open;
            refreshDynamicFlexControls();
        }
    });
    const dialog = document.getElementById('actionDetailsDialog');
    let actionTrigger = null;
    // FR-77: Derselbe Dialog zeigt „Details & Drucken“ des Plans (Beleg) oder die Details der Vorschau.
    const showMode = mode => {
        if (!dialog) return;
        const plan = mode === 'plan' && Boolean(document.getElementById('balancePlanDetails')?.children.length);
        dialog.dataset.actionDetailsMode = plan ? 'plan' : 'preview';
        const head = dialog.querySelector?.('.balance-action-dialog-head');
        for (const node of [head, document.getElementById('handlungsanweisung'), document.getElementById('actionPurposeContent'),
            dialog.querySelector?.('.balance-action-note'), dialog.querySelector?.('.ds-actions'), document.getElementById('balancePlayExecutionStatus')]) {
            if (node) /** @type {HTMLElement} */ (node).hidden = plan;
        }
        const planHost = document.getElementById('balancePlanDetails');
        if (planHost) planHost.hidden = !plan;
        dialog.setAttribute('aria-labelledby', plan ? 'balancePlanDetailsTitle' : 'actionDetailsTitle');
    };
    const open = (trigger, mode = 'preview') => {
        if (!dialog || dialog.open) return;
        actionTrigger = trigger;
        showMode(mode);
        dialog.showModal();
        document.getElementById('closeActionDetails')?.focus();
    };
    // Der Planknopf entsteht mit der Karte neu; deshalb ein Listener am Dokument.
    document.addEventListener('click', event => {
        const trigger = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target)?.closest?.('[data-action-details]'));
        if (trigger) open(trigger, trigger.dataset.actionDetails);
    });
    document.getElementById('closeActionDetails')?.addEventListener('click', () => dialog.close());
    dialog?.addEventListener('close', () => actionTrigger?.focus());
    dialog?.addEventListener('click', e => {
        const rect = dialog.getBoundingClientRect();
        if (e.target === dialog && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) dialog.close();
    });
    document.getElementById('balanceChangeScope')?.addEventListener('click', () => {
        UIBinder.selectTab(dom.containers.tabButtons?.querySelector('[data-tab="strategy"]'));
        const household = document.getElementById('profilverbund-profile-list');
        const target = /** @type {HTMLElement & {disabled?: boolean}} */ (household?.querySelector('input[type="checkbox"]:not(:disabled)') || household);
        if (target?.closest?.('[hidden]') || target?.disabled) return;
        target?.scrollIntoView?.({ block: 'center' });
        target?.focus();
    });
    document.getElementById('printAction')?.addEventListener('click', () => window.print());
    document.querySelectorAll('[data-balance-tab]').forEach(button => button.addEventListener('click', () => {
        UIBinder.selectTab(dom.containers.tabButtons?.querySelector(`[data-tab="${/** @type {HTMLElement} */ (button).dataset.balanceTab}"]`));
    }));
    bindBalanceInfoPopups();
}
const actionBlocked = () => {
    const guard = globalThis.document ? getPageNavigationGuard() : null;
    return Boolean(guard?.isBusy() || guard?.reasons().some(reason => reason.phase === 'commit'));
};

/** Fehlgeschlagene Eingaben brauchen einen Merker, keine abgelaufene Timer-ID. */
/**
 * @param state Eingabe für die bestehende Projektion.
 * @param result Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function trackBalanceInputSave(state, result) {
    const token = {};
    state.inputSaveToken = token;
    const blockedReason = {
        person_data_incomplete: 'Die Personenangaben sind noch unvollständig.',
        initial_state: 'Das Alter für den Planungsstart fehlt.'
    }[result?.reason];
    state.unsavedInput = result?.ok ? null : result?.error?.message || blockedReason || 'Bitte die Balance-Eingabe prüfen.';
    if (result?.overviewPersistence !== undefined) {
        result.overviewPersistence = Promise.resolve(result.overviewPersistence).then(confirmed => {
            if (state.inputSaveToken === token) state.unsavedInput = confirmed === false ? 'Die Speicherung der Plananzeige wurde nicht bestätigt.' : null;
            return confirmed;
        }).catch(() => {
            if (state.inputSaveToken === token) state.unsavedInput = 'Die Speicherung der Plananzeige wurde nicht bestätigt.';
            return false;
        });
    }
    return result || { ok: false };
}

/**
 * Initialisiert den UIBinder mit den notwendigen Abhängigkeiten
 */
/**
 * @param domRefs Eingabe für die bestehende Projektion.
 * @param state Eingabe für die bestehende Projektion.
 * @param updateFn Eingabe für die bestehende Projektion.
 * @param debouncedUpdateFn Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function initUIBinder(domRefs, state, updateFn, debouncedUpdateFn) {
    dom = domRefs;
    appState = state;
    update = updateFn;
    debouncedUpdate = debouncedUpdateFn;
    if (globalThis.document) registerProfileInputFlush(document, () => {
        const pending = state.debounceTimer;
        if (!pending) return state.unsavedInput ? { ok: false, error: new Error(state.unsavedInput) } : null;
        clearTimeout(pending);
        state.debounceTimer = null;
        const result = trackBalanceInputSave(state, updateFn({ mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS }));
        return result.ok ? result : { ...result, error: result.error || new Error(state.unsavedInput) };
    });
    uiBound = false;
    const readAnnualState = () => loadStoredBalanceStateFromData({ [CONFIG.STORAGE.LS_KEY]: persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY) }).value || {};
    let priceReport = readStartupPriceReport();
    const getAnnualModel = annualTargetYear => {
        const liveData = Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i)).map(key => [key, persistenceStorage.getItem(key)]));
        const model = /** @type {import('../../typcheck/balance-ui.js').ProjectOverviewWithArchive} */ (projectOverviewWithAnnualArchive)({ registry: loadProfileRegistry().value, activeId: persistenceStorage.getItem('rs_current_profile'), liveData,
            priceReport, ...(Number.isInteger(annualTargetYear) ? { annualTargetYear } : {}),
            recovery: Boolean(globalThis.window?.__profileRecoveryBlocker || globalThis.window?.__balanceMonthRecovery), balanceSingleFallback: true }, { onChange: () => UIRenderer.renderContext(appState.inputs) });
        return projectAnnualClosePreparation(model, { store: loadExpensesStoreResult(persistenceStorage).store,
            annualBudgetSummary: readOverviewSummary(liveData[OVERVIEW_SUMMARY_KEY], model.occasion?.closingYear, model.scope) });
    };
    const priceActions = /** @type {import('../../typcheck/balance-ui.js').WithOptions<typeof createClosePriceActions, {getModel: ()=>import('../../typcheck/balance-ui.js').OverviewModel, onReport?: (report: unknown)=>void}>} */ (/** @type {unknown} */ (createClosePriceActions))({ getModel: getAnnualModel, onReport: report => { priceReport = report; } });
    const annual = createAnnualHandlers({
        dom,
        appState,
        update,
        debouncedUpdate,
        getLastUpdateResults: () => lastUpdateResults,
        setLastUpdateResults: (value) => { lastUpdateResults = value; },
        getModel: getAnnualModel, priceActions
    });
    const imports = createImportExportHandlers({ dom, debouncedUpdate, update });
    const diagnosis = createDiagnosisHandlers({ dom, appState });
    const wealthHistory = createBalanceWealthHistoryService({
        guard: globalThis.document ? getPageNavigationGuard() : null
    });
    const snapshots = /** @type {import('../../typcheck/balance-ui.js').WithOptions<typeof createSnapshotHandlers, {createAnnualSnapshot?: unknown, operationLock?: unknown, engineLoader?: unknown}>} */ (createSnapshotHandlers)({
        wealthHistory,
        onAnnualWealthSaved: () => {
            if (dom.wealthHistory?.status) dom.wealthHistory.status.textContent = 'Stand gesichert';
        },
        dom,
        appState,
        debouncedUpdate,
        applyAnnualInflation: annual.applyAnnualInflation,
        runAnnualUpdate: annual.prepareAnnualUpdate,
        showContinuation: annual.showAnnualContinuation,
        reportAnnualError: reportAnnualActionError,
        clearAnnualError: clearAnnualActionError,
        openRecovery: openDataRecovery,
        showPlanningStart: annual.showPlanningStart,
        openExpensesYear: year => UIBinder.openExpensesYear(year),
        // Vorbereitung braucht den lesenden Koordinator. Abweichende
        // Überblicks-/Periodenzustände dürfen keinen unversorgten Dialog öffnen.
        confirmAnnual: async () => {
            UIRenderer.toast('Der Jahresabschluss kann nicht vorbereitet werden. Bitte prüfen Sie den Profil- und Periodenstand sowie die Sicherungsverwaltung.', 'info');
            return null;
        },
        validateLiveState: () => update({ mode: BALANCE_UPDATE_MODE.PREVIEW }),
        flushLiveState: async ({ sync = true } = {}) => {
            const pending = appState.debounceTimer;
            if (pending) {
                clearTimeout(pending);
                appState.debounceTimer = null;
            }
            const result = sync || pending
                ? update({ mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS })
                : { ok: true };
            if (!result?.ok) {
                throw result?.error || new Error('Balance-Zustand konnte nicht validiert und gespeichert werden.');
            }
            if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        },
        engineLoader: createAnnualEngineLoader({ readActiveApi: () => createBalanceDisplayEngineApi(window.EngineAPI) }),
        commitLiveState: options => commitAnnualPlanUpdate(options),
        projectAnnualState: committed => {
            if (appState.debounceTimer) clearTimeout(appState.debounceTimer);
            appState.debounceTimer = null;
            appState.pendingInputMetadata = {};
            UIReader.applyStoredInputs(StorageManager.loadState().inputs);
            UIReader.applyHouseholdPlanInputs();
            const shown = update({ mode: BALANCE_UPDATE_MODE.PREVIEW, confirmedAnnualResult: committed.result });
            if (!shown?.ok) throw shown?.error || new Error('Der bestätigte Jahresstand konnte nicht angezeigt werden.');
        }
    });
    const captureButton = dom.controls?.captureWealthBtn;
    const manual = (captureButton && wealthControllers.get(captureButton)) || createManualWealthHistoryController({
        service: wealthHistory,
        update: options => update(options),
        refresh: () => refreshBalanceWealthHistory(dom.wealthHistory),
        button: dom.controls?.captureWealthBtn,
        status: dom.wealthHistory?.status,
        annualButtons: [],
        toast: text => UIRenderer.toast(text)
    });
    if (captureButton) wealthControllers.set(captureButton, manual);
    const expensesWealth = createExpensesWealthCaptureController({
        service: wealthHistory,
        update: options => update(options),
        refresh: () => {
            refreshBalanceWealthHistory(dom.wealthHistory);
        },
        toast: (text, type) => UIRenderer.toast(text, type),
        clearError: scope => UIRenderer.clearActionError(scope),
        reportError: (error, scope) => UIRenderer.handleActionError(error, scope)
    });
    let closeImports;
    const closeCoordinator = /** @type {import('../../typcheck/balance-ui.js').WithOptions<typeof createBalanceCloseCoordinator, {readContext: ()=>unknown, fetchers: object, showPreparation: (...args: unknown[])=>unknown}>} */ (createBalanceCloseCoordinator)({
        readContext: () => {
            const model = getAnnualModel(), year = model.occasion.closingYear;
            return { activeId: persistenceStorage.getItem('rs_current_profile'), active: persistenceStorage.getItem('rs_active_profile'),
                scope: model.scope?.key, date: appNow().toDateString(), synthetic: isSyntheticPriceMode(),
                year: model.occasion?.closingYear,
                people: readBalancePersonStatus({ referenceYear: year + 1 }).entries?.map(entry => ({ id: entry.profileId, name: entry.name,
                    values: Object.fromEntries(Object.entries(entry.data).filter(([key]) => key.startsWith('profile_') && key !== 'profile_tagesgeld')) })),
                cash: captureCashPeople({ ids: model.scope?.ids || [], activeId: model.activeId }),
                lastState: readAnnualState()?.lastState, marketMeta: readAnnualState()?.annualMarketDataMeta,
                plan: persistenceStorage.getItem('household_plan_v1'),
                metadata: readAnnualState()?.annualPeriodMetadata,
                inputs: Object.fromEntries(Object.entries(dom.inputs).map(([key, input]) => [key, input.type === 'checkbox' ? input.checked : input.value])) };
        },
        fetchers: { inflation: annual.prepareInflation, etf: annual.prepareETF, cape: annual.prepareCape },
        showPreparation: annual.showAnnualPreparation,
        getImports: () => closeImports,
        guard: globalThis.document ? getPageNavigationGuard() : null
    });
    const ensureCloseImports = () => {
        if (closeImports) return closeImports;
        const refresh = () => { closeCoordinator.refresh(); closeImports.syncButtons(); };
        const capture = createOverviewExpensesWealthCapture({ doc: document, win: globalThis.window, refresh,
            report: text => closeImports?.reportWealth(text) });
        closeImports = bindOverviewExampleExpenses({ doc: document, win: globalThis.window,
            getModel: () => closeImports.projectModel(getAnnualModel()), refresh, wealthCapture: capture });
        return closeImports;
    };

    handlers = { annual, imports, diagnosis, snapshots, wealthHistory, manual, expensesWealth, closeCoordinator, getAnnualModel, ensureCloseImports, readAnnualState };
}

export const UIBinder = {
    handleExpensesImported() {
        if (actionBlocked()) return;
        return handlers.expensesWealth.afterImport();
    },
    bindUI() {
        if (uiBound) return;
        const captureButton = dom.controls?.captureWealthBtn;
        if (captureButton && !wealthButtonsBound.has(captureButton)) {
            captureButton.addEventListener('click', () => this.handleCaptureWealth());
            wealthButtonsBound.add(captureButton);
        }
        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));

        dom.containers.form?.addEventListener('input', this.handleFormInput.bind(this));
        dom.containers.form?.addEventListener('change', this.handleFormChange.bind(this));
        document.querySelectorAll('input.currency').forEach(el => {
            el.addEventListener('blur', (e) => {
                if (e.target.dataset.planFieldSource !== 'household-plan') e.target.value = UIUtils.formatNumber(UIUtils.parseCurrency(e.target.value));
            });
        });

        if (dom.containers.tabButtons && !tabButtonsBound.has(dom.containers.tabButtons)) {
            dom.containers.tabButtons?.addEventListener('click', this.handleTabClick.bind(this));
            dom.containers.tabButtons?.addEventListener('keydown', this.handleTabKeydown.bind(this));
            tabButtonsBound.add(dom.containers.tabButtons);
        }
        dom.controls?.copyAction?.addEventListener('click', async () => {
            const text = UIRenderer.getActionCopyText();
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                UIRenderer.toast('Kopiert.');
            } catch (error) { UIRenderer.handleActionError(error, 'copyAction'); }
        });
        if (dom.controls?.btnJahresUpdateLog) {
            dom.controls?.btnJahresUpdateLog?.addEventListener('click', this.handleShowUpdateLog.bind(this));
        }
        if (dom.controls?.exportBtn?.tagName !== 'A') dom.controls?.exportBtn?.addEventListener('click', this.handleExport.bind(this));
        if (dom.controls?.importBtn?.tagName !== 'A') dom.controls?.importBtn?.addEventListener('click', () => { if (!actionBlocked()) dom.controls?.importFile?.click(); });
        dom.controls?.importFile?.addEventListener('change', this.handleImport.bind(this));
        if (dom.controls?.connectFolderBtn?.tagName !== 'A') dom.controls?.connectFolderBtn?.addEventListener('click', async () => {
            if (actionBlocked()) return;
            try { await StorageManager.connectFolder(); }
            catch (error) { UIRenderer.handleActionError(error, 'snapshots'); }
        });

        dom.outputs.snapshotList?.addEventListener('click', this.handleSnapshotActions.bind(this));

        dom.diagnosis?.copyBtn?.addEventListener('click', this.handleCopyDiagnosis.bind(this));
        dom.diagnosis?.filterToggle?.addEventListener('change', (e) => {
            dom.diagnosis.content?.classList.toggle('filter-inactive', e.target.checked);
        });
        bindBalancePresentation();
        uiBound = true;
    },

    handleKeyboardShortcuts(e) {
        if (e.altKey && ['e', 'i'].includes(e.key.toLowerCase()) && actionBlocked()) {
            e.preventDefault();
            return;
        }
        // Alt+E: zentraler Balance-Austausch.
        if (e.altKey && e.key === 'e') {
            e.preventDefault();
            openBalanceDataTarget('#dataBalanceExport');
            return;
        }

        // Alt+I: zentraler Balance-Import.
        if (e.altKey && e.key === 'i') {
            e.preventDefault();
            openBalanceDataTarget('#dataBalanceImport');
            return;
        }


    },

    handleFormInput(e) {
        if (actionBlocked()) return;
        if (e?.target?.type === 'file') return;
        appState.unsavedInput = null;
        appState.inputSaveToken = null;
        try { registeredPlanTrial(document)?.capture?.(); } catch (error) { UIRenderer.handleError(error); }
        const targetId = e.target.id;
        if (targetId && (targetId.startsWith('depotwert') || targetId === 'goldWert')) {
            appState.pendingInputMetadata = {
                ...(appState.pendingInputMetadata || {}),
                depotLastUpdate: Date.now()
            };
        }
        debouncedUpdate();
    },

    handleFormChange(e) {
        if (actionBlocked()) return;
        if (e?.target?.type === 'file') return;
        appState.unsavedInput = null;
        appState.inputSaveToken = null;
        try { registeredPlanTrial(document)?.capture?.(); } catch (error) { UIRenderer.handleError(error); }
        UIReader.applySideEffectsFromInputs();
        debouncedUpdate();
    },

    selectTab(clickedButton, focus = true) {
        if (!clickedButton || !dom.containers.tabButtons) return;
        dom.containers.tabButtons.querySelectorAll('.tab-btn').forEach(button => {
            const selected = button === clickedButton;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
            button.setAttribute('tabindex', selected ? '0' : '-1');
        });
        dom.containers.tabPanels.forEach(panel => {
            const selected = panel.id === 'tab-' + clickedButton.dataset.tab;
            panel.classList.toggle('active', selected);
            panel.hidden = !selected;
        });
        if (focus) clickedButton.focus();
        refreshBalanceWealthHistory(dom.wealthHistory);
    },

    async prepareExpensesNavigation() {
        // Der gemeinsame beforeLeave-Hook sichert das Formular und nennt
        // Fehlschläge im Verlustdialog auch bei Hashzielen.
        return Boolean(appState && update && !actionBlocked() && !annualEntryInFlight && !annualRetryInFlight);
    },

    openExpensesYear(year) {
        if (!Number.isInteger(year) || year < 1900 || year > 9999 || annualEntryInFlight || annualRetryInFlight || actionBlocked()) return false;
        if (!handlers.annual.closeAnnualModal()) return false;
        return navigateExpenses({ target: 'ausgaben', year, month: null }, { beforeLeave: () => this.prepareExpensesNavigation() });
    },

    handleTabClick(e) {
        this.selectTab(e.target.closest('.tab-btn'));
    },

    handleTabKeydown(e) {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        const buttons = [...dom.containers.tabButtons.querySelectorAll('.tab-btn')];
        const index = buttons.indexOf(e.target.closest('.tab-btn'));
        if (index < 0) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
            : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        this.selectTab(buttons[next]);
    },

    handleExport() {
        if (actionBlocked()) return;
        handlers.imports.handleExport();
    },

    async handleImport(e) {
        if (actionBlocked()) return;
        if (!e?.target?.files?.[0]) return;
        try { return await handlers.imports.handleImport(e); }
        finally {
            if (dom.wealthHistory?.status) dom.wealthHistory.status.textContent = '';
            refreshBalanceWealthHistory(dom.wealthHistory);
        }
    },

    async handleFetchInflation() {
        return handlers.annual.handleFetchInflation();
    },

    /**
     * Rendert das Ergebnis-Modal für den Jahres-Update-Prozess und bindet Close-Handler.
     * @param {Object} results Aggregiertes Ergebnisobjekt aus Inflation, ETF-Daten und Altersfortschritt.
     * @returns {void}
     */
    showUpdateResultModal(results) {
        return handlers.annual.showUpdateResultModal(results);
    },

    /**
     * Öffnet das Ergebnis-Modal erneut, um das letzte gespeicherte Protokoll anzuzeigen.
     * @returns {void}
     */
    handleShowUpdateLog() {
        return handlers.annual.handleShowUpdateLog();
    },

    async handleNachrueckenMitETF() {
        return handlers.annual.handleNachrueckenMitETF();
    },

    async handleJahresabschluss(options = {}) {
        if (annualEntryInFlight || annualRetryInFlight || actionBlocked()) return { status: 'in_flight' };
        const trial = registeredPlanTrial(document);
        if (trial?.read().active) { clearTimeout(appState.debounceTimer); appState.debounceTimer = null; trial.reset(); trial.render?.({ project: true }); UIReader.applyHouseholdPlanInputs(); }
        annualEntryInFlight = true;
        annualDialogOpener = (options.isTrusted === true ? options.currentTarget : null) || options.opener || document.activeElement;
        let annualLease, rereadArchive = true;
        // Nur echte Nutzerereignisse öffnen am Kopfknopf; .click()-Weiterleitungen
        // behalten ihr Eintrittsziel. currentTarget vor Ende der Dispatchphase lesen.
        const annualOptions = /** @type {import('../../typcheck/balance-ui.js').AnnualEntryOptions} */ ({ ...options, opener: annualDialogOpener });
        try {
            try { annualLease = await createAnnualOperationLock().acquire(); }
            catch (error) { reportAnnualActionError(error); return { status: 'invalid', error }; }
            if (!annualLease) { rereadArchive = false; reportAnnualActionError(new Error('Eine andere Seite hält den Jahresbesitz.')); return { status: 'in_flight' }; }
            annualOptions.annualLease = annualLease;
            let model = handlers.getAnnualModel();
            annualOptions.targetYear = options.resume?.targetYear ?? model.occasion.closingYear;
            if (model.recovery) {
                UIRenderer.toast('Der Jahresabschluss kann nicht vorbereitet werden. Bitte prüfen Sie den Profil- und Periodenstand sowie die Sicherungsverwaltung.', 'info');
                return { status: 'cancelled' };
            }
            if (!options.resume && !handlers.readAnnualState()?.annualPeriodMetadata?.pendingCommit) {
                await annualCloseArchiveReader.refresh({ targetYear: annualOptions.targetYear, activeId: model.activeId, scope: model.scope });
                model = handlers.getAnnualModel();
                const period = await handlers.snapshots.reconcileAnnualPeriod({ targetYear: annualOptions.targetYear, annualLease, clarify: true, opener: annualDialogOpener });
                model = handlers.getAnnualModel();
                if (period.status === 'cancelled') return period;
                if (period.status === 'legacy_confirmation_required') { reportAnnualActionError(new Error(period.errors.map(entry => entry.message).join(' '))); return period; }
            }
            if (options.resume) {
                if (!await /** @type {(value: unknown, options: {dom: unknown})=>Promise<boolean>} */ (validateAnnualRetry)(options.resume, { dom })) return { status: 'cancelled' };
                const targetYear = options.resume.targetYear;
                const before = handlers.closeCoordinator.contextFingerprint();
                handlers.annual.showAnnualContinuation({ targetYear, opener: annualDialogOpener });
                const people = captureCashPeople({ ids: model.scope?.ids || [], activeId: model.activeId });
                if (people.some(person => person.error || !options.resume.cash && (!Number.isFinite(person.value) || person.value < 0))) throw new Error('Die wiederhergestellten Tagesgeldquellen sind nicht gültig.');
                const controller = new AbortController();
                let reading;
                const lease = getPageNavigationGuard().register(Symbol('annual-resume-read'), {
                    read: () => ({ phase: 'running', message: 'Die Wiederaufnahme liest Jahresdaten.' }),
                    cancel: async () => { controller.abort(); await reading.catch(() => {}); handlers.annual.abortContinuation(); return true; }
                });
                let inflation, cape;
                try {
                    reading = Promise.all([handlers.annual.prepareInflation({ targetYear, signal: controller.signal }), handlers.annual.prepareCape({ targetYear, signal: controller.signal })]);
                    [inflation, cape] = await reading;
                    controller.signal.throwIfAborted();
                } catch (error) {
                    if (controller.signal.aborted) { handlers.annual.abortContinuation(); return { status: 'cancelled' }; }
                    throw error;
                } finally { lease.unregister(); }
                if (before !== handlers.closeCoordinator.contextFingerprint()) throw new Error('Der Wiederaufnahmekontext wurde während des Abrufs geändert.');
                if (cape.capeFetchStatus === 'error_no_source_no_stored') throw new Error('Keine CAPE-Quelle für die Wiederaufnahme verfügbar.');
                // Die gewählte Lesart des Hochs reist mit (FR-71); ein unpassendes Hoch lässt den Abschluss abbrechen.
                annualOptions.confirmedPreparation = { manualPrice: options.resume.price,
                    adoptedPlanPatch: options.resume.adoptedPlanPatch, careValues: options.resume.careValues, careToday: options.resume.careToday,
                    ...(options.resume.yearHigh ? { yearHigh: options.resume.yearHigh } : {}),
                    ...(options.resume.cash ? { cash: options.resume.cash }
                        : people.length ? { cash: { people, values: Object.fromEntries(people.map(person => [person.id, person.value])) } } : {}),
                    preparedMarketData: { inflation, cape } };
                annualOptions.manualPrice = options.resume.price;
                annualOptions.onProgress = handlers.annual.setProgress;
            } else if ((model.occasion?.annualState === 'open' || model.occasion?.annualState === 'unclear' && model.occasion?.annualReason === 'missing_commit') && !handlers.readAnnualState()?.annualPeriodMetadata?.pendingCommit) {
                const closeImports = handlers.ensureCloseImports();
                const targetYear = annualOptions.targetYear;
                const confirmedPreparation = await handlers.closeCoordinator.prepare({ targetYear, model: closeImports.projectModel(model), getModel: () => closeImports.projectModel(handlers.getAnnualModel()),
                    people: captureCashPeople({ ids: model.scope?.ids || [], activeId: model.activeId }), opener: annualDialogOpener,
                    validatePrice: value => ({ manualPrice: createManualAnnualQuote(value, `calendar-year:${targetYear}`).price }) });
                if (!confirmedPreparation) return { status: 'cancelled' };
                annualOptions.confirmedPreparation = confirmedPreparation;
                annualOptions.manualPrice = options.resume?.price ?? confirmedPreparation.manualPrice;
                annualOptions.onProgress = handlers.annual.setProgress;
            } else {
                // Auch Legacy-Metadaten erst nach einer versorgten Vorbereitung
                // auflösen; der Fallback meldet zuvor den Schutzabbruch.
                annualOptions.preparationFirst = true;
            }
            const result = await handlers.manual.withAnnual(() => handlers.snapshots.handleJahresabschluss(annualOptions));
            // Beim Vorbereitungsabbruch war der Öffner im Modal-Schließhandler
            // gegebenenfalls noch deaktiviert. withAnnual hat ihn jetzt freigegeben.
            if (result?.status === 'cancelled' && !document.getElementById('balanceAnnualClose')?.open
                && !actionBlocked()) annualOptions.opener?.focus?.();
            // Der Koordinator hat den Erstjahrhinweis bereits geöffnet.
            if (result?.status === 'not_applicable') return result;
            if (result?.status === 'already_committed' && !result.results) {
                UIRenderer.toast(`Die Jahresperiode ${result.periodId.slice('calendar-year:'.length)} wurde bereits abgeschlossen.`, 'info');
            }
            const recovery = await projectAnnualCloseRecovery(result, { archive: SnapshotArchive, metadata: handlers.readAnnualState()?.annualPeriodMetadata });
            if (result?.results || recovery) {
                handlers.annual.publishResult({ ...result, results: result.results || { targetYear: annualOptions.targetYear, confirmed: false } });
                const context = result.retryContext;
                const modalResult = { ...lastUpdateResults, recovery };
                modalResult.displayPreview = annualOptions.confirmedPreparation?.displayPreview;
                modalResult.openRecovery = () => {
                    UIBinder.selectTab(dom.containers.tabButtons?.querySelector('[data-tab="strategy"]'));
                    openDataRecovery(recovery?.snapshotId || context?.snapshotId || StorageManager.loadState()?.annualPeriodMetadata?.pendingCommit?.snapshotId);
                };
                if (modalResult.confirmed && annualOptions.confirmedPreparation?.cash) {
                    const month = await /** @type {import('../../typcheck/balance-ui.js').WithOptions<typeof finalizeAnnualMonth, {options: object}>} */ (finalizeAnnualMonth)({ options: {
                            targetYear: modalResult.targetYear, annualSnapshotId: result.snapshotId,
                            cash: annualOptions.confirmedPreparation.cash, readModel: () => handlers.getAnnualModel(modalResult.targetYear),
                            readPending: () => handlers.readAnnualState()?.annualPeriodMetadata?.pendingCommit
                                || PersistenceFacade.hasSyncWriteBlocks(),
                            readContext: handlers.closeCoordinator.contextFingerprint,
                            guard: getPageNavigationGuard(),
                            annualLease,
                            confirmSummary: () => /** @type {import('../../typcheck/balance-ui.js').WithOptions<typeof confirmAnnualMonthSummary, {targetYear: number, scope: import('../../typcheck/datenvertraege.js').PlanScope, expectedProfileId: string}>} */ (confirmAnnualMonthSummary)({ targetYear: modalResult.targetYear,
                                scope: handlers.getAnnualModel().scope, expectedProfileId: handlers.getAnnualModel().activeId })
                    } });
                    modalResult.monthSession = month.session; modalResult.monthError = month.error?.message;
                    modalResult.retryMonth = async () => { const receipt = await month.retry(); modalResult.monthSession = month.session;
                        modalResult.actionResult = projectAnnualCloseResult({ ...modalResult, model: month.session?.model }); return receipt; };
                }
                if (context) {
                    modalResult.validatePrice = value => ({ manualPrice: createManualAnnualQuote(value, context.periodId).price });
                    modalResult.retry = async ({ manualPrice }) => {
                        if (annualRetryInFlight || annualEntryInFlight) return { status: 'in_flight' };
                        annualRetryInFlight = true;
                        try { return await handlers.snapshots.retryAnnualWithManualPrice(context, manualPrice,
                            { annualLease: annualLease.released ? undefined : annualLease }); }
                        finally { annualRetryInFlight = false; }
                    };
                }
                modalResult.actionResult = projectAnnualCloseResult({ ...modalResult, model: modalResult.monthSession?.model || handlers.getAnnualModel(modalResult.targetYear) });
                lastUpdateResults = modalResult;
                handlers.annual.showUpdateResultModal(modalResult);
            } else if (document.getElementById('balanceAnnualClose')?.open) {
                // Abbruch/Vorprüfungsfehler hat kein erfolgreiches Ergebnis.
                finishAnnualPreflight();
            }
            return result;
        } catch (error) {
            reportAnnualActionError(error);
            finishAnnualPreflight();
            throw error;
        } finally {
            // Abschließend auch neu gespeicherte Vorabpunkte lesen. Das folgende
            // Rendern klassifiziert aktuelle Finanzquellen ohne Fachwrites neu.
            try {
                if (rereadArchive) {
                    const next = handlers.getAnnualModel();
                    await annualCloseArchiveReader.refresh({ targetYear: next.occasion.closingYear, activeId: next.activeId, scope: next.scope });
                    UIRenderer.renderContext(appState.inputs);
                }
            } catch {
                // Lesung/Anzeige dürfen das ursprüngliche Ergebnis nicht ersetzen.
            }
            annualEntryInFlight = false;
            const dialog = document.getElementById('balanceAnnualClose');
            if (dialog?.open && annualLease) dialog.addEventListener('close', () => annualLease.release(), { once: true });
            else await annualLease?.release();
        }
    },

    openAnnualOverview() {
        const link = document.createElement('a'); link.href = 'index.html';
        link.setAttribute('data-profile-handoff', '');
        link.hidden = true; document.body.appendChild(link); link.click(); link.remove();
        return true;
    },

    /** @param {{doc?: Document, win?: Window & typeof globalThis, navigate?: typeof import("../shared/wealth-history-navigation.js").navigateWealthHistory}} [options] */
    initializeWealthHistoryNavigation({ doc = globalThis.document, win = globalThis.window, navigate } = {}) {
        return initializeWealthHistoryNavigation({ doc, win, navigate,
            beforeLeave: () => this.prepareExpensesNavigation() });
    },

    /** Stoppt bei einem initialen Altziel den Balance-Start auch bei verweigerter Navigation. */
    async initializeExpensesNavigation({ doc = globalThis.document, win = globalThis.window, navigate = navigateExpenses } = {}) {
        const initialTarget = parseExpensesTarget(win.location);
        win.addEventListener('hashchange', () => {
            const target = parseExpensesTarget(win.location);
            if (target) void navigate(target, { doc, win, beforeLeave: () => this.prepareExpensesNavigation() });
        });
        if (!initialTarget) return false;
        await navigate(initialTarget, { doc, win, replace: true });
        return true;
    },

    /** @returns {boolean|Promise<boolean>} Sofortige Ablehnung/Jahresaktion oder bestätigter Ausgabenseitenwechsel; Aufrufer müssen await verwenden. */
    openOverviewTarget(requestedLocation, { ready = false, navigate = navigateExpenses } = {}) {
        const request = parseOverviewTarget('balance', requestedLocation);
        const guard = getPageNavigationGuard();
        if (!ready || !request || globalThis.window?.__profileRecoveryBlocker || PersistenceFacade.hasSyncWriteBlocks()
            || annualEntryInFlight || annualRetryInFlight || actionBlocked()) return false;
        if (request.target === 'jahresabschluss') {
            if (guard.reasons().length) return false;
            if (request.year !== null && request.year !== handlers.getAnnualModel().occasion.closingYear) return false;
            return this.openAnnualOverview();
        }
        if (globalThis.window?.__profileRecoveryBlocker) return false;
        if (!['ausgaben', 'ausgaben-import'].includes(request.target)) return false;
        return navigate(request, { beforeLeave: () => this.prepareExpensesNavigation() });

    },

    async resumeAnnualRetry(request) {
        if (!request || consumedRetryRequests.has(request)) return { status: 'cancelled' };
        consumedRetryRequests.add(request);
        try {
            if (!await /** @type {(value: unknown, options: {dom: unknown})=>Promise<boolean>} */ (validateAnnualRetry)(request, { dom })) return { status: 'cancelled' };
            return await this.handleJahresabschluss({ resume: request });
        } catch (error) {
            reportAnnualActionError(error);
            return { status: 'invalid', error };
        }
    },

    async handleCaptureWealth() {
        if (actionBlocked()) return;
        // Einen bereits geplanten Inputwrite erst nach der Verlaufstransaktion ausführen.
        // Seine Eingaben liest die synchrone Vorschau schon jetzt vollständig.
        const pending = appState.debounceTimer;
        if (pending) {
            clearTimeout(pending);
            appState.debounceTimer = null;
        }
        try { return await handlers.manual.capture(); }
        finally { if (pending) debouncedUpdate(); }
    },

    async handleSnapshotActions(e) {
        try { return await handlers.snapshots.handleSnapshotActions(e); }
        finally {
            refreshBalanceWealthHistory(dom.wealthHistory);
        }
    },

    handleCopyDiagnosis() {
        return handlers.diagnosis.handleCopyDiagnosis();
    }
};
