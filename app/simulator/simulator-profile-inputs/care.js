import { SUPPORTED_PFLEGE_GRADES } from '../simulator-data.js';
import { readNumber, simKey, readString } from './values.js';
import { CARE_FLEX_DEFAULT_PERCENT, CARE_MORTALITY_DEFAULT_FACTORS } from '../simulator-care-flex.js';
import { normalizeCareForm, defaultCareForm } from '../../shared/care-benefits.js';

export const careTodaySources = new WeakMap();

export function parsePflegeGradeConfigs(data) {
    const configs = {};
    SUPPORTED_PFLEGE_GRADES.forEach(grade => {
        // Pflege-Stufen: Zusatzkosten + Flex-Cut + Mortalitätsfaktor.
        const zusatz = readNumber(data, simKey(`pflegeStufe${grade}Zusatz`), 0);
        const flexPct = readNumber(data, simKey(`pflegeStufe${grade}FlexCut`), CARE_FLEX_DEFAULT_PERCENT[grade]);
        const flexCut = Math.min(1, Math.max(0, flexPct / 100));
        const mortalityFactor = Math.max(0, readNumber(data, simKey(`pflegeStufe${grade}Mortality`), CARE_MORTALITY_DEFAULT_FACTORS[grade]));
        const careForm = normalizeCareForm(data.sim_pflegeKostenStaffelPreset === 'amtlich' ? null : readString(data, simKey(`pflegeStufe${grade}Form`), defaultCareForm(grade)), grade);
        configs[grade] = { zusatz, flexCut, mortalityFactor, ...(careForm !== defaultCareForm(grade) ? { careForm } : {}) };
    });
    return configs;
}
