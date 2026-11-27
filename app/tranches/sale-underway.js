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

/** SP-1c (Nutzer 13.11.2026 „Erst warnen“): offene Gutschriften und Abbuchungen je Posten, für den Hinweis beim Start des
 * Jahresabschlusses. Unlesbarer Verlauf ergibt keine Posten. @param {any} registry @param {string[]|null} [ids]
 * @returns {{kind: 'credit'|'debit', profileId: string, name: string, executedAt: string, amount: number}[]} */
export function listMoneyUnderway(registry, ids = null) {
    const set = ids ? new Set(ids) : null;
    /** @type {{kind: 'credit'|'debit', profileId: string, name: string, executedAt: string, amount: number}[]} */
    const items = [];
    /** @param {'credit'|'debit'} kind @param {(registry: any) => readonly any[]} read */
    const add = (kind, read) => {
        try {
            for (const status of read(registry)) {
                const amount = Math.abs(Number(status.confirmedNetProceedsEur) || 0);
                if (!status.isPending || set && !set.has(status.profileId) || amount < 0.005) continue;
                items.push({ kind, profileId: status.profileId, name: registry?.profiles?.[status.profileId]?.meta?.name || 'Person',
                    executedAt: String(status.executedAt || ''), amount });
            }
        } catch { /* Ein unlesbarer Verlauf meldet sich an seiner eigenen Stelle. */ }
    };
    add('credit', projectReconciliationCashStatuses);
    add('debit', projectBuyCashStatuses);
    return items.sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.name.localeCompare(b.name));
}

/** „Erst die offene Gutschrift von Erika bestätigen (Verkauf vom 02.09.2026, 30.381 €). Sonst rechnet der Jahresabschluss mit zu
 * wenig Tagesgeld.“ Ganze Euro ohne Nachkommastellen, sonst mit Cent. @param {ReturnType<typeof listMoneyUnderway>[number]} item */
export function moneyUnderwayCloseText(item) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(item.executedAt) ? item.executedAt.split('-').reverse().join('.') : item.executedAt;
    const cents = Math.round(item.amount * 100) % 100 !== 0;
    const amount = `${formatDisplayNumber(item.amount, cents ? { fractionDigits: 2, minimumFractionDigits: 2 } : { fractionDigits: 0 })} €`;
    return item.kind === 'credit'
        ? `Erst die offene Gutschrift von ${item.name} bestätigen (Verkauf vom ${date}, ${amount}). Sonst rechnet der Jahresabschluss mit zu wenig Tagesgeld.`
        : `Erst die offene Abbuchung von ${item.name} bestätigen (Kauf vom ${date}, ${amount}). Sonst rechnet der Jahresabschluss mit zu viel Tagesgeld.`;
}
