// @ts-check
/** FR-75: Simulationsdauer automatisch bis Alter 110 der jüngsten Person.
 * Ein leeres Feld „Maximale Dauer“ bedeutet automatisch; ein eigener Wert bleibt überschreibbar.
 * Ein gespeicherter Wert 35 (alte Vorgabe) gilt beim Lesen als automatisch, ohne Schreiben.
 */
import { MONTE_CARLO_PARAMETER_LIMITS, resolveMonteCarloDefaultDurationV1 } from './monte-carlo-parameters.js';

/** Gespeicherter Rohwert für das Feld; die alte Vorgabe 35 wird zu „automatisch“ (leer).
 * @param {unknown} storedValue @returns {unknown} */
export function readStoredMonteCarloDuration(storedValue) {
    return String(storedValue ?? '').trim() === String(MONTE_CARLO_PARAMETER_LIMITS.durationYears.legacyStoredDefault)
        ? '' : storedValue;
}

/** Wirksamer Wert des Felds: eigener Wert oder die zuletzt angezeigte automatische Dauer.
 * @param {{value?:string;dataset?:Record<string, string|undefined>}|null|undefined} element @returns {string} */
export function effectiveMonteCarloDurationValue(element) {
    const own = String(element?.value ?? '').trim();
    return own || String(element?.dataset?.autoDuration ?? '');
}

/** Zeigt die automatische Dauer am Feld (Platzhalter und Hinweis); nur Anzeige, kein Speichern.
 * @param {Document|null|undefined} documentRef @param {import('../../typcheck/rechenkern').MonteCarloAgeInput|null} inputs */
export function syncMonteCarloDurationDefault(documentRef, inputs) {
    const element = /** @type {HTMLInputElement|null} */ (documentRef?.getElementById?.('mcDauer') ?? null);
    if (!element) return null;
    let years;
    try { years = resolveMonteCarloDefaultDurationV1(inputs); } catch { return null; }
    element.placeholder = String(years);
    if (element.dataset) element.dataset.autoDuration = String(years);
    const hint = documentRef?.getElementById?.('mcDauerAuto');
    if (hint) {
        const age = MONTE_CARLO_PARAMETER_LIMITS.durationYears.mortalityTableMaximumAge;
        hint.textContent = String(element.value ?? '').trim() === ''
            ? `automatisch: bis Alter ${age} der jüngsten Person · ${years} Jahre`
            : `eigener Wert · automatisch wären ${years} Jahre (Feld leeren)`;
    }
    const summary = documentRef?.getElementById?.('mcSetupSummaryDuration');
    if (summary) summary.textContent = effectiveMonteCarloDurationValue(element) || '—';
    return years;
}
