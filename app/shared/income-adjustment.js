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

/** Rentenanpassung des Haushalts: Im Haushalt gilt die des Hauptprofils (erste Person), für beide Renten.
 * Simulator (Profilkombination) und Balance (Folgejahreseinkünfte) lösen sie hierüber gleich auf.
 *
 * @param {{rentAdjMode?: string, rentAdjPct?: number}|null|undefined} primary Projektion oder Eingaben des Hauptprofils.
 * @param {{rentAdjMode?: string, rentAdjPct?: number}} [fallback] Werte, wenn das Hauptprofil keine nennt.
 * @returns {{rentAdjMode: string|undefined, rentAdjPct: number|undefined}} Wirksame Rentenanpassung des Haushalts.
 */
export function householdPensionAdjustment(primary, fallback = {}) {
    return { rentAdjMode: primary?.rentAdjMode || fallback.rentAdjMode,
        rentAdjPct: Number.isFinite(primary?.rentAdjPct) ? primary.rentAdjPct : fallback.rentAdjPct };
}
