"use strict";

import { setFieldState } from '../shared/field-state.js';

// Nur Darstellung; Modusentscheidung und nachfolgende Profilsperre bleiben getrennt.
/**
 * @returns {void}
 */
export function refreshRentAdjustmentPresentation() {
    const modeField = /** @type {HTMLSelectElement} */ (document.getElementById('rentAdjMode'));
    const pctField = /** @type {HTMLInputElement} */ (document.getElementById('rentAdjPct'));
    if (!modeField || !pctField) return;
    const mode = modeField.value || 'fix';
    const origin = pctField.dataset?.profileFieldOrigin || '';
    const modeReason = mode === 'fix' ? 'Gemeinsame Rentenanpassung für beide Personen.'
        : `Prozentfeld nicht anwendbar: Anpassung wird aus ${mode === 'wage' ? 'Lohnentwicklung' : 'Inflation'} abgeleitet.`;
    // Die Auswahl bleibt sichtbar, auch wenn die Prozentgruppe verborgen ist.
    if (modeField.ownerDocument && modeField.parentNode) {
        setFieldState(modeField, origin ? 'adopted' : 'editable', [origin, modeReason].filter(Boolean).join(' '));
    }
    if (pctField.ownerDocument && pctField.parentNode) {
        setFieldState(pctField, origin ? 'adopted' : mode === 'fix' ? 'editable' : 'inactive',
            [origin, modeReason].filter(Boolean).join(' '));
    }
}

/**
 * @returns {void}
 */
export function initRentAdjModeUI() {
    const rentAdjModeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('rentAdjMode'));
    const rentAdjPctInput = /** @type {HTMLInputElement} */ (document.getElementById('rentAdjPct'));
    if (!rentAdjModeSelect || !rentAdjPctInput) return;

    const rentAdjPctGroup = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (rentAdjPctInput.closest('.ds-field')));

    rentAdjModeSelect.addEventListener('change', () => {
        const mode = rentAdjModeSelect.value;
        if (mode === 'fix') {
            rentAdjPctInput.disabled = Boolean(rentAdjPctInput.dataset.profileFieldOrigin);
            rentAdjPctInput.title = 'Gemeinsame Rentenanpassung für beide Personen';
            if (rentAdjPctGroup) rentAdjPctGroup.style.display = 'flex';
        } else {
            // For wage/CPI coupling, the percent is derived from data.
            rentAdjPctInput.disabled = true;
            rentAdjPctInput.title = 'Wird automatisch über Koppelung gesteuert (' + (mode === 'wage' ? 'Lohnentwicklung' : 'Inflation') + ')';
            if (rentAdjPctGroup) rentAdjPctGroup.style.display = 'none';
        }
        refreshRentAdjustmentPresentation();
    });
    // Initial state
    const initialMode = rentAdjModeSelect.value || 'fix';
    rentAdjPctInput.disabled = initialMode !== 'fix' || Boolean(rentAdjPctInput.dataset.profileFieldOrigin);
    if (initialMode !== 'fix') {
        rentAdjPctInput.title = 'Wird automatisch über Koppelung gesteuert (' + (initialMode === 'wage' ? 'Lohnentwicklung' : 'Inflation') + ')';
        if (rentAdjPctGroup) rentAdjPctGroup.style.display = 'none';
    } else {
        rentAdjPctInput.title = 'Gemeinsame Rentenanpassung für beide Personen';
        if (rentAdjPctGroup) rentAdjPctGroup.style.display = 'flex';
    }
    refreshRentAdjustmentPresentation();
}
