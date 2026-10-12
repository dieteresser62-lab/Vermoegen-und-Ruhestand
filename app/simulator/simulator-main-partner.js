"use strict";

import { setFieldState } from '../shared/field-state.js';

export function refreshPartnerPresentation() {
    const toggle = document.getElementById('chkPartnerAktiv');
    if (!toggle?.ownerDocument || !toggle.parentNode) return;
    const origin = toggle.dataset.profileFieldOrigin || '';
    const reason = toggle.checked ? 'Partner ist berücksichtigt.' : 'Partnerfelder nicht anwendbar: kein Partner aktiviert.';
    setFieldState(toggle, origin ? 'adopted' : 'editable', [origin, reason].filter(Boolean).join(' '));
}

export function initPartnerToggle() {
    const chkPartnerAktiv = document.getElementById('chkPartnerAktiv');
    const sectionRente2 = document.getElementById('sectionRente2');
    if (!chkPartnerAktiv || !sectionRente2) return;

    chkPartnerAktiv.addEventListener('change', () => {
        const aktiv = chkPartnerAktiv.checked;
        // Ausschließlich Partnersektion darstellen; kein zweiter Personenwrite.
        sectionRente2.style.display = aktiv ? 'block' : 'none';
        refreshPartnerPresentation();

    });
    refreshPartnerPresentation();
}
