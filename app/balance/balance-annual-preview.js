import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { prepareAnnualNeeds } from './balance-annual-inflation.js';
import { UIUtils } from './balance-utils.js';
import { projectPerson, projectPersonPension } from '../profile/profile-person-data.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { readProfilePersonFromStorage } from '../profile/profile-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';

/** Lesende Projektion derselben Januar-, Renten- und Rundungsregeln wie der Jahrespfad. */
export function projectAnnualPreview({ targetYear, inputs, inflation, entries,
    storage = persistenceStorage, confirmed = false } = {}) {
    const planningYear = targetYear + 1;
    const status = entries ? { entries } : readBalancePersonStatus({ storage, referenceYear: planningYear });
    const people = (status.entries || []).map(entry => {
        try {
            const person = projectPerson(entry.data, planningYear);
            const pension = projectPersonPension(entry.data, planningYear);
            return { id: entry.profileId, name: entry.name, ...person,
                budgetPensionMonthly: pension.monateImJahr === 12 ? pension.renteMonatlich : pension.renteImJahr / 12 };
        } catch (error) { return { id: entry.profileId, name: entry.name, error: error.message }; }
    });
    if (!people.length) {
        try {
            const person = readProfilePersonFromStorage(storage, planningYear);
            people.push({ name: storage.getItem('profile_name') || 'Aktive Person', ...person,
                budgetPensionMonthly: person.monateImJahr === 12 ? person.renteMonatlich : person.renteImJahr / 12 });
        } catch { /* Fehlende Personenquellen sichtbar statt erfunden. */ }
    }
    if (!inputs) {
        const values = readBalanceHouseholdPlan({ storage }).entry?.values;
        inputs = values ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value: UIUtils.formatNumber(value) }])) : {};
    }
    const needs = confirmed || inflation ? prepareAnnualNeeds(inputs, confirmed ? 0 : inflation.rate).entries.map(entry => ({
        id: entry.id, before: UIUtils.parseCurrency(entry.element.value),
        after: UIUtils.parseCurrency(entry.formattedValue), formattedValue: entry.formattedValue
    })) : [];
    return { targetYear, planningYear, people, needs, confirmed, inflation: inflation || null };
}

/** Nur die Anzeige: unbekannte/identische Vorher-Werte erzeugen keinen Pfeil. */
export function formatAnnualNeed(need, { inflation, targetYear, adjustedFields = [] } = {}) {
    const money = value => Number.isFinite(value) ? UIUtils.formatCurrency(value) : '—';
    const adjusted = adjustedFields.includes(need.id);
    if (!Number.isFinite(need.before) || need.before === need.after) return money(need.after) + (adjusted ? ' (von dir angepasst)' : '');
    const rate = inflation?.rate;
    const detail = adjusted ? 'von dir angepasst' : Number.isFinite(rate)
        ? `${rate > 0 ? '+' : ''}${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(rate)} % Inflation ${targetYear}` : '';
    return `${money(need.before)} → ${money(need.after)}${detail ? ` (${detail})` : ''}`;
}
