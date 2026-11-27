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
import { activeCarrier } from '../../profile/household-withdrawal-mode.js';
import { planCarrierAction, carrierAttributionView, cappedPurchaseAmount, nonCarrierSales, carrierViewCapital, carrierReserveShortfall } from '../../profile/household-carrier-action.js';
import { personalProfiles, personalWithdrawalPlan } from '../simulator-personal-accounts.js';
import { buildDetailedTranchesFromPortfolio } from '../simulator-engine-direct-utils.js';
import { buildInputsCtxFromPortfolio } from '../simulator-portfolio.js';
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
            `Die Simulation lieferte keine ausgeglichene geplante Transaktion (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
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
            `Die Simulation lieferte keine zentral reconciliierte Jahressteuer (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
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
    // TJ-2b: Auch die persönliche Zuordnung verkauft und zahlt im Todesjahr nur aus Losen und Liquidität der
    // überlebenden Person (vorhandener Ausschluss fremder Profiltranchen), nie aus dem Nachlass.
    // FR-80 (TRG-1b): „Eine Person trägt“ wie in der Balance – Jahresauszahlung aus eigenem Vermögen, Käufe nur aus eigener freier Liquidität.
    const carrier = deathYearView ? null : carrierYear({ portfolio, inputs, unmarried, unmarriedShares, ownReserves,
        withdrawal: plannedWithdrawalResolution.annualWithdrawal + plannedExpense });
    // VN-3 (Ergänzung 1 FR-80): Mit der Sicht der tragenden Person ordnet die Zuordnung nur ihre Lose und ihre Liquidität zu (wie die Balance).
    const carrierOnly = carrier && engineInput.transactionView?.detailledTranches ? { onlyProfileId: carrier.carrierId, onlyProfileCash: true } : {};
    const attributionOptions = deathYearView ? { onlyProfileId: deathYearView.survivorProfileId, onlyProfileCash: true }
        : cashReserves ? { cashReserves, ...carrierOnly } : carrierOnly;
    const attribute = (/** @type {any} */ action) => /** @type {import('../../../typcheck/rechenkern-integration').AttributeSimulatorAction} */ (attributeSimulatorAction)(portfolio, action, inputs, attributionOptions);
    let attributed;
    if (carrier) {
        const planned = planCarrierAction({ action: actionResult, carrierId: carrier.carrierId, cashBefore: carrier.cashBefore, payout: carrier.payout,
            attribute: action => { const result = /** @type {any} */ (attribute(action)); return { ...carrierAttributionView(result.personalPlannedActions || []), result }; },
            purchase: (requested, free) => cappedPurchaseAmount(requested, free, actionResult.cashInvestmentRules,
                /** @type {any} */ (fullResult), engineInput.transactionView ? carrierViewCapital(engineInput, engineInput.transactionView)
                    : engineInput.depotwertAlt + engineInput.depotwertNeu + (engineInput.goldAktiv ? engineInput.goldWert : 0)
                    + /** @type {number} */ (engineInput.aktuelleLiquiditaet ?? liquiditaet)),
            sale: { lots: carrier.lots, kirchensteuerSatz: carrier.kirchensteuerSatz, market } });
        Object.assign(actionResult, planned.action);
        attributed = planned.result;
    }
    const beforeAttribution = { ...actionResult };
    Object.assign(actionResult, attributed || attribute(actionResult));
    if (carrier) {
        const otherSales = nonCarrierSales(actionResult, carrier.carrierId, /** @type {any} */ (actionResult).personalPlannedActions || []);
        if (otherSales.length) actionResult.carrierAttacked = otherSales;
        // VN-3 (Ergänzung 1 FR-80): Reicht ihr Vermögen nicht für das Liquiditätsziel, bleibt es unerreicht (Hinweis wie in der Balance).
        const short = carrierReserveShortfall({ view: engineInput.transactionView, target: Number(fullResult.ui?.zielLiquiditaet) || 0,
            carrierAction: (/** @type {any} */ (actionResult).personalPlannedActions || []).find((/** @type {any} */ entry) => entry.profileId === carrier.carrierId)?.action });
        if (short > 0) /** @type {any} */ (actionResult).carrierReserveShort = { profileId: carrier.carrierId, amount: short };
    }
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
            `Die Simulation lieferte keine ausgeglichene geplante Transaktion (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_RESULT_SHAPE_INVALID}).`,
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

/** FR-80: Tragende Person im Jahr (eigene Aktien, Gold und Anleihen, VK-2b P2-2), wenn ihr Vermögen für ihren Anteil reicht (sonst Rückgriff über die Auszahlungsverteilung).
 * @param {{portfolio: any, inputs: any, unmarried: boolean, unmarriedShares: any[]|undefined, ownReserves: {profileId: string, amount: number}[]|null, withdrawal: number}} options
 * @returns {{carrierId: string, cashBefore: number, payout: number, lots: any[], kirchensteuerSatz: number}|null} */
export function carrierYear({ portfolio, inputs, unmarried, unmarriedShares, ownReserves, withdrawal }) {
    const accounts = /** @type {any[]} */ (portfolio.personAccounts || []);
    const carrierId = accounts.length > 1 ? activeCarrier(inputs.householdWithdrawalMode, accounts) : null;
    if (!carrierId) return null;
    const account = accounts.find(row => row.profileId === carrierId);
    let payout;
    if (unmarried) {
        if (!unmarriedShares?.some(row => row.carries)) return null;
        payout = ownReserves?.find(row => row.profileId === carrierId)?.amount || 0;
    } else {
        const plan = personalWithdrawalPlan(personalProfiles(portfolio, inputs), withdrawal, inputs.householdWithdrawalMode);
        if (plan.attacked?.length) return null;
        payout = plan.items.find(item => item.profileId === carrierId)?.withdrawalAmount || 0;
    }
    const owner = (/** @type {any} */ lot) => lot.sourceProfileId || portfolio.simulationSourceProfileId;
    const lots = [...(portfolio.depotTranchesAktien || []), ...(portfolio.depotTranchesGold || [])]
        .filter(lot => owner(lot) === carrierId && lot.marketValue > 1e-9);
    const own = lots.length ? buildDetailedTranchesFromPortfolio(/** @type {any} */ ({ depotTranchesAktien: lots, simulationSourceProfileId: portfolio.simulationSourceProfileId })) : [];
    const ownValue = own.reduce((sum, lot) => sum + (Number(lot.marketValue) || 0), 0);
    const cashBefore = (account.tagesgeld || 0) + (account.geldmarktEtf || 0);
    if (unmarried && cashBefore + ownValue + 0.01 < payout) return null;
    return { carrierId, cashBefore, payout, lots: own, kirchensteuerSatz: account.kirchensteuerSatz || 0 };
}

/** VN-3 (Ergänzung 1 FR-80): Eigene Bestände der tragenden Person für die Sicht der Engine, dieselben Felder wie in der Balance.
 * @param {any} portfolio @param {any} inputs @param {string} carrierId */
export function carrierHoldings(portfolio, inputs, carrierId) {
    const owner = (/** @type {any} */ lot) => lot.sourceProfileId || portfolio.simulationSourceProfileId;
    const keys = ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt'];
    const view = { ...portfolio, ...Object.fromEntries(keys.map(key => [key, (portfolio[key] || []).filter((/** @type {any} */ lot) => owner(lot) === carrierId)])) };
    const assets = /** @type {any} */ (buildInputsCtxFromPortfolio(inputs, view, { pensionAnnual: 0, marketData: null }));
    return { depotwertAlt: assets.depotwertAlt, depotwertNeu: assets.depotwertNeu, goldWert: assets.goldWert,
        costBasisAlt: assets.costBasisAlt, costBasisNeu: assets.costBasisNeu, goldCost: assets.goldCost,
        detailledTranches: buildDetailedTranchesFromPortfolio(view) };
}
