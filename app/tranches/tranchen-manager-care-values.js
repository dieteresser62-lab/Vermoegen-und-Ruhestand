/** PFA-10: Bereich „Pflege“ in Personen & Vermögen. Zeigt den heutigen Pflegezustand des Haushalts und die Pflegewerte
 * (seit PFA-11 auch regionalen Zuschlag und Flex-Level je Grad),
 * mit denen Balance, Simulator, Jahresabschluss und Personenkarten rechnen. Geschrieben wird über denselben Weg wie im
 * Simulator (`care-price-fields.js`); Lesen schreibt nie. Bei einer Außenperson zeigt und ändert der Bereich ihre
 * eigenen Werte, wie der Simulator. Seit UR-1 stehen die Werte in Aufklappzeilen (`tranchen-manager-care-rows.js`). */
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { CARE_FORMS } from '../shared/care-benefits.js';
import { CARE_RECORD_FIELDS, CARE_RECORD_LIMITS, careRecordLimitText, PFLEGE_COST_PRESETS, readCareFieldValues, writeCarePreset, writeCareRecordField, writeCareSettingField } from '../shared/care-price-fields.js';
import { officialCareCosts, readCareValues, residentialComponents, residentialMonthly } from '../shared/household-care-values.js';
import { resolveCarePrices } from '../shared/care-prices.js';
import { careSettingsStorage, sharesHouseholdCareValues } from '../shared/care-profile-settings.js';
import { projectHouseholdCareNeeds } from '../shared/care-hint.js';
import { readHouseholdPersonStatus } from '../shared/person-data-status.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { escapeHtml } from '../shared/security-utils.js';
import { canonicalDecimalInput, displayDecimalInput } from './tranchen-manager-decimal-input.js';
import { bindCareRows, careOriginText, careRowSummaries, renderCareRowSummaries } from './tranchen-manager-care-rows.js';
import { setFieldState } from '../shared/field-state.js';

const GRADES = [1, 2, 3, 4, 5];
const FORM_TEXT = { family: 'zu Hause durch Angehörige', 'home-support': 'zu Hause mit externer Unterstützung', residential: 'im Heim' };
const PRESET_HINTS = { custom: 'Deine eigenen Beträge je Grad. Beim Wechsel zu einer Vorgabe merkt die App sie und stellt sie wieder her.',
    ambulant: PFLEGE_COST_PRESETS.ambulant.description, amtlich: PFLEGE_COST_PRESETS.amtlich.description };
const euro = value => formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 });

function careToday(storage, values) {
    let status = null, needs = null;
    try { status = readHouseholdPersonStatus({ storage }); } catch { status = null; }
    if (!status?.ready || !status.entries?.length) return { entries: [], needs: null, message: 'Der Pflegezustand der Personen ist gerade nicht lesbar.' };
    try { needs = projectHouseholdCareNeeds({ storage, status }); } catch { needs = null; }
    const rows = new Map((needs?.persons || []).map(row => [row.profileId, row]));
    return { entries: status.entries.map(entry => ({ id: entry.profileId, name: entry.name, row: rows.get(entry.profileId) || null })), needs, preset: values.pflegeKostenStaffelPreset };
}

function personCard({ id, name, row }, prices, preset) {
    const link = `<a class="ds-text-link" href="#personendaten" data-care-person="${escapeHtml(id)}">Zur Personenkarte →</a>`;
    const head = `<div class="pv-care-person-head"><strong>${escapeHtml(name)}</strong>${link}</div>`;
    if (!row?.grade) return `<article class="pv-care-person">${head}<p class="ds-help">Kein Pflegegrad heute</p></article>`;
    const residential = row.form === 'residential';
    const own = !residential && preset !== 'amtlich' && Number.isFinite(row.homeCostsMonthly);
    const since = residential && row.residentialSince ? ` seit ${row.residentialSince.slice(5)}/${row.residentialSince.slice(0, 4)}` : '';
    const state = `Grad ${row.grade} · ${FORM_TEXT[row.form] || CARE_FORMS[row.form] || 'Form offen'}${since}${residential ? ` · Heimjahr ${row.heimJahr}` : ''}`;
    // UR-1: Kachel mit Monatsbetrag als Kennzahl und genau einer Erklärzeile.
    const unit = residential ? '/Monat Heim nach Zuschuss der Kasse'
        : `/Monat über die Kasse hinaus · ${own ? 'eigener Wert' : preset === 'amtlich' ? 'Amtlicher Durchschnitt' : 'Staffel'}`;
    const allowance = row.careAllowance > 0 ? `Pflegegeld ${euro(row.careAllowance / 12)}/Monat kommt als Einkunft dazu` : '';
    const detail = residential ? `${euro(row.residentialCosts / 12)} Eigenanteil im ${row.heimJahr}. Heimjahr + ${euro(row.residentialOwnExpenses / 12)} eigene Ausgaben`
        : own ? `Ohne eigenen Wert gälte die Staffel für Grad ${row.grade}: ${euro(prices.costs[row.grade] / 12)}/Monat`
            : preset === 'amtlich' ? 'Amtlicher Durchschnitt: zu Hause ohne Zusatz und ohne Pflegegeld' : `Staffel für Grad ${row.grade}`;
    return `<article class="pv-care-person" data-care-person-card="${escapeHtml(id)}">${head}<p>${escapeHtml(state)}</p>
        <p class="pv-care-amount"><strong>${euro(row.personal / 12)}</strong><span class="ds-help">${escapeHtml(unit)}</span></p><p class="ds-help">${escapeHtml([detail, allowance].filter(Boolean).join(' · '))}</p></article>`;
}

const tile = (term, value) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`;
const setText = (doc, id, text) => { const node = doc.getElementById(id); if (node && node.textContent !== text) node.textContent = text; };

/** Füllt den Bereich aus dem gespeicherten Stand; schreibt nie.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @param {{storage?: import("../../typcheck/datenvertraege.js").RecordReader}} [options]
 * @returns {boolean} Ob der Bereich gefüllt wurde.
 */
export function renderManagerCareValues(doc, { storage = persistenceStorage } = {}) {
    const panel = doc?.getElementById?.('managerCarePanel');
    if (!panel) return false;
    let values, careValues, prices, shared;
    try {
        values = readCareFieldValues(storage); careValues = readCareValues(storage); shared = sharesHouseholdCareValues(storage);
        prices = resolveCarePrices(careValues, careSettingsStorage(storage), { shared });
    } catch (error) {
        setText(doc, 'managerCareStatus', `Pflegewerte nicht lesbar: ${error.message}`);
        return false;
    }
    const preset = values.pflegeKostenStaffelPreset, official = preset === 'amtlich';
    const owner = doc.getElementById('managerCareOwner');
    if (owner) {
        let name = '';
        try { name = JSON.parse(storage.getItem('rs_profiles_v1') || 'null')?.profiles?.[storage.getItem('rs_current_profile')]?.meta?.name || ''; } catch { name = ''; }
        owner.hidden = shared;
        owner.textContent = shared ? '' : `Du siehst die eigenen Pflegewerte von ${name || 'dieser Person'}. Sie gehört nicht zum Haushalt; der Haushalt rechnet mit seinen Werten.`;
    }
    const today = careToday(storage, values);
    const host = doc.getElementById('managerCareToday');
    if (host) host.innerHTML = today.entries.length ? today.entries.map(entry => personCard(entry, prices, preset)).join('')
        : `<p class="ds-help">${escapeHtml(today.message || 'Noch keine Person im Haushalt.')}</p>`;
    // Zeilen „im Heim“ rechnen mit den Heimkosten; lebt heute jemand mit diesem Grad zu Hause, gilt die Staffel (wie im Simulator).
    const homeGrades = new Set(today.entries.filter(entry => entry.row?.grade && entry.row.form !== 'residential').map(entry => entry.row.grade));
    const costs = official ? officialCareCosts(careValues) : null;
    for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (doc.querySelectorAll('#managerCarePreset [data-care-preset]'))) {
        button.setAttribute('aria-pressed', String(button.dataset.carePreset === preset));
    }
    setText(doc, 'managerCarePresetHint', PRESET_HINTS[preset] || '');
    for (const cell of /** @type {NodeListOf<HTMLElement>} */ (panel.querySelectorAll('[data-care-form-cell]'))) cell.hidden = official;
    for (const grade of GRADES) {
        const form = /** @type {HTMLSelectElement|null} */ (doc.getElementById(`managerCareForm${grade}`));
        if (form && doc.activeElement !== form) form.value = values[`pflegeStufe${grade}Form`];
        const residential = !official && values[`pflegeStufe${grade}Form`] === 'residential' && !homeGrades.has(grade);
        const annual = official ? costs[grade] : Number(values[`pflegeStufe${grade}Zusatz`]);
        const input = /** @type {HTMLInputElement|null} */ (doc.getElementById(`managerCareCost${grade}`));
        if (input) {
            if (doc.activeElement !== input) input.value = displayDecimalInput(String(annual), input);
            input.disabled = official || residential;
            input.title = official ? 'Amtlicher Durchschnitt aus den Heimwerten' : residential ? 'Im Heim zählen die Heimkosten' : '';
        }
        setText(doc, `managerCareMonthly${grade}`, residential ? 'Heimkosten' : euro(annual / 12));
    }
    const fields = [['managerCareMaxFloor', 'pflegeMaxFloor'], ['managerCareDrift', 'pflegeKostenDrift'], ['managerCareOwnExpenses', 'pflegeHeimEigeneAusgaben'],
        ['managerCareRegional', 'pflegeRegionalZuschlag'], ...GRADES.map(grade => [`managerCareFlex${grade}`, `pflegeStufe${grade}FlexCut`])];
    for (const [id, field] of fields) {
        const input = /** @type {HTMLInputElement|null} */ (doc.getElementById(id));
        if (input && doc.activeElement !== input) input.value = displayDecimalInput(values[field], input);
    }
    const components = residentialComponents(careValues.residential);
    // UR-2: Pflegegeld und Heim-Bestandteile als Felder; sie gehören dem Haushalt, eine Außenperson sieht sie nur.
    const record = { careAllowance2: careValues.allowance.values[2], careAllowance3: careValues.allowance.values[3], careAllowance4: careValues.allowance.values[4],
        careAllowance5: careValues.allowance.values[5], careResidentialCare: components.care, careResidentialBoard: components.board, careResidentialInvest: components.invest };
    for (const [field, value] of Object.entries(record)) {
        const input = /** @type {HTMLInputElement|null} */ (doc.getElementById(RECORD_INPUT_IDS[field]));
        if (!input) continue;
        if (doc.activeElement !== input) input.value = displayDecimalInput(String(Number(value.toFixed(2))), input);
        input.disabled = !shared;
        input.title = shared ? '' : 'Pflegegeld und Heimwerte gelten für den Haushalt; ändern in der Ansicht einer Person im Haushalt.';
    }
    setText(doc, 'managerCareHeimSource', `${careOriginText(careValues.residential, 'residential')} · ändern hier oder im Jahresabschluss unter „Werte ändern …“`);
    const years = doc.getElementById('managerCareHeimYears');
    if (years) years.innerHTML = [1, 2, 3, 4].map(year => tile(year === 4 ? 'ab 4. Heimjahr' : `${year}. Heimjahr`, euro(residentialMonthly(components, year)))).join('');
    // UR-1: Je Zeile ein Satz mit den aktuellen Werten, nach jeder Änderung neu.
    renderCareRowSummaries(doc, careRowSummaries({ values, careValues, officialCosts: costs, homeGrades }));
    setText(doc, 'managerCareStand', prices.priceYear ? `Preisstand ${prices.priceYear}` : `Preise ${prices.origin}`);
    return true;
}

const bound = new WeakSet();
const RECORD_INPUT_IDS = Object.freeze({ careAllowance2: 'managerCareAllowance2', careAllowance3: 'managerCareAllowance3', careAllowance4: 'managerCareAllowance4',
    careAllowance5: 'managerCareAllowance5', careResidentialCare: 'managerCareHeimCare', careResidentialBoard: 'managerCareHeimBoard', careResidentialInvest: 'managerCareHeimInvest' });
/** UR-2: Grund am Feld (Designsystem-Feldzustand), nur im echten Dokument. */
const fieldReason = (field, reason) => { if (field?.ownerDocument && field.parentNode) setFieldState(field, reason ? 'error' : 'editable', reason); };

/** Speichert jede Änderung sofort wie der Autosave des Simulators und bestätigt sie mit der Persistenz.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @param {{openPerson?: (profileId: string) => unknown, blocked?: () => boolean}} [options]
 * @returns {void}
 */
export function bindManagerCareValues(doc, { openPerson = () => {}, blocked = () => false } = {}) {
    const panel = doc?.getElementById?.('managerCarePanel');
    if (!panel || bound.has(panel)) return;
    bound.add(panel);
    bindCareRows(doc);
    const status = text => setText(doc, 'managerCareStatus', text);
    const commit = async write => {
        if (blocked()) { status('Gerade nicht änderbar; bitte die laufende Aktion abschließen.'); renderManagerCareValues(doc); return false; }
        status('Wird gespeichert …');
        try { write(); }
        catch (error) { status(`Nicht gespeichert: ${error.message}`); renderManagerCareValues(doc); return false; }
        let saved = true;
        try { saved = await PersistenceFacade.flush() !== false; } catch { saved = false; }
        renderManagerCareValues(doc);
        status(saved ? 'Gespeichert' : 'Nicht gespeichert. Bitte erneut versuchen.');
        return saved;
    };
    panel.addEventListener('change', event => {
        const field = /** @type {HTMLInputElement|HTMLSelectElement} */ (event.target);
        const id = field?.dataset?.careField;
        if (!id || field.disabled) return;
        if (field.tagName === 'SELECT') { void commit(() => writeCareSettingField(id, field.value)); return; }
        const canonical = canonicalDecimalInput(field.value, field);
        const flexLevel = /FlexCut$/.test(id);
        if (Object.hasOwn(CARE_RECORD_FIELDS, id)) {
            // UR-2: Pflegegeld und Heim-Bestandteile in den Pflegewerte-Record; ungültig speichert nicht und nennt den Grund am Feld.
            if (canonical === '' || canonical === 'NaN' || !Number.isFinite(Number(canonical)) || Number(canonical) < 0) {
                const reason = 'Bitte einen Betrag ab 0 eintragen; der bisherige Wert bleibt.';
                fieldReason(field, reason); status(reason); renderManagerCareValues(doc);
                return;
            }
            if (Number(canonical) > CARE_RECORD_LIMITS[CARE_RECORD_FIELDS[id][0]]) {
                const reason = careRecordLimitText(id);
                fieldReason(field, reason); status(reason); renderManagerCareValues(doc);
                return;
            }
            fieldReason(field, '');
            void commit(() => writeCareRecordField(id, canonical));
            return;
        }
        if (canonical === '' || canonical === 'NaN' || Number(canonical) < 0 || (flexLevel && Number(canonical) > 100)) {
            status(flexLevel ? 'Bitte ein Flex-Level von 0 bis 100 % eintragen; der bisherige Wert bleibt.' : 'Bitte einen Betrag ab 0 eintragen; der bisherige Wert bleibt.');
            renderManagerCareValues(doc);
            return;
        }
        const preset = readCareFieldValues().pflegeKostenStaffelPreset;
        void commit(() => writeCareSettingField(id, canonical, { preset }));
    });
    panel.addEventListener('keydown', event => {
        const field = /** @type {HTMLInputElement} */ (event.target);
        if (event.key === 'Enter' && field?.dataset?.careField && field.tagName === 'INPUT') { event.preventDefault(); field.blur(); }
    });
    panel.addEventListener('click', event => {
        const target = /** @type {HTMLElement} */ (event.target);
        const presetButton = /** @type {HTMLButtonElement|null} */ (target?.closest?.('[data-care-preset]'));
        if (presetButton && !presetButton.disabled) {
            const values = readCareFieldValues(), previous = values.pflegeKostenStaffelPreset, next = presetButton.dataset.carePreset;
            if (next === previous) return;
            const current = Object.fromEntries(GRADES.map(grade => [grade, values[`pflegeStufe${grade}Zusatz`]]));
            void commit(() => writeCarePreset(next, previous, current));
            return;
        }
        const person = /** @type {HTMLElement|null} */ (target?.closest?.('[data-care-person]'));
        if (person) { event.preventDefault(); void openPerson(person.dataset.carePerson); }
    });
}
