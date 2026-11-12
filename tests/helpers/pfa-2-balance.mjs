// FR-73 Paket 2: synthetische Balance-Haushalte aus dem Beispiel „Helga und Werner“ (Testdatum 23.10.2026).
import { createMusterHaushaltRecords } from '../../app/demo/muster-haushalt.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, planScope } from '../../app/profile/household-plan.js';
import { PARTNERSHIP_KEY } from '../../app/profile/household-partnership.js';
import { CARE_VALUE_KEYS } from '../../app/profile/profile-care.js';
import { CONFIG } from '../../app/balance/balance-config.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../../app/profile/annual-plan-record.js';
import { PROFILE_TRANCHES_KEY } from '../../app/profile/profile-state.js';

export const PFA2_TEST_DATE = '2026-10-23';
export const IDS = ['muster_helga', 'muster_werner'];

/** Gespeicherter Haushalt: Grundbedarf ohne Pflege, heutige Pflege je Person, ohne Einkünfte und ohne Rücklage.
 *
 * @param {object} [options]
 * @param {[object|null, object|null]} [options.care] Heutige Pflege für Helga (p1) und Werner (p2): {grade, form, residentialSince}.
 * @param {Partial<{floorBedarf: number, flexBedarf: number, minimumFlexAnnual: number}>} [options.plan] Planwerte.
 * @param {boolean} [options.single] Nur Helga im Haushalt.
 * @param {boolean} [options.unmarried] Unverheiratetes Paar.
 * @param {[number, number]} [options.cash] Tagesgeld je Person.
 * @param {[number, number]} [options.pensions] Monatsrente je Person.
 * @param {Record<string, string>} [options.sim] Zusätzliche sim_-Schlüssel auf dem Haushaltsprofil.
 * @param {string} [options.careValuesRaw] Gespeicherter Pflegewerte-Record.
 * @returns {{records: Record<string, string>, scope: import('../../typcheck/datenvertraege.js').PlanScope, values: object}} Rohrecords.
 */
export function pfa2Records({ care = [null, null], plan = {}, single = false, unmarried = false, cash = [40000, 40000],
    pensions = [0, 0], sim = {}, careValuesRaw = null, clearTranches = false, testDate = PFA2_TEST_DATE } = {}) {
    const records = createMusterHaushaltRecords(testDate, 'helga-werner');
    delete records[ANNUAL_PLAN_RECORD_KEY];
    const registry = JSON.parse(records.rs_profiles_v1);
    const ids = single ? [IDS[0]] : IDS;
    if (single) delete registry.profiles[IDS[1]];
    for (const [index, id] of ids.entries()) {
        const data = registry.profiles[id].data;
        for (const key of Object.values(CARE_VALUE_KEYS)) delete data[key];
        const today = care[index];
        if (today?.grade) {
            data[CARE_VALUE_KEYS.grade] = String(today.grade);
            if (today.form) data[CARE_VALUE_KEYS.form] = today.form;
            if (today.residentialSince) data[CARE_VALUE_KEYS.residentialSince] = today.residentialSince;
            if (today.residentialFirstYear) data[CARE_VALUE_KEYS.residentialFirstYear] = String(today.residentialFirstYear);
            if (today.homeCostsMonthly !== undefined && today.homeCostsMonthly !== null) data[CARE_VALUE_KEYS.homeCostsMonthly] = String(today.homeCostsMonthly);
        }
        data.profile_tagesgeld = String(cash[index]);
        data.profile_rente_monatlich = String(pensions[index]);
        if (clearTranches) data[PROFILE_TRANCHES_KEY] = '[]';
        delete data.profile_health_bucket;
        for (const key of Object.keys(data)) if (/^sim_pflegeStufe[1-5]Form$/.test(key)) delete data[key];
        if (index === 0) Object.assign(data, sim);
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    for (const key of Object.keys(records)) if (/^(profile_|sim_pflege)/.test(key)) delete records[key];
    Object.assign(records, registry.profiles[records.rs_current_profile].data);
    const scope = planScope(single ? 'single' : 'household', ids);
    const stored = JSON.parse(records[HOUSEHOLD_PLAN_KEY]);
    const base = Object.values(stored.entries)[0].values;
    const values = { ...base, floorBedarf: 36000, flexBedarf: 0, minimumFlexAnnual: 0, householdWithdrawalMode: 'proportional',
        decumulation: { mode: 'standard', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null }, ...plan };
    delete records[HOUSEHOLD_PLAN_KEY];
    records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope, values }], { now: () => new Date(`${testDate}T12:00:00Z`) }).raw;
    if (unmarried) records[PARTNERSHIP_KEY] = JSON.stringify({ schemaVersion: 1, status: 'unmarried', inheritance: { [IDS[0]]: 0, [IDS[1]]: 0 } });
    else delete records[PARTNERSHIP_KEY];
    if (careValuesRaw !== null) records.household_care_values_v1 = careValuesRaw; else delete records.household_care_values_v1;
    // Die Balance-Zustände behalten ihre Musterform; nur Plan und Personen bestimmen den Bedarf.
    for (const id of ids) {
        const state = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]);
        if (state.inputs) { state.inputs.floorBedarf = values.floorBedarf; state.inputs.flexBedarf = values.flexBedarf; }
        registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    Object.assign(records, registry.profiles[records.rs_current_profile].data);
    return { records, scope, values };
}

/** Zählender Speicheradapter: Lesen darf nie schreiben. */
export function countingStorage(records) {
    const counts = { setItem: 0, removeItem: 0 };
    return { counts, storage: { getItem: key => records[key] ?? null, setItem() { counts.setItem++; }, removeItem() { counts.removeItem++; },
        key: index => Object.keys(records)[index] ?? null, get length() { return Object.keys(records).length; } } };
}
