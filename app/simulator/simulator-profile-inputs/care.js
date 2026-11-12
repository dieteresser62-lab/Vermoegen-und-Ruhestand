import { readCareCostSettings } from '../../shared/care-cost-resolver.js';
import { SUPPORTED_PFLEGE_GRADES } from '../simulator-data.js';
import { readNumber, simKey, readString } from './values.js';
import { CARE_FLEX_DEFAULT_PERCENT, CARE_MORTALITY_DEFAULT_FACTORS } from '../simulator-care-flex.js';
import { normalizeCareForm, defaultCareForm } from '../../shared/care-benefits.js';

export const careTodaySources = new WeakMap();

/** Staffelbeträge kommen vom Aufrufer (Pflegewerte-Record zuerst); ohne Angabe gilt der Altbestand der Person.
 *
 * @param {Record<string, unknown>} data Profilrecord.
 * @param {Record<number, number>} [costs] Wirksame Jahreszusätze je Grad.
 * @returns {Record<number, {zusatz: number, flexCut: number, mortalityFactor: number, careForm?: string}>} Gradkonfiguration.
 */
export function parsePflegeGradeConfigs(data, costs = readCareCostSettings(data).costs) {
    const configs = /** @type {Record<number, {zusatz: number, flexCut: number, mortalityFactor: number, careForm?: string}>} */ ({});
    SUPPORTED_PFLEGE_GRADES.forEach(grade => {
        // Pflege-Stufen: Zusatzkosten + Flex-Cut + Mortalitätsfaktor.
        const zusatz = costs[grade];
        const flexPct = readNumber(data, simKey(`pflegeStufe${grade}FlexCut`), CARE_FLEX_DEFAULT_PERCENT[grade]);
        const flexCut = Math.min(1, Math.max(0, flexPct / 100));
        const mortalityFactor = Math.max(0, readNumber(data, simKey(`pflegeStufe${grade}Mortality`), CARE_MORTALITY_DEFAULT_FACTORS[grade]));
        const careForm = normalizeCareForm(data.sim_pflegeKostenStaffelPreset === 'amtlich' ? null : readString(data, simKey(`pflegeStufe${grade}Form`), defaultCareForm(grade)), grade);
        configs[grade] = { zusatz, flexCut, mortalityFactor, ...(careForm !== defaultCareForm(grade) ? { careForm } : {}) };
    });
    return configs;
}
