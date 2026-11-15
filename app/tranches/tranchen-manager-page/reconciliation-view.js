// @ts-check
import { byId } from './helpers.js';
import { loadReconciliationRegistryFromStorage } from '../tranchen-manager-state.js';
import { state } from './state.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { projectReconciliationCashStatuses, TrancheReconciliationError } from '../tranche-reconciliation.js';
import { ensureReconciliationCashControls, renderReconciliationCashStatuses, buildOpenDebitsHtml } from '../tranchen-manager-renderer.js';
import { openDebitNotes } from '../buy-debit-dialog.js';

export function setReconciliationStatus(message = '', kind = '') {
    const target = byId('reconciliationStatus');
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
}

export function refreshReconciliationCashStatuses() {
    const loaded = loadReconciliationRegistryFromStorage(state.registryDisplayRaw === undefined ? persistenceStorage : {
        getItem: () => state.registryDisplayRaw
    });
    if (loaded.status === 'empty') {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = '';
        return;
    }
    if (loaded.status !== 'valid') {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = 'Cashstatus-Audit ist nicht lesbar. Bestätigung und Korrektur bleiben blockiert.';
        return;
    }
    try {
        state.reconciliationCashStatuses = projectReconciliationCashStatuses(loaded.registry, state.profileId);
        state.cashStatusError = '';
        // VK-2b P2-2: offene Abbuchungen der Käufe dieser Person (wie „Gutschrift nachtragen“).
        state.openDebits = state.profileId ? openDebitNotes(loaded.registry, [state.profileId]) : [];
    } catch (error) {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = error instanceof TrancheReconciliationError
            ? `Cashstatus-Audit blockiert: ${error.message}`
            : 'Cashstatus-Audit ist beschädigt oder nicht unterstützt.';
    }
}

export function renderReconciliationState() {
    const cashContainer = ensureReconciliationCashControls(document);
    if (!cashContainer) return;
    renderReconciliationCashStatuses(cashContainer, state.reconciliationCashStatuses, {
        errorMessage: state.cashStatusError, tranches: state.tranchen
    });
    if (!state.cashStatusError && state.openDebits?.length) cashContainer.insertAdjacentHTML('afterbegin', buildOpenDebitsHtml(state.openDebits));
    if (state.cashStatusError) {
        setReconciliationStatus(state.cashStatusError, 'error');
    } else if (state.reconciliationError) {
        setReconciliationStatus(state.reconciliationError, 'error');
    } else if (state.reconciliationStatus) {
        setReconciliationStatus(state.reconciliationStatus, 'ok');
    } else {
        setReconciliationStatus(
            'Balance und Simulator ändern deine Bestände nicht. Erst wenn du hier einen Verkauf einträgst, ändern sich Depot und Tagesgeld.',
            ''
        );
    }
}

// Ungenutzt seit VK-1 (FR-79: der alte Verkaufsdialog entfällt); die Exporte bleiben erhalten (Exportprüfung) und tun nichts.
export const syncInitialCashStatusControls = () => {};
export const renderReconciliationOptions = () => {};
export const renderReconciliationPreview = () => {};
