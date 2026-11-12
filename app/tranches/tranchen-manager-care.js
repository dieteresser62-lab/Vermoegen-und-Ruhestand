import { careSettingsStorage, readProfileCareSettings, sharesHouseholdCareValues } from '../shared/care-profile-settings.js';
import { readCareValues } from '../shared/household-care-values.js';
import { resolveCarePrices } from '../shared/care-prices.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { CARE_BENEFITS_2026, careAllowanceAnnual, careSettingsFromRecord, effectiveCareFormToday, noCareAllowanceReason } from '../shared/care-benefits.js';
import { readIncome } from '../profile/profile-income.js';
import { localCalendarDate } from '../shared/app-clock.js';
import { projectHouseholdCareNeeds, refreshCareHints } from '../shared/care-hint.js';
import { readHouseholdPersonStatus, readSingleProfileStatus } from '../shared/person-data-status.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { canonicalDecimalInput } from './tranchen-manager-decimal-input.js';
import { genitive } from './tranchen-manager-household-adoption.js';

const money = value => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
const euro = value => `${formatDisplayNumber(value, { fractionDigits: 0 })}\u00a0€`;

/** Gespeicherte Bedarfsprojektion der angezeigten Person aus der gemeinsamen Bedarfsrechnung (wie Reiter Pflege, Balance
 * und Simulator); null ohne Treffer. UR-1c/UR-1d: Eine Person außerhalb des Haushalts rechnet als Einzelprofil mit ihren
 * eigenen Pflegewerten, Zuschlag, Deckel und ihrem bestätigten Einzelplan; ohne ihn keine Projektion. */
function storedCareRow(storage) {
    try {
        const id = storage.getItem?.('rs_current_profile');
        if (!id) return null;
        const household = readHouseholdPersonStatus({ storage });
        const member = household?.entries?.some(entry => entry.profileId === id);
        const status = member ? household : readSingleProfileStatus({ storage });
        if (!status?.ready || !status.entries?.some(entry => entry.profileId === id)) return null;
        // UR-1d: Die Außenperson rechnet mit ihrem eigenen Einzelplan (profileId), wie der Simulator sie allein rechnet.
        return projectHouseholdCareNeeds({ storage, status, ...(member ? {} : { profileId: id }) })?.persons?.find(person => person.profileId === id) || null;
    } catch { return null; }
}

/** UR-1: Ergebniszeile „Angesetzt: …“ des Pflegebands. Betrag aus der gespeicherten Projektion, solange sie zum
 * Formular passt; sonst (noch nicht gespeichert, nicht berechenbar) ohne Betrag statt mit einem falschen (UR-1c). Liest nur. */
function careResult(doc, storage, { grade, careForm, storedForm, settings, prices, allowance }) {
    const field = doc.getElementById('profileCareHomeCostsMonthly');
    const raw = String(field?.value ?? '').trim();
    const parsed = raw === '' ? null : Number(canonicalDecimalInput(raw, field));
    const own = Number.isFinite(parsed) ? parsed : null;
    const row = storedCareRow(storage);
    const official = settings.preset === 'amtlich';
    const matches = row && row.grade === grade && row.form === careForm
        && (careForm === 'residential' || official || (row.homeCostsMonthly ?? null) === own);
    if (careForm === 'residential') {
        const share = row?.name ? `statt ${genitive(row.name)} Anteil am Grundbedarf` : 'statt des Anteils am Grundbedarf';
        return matches ? { amount: row.residentialCosts / 12, text: `Eigenanteil im ${row.heimJahr}. Heimjahr + ${euro(row.residentialOwnExpenses / 12)}/Monat eigene Ausgaben · ${share}` }
            : { amount: null, text: `Heimkosten nach Heimjahr und eigene Ausgaben · ${share}` };
    }
    const partnerFallback = careForm !== storedForm;
    const tail = allowance > 0 ? `Pflegegeld ${euro(allowance)}/Monat kommt als Einkunft dazu`
        : partnerFallback ? `kein Pflegegeld: Die Partnerperson hat heute selbst Pflegegrad ${settings.partnerCare?.grade}, die Angehörigenpflege fällt aus; gerechnet wird Pflege zu Hause mit externer Unterstützung`
            : noCareAllowanceReason({ grade, careForm, preset: settings.preset });
    const staffel = prices.costs[grade] / 12;
    const amount = matches ? row.personal / 12 : null;
    if (official) return { amount, text: 'Amtlicher Durchschnitt: zu Hause ohne Zusatz', tail };
    if (own !== null) return { amount, text: 'eigener Wert', extra: `(leer = Staffel ${euro(staffel)})`, tail };
    return { amount, text: `Staffel für Grad ${grade}`, tail };
}

/** Schreibt die Ergebniszeile; im echten Dokument mit hervorgehobenem Betrag. */
function renderCareResult(doc, node, result) {
    const amount = result.amount === null ? '' : `${euro(result.amount)}/Monat`;
    const plain = `Angesetzt: ${[amount, result.text, result.extra].filter(Boolean).join(' ')}${result.tail ? ` · ${result.tail}` : ''}`;
    if (typeof node.replaceChildren !== 'function' || typeof doc.createElement !== 'function') { node.textContent = plain; return; }
    const parts = ['Angesetzt: '];
    if (amount) { const strong = doc.createElement('strong'); strong.textContent = amount; parts.push(strong, ' '); }
    parts.push(result.text);
    if (result.extra) { const muted = doc.createElement('span'); muted.className = 'ds-help'; muted.textContent = result.extra; parts.push(' ', muted); }
    if (result.tail) parts.push(` · ${result.tail}`);
    node.replaceChildren(...parts);
}

/** @param doc Dokument mit den Pflegefeldern.
 * @param {import("../../typcheck/datenvertraege.js").RecordReader} [storage]
 * @returns {void} */
export function syncManagerCareToday(doc, storage = persistenceStorage) {
    const grade = Number(doc.getElementById('profileCareGradeToday')?.value) || 0;
    // UR-1: Ohne Grad zeigt das Pflegeband nur das Gradfeld und einen Satz.
    const fields = doc.getElementById('profileCareTodayFields');
    if (fields) fields.hidden = grade === 0;
    const formGroup = doc.getElementById('profileCareFormField');
    if (formGroup) formGroup.hidden = grade === 0;
    const none = doc.getElementById('profileCareNone');
    if (none) none.hidden = grade !== 0;
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
    const since = doc.getElementById('profileCareResidentialSince');
    if (since) since.max = localCalendarDate().slice(0, 7);
    const sinceField = doc.getElementById('profileCareResidentialSinceField');
    if (sinceField) sinceField.hidden = !grade || formField?.value !== 'residential';
    // FR-73 Punkt 13: eigener Wert nur bei Pflege zu Hause; bei „Amtlicher Durchschnitt“ ohne Wirkung (Netto-Konvention).
    const ownField = doc.getElementById('profileCareHomeCostsField');
    if (ownField) ownField.hidden = !grade || formField?.value === 'residential';
    const ownInput = doc.getElementById('profileCareHomeCostsMonthly');
    const prices = grade ? resolveCarePrices(careValues, careSettingsStorage(storage), { shared: sharesHouseholdCareValues(storage) }) : null;
    // Platzhalter nennt den Staffelbetrag des heutigen Grads (€/Monat), den ein leeres Feld bedeutet.
    if (ownInput && prices) ownInput.placeholder = `Staffel ${money(prices.costs[grade] / 12)}`;
    const ownHelp = doc.getElementById('profileCareHomeCostsHelp');
    if (ownHelp) ownHelp.textContent = settings.preset === 'amtlich'
        ? 'Ohne Wirkung: Beim amtlichen Durchschnitt gilt zu Hause die Netto-Konvention (0 € Zusatz, kein Pflegegeld).'
        : 'Leer rechnet die App mit dem Staffelbetrag des Grads; auch 0 € gilt. Der Jahresabschluss schreibt den Wert wie die Staffel fort.';
    // FR-73 Punkt 10: Hinweise aus dem gespeicherten Haushaltszustand, auf Personenkarte und Haushalt & Plan gemeinsam.
    refreshCareHints(doc, { storage });
    const summary = doc.getElementById('profileCareAllowanceSummary');
    if (summary) {
        const storedForm = formField?.value || settings.forms[grade];
        // Argon FR73A B3: wirksame Form wie Balance und Simulator; hat die Partnerperson heute Grad 3 oder mehr, fällt die Angehörigenpflege aus (P6).
        const careForm = effectiveCareFormToday({ grade, form: storedForm }, settings) || storedForm;
        const allowance = /** @type {import("../../typcheck/simulator-ui.js").CareAllowanceAnnual} */ (careAllowanceAnnual)({ grade, careForm, preset: settings.preset, careValues }) / 12;
        summary.hidden = !grade;
        if (grade) renderCareResult(doc, summary, careResult(doc, storage, { grade, careForm, storedForm, settings, prices, allowance }));
        else summary.textContent = '';
    }
    if (table) table.innerHTML = Object.entries(CARE_BENEFITS_2026).map(([grade, row]) =>
        `<tr><th scope="row">${grade}</th>${['allowance', 'services', 'relief', 'respiteAnnual', 'residential'].map(key => `<td>${key === 'residential' && Number(grade) === 1 ? '—' : money(key === 'allowance' ? careValues.allowance.values[grade] || 0 : row[key])}</td>`).join('')}</tr>`).join('');
    const source = doc.getElementById('profileCareBenefitsSource');
    if (source) {
        source.href = careValues.allowance.source;
        source.textContent = `Bundesgesundheitsministerium · Pflegegeld Stand ${careValues.allowance.asOf.split('-').reverse().join('.')} · ${careValues.allowance.origin}`;
    }
}
