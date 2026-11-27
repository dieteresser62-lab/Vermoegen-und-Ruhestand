/** FR-64: nominal feste Vorauszahlung ab dem Folgejahr des Erbfalls. */
import { endResidenceRights } from './simulator-home-sale.js';
import { payPersonalCostInAdvance } from './simulator-personal-tax.js';

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param survivor
 * @param household
 * @returns Ergebnis der Operation.
 */
export function payResidenceTaxForYear(portfolio, inputs, survivor, household, maxAdvance = Infinity) {
    if (!portfolio.residenceTax) return null;
    const tax = portfolio.residenceTax;
    const people = inputs.simulationPeople || [];
    const matches = people.map((person, index) => person.profileId === tax.profileId ? index : -1).filter(index => index >= 0);
    const index = matches.length === 1 ? matches[0] : -1;
    const knownPayer = index === 0 || index === 1;
    if (knownPayer) endResidenceRights(portfolio, inputs, { ...survivor, survivorProfileId: tax.profileId }, household);
    const alive = index === 0 ? household.p1Alive : index === 1 ? household.p2Alive : true;
    if (!alive || (!portfolio.rentBequest && !Object.values(portfolio.homeInheritance || {}).some(home => home.residenceActive))) return null;
    // Ein verbliebener Freibetrag wird jährlich um den Jahreswert aufgezehrt.
    const exempt = Math.min(tax.annualValue, tax.allowanceRemaining);
    const amount = (tax.annualValue - exempt) * tax.rate;
    portfolio.residenceTax = { ...tax, allowanceRemaining: tax.allowanceRemaining - exempt };
    for (const key of ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt']) {
        portfolio[key] = (portfolio[key] || []).map(lot => ({ ...lot }));
    }
    // NK-2b (Gutachten NK2C Befund 1): Zu Beginn nur aus Geld über Grundbedarf und Pflege des Jahres; der Rest ist Forderung (Schuldenbuch).
    const advance = Math.min(amount, Math.max(0, maxAdvance));
    const paid = payPersonalCostInAdvance(portfolio, tax.profileId, advance);
    const payment = { ...paid, shortfall: paid.shortfall + amount - advance };
    return { wohnrechtsteuer: payment.paidCost, residenceTaxPayment: { profileId: tax.profileId, due: amount,
        annualValue: tax.annualValue, rate: tax.rate, exempt, allowanceRemaining: tax.allowanceRemaining - exempt,
        annualTax: tax.annualTax, ...(portfolio.rentBequest ? { rentBequest: true } : {}),
        ...(!knownPayer ? { note: 'Zahler der Wohnrechtsteuer nicht eindeutig zugeordnet; Zahlung wird fortgesetzt.' } : {}), ...payment } };
}
