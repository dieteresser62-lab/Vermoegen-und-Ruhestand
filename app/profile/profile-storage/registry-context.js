/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { PROFILE_LOAD_STATUS } from '../profile-state.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { createProfile as createProfileInRegistry, ensureDefaultProfile, getCurrentProfileId as getCurrentProfileIdFromRegistry, getProfileData as getProfileDataFromRegistry, getProfileMeta as getProfileMetaFromRegistry, loadProfileRegistry, listProfiles as listProfilesFromRegistry, renameProfile as renameProfileInRegistry, setCurrentProfileId as setCurrentProfileIdInRegistry, setProfileVerbundMembership as setProfileVerbundMembershipInRegistry, updateProfileData as updateProfileDataInRegistry } from '../profile-registry.js';
import { captureProfileData } from './balance-ownership.js';
import { ACTIVE_PROFILE_KEY, ProfileRecoveryError, readStorageValue } from './storage-access.js';
import { assertProfileDataLoadable } from './load-guards.js';

/**
 * @returns {D.ProfileRegistry}
 */
function ensureRegistryWithLiveSnapshot() {
    return /** @type {D.ProfileRegistry} */ (ensureDefaultProfile({ captureProfileData }));
}

export function getRegistryContextSnapshot() {
    const registry = ensureRegistryWithLiveSnapshot();
    const registryResult = /** @type {I.LoadRegistry} */ (/** @type {unknown} */ (loadProfileRegistry))(persistenceStorage);
    return { registry, registryRaw: registryResult.raw ?? null };
}

/**
 * @param {D.ProfileRegistry} registry
 * @param {unknown} registryRaw
 * @returns {string | null}
 */
export function validateActiveProfileId(registry, registryRaw) {
    const activeId = readStorageValue(
        persistenceStorage,
        ACTIVE_PROFILE_KEY,
        'Die aktive Profil-ID ist technisch nicht lesbar.'
    );
    if (!activeId) return null;
    if (!registry.profiles[activeId]) {
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.CORRUPT,
            scope: 'profile-context',
            storageKey: ACTIVE_PROFILE_KEY,
            raw: activeId,
            registryRaw,
            code: 'PROFILE_ACTIVE_GHOST',
            message: `Die aktive Profil-ID ${activeId} existiert nicht in der Profilregistry.`,
            canReset: true
        });
    }
    return activeId;
}

export function assertProfileContextReady() {
    const { registry, registryRaw } = getRegistryContextSnapshot();
    const currentId = getCurrentProfileIdFromRegistry();
    const activeId = validateActiveProfileId(registry, registryRaw);
    if (activeId && activeId !== currentId) {
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.CORRUPT,
            scope: 'profile-context',
            storageKey: ACTIVE_PROFILE_KEY,
            profileId: currentId,
            raw: activeId,
            registryRaw,
            code: 'PROFILE_CONTEXT_MISMATCH',
            message: `Aktives Profil ${activeId} und aktuelles Profil ${currentId} stimmen nicht ueberein.`,
            canReset: true
        });
    }
    assertProfileDataLoadable(currentId, registry.profiles[currentId], { registryRaw });
    return { registry, registryRaw, currentId, activeId };
}

export function getCurrentProfileId() {
    ensureRegistryWithLiveSnapshot();
    return getCurrentProfileIdFromRegistry();
}

/**
 * @param {string} id
 */
export function setCurrentProfileId(id) {
    setCurrentProfileIdInRegistry(id);
}

export function listProfiles() {
    return listProfilesFromRegistry({ captureProfileData });
}

/**
 * @param {string} id
 */
export function getProfileMeta(id) {
    return getProfileMetaFromRegistry(id, { captureProfileData });
}

/**
 * @param {string} id
 */
export function getProfileData(id) {
    return getProfileDataFromRegistry(id, { captureProfileData });
}

/**
 * @param {string} name
 */
export function createProfile(name) {
    return createProfileInRegistry(name, { captureProfileData });
}

/**
 * @param {string} id
 * @param {string} name
 */
export function renameProfile(id, name) {
    return renameProfileInRegistry(id, name, { captureProfileData });
}

/**
 * @param {string} profileId
 * @param {boolean} belongs
 */
export function setProfileVerbundMembership(profileId, belongs) {
    return setProfileVerbundMembershipInRegistry(profileId, belongs, { captureProfileData });
}

/**
 * @param {string} id
 * @param {D.StringRecords} patch
 */
export function updateProfileData(id, patch) {
    return updateProfileDataInRegistry(id, patch, { captureProfileData });
}

export function getActiveProfileId() {
    const { registry, registryRaw } = getRegistryContextSnapshot();
    return validateActiveProfileId(registry, registryRaw);
}

export function ensureProfileRegistry() {
    return ensureRegistryWithLiveSnapshot();
}
