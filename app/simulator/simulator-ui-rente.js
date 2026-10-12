import { SIMULATOR_PERSON_FIELD_IDS } from './simulator-person-overrides.js';
"use strict";
/** Die Personenauswahl projiziert zentrale Werte; dieser Initialisierer schreibt keine Altkeys. */
export function initRente2ConfigWithLocalStorage() {
    const fields = SIMULATOR_PERSON_FIELD_IDS;
    for (const id of fields) {
        const element = document.getElementById(id);
        if (element) { element.dataset.noPersist = 'true'; element.disabled = true; }
    }
}
