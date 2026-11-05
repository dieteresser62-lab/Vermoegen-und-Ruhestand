/** @import {SimulatorControl} from '../../typcheck/simulator-ui.js' */
import { persistenceStorage } from '../shared/persistence-facade.js';
import { readCareValues, officialCareCosts } from '../shared/household-care-values.js';
"use strict";

import { SUPPORTED_PFLEGE_GRADES, PFLEGE_GRADE_LABELS } from './simulator-data.js';
import { readNumber } from './simulator-input-dom.js';
import { formatWholeEuro } from './results-formatting.js';
import { setFieldState } from '../shared/field-state.js';
import { careSettingsStorage } from '../shared/care-profile-settings.js';

export const PFLEGE_CUSTOM_COSTS_KEY = 'sim_pflegeCustomCosts';

function rememberedCareCosts() {
    try {
        const values = JSON.parse(careSettingsStorage(persistenceStorage).getItem(PFLEGE_CUSTOM_COSTS_KEY));
        return SUPPORTED_PFLEGE_GRADES.every(grade => typeof values?.[grade] === 'string' && values[grade].trim() !== ''
            && Number.isFinite(Number(values[grade])) && Number(values[grade]) >= 0) ? values : null;
    } catch { return null; }
}

function rememberCareCosts() {
    const values = Object.fromEntries(SUPPORTED_PFLEGE_GRADES.map(grade =>
        [grade, String(/** @type {HTMLInputElement} */ (document.getElementById(`pflegeStufe${grade}Zusatz`))?.value ?? '')]));
    careSettingsStorage(persistenceStorage).setItem(PFLEGE_CUSTOM_COSTS_KEY, JSON.stringify(values));
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

function refreshCareForms() {
    const official = /** @type {HTMLSelectElement} */ (document.getElementById('pflegeKostenStaffelPreset'))?.value === 'amtlich';
    document.querySelectorAll?.('[data-care-form]').forEach(/** @param {HTMLElement} cell */ cell => { cell.hidden = official; });
    const hint = document.getElementById('pflegeFormHint');
    if (hint) hint.hidden = official;
}

/**
 * Vordefinierte Kosten-Staffeln für Pflegegrade.
 * Jede Voreinstellung enthält eine Benutzerbeschreibung und optionale Werte pro Pflegegrad.
 */
export const PFLEGE_COST_PRESETS = Object.freeze({
    custom: {
        label: 'Individuelle Werte',
        description: 'Deine fünf eigenen Beträge werden beim Wechsel zu einer Voreinstellung gemerkt und hier wiederhergestellt, auch nach einem Neustart. Sicherung und Wiederherstellung nehmen sie mit.'
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
    },
    amtlich: {
        label: 'Amtlicher Durchschnitt (Destatis/vdek)',
        description: 'Mittel aller Pflegebedürftigen: Heimanteil je Grad (Destatis 2023) × Heim-Eigenanteil (vdek 7/2026). Pflege zu Hause ohne Zuzahlung angenommen. Ein Heimplatz allein: rund 40.400 € im Jahr. Pflegegeld ist hier schon verrechnet.',
        // Destatis 22421-01, I34:I38 / C34:C38 × (3.364 € × 12), auf 100 € gerundet.
        values: { 1: 200, 2: 2300, 3: 7100, 4: 15000, 5: 18900 }
    }
});

/**
 * Überträgt eine Kosten-Voreinstellung in die UI und triggert Updates.
 * @param {string} presetKey - Schlüssel der gewünschten Voreinstellung aus PFLEGE_COST_PRESETS.
 * @returns {void}
 */
export function applyPflegeKostenPreset(presetKey) {
    const preset = presetKey === 'custom' ? { values: rememberedCareCosts() }
        : presetKey === 'amtlich' ? { ...PFLEGE_COST_PRESETS.amtlich, values: officialCareCosts(readCareValues(persistenceStorage)) } : PFLEGE_COST_PRESETS[presetKey];
    // Defensive exit: Ohne gültige Werte keine Änderungen durchführen.
    if (!preset || !preset.values) return;

    let didChange = false;
    SUPPORTED_PFLEGE_GRADES.forEach(grade => {
        const value = preset.values[grade];
        if (value == null) return;
        const field = /** @type {HTMLInputElement} */ (document.getElementById(`pflegeStufe${grade}Zusatz`));
        if (field) {
            field.value = /** @type {string} */ (value);
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
    hintEl.textContent = selectEl.value === 'amtlich' ? `Mittel aller Pflegebedürftigen: Heimanteil je Grad (Destatis 2023) × gespeicherter Heim-Eigenanteil (${readCareValues(persistenceStorage).residential.monthly.toLocaleString('de-DE')} €/Monat). Pflege zu Hause ohne Zuzahlung angenommen. Ein Heimplatz allein: rund ${(Math.round(readCareValues(persistenceStorage).residential.monthly * 12 / 100) * 100).toLocaleString('de-DE')} € im Jahr. Pflegegeld ist hier schon verrechnet.` : preset.description;
    refreshCareForms();
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

    // Ermittle den höchsten Bedarf inkl. Zuschlag über alle Pflegegrade hinweg.
    const gradeNeeds = SUPPORTED_PFLEGE_GRADES.map(grade => {
        const value = (parseFloat(/** @type {HTMLInputElement} */ (document.getElementById(`pflegeStufe${grade}Zusatz`))?.value) || 0) * regionalMultiplier;
        return { grade, value };
    });
    const maxEntry = gradeNeeds.reduce((best, entry) => entry.value > best.value ? entry : best, { grade: null, value: 0 });
    const gradeLabel = maxEntry.grade ? (PFLEGE_GRADE_LABELS[maxEntry.grade] || `Pflegegrad ${maxEntry.grade}`) : 'Pflegegrad n/a';

    if (infoBadge) {
        infoBadge.innerHTML = `Heutiger Cap für Zusatzkosten: <strong>${formatWholeEuro(capHeute)}</strong><br>` +
            `Höchster Bedarf (inkl. Zuschlag): <strong>${formatWholeEuro(maxEntry.value)}</strong> (${gradeLabel})`;
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
        pflegeMaxFloorInput.title = 'Gesamt-Floor inkl. Pflege. Der maximal mögliche Zusatzbedarf ergibt sich aus diesem Wert abzüglich des Basis-Floor-Bedarfs zum Zeitpunkt des Pflegeeintritts.';
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
        if (pflegeStaffelSelect.value === 'amtlich') applyPflegeKostenPreset('amtlich');
    }

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
