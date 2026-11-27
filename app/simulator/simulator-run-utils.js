"use strict";

/**
 * ============================================================================
 * Gemeinsame Helfer für Simulationsläufe (Monte Carlo, Vergleich, Parität)
 * ============================================================================
 *
 * Schnelles strukturiertes Cloning für Stress-Context.
 * @param {object|null|undefined} ctx - Ursprünglicher Stress-Context.
 * @returns {object|null} Flache Kopie für sicheren Gebrauch innerhalb eines Laufs.
 */
export function cloneStressContext(ctx) {
    if (!ctx) return null;
    return {
        type: ctx.type,
        remainingYears: ctx.remainingYears,
        pickableIndices: ctx.pickableIndices, // Read-only Array, Shallow Copy OK
        preset: ctx.preset // Read-only Object, Shallow Copy OK
    };
}

/**
 * Normalisiert die Konfiguration der Hinterbliebenenrente.
 * @param {object|undefined} rawOptions - Ursprüngliche Eingaben aus dem UI.
 * @returns {{mode:string,percent:number,marriageOffsetYears:number,minMarriageYears:number}} Normalisierte Optionen.
 */
export function normalizeWidowOptions(rawOptions) {
    const defaults = {
        mode: 'stop',
        percent: 0,
        marriageOffsetYears: 0,
        minMarriageYears: 0
    };
    if (!rawOptions) return defaults;
    return {
        mode: rawOptions.mode === 'percent' ? 'percent' : 'stop',
        percent: Math.max(0, Math.min(1, Number(rawOptions.percent) || 0)),
        marriageOffsetYears: Math.max(0, Math.floor(Number(rawOptions.marriageOffsetYears) || 0)),
        minMarriageYears: Math.max(0, Math.floor(Number(rawOptions.minMarriageYears) || 0))
    };
}

/**
 * Ermittelt die Anzahl der Ehejahre, die bis zum aktuellen Simulationsjahr vergangen sind.
 * @param {number} yearIndex - Laufender Jahresindex der Simulation (0-basiert).
 * @param {{marriageOffsetYears:number}} widowOptions - Normalisierte Witwen-Konfiguration.
 * @returns {number} Anzahl der absolvierten Ehejahre (0, falls noch nicht verheiratet).
 */
export function computeMarriageYearsCompleted(yearIndex, widowOptions) {
    if (!widowOptions) return 0;
    if (yearIndex < widowOptions.marriageOffsetYears) return 0;
    return (yearIndex - widowOptions.marriageOffsetYears) + 1;
}
