/** @import {SimulatorControl} from '../../typcheck/simulator-ui.js' */
import { persistenceStorage } from '../shared/persistence-facade.js';
import { readCareValues } from '../shared/household-care-values.js';
import { PFLEGE_COST_PRESETS, PFLEGE_CUSTOM_COSTS_KEY, carePresetValues, normalizePflegeKostenPreset, rememberCareCostValues } from '../shared/care-price-fields.js';
"use strict";

import { SUPPORTED_PFLEGE_GRADES, PFLEGE_GRADE_LABELS } from './simulator-data.js';
import { readNumber } from './simulator-input-dom.js';
import { formatWholeEuro } from './results-formatting.js';
import { setFieldState } from '../shared/field-state.js';

// PFA-10: Vorgaben und gemerkte eigene Beträge teilt der Simulator mit Personen & Vermögen › Pflege.
export { PFLEGE_COST_PRESETS, PFLEGE_CUSTOM_COSTS_KEY, normalizePflegeKostenPreset };

function rememberCareCosts() {
    rememberCareCostValues(Object.fromEntries(SUPPORTED_PFLEGE_GRADES.map(grade =>
        [grade, String(/** @type {HTMLInputElement} */ (document.getElementById(`pflegeStufe${grade}Zusatz`))?.value ?? '')])));
}

function refreshPflegePresentation() {
    const toggle = /** @type {HTMLInputElement} */ (document.getElementById('pflegefallLogikAktivieren'));
    const model = /** @type {HTMLSelectElement} */ (document.getElementById('pflegeModellTyp'));
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
    const toggle = /** @type {HTMLInputElement} */ (document.getElementById('pflegefallLogikAktivieren'));
    const hasCareToday = document.getElementById('simCareTodaySummary')?.hidden === false;
    const panel = document.getElementById('pflegePanel');
    if (panel) panel.style.display = 'grid';
    const container = document.getElementById('pflegePanelContainer');
    container?.querySelectorAll?.('input:not([type="checkbox"]), select').forEach(/** @param {SimulatorControl} field */ field => {
        const applicable = toggle.checked || hasCareToday;
        field.disabled = !applicable;
        setFieldState(field, applicable ? 'editable' : 'inactive', applicable ? ''
            : 'Nicht anwendbar: Pflegelogik ist ausgeschaltet. Der bisherige Wert bleibt erhalten.');
    });
    refreshPflegePresentation();
    refreshCareForms();
}

/** FR-72 Punkt 6: Zeilen „im Heim“ rechnen mit den Heimkosten aus den Pflegewerten; ihr Betragsfeld ruht.
 *
 * @param {number} grade Pflegegrad der Zeile.
 * @returns {boolean} Ergebnis der Prüfung.
 */
export function careRowUsesResidentialCosts(grade) {
    const homeGrades = document.getElementById('simCareTodaySummary')?.dataset?.homeCareGrades?.split(',') || [];
    if (homeGrades.includes(String(grade))) return false;
    const official = /** @type {HTMLSelectElement} */ (document.getElementById('pflegeKostenStaffelPreset'))?.value === 'amtlich';
    return !official && /** @type {HTMLSelectElement} */ (document.getElementById(`pflegeStufe${grade}Form`))?.value === 'residential';
}

function refreshCareForms() {
    const official = /** @type {HTMLSelectElement} */ (document.getElementById('pflegeKostenStaffelPreset'))?.value === 'amtlich';
    document.querySelectorAll?.('[data-care-form]').forEach(/** @param {HTMLElement} cell */ cell => { cell.hidden = official; });
    const hint = document.getElementById('pflegeFormHint');
    if (hint) hint.hidden = official;
    const toggle = /** @type {HTMLInputElement} */ (document.getElementById('pflegefallLogikAktivieren'));
    const applicable = toggle?.checked !== false || document.getElementById('simCareTodaySummary')?.hidden === false;
    for (const grade of SUPPORTED_PFLEGE_GRADES) {
        const field = /** @type {HTMLInputElement} */ (document.getElementById(`pflegeStufe${grade}Zusatz`));
        if (!field?.ownerDocument || !field.parentNode || !applicable) continue;
        const residential = careRowUsesResidentialCosts(grade);
        field.disabled = residential;
        setFieldState(field, residential ? 'inactive' : 'editable', residential ? 'aus den Pflegewerten' : '');
    }
}

/**
 * Überträgt eine Kosten-Voreinstellung in die UI und triggert Updates.
 * @param {string} presetKey - Schlüssel der gewünschten Voreinstellung aus PFLEGE_COST_PRESETS.
 * @param {{asInput?: boolean}} [options] Ohne Eingabeereignisse nur anzeigen (Start: Lesen schreibt nie, PFA-12).
 * @returns {void}
 */
export function applyPflegeKostenPreset(presetKey, { asInput = true } = {}) {
    const preset = { values: carePresetValues(presetKey) };
    // Defensive exit: Ohne gültige Werte keine Änderungen durchführen.
    if (!preset || !preset.values) return;

    let didChange = false;
    SUPPORTED_PFLEGE_GRADES.forEach(grade => {
        const value = preset.values[grade];
        if (value == null) return;
        const field = /** @type {HTMLInputElement} */ (document.getElementById(`pflegeStufe${grade}Zusatz`));
        if (field) {
            field.value = /** @type {string} */ (value);
            if (asInput) field.dispatchEvent(new Event('input', { bubbles: true }));
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
    refreshCareForms();
    // Defensive Checks: Verhindere Fehler bei fehlenden DOM-Knoten.
    if (!selectEl || !hintEl) return;
    const preset = PFLEGE_COST_PRESETS[selectEl.value] || PFLEGE_COST_PRESETS.custom;
    const monthly = selectEl.value === 'amtlich' ? readCareValues(persistenceStorage).residential.monthly : 0;
    hintEl.textContent = selectEl.value === 'amtlich' ? `${preset.description} Erstes Heimjahr aus den Pflegewerten: ${monthly.toLocaleString('de-DE')} €/Monat.` : preset.description;
}

/**
 * Berechnet kontextuelle Hinweise zu Pflegekosten und aktualisiert das UI-Badge.
 * Nutzt aktuelle Formulareingaben (inkl. Regionalzuschlag) für die Darstellung.
 * @returns {void}
 */
export function updatePflegeUIInfo() {
    const pflegeMaxFloorInput = /** @type {HTMLInputElement} */ (document.getElementById('pflegeMaxFloor'));
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
    const regionalMultiplier = 1 + (Math.max(0, parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('pflegeRegionalZuschlag'))?.value) || 0) / 100);

    // Höchster Zusatz zu Hause inkl. Zuschlag; Zeilen „im Heim“ rechnen mit den Pflegewerten.
    const gradeNeeds = SUPPORTED_PFLEGE_GRADES.filter(grade => !careRowUsesResidentialCosts(grade)).map(grade => {
        const value = (parseFloat(/** @type {HTMLInputElement} */ (document.getElementById(`pflegeStufe${grade}Zusatz`))?.value) || 0) * regionalMultiplier;
        return { grade, value };
    });
    const maxEntry = gradeNeeds.reduce((best, entry) => entry.value > best.value ? entry : best, { grade: null, value: 0 });
    const gradeLabel = maxEntry.grade ? (PFLEGE_GRADE_LABELS[maxEntry.grade] || `Pflegegrad ${maxEntry.grade}`) : 'Pflegegrad n/a';

    if (infoBadge) {
        infoBadge.innerHTML = `Heutiger Deckel für den Zusatz zu Hause, je Person: <strong>${formatWholeEuro(capHeute)}</strong><br>` +
            `Höchster Zusatz zu Hause (inkl. Zuschlag): <strong>${formatWholeEuro(maxEntry.value)}</strong> (${gradeLabel})`;
    }
}

/**
 * Richtet alle Pflege-spezifischen UI-Listener ein und aktualisiert Initialzustände.
 * @returns {void}
 */
export function initializePflegeUIControls() {
    document.getElementById('simCareTodaySummary')?.addEventListener('care-today-change', refreshPflegeAvailability);
    const CARE_GRADE_FIELD_IDS = SUPPORTED_PFLEGE_GRADES.flatMap(grade => [
        `pflegeStufe${grade}Zusatz`,
        `pflegeStufe${grade}FlexCut`,
        `pflegeStufe${grade}Mortality`,
        `pflegeStufe${grade}Form`
    ]);

    // Aktualisiere Pflege-Badge bei jeder relevanten Eingabeänderung.
    const pflegeInfoFields = ['startFloorBedarf', 'pflegeMaxFloor', 'pflegeRegionalZuschlag', ...CARE_GRADE_FIELD_IDS];
    pflegeInfoFields.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('input', updatePflegeUIInfo);
    });

    // Kontext-Hinweis für Cap-Feld (maximaler Floor inkl. Pflegekosten).
    const pflegeMaxFloorInput = /** @type {HTMLInputElement} */ (document.getElementById('pflegeMaxFloor'));
    if (pflegeMaxFloorInput) {
        pflegeMaxFloorInput.title = 'Gilt nur für Pflege zu Hause und je Person: Grundbedarf plus Zusatz zu Hause höchstens bis zu diesem Wert. Heimkosten und eigene Ausgaben im Heim sind nicht gedeckelt.';
    }
    updatePflegeUIInfo();

    const pflegeStaffelSelect = /** @type {HTMLSelectElement} */ (document.getElementById('pflegeKostenStaffelPreset'));
    const pflegePresetHint = document.getElementById('pflegeStaffelPresetHint');
    if (pflegeStaffelSelect) {
        let previousPreset = pflegeStaffelSelect.value;
        pflegeStaffelSelect.addEventListener('change', (event) => {
            if (previousPreset === 'custom' && /** @type {HTMLSelectElement} */ (event.target).value !== 'custom') rememberCareCosts();
            previousPreset = /** @type {HTMLSelectElement} */ (event.target).value;
            updatePflegePresetHint(pflegeStaffelSelect, pflegePresetHint);
            applyPflegeKostenPreset(/** @type {HTMLSelectElement} */ (event.target).value);
        });
        updatePflegePresetHint(pflegeStaffelSelect, pflegePresetHint);
        if (pflegeStaffelSelect.value === 'amtlich') applyPflegeKostenPreset('amtlich', { asInput: false });
    }
    SUPPORTED_PFLEGE_GRADES.forEach(grade => document.getElementById(`pflegeStufe${grade}Form`)?.addEventListener('change', () => {
        refreshCareForms();
        updatePflegeUIInfo();
    }));
    refreshCareForms();

    const pflegeCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('pflegefallLogikAktivieren'));
    if (pflegeCheckbox) {
        pflegeCheckbox.addEventListener('change', () => {
            refreshPflegeAvailability();
        });
    }

    const pflegeModellSelect = /** @type {HTMLSelectElement} */ (document.getElementById('pflegeModellTyp'));
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
