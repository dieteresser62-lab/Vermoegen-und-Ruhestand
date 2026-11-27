import { projectCareLiquidityYear } from '../simulator-care-projection.js';
// @ts-check
/** @import {EngineSuccess,YearOutcome} from '../../../typcheck/rechenkern' */
import { simulatorPlannedExpenseYear } from '../../profile/household-planned-expenses.js';
import { checkExpenseTotal } from '../simulator-planned-expense-items.js';
import { calculateFixedIncomeForYear, creditFixedIncomeSurplus, decidedIncomeFlex, nextFixedIncomeWageFactor } from '../simulator-fixed-income.js';
import { personalProfiles, personalWithdrawalPlan } from '../simulator-personal-accounts.js';
import { applyGuardrailPlanChange, prepareGuardrailPlanInputs, shouldResetGuardrailState } from '../../shared/guardrail-history.js';
import { sumDepot } from '../simulator-portfolio.js';
import { euros } from '../simulator-engine-direct-utils.js';
import { finalizeThreeBucketAction } from '../../../engine/transactions/three-bucket-logic.mjs';
import { calculateHouseholdPensionForYear } from '../simulator-household-pension.js';
import { buildSimulatorEngineInput } from '../simulator-engine-input.js';
import { resolvePlannedAnnualWithdrawal } from '../../../types/planned-withdrawal-contract.js';
import { snapshotBalance } from './year-diagnostics.js';
import { deathYearCashShare, deathYearTransactionView } from '../simulator-death-year-cash.js';
import { unmarriedInvestmentReserves } from '../simulator-unmarried.js';
import { SIMULATOR_TECHNICAL_ERROR_CODES, buildTechnicalErrorOutcome } from './outcomes.js';
import { restoreEngineBoundaryPortfolio, alignEngineInflationContract } from './engine-boundary.js';
import { carrierYear, carrierHoldings } from './action-plan.js';
import { activeCarrier } from '../../profile/household-withdrawal-mode.js';
import { carrierTransactionView } from '../../profile/household-carrier-action.js';
import { moneyAssets } from '../simulator-home-sale.js';
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
        depotTranchesAktien, depotTranchesGold, hasLifeEvents, unmarriedShares, yearNeed
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
    // FR-84: Geldvermögen des Haushalts (vor angelegten Einkünften) gegen den Grundbedarf ohne Pflege nach Renten und Einkünften.
    const careNeed = Math.max(0, (yearNeed?.total || 0) - (yearNeed?.homeFloor || 0));
    const incomeAnnual = pensionResult.pensionAnnual + (fixedIncome?.total || 0);
    const basicCoverage = { money: moneyAssets(portfolio), need: Math.max(0, effectiveBaseFloor - careNeed - incomeAnnual), careNeed,
        p1Alive, p2Alive, deathThisYear: survivorYear?.deathThisYear === true, unmarried: Boolean(unmarried), lockedReserve: 0 };
    // NK-2b: ungekappter Bedarf für die Heimregel (nicht aufzählbar, ändert kein Ergebnis).
    Object.defineProperty(basicCoverage, 'rawNeed', { value: effectiveBaseFloor - careNeed - incomeAnnual, enumerable: false });
    let incomeLog = /** @type {import('../../../typcheck/rechenkern-integration').CreditFixedIncomeSurplus} */ (creditFixedIncomeSurplus)(portfolio, fixedIncome, pensionResult, effectiveBaseFloor,
        baseFlex * temporaryFlexFactor, inputs.dynamicFlex, inputs);
    // KR-1c (NG-5): initialLiqStart bleibt der Stand am Jahresanfang vor dem Zins (year-market.js). Der Einkommensüberschuss
    // kommt nach dem Zins in die Liquidität und verzinst sich wie jede Bewegung der Entscheidung erst im Folgejahr.
    if (incomeLog) {
        liquiditaet = portfolio.liquiditaet;
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
    // FR-43: Feste geplante Ausgaben stecken schon im Grundbedarf (year-preparation); hier nur einmalige.
    const requestedExpense = simulatorPlannedExpenseYear(inputs, yearIndex, cumulativeInflationFactor).once;
    const checkedExpenses = checkExpenseTotal(inputs, yearIndex, cumulativeInflationFactor, requestedExpense);
    const plannedExpense = checkedExpenses?.total ?? requestedExpense;
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

    if ((careP1?.active || careP2?.active) && careP1?.heimBestand !== true && careP2?.heimBestand !== true) {
        // Lohnindexierte Einkünfte des Folgejahrs wie im Hinterbliebenenpfad (Gutachten PFA-1, Befund 8).
        engineInput.careLiquidityProjection = projectCareLiquidityYear({ inputs, state: currentState, portfolio,
            household: { ...householdCtx, care: { p1: careP1, p2: careP2 } }, yearIndex,
            inflationFactor: cumulativeInflationFactor * (1 + yearData.inflation / 100), pension: pensionResult,
            fixedIncomeWageFactor: inputs.fixedIncome?.length ? nextFixedIncomeWageFactor(inputs, currentState, yearData)
                : currentState.fixedIncomeWageFactor });
    }

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
    // TJ-1b: Auch im Todesjahr mit Erbanteil unter 100 % fertigt der Simulator die Drei-Töpfe-Aktion nach der Begrenzung.
    const deathYearShare = deathYearCashShare({ inputs, transition: survivorYear, hasLifeEvents });
    if (is3Bucket && (unmarried || deathYearShare < 1)) {
        engineInput.finalizeThreeBucketAction = false;
    }
    /** Engine-Aufruf mit denselben Prüfungen für Haushalts- und Todesjahrsicht. */
    const runEngine = () => {
        let result;
        try {
            result = engine.simulateSingleYear(engineInput, engineLastState);
        } catch (cause) {
            restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
            return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
                SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_EXECUTION_EXCEPTION,
                `Der Rechenkern konnte das Jahr nicht berechnen (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_EXECUTION_EXCEPTION}).`,
                cause
            )) };
        }
        // Die Engine liefert bereits die vollständige Drei-Töpfe-Aktion.
        if (replayCollector && !engineInput.transactionView) replayCollector.afterEngine(replayYear, result);
        // FAIL-SAFE: Error-Handling
        if (result?.error) {
            restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
            return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
                SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_ERROR,
                `Der Rechenkern hat das Jahr abgewiesen (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_ERROR}).`,
                result.error
            )) };
        }
        if (!result?.ui
            || !result.ui.spending
            || !result.ui.action
            || !result.ui.market
            || !result.newState) {
            restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
            return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
                SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID,
                `Der Rechenkern lieferte ein unvollständiges Ergebnis (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
                result
            )) };
        }
        return { result };
    };
    const engineRun = runEngine();
    if (engineRun.outcome) return { outcome: engineRun.outcome };
    let fullResult = engineRun.result;

    const plannedWithdrawalResolution = resolvePlannedAnnualWithdrawal({
        spendingResult: fullResult.ui.spending
    });
    if (plannedWithdrawalResolution.status !== 'resolved') {
        restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID,
            `Der Rechenkern lieferte keine eindeutige geplante Jahresentnahme (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
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
        if (/** @type {NonNullable<typeof incomeLog>} */ (incomeLog).einkuenfte_gespart > creditedBeforeDecision) snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, 'after_income_surplus_final', {
            incomeSurplus: /** @type {NonNullable<typeof incomeLog>} */ (incomeLog).einkuenfte_gespart - creditedBeforeDecision });
    }
    // TJ-2: Im Todesjahr mit Erbanteil unter 100 % entscheidet die Engine Kauf und Auffüllung erneut mit der Sicht der
    // überlebenden Person. Die Ausgabenplanung hängt nicht von dieser Sicht ab und bleibt gleich.
    const deathYearView = deathYearTransactionView({ portfolio, inputs, transition: survivorYear, share: deathYearShare,
        householdLiquidity: /** @type {number} */ (engineInput.aktuelleLiquiditaet),
        bookings: () => unmarried ? unmarriedInvestmentReserves(portfolio, inputs, unmarriedShares,
            plannedWithdrawalResolution.annualWithdrawal, plannedExpense, pensionResult, fixedIncome, incomeLog)
            : personalWithdrawalPlan(personalProfiles(portfolio, inputs), plannedWithdrawalResolution.annualWithdrawal + plannedExpense,
                inputs.householdWithdrawalMode).items.map(item => ({ profileId: item.profileId, amount: item.withdrawalAmount })) });
    // LZ-1 (Ergänzung 2 FR-80): Bei „Eine Person trägt“ entscheidet die Engine Auffüllen und Anlegen erneut, nur mit Tagesgeld und
    // Geldmarkt der tragenden Person (wie die Balance). Ausgaben und Ziel bleiben beim Haushalt; reicht ihr Vermögen nicht, Rückgriff wie bisher.
    const accounts = /** @type {any[]} */ (portfolio.personAccounts || []);
    const carrier = deathYearView || accounts.length < 2 || !activeCarrier(inputs.householdWithdrawalMode, accounts) ? null : carrierYear({ portfolio, inputs, unmarried, unmarriedShares,
        ownReserves: unmarried ? unmarriedInvestmentReserves(portfolio, inputs, unmarriedShares, plannedWithdrawalResolution.annualWithdrawal,
            plannedExpense, pensionResult, fixedIncome, incomeLog) : null,
        withdrawal: plannedWithdrawalResolution.annualWithdrawal + plannedExpense });
    const transactionView = deathYearView ? deathYearView.engineView
        : carrier ? carrierTransactionView(accounts.find(row => row.profileId === carrier.carrierId), carrierHoldings(portfolio, inputs, carrier.carrierId)) : null;
    if (transactionView) {
        engineInput.transactionView = transactionView;
        const viewRun = runEngine();
        if (viewRun.outcome) return { outcome: viewRun.outcome };
        fullResult = viewRun.result;
        alignEngineInflationContract(/** @type {EngineSuccess} */ (fullResult), cumulativeInflationFactor);
    }
    return { state: {
        pensionResult, inputs, yearIndex, widowPensionP1, widowPensionP2, p1Alive, p2Alive, householdCtx,
        survivorYear, effectiveBaseFloor, baseFlex, temporaryFlexFactor, fixedIncome, currentState, portfolio,
        cumulativeInflationFactor, careP1, careP2, incomeLog, liquiditaet, initialLiqStart, rente1, rente2,
        renteSum, pensionAnnual, inflatedFloor, inflatedFlex, depotwertGesamt, profilesAtDecision,
        plannedExpense, checkedExpenses, engineInput, detailedTranches, marketDataCurrentYear, marketDataHist, yearData,
        baseMinimumFlexAnnual, baseFlexBudgetAnnual, baseFlexBudgetRecharge, resolvedCapeRatio,
        guardrailPlanInputs, pflegeMeta, careFloorAddition, is3Bucket, unmarried, fullResult,
        engineBoundaryPortfolio, plannedWithdrawalResolution, balanceTrace, depotTranchesAktien,
        depotTranchesGold, deathYearView, basicCoverage
    } };
}
