import { assertProfileIdentityRecords } from '../profile/profile-storage.js';
import { personAge, personReferenceYear, PERSON_VALUE_KEYS, validatePersonValues, projectPerson } from '../profile/profile-person-data.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { persistenceStorage } from './persistence-facade.js';
import { CONFIG } from '../balance/balance-config.js';
import { showPageNotice } from './page-choice-dialog.js';

export const PERSON_DATA_LINK = 'depot-tranchen-manager.html#personendaten';
const documentStates = new WeakMap();
const documentNotices = new WeakMap();
export function setDocumentPersonStatus(doc, status) { if (doc) documentStates.set(doc, status); return status; }
export function documentPersonStatus(doc = globalThis.document) { return documentStates.get(doc) || null; }

/** Nur nach ausdrücklich bestätigter, erfolgreich abgeschlossener Übernahme. */
export function showConfirmedPersonMigrationNotice(names, doc = globalThis.document) {
    if (!doc || !names.length) return;
    const state = documentNotices.get(doc) || { names: [], status: null };
    state.names = [...new Set([...state.names, ...names])];
    documentNotices.set(doc, state);
    return showPersonDataStatus(state.status, doc);
}

/** DOM-freier Bereitschaftsvertrag. Technische Schäden bleiben technische Schäden. */
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
            for (const key of ['profile_rente_monatlich', 'profile_sonstige_einkuenfte']) {
                if (data[key] != null && data[key] !== '' && (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0)) throw new Error('Ungültiges Profileinkommen.');
            }
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

/** Nur lesend: die ausgewählten Haushaltsmitglieder sperren, Außenprofile nicht. */
function readPersonStatus({ storage = persistenceStorage, win = globalThis.window, referenceYear } = {}, balance = false) {
    if (win?.__personMigrationDeferred) return assessPersonData([], referenceYear, { deferred: true });
    const loaded = loadProfileRegistry(storage);
    if (['corrupt', 'unavailable'].includes(loaded.status)) return { ready: false, status: 'corrupt', error: loaded.error || new Error('Profilbestand nicht lesbar.'), message: 'Profilbestand nicht lesbar.' };
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
        for (const key of [...Object.values(PERSON_VALUE_KEYS), 'profile_aktuelles_alter', 'profile_rente_monatlich', 'profile_sonstige_einkuenfte']) {
            const raw = storage.getItem(key); if (raw !== null) entry.data[key] = raw;
        }
    }
    let metadata;
    try {
        const raw = storage.getItem(CONFIG.STORAGE.LS_KEY);
        metadata = raw ? JSON.parse(raw).annualPeriodMetadata : null;
    } catch (error) { return { ready: false, status: 'corrupt', error, message: error.message }; }
    // Die leere Erstinstallation bleibt beim vorhandenen DOM-Demobetrieb.
    if (!entries.length || entries.length === 1 && entries[0].profileId === 'default'
        && !Object.keys(entries[0].data).some(key => key.startsWith('profile_') && key !== 'profile_person_schema_version')) {
        return { ready: true, status: 'demo', persons: [], message: '', entries };
    }
    try {
        const year = referenceYear ?? personReferenceYear(metadata);
        return { ...assessPersonData(entries, year), referenceYear: year, entries, singleProfile, ...(balance ? { calculationProfileId: entries.some(entry => entry.profileId === current) ? current : entries.map(entry => entry.profileId).sort()[0] } : {}) };
    } catch (error) { return { ready: false, status: 'corrupt', error, message: error.message, entries }; }
}

/** Simulator: ausgewählte Haushaltsmitglieder, unabhängig vom geöffneten Profil. */
export function readHouseholdPersonStatus(options) { return readPersonStatus(options); }

/** Balance: Auswahl bestimmt den Umfang; ohne Auswahl rechnet die geöffnete Person. */
export function readBalancePersonStatus(options) { return readPersonStatus(options, true); }

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
    return showPageNotice({ doc, message: messages.join(' '), href: status?.href || PERSON_DATA_LINK });
}

/** Basisperson im ausdrücklich ausgewählten Rechenumfang; Einzelprojektionen bleiben identitätsgebunden. */
export function projectParticipatingPerson(status, currentId) {
    if (!status.ready || status.status === 'demo') return null;
    const entry = status.entries.find(person => person.profileId === (status.calculationProfileId ?? currentId));
    if (!entry) throw new Error('Aktive Person ist im Rechenumfang nicht enthalten.');
    return projectPerson(entry.data, status.referenceYear);
}
