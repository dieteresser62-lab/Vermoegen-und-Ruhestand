import { createStressReplayController } from './controller.js';

let activeController = null;

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function initStressReplayUI(options = {}) {
    activeController ||= createStressReplayController(options);
    activeController.initialize();
    return activeController;
}

/**
 * @param context - Kontext der Auswertung.
 * @returns {void}
 */
export function publishStressReplayMonteCarloContext(context) {
    activeController?.setMonteCarloContext(context);
}

/**
 * @param scenario - Ausgewählter Pfad.
 * @returns {void}
 */
export function selectStressReplayScenario(scenario) {
    activeController?.selectScenario(scenario);
}
