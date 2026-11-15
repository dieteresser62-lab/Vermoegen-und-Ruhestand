// FR-79 Ergänzung 1 Punkt 4: Geld unterwegs. Zwischen eingetragener Abrechnung und bestätigter Gutschrift fehlt der Erlös im
// Tagesgeld; Balance, Jahresabschluss und Simulator nennen Betrag und Richtung. Die Rechnung bleibt unverändert.
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { projectReconciliationCashStatuses, projectBuyCashStatuses } from './tranche-reconciliation.js';

/** Summe der offenen Gutschriften der Personen (alle Personen der Registry, wenn `ids` fehlt); unlesbar ergibt 0.
 * @param {any} registry @param {string[]|null} [ids] @returns {number} */
export function pendingCreditTotal(registry, ids = null) {
    try {
        const set = ids ? new Set(ids) : null;
        return projectReconciliationCashStatuses(registry).filter(status => status.isPending && (!set || set.has(status.profileId)))
            .reduce((sum, status) => sum + (Number(status.confirmedNetProceedsEur) || 0), 0);
    } catch { return 0; }
}

/** „Gutschrift unterwegs: Vermögen um 80.014,80 € zu niedrig.“ oder leer. @param {number} amount */
export function creditUnderwayText(amount) {
    return amount >= 0.005 ? `Gutschrift unterwegs: Vermögen um ${formatDisplayNumber(amount, { fractionDigits: 2, minimumFractionDigits: 2 })} € zu niedrig.` : '';
}

/** VK-2 (Ergänzung 1 FR-79 Punkt 4): Summe der offenen Abbuchungen aus Käufen; unlesbar ergibt 0. @param {any} registry @param {string[]|null} [ids] */
export function pendingDebitTotal(registry, ids = null) {
    try {
        const set = ids ? new Set(ids) : null;
        return projectBuyCashStatuses(registry).filter(status => status.isPending && (!set || set.has(status.profileId)))
            .reduce((sum, status) => sum + Math.abs(Number(status.confirmedNetProceedsEur) || 0), 0);
    } catch { return 0; }
}

/** „Abbuchung unterwegs: Vermögen um 98.930,75 € zu hoch.“ oder leer. @param {number} amount */
export function debitUnderwayText(amount) {
    return amount >= 0.005 ? `Abbuchung unterwegs: Vermögen um ${formatDisplayNumber(amount, { fractionDigits: 2, minimumFractionDigits: 2 })} € zu hoch.` : '';
}
