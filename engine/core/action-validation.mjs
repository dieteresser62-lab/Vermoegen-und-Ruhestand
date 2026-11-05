// @ts-check
/** @import {Action,ActionSource} from '../../typcheck/rechenkern' */
import { FinancialCalculationError } from '../errors.mjs';
const ACTION_SOURCE_KINDS = new Set([
    'liquiditaet',
    'aktien_alt',
    'aktien_neu',
    'anleihe',
    'gold'
]);
/** @param {{action:Action}} params */
export function validateRawAction({ action }) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new FinancialCalculationError(
            'Die Transaktionsplanung hat kein gültiges Action-Objekt geliefert.',
            { contract: 'planned_action_flow', actionType: Array.isArray(action) ? 'array' : typeof action }
        );
    }
    if (action.type !== 'TRANSACTION' && action.type !== 'NONE') {
        throw new FinancialCalculationError(
            'Die Transaktionsplanung hat einen unbekannten Action-Typ geliefert.',
            { contract: 'planned_action_flow', actionType: action.type }
        );
    }
    const hasRawSourcesProperty = Object.prototype.hasOwnProperty.call(action, 'quellen');
    if (
        (action.type === 'TRANSACTION' || hasRawSourcesProperty)
        && !Array.isArray(action.quellen)
    ) {
        throw new FinancialCalculationError(
            'Die Quellen der geplanten Transaktion besitzen keinen gültigen Array-Vertrag.',
            {
                contract: 'planned_action_flow',
                rawSourcesType: action.quellen === null ? 'null' : typeof action.quellen
            }
        );
    }
    const invalidRawSourceIndex = Array.isArray(action.quellen)
        ? action.quellen.findIndex(source => (
            !source
            || typeof source !== 'object'
            || Array.isArray(source)
            || !ACTION_SOURCE_KINDS.has(source.kind)
            || typeof source.brutto !== 'number'
            || !Number.isFinite(source.brutto)
            || source.brutto < 0
            || typeof source.steuer !== 'number'
            || !Number.isFinite(source.steuer)
            || source.steuer < 0
            || source.steuer > source.brutto + 0.01
            || typeof source.netto !== 'number'
            || !Number.isFinite(source.netto)
            || source.netto < 0
            || Math.abs((source.brutto - source.steuer) - source.netto) > 0.01
            || (
                source.kind === 'liquiditaet'
                && (
                    Math.abs(source.steuer) > 0.01
                    || Math.abs(source.netto - source.brutto) > 0.01
                )
            )
        ))
        : -1;
    if (invalidRawSourceIndex >= 0) {
        throw new FinancialCalculationError(
            'Eine Quelle der geplanten Transaktion ist ungültig.',
            {
                contract: 'planned_action_flow',
                sourceIndex: invalidRawSourceIndex,
                source: /** @type {ActionSource[]} */ (action.quellen)[invalidRawSourceIndex]
            }
        );
    }
    const rawAssetSources = Array.isArray(action.quellen)
        ? action.quellen.filter(source => source.kind !== 'liquiditaet')
        : [];
    const rawCashSources = Array.isArray(action.quellen)
        ? action.quellen.filter(source => source.kind === 'liquiditaet')
        : [];
    const hasAssetSale = rawAssetSources.length > 0;
    const rawSourcePlanTax = rawAssetSources.reduce((total, source) => total + source.steuer, 0);
    const rawSourcePlanFunding = rawAssetSources.reduce((total, source) => total + source.netto, 0)
        + rawCashSources.reduce((total, source) => total + source.brutto, 0);
    if (
        action.type === 'TRANSACTION'
        && (
            typeof action.nettoErlös !== 'number'
            || !Number.isFinite(action.nettoErlös)
            || action.nettoErlös < 0
        )
    ) {
        throw new FinancialCalculationError(
            'Der geplante Netto-Gesamtbetrag der Transaktion ist ungültig.',
            {
                contract: 'planned_action_flow',
                field: 'nettoErlös',
                value: action.nettoErlös
            }
        );
    }
    const hasRawActionTax = Object.prototype.hasOwnProperty.call(action, 'steuer');
    if (
        action.type === 'TRANSACTION'
        && (
            (hasRawActionTax && (
                typeof action.steuer !== 'number'
                || !Number.isFinite(action.steuer)
                || action.steuer < 0
            ))
            || (hasAssetSale && !hasRawActionTax)
            || (hasAssetSale && Math.abs(/** @type {number} */ (action.steuer) - rawSourcePlanTax) > 0.01)
            || (!hasAssetSale && hasRawActionTax && /** @type {number} */ (action.steuer) > 0.01)
        )
    ) {
        throw new FinancialCalculationError(
            'Die geplante Gesamtsteuer der Transaktion ist ungültig oder nicht mit den Quellen reconciliert.',
            {
                contract: 'planned_action_flow',
                field: 'steuer',
                value: action.steuer,
                rawSourcePlanTax
            }
        );
    }

    return { hasAssetSale, rawSourcePlanFunding };
}
