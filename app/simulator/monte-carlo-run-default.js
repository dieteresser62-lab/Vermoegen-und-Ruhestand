// @ts-check
/** MC-3 (Nutzer 16.11.2026): Im Spielbereich mit Beispielhaushalt ist die Laufzahl mit 2.000 vorbelegt, sonst mit 10.000.
 * Das gilt nur für ein Feld ohne gespeicherte Eingabe; eine selbst eingegebene Zahl bleibt, auch eine 10.000. Nichts wird umgeschrieben.
 * Die Rechnung selbst und ihre Vorgabe für ein leeres Feld (`MONTE_CARLO_PARAMETER_LIMITS.runs.default`) bleiben unverändert. */
import { getProbelaufController } from '../shared/probelauf-state.js';
import { MONTE_CARLO_PARAMETER_LIMITS } from './monte-carlo-parameters.js';

export const EXAMPLE_HOUSEHOLD_MONTE_CARLO_RUNS = 2000;

/** @param {unknown} source Quelle des Spielbereichs: „demo“ (Beispielhaushalt), „copy“ (Kopie meiner Daten) oder keine.
 * @returns {number} */
export function monteCarloDefaultRuns(source) {
    return source === 'demo' ? EXAMPLE_HOUSEHOLD_MONTE_CARLO_RUNS : MONTE_CARLO_PARAMETER_LIMITS.runs.default;
}

/** Vorgabe der Seite aus dem bestätigten Spielbereich-Zustand des Dokuments.
 * @param {any} [doc] @param {(doc: any) => {blocked?: boolean, state?: {source?: string, phase?: string}|null}|null|undefined} [controllerOf]
 * @returns {number} */
export function documentMonteCarloDefaultRuns(doc = globalThis.document, controllerOf = getProbelaufController) {
    const controller = controllerOf(doc);
    return monteCarloDefaultRuns(!controller?.blocked && controller?.state?.phase === 'active' ? controller.state.source : undefined);
}
