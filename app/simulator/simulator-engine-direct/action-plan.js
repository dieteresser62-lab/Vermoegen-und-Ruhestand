// @ts-check
/** @import {YearOutcome} from '../../../typcheck/rechenkern' */
import { unmarriedInvestmentReserves } from '../simulator-unmarried.js';
import { calculateRealEquityReturn, finalizeThreeBucketAction, sumBondBucketValuation } from '../../../engine/transactions/three-bucket-logic.mjs';
import { reconcileAttributedThreeBucketState } from '../../profile/profilverbund-action-attribution.js';
import { buildTaxRawAggregate } from '../simulator-tax-recompute.js';
import { personalCashInvestmentProfiles, limitCashInvestment, attributeSimulatorAction } from '../simulator-personal-tax.js';
import { deathYearPurchaseAmount, describeDeathYearPurchase } from '../simulator-death-year-cash.js';
import { SIMULATOR_TECHNICAL_ERROR_CODES, buildTechnicalErrorOutcome } from './outcomes.js';
import { resolvePlannedActionSafely, createPlannedActionFlowSnapshot, resolveAnnualTaxSettlementSafely } from './action-contracts.js';
import { restoreEngineBoundaryPortfolio } from './engine-boundary.js';
/** @typedef {import('./engine-decision.js').YearContext & NonNullable<ReturnType<typeof prepareYearAction>['state']>} YearContext */
/** @param {import('./engine-decision.js').YearContext} context */
export function prepareYearAction(context) {
    let {
        fullResult, liquiditaet, detailedTranches, is3Bucket, portfolio, engineBoundaryPortfolio, taxStatePrev,
        engineInput, combinedTaxRawAggregate, unmarried, inputs, unmarriedShares, plannedWithdrawalResolution,
        plannedExpense, pensionResult, fixedIncome, incomeLog, rA, yearData, bondBucketBefore, deathYearView
    } = context;

    // Extrahiere Ergebnisse direkt aus fullResult
    const spendingResult = fullResult.ui.spending;
    const rawActionResult = fullResult.ui.action;
    const market = fullResult.ui.market;
    const zielLiquiditaet = fullResult.ui.zielLiquiditaet;
    const spendingNewState = fullResult.newState;

    // Die Engine-Grenze wird vor jeder 3-Bucket-Transformation validiert.
    // Andernfalls koennte ein Override einen fehlerhaften Adaptervertrag durch
    // Nullsetzen oder Ersetzen seiner Quellen scheinbar reparieren.
    const rawPlannedActionResolution = resolvePlannedActionSafely({
        action: rawActionResult,
        availableLiquidity: liquiditaet,
        detailedTranches,
        requireAssetInventory: true,
        allowedUseKeys: is3Bucket ? ['liquiditaet', 'gold', 'aktien', 'bonds'] : ['liquiditaet', 'gold', 'aktien']
    });
    if (rawPlannedActionResolution.status !== 'resolved') {
        restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID,
            `Die Simulations-Engine lieferte keine ausgeglichene geplante Transaktion (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
            null,
            {
                contract: 'planned_action_flow',
                phase: 'engine_output',
                reason: rawPlannedActionResolution.reason,
                ...rawPlannedActionResolution.context
            }
        )) };
    }
    const rawActionSnapshot = rawPlannedActionResolution.action;
    const rawTaxSettlementResolution = resolveAnnualTaxSettlementSafely({
        action: rawActionSnapshot,
        newState: spendingNewState,
        taxStatePrev,
        sparerPauschbetrag: engineInput.sparerPauschbetrag,
        kirchensteuerSatz: engineInput.kirchensteuerSatz
    });
    if (rawTaxSettlementResolution.status !== 'resolved') {
        restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID,
            `Die Simulations-Engine lieferte keine zentral reconciliierte Jahressteuer (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
            null,
            {
                contract: 'annual_tax_settlement',
                phase: 'engine_output',
                reason: rawTaxSettlementResolution.reason,
                ...rawTaxSettlementResolution.context
            }
        )) };
    }
    const actionRawAggregate = buildTaxRawAggregate(rawActionSnapshot.taxRawAggregate);
    combinedTaxRawAggregate = { ...actionRawAggregate };
    const actionResult = /** @type {import('../../../typcheck/rechenkern').SimulatorAction} */ ({
        ...rawActionSnapshot,
        ...(Array.isArray(rawActionSnapshot.quellen)
            ? { quellen: rawActionSnapshot.quellen.map(source => ({ ...source })) }
            : {}),
        ...(rawActionSnapshot.verwendungen && typeof rawActionSnapshot.verwendungen === 'object'
            && !Array.isArray(rawActionSnapshot.verwendungen)
            ? { verwendungen: { ...rawActionSnapshot.verwendungen } }
            : {}),
        ...(rawActionSnapshot.taxRawAggregate && typeof rawActionSnapshot.taxRawAggregate === 'object'
            && !Array.isArray(rawActionSnapshot.taxRawAggregate)
            ? { taxRawAggregate: { ...rawActionSnapshot.taxRawAggregate } }
            : {})
    });

    const ownReserves = unmarried && !deathYearView ? unmarriedInvestmentReserves(portfolio, inputs, unmarriedShares,
        plannedWithdrawalResolution.annualWithdrawal, plannedExpense, pensionResult, fixedIncome, incomeLog) : null;
    // TJ-1/TJ-2: Im Todesjahr hat die Engine mit der Sicht der überlebenden Person entschieden. Gekauft wird nur von
    // ihrem Konto und höchstens, was nach ihrem eigenen Ausgabenanteil frei ist (unabhängig von Steuerbüchern).
    const view = deathYearView?.engineView;
    const requestedCash = (actionResult.quellen || [])
        .reduce((sum, source) => source.kind === 'liquiditaet' ? sum + (source.brutto || 0) : sum, 0);
    const deathYearCash = view && requestedCash > 0 ? { requested: requestedCash, survivorProfileId: deathYearView.survivorProfileId,
        invested: deathYearPurchaseAmount(requestedCash, deathYearView.ownFree, actionResult.cashInvestmentRules,
            /** @type {Parameters<typeof deathYearPurchaseAmount>[3]} */ (/** @type {unknown} */ (fullResult)),
            view.depotwertAlt + view.depotwertNeu + (engineInput.goldAktiv ? view.goldWert : 0) + view.aktuelleLiquiditaet) } : null;
    if (deathYearCash) limitCashInvestment(actionResult, deathYearCash.invested);
    const cashReserves = ownReserves;
    const personalCash = is3Bucket && unmarried && !deathYearView && cashReserves ? /** @type {import('../../../typcheck/rechenkern-integration').PersonalCashInvestmentProfiles} */ (personalCashInvestmentProfiles)(portfolio, inputs, cashReserves, actionResult.cashInvestmentRules) : null;
    if (personalCash) {
        engineInput.personalCashInvestmentCapacity = personalCash.reduce((sum, p) => sum + p.capacity, 0);
        limitCashInvestment(actionResult, engineInput.personalCashInvestmentCapacity);
    }

    // Injizierbare Adapter ohne Finalizerdiagnose durchlaufen denselben Baustein.
    // Einzelprofile und Ehepaare werden im Core finalisiert; unverheiratete
    // Haushalte hier nach der persönlichen Liquiditätsreservierung.
    let { updatedAction, threeBucketState } = fullResult.ui.threeBucket
        ? { updatedAction: actionResult, threeBucketState: fullResult.ui.threeBucket }
        : finalizeThreeBucketAction({
            // TJ-2: Im Todesjahr füllt die Auffüllung nur aus Beständen der überlebenden Person.
            detailedTranches: view ? view.detailledTranches : detailedTranches,
            engineInput: view ? { ...engineInput, ...view } : engineInput, market, pendingAction: actionResult,
            realReturnEq: calculateRealEquityReturn(rA * 100, yearData.inflation),
            annualWithdrawalTarget: plannedWithdrawalResolution.annualWithdrawal,
            currentBondValuation: view ? sumBondBucketValuation(view.detailledTranches) : bondBucketBefore
        });

    Object.assign(actionResult, updatedAction);
    const beforeAttribution = { ...actionResult };
    // TJ-2b: Auch die persönliche Zuordnung verkauft und zahlt im Todesjahr nur aus Losen und Liquidität der
    // überlebenden Person (vorhandener Ausschluss fremder Profiltranchen), nie aus dem Nachlass.
    Object.assign(actionResult, /** @type {import('../../../typcheck/rechenkern-integration').AttributeSimulatorAction} */ (attributeSimulatorAction)(portfolio, actionResult, inputs,
        deathYearView ? { onlyProfileId: deathYearView.survivorProfileId, onlyProfileCash: true } : cashReserves ? { cashReserves } : {}));
    if (deathYearCash) describeDeathYearPurchase(actionResult, deathYearCash);
    threeBucketState = reconcileAttributedThreeBucketState(threeBucketState, beforeAttribution, actionResult);
    const plannedActionResolution = resolvePlannedActionSafely({
        action: actionResult,
        availableLiquidity: liquiditaet,
        detailedTranches,
        requireAssetInventory: true,
        allowedUseKeys: is3Bucket ? ['liquiditaet', 'gold', 'aktien', 'bonds'] : ['liquiditaet', 'gold', 'aktien']
    });
    if (plannedActionResolution.status !== 'resolved') {
        restoreEngineBoundaryPortfolio(portfolio, engineBoundaryPortfolio);
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID,
            `Die Simulations-Engine lieferte keine ausgeglichene geplante Transaktion (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
            null,
            {
                contract: 'planned_action_flow',
                phase: 'three_bucket_final',
                reason: plannedActionResolution.reason,
                ...plannedActionResolution.context
            }
        )) };
    }
    const plannedActionFlow = createPlannedActionFlowSnapshot(plannedActionResolution);
    combinedTaxRawAggregate = buildTaxRawAggregate(actionResult?.taxRawAggregate);
    return { state: {
        spendingResult, fullResult, market, zielLiquiditaet, spendingNewState, liquiditaet, is3Bucket,
        portfolio, taxStatePrev, engineInput, combinedTaxRawAggregate, actionResult, unmarried, inputs,
        unmarriedShares, plannedWithdrawalResolution, plannedExpense, pensionResult, fixedIncome, incomeLog,
        threeBucketState, rA, yearData, bondBucketBefore, plannedActionFlow, deathYearCash
    } };
}
