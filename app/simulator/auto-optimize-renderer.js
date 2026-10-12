import { renderPersonDataNotice } from './protocol-renderer.js';
/**
 * Module: Auto-Optimize Renderer
 * Purpose: Render parameter blocks, progress messages and result HTML.
 */
"use strict";

import { syncSelectionText } from '../shared/designsystem-selection-text.js';
import { formatDisplayFixed } from '../shared/designsystem-number-format.js';

import { formatCurrency } from './simulator-utils.js';
import {
    AUTO_OPTIMIZE_DYNAMIC_FLEX_MODE_LABELS,
    AUTO_OPTIMIZE_PARAM_LABELS,
    AUTO_OPTIMIZE_PARAM_UNITS,
    AUTO_OPTIMIZE_PARAMETER_OPTIONS,
    AUTO_OPTIMIZE_PARAMETER_REGISTRY,
    renderAutoOptimizeParamOptions
} from './auto-optimize-param-meta.js';

const formatFixed = (value, digits = 1) => formatDisplayFixed(Number(value), digits);
const formatPercentFromRatio = (value, digits = 1) => `${formatFixed((value ?? 0) * 100, digits)}\u00a0%`;
const formatSignedPercentFromRatio = (value, digits = 2) => `${value >= 0 ? '+' : ''}${formatPercentFromRatio(value, digits)}`;
const formatBoolean = value => value === true ? 'ja' : 'nein';
const MODEL_STATUS_LABELS = Object.freeze({
    technically_tested: 'technisch getestet',
    partially_plausibilized: 'teilweise intern plausibilisiert',
    not_validated: 'extern nicht validiert',
    custom_evaluator_not_assessed: 'bei benutzerdefiniertem Evaluator nicht bewertet'
});

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function createAutoOptimizeParameterBlock({ paramId, paramNumber, defaults = null, doc = globalThis.document }) {
    const paramDiv = doc.createElement('div');
    paramDiv.id = `ao_param_${paramId}`;
    paramDiv.className = 'ao-parameter-block ds-card';
    const selectedKey = AUTO_OPTIMIZE_PARAMETER_REGISTRY[defaults?.key]
        ? defaults.key
        : AUTO_OPTIMIZE_PARAMETER_OPTIONS[0].key;
    const selectedDomain = AUTO_OPTIMIZE_PARAMETER_REGISTRY[selectedKey].domain;
    const unitText = key => AUTO_OPTIMIZE_PARAM_UNITS[key] || 'Anteil';
    const initialRange = {
        min: defaults?.min ?? selectedDomain.min,
        max: defaults?.max ?? selectedDomain.max,
        step: defaults?.step ?? selectedDomain.step
    };

    paramDiv.innerHTML = `
        <h5 style="margin-top: 0; margin-bottom: 10px;">Parameter ${paramNumber}</h5>
        <div class="ds-field-grid sim-optimize-parameter-grid">
            <div class="ds-field">
                <label for="ao_param_${paramId}_key">Parameter</label>
                <select id="ao_param_${paramId}_key" class="ao-param-key" data-param-id="${paramId}">
                    ${renderAutoOptimizeParamOptions(selectedKey)}
                </select>
            </div>
            <div class="ds-field">
                <label for="ao_param_${paramId}_min">Minimum (<span data-ao-param-unit>${escapeHtml(unitText(selectedKey))}</span>)</label>
                <input id="ao_param_${paramId}_min" type="number" class="ao-param-min" data-param-id="${paramId}" value="${initialRange.min}"
                    min="${selectedDomain.min}" max="${selectedDomain.max}" step="${selectedDomain.step}">
            </div>
            <div class="ds-field">
                <label for="ao_param_${paramId}_max">Maximum (<span data-ao-param-unit>${escapeHtml(unitText(selectedKey))}</span>)</label>
                <input id="ao_param_${paramId}_max" type="number" class="ao-param-max" data-param-id="${paramId}" value="${initialRange.max}"
                    min="${selectedDomain.min}" max="${selectedDomain.max}" step="${selectedDomain.step}">
            </div>
            <div class="ds-field">
                <label for="ao_param_${paramId}_step">Schritt (<span data-ao-param-unit>${escapeHtml(unitText(selectedKey))}</span>)</label>
                <input id="ao_param_${paramId}_step" type="number" class="ao-param-step" data-param-id="${paramId}" value="${initialRange.step}"
                    step="${selectedDomain.step}" min="${selectedDomain.step}">
            </div>
        </div>
    `;

    const keySelect = paramDiv.querySelector('.ao-param-key');
    const minimumInput = paramDiv.querySelector('.ao-param-min');
    const maximumInput = paramDiv.querySelector('.ao-param-max');
    const stepInput = paramDiv.querySelector('.ao-param-step');
    keySelect?.classList?.add('ds-select');
    for (const input of [minimumInput, maximumInput, stepInput]) input?.classList?.add('ds-input');
    keySelect?.addEventListener?.('change', () => {
        const domain = AUTO_OPTIMIZE_PARAMETER_REGISTRY[keySelect.value]?.domain;
        if (!domain) return;
        paramDiv.querySelectorAll?.('[data-ao-param-unit]').forEach(label => { label.textContent = unitText(keySelect.value); });
        minimumInput.value = domain.min;
        minimumInput.min = domain.min;
        minimumInput.max = domain.max;
        minimumInput.step = domain.step;
        maximumInput.value = domain.max;
        maximumInput.min = domain.min;
        maximumInput.max = domain.max;
        maximumInput.step = domain.step;
        stepInput.value = domain.step;
        stepInput.min = domain.step;
        stepInput.step = domain.step;
    });

    syncSelectionText(keySelect);
    return paramDiv;
}

export function formatAutoOptimizeProgress(status) {
    if (status.stage === 'lhs') {
        return 'Generating candidates (Latin Hypercube Sampling)...';
    }
    if (status.stage === 'quick_filter') {
        const pct = Math.round((status.progress / status.total) * 100);
        return `Quick-Filter (fast evaluation): ${status.progress}/${status.total} (${pct}\u00a0%)`;
    }
    if (status.stage === 'evaluate_lhs') {
        const pct = Math.round((status.progress / status.total) * 100);
        return `Full evaluation (top candidates): ${status.progress}/${status.total} (${pct}\u00a0%)`;
    }
    if (status.stage === 'refine') {
        if (status.total) {
            const pct = Math.round((status.progress / status.total) * 100);
            return `Refining top-5 candidates: ${status.progress}/${status.total} (${pct}\u00a0%)`;
        }
        return 'Refining top-5 candidates (local search)...';
    }
    if (status.stage === 'validate') {
        const pct = Math.round((status.progress / status.total) * 100);
        return `Validating on test seeds: ${status.progress}/${status.total} (${pct}\u00a0%)`;
    }
    if (status.stage === 'done') {
        return 'Optimization complete!';
    }
    return '';
}

export function renderAutoOptimizeResult({ resultEl, result, objective }) {
    if (!resultEl) return;
    const {
        championCfg,
        metricsTest,
        deltaVsCurrent,
        stability,
        optimizationContext,
        parameterFidelity,
        modelStatus
    } = result;
    const stabilityPct = Math.round(stability * 100);
    const stabilityColor = stabilityPct >= 80 ? 'var(--good)' : stabilityPct >= 60 ? 'var(--warn)' : 'var(--bad)';
    const dynamicFlexModeLabel = AUTO_OPTIMIZE_DYNAMIC_FLEX_MODE_LABELS[optimizationContext?.dynamicFlexMode]
        || AUTO_OPTIMIZE_DYNAMIC_FLEX_MODE_LABELS.inherit;
    const dynamicFlexStateLabel = optimizationContext?.dynamicFlexActive === true ? 'aktiv' : 'inaktiv';
    const safetyLabel = optimizationContext?.safetyGuardsActive === true ? 'aktiv' : 'inaktiv';
    const evaluationContract = optimizationContext?.evaluationContract;
    const monteCarloParameters = evaluationContract?.monteCarloParameters;
    const seedContract = evaluationContract?.seedContract;
    const dataFilter = evaluationContract?.dataFilter;
    const fixedModelAssumptions = evaluationContract?.fixedModelAssumptions;
    const dataVersion = modelStatus?.dataVersion;
    const effectiveDataSelection = modelStatus?.effectiveDataSelection || dataFilter;
    const technicalStatus = modelStatus?.technicalTestStatus ?? 'nicht ausgewiesen';
    const internalStatus = modelStatus?.internalPlausibilityStatus ?? 'nicht ausgewiesen';
    const externalStatus = modelStatus?.externalValidationStatus ?? 'nicht ausgewiesen';
    const technicalStatusLabel = MODEL_STATUS_LABELS[technicalStatus] || technicalStatus;
    const internalStatusLabel = MODEL_STATUS_LABELS[internalStatus] || internalStatus;
    const externalStatusLabel = MODEL_STATUS_LABELS[externalStatus] || externalStatus;
    const trainSeeds = Array.isArray(seedContract?.trainSeeds) ? seedContract.trainSeeds.join(', ') : 'nicht ausgewiesen';
    const confirmationSeeds = Array.isArray(seedContract?.confirmationSeeds)
        ? seedContract.confirmationSeeds.join(', ')
        : 'nicht ausgewiesen';

    let paramCardsHtml = '';
    for (const [key, value] of Object.entries(championCfg)) {
        const label = AUTO_OPTIMIZE_PARAM_LABELS[key] || key;
        const unit = AUTO_OPTIMIZE_PARAM_UNITS[key] || '';
        const displayValue = typeof value === 'number' ? formatFixed(value, 1) : value;

        paramCardsHtml += `
            <div class="ds-card ds-metric sim-champion-param">
                <div style="font-size: var(--balance-help); color: var(--text-muted); margin-bottom: 5px;">${label}</div>
                <div style="font-size: var(--balance-kpi); font-weight: 600; color: var(--secondary-color);">
                    ${displayValue}${unit ? '\u00a0' + unit : ''}
                </div>
            </div>
        `;
    }

    resultEl.innerHTML = `
        ${renderPersonDataNotice(result.personDataContext)}
        <div class="ds-plan-card sim-champion">
            <h3 style="margin-top: 0; color: var(--secondary-color);">Champion Configuration</h3>
            <div class="ds-note ds-note-warning" role="note" data-auto-optimize-model-warning
                style="background: var(--bad-soft); border: 2px solid var(--bad); color: var(--bad); padding: 12px; border-radius: 6px; margin-bottom: 14px; font-size: var(--balance-help);">
                <strong>Experimenteller Szenariokandidat – keine Finanzempfehlung:</strong>
                Dieser Champion gilt nur fuer den ausgewiesenen Modell-, Daten-, Filter-, Seed- und Parameterraum.
                Er ist weder ein globales Optimum noch extern validiert.
            </div>
            <div class="ds-note" style="background: var(--surface-sunken); border: 1px solid var(--border); color: var(--text-main); padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; font-size: var(--balance-help);">
                <strong>Dynamic-Flex Modus:</strong> ${dynamicFlexModeLabel} (${dynamicFlexStateLabel})
                <br><strong>Safety-Guards:</strong> ${safetyLabel}
            </div>

            <div class="ds-note" data-auto-optimize-model-status
                style="background: var(--surface-sunken); border: 1px solid var(--border); color: var(--text-main); padding: 12px; border-radius: 6px; margin-bottom: 14px; font-size: var(--balance-help);">
                <strong>Modell- und Validierungsstatus:</strong>
                <br>Schema: <code>${escapeHtml(modelStatus?.schemaVersion ?? 'nicht ausgewiesen')}</code>
                · Modellversion: <code>${escapeHtml(modelStatus?.modelVersion ?? 'nicht ausgewiesen')}</code>
                · Modus: <code>${escapeHtml(modelStatus?.evaluationMode ?? 'nicht ausgewiesen')}</code>
                <br>Methode: <strong>${escapeHtml(modelStatus?.methodClassification ?? 'nicht ausgewiesen')}</strong>
                · Entscheidungsnutzung: <code>${escapeHtml(modelStatus?.decisionUse ?? 'nicht ausgewiesen')}</code>
                <br>Technisch: ${escapeHtml(technicalStatusLabel)}
                (<code>${escapeHtml(technicalStatus)}</code>)
                · Intern: ${escapeHtml(internalStatusLabel)}
                (<code>${escapeHtml(internalStatus)}</code>)
                · Extern: ${escapeHtml(externalStatusLabel)}
                (<code>${escapeHtml(externalStatus)}</code>)
                <br>Datenuniversum:
                annualDataHash <code>${escapeHtml(dataVersion?.annualDataHash ?? 'nicht anwendbar')}</code>
                · regimeHash <code>${escapeHtml(dataVersion?.regimeHash ?? 'nicht anwendbar')}</code>
                <br>Effektive Datenauswahl:
                ${escapeHtml(effectiveDataSelection?.startYearMode ?? 'nicht ausgewiesen')}
                · Startjahr ${escapeHtml(effectiveDataSelection?.startYearFilter ?? 'nicht ausgewiesen')}
                · Halbwertszeit ${escapeHtml(effectiveDataSelection?.startYearHalfLife ?? 'nicht ausgewiesen')}
                · geschaetzte Historie ausgeschlossen:
                ${formatBoolean(effectiveDataSelection?.excludeEstimatedHistory)}
                <br><small>Statusvokabular:
                <code>${escapeHtml(modelStatus?.statusVocabularyVersion ?? 'nicht ausgewiesen')}</code>
                · Evidenzgrenze:
                <code>${escapeHtml(modelStatus?.evidenceBoundary ?? 'nicht ausgewiesen')}</code></small>
            </div>

            <div class="ds-note" style="background: var(--surface-sunken); border: 1px solid var(--border); color: var(--text-main); padding: 12px; border-radius: 6px; margin-bottom: 14px; font-size: var(--balance-help);">
                <strong>Versionierte Optimierungsannahmen:</strong>
                <br>Sampling: ${escapeHtml(monteCarloParameters?.methode ?? 'nicht ausgewiesen')}
                · RNG: ${escapeHtml(monteCarloParameters?.rngMode ?? 'nicht ausgewiesen')}
                · Runs/Kandidat: ${escapeHtml(monteCarloParameters?.anzahl ?? 'nicht ausgewiesen')}
                · Blockgröße: ${escapeHtml(monteCarloParameters?.blockSize ?? 'nicht ausgewiesen')}
                · CAPE-Sampling: ${formatBoolean(evaluationContract?.useCapeSampling)}
                <br>Datenfilter: ${escapeHtml(dataFilter?.startYearMode ?? 'nicht ausgewiesen')}
                · Startjahr ${escapeHtml(dataFilter?.startYearFilter ?? 'nicht ausgewiesen')}
                · Halbwertszeit ${escapeHtml(dataFilter?.startYearHalfLife ?? 'nicht ausgewiesen')}
                · geschätzte Historie ausgeschlossen: ${formatBoolean(dataFilter?.excludeEstimatedHistory)}
                <br>Train-Seeds: ${escapeHtml(trainSeeds)}
                <br>Bestätigungsseeds: ${escapeHtml(confirmationSeeds)}
                <br>Fixiert: CAPE ${escapeHtml(fixedModelAssumptions?.capeRatio ?? 'nicht ausgewiesen')}
                · Stress ${escapeHtml(fixedModelAssumptions?.stressPreset ?? 'nicht ausgewiesen')}
                · Horizon-Methode ${escapeHtml(fixedModelAssumptions?.horizonMethod ?? 'nicht ausgewiesen')}
                · Dauer ${escapeHtml(fixedModelAssumptions?.maxDauer ?? 'nicht ausgewiesen')} Jahre
                <br><small>Request-Fingerprint: ${escapeHtml(parameterFidelity?.requestFingerprint ?? 'nicht ausgewiesen')}</small>
            </div>

            <div class="sim-champion-parameters">
                ${paramCardsHtml}
            </div>

            <div class="ds-card sim-champion-metrics">
                <h4 style="margin-top: 0;">Key Metrics (Test Seeds)</h4>
                <p class="reporting-reference-note">Die 4,5-%-Kennzahl misst die realisierte Entnahmequote strikt größer 4,5 %. Sie ist nur eine Berichtsreferenz und keine Alarm- oder Guardrail-Schwelle.</p>
                <div class="sim-champion-metric-grid">
                    <div><strong>Success Rate:</strong><span style="margin-left: 10px;">${formatPercentFromRatio(metricsTest.successProbFloor, 1)}</span></div>
                    <div><strong>P90 Drawdown:</strong><span style="margin-left: 10px;">${formatPercentFromRatio(metricsTest.worst5Drawdown, 1)}</span></div>
                    <div><strong>End Wealth P50:</strong><span style="margin-left: 10px;">${formatCurrency(metricsTest.medianEndWealth ?? 0)}</span></div>
                    <div><strong>Zeitanteil realisierte Entnahmequote &gt; 4,5 %:</strong><span style="margin-left: 10px;">${formatPercentFromRatio(metricsTest.timeShareWRgt45, 2)}</span></div>
                </div>
            </div>

            <div class="ds-card sim-champion-metrics">
                <h4 style="margin-top: 0;">Delta vs. Current Configuration</h4>
                <div class="sim-champion-metric-grid">
                    <div>
                        <strong>Success Rate:</strong>
                        <span style="margin-left: 10px; color: ${deltaVsCurrent.successRate === 0 ? 'var(--text-main)' : deltaVsCurrent.successRate >= 0 ? 'var(--good)' : 'var(--bad)'};">
                            ${formatSignedPercentFromRatio(deltaVsCurrent.successRate, 2)}
                        </span>
                    </div>
                    <div>
                        <strong>P90 Drawdown:</strong>
                        <span style="margin-left: 10px; color: ${deltaVsCurrent.drawdownP90 === 0 ? 'var(--text-main)' : deltaVsCurrent.drawdownP90 <= 0 ? 'var(--good)' : 'var(--bad)'};">
                            ${formatSignedPercentFromRatio(deltaVsCurrent.drawdownP90, 2)}
                        </span>
                    </div>
                    <div>
                        <strong>End Wealth P50:</strong>
                        <span style="margin-left: 10px; color: ${deltaVsCurrent.endWealthP50 === 0 ? 'var(--text-main)' : deltaVsCurrent.endWealthP50 >= 0 ? 'var(--good)' : 'var(--bad)'};">
                            ${deltaVsCurrent.endWealthP50 >= 0 ? '+' : ''}${formatCurrency(deltaVsCurrent.endWealthP50)}
                        </span>
                    </div>
                    <div>
                        <strong>Δ Zeitanteil realisierte Entnahmequote &gt; 4,5 %:</strong>
                        <span style="margin-left: 10px; color: ${deltaVsCurrent.timeShareWRgt45 === 0 ? 'var(--text-main)' : deltaVsCurrent.timeShareWRgt45 <= 0 ? 'var(--good)' : 'var(--bad)'};">
                            ${formatSignedPercentFromRatio(deltaVsCurrent.timeShareWRgt45, 2)}
                        </span>
                    </div>
                </div>
            </div>

            <div style="background: ${stabilityColor}; color: var(--surface); padding: 15px; border-radius: 6px; text-align: center;">
                <h4 style="margin: 0; color: var(--surface);">Stability Score: ${stabilityPct}\u00a0%</h4>
                <p style="margin: 5px 0 0 0; font-size: var(--balance-help);">
                    ${stabilityPct >= 80 ? '✓ Highly stable across seed sets'
        : stabilityPct >= 60 ? '⚠ Moderately stable'
            : '⚠ Low stability - consider more seeds'}
                </p>
            </div>
        </div>
    `;
    resultEl.style.display = 'block';
}

export function appendAutoOptimizeApplySuccess({ resultEl, doc = globalThis.document }) {
    if (!resultEl) return;
    const successMsg = doc.createElement('div');
    successMsg.className = 'ds-note';
    successMsg.style.cssText = 'background: var(--warn); color: var(--surface); padding: 10px; border-radius: 6px; margin-top: 10px; text-align: center;';
    successMsg.textContent = '✓ Experimenteller Szenariokandidat übernommen – keine Finanzempfehlung. Eine spätere Profilauswahl kann profilgebundene Felder erneut setzen.';
    resultEl.appendChild(successMsg);

    setTimeout(() => {
        successMsg.remove();
    }, 3500);
}
