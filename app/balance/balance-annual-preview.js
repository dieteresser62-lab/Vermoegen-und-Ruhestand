import { balanceCareSettings } from '../shared/person-data-status.js';
import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { prepareAnnualNeeds } from './balance-annual-inflation.js';
import { UIUtils } from './balance-utils.js';
import { roundAnnualSuggestion } from '../shared/annual-needs-review.js';
import { projectPerson, projectPersonPension } from '../profile/profile-person-data.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { readProfilePersonFromStorage } from '../profile/profile-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';

/** Lesende Projektion derselben Januar-, Renten- und Rundungsregeln wie der Jahrespfad. */
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {import('../../typcheck/balance-ui.js').AnnualPreviewOptions} [options] @returns Lesende Jahresvorschau. */
export function projectAnnualPreview({ targetYear, inputs, inflation, entries, careValues,
    storage = persistenceStorage, confirmed = false } = {}) {
    const planningYear = targetYear + 1;
    const status = entries ? { entries, calculationProfileId: storage.getItem('rs_current_profile') }
        : readBalancePersonStatus({ storage, referenceYear: planningYear });
    const people = (status.entries || []).map(entry => {
        try {
            const careSettings = { ...balanceCareSettings(status, entry.profileId), ...(careValues ? { careValues } : {}) };
            const person = projectPerson(entry.data, planningYear, careSettings);
            const pension = projectPersonPension(entry.data, planningYear, careSettings);
            return { id: entry.profileId, name: entry.name, ...person,
                budgetPensionMonthly: pension.monateImJahr === 12 ? pension.renteMonatlich : pension.renteImJahr / 12 };
        } catch (error) { return { id: entry.profileId, name: entry.name, error: error.message }; }
    });
    if (!people.length) {
        try {
            const person = /** @type {(storage: import("../../typcheck/datenvertraege.js").RecordReader, year: number)=>ReturnType<typeof readProfilePersonFromStorage>} */ (readProfilePersonFromStorage)(storage, planningYear);
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
/**
 * @param need Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** S7: Der neue Bedarf ist die auf volle 1.000 € aufgerundete Inflationsfortschreibung des alten.
 * @param {number} before Bedarf vorher. @param {number} after Bedarf nachher. @param {number} [rate] Inflation in %.
 * @returns {boolean} */
export function annualNeedRoundedUp(before, after, rate) {
    if (![before, after, rate].every(Number.isFinite)) return false;
    const projected = before * (1 + rate / 100);
    return after > projected + 0.005 && after === roundAnnualSuggestion(projected);
}

/** @param {{id: string, before: number, after: number}} need @param {{inflation?: Partial<import('../../typcheck/balance-ui.js').InflationResult>, targetYear?: number, adjustedFields?: string[]}} [options] @returns {string} */
export function formatAnnualNeed(need, { inflation, targetYear, adjustedFields = [] } = {}) {
    const money = value => Number.isFinite(value) ? UIUtils.formatCurrency(value) : '—';
    const adjusted = adjustedFields.includes(need.id);
    if (!Number.isFinite(need.before) || need.before === need.after) return money(need.after) + (adjusted ? ' (von dir angepasst)' : '');
    const rate = inflation?.rate;
    const detail = adjusted ? 'von dir angepasst' : Number.isFinite(rate)
        ? `${rate > 0 ? '+' : ''}${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(rate)} % Inflation ${targetYear}`
            + (annualNeedRoundedUp(need.before, need.after, rate) ? ', aufgerundet auf volle 1.000 €' : '') : '';
    return `${money(need.before)} → ${money(need.after)}${detail ? ` (${detail})` : ''}`;
}
