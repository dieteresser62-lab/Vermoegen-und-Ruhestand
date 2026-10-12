import { cloneWorkshopInputsForDisplay } from './simulator-overview-summary.js';
import { freezePersonDataContext, personDataContextFor } from './simulator-person-overrides.js';
import { renderPersonDataNotice } from './protocol-renderer.js';
import { bindScenarioLogView, disposeScenarioLogView } from './scenario-log-view.js';
import { buildWealthDistribution, renderWealthDistribution } from './wealth-distribution.js';
import { renderWealthFanChart } from './wealth-fan-chart.js';
import { initializePortfolio } from './simulator-portfolio-init.js';
import { getProtocolColumns, createProtocolPersonContext } from './protocol-columns.js';
import { escapeProtocolHtml, renderProtocolSummary, renderProtocolTable } from './protocol-renderer.js';
"use strict";


import { formatCurrency, quantile } from './simulator-utils.js';
import { prepareMonteCarloViewModel, buildMonteCarloAnswers } from './results-metrics.js';
import { renderMonteCarloAnswers, renderSummary, renderKpiDashboard, renderStressSection, renderHeatmap, renderCareSection } from './results-renderers.js';
import { showToast } from './simulator-main-helpers.js';
import { buildBinaryProportionEstimate } from './monte-carlo-statistics.js';
import {
    SWEEP_COMPARISON_DIAGNOSTICS_VERSION,
    SWEEP_METRIC_METADATA,
    SWEEP_METRICS_VERSION
} from './sweep-metrics-contract.js';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import {
    projectScenarioLogV2,
    serializeScenarioLogCsvV2,
    serializeScenarioLogExportV2
} from './monte-carlo-export.js';
import {
    publishStressReplayMonteCarloContext,
    selectStressReplayScenario
} from './stress-replay-ui.js';

const scenarioChangeListeners = new WeakMap();
function replaceScenarioChangeListener(element, handler) {
    if (!element) return;
    const previous = scenarioChangeListeners.get(element);
    if (previous) element.removeEventListener('change', previous);
    if (handler) {
        element.addEventListener('change', handler);
        scenarioChangeListeners.set(element, handler);
    } else scenarioChangeListeners.delete(element);
}

function projectStressReplayScenario(scenario) {
    const empty = document.getElementById('stressReplaySelectedScenarioEmpty');
    const details = document.getElementById('stressReplaySelectedScenarioDetails');
    const label = document.getElementById('stressReplaySelectedScenarioLabel');
    const wealth = document.getElementById('stressReplaySelectedScenarioWealth');
    const care = document.getElementById('stressReplaySelectedScenarioCare');
    if (!empty || !details || !label || !wealth || !care) return;

    if (!scenario) {
        empty.hidden = false;
        details.hidden = true;
        label.textContent = '—';
        wealth.textContent = '—';
        care.textContent = '—';
        return;
    }

    label.textContent = scenario.label || 'Unbenannter Lauf';
    wealth.textContent = scenario.failed ? 'FAILED' : formatCurrency(scenario.endVermoegen);
    care.textContent = scenario.careEverActive ? 'Pflegefall enthalten' : 'Nicht als Pflegefall markiert';
    empty.hidden = true;
    details.hidden = false;
}

/**
 * Storage keys for log detail preferences.
 * Separate keys prevent the backtest log checkbox from leaking into the
 * worst-case log (and vice versa). A legacy key is still understood to avoid
 * breaking existing localStorage data when users upgrade.
 */
export const LEGACY_LOG_DETAIL_KEY = 'logDetailLevel';
export const WORST_LOG_DETAIL_KEY = 'worstLogDetailLevel';
export const BACKTEST_LOG_DETAIL_KEY = 'backtestLogDetailLevel';
export {
    SWEEP_COMPARISON_DIAGNOSTICS_VERSION,
    SWEEP_DECISION_METRIC_KEYS,
    SWEEP_DRAWDOWN_DEFINITION_VERSION,
    SWEEP_METRIC_METADATA,
    SWEEP_METRIC_METADATA_VERSION,
    SWEEP_METRICS_VERSION,
    readSweepMetricValue
} from './sweep-metrics-contract.js';

/**
 * Reads the persisted detail level with a defensive fallback.
 *
 * @param {string} storageKey - Primary localStorage key for the preference.
 * @param {string|null} legacyKey - Optional legacy key to read for backward compatibility.
 * @returns {('normal'|'detailed')} Sanitized detail level, defaults to 'normal'.
 */
export function loadDetailLevel(storageKey, legacyKey = LEGACY_LOG_DETAIL_KEY) {
    const stored = persistenceStorage.getItem(storageKey);
    if (stored === 'detailed' || stored === 'normal') {
        return stored;
    }

    if (legacyKey) {
        const legacy = persistenceStorage.getItem(legacyKey);
        if (legacy === 'detailed') return 'detailed';
    }

    return 'normal';
}

/**
 * Persists a detail level and removes the legacy key to avoid cross-contamination
 * between different log UIs.
 *
 * @param {string} storageKey - Primary localStorage key for the preference.
 * @param {string} level - Desired level, anything but 'detailed' collapses to 'normal'.
 * @returns {('normal'|'detailed')} The sanitized value that was stored.
 */
export function persistDetailLevel(storageKey, level) {
    const sanitizedLevel = level === 'detailed' ? 'detailed' : 'normal';
    persistenceStorage.setItem(storageKey, sanitizedLevel);
    if (storageKey !== LEGACY_LOG_DETAIL_KEY) {
        persistenceStorage.removeItem(LEGACY_LOG_DETAIL_KEY);
    }
    return sanitizedLevel;
}

/**
 * Zeigt die Monte-Carlo-Ergebnisse an. Berechnung und Strukturierung der Kennzahlen
 * erfolgt in einem dom-neutralen View-Model, das anschließend mit Renderer-Funktionen
 * in HTML überführt wird. Dadurch bleiben Berechnung und Darstellung sauber getrennt.
 */
export function displayMonteCarloResults(results, anzahl, failCount, worstRun, resultsMitPflege, resultsOhnePflege, pflegefallEingetretenCount, inputs, worstRunCare, scenarioLogs = null, displayContext = {}) {

    const personDataContext = freezePersonDataContext(displayContext.personDataContext ?? personDataContextFor(inputs));
    inputs = cloneWorkshopInputsForDisplay(inputs);
    displayContext = { ...displayContext };
    const personDisplayContext = createProtocolPersonContext(inputs, displayContext.personDisplayContext?.persons);
    disposeScenarioLogView(document);
    const distributionHost = document.getElementById('wealthDistribution');
    const fanHost = document.getElementById('wealthFanChart');
    const renderDistribution = mode => {
        if (distributionHost) distributionHost.innerHTML = renderWealthDistribution(buildWealthDistribution(results, scenarioLogs, mode));
        if (fanHost) fanHost.innerHTML = renderWealthFanChart(results?.wealthFan, { mode, initialWealth: portfolioTotal(initializePortfolio(inputs || {})), startYear: displayContext.startYear, startAge: inputs?.startAlter });
    };
    const scenarioContainer = document.getElementById('scenarioLogContainer');
    // Invalidate the previous UI selection only when this renderer owns the
    // scenario surface. Hostless callers may already have published their state.
    if (scenarioContainer) {
        projectStressReplayScenario(null);
        selectStressReplayScenario(null);
        window.globalCurrentScenarioData = null;
        for (const id of ['toggle-care-details', 'toggle-log-detail']) replaceScenarioChangeListener(document.getElementById(id), null);
        for (const id of ['exportScenarioLogJson', 'exportScenarioLogCsv']) {
            const button = document.getElementById(id);
            if (button) button.onclick = null;
        }
        const previousOutput = document.getElementById('scenarioLogOutput');
        if (previousOutput) { previousOutput.innerHTML = ''; previousOutput.style.display = 'none'; }
        const previousExports = document.getElementById('scenarioExportButtons');
        if (previousExports) previousExports.style.display = 'none';
        const previousSummary = document.getElementById('scenarioProtocolSummary');
        if (previousSummary) previousSummary.innerHTML = '';
    }

    const viewModel = prepareMonteCarloViewModel({ results, totalRuns: anzahl, failCount, inputs });

    renderMonteCarloAnswers(document.getElementById('monteCarloAnswers'), buildMonteCarloAnswers({ results, totalRuns: anzahl, failCount }));
    renderSummary(document.getElementById('monteCarloSummary'), viewModel.summaryCards);
    const personNotice = document.getElementById('monteCarloPersonNotice');
    if (personNotice) personNotice.innerHTML = renderPersonDataNotice(personDataContext);

    const dashboard = document.getElementById('unifiedKpiDashboard');
    const riskDashboard = document.getElementById('riskKpiDashboard');
    renderKpiDashboard(dashboard, viewModel.kpiDashboard, riskDashboard);
    renderStressSection(riskDashboard || dashboard, viewModel.stressMetrics);

    renderHeatmap(document.getElementById('advancedKpiDashboard'), viewModel.heatmapData);

    const pflegeResultsContainer = document.getElementById('pflegeKpiResults');
    const summaryBox = document.getElementById('pflegeKpiSummary');
    renderCareSection(summaryBox, pflegeResultsContainer, viewModel.careMetrics);

    // 5. Szenario-Log Auswahl (ersetzt den alten Worst-Run-Log)
    if (scenarioLogs && scenarioContainer) {
        const caR = viewModel.carThreshold;
        // Expose scenario logs globally for export actions.
        window.globalScenarioLogs = scenarioLogs;
        window.globalScenarioCarThreshold = caR;
        window.globalCurrentScenarioData = null;
        publishStressReplayMonteCarloContext({ inputs, scenarioLogs, personDataContext });

        scenarioContainer.style.display = 'block';
        let currentId = '', currentScenario = null;
        const output = document.getElementById('scenarioLogOutput');
        const exportButtons = document.getElementById('scenarioExportButtons');

        // Funktion zum Rendern des ausgewählten Szenarios
        const renderSelectedScenario = (val = currentId, scenario = currentScenario) => {
            currentId = val; currentScenario = scenario;
            // Invalidate the previous selection before any rendering work. A
            // render failure must never leave an older path exportable.
            window.globalCurrentScenarioData = null;
            exportButtons.style.display = 'none';
            output.style.display = 'none';
            output.innerHTML = '';
            const summary = document.getElementById('scenarioProtocolSummary');
            if (summary) summary.innerHTML = '';
            projectStressReplayScenario(null);
            selectStressReplayScenario(null);
            try {
                if (!val) return;

                if (scenario && scenario.logDataRows && scenario.logDataRows.length > 0) {
                    // Respect persisted detail toggles for care and log verbosity.
                    const showCareDetails = (persistenceStorage.getItem('showCareDetails') === '1');
                    const logDetailLevel = loadDetailLevel(WORST_LOG_DETAIL_KEY);
                    output.innerHTML = renderWorstRunLog(scenario.logDataRows, caR, {
                        showCareDetails: showCareDetails,
                        logDetailLevel: logDetailLevel,
                        strategyMode: inputs?.decumulation?.mode || STRATEGY_OPTIONS.STANDARD,
                        goldAktiv: inputs?.goldAktiv,
                        inputs, startYear: displayContext.startYear, personDisplayContext
                    });
                    if (summary) summary.innerHTML = renderProtocolSummary(scenario.logDataRows, {
                        personDataContext,
                        source: 'mc', endWealth: scenario.endVermoegen,
                        outcome: scenario.failed ? 'ruin' : scenario.logDataRows.at(-1)?.recordType === 'terminal_death' ? 'all_dead' : scenario.failed === false ? 'no_ruin' : undefined,
                        subtitle: `${scenario.label || 'Szenario'} · ${scenario.logDataRows.length} Jahreszeilen · nominale Euro`
                    });
                    projectStressReplayScenario(scenario);
                    selectStressReplayScenario(scenario);
                    output.style.display = 'block';
                    window.globalCurrentScenarioData = {
                        personDataContext,
                        rows: scenario.logDataRows,
                        caR_Threshold: caR
                    };
                    exportButtons.style.display = 'flex';
                } else {
                    projectStressReplayScenario(null);
                    selectStressReplayScenario(null);
                    output.innerHTML = '<p class="ds-note" style="color: var(--text-muted); padding: 10px;">Keine Log-Daten für dieses Szenario verfügbar.</p>';
                    output.style.display = 'block';
                }
            } catch (error) {
                window.globalCurrentScenarioData = null;
                exportButtons.style.display = 'none';
                projectStressReplayScenario(null);
                selectStressReplayScenario(null);
                if (summary) summary.innerHTML = '';
                output.innerHTML = '<p class="ds-note ds-note-error" role="alert">Das Szenarioprotokoll konnte nicht angezeigt werden. Wählen Sie ein anderes Szenario.</p>';
                output.style.display = 'block';
                console.error('Szenarioprotokoll fehlgeschlagen:', error);
            }
        };

        // Liste, Navigation und SVG werden unten gemeinsam gebunden.

        // Event-Handler für Checkboxen (re-render bei Änderung)
        const careDetailsCheckbox = document.getElementById('toggle-care-details');
        const logDetailCheckbox = document.getElementById('toggle-log-detail');

        if (careDetailsCheckbox) {
            careDetailsCheckbox.checked = (persistenceStorage.getItem('showCareDetails') === '1');
            replaceScenarioChangeListener(careDetailsCheckbox, () => {
                persistenceStorage.setItem('showCareDetails', careDetailsCheckbox.checked ? '1' : '0');
                renderSelectedScenario();
            });
        }

        if (logDetailCheckbox) {
            logDetailCheckbox.checked = (loadDetailLevel(WORST_LOG_DETAIL_KEY) === 'detailed');
            replaceScenarioChangeListener(logDetailCheckbox, () => {
                const newLevel = logDetailCheckbox.checked ? 'detailed' : 'normal';
                persistDetailLevel(WORST_LOG_DETAIL_KEY, newLevel);
                renderSelectedScenario();
            });
        }

        // Export-Buttons Event-Handler
        const jsonBtn = document.getElementById('exportScenarioLogJson');
        const csvBtn = document.getElementById('exportScenarioLogCsv');
        const projectCurrentScenarioForExport = () => {
            const rows = window.globalCurrentScenarioData?.rows;
            return Array.isArray(rows) ? projectScenarioLogV2(rows, { personDataContext: window.globalCurrentScenarioData.personDataContext }) : null;
        };
        const reportScenarioExportError = error => {
            console.error('Szenario-Export fehlgeschlagen:', error);
            showToast('Szenario-Export nicht möglich: Die Logdaten verletzen den V2-Vertrag.', { duration: 5000 });
        };

        if (jsonBtn) {
            jsonBtn.onclick = () => {
                try {
                    const exportDocument = projectCurrentScenarioForExport();
                    if (!exportDocument) return;
                    const blob = new Blob([
                        serializeScenarioLogExportV2(exportDocument)
                    ], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'scenario-log-v2.json';
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('Export gespeichert: scenario-log-v2.json');
                } catch (error) {
                    reportScenarioExportError(error);
                }
            };
        }

        if (csvBtn) {
            csvBtn.onclick = () => {
                try {
                    const exportDocument = projectCurrentScenarioForExport();
                    if (!exportDocument) return;
                    const csvContent = serializeScenarioLogCsvV2(exportDocument);
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'scenario-log-v2.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('Export gespeichert: scenario-log-v2.csv');
                } catch (error) {
                    reportScenarioExportError(error);
                }
            };
        }

        bindScenarioLogView({
            document, logs: scenarioLogs,
            chartOptions: { initialWealth: portfolioTotal(initializePortfolio(inputs || {})), startYear: displayContext.startYear, startAge: inputs?.startAlter, realByRun: results?.wealthView?.realByRun, wealthFan: results?.wealthFan },
            onSelect: renderSelectedScenario,
            onMode: renderDistribution
        });

    } else if (scenarioContainer) {
        window.globalScenarioLogs = null;
        window.globalScenarioCarThreshold = null;
        publishStressReplayMonteCarloContext({});
        projectStressReplayScenario(null);
        selectStressReplayScenario(null);
        scenarioContainer.style.display = 'none';
    }
    if (!scenarioLogs || !scenarioContainer) bindScenarioLogView({ document, logs: null, onSelect: () => {}, onMode: renderDistribution });

    // 6. Ergebnisinhalt bereitstellen. Die Sichtbarkeit der übergeordneten
    // Unteransicht wird ausschließlich vom MC-Cockpit gesteuert.
    document.getElementById('monteCarloResults').style.display = 'block';
}

/**
 * Rendert das Worst-Run-Log als Textausgabe
 */
export function getWorstRunColumnDefinitions(opts = {}) {
    return getProtocolColumns({ ...opts, source: 'mc', compatibility: true });
}

export function renderWorstRunLog(logRows, caR_Threshold, opts = {}) {
    return renderProtocolTable(logRows, { ...opts, source: 'mc', caRThreshold: caR_Threshold });
}

/**
 * Berechnet das Gesamtvermögen eines Portfolios
 */
export function portfolioTotal(p) {
    const sumTr = (arr) => Array.isArray(arr)
        ? arr.reduce((s, t) => s + (Number(t?.marketValue) || 0), 0)
        : 0;
    return sumTr(p?.depotTranchesAktien) + sumTr(p?.depotTranchesGold) + (Number(p?.liquiditaet) || 0);
}

function buildSweepComparisonDiagnostics(runOutcomes, values, successCount, options = {}) {
    const runCount = runOutcomes.length;
    const terminalRuinRuns = runOutcomes.filter(outcome => outcome?.failed === true).length;
    const terminalRuinSharePct = runCount > 0 ? (terminalRuinRuns / runCount) * 100 : 0;
    const worst5Drawdown = Number(values?.worst5Drawdown);
    const quantileInTerminalRuinBlock = terminalRuinRuns > 0
        && Number.isFinite(worst5Drawdown)
        && Math.abs(worst5Drawdown - 100) <= 1e-12;
    return {
        schemaVersion: SWEEP_COMPARISON_DIAGNOSTICS_VERSION,
        runCount,
        successfulRuns: successCount,
        failedRuns: runCount - successCount,
        commonRandomNumbers: options.commonRandomNumbers === true,
        randomPolicyVersion: options.randomPolicyVersion ?? null,
        successProbability: buildBinaryProportionEstimate({
            successes: successCount,
            trials: runCount
        }),
        quantileUncertainty: {
            confidenceInterval: null,
            reason: 'quantile_confidence_interval_not_estimated'
        },
        drawdownQuantile: {
            metricKey: 'worst5Drawdown',
            quantile: 0.95,
            terminalRuinLossPct: 100,
            terminalRuinRuns,
            terminalRuinSharePct,
            upperTailSharePct: 5,
            quantileInTerminalRuinBlock,
            status: quantileInTerminalRuinBlock
                ? 'saturated_by_terminal_ruin'
                : 'not_saturated_by_terminal_ruin',
            warning: quantileInTerminalRuinBlock
                ? 'Der Drawdown-P95 liegt im Block terminaler Ruine und unterscheidet Strategien mit derselben gesaettigten Kennzahl nicht.'
                : null
        },
        ranking: {
            status: 'experimental_point_estimate',
            warning: 'Quantilrankings sind experimentelle Punktschätzer; CRN reduziert Vergleichsrauschen, ersetzt aber kein Quantil-Konfidenzintervall und kein Modellrisiko.'
        }
    };
}

function buildSweepMetricsEnvelope(runOutcomes, values, successCount, options = {}) {
    return {
        schemaVersion: SWEEP_METRICS_VERSION,
        metricMetadata: SWEEP_METRIC_METADATA,
        comparison: buildSweepComparisonDiagnostics(runOutcomes, values, successCount, options),
        ...values
    };
}

/**
 * Aggregiert Metriken für eine Reihe von Monte-Carlo-Läufen.
 *
 * @param {Array} runOutcomes - Array mit Ergebnissen einzelner Läufe
 * @param {Object} options - Vergleichs-/Seedvertrag des aufrufenden Runners
 * @returns {Object} Versionierte aggregierte Sweep-Metriken
 */
export function aggregateSweepMetrics(runOutcomes, options = {}) {
    const outcomes = Array.isArray(runOutcomes) ? runOutcomes : [];
    if (outcomes.length === 0) {
        return buildSweepMetricsEnvelope(outcomes, {
            successProbFloor: 0,
            p10EndWealth: 0,
            p25EndWealth: 0,
            medianEndWealth: 0,
            p75EndWealth: 0,
            meanEndWealth: 0,
            maxEndWealth: 0,
            worst5Drawdown: 0,
            minRunwayObserved: null
        }, 0, options);
    }

    const successCount = outcomes.filter(r => !r.failed).length;
    const successProbFloor = (successCount / outcomes.length) * 100;

    // End wealth quantiles use the same canonical interpolated method as D-06.
    const endWealths = outcomes.map(r => Number.isFinite(Number(r?.finalVermoegen))
        ? Number(r.finalVermoegen)
        : 0);

    const p10EndWealth = quantile(endWealths, 0.10);
    const p25EndWealth = quantile(endWealths, 0.25);
    const medianEndWealth = quantile(endWealths, 0.50);
    const p75EndWealth = quantile(endWealths, 0.75);

    // Mittelwert
    const meanEndWealth = endWealths.reduce((sum, val) => sum + val, 0) / endWealths.length;

    // Maximum
    const maxEndWealth = Math.max(...endWealths);

    // D-06: Verlustmass aufsteigend lesen; der schlechte Tail liegt oben.
    // Die kanonische Quantilfunktion interpoliert auf (n - 1) * q.
    const drawdowns = outcomes.map(r => {
        const value = Number(r?.maxDrawdown);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
            throw new RangeError(`Sweep-Drawdown ausserhalb des gueltigen Bereichs 0..100: ${String(r?.maxDrawdown)}`);
        }
        return value;
    });
    const worst5Drawdown = quantile(drawdowns, 0.95);

    const runways = outcomes
        .map(r => r?.minRunway)
        .filter(value => typeof value === 'number' && Number.isFinite(value));
    const minRunwayObserved = runways.length > 0 ? Math.min(...runways) : null;

    return buildSweepMetricsEnvelope(outcomes, {
        successProbFloor,
        p10EndWealth,
        p25EndWealth,
        medianEndWealth,
        p75EndWealth,
        meanEndWealth,
        maxEndWealth,
        worst5Drawdown,
        minRunwayObserved
    }, successCount, options);
}
