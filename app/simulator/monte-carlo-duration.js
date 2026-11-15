// @ts-check
/** FR-75: Simulationsdauer automatisch bis Alter 110 der jüngsten Person.
 * Ein leeres Feld „Maximale Dauer“ bedeutet automatisch; ein eigener Wert bleibt überschreibbar.
 * Ein gespeicherter Wert 35 (alte Vorgabe) gilt beim Lesen als automatisch, ohne Schreiben.
 */
import { MONTE_CARLO_PARAMETER_LIMITS, resolveMonteCarloDefaultDurationV1 } from './monte-carlo-parameters.js';

/** GH-1 Punkt 11: Markierung „35 Jahre bewusst eingetragen“ (Muster wie der markierte Pflegekostenanstieg, FR-73 Punkt 8). Ein `sim_`-Schlüssel,
 * daher wandert sie mit Sicherung und Profilwechsel wie die übrigen Simulator-Einstellungen. */
export const MONTE_CARLO_DURATION_EXPLICIT_KEY = 'sim_mcDauerBewusst';

/** Gespeicherter Rohwert für das Feld; die alte Vorgabe 35 wird zu „automatisch“ (leer), außer sie ist als bewusst markiert.
 * @param {unknown} storedValue @param {boolean} [explicit] @returns {unknown} */
export function readStoredMonteCarloDuration(storedValue, explicit = false) {
    return !explicit && String(storedValue ?? '').trim() === String(MONTE_CARLO_PARAMETER_LIMITS.durationYears.legacyStoredDefault)
        ? '' : storedValue;
}

/** Markierung beim Speichern: nur eine eingetragene 35 ist bewusst; jeder andere Wert entfernt sie. @param {any} storage @param {unknown} value */
export function writeMonteCarloDurationMarker(storage, value) {
    if (String(value ?? '').trim() === String(MONTE_CARLO_PARAMETER_LIMITS.durationYears.legacyStoredDefault)) storage.setItem(MONTE_CARLO_DURATION_EXPLICIT_KEY, 'true');
    else storage.removeItem?.(MONTE_CARLO_DURATION_EXPLICIT_KEY);
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
