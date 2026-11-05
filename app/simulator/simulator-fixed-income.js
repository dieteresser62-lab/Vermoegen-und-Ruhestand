/** @import {CareAllowanceAnnual} from '../../typcheck/simulator-ui.js' */
/** FR-42: persönliche Nettobeträge, Kalendergrenzen und Fortschreibung im Jahrespfad. */
import { inheritancePercent, inheritsHomeAndTax } from '../profile/household-partnership.js';
import { homeWasSold, inheritedHomeShare } from './simulator-home-sale.js';
import { incomeErrors, monthlyOtherIncome } from '../profile/profile-income.js';
import { syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { careAllowanceAnnual, careFormForPerson } from '../shared/care-benefits.js';
import { fixedIncomeSurplus } from '../shared/fixed-income-budget.js';
import { computeRentAdjRate } from '../shared/income-adjustment.js';
export { decidedIncomeFlex } from '../shared/fixed-income-budget.js';

/** Geschützte Vorjahresrate, gemeinsam für Jahresabschluss und Reserveprojektion.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param state Zustand des Simulationspfads.
 * @param yearData Historische Jahresdaten.
 * @returns {number} Ergebnis der Operation.
 */
export function nextFixedIncomeWageFactor(inputs, state, yearData) {
    const wageRate = inputs.fixedIncome.some(entry => entry.anpassung === 'lohn')
        ? computeRentAdjRate({ rentAdjMode: 'wage' }, yearData) : Number(yearData.lohn) || 0;
    return (state.fixedIncomeWageFactor ?? 1) * (1 + wageRate / 100);
}

/**
 * @param inputs Wirksame Simulationseingaben.
 * @returns Ergebnis der Operation.
 */
export function fixedIncomeErrors(inputs) {
    if (!inputs.fixedIncome?.length) return [];
    const people = new Set((inputs.simulationPeople || []).map(person => person.profileId));
    const errors = incomeErrors(inputs.fixedIncome).map(error => ({ fieldId: error.field, message: error.message }));
    if (!Number.isInteger(inputs.fixedIncomeReferenceYear)) errors.push({ fieldId: 'fixedIncomeReferenceYear', message: 'Einkünfte: Das Bezugsjahr fehlt.' });
    inputs.fixedIncome.forEach((entry, index) => {
        if (entry.art !== 'sonstige' || (people.size && !people.has(entry.profileId))) {
            errors.push({ fieldId: `income-${index}-profileId`, message: `Einkünfte ${index + 1}: Art oder Person ist ungültig.` });
        }
    });
    return errors;
}

/**
 * @param {object} options
 * @param options.inputs
 * @param options.state
 * @param options.yearIndex
 * @param options.inflationFactor
 * @param options.household
 * @param options.deathThisYear
 * @param [options.care]
 * @returns Ergebnis der Operation.
 */
export function calculateFixedIncomeForYear({ inputs, state, yearIndex, inflationFactor, household, deathThisYear, care = household?.care }) {
    const careAllowance = (meta, personIndex) => meta?.active ? /** @type {CareAllowanceAnnual} */ (careAllowanceAnnual)({ grade: meta.grade,
        preset: inputs.pflegeKostenStaffelPreset, careForm: careFormForPerson(inputs, meta.grade, personIndex, { ...household, care }),
        inflationFactor, careValues: inputs.careValues }) : 0;
    const allowanceP1 = careAllowance(care?.p1, 0), allowanceP2 = careAllowance(care?.p2, 1);
    if (!inputs.fixedIncome?.length && !allowanceP1 && !allowanceP2) return null;
    const year = inputs.fixedIncomeReferenceYear + yearIndex;
    const primaryId = inputs.simulationPeople?.[0]?.profileId || inputs.simulationSourceProfileId || 'simulation';
    const partnerId = inputs.simulationPeople?.[1]?.profileId;
    const persons = new Map();
    for (const entry of inputs.fixedIncome || []) {
        // Der Haushaltsprojektor stellt die Personenkennung vor die lokale Einkunftskennung.
        const localId = entry.profileId && entry.id?.startsWith(`${entry.profileId}:`)
            ? entry.id.slice(entry.profileId.length + 1) : entry.id;
        const rental = localId?.startsWith('immobilie:');
        if (rental && (inputs.home || []).some((home, index) =>
            home.profileId === entry.profileId && `immobilie:${home.id}` === localId && homeWasSold(state.portfolio, home, index))) continue;
        let profileId = entry.profileId || primaryId;
        const alive = profileId === partnerId ? household.p2Alive : household.p1Alive;
        let lifeFactor = alive ? 1 : deathThisYear ? .5 : 0;
        if (!alive && !deathThisYear && rental
            && state.survivor?.deceasedProfileId === profileId) {
            const index = (inputs.home || []).findIndex(home => home.profileId === profileId && `immobilie:${home.id}` === localId);
            lifeFactor = index >= 0 ? inheritedHomeShare(inputs, state.portfolio, state.survivor, inputs.home[index], index, inflationFactor)
                : inheritsHomeAndTax(inputs.partnership, profileId) ? 1
                    : inputs.partnership ? inheritancePercent(inputs.partnership, profileId) / 100 : 1;
            profileId = state.survivor.survivorProfileId;
        }
        const adjustment = entry.anpassung === 'inflation' ? inflationFactor
            : entry.anpassung === 'lohn' ? state.fixedIncomeWageFactor ?? 1 : 1;
        const amount = monthlyOtherIncome([entry], year, { baseYear: inputs.fixedIncomeReferenceYear }) * 12 * adjustment * lifeFactor;
        persons.set(profileId, (persons.get(profileId) || 0) + amount);
    }
    const allowancePersons = [];
    for (const [profileId, allowance, alive] of [[primaryId, allowanceP1, household.p1Alive], [partnerId || primaryId, allowanceP2, household.p2Alive]]) {
        if (!allowance) continue;
        const amount = allowance * (alive ? 1 : deathThisYear ? .5 : 0);
        persons.set(profileId, (persons.get(profileId) || 0) + amount);
        allowancePersons.push({ profileId, amount });
    }
    const rows = [...persons].map(([profileId, amount]) => ({ profileId, amount }));
    return { total: rows.reduce((sum, row) => sum + row.amount, 0), persons: rows, ...(allowancePersons.length ? { pflegegeld: allowancePersons.reduce((sum, row) => sum + row.amount, 0), pflegegeld_personen: allowancePersons } : {}) };
}

/** Nur der nicht verbrauchte Teil wird gebucht; der Rest senkt die Entnahme.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param income
 * @param pension
 * @param floor
 * @param flex
 * @param dynamicFlex
 * @param inputs Wirksame Simulationseingaben.
 * @param [previous]
 * @returns Ergebnis der Operation.
 */
export function creditFixedIncomeSurplus(portfolio, income, pension, floor, flex, dynamicFlex, inputs, previous = null) {
    const otherIncome = income?.total || 0;
    const total = pension.pensionAnnual + otherIncome;
    const flexLimit = Math.max(0, flex) * (dynamicFlex ? 2 : 1);
    const surplus = fixedIncomeSurplus(total, floor, flex, dynamicFlex);
    // Keine neuen Protokollfelder in unveränderten reinen Rentenjahren.
    if (!(otherIncome > 0) && !(surplus > 0) && !previous) return null;
    const primaryId = inputs.simulationPeople?.[0]?.profileId || inputs.simulationSourceProfileId || portfolio.simulationSourceProfileId || 'simulation';
    const partnerId = inputs.simulationPeople?.[1]?.profileId
        || portfolio.personAccounts.find(person => person.profileId !== primaryId)?.profileId || primaryId;
    // Die bisherige Rentenanrechnung deckt den Bedarf zuerst. Ein darüber
    // verbleibender sonstiger Betrag bleibt bei der Person, die ihn erhält.
    const pensionSurplus = fixedIncomeSurplus(pension.pensionAnnual, floor, flex, dynamicFlex);
    const credits = (income?.persons || []).filter(row => row.amount > 0).map(row => ({ profileId: row.profileId,
        amount: (surplus - pensionSurplus) * row.amount / otherIncome }));
    for (const [profileId, amount] of [[primaryId, pension.rente1], [partnerId, pension.rente2]]) {
        if (!(amount > 0) || !(pensionSurplus > 0)) continue;
        const credit = pensionSurplus * amount / pension.pensionAnnual;
        const row = credits.find(person => person.profileId === profileId);
        if (row) row.amount += credit;
        else credits.push({ profileId, amount: credit });
    }
    for (const row of credits) {
        const account = portfolio.personAccounts.find(person => person.profileId === row.profileId);
        if (!account) throw new Error('Einkünfte: Das persönliche Tagesgeldkonto fehlt.');
        account.tagesgeld += row.amount - (previous?.einkuenfte_gespart_personen.find(person => person.profileId === row.profileId)?.amount || 0);
    }
    if (surplus > 0) syncPersonalLiquidity(portfolio);
    return { ...(income?.pflegegeld > 0 ? { pflegegeld: income.pflegegeld, pflegegeld_personen: income.pflegegeld_personen } : {}),
        sonstige_einkuenfte: otherIncome, sonstige_einkuenfte_personen: income?.persons || [],
        einkuenfte_gespart: surplus, einkuenfte_gespart_personen: credits,
        flexIncomeContribution: Math.min(Math.max(0, total - floor), flexLimit) };
}
