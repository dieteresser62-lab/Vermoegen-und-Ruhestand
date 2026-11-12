import { calculateCareNeeds, nextYearCareState } from '../shared/care-needs.js';
import { resolveSimulatorCumulativeInflationFactor } from './simulator-engine-helpers.js';
import { calculateHouseholdPensionForYear } from './simulator-household-pension.js';
import { calculateFixedIncomeForYear } from './simulator-fixed-income.js';
import { homeRentForYear } from './simulator-home-sale.js';
import { simulatorPlannedExpenseYear } from '../profile/household-planned-expenses.js';

/** Volles Folgejahr ohne Todesjahrmischung oder neue Ereignisse. Originalzustände bleiben erhalten. */
export function projectCareLiquidityYear({ inputs, state, portfolio, household, yearIndex, inflationFactor,
    pension, fixedIncomeWageFactor = state.fixedIncomeWageFactor }) {
    const currentFactor = resolveSimulatorCumulativeInflationFactor(state);
    const care = { p1: household.p1Alive ? nextYearCareState(household.care?.p1, inputs) : null,
        p2: household.p2Alive ? nextYearCareState(household.care?.p2, inputs) : null };
    const nextHousehold = { ...household, care };
    const needs = calculateCareNeeds({ inputs, household, baseFloor: state.baseFloor,
        inflationFactor: currentFactor, nextInflationFactor: inflationFactor, yearIndex,
        referenceDate: inputs.careReferenceDate, priced: true }).next;
    // FR-43: Feste geplante Ausgaben des Folgejahrs gehören zu dessen Grundbedarf.
    const floor = needs.total + homeRentForYear({ ...portfolio }, inputs, nextHousehold, inflationFactor)
        + simulatorPlannedExpenseYear(inputs, yearIndex + 1, inflationFactor).fixed;
    const flex = state.baseFlex * needs.flexFactor * inflationFactor / currentFactor;
    const nextPension = calculateHouseholdPensionForYear({ inputs, yearIndex: yearIndex + 1, ...nextHousehold,
        currentAnnualPension: pension.nextAnnualPension, currentAnnualPension2: pension.nextAnnualPension2,
        widowPensionP1: pension.nextWidowPensionP1, widowPensionP2: pension.nextWidowPensionP2 });
    const income = calculateFixedIncomeForYear({ inputs, state: { ...state, portfolio, fixedIncomeWageFactor },
        household: nextHousehold, care, yearIndex: yearIndex + 1, inflationFactor, deathThisYear: false });
    return { floor, flex, income: nextPension.pensionAnnual + (income?.total || 0),
        priceFactor: inflationFactor / currentFactor };
}
