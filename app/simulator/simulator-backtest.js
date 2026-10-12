import { simulatorRunAssumptions } from './simulator-run-assumptions.js';
import { beginSimulationSummary, completeSimulationSummary } from './simulator-overview-summary.js';
import { personDataContextFor } from './simulator-person-overrides.js';
import { renderProtocolSummary } from './protocol-renderer.js';
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
import { runHistoricalBacktestCohorts } from './historical-backtest-cohorts.js';
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
    createImmutableCohortInventory,
    describeHistoricalBacktestResult,
    escapeBacktestHtml,
    focusBacktestElement,
    renderHistoricalBacktestCohorts,
    renderHistoricalBacktestNotices,
    renderHistoricalBacktestStatus,
    renderHistoricalBacktestValidation,
    validateHistoricalBacktestPeriod
} from './historical-backtest-ui.js';

const HISTORICAL_BACKTEST_PROVIDER = createHistoricalBacktestContractProvider();

const BACKTEST_RUNNING_STATUS = createBacktestUiStatus(
    'running',
    'BACKTEST_RUNNING',
    'Backtest läuft',
    'Der kanonische historische Lauf wird berechnet.',
    'Warten Sie auf den fachlichen Endstatus.'
);

let activeBacktest = null;
let nextBacktestGeneration = 1;
let backtestRevision = 0;
const invalidatedHouseholds = new WeakSet();
const backtestRegistrations = new WeakMap();
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

function summaryItem({ label, displayValue, rawValue, metricId = null, resultField = null, className = '' }) {
    const attributes = [
        metricId ? `data-metric-id="${escapeBacktestHtml(metricId)}"` : '',
        resultField ? `data-result-field="${escapeBacktestHtml(resultField)}"` : '',
        `data-canonical-value="${canonicalAttribute(rawValue)}"`
    ].filter(Boolean).join(' ');
    // Visuell ganze Euro; Hilfstechnik liest ausschließlich den präzisen Geldbetrag.
    const valueMarkup = metricId?.endsWith('_eur') && Number.isFinite(rawValue)
        ? `<span aria-hidden="true">${escapeBacktestHtml(displayValue)}</span><span class="ds-visually-hidden">${escapeBacktestHtml(formatCurrency(rawValue))}</span>`
        : `<span>${escapeBacktestHtml(displayValue)}</span>`;
    return `<div class="summary-item ds-card ds-metric ${escapeBacktestHtml(className)}" ${attributes}><strong>${escapeBacktestHtml(label)}</strong>${valueMarkup}</div>`;
}

function summaryPair(label, parts) {
    const values = parts.map(({ field, display, raw, title }) => `<span data-result-field="${field}" data-canonical-value="${canonicalAttribute(raw)}" title="${escapeBacktestHtml(title)}">${escapeBacktestHtml(display)}</span>`).join(' · ');
    return `<div class="summary-item ds-card ds-metric"><strong>${escapeBacktestHtml(label)}</strong><span class="summary-pair">${values}</span></div>`;
}

function currencyOrDash(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value) : '—';
}

function renderBacktestSummary(result) {
    const summaryElement = document.getElementById('simulationSummary');
    if (!summaryElement) return;
    const metrics = result?.metrics?.values || {};
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

    const caption = document.getElementById('backtestResultPeriod');
    if (caption) caption.textContent = `${result.request?.startYear ?? '—'}–${result.request?.endYear ?? '—'} · ${result.completedYears ?? 0} von ${result.requestedYears ?? 0} Jahren ausgewertet`;
    summaryElement.innerHTML = `<div class="summary-grid">
        ${summaryItem({ label: 'Ergebnis', displayValue: outcomeLabel, rawValue: outcome, resultField: 'outcome', className: `backtest-outcome-${outcome}` })}
        ${summaryPair('Startjahr · Endjahr', [
            { field: 'period_start', display: result.request?.startYear ?? '—', raw: result.request?.startYear, title: 'Startjahr' },
            { field: 'period_end', display: result.request?.endYear ?? '—', raw: result.request?.endYear, title: 'Endjahr' }
        ])}
        ${summaryPair('Angeforderte · ausgewertete Jahre', [
            { field: 'requested_years', display: result.requestedYears ?? '—', raw: result.requestedYears, title: 'Angeforderte Jahre' },
            { field: 'completed_years', display: result.completedYears ?? '—', raw: result.completedYears, title: 'Wirtschaftlich ausgewertete Jahre' }
        ])}
        ${summaryItem({ label: 'Jahreszeilen', displayValue: result.rows?.length ?? 0, rawValue: result.rows?.length ?? 0, resultField: 'row_count' })}
        ${summaryItem({ label: 'Startvermögen', displayValue: currencyOrDash(metrics.wealth_start_nominal_eur), rawValue: metrics.wealth_start_nominal_eur, metricId: 'wealth_start_nominal_eur' })}
        ${summaryItem({ label: 'Endvermögen', displayValue: currencyOrDash(metrics.wealth_end_nominal_eur), rawValue: metrics.wealth_end_nominal_eur, metricId: 'wealth_end_nominal_eur' })}
        ${summaryItem({ label: 'Gesamte Entnahmen', displayValue: currencyOrDash(metrics.withdrawal_total_nominal_eur), rawValue: metrics.withdrawal_total_nominal_eur, metricId: 'withdrawal_total_nominal_eur', className: 'highlight' })}
        ${summaryItem({ label: 'Max. Kürzungsdauer (≥ 10 %)', displayValue: `${metrics.flex_reduction_longest_streak_gte_10_pct ?? '—'} Jahre`, rawValue: metrics.flex_reduction_longest_streak_gte_10_pct, metricId: 'flex_reduction_longest_streak_gte_10_pct' })}
        ${summaryItem({ label: 'Jahre mit Kürzung (≥ 10 %)', displayValue: `${metrics.flex_reduction_years_gte_10_pct ?? '—'} von ${result.completedYears ?? '—'}`, rawValue: metrics.flex_reduction_years_gte_10_pct, metricId: 'flex_reduction_years_gte_10_pct' })}
        ${summaryItem({ label: 'Gezahlte Steuern', displayValue: currencyOrDash(metrics.tax_total_nominal_eur), rawValue: metrics.tax_total_nominal_eur, metricId: 'tax_total_nominal_eur', className: 'tax' })}
        ${summaryItem({ label: healthBucket.enabled ? 'Pflegebucket am Laufende (im Endvermögen enthalten)' : 'Pflegebucket am Laufende (deaktiviert; im Endvermögen enthalten)', displayValue: currencyOrDash(metrics.health_bucket_end_nominal_eur), rawValue: metrics.health_bucket_end_nominal_eur, metricId: 'health_bucket_end_nominal_eur' })}
        ${summaryPair('Pflegereserve: Zieldeckung · Lücke', [
            { field: 'health_bucket_coverage_pct', display: healthCoverage, raw: healthBucket.realCoveragePct, title: 'Pflegebucket-Zieldeckung' },
            { field: 'health_bucket_target_gap', display: currencyOrDash(healthBucket.targetGap), raw: healthBucket.targetGap, title: 'Pflegebucket-Ziellücke' }
        ])}
    </div>`;
}

function setBacktestResultsVisible(visible) {
    const results = document.getElementById('simulationResults');
    if (results) results.style.display = visible ? 'block' : 'none';
}

function setBacktestExportEnabled(enabled) {
    for (const id of ['exportBacktestJson', 'exportBacktestCsv']) {
        const button = document.getElementById(id);
        if (button) button.disabled = !enabled;
    }
}

function clearBacktestResultProjection() {
    const summary = document.getElementById('simulationSummary');
    const log = document.getElementById('simulationLog');
    const chart = document.getElementById('portfolioCompositionChart');
    if (summary) summary.innerHTML = '';
    if (log) { log.innerHTML = ''; log.textContent = 'Keine Daten'; }
    if (chart) { disposeThreeBucketPortfolioChart(chart); chart.innerHTML = ''; chart.style.display = 'none'; }
    for (const id of ['backtestProtocolSummary', 'backtestResultPeriod']) {
        const element = document.getElementById(id);
        if (element) {
            element.innerHTML = '';
            if (element.dataset) delete element.dataset.personProfileIds;
        }
    }
    renderHistoricalBacktestCohorts(document, null, null);
    setBacktestResultsVisible(false);
    setBacktestExportEnabled(false);
}

function clearBacktestNotices() {
    const section = document.getElementById('backtestNotices');
    const list = document.getElementById('backtestNoticeList');
    if (section) section.hidden = true;
    if (list) list.innerHTML = '';
}

/** Der wirksame Haushaltswechsel entzieht allen Detailprojektionen ihre Quelle. */
export function invalidateBacktestForHousehold() {
    backtestGeneration++;
    backtestRevision++;
    window.globalBacktestData = null;
    invalidatedHouseholds.add(document);
    clearBacktestResultProjection();
    clearBacktestNotices();
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
        'Warten Sie auf den Ersatzlauf oder prüfen Sie die Personendaten und Eingaben.'
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
        clearBacktestNotices();
        const dependencies = options && typeof options === 'object' ? options : {};
        const historicalDataProvider = dependencies.historicalDataProvider || HISTORICAL_BACKTEST_PROVIDER;
        const cohortCheckbox = document.getElementById('runBacktestCohorts');
        const cohortHorizonInput = document.getElementById('backtestCohortHorizon');
        const validation = validateHistoricalBacktestPeriod({
            startRaw: document.getElementById('simStartJahr')?.value,
            endRaw: document.getElementById('simEndJahr')?.value,
            bounds: historicalDataProvider.bounds,
            cohortsEnabled: dependencies.cohortsEnabled ?? Boolean(cohortCheckbox?.checked),
            cohortHorizonRaw: cohortHorizonInput?.value
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
                'Korrigieren Sie das markierte Feld und starten Sie den Backtest erneut.'
            ));
            return null;
        }

        renderHistoricalBacktestStatus(document, BACKTEST_RUNNING_STATUS);
        const inputs = (dependencies.validateInputs || validateSimulatorInputs)((dependencies.getInputs || getCommonInputs)());
        const personDataContext = personDataContextFor(inputs);
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

        let cohortInventory = null;
        if (validation.cohortsEnabled && ['completed', 'ruin'].includes(backtestResult.outcome?.kind)) {
            const runCohorts = dependencies.runCohorts || runHistoricalBacktestCohorts;
            const cohortResult = runCohorts({
                inputs,
                range: { startYear: validation.startYear, endYear: validation.endYear },
                cohortHorizonYears: validation.cohortHorizonYears,
                historicalDataProvider,
                simulateYear: dependencies.simulateYear || simulateOneYear,
                initializePortfolio: dependencies.initializePortfolio || initializePortfolio,
                computeAdjustmentPct: dependencies.computeAdjustmentPct || computeAdjPctForYear,
                resolveHorizon: dependencies.resolveHorizon || resolveDynamicFlexRunnerHorizon,
                totalPortfolio: dependencies.totalPortfolio || portfolioTotal,
                breakOnRuin: dependencies.breakOnRuin ?? BREAK_ON_RUIN,
                runSinglePath
            });
            cohortInventory = createImmutableCohortInventory(cohortResult.inventory);
        }

        if (!isCurrent()) return null;
        // UI, Summary, Tabelle und Export teilen exakt diese immutable Runner-Instanz.
        window.globalBacktestData = Object.freeze({
            automatic: dependencies.automatic === true,
            personDataContext,
            result: backtestResult,
            rows: backtestResult.rows,
            startJahr: validation.startYear,
            schemaVersion: backtestResult.schemaVersion,
            outcome: backtestResult.outcome,
            requestedYears: backtestResult.requestedYears,
            completedYears: backtestResult.completedYears,
            breakOnRuin: backtestResult.breakOnRuin,
            ...(cohortInventory ? {
                cohortInventory,
                cohortHorizonYears: validation.cohortHorizonYears
            } : {}),
            decumulationMode: inputs?.decumulation?.mode || STRATEGY_OPTIONS.STANDARD,
            goldAktiv: inputs?.goldAktiv,
            minimumFlexProfiles: Array.isArray(inputs?.minimumFlexProfiles)
                ? inputs.minimumFlexProfiles.map(entry => ({ ...entry }))
                : []
        });
        renderHistoricalBacktestStatus(document, describeHistoricalBacktestResult(backtestResult), { focus: dependencies.focus !== false });
        renderHistoricalBacktestNotices(document, backtestResult, cohortInventory);

        if (['completed', 'ruin'].includes(backtestResult.outcome?.kind)) {
            invalidatedHouseholds.delete(document);
            setBacktestResultsVisible(true);
            setBacktestExportEnabled(true);
            renderBacktestSummary(backtestResult);
            renderHistoricalBacktestCohorts(document, cohortInventory, validation.cohortHorizonYears);
            renderBacktestLog();
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
                ? 'Korrigieren Sie die betroffene Simulator-Eingabe und starten Sie erneut.'
                : 'Prüfen Sie die Eingaben und starten Sie erneut. Bleibt der Code bestehen, melden Sie ihn zur Diagnose.'
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
        strategyMode: window.globalBacktestData?.decumulationMode,
        goldAktiv: window.globalBacktestData?.goldAktiv
    });

    document.getElementById('simulationLog').innerHTML = buildAccessibleBacktestTableHtml(
        logRows,
        columns,
        formatColumnValue,
        { startYear: window.globalBacktestData.result?.request?.startYear ?? window.globalBacktestData.startJahr,
            inputs: window.globalBacktestData.result?.request?.inputs }
    );
    const protocolSummary = document.getElementById('backtestProtocolSummary');
    if (protocolSummary) {
        if (protocolSummary.dataset) protocolSummary.dataset.personProfileIds =
            (window.globalBacktestData.personDataContext?.persons || []).map(person => person.profileId).join(',');
        protocolSummary.innerHTML = renderProtocolSummary(logRows, {
            personDataContext: window.globalBacktestData.personDataContext,
            source: 'backtest', outcome: window.globalBacktestData.result?.outcome,
            endWealth: window.globalBacktestData.result?.metrics?.values?.wealth_end_nominal_eur,
            subtitle: `${window.globalBacktestData.result?.request?.startYear ?? '—'}–${window.globalBacktestData.result?.request?.endYear ?? '—'} · ${logRows.length} Jahreszeilen · nominale Euro`
        });
    }
    const chartContainer = document.getElementById('portfolioCompositionChart');
    if (chartContainer) {
        chartContainer.style.display = 'block';
        renderThreeBucketPortfolioChart(chartContainer, logRows);
    }
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
            'Es liegt kein kanonisches Backtest-Resultat vor.',
            'Führen Sie zuerst einen vollständigen Backtest aus.'
        ), { focus: true });
        return;
    }

    try {
        const download = createHistoricalBacktestDownload(backtestData.result, format, {
            personDataContext: backtestData.personDataContext,
            cohortInventory: backtestData.cohortInventory
        });
        triggerDownload(download.filename, download.content, download.mimeType);
    } catch (error) {
        const known = {
            HISTORICAL_EXPORT_SOURCE_COMMIT_REQUIRED: {
                title: 'Quellstand des Backtests fehlt',
                summary: 'Der JSON-Export benötigt den beim Lauf erfassten exakten Source-Commit.',
                action: 'Starten Sie die Suite über den lokalen Server oder einen gültigen Desktop-Build und führen Sie den Backtest danach neu aus.'
            },
            HISTORICAL_EXPORT_SOURCE_TREE_DIRTY: {
                title: 'Quellstand des Backtests ist nicht sauber',
                summary: `Der JSON-Export ist für den erfassten Quellbaumstatus „${error?.details?.sourceTreeStatus || 'unbekannt'}“ gesperrt.`,
                action: 'Verwenden Sie einen aus einem sauberen Commit gestarteten beziehungsweise erzeugten Build.'
            },
            HISTORICAL_EXPORT_QUANTIZATION_CONTRACT_REQUIRED: {
                title: 'Quantisierungsvertrag fehlt oder ist ungültig',
                summary: 'Der JSON-Export kann die beim Lauf verwendeten Rundungsregeln nicht vollständig belegen.',
                action: 'Aktualisieren Sie Anwendung und Engine gemeinsam und führen Sie den Backtest erneut aus.'
            },
            HISTORICAL_EXPORT_PORTFOLIO_BOUNDARY_MISMATCH: {
                title: 'Portfoliogrenzen sind widersprüchlich',
                summary: 'Kanonische Metrik und unabhängige Jahreszeile stimmen nicht überein.',
                action: 'Verwenden Sie dieses Ergebnis nicht weiter und melden Sie den angezeigten Fehlercode.'
            },
            HISTORICAL_EXPORT_PERIOD_LENGTH_MISMATCH: {
                title: 'Backtestzeitraum ist widersprüchlich',
                summary: 'Angeforderte Jahreszahl und inklusive Kalenderperiode stimmen nicht überein.',
                action: 'Verwenden Sie dieses Ergebnis nicht weiter und melden Sie den angezeigten Fehlercode.'
            }
        }[error?.code];
        renderHistoricalBacktestStatus(document, createBacktestUiStatus(
            'technical_error',
            known ? error.code : 'BACKTEST_EXPORT_FAILED',
            known?.title || 'Backtest-Export fehlgeschlagen',
            known?.summary || `Der ${format.toUpperCase()}-Export konnte technisch nicht erstellt werden.`,
            known?.action || 'Melden Sie den angezeigten Fehlercode zur Diagnose.'
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
    configureHistoricalBacktestControls(document, HISTORICAL_BACKTEST_PROVIDER);
    setBacktestExportEnabled(Boolean(window.globalBacktestData?.result));

    const startButton = document.getElementById('btButton');
    bindBacktestEventOnce(startButton, 'click', 'Start', () => {
        void runBacktestWithRuntimeProvenance();
    });

    const cohortCheckbox = document.getElementById('runBacktestCohorts');
    const cohortHorizonInput = document.getElementById('backtestCohortHorizon');
    const syncCohortControl = () => {
        if (cohortHorizonInput) cohortHorizonInput.disabled = !cohortCheckbox?.checked;
        if (!cohortCheckbox?.checked) clearBacktestFieldError('backtestCohortHorizon', 'backtestCohortHorizonError');
    };
    bindBacktestEventOnce(cohortCheckbox, 'change', 'CohortToggle', syncCohortControl);
    syncCohortControl();

    for (const [fieldId, errorId] of [
        ['simStartJahr', 'simStartJahrError'],
        ['simEndJahr', 'simEndJahrError'],
        ['backtestCohortHorizon', 'backtestCohortHorizonError']
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
