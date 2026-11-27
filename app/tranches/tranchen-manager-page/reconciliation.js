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
