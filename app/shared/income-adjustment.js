/**
 * Berechnet die effektive Rentenanpassungsrate basierend auf Modus und Jahresdaten
 * @param {object} inputs - Input-Objekt mit rentAdjMode und rentAdjPct
 * @param {object} yearData - Jahresdaten mit inflation und lohn
 * @returns {number} Anpassungsrate in Prozent (z.B. 2.0 für 2%)
 */
export function computeRentAdjRate(inputs, yearData) {
    if (!inputs.rentAdjMode || inputs.rentAdjMode === 'fix') {
        return inputs.rentAdjPct || 0;
    }

    if (inputs.rentAdjMode === 'wage') {
        // Lohnentwicklung aus historischen Daten
        return Math.max(0, yearData.lohn || 0);
    }

    if (inputs.rentAdjMode === 'cpi') {
        // Inflation (CPI)
        return Math.max(0, yearData.inflation || 0);
    }

    // Fallback
    return inputs.rentAdjPct || 0;
}
