// @ts-check
/** @import {EngineSuccess,YearOutcome} from '../../../typcheck/rechenkern' */
import { plannedExpensesForYear } from '../../profile/household-planned-expenses.js';
import { calculateFixedIncomeForYear, creditFixedIncomeSurplus, decidedIncomeFlex } from '../simulator-fixed-income.js';
import { personalProfiles } from '../simulator-personal-accounts.js';
import { applyGuardrailPlanChange, prepareGuardrailPlanInputs, shouldResetGuardrailState } from '../../shared/guardrail-history.js';
import { sumDepot } from '../simulator-portfolio.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { finalizeThreeBucketAction } from '../../../engine/transactions/three-bucket-logic.mjs';
import { calculateHouseholdPensionForYear } from '../simulator-household-pension.js';
import { buildSimulatorEngineInput } from '../simulator-engine-input.js';
import { resolvePlannedAnnualWithdrawal } from '../../../types/planned-withdrawal-contract.js';
import { snapshotBalance } from './year-diagnostics.js';
import { SIMULATOR_TECHNICAL_ERROR_CODES, buildTechnicalErrorOutcome } from './outcomes.js';
import { restoreEngineBoundaryPortfolio, alignEngineInflationContract } from './engine-boundary.js';
/** @typedef {import('./year-market.js').YearContext & NonNullable<ReturnType<typeof decideYear>['state']>} YearContext */
/** @param {import('./year-market.js').YearContext} context */
export function decideYear(context) {
    let {
        inputs, yearIndex, currentAnnualPension, currentAnnualPension2, widowPensionP1, widowPensionP2,
        p1Alive, p2Alive, householdCtx, survivorYear, effectiveBaseFloor, baseFlex, temporaryFlexFactor,
        homeSaleLog, currentState, portfolio, cumulativeInflationFactor, careP1, careP2, liquiditaet,
        initialLiqStart, replayCollector, marketDataCurrentYear, marketDataHist, yearData,
        baseMinimumFlexAnnual, temporaryMinimumFlexFactor, baseFlexBudgetAnnual, baseFlexBudgetRecharge,
        resolvedCapeRatio, preparedGuardrailPlan, lastState, replayYear, pflegeMeta, careFloorAddition,
        householdContext, is3Bucket, unmarried, engine, engineBoundaryPortfolio, balanceTrace,
        depotTranchesAktien, depotTranchesGold
    } = context;

    // ==========================================
    // ENTNAHMEPHASE-LOGIK - DIREKTE ENGINE API
    // ==========================================

    const pensionResult = calculateHouseholdPensionForYear({
        inputs,
        yearIndex,
        currentAnnualPension,
        currentAnnualPension2,
        widowPensionP1,
        widowPensionP2,
        p1Alive,
        p2Alive,
        widowBenefits: householdCtx.widowBenefits,
        deathThisYear: survivorYear?.deathThisYear === true,
        effectiveBaseFloor,
        baseFlex,
        temporaryFlexFactor
    });
    const fixedIncome = calculateFixedIncomeForYear({ inputs, state: homeSaleLog ? { ...currentState, portfolio } : currentState, yearIndex,
        inflationFactor: cumulativeInflationFactor, household: householdCtx,
        care: { p1: careP1, p2: careP2 },
        deathThisYear: survivorYear?.deathThisYear === true });
    let incomeLog = /** @type {import('../../../typcheck/rechenkern-integration').CreditFixedIncomeSurplus} */ (creditFixedIncomeSurplus)(portfolio, fixedIncome, pensionResult, effectiveBaseFloor,
        baseFlex * temporaryFlexFactor, inputs.dynamicFlex, inputs);
    if (incomeLog) {
        liquiditaet = portfolio.liquiditaet;
        initialLiqStart = euros(liquiditaet);
        if (incomeLog.einkuenfte_gespart > 0) snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_income_surplus', { incomeSurplus: incomeLog.einkuenfte_gespart });
    }
    const {
        rentAdjPct,
        rente1,
        rente2,
        renteSum,
        pensionAnnual: pensionOnlyAnnual
    } = pensionResult;
    // Gemeinsamer Netto-Pfad zur Engine, ohne die gesetzlichen Renten oder Witwenbasen zu ändern.
    const pensionAnnual = pensionOnlyAnnual + (fixedIncome?.total || 0);
    const pensionSurplus = Math.max(0, pensionAnnual - effectiveBaseFloor);
    const inflatedFloor = Math.max(0, effectiveBaseFloor - pensionAnnual);
    const inflatedFlex = Math.max(0, baseFlex * temporaryFlexFactor - pensionSurplus);

    const depotwertGesamt = sumDepot(portfolio);
    const totalWealth = depotwertGesamt + liquiditaet;

    // Calculate reduced floor/flex for FAIL-SAFE Guard (NOT for engine input!)
    // The engine calculates this internally, but we need it for emergency guard logic
    // (Variables already calculated above: pensionSurplus, inflatedFloor, inflatedFlex)

    // ==========================================
    // DIREKTE ENGINE API - SINGLE CALL
    // ==========================================

    const profilesAtDecision = personalProfiles(portfolio, inputs);
    const plannedExpense = inputs.plannedExpenses?.length ? euros(plannedExpensesForYear(inputs.plannedExpenses,
        /** @type {NonNullable<typeof inputs.plannedExpensesReferenceYear>} */ (inputs.plannedExpensesReferenceYear) + yearIndex, cumulativeInflationFactor)) : 0;
    const { engineInput, detailedTranches } = /** @type {{engineInput:import('../../../typcheck/rechenkern').NormalizedEngineInput & {personalCashInvestmentCapacity?:number};detailedTranches:import('../../../typcheck/rechenkern').EngineTranche[]}} */ (buildSimulatorEngineInput({
        preserveInputShape: Boolean(replayCollector),
        inputs,
        portfolio,
        marketDataCurrentYear,
        marketDataHist,
        yearData,
        yearIndex,
        liquiditaet,
        effectiveBaseFloor,
        baseFlex,
        baseMinimumFlexAnnual,
        temporaryFlexFactor,
        temporaryMinimumFlexFactor,
        p1Alive,
        p2Alive,
        baseFlexBudgetAnnual,
        baseFlexBudgetRecharge,
        pensionAnnual,
        resolvedCapeRatio
    }));
    // Wie in der Balance: erst nach der Budgetentscheidung zum Liquiditätsziel
    // addieren. Das Geld bleibt bis zur späteren Zahlung vor Käufen geschützt.
    if (plannedExpense > 0) engineInput.plannedExpenseLiquidityReserve = plannedExpense;

    // **HAUPTUNTERSCHIED**: Ein einziger Engine-Aufruf statt 3-5 Adapter-Aufrufe
    // PE-1/MP-1: Der MC-Runner reicht die unveränderten Planwerte je Paket durch,
    // auch wenn Hinterbliebenen- oder Steuerzweige inputs lokal kopieren.
    const guardrailPlanInputs = preparedGuardrailPlan || prepareGuardrailPlanInputs(inputs);
    const planLastState = applyGuardrailPlanChange(lastState, currentState.guardrailPlanInputs, guardrailPlanInputs);
    const engineLastState = planLastState?.initialized
        ? { ...planLastState, cumulativeInflationFactor }
        : planLastState;
    if (replayCollector) {
        replayCollector.beforeEngine(replayYear, {
            engineInput,
            engineLastState,
            // Der Direktweg übergibt keinen dritten Engineparameter.
            options: undefined,
            simulatorStateBefore: { ...currentState, portfolio },
            assumptions: inputs,
            householdEvents: { pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor, normalizedHouseholdContext: householdCtx },
            effectiveAnnualPensions: pensionResult,
            marketContext: { yearData, marketDataHist, marketDataCurrentYear, resolvedCapeRatio },
            cumulativeInflationFactor,
            guardrailResetApplied: shouldResetGuardrailState(currentState.guardrailPlanInputs, guardrailPlanInputs)
        });
    }
    if (is3Bucket && unmarried) engineInput.finalizeThreeBucketAction = false;
    let fullResult;
    try {
        fullResult = engine.simulateSingleYear(engineInput, engineLastState);
    } catch (cause) {
        restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_EXECUTION_EXCEPTION,
            `Die Simulations-Engine konnte das Jahr nicht berechnen (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_EXECUTION_EXCEPTION}).`,
            cause
        )) };
    }

    // Die Engine liefert bereits die vollständige Drei-Töpfe-Aktion.
    if (replayCollector) replayCollector.afterEngine(replayYear, fullResult);

    // FAIL-SAFE: Error-Handling
    if (fullResult?.error) {
        restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_ERROR,
            `Die Simulations-Engine hat das Jahr abgewiesen (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_ERROR}).`,
            fullResult.error
        )) };
    }
    if (!fullResult?.ui
        || !fullResult.ui.spending
        || !fullResult.ui.action
        || !fullResult.ui.market
        || !fullResult.newState) {
        restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID,
            `Die Simulations-Engine lieferte ein unvollständiges Ergebnis (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
            fullResult
        )) };
    }

    const plannedWithdrawalResolution = resolvePlannedAnnualWithdrawal({
        spendingResult: fullResult.ui.spending
    });
    if (plannedWithdrawalResolution.status !== 'resolved') {
        restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID,
            `Die Simulations-Engine lieferte keine eindeutige geplante Jahresentnahme (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
            null,
            {
                contract: 'planned_annual_withdrawal',
                status: plannedWithdrawalResolution.status,
                candidates: plannedWithdrawalResolution.candidates
            }
        )) };
    }

    alignEngineInflationContract(/** @type {EngineSuccess} */ (fullResult), cumulativeInflationFactor);

    // Nach der Entscheidung den gesamten unverbrauchten Einkommensrest buchen,
    // auch bei wirksamem VPW und bei ausschließlich gesetzlichen Renten.
    const decidedFlex = decidedIncomeFlex(/** @type {EngineSuccess} */ (fullResult), baseFlex * temporaryFlexFactor,
        inflatedFloor, plannedWithdrawalResolution.annualWithdrawal);
    if (incomeLog || pensionAnnual > effectiveBaseFloor + decidedFlex) {
        const creditedBeforeDecision = incomeLog?.einkuenfte_gespart || 0;
        incomeLog = /** @type {import('../../../typcheck/rechenkern-integration').CreditFixedIncomeSurplus} */ (creditFixedIncomeSurplus)(portfolio, fixedIncome, pensionResult, effectiveBaseFloor,
            decidedFlex, false, inputs, incomeLog);
        liquiditaet = portfolio.liquiditaet;
        initialLiqStart = euros(liquiditaet);
        if (/** @type {NonNullable<typeof incomeLog>} */ (incomeLog).einkuenfte_gespart > creditedBeforeDecision) snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_income_surplus_final', {
            incomeSurplus: /** @type {NonNullable<typeof incomeLog>} */ (incomeLog).einkuenfte_gespart - creditedBeforeDecision });
    }
    return { state: {
        pensionResult, inputs, yearIndex, widowPensionP1, widowPensionP2, p1Alive, p2Alive, householdCtx,
        survivorYear, effectiveBaseFloor, baseFlex, temporaryFlexFactor, fixedIncome, currentState, portfolio,
        cumulativeInflationFactor, careP1, careP2, incomeLog, liquiditaet, initialLiqStart, rente1, rente2,
        renteSum, pensionAnnual, inflatedFloor, inflatedFlex, depotwertGesamt, profilesAtDecision,
        plannedExpense, engineInput, detailedTranches, marketDataCurrentYear, marketDataHist, yearData,
        baseMinimumFlexAnnual, baseFlexBudgetAnnual, baseFlexBudgetRecharge, resolvedCapeRatio,
        guardrailPlanInputs, pflegeMeta, careFloorAddition, is3Bucket, unmarried, fullResult,
        engineBoundaryPortfolio, plannedWithdrawalResolution, balanceTrace, depotTranchesAktien,
        depotTranchesGold
    } };
}
