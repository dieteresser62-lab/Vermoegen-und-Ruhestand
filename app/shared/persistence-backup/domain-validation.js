/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { HOUSEHOLD_CARE_VALUES_KEY, parseCareValues } from '../household-care-values.js';
import { CARE_HINT_KEY, parseCareHint } from '../household-care-hint.js';
import { PARTNERSHIP_KEY, readPartnership } from '../../profile/household-partnership.js';
import { PLANNED_EXPENSES_KEY, assertPlannedExpensesRecord } from '../../profile/household-planned-expenses.js';
import { HOUSEHOLD_PLAN_KEY, assertHouseholdPlanRecord } from '../../profile/household-plan.js';
import { WEALTH_CAPTURES_KEY, readWealthCaptures } from '../../../types/wealth-capture-contract.js';
import { ANNUAL_PLAN_RECORD_KEY, assertAnnualPlanRecord } from '../../profile/annual-plan-record.js';
import { DATA_BACKUP_SUMMARY_KEY, assertBackupSummary } from '../../data/data-backup-summary.js';
import { WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY, assertHistoryStart, assertDailyPrices, requireHistoryRecord } from '../../tranches/tranchen-history-store.js';
import { OVERVIEW_BACKUP_KEY } from '../../overview/overview-storage.js';
import { isAllowedPersistenceImportKey } from '../persistence-key-policy.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { PROFILE_LIVE_BASE_KEY } from '../../profile/profile-storage.js';
import { EXPENSES_STORAGE_KEY, EXPENSES_STORE_STATUS, loadExpensesStoreResult } from '../../balance/balance-expenses-storage.js';
import { BLOCKED_BACKUP_KEYS } from './schema.js';
import { isPlainRecord, hasOwn, createRecordsStorage } from './records.js';
import { validateRegistryAndProfiles, validateLiveProfile } from './profile-validation.js';

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [error]
 * @returns {Extract<D.DomainValidation, {ok: false}>}
 */
function invalidDomain(code, message, error = null) {
    return {
        ok: false,
        code,
        message,
        ...(error ? { error } : {})
    };
}

/**
 * @param {D.StringRecords} records
 * @returns {void}
 */
function validateLiveDomains(records) {
    validateLiveProfile(records);
    if (hasOwn(records, EXPENSES_STORAGE_KEY)) {
        const expensesResult = loadExpensesStoreResult(createRecordsStorage(records));
        if (expensesResult.status === EXPENSES_STORE_STATUS.CORRUPT) {
            throw new Error(expensesResult.error?.message || 'Der Ausgabenstore ist ungueltig.');
        }
    }
}

/** Personenaktionen prüfen nur ihre Registry, Kennungen, Ladebasis und betroffene Personendaten. */
/**
 * @param {D.StringRecords} records
 * @param {string[]} profileIds
 * @param {{liveProfile?: boolean}} [options]
 * @returns {D.ProfileRegistry}
 */
export function validateProfileManagementRecords(records, profileIds, { liveProfile = false } = {}) {
    for (const key of [...Object.values(PROFILE_STORAGE_KEYS), PROFILE_LIVE_BASE_KEY]) {
        if (hasOwn(records, key) && typeof records[key] !== 'string') {
            throw new Error(`Persistenzwert ${key} muss als String vorliegen.`);
        }
    }
    const registry = validateRegistryAndProfiles(records, { requireProfileContext: true, householdLimit: false }, new Set(profileIds));
    if (liveProfile) validateLiveProfile(records);
    return registry;
}

/**
 * @param {D.StringRecords} records
 * @param {{householdLimit?: boolean, requireProfileContext?: boolean}} [options]
 * @returns {D.DomainValidation}
 */
export function validatePersistenceDomainRecords(records, options = {}) {
    if (!isPlainRecord(records)) {
        return invalidDomain('records_invalid', 'Persistenz-Records muessen ein Objekt sein.');
    }
    try {
        if (hasOwn(records, WEALTH_CAPTURES_KEY)) readWealthCaptures(records[WEALTH_CAPTURES_KEY]);
        Object.entries(records).forEach(([key, value]) => {
            if (BLOCKED_BACKUP_KEYS.has(key) || !isAllowedPersistenceImportKey(key)) {
                throw new Error(`Persistenz-Key ${key} ist nicht erlaubt.`);
            }
            if (typeof value !== 'string') {
                throw new Error(`Persistenzwert ${key} muss als String vorliegen.`);
            }
        });
        for (const [key, validator] of /** @type {[string, (value: unknown) => unknown][]} */ ([[WEALTH_HISTORY_START_KEY, assertHistoryStart], [DAILY_PRICES_KEY, assertDailyPrices]])) {
            if (hasOwn(records, key)) requireHistoryRecord(records[key], validator);
        }
        if (hasOwn(records, DATA_BACKUP_SUMMARY_KEY)) {
            const summary = assertBackupSummary(JSON.parse(/** @type {string} */ (records[DATA_BACKUP_SUMMARY_KEY])));
            if (hasOwn(records, OVERVIEW_BACKUP_KEY) && summary.exportedAt !== records[OVERVIEW_BACKUP_KEY]) throw new Error('Sicherungszeit und Vergleichsbasis widersprechen sich.');
        }
        for (const [key, validator] of /** @type {[string, (value: unknown) => unknown][]} */ ([[HOUSEHOLD_CARE_VALUES_KEY, parseCareValues], [CARE_HINT_KEY, parseCareHint], [HOUSEHOLD_PLAN_KEY, assertHouseholdPlanRecord], [PLANNED_EXPENSES_KEY, assertPlannedExpensesRecord], [ANNUAL_PLAN_RECORD_KEY, assertAnnualPlanRecord]])) {
            if (hasOwn(records, key)) validator(records[key]);
        }
        if (hasOwn(records, PARTNERSHIP_KEY)) readPartnership(records[PARTNERSHIP_KEY]);
        const registry = validateRegistryAndProfiles(records, options);
        validateLiveDomains(records);
        return { ok: true, records, registry };
    } catch (error) {
        return invalidDomain(
            /** @type {I.AppError} */ (error)?.code || 'domain_validation_failed',
            /** @type {I.AppError} */ (error)?.message || 'Persistenzdaten sind fachlich ungueltig.',
            error
        );
    }
}
