/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { PROFILE_LOAD_STATUS, PROFILE_STORAGE_KEYS } from '../profile-state.js';

export const PROFILE_STORAGE_KEY = PROFILE_STORAGE_KEYS.registry;

export const ACTIVE_PROFILE_KEY = PROFILE_STORAGE_KEYS.active;

export const CURRENT_PROFILE_KEY = PROFILE_STORAGE_KEYS.current;

export class ProfileRecoveryError extends Error {
    /** @param {D.ProfileRecovery} recovery @param {unknown} [cause] */
    constructor(recovery, cause = null) {
        super(recovery?.message || 'Profildaten konnten nicht sicher geladen werden.');
        this.name = 'ProfileRecoveryError';
        this.code = recovery?.code || 'PROFILE_RECOVERY_REQUIRED';
        this.status = recovery?.status || PROFILE_LOAD_STATUS.CORRUPT;
        this.storageKey = recovery?.storageKey || null;
        this.profileId = recovery?.profileId || null;
        this.raw = recovery?.raw ?? null;
        this.recovery = recovery || null;
        this.cause = cause;
    }
}

/**
 * @param {D.RecordReader} storage
 * @param {string} key
 * @param {string} message
 * @returns {string | null}
 */
export function readStorageValue(storage, key, message) {
    try {
        return storage.getItem(key);
    } catch (error) {
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.UNAVAILABLE,
            scope: 'profile-context',
            storageKey: key,
            raw: null,
            code: 'PROFILE_STORAGE_UNAVAILABLE',
            message,
            canReset: false
        }, error);
    }
}

/**
 * @param {D.RecordWriter} storage
 * @param {string} key
 * @param {string} value
 * @param {string} message
 * @returns {void}
 */
export function writeStorageValue(storage, key, value, message) {
    try {
        storage.setItem(key, value);
    } catch (error) {
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.UNAVAILABLE,
            scope: 'profile-context',
            storageKey: key,
            raw: null,
            code: 'PROFILE_STORAGE_UNAVAILABLE',
            message,
            canReset: false
        }, error);
    }
}

/**
 * @param {Pick<D.RecordStorage, "removeItem">} storage
 * @param {string} key
 * @param {string} message
 * @returns {void}
 */
export function removeStorageValue(storage, key, message) {
    try {
        storage.removeItem(key);
    } catch (error) {
        throw new ProfileRecoveryError({
            status: PROFILE_LOAD_STATUS.UNAVAILABLE,
            scope: 'profile-context',
            storageKey: key,
            raw: null,
            code: 'PROFILE_STORAGE_UNAVAILABLE',
            message,
            canReset: false
        }, error);
    }
}
