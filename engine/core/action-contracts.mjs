// @ts-check
/** @import {Action,ActionSource,NormalizedEngineInput} from '../../typcheck/rechenkern' */
import { FinancialCalculationError } from '../errors.mjs';
import { resolvePlannedAction } from '../../types/planned-action-contract.js';
/** @param {Action & {quellen:ActionSource[];verwendungen:Record<string,number>}} action */
export function _assertFinalActionReconciliation(action) {
    const sources = action.quellen;
    const invalidAssetSource = sources.find(source => (
        source.kind !== 'liquiditaet'
        && (
            typeof source.brutto !== 'number'
            || !Number.isFinite(source.brutto)
            || source.brutto < 0
            || typeof source.steuer !== 'number'
            || !Number.isFinite(source.steuer)
            || typeof source.netto !== 'number'
            || !Number.isFinite(source.netto)
            || source.netto < -0.01
            || source.steuer < -0.01
            || source.steuer > source.brutto + 0.01
        )
    ));
    if (invalidAssetSource) {
        throw new FinancialCalculationError(
            'Eine finale Verkaufsquelle besitzt ungueltige Brutto-, Steuer- oder Nettowerte. Bitte pruefen Sie die Depot-Tranchen und Steuerparameter.',
            { contract: 'final_action_reconciliation', source: invalidAssetSource }
        );
    }

    const invalidCashSource = sources.find(source => (
        source.kind === 'liquiditaet'
        && (
            typeof source.brutto !== 'number'
            || !Number.isFinite(source.brutto)
            || source.brutto < 0
        )
    ));
    if (invalidCashSource) {
        throw new FinancialCalculationError(
            'Eine finale Liquiditätsquelle besitzt einen ungültigen Bruttowert.',
            { contract: 'planned_liquidity_flow', source: invalidCashSource }
        );
    }

    const assetSourceNet = sources
        .filter(source => source.kind !== 'liquiditaet')
        .reduce((total, source) => total + source.netto, 0);
    const cashSourceGross = sources
        .filter(source => source.kind === 'liquiditaet')
        .reduce((total, source) => total + source.brutto, 0);
    const sourceFundingTotal = assetSourceNet + cashSourceGross;
    const useTotal = Object.values(action?.verwendungen || {})
        .reduce((total, value) => total + value, 0);
    const actionNet = action.nettoErlös;
    if (typeof actionNet !== 'number' || !Number.isFinite(actionNet) || actionNet < 0) {
        throw new FinancialCalculationError(
            'Der Netto-Gesamtbetrag der finalen Transaktion ist ungültig.',
            { contract: 'planned_action_flow', actionNet }
        );
    }
    if (
        action.type === 'NONE'
        && (sourceFundingTotal > 0.01 || useTotal > 0.01 || actionNet > 0.01)
    ) {
        throw new FinancialCalculationError(
            'Eine Nichttransaktions-Aktion darf keine finanziellen Quellen oder Verwendungen enthalten.',
            {
                contract: 'planned_action_flow',
                sourceFundingTotal,
                useTotal,
                actionNet
            }
        );
    }
    if (action.verwendungen.liquiditaet > assetSourceNet + 0.01) {
        throw new FinancialCalculationError(
            'Der geplante Liquiditätszufluss ist nicht durch Netto-Assetverkäufe gedeckt.',
            {
                contract: 'planned_liquidity_flow',
                plannedLiquidityInflow: action.verwendungen.liquiditaet,
                assetSourceNet
            }
        );
    }
    if (
        Math.abs(sourceFundingTotal - useTotal) > 0.01
        || Math.abs(sourceFundingTotal - actionNet) > 0.01
    ) {
        throw new FinancialCalculationError(
            `Die finale Transaktion ist nicht ausgeglichen: Quellen-Finanzierung ${sourceFundingTotal.toFixed(2)} EUR, Verwendungen ${useTotal.toFixed(2)} EUR, Action-Netto ${actionNet.toFixed(2)} EUR. Bitte pruefen Sie die Depot-Tranchen und Transaktionsbudgets.`,
            {
                contract: 'final_action_reconciliation',
                assetSourceNet,
                cashSourceGross,
                sourceFundingTotal,
                useTotal,
                actionNet
            }
        );
    }
}

/** @param {Action} action
 * @param {NormalizedEngineInput} input
 * @param {number} availableLiquidity
 * @param {string} phase */
export function _assertPlannedActionContract(action, input, availableLiquidity, phase) {
    /** @param {unknown} value */
    const normalizeTqf = value => {
        const normalized = Number(value);
        return Number.isFinite(normalized) ? normalized : 0;
    };
    const plannedActionResolution = resolvePlannedAction({
        action,
        availableLiquidity,
        detailedTranches: input.detailledTranches,
        legacyCapacities: {
            aktien_alt: input.depotwertAlt,
            aktien_neu: input.depotwertNeu,
            gold: input.goldWert
        },
        legacyTaxMetadata: {
            aktien_alt: {
                costBasis: input.costBasisAlt,
                tqf: normalizeTqf(input.tqfAlt),
                taxExempt: input.taxExemptAlt === true
            },
            aktien_neu: {
                costBasis: input.costBasisNeu,
                tqf: normalizeTqf(input.tqfNeu),
                taxExempt: input.taxExemptNeu === true
            },
            gold: {
                costBasis: input.goldCost,
                tqf: 0,
                taxExempt: input.goldSteuerfrei === true
            }
        }
    });
    if (plannedActionResolution.status === 'resolved') return plannedActionResolution;

    const liquidityContractReasons = new Set([
        'cash_source_overbooked',
        'liquidity_inflow_without_asset_source'
    ]);
    const contract = liquidityContractReasons.has(plannedActionResolution.reason)
        || (
            plannedActionResolution.reason === 'use_amount_invalid'
            && plannedActionResolution.context?.key === 'liquiditaet'
        )
        ? 'planned_liquidity_flow'
        : 'planned_action_flow';
    throw new FinancialCalculationError(
        'Die Transaktionsplanung verletzt den gemeinsamen Action-Vertrag.',
        {
            contract,
            phase,
            reason: plannedActionResolution.reason,
            ...plannedActionResolution.context
        }
    );
}
