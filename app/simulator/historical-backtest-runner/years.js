"use strict";

import { BACKTEST_RESULT_SCHEMA_VERSION, BACKTEST_OUTCOME_KINDS, BACKTEST_TECHNICAL_ERROR_CODES } from './schema.js';
import { cloneRunValue } from './run-values.js';
import { buildYearData, buildVpwFallbackHint } from './year-data.js';
import { readPortfolioParts, computeCanonicalPortfolioTotal, computeIndependentPortfolioTotal } from './portfolio.js';
import { normalizeTechnicalError, buildSummary, attachCanonicalMetrics } from './results.js';

/**
 * Führt den vorbereiteten Jahreslauf mit dessen lokalen Bindungen fort.
 * @param context - Geprüfte Abhängigkeiten und initialisierter Laufzustand.
 * @returns Ergebnis des historischen Jahreslaufs.
 */
export function executeHistoricalYears({
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
}) {
    let totalWithdrawal = 0;
    let currentReductionStreak = 0;
    let maxReductionStreak = 0;
    let reductionYears = 0;
    let totalTaxes = 0;
    let successfulYears = 0;
    let ruinEncountered = false;
    let ruinYear = null;
    let ruinReason = null;
    let lastCompletedYear = null;
    const rows = [];

    const finishResult = ({ outcome, diagnostics = null }) => {
        const portfolioEnd = simulationState?.portfolio
            ? computeCanonicalPortfolioTotal(computePortfolioTotal, simulationState.portfolio)
            : null;
        const legacyMetrics = {
            totalWithdrawal,
            maxReductionStreak: Math.max(maxReductionStreak, currentReductionStreak),
            reductionYears,
            totalTaxes
        };
        return attachCanonicalMetrics({
            schemaVersion: BACKTEST_RESULT_SCHEMA_VERSION,
            request,
            outcome,
            warnings: [],
            error: outcome.kind === BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR ? outcome.error : null,
            rows,
            requestedYears,
            completedYears: successfulYears,
            firstYear: startYear,
            lastCompletedYear,
            ruinYear: outcome.ruinYear ?? null,
            breakOnRuin: request.breakOnRuin,
            portfolioStart,
            portfolioEnd,
            dataStatus: 'complete',
            incompleteReason: null,
            historicalYearRecords: historicalRecords,
            legacyOutcome: outcome.kind,
            legacyMetrics,
            summary: buildSummary({
                rows,
                portfolioStart,
                portfolioEnd,
                completedYears: successfulYears,
                ...legacyMetrics
            }),
            diagnostics
        });
    };

    for (let yearIndex = 0; yearIndex < historicalRecords.length; yearIndex++) {
        const historicalRecord = historicalRecords[yearIndex];
        const year = historicalRecord.simulationYear;
        const yearData = buildYearData(historicalRecord);
        const resolvedCapeRatio = historicalRecord.decisionAsOf.capeRatio.value;
        const adjustmentPct = computeAdjustment(backtestContext, yearIndex);
        const horizonResolution = resolveYearHorizon(runInputs, { yearIndex });
        const adjustedInputs = {
            ...runInputs,
            rentAdjPct: adjustmentPct,
            capeRatio: resolvedCapeRatio,
            marketCapeRatio: resolvedCapeRatio,
            horizonYears: horizonResolution.horizonYears,
            guardrailPlanHorizonYears: runInputs.horizonYears,
            ...(horizonResolution.diagnostics?.longevityMode !== 'none'
                ? { longevityHorizonDiagnostics: horizonResolution.diagnostics }
                : {})
        };
        const stateBeforeYear = cloneRunValue(simulationState);
        const portfolioTotalBeforeYear = yearIndex === 0
            ? portfolioStartEvidence
            : computeIndependentPortfolioTotal(stateBeforeYear.portfolio);
        let result;
        try {
            result = simulate(simulationState, adjustedInputs, yearData, yearIndex);
        } catch (cause) {
            simulationState = stateBeforeYear;
            const error = normalizeTechnicalError(null, BACKTEST_TECHNICAL_ERROR_CODES.SIMULATOR_EXCEPTION);
            return finishResult({
                outcome: { kind: BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR, error, lastCompletedYear },
                diagnostics: { cause, failedYear: year }
            });
        }

        if (result?.kind === 'technical_error' || result?.error) {
            simulationState = stateBeforeYear;
            const error = normalizeTechnicalError(result?.error, BACKTEST_TECHNICAL_ERROR_CODES.SIMULATOR_RESULT_INVALID);
            return finishResult({
                outcome: { kind: BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR, error, lastCompletedYear },
                diagnostics: { cause: result?.error?.cause || result?.error || null, failedYear: year }
            });
        }

        if (result?.kind === 'ruin' || result?.isRuin === true) {
            if (!result?.newState?.portfolio) {
                simulationState = stateBeforeYear;
                const error = normalizeTechnicalError(null, BACKTEST_TECHNICAL_ERROR_CODES.RUIN_STATE_INVALID);
                return finishResult({
                    outcome: { kind: BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR, error, lastCompletedYear },
                    diagnostics: { cause: result, failedYear: year }
                });
            }
            ruinEncountered = true;
            ruinYear ??= year;
            ruinReason ??= result.reason || 'Floor-Deckungsausfall';
            simulationState = result.newState;
            const terminal = readPortfolioParts(simulationState.portfolio);
            const terminalPortfolioTotal = computeIndependentPortfolioTotal(simulationState.portfolio);
            const requiredFloorNominal = Number.isFinite(result?.ruinDetails?.requiredFloorNominal)
                ? result.ruinDetails.requiredFloorNominal
                : null;
            const coveredFloorNominal = Number.isFinite(result?.ruinDetails?.coveredFloorNominal)
                ? result.ruinDetails.coveredFloorNominal
                : null;
            const floorShortfallNominal = Number.isFinite(result?.ruinDetails?.shortfallNominal)
                ? result.ruinDetails.shortfallNominal
                : null;
            rows.push({
                jahr: year,
                row: {
                    floor_brutto: simulationState.baseFloor,
                    renteSum: 0,
                    ...(result.logData?.immobilien_wert_end !== undefined ? { immobilien_wert_end: result.logData.immobilien_wert_end } : {}),
                    ...(result.logData?.geplante_ausgaben ? { geplante_ausgaben: result.logData.geplante_ausgaben } : {}),
                    ...(result.logData?.zufluss ? { zufluss: result.logData.zufluss, zufluss_personen: result.logData.zufluss_personen } : {}),
                    aktionUndGrund: `>>> RUIN <<< ${ruinReason}`,
                    ruin_reason: ruinReason,
                    Regime: 'BANKRUPT',
                    liquiditaet: terminal.liquiditaet,
                    wertAktien: terminal.wertAktien,
                    wertGold: terminal.wertGold,
                    FlexRatePct: 0,
                    flex_erfuellt_nominal: 0,
                    QuoteEndPct: 0,
                    RunwayCoveragePct: null,
                    RunwayMeasurementPhase: 'not_applicable_terminal_ruin',
                    RunwayCoveragePostPayoutEndOfYearPct: null,
                    runway_after_transaction_before_payout_months: null,
                    runway_post_payout_end_of_year_months: null,
                    NominalReturnEquityPct: 0,
                    NominalReturnGoldPct: 0,
                    steuern_gesamt: 0,
                    NeedLiq: 0,
                    GuardGold: 0,
                    GuardEq: 0,
                    GuardNote: result.reason || 'Floor-Deckungsausfall',
                    health_bucket_enabled: simulationState.portfolio.healthBucketConfig?.enabled === true,
                    health_bucket_end: terminal.healthBucketEnd,
                    ...Object.fromEntries(Object.entries(result.logData || {}).filter(([key]) => key.startsWith('health_bucket_'))),
                    floor_coverage_required_nominal: requiredFloorNominal,
                    floor_coverage_covered_nominal: coveredFloorNominal,
                    floor_shortfall_nominal: floorShortfallNominal,
                    taxSavedByLossCarry: 0,
                    lossCarryEnd: Number(simulationState?.lastState?.taxState?.lossCarry) || 0,
                    portfolio_total_start: portfolioTotalBeforeYear,
                    portfolio_total_end: terminalPortfolioTotal
                },
                entscheidung: { jahresEntnahme: 0 },
                wertAktien: terminal.wertAktien,
                wertGold: terminal.wertGold,
                liquiditaet: terminal.liquiditaet,
                netA: 0,
                netG: 0,
                vpw: null,
                vpwFallbackHint: 'no_vpw',
                adjPct: adjustmentPct,
                inflationVJ: historicalRecord.realized.inflation.value
            });
            if (breakOnRuin) break;
            continue;
        }

        if (!result?.newState?.portfolio || !result?.logData) {
            simulationState = stateBeforeYear;
            const error = normalizeTechnicalError(null, BACKTEST_TECHNICAL_ERROR_CODES.SIMULATOR_RESULT_INVALID);
            return finishResult({
                outcome: { kind: BACKTEST_OUTCOME_KINDS.TECHNICAL_ERROR, error, lastCompletedYear },
                diagnostics: { cause: result, failedYear: year }
            });
        }

        simulationState = result.newState;
        totalTaxes += result.totalTaxesThisYear;
        const enginePortfolioTotalEnd = Number(result.logData.portfolio_total_end);
        const row = {
            ...result.logData,
            portfolio_total_start: portfolioTotalBeforeYear,
            portfolio_total_end: Number.isFinite(enginePortfolioTotalEnd)
                ? enginePortfolioTotalEnd
                : computeIndependentPortfolioTotal(simulationState.portfolio)
        };
        const { entscheidung, wertAktien, wertGold, liquiditaet } = row;
        totalWithdrawal += entscheidung.jahresEntnahme;
        successfulYears++;
        lastCompletedYear = year;

        const netA = Number.isFinite(row.netTradeEq)
            ? row.netTradeEq
            : (row.vk?.vkAkt || 0) - (row.kaufAkt || 0);
        const netG = Number.isFinite(row.netTradeGold)
            ? row.netTradeGold
            : (row.vk?.vkGld || 0) - (row.kaufGld || 0);
        const vpwPayload = result.ui?.vpw || null;
        rows.push({
            jahr: year,
            row,
            entscheidung,
            wertAktien,
            wertGold,
            liquiditaet,
            netA,
            netG,
            vpw: vpwPayload,
            vpwFallbackHint: buildVpwFallbackHint(vpwPayload),
            adjPct: adjustmentPct,
            inflationVJ: historicalRecord.realized.inflation.value
        });

        if (result.logData.flex_wunsch_haushalt_nominal > 0 && entscheidung.kuerzungProzent >= 10) {
            reductionYears++;
            currentReductionStreak++;
        } else {
            maxReductionStreak = Math.max(maxReductionStreak, currentReductionStreak);
            currentReductionStreak = 0;
        }
    }

    maxReductionStreak = Math.max(maxReductionStreak, currentReductionStreak);
    return finishResult({
        outcome: ruinEncountered
            ? {
                kind: BACKTEST_OUTCOME_KINDS.RUIN,
                ruinYear,
                reason: ruinReason,
                lastCompletedYear
            }
            : {
                kind: BACKTEST_OUTCOME_KINDS.COMPLETED,
                lastCompletedYear
            }
    });
}
