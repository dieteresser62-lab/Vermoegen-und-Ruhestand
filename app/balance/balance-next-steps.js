import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
/** Gemeinsame lesende Pflichtschritte. Hilfetexte sind kein Erledigungsnachweis. */
export function deriveBalanceNextSteps({ occasion, actionBasis = null, basisCurrent = false, cashStatus = null, recovery = false, expenses = null, monthlyWithdrawal = null } = {}) {
    const steps = [];
    const add = (id, title, description, href) => steps.push({ id, title, description, href, status: 'open' });
    const year = occasion?.closingYear;
    const annual = occasion?.annualState;
    if (recovery || annual === 'recovery') add('annual', 'Wiederherstellung öffnen', 'Zuerst den unterbrochenen Jahresabschluss wiederherstellen.', Number.isInteger(year) ? `Balance.html?year=${year}#jahresabschluss` : 'Balance.html#jahresabschluss');
    else if (!occasion || !['done', 'not_applicable'].includes(annual)) add('annual', annual === 'open' ? `Jahr ${year} abschließen` : annual === 'unavailable' ? 'Daten prüfen' : 'Jahresstatus klären',
        annual === 'open' ? 'Der Plan bleibt bis zum Jahresabschluss vorläufig.' : 'Daten und Abschlussvermerke in Balance prüfen.', Number.isInteger(year) ? `Balance.html?year=${year}#jahresabschluss` : 'Balance.html#jahresabschluss');
    // Handlung und Vorschauaktualität sind keine Pflichten. Der Jahresdialog
    // behält seine eigene Planprüfung; reale Buchungen bleiben unten offen.
    if (occasion && !['play', 'start'].includes(occasion.kind) && occasion.monthApplicable !== false && occasion.monthCompleted !== true) add('monthly', 'Monatsbetrag bereitstellen', Number.isFinite(monthlyWithdrawal) ? `${formatDisplayNumber(monthlyWithdrawal, { unit: 'currency', fractionDigits: 0 })} monatlich aus der Liquidität bereitstellen; der Haken bucht keine Bestände.` : 'Monatsbetrag in Balance prüfen; ohne passenden Plan keinen Betrag bestätigen.', 'Balance.html#ausgaben');
    // Bereitstellung ist kein Ausgabenimport und kein Budgetvergleich.
    if (expenses && !expenses.beforePlanning) {
        const params = new URLSearchParams();
        if (Number.isInteger(expenses.year)) params.set('year', expenses.year);
        const month = expenses.missingMonths?.[0]?.month || expenses.month;
        if (Number.isInteger(month) && params.has('year')) params.set('month', month);
        const query = params.size ? `?${params}` : '';
        if (!expenses.complete) add('expenses', 'Ausgaben importieren',
            'Fehlende Ausgaben importieren und mit dem Budget vergleichen. Der Jahresabschluss bleibt unabhängig davon möglich.', `Balance.html${query}#ausgaben-import`);
        else if (occasion?.kind !== 'play' || !Number.isFinite(monthlyWithdrawal)) add('expenses', 'Ausgaben vergleichen',
            'Importierte Ausgaben mit dem passenden Budget vergleichen. Die Monatsbereitstellung bestätigt keinen Vergleich.', `Balance.html${query}#ausgaben`);
    }
    if (cashStatus?.state === 'error') add('cash', 'Cashstatus prüfen', 'Cashstatus-Audit ist beschädigt oder nicht unterstützt; Cashaussagen sind blockiert.', 'depot-tranchen-manager.html');
    else if (cashStatus?.state === 'valid' && cashStatus.pendingCount > 0) add('cash', 'Cashstatus prüfen', `${cashStatus.pendingCount} Realverkauf/Realverkäufe mit offener manueller Cashbuchung.`, 'depot-tranchen-manager.html');
    else if (!cashStatus || cashStatus.state !== 'valid') add('cash', 'Cashstatus prüfen', 'Cashstatus ist nicht verfügbar. Keine bestätigte Entwarnung.', 'depot-tranchen-manager.html');
    return steps;
}
