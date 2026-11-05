import { createBalanceValidationHint } from '../balance-renderer.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { importExpenses, isExpensesImportHint } from '../balance-expenses-import.js';
import { canGenerateExampleExpenses, assertExampleExpensesAllowed, generateExampleExpensesCsv, resolveExampleExpensesBasis, resolveExampleExpensesFloor, EXAMPLE_SOURCE } from '../../demo/beispielausgaben.js';
import { getProbelaufController } from '../../shared/probelauf-state.js';
import { getPageNavigationGuard } from '../../shared/navigation-guard-dialog.js';
import { EXPENSES_STORAGE_KEY, saveExpensesStore } from '../balance-expenses-storage.js';
import { EXPENSE_MONTHS } from '../balance-expenses-renderer.js';
import { context, state } from './context.js';
import { mutationBlocked, trackMutation, reportImportOperation, messages, notifyExpensesChange, readExpensesStoreForUi, getProfiles } from './helpers.js';

export function createExpensesActions({ refreshTableValues, openDetails }, { renderCorruptExpensesState }) {
    function showImportError(error) {
        messages().handleActionError(isExpensesImportHint(error) ? createBalanceValidationHint(error.message) : error, 'expenses-import');
    }

    function captureImportContext(year, profileId) {
        const token = context.generation, ids = getProfiles().map(profile => profile.profileId).sort().join('|');
        const activeId = persistenceStorage.getItem('rs_current_profile');
        return () => {
            try {
                return token === context.generation && !state.corruption && !globalThis.window?.__profileRecoveryBlocker && state.year === year
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
        const raw = context.recoveryOptions.storage.getItem(EXPENSES_STORAGE_KEY);
        delete monthData.profiles[profileId];
        try {
            saveExpensesStore(store, context.recoveryOptions?.storage);
            if (context.adapters.transactionalActions && await context.recoveryOptions.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        } catch (error) {
            if (raw !== null) context.recoveryOptions.storage.setItem(EXPENSES_STORAGE_KEY, raw);
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
                    basis: resolveExampleExpensesBasis({ year, ids }), floorMonthly: resolveExampleExpensesFloor({ ids }) });
                const isCurrent = captureImportContext(year, profileId);
                button.disabled = true;
                return reportImportOperation(handleCsvImport({ text: async () => text() }, month, profileId, year, context.recoveryOptions, context.onImportSuccess, isCurrent, EXAMPLE_SOURCE)
                    .catch(error => showImportError(error))
                    .finally(() => { button.disabled = false; button.focus?.(); }));
            } catch (error) { showImportError(error); return; }
        }

        if (action === 'import') {
            if (state.corruption) return;
            context.pendingImport = { month, profileId, year: state.year, isCurrent: captureImportContext(state.year, profileId) };
            context.dom.expenses.csvInput.click();
            return;
        }

        if (action === 'details') {
            openDetails(month, profileId);
            return;
        }

        if (action === 'delete') {
            if (context.decisionInFlight || state.corruption || context.adapters.transactionalActions && mutationBlocked()) return;
            context.decisionInFlight = true;
            button.disabled = true;
            const options = context.recoveryOptions;
            let isCurrent, raw;
            const activeId = persistenceStorage.getItem('rs_active_profile');
            try {
                isCurrent = captureImportContext(state.year, profileId);
                raw = options.storage.getItem(EXPENSES_STORAGE_KEY);
            } catch (error) {
                context.decisionInFlight = false; button.disabled = false;
                messages().handleActionError(error, 'expenses-delete'); return;
            }
            const monthName = EXPENSE_MONTHS[month - 1] || String(month);
            return trackMutation(() => Promise.resolve().then(() => options.confirmDelete({
                title: 'Monatsdaten löschen', description: `Monatsdaten für ${monthName} löschen?`,
                confirmLabel: 'Monatsdaten löschen', cancelLabel: 'Abbrechen', danger: true, opener: button
            })).then(confirmed => {
                if (!confirmed || !isCurrent() || persistenceStorage.getItem('rs_active_profile') !== activeId || options !== context.recoveryOptions
                    || options.storage.getItem(EXPENSES_STORAGE_KEY) !== raw) return;
                return deleteMonthData(month, profileId);
            }).catch(error => messages().handleActionError(error, 'expenses-delete'))
                .finally(() => { context.decisionInFlight = false; button.disabled = false; }));
        }
    }

    function handleFileChange(e) {
        const file = e.target.files?.[0];
        if (!file || !context.pendingImport) return;
        const { month, profileId } = context.pendingImport;
        const year = context.adapters.readOnlySelection ? context.pendingImport.year : state.year;
        const isCurrent = context.adapters.readOnlySelection ? context.pendingImport.isCurrent : captureImportContext(year, profileId);
        context.pendingImport = null;

        if (!isCurrent()) { e.target.value = ''; return; }
        const options = context.recoveryOptions, afterImport = context.onImportSuccess;
        const operation = handleCsvImport(file, month, profileId, year, options, afterImport, isCurrent);
        const completed = operation.catch(err => {
            showImportError(err);
        }).finally(() => {
            e.target.value = '';
        });
        return reportImportOperation(completed);
    }

    return { handleTableClick, handleFileChange };
}
