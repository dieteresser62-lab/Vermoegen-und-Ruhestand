import { isInResidentialCare } from '../shared/care-benefits.js';

/** Heutige Pflege gilt dauerhaft. Ein neu gezogener akuter Heimaufenthalt lässt die Miete weiterlaufen.
 * @param {import('../../typcheck/rechenkern.js').SimulatorInputs} inputs
 * @param {number} index
 * @param {Partial<import('../../typcheck/rechenkern.js').HouseholdContext>} household */
export function isInPermanentResidentialCare(inputs, index, household) {
    const care = household?.care?.[index === 0 ? 'p1' : 'p2'];
    return isInResidentialCare(inputs, index, household) && (inputs.pflegeModellTyp !== 'akut' || Number(care?.initialGrade) > 0);
}

/** Zahlung und Mietbedarf zu Preisen des laufenden Jahres. Der Pfad legt die Rente erst beim Jahresabschluss des Erbfalls an.
 * ER-2: Nach „Verkauf mit Wohnkapital“ (selfPaid) zahlt die überlebende Person die Miete selbst; es gibt keine Einnahme.
 * @param {import('../../typcheck/rechenkern.js').SimulationPortfolio|undefined} portfolio
 * @param {import('../../typcheck/rechenkern.js').SimulatorInputs} inputs
 * @param {Partial<import('../../typcheck/rechenkern.js').HouseholdContext>} household
 * @param {number} inflationFactor */
export function rentBequestForYear(portfolio, inputs, household, inflationFactor) {
    const bequest = portfolio?.rentBequest;
    if (!bequest) return null;
    const index = inputs.simulationPeople?.findIndex(person => person.profileId === bequest.profileId);
    if (!(index === 0 ? household.p1Alive : index === 1 && household.p2Alive)) return null;
    const amount = bequest.annualAmount * inflationFactor;
    const rent = bequest.rentEnded || isInPermanentResidentialCare(inputs, index, household) ? 0 : amount;
    return { profileId: bequest.profileId, income: bequest.selfPaid ? 0 : amount, rent, ...(bequest.selfPaid ? { selfPaid: true } : {}) };
}

/** Nur die Rente aus dem Erbe bringt Einnahmen.
 * @param {Parameters<typeof rentBequestForYear>} args */
export function rentBequestIncomeForYear(...args) {
    const bequest = rentBequestForYear(...args);
    return bequest?.selfPaid ? null : bequest;
}
