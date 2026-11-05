import { readProfileCareSettings } from '../shared/care-profile-settings.js';
import { readCareValues } from '../shared/household-care-values.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { CARE_BENEFITS_2026, CARE_FORMS, careAllowanceAnnual, careSettingsFromRecord, noCareAllowanceReason } from '../shared/care-benefits.js';
import { readIncome } from '../profile/profile-income.js';

const money = value => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });

/** @param doc Dokument mit den Pflegefeldern.
 * @param {import("../../typcheck/datenvertraege.js").RecordReader} [storage]
 * @returns {void} */
export function syncManagerCareToday(doc, storage = persistenceStorage) {
    const grade = Number(doc.getElementById('profileCareGradeToday')?.value) || 0;
    const fields = doc.getElementById('profileCareTodayFields');
    if (fields) fields.hidden = grade === 0;
    const warning = doc.getElementById('profileCareIncomeWarning');
    if (warning) {
        let incomes = [];
        try { incomes = readIncome(doc.getElementById('profileEinkuenfte')?.value || '[]', { draft: true }); } catch { /* Entwurf wird separat validiert. */ }
        const pensionLabel = doc.getElementById('profileRenteBezeichnung')?.value || '';
        warning.hidden = !grade || !(/pflegegeld/i.test(pensionLabel)
            || incomes.some(income => /pflegegeld/i.test(income.bezeichnung || '')));
    }
    const table = doc.getElementById('profileCareBenefitsRows');
    const careValues = readCareValues(storage);
    const formField = doc.getElementById('profileCareFormToday');
    const settings = readProfileCareSettings(storage);
    if (!grade && formField) formField.value = '';
    if (grade && formField && !formField.value) formField.value = settings.forms[grade] || 'family';
    if (formField) formField.disabled = !grade;
    const summary = doc.getElementById('profileCareAllowanceSummary');
    if (summary) {
        const careForm = formField?.value || settings.forms[grade];
        const allowance = /** @type {import("../../typcheck/simulator-ui.js").CareAllowanceAnnual} */ (careAllowanceAnnual)({ grade, careForm, preset: settings.preset, careValues }) / 12;
        summary.hidden = !grade;
        summary.textContent = allowance > 0 ? `Pflegegeld: ${money(allowance)} €/Monat als Einkunft (${CARE_FORMS[careForm]})`
            : noCareAllowanceReason({ grade, careForm, preset: settings.preset });
    }
    if (table) table.innerHTML = Object.entries(CARE_BENEFITS_2026).map(([grade, row]) =>
        `<tr><th scope="row">${grade}</th>${['allowance', 'services', 'relief', 'respiteAnnual', 'residential'].map(key => `<td>${key === 'residential' && Number(grade) === 1 ? '—' : money(key === 'allowance' ? careValues.allowance.values[grade] || 0 : row[key])}</td>`).join('')}</tr>`).join('');
    const source = doc.getElementById('profileCareBenefitsSource');
    if (source) {
        source.href = careValues.allowance.source;
        source.textContent = `Bundesgesundheitsministerium · Pflegegeld Stand ${careValues.allowance.asOf.split('-').reverse().join('.')} · ${careValues.allowance.origin}`;
    }
}
