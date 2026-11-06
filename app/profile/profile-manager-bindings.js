import { requestPageConfirmation } from '../shared/page-dialog.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { validateProfileManagementRecords } from '../shared/persistence-backup.js';
import { isAllowedPersistenceImportKey } from '../shared/persistence-key-policy.js';
import { setProfileVerbundMembership as validateMembershipOnCopy, householdMemberCount, HOUSEHOLD_MINIMUM_REASON } from './profile-registry.js';
import { PROFILE_STORAGE_KEYS } from './profile-state.js';
import { INCOME_KEY, INCOME_MIGRATION_KEY, readIncome } from './profile-income.js';
import { captureProfileData } from './profile-live-storage.js';
import { CONFIG } from '../balance/balance-config.js';
import { WEALTH_CAPTURES_KEY } from '../../types/wealth-capture-contract.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { PROBELAUF_RESTORE_HINT } from '../shared/probelauf-runtime.js';
import { createProfile, renameProfile, deleteProfile, switchProfile, listProfiles,
    getProfileMeta, getProfileData, getCurrentProfileId, setProfileVerbundMembership } from './profile-storage.js';

/** Gemeinsame Namensprüfung für Startseite und Manager; keine Speicherung. */
export function validateProfileName(name) {
    const value = String(name || '').trim();
    if (!value) throw new Error('Bitte einen Profilnamen eingeben.');
    return value;
}

/** Ein Dialog gilt nur für dieselbe Registry sowie aktuelle und aktive Person.
 * @param {() => unknown | Promise<unknown>} ask
 * @param {{storage?: import('../../typcheck/runtime-contracts.js').StorageReader, signal?: AbortSignal}} [options]
 */
export async function confirmUnchangedProfileContext(ask, { storage = persistenceStorage, signal } = {}) {
    const keys = [PROFILE_STORAGE_KEYS.registry, PROFILE_STORAGE_KEYS.current, PROFILE_STORAGE_KEYS.active];
    const before = keys.map(key => storage.getItem(key));
    const confirmed = await ask();
    return confirmed === true && !signal?.aborted && keys.every((key, index) => storage.getItem(key) === before[index]);
}

/** Günstige Prüfungen vor dem Rückkehrpunkt; alle Änderungen bleiben auf einer Kopie. */
export function validateProfileManagementAction(request, storage = persistenceStorage) {
    const records = Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter(isAllowedPersistenceImportKey).map(key => [key, storage.getItem(key)]));
    const registry = JSON.parse(records[PROFILE_STORAGE_KEYS.registry] || 'null');
    const id = records[PROFILE_STORAGE_KEYS.current];
    if (!registry?.profiles?.[id] || records[PROFILE_STORAGE_KEYS.active] !== id) throw new Error('Die Person ist nicht eindeutig zugeordnet.');
    if (!registry.profiles[request.profileId]) throw new Error('Die Person ist nicht mehr vorhanden.');
    const next = { ...records };
    if (request.kind === 'membership') validateMembershipOnCopy(request.profileId, request.belongs, {
        storage: { getItem: key => next[key] ?? null, setItem: (key, value) => { next[key] = String(value); } }
    });
    if (request.kind === 'delete' && registry.profiles[request.profileId].meta.belongsToHousehold !== false
        && householdMemberCount(registry) <= 1) throw new Error(HOUSEHOLD_MINIMUM_REASON);
    if (request.kind === 'delete' && request.profileId === 'default' && Object.keys(registry.profiles).length <= 1)
        throw new Error('Das Standard-Profil kannst Du erst löschen, wenn ein weiteres Profil existiert.');
    const profileIds = [request.profileId];
    if (request.kind === 'delete' && request.profileId === id) {
        const remaining = Object.keys(registry.profiles).filter(profileId => profileId !== id);
        profileIds.push(remaining.includes('default') ? 'default' : remaining[0]);
    }
    validateProfileManagementRecords(next, profileIds, { liveProfile: request.profileId === id });
    return records;
}

/** Gemeinsamer Defaultschutz und ausdrückliche Löschbestätigung. */
export async function confirmProfileDeletion(profileId, ask, options = {}) {
    if (profileId === 'default' && listProfiles().length <= 1) {
        throw new Error('Das Standard-Profil kannst Du erst löschen, wenn ein weiteres Profil existiert.');
    }
    const name = getProfileMeta(profileId)?.name || profileId;
    const recovery = getProbelaufController(options.doc || globalThis.document)?.state ? PROBELAUF_RESTORE_HINT
        : `Vorher wird der Wiederherstellungspunkt „Vor dem Löschen von ${name}“ angelegt; die Person ist über Daten & Sicherung zurückholbar.`;
    const description = `Person „${name}“ wirklich löschen? ${recovery} Partnerschaft, Testament, gemeinsamer Plan und gemeinsame Ausgaben bleiben eingetragen und müssen danach angepasst werden.`;
    return confirmUnchangedProfileContext(() => ask ? ask(description) : requestPageConfirmation({
        title: 'Person löschen', description, confirmLabel: 'Person löschen', danger: true, ...options
    }), options);
}

// Nur Verwaltungseinträge, die schon der bloße Start oder ein Seitenbesuch anlegt (Probe DP-1, 06.11.2026):
// Schemastand, Einkünfte-Übernahme mit leerer Liste, Inflationsmarke der Balance, Ergebnisspeicher des Simulators.
// Fehlt hier künftig ein solcher Eintrag, wird wie früher ergänzt; eine Person mit eigenen Werten wird nie umbenannt.
const UNTOUCHED_DEFAULT_KEYS = new Set(['profile_person_schema_version', INCOME_KEY, INCOME_MIGRATION_KEY,
    CONFIG.STORAGE.MIGRATION_FLAG, 'overview_simulation_summary_v1']);

function hasNoIncome(data) {
    const income = data[INCOME_KEY], marker = data[INCOME_MIGRATION_KEY];
    if (marker == null) return income == null || income === '';
    if (marker !== '1' || !income) return false;
    try { return readIncome(income).length === 0; } catch { return false; }
}

const isBookkeepingOnly = data => Object.keys(data).every(key => UNTOUCHED_DEFAULT_KEYS.has(key)) && hasNoIncome(data);

function isUntouchedDefault(storage = persistenceStorage) {
    const profiles = listProfiles();
    if (profiles.length !== 1 || profiles[0].id !== 'default' || profiles[0].name !== 'Default') return false;
    // Gutachten DP/DPN: Gespeicherte und noch nicht übernommene Live-Werte getrennt prüfen; eine leere Quelle
    // darf eigene Werte der anderen nicht verdecken. Jeder Lesefehler heißt: ergänzen statt umbenennen.
    try {
        if (!isBookkeepingOnly(getProfileData('default') || {})) return false;
        if (getCurrentProfileId() === 'default' && !isBookkeepingOnly(captureProfileData(storage))) return false;
        // Ausgaben und erfasste Vermögensstände liegen außerhalb der Personendaten.
        return Array.from({ length: storage.length }, (_, index) => storage.key(index))
            .every(key => !key?.startsWith('balance_expenses_') && key !== WEALTH_CAPTURES_KEY);
    } catch { return false; }
}

/** Aufrufer besitzt Autosaveabschluss, Navigationsschutz, Flush und Recovery.
 * @param {{kind: string, profileId?: string, name?: string, belongs?: boolean}} request */
export function applyProfileManagementAction({ kind, profileId, name, belongs }) {
    if (kind === 'create') {
        // Gutachten 05.11.2026: Ein unberührtes „Default“ als einzige Person wird zur ersten echten Person
        // umbenannt; sonst entsteht unbemerkt ein Zwei-Personen-Haushalt (Erststart und jeder neue Haushalt).
        if (isUntouchedDefault()) return renameProfile('default', validateProfileName(name));
        const meta = createProfile(validateProfileName(name));
        if (!switchProfile(meta.id)) throw new Error('PROFILE_SWITCH_FAILED');
        return meta;
    }
    if (kind === 'rename') return renameProfile(profileId, validateProfileName(name));
    if (kind === 'delete') return deleteProfile(profileId);
    if (kind === 'membership') return setProfileVerbundMembership(profileId, belongs);
    throw new Error('PROFILE_ACTION_INVALID');
}
