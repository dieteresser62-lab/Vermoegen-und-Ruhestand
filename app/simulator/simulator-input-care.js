import { resolveCareSetting } from '../shared/care-cost-resolver.js';
import { resolveCarePrices } from '../shared/care-prices.js';
import { careSettingsStorage, sharesHouseholdCareValues } from '../shared/care-profile-settings.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { readCareValues, officialCareCosts, careValuesInputPatch } from '../shared/household-care-values.js';
import { defaultCareForm, normalizeCareForm } from '../shared/care-benefits.js';
/**
 * Module: Simulator Input Care
 * Purpose: Reads care scenario inputs from the simulator UI.
 */
"use strict";

import { SUPPORTED_PFLEGE_GRADES } from './simulator-data.js';
import { normalizeCareDurationRange } from './simulator-portfolio-care.js';
import { readChecked, readInt, readNumber, readValue } from './simulator-input-dom.js';
import { CARE_FLEX_DEFAULT_PERCENT, CARE_MORTALITY_DEFAULT_FACTORS } from './simulator-care-flex.js';
import { residentialOwnExpensesInputPatch } from './simulator-residential-care.js';

const DEFAULT_PFLEGE_DRIFT_PCT = 5;

/**
 * Normalizes a persisted/UI percentage to the simulator's ratio contract.
 * Missing/invalid values use the boundary-specific fallback; negative values
 * are rejected into the neutral 0 % value before the single division by 100.
 *
 * @param {unknown} rawPercent
 * @param {unknown} [fallbackPercent]
 * @returns {number} Ergebnis der Operation.
 */
export function normalizeCareCostDriftPercent(rawPercent, fallbackPercent = 0) {
    const numericRaw = Number(rawPercent);
    const numericFallback = Number(fallbackPercent);
    const fallback = Number.isFinite(numericFallback) ? numericFallback : 0;
    const percent = Number.isFinite(numericRaw) ? numericRaw : fallback;
    return Math.max(0, percent) / 100;
}

/**
 * @param {object} [options]
 * @param {string} [options.gender]
 * @param [options.doc]
 * @param [options.storage]
 * @returns Ergebnis der Operation.
 */
export function readCareInputs({ gender = 'w', doc = globalThis.document, storage = persistenceStorage } = {}) {
    const careValues = readCareValues(storage), official = officialCareCosts(careValues);
    const isOfficial = readValue('pflegeKostenStaffelPreset', 'custom', doc) === 'amtlich';
    // FR-73 P8/B3: Trägt der Pflegewerte-Record Preise, sind die Felder bewusste Eingaben und werden nie umgedeutet.
    const prices = resolveCarePrices(careValues, careSettingsStorage(storage), { shared: sharesHouseholdCareValues(storage) });
    const price = (key, raw, fallback) => prices.stored ? numberOr(raw, fallback) : resolveCareSetting(key, raw);
    const pflegeGradeConfigs = {};
    SUPPORTED_PFLEGE_GRADES.forEach(grade => {
        const zusatz = isOfficial ? official[grade] : price(`sim_pflegeStufe${grade}Zusatz`, readValue(`pflegeStufe${grade}Zusatz`, null, doc), prices.costs[grade]);
        const flexPercent = readNumber(`pflegeStufe${grade}FlexCut`, NaN, doc);
        const flexCut = Math.min(1, Math.max(0, ((Number.isFinite(flexPercent) ? flexPercent : CARE_FLEX_DEFAULT_PERCENT[grade]) / 100)));
        const mortalityRaw = readNumber(`pflegeStufe${grade}Mortality`, NaN, doc);
        const mortalityFactor = Math.max(0, Number.isFinite(mortalityRaw) ? mortalityRaw : CARE_MORTALITY_DEFAULT_FACTORS[grade]);
        const careForm = normalizeCareForm(isOfficial ? null : readValue(`pflegeStufe${grade}Form`, defaultCareForm(grade), doc), grade);
        pflegeGradeConfigs[grade] = { zusatz, flexCut, mortalityFactor, ...(careForm !== defaultCareForm(grade) ? { careForm } : {}) };
    });
    const grade1Config = pflegeGradeConfigs[1] || { zusatz: 0, flexCut: 1 };

    const rawPflegeMin = readInt('pflegeMinDauer', NaN, doc);
    const rawPflegeMax = readInt('pflegeMaxDauer', NaN, doc);
    const normalizedCareDuration = normalizeCareDurationRange(rawPflegeMin, rawPflegeMax, gender);
    const driftPctRaw = readNumber('pflegeKostenDrift', NaN, doc);
    const regionalRaw = readNumber('pflegeRegionalZuschlag', NaN, doc);

    return {
        ...careValuesInputPatch(careValues),
        pflegefallLogikAktivieren: readChecked('pflegefallLogikAktivieren', false, doc),
        pflegeModellTyp: readValue('pflegeModellTyp', '', doc),
        ...(readValue('pflegeKostenStaffelPreset', 'custom', doc) === 'amtlich' ? { pflegeKostenStaffelPreset: 'amtlich' } : {}),
        pflegeGradeConfigs,
        pflegeStufe1Zusatz: grade1Config.zusatz,
        pflegeStufe1FlexCut: grade1Config.flexCut,
        pflegeMaxFloor: price('sim_pflegeMaxFloor', readValue('pflegeMaxFloor', null, doc), prices.maximumFloor),
        pflegeRampUp: readInt('pflegeRampUp', 5, doc) || 5,
        pflegeMinDauer: normalizedCareDuration.minYears,
        pflegeMaxDauer: normalizedCareDuration.maxYears,
        // Gutachten PFA-2, Befund 6: Ein im Preisblock markierter Kostenanstieg ist bewusste Eingabe und wird nicht umgedeutet.
        pflegeKostenDrift: normalizeCareCostDriftPercent(prices.driftMarked ? (Number.isFinite(driftPctRaw) ? Math.max(0, driftPctRaw) : prices.driftPercent)
            : resolveCareSetting('sim_pflegeKostenDrift', Number.isFinite(driftPctRaw) ? driftPctRaw : null), DEFAULT_PFLEGE_DRIFT_PCT),
        pflegeRegionalZuschlag: Math.max(0, Number.isFinite(regionalRaw) ? regionalRaw : 0) / 100,
        // FR-72 Punkt 3: wie die Pflegewerte erst bei Abweichung von der Vorgabe übergeben.
        ...residentialOwnExpensesInputPatch(prices.stored ? numberOr(readValue('pflegeHeimEigeneAusgaben', null, doc), prices.ownExpensesMonthly)
            : readNumber('pflegeHeimEigeneAusgaben', NaN, doc))
    };
}

function numberOr(raw, fallback) {
    const text = raw == null ? '' : String(raw).trim();
    const value = Number(text.replace(',', '.'));
    return !text || !Number.isFinite(value) ? fallback : Math.max(0, value);
}
