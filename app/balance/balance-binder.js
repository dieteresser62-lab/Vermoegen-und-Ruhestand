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
    const open = trigger => {
        if (!dialog || dialog.open) return;
        actionTrigger = trigger;
        dialog.showModal();
        document.getElementById('closeActionDetails')?.focus();
    };
    document.getElementById('openActionDetails')?.addEventListener('click', e => open(e.currentTarget));
    document.getElementById('closeActionDetails')?.addEventListener('click', () => dialog.close());
    dialog?.addEventListener('close', () => actionTrigger?.focus());
    dialog?.addEventListener('click', e => {
        const rect = dialog.getBoundingClientRect();
        if (e.target === dialog && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) dialog.close();
    });
    document.getElementById('balanceNextAnnual')?.addEventListener('click', () => {
        UIBinder.openNextAnnual();
    });
    const marketUpdate = document.getElementById('balanceMarketUpdate');
    const annualButton = dom.controls?.jahresabschlussBtn;
    const nextAnnual = document.getElementById('balanceNextAnnual');
    const syncAnnualAccess = () => {
        if (marketUpdate) marketUpdate.disabled = Boolean(annualButton?.disabled || nextAnnual?.disabled);
    };
    marketUpdate?.addEventListener('click', () => {
        syncAnnualAccess();
        if (marketUpdate.disabled || actionBlocked()) return;
        annualButton?.click();
    });
    if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(syncAnnualAccess);
        for (const button of [annualButton, nextAnnual]) if (button) observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
    }
    // Fachabrufe liefern ältere Ladetexte; nur deren sichtbarer Host wird bereinigt.
    const progressButton = dom.controls?.btnJahresUpdate;
    if (progressButton && typeof MutationObserver !== 'undefined') {
        const normalizeProgressText = () => {
            const text = progressButton.textContent;
            const shown = displayDiagnosisText(text);
            if (shown !== text) progressButton.textContent = shown;
        };
        const observer = new MutationObserver(normalizeProgressText);
        observer.observe(progressButton, { childList: true, characterData: true, subtree: true });
        normalizeProgressText();
    }
    syncAnnualAccess();
    document.getElementById('balanceChangeScope')?.addEventListener('click', () => {
        UIBinder.selectTab(dom.containers.tabButtons?.querySelector('[data-tab="strategy"]'));
        const household = document.getElementById('profilverbund-profile-list');
        const target = household?.querySelector('input[type="checkbox"]:not(:disabled)') || household;
        if (target?.closest?.('[hidden]') || target?.disabled) return;
        target?.scrollIntoView?.({ block: 'center' });
        target?.focus();
    });
    document.getElementById('printAction')?.addEventListener('click', () => window.print());
    document.getElementById('printPlan')?.addEventListener('click', e => {
        open(e.currentTarget);
        window.print();
    });
    document.querySelectorAll('[data-balance-tab]').forEach(button => button.addEventListener('click', () => {
        UIBinder.selectTab(dom.containers.tabButtons?.querySelector(`[data-tab="${button.dataset.balanceTab}"]`));
    }));
    bindBalanceInfoPopups();
}
const actionBlocked = () => {
    const guard = globalThis.document ? getPageNavigationGuard() : null;
    return Boolean(guard?.isBusy() || guard?.reasons().some(reason => reason.phase === 'commit'));
};

/**
 * Initialisiert den UIBinder mit den notwendigen Abhängigkeiten
 */
export function initUIBinder(domRefs, state, updateFn, debouncedUpdateFn) {
    dom = domRefs;
    appState = state;
    update = updateFn;
    debouncedUpdate = debouncedUpdateFn;
    uiBound = false;
    const readAnnualState = () => loadStoredBalanceStateFromData({ [CONFIG.STORAGE.LS_KEY]: persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY) }).value || {};
    let priceReport = readStartupPriceReport();
    const getAnnualModel = () => {
        const liveData = Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i)).map(key => [key, persistenceStorage.getItem(key)]));
        const model = projectOverviewWithAnnualArchive({ registry: loadProfileRegistry().value, activeId: persistenceStorage.getItem('rs_current_profile'), liveData,
            priceReport, recovery: Boolean(globalThis.window?.__profileRecoveryBlocker || globalThis.window?.__balanceMonthRecovery), balanceSingleFallback: true }, { onChange: () => UIRenderer.renderContext(appState.inputs) });
        return projectAnnualClosePreparation(model, { store: loadExpensesStoreResult(persistenceStorage).store,
            annualBudgetSummary: readOverviewSummary(liveData[OVERVIEW_SUMMARY_KEY], model.occasion?.closingYear, model.scope) });
    };
    const priceActions = createClosePriceActions({ getModel: getAnnualModel, onReport: report => { priceReport = report; } });
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
    const snapshots = createSnapshotHandlers({
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
        annualButtons: [dom.controls?.jahresabschlussBtn, dom.controls?.btnJahresUpdate],
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
    const closeCoordinator = createBalanceCloseCoordinator({
        readContext: () => {
            const model = getAnnualModel(), year = appNow().getFullYear() - 1;
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
        dom.containers.bedarfAnpassung?.addEventListener('click', this.handleBedarfAnpassungClick.bind(this));
        dom.controls?.btnJahresUpdate?.addEventListener('click', this.handleJahresUpdate.bind(this));
        if (dom.controls?.btnJahresUpdateLog) {
            dom.controls?.btnJahresUpdateLog?.addEventListener('click', this.handleShowUpdateLog.bind(this));
        }
        if (dom.controls?.exportBtn?.tagName !== 'A') dom.controls?.exportBtn?.addEventListener('click', this.handleExport.bind(this));
        if (dom.controls?.importBtn?.tagName !== 'A') dom.controls?.importBtn?.addEventListener('click', () => { if (!actionBlocked()) dom.controls?.importFile?.click(); });
        dom.controls?.importFile?.addEventListener('change', this.handleImport.bind(this));
        dom.controls?.jahresabschlussBtn?.addEventListener('click', this.handleJahresabschluss.bind(this));
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
        if (e.altKey && ['j', 'e', 'i'].includes(e.key.toLowerCase()) && actionBlocked()) {
            e.preventDefault();
            return;
        }
        // Alt+J: Jahresabschluss
        if (e.altKey && e.key === 'j') {
            e.preventDefault();
            dom.controls?.jahresabschlussBtn?.click();
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
        if (!appState || !update || actionBlocked() || annualEntryInFlight || annualRetryInFlight) return false;
        if (!appState.debounceTimer) return true;
        clearTimeout(appState.debounceTimer);
        appState.debounceTimer = null;
        const result = update({ mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS });
        if (!result?.ok || await result.overviewPersistence === false || appState.debounceTimer) return false;
        return await PersistenceFacade.flush() !== false;
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

    handleBedarfAnpassungClick(e) {
        if (e.target.matches('.btn-apply-inflation')) {
            this.handleJahresabschluss();
        }
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
     * Startet den gemeinsamen fail-safe Jahresprozess. Jahres-Update und Jahresabschluss
     * teilen dadurch Perioden-ID, Snapshot und Idempotenz-Sperre.
     * @returns {Promise<Object|undefined>} Ergebnis des Jahresprozess-Coordinators.
     */
    async handleJahresUpdate() {
        return this.handleJahresabschluss();
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
        const annualOptions = { ...options, opener: annualDialogOpener };
        try {
            try { annualLease = await createAnnualOperationLock().acquire(); }
            catch (error) { reportAnnualActionError(error); return { status: 'invalid', error }; }
            if (!annualLease) { rereadArchive = false; reportAnnualActionError(new Error('Eine andere Seite hält den Jahresbesitz.')); return { status: 'in_flight' }; }
            annualOptions.annualLease = annualLease;
            let model = handlers.getAnnualModel();
            if (model.recovery) {
                UIRenderer.toast('Der Jahresabschluss kann nicht vorbereitet werden. Bitte prüfen Sie den Profil- und Periodenstand sowie die Sicherungsverwaltung.', 'info');
                return { status: 'cancelled' };
            }
            if (!options.resume && !handlers.readAnnualState()?.annualPeriodMetadata?.pendingCommit) {
                await annualCloseArchiveReader.refresh({ targetYear: appNow().getFullYear() - 1, activeId: model.activeId, scope: model.scope });
                model = handlers.getAnnualModel();
                const period = await handlers.snapshots.reconcileAnnualPeriod({ annualLease, clarify: true, opener: annualDialogOpener });
                model = handlers.getAnnualModel();
                if (period.status === 'cancelled') return period;
                if (period.status === 'legacy_confirmation_required') { reportAnnualActionError(new Error(period.errors.map(entry => entry.message).join(' '))); return period; }
            }
            if (options.resume) {
                if (!await validateAnnualRetry(options.resume, { dom })) return { status: 'cancelled' };
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
                annualOptions.confirmedPreparation = { manualPrice: options.resume.price,
                    adoptedPlanPatch: options.resume.adoptedPlanPatch,
                    ...(options.resume.cash ? { cash: options.resume.cash }
                        : people.length ? { cash: { people, values: Object.fromEntries(people.map(person => [person.id, person.value])) } } : {}),
                    preparedMarketData: { inflation, cape } };
                annualOptions.manualPrice = options.resume.price;
                annualOptions.onProgress = handlers.annual.setProgress;
            } else if ((model.occasion?.annualState === 'open' || model.occasion?.annualState === 'unclear' && model.occasion?.annualReason === 'missing_commit') && !handlers.readAnnualState()?.annualPeriodMetadata?.pendingCommit) {
                const closeImports = handlers.ensureCloseImports();
                const targetYear = appNow().getFullYear() - 1;
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
                handlers.annual.publishResult({ ...result, results: result.results || { targetYear: appNow().getFullYear() - 1, confirmed: false } });
                const context = result.retryContext;
                const modalResult = { ...lastUpdateResults, recovery };
                modalResult.displayPreview = annualOptions.confirmedPreparation?.displayPreview;
                modalResult.openRecovery = () => {
                    UIBinder.selectTab(dom.containers.tabButtons?.querySelector('[data-tab="strategy"]'));
                    openDataRecovery(recovery?.snapshotId || context?.snapshotId || StorageManager.loadState()?.annualPeriodMetadata?.pendingCommit?.snapshotId);
                };
                if (modalResult.confirmed && annualOptions.confirmedPreparation?.cash) {
                    const month = await finalizeAnnualMonth({ options: {
                            targetYear: modalResult.targetYear, annualSnapshotId: result.snapshotId,
                            cash: annualOptions.confirmedPreparation.cash, readModel: handlers.getAnnualModel,
                            readPending: () => handlers.readAnnualState()?.annualPeriodMetadata?.pendingCommit
                                || PersistenceFacade.hasSyncWriteBlocks(),
                            readContext: handlers.closeCoordinator.contextFingerprint,
                            guard: getPageNavigationGuard(),
                            annualLease,
                            confirmSummary: () => confirmAnnualMonthSummary({ targetYear: modalResult.targetYear,
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
                modalResult.actionResult = projectAnnualCloseResult({ ...modalResult, model: modalResult.monthSession?.model });
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
                    await annualCloseArchiveReader.refresh({ targetYear: appNow().getFullYear() - 1, activeId: next.activeId, scope: next.scope });
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

    openNextAnnual({ preparationFirst = false, opener } = {}) {
        const button = document.getElementById('balanceNextAnnual');
        if (dom.controls?.jahresabschlussBtn?.disabled || annualEntryInFlight || annualRetryInFlight || actionBlocked()
            || globalThis.window?.__profileRecoveryBlocker || PersistenceFacade.hasSyncWriteBlocks()) return false;
        const model = handlers.getAnnualModel();
        if (button?.disabled && model.occasion?.annualState !== 'not_applicable') return false;
        const pendingCommit = StorageManager.loadState()?.annualPeriodMetadata?.pendingCommit;
        if (button?.disabled && pendingCommit) return false;
        if (model.occasion?.annualState === 'recovery' || pendingCommit) {
            this.selectTab(dom.containers.tabButtons?.querySelector('[data-tab="strategy"]'));
            openDataRecovery(pendingCommit?.snapshotId);
            return true;
        }
        if (model.occasion?.annualState === 'not_applicable') {
            // Nur die fachliche Erstjahrsperre des Überblicksknopfs umgehen;
            // der geschützte Jahreshandler prüft die Planungsgrenze erneut.
            const visible = element => element && !element.disabled && !element.hidden
                && !element.closest?.('[hidden]') && element.isConnected !== false
                && (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0);
            const title = document.getElementById('overviewFocusTitle');
            const returnTarget = visible(opener) ? opener : visible(title) ? title : dom.controls?.jahresabschlussBtn;
            if (title && returnTarget === title) title.tabIndex = -1;
            void this.handleJahresabschluss({ opener: returnTarget }).catch(error => reportAnnualActionError(error));
            return true;
        }
        if (button?.disabled) return false;
        if (preparationFirst) {
            void this.openAnnualPreparation({ opener }).catch(error => reportAnnualActionError(error));
        } else dom.controls?.jahresabschlussBtn?.click();
        return true;
    },

    openAnnualPreparation(options = {}) {
        return this.handleJahresabschluss({ ...options, preparationFirst: true });
    },

    initializeWealthHistoryNavigation({ doc = globalThis.document, win = globalThis.window, navigate } = {}) {
        return initializeWealthHistoryNavigation({ doc, win, navigate,
            beforeLeave: () => !appState?.debounceTimer && !actionBlocked() && !annualEntryInFlight && !annualRetryInFlight });
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
            || annualEntryInFlight || annualRetryInFlight || actionBlocked() || guard.reasons().length) return false;
        if (request.target === 'jahresabschluss') {
            if (request.year !== null && request.year !== appNow().getFullYear() - 1) return false;
            return this.openNextAnnual({ preparationFirst: true });
        }
        if (globalThis.window?.__profileRecoveryBlocker) return false;
        if (!['ausgaben', 'ausgaben-import'].includes(request.target)) return false;
        return navigate(request, { beforeLeave: () => this.prepareExpensesNavigation() });

    },

    async resumeAnnualRetry(request) {
        if (!request || consumedRetryRequests.has(request)) return { status: 'cancelled' };
        consumedRetryRequests.add(request);
        try {
            if (!await validateAnnualRetry(request, { dom })) return { status: 'cancelled' };
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
