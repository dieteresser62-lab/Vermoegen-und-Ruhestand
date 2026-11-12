/** Gemeinsame Sterbetafelrechnung für Balance und Simulator.
 * FR-75: Mit Geburtsjahr gilt die Kohortentafel V2 dieses Jahrgangs, ohne Geburtsjahr die Periodentafel. */
import { resolveTargetMortalityTable } from '../simulator/target-mortality.js';
import { BMF_LIFETIME_USE_2026 } from './bmf-lifetime-use-2026.js';

/** FR-64, § 14 BewG: amtliche Tabelle 2026; fehlendes Geschlecht vorsichtig weiblich.
 *
 * @param age Wert für den bestehenden Aufrufvertrag.
 * @param gender Wert für den bestehenden Aufrufvertrag.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function lifetimeUseMultiplier(age, gender) {
    if (!Number.isFinite(age) || age < 0) throw new RangeError('Wohnrecht: Das Alter des Partners fehlt.');
    return BMF_LIFETIME_USE_2026[gender === 'm' ? 'm' : 'w'][Math.min(100, Math.floor(age))];
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Schätzt die verbleibende Lebenserwartung anhand der Sterbetafel.

 *
 * @param gender Wert für den bestehenden Aufrufvertrag.
 * @param currentAge Wert für den bestehenden Aufrufvertrag.
 * @param {number} [birthYear] Geburtsjahr für die Kohortentafel (FR-75).
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function estimateRemainingLifeYears(gender, currentAge, birthYear) {
    const table = resolveTargetMortalityTable(gender, birthYear);
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

 *
 * @param gender1 Wert für den bestehenden Aufrufvertrag.
 * @param age1 Wert für den bestehenden Aufrufvertrag.
 * @param gender2 Wert für den bestehenden Aufrufvertrag.
 * @param age2 Wert für den bestehenden Aufrufvertrag.
 * @param {number} [birthYear1] Geburtsjahr Person 1 (FR-75).
 * @param {number} [birthYear2] Geburtsjahr Person 2 (FR-75).
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function estimateJointRemainingLifeYears(gender1, age1, gender2, age2, birthYear1, birthYear2) {
    const table1 = resolveTargetMortalityTable(gender1, birthYear1);
    const table2 = resolveTargetMortalityTable(gender2, birthYear2);
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

 *
 * @param gender Wert für den bestehenden Aufrufvertrag.
 * @param currentAge Wert für den bestehenden Aufrufvertrag.
 * @param quantile Wert für den bestehenden Aufrufvertrag.
 * @param options Optionen des Aufrufers; `birthYear` wählt die Kohortentafel (FR-75).
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function estimateSingleRemainingLifeYearsAtQuantile(gender, currentAge, quantile, options = {}) {
    const minYears = Number.isFinite(options?.minYears) ? options.minYears : 1;
    const maxYears = Number.isFinite(options?.maxYears) ? options.maxYears : 60;
    const table = resolveTargetMortalityTable(gender, options?.birthYear);
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

 *
 * @param gender1 Wert für den bestehenden Aufrufvertrag.
 * @param age1 Wert für den bestehenden Aufrufvertrag.
 * @param gender2 Wert für den bestehenden Aufrufvertrag.
 * @param age2 Wert für den bestehenden Aufrufvertrag.
 * @param quantile Wert für den bestehenden Aufrufvertrag.
 * @param options Optionen des Aufrufers; `birthYear1`/`birthYear2` wählen die Kohortentafeln (FR-75).
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function estimateJointRemainingLifeYearsAtQuantile(gender1, age1, gender2, age2, quantile, options = {}) {
    const minYears = Number.isFinite(options?.minYears) ? options.minYears : 1;
    const maxYears = Number.isFinite(options?.maxYears) ? options.maxYears : 60;
    const table1 = resolveTargetMortalityTable(gender1, options?.birthYear1);
    const table2 = resolveTargetMortalityTable(gender2, options?.birthYear2);
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

