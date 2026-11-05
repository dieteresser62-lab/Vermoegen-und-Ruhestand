/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { PROFILE_LOAD_STATUS } from '../profile-state.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { captureProfileData as captureLiveProfileData, hasProfileScopedDataInLocalStorage, loadProfileDataIntoLocalStorage } from '../profile-live-storage.js';
import { ensureDefaultProfile, loadProfileRegistry, saveProfileRegistry } from '../profile-registry.js';
import { CONFIG } from '../../balance/balance-config.js';
import { parseBalanceState, createProfileOwnedBalanceState, createHouseholdOwnedBalanceState, sanitizeProfileDataBalanceOwnership, captureProfileData } from './balance-ownership.js';
import { hasNewerLiveData } from './live-base.js';
import { PROFILE_STORAGE_KEY, ACTIVE_PROFILE_KEY, CURRENT_PROFILE_KEY, ProfileRecoveryError, readStorageValue, writeStorageValue, removeStorageValue } from './storage-access.js';
import { assertProfileDataLoadable, getProfileRecoveryFromError } from './load-guards.js';
import { getRegistryContextSnapshot, validateActiveProfileId, getCurrentProfileId } from './registry-context.js';
import { saveCurrentProfileFromLocalStorage, loadProfileIntoLocalStorage } from './live-storage.js';
import { importProfilesBundleFromWindowName } from './bundle-transfer.js';
import { recoveryRawMatches, assertRecoveryDocumentMatches } from './recovery-document.js';

/** @type {D.BootstrapResult | null} */
let lastProfileBootstrapResult = null;

export function getLastProfileBootstrapResult() {
    return lastProfileBootstrapResult;
}

/**
 * @param {{importFromWindowName?: boolean, preserveLiveProfileData?: boolean, preserveNewerLiveProfileData?: boolean}} [options]
 * @returns {D.BootstrapResult}
 */
export function bootstrapProfileContext(options = {}) {
    const {
        importFromWindowName = false,
        preserveLiveProfileData = false,
        preserveNewerLiveProfileData = false
    } = options;

    /** @type {{ok: boolean, message?: string}} */
    let importResult = { ok: false, message: 'window.name import disabled' };
    try {
        if (importFromWindowName && !readStorageValue(
            persistenceStorage,
            PROFILE_STORAGE_KEY,
            'Die Profilregistry ist technisch nicht lesbar.'
        )) {
            importResult = importProfilesBundleFromWindowName();
        }

        const { registry, registryRaw } = getRegistryContextSnapshot();
        const currentId = /** @type {(storage?: D.RecordReader) => string} */ (getCurrentProfileId)();
        const activeId = validateActiveProfileId(registry, registryRaw);
        assertProfileDataLoadable(currentId, registry.profiles[currentId], { registryRaw });
        const hasLiveProfileData = hasProfileScopedDataInLocalStorage();
        const shouldSaveLiveData =
            (preserveLiveProfileData || (preserveNewerLiveProfileData && hasNewerLiveData(currentId, registry.profiles[currentId].data))) &&
            activeId === currentId &&
            hasLiveProfileData;

        if (shouldSaveLiveData) {
            saveCurrentProfileFromLocalStorage();
            lastProfileBootstrapResult = { currentId, action: 'saved', importResult, recovery: null };
            return lastProfileBootstrapResult;
        }

        const loaded = loadProfileIntoLocalStorage(currentId);
        if (!loaded) {
            throw new ProfileRecoveryError({
                status: PROFILE_LOAD_STATUS.CORRUPT,
                scope: 'profile-context',
                storageKey: CURRENT_PROFILE_KEY,
                profileId: currentId,
                raw: currentId,
                registryRaw,
                code: 'PROFILE_CURRENT_LOAD_FAILED',
                message: `Das aktuelle Profil ${currentId} konnte nicht geladen werden.`,
                canReset: true
            });
        }
        lastProfileBootstrapResult = { currentId, action: 'loaded', importResult, recovery: null };
        return lastProfileBootstrapResult;
    } catch (error) {
        const recovery = getProfileRecoveryFromError(error);
        if (!recovery) throw error;
        lastProfileBootstrapResult = {
            currentId: null,
            action: 'recovery',
            importResult,
            recovery
        };
        return lastProfileBootstrapResult;
    }
}

/**
 * @param {D.ProfileRecovery} recovery
 * @param {I.RecoveryOptions} [options]
 */
export function resetProfileRecovery(recovery, options = {}) {
    const {
        storage = persistenceStorage,
        recoveryDocument = null,
        confirmed = false,
        captureProfileData: captureForReset = () => /** @type {(storage?: D.RecordStorage) => D.StringRecords} */ (captureLiveProfileData)(storage)
    } = options;
    if (!confirmed) {
        throw new Error('Der Profil-Reset wurde nicht bestaetigt.');
    }
    if (!recovery || recovery.status !== PROFILE_LOAD_STATUS.CORRUPT || recovery.canReset !== true) {
        throw new Error('Ein technisch nicht lesbarer Profilzustand darf nicht zurueckgesetzt werden.');
    }
    assertRecoveryDocumentMatches(recovery, recoveryDocument);

    if (recovery.scope === 'registry') {
        const currentRaw = readStorageValue(
            storage,
            PROFILE_STORAGE_KEY,
            'Die Profilregistry ist technisch nicht lesbar.'
        );
        if (!recoveryRawMatches(recovery.raw, currentRaw)) {
            throw new Error('Die Profilregistry hat sich seit dem Recovery-Export geaendert.');
        }
        removeStorageValue(storage, PROFILE_STORAGE_KEY, 'Die korrupte Profilregistry konnte nicht entfernt werden.');
        removeStorageValue(storage, CURRENT_PROFILE_KEY, 'Die aktuelle Profil-ID konnte nicht zurueckgesetzt werden.');
        removeStorageValue(storage, ACTIVE_PROFILE_KEY, 'Die aktive Profil-ID konnte nicht zurueckgesetzt werden.');
        ensureDefaultProfile({ storage, captureProfileData: captureForReset });
        return { ok: true, action: 'registry_reset', profileId: 'default' };
    }

    if (recovery.scope === 'profile-context') {
        const currentRaw = readStorageValue(
            storage,
            /** @type {string} */ (recovery.storageKey),
            'Der Profilkontext ist technisch nicht lesbar.'
        );
        if (!recoveryRawMatches(recovery.raw, currentRaw)) {
            throw new Error('Der Profilkontext hat sich seit dem Recovery-Export geaendert.');
        }
        const registryResult = /** @type {I.LoadRegistry} */ (/** @type {unknown} */ (loadProfileRegistry))(storage);
        if (registryResult.status !== PROFILE_LOAD_STATUS.VALID) {
            throw new Error('Der Profilkontext kann ohne gueltige Profilregistry nicht repariert werden.');
        }
        const registry = registryResult.value;
        const fallbackId = registry.profiles.default
            ? 'default'
            : Object.keys(registry.profiles)[0];
        if (!fallbackId) {
            throw new Error('Die Profilregistry enthaelt kein Profil fuer die Recovery.');
        }
        const storedCurrent = readStorageValue(
            storage,
            CURRENT_PROFILE_KEY,
            'Die aktuelle Profil-ID ist technisch nicht lesbar.'
        );
        const nextCurrent = registry.profiles[/** @type {string} */ (storedCurrent)] ? /** @type {string} */ (storedCurrent) : fallbackId;
        assertProfileDataLoadable(nextCurrent, registry.profiles[nextCurrent], {
            registryRaw: registryResult.raw,
            scope: 'profile-context'
        });
        const previousLiveData = /** @type {(storage?: D.RecordStorage) => D.StringRecords} */ (captureLiveProfileData)(storage);
        const previousCurrent = storedCurrent;
        const previousActive = readStorageValue(
            storage,
            ACTIVE_PROFILE_KEY,
            'Die aktive Profil-ID ist technisch nicht lesbar.'
        );
        const currentMainState = parseBalanceState(previousLiveData[CONFIG.STORAGE.LS_KEY]);
        const householdState = createHouseholdOwnedBalanceState(currentMainState || {});
        const sanitizedData = sanitizeProfileDataBalanceOwnership(registry.profiles[nextCurrent].data);
        try {
            /** @type {(data: D.StringRecords, storage?: D.RecordStorage) => boolean} */ (loadProfileDataIntoLocalStorage)(sanitizedData, storage);
            const loadedProfileState = parseBalanceState(readStorageValue(
                storage,
                CONFIG.STORAGE.LS_KEY,
                'Der geladene Balance-State ist technisch nicht lesbar.'
            ));
            if (loadedProfileState) {
                writeStorageValue(storage, CONFIG.STORAGE.LS_KEY, JSON.stringify({
                    ...createProfileOwnedBalanceState(loadedProfileState),
                    ...householdState
                }), 'Der reparierte Balance-State konnte nicht gespeichert werden.');
            } else if (Object.keys(householdState).length > 0) {
                writeStorageValue(
                    storage,
                    CONFIG.STORAGE.LS_KEY,
                    JSON.stringify(householdState),
                    'Der reparierte Balance-State konnte nicht gespeichert werden.'
                );
            }
            writeStorageValue(storage, CURRENT_PROFILE_KEY, nextCurrent, 'Die aktuelle Profil-ID konnte nicht repariert werden.');
            writeStorageValue(storage, ACTIVE_PROFILE_KEY, nextCurrent, 'Die aktive Profil-ID konnte nicht repariert werden.');
        } catch (error) {
            let rollbackError = null;
            try {
                /** @type {(data: D.StringRecords, storage?: D.RecordStorage) => boolean} */ (loadProfileDataIntoLocalStorage)(previousLiveData, storage);
                if (previousCurrent) {
                    storage.setItem(CURRENT_PROFILE_KEY, previousCurrent);
                } else {
                    storage.removeItem(CURRENT_PROFILE_KEY);
                }
                if (previousActive) {
                    storage.setItem(ACTIVE_PROFILE_KEY, previousActive);
                } else {
                    storage.removeItem(ACTIVE_PROFILE_KEY);
                }
            } catch (failure) {
                rollbackError = failure;
            }
            throw new ProfileRecoveryError({
                status: PROFILE_LOAD_STATUS.UNAVAILABLE,
                scope: 'profile-context',
                storageKey: /** @type {string} */ (recovery.storageKey),
                profileId: nextCurrent,
                raw: recovery.raw,
                registryRaw: registryResult.raw,
                code: rollbackError ? 'PROFILE_CONTEXT_ROLLBACK_FAILED' : 'PROFILE_CONTEXT_REPAIR_FAILED',
                message: rollbackError
                    ? 'Der Profilkontext konnte nicht repariert und der vorherige Zustand nicht vollstaendig wiederhergestellt werden.'
                    : 'Der Profilkontext konnte nicht repariert werden; der vorherige Zustand wurde wiederhergestellt.',
                canReset: false
            }, error);
        }
        lastProfileBootstrapResult = {
            currentId: nextCurrent,
            action: 'recovered',
            importResult: null,
            recovery: null
        };
        return { ok: true, action: 'context_repaired', profileId: nextCurrent };
    }

    if (recovery.scope === 'live-profile-field') {
        const currentRaw = readStorageValue(
            storage,
            /** @type {string} */ (recovery.storageKey),
            'Der aktuelle profilbezogene Live-State ist technisch nicht lesbar.'
        );
        if (!recoveryRawMatches(recovery.raw, currentRaw)) {
            throw new Error('Der profilbezogene Live-State hat sich seit dem Recovery-Export geaendert.');
        }
        removeStorageValue(
            storage,
            /** @type {string} */ (recovery.storageKey),
            'Der korrupte profilbezogene Live-State konnte nicht entfernt werden.'
        );
        return {
            ok: true,
            action: 'live_profile_field_reset',
            profileId: /** @type {string} */ (recovery.profileId),
            storageKey: /** @type {string} */ (recovery.storageKey)
        };
    }

    if (recovery.scope === 'profile-field') {
        const registryRaw = readStorageValue(
            storage,
            PROFILE_STORAGE_KEY,
            'Die Profilregistry ist technisch nicht lesbar.'
        );
        if (!recoveryRawMatches(recovery.registryRaw, registryRaw)) {
            throw new Error('Die Profilregistry hat sich seit dem Recovery-Export geaendert.');
        }
        const registryResult = /** @type {I.LoadRegistry} */ (/** @type {unknown} */ (loadProfileRegistry))(storage);
        if (registryResult.status !== PROFILE_LOAD_STATUS.VALID) {
            throw new Error('Der Profilbereich kann ohne gueltige Profilregistry nicht repariert werden.');
        }
        const registry = registryResult.value;
        const profile = registry.profiles[/** @type {string} */ (recovery.profileId)];
        if (!profile || !Object.prototype.hasOwnProperty.call(profile.data, /** @type {string} */ (recovery.storageKey))) {
            throw new Error('Der betroffene Profilbereich existiert nicht mehr.');
        }
        if (!recoveryRawMatches(profile.data[/** @type {string} */ (recovery.storageKey)], recovery.raw)) {
            throw new Error('Der betroffene Profilbereich hat sich seit dem Recovery-Export geaendert.');
        }
        const nextRegistry = {
            ...registry,
            profiles: {
                ...registry.profiles,
                [/** @type {string} */ (recovery.profileId)]: {
                    ...profile,
                    data: { ...profile.data }
                }
            }
        };
        delete nextRegistry.profiles[/** @type {string} */ (recovery.profileId)].data[/** @type {string} */ (recovery.storageKey)];
        nextRegistry.profiles[/** @type {string} */ (recovery.profileId)].meta = {
            ...nextRegistry.profiles[/** @type {string} */ (recovery.profileId)].meta,
            updatedAt: new Date().toISOString()
        };
        if (!/** @type {(registry: D.ProfileRegistry | D.ProfileRegistryAlt, storage?: D.RecordStorage) => boolean} */ (saveProfileRegistry)(nextRegistry, storage)) {
            throw new Error('Der bestaetigte Profilbereich konnte nicht zurueckgesetzt werden.');
        }
        return {
            ok: true,
            action: 'profile_field_reset',
            profileId: /** @type {string} */ (recovery.profileId),
            storageKey: /** @type {string} */ (recovery.storageKey)
        };
    }

    throw new Error('Der Profil-Recoverybereich wird nicht unterstuetzt.');
}
