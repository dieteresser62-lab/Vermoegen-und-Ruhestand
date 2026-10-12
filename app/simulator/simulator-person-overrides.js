import { appNow } from '../shared/app-clock.js';
import { canonicalizeHistoricalContractValue } from './historical-backtest-contract.js';
import { projectPerson, personReferenceYear } from '../profile/profile-person-data.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from './simulator-profile-inputs.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { CONFIG } from '../balance/balance-config.js';
import { setFieldState } from '../shared/field-state.js';

// Ausschließlich Dokument-/Objektlebensdauer. Keine exportierbaren Profile oder Speicherschlüssel.
const documents = new WeakMap();
const contexts = new WeakMap();
const clone = value => JSON.parse(JSON.stringify(value));
export function freezePersonDataContext(value) {
    if (value == null) return null;
    const copy = clone(value);
    const freeze = object => { if (object && typeof object === 'object') { Object.values(object).forEach(freeze); Object.freeze(object); } };
    freeze(copy);
    return copy;
}
export function bindPersonDataContext(object, context) {
    if (object && context) contexts.set(object, freezePersonDataContext(context));
    return object;
}
export function personDataContextFor(object) { return contexts.get(object) || null; }
export function validatePersonDataContext(context) {
    if (context == null) return null;
    const invalid = () => { throw new TypeError('Ungültiger Personenbeleg für den Ergebnisexport.'); };
    if (context.schemaVersion !== 1 || context.ageRule !== 'january-1-completed-years'
        || !Number.isInteger(context.referenceYear) || context.referenceYear < 1 || context.referenceYear > 9999
        || typeof context.deviationApplied !== 'boolean' || !Array.isArray(context.persons) || context.persons.length < 1) invalid();
    const ids = new Set();
    for (const person of context.persons) {
        if (!person || typeof person.profileId !== 'string' || !person.profileId.trim() || ids.has(person.profileId)
            || !['primary', 'partner'].includes(person.role) || !Array.isArray(person.changes)) invalid();
        ids.add(person.profileId);
        const fields = new Set();
        for (const change of person.changes) {
            const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean'
                || typeof value === 'number' && Number.isFinite(value);
            if (!change || !Object.values(editable).includes(change.field) || fields.has(change.field)
                || !scalar(change.profileValue) || !scalar(change.effectiveValue)
                || change.profileValue === change.effectiveValue) invalid();
            fields.add(change.field);
        }
    }
    if (context.persons.filter(person => person.role === 'primary').length !== 1
        || context.deviationApplied !== context.persons.some(person => person.changes.length > 0)) invalid();
    return context;
}
export function personDataCsvFields(context) {
    validatePersonDataContext(context);
    return context ? { personDataReferenceYear: context.referenceYear,
        personDataDeviationApplied: context.deviationApplied,
        personDataChanges: canonicalizeHistoricalContractValue(context.persons) } : {};
}

const editable = {
    p1Geburtsdatum: 'profile_geburtsdatum', p1Rentenbeginn: 'profile_rentenbeginn',
    p1Monatsrente: 'profile_rente_monatlich', p1Geschlecht: 'profile_geschlecht',
    p1SparerPauschbetrag: 'profile_sparer_pauschbetrag', p1KirchensteuerPct: 'profile_kirchensteuer_pct',
    rentAdjMode: 'profile_rentenanpassung_art', rentAdjPct: 'profile_rentenanpassung_pct',
    r2Geburtsdatum: 'profile_geburtsdatum', r2Rentenbeginn: 'profile_rentenbeginn',
    r2Monatsrente: 'profile_rente_monatlich', r2Geschlecht: 'profile_geschlecht',
    r2SparerPauschbetrag: 'profile_sparer_pauschbetrag', r2KirchensteuerPct: 'profile_kirchensteuer_pct',
    r2Steuerquote: 'profile_rente_steuerquote_pct'
};
export const SIMULATOR_PERSON_FIELD_IDS = Object.freeze([...Object.keys(editable),
    'p1StartAlter', 'p1StartInJahren', 'r2StartAlter', 'r2StartInJahren', 'chkPartnerAktiv',
    'startAlter', 'geschlecht', 'startSPB', 'kirchensteuerSatz', 'renteMonatlich',
    'renteStartOffsetJahre', 'renteIndexierungsart', 'renteFesterSatz', 'r2Brutto', 'r2Anpassung']);
const numeric = new Set(['profile_rente_monatlich', 'profile_sparer_pauschbetrag',
    'profile_kirchensteuer_pct', 'profile_rente_steuerquote_pct', 'profile_rentenanpassung_pct']);

export function createPersonOverrides(entries, primaryId, referenceYear) {
    const baseline = clone(entries);
    let active = false;
    let draft = {};
    const primary = baseline.find(entry => entry.profileId === primaryId) || baseline[0];
    const ordered = [primary, ...baseline.filter(entry => entry !== primary)].filter(Boolean);
    return {
        get active() { return active; },
        get entries() { return clone(ordered); },
        activate(value) { active = value === true; draft = {}; },
        reset() { active = false; draft = {}; },
        set(profileId, key, value) {
            if (!active || !ordered.some(entry => entry.profileId === profileId)) return false;
            if (!Object.values(editable).includes(key)) throw new Error('Unbekannte Personenabweichung.');
            draft[profileId] ||= {};
            draft[profileId][key] = numeric.has(key) ? (value === '' ? NaN : Number(value)) : value;
            return true;
        },
        read(year = referenceYear) {
            const persons = [];
            const effectiveEntries = ordered.map((entry, index) => {
                const data = { ...entry.data, ...(active ? draft[entry.profileId] : {}) };
                // Dormante Sätze und die Partneranpassung sind keine wirksamen Alternativen.
                if (data.profile_rentenanpassung_art !== 'fix' || index > 0) data.profile_rentenanpassung_pct = entry.data.profile_rentenanpassung_pct;
                const original = projectPerson(entry.data, year);
                const effective = projectPerson(data, year);
                const changes = Object.keys(active ? draft[entry.profileId] || {} : {}).filter(key => {
                    if (key === 'profile_rentenanpassung_pct' && data.profile_rentenanpassung_art !== 'fix') return false;
                    if (index > 0 && key.startsWith('profile_rentenanpassung')) return false;
                    const before = numeric.has(key) ? Number(entry.data[key] ?? 0) : (entry.data[key] ?? '');
                    return before !== data[key];
                }).map(key => ({ field: key, profileValue: numeric.has(key) ? Number(entry.data[key] ?? 0) : entry.data[key] ?? '', effectiveValue: data[key] }));
                persons.push({ profileId: entry.profileId, role: index === 0 ? 'primary' : 'partner',
                    ageStatus: effective.ageStatus, profileAgeStatus: original.ageStatus, changes });
                return { ...entry, data, inputs: buildSimulatorInputsFromProfileData(data, { referenceYear: year }) };
            });
            const { combined, warnings } = combineSimulatorProfiles(effectiveEntries, ordered[0]?.profileId);
            const context = freezePersonDataContext({ schemaVersion: 1, referenceYear: year,
                ageRule: 'january-1-completed-years', deviationApplied: persons.some(person => person.changes.length > 0), persons,
                sharedPensionAdjustment: { sourceProfileId: ordered[0]?.profileId,
                    mode: combined.rentAdjMode, percent: combined.rentAdjMode === 'fix' ? combined.rentAdjPct : null } });
            return { combined, entries: effectiveEntries, context, warnings };
        }
    };
}

function currentYear(state) {
    const raw = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
    return personReferenceYear(raw ? JSON.parse(raw).annualPeriodMetadata : null, Math.max(state.referenceYear, appNow().getFullYear()));
}
export function readDocumentPersonInputs(doc = globalThis.document) {
    const state = documents.get(doc);
    if (!state) return null;
    const year = currentYear(state);
    if (state.renderedYear !== year) render(state, doc);
    return state.controller.read(year);
}
export function resetPersonOverrides(doc = globalThis.document) {
    const state = documents.get(doc);
    if (state) { state.controller.reset(); render(state, doc); }
}

const germanNumber = value => Number.isFinite(Number(value))
    ? Number(value).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : 'nicht bekannt';
const germanDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
    ? value.split('-').reverse().join('.') : 'noch nicht eingetragen';

// Dieselben Knoten wechseln ihren Host. IDs, Setter und Listener bleiben einmalig.
function showPersonValues(doc, id, editorId, rows, active) {
    const list = doc.getElementById(id);
    const editors = doc.getElementById(editorId);
    const cache = doc.getElementById('personEditorCache');
    if (!list || !editors || !cache) return;
    const host = active ? list.parentNode : cache;
    if (editors.parentNode !== host) host.insertBefore(editors, active ? list.nextSibling : null);
    list.hidden = active;
    list.replaceChildren();
    for (const [label, value] of rows) {
        const term = doc.createElement('dt'), definition = doc.createElement('dd');
        term.textContent = label;
        definition.textContent = value;
        list.appendChild(term); list.appendChild(definition);
    }
}

function render(state, doc) {
    const year = currentYear(state);
    const { combined, entries, context } = state.controller.read(year);
    state.renderedYear = year;
    for (const [index, role] of ['p1', 'r2'].entries()) {
        const entry = entries[index];
        const data = entry?.data || {};
        const person = entry ? projectPerson(data, year) : {};
        const age = index === 0 ? combined.startAlter : combined.partner.startAlter;
        const offset = index === 0 ? combined.renteStartOffsetJahre : combined.partner.startInJahren;
        const rows = [
            ['Geburtsdatum', germanDate(data.profile_geburtsdatum)],
            [`Alter am 01.01.${year}`, `${germanNumber(age)} Jahre`],
            ['Geschlecht', { m: 'Männlich', w: 'Weiblich', d: 'Divers' }[person.geschlecht] || 'nicht eingetragen'],
            ['Rentenbeginn', germanDate(data.profile_rentenbeginn)],
            ['Monatliche Rente', `${germanNumber(person.renteMonatlich ?? 0)} €`],
            ['Sparer-Pauschbetrag', `${germanNumber(person.startSPB ?? 0)} €`],
            ['Kirchensteuer', `${germanNumber((person.kirchensteuerSatz ?? 0) * 100)} %`]
        ];
        if (offset > 0) rows.splice(4, 0, ['Rentenbeginn in', `${germanNumber(offset)} Jahren`]);
        if (index > 0) rows.push(['Steuerquote · bisherige Rentenbasis', `${germanNumber(person.steuerquotePct ?? 0)} %`]);
        showPersonValues(doc, `${role}PersonValues`, `${role}PersonEditors`, rows, state.controller.active && Boolean(entry));
    }
    showPersonValues(doc, 'sharedPensionValues', 'sharedPensionEditors', [
        ['Gemeinsame Rentenanpassung nach Hauptprofil', combined.rentAdjMode === 'fix'
            ? `${germanNumber(combined.rentAdjPct)} % p.a.` : combined.rentAdjMode === 'wage' ? 'Lohnentwicklung' : 'Inflation']
    ], state.controller.active);
    const adopted = {
        p1StartAlter: combined.startAlter, r2StartAlter: combined.partner.startAlter ?? 0,
        p1StartInJahren: combined.renteStartOffsetJahre, r2StartInJahren: combined.partner.startInJahren ?? 0,
        startAlter: combined.startAlter, geschlecht: combined.geschlecht, startSPB: combined.startSPB,
        kirchensteuerSatz: combined.kirchensteuerSatz * 100, renteMonatlich: combined.renteMonatlich,
        renteStartOffsetJahre: combined.renteStartOffsetJahre, renteIndexierungsart: combined.renteIndexierungsart,
        renteFesterSatz: combined.rentAdjPct, r2Brutto: combined.partner.brutto ?? 0, r2Anpassung: combined.rentAdjPct
    };
    for (const id of SIMULATOR_PERSON_FIELD_IDS) {
        const field = doc.getElementById(id);
        if (!field) continue;
        const entry = entries[id.startsWith('r2') ? 1 : 0];
        const key = editable[id];
        const inactive = id === 'rentAdjPct' && combined.rentAdjMode !== 'fix';
        const unlocked = state.controller.active && key && entry && !inactive && !globalThis.window?.__profileRecoveryBlocker;
        field.setCustomValidity?.('');
        field.dataset.noPersist = 'true';
        field.disabled = !unlocked;
        if (id === 'chkPartnerAktiv') field.checked = entries.length > 1;
        else field.value = key ? entry?.data[key] ?? (numeric.has(key) ? 0 : '') : adopted[id] ?? '';
        const changed = entry && context.persons.find(person => person.profileId === entry.profileId)?.changes.some(change => change.field === key);
        const baseline = state.controller.entries[id.startsWith('r2') ? 1 : 0]?.data[key];
        field.dataset.profileFieldOrigin = unlocked ? '' : 'Aus Personen & Vermögen übernommen.';
        if (state.controller.active && field.ownerDocument && field.parentNode && field.type !== 'hidden') setFieldState(field,
            unlocked ? 'editable' : 'adopted', changed ? `Profil: ${baseline ?? 'nicht bekannt'} · nur diese Rechnung`
                : inactive ? 'Satz bei Lohn-/Inflationskopplung nicht anwendbar.' : key ? 'Aus Personen & Vermögen übernommen.' : `Abgeleitet am 01.01.${context.referenceYear}.`);
        for (const button of doc.querySelectorAll?.(`[data-select-segment="${id}"] button`) || []) {
            button.disabled = field.disabled;
            button.setAttribute('aria-pressed', String(button.dataset.value === field.value));
        }
    }
    const toggle = doc.getElementById('personDeviationToggle');
    if (toggle) toggle.checked = state.controller.active;
    const notice = doc.getElementById('personDeviationStatus');
    if (notice) notice.textContent = context.deviationApplied ? 'Abweichung · nur diese Rechnung. Ergebnis und Protokoll behalten ihre eigenen Werte.'
        : state.controller.active ? 'Alternativen aktiv · bisher keine wirksame Abweichung.' : 'Übernommen · gerechnet wird mit Personen & Vermögen.';
    for (const [index, role] of ['p1', 'r2'].entries()) {
        const host = doc.getElementById(`${role}PersonSource`);
        if (host) {
            const entry = entries[index];
            host.hidden = !entry;
            host.textContent = entry ? `${entry.name || entry.profileId} · ${index === 0 ? 'Hauptprofil' : 'Partner'} · aus Personen & Vermögen${context.persons[index].ageStatus === 'fallback' ? ' · festes Altalter; Geburtsdatum zentral ergänzen' : ''}` : '';
        }
    }
    const spb = doc.getElementById('personHouseholdSPB');
    if (spb) spb.textContent = `Wirksamer Sparer-Pauschbetrag im Haushalt: ${germanNumber(combined.startSPB)} € · gemeinsame Rentenanpassung nach Hauptprofil.`;
}

export function initializePersonOverrides(entries, primaryId, referenceYear, doc = globalThis.document) {
    const previous = documents.get(doc);
    previous?.dispose();
    const state = { referenceYear, controller: createPersonOverrides(entries, primaryId, referenceYear) };
    documents.set(doc, state);
    const changed = event => {
        const id = event.target?.id;
        if (id !== 'personDeviationToggle' && !SIMULATOR_PERSON_FIELD_IDS.includes(id)) return;
        try {
            if (id === 'personDeviationToggle') state.controller.activate(event.target.checked);
            else if (editable[id] && !event.target.disabled) {
                const entry = state.controller.entries[id.startsWith('r2') ? 1 : 0];
                if (entry) state.controller.set(entry.profileId, editable[id], event.target.value);
            }
            render(state, doc);
            event.target?.setCustomValidity?.('');
        } catch (error) {
            event.target?.setCustomValidity?.(error.message);
            const notice = doc.getElementById('personDeviationStatus');
            if (notice) notice.textContent = error.message;
        }
    };
    doc.addEventListener?.('input', changed, true);
    doc.addEventListener?.('change', changed, true);
    const refresh = () => render(state, doc);
    doc.addEventListener?.('visibilitychange', refresh);
    state.dispose = () => { doc.removeEventListener?.('input', changed, true); doc.removeEventListener?.('change', changed, true); doc.removeEventListener?.('visibilitychange', refresh); };
    render(state, doc);
    return state.controller;
}
