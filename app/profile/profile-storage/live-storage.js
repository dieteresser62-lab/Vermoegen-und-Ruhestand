/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { PROFILE_LOAD_STATUS, PROFILE_TRANCHES_KEY } from '../profile-state.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { captureProfileData as captureLiveProfileData, loadProfileDataIntoLocalStorage } from '../profile-live-storage.js';
import { ProfileRegistryError, loadProfileRegistry, replaceProfileData, saveProfileRegistry } from '../profile-registry.js';
import { CONFIG } from '../../balance/balance-config.js';
import { normalizeTrancheCollection } from '../../../types/tranche-contract.js';
import { isProfileScopedKey } from '../profile-key-policy.js';
import { parseBalanceState, createProfileOwnedBalanceState, createHouseholdOwnedBalanceState, sanitizeProfileDataBalanceOwnership, captureProfileData, mergeProfileLiveData } from './balance-ownership.js';
import { dataIdentity, rememberLiveBase, trackLiveBase } from './live-base.js';
import { PROFILE_STORAGE_KEY, ACTIVE_PROFILE_KEY, CURRENT_PROFILE_KEY, ProfileRecoveryError, readStorageValue } from './storage-access.js';
import { assertProfileIdentityRecords, assertProfileDataLoadable } from './load-guards.js';
import { getRegistryContextSnapshot, assertProfileContextReady } from './registry-context.js';

/**
 * @param {{deletedKeys?: string[]}} [options]
 * @returns {boolean}
 */
export function saveCurrentProfileFromLocalStorage({ deletedKeys = [] } = {}) {
    if (!Array.isArray(deletedKeys) || deletedKeys.some(key => typeof key !== 'string' || !isProfileScopedKey(key)
        || ['sim_', 'sim.', CONFIG.STORAGE.SNAPSHOT_PREFIX].includes(key) || key.includes('*'))) {
        throw new TypeError('Der Löschauftrag darf nur konkrete profilbezogene Schlüssel enthalten.');
    }
    let context;
    if (deletedKeys.length) {
        // Ein expliziter Reset darf fehlende Registry/Identität nicht durch Defaultanlage reparieren.
        const result = /** @type {I.LoadRegistry} */ (/** @type {unknown} */ (loadProfileRegistry))(persistenceStorage);
        if (result.status === PROFILE_LOAD_STATUS.CORRUPT || result.status === PROFILE_LOAD_STATUS.UNAVAILABLE) {
            throw new ProfileRegistryError(result);
        }
        const registry = result.value;
        const currentId = readStorageValue(persistenceStorage, CURRENT_PROFILE_KEY, 'Die aktuelle Profil-ID ist technisch nicht lesbar.');
        const activeId = readStorageValue(persistenceStorage, ACTIVE_PROFILE_KEY, 'Die aktive Profil-ID ist technisch nicht lesbar.');
        assertProfileIdentityRecords(registry, currentId, activeId, result.raw);
        if (!registry || !currentId || !registry.profiles[currentId]) {
            throw new ProfileRecoveryError({ status: PROFILE_LOAD_STATUS.CORRUPT, scope: 'profile-context',
                storageKey: PROFILE_STORAGE_KEY, raw: result.raw, code: 'PROFILE_DELETE_CONTEXT_MISSING',
                message: 'Der Löschauftrag benötigt eine gültige Registry und eine aktuelle Profil-ID.', canReset: false });
        }
        assertProfileDataLoadable(currentId, registry.profiles[currentId], { registryRaw: result.raw });
        context = { registry, registryRaw: result.raw, currentId };
    } else {
        context = assertProfileContextReady();
    }
    const { registry, registryRaw, currentId: id } = context;
    if (!registry.profiles[id]) return false;
    let capturedData;
    try {
        capturedData = captureProfileData();
    } catch (error) {
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.UNAVAILABLE,
            scope: 'live-profile',
            storageKey: null,
            profileId: id,
            raw: null,
            registryRaw,
            code: 'PROFILE_LIVE_CAPTURE_UNAVAILABLE',
            message: `Profil ${id}: Der aktuelle Live-State ist technisch nicht lesbar.`,
            canReset: false
        }, error);
    }
    // Abwesenheit ist beim gewöhnlichen Snapshot keine Löschanweisung.
    // Nur konkret benannte Löschziele setzen den Merge außer Kraft, auch bei leerem Capture.
    if (!Object.keys(capturedData).length && !deletedKeys.length) return true;
    const snapshotData = mergeProfileLiveData(registry.profiles[id].data, capturedData, deletedKeys);
    assertProfileDataLoadable(id, {
        ...registry.profiles[id],
        data: snapshotData
    }, {
        registryRaw,
        scope: 'live-profile-field'
    });
    if (!replaceProfileData(id, snapshotData, { captureProfileData })) {
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.UNAVAILABLE,
            scope: 'registry',
            storageKey: PROFILE_STORAGE_KEY,
            profileId: id,
            raw: null,
            registryRaw,
            code: 'PROFILE_SAVE_UNAVAILABLE',
            message: `Profil ${id}: Der aktuelle Live-State konnte nicht sicher gespeichert werden.`,
            canReset: false
        });
    }
    if (dataIdentity(snapshotData) !== dataIdentity(registry.profiles[id].data)) rememberLiveBase(id, snapshotData);
    trackLiveBase(id, snapshotData);
    return true;
}

/**
 * @param {string} id
 */
export function loadProfileIntoLocalStorage(id) {
    const { registry, registryRaw } = getRegistryContextSnapshot();
    const profile = registry.profiles[id];
    if (!profile) return false;
    assertProfileDataLoadable(id, profile, { registryRaw });
    let previousLiveData;
    let previousActiveId;
    let currentMainState;
    try {
        previousLiveData = /** @type {(storage?: D.RecordStorage) => D.StringRecords} */ (captureLiveProfileData)();
        previousActiveId = readStorageValue(
            persistenceStorage,
            ACTIVE_PROFILE_KEY,
            'Die aktive Profil-ID ist technisch nicht lesbar.'
        );
        currentMainState = parseBalanceState(readStorageValue(
            persistenceStorage,
            CONFIG.STORAGE.LS_KEY,
            'Der aktuelle Balance-State ist technisch nicht lesbar.'
        ));
    } catch (error) {
        if (error instanceof ProfileRecoveryError) throw error;
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.UNAVAILABLE,
            scope: 'profile-load',
            storageKey: null,
            profileId: id,
            raw: null,
            registryRaw,
            code: 'PROFILE_LOAD_PREFLIGHT_UNAVAILABLE',
            message: `Profil ${id} kann nicht atomar geladen werden, weil der vorherige Live-State technisch nicht lesbar ist.`,
            canReset: false
        }, error);
    }
    const householdState = createHouseholdOwnedBalanceState(currentMainState || {});
    const sanitizedData = sanitizeProfileDataBalanceOwnership(profile.data);
    try {
        /** @type {(data: D.StringRecords, storage?: D.RecordStorage) => boolean} */ (loadProfileDataIntoLocalStorage)(sanitizedData);
        const loadedProfileState = parseBalanceState(persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY));
        if (loadedProfileState) {
            persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
                ...createProfileOwnedBalanceState(loadedProfileState, { preservePersonInputs: profile.data.profile_person_schema_version !== '1' }),
                ...householdState
            }));
        } else if (Object.keys(householdState).length > 0) {
            persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(householdState));
        }
        persistenceStorage.setItem(ACTIVE_PROFILE_KEY, id);
        if (sanitizedData !== profile.data) {
            const persisted = replaceProfileData(id, sanitizedData, { captureProfileData });
            if (!persisted) {
                throw new Error('PROFILE_SANITIZED_STATE_WRITE_FAILED');
            }
        }
        trackLiveBase(id, sanitizedData);
        return true;
    } catch (error) {
        let rollbackError = null;
        try {
            /** @type {(data: D.StringRecords, storage?: D.RecordStorage) => boolean} */ (loadProfileDataIntoLocalStorage)(previousLiveData);
            if (previousActiveId === null || previousActiveId === undefined || previousActiveId === '') {
                persistenceStorage.removeItem(ACTIVE_PROFILE_KEY);
            } else {
                persistenceStorage.setItem(ACTIVE_PROFILE_KEY, previousActiveId);
            }
        } catch (failure) {
            rollbackError = failure;
        }
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.UNAVAILABLE,
            scope: 'profile-load',
            storageKey: null,
            profileId: id,
            raw: null,
            registryRaw,
            code: rollbackError ? 'PROFILE_LOAD_ROLLBACK_FAILED' : 'PROFILE_LOAD_UNAVAILABLE',
            message: rollbackError
                ? `Profil ${id} konnte nicht geladen und der vorherige Live-State nicht vollstaendig wiederhergestellt werden.`
                : `Profil ${id} konnte nicht geladen werden; der vorherige Live-State wurde wiederhergestellt.`,
            canReset: false
        }, error);
    }
}

/** Kursausschnitte auf Originalrecords anwenden, niemals normalisierte Sicht speichern.
 * Der Aufrufer hält Commitbesitz und bestätigt anschließend den gemeinsamen Flush.
 */
/**
 * @param {I.QuotePatch[]} patches
 * @param {string} activeId
 * @param {D.ProfileRegistryAlt | null} [originalRegistry]
 * @returns {number}
 */
export function patchInactiveProfileQuotes(patches, activeId, originalRegistry = null) {
    const loaded = /** @type {I.LoadRegistry} */ (/** @type {unknown} */ (loadProfileRegistry))(persistenceStorage);
    if (!loaded.value) throw new Error('PROFILE_REGISTRY_UNAVAILABLE');
    const registry = JSON.parse(/** @type {string} */ (loaded.raw));
    // Der kanonische aktive Save kann eine Legacyregistry lesend normalisieren.
    // Unveränderte inaktive Originalprofile werden im selben synchronen Abschnitt erhalten.
    if (originalRegistry) for (const [id, profile] of Object.entries(originalRegistry.profiles)) {
        if (id === activeId) continue;
        const current = structuredClone(registry.profiles[id]);
        if (!current) throw new Error('QUOTE_SOURCE_CHANGED');
        if (profile.meta.id === undefined) delete current.meta.id;
        if (JSON.stringify(current) !== JSON.stringify(profile)) throw new Error('QUOTE_SOURCE_CHANGED');
        registry.profiles[id] = structuredClone(profile);
    }
    const seen = new Set();
    for (const patch of patches) {
        if (patch.profileId === activeId) throw new Error('QUOTE_ACTIVE_PROFILE_PATCH');
        const profile = registry.profiles[patch.profileId];
        if (!profile || profile.data[PROFILE_TRANCHES_KEY] !== patch.raw) throw new Error('QUOTE_SOURCE_CHANGED');
        const records = JSON.parse(patch.raw);
        const normalized = normalizeTrancheCollection(records, { mode: 'persisted' });
        for (const update of patch.updates) {
            const record = records[update.index];
            const key = `${patch.profileId}:${update.index}`;
            if (seen.has(key) || !record || String(record.trancheId || record.id || '').trim() !== update.trancheId
                || normalized[update.index]?.trancheId !== update.trancheId
                || !update.trancheId || !Number.isFinite(update.quote.price) || update.quote.price <= 0
                || !Number.isInteger(update.quote.asOf) || update.quote.asOf <= 0
                || update.quote.currency !== 'EUR' || !/^[A-Z0-9.^=-]{1,32}$/.test(update.quote.symbol)) {
                throw new Error('QUOTE_PATCH_INVALID');
            }
            seen.add(key);
            records[update.index] = { ...record, currentPrice: update.quote.price,
                asOf: update.quote.asOf, ticker: update.quote.symbol };
        }
        profile.data[PROFILE_TRANCHES_KEY] = JSON.stringify(records);
    }
    if ((seen.size || originalRegistry) && !/** @type {(registry: D.ProfileRegistry | D.ProfileRegistryAlt, storage?: D.RecordStorage) => boolean} */ (saveProfileRegistry)(registry, persistenceStorage)) throw new Error('PROFILE_SAVE_FAILED');
    return seen.size;
}
