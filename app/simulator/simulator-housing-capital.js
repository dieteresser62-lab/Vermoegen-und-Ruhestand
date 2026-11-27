import { housingCapitalFromHome, housingCapitalTax } from '../profile/household-partnership.js';
import { homeKey } from './simulator-home-sale.js';
import { homeValueAtDeath } from './simulator-inheritance.js';
import { syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { isInPermanentResidentialCare } from './simulator-rent-bequest.js';

/**
 * Bucht den Verkauf vor der Bedarfsrechnung, damit Wohnkapital und Miete im selben Jahr wirken.
 * @param {import('../../typcheck/rechenkern.js').SimulationPortfolio} portfolio
 * @param {import('../../typcheck/rechenkern.js').SimulatorInputs} inputs
 * @param {Partial<import('../../typcheck/rechenkern.js').HouseholdContext>} household
 * @param {number} yearIndex
 * @param {number} yearEndInflationFactor
 */
export function housingCapitalMoveForYear(portfolio, inputs, household, yearIndex, yearEndInflationFactor) {
    const pending = portfolio.pendingHousingCapital;
    if (!pending) return null;
    const { profileId, homeKeys, moveOutYearIndex, percent, annualRent, allowanceRemaining } = pending;
    const index = inputs.simulationPeople?.findIndex(person => person.profileId === profileId);
    const alive = index === 0 ? household.p1Alive : index === 1 && household.p2Alive;
    const cancelled = !alive || isInPermanentResidentialCare(inputs, index, household);
    if (!cancelled && yearIndex < moveOutYearIndex) return { housingCapitalMove: { kind: 'staying' } };
    delete portfolio.pendingHousingCapital;
    portfolio.homeSales = [...new Set([...(portfolio.homeSales || []), ...homeKeys])];
    if (cancelled) {
        return { housingCapitalMove: { kind: 'cancelled', reason: alive ? 'care' : 'death' } };
    }

    const homeValue = (inputs.home || []).reduce((sum, home, homeIndex) => homeKeys.includes(homeKey(home, homeIndex))
        ? sum + homeValueAtDeath(home, inputs, yearEndInflationFactor) : sum, 0);
    const amount = housingCapitalFromHome(homeValue, percent);
    const { tax, taxable } = housingCapitalTax(amount, inputs.partnership?.status, pending);
    const account = portfolio.personAccounts.find(person => person.profileId === profileId);
    account.tagesgeld += amount - tax;
    syncPersonalLiquidity(portfolio);
    portfolio.rentBequest = { profileId, annualAmount: annualRent, rentEnded: false, selfPaid: true };
    return { erbschaftsteuer: tax, housingCapitalMove: { kind: 'sold', amount, allowanceRemaining, taxable } };
}
