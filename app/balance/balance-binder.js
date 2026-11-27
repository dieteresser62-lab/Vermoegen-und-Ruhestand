import { bindDialogBackdrop } from '../shared/dialog-backdrop.js';
import { registeredPlanTrial } from '../shared/plan-trial.js';
import { readStartupPriceReport } from '../tranches/tranchen-startup-prices.js';
import { parseExpensesTarget, navigateExpenses } from '../shared/expenses-navigation.js';
import { registerProfileInputFlush } from '../profile/profile-navigation.js';
/**
 * Module: Balance Binder (UI Binder)
 * Purpose: Centralizes Event Handling and wiring for the Balance App.
 *          It connects DOM events (clicks, inputs, shortcuts) to the appropriate logic handlers (Diagnosis, Presentation, Navigation).
 * Usage: Initialized by balance-main.js to set up all event listeners.
 * Dependencies: balance-reader.js, balance-renderer.js, balance-binder-diagnosis.js
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
import { bindAthCorrections } from './balance-ath-corrections-view.js';
import { createDiagnosisHandlers } from './balance-binder-diagnosis.js';
import { bindBalanceInfoPopups } from './balance-renderer-diagnosis.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { BALANCE_UPDATE_MODE } from './balance-update-pipeline.js';
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
let handlers = null;
let uiBound = false;
const tabButtonsBound = new WeakSet();
const presentationDocumentsBound = new WeakSet();

// In-Process-Tests stellen die vorherige Bindung nach ihren isolierten Fixtures wieder her.
/**
 * @returns Ergebnis der bestehenden Operation.
 */
export function preserveUIBinderStateForTests() {
    const previous = { dom, appState, update, debouncedUpdate, handlers, uiBound };
    const restore = () => {
        ({ dom, appState, update, debouncedUpdate, handlers, uiBound } = previous);
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
            dialog.querySelector?.('.balance-action-note')]) {
            if (node) /** @type {HTMLElement} */ (node).hidden = plan;
        }
        // VN-1 Punkt 11: „Als ausgeführt eintragen“ (Spielbereich) steht weder in der Vorschau noch im Plan; erfasst wird im geführten Ablauf.
        for (const node of [dialog.querySelector?.('.ds-actions'), document.getElementById('balancePlayExecutionStatus')]) if (node) /** @type {HTMLElement} */ (node).hidden = true;
        const planHost = document.getElementById('balancePlanDetails');
        if (planHost) planHost.hidden = !plan;
        // VN-1 Punkt 11: Die Vorschau hat keine Erfassungsknöpfe. Im beschlossenen Plan starten „Verkauf starten“ und „Kauf starten“
        // den geführten Ablauf (dieselben Knöpfe wie in „Was zu tun ist“) statt „Verkauf erfassen →“ und „Als ausgeführt eintragen“.
        const manager = document.getElementById('actionManagerLink');
        if (manager) manager.hidden = true;
        for (const [id, selector] of [['actionSaleStart', '#balanceActionArea [data-todo-sale-entry]'], ['actionBuyStart', '#balanceActionArea [data-todo-purchase-entry]']]) {
            const button = document.getElementById(id), entry = /** @type {HTMLElement|null} */ (document.querySelector(selector));
            if (!button) continue;
            button.hidden = !plan || !entry;
            if (entry) button.textContent = entry.textContent || button.textContent;
        }
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
    for (const [id, selector] of [['actionSaleStart', '#balanceActionArea [data-todo-sale-entry]'], ['actionBuyStart', '#balanceActionArea [data-todo-purchase-entry]']]) {
        document.getElementById(id)?.addEventListener('click', () => {
            const entry = /** @type {HTMLElement|null} */ (document.querySelector(selector));
            actionTrigger = entry; dialog?.close(); entry?.click();
        });
    }
    dialog?.addEventListener('close', () => actionTrigger?.focus());
    bindDialogBackdrop(dialog, () => dialog.close(), e => {
        const rect = dialog.getBoundingClientRect();
        return e.target === dialog && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom);
    });
    document.getElementById('balanceChangeScope')?.addEventListener('click', () => {
        UIBinder.selectTab(dom.containers.tabButtons?.querySelector('[data-tab="strategy"]'));
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
    const priceReport = readStartupPriceReport();
    const getAnnualModel = () => {
        const liveData = Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i)).map(key => [key, persistenceStorage.getItem(key)]));
        const model = /** @type {import('../../typcheck/balance-ui.js').ProjectOverviewWithArchive} */ (projectOverviewWithAnnualArchive)({ registry: loadProfileRegistry().value, activeId: persistenceStorage.getItem('rs_current_profile'), liveData,
            priceReport,
            recovery: Boolean(globalThis.window?.__profileRecoveryBlocker || globalThis.window?.__balanceMonthRecovery) }, { onChange: () => UIRenderer.renderContext(appState.inputs) });
        return projectAnnualClosePreparation(model, { store: loadExpensesStoreResult(persistenceStorage).store,
            annualBudgetSummary: readOverviewSummary(liveData[OVERVIEW_SUMMARY_KEY], model.occasion?.closingYear, model.scope) });
    };
    handlers = { diagnosis: createDiagnosisHandlers({ dom, appState }), getAnnualModel };
}

export const UIBinder = {
    bindUI() {
        if (uiBound) return;
        dom.containers.form?.addEventListener('input', this.handleFormInput.bind(this));
        dom.containers.form?.addEventListener('change', this.handleFormChange.bind(this));
        bindAthCorrections(document, { update: options => update(options), blocked: actionBlocked }); // ATH-1b
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
        dom.diagnosis?.copyBtn?.addEventListener('click', this.handleCopyDiagnosis.bind(this));
        dom.diagnosis?.filterToggle?.addEventListener('change', (e) => {
            dom.diagnosis.content?.classList.toggle('filter-inactive', e.target.checked);
        });
        bindBalancePresentation();
        uiBound = true;
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
    },

    async prepareExpensesNavigation() {
        // Der gemeinsame beforeLeave-Hook sichert das Formular und nennt
        // Fehlschläge im Verlustdialog auch bei Hashzielen.
        return Boolean(appState && update && !actionBlocked());
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

    openAnnualOverview() {
        const link = document.createElement('a'); link.href = 'index.html';
        link.setAttribute('data-profile-handoff', '');
        link.hidden = true; document.body.appendChild(link); link.click(); link.remove();
        return true;
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
            || actionBlocked()) return false;
        if (request.target === 'jahresabschluss') {
            if (guard.reasons().length) return false;
            if (request.year !== null && request.year !== handlers.getAnnualModel().occasion.closingYear) return false;
            return this.openAnnualOverview();
        }
        if (globalThis.window?.__profileRecoveryBlocker) return false;
        if (!['ausgaben', 'ausgaben-import'].includes(request.target)) return false;
        return navigate(request, { beforeLeave: () => this.prepareExpensesNavigation() });

    },

    handleCopyDiagnosis() {
        return handlers.diagnosis.handleCopyDiagnosis();
    }
};
