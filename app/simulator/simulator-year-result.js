import { copyLogField, restoreSimulatorLogOrder } from './simulator-log-order.js';
import { sumDepot } from './simulator-portfolio.js';
import { buildCareLogFields } from './simulator-care-log.js';
import { euros, signedEuros } from './simulator-engine-direct-utils.js';
import { shortenReasonText } from './simulator-utils.js';
import { sumBondBucketValuation } from '../../engine/transactions/three-bucket-logic.mjs';
import { FinancialCalculationError } from '../../engine/errors.mjs';
import { resolvePlannedAnnualWithdrawal } from '../../types/planned-withdrawal-contract.js';
import {
    advanceSimulatorCumulativeInflationFactor,
    resolveSimulatorCumulativeInflationFactor
} from './simulator-engine-helpers.js';

/**
 * @param {object} options
 * @param options.guardrailPlanInputs
 * @param options.inflowLog
 * @param [options.inheritanceLog]
 * @param options.incomeLog
 * @param options.expenseLog
 * @param options.personalPayout
 * @param options.portfolio
 * @param options.liquiditaet
 * @param options.spendingResult
 * @param options.actionResult
 * @param options.market
 * @param options.spendingNewState
 * @param options.yearData
 * @param options.fullResult
 * @param options.currentState
 * @param options.newMarketDataHist
 * @param options.initialLiqStart
 * @param options.jahresEntnahmePlan
 * @param options.jahresEntnahmeEffektiv
 * @param options.liqBeforePayout
 * @param options.liqAfterPayout
 * @param options.portfolioTotalBeforePayout
 * @param options.buyEqAmount
 * @param options.buyGoldAmount
 * @param options.kaufAkt
 * @param options.kaufGld
 * @param options.baseFloor
 * @param options.baseFlex
 * @param {number} [options.baseMinimumFlexAnnual]
 * @param options.baseFlexBudgetAnnual
 * @param options.baseFlexBudgetRecharge
 * @param options.pensionResult
 * @param options.rA
 * @param options.rG
 * @param options.depotwertGesamt
 * @param options.totalTaxesThisYear
 * @param options.vk
 * @param [options.legacySaleTotals]
 * @param options.depotTranchesAktien
 * @param options.depotTranchesGold
 * @param options.equityBeforeReturn
 * @param options.equityAfterReturn
 * @param options.equityAfterSales
 * @param options.equityAfterBuys
 * @param options.goldBeforeReturn
 * @param options.goldAfterReturn
 * @param options.goldAfterSales
 * @param options.goldAfterBuys
 * @param options.cashZinsen
 * @param options.liqNachZins
 * @param options.zielLiquiditaet
 * @param options.bondBucketBefore
 * @param options.bondRefillGross
 * @param options.bondRefillNet
 * @param options.bondRefillTax
 * @param options.bondSaleAmount
 * @param {string} [options.bondRefillDebugVersion]
 * @param {number} [options.bondRefillSaleShortfallGross]
 * @param options.effectiveBaseFloor
 * @param options.pensionAnnual
 * @param options.rente1
 * @param options.rente2
 * @param options.renteSum
 * @param options.inflatedFloor
 * @param options.inflatedFlex
 * @param options.pflegeMeta
 * @param [options.householdContext]
 * @param [options.careLogContext]
 * @param [options.yearNeed] Bestandteile des Jahresbedarfs nach FR-72.
 * @param {boolean} [options.hasPartner]
 * @param options.widowBenefits
 * @param options.widowPensionP1
 * @param options.widowPensionP2
 * @param options.p1Alive
 * @param options.p2Alive
 * @param options.guardReason
 * @param options.isBadYear
 * @param options.equityPreserved
 * @param options.unmetLiquidity
 * @param [options.healthBucketCoverage]
 * @param [options.healthBucketInterest]
 * @param [options.healthBucketDiagnostics]
 * @param [options.stressReplayTransactionDiagnostics]
 * @param [options.balanceTrace]
 * @param {boolean} [options.preserveLogOrder]
 * @returns Ergebnis der Operation.
 */
export function buildSimulatorYearResult({
    guardrailPlanInputs,
    inflowLog,
    inheritanceLog = null,
    incomeLog,
    expenseLog,
    personalPayout,
    portfolio,
    liquiditaet,
    spendingResult,
    actionResult,
    market,
    spendingNewState,
    yearData,
    fullResult,
    currentState,
    newMarketDataHist,
    initialLiqStart,
    jahresEntnahmePlan,
    jahresEntnahmeEffektiv,
    liqBeforePayout,
    liqAfterPayout,
    portfolioTotalBeforePayout,
    buyEqAmount,
    buyGoldAmount,
    kaufAkt,
    kaufGld,
    baseFloor,
    baseFlex,
    baseMinimumFlexAnnual = 0,
    baseFlexBudgetAnnual,
    baseFlexBudgetRecharge,
    pensionResult,
    rA,
    rG,
    depotwertGesamt,
    totalTaxesThisYear,
    vk,
    legacySaleTotals = vk,
    depotTranchesAktien,
    depotTranchesGold,
    equityBeforeReturn,
    equityAfterReturn,
    equityAfterSales,
    equityAfterBuys,
    goldBeforeReturn,
    goldAfterReturn,
    goldAfterSales,
    goldAfterBuys,
    cashZinsen,
    liqNachZins,
    zielLiquiditaet,
    bondBucketBefore,
    bondRefillGross,
    bondRefillNet,
    bondRefillTax,
    bondSaleAmount,
    bondRefillDebugVersion = '',
    bondRefillSaleShortfallGross = 0,
    effectiveBaseFloor,
    pensionAnnual,
    rente1,
    rente2,
    renteSum,
    inflatedFloor,
    inflatedFlex,
    pflegeMeta,
    householdContext = null,
    careLogContext = null,
    yearNeed = null,
    hasPartner = false,
    widowBenefits,
    widowPensionP1,
    widowPensionP2,
    p1Alive,
    p2Alive,
    guardReason,
    isBadYear,
    equityPreserved,
    unmetLiquidity,
    healthBucketCoverage = null,
    healthBucketInterest = null,
    healthBucketDiagnostics = null,
    stressReplayTransactionDiagnostics = null,
    balanceTrace = [],
    preserveLogOrder = true
}) {
    const kaufAktTotal = buyEqAmount + kaufAkt;
    const totalGoldKauf = buyGoldAmount + kaufGld;
    let aktionText = shortenReasonText(
        actionResult.transactionDiagnostics?.blockReason || 'none',
        actionResult.title || market.szenarioText
    );
    if (actionResult.personalPayoutSale?.gross > 0) {
        aktionText = `${aktionText.replace(/\(?Kein Handlungsbedarf\)?/gi, '').replace(/\s+$/, '')} / Verkauf für die Auszahlung ${actionResult.personalPayoutSale.gross.toFixed(2)} €`;
    }
    if (actionResult.householdTaxSale?.gross > 0) {
        aktionText = `${aktionText.replace(/\(?Kein Handlungsbedarf\)?/gi, '').trimEnd()} / Verkauf für die Steuer im Haushalt ${actionResult.householdTaxSale.gross.toFixed(2)} €`;
    }
    if (fullResult.ui.vpw?.wishFlexCapApplied) aktionText += ` / ${fullResult.ui.vpw.enabled ? 'Dynamic-Flex-Obergrenze' : 'Sicherheitsboden begrenzt'} (${fullResult.ui.vpw.wishFlexCapAnnual.toFixed(2)} €/Jahr)`;
    const careLog = buildCareLogFields({ hasPartner, p1Alive, p2Alive,
        careMetaP1: householdContext?.care?.p1 ?? pflegeMeta, careMetaP2: householdContext?.care?.p2,
        ...careLogContext });
    if (vk?.vkBnd > 0) aktionText += ` / Anleihen verkauft ${vk.vkBnd.toFixed(2)} €`;
    if (totalGoldKauf > 0) aktionText += " / Rebal.(G+)";
    if (kaufAktTotal > 0) aktionText += " / Rebal.(A+)";
    if (actionResult.personalTaxFunding) aktionText += ` / ${actionResult.personalTaxFunding.reason}`;
    if (inflowLog?.immobilienverkauf_hinweis) aktionText += ` / ${inflowLog.immobilienverkauf_hinweis}`;

    const inflFactorThisYear = 1 + (yearData.inflation / 100);
    const cumulativeInflationFactor = resolveSimulatorCumulativeInflationFactor(currentState);
    const nextCumulativeInflationFactor = advanceSimulatorCumulativeInflationFactor(
        cumulativeInflationFactor,
        yearData.inflation
    );
    const nextSpendingState = {
        ...spendingNewState,
        cumulativeInflationFactor: nextCumulativeInflationFactor,
        lastEntnahmeReal: jahresEntnahmeEffektiv / cumulativeInflationFactor
    };
    const {
        nextWidowPensionP1,
        nextWidowPensionP2,
        nextAnnualPension,
        nextAnnualPension2
    } = pensionResult;
    const nextPortfolio = { ...portfolio, liquiditaet };
    const bondBucketAfter = sumBondBucketValuation(nextPortfolio.depotTranchesAktien);
    const wertAktien = sumDepot({ depotTranchesAktien });
    const wertGold = sumDepot({ depotTranchesGold });
    const healthBucketEnd = euros(Number(nextPortfolio.healthBucketGeldmarkt) || 0);
    const portfolioActiveEnd = euros(wertAktien + wertGold + liquiditaet);
    const portfolioTotalEnd = euros(portfolioActiveEnd + healthBucketEnd);
    const taxCashAdjustment = signedEuros(actionResult?.taxSettlement?.taxCashAdjustment);
    const signedCashInterest = Number.isFinite(Number(cashZinsen)) ? Number(cashZinsen) : 0;
    const portfolioFlowDelta = portfolioActiveEnd - (
        euros(portfolioTotalBeforePayout)
        - euros(jahresEntnahmeEffektiv)
        - (expenseLog?.geplante_ausgaben || 0)
        + signedCashInterest
        + taxCashAdjustment
        - (inheritanceLog?.abgang_erben || 0)
        + (inheritanceLog?.healthLeaves || 0)
        - (inheritanceLog?.erbschaftsteuer || 0)
    );
    const normalizedBalanceTrace = Array.isArray(balanceTrace)
        ? balanceTrace.map(entry => ({
            ...entry,
            phase: String(entry?.phase || ''),
            total: euros(entry?.total),
            equity: euros(entry?.equity),
            bonds: euros(entry?.bonds),
            gold: euros(entry?.gold),
            cash: euros(entry?.cash)
        }))
        : [];
    const healthBucketWarnings = Array.isArray(nextPortfolio.healthBucketMeta?.warnings)
        ? nextPortfolio.healthBucketMeta.warnings
        : [];
    const vpw = fullResult.ui.vpw || null;
    const safetyDiagnosis = fullResult.diagnosis?.general || {};
    const keyParams = fullResult.diagnosis?.keyParams || {};
    const flexRate = Number.isFinite(spendingResult.details?.flexRate)
        ? spendingResult.details.flexRate
        : null;
    const plannedWithdrawalResolution = resolvePlannedAnnualWithdrawal({
        spendingResult,
        ...(jahresEntnahmePlan === undefined ? {} : { annualPlan: jahresEntnahmePlan })
    });
    if (plannedWithdrawalResolution.status === 'invalid' || plannedWithdrawalResolution.status === 'conflict') {
        throw new FinancialCalculationError(
            'Die Jahresentnahme des Simulatorergebnisses ist nicht eindeutig reconciliert.',
            {
                contract: 'planned_annual_withdrawal',
                status: plannedWithdrawalResolution.status,
                candidates: plannedWithdrawalResolution.candidates
            }
        );
    }
    const annualRunwayNeed = plannedWithdrawalResolution.status === 'resolved'
        ? plannedWithdrawalResolution.annualWithdrawal
        : null;
    const runwayAfterTransactionBeforePayoutMonths = Number.isFinite(annualRunwayNeed)
        && Number.isFinite(liqBeforePayout)
        ? (annualRunwayNeed > 0 ? liqBeforePayout / (annualRunwayNeed / 12) : null)
        : null;
    const runwayPostPayoutEndOfYearMonths = Number.isFinite(annualRunwayNeed)
        && Number.isFinite(liquiditaet)
        ? (annualRunwayNeed > 0 ? liquiditaet / (annualRunwayNeed / 12) : null)
        : null;
    const runwayCoveragePct = zielLiquiditaet > 0 && Number.isFinite(liqBeforePayout)
        ? (liqBeforePayout / zielLiquiditaet) * 100
        : null;
    const runwayPostPayoutEndOfYearCoveragePct = zielLiquiditaet > 0 && Number.isFinite(liquiditaet)
        ? (liquiditaet / zielLiquiditaet) * 100
        : null;
    const pensionFlexSurplus = incomeLog?.flexIncomeContribution ?? Math.max(0, pensionAnnual - effectiveBaseFloor);
    const dynamicPortfolioFlex = vpw?.enabled === true && Number.isFinite(vpw?.dynamicFlex)
        ? Math.max(0, vpw.dynamicFlex)
        : null;
    const grossHouseholdFlex = dynamicPortfolioFlex !== null
        ? pensionFlexSurplus + dynamicPortfolioFlex
        : (Number.isFinite(fullResult.input?.flexBedarf)
            ? Math.max(0, fullResult.input.flexBedarf)
            : Math.max(0, inflatedFlex));
    const pensionFlexContribution = Math.min(
        grossHouseholdFlex,
        pensionFlexSurplus
    );
    const fulfilledFlexFromPortfolio = jahresEntnahmeEffektiv > inflatedFloor
        ? jahresEntnahmeEffektiv - inflatedFloor
        : 0;
    const fulfilledHouseholdFlex = pensionFlexContribution + fulfilledFlexFromPortfolio;
    const displayedWishFlex = Number.isFinite(fullResult.input?.flexBedarf)
        ? fullResult.input.flexBedarf : inflatedFlex;
    const displayedFlexRate = flexRate === null ? null
        : (displayedWishFlex > 0 ? fulfilledHouseholdFlex / displayedWishFlex * 100 : flexRate);
    const displayedFlexCut = displayedWishFlex <= 0 ? 0
        : displayedFlexRate === null ? spendingResult.kuerzungProzent : Math.max(0, 100 - displayedFlexRate);
    const householdFlexReductionPct = displayedFlexCut;
    const displayedFlexNote = displayedWishFlex > 0 && (displayedFlexCut <= 0 || flexRate >= 100)
        ? '' : displayedWishFlex <= 0
        ? `kein Flex${careLog.pflege_aktiv ? ` (Pflegegrad ${careLog.pflege_grade})` : ''}`
        : Number.isFinite(displayedFlexCut) && typeof spendingResult.anmerkung === 'string'
        ? spendingResult.anmerkung.replace(/^\(Flex um [\d.-]+% /, `(Flex um ${displayedFlexCut.toFixed(0)}% `)
        : spendingResult.anmerkung;
    const minimumFlexAnnual = Number.isFinite(keyParams.minimumFlexAnnual)
        ? Math.max(0, keyParams.minimumFlexAnnual)
        : 0;
    const minimumFlexApplicable = keyParams.minimumFlexApplicable === true;
    const plannedMinimumFlexEffective = Number.isFinite(keyParams.minimumFlexEffectiveFinal)
        ? Math.max(0, keyParams.minimumFlexEffectiveFinal)
        : minimumFlexAnnual;
    const minimumFlexEffectiveFinal = minimumFlexApplicable
        ? Math.min(minimumFlexAnnual, fulfilledHouseholdFlex)
        : (Number.isFinite(keyParams.minimumFlexEffectiveFinal) ? keyParams.minimumFlexEffectiveFinal : null);
    const minimumFlexShortfallAnnual = minimumFlexApplicable
        ? Math.max(0, minimumFlexAnnual - minimumFlexEffectiveFinal)
        : (Number.isFinite(keyParams.minimumFlexShortfallAnnual) ? keyParams.minimumFlexShortfallAnnual : null);
    const minimumFlexFulfilled = minimumFlexApplicable
        ? minimumFlexShortfallAnnual <= 0.01
        : keyParams.minimumFlexFulfilled === true;
    const minimumFlexLimitedByActualPayout = minimumFlexApplicable
        && minimumFlexShortfallAnnual > 0.01
        && minimumFlexEffectiveFinal + 0.01 < plannedMinimumFlexEffective;
    const minimumFlexStatus = minimumFlexLimitedByActualPayout
        ? 'limited_by_actual_payout'
        : (keyParams.minimumFlexStatus || 'inactive_zero');
    const withdrawalRateEndPct = Number.isFinite(spendingResult.details?.entnahmequoteDepot)
        ? spendingResult.details.entnahmequoteDepot * 100
        : null;

    const result = {
        isRuin: false,
        portfolio: nextPortfolio,
        ui: {
            spending: spendingResult,
            action: actionResult,
            market: { sKey: spendingNewState.lastMarketSKey, ...yearData },
            vpw,
            zielLiquiditaet,
            liquiditaet: {
                vorher: initialLiqStart,
                nachher: liqBeforePayout,
                deckungNachher: runwayCoveragePct,
                vorAuszahlung: liqBeforePayout,
                nachAuszahlung: liqAfterPayout,
                jahresende: liquiditaet,
                deckungJahresende: runwayPostPayoutEndOfYearCoveragePct
            },
            runway: {
                months: runwayAfterTransactionBeforePayoutMonths,
                postPayoutEndOfYearMonths: runwayPostPayoutEndOfYearMonths
            }
        },
        newState: {
            guardrailPlanInputs,
            portfolio: nextPortfolio,
            cumulativeInflationFactor: nextCumulativeInflationFactor,
            baseFloor: euros(baseFloor * inflFactorThisYear),
            baseFlex: euros(baseFlex * inflFactorThisYear),
            baseMinimumFlexAnnual: euros(baseMinimumFlexAnnual * inflFactorThisYear),
            baseFlexBudgetAnnual: euros(baseFlexBudgetAnnual * inflFactorThisYear),
            baseFlexBudgetRecharge: euros(baseFlexBudgetRecharge * inflFactorThisYear),
            lastState: nextSpendingState,
            currentAnnualPension: nextAnnualPension,
            currentAnnualPension2: nextAnnualPension2,
            marketDataHist: newMarketDataHist,
            samplerState: currentState.samplerState,
            widowPensionP1: nextWidowPensionP1,
            widowPensionP2: nextWidowPensionP2
        },
        logData: {
            entscheidung: {
                ...spendingResult,
                jahresEntnahme: jahresEntnahmeEffektiv,
                jahresEntnahme_plan: jahresEntnahmePlan,
                runwayMonths: runwayAfterTransactionBeforePayoutMonths,
                kuerzungProzent: displayedFlexCut,
                anmerkung: displayedFlexNote
            },
            FlexRatePct: displayedFlexRate,
            MinFlexRatePct: spendingResult.details?.minFlexRatePct ?? null,
            minimumFlexAnnual,
            flex_wunsch_haushalt_nominal: Number.isFinite(fullResult.input?.flexBedarf)
                ? fullResult.input.flexBedarf : null,
            flex_unter_mindestflex: minimumFlexAnnual > 0 && fulfilledHouseholdFlex < minimumFlexAnnual,
            minimumFlexStatus,
            minimumFlexBlockReason: keyParams.minimumFlexBlockReason || '',
            minimumFlexStatusBeforeSafetyOverride: keyParams.minimumFlexStatusBeforeSafetyOverride || '',
            minimumFlexRequiredRate: Number.isFinite(keyParams.minimumFlexRequiredRate) ? keyParams.minimumFlexRequiredRate : null,
            minimumFlexEffectiveBefore: Number.isFinite(keyParams.minimumFlexEffectiveBefore) ? keyParams.minimumFlexEffectiveBefore : null,
            minimumFlexEffectiveAfter: Number.isFinite(keyParams.minimumFlexEffectiveAfter) ? keyParams.minimumFlexEffectiveAfter : null,
            minimumFlexApplicable,
            minimumFlexEffectiveFinal,
            minimumFlexShortfallAnnual,
            minimumFlexFulfilled,
            SafetyCapActive: keyParams.safetyCapActive === true,
            SafetyCapFlexRatePct: Number.isFinite(keyParams.safetyCapFlexRatePct) ? keyParams.safetyCapFlexRatePct : null,
            SafetyCapEffectiveFlexRatePct: Number.isFinite(keyParams.safetyCapEffectiveFlexRatePct)
                ? keyParams.safetyCapEffectiveFlexRatePct
                : null,
            SafetyCapRawCandidateFlexRatePct: Number.isFinite(keyParams.safetyCapRawCandidateFlexRatePct)
                ? keyParams.safetyCapRawCandidateFlexRatePct
                : null,
            SafetyCapSource: keyParams.safetyCapSource || '',
            SafetyCapAnchorStage: keyParams.safetyCapAnchorStage || '',
            SafetyCapApplied: keyParams.safetyCapApplied === true,
            SafetyCapDeferredByRateLimit: keyParams.safetyCapDeferredByRateLimit === true,
            FinalLimitingPolicy: keyParams.finalLimitingPolicy || '',
            SevereFlexEmergencyActive: keyParams.severeFlexEmergencyActive === true,
            MarketExtremeBear: keyParams.marketExtremeBear === true,
            RealTotalWealthDrawdownPct: Number.isFinite(keyParams.realTotalWealthDrawdownRatio)
                ? keyParams.realTotalWealthDrawdownRatio * 100
                : null,
            RealTotalWealthDrawdownThresholdPct: Number.isFinite(keyParams.realTotalWealthDrawdownThresholdRatio)
                ? keyParams.realTotalWealthDrawdownThresholdRatio * 100
                : null,
            MinimumFlexOverrideAllowed: keyParams.minimumFlexOverrideAllowed === true,
            AlarmActiveDiagnostic: keyParams.alarmActiveDiagnostic === true,
            WithdrawalBurdenFactor: Number.isFinite(keyParams.withdrawalBurdenFactor)
                ? keyParams.withdrawalBurdenFactor
                : null,
            AlarmWealthSufficient: typeof keyParams.alarmWealthSufficient === 'boolean'
                ? keyParams.alarmWealthSufficient
                : null,
            AlarmWealthSufficientThreshold: Number.isFinite(keyParams.alarmWealthSufficientThreshold)
                ? keyParams.alarmWealthSufficientThreshold
                : null,
            WithdrawalBurdenGateRole: keyParams.withdrawalBurdenGateRole || '',
            ProtectedPortfolioWithdrawalAnnual: Number.isFinite(keyParams.protectedPortfolioWithdrawalAnnual)
                ? keyParams.protectedPortfolioWithdrawalAnnual
                : null,
            ProtectedPortfolioWithdrawalRatePct: Number.isFinite(keyParams.protectedPortfolioWithdrawalRate)
                ? keyParams.protectedPortfolioWithdrawalRate * 100
                : null,
            ProtectedPortfolioWithdrawalRateThresholdPct: Number.isFinite(keyParams.protectedPortfolioWithdrawalRateThreshold)
                ? keyParams.protectedPortfolioWithdrawalRateThreshold * 100
                : null,
            ProtectedPortfolioWithdrawalCapacityCritical: keyParams.protectedPortfolioWithdrawalCapacityCritical === true,
            ProtectedPortfolioWithdrawalGateRole: keyParams.protectedPortfolioWithdrawalGateRole || '',
            BaseAlarmCutPct: Number.isFinite(keyParams.baseAlarmCutPct) ? keyParams.baseAlarmCutPct : null,
            EffectiveAlarmCutPct: Number.isFinite(keyParams.effectiveAlarmCutPct) ? keyParams.effectiveAlarmCutPct : null,
            FloorProtectionPolicy: keyParams.floorProtectionPolicy || '',
            WealthRedF: Number.isFinite(spendingResult.details?.wealthReductionFactor)
                ? spendingResult.details.wealthReductionFactor * 100
                : null,
            WealthQuoteUsedPct: Number.isFinite(spendingResult.details?.entnahmequoteUsed)
                ? spendingResult.details.entnahmequoteUsed * 100
                : null,
            CutReason: spendingResult.kuerzungQuelle || 'none',
            Alarm: spendingNewState.alarmActive || false,
            Regime: spendingNewState.lastMarketSKey || 'unknown',
            QuoteEndPct: withdrawalRateEndPct,
            RunwayCoveragePct: runwayCoveragePct,
            RunwayMeasurementPhase: 'after_transaction_before_payout',
            RunwayCoveragePostPayoutEndOfYearPct: runwayPostPayoutEndOfYearCoveragePct,
            RunwayTargetRawMonths: Number.isFinite(safetyDiagnosis.runwayTargetSmoothing?.rawTargetMonths) ? safetyDiagnosis.runwayTargetSmoothing.rawTargetMonths : null,
            RunwayTargetSmoothedMonths: Number.isFinite(safetyDiagnosis.runwayTargetSmoothing?.targetMonths) ? safetyDiagnosis.runwayTargetSmoothing.targetMonths : null,
            RunwayTargetSmoothingApplied: safetyDiagnosis.runwayTargetSmoothing?.smoothingApplied === true,
            RunwayTargetSmoothingFallback: safetyDiagnosis.runwayTargetSmoothing?.smoothingFallback === true,
            RunwayTargetSeverityPct: Number.isFinite(safetyDiagnosis.runwayTargetSmoothing?.severityPct) ? safetyDiagnosis.runwayTargetSmoothing.severityPct : null,
            RunwayTargetHardMinMonths: Number.isFinite(safetyDiagnosis.runwayTargetSmoothing?.hardMinimumMonths) ? safetyDiagnosis.runwayTargetSmoothing.hardMinimumMonths : null,
            RealReturnEquityPct: (1 + rA) / (1 + yearData.inflation / 100) - 1,
            RealReturnGoldPct: (1 + rG) / (1 + yearData.inflation / 100) - 1,
            NominalReturnEquityPct: rA,
            NominalReturnGoldPct: rG,
            entnahmequote: depotwertGesamt > 0 ? (jahresEntnahmeEffektiv / depotwertGesamt) : 0,
            entnahme_plan: jahresEntnahmePlan,
            entnahme_effektiv: jahresEntnahmeEffektiv,
            vpw_total: Number.isFinite(vpw?.vpwTotal) ? vpw.vpwTotal : null,
            vpw_dynamic_flex: Number.isFinite(vpw?.dynamicFlex) ? vpw.dynamicFlex : null,
            static_flex_baseline: Number.isFinite(vpw?.staticFlexBaseline) ? vpw.staticFlexBaseline : null,
            safety_stage_current: Number.isFinite(safetyDiagnosis.dynamicFlexSafetyStage) ? safetyDiagnosis.dynamicFlexSafetyStage : null,
            safety_score: Number.isFinite(safetyDiagnosis.dynamicFlexSafetyScore) ? safetyDiagnosis.dynamicFlexSafetyScore : null,
            safety_risk_streak: Number.isFinite(safetyDiagnosis.dynamicFlexSafetyRiskStreak) ? safetyDiagnosis.dynamicFlexSafetyRiskStreak : null,
            safety_stable_streak: Number.isFinite(safetyDiagnosis.dynamicFlexSafetyStableStreak) ? safetyDiagnosis.dynamicFlexSafetyStableStreak : null,
            safety_transition: safetyDiagnosis.dynamicFlexSafetyTransition || '',
            safety_runway_pre_months: Number.isFinite(safetyDiagnosis.runwayMonateVorTransaktion) ? safetyDiagnosis.runwayMonateVorTransaktion : null,
            runway_after_transaction_before_payout_months: runwayAfterTransactionBeforePayoutMonths,
            safety_runway_after_transaction_before_payout_months: runwayAfterTransactionBeforePayoutMonths,
            safety_runway_post_months: Number.isFinite(safetyDiagnosis.dynamicFlexSafetyRunwayMonate)
                ? safetyDiagnosis.dynamicFlexSafetyRunwayMonate
                : null,
            runway_post_payout_end_of_year_months: runwayPostPayoutEndOfYearMonths,
            safety_real_drawdown_pct: Number.isFinite(keyParams.realerDepotDrawdown) ? keyParams.realerDepotDrawdown * 100 : null,
            liq_before_payout: liqBeforePayout,
            liq_after_payout: liqAfterPayout,
            liq_after_interest: liqNachZins,
            portfolio_total_before_payout: portfolioTotalBeforePayout,
            portfolio_active_end: portfolioActiveEnd,
            portfolio_flow_delta: portfolioFlowDelta,
            tax_cash_adjustment: taxCashAdjustment,
            cash_interest_taxable_signed: signedEuros(actionResult?.taxSettlement?.cashInterestIncomeSigned),
            cash_interest_tax_delta: signedEuros(actionResult?.taxSettlement?.cashInterestTaxDelta),
            balance_trace: normalizedBalanceTrace,
            health_bucket_enabled: !!healthBucketDiagnostics?.enabled,
            health_bucket_start: euros(healthBucketCoverage?.startAmount ?? healthBucketInterest?.startAmount),
            health_bucket_triggered: !!healthBucketCoverage?.triggered,
            health_bucket_reason: healthBucketCoverage?.reason || '',
            health_bucket_eligible_need: euros(healthBucketCoverage?.eligibleNeed),
            health_bucket_used: euros(healthBucketCoverage?.used),
            health_bucket_uncovered_need: euros(healthBucketCoverage?.uncoveredNeed),
            health_bucket_interest: signedEuros(healthBucketInterest?.interest),
            health_bucket_end: healthBucketEnd,
            health_bucket_target_nominal: euros(healthBucketDiagnostics?.nominalTarget),
            health_bucket_target_inflation_adjusted: euros(healthBucketDiagnostics?.inflationAdjustedTarget),
            health_bucket_real_coverage_pct: healthBucketDiagnostics?.realCoveragePct ?? null,
            health_bucket_target_gap: euros(healthBucketDiagnostics?.targetGap),
            health_bucket_warning: healthBucketWarnings.join(' | '),
            portfolio_total_end: portfolioTotalEnd,
            steuern_gesamt: totalTaxesThisYear,
            vk,
            kaufAkt: kaufAktTotal,
            kaufGld: totalGoldKauf,
            wertAktien,
            wertGold,
            liquiditaet,
            eq_before_return: equityBeforeReturn,
            eq_after_return: equityAfterReturn,
            eq_after_sales: equityAfterSales,
            eq_after_buys: equityAfterBuys,
            gold_before_return: goldBeforeReturn,
            gold_after_return: goldAfterReturn,
            gold_after_sales: goldAfterSales,
            gold_after_buys: goldAfterBuys,
            netTradeEq: equityAfterReturn - equityAfterBuys,
            // Legacy-Phasendifferenz des Wertpapierdepots, bei drei Töpfen inkl. Anleihen.
            // Die historischen Phasenfelder behalten ihre Zahlen; vk enthält alle Jahresverkäufe.
            executedSaleEq: equityAfterReturn - equityAfterSales,
            liqStart: initialLiqStart,
            personalPayout,
            personAccounts: nextPortfolio.personAccounts?.map(person => ({ ...person })),
            personalTaxModel: actionResult.personalAnnualTaxes ? 'personal_annual_settlement' : 'legacy_pooled_tax_unproven',
            cashInterestEarned: cashZinsen,
            liqEnd: inheritanceLog ? liquiditaet : liqNachZins,
            liq_post_payout_end_of_year: liquiditaet,
            zielLiquiditaet: zielLiquiditaet || 0,
            bondBucketAfter,
            bondRefillGross,
            bondRefillNet,
            bondRefillTax,
            bondSaleAmount,
            aktionUndGrund: aktionText,
            usedSPB: actionResult?.taxSettlement?.spbUsedThisYear || actionResult.pauschbetragVerbraucht || 0,
            floor_brutto: effectiveBaseFloor,
            pension_annual: pensionResult.pensionAnnual,
            rente1,
            rente2,
            renteSum,
            floor_aus_depot: inflatedFloor,
            flex_brutto: inflatedFlex,
            flex_erfuellt_nominal: fulfilledFlexFromPortfolio,
            flex_brutto_haushalt: grossHouseholdFlex,
            flex_rentenueberschuss: pensionFlexContribution,
            flex_aus_depot_bedarf: dynamicPortfolioFlex ?? inflatedFlex,
            flex_haushalt_basis: dynamicPortfolioFlex !== null
                ? 'effective_vpw_plus_pension_surplus'
                : 'static_input',
            flex_aus_depot_erfuellt: fulfilledFlexFromPortfolio,
            flex_haushalt_erfuellt: fulfilledHouseholdFlex,
            flex_haushalt_kuerzung_pct: householdFlexReductionPct,
            inflation_factor_cum: cumulativeInflationFactor,
            jahresentnahme_real: jahresEntnahmeEffektiv / cumulativeInflationFactor,
            pflege_aktiv: careLog.pflege_aktiv,
            pflege_zusatz_floor: careLog.pflege_zusatz_floor,
            pflege_zusatz_floor_delta: careLog.pflege_zusatz_floor_delta,
            pflege_flex_faktor: careLog.pflege_flex_faktor,
            pflege_kumuliert: careLog.pflege_kumuliert,
            pflege_grade: careLog.pflege_grade,
            pflege_grade_label: careLog.pflege_grade_label,
            pflege_delta_flex: careLog.pflege_delta_flex,
            WidowBenefitP1: widowBenefits.p1FromP2
                ? pensionResult.widowBenefitP1ThisYear
                : 0,
            WidowBenefitP2: widowBenefits.p2FromP1
                ? pensionResult.widowBenefitP2ThisYear
                : 0,
            NeedLiq: 0,
            GuardGold: 0,
            GuardEq: 0,
            GuardNote: guardReason,
            Person1Alive: p1Alive ? 1 : 0,
            Person2Alive: p2Alive ? 1 : 0,
            lossCarryEnd: actionResult.personalAnnualTaxes
                ? nextPortfolio.personAccounts.reduce((total, person) => total + (Number(person.taxState?.lossCarry) || 0), 0)
                : Number(spendingNewState?.taxState?.lossCarry) || 0,
            taxSavedByLossCarry: Number(actionResult?.taxSettlement?.taxSavedByLossCarry) || 0,
            pflege_floor_anchor: careLog.pflege_floor_anchor,
            pflege_maxfloor_anchor: careLog.pflege_maxfloor_anchor,
            pflege_cap_zusatz: careLog.pflege_cap_zusatz,
            CareP1_Active: careLog.CareP1_Active,
            CareP1_Cost: careLog.CareP1_Cost,
            CareP1_Grade: careLog.CareP1_Grade,
            CareP1_GradeLabel: careLog.CareP1_GradeLabel,
            CareP2_Active: careLog.CareP2_Active,
            CareP2_Cost: careLog.CareP2_Cost,
            CareP2_Grade: careLog.CareP2_Grade,
            CareP2_GradeLabel: careLog.CareP2_GradeLabel,
            threeBucket: {
                isBadYear,
                bondBucketBefore: euros(bondBucketBefore),
                bondBucketAfter: euros(bondBucketAfter),
                bondRefillGross: euros(bondRefillGross),
                bondRefillNet: euros(bondRefillNet),
                bondRefillTax: euros(bondRefillTax),
                bondSaleAmount: euros(bondSaleAmount),
                bondRefillDebugVersion,
                bondRefillSaleShortfallGross: euros(bondRefillSaleShortfallGross),
                equityPreserved: euros(equityPreserved),
                unmetLiquidity: euros(unmetLiquidity)
            }
        },
        totalTaxesThisYear
    };
    // PE-1/MP-1: Das feste Literal bleibt frei von bedingten Spreads.
    // Die sieben späteren Gruppen haben keine Schlüssel mit späteren festen
    // Feldern gemeinsam; ihre gegenseitige Zuweisungsreihenfolge bleibt erhalten.
    const logData = result.logData;
    if (Array.isArray(stressReplayTransactionDiagnostics)) {
        logData.stressReplayTransactionDiagnostics = stressReplayTransactionDiagnostics.map(diagnostic => ({
            ...diagnostic,
            breakdown: Array.isArray(diagnostic?.breakdown)
                ? diagnostic.breakdown.map(entry => ({ ...entry })) : [],
            missingness: Array.isArray(diagnostic?.missingness)
                ? diagnostic.missingness.map(entry => ({ ...entry })) : []
        }));
    }
    if (fullResult.input?.decumulation?.mode === '3_bucket_jilge') {
        Object.assign(logData, { wertAktienEnthaeltAnleihen: true,
            executedSaleAkt: legacySaleTotals.vkAkt, executedSaleAnl: legacySaleTotals.vkBnd });
    }
    if (actionResult.personalPayoutSale?.persons?.length) {
        logData.personalPayoutSales = actionResult.personalPayoutSale.persons;
    }
    if (actionResult.personalAnnualTaxes) {
        logData.tax_funding_sale_gross = actionResult.personalAnnualTaxes.reduce((sum, row) => sum + row.taxFundingGross, 0);
    }
    if (incomeLog) {
        if (incomeLog.pflegegeld > 0) {
            logData.pflegegeld = incomeLog.pflegegeld;
            logData.pflegegeld_personen = incomeLog.pflegegeld_personen;
        }
        Object.assign(logData, { sonstige_einkuenfte: incomeLog.sonstige_einkuenfte,
            sonstige_einkuenfte_personen: incomeLog.sonstige_einkuenfte_personen,
            einkuenfte_gespart: incomeLog.einkuenfte_gespart,
            einkuenfte_gespart_personen: incomeLog.einkuenfte_gespart_personen });
    }
    if (careLog.CareP1_FamilyFallback) logData.CareP1_FamilyFallback = careLog.CareP1_FamilyFallback;
    if (careLog.CareP2_FamilyFallback) logData.CareP2_FamilyFallback = careLog.CareP2_FamilyFallback;
    // FR-72 Punkt 18: verbleibender Grundbedarf und Heimposten getrennt, nur bei Heimpflege; die gezogene
    // Form bei „Amtlich“ steht auch zu Hause im Jahreszustand.
    if (Object.hasOwn(careLog, 'pflege_heimkosten')) logData.grundbedarf_zu_hause = yearNeed?.homeFloor ?? null;
    for (const [key, value] of Object.entries(careLog)) {
        if (/^(?:pflege_heim|CareP[12]_(?:Form|Heim))/.test(key)) logData[key] = value;
    }

    const inheritanceFields = inheritanceLog ? { abgang_erben: inheritanceLog.abgang_erben,
        erbschaftsteuer: inheritanceLog.erbschaftsteuer, inheritance: inheritanceLog.inheritance } : null;
    // Frühe Gruppen rückwärts ergänzen: spätere Werte haben wie bisher Vorrang.
    for (const source of [expenseLog, inflowLog, inheritanceFields]) {
        if (!source) continue;
        for (const key of Object.keys(source)) {
            if (!Object.hasOwn(logData, key)) copyLogField(logData, key, source[key]);
        }
    }
    // Nur unprotokollierte MC-Jahre dürfen die interne Feldreihenfolge behalten.
    // Backtest, Szenario, Replay und JSON/CSV erhalten die bisherige Reihenfolge.
    if (preserveLogOrder) {
        result.logData = /** @type {typeof logData} */ (restoreSimulatorLogOrder(logData, [inheritanceFields, inflowLog, expenseLog]));
    }
    return result;
}
