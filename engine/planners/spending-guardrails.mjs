/** @import {Needs, EngineInput, EngineState, SpendingParameters, Market, RunwayProfile, AddDecision, Trace, AlarmStatus, PlannerState, KeyParams} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';
import { calculateWealthAdjustedReductionFactor } from './wealth-reduction.mjs';
import {
    deriveLiquidityRunwayPolicy,
    resolveLiquidityRunwayYears
} from '../../types/liquidity-runway-contract.js';

/**
 * Mutates state.keyParams with wealthReductionFactor and entnahmequoteUsed in recovery contexts.
 */
/** @param {number} rate
 * @param {PlannerState} state
 * @param {SpendingParameters & {kuerzungQuelle:string}} params
 * @param {AddDecision} addDecision */
export function applyGuardrails(rate, state, params, addDecision) {
    const {
        market, inflatedBedarf, renteJahr, input,
        runwayMonate, kuerzungQuelle: initialSource
    } = params;
    const { entnahmequoteDepot } = state.keyParams;

    const isCautionContext = (entnahmequoteDepot >= CONFIG.THRESHOLDS.CAUTION.withdrawalRate);

    let kuerzungQuelle = initialSource;
    let geglätteteFlexRate = rate;
    let cautiousRuleApplied = false;
    const diagnostics = /** @type {import('../../typcheck/rechenkern').GuardrailDiagnostics} */ ({});

    if (market.sKey === 'recovery_in_bear') {
        const gap = market.abstandVomAthProzent || 0;
        let basisCurb = CONFIG.RECOVERY_GUARDRAILS.getCurb(gap);
        if (runwayMonate < 30) basisCurb = Math.max(basisCurb, 20);

        const wealthReduction = calculateWealthAdjustedReductionFactor(params);
        const reductionFactor = wealthReduction.factor;
        if (state.keyParams && Number.isFinite(reductionFactor)) {
            state.keyParams.wealthReductionFactor = reductionFactor;
        }
        if (state.keyParams && Number.isFinite(wealthReduction.entnahmequoteUsed)) {
            state.keyParams.entnahmequoteUsed = wealthReduction.entnahmequoteUsed;
        }

        const curb = basisCurb * reductionFactor;
        const maxFlexRate = 100 - curb;

        if (reductionFactor > 0 && geglätteteFlexRate > maxFlexRate) {
            geglätteteFlexRate = maxFlexRate;
            kuerzungQuelle = reductionFactor < 1
                ? 'Guardrail (vermögensadj.)'
                : 'Guardrail (Vorsicht)';
            addDecision(
                kuerzungQuelle,
                `Recovery-Cap: Flex-Rate auf ${maxFlexRate.toFixed(1)}% gekappt.`,
                'active',
                'guardrail'
            );
            cautiousRuleApplied = true;
        } else if (reductionFactor === 0) {
            addDecision(
                'Vermögensbasierte Anpassung',
                'Recovery-Cap entfällt – Entnahmequote unter dem Safe-Wert.',
                'active',
                'info'
            );
        }
    }

    // Die Vorsicht begrenzt das Anhebungsziel, nicht die Bedarfsindexierung.
    const inflationsFaktor = 1 + Math.max(0, input.inflation) / 100;
    const inflationsAnhebung = Math.max(0, Math.min(100, input.budgetInflationBoost || 0));
    const inflationsBoost = inflationsAnhebung / 100;
    const floorBedarfNachInflation = (inflatedBedarf.floor / inflationsFaktor) * (1 + inflationsBoost);
    const flexBedarfNachInflation = inflatedBedarf.flex / inflationsFaktor;
    const angepasstesMinBudget = floorBedarfNachInflation + flexBedarfNachInflation + renteJahr;
    let geplanteJahresentnahme = inflatedBedarf.floor +
        (inflatedBedarf.flex * (Math.max(0, Math.min(100, geglätteteFlexRate)) / 100));
    let aktuellesGesamtbudget = geplanteJahresentnahme + renteJahr;
    const wealthFactor = Number.isFinite(state.keyParams?.wealthReductionFactor)
        ? Math.min(1, Math.max(0, state.keyParams.wealthReductionFactor))
        : 1;
    const uncappedMinBudgetWithWealth = aktuellesGesamtbudget + (angepasstesMinBudget - aktuellesGesamtbudget) * wealthFactor;
    // FR-60: Nur die Anhebung begrenzen; höhere Policy-Auszahlungen bleiben bestehen.
    const minBudgetWithWealth = Math.min(uncappedMinBudgetWithWealth,
        params.depotwertGesamt > 0
            ? renteJahr + params.depotwertGesamt * CONFIG.THRESHOLDS.CAUTION.withdrawalRate
            : Infinity);
    const noNewLowerYearlyCloses = /** @type {number} */ (input.endeVJ) > Math.min(/** @type {number} */ (input.endeVJ_1), /** @type {number} */ (input.endeVJ_2));
    const hardMinimumMonths = deriveLiquidityRunwayPolicy(resolveLiquidityRunwayYears(input || {}).years).hardMinimumMonths;
    const budgetFloorErlaubt = !['bear_deep', 'recovery_in_bear'].includes(market.sKey) ||
        ((market.abstandVomAthProzent || 0) <= 10 && noNewLowerYearlyCloses &&
            runwayMonate >= Math.max(30, hardMinimumMonths + 6));

    if (budgetFloorErlaubt) {
        diagnostics.budgetFloor = {
            rule: 'min',
            type: 'currency',
            threshold: minBudgetWithWealth,
            value: aktuellesGesamtbudget
        };
    }

    const floorCappedByCaution = budgetFloorErlaubt && !cautiousRuleApplied
        && uncappedMinBudgetWithWealth > Math.max(aktuellesGesamtbudget, minBudgetWithWealth) + 1
        && inflatedBedarf.flex > 0;
    if (isCautionContext || floorCappedByCaution) {
        diagnostics.cautionBudgetFloor = {
            rule: 'max', type: 'percent',
            threshold: CONFIG.THRESHOLDS.CAUTION.withdrawalRate,
            value: entnahmequoteDepot,
            details: { budgetFloorBlocked: floorCappedByCaution }
        };
        if (floorCappedByCaution) {
            kuerzungQuelle = 'Guardrail (Vorsicht)';
            addDecision('Guardrail (Vorsicht)',
                'Anhebung zum Erhalt der Kaufkraft bis 4,5 % Depotquote begrenzt',
                'active', 'guardrail');
        }
    }

    if (budgetFloorErlaubt && !cautiousRuleApplied && aktuellesGesamtbudget + 1 < minBudgetWithWealth) {
        const benötigteJahresentnahme = Math.max(0, minBudgetWithWealth - renteJahr);
        const nötigeFlexRate = inflatedBedarf.flex > 0
            ? Math.min(100, Math.max(0, ((benötigteJahresentnahme - inflatedBedarf.floor) / inflatedBedarf.flex) * 100))
            : 0;

        if (nötigeFlexRate > geglätteteFlexRate) {
            geglätteteFlexRate = nötigeFlexRate;
            kuerzungQuelle = 'Budget-Floor';
            addDecision(
                kuerzungQuelle,
                `Um realen Kaufkraftverlust zu vermeiden, wird Rate auf ${geglätteteFlexRate.toFixed(1)}% angehoben.`,
                'active',
                'guardrail'
            );
            const aktualisierteEntnahme = inflatedBedarf.floor +
                (inflatedBedarf.flex * (Math.max(0, Math.min(100, geglätteteFlexRate)) / 100));
            aktuellesGesamtbudget = aktualisierteEntnahme + renteJahr;
            if (diagnostics.budgetFloor) {
                diagnostics.budgetFloor.value = aktuellesGesamtbudget;
            }
        }
    }

    const preventedFloorRaiseRatePct = floorCappedByCaution
        ? Math.max(0, Math.min(100, (uncappedMinBudgetWithWealth - renteJahr - inflatedBedarf.floor) / inflatedBedarf.flex * 100) - Math.max(rate, geglätteteFlexRate))
        : 0;
    return { rate: geglätteteFlexRate, source: kuerzungQuelle, diagnostics, preventedFloorRaiseRatePct };
}
