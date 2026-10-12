"use strict";

import { SUPPORTED_PFLEGE_GRADES, PFLEGE_GRADE_LABELS } from './simulator-data.js';
import { readNumber } from './simulator-input-dom.js';
import { formatCurrency } from './simulator-utils.js';
import { setFieldState } from '../shared/field-state.js';

function refreshPflegePresentation() {
    const toggle = document.getElementById('pflegefallLogikAktivieren');
    const model = document.getElementById('pflegeModellTyp');
    if (toggle?.ownerDocument && toggle.parentNode) {
        setFieldState(toggle, 'editable', toggle.checked ? '' : 'Pflegekonfiguration nicht anwendbar: Pflegelogik ist ausgeschaltet.');
    }
    if (model?.ownerDocument && model.parentNode) {
        setFieldState(model, toggle?.checked === false ? 'inactive' : 'editable', toggle?.checked === false
            ? 'Nicht anwendbar: Pflegelogik ist ausgeschaltet. Der bisherige Wert bleibt erhalten.'
            : model.value === 'akut' ? '' : 'Begrenzte Pflegedauer nicht anwendbar: chronisches Modell bis Lebensende.');
    }
}

// Sperrt ausschließlich die Bedienung; Kosten, Dauer und Reserve bleiben erhalten.
function refreshPflegeAvailability() {
    const toggle = document.getElementById('pflegefallLogikAktivieren');
    const panel = document.getElementById('pflegePanel');
    if (panel) panel.style.display = 'grid';
    const container = document.getElementById('pflegePanelContainer');
    container?.querySelectorAll?.('input:not([type="checkbox"]), select').forEach(field => {
        field.disabled = !toggle.checked;
        setFieldState(field, toggle.checked ? 'editable' : 'inactive', toggle.checked ? ''
            : 'Nicht anwendbar: Pflegelogik ist ausgeschaltet. Der bisherige Wert bleibt erhalten.');
    });
    refreshPflegePresentation();
}

/**
 * Vordefinierte Kosten-Staffeln für Pflegegrade.
 * Jede Voreinstellung enthält eine Benutzerbeschreibung und optionale Werte pro Pflegegrad.
 */
export const PFLEGE_COST_PRESETS = Object.freeze({
    custom: {
        label: 'Individuelle Werte',
        description: 'Keine Automatik – du behältst deine individuellen Staffelungen.'
    },
    ambulant: {
        label: 'Ambulant (ab 36 Tsd. €)',
        description: 'Ambulante Leistungen inkl. Haushaltshilfen (PG1 36k → PG5 78k).',
        values: { 1: 36000, 2: 42000, 3: 54000, 4: 66000, 5: 78000 }
    },
    stationaer: {
        label: 'Stationär (Premium)',
        description: 'Pflegeheim mit Unterbringung (PG1 45k → PG5 105k).',
        values: { 1: 45000, 2: 60000, 3: 75000, 4: 90000, 5: 105000 }
    }
});

/**
 * Überträgt eine Kosten-Voreinstellung in die UI und triggert Updates.
 * @param {string} presetKey - Schlüssel der gewünschten Voreinstellung aus PFLEGE_COST_PRESETS.
 * @returns {void}
 */
export function applyPflegeKostenPreset(presetKey) {
    const preset = PFLEGE_COST_PRESETS[presetKey];
    // Defensive exit: Ohne gültige Werte keine Änderungen durchführen.
    if (!preset || !preset.values) return;

    let didChange = false;
    SUPPORTED_PFLEGE_GRADES.forEach(grade => {
        const value = preset.values[grade];
        if (typeof value !== 'number') return; // Überspringe unvollständige Staffeln.
        const field = document.getElementById(`pflegeStufe${grade}Zusatz`);
        if (field) {
            field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            didChange = true;
        }
    });

    if (didChange) {
        updatePflegeUIInfo();
    }
}

/**
 * Aktualisiert den Beschreibungshinweis unterhalb der Preset-Auswahl.
 * @param {HTMLSelectElement} selectEl - Die Select-Box für die Preset-Auswahl.
 * @param {HTMLElement} hintEl - Das Ausgabeelement für den Beschreibungstext.
 * @returns {void}
 */
export function updatePflegePresetHint(selectEl, hintEl) {
    // Defensive Checks: Verhindere Fehler bei fehlenden DOM-Knoten.
    if (!selectEl || !hintEl) return;
    const preset = PFLEGE_COST_PRESETS[selectEl.value] || PFLEGE_COST_PRESETS.custom;
    hintEl.textContent = preset.description;
}

/**
 * Berechnet kontextuelle Hinweise zu Pflegekosten und aktualisiert das UI-Badge.
 * Nutzt aktuelle Formulareingaben (inkl. Regionalzuschlag) für die Darstellung.
 * @returns {void}
 */
export function updatePflegeUIInfo() {
    const pflegeMaxFloorInput = document.getElementById('pflegeMaxFloor');
    if (!pflegeMaxFloorInput) return;

    // Stelle sicher, dass das Info-Badge existiert und optisch eingebettet ist.
    let infoBadge = document.getElementById('pflegeInfoBadge');
    const infoHost = document.getElementById('pflegePanel') || pflegeMaxFloorInput.parentElement?.parentElement;
    if (!infoBadge && infoHost) {
        infoBadge = document.createElement('div');
        infoBadge.id = 'pflegeInfoBadge';
        infoBadge.style.fontSize = 'var(--balance-help)';
        infoBadge.style.color = 'var(--text-muted)';
        infoBadge.style.textAlign = 'center';
        infoBadge.style.marginTop = '10px';
        infoBadge.style.padding = '5px';
        infoBadge.style.background = 'var(--surface-sunken)';
        infoBadge.className = 'ds-note';
        infoBadge.style.borderRadius = '4px';
        infoHost.appendChild(infoBadge);
    }

    const startFloor = readNumber('startFloorBedarf', 0);
    const maxFloor = parseFloat(pflegeMaxFloorInput.value) || 0;
    const capHeute = Math.max(0, maxFloor - startFloor);
    const regionalMultiplier = 1 + (Math.max(0, parseFloat(document.getElementById('pflegeRegionalZuschlag')?.value) || 0) / 100);

    // Ermittle den höchsten Bedarf inkl. Zuschlag über alle Pflegegrade hinweg.
    const gradeNeeds = SUPPORTED_PFLEGE_GRADES.map(grade => {
        const value = (parseFloat(document.getElementById(`pflegeStufe${grade}Zusatz`)?.value) || 0) * regionalMultiplier;
        return { grade, value };
    });
    const maxEntry = gradeNeeds.reduce((best, entry) => entry.value > best.value ? entry : best, { grade: null, value: 0 });
    const gradeLabel = maxEntry.grade ? (PFLEGE_GRADE_LABELS[maxEntry.grade] || `Pflegegrad ${maxEntry.grade}`) : 'Pflegegrad n/a';

    if (infoBadge) {
        infoBadge.innerHTML = `Heutiger Cap für Zusatzkosten: <strong>${formatCurrency(capHeute)}</strong><br>` +
            `Höchster Bedarf (inkl. Zuschlag): <strong>${formatCurrency(maxEntry.value)}</strong> (${gradeLabel})`;
    }
}

/**
 * Richtet alle Pflege-spezifischen UI-Listener ein und aktualisiert Initialzustände.
 * @returns {void}
 */
export function initializePflegeUIControls() {
    const CARE_GRADE_FIELD_IDS = SUPPORTED_PFLEGE_GRADES.flatMap(grade => [
        `pflegeStufe${grade}Zusatz`,
        `pflegeStufe${grade}FlexCut`,
        `pflegeStufe${grade}Mortality`
    ]);

    // Aktualisiere Pflege-Badge bei jeder relevanten Eingabeänderung.
    const pflegeInfoFields = ['startFloorBedarf', 'pflegeMaxFloor', 'pflegeRegionalZuschlag', ...CARE_GRADE_FIELD_IDS];
    pflegeInfoFields.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('input', updatePflegeUIInfo);
    });

    // Kontext-Hinweis für Cap-Feld (maximaler Floor inkl. Pflegekosten).
    const pflegeMaxFloorInput = document.getElementById('pflegeMaxFloor');
    if (pflegeMaxFloorInput) {
        pflegeMaxFloorInput.title = 'Gesamt-Floor inkl. Pflege. Der maximal mögliche Zusatzbedarf ergibt sich aus diesem Wert abzüglich des Basis-Floor-Bedarfs zum Zeitpunkt des Pflegeeintritts.';
    }
    updatePflegeUIInfo();

    const pflegeStaffelSelect = document.getElementById('pflegeKostenStaffelPreset');
    const pflegePresetHint = document.getElementById('pflegeStaffelPresetHint');
    if (pflegeStaffelSelect) {
        pflegeStaffelSelect.addEventListener('change', (event) => {
            // Presets overwrite per-grade inputs unless "custom" is selected.
            updatePflegePresetHint(pflegeStaffelSelect, pflegePresetHint);
            if (event.target.value !== 'custom') {
                applyPflegeKostenPreset(event.target.value);
            }
        });
        updatePflegePresetHint(pflegeStaffelSelect, pflegePresetHint);
    }

    const pflegeCheckbox = document.getElementById('pflegefallLogikAktivieren');
    if (pflegeCheckbox) {
        pflegeCheckbox.addEventListener('change', () => {
            refreshPflegeAvailability();
        });
    }

    const pflegeModellSelect = document.getElementById('pflegeModellTyp');
    if (pflegeModellSelect) {
        pflegeModellSelect.addEventListener('change', () => {
            const dauerContainer = document.getElementById('pflegeDauerContainer');
            if (dauerContainer) {
                dauerContainer.style.display = pflegeModellSelect.value === 'akut' ? 'contents' : 'none';
            }
            refreshPflegePresentation();
        });
    }

    // Initiale UI-Synchronisierung mit aktuellen Formulareingaben.
    const pflegePanel = document.getElementById('pflegePanel');
    if (pflegePanel && pflegeCheckbox) refreshPflegeAvailability();
    const dauerContainer = document.getElementById('pflegeDauerContainer');
    if (dauerContainer && pflegeModellSelect) {
        dauerContainer.style.display = pflegeModellSelect.value === 'akut' ? 'contents' : 'none';
    }
    refreshPflegePresentation();
}
