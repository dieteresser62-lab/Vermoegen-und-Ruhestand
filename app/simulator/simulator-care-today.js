import { makeDefaultCareMeta, priceCareMeta, calcCareCost, computeHouseholdFlexFactor } from './simulator-engine-helpers.js';
import { applyPartnerCareFallback } from '../shared/care-benefits.js';

/** Backtest: heutige Grade festhalten, ohne Ereignisse oder Zufallsziehungen.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param state Zustand des Simulationspfads.
 * @param yearIndex Nullbasierter Index des Simulationsjahrs.
 * @returns Ergebnis der Operation.
 */
export function fixedCareTodayForYear(inputs, state, yearIndex) {
    if (!inputs.careToday?.grade && !(inputs.partner?.aktiv && inputs.partner?.careToday?.grade)) return null;
    const personCare = (person, gender, age) => {
        if (!person?.grade) return null;
        const care = makeDefaultCareMeta(false, gender, person, age, inputs);
        care.floorAtTrigger = inputs.startFloorBedarf;
        care.flexAtTrigger = inputs.startFlexBedarf;
        care.maxFloorAtTrigger = inputs.pflegeMaxFloor;
        care.currentYearInCare = yearIndex + 1;
        return care;
    };
    const p1 = personCare(inputs.careToday, inputs.geschlecht, inputs.startAlter);
    const p2 = inputs.partner?.aktiv
        ? personCare(inputs.partner.careToday, inputs.partner.geschlecht, inputs.partner.startAlter) : null;
    const householdContext = { p1Alive: true, p2Alive: inputs.partner?.aktiv === true, care: { p1, p2 } };
    applyPartnerCareFallback(inputs, householdContext);
    priceCareMeta(p1, inputs, state, yearIndex);
    priceCareMeta(p2, inputs, state, yearIndex);
    return { pflegeMeta: p1, householdContext,
        careFloorAddition: calcCareCost(p1, p2).zusatzFloor,
        temporaryFlexFactor: computeHouseholdFlexFactor({ hasPartner: inputs.partner?.aktiv === true,
            p1Alive: true, p2Alive: inputs.partner?.aktiv === true, careMetaP1: p1, careMetaP2: p2 }) };
}
