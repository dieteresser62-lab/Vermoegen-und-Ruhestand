// @ts-check
/** @import {ActionSource} from '../../typcheck/rechenkern' */
import { FinancialCalculationError } from '../errors.mjs';
/** @param {ActionSource[]|undefined} sources
 * @param {number} finalTax
 * @returns {ActionSource[]} */
export function _allocateFinalTaxToActionSources(sources, finalTax) {
    const sourceList = Array.isArray(sources) ? sources : [];
    const assetRows = sourceList
        .map((source, index) => ({ source, index }))
        .filter(({ source }) => source?.kind && source.kind !== 'liquiditaet');
    const parsedFinalTax = Number(finalTax);
    if (!Number.isFinite(parsedFinalTax) || parsedFinalTax < -0.01) {
        throw new FinancialCalculationError(
            'Die finale Steuer der Transaktion ist ungueltig. Bitte pruefen Sie die Steuerparameter und starten Sie die Berechnung erneut.',
            { contract: 'final_source_tax', finalTax }
        );
    }
    const targetTax = Math.max(0, parsedFinalTax);
    if (!assetRows.length) {
        if (targetTax > 0.01) {
            throw new FinancialCalculationError(
                'Die finale Steuer kann keiner Verkaufsquelle zugeordnet werden. Bitte pruefen Sie die Depot-Tranchen und starten Sie die Berechnung erneut.',
                { contract: 'final_source_tax', targetTax }
            );
        }
        return sourceList.map(source => ({ ...source }));
    }

    const positiveTaxable = assetRows.map(({ source }) => (
        Math.max(0, Number(source?.taxableAfterTqfSigned) || 0)
    ));
    const taxableTotal = positiveTaxable.reduce((total, value) => total + value, 0);
    const grossCaps = assetRows.map(({ source }) => Math.max(0, Number(source?.brutto) || 0));
    const grossTotal = grossCaps.reduce((total, value) => total + value, 0);
    const weights = taxableTotal > 0
        ? positiveTaxable
        : grossCaps;
    const weightTotal = weights.reduce((total, value) => total + value, 0);

    if (targetTax > 0.000000001 && weightTotal <= 0.000000001) {
        throw new FinancialCalculationError(
            'Eine positive finale Steuer steht keiner positiven Brutto-Verkaufsquelle gegenueber. Bitte pruefen Sie die Depot-Tranchen und Steuerdaten.',
            { contract: 'final_source_tax', targetTax, grossTotal, taxableTotal }
        );
    }
    if (targetTax > grossTotal + 0.01) {
        throw new FinancialCalculationError(
            'Die finale Steuer uebersteigt den gesamten Bruttoverkauf. Bitte pruefen Sie die Steuerparameter und Verkaufsquellen.',
            { contract: 'final_source_tax', targetTax, grossTotal }
        );
    }

    const allocations = new Array(assetRows.length).fill(0);
    let taxRemaining = targetTax;
    let active = assetRows
        .map((_, index) => index)
        .filter(index => grossCaps[index] > 0.000000001);

    while (taxRemaining > 0.000000001 && active.length) {
        const activeWeightTotal = active.reduce((total, index) => total + weights[index], 0);
        const useGrossCapacityWeights = activeWeightTotal <= 0.000000001;
        const effectiveWeightTotal = active.reduce((total, index) => (
            total + (
                useGrossCapacityWeights
                    ? Math.max(0, grossCaps[index] - allocations[index])
                    : weights[index]
            )
        ), 0);
        if (effectiveWeightTotal <= 0.000000001) break;

        const remainingBeforeAllocation = taxRemaining;
        const saturated = active.filter(index => {
            const capacity = Math.max(0, grossCaps[index] - allocations[index]);
            const weight = useGrossCapacityWeights
                ? capacity
                : weights[index];
            const proportionalTax = remainingBeforeAllocation * (weight / effectiveWeightTotal);
            return proportionalTax > capacity + 0.000000001;
        });

        if (saturated.length) {
            saturated.forEach(index => {
                const capacity = Math.max(0, grossCaps[index] - allocations[index]);
                allocations[index] += capacity;
                taxRemaining -= capacity;
            });
            const saturatedSet = new Set(saturated);
            active = active.filter(index => !saturatedSet.has(index));
            continue;
        }

        active.forEach(index => {
            const capacity = Math.max(0, grossCaps[index] - allocations[index]);
            const weight = useGrossCapacityWeights
                ? capacity
                : weights[index];
            allocations[index] += remainingBeforeAllocation * (weight / effectiveWeightTotal);
        });
        taxRemaining = 0;
    }

    if (taxRemaining > 0.01) {
        throw new FinancialCalculationError(
            'Die finale Steuer kann nicht ohne negative Nettoquelle verteilt werden. Bitte pruefen Sie die Steuerparameter und Depot-Tranchen.',
            { contract: 'final_source_tax', targetTax, taxRemaining, grossTotal }
        );
    }

    const allocatedByIndex = new Map();
    assetRows.forEach(({ index }, assetIndex) => {
        allocatedByIndex.set(index, allocations[assetIndex]);
    });

    const allocatedTotal = allocations.reduce((total, value) => total + value, 0);
    if (Math.abs(allocatedTotal - targetTax) > 0.01) {
        throw new FinancialCalculationError(
            'Die verteilte Quellensteuer stimmt nicht mit der finalen Steuer ueberein. Bitte pruefen Sie die Steuerparameter und Depot-Tranchen.',
            { contract: 'final_source_tax', targetTax, allocatedTotal }
        );
    }

    return sourceList.map((source, index) => {
        if (!allocatedByIndex.has(index)) return { ...source };
        const allocatedTax = allocatedByIndex.get(index);
        const gross = Math.max(0, Number(source?.brutto) || 0);
        return {
            ...source,
            steuerPlan: Number(source?.steuer) || 0,
            steuer: allocatedTax,
            netto: Math.max(0, gross - allocatedTax)
        };
    });
}
