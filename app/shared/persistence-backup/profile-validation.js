/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { IMMOBILIEN_KEY, readImmobilien } from '../../profile/profile-immobilien.js';
import { incomeFromRecord } from '../../profile/profile-income.js';
import { OVERVIEW_SIMULATION_KEY, assertSimulationRecord } from '../../overview/overview-simulation-summary.js';
import { PERSON_VALUE_KEYS, validatePersonValues } from '../../profile/profile-person-data.js';
import { careTodayFromRecord, careTodayErrors } from '../../profile/profile-care.js';
import { PROFILE_CASH_HISTORY_KEY, PROFILE_WEALTH_LOTS_KEY, assertCashHistory, assertWealthLots } from '../../profile/profile-wealth-history.js';
import { requireHistoryRecord, historyDay } from '../../tranches/tranchen-history-store.js';
import { isSnapshotTechnicalKey } from '../persistence-key-policy.js';
import { PROFILE_HEALTH_BUCKET_KEY, PROFILE_CASH_CONFIRMED_DATE_KEY, PROFILE_LOAD_STATUS, PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY, PROFILE_VALUE_KEYS, loadProfileHealthBucketFromData, loadStoredBalanceStateFromData, parseStoredBool, parseStoredNumber } from '../../profile/profile-state.js';
import { isProfileScopedKey } from '../../profile/profile-key-policy.js';
import { loadProfileRegistry, assertHouseholdLimit } from '../../profile/profile-registry.js';
import { assertProfileIdentityRecords } from '../../profile/profile-storage.js';
import { CONFIG } from '../../balance/balance-config.js';
import { normalizeTrancheCollection } from '../../../types/tranche-contract.js';
import { assertCumulativeInflationFactor } from '../../../types/cumulative-inflation-contract.js';
import { BLOCKED_BACKUP_KEYS } from './schema.js';
import { isPlainRecord, hasOwn, createRecordsStorage, validateIsoTimestamp } from './records.js';

const PROFILE_SELECTOR_KEYS = [
    PROFILE_STORAGE_KEYS.current,
    PROFILE_STORAGE_KEYS.active
];

const PROFILE_NUMBER_KEYS = new Set([
    PROFILE_VALUE_KEYS.tagesgeld,
    PROFILE_VALUE_KEYS.renteMonatlich,
    PROFILE_VALUE_KEYS.sonstigeEinkuenfte,
    PROFILE_VALUE_KEYS.alter,
    PROFILE_VALUE_KEYS.goldZiel,
    PROFILE_VALUE_KEYS.goldFloor,
    PROFILE_VALUE_KEYS.goldRebalBand
]);

const PROFILE_BOOLEAN_KEYS = new Set([
    PROFILE_VALUE_KEYS.renteAktiv,
    PROFILE_VALUE_KEYS.goldAktiv,
    PROFILE_VALUE_KEYS.goldSteuerfrei
]);

/**
 * @param {D.BalanceState} balanceState
 * @param {string} path
 * @returns {void}
 */
function validateBalanceInflationState(balanceState, path) {
    const lastState = balanceState?.lastState;
    if (!isPlainRecord(lastState) || !hasOwn(lastState, 'cumulativeInflationFactor')) return;
    assertCumulativeInflationFactor(lastState.cumulativeInflationFactor, {
        path: `${path}.lastState.cumulativeInflationFactor`
    });
}

/**
 * @param {D.StringRecords} data
 * @param {string} path
 * @returns {void}
 */
function validateStoredTranches(data, path) {
    if (!hasOwn(data, PROFILE_TRANCHES_KEY)) return;
    const raw = data[PROFILE_TRANCHES_KEY];
    if (typeof raw !== 'string') {
        throw new Error(`${path}.${PROFILE_TRANCHES_KEY} muss als JSON-String vorliegen.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${path}.${PROFILE_TRANCHES_KEY} enthaelt ungueltiges JSON.`);
    }
    normalizeTrancheCollection(parsed, { mode: 'persisted' });
}

/**
 * @param {D.StringRecords} data
 * @param {string} path
 * @returns {void}
 */
function validateProfileScalarValues(data, path) {
    incomeFromRecord(data);
    readImmobilien(data[IMMOBILIEN_KEY]);
    for (const grade of [1, 2, 3, 4, 5]) {
        const form = data[`sim_pflegeStufe${grade}Form`];
        if (form != null && form !== '' && !['family', 'home-support', 'residential', 'external'].includes(form)) throw new Error(`${path}: Pflegeform für Grad ${grade} ist ungültig.`);
    }
    const careErrors = careTodayErrors(careTodayFromRecord(data));
    if (careErrors.length) throw new Error(`${path}: ${careErrors[0].message}`);
    if (hasOwn(data, PROFILE_CASH_CONFIRMED_DATE_KEY)) historyDay(data[PROFILE_CASH_CONFIRMED_DATE_KEY]);
    if (data[PERSON_VALUE_KEYS.personSchemaVersion] !== undefined) {
        if (data[PERSON_VALUE_KEYS.personSchemaVersion] !== '1') throw new Error(`${path}: unbekannte Personenversion.`);
        validatePersonValues(Object.fromEntries(Object.entries(PERSON_VALUE_KEYS).map(([field, key]) => [field, data[key]])));
        if (data[PERSON_VALUE_KEYS.personMigration]) {
            const metadata = JSON.parse(data[PERSON_VALUE_KEYS.personMigration]);
            if (!isPlainRecord(metadata) || !Number.isSafeInteger(metadata.referenceYear)) throw new Error(`${path}: ungültige Personenherkunft.`);
        }
    }

    Object.entries(data).forEach(([key, value]) => {
        if (PROFILE_NUMBER_KEYS.has(key) && parseStoredNumber(value, null) === null) {
            throw new Error(`${path}.${key} enthaelt keine endliche Zahl.`);
        }
        if (PROFILE_BOOLEAN_KEYS.has(key) && parseStoredBool(value, null) === null) {
            throw new Error(`${path}.${key} enthaelt keinen gueltigen Booleanwert.`);
        }
    });
}

/**
 * @param {D.StringRecords} data
 * @param {string} path
 * @param {{allowHistoricalTechnicalKeys?: boolean}} [options]
 * @returns {void}
 */
function validateProfileData(data, path, { allowHistoricalTechnicalKeys = false } = {}) {
    if (!isPlainRecord(data)) {
        throw new Error(`${path} ist kein gueltiges Profildatenobjekt.`);
    }
    Object.entries(data).forEach(([key, value]) => {
        // Nur verschachtelte Registrydaten dürfen historische technische Strings behalten.
        if (BLOCKED_BACKUP_KEYS.has(key) || (!isProfileScopedKey(key)
            && !(allowHistoricalTechnicalKeys && isSnapshotTechnicalKey(key)))) {
            throw new Error(`${path}.${key} ist kein erlaubter profilbezogener Key.`);
        }
        if (typeof value !== 'string') {
            throw new Error(`${path}.${key} muss als String vorliegen.`);
        }
    });

    const healthResult = loadProfileHealthBucketFromData(data);
    if (healthResult.status === PROFILE_LOAD_STATUS.CORRUPT
        || healthResult.status === PROFILE_LOAD_STATUS.UNAVAILABLE) {
        throw new Error(healthResult.error?.message || `${path}.${PROFILE_HEALTH_BUCKET_KEY} ist ungueltig.`);
    }

    const balanceResult = loadStoredBalanceStateFromData(data);
    if (balanceResult.status === PROFILE_LOAD_STATUS.CORRUPT
        || balanceResult.status === PROFILE_LOAD_STATUS.UNAVAILABLE) {
        throw new Error(`${path}.${CONFIG.STORAGE.LS_KEY}: ${balanceResult.error?.message || 'Der Balance-State ist ungueltig.'}`);
    }
    if (/** @type {D.BalanceState} */ (balanceResult.value)) {
        validateBalanceInflationState(/** @type {D.BalanceState} */ (balanceResult.value), `${path}.${CONFIG.STORAGE.LS_KEY}`);
    }

    for (const [key, validator] of /** @type {[string, (value: unknown) => unknown][]} */ ([[PROFILE_CASH_HISTORY_KEY, assertCashHistory], [PROFILE_WEALTH_LOTS_KEY, assertWealthLots]])) {
        if (hasOwn(data, key)) requireHistoryRecord(data[key], validator);
    }
    if (hasOwn(data, OVERVIEW_SIMULATION_KEY)) assertSimulationRecord(data[OVERVIEW_SIMULATION_KEY]);
    validateStoredTranches(data, path);
    validateProfileScalarValues(data, path);
}

/**
 * @param {D.StringRecords} records
 * @param {{householdLimit?: boolean, requireProfileContext?: boolean}} [options]
 * @param {Set<string> | null} [profileIds]
 * @returns {D.ProfileRegistry}
 */
export function validateRegistryAndProfiles(records, options = {}, profileIds = null) {
    const storage = createRecordsStorage(records);
    const registryResult = /** @type {I.LoadRegistry} */ (/** @type {unknown} */ (loadProfileRegistry))(storage);
    if (registryResult.status === PROFILE_LOAD_STATUS.CORRUPT
        || registryResult.status === PROFILE_LOAD_STATUS.UNAVAILABLE) {
        throw new Error(registryResult.error?.message || 'Die Profilregistry ist ungueltig.');
    }

    const registryPresent = hasOwn(records, PROFILE_STORAGE_KEYS.registry);
    const registry = registryResult.value || { version: 1, profiles: {} };
    if (options.householdLimit !== false) assertHouseholdLimit(registry);
    if (options.requireProfileContext && !registryPresent) {
        throw new Error('Die Profilregistry fehlt.');
    }

    Object.entries(registry.profiles || {}).forEach(([profileId, profile]) => {
        /** @type {Partial<D.ProfileMeta>} */
        const meta = profile.meta || {};
        if (meta.createdAt !== undefined) validateIsoTimestamp(meta.createdAt, `registry.profiles.${profileId}.meta.createdAt`);
        if (meta.updatedAt !== undefined) validateIsoTimestamp(meta.updatedAt, `registry.profiles.${profileId}.meta.updatedAt`);
        if (!profileIds || profileIds.has(profileId)) {
            validateProfileData(profile.data, `registry.profiles.${profileId}.data`, { allowHistoricalTechnicalKeys: true });
        }
    });

    PROFILE_SELECTOR_KEYS.forEach(key => {
        if (!hasOwn(records, key)) {
            if (options.requireProfileContext) {
                throw new Error(`${key} fehlt.`);
            }
            return;
        }
        const profileId = records[key];
        if (!profileId || !hasOwn(registry.profiles, profileId)) {
            throw new Error(`${key} verweist auf das nicht vorhandene Profil ${profileId || '<leer>'}.`);
        }
    });
    assertProfileIdentityRecords(registry, records[PROFILE_STORAGE_KEYS.current], records[PROFILE_STORAGE_KEYS.active],
        records[PROFILE_STORAGE_KEYS.registry]);
    return registry;
}

/**
 * @param {D.StringRecords} records
 * @returns {void}
 */
export function validateLiveProfile(records) {
    const liveProfileData = Object.create(null);
    Object.entries(records).forEach(([key, value]) => {
        if (isProfileScopedKey(key)) liveProfileData[key] = value;
    });
    validateProfileData(liveProfileData, 'records');
}
