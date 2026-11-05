/** Simulator-only, nominal net asset additions. No Balance or income projection. */
import { syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { personPlannedInflowsErrors } from '../profile/profile-planned-inflows.js';
import { maritalPropertyRegime } from '../profile/household-partnership.js';

export { plannedInflowsSummary } from '../profile/profile-planned-inflows.js';

/**
 * @param inputs - Eingaben des Laufes.
 * @returns Ergebnis der Operation.
 */
export function plannedInflowsErrors(inputs) {
    if (!inputs?.plannedInflows?.length) return [];
    const errors = [];
    const start = inputs.plannedInflowsReferenceYear;
    const people = new Set((inputs.simulationPeople || []).map(person => person.profileId));
    inputs.plannedInflows.forEach((entry, index) => {
        const add = (field, message) => errors.push({ fieldId: `plannedInflow-${index}-${field}`,
            message: `Einmalige Einkunft ${index + 1}: ${message}` });
        // Personendaten bleiben auch vor/nach dem gewählten Rechenzeitraum erhalten.
        errors.push(...personPlannedInflowsErrors([entry], { minYear: 1, maxYear: 9999 }).map(error => ({
            fieldId: error.field.replace('plannedInflow-0-', `plannedInflow-${index}-`),
            message: error.message.replace('Einmalige Einkunft 1:', `Einmalige Einkunft ${index + 1}:`)
        })));
        if (!Number.isInteger(start)) add('year', 'Das Bezugsjahr der Rechnung fehlt.');
        if (!people.has(entry.profileId)) add('profileId', 'Wähle eine Person der Rechnung.');
    });
    return errors;
}
/**
 * @param portfolio - Fortgeschriebenes Portfolio.
 * @param inputs - Eingaben des Laufes.
 * @param yearIndex - Nullbasierter Jahresindex.
 * @param {number} [inflationFactor] - Kontext für inflationFactor.
 * @returns Ergebnis der Operation.
 */
export function applyPlannedInflows(portfolio, inputs, yearIndex, inflationFactor = 1) {
    if (!inputs.plannedInflows?.length) return null;
    const entries = inputs.plannedInflows.filter(entry => entry.year - inputs.plannedInflowsReferenceYear === yearIndex);
    if (!entries.length) return null;
    let total = 0;
    const persons = [];
    for (const entry of entries) {
        const account = portfolio.personAccounts.find(person => person.profileId === entry.profileId);
        if (!account || !Number.isFinite(entry.amount) || entry.amount <= 0) throw new Error('Geplante einmalige Einkunft ist ungültig.');
        account.tagesgeld += entry.amount;
        if (inputs.simulationPeople?.length === 2 && inputs.partnership?.status !== 'unmarried'
            && maritalPropertyRegime(inputs.partnership) === 'community') {
            // Planstart-Kaufkraft: beim Tod mit der gesamten Pfadinflation
            // multipliziert, wächst jeder Zufluss erst ab seinem eigenen Jahr.
            portfolio.equalizationInflows = { ...portfolio.equalizationInflows };
            portfolio.equalizationInflows[entry.profileId] = (portfolio.equalizationInflows[entry.profileId] || 0)
                + entry.amount / inflationFactor;
        }
        total += entry.amount;
        persons.push({ profileId: account.profileId, amount: entry.amount, label: entry.label });
    }
    syncPersonalLiquidity(portfolio);
    return { zufluss: total, zufluss_personen: persons };
}
