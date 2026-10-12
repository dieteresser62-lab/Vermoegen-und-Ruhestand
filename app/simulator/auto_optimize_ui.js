import { showPageAlert } from '../shared/page-dialog.js';
import { freezePersonDataContext } from './simulator-person-overrides.js';
import { getSimulatorPlanTrial } from './simulator-plan-trial.js';
/**
 * Module: Auto-Optimize UI
 * Purpose: Facade for Auto-Optimize UI initialization and event wiring.
 * Dependencies: auto_optimize.js, auto-optimize-*.js
 */
"use strict";

import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { throwIfAutoOptimizeCancelled } from './auto-optimize-worker.js';
import { runAutoOptimize } from './auto_optimize.js';
import { updateStartPortfolioDisplay } from './simulator-portfolio.js';
import { applyChampionToForm } from './auto-optimize-apply.js';
import {
    readAutoOptimizeConfigFromUI,
    setAutoOptimizeDefaultsInDOM,
    validateAutoOptimizeInputs
} from './auto-optimize-config-ui.js';
import { AUTO_OPTIMIZE_PRESETS } from './auto-optimize-presets.js';
import {
    appendAutoOptimizeApplySuccess,
    createAutoOptimizeParameterBlock,
    formatAutoOptimizeProgress,
    renderAutoOptimizeResult
} from './auto-optimize-renderer.js';
import { formatSimulatorValidationError } from './simulator-input-validation.js';

let aoParamCounter = 0;
let activeAutoOptimize = null;
let nextAutoOptimizeGeneration = 1;
let autoOptimizeRevision = 0;
const autoOptimizeRegistrations = new WeakMap();

function autoOptimizeNavigationRegistration() {
    const doc = globalThis.document;
    if (!doc || typeof doc !== 'object') return null;
    if (!autoOptimizeRegistrations.has(doc)) {
        const guard = getPageNavigationGuard(doc);
        const registration = guard.register('simulator-auto-optimize', {
            read: () => ({ phase: activeAutoOptimize?.phase || 'idle',
                operationId: activeAutoOptimize?.generationId || null,
                revision: autoOptimizeRevision, result: Boolean(window.aoChampionResult),
                message: activeAutoOptimize
                    ? 'Auto-Optimize: Laufende Rechnung wird abgebrochen – trotzdem wechseln?'
                        + (window.aoChampionResult ? '\nAuto-Optimize: Ergebnis geht verloren – trotzdem wechseln?' : '')
                    : 'Auto-Optimize: Ergebnis geht verloren – trotzdem wechseln?' }),
            cancel: () => cancelAutoOptimize().then(() => true)
        });
        autoOptimizeRegistrations.set(doc, { guard, ...registration });
    }
    return autoOptimizeRegistrations.get(doc);
}

export function cancelAutoOptimize() {
    const run = activeAutoOptimize;
    if (!run) return Promise.resolve(false);
    if (run.cancelPromise) return run.cancelPromise;
    run.phase = 'cancelling';
    run.registration?.notify();
    run.controller.abort();
    run.cancelPromise = run.promise.then(() => true);
    return run.cancelPromise;
}

export function formatAutoOptimizeError(error) {
    return formatSimulatorValidationError(error);
}

function el(id) {
    return document.getElementById(id);
}

/**
 * Initialisiert das Auto-Optimize UI
 */
export function initAutoOptimizeUI() {
    const runBtn = el('ao_run_btn');
    const applyBtn = el('ao_apply_btn');
    if (!runBtn) return;

    autoOptimizeNavigationRegistration();
    bindMetricQuantileToggle();
    runBtn.addEventListener('click', async () => {
        await handleRunAutoOptimize();
    });
    el('ao_cancel_btn')?.addEventListener('click', () => { void cancelAutoOptimize(); });

    if (applyBtn) {
        applyBtn.style.display = 'none';
        applyBtn.addEventListener('click', applyChampionToConfig);
    }

    el('ao_add_param_btn')?.addEventListener('click', () => addParameter());
    el('ao_remove_param_btn')?.addEventListener('click', removeParameter);

    initPresetButtons();
    applyPreset('standard');
    updateRunButtonState();
}

function bindMetricQuantileToggle() {
    const metricSelect = el('ao_metric');
    const quantileContainer = el('ao_quantile_container');
    if (!metricSelect || !quantileContainer) return;

    metricSelect.addEventListener('change', () => {
        const metric = metricSelect.value;
        quantileContainer.style.display = metric.startsWith('EndWealth_P') ? 'block' : 'none';
    });
    metricSelect.dispatchEvent(new Event('change'));
}

function initPresetButtons() {
    const container = el('ao_presets_container');
    if (!container) return;

    container.addEventListener('click', (e) => {
        const button = e.target.closest('.ao-preset-btn');
        if (!button) return;
        applyPreset(button.dataset.preset);

        container.querySelectorAll('.ao-preset-btn').forEach(btn => {
            btn.setAttribute('aria-pressed', String(btn === button));
        });
    });
}

function applyPreset(presetKey) {
    const preset = AUTO_OPTIMIZE_PRESETS[presetKey];
    if (!preset) {
        console.error(`Unknown preset: ${presetKey}`);
        return;
    }

    const container = el('ao_parameters_container');
    if (!container) return;
    container.innerHTML = '';
    aoParamCounter = 0;

    el('ao_metric').value = preset.objective.metric;
    el('ao_direction').value = preset.objective.direction;
    el('ao_metric').dispatchEvent(new Event('change'));

    el('ao_c_sr99').checked = preset.constraints.sr99;
    el('ao_c_noex').checked = preset.constraints.noex;
    el('ao_c_ts45').checked = preset.constraints.ts45;
    el('ao_c_dd55').checked = preset.constraints.dd55;

    for (const param of preset.params) {
        addParameter(param);
    }

    const dynamicFlexModeSelect = el('ao_dynamic_flex_mode');
    if (dynamicFlexModeSelect) {
        dynamicFlexModeSelect.value = preset.dynamicFlexMode || 'inherit';
    }
    updateParameterButtonStates();
    updateRunButtonState();
}

function addParameter(defaults = null) {
    const container = el('ao_parameters_container');
    if (!container) return;
    const paramCount = container.children.length;
    if (paramCount >= 7) {
        notifyPage('Maximal 7 Parameter erlaubt.');
        return;
    }

    const paramDiv = createAutoOptimizeParameterBlock({
        paramId: aoParamCounter++,
        paramNumber: paramCount + 1,
        defaults
    });
    container.appendChild(paramDiv);
    attachParameterValidationListeners(paramDiv);
    updateParameterButtonStates();
    updateRunButtonState();
}

function removeParameter() {
    const container = el('ao_parameters_container');
    if (!container) return;
    const paramCount = container.children.length;
    if (paramCount <= 1) {
        notifyPage('Mindestens 1 Parameter erforderlich.');
        return;
    }

    container.removeChild(container.lastChild);
    updateParameterButtonStates();
    updateRunButtonState();
}

function updateParameterButtonStates() {
    const container = el('ao_parameters_container');
    if (!container) return;
    const paramCount = container.children.length;
    const addBtn = el('ao_add_param_btn');
    const removeBtn = el('ao_remove_param_btn');
    if (addBtn) addBtn.disabled = paramCount >= 7;
    if (removeBtn) removeBtn.disabled = paramCount <= 1;
}

function attachParameterValidationListeners(paramDiv) {
    const inputs = paramDiv.querySelectorAll('input, select');
    for (const input of inputs) {
        input.addEventListener('change', updateRunButtonState);
        input.addEventListener('input', updateRunButtonState);
    }
}

function updateRunButtonState() {
    const runBtn = el('ao_run_btn');
    if (!runBtn) return;
    runBtn.disabled = Boolean(activeAutoOptimize) || !validateAutoOptimizeInputs();
}

export function handleRunAutoOptimize(dependencies = {}) {
    if (activeAutoOptimize) return activeAutoOptimize.promise;
    const registration = autoOptimizeNavigationRegistration();
    if (registration?.guard.isBusy()) return Promise.resolve();
    const run = { controller: new AbortController(), phase: 'preparing', registration,
        generationId: `auto-optimize-${nextAutoOptimizeGeneration++}` };
    activeAutoOptimize = run;
    autoOptimizeRevision++;
    run.promise = Promise.resolve().then(() => executeAutoOptimize(run, dependencies)).finally(() => {
        if (activeAutoOptimize === run) activeAutoOptimize = null;
        registration?.notify();
    });
    registration?.notify();
    return run.promise;
}

async function executeAutoOptimize(run, dependencies) {
    const { signal } = run.controller;
    const runBtn = el('ao_run_btn');
    const progressEl = el('ao_progress');
    const resultEl = el('ao_result');
    const applyBtn = el('ao_apply_btn');

    runBtn.disabled = true;
    const cancelBtn = el('ao_cancel_btn');
    if (cancelBtn) cancelBtn.disabled = false;
    progressEl.textContent = 'Optimierung wird vorbereitet …';
    progressEl.style.display = 'block';

    try {
        throwIfAutoOptimizeCancelled(signal);
        const config = (dependencies.readConfig || readAutoOptimizeConfigFromUI)();
        config.signal = signal;
        config.generationId = run.generationId;
        run.phase = 'running';
        run.registration?.notify();
        config.onProgress = (status) => {
            if (signal.aborted || activeAutoOptimize !== run) return;
            const message = formatAutoOptimizeProgress(status);
            if (message) progressEl.textContent = message;
        };

        const evaluated = await (dependencies.run || runAutoOptimize)(config);
        const result = { ...evaluated, personDataContext: freezePersonDataContext(evaluated.personDataContext) };
        throwIfAutoOptimizeCancelled(signal);
        renderAutoOptimizeResult({ resultEl, result, objective: config.objective });
        window.aoChampionResult = result;
        autoOptimizeRevision++;
        run.registration?.notify();
        applyBtn.style.display = 'inline-block';
    } catch (e) {
        if (signal.aborted || e?.name === 'AbortError') {
            progressEl.textContent = 'Abgebrochen';
            return;
        }
        const message = formatAutoOptimizeError(e);
        notifyPage('Fehler bei der Auto-Optimierung:\n\n' + message);
        console.error(e);
        progressEl.textContent = 'Fehler: ' + message;
    } finally {
        runBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = true;
    }
}

function applyChampionToConfig() {
    if (!window.aoChampionResult) {
        notifyPage('Es ist noch kein führendes Ergebnis verfügbar.');
        return;
    }

    try {
        const planTrial = getSimulatorPlanTrial().read();
        if (planTrial.confirmed && !planTrial.scope) {
            notifyPage('Nicht übernommen: Der gemeinsame Plan fehlt oder ist ungültig. Stelle den gemeinsamen Plan wieder her, bevor du den Champion erneut übernimmst.');
            return;
        }
        applyChampionToForm({ championCfg: window.aoChampionResult.championCfg });
    } catch (error) {
        const planTrial = getSimulatorPlanTrial().read();
        const message = planTrial.confirmed && !planTrial.scope
            ? 'Nicht übernommen: Der gemeinsame Plan fehlt oder ist ungültig. Stelle den gemeinsamen Plan wieder her, bevor du den Champion erneut übernimmst.'
            : planTrial.confirmed && planTrial.scope && !planTrial.active
                ? 'Nicht übernommen: Das Formular bleibt beim bestätigten Plan. Starte „Nur hier ausprobieren“ und übernimm den Champion danach erneut für diesen lokalen Versuch.'
                : `Nicht übernommen: ${formatAutoOptimizeError(error)}`;
        notifyPage(message);
        return;
    }
    updateStartPortfolioDisplay();
    appendAutoOptimizeApplySuccess({ resultEl: el('ao_result') });
}

export function setAutoOptimizeDefaults() {
    setAutoOptimizeDefaultsInDOM();
}

/** Hinweise besitzen keinen fachlichen Zustimmungswert. */
function notifyPage(description) {
    void showPageAlert({ title: 'Auto-Optimierung', description: `${description}\n\nPrüfe die Parameter und starte die Auto-Optimierung bei Bedarf erneut.` })
        .catch(error => console.error('[Seitendialog] Hinweis konnte nicht geöffnet werden.', error));
}
