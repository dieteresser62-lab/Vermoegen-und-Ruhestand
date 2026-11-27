/** @import {BindInfoPopovers, BindScenarioLogView, PrepareMonteCarloViewModel} from '../../typcheck/simulator-ui.js' */
import { freezePersonDataContext, personDataContextFor } from './simulator-person-overrides.js';
import { renderPersonDataNotice } from './protocol-renderer.js';
import { bindScenarioLogView, disposeScenarioLogView } from './scenario-log-view.js';
import { buildComparisonContext } from './scenario-comparison.js';
import { renderScenarioAnalysis } from './scenario-log-analysis.js';
import { buildWealthDistribution, renderWealthDistribution } from './wealth-distribution.js';
import { renderWealthFanChart } from './wealth-fan-chart.js';
import { getEuroMode, resetEuroMode, euroBasisLabel } from './euro-display.js';
import { scenarioEndWealth, scenarioDisplayLabel } from './scenario-wealth-chart.js';
import { initializePortfolio } from './simulator-portfolio-init.js';
import { getProtocolColumns, createProtocolPersonContext } from './protocol-columns.js';
import { escapeProtocolHtml, renderProtocolSummary, renderProtocolTable } from './protocol-renderer.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
import { renderMonteCarloPersonOutcomes } from './mc-person-outcomes-view.js';
"use strict";


import { formatCurrency } from './simulator-utils.js';
import { prepareMonteCarloViewModel, buildMonteCarloAnswers } from './results-metrics.js';
import { renderMonteCarloAnswers, renderSummary, renderKpiDashboard, renderStressSection, renderHeatmap, renderCareSection, renderRiskKeyFigures } from './results-renderers.js';
import { showToast, triggerDownload } from './simulator-main-helpers.js';
import { lockWhileSaving } from '../shared/save-file.js';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import {
    projectScenarioLogV2,
    serializeScenarioLogCsvV2,
    serializeScenarioLogExportV2
} from './monte-carlo-export.js';

// SE-2: Kopfzeile des zugeklappten Szenario-Protokolls (Pfad, Jahre, Ruin, Eurobasis).
function setScenarioProtocolHead(head) {
    const heading = document.getElementById('scenarioProtocolHeading');
    const line = document.getElementById('scenarioProtocolLine');
    if (heading) heading.textContent = head ? `Szenario-Protokoll · ${head.label}` : 'Szenario-Protokoll';
    if (line) line.textContent = head ? [`${head.years} Jahreszeilen`, head.failed ? 'Vermögen aufgebraucht' : head.failed === false ? 'Vermögen reicht' : '',
        `Geldbeträge · ${euroBasisLabel(head.moneyBasis)}`, 'Jahr für Jahr mit allen Buchungen'].filter(Boolean).join(' · ')
        : 'Jahr für Jahr mit allen Buchungen';
}

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

/**
 * Storage keys for log detail preferences.
 * Separate keys prevent the backtest log checkbox from leaking into the
 * worst-case log (and vice versa). A legacy key is still understood to avoid
 * breaking existing localStorage data when users upgrade.
 */
export const LEGACY_LOG_DETAIL_KEY = 'logDetailLevel';
export const WORST_LOG_DETAIL_KEY = 'worstLogDetailLevel';
export const BACKTEST_LOG_DETAIL_KEY = 'backtestLogDetailLevel';

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
 *
 * @param results Aggregierte Simulationsergebnisse.
 * @param anzahl
 * @param failCount
 * @param worstRun
 * @param resultsMitPflege
 * @param resultsOhnePflege
 * @param pflegefallEingetretenCount
 * @param inputs Wirksame Simulationseingaben.
 * @param worstRunCare
 * @param [scenarioLogs]
 * @param [displayContext]
 * @returns {void}
 */
export function displayMonteCarloResults(results, anzahl, failCount, worstRun, resultsMitPflege, resultsOhnePflege, pflegefallEingetretenCount, inputs, worstRunCare, scenarioLogs = null, displayContext = {}) {

    const personDataContext = freezePersonDataContext(displayContext.personDataContext ?? personDataContextFor(inputs));
    inputs = structuredClone(inputs || {});
    displayContext = { ...displayContext };
    const personDisplayContext = createProtocolPersonContext(inputs, displayContext.personDisplayContext?.persons);
    disposeScenarioLogView(document);
    resetEuroMode(document);
    const distributionHost = document.getElementById('wealthDistribution');
    const fanHost = document.getElementById('wealthFanChart');
    let moneyBasis = getEuroMode(document);
    let renderActiveScenario = () => {};
    if (distributionHost) distributionHost.innerHTML = '';
    const renderDistribution = mode => {
        const distribution = buildWealthDistribution(results, scenarioLogs, mode);
        if (distributionHost) {
            const showAllMarks = /** @type {HTMLInputElement} */ (distributionHost.querySelector?.('#wealthShowAllMarks'))?.checked === true;
            const detailsOpen = /** @type {HTMLDetailsElement} */ (distributionHost.querySelector?.('.wealth-statistics-details'))?.open === true;
            distributionHost.innerHTML = renderWealthDistribution(distribution, { showAllMarks, detailsOpen });
        }
        if (fanHost) fanHost.innerHTML = renderWealthFanChart(results?.wealthFan, { mode, initialWealth: portfolioTotal(initializePortfolio(inputs || {})), initialHomes: (inputs?.home || []).reduce((sum, home) => sum + home.wert, 0), initialHomeSelf: (inputs?.home || []).filter(home => home.nutzung === 'selbst').reduce((sum, home) => sum + home.wert, 0), displayHomeValueFan: results?.displayHomeValueFan, startYear: displayContext.startYear, startAge: inputs?.startAlter });
        return distribution;
    };
    const scenarioContainer = document.getElementById('scenarioLogContainer');
    // Invalidate the previous UI selection only when this renderer owns the
    // scenario surface. Hostless callers may already have published their state.
    if (scenarioContainer) {
        renderScenarioAnalysis(document, null);
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

    const viewModel = /** @type {PrepareMonteCarloViewModel} */ (prepareMonteCarloViewModel)({ results, totalRuns: anzahl, failCount, inputs, moneyBasis });
    const personNotice = document.getElementById('monteCarloPersonNotice');
    if (personNotice) personNotice.innerHTML = renderPersonDataNotice(personDataContext);
    renderMonteCarloPersonOutcomes(document.getElementById('mcPersonOutcomes'), results?.personOutcomeRows, personDisplayContext.persons);

    const dashboard = document.getElementById('unifiedKpiDashboard');
    const riskDashboard = document.getElementById('riskKpiDashboard');
    renderHeatmap(document.getElementById('advancedKpiDashboard'), viewModel.heatmapData, { tall: true });

    const pflegeResultsContainer = document.getElementById('pflegeKpiResults');
    const summaryBox = document.getElementById('pflegeKpiSummary');
    const renderMoney = mode => {
        moneyBasis = mode;
        const model = /** @type {PrepareMonteCarloViewModel} */ (prepareMonteCarloViewModel)({ results, totalRuns: anzahl, failCount, inputs, moneyBasis });
        const detailsOpen = /** @type {HTMLDetailsElement} */ (dashboard?.querySelector?.('.mc-more-metrics'))?.open;
        for (const id of ['monteCarloAnswers', 'overviewMonteCarloAnswers']) renderMonteCarloAnswers(document.getElementById(id), buildMonteCarloAnswers({ results, totalRuns: anzahl, failCount, moneyBasis, inputs, durationYears: displayContext.durationYears ?? null }));
        renderSummary(document.getElementById('monteCarloSummary'), model.summaryCards);
        renderKpiDashboard(dashboard, model.kpiDashboard, riskDashboard, { stressMetrics: model.stressMetrics });
        const disclosure = /** @type {HTMLDetailsElement} */ (dashboard?.querySelector?.('.mc-more-metrics'));
        if (disclosure) disclosure.open = !!detailsOpen;
        // SE-2: Stress-Ergebnis steht in der Aufklappzeile „Stress-Szenario“ der Risikoansicht.
        renderStressSection(riskDashboard?.querySelector?.('.sim-risk-stress-anchor') || riskDashboard || dashboard, model.stressMetrics);
        renderCareSection(summaryBox, pflegeResultsContainer, model.careMetrics, personDisplayContext);
        const basis = document.getElementById('scenarioProtocolBasis');
        if (basis) basis.textContent = `Geldbeträge · ${euroBasisLabel(mode)}`;
        renderRiskKeyFigures(document.getElementById('riskKeyFigures'), renderDistribution(mode), model.kpiDashboard);
        renderActiveScenario();
    };

    // 5. Szenario-Log Auswahl (ersetzt den alten Worst-Run-Log)
    if (scenarioLogs && scenarioContainer) {
        const caR = viewModel.carThreshold;
        // Expose scenario logs globally for export actions.
        window.globalScenarioLogs = scenarioLogs;
        window.globalScenarioCarThreshold = caR;
        window.globalCurrentScenarioData = null;

        scenarioContainer.style.display = 'block';
        let currentId = '', currentScenario = null;
        const output = document.getElementById('scenarioLogOutput');
        const exportButtons = document.getElementById('scenarioExportButtons');
        const analysisOptions = { inputs, initialWealth: portfolioTotal(initializePortfolio(inputs || {})), initialHomes: (inputs?.home || []).reduce((sum, home) => sum + home.wert, 0), initialHomeSelf: (inputs?.home || []).filter(home => home.nutzung === 'selbst').reduce((sum, home) => sum + home.wert, 0), displayHomeValueFan: results?.displayHomeValueFan,
            startYear: displayContext.startYear, personDisplayContext };

        // Funktion zum Rendern des ausgewählten Szenarios
        const renderSelectedScenario = (val = currentId, scenario = currentScenario) => {
            currentId = val; currentScenario = scenario;
            // Invalidate the previous selection before any rendering work. A
            // render failure must never leave an older path exportable.
            window.globalCurrentScenarioData = null;
            renderScenarioAnalysis(document, null);
            exportButtons.style.display = 'none';
            output.style.display = 'none';
            output.innerHTML = '';
            const summary = document.getElementById('scenarioProtocolSummary');
            if (summary) summary.innerHTML = '';
            setScenarioProtocolHead(null);
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
                        inputs, startYear: displayContext.startYear, personDisplayContext, moneyBasis
                    });
                    const scenarioLabel = { earliestCareP1: personDisplayContext.persons[0]?.name,
                        earliestCareP2: personDisplayContext.persons[1]?.name }[scenario.key];
                    if (summary) summary.innerHTML = renderProtocolSummary(scenario.logDataRows, {
                        personDataContext,
                        source: 'mc', endWealth: scenarioEndWealth(scenario, moneyBasis, results?.wealthView?.realByRun), moneyBasis,
                        outcome: scenario.failed ? 'ruin' : scenario.logDataRows.at(-1)?.recordType === 'terminal_death' ? 'all_dead' : scenario.failed === false ? 'no_ruin' : undefined,
                        subtitle: `${scenarioLabel ? `Frühester Pflegeeintritt ${scenarioLabel}` : scenarioDisplayLabel(scenario)} · ${scenario.logDataRows.length} Jahreszeilen`
                    });
                    setScenarioProtocolHead({ label: scenarioLabel ? `Frühester Pflegeeintritt ${scenarioLabel}` : scenarioDisplayLabel(scenario),
                        years: scenario.logDataRows.length, failed: scenario.failed, moneyBasis });
                    output.style.display = 'block';
                    /** @type {BindInfoPopovers} */ (bindInfoPopovers)(document, { root: output });
                    window.globalCurrentScenarioData = {
                        personDataContext,
                        rows: scenario.logDataRows,
                        caR_Threshold: caR
                    };
                    exportButtons.style.display = 'flex';
                    renderScenarioAnalysis(document, scenario, { ...analysisOptions, moneyBasis });
                } else {
                    output.innerHTML = '<p class="ds-note" style="color: var(--text-muted); padding: 10px;">Keine Log-Daten für dieses Szenario verfügbar.</p>';
                    output.style.display = 'block';
                }
            } catch (error) {
                window.globalCurrentScenarioData = null;
                renderScenarioAnalysis(document, null);
                exportButtons.style.display = 'none';
                if (summary) summary.innerHTML = '';
                output.innerHTML = '<p class="ds-note ds-note-error" role="alert">Das Szenarioprotokoll konnte nicht angezeigt werden. Wähle ein anderes Szenario.</p>';
                output.style.display = 'block';
                console.error('Szenarioprotokoll fehlgeschlagen:', error);
            }
        };
        renderActiveScenario = () => renderSelectedScenario();

        // Liste, Navigation und SVG werden unten gemeinsam gebunden.

        // Event-Handler für Checkboxen (re-render bei Änderung)
        const careDetailsCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('toggle-care-details'));
        const logDetailCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('toggle-log-detail'));

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
        const jsonBtn = /** @type {HTMLButtonElement} */ (document.getElementById('exportScenarioLogJson'));
        const csvBtn = /** @type {HTMLButtonElement} */ (document.getElementById('exportScenarioLogCsv'));
        const projectCurrentScenarioForExport = () => {
            const rows = window.globalCurrentScenarioData?.rows;
            return Array.isArray(rows) ? projectScenarioLogV2(rows, { personDataContext: window.globalCurrentScenarioData.personDataContext }) : null;
        };
        // SD-1: Beide Knöpfe bleiben gesperrt, solange „Speichern unter“ offen ist.
        const saveScenarioExport = (filename, content, mimeType) => lockWhileSaving([jsonBtn, csvBtn], triggerDownload(filename, content, mimeType));
        const reportScenarioExportError = error => {
            console.error('Szenario-Export fehlgeschlagen:', error);
            showToast('Szenario-Export nicht möglich: Die Logdaten verletzen den V2-Vertrag.', { duration: 5000 });
        };

        if (jsonBtn) {
            jsonBtn.onclick = () => {
                try {
                    const exportDocument = projectCurrentScenarioForExport();
                    if (!exportDocument) return;
                    void saveScenarioExport('scenario-log-v2.json', serializeScenarioLogExportV2(exportDocument), 'application/json');
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
                    void saveScenarioExport('scenario-log-v2.csv', serializeScenarioLogCsvV2(exportDocument), 'text/csv;charset=utf-8;');
                } catch (error) {
                    reportScenarioExportError(error);
                }
            };
        }

        /** @type {BindScenarioLogView} */ (bindScenarioLogView)({
            document, logs: scenarioLogs,
            comparisonContext: buildComparisonContext({ results, totalRuns: anzahl, failCount, inputs }),
            chartOptions: { initialWealth: portfolioTotal(initializePortfolio(inputs || {})), initialHomes: (inputs?.home || []).reduce((sum, home) => sum + home.wert, 0), initialHomeSelf: (inputs?.home || []).filter(home => home.nutzung === 'selbst').reduce((sum, home) => sum + home.wert, 0), displayHomeValueFan: results?.displayHomeValueFan, startYear: displayContext.startYear, startAge: inputs?.startAlter, realByRun: results?.wealthView?.realByRun, wealthFan: results?.wealthFan, personDisplayContext },
            onSelect: renderSelectedScenario,
            onMode: renderMoney
        });

    } else if (scenarioContainer) {
        window.globalScenarioLogs = null;
        window.globalScenarioCarThreshold = null;
        scenarioContainer.style.display = 'none';
    }
    if (!scenarioLogs || !scenarioContainer) /** @type {BindScenarioLogView} */ (bindScenarioLogView)({ document, logs: null, onSelect: () => {}, onMode: renderMoney });

    // 6. Ergebnisinhalt bereitstellen. Die Sichtbarkeit der übergeordneten
    // Unteransicht wird ausschließlich vom MC-Cockpit gesteuert.
    document.getElementById('monteCarloResults').style.display = 'block';
}

/**
 * Rendert das Worst-Run-Log als Textausgabe
 *
 * @param [opts]
 * @returns Ergebnis der Operation.
 */
export function getWorstRunColumnDefinitions(opts = {}) {
    return getProtocolColumns({ ...opts, source: 'mc', compatibility: true });
}

/**
 * @param logRows
 * @param caR_Threshold
 * @param [opts]
 * @returns {string} Ergebnis der Operation.
 */
export function renderWorstRunLog(logRows, caR_Threshold, opts = {}) {
    return renderProtocolTable(logRows, { ...opts, source: 'mc', caRThreshold: caR_Threshold });
}

/**
 * Berechnet das Gesamtvermögen eines Portfolios
 *
 * @param p
 * @returns Ergebnis der Operation.
 */
export function portfolioTotal(p) {
    const sumTr = (arr) => Array.isArray(arr)
        ? arr.reduce((s, t) => s + (Number(t?.marketValue) || 0), 0)
        : 0;
    const total = sumTr(p?.depotTranchesAktien) + sumTr(p?.depotTranchesGold) + (Number(p?.liquiditaet) || 0)
        + (Number(p?.healthBucketGeldmarkt) || 0);
    // NK-2 (FR-84 Punkt 17): Nettovermögen; eine offene Steuerschuld mindert es höchstens bis null (ohne Schuld unverändert).
    const debt = Array.isArray(p?.personAccounts) ? p.personAccounts.reduce((sum, account) => sum + (account?.openTax > 0 ? account.openTax : 0), 0) : 0;
    return debt > 0 ? Math.max(0, total - debt) : total;
}
