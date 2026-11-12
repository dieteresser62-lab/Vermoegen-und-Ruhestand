import { effectiveIncomeFromRecord, monthlyOtherIncome, PENSION_LABEL_KEY } from '../profile/profile-income.js';
import { projectPerson } from '../profile/profile-person-data.js';
import { balanceCareSettings } from '../shared/person-data-status.js';
import { projectMonthlyFlow } from '../shared/monthly-flow.js';
import { projectBalanceFlexTrace } from './balance-flex-trace.js';

/** Dieselben Personenprojektionen wie im Balance-Reader; nur laufende Einkünfte. */
/** @param {import('../../typcheck/balance-ui.js').PersonStatus} status @returns {{label: string, amount: number}[]} */
export function balanceIncomeDetails(status) {
    if (!status?.ready || status.status === 'demo') return [];
    return status.entries.flatMap(entry => {
        const person = projectPerson(entry.data, status.referenceYear, balanceCareSettings(status, entry.profileId));
        const name = entry.name || entry.profileId;
        return [
            { label: `${entry.data[PENSION_LABEL_KEY] || 'Rente'} ${name}`, amount: person.renteImJahr / 12 },
            ...effectiveIncomeFromRecord(entry.data).filter(item => item.art === 'sonstige').map(item => ({
                label: `${item.bezeichnung || 'Sonstige Einkünfte'} ${name}`,
                amount: monthlyOtherIncome([item], status.referenceYear)
            })),
            { label: `Pflegegeld ${name}`, amount: person.pflegegeld || 0 }
        ].filter(item => item.amount > 0);
    });
}

/** @param {import('../../typcheck/balance-ui.js').Ui} ui @returns {ReturnType<typeof projectMonthlyFlow>|null} */
export function projectBalanceMonthlyFlow(ui) {
    const trace = projectBalanceFlexTrace(ui);
    if (![trace.income, trace.withdrawal, trace.budget].every(Number.isFinite)) return null;
    return projectMonthlyFlow(trace);
}
