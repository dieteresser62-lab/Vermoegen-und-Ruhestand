import { requestPageConfirmation } from '../shared/page-dialog.js';
import { appNow } from '../shared/app-clock.js';
/**
 * Module: Balance Expenses (Ausgaben-Check)
 * Purpose: Monatliche Kategorien-Importe verwalten und gegen Budget prüfen.
 * Usage: Initialisiert in balance-main.js, arbeitet rein im Browser (localStorage).
 */
"use strict";

import { UIUtils } from './balance-utils.js';
import { UIRenderer, createBalanceValidationHint } from './balance-renderer.js';
import { loadProfilverbundProfiles } from '../profile/profilverbund-balance.js';
import { downloadJsonFile } from '../shared/persistence-backup.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { importExpenses, requestExpensesPreview, isExpensesImportHint } from './balance-expenses-import.js';
import { canGenerateExampleExpenses, assertExampleExpensesAllowed, generateExampleExpensesCsv, resolveExampleExpensesBasis, EXAMPLE_SOURCE } from '../demo/beispielausgaben.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { computeYearStats } from './balance-expenses-metrics.js';
import { bindBalanceYearSegments } from './balance-presentation-controls.js';
import {
    createExpensesCorruptionRecoveryDocument,
    EXPENSES_STORAGE_KEY,
    EXPENSES_STORE_STATUS,
    getExpensesMonthData,
    getExpensesYearData,
    listExpensesYears,
    loadExpensesStoreResult,
    resetCorruptExpensesStore,
    saveExpensesStore,
    setExpensesActiveYear,
    resolveExpensesInitialYear
} from './balance-expenses-storage.js';
import {
    EXPENSE_MONTHS,
    refreshExpensesTableValues,
    renderExpensesDetails,
    renderExpensesSummary,
    renderExpensesTableStructure,
    renderExpensesYearSelect
} from './balance-expenses-renderer.js';

let dom = null;
let adapters = {};
let detailTarget = null;
const state = {
    year: null,
    monthlyBudget: 0,
    annualBudget: 0,
    profileIds: [],
    corruption: null,
    recoveryExported: false,
    recoveryCancelled: false
};
let pendingImport = null;
let recoveryOptions = null;
let onChange = null;
let onImportSuccess = null;
let generation = 0;
let decisionInFlight = false;
let exampleVisible = false;
let refreshYearSegments = () => {};

function mutationBlocked() {
    const guard = getPageNavigationGuard(globalThis.document);
    return guard.isBusy() || guard.reasons().some(reason => ['commit', 'running', 'preparing', 'cancelling'].includes(reason.phase));
}
async function trackMutation(action) {
    if (!adapters.transactionalActions) return action();
    const guard = getPageNavigationGuard(globalThis.document);
    if (mutationBlocked()) return;
    const lease = guard.register(Symbol('expenses-mutation'), { read: () => ({ phase: 'commit', message: 'Ausgabenaktion läuft – bitte warten.' }) });
    try { return await action(); } finally { lease.unregister(); }
}

function reportImportOperation(job) {
    try { adapters.onImportOperation?.(job); } catch { /* Anzeige besitzt die Speicherung nicht. */ }
    return job;
}

function messages() { return adapters.messages || UIRenderer; }

function notifyExpensesChange() {
    // Die lesende Darstellung darf erfolgreiche Speicheraktionen nicht rückgängig machen.
    try { onChange?.(); } catch { /* Der Ausgaben-Check bleibt bedienbar. */ }
}

function createDefaultRecoveryOptions(options = {}) {
    return {
        storage: options.storage || persistenceStorage,
        getPersistenceStatus: options.getPersistenceStatus
            || (() => PersistenceFacade.getPersistenceStatus()),
        confirmReset: options.confirmReset
            || ((message, context) => requestPageConfirmation({ ...context, title: 'Ausgaben-Check zurücksetzen', description: message, confirmLabel: 'Ausgaben zurücksetzen', cancelLabel: 'Abbrechen', danger: true })),
        confirmDelete: options.confirmDelete || requestPageConfirmation,
        downloadRecovery: options.downloadRecovery
            || ((document, filename) => downloadJsonFile(document, filename, globalThis.document)),
        flush: options.flush || (ownedFlush => ownedFlush ? ownedFlush() : PersistenceFacade.flush()),
        now: options.now || appNow,
        importWait: options.importWait || {},
        confirmImport: options.confirmImport || ((targets, context) => requestExpensesPreview(targets, { ...context, doc: globalThis.document }))
    };
}

function getBackendLabel() {
    try {
        return String(recoveryOptions?.getPersistenceStatus?.()?.backend || 'unknown');
    } catch {
        return 'unknown';
    }
}

function createRecoveryFilename(date = new Date()) {
    return `balance-ausgaben-recovery-${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

function readExpensesStoreForUi() {
    const result = loadExpensesStoreResult(recoveryOptions?.storage);
    if (result.status === EXPENSES_STORE_STATUS.CORRUPT) {
        const isSameCorruption = state.corruption?.raw === result.raw
            && state.corruption?.error?.code === result.error?.code;
        state.corruption = result;
        if (!isSameCorruption) {
            state.recoveryExported = false;
            state.recoveryCancelled = false;
        }
        return null;
    }
    state.corruption = null;
    state.recoveryExported = false;
    state.recoveryCancelled = false;
    return result.store;
}

function formatCurrency(value) {
    return UIUtils.formatBalanceCurrency(Math.abs(value || 0));
}

function getProfiles() {
    if (adapters.getProfiles) return adapters.getProfiles();
    const profiles = loadProfilverbundProfiles();
    if (profiles.length > 0) return profiles;
    const registry = loadProfileRegistry().value;
    const id = persistenceStorage.getItem('rs_current_profile') || persistenceStorage.getItem('rs_active_profile');
    const single = registry?.profiles?.[id];
    return [{ profileId: single?.meta?.id || id || 'default', name: single?.meta?.name || 'Profil', inputs: {} }];
}

function renderProfileRecoveryBlocker(error) {
    state.profileIds = [];
    messages().handleError(new Error(
        `Profil-Recovery erforderlich: ${error?.message || 'Profildaten konnten nicht sicher geladen werden.'}`
    ));
    return {
        status: 'profile_recovery',
        error
    };
}

async function exportCorruptExpensesRecovery() {
    if (!state.corruption || typeof state.corruption.raw !== 'string') return;
    messages().clearActionError('expenses-recovery');
    try {
        const recoveryDocument = createExpensesCorruptionRecoveryDocument(state.corruption, {
            backend: getBackendLabel(),
            exportedAt: recoveryOptions.now().toISOString()
        });
        const filename = createRecoveryFilename(recoveryOptions.now());
        await recoveryOptions.downloadRecovery(recoveryDocument, filename);
        state.recoveryExported = true;
        state.recoveryCancelled = false;
        renderCorruptExpensesState();
        messages().toast('Recovery-Export der korrupten Ausgabendaten erstellt.');
    } catch {
        messages().handleActionError(new Error(
            'Der Recovery-Export konnte nicht erstellt werden. Die korrupten Ausgabendaten bleiben unveraendert.'
        ), 'expenses-recovery');
    }
}

async function resetCorruptExpensesAfterConfirmation() {
    if (!state.corruption || !state.recoveryExported || decisionInFlight) return;
    decisionInFlight = true;
    const corruption = state.corruption, options = recoveryOptions, token = generation, year = state.year;
    const selectors = () => JSON.stringify([persistenceStorage.getItem('rs_current_profile'), persistenceStorage.getItem('rs_active_profile')]);
    const identity = selectors();
    let resetApplied = false;
    try {
        const confirmed = await options.confirmReset(
            `Ausgaben-Check auf Backend ${getBackendLabel()} zurücksetzen?\n\n`
            + 'Der korrupte Rohinhalt wurde als Recovery-Datei exportiert. Nach Export und Bestätigung wird der gesamte Ausgabenbereich geleert. Dies betrifft alle Jahre und Profile.'
        );
        if (!confirmed || token !== generation || options !== recoveryOptions || year !== state.year
            || selectors() !== identity || corruption !== state.corruption || !state.recoveryExported || state.recoveryCancelled
            || options.storage.getItem(EXPENSES_STORAGE_KEY) !== corruption.raw) return;
        messages().clearActionError('expenses-recovery');
        resetCorruptExpensesStore(corruption, { storage: options.storage, rawPreserved: true, activeYear: year });
        resetApplied = true;
        if (await options.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        if (token !== generation) return;
        state.corruption = null;
        state.recoveryExported = false;
        state.recoveryCancelled = false;
        state.profileIds = [];
        if (dom?.expenses?.yearSelect) dom.expenses.yearSelect.disabled = false;
        renderYearSelect();
        renderTable();
        notifyExpensesChange();
        messages().toast('Der Ausgaben-Check wurde nach bestätigtem Recovery-Export zurückgesetzt.');
    } catch {
        if (resetApplied && typeof corruption.raw === 'string') {
            try { options.storage?.setItem(EXPENSES_STORAGE_KEY, corruption.raw); }
            catch { /* Der exportierte Rohinhalt bleibt der sichere Recovery-Punkt. */ }
        }
        if (token !== generation) return;
        readExpensesStoreForUi();
        renderCorruptExpensesState();
        messages().handleActionError(new Error(
            'Der Ausgaben-Check wurde nicht zurueckgesetzt. Die gespeicherten Daten muessen neu geladen und erneut exportiert werden.'
        ), 'expenses-recovery');
    } finally { decisionInFlight = false; }
}

function cancelCorruptExpensesRecovery() {
    if (!state.corruption) return;
    state.recoveryCancelled = true;
    renderCorruptExpensesState();
}

function createRecoveryAction(label, action, handler, disabled = false) {
    const button = globalThis.document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = action;
    button.disabled = disabled;
    button.className = action === 'expenses-recovery-reset'
        ? 'ds-button ds-button-danger' : 'ds-button ds-button-secondary';
    button.addEventListener('click', handler);
    return button;
}

function renderCorruptExpensesState() {
    const host = dom?.expenses?.table;
    if (!host || !state.corruption) return;
    if (dom.expenses.yearSelect) dom.expenses.yearSelect.disabled = true;
    refreshYearSegments();
    for (const key of ['annualBudget', 'annualRemaining', 'annualForecast', 'ytdValue']) {
        const element = dom.expenses[key];
        if (element) {
            element.textContent = '—';
            element.classList.remove('budget-ok', 'budget-warn', 'budget-bad');
        }
    }
    for (const key of ['monthlyBudget', 'annualUsed', 'forecastSub', 'ytdSub']) {
        if (dom.expenses[key]) dom.expenses[key].textContent = '—';
    }

    const panel = globalThis.document.createElement('section');
    panel.dataset.expensesRecovery = 'corrupt';
    panel.setAttribute?.('role', 'alert');
    panel.className = 'error-warn expenses-recovery ds-card';

    const title = globalThis.document.createElement('h3');
    title.textContent = adapters.readOnlySelection ? 'Ausgabendaten können nicht gelesen werden' : 'Ausgaben-Check: korrupte Persistenz erkannt';
    const message = globalThis.document.createElement('p');
    message.dataset.role = 'expenses-recovery-message';
    message.textContent = `Betroffener Datenbereich: Ausgaben-Check. Backend: ${getBackendLabel()}. ${state.corruption.error?.message || ''} Ohne ausdrueckliche Nutzerentscheidung werden keine Daten ueberschrieben.`;
    if (adapters.readOnlySelection) {
        message.textContent = 'Der gespeicherte Ausgabenbestand ist beschädigt. Import bleibt gesperrt. Bitte zuerst eine Recovery-Datei exportieren.';
        const details = globalThis.document.createElement('details');
        const summary = globalThis.document.createElement('summary'); summary.textContent = 'Technische Details';
        const diagnosis = globalThis.document.createElement('p');
        diagnosis.textContent = `Speicher: ${getBackendLabel()} · ${state.corruption.error?.code || 'nicht lesbar'}`;
        details.append(summary, diagnosis); panel.appendChild(details);
    }
    panel.append(title, message);
    const scope = globalThis.document.createElement('p');
    scope.dataset.role = 'expenses-recovery-scope';
    scope.textContent = 'Nach Export und Bestätigung wird der gesamte Ausgabenbereich geleert. Dies betrifft alle Jahre und Profile.';
    panel.appendChild(scope);

    if (state.recoveryCancelled) {
        const cancelled = globalThis.document.createElement('p');
        cancelled.dataset.role = 'expenses-recovery-cancelled';
        cancelled.textContent = 'Recovery abgebrochen. Der korrupte Rohinhalt bleibt unveraendert; nach einem Neuladen werden die sicheren Optionen erneut angeboten.';
        panel.appendChild(cancelled);
        host.replaceChildren(panel);
        return;
    }

    const actions = globalThis.document.createElement('div');
    actions.dataset.role = 'expenses-recovery-actions';
    const canExport = typeof state.corruption.raw === 'string';
    const exportButton = createRecoveryAction(
        state.recoveryExported ? 'Recovery exportiert' : 'Export / Recovery',
        'expenses-recovery-export',
        () => trackMutation(exportCorruptExpensesRecovery),
        !canExport
    );
    const resetButton = createRecoveryAction(
        'Gesamten Ausgabenbereich leeren',
        'expenses-recovery-reset',
        () => trackMutation(resetCorruptExpensesAfterConfirmation),
        !state.recoveryExported
    );
    const cancelButton = createRecoveryAction(
        'Abbrechen',
        'expenses-recovery-cancel',
        cancelCorruptExpensesRecovery
    );
    actions.append(exportButton, resetButton, cancelButton);
    panel.appendChild(actions);

    if (!canExport) {
        const blocked = globalThis.document.createElement('p');
        blocked.textContent = 'Der Rohinhalt ist nicht lesbar. Export und Zuruecksetzen bleiben gesperrt; bitte Speicherzugriff und App-Berechtigungen pruefen.';
        panel.appendChild(blocked);
    } else if (!state.recoveryExported) {
        const hint = globalThis.document.createElement('p');
        hint.textContent = 'Zuruecksetzen wird erst nach einem erfolgreichen Recovery-Export freigeschaltet.';
        panel.appendChild(hint);
    }

    host.replaceChildren(panel);
}

function renderYearSelect() {
    if (!dom?.expenses?.yearSelect) return;
    if (state.corruption) {
        dom.expenses.yearSelect.disabled = true;
        refreshYearSegments();
        return;
    }
    const store = readExpensesStoreForUi();
    if (!store) {
        renderCorruptExpensesState();
        return;
    }
    dom.expenses.yearSelect.disabled = false;
    renderExpensesYearSelect({
        select: dom.expenses.yearSelect,
        years: listExpensesYears({ store, activeYear: state.year }),
        activeYear: state.year
    });
    if (dom.expenses.yearLabel) dom.expenses.yearLabel.textContent = String(state.year);
    refreshYearSegments();
}

function updateSummary(store) {
    if (!dom?.expenses) return;
    const safeStore = store || readExpensesStoreForUi();
    if (!safeStore) {
        renderCorruptExpensesState();
        return;
    }
    if (adapters.renderSummary) { adapters.renderSummary(safeStore, state.year); return; }
    const yearData = getExpensesYearData(safeStore, state.year);
    const stats = computeYearStats({
        yearData,
        annualBudget: state.annualBudget,
        monthlyBudget: state.monthlyBudget
    });
    renderExpensesSummary({
        refs: dom.expenses,
        stats,
        annualBudget: state.annualBudget,
        monthlyBudget: state.monthlyBudget,
        formatCurrency
    });
}

function refreshTableValues() {
    if (!dom?.expenses?.table) return;
    const store = readExpensesStoreForUi();
    if (!store) {
        renderCorruptExpensesState();
        return;
    }
    const yearData = getExpensesYearData(store, state.year);
    refreshExpensesTableValues({
        host: dom.expenses.table,
        yearData,
        profileIds: state.profileIds,
        monthlyBudget: state.monthlyBudget,
        formatCurrency, missingLabel: adapters.missingLabel,
        dueMonth: adapters.dueMonth?.(state.year)
    });
    updateSummary(store);
}

function renderTable() {
    // Auch gemeinsame Observer ersetzen die Matrix außerhalb des Seitenrefreshs.
    // Der Seitenadapter schützt den Fokus bereits vor dem nativen focusout.
    if (adapters.preserveMatrixFocus) return adapters.preserveMatrixFocus(renderTableContent);
    return renderTableContent();
}

function renderTableContent() {
    if (!dom?.expenses?.table) return;
    if (state.corruption) {
        renderCorruptExpensesState();
        return;
    }
    const profiles = getProfiles();
    if (dom.expenses.profileCount) dom.expenses.profileCount.textContent = `${profiles.length} ${profiles.length === 1 ? 'Profil' : 'Profile'}`;
    const profileIds = profiles.map(p => p.profileId);
    const visible = canGenerateExampleExpenses(getProbelaufController(globalThis.document), { allowBusy: true });
    const needsRebuild = profileIds.join('|') !== state.profileIds.join('|') || visible !== exampleVisible;

    if (needsRebuild) {
        state.profileIds = profileIds;
        exampleVisible = visible;
        renderExpensesTableStructure({
            host: dom.expenses.table,
            profiles, examples: visible, deleteInDetails: adapters.deleteInDetails
        });
    }

    refreshTableValues();
}

function setYear(year) {
    if (!Number.isFinite(year) || state.corruption) return;
    try {
        state.year = year;
        if (!adapters.readOnlySelection) setExpensesActiveYear(year, recoveryOptions?.storage);
        renderYearSelect();
        renderTable();
        notifyExpensesChange();
    } catch {
        readExpensesStoreForUi();
        renderCorruptExpensesState();
    }
}

function openDetails(month, profileId) {
    if (!dom?.expenses?.detailDialog || state.corruption) return;
    const store = readExpensesStoreForUi();
    if (!store) {
        renderCorruptExpensesState();
        return;
    }
    const yearData = getExpensesYearData(store, state.year);
    const monthData = getExpensesMonthData(yearData, month);
    const profileData = monthData.profiles?.[profileId];
    const categories = profileData?.categories || {};
    const profileName = getProfiles().find(p => p.profileId === profileId)?.name || profileId;

    detailTarget = { month, profileId, year: state.year };
    if (dom.expenses.detailDelete) {
        dom.expenses.detailDelete.dataset.month = String(month);
        dom.expenses.detailDelete.dataset.profile = profileId;
        dom.expenses.detailDelete.disabled = !profileData;
    }
    renderExpensesDetails({
        refs: dom.expenses,
        monthName: EXPENSE_MONTHS[month - 1],
        profileName,
        categories,
        source: profileData?.source,
        formatCurrency
    });
}

function showImportError(error) {
    messages().handleActionError(isExpensesImportHint(error) ? createBalanceValidationHint(error.message) : error, 'expenses-import');
}

function captureImportContext(year, profileId) {
    const token = generation, ids = getProfiles().map(profile => profile.profileId).sort().join('|');
    const activeId = persistenceStorage.getItem('rs_current_profile');
    return () => {
        try {
            return token === generation && !state.corruption && !globalThis.window?.__profileRecoveryBlocker && state.year === year
                && persistenceStorage.getItem('rs_current_profile') === activeId
                && getProfiles().some(profile => profile.profileId === profileId)
                && getProfiles().map(profile => profile.profileId).sort().join('|') === ids;
        } catch { return false; } // Nicht mehr lesbarer Profilkontext ist kein neues Importziel.
    };
}

async function handleCsvImport(file, month, profileId, year, options, afterImport, isCurrent, source) {
    if (state.corruption) { renderCorruptExpensesState(); return; }
    messages().clearActionError('expenses-import');
    const result = await importExpenses({
        ...options.importWait,
        targets: [{ text: () => file.text(), month, year, profileId, source,
            name: getProfiles().find(profile => profile.profileId === profileId)?.name }],
        storage: options.storage, flush: options.flush, now: options.now,
        controller: getProbelaufController(globalThis.document),
        guard: getPageNavigationGuard(globalThis.document), isCurrent, confirm: options.confirmImport,
        onProgress: message => message ? messages().handleActionError(createBalanceValidationHint(message), 'expenses-import') : messages().clearActionError('expenses-import'),
        onSuccess: async () => {
            try { messages().toast(source === EXAMPLE_SOURCE ? 'Beispielausgaben importiert.' : 'CSV importiert.'); } catch { /* Anzeige bleibt optional. */ }
            // Vermögensaufnahme startet an der bestätigten Grenze, vor UI-Rückrufen.
            let capture, error;
            try { capture = source === EXAMPLE_SOURCE ? null : afterImport?.(); } catch (caught) { error = caught; }
            try { refreshTableValues(); } catch { /* Speicherung bleibt bestätigt. */ }
            notifyExpensesChange();
            if (error) throw error;
            await capture;
        },
        onFollowupError: error => messages().handleActionError(new Error(`Ausgaben importiert; Vermögensstand nicht bestätigt: ${error.message || error}`), 'expenses-wealth')
    });
    if (result.status === 'cancelled') showImportError({ code: 'EXPENSES_ABORTED', message: 'Import abgebrochen.' });
    const failed = result.results.find(item => !item.ok);
    if (failed) throw failed.error;
    return result;
}

async function deleteMonthData(month, profileId) {
    if (state.corruption) return false;
    const store = readExpensesStoreForUi();
    if (!store) {
        renderCorruptExpensesState();
        return false;
    }
    const yearData = store?.years?.[String(state.year)];
    if (!yearData?.months) return false;
    const monthData = yearData.months[String(month)];
    if (!monthData?.profiles || !Object.prototype.hasOwnProperty.call(monthData.profiles, profileId)) {
        return false;
    }
    const raw = recoveryOptions.storage.getItem(EXPENSES_STORAGE_KEY);
    delete monthData.profiles[profileId];
    try {
        saveExpensesStore(store, recoveryOptions?.storage);
        if (adapters.transactionalActions && await recoveryOptions.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    } catch (error) {
        if (raw !== null) recoveryOptions.storage.setItem(EXPENSES_STORAGE_KEY, raw);
        throw error;
    }
    refreshTableValues();
    notifyExpensesChange();
    messages().toast('Monatsdaten gelöscht.');
    return true;
}

function handleTableClick(e) {
    const button = e.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    const month = Number(button.dataset.month);
    const profileId = button.dataset.profile;
    if (!month || !profileId) return;

    if (action === 'example') {
        try {
            const controller = getProbelaufController(globalThis.document);
            if (!canGenerateExampleExpenses(controller, { allowBusy: true })) assertExampleExpensesAllowed(controller);
            if (state.corruption) return;
            const profiles = getProfiles(), year = state.year;
            const ids = profiles.map(profile => profile.profileId);
            const text = () => generateExampleExpensesCsv({ controller, ids, profileId, year, month,
                basis: resolveExampleExpensesBasis({ year, ids }) });
            const isCurrent = captureImportContext(year, profileId);
            button.disabled = true;
            return reportImportOperation(handleCsvImport({ text: async () => text() }, month, profileId, year, recoveryOptions, onImportSuccess, isCurrent, EXAMPLE_SOURCE)
                .catch(error => showImportError(error))
                .finally(() => { button.disabled = false; button.focus?.(); }));
        } catch (error) { showImportError(error); return; }
    }

    if (action === 'import') {
        if (state.corruption) return;
        pendingImport = { month, profileId, year: state.year, isCurrent: captureImportContext(state.year, profileId) };
        dom.expenses.csvInput.click();
        return;
    }

    if (action === 'details') {
        openDetails(month, profileId);
        return;
    }

    if (action === 'delete') {
        if (decisionInFlight || state.corruption || adapters.transactionalActions && mutationBlocked()) return;
        decisionInFlight = true;
        button.disabled = true;
        const options = recoveryOptions;
        let isCurrent, raw;
        const activeId = persistenceStorage.getItem('rs_active_profile');
        try {
            isCurrent = captureImportContext(state.year, profileId);
            raw = options.storage.getItem(EXPENSES_STORAGE_KEY);
        } catch (error) {
            decisionInFlight = false; button.disabled = false;
            messages().handleActionError(error, 'expenses-delete'); return;
        }
        const monthName = EXPENSE_MONTHS[month - 1] || String(month);
        return trackMutation(() => Promise.resolve().then(() => options.confirmDelete({
            title: 'Monatsdaten löschen', description: `Monatsdaten für ${monthName} löschen?`,
            confirmLabel: 'Monatsdaten löschen', cancelLabel: 'Abbrechen', danger: true, opener: button
        })).then(confirmed => {
            if (!confirmed || !isCurrent() || persistenceStorage.getItem('rs_active_profile') !== activeId || options !== recoveryOptions
                || options.storage.getItem(EXPENSES_STORAGE_KEY) !== raw) return;
            return deleteMonthData(month, profileId);
        }).catch(error => messages().handleActionError(error, 'expenses-delete'))
            .finally(() => { decisionInFlight = false; button.disabled = false; }));
    }
}

function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file || !pendingImport) return;
    const { month, profileId } = pendingImport;
    const year = adapters.readOnlySelection ? pendingImport.year : state.year;
    const isCurrent = adapters.readOnlySelection ? pendingImport.isCurrent : captureImportContext(year, profileId);
    pendingImport = null;

    if (!isCurrent()) { e.target.value = ''; return; }
    const options = recoveryOptions, afterImport = onImportSuccess;
    const operation = handleCsvImport(file, month, profileId, year, options, afterImport, isCurrent);
    const completed = operation.catch(err => {
        showImportError(err);
    }).finally(() => {
        e.target.value = '';
    });
    return reportImportOperation(completed);
}

function bindEvents() {
    if (dom?.expenses?.table) {
        dom.expenses.table.addEventListener('click', handleTableClick);
    }
    if (dom?.expenses?.csvInput) {
        dom.expenses.csvInput.addEventListener('change', handleFileChange);
    }
    if (dom?.expenses?.yearSelect) {
        dom.expenses.yearSelect.addEventListener('change', (event) => {
            const year = Number(event.target.value);
            setYear(year);
        });
    }
    if (dom?.expenses?.detailDelete) {
        dom.expenses.detailDelete.dataset.action = 'delete';
        dom.expenses.detailDelete.addEventListener('click', async event => {
            if (!detailTarget || detailTarget.year !== state.year) return;
            await handleTableClick(event);
            dom.expenses.detailDialog.close();
        });
    }
    if (dom?.expenses?.detailClose) {
        dom.expenses.detailClose.addEventListener('click', () => dom.expenses.detailDialog.close());
    }
    if (dom?.expenses?.detailDialog) {
        dom.expenses.detailDialog.addEventListener('click', (event) => {
            if (event.target === dom.expenses.detailDialog) dom.expenses.detailDialog.close();
        });
    }
}

export function initExpensesTab(domRefs, options = {}) {
    generation++;
    dom = domRefs;
    adapters = options;
    detailTarget = null;
    recoveryOptions = createDefaultRecoveryOptions(options);
    onChange = typeof options.onChange === 'function' ? options.onChange : null;
    onImportSuccess = typeof options.onImportSuccess === 'function' ? options.onImportSuccess : null;
    pendingImport = null;
    state.profileIds = [];
    state.recoveryExported = false;
    state.recoveryCancelled = false;

    refreshYearSegments = bindBalanceYearSegments(dom?.expenses?.yearSelect, dom?.expenses?.yearSegments);

    const initialResult = loadExpensesStoreResult(recoveryOptions.storage);
    if (initialResult.status === EXPENSES_STORE_STATUS.CORRUPT) {
        state.corruption = initialResult;
        state.year = recoveryOptions.now().getFullYear();
        bindEvents();
        renderCorruptExpensesState();
        return initialResult;
    }

    state.corruption = null;
    state.year = options.initialYear || Number(initialResult.store?.activeYear) || recoveryOptions.now().getFullYear();
    if (!adapters.readOnlySelection) setExpensesActiveYear(state.year, recoveryOptions.storage);
    bindEvents();
    const band = globalThis.document?.getElementById?.('probelaufBand');
    if (band && globalThis.MutationObserver) new MutationObserver(() => renderTable()).observe(band, { subtree: true, childList: true, attributes: true });
    try {
        renderYearSelect();
        renderTable();
    } catch (error) {
        return {
            ...initialResult,
            ...renderProfileRecoveryBlocker(error)
        };
    }
    return initialResult;
}

export function updateExpensesBudget({ monthlyBudget, annualBudget }) {
    state.monthlyBudget = Number.isFinite(monthlyBudget) ? monthlyBudget : 0;
    state.annualBudget = Number.isFinite(annualBudget) ? annualBudget : 0;
    renderTable();
}

export function rollExpensesYear() {
    if (state.corruption) return state.year;
    const nextYear = state.year + 1;
    setYear(nextYear);
    return nextYear;
}

/** Nach dem bestätigten Jahreswrite ausschließlich aus dem Speicher anzeigen. */
export function projectCommittedExpensesYear() {
    state.year = resolveExpensesInitialYear(recoveryOptions?.storage);
    renderYearSelect();
    renderTable();
    return state.year;
}

/** Adapter für reine Auswahlzustände der eigenständigen Seite. */
export function selectExpensesYear(year) { setYear(year); return state.year; }
export function refreshExpensesView({ invalidateContext = false } = {}) {
    if (invalidateContext) { generation++; pendingImport = null; }
    renderYearSelect(); renderTable();
}
export function getExpensesViewYear() { return state.year; }
