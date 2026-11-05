/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { PROFILE_HEALTH_BUCKET_KEY, PROFILE_LOAD_STATUS, loadProfileHealthBucketFromData, loadStoredBalanceStateFromData } from '../profile-state.js';
import { ProfileRegistryError } from '../profile-registry.js';
import { PROFILE_STORAGE_KEY, ACTIVE_PROFILE_KEY, CURRENT_PROFILE_KEY, ProfileRecoveryError } from './storage-access.js';

/** Identität vor Migration/Defaultanlage prüfen, ausschließlich auf gelesenen Records. */
/**
 * @param {D.ProfileRegistry | null} registry
 * @param {string | null | undefined} currentId
 * @param {string | null | undefined} activeId
 * @param {unknown} [registryRaw]
 * @returns {void}
 */
export function assertProfileIdentityRecords(registry, currentId, activeId, registryRaw = null) {
    const profiles = registry?.profiles || {};
    /** @param {string} id @param {string} key @param {string} code @param {string} message */
    const reject = (id, key, code, message) => {
        throw new ProfileRecoveryError({ status: PROFILE_LOAD_STATUS.CORRUPT,
            scope: 'profile-context', storageKey: key, profileId: id, raw: id,
            registryRaw, code, message, canReset: true });
    };
    if (currentId && !profiles[currentId]) reject(currentId, CURRENT_PROFILE_KEY, 'PROFILE_CURRENT_GHOST',
        `Die aktuelle Profil-ID ${currentId} existiert nicht in der Profilregistry.`);
    if (activeId && !profiles[activeId]) reject(activeId, ACTIVE_PROFILE_KEY, 'PROFILE_ACTIVE_GHOST',
        `Die aktive Profil-ID ${activeId} existiert nicht in der Profilregistry.`);
    if (currentId && activeId && currentId !== activeId) reject(activeId, ACTIVE_PROFILE_KEY, 'PROFILE_CONTEXT_MISMATCH',
        `Aktives Profil ${activeId} und aktuelles Profil ${currentId} stimmen nicht überein.`);
}

/**
 * @param {string} profileId
 * @param {string | undefined} profileName
 * @param {D.ProfileLoadResult} result
 * @param {unknown} registryRaw
 * @param {I.ProfileOptions} [options]
 * @returns {D.ProfileRecovery}
 */
function createProfileFieldRecovery(profileId, profileName, result, registryRaw, options = {}) {
    const status = result.status;
    const storageKey = result.storageKey;
    const dataArea = storageKey === PROFILE_HEALTH_BUCKET_KEY
        ? 'Pflegebucket'
        : 'Balance-State';
    const message = status === PROFILE_LOAD_STATUS.UNAVAILABLE
        ? `Profil ${profileName || profileId}: Der ${dataArea} ist technisch nicht lesbar.`
        : `Profil ${profileName || profileId}: Der ${dataArea} ist korrupt und blockiert die Profilnutzung.`;
    return {
        status,
        scope: options.scope || 'profile-field',
        storageKey,
        profileId,
        profileName: profileName || profileId,
        raw: result.raw ?? null,
        registryRaw,
        code: result.error?.code || 'PROFILE_FIELD_INVALID',
        message,
        detail: result.error?.message || '',
        canReset: status === PROFILE_LOAD_STATUS.CORRUPT && result.raw !== null
    };
}

/**
 * @param {string} profileId
 * @param {D.Profile} profile
 * @param {I.ProfileOptions} [options]
 */
export function assertProfileDataLoadable(profileId, profile, options = {}) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.CORRUPT,
            scope: 'registry',
            storageKey: PROFILE_STORAGE_KEY,
            profileId,
            raw: options.registryRaw ?? null,
            registryRaw: options.registryRaw ?? null,
            code: 'PROFILE_REGISTRY_ENTRY_INVALID',
            message: `Profil ${profileId} besitzt keinen gueltigen Registryeintrag.`,
            canReset: options.registryRaw !== null && options.registryRaw !== undefined
        });
    }
    const data = profile.data;
    /** @type {D.ProfileLoadResult[]} */
    const checks = [
        loadProfileHealthBucketFromData(data),
        loadStoredBalanceStateFromData(data)
    ];
    const failed = checks.find(result => (
        result.status === PROFILE_LOAD_STATUS.CORRUPT
        || result.status === PROFILE_LOAD_STATUS.UNAVAILABLE
    ));
    if (failed) {
        throw new ProfileRecoveryError(createProfileFieldRecovery(
            profileId,
            profile.meta?.name,
            failed,
            options.registryRaw ?? null,
            options
        ), failed.error?.cause || null);
    }
    return {
        healthBucket: checks[0],
        balanceState: checks[1]
    };
}

/**
 * @param {unknown} error
 * @returns {D.ProfileRecovery | null}
 */
export function getProfileRecoveryFromError(error) {
    if (/** @type {I.AppError} */ (error)?.recovery) return /** @type {I.AppError} */ (error).recovery;
    if (error instanceof ProfileRegistryError && /** @type {I.AppError} */ (error).recovery) return /** @type {I.AppError} */ (error).recovery;
    return null;
}
