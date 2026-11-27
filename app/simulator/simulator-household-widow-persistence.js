import { PROFILE_STORAGE_KEYS } from '../profile/profile-state.js';

/** @import {RecordReader, RecordStorage} from '../../typcheck/datenvertraege.js' */

export const HOUSEHOLD_WIDOW_KEY = 'household_simulator_widow_v1';
export const WIDOW_FIELD_IDS = ['widowPensionMode', 'widowPensionPct', 'widowMarriageOffsetYears', 'widowMinMarriageYears'];

/** @param {string|null} raw @returns {Record<string, string>|null} */
export function parseHouseholdWidowSettings(raw) {
    if (raw == null) return null;
    const record = JSON.parse(raw);
    const values = record?.values;
    if (record?.version !== 1 || !values || typeof values !== 'object' || Array.isArray(values)
        || Object.keys(values).some(id => !WIDOW_FIELD_IDS.includes(id) || typeof values[id] !== 'string')) {
        throw new Error('Die gespeicherten Einstellungen zur Hinterbliebenenrente sind ungültig.');
    }
    return values;
}

/** @param {RecordReader} storage */
function legacyWidowSettings(storage) {
    const { registry, active, current } = PROFILE_STORAGE_KEYS;
    const activeId = storage.getItem(active) || storage.getItem(current);
    let profiles;
    try { profiles = JSON.parse(storage.getItem(registry) || 'null')?.profiles; }
    catch { return {}; }
    const valuesFrom = read => Object.fromEntries(WIDOW_FIELD_IDS.map(id => [id, read('sim_' + id)])
        .filter(([, value]) => typeof value === 'string' && value !== ''));
    const profileIds = Object.keys(profiles || {});
    if (!profileIds.length) return valuesFrom(key => storage.getItem(key));

    if (profileIds.includes(activeId)) {
        const values = valuesFrom(key => storage.getItem(key) ?? profiles[activeId]?.data?.[key]);
        if (Object.keys(values).length) return values;
    }
    for (const id of profileIds) {
        const values = valuesFrom(key => profiles[id]?.data?.[key]);
        if (Object.keys(values).length) return values;
    }
    return {};
}

/** @param {RecordReader} storage */
export function readHouseholdWidowSettings(storage) {
    return parseHouseholdWidowSettings(storage.getItem(HOUSEHOLD_WIDOW_KEY)) ?? legacyWidowSettings(storage);
}

/** @param {RecordStorage} storage */
export function loadHouseholdWidowSettings(storage) {
    const values = readHouseholdWidowSettings(storage);
    if (storage.getItem(HOUSEHOLD_WIDOW_KEY) == null && Object.keys(values).length) {
        storage.setItem(HOUSEHOLD_WIDOW_KEY, JSON.stringify({ version: 1, values }));
    }
    return values;
}

/** @param {RecordStorage} storage @param {string} id @param {string} value */
export function writeHouseholdWidowSetting(storage, id, value) {
    const values = parseHouseholdWidowSettings(storage.getItem(HOUSEHOLD_WIDOW_KEY)) ?? {};
    storage.setItem(HOUSEHOLD_WIDOW_KEY, JSON.stringify({ version: 1, values: { ...values, [id]: value } }));
}
