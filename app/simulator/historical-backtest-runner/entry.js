"use strict";

import { BACKTEST_REQUEST_SCHEMA_VERSION, BACKTEST_RESULT_SCHEMA_VERSION, BACKTEST_OUTCOME_KINDS, BACKTEST_TECHNICAL_ERROR_CODES } from './schema.js';
import { cloneRunValue, deepFreeze } from './run-values.js';
import { requireFunction, prepareHistoricalPeriod, readInitialMarketValue } from './year-data.js';
import { computeCanonicalPortfolioTotal, computeIndependentPortfolioTotal } from './portfolio.js';
import { normalizeTechnicalError, buildIncompleteOutcome, buildSummary, attachCanonicalMetrics } from './results.js';
import { buildDatasetProvenance, buildEngineProvenance } from './provenance.js';
import { initialAccumulationState } from '../simulator-engine-helpers.js';
import { validatePlannedInflows } from '../simulator-input-validation.js';
import { executeHistoricalYears } from './years.js';

/**
 * Executes the historical year loop against one preflighted V1 record per year.
 * All environment-facing dependencies are supplied by the caller.

 *
 * @param options - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function runHistoricalBacktest({
    inputs,
    period,
    historicalDataProvider,
    simulateYear,
    initializePortfolio,
    computeAdjustmentPct,
    resolveHorizon,
    totalPortfolio,
    breakOnRuin = false,
    engineProvenance = null
}) {
    const startYear = Number(period?.startYear);
    const endYear = Number(period?.endYear);
    const requestedYears = Number.isInteger(startYear) && Number.isInteger(endYear)
        ? endYear - startYear + 1
        : null;
    validatePlannedInflows(inputs, requestedYears);
    const requestInputs = deepFreeze(cloneRunValue(inputs || {}));
    const runInputs = cloneRunValue(requestInputs);
    const request = deepFreeze({
        schemaVersion: BACKTEST_REQUEST_SCHEMA_VERSION,
        startYear,
        endYear,
        executionMode: 'single_path',
        breakOnRuin: Boolean(breakOnRuin),
        temporalConventionId: historicalDataProvider?.temporalConventionId || null,
        dataset: buildDatasetProvenance(historicalDataProvider),
        engine: buildEngineProvenance(engineProvenance),
        inputs: requestInputs
    });

    let simulate;
    let initialize;
    let computeAdjustment;
    let resolveYearHorizon;
    let computePortfolioTotal;
    let prepared;
    let dependencyCause = null;
    try {
        simulate = requireFunction(simulateYear, 'simulateYear');
        initialize = requireFunction(initializePortfolio, 'initializePortfolio');
        computeAdjustment = requireFunction(computeAdjustmentPct, 'computeAdjustmentPct');
        resolveYearHorizon = requireFunction(resolveHorizon, 'resolveHorizon');
        computePortfolioTotal = requireFunction(totalPortfolio, 'totalPortfolio');
    } catch (cause) {
        dependencyCause = cause;
    }

    const emptyMetrics = {
        totalWithdrawal: 0,
        maxReductionStreak: 0,
        reductionYears: 0,
        totalTaxes: 0
    };
    const buildEarlyResult = ({ outcome, dataStatus, incompleteReason = null, diagnostics = null }) => (
        attachCanonicalMetrics({
            schemaVersion: BACKTEST_RESULT_SCHEMA_VERSION,
            request,
            outcome,
            warnings: [],
            error: outcome.kind === BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR ? outcome.error : null,
            rows: [],
            requestedYears,
            completedYears: 0,
            firstYear: Number.isInteger(startYear) ? startYear : null,
            lastCompletedYear: null,
            ruinYear: null,
            breakOnRuin: request.breakOnRuin,
            portfolioStart: null,
            portfolioEnd: null,
            dataStatus,
            incompleteReason,
            historicalYearRecords: [],
            legacyOutcome: outcome.kind,
            legacyMetrics: emptyMetrics,
            summary: buildSummary({
                rows: [],
                portfolioStart: null,
                portfolioEnd: null,
                completedYears: 0,
                ...emptyMetrics
            }),
            diagnostics
        })
    );

    if (dependencyCause) {
        const error = normalizeTechnicalError(null, BACKTEST_TECHNICAL_ERROR_CODES.DEPENDENCY_INVALID);
        return buildEarlyResult({
            outcome: { kind: BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR, error, lastCompletedYear: null },
            dataStatus: 'not_checked',
            diagnostics: { cause: dependencyCause }
        });
    }

    try {
        prepared = prepareHistoricalPeriod(historicalDataProvider, { startYear, endYear });
    } catch (cause) {
        const error = normalizeTechnicalError(null, BACKTEST_TECHNICAL_ERROR_CODES.PERIOD_CONTRACT_ERROR);
        return buildEarlyResult({
            outcome: { kind: BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR, error, lastCompletedYear: null },
            dataStatus: 'not_checked',
            diagnostics: { cause }
        });
    }
    if (prepared.status === 'incomplete') {
        return buildEarlyResult({
            outcome: buildIncompleteOutcome(prepared.reason),
            dataStatus: 'incomplete',
            incompleteReason: prepared.reason
        });
    }
    const historicalRecords = prepared.records;
    const backtestContext = {
        inputs: {
            rentAdj: {
                mode: runInputs.rentAdjMode || 'fix',
                pct: runInputs.rentAdjPct || 0
            }
        },
        series: {
            wageGrowth: historicalRecords.map(record => record.realized.wagePensionAdjustment.value),
            inflationPct: historicalRecords.map(record => record.realized.inflation.value),
            startYear
        },
        simStartYear: startYear
    };
    const initialMarketHistory = prepared.initialMarketHistory;
    const initialCapeRatio = historicalRecords[0].decisionAsOf.capeRatio.value;
    let initialPortfolio;
    try {
        initialPortfolio = initialize(runInputs);
    } catch (cause) {
        const error = normalizeTechnicalError(null, BACKTEST_TECHNICAL_ERROR_CODES.INITIALIZATION_ERROR);
        return buildEarlyResult({
            outcome: { kind: BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR, error, lastCompletedYear: null },
            dataStatus: 'complete',
            diagnostics: { cause }
        });
    }
    let simulationState = {
        portfolio: initialPortfolio,
        ...(runInputs.accumulationPhase?.enabled ? { accumulationState: initialAccumulationState(runInputs) } : {}),
        baseFloor: runInputs.startFloorBedarf,
        baseFlex: runInputs.startFlexBedarf,
        baseMinimumFlexAnnual: runInputs.minimumFlexAnnual || 0,
        baseFlexBudgetAnnual: runInputs.flexBudgetAnnual || 0,
        baseFlexBudgetRecharge: runInputs.flexBudgetRecharge || 0,
        lastState: null,
        currentAnnualPension: (runInputs.renteMonatlich || 0) * 12,
        currentAnnualPension2: runInputs.partner?.brutto || 0,
        marketDataHist: {
            endeVJ: readInitialMarketValue(initialMarketHistory, 'endeVJ'),
            endeVJ_1: readInitialMarketValue(initialMarketHistory, 'endeVJ_1'),
            endeVJ_2: readInitialMarketValue(initialMarketHistory, 'endeVJ_2'),
            endeVJ_3: readInitialMarketValue(initialMarketHistory, 'endeVJ_3'),
            ath: initialMarketHistory.allTimeHigh.value,
            jahreSeitAth: initialMarketHistory.yearsSinceAllTimeHigh,
            capeRatio: initialCapeRatio
        }
    };
    const portfolioStart = computeCanonicalPortfolioTotal(computePortfolioTotal, simulationState.portfolio);
    const portfolioStartEvidence = computeIndependentPortfolioTotal(simulationState.portfolio);

    return executeHistoricalYears({
        startYear,
        requestedYears,
        runInputs,
        request,
        historicalRecords,
        backtestContext,
        simulationState,
        portfolioStart,
        portfolioStartEvidence,
        simulate,
        computeAdjustment,
        resolveYearHorizon,
        computePortfolioTotal,
        breakOnRuin
    });
}
