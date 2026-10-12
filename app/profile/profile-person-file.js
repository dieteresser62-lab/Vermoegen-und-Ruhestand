import { PROFILE_VALUE_KEYS, PROFILE_HEALTH_BUCKET_KEY } from './profile-state.js';
import { normalizeProfilesBundle, PROFILE_BUNDLE_TYPE, PROFILE_BUNDLE_APP_ID, PROFILE_BUNDLE_SCHEMA_VERSION } from './profile-bundle-io.js';
import { PROFILE_VERSION } from './profile-registry.js';
import { isProfileScopedKey } from './profile-key-policy.js';
import { isAllowedPersistenceImportKey, PROBELAUF_STATE_KEY } from '../shared/persistence-key-policy.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { validatePersistenceDomainRecords } from '../shared/persistence-backup.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';

const REGISTRY = 'rs_profiles_v1';
const active = new WeakSet();
const importPlans = new WeakMap();
const cacheRecords = persistence => Object.fromEntries(persistence.keysSync().map(key => [key, persistence.getItemSync(key)]));
const identity = records => JSON.stringify(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
function assertAllowed(records, options) {
    const trial = options.probelaufController;
    if (trial?.state || trial?.blocked || trial?.busy || records[PROBELAUF_STATE_KEY]) throw new Error('Personenaustausch ist im Probelauf gesperrt.');
    const result = validatePersistenceDomainRecords(Object.fromEntries(Object.entries(records).filter(([key]) => isAllowedPersistenceImportKey(key))), { requireProfileContext: true });
    if (!result.ok) throw new Error(result.message);
    return JSON.parse(records[REGISTRY]);
}
// Nur eigene Personen-/Depotrecords. Balance, Simulator- und Monatsbelege
// können Haushaltswerte und fremde Profilreferenzen enthalten und gehören nicht
// in eine Ein-Person-Datei. Der Vollbundlevertrag bleibt unverändert.
const PERSON_FILE_KEYS = new Set([...Object.values(PROFILE_VALUE_KEYS), PROFILE_HEALTH_BUCKET_KEY,
    'depot_tranchen', 'profile_cash_history_v1', 'profile_wealth_history_lots_v1']);
function personData(data) {
    return Object.fromEntries(Object.entries(data).filter(([key]) => PERSON_FILE_KEYS.has(key)));
}
function bundleFor(id, profile, exportedAt = new Date().toISOString()) {
    return { bundleType: PROFILE_BUNDLE_TYPE, app: PROFILE_BUNDLE_APP_ID,
        schemaVersion: PROFILE_BUNDLE_SCHEMA_VERSION, profileVersion: PROFILE_VERSION, version: PROFILE_VERSION,
        exportedAt, recordCount: 1, registry: { version: PROFILE_VERSION, profiles: { [id]: profile } }, currentProfileId: id, globals: {} };
}
export function normalizePersonFile(file) {
    const normalized = normalizeProfilesBundle(file);
    if (!normalized.ok) throw new Error(normalized.message);
    const bundle = normalized.bundle;
    if (bundle.recordCount !== 1 || Object.keys(bundle.globals).length) throw new Error('Die Personendatei muss genau eine Person ohne Haushaltsglobals enthalten.');
    const [id, profile] = Object.entries(bundle.registry.profiles)[0];
    if (id !== bundle.currentProfileId) throw new Error('Die Personenzuordnung der Datei ist ungültig.');
    for (const key of Object.keys(profile.data)) if (!isProfileScopedKey(key)) throw new Error(`Personen-Key ${key} ist nicht erlaubt.`);
    return { id, profile: structuredClone(profile) };
}
export async function previewPersonExport(id, options = {}) {
    const persistence = options.persistence || PersistenceFacade;
    const records = await persistence.readPersistedRecords();
    if (identity(cacheRecords(persistence)) !== identity(records)) throw new Error('Der Bestand ist noch nicht dauerhaft bestätigt. Bitte erneut prüfen.');
    const registry = assertAllowed(records, options);
    const stored = registry.profiles[id];
    if (!stored) throw new Error('Bitte eine vorhandene Person auswählen.');
    // Aktuelle Livewerte nur lesend überlagern, keinen Save/Switch auslösen.
    const data = id === records.rs_active_profile ? personData(records) : personData(stored.data);
    const profile = { meta: { id, name: stored.meta.name, createdAt: stored.meta.createdAt, updatedAt: stored.meta.updatedAt, belongsToHousehold: false }, data };
    const file = bundleFor(id, profile);
    normalizePersonFile(file);
    return { file, name: profile.meta.name || id, identity: identity(records) };
}
export async function confirmPersonExport(preview, options = {}) {
    const persistence = options.persistence || PersistenceFacade;
    const records = await persistence.readPersistedRecords();
    if (identity(cacheRecords(persistence)) !== identity(records)) throw new Error('Der Bestand ist noch nicht dauerhaft bestätigt.');
    assertAllowed(records, options);
    if (identity(records) !== preview.identity) throw new Error('Der Personenbestand hat sich geändert. Bitte erneut auswählen.');
    return preview.file;
}
export async function previewPersonImport(file, options = {}) {
    const source = normalizePersonFile(file);
    const persistence = options.persistence || PersistenceFacade;
    const records = await persistence.readPersistedRecords();
    if (identity(cacheRecords(persistence)) !== identity(records)) throw new Error('Der Bestand ist noch nicht dauerhaft bestätigt.');
    const registry = assertAllowed(records, options);
    let id = `${source.id}-import`, suffix = 1;
    while (Object.hasOwn(registry.profiles, id)) id = `${source.id}-import-${suffix++}`;
    const originalName = String(source.profile.meta.name || 'Importierte Person');
    const names = new Set(Object.values(registry.profiles).map(profile => profile.meta.name));
    let name = originalName, count = 1;
    while (names.has(name)) name = `${originalName} (Import ${count++})`;
    const stamp = new Date().toISOString();
    const profile = { meta: { id, name, createdAt: stamp, updatedAt: stamp, belongsToHousehold: false }, data: personData(source.profile.data) };
    normalizePersonFile(bundleFor(id, profile));
    const next = { ...registry, profiles: { ...registry.profiles, [id]: profile } };
    const preview = Object.freeze({ id, name });
    importPlans.set(preview, { identity: identity(records), registry: JSON.stringify(next) });
    return preview;
}
export async function importPersonFile(preview, options = {}) {
    const plan = importPlans.get(preview);
    if (!plan) throw new Error('Bitte eine gültige Personenvorschau erstellen.');
    const persistence = options.persistence || PersistenceFacade;
    if (active.has(persistence)) return { status: 'in_flight' };
    active.add(persistence);
    try {
        return await createNavigationOperationLifecycle({ guard: options.guard }).run(options, async operation => {
            const records = await persistence.readPersistedRecords();
            operation.check();
            if (identity(cacheRecords(persistence)) !== identity(records)) throw new Error('Der Bestand oder Profilkontext hat sich geändert.');
            assertAllowed(records, options);
            if (identity(records) !== plan.identity) throw new Error('Der Bestand oder Profilkontext hat sich seit der Vorschau geändert. Bitte erneut prüfen.');
            await persistence.replaceRecordsTransactional({ [REGISTRY]: plan.registry }, {
                allowKey: key => key === REGISTRY, expectedRecords: { [REGISTRY]: records[REGISTRY] }, navigationOperation: operation,
                postValidate: confirmed => {
                    const result = validatePersistenceDomainRecords({ ...records, ...confirmed }, { requireProfileContext: true });
                    if (!result.ok) throw new Error(result.message);
                    const after = Object.fromEntries(persistence.keysSync().map(key => [key, persistence.getItemSync(key)]));
                    if (identity({ ...after, [REGISTRY]: records[REGISTRY] }) !== plan.identity) throw new Error('Andere Daten wurden während des Imports verändert.');
                    return true;
                }
            });
            return { status: 'imported', id: preview.id, name: preview.name };
        });
    } finally { active.delete(persistence); }
}
