import { registeredPlanTrial } from '../shared/plan-trial.js';
import { dynamicFlexPresetPatch, detectDynamicFlexPreset } from '../shared/dynamic-flex-presets.js';
import { writeBoundHouseholdPlanField, readBoundHouseholdPlanField } from '../shared/household-plan-fields.js';
import { updateSimulatorPlanTrial, renderSimulatorPlanTrial } from './simulator-plan-trial.js';
"use strict";

import { readSimulatorHouseholdPlan } from '../profile/household-plan.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { setFieldState } from '../shared/field-state.js';
import { LONGEVITY_DEFAULTS, normalizeLongevityMode } from './dynamic-flex-longevity-contract.js';

// Beide Seiten nutzen explizit registrierte Besitzer; ohne Besitzer gilt der Altweg.
function renderPageTrial(options) {
    const trial = registeredPlanTrial(document);
    if (trial?.render) trial.render(options); else renderSimulatorPlanTrial(document, options);
}
function capturePageTrial(ids) {
    const trial = registeredPlanTrial(document);
    if (trial?.capture) return trial.capture(ids);
    return updateSimulatorPlanTrial(document, ids);
}
function readTrialState() {
    return registeredPlanTrial(document)?.read() || null;
}

function setDisabled(id, disabled, reason, state = disabled ? 'inactive' : 'editable') {
    const el = document.getElementById(id);
    if (!el) return;
    const trialState = readTrialState();
    if (trialState) el.dataset.planTrialInactive = String(disabled);
    el.disabled = disabled || Boolean(trialState && (trialState.busy || trialState.confirmed && (!trialState.active || !trialState.scope)));
    if (el.ownerDocument && el.parentNode) setFieldState(el, trialState?.confirmed && !trialState.active ? 'adopted' : state,
        trialState?.confirmed && !trialState.active ? 'aus Haushalt & Plan' : reason);
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!writeBoundHouseholdPlanField(el, value)) el.value = value;
}

function setChecked(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = value === true;
}

const DYNAMIC_FLEX_PERSIST_IDS = [
    'dynamicFlexPreset',
    'dynamicFlexShowAdvanced',
    'dynamicFlex',
    'horizonMethod',
    'horizonYears',
    'survivalQuantile',
    'goGoActive',
    'goGoMultiplier',
    'longevityMode',
    'longevityQuantileShift',
    'longevityRelativePct',
    'longevityBufferYears'
];

function getCurrentDynamicFlexValues() {
    return {
        dynamicFlex: document.getElementById('dynamicFlex')?.checked === true,
        horizonMethod: document.getElementById('horizonMethod')?.value || 'survival_quantile',
        horizonYears: readBoundHouseholdPlanField(document.getElementById('horizonYears')) ?? (Number.parseFloat(document.getElementById('horizonYears')?.value) || 30),
        survivalQuantile: readBoundHouseholdPlanField(document.getElementById('survivalQuantile')) ?? (Number.parseFloat(document.getElementById('survivalQuantile')?.value) || 0.85),
        goGoActive: document.getElementById('goGoActive')?.checked === true,
        goGoMultiplier: readBoundHouseholdPlanField(document.getElementById('goGoMultiplier')) ?? (Number.parseFloat(document.getElementById('goGoMultiplier')?.value) || 1.0),
        longevityMode: normalizeLongevityMode(document.getElementById('longevityMode')?.value || LONGEVITY_DEFAULTS.mode)
    };
}

function applyDynamicFlexPreset(presetKey, persistFn) {
    const preset = dynamicFlexPresetPatch(presetKey);
    if (!preset) return;
    setChecked('dynamicFlex', preset.dynamicFlex);
    setValue('horizonMethod', preset.horizonMethod);
    setValue('horizonYears', preset.horizonYears);
    setValue('survivalQuantile', preset.survivalQuantile);
    setChecked('goGoActive', preset.goGoActive);
    setValue('goGoMultiplier', preset.goGoMultiplier);
    setValue('longevityMode', preset.longevityMode);
    setValue('longevityQuantileShift', preset.longevityQuantileShift);
    setValue('longevityRelativePct', preset.longevityRelativePct);
    setValue('longevityBufferYears', preset.longevityBufferYears);
    if (typeof persistFn === 'function') persistFn();
}

export function syncDynamicFlexPresetSelection() {
    if (!globalThis.document) return;
    const presetSelect = document.getElementById('dynamicFlexPreset');
    if (!presetSelect) return;
    const current = getCurrentDynamicFlexValues();
    const detected = detectDynamicFlexPreset(current);
    // Benutzerdefiniert bezeichnet auch eine ausdrückliche lokale Detailabsicht.
    // Passende Werte dürfen diese Ansicht nicht während der Bearbeitung schließen.
    const keepDetails = presetSelect.value === 'custom'
        && document.getElementById('dynamicFlexShowAdvanced')?.checked === true;
    presetSelect.value = keepDetails ? 'custom' : detected;
    if (detected === 'off' && !keepDetails) {
        const showAdvancedToggle = document.getElementById('dynamicFlexShowAdvanced');
        if (showAdvancedToggle) {
            showAdvancedToggle.checked = false;
        }
    }
}

export function refreshDynamicFlexControls() {
    if (!globalThis.document) return;
    const presetValue = document.getElementById('dynamicFlexPreset')?.value || 'custom';
    const showAdvanced = document.getElementById('dynamicFlexShowAdvanced')?.checked === true;
    const showDetails = showAdvanced || presetValue === 'custom';
    const dynamicFlexEnabled = document.getElementById('dynamicFlex')?.checked === true;
    const longevityMode = normalizeLongevityMode(document.getElementById('longevityMode')?.value || LONGEVITY_DEFAULTS.mode);
    const goGoActive = document.getElementById('goGoActive')?.checked === true;
    const horizonMethod = document.getElementById('horizonMethod')?.value || 'survival_quantile';
    const configContainer = document.getElementById('dynamicFlexConfigGroup');
    const advancedToggleRow = document.getElementById('dynamicFlexAdvancedToggleRow');

    if (advancedToggleRow) {
        advancedToggleRow.style.display = showDetails ? 'grid' : 'none';
    }
    if (configContainer) {
        configContainer.style.display = showDetails ? 'grid' : 'none';
    }
    const hint = document.querySelector?.('.household-plan-more [data-plan-dynamic-hint]');
    if (hint) hint.hidden = showDetails;

    const detailsReason = !showDetails ? 'Detailmodus ist ausgeblendet; die Voreinstellung gilt.' : '';
    const flexReason = detailsReason || (!dynamicFlexEnabled ? 'Dynamic Flex ist ausgeschaltet.' : '');
    setDisabled('dynamicFlex', !showDetails, detailsReason);
    setDisabled('horizonMethod', !showDetails || !dynamicFlexEnabled, flexReason);
    // Die fachliche Anwendbarkeit ändert die bisherigen Sperren nicht.
    const directInactive = horizonMethod !== 'direct';
    setDisabled('horizonYears', !showDetails || !dynamicFlexEnabled,
        flexReason || (directInactive ? 'Nicht anwendbar bei aktuarischer Horizontmethode; nur im Request-Modus direct wirksam.' : ''),
        flexReason || directInactive ? 'inactive' : 'editable');
    setDisabled('survivalQuantile', !showDetails || !dynamicFlexEnabled,
        flexReason || (horizonMethod !== 'survival_quantile' ? 'Nicht anwendbar bei der Horizontmethode Erwartungswert oder direct.' : ''),
        flexReason || horizonMethod !== 'survival_quantile' ? 'inactive' : 'editable');
    setDisabled('goGoActive', !showDetails || !dynamicFlexEnabled, flexReason);
    setDisabled('goGoMultiplier', !showDetails || !dynamicFlexEnabled || !goGoActive,
        flexReason || (!goGoActive ? 'Go-Go ist ausgeschaltet.' : ''));
    setDisabled('longevityMode', !showDetails || !dynamicFlexEnabled, flexReason);
    for (const [id, mode, label] of [
        ['longevityQuantileShift', 'quantile_shift', 'Quantilverschiebung'],
        ['longevityRelativePct', 'relative_horizon_buffer', 'relativer Horizontpuffer'],
        ['longevityBufferYears', 'buffer_years', 'Jahrespuffer']
    ]) {
        setDisabled(id, !showDetails || !dynamicFlexEnabled || longevityMode !== mode,
            flexReason || (longevityMode !== mode ? `Nicht anwendbar: Langlebigkeitsmodus ${label} ist nicht gewählt.` : ''));
    }
    const presetSelect = document.getElementById('dynamicFlexPreset');
    if (presetSelect?.ownerDocument && presetSelect.parentNode) {
        setFieldState(presetSelect, 'editable', showDetails ? '' : 'Voreinstellung gilt; Details sind ausgeblendet.');
    }
    if (readTrialState()) renderPageTrial();
}

export function initDynamicFlexControls(options = {}) {
    const storagePrefix = typeof options.storagePrefix === 'string' ? options.storagePrefix : 'sim_';
    const enableLocalPersistence = options.enableLocalPersistence !== false;
    const persist = ({ presentationOnly = false } = {}) => {
        if (!enableLocalPersistence) {
            if (!presentationOnly && registeredPlanTrial(document)?.capture) {
                try { capturePageTrial(DYNAMIC_FLEX_PERSIST_IDS); document.getElementById('dynamicFlexPreset')?.setCustomValidity?.(''); }
                catch (error) { document.getElementById('dynamicFlexPreset')?.setCustomValidity?.(error.message); }
            }
            return;
        }
        const plan = readSimulatorHouseholdPlan();
        const trialState = readTrialState();
        if (plan.status !== 'valid' && trialState?.confirmed) return;
        if (plan.status === 'valid' && trialState && !presentationOnly) {
            try {
                capturePageTrial(DYNAMIC_FLEX_PERSIST_IDS);
                // Nach einer Rückprojektion auch abgeleitete Auswahl und Sperren
                // synchronisieren, bevor ein Champion seine Werte zurückliest.
                syncDynamicFlexPresetSelection();
                refreshDynamicFlexControls();
            } catch (error) {
                const field = document.getElementById('dynamicFlexPreset');
                field?.setCustomValidity?.(error.message);
                return;
            }
            document.getElementById('dynamicFlexPreset')?.setCustomValidity?.('');
        }
        DYNAMIC_FLEX_PERSIST_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.dataset.noPersist || plan.status === 'valid') return;
            const key = storagePrefix + id;
            if (el.type === 'checkbox') {
                persistenceStorage.setItem(key, el.checked ? 'true' : 'false');
            } else if (el.type !== 'radio') {
                persistenceStorage.setItem(key, String(el.value));
            }
        });
    };

    const dynamicFlexToggle = document.getElementById('dynamicFlex');
    const presetSelect = document.getElementById('dynamicFlexPreset');
    const showAdvancedToggle = document.getElementById('dynamicFlexShowAdvanced');
    const goGoToggle = document.getElementById('goGoActive');
    const longevityModeSelect = document.getElementById('longevityMode');
    if (!dynamicFlexToggle) return;

    if (presetSelect) {
        presetSelect.addEventListener('change', () => {
            const trialState = readTrialState();
            if (trialState?.confirmed && !trialState.active) {
                renderPageTrial({ project: true });
                syncDynamicFlexPresetSelection();
                refreshDynamicFlexControls();
                return;
            }
            if (presetSelect.value !== 'custom') {
                applyDynamicFlexPreset(presetSelect.value);
            }
            if (showAdvancedToggle) showAdvancedToggle.checked = presetSelect.value === 'custom';
            if (presetSelect.value === 'off') {
                const showAdvancedToggle = document.getElementById('dynamicFlexShowAdvanced');
                if (showAdvancedToggle) {
                    showAdvancedToggle.checked = false;
                }
            }
            refreshDynamicFlexControls();
            persist();
        });
    }
    if (showAdvancedToggle) {
        showAdvancedToggle.addEventListener('change', () => {
            refreshDynamicFlexControls();
            persist({ presentationOnly: true });
        });
    }
    dynamicFlexToggle.addEventListener('change', () => {
        refreshDynamicFlexControls();
        persist();
    });
    if (goGoToggle) {
        goGoToggle.addEventListener('change', () => {
            refreshDynamicFlexControls();
            persist();
        });
    }
    ['horizonMethod', 'horizonYears', 'survivalQuantile', 'goGoMultiplier', 'longevityMode', 'longevityQuantileShift', 'longevityRelativePct', 'longevityBufferYears'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || !presetSelect) return;
        el.addEventListener('input', () => {
            syncDynamicFlexPresetSelection();
            refreshDynamicFlexControls();
            persist();
        });
        el.addEventListener('change', () => {
            syncDynamicFlexPresetSelection();
            refreshDynamicFlexControls();
            persist();
        });
    });
    if (goGoToggle && presetSelect) {
        goGoToggle.addEventListener('change', () => {
            syncDynamicFlexPresetSelection();
            refreshDynamicFlexControls();
            persist();
        });
    }
    if (longevityModeSelect && presetSelect) {
        longevityModeSelect.addEventListener('change', () => {
            syncDynamicFlexPresetSelection();
            refreshDynamicFlexControls();
            persist();
        });
    }
    dynamicFlexToggle.addEventListener('change', () => {
        syncDynamicFlexPresetSelection();
        refreshDynamicFlexControls();
        persist();
    });

    syncDynamicFlexPresetSelection();
    refreshDynamicFlexControls();
    if (enableLocalPersistence && readSimulatorHouseholdPlan().status !== 'valid') persist();
}
