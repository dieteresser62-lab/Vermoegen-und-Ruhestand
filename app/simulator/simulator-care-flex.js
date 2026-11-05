import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT } from './german-demography-care-survivor-contract.js';

/** Flex-Level je Pflegegrad in Prozent; Runner verwenden Verhältnisse. */
export const CARE_FLEX_DEFAULT_PERCENT = Object.freeze({ 1: 100, 2: 100, 3: 50, 4: 0, 5: 0 });
export const CARE_FLEX_MIGRATION_KEY = 'sim_careFlexDefaultsVersion';
export const CARE_FLEX_FIELD_KEYS = Object.freeze(Object.keys(CARE_FLEX_DEFAULT_PERCENT)
    .map(grade => `sim_pflegeStufe${grade}FlexCut`));
const OLD_PERCENT = [75, 25, 10, 0, 0];
export const CARE_MORTALITY_DEFAULT_FACTORS = GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.care.mortalityModel.defaultFactorsByGrade;
export const CARE_MORTALITY_MIGRATION_KEY = 'sim_careMortalityDefaultsVersion';
export const CARE_MORTALITY_FIELD_KEYS = Object.freeze([1, 2, 3, 4, 5].map(grade => `sim_pflegeStufe${grade}Mortality`));

/**
 * @param record
 * @returns Ergebnis der Operation.
 */
export function migrateCareMortalityRecord(record) {
    if (!record || record[CARE_MORTALITY_MIGRATION_KEY] === '1') return record;
    const oldFactors = [0, 0, 3, 5, 5];
    const isOldDefault = CARE_MORTALITY_FIELD_KEYS.every((key, index) => {
        const raw = record[key];
        return (typeof raw === 'number' || typeof raw === 'string') && String(raw).trim() !== ''
            && Number(String(raw).replace(',', '.')) === oldFactors[index];
    });
    if (!isOldDefault) return record;
    return { ...record, ...Object.fromEntries(CARE_MORTALITY_FIELD_KEYS.map((key, index) =>
        [key, String(CARE_MORTALITY_DEFAULT_FACTORS[index + 1])])), [CARE_MORTALITY_MIGRATION_KEY]: '1' };
}

/**
 * @param record
 * @returns Ergebnis der Operation.
 */
export function migrateCareDefaultsRecord(record) {
    return migrateCareMortalityRecord(migrateCareFlexRecord(record));
}

/** Nur eine vollständig gespeicherte alte Vorgabe umstellen, nie Einzelwerte.
 *
 * @param record
 * @returns Ergebnis der Operation.
 */
export function migrateCareFlexRecord(record) {
    if (!record || record[CARE_FLEX_MIGRATION_KEY] === '1') return record;
    const isOldDefault = CARE_FLEX_FIELD_KEYS.every((key, index) => {
        const raw = record[key];
        if (typeof raw !== 'number' && typeof raw !== 'string') return false;
        if (String(raw).trim() === '') return false;
        return Number(String(raw).replace(',', '.')) === OLD_PERCENT[index];
    });
    if (!isOldDefault) return record;
    return { ...record, ...Object.fromEntries(CARE_FLEX_FIELD_KEYS.map((key, index) =>
        [key, String(CARE_FLEX_DEFAULT_PERCENT[index + 1])])), [CARE_FLEX_MIGRATION_KEY]: '1' };
}
