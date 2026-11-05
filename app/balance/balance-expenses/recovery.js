import { persistenceStorage } from '../../shared/persistence-facade.js';
import { createExpensesCorruptionRecoveryDocument, EXPENSES_STORAGE_KEY, resetCorruptExpensesStore } from '../balance-expenses-storage.js';
import { context, state } from './context.js';
import { trackMutation, messages, notifyExpensesChange, getBackendLabel, createRecoveryFilename, readExpensesStoreForUi } from './helpers.js';

export function createExpensesRecovery(view) {
    async function exportCorruptExpensesRecovery() {
        if (!state.corruption || typeof state.corruption.raw !== 'string') return;
        messages().clearActionError('expenses-recovery');
        try {
            const recoveryDocument = createExpensesCorruptionRecoveryDocument(state.corruption, {
                backend: getBackendLabel(),
                exportedAt: context.recoveryOptions.now().toISOString()
            });
            const filename = createRecoveryFilename(context.recoveryOptions.now());
            await context.recoveryOptions.downloadRecovery(recoveryDocument, filename);
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
        if (!state.corruption || !state.recoveryExported || context.decisionInFlight) return;
        context.decisionInFlight = true;
        const corruption = state.corruption, options = context.recoveryOptions, token = context.generation, year = state.year;
        const selectors = () => JSON.stringify([persistenceStorage.getItem('rs_current_profile'), persistenceStorage.getItem('rs_active_profile')]);
        const identity = selectors();
        let resetApplied = false;
        try {
            const confirmed = await options.confirmReset(
                `Ausgaben-Check auf Backend ${getBackendLabel()} zurücksetzen?\n\n`
                + 'Der korrupte Rohinhalt wurde als Recovery-Datei exportiert. Nach Export und Bestätigung wird der gesamte Ausgabenbereich geleert. Dies betrifft alle Jahre und Profile.'
            );
            if (!confirmed || token !== context.generation || options !== context.recoveryOptions || year !== state.year
                || selectors() !== identity || corruption !== state.corruption || !state.recoveryExported || state.recoveryCancelled
                || options.storage.getItem(EXPENSES_STORAGE_KEY) !== corruption.raw) return;
            messages().clearActionError('expenses-recovery');
            resetCorruptExpensesStore(corruption, { storage: options.storage, rawPreserved: true, activeYear: year });
            resetApplied = true;
            if (await options.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            if (token !== context.generation) return;
            state.corruption = null;
            state.recoveryExported = false;
            state.recoveryCancelled = false;
            state.profileIds = [];
            if (context.dom?.expenses?.yearSelect) context.dom.expenses.yearSelect.disabled = false;
            view.renderYearSelect();
            view.renderTable();
            notifyExpensesChange();
            messages().toast('Der Ausgaben-Check wurde nach bestätigtem Recovery-Export zurückgesetzt.');
        } catch {
            if (resetApplied && typeof corruption.raw === 'string') {
                try { options.storage?.setItem(EXPENSES_STORAGE_KEY, corruption.raw); }
                catch { /* Der exportierte Rohinhalt bleibt der sichere Recovery-Punkt. */ }
            }
            if (token !== context.generation) return;
            readExpensesStoreForUi();
            renderCorruptExpensesState();
            messages().handleActionError(new Error(
                'Der Ausgaben-Check wurde nicht zurueckgesetzt. Die gespeicherten Daten muessen neu geladen und erneut exportiert werden.'
            ), 'expenses-recovery');
        } finally { context.decisionInFlight = false; }
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
        const host = context.dom?.expenses?.table;
        if (!host || !state.corruption) return;
        if (context.dom.expenses.yearSelect) context.dom.expenses.yearSelect.disabled = true;
        (0, context.refreshYearSegments)();
        for (const key of ['annualBudget', 'annualRemaining', 'annualForecast', 'ytdValue']) {
            const element = context.dom.expenses[key];
            if (element) {
                element.textContent = '—';
                element.classList.remove('budget-ok', 'budget-warn', 'budget-bad');
            }
        }
        for (const key of ['monthlyBudget', 'annualUsed', 'forecastSub', 'ytdSub']) {
            if (context.dom.expenses[key]) context.dom.expenses[key].textContent = '—';
        }

        const panel = globalThis.document.createElement('section');
        panel.dataset.expensesRecovery = 'corrupt';
        panel.setAttribute?.('role', 'alert');
        panel.className = 'error-warn expenses-recovery ds-card';

        const title = globalThis.document.createElement('h3');
        title.textContent = context.adapters.readOnlySelection ? 'Ausgabendaten können nicht gelesen werden' : 'Ausgaben-Check: korrupte Persistenz erkannt';
        const message = globalThis.document.createElement('p');
        message.dataset.role = 'expenses-recovery-message';
        message.textContent = `Betroffener Datenbereich: Ausgaben-Check. Backend: ${getBackendLabel()}. ${state.corruption.error?.message || ''} Ohne ausdrueckliche Nutzerentscheidung werden keine Daten ueberschrieben.`;
        if (context.adapters.readOnlySelection) {
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

    return { renderCorruptExpensesState };
}
