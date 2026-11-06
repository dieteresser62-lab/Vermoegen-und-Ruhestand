import { readCareValues } from './household-care-values.js';
import { CARE_VALUE_KEYS } from '../profile/profile-care.js';
import { careSettingsFromRecord } from './care-benefits.js';
import { INCOME_KEYS, incomeFromRecord } from '../profile/profile-income.js';
import { assertProfileIdentityRecords } from '../profile/profile-storage.js';
import { personAge, personReferenceYear, PERSON_VALUE_KEYS, validatePersonValues, projectPerson } from '../profile/profile-person-data.js';
import { loadProfileRegistry, householdMemberCount, HOUSEHOLD_CURRENT_LIMIT_MESSAGE } from '../profile/profile-registry.js';
import { persistenceStorage } from './persistence-facade.js';
import { CONFIG } from '../balance/balance-config.js';
import { showPageNotice } from './page-choice-dialog.js';

export const PERSON_DATA_LINK = 'depot-tranchen-manager.html#personendaten';
const documentStates = new WeakMap();
const documentNotices = new WeakMap();
/**
 * @param doc Dokument der Seite.
 * @param status Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function setDocumentPersonStatus(doc, status) { if (doc) documentStates.set(doc, status); return status; }
/**
 * @param {Document} doc Dokument der Seite.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function documentPersonStatus(doc = globalThis.document) { return documentStates.get(doc) || null; }

/** Nur nach ausdrücklich bestätigter, erfolgreich abgeschlossener Übernahme.
 *
 * @param names Wert für den bestehenden Aufrufvertrag.
 * @param {Document} doc Dokument der Seite.
 * @returns {HTMLElement} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function showConfirmedPersonMigrationNotice(names, doc = globalThis.document) {
    if (!doc || !names.length) return;
    const state = documentNotices.get(doc) || { names: [], status: null };
    state.names = [...new Set([...state.names, ...names])];
    documentNotices.set(doc, state);
    return showPersonDataStatus(state.status, doc);
}

/** DOM-freier Bereitschaftsvertrag. Technische Schäden bleiben technische Schäden.
 *
 * @param entries Wert für den bestehenden Aufrufvertrag.
 * @param referenceYear Wert für den bestehenden Aufrufvertrag.
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function assessPersonData(entries, referenceYear, { deferred = false } = {}) {
    if (deferred) return { ready: false, status: 'deferred', persons: [], href: PERSON_DATA_LINK,
        message: 'Die Personenumstellung wurde aufgeschoben. Bitte mit „Jetzt übernehmen“ im Kopf fortsetzen, bevor gerechnet oder gespeichert wird.' };
    const persons = [];
    try {
        for (const entry of entries) {
            const data = entry.data || {};
            if (String(data.profile_person_schema_version) !== '1') throw new Error('Personendaten müssen zuerst sicher umgestellt werden.');
            validatePersonValues(Object.fromEntries(Object.entries(PERSON_VALUE_KEYS).map(([field, key]) => [field, data[key]])));
            if (data.profile_person_migration_v1) JSON.parse(data.profile_person_migration_v1);
            for (const key of ['profile_rente_monatlich']) {
                if (data[key] != null && data[key] !== '' && (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0)) throw new Error('Ungültiges Profileinkommen.');
            }
            incomeFromRecord(data);
            const age = personAge(data, referenceYear);
            if (!['valid', 'fallback', 'missing'].includes(age.status)) throw new Error('Geburtsdatum oder Altalter ist für das Planungsjahr ungültig.');
            const person = { profileId: entry.profileId || entry.id, name: entry.name || entry.profileId || entry.id,
                status: age.status === 'valid' ? 'complete' : age.status === 'fallback' ? 'legacy-age' : 'missing', age: age.age };
            persons.push(person);
            if (age.status !== 'missing') projectPerson(data, referenceYear);
        }
    } catch (error) { return { ready: false, status: 'corrupt', error, persons, href: PERSON_DATA_LINK, message: error.message }; }
    const missing = persons.filter(person => person.status === 'missing');
    return { ready: missing.length === 0, status: missing.length ? 'missing' : persons.some(p => p.status === 'legacy-age') ? 'legacy-age' : 'complete',
        persons, href: PERSON_DATA_LINK,
        message: missing.length ? `Für die Rechnung fehlt das Geburtsdatum von ${missing.map(person => person.name).join(', ')} – in Personen & Vermögen ergänzen` : '' };
}

/** Nur lesend: die ausgewählten Haushaltsmitglieder sperren, Außenprofile nicht.
 *
 * @param {{storage?: import("../../typcheck/datenvertraege.js").RecordStorage; win?: Window & typeof globalThis; referenceYear?: number}} [options]
 * @param {boolean} [balance]
 * @returns Ergebnis der bestehenden Projektion.
 */
function readPersonStatus({ storage = persistenceStorage, win = globalThis.window, referenceYear } = {}, balance = false) {
    if (win?.__personMigrationDeferred) return assessPersonData([], referenceYear, { deferred: true });
    const loaded = loadProfileRegistry(storage);
    if (['corrupt', 'unavailable'].includes(loaded.status)) return { ready: false, status: 'corrupt', error: loaded.error || new Error('Profilbestand nicht lesbar.'), message: 'Profilbestand nicht lesbar.' };
    if (householdMemberCount(loaded.value) > 2) return { ready: false, status: 'household-limit', persons: [],
        href: 'depot-tranchen-manager.html#personen', message: HOUSEHOLD_CURRENT_LIMIT_MESSAGE(householdMemberCount(loaded.value)) };
    const profiles = loaded.value?.profiles || {};
    const current = storage.getItem('rs_current_profile');
    const active = storage.getItem('rs_active_profile');
    try { assertProfileIdentityRecords(loaded.value, current, active, loaded.raw); }
    catch (error) { return { ready: false, status: 'corrupt', error, message: error.message }; }
    const selectedIds = Object.keys(profiles).filter(id => profiles[id].meta?.belongsToHousehold !== false);
    const singleProfile = balance && selectedIds.length === 0;
    const entries = Object.entries(profiles).filter(([id, p]) => singleProfile
        ? id === current : p.meta?.belongsToHousehold !== false).map(([id, profile]) => ({
        profileId: id, name: profile.meta?.name || id, data: { ...profile.data }
    }));
    if (!entries.length && current && profiles[current]) entries.push({ profileId: current, name: profiles[current].meta?.name || current, data: { ...profiles[current].data } });
    for (const entry of entries) if (entry.profileId === current) {
        for (const key of [...Object.values(INCOME_KEYS), 'profile_planned_inflows_v1', ...Object.values(PERSON_VALUE_KEYS), ...Object.values(CARE_VALUE_KEYS), 'sim_pflegeKostenStaffelPreset', ...[1, 2, 3, 4, 5].map(grade => `sim_pflegeStufe${grade}Form`), 'profile_aktuelles_alter', 'profile_rente_monatlich', 'profile_sonstige_einkuenfte']) {
            const raw = storage.getItem(key); if (raw !== null) entry.data[key] = raw;
        }
    }
    let metadata;
    try {
        const raw = storage.getItem(CONFIG.STORAGE.LS_KEY);
        metadata = raw ? JSON.parse(raw).annualPeriodMetadata : null;
    } catch (error) { return { ready: false, status: 'corrupt', error, message: error.message }; }
    // Die leere Erstinstallation bleibt beim vorhandenen DOM-Demobetrieb. Hat die erste Person den Platzhalter
    // „Default“ ersetzt (DP-1), gilt für sie die gewöhnliche Prüfung auf fehlende Personendaten.
    if (!entries.length || entries.length === 1 && entries[0].profileId === 'default' && (profiles.default?.meta?.name ?? 'Default') === 'Default'
        && !Object.keys(entries[0].data).some(key => key.startsWith('profile_') && !['profile_person_schema_version', ...Object.values(INCOME_KEYS)].includes(key))) {
        return { ready: true, status: 'demo', persons: [], message: '', entries };
    }
    try {
        const year = referenceYear ?? personReferenceYear(metadata);
        return { ...assessPersonData(entries, year), referenceYear: year, entries, singleProfile, careValues: readCareValues(storage), ...(balance ? { calculationProfileId: entries.some(entry => entry.profileId === current) ? current : entries.map(entry => entry.profileId).sort()[0] } : {}) };
    } catch (error) { return { ready: false, status: 'corrupt', error, message: error.message, entries }; }
}

/** Simulator: ausgewählte Haushaltsmitglieder, unabhängig vom geöffneten Profil.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function readHouseholdPersonStatus(options) { return readPersonStatus(options); }

/** Balance: Auswahl bestimmt den Umfang; ohne Auswahl rechnet die geöffnete Person.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function readBalancePersonStatus(options) { return readPersonStatus(options, true); }

/**
 * @param status Wert für den bestehenden Aufrufvertrag.
 * @param {Document} doc Dokument der Seite.
 * @returns {HTMLElement} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function showPersonDataStatus(status, doc = globalThis.document) {
    if (!doc) return;
    const state = documentNotices.get(doc) || { names: [], status: null };
    state.status = status;
    documentNotices.set(doc, state);
    const messages = [];
    if (!status?.ready && status?.message) messages.push(status.message);
    if (state.names.length) messages.push(`Für ${state.names.join(', ')} fehlt noch das Geburtsdatum. In Personen & Vermögen im Band ‚Geburtsdatum einmal ergänzen‘ nachtragen.`);
    const legacy = status?.persons?.filter(person => person.status === 'legacy-age') || [];
    if (status?.ready && legacy.length) messages.push(`Geburtsdatum einmal ergänzen: ${legacy.map(person => person.name).join(', ')} rechnet weiter mit dem festgehaltenen Altalter.`);
    if (!messages.length) { doc.getElementById?.('personDataNotice')?.remove(); return; }
    return showPageNotice({ doc, message: messages.join(' '), href: status?.href || PERSON_DATA_LINK,
        ...(status?.status === 'household-limit' ? { linkText: 'Personen verwalten' } : {}) });
}

/** Basisperson im ausdrücklich ausgewählten Rechenumfang; Einzelprojektionen bleiben identitätsgebunden.
 *
 * @param status Wert für den bestehenden Aufrufvertrag.
 * @param currentId Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function projectParticipatingPerson(status, currentId) {
    if (!status.ready || status.status === 'demo') return null;
    const entry = status.entries.find(person => person.profileId === (status.calculationProfileId ?? currentId));
    if (!entry) throw new Error('Aktive Person ist im Rechenumfang nicht enthalten.');
    return projectPerson(entry.data, status.referenceYear, balanceCareSettings(status));
}

/**
 * @param status Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function balanceCareSettings(status) {
    const primary = status.entries?.[0];
    return { ...careSettingsFromRecord(primary?.data), careValues: status.careValues };
}
