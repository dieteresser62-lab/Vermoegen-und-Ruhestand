/**
 * Gemeinsames Endjahr der Bauskripte für die historischen Ketten. Es steht im Datenstand
 * (app/simulator/historical-datenstand.js); die Datenübernahme setzt es, die Bauskripte lesen es nur.
 */
import HISTORICAL_DATENSTAND from '../../app/simulator/historical-datenstand.js';

/**
 * Prüft und liefert das Endjahr eines Datenstands.
 * @param {{startYear?: unknown, endYear?: unknown}} [stand] Datenstand; ohne Angabe der eingebettete.
 * @returns {number} Letztes Jahr der historischen Reihen.
 */
export function historicalEndYear(stand = HISTORICAL_DATENSTAND) {
    const { startYear, endYear } = stand ?? {};
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear) {
        throw new Error(`Datenstand: Endjahr ${String(endYear)} ist kein ganzes Jahr ab ${String(startYear)}.`);
    }
    return /** @type {number} */ (endYear);
}

/** Letztes Jahr, das jede Kette liefern muss. */
export const HISTORICAL_END_YEAR = historicalEndYear();
