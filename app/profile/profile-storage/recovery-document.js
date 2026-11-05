/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { PROFILE_LOAD_STATUS } from '../profile-state.js';

export const PROFILE_RECOVERY_SCHEMA = 'ruhestand-profile-recovery';

export const PROFILE_RECOVERY_SCHEMA_VERSION = 1;

/**
 * @param {unknown} expected
 * @param {unknown} actual
 * @returns {boolean}
 */
export function recoveryRawMatches(expected, actual) {
    if (typeof expected === 'string' || typeof actual === 'string') {
        return expected === actual;
    }
    try {
        return JSON.stringify(expected) === JSON.stringify(actual);
    } catch {
        return false;
    }
}

/**
 * @param {D.ProfileRecovery} recovery
 * @param {I.RecoveryOptions} [options]
 * @returns {D.ProfileRecoveryDocument}
 */
export function createProfileRecoveryDocument(recovery, options = {}) {
    if (!recovery || recovery.status !== PROFILE_LOAD_STATUS.CORRUPT || recovery.raw === null) {
        throw new Error('Fuer diesen Profilzustand ist kein Raw-Recovery-Export verfuegbar.');
    }
    return {
        schema: PROFILE_RECOVERY_SCHEMA,
        schemaVersion: PROFILE_RECOVERY_SCHEMA_VERSION,
        exportedAt: options.exportedAt || new Date().toISOString(),
        backend: options.backend || 'unknown',
        recovery: {
            status: recovery.status,
            scope: recovery.scope,
            code: recovery.code,
            message: recovery.message,
            detail: recovery.detail || '',
            storageKey: /** @type {string} */ (recovery.storageKey) || null,
            profileId: /** @type {string} */ (recovery.profileId) || null,
            profileName: recovery.profileName || null,
            raw: recovery.raw,
            registryRaw: recovery.registryRaw ?? null
        }
    };
}

/**
 * @param {D.ProfileRecovery} recovery
 * @param {D.ProfileRecoveryDocument | null} recoveryDocument
 * @returns {void}
 */
export function assertRecoveryDocumentMatches(recovery, recoveryDocument) {
    const exported = recoveryDocument?.recovery;
    if (recoveryDocument?.schema !== PROFILE_RECOVERY_SCHEMA
        || recoveryDocument?.schemaVersion !== PROFILE_RECOVERY_SCHEMA_VERSION
        || exported?.status !== recovery.status
        || exported?.scope !== recovery.scope
        || exported?.storageKey !== (/** @type {string} */ (recovery.storageKey) || null)
        || exported?.profileId !== (/** @type {string} */ (recovery.profileId) || null)
        || !recoveryRawMatches(exported?.raw, recovery.raw)
        || !recoveryRawMatches(exported?.registryRaw ?? null, recovery.registryRaw ?? null)) {
        throw new Error('Der Recovery-Export passt nicht mehr zum aktuellen Profilfehler.');
    }
}
