import { appNow } from '../shared/app-clock.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { liveCashData } from '../profile/profile-cash-update.js';
import { projectPersonMonthIncome } from '../profile/profile-person-data.js';
import { loadExpensesStoreResult } from './balance-expenses-storage.js';
import { computeSpent, hasExpenseImport } from './balance-expenses-metrics.js';

const cents = value => Math.round(value * 100) / 100;

/** Lesende Bedarfsprojektion; keine Änderung an Engine- oder gespeicherten Planzielen. */
/**
 * @param entries Eingabe für die bestehende Projektion.
 * @param householdCash Eingabe für die bestehende Projektion.
 * @param householdMinimum Eingabe für die bestehende Projektion.
 * @param options4 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function personalCashTargets(entries, householdCash, householdMinimum, { storage = persistenceStorage, now = appNow() } = {}) {
    const registry = JSON.parse(storage.getItem('rs_profiles_v1') || 'null');
    const activeId = storage.getItem('rs_current_profile');
    const expenseResult = loadExpensesStoreResult(storage);
    const expenses = expenseResult.store;
    const corrupt = expenseResult.status === 'corrupt';
    const first = entries[0].input || {};
    const budget = Math.max(0, (first.floorBedarf || 0) + (first.flexBedarf || 0));
    const bases = entries.map(entry => {
        let annualExpenses = 0, complete = true, pension = 0, income = 0;
        const profile = registry?.profiles?.[entry.profileId];
        const data = entry.personData ?? (profile ? entry.profileId === activeId ? liveCashData(storage) : profile.data : null);
        for (let offset = 0; offset < 12; offset++) {
            const previous = new Date(now.getFullYear(), now.getMonth() - 1 - offset, 1);
            const imported = expenses?.years?.[previous.getFullYear()]?.months?.[previous.getMonth() + 1]?.profiles?.[entry.profileId];
            if (hasExpenseImport(imported)) annualExpenses += computeSpent(imported.categories).spent;
            else complete = false;
            const next = new Date(now.getFullYear(), now.getMonth() + offset, 1);
            if (data) {
                const projected = projectPersonMonthIncome(data, next.getFullYear(), next.getMonth() + 1);
                pension += projected.pension;
                income += projected.income;
            } else {
                pension += entry.input?.renteAktiv ? entry.input.renteMonatlich || 0 : 0;
                income += entry.input?.sonstigeEinkuenfte || 0;
            }
        }
        annualExpenses = Math.max(0, complete ? annualExpenses : budget / entries.length);
        return { source: complete ? 'Importierte Ausgaben der letzten zwölf vollständigen Monate' : 'Haushaltsbudget nach Plan, gleich je Person',
            ...(corrupt ? { notice: 'Ausgabenbereich beschädigt: ' + expenseResult.error.message + ' Tagesgeldziele werden gleich verteilt.' } : {}),
            annualExpenses: cents(annualExpenses), pension: cents(pension), income: cents(income), need: Math.max(0, annualExpenses - pension - income) };
    });
    const totalNeed = bases.reduce((sum, row) => sum + row.need, 0);
    const weights = bases.map(row => !corrupt && totalNeed > 0 ? row.need : 1);
    // Mindestanteile nach dem gleich geteilten Haushaltsplan; die übrigen Ziele
    // proportional zum Bedarf, soweit die Mindestanteile dies zulassen.
    const targets = entries.map(() => null);
    let remaining = cents(householdCash), active = entries.map((_, i) => i);
    let reserveRest = cents(householdMinimum);
    const minima = entries.map((_, i) => {
        const minimum = i === entries.length - 1 ? reserveRest : cents(householdMinimum / entries.length);
        reserveRest = cents(reserveRest - minimum); return minimum;
    });
    while (active.length) {
        const total = active.reduce((sum, i) => sum + weights[i], 0);
        const below = active.filter(i => remaining * (total > 0 ? weights[i] / total : 1 / active.length) < minima[i]);
        if (below.length) {
            for (const i of below) { targets[i] = minima[i]; remaining = cents(remaining - targets[i]); }
            active = active.filter(i => !below.includes(i));
        } else {
            const amount = remaining;
            active.forEach((i, index) => {
                targets[i] = index === active.length - 1 ? remaining : cents(amount * (total > 0 ? weights[i] / total : 1 / active.length));
                remaining = cents(remaining - targets[i]);
            });
            break;
        }
    }
    return entries.map((entry, i) => ({ ...entry, liquidityTargetBasis: bases[i], input: { ...entry.input,
        minimumTagesgeld: minima[i], personalTagesgeldTarget: targets[i] } }));
}
