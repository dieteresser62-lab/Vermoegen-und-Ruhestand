/** @import {SimulatorControl} from '../../typcheck/simulator-ui.js' */
import { SIMULATOR_PERSON_FIELD_IDS } from './simulator-person-overrides.js';
"use strict";
/** Die Personenauswahl projiziert zentrale Werte; dieser Initialisierer schreibt keine Altkeys.
 *
 * @returns {void}
 */
export function initRente2ConfigWithLocalStorage() {
    const fields = SIMULATOR_PERSON_FIELD_IDS;
    for (const id of fields) {
        const element = /** @type {SimulatorControl} */ (document.getElementById(id));
        if (element) { element.dataset.noPersist = 'true'; element.disabled = true; }
    }
}
