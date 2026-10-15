/** Gemeinsame Sterbetafelrechnung für Balance und Simulator. */
import { MORTALITY_TABLE } from '../simulator/german-demography-care-survivor-contract.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Schätzt die verbleibende Lebenserwartung anhand der Sterbetafel.
 */
export function estimateRemainingLifeYears(gender, currentAge) {
    const table = MORTALITY_TABLE[gender] || MORTALITY_TABLE.m;
    const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
    const minAge = ages[0] ?? currentAge;
    const maxAge = ages[ages.length - 1] ?? currentAge;
    let survivalProbability = 1;
    let expectedYears = 0;

    // Erwartungswert über die Überlebenswahrscheinlichkeiten der Sterbetafel.
    for (let age = Math.max(currentAge, minAge); age <= maxAge; age++) {
        const qxRaw = table[age] ?? 1;
        const qx = Math.min(1, Math.max(0, qxRaw));
        expectedYears += survivalProbability;
        survivalProbability *= (1 - qx);
        if (survivalProbability < 0.0001) break;
    }

    return Math.max(1, Math.round(expectedYears));
}

/**
 * Joint Life: Erwartete Restjahre bis der letzte von beiden stirbt.
 * Der Erwartungswert wird ueber die Wahrscheinlichkeit berechnet,
 * dass mindestens eine Person im jeweiligen Jahr noch lebt.
 * Hinweis zur Reihenfolge: Fuer den Erwartungswert wird die aktuelle
 * Ueberlebenswahrscheinlichkeit aufsummiert und danach in den naechsten
 * Jahresschritt fortgeschrieben.
 */
export function estimateJointRemainingLifeYears(gender1, age1, gender2, age2) {
    const table1 = MORTALITY_TABLE[gender1] || MORTALITY_TABLE.m;
    const table2 = MORTALITY_TABLE[gender2] || MORTALITY_TABLE.m;
    let survP1 = 1;
    let survP2 = 1;
    let expectedYears = 0;

    for (let t = 0; t < 60; t++) {
        const qx1 = Math.min(1, Math.max(0, table1[age1 + t] ?? 1));
        const qx2 = Math.min(1, Math.max(0, table2[age2 + t] ?? 1));
        const jointSurvival = 1 - ((1 - survP1) * (1 - survP2));
        expectedYears += jointSurvival;
        survP1 *= (1 - qx1);
        survP2 *= (1 - qx2);
        if (jointSurvival < 0.0001) break;
    }

    return Math.max(1, Math.round(expectedYears));
}

/**
 * Restlaufzeit auf einem Langlebigkeits-Quantil fuer eine Einzelperson.
 * Liefert den ersten Jahresschritt, in dem die Ueberlebenswahrscheinlichkeit
 * auf oder unter das Zielniveau faellt.
 */
export function estimateSingleRemainingLifeYearsAtQuantile(gender, currentAge, quantile, options = {}) {
    const minYears = Number.isFinite(options?.minYears) ? options.minYears : 1;
    const maxYears = Number.isFinite(options?.maxYears) ? options.maxYears : 60;
    const table = MORTALITY_TABLE[gender] || MORTALITY_TABLE.m;
    const q = clamp(Number(quantile) || 0.85, 0.5, 0.99);
    const targetSurvival = 1 - q;
    let survivalProbability = 1;

    for (let t = 0; t < maxYears; t++) {
        const qx = clamp(Number(table[currentAge + t] ?? 1), 0, 1);
        survivalProbability *= (1 - qx);
        if (survivalProbability <= targetSurvival) {
            return clamp(t + 1, minYears, maxYears);
        }
    }
    return maxYears;
}

/**
 * Restlaufzeit auf einem Langlebigkeits-Quantil fuer Joint-Life.
 * Hinweis zur Reihenfolge: Fuer die Quantil-Suche wird der Survival-Wert
 * "am Ende von Jahr t" verwendet (erst Fortschreibung, dann Schwellwerttest).
 */
export function estimateJointRemainingLifeYearsAtQuantile(gender1, age1, gender2, age2, quantile, options = {}) {
    const minYears = Number.isFinite(options?.minYears) ? options.minYears : 1;
    const maxYears = Number.isFinite(options?.maxYears) ? options.maxYears : 60;
    const table1 = MORTALITY_TABLE[gender1] || MORTALITY_TABLE.m;
    const table2 = MORTALITY_TABLE[gender2] || MORTALITY_TABLE.m;
    const q = clamp(Number(quantile) || 0.85, 0.5, 0.99);
    const targetSurvival = 1 - q;
    let survP1 = 1;
    let survP2 = 1;

    for (let t = 0; t < maxYears; t++) {
        const qx1 = clamp(Number(table1[age1 + t] ?? 1), 0, 1);
        const qx2 = clamp(Number(table2[age2 + t] ?? 1), 0, 1);
        survP1 *= (1 - qx1);
        survP2 *= (1 - qx2);
        const jointSurvival = 1 - ((1 - survP1) * (1 - survP2));
        if (jointSurvival <= targetSurvival) {
            return clamp(t + 1, minYears, maxYears);
        }
    }
    return maxYears;
}

