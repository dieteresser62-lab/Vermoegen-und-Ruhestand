import { simulatorRunAssumptions } from './simulator-run-assumptions.js';
import { beginSimulationSummary, completeSimulationSummary } from './simulator-overview-summary.js';
import { personDataContextFor, readDocumentPersonInputs } from './simulator-person-overrides.js';
import { createProtocolPersonContext } from './protocol-columns.js';
import { projectMinimumFlexDisplay } from './results-metrics.js';
import { renderProtocolSummary } from './protocol-renderer.js';
import { renderBacktestAnalysis } from './backtest-log-analysis.js';
import { bindEuroMode, getEuroMode, resetEuroMode } from './euro-display.js';
import { backtestEuroBasis, backtestStartYear, projectBacktestEuroMetrics } from './backtest-euro-display.js';
"use strict";

import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { BREAK_ON_RUIN } from './simulator-data.js';
import { initializePortfolio, getCommonInputs } from './simulator-portfolio.js';
import { simulateOneYear } from './simulator-engine-wrapper.js';
import { formatDisplayPercentValue as formatPercentValue } from '../shared/shared-formatting.js';
import {
    BACKTEST_LOG_DETAIL_KEY,
    LEGACY_LOG_DETAIL_KEY,
    loadDetailLevel,
    persistDetailLevel,
    portfolioTotal
} from './simulator-results.js';
import { formatSimulatorValidationError, validateSimulatorInputs } from './simulator-input-validation.js';
import {
    buildBacktestColumnDefinitions,
    computeAdjPctForYear,
    formatColumnValue,
    triggerDownload
} from './simulator-main-helpers.js';
import { renderThreeBucketPortfolioChart, disposeThreeBucketPortfolioChart } from './simulator-portfolio-chart.js';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { formatCurrency } from './simulator-utils.js';
import { beginOverviewRun, completeOverviewRun, failOverviewRun, readOverviewAssumptions, setOverviewBacktestStatus } from './simulator-result-overview.js';
import { resolveDynamicFlexRunnerHorizon } from './dynamic-flex-runner-horizon.js';
import { createHistoricalBacktestContractProvider } from './historical-backtest-contract.js';
import { runHistoricalBacktest } from './historical-backtest-runner.js';
import {
    captureHistoricalBacktestEngineProvenance,
    createHistoricalBacktestDownload
} from './historical-backtest-export.js';
import {
    getRuntimeBuildProvenance,
    loadRuntimeBuildProvenance
} from '../shared/runtime-build-provenance.js';
import {
    buildAccessibleBacktestTableHtml,
    configureHistoricalBacktestControls,
    createBacktestUiStatus,
    describeHistoricalBacktestResult,
    escapeBacktestHtml,
    focusBacktestElement,
    renderHistoricalBacktestContext,
    renderHistoricalBacktestStatus,
    renderHistoricalBacktestValidation,
    validateHistoricalBacktestPeriod
} from './historical-backtest-ui.js';

const HISTORICAL_BACKTEST_PROVIDER = createHistoricalBacktestContractProvider();

const BACKTEST_RUNNING_STATUS = createBacktestUiStatus(
    'running',
    'BACKTEST_RUNNING',
    'Backtest läuft',
    'Der historische Zeitraum wird berechnet.',
    'Warte, bis der Backtest fertig ist.'
);

let activeBacktest = null;
let nextBacktestGeneration = 1;
let backtestRevision = 0;
const invalidatedHouseholds = new WeakSet();
const backtestRegistrations = new WeakMap();
const euroBindings = new WeakMap();
// Die Herkunft gehört zur veröffentlichten Instanz, nicht zur nächsten Vorbereitung.
const hasBacktestResult = () => ['completed', 'ruin'].includes(window.globalBacktestData?.result?.outcome?.kind)
    && window.globalBacktestData?.automatic !== true;

function backtestNavigationRegistration() {
    const doc = globalThis.document;
    if (!doc || typeof doc !== 'object') return null;
    if (!backtestRegistrations.has(doc)) {
        const guard = getPageNavigationGuard(doc);
        const registration = guard.register('simulator-backtest', {
            read: () => ({ phase: activeBacktest?.phase || 'idle',
                operationId: activeBacktest?.generationId || null,
                revision: backtestRevision, result: hasBacktestResult(),
                message: activeBacktest
                    ? 'Backtest: Laufende Vorbereitung wird abgebrochen – trotzdem wechseln?'
                        + (hasBacktestResult() ? '\nBacktest: Ergebnis geht verloren – trotzdem wechseln?' : '')
                    : 'Backtest: Ergebnis geht verloren – trotzdem wechseln?' }),
            cancel: () => cancelBacktestPreparation().then(() => true)
        });
        backtestRegistrations.set(doc, { guard, ...registration });
    }
    return backtestRegistrations.get(doc);
}

export function cancelBacktestPreparation() {
    const run = activeBacktest;
    if (!run?.promise) return Promise.resolve(false);
    if (run.cancelPromise) return run.cancelPromise;
    run.phase = 'cancelling';
    run.cancelled = true;
    failOverviewRun('backtest', 'cancelled');
    run.registration?.notify();
    run.cancelPromise = run.promise.then(() => true);
    return run.cancelPromise;
}

function canonicalAttribute(value) {
    if (value === null || value === undefined) return '';
    return escapeBacktestHtml(String(value));
}

function summaryItem({ label, displayValue, rawValue, displayRawValue = rawValue, otherBasisLine = '', metricId = null, resultField = null, className = '', compact = false }) {
    const attributes = [
        metricId ? `data-metric-id="${escapeBacktestHtml(metricId)}"` : '',
        resultField ? `data-result-field="${escapeBacktestHtml(resultField)}"` : '',
        `data-canonical-value="${canonicalAttribute(rawValue)}"`,
        `data-display-value="${canonicalAttribute(displayRawValue)}"`
    ].filter(Boolean).join(' ');
    // Visuell ganze Euro; Hilfstechnik liest ausschließlich den präzisen Geldbetrag.
    const valueMarkup = metricId?.endsWith('_eur') && Number.isFinite(displayRawValue)
        ? `<span aria-hidden="true">${escapeBacktestHtml(displayValue)}</span><span class="ds-visually-hidden">${escapeBacktestHtml(formatCurrency(displayRawValue))}</span>`
        : `<span>${escapeBacktestHtml(displayValue)}</span>`;
    return `<div class="summary-item ds-card ds-metric${compact ? ' sim-metric-row' : ''} ${escapeBacktestHtml(className)}" ${attributes}><strong>${escapeBacktestHtml(label)}</strong>${valueMarkup}${otherBasisLine ? `<small class="sim-other-basis">${escapeBacktestHtml(otherBasisLine)}</small>` : ''}</div>`;
}

function summaryPair(label, parts) {
    const values = parts.map(({ field, display, raw, title }) => `<span data-result-field="${field}" data-canonical-value="${canonicalAttribute(raw)}" title="${escapeBacktestHtml(title)}">${escapeBacktestHtml(display)}</span>`).join(' · ');
    return `<div class="summary-item ds-card ds-metric sim-metric-row"><strong>${escapeBacktestHtml(label)}</strong><span class="summary-pair">${values}</span></div>`;
}

function currencyOrDash(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value) : '—';
}

function renderBacktestSummary(result, moneyBasis = getEuroMode(document)) {
    const summaryElement = document.getElementById('simulationSummary');
    if (!summaryElement) return;
    const metrics = result?.metrics?.values || {};
    const bases = projectBacktestEuroMetrics(result);
    const display = bases[moneyBasis];
    const otherBasisLine = id => {
        const other = bases[moneyBasis === 'real' ? 'nominal' : 'real'][id];
        const label = moneyBasis === 'real' ? 'nominal' : `in Kaufkraft von ${backtestStartYear(result) ?? 'Laufstart'}`;
        return `${label} ${Number.isFinite(other) ? `etwa ${currencyOrDash(other)}` : 'unbekannt'}`;
    };
    const moneyItem = (label, id, compact = false) => summaryItem({ label,
        displayValue: currencyOrDash(display[id]), displayRawValue: display[id], rawValue: metrics[id], metricId: id,
        compact, otherBasisLine: compact ? '' : otherBasisLine(id) });
    const moreOpen = summaryElement.querySelector?.('.sim-backtest-more-metrics')?.open;
    const healthBucket = result?.summary?.healthBucket || {};
    const outcome = result?.outcome?.kind || 'technical_error';
    const outcomeLabel = {
        completed: 'Vollständig',
        ruin: 'Ruin',
        incomplete: 'Unvollständig',
        technical_error: 'Technischer Fehler'
    }[outcome] || outcome;
    const healthCoverage = typeof healthBucket.realCoveragePct === 'number' && Number.isFinite(healthBucket.realCoveragePct)
        ? formatPercentValue(healthBucket.realCoveragePct, { fractionDigits: 0, invalid: '—' })
        : '—';

    const restriction = projectMinimumFlexDisplay(result, { backtest: true });
    const restrictionValue = restriction.legacy
        ? `${metrics.flex_reduction_years_gte_10_pct ?? '—'} von ${result.completedYears ?? '—'} Jahren`
        : restriction.valid ? `${restriction.count} von ${restriction.observationCount} Jahren · ${restriction.value}` : '—';
    summaryElement.innerHTML = `<div class="summary-grid sim-backtest-primary">
        ${moneyItem('Endvermögen', 'wealth_end_nominal_eur')}
        ${moneyItem('Gesamte Entnahmen', 'withdrawal_total_nominal_eur')}
        <div class="summary-item ds-card ds-metric"><strong>${escapeBacktestHtml(restriction.title)}</strong><span>${escapeBacktestHtml(restrictionValue)}</span><small class="summary-description">${escapeBacktestHtml(restriction.legacy ? restriction.basisNote : restriction.valid ? '' : restriction.reason)}</small></div>
    </div><details class="ds-disclosure sim-backtest-more-metrics"${moreOpen ? ' open' : ''}><summary class="ds-disclosure-toggle"><span>Weitere Kennzahlen</span><span class="ds-slider" aria-hidden="true"></span></summary><div class="sim-metric-list sim-backtest-supplementary">
        ${summaryItem({ label: 'Ergebnis', displayValue: outcomeLabel, rawValue: outcome, resultField: 'outcome', compact: true })}
        ${summaryPair('Startjahr · Endjahr', [
            { field: 'period_start', display: result.request?.startYear ?? '—', raw: result.request?.startYear, title: 'Startjahr' },
            { field: 'period_end', display: result.request?.endYear ?? '—', raw: result.request?.endYear, title: 'Endjahr' }
        ])}
        ${summaryPair('Angeforderte · ausgewertete Jahre', [
            { field: 'requested_years', display: result.requestedYears ?? '—', raw: result.requestedYears, title: 'Angeforderte Jahre' },
            { field: 'completed_years', display: result.completedYears ?? '—', raw: result.completedYears, title: 'Wirtschaftlich ausgewertete Jahre' }
        ])}
        ${summaryItem({ label: 'Jahreszeilen', displayValue: result.rows?.length ?? 0, rawValue: result.rows?.length ?? 0, resultField: 'row_count', compact: true })}
        ${moneyItem('Startvermögen', 'wealth_start_nominal_eur', true)}
        ${summaryItem({ label: 'Max. Kürzungsdauer (≥ 10 %)', displayValue: `${metrics.flex_reduction_longest_streak_gte_10_pct ?? '—'} Jahre`, rawValue: metrics.flex_reduction_longest_streak_gte_10_pct, metricId: 'flex_reduction_longest_streak_gte_10_pct', compact: true })}
        ${summaryItem({ label: 'Jahre mit Kürzung (≥ 10 %)', displayValue: `${metrics.flex_reduction_years_gte_10_pct ?? '—'} von ${result.completedYears ?? '—'}`, rawValue: metrics.flex_reduction_years_gte_10_pct, metricId: 'flex_reduction_years_gte_10_pct', compact: true })}
        ${moneyItem('Gezahlte Steuern', 'tax_total_nominal_eur', true)}
        ${moneyItem(healthBucket.enabled ? 'Pflegebucket am Laufende (im Endvermögen enthalten)' : 'Pflegebucket am Laufende (deaktiviert; im Endvermögen enthalten)', 'health_bucket_end_nominal_eur', true)}
        ${summaryPair('Pflegereserve: Zieldeckung · Lücke', [
            { field: 'health_bucket_coverage_pct', display: healthCoverage, raw: healthBucket.realCoveragePct, title: 'Pflegebucket-Zieldeckung' },
            { field: 'health_bucket_target_gap', display: currencyOrDash(display.health_bucket_target_gap), raw: healthBucket.targetGap, title: `Pflegebucket-Ziellücke · ${backtestEuroBasis(result, moneyBasis)}` }
        ])}
    </div></details>`;
}

function setBacktestResultsVisible(visible) {
    const results = document.getElementById('simulationResults');
    if (results) results.style.display = visible ? 'contents' : 'none';
}

function setBacktestExportEnabled(enabled) {
    for (const id of ['exportBacktestJson', 'exportBacktestCsv']) {
        const button = document.getElementById(id);
        if (button) button.disabled = !enabled;
    }
}

function clearBacktestResultProjection() {
    renderBacktestAnalysis(document, null);
    const summary = document.getElementById('simulationSummary');
    const log = document.getElementById('simulationLog');
    const chart = document.getElementById('portfolioCompositionChart');
    if (summary) summary.innerHTML = '';
    if (log) { log.innerHTML = ''; log.textContent = 'Keine Daten'; }
    if (chart) { disposeThreeBucketPortfolioChart(chart); chart.innerHTML = ''; chart.style.display = 'none'; }
    for (const id of ['backtestProtocolSummary', 'backtestResultPeriod', 'backtestResultInfoPop']) {
        const element = document.getElementById(id);
        if (element) {
            element.innerHTML = '';
            if (element.dataset) delete element.dataset.personProfileIds;
        }
    }
    setBacktestResultsVisible(false);
    setBacktestExportEnabled(false);
}

/** Der wirksame Haushaltswechsel entzieht allen Detailprojektionen ihre Quelle. */
export function invalidateBacktestForHousehold() {
    backtestGeneration++;
    backtestRevision++;
    window.globalBacktestData = null;
    invalidatedHouseholds.add(document);
    clearBacktestResultProjection();
    renderInvalidatedBacktestStatus('idle');
    backtestNavigationRegistration()?.notify();
}

/** Statuswechsel haben nach der Invalidierung keine alte Resultatquelle mehr. */
export function renderInvalidatedBacktestStatus(phase) {
    if (!globalThis.document || !invalidatedHouseholds.has(document) || window.globalBacktestData) return;
    const titles = {
        idle: 'Haushalt geändert · neuer Backtest ausstehend',
        preparing: 'Neuer Backtest wird vorbereitet', running: 'Neuer Backtest läuft',
        skipped: 'Personendaten ergänzen · kein aktueller Backtest', blocked: 'Ersatzlauf gesperrt · kein aktueller Backtest',
        invalid: 'Eingaben prüfen · kein aktueller Backtest', missing: 'Daten fehlen · kein aktueller Backtest',
        technical_error: 'Ersatzlauf technisch abgebrochen · kein aktueller Backtest', cancelled: 'Ersatzlauf abgebrochen'
    };
    if (!titles[phase]) return;
    renderHistoricalBacktestStatus(document, createBacktestUiStatus(
        ['preparing', 'running'].includes(phase) ? 'running' : phase,
        'BACKTEST_HOUSEHOLD_CHANGED', titles[phase],
        'Der bisherige Backtest wurde verworfen. Für die aktuelle Auswahl liegt noch kein Ergebnis vor.',
        'Warte auf den Ersatzlauf oder prüfe die Personendaten und Eingaben.'
    ));
    if (phase === 'idle') {
        const chip = document.getElementById('backtestPeriodStatus');
        if (chip) chip.textContent = 'Neuer Backtest ausstehend';
    }
}

/**
 * Führt einen historischen Backtest durch.
 * Lesen und Schreiben erfolgen über den UI-Adapter; fachliche Abhängigkeiten sind für Browser-Gates injizierbar.
 */
export function runBacktest(options = {}) {
    const registration = backtestNavigationRegistration();
    if (activeBacktest || registration?.guard.isBusy()) return null;
    const run = { phase: 'running', generationId: `backtest-${nextBacktestGeneration++}` };
    activeBacktest = run;
    backtestRevision++;
    registration?.notify();
    try { return executeBacktest(options); } finally {
        activeBacktest = null;
        backtestRevision++;
        registration?.notify();
    }
}

let backtestGeneration = 0;
function executeBacktest(options = {}) {
    const generation = ++backtestGeneration;
    const contextRevision = simulatorRunAssumptions.read('backtest').contextRevision;
    const isCurrent = () => generation === backtestGeneration
        && contextRevision === simulatorRunAssumptions.read('backtest').contextRevision;
    const button = document.getElementById('btButton');
    try {
        if (button) button.disabled = true;
        const dependencies = options && typeof options === 'object' ? options : {};
        const historicalDataProvider = dependencies.historicalDataProvider || HISTORICAL_BACKTEST_PROVIDER;
        const validation = validateHistoricalBacktestPeriod({
            startRaw: document.getElementById('simStartJahr')?.value,
            endRaw: document.getElementById('simEndJahr')?.value,
            bounds: historicalDataProvider.bounds
        });
        renderHistoricalBacktestValidation(document, validation, { focus: dependencies.focus !== false });
        if (!validation.valid) {
            failOverviewRun('backtest', 'invalid', { name: 'SimulatorValidationError', errors: [{
                fieldId: validation.firstErrorFieldId, message: validation.errors[validation.firstErrorFieldId]
            }] });
            window.globalBacktestData = null;
            clearBacktestResultProjection();
            renderHistoricalBacktestStatus(document, createBacktestUiStatus(
                'validation_error',
                'BACKTEST_PERIOD_INVALID',
                'Zeitraum korrigieren',
                'Mindestens ein Zeitraumfeld ist leer, nicht ganzzahlig, rückwärts oder außerhalb der Datensatzgrenzen.',
                'Korrigiere das markierte Feld und starte den Backtest erneut.'
            ));
            return null;
        }

        renderHistoricalBacktestStatus(document, BACKTEST_RUNNING_STATUS);
        const inputs = (dependencies.validateInputs || validateSimulatorInputs)((dependencies.getInputs || getCommonInputs)());
        const personDataContext = personDataContextFor(inputs);
        const entries = readDocumentPersonInputs()?.entries || [];
        const personDisplayContext = createProtocolPersonContext(inputs, (personDataContext?.persons || []).map(person =>
            entries.find(entry => entry.profileId === person.profileId)));
        const overviewToken = beginOverviewRun('backtest', readOverviewAssumptions('backtest', inputs, {
            startYear: validation.startYear, endYear: validation.endYear
        }), { startedAt: new Date().toISOString(), automatic: dependencies.automatic === true,
            opening: dependencies.opening === true });
        const summaryContext = (dependencies.beginSimulationSummary || beginSimulationSummary)('backtest', inputs, { startYear: validation.startYear, endYear: validation.endYear });
        const engineApi = dependencies.engineApi || window?.EngineAPI;
        const runSinglePath = dependencies.runSinglePath || runHistoricalBacktest;
        const backtestResult = runSinglePath({
            inputs,
            period: { startYear: validation.startYear, endYear: validation.endYear },
            historicalDataProvider,
            simulateYear: dependencies.simulateYear || simulateOneYear,
            initializePortfolio: dependencies.initializePortfolio || initializePortfolio,
            computeAdjustmentPct: dependencies.computeAdjustmentPct || computeAdjPctForYear,
            resolveHorizon: dependencies.resolveHorizon || resolveDynamicFlexRunnerHorizon,
            totalPortfolio: dependencies.totalPortfolio || portfolioTotal,
            breakOnRuin: dependencies.breakOnRuin ?? BREAK_ON_RUIN,
            engineProvenance: captureHistoricalBacktestEngineProvenance(
                engineApi,
                dependencies.runtimeBuildProvenance ?? getRuntimeBuildProvenance()
            )
        });

        if (!isCurrent()) return null;
        // UI, Summary, Tabelle und Export teilen exakt diese immutable Runner-Instanz.
        window.globalBacktestData = Object.freeze({
            automatic: dependencies.automatic === true,
            personDataContext,
            personDisplayContext,
            result: backtestResult,
            rows: backtestResult.rows,
            startJahr: validation.startYear,
            schemaVersion: backtestResult.schemaVersion,
            outcome: backtestResult.outcome,
            requestedYears: backtestResult.requestedYears,
            completedYears: backtestResult.completedYears,
            breakOnRuin: backtestResult.breakOnRuin,
            decumulationMode: inputs?.decumulation?.mode || STRATEGY_OPTIONS.STANDARD,
            goldAktiv: inputs?.goldAktiv,
            minimumFlexProfiles: Array.isArray(inputs?.minimumFlexProfiles)
                ? inputs.minimumFlexProfiles.map(entry => ({ ...entry }))
                : []
        });

        if (['completed', 'ruin'].includes(backtestResult.outcome?.kind)) {
            resetEuroMode(document);
            invalidatedHouseholds.delete(document);
            setBacktestResultsVisible(true);
            setBacktestExportEnabled(true);
            renderHistoricalBacktestContext(document, backtestResult);
            renderBacktestLog();
            renderBacktestEuroResults();
            completeOverviewRun('backtest', overviewToken, backtestResult);
            if (generation === backtestGeneration && simulatorRunAssumptions.read('backtest').last?.metadata === overviewToken.metadata) {
                void (dependencies.completeSimulationSummary || completeSimulationSummary)(summaryContext, backtestResult, {},
                    { isCurrent });
            }
        } else {
            if (invalidatedHouseholds.has(document)) window.globalBacktestData = null;
            clearBacktestResultProjection();
            failOverviewRun('backtest', backtestResult.outcome?.kind === 'incomplete' ? 'missing' : 'technical_error');
        }
        renderHistoricalBacktestStatus(document, describeHistoricalBacktestResult(backtestResult), { focus: dependencies.focus !== false });
        return backtestResult;
    } catch (error) {
        window.globalBacktestData = null;
        clearBacktestResultProjection();
        const isInputValidation = error?.name === 'SimulatorValidationError';
        failOverviewRun('backtest', isInputValidation ? 'invalid' : 'technical_error', error);
        renderHistoricalBacktestStatus(document, createBacktestUiStatus(
            isInputValidation ? 'validation_error' : 'technical_error',
            isInputValidation ? 'BACKTEST_INPUT_INVALID' : 'BACKTEST_UI_EXCEPTION',
            isInputValidation ? 'Simulator-Eingabe korrigieren' : 'Backtest technisch abgebrochen',
            isInputValidation
                ? formatSimulatorValidationError(error)
                : 'Die Eingaben oder der Lauf konnten technisch nicht sicher verarbeitet werden.',
            isInputValidation
                ? 'Korrigiere die betroffene Simulator-Eingabe und starte erneut.'
                : 'Prüfe die Eingaben und starte erneut. Bleibt der Code bestehen, melde ihn zur Diagnose.'
        ), { focus: !isInputValidation && options.focus !== false });
        if (isInputValidation && options.focus !== false) focusBacktestElement(document, error?.errors?.[0]?.fieldId);
        return null;
    } finally {
        if (button) button.disabled = false;
    }
}

export function whenBacktestIdle() { return activeBacktest?.promise || Promise.resolve(null); }

export function runBacktestWithRuntimeProvenance(options = {}) {
    if (activeBacktest) return activeBacktest.promise || Promise.resolve(null);
    const registration = backtestNavigationRegistration();
    if (registration?.guard.isBusy()) return Promise.resolve(null);
    const dependencies = options && typeof options === 'object' ? options : {};
    const loader = dependencies.loadRuntimeBuildProvenance || loadRuntimeBuildProvenance;
    const button = document.getElementById('btButton');
    const contextRevision = simulatorRunAssumptions.read('backtest').contextRevision;
    const contextChanged = () => contextRevision !== simulatorRunAssumptions.read('backtest').contextRevision;
    const run = { phase: 'preparing', cancelled: false, registration,
        generationId: `backtest-${nextBacktestGeneration++}` };
    activeBacktest = run;
    setOverviewBacktestStatus('preparing');
    backtestRevision++;
    if (button) button.disabled = true;
    run.promise = Promise.resolve().then(async () => {
        if (run.cancelled) return null;
        let runtimeBuildProvenance = null;
        try { runtimeBuildProvenance = await loader({ force: true }); } catch {
            runtimeBuildProvenance = null;
        }
        if (run.cancelled || contextChanged()) return null;
        // Der automatische Pfad zeichnet vor dem unveränderten synchronen Runner.
        run.phase = 'running';
        registration?.notify();
        setOverviewBacktestStatus('running');
        if (dependencies.beforeRun) await dependencies.beforeRun();
        if (contextChanged()) return null;
        if (run.cancelled) { failOverviewRun('backtest', 'cancelled'); return null; }
        if (dependencies.automatic && (dependencies.isBlocked?.() || window.__profileRecoveryBlocker)) {
            failOverviewRun('backtest', 'blocked'); return null;
        }
        if (dependencies.automatic && typeof (dependencies.engineApi || window.EngineAPI)?.simulateSingleYear !== 'function') {
            failOverviewRun('backtest', 'technical_error'); return null;
        }
        const result = executeBacktest({ ...dependencies, runtimeBuildProvenance });
        backtestRevision++;
        return result;
    }).finally(() => {
        if (activeBacktest === run) activeBacktest = null;
        if (button) button.disabled = false;
        registration?.notify();
    });
    registration?.notify();
    return run.promise;
}

/**
 * Rendert die Backtest-Logtabelle basierend auf dem gespeicherten Log-Level.
 * Nutzt die zuvor abgelegten globalBacktestData, um Re-Renders ohne erneuten Lauf zu ermöglichen.
 */
export function renderBacktestLog() {
    if (!window.globalBacktestData || !Array.isArray(window.globalBacktestData.rows)) {
        return;
    }

    const logDetailLevel = loadDetailLevel(BACKTEST_LOG_DETAIL_KEY, LEGACY_LOG_DETAIL_KEY);
    const { rows: logRows } = window.globalBacktestData;
    const columns = buildBacktestColumnDefinitions(logDetailLevel, {
        display: true,
        moneyBasis: getEuroMode(document),
        strategyMode: window.globalBacktestData?.decumulationMode,
        personDisplayContext: window.globalBacktestData?.personDisplayContext,
        goldAktiv: window.globalBacktestData?.goldAktiv
    });

    const logElement = document.getElementById('simulationLog');
    if (logElement) logElement.innerHTML = buildAccessibleBacktestTableHtml(
        logRows,
        columns,
        formatColumnValue,
        { startYear: window.globalBacktestData.result?.request?.startYear ?? window.globalBacktestData.startJahr,
            inputs: window.globalBacktestData.result?.request?.inputs,
            personDisplayContext: window.globalBacktestData?.personDisplayContext,
            moneyBasis: getEuroMode(document) }
    );
    const protocolSummary = document.getElementById('backtestProtocolSummary');
    if (protocolSummary) {
        if (protocolSummary.dataset) protocolSummary.dataset.personProfileIds =
            (window.globalBacktestData.personDataContext?.persons || []).map(person => person.profileId).join(',');
        protocolSummary.innerHTML = renderProtocolSummary(logRows, {
            personDataContext: window.globalBacktestData.personDataContext,
            source: 'backtest', outcome: window.globalBacktestData.result?.outcome,
            moneyBasis: getEuroMode(document),
            endWealth: projectBacktestEuroMetrics(window.globalBacktestData.result)[getEuroMode(document)].wealth_end_nominal_eur,
            subtitle: `${window.globalBacktestData.result?.request?.startYear ?? '—'}–${window.globalBacktestData.result?.request?.endYear ?? '—'} · ${logRows.length} Jahreszeilen · ${backtestEuroBasis(window.globalBacktestData.result, getEuroMode(document))}`
        });
    }
    renderBacktestChart();
}

function renderBacktestChart() {
    const data = window.globalBacktestData;
    if (!data?.result) return;
    const moneyBasis = getEuroMode(document);
    const chartContainer = document.getElementById('portfolioCompositionChart');
    if (chartContainer) {
        chartContainer.style.display = 'block';
        chartContainer.setAttribute?.('aria-label', `Portfolioverlauf des Backtests, ${backtestEuroBasis(data.result, moneyBasis)}, ohne Pflegebucket; horizontal scrollbar`);
        renderThreeBucketPortfolioChart(chartContainer, data.rows, { analysisData: data, result: data.result, moneyBasis,
            annotationToggle: document.getElementById('backtestChartAnnotations') });
    }
}

/** Der Euro-Wechsel projiziert nur Anzeigen und startet keinen Backtest. */
export function renderBacktestEuroResults() {
    const result = window.globalBacktestData?.result;
    const moneyBasis = getEuroMode(document);
    const basis = backtestEuroBasis(result, moneyBasis);
    for (const [id, text] of [['backtestResultHeading', `Kennzahlen · ${basis}`],
        ['backtestChartHeading', `Portfolioverlauf · ${basis}`],
        ['backtestLogHeading', `Backtest-Protokoll · ${basis}`]]) {
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    }
    if (!result || !['completed', 'ruin'].includes(result.outcome?.kind)) return;
    renderBacktestSummary(result, moneyBasis);
    renderBacktestLog();
    renderBacktestAnalysis(document, window.globalBacktestData, { moneyBasis });
}

/**
 * Exportiert die Backtest-Logdaten im JSON- oder CSV-Format.
 * Validiert Eingaben defensiv und belässt Fehlermeldungen unverändert zur UI-Kompatibilität.
 * @param {'json'|'csv'} format - Gewünschtes Exportformat.
 */
export function exportBacktestLogData(format = 'json') {
    const backtestData = window.globalBacktestData;
    if (!backtestData?.result) {
        renderHistoricalBacktestStatus(document, createBacktestUiStatus(
            'technical_error',
            'BACKTEST_EXPORT_RESULT_MISSING',
            'Kein Backtest für den Export vorhanden',
            'Es liegt noch kein Backtest-Ergebnis vor.',
            'Führe zuerst einen vollständigen Backtest aus.'
        ), { focus: true });
        return;
    }

    try {
        const download = createHistoricalBacktestDownload(backtestData.result, format, {
            personDataContext: backtestData.personDataContext
        });
        triggerDownload(download.filename, download.content, download.mimeType);
    } catch (error) {
        const known = {
            HISTORICAL_EXPORT_SOURCE_COMMIT_REQUIRED: {
                title: 'Quellstand des Backtests fehlt',
                summary: 'Der JSON-Export benötigt den beim Lauf erfassten exakten Source-Commit.',
                action: 'Starte die Suite über den lokalen Server oder einen gültigen Desktop-Build und führe den Backtest danach neu aus.'
            },
            HISTORICAL_EXPORT_SOURCE_TREE_DIRTY: {
                title: 'Quellstand des Backtests ist nicht sauber',
                summary: `Der JSON-Export ist für den erfassten Quellbaumstatus „${error?.details?.sourceTreeStatus || 'unbekannt'}“ gesperrt.`,
                action: 'Verwende einen aus einem sauberen Commit gestarteten beziehungsweise erzeugten Build.'
            },
            HISTORICAL_EXPORT_QUANTIZATION_CONTRACT_REQUIRED: {
                title: 'Quantisierungsvertrag fehlt oder ist ungültig',
                summary: 'Der JSON-Export kann die beim Lauf verwendeten Rundungsregeln nicht vollständig belegen.',
                action: 'Aktualisiere Anwendung und Engine gemeinsam und führe den Backtest erneut aus.'
            },
            HISTORICAL_EXPORT_PORTFOLIO_BOUNDARY_MISMATCH: {
                title: 'Portfoliogrenzen sind widersprüchlich',
                summary: 'Kanonische Metrik und unabhängige Jahreszeile stimmen nicht überein.',
                action: 'Verwende dieses Ergebnis nicht weiter und melde den angezeigten Fehlercode.'
            },
            HISTORICAL_EXPORT_PERIOD_LENGTH_MISMATCH: {
                title: 'Backtestzeitraum ist widersprüchlich',
                summary: 'Angeforderte Jahreszahl und inklusive Kalenderperiode stimmen nicht überein.',
                action: 'Verwende dieses Ergebnis nicht weiter und melde den angezeigten Fehlercode.'
            }
        }[error?.code];
        renderHistoricalBacktestStatus(document, createBacktestUiStatus(
            'technical_error',
            known ? error.code : 'BACKTEST_EXPORT_FAILED',
            known?.title || 'Backtest-Export fehlgeschlagen',
            known?.summary || `Der ${format.toUpperCase()}-Export konnte technisch nicht erstellt werden.`,
            known?.action || 'Melde den angezeigten Fehlercode zur Diagnose.'
        ), { focus: true });
    }
}

function bindBacktestEventOnce(element, eventName, key, handler) {
    if (!element) return;
    if (!element.dataset) element.dataset = {};
    const marker = `backtestBound${key}`;
    if (element.dataset[marker] === 'true') return;
    element.addEventListener(eventName, handler);
    element.dataset[marker] = 'true';
}

function clearBacktestFieldError(fieldId, errorId) {
    const field = document.getElementById(fieldId);
    const error = document.getElementById(errorId);
    if (typeof field?.removeAttribute === 'function') field.removeAttribute('aria-invalid');
    else if (field) delete field['aria-invalid'];
    if (error) {
        error.textContent = '';
        error.hidden = true;
    }
}

/**
 * Registriert UI-spezifische Backtest-Handler (Detail-Level und Export).
 * Diese Logik wurde extrahiert, um Simulator-Main zu entlasten und Wiederverwendung zu vereinfachen.
 */
export function initializeBacktestUI() {
    backtestNavigationRegistration();
    euroBindings.get(document)?.();
    euroBindings.set(document, bindEuroMode(document, document.getElementById('backtestWealthMode'), renderBacktestEuroResults));
    configureHistoricalBacktestControls(document, HISTORICAL_BACKTEST_PROVIDER);
    setBacktestExportEnabled(Boolean(window.globalBacktestData?.result));

    const startButton = document.getElementById('btButton');
    bindBacktestEventOnce(startButton, 'click', 'Start', () => {
        void runBacktestWithRuntimeProvenance();
    });

    for (const [fieldId, errorId] of [
        ['simStartJahr', 'simStartJahrError'],
        ['simEndJahr', 'simEndJahrError']
    ]) {
        const field = document.getElementById(fieldId);
        bindBacktestEventOnce(field, 'input', `Clear${fieldId}`, () => clearBacktestFieldError(fieldId, errorId));
    }

    const backtestDetailCheckbox = document.getElementById('toggle-backtest-detail');
    if (backtestDetailCheckbox) {
        backtestDetailCheckbox.checked = loadDetailLevel(BACKTEST_LOG_DETAIL_KEY, LEGACY_LOG_DETAIL_KEY) === 'detailed';
        bindBacktestEventOnce(backtestDetailCheckbox, 'change', 'Detail', (event) => {
            const detailLevel = (event.currentTarget || backtestDetailCheckbox).checked ? 'detailed' : 'normal';
            // Backtest detail level is isolated to keep the worst-case log unchanged.
            persistDetailLevel(BACKTEST_LOG_DETAIL_KEY, detailLevel);

            // Re-render Backtest-Log mit neuem Detail-Level
            if (typeof window.renderBacktestLog === 'function') {
                window.renderBacktestLog();
            } else {
                renderBacktestLog();
            }
        });
    }

    const exportBacktestJsonBtn = document.getElementById('exportBacktestJson');
    bindBacktestEventOnce(exportBacktestJsonBtn, 'click', 'ExportJson', () => exportBacktestLogData('json'));
    const exportBacktestCsvBtn = document.getElementById('exportBacktestCsv');
    bindBacktestEventOnce(exportBacktestCsvBtn, 'click', 'ExportCsv', () => exportBacktestLogData('csv'));
}
