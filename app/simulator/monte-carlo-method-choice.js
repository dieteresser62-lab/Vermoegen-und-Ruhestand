// @ts-check
/** MS-1: Vorgabe der Simulationsmethode ist Stationary Bootstrap mit Blocklänge 5.
 * Bis MS-1 gab es kein Merkmal für eine ausdrückliche Wahl. Nur ein gespeichertes `regime_markov` ohne
 * `sim_mcMethodeQuelle = nutzer` gilt deshalb als alte Vorgabe (MS-1b); andere Werte entstanden nur durch eine
 * Formularänderung und bleiben. Beim Lesen wird nichts geschrieben.
 */

/** Merkmal „Methode im Formular gewählt“. Ein `sim_`-Schlüssel, daher wandert es mit Sicherung und Profilwechsel. */
export const MONTE_CARLO_METHOD_SOURCE_KEY = 'sim_mcMethodeQuelle';
export const MONTE_CARLO_METHOD_SOURCE_USER = 'nutzer';

/** Alte Vorgabe vor MS-1. */
export const MONTE_CARLO_LEGACY_DEFAULT_METHOD = 'regime_markov';

/** Gespeicherte Methode für das Feld; `regime_markov` ohne Merkmal `nutzer` ergibt die Vorgabe der Seite (Rückgabe null).
 * @param {unknown} storedValue @param {unknown} source @returns {unknown} */
export function readStoredMonteCarloMethod(storedValue, source) {
    return source !== MONTE_CARLO_METHOD_SOURCE_USER && storedValue === MONTE_CARLO_LEGACY_DEFAULT_METHOD ? null : storedValue;
}

/** Beim Speichern einer Methode aus dem Formular: Merkmal setzen. @param {{setItem(key: string, value: string): void}} storage */
export function writeMonteCarloMethodSource(storage) {
    storage.setItem(MONTE_CARLO_METHOD_SOURCE_KEY, MONTE_CARLO_METHOD_SOURCE_USER);
}
