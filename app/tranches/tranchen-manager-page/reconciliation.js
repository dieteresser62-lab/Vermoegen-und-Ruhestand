// @ts-check
// FR-79: Den Verkauf trägst du im geführten Ablauf ein (`app/tranches/sale-flow-dialog.js`). Hier bleibt nur das Zurücksetzen
// des Statuszustands der Liste „Verkäufe & Cashstatus“ bei Personen- und Ansichtswechseln.
import { state } from './state.js';
import { renderReconciliationState } from './reconciliation-view.js';

/** @param {{resetForm?: boolean, navigationOperation?: import('../../../typcheck/runtime-contracts.js').NavigationOperation}} [options] */
export function clearReconciliationPreview({ navigationOperation } = {}) {
    if (!navigationOperation && state.navigationLifecycle?.isBlocked()) return false;
    state.reconciliationPreview = null;
    state.reconciliationError = '';
    renderReconciliationState();
    state.navigationRegistration?.notify();
    return true;
}

// Ungenutzt seit VK-1 (FR-79: der alte Verkaufsdialog entfällt); die Exporte bleiben erhalten (Exportprüfung) und tun nichts.
/** @returns {null} */ export const readOptionalNumber = () => null;
/** @returns {null} */ export const readReconciliationActionFromDom = () => null;
/** @returns {false} */ export const createReconciliationPreview = () => false;
/** @returns {Promise<false>} */ export const executeReconciliation = async () => false;
/** @returns {Promise<false>} */ export const confirmReconciliation = async () => false;
