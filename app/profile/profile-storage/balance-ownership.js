/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */
import { stripBalancePersonInputs } from '../profile-person-data.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { captureProfileData as captureLiveProfileData } from '../profile-live-storage.js';
import { CONFIG } from '../../balance/balance-config.js';
import { LEGACY_PERSON_KEYS } from '../profile-person-migration.js';

export const HOUSEHOLD_OWNED_BALANCE_STATE_KEYS = Object.freeze([
    'annualPeriodMetadata',
    'balanceStateLifecycle',
    'ageAdjustedForInflation',
    'needsAdjustedForInflationYear',
    'lastInflationAppliedAtYear',
    'annualMarketDataMeta',
    'capeMeta'
]);

/**
 * @param {unknown} raw
 * @returns {D.BalanceState | null}
 */
export function parseBalanceState(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return /** @type {D.BalanceState} */ (raw);
    try {
        const parsed = JSON.parse(String(raw));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    } catch {
        return null;
    }
}

/**
 * @param {D.BalanceState} [state]
 * @param {{preservePersonInputs?: boolean}} [options]
 * @returns {D.BalanceState}
 */
export function createProfileOwnedBalanceState(state = {}, { preservePersonInputs = false } = {}) {
    const profileState = { ...state };
    HOUSEHOLD_OWNED_BALANCE_STATE_KEYS.forEach(key => {
        delete profileState[key];
    });
    return preservePersonInputs ? profileState : stripBalancePersonInputs(profileState);
}

/**
 * @param {D.BalanceState} [state]
 * @returns {D.BalanceState}
 */
export function createHouseholdOwnedBalanceState(state = {}) {
    return Object.fromEntries(
        HOUSEHOLD_OWNED_BALANCE_STATE_KEYS
            .filter(key => Object.prototype.hasOwnProperty.call(state, key))
            .map(key => [key, state[key]])
    );
}

/**
 * @param {string} raw
 * @param {I.ProfileOptions} [options]
 */
function sanitizeStoredProfileBalanceState(raw, options = {}) {
    const parsed = parseBalanceState(raw);
    if (!parsed) return { raw, changed: false };
    const changed = (!options.preservePersonInputs && JSON.stringify(stripBalancePersonInputs(parsed)) !== JSON.stringify(parsed)) || HOUSEHOLD_OWNED_BALANCE_STATE_KEYS.some(
        key => Object.prototype.hasOwnProperty.call(parsed, key)
    );
    return {
        raw: changed ? JSON.stringify(createProfileOwnedBalanceState(parsed, options)) : raw,
        changed
    };
}

/**
 * @param {D.StringRecords} data
 * @returns {D.StringRecords}
 */
export function sanitizeProfileDataBalanceOwnership(data) {
    if (!data || typeof data !== 'object') return data;
    const key = CONFIG.STORAGE.LS_KEY;
    if (!Object.prototype.hasOwnProperty.call(data, key)) return data;
    const sanitized = sanitizeStoredProfileBalanceState(data[key], { preservePersonInputs: data.profile_person_schema_version !== '1' });
    if (!sanitized.changed) return data;
    return {
        ...data,
        [key]: sanitized.raw
    };
}

/**
 * @param {D.RecordStorage} [storage]
 * @returns {D.StringRecords}
 */
export function captureProfileData(storage = persistenceStorage) {
    const captured = /** @type {(storage?: D.RecordStorage) => D.StringRecords} */ (captureLiveProfileData)(storage);
    if (captured.profile_person_schema_version !== '1') return captured;
    return sanitizeProfileDataBalanceOwnership(captured);
}

/** Derselbe Merge für gewöhnliches Sichern und transaktionale Depotaktionen. */
/**
 * @param {D.StringRecords} savedData
 * @param {D.StringRecords} capturedData
 * @param {string[]} [deletedKeys]
 * @returns {D.StringRecords}
 */
export function mergeProfileLiveData(savedData, capturedData, deletedKeys = []) {
    const merged = { ...savedData, ...capturedData };
    deletedKeys.forEach(key => delete merged[key]);
    const data = sanitizeProfileDataBalanceOwnership(merged);
    if (data.profile_person_schema_version === '1') LEGACY_PERSON_KEYS.forEach(key => delete data[key]);
    return data;
}
