// @ts-check
/** @import {Action,ActionSource,NormalizedEngineInput,Diagnosis,ThreeBucketState} from '../../typcheck/rechenkern' */
import { FinancialCalculationError } from '../errors.mjs';
import { settleTaxYear } from '../tax-settlement.mjs';
import { _allocateFinalTaxToActionSources } from './action-source-tax.mjs';
import { _assertFinalActionReconciliation } from './action-contracts.mjs';
const ACTION_USE_KEYS = new Set(['liquiditaet', 'gold', 'aktien', 'bonds']);

/** @param {{action:Action;normalizedInput:NormalizedEngineInput;taxStatePrev:{lossCarry:number};
 * hasAssetSale:boolean;rawSourcePlanFunding:number;diagnosis:Diagnosis;threeBucketDiagnosis:ThreeBucketState|null}} params */
export function settleAnnualAction({
    action, normalizedInput, taxStatePrev,
    hasAssetSale, rawSourcePlanFunding, diagnosis,
    threeBucketDiagnosis
}) {
    const rawTaxAggregate = action?.taxRawAggregate;
    const rawTaxAggregatePrototype = rawTaxAggregate && typeof rawTaxAggregate === 'object'
        ? Object.getPrototypeOf(rawTaxAggregate)
        : null;
    const hasPlainTaxAggregate = rawTaxAggregate !== null
        && typeof rawTaxAggregate === 'object'
        && !Array.isArray(rawTaxAggregate)
        && (rawTaxAggregatePrototype === Object.prototype || rawTaxAggregatePrototype === null);
    const hasValidTaxAggregateValues = hasPlainTaxAggregate
        && typeof rawTaxAggregate.sumRealizedGainSigned === 'number'
        && Number.isFinite(rawTaxAggregate.sumRealizedGainSigned)
        && typeof rawTaxAggregate.sumTaxableAfterTqfSigned === 'number'
        && Number.isFinite(rawTaxAggregate.sumTaxableAfterTqfSigned);
    if (hasAssetSale && !hasValidTaxAggregateValues) {
        throw new FinancialCalculationError(
            'Eine geplante Asset-Transaktion besitzt kein gültiges Rohsteueraggregat.',
            {
                contract: 'planned_action_flow',
                field: 'taxRawAggregate',
                taxRawAggregate: rawTaxAggregate ?? null
            }
        );
    }
    const actionRawAggregate = {
        sumRealizedGainSigned: hasValidTaxAggregateValues
            ? rawTaxAggregate.sumRealizedGainSigned
            : 0,
        sumTaxableAfterTqfSigned: hasValidTaxAggregateValues
            ? rawTaxAggregate.sumTaxableAfterTqfSigned
            : 0
    };
    const steuerPlanGesamt = hasAssetSale ? (Number(action.steuer) || 0) : 0;
    const nettoErloesPlan = hasAssetSale ? (Number(action.nettoErlös) || 0) : 0;
    const bruttoVerkaufGesamt = hasAssetSale
        ? /** @type {ActionSource[]} */ (action.quellen).reduce(
            (summe, source) => summe + (source?.kind === 'liquiditaet' ? 0 : (Number(source?.brutto) || 0)),
            0
        )
        : 0;
    const taxSettlementDeferred = normalizedInput.deferTaxSettlement === true;
    const taxSettlement = taxSettlementDeferred
        ? {
            taxDue: steuerPlanGesamt,
            taxStateNext: { ...taxStatePrev },
            details: {
                deferred: true,
                reason: 'profile_attribution_required',
                sumRealizedGainSigned: actionRawAggregate.sumRealizedGainSigned,
                sumTaxableAfterTqfSigned: actionRawAggregate.sumTaxableAfterTqfSigned,
                lossCarryStart: taxStatePrev.lossCarry,
                taxPlanDue: steuerPlanGesamt
            }
        }
        : settleTaxYear({
            taxStatePrev,
            rawAggregate: actionRawAggregate,
            sparerPauschbetrag: normalizedInput.sparerPauschbetrag,
            kirchensteuerSatz: normalizedInput.kirchensteuerSatz
        });
    const rawTaxCashAdjustment = hasAssetSale
        ? steuerPlanGesamt - taxSettlement.taxDue
        : 0;

    if (rawTaxCashAdjustment < -0.01) {
        throw new FinancialCalculationError(
            `Die finale Steuer uebersteigt die eingeplante Steuerreserve um ${Math.abs(rawTaxCashAdjustment).toFixed(2)} EUR. Bitte pruefen Sie die Steuerparameter und Depot-Tranchen.`,
            {
                contract: 'tax_reserve',
                taxCashAdjustment: rawTaxCashAdjustment,
                steuerPlanGesamt,
                finalTax: taxSettlement.taxDue
            }
        );
    }
    // Dieselbe Subcent-Regel wie im Simulator-Recompute: negatives
    // Rundungsrauschen bis einschließlich 0,01 EUR darf keine negative
    // Verwendung und damit keinen falschen Liquiditätsfehler erzeugen.
    const taxCashAdjustment = rawTaxCashAdjustment < 0 && rawTaxCashAdjustment >= -0.01
        ? 0
        : rawTaxCashAdjustment;
    const rawVerwendungen = action?.verwendungen;
    const rawUsesPrototype = rawVerwendungen && typeof rawVerwendungen === 'object'
        ? Object.getPrototypeOf(rawVerwendungen)
        : null;
    const hasPlainUses = rawVerwendungen !== null
        && typeof rawVerwendungen === 'object'
        && !Array.isArray(rawVerwendungen)
        && (rawUsesPrototype === Object.prototype || rawUsesPrototype === null);
    const hasRawUsesProperty = Object.prototype.hasOwnProperty.call(action, 'verwendungen');
    if ((action.type === 'TRANSACTION' || hasRawUsesProperty) && !hasPlainUses) {
        throw new FinancialCalculationError(
            'Die geplanten Verwendungen der Transaktion besitzen keinen gültigen Objektvertrag.',
            {
                contract: 'planned_action_flow',
                rawUsesType: Array.isArray(rawVerwendungen) ? 'array' : typeof rawVerwendungen
            }
        );
    }
    const invalidRawUse = hasPlainUses
        ? Object.entries(rawVerwendungen).find(([, value]) => (
            typeof value !== 'number' || !Number.isFinite(value) || value < 0
        ))
        : null;
    const invalidRawUseKey = hasPlainUses
        ? Object.keys(rawVerwendungen).find(key => !ACTION_USE_KEYS.has(key))
        : null;
    if (invalidRawUseKey) {
        throw new FinancialCalculationError(
            'Die geplante Transaktion besitzt einen unbekannten Verwendungsschlüssel.',
            {
                contract: 'planned_action_flow',
                key: invalidRawUseKey
            }
        );
    }
    if (invalidRawUse) {
        const [key, value] = invalidRawUse;
        throw new FinancialCalculationError(
            'Eine geplante Verwendung der Transaktion ist ungültig.',
            {
                contract: key === 'liquiditaet' ? 'planned_liquidity_flow' : 'planned_action_flow',
                key,
                value
            }
        );
    }
    const rawUseTotal = hasPlainUses
        ? Object.values(rawVerwendungen).reduce((total, value) => total + value, 0)
        : 0;
    if (
        action.type === 'TRANSACTION'
        && (
            Math.abs(rawSourcePlanFunding - rawUseTotal) > 0.01
            || Math.abs(rawSourcePlanFunding - /** @type {number} */ (action.nettoErlös)) > 0.01
        )
    ) {
        throw new FinancialCalculationError(
            'Die geplante Transaktion ist bereits vor dem Steuer-Settlement nicht ausgeglichen.',
            {
                contract: 'planned_action_flow',
                rawSourcePlanFunding,
                rawUseTotal,
                actionNet: action.nettoErlös
            }
        );
    }
    action.quellen = _allocateFinalTaxToActionSources(action?.quellen, taxSettlement.taxDue);

    const verwendungen = Object.fromEntries(
        Object.entries(hasPlainUses ? rawVerwendungen : {})
            .map(([key, value]) => [key, value])
    );
    verwendungen.liquiditaet = Number(verwendungen.liquiditaet) || 0;
    verwendungen.gold = Number(verwendungen.gold) || 0;
    verwendungen.aktien = Number(verwendungen.aktien) || 0;
    if (hasAssetSale) {
        verwendungen.liquiditaet += taxCashAdjustment;
        action.nettoErlös = nettoErloesPlan + taxCashAdjustment;
    } else if (action?.type === 'NONE') {
        action.nettoErlös = 0;
    }

    action.bruttoVerkaufGesamt = bruttoVerkaufGesamt;
    action.steuerPlanGesamt = steuerPlanGesamt;
    action.nettoErlösPlan = nettoErloesPlan;
    action.taxCashAdjustment = taxCashAdjustment;
    action.verwendungen = verwendungen;
    action.taxRawAggregate = actionRawAggregate;
    action.taxSettlement = taxSettlement.details;
    action.taxSettlementDeferred = taxSettlementDeferred;
    // NOTE: action is passed by reference to the UI payload below.
    // We intentionally override steuer with the final annual settlement tax.
    action.steuer = taxSettlement.taxDue;
    _assertFinalActionReconciliation(/** @type {Action & {quellen:ActionSource[];verwendungen:Record<string,number>}} */ (action));
    diagnosis.keyParams = diagnosis.keyParams || /** @type {import('../../typcheck/rechenkern').KeyParams} */ ({});
    diagnosis.keyParams.taxSettlement = taxSettlement.details;
    if (threeBucketDiagnosis) {
        diagnosis.keyParams.threeBucket = threeBucketDiagnosis;
    }

    return { taxSettlement };
}
