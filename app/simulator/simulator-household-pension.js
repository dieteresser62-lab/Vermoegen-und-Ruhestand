/** @import {HouseholdContext} from '../../typcheck/rechenkern.js'
 *
 * Module: Simulator Household Pension
 * Purpose: DOM-free pension and widow benefit calculations for simulator years.
 */
"use strict";

// FR-22: aktueller Rentenwert ab 01.07.2026, Stand 29.04.2026 (DRV).
// https://rvrecht.deutsche-rentenversicherung.de/SharedDocs/rvRecht/07_AktuelleWerte/A-C/awert_aktrtwt.html
export const CURRENT_PENSION_VALUE = 42.52;
export const CURRENT_PENSION_VALUE_DATE = '2026-07-01';

/**
 * @param {number} ownMonthlyPension
 * @param {number} [pensionValue]
 * @returns {number} Ergebnis der Operation.
 */
export function survivorIncomeOffset(ownMonthlyPension, pensionValue = CURRENT_PENSION_VALUE) {
    // FR-11/22: Die Eingabe ist bereits netto, ohne weiteren Pauschalabzug.
    return Math.max(0, ownMonthlyPension - 26.4 * pensionValue) * 0.4;
}

/**
 * @param {object} options
 * @param options.inputs
 * @param options.yearIndex
 * @param {number} [options.currentAnnualPension]
 * @param {number} [options.currentAnnualPension2]
 * @param {number} [options.widowPensionP1]
 * @param {number} [options.widowPensionP2]
 * @param {boolean} [options.p1Alive]
 * @param {boolean} [options.p2Alive]
 * @param [options.widowBenefits]
 * @param {boolean} [options.deathThisYear]
 * @param {number} [options.effectiveBaseFloor]
 * @param {number} [options.baseFlex]
 * @param {number} [options.temporaryFlexFactor]
 * @returns Ergebnis der Operation.
 */
export function calculateHouseholdPensionForYear({
    inputs,
    yearIndex,
    currentAnnualPension = 0,
    currentAnnualPension2 = 0,
    widowPensionP1 = 0,
    widowPensionP2 = 0,
    p1Alive = true,
    p2Alive = true,
    widowBenefits = /** @type {Partial<HouseholdContext["widowBenefits"]>} */ ({}),
    deathThisYear = false,
    effectiveBaseFloor = 0,
    baseFlex = 0,
    temporaryFlexFactor = 1
}) {
    if (inputs.partner?.aktiv && inputs.partnership?.status === 'unmarried') {
        widowBenefits = { ...widowBenefits, p1FromP2: false, p2FromP1: false };
    }
    const rentAdjPct = inputs.rentAdjPct || 0;
    const p1FromP2Percent = Math.max(
        0,
        Math.min(1, Number(widowBenefits.p1FromP2Percent) || 0)
    );
    const p2FromP1Percent = Math.max(
        0,
        Math.min(1, Number(widowBenefits.p2FromP1Percent) || 0)
    );
    const currentAgeP1 = inputs.startAlter + yearIndex;
    const r1StartOffsetYears = Math.max(0, Number(inputs.renteStartOffsetJahre) || 0);
    const partnerStartOffsetYears = Math.max(0, Number(inputs.partner?.startInJahren) || 0);
    let rente1BruttoEigen = 0;
    let widowBenefitP1ThisYear = 0;
    // Die vollen Rentenbasen werden auch vor Rentenbeginn jährlich angepasst.
    // Ihr Verhältnis zur Eingabe schreibt den Rentenwert mit genau denselben Raten fort.
    const initialPension1 = (inputs.renteMonatlich || 0) * 12;
    const initialPension2 = inputs.partner?.brutto || (inputs.partner?.monatsrente || 0) * 12;
    const pensionValue = CURRENT_PENSION_VALUE * (initialPension1 > 0 && currentAnnualPension > 0
        ? currentAnnualPension / initialPension1
        : initialPension2 > 0 ? currentAnnualPension2 / initialPension2 : 1);
    let widowIncomeOffsetP1 = 0;
    let widowIncomeOffsetP2 = 0;
    let bereavementQuarterP1 = 0;
    let bereavementQuarterP2 = 0;
    let widowBaseP1 = 0;
    let widowBaseP2 = 0;
    const offsetMonths = (startIndex, months) => Math.min(deathThisYear ? 3 : 12,
        12 * pensionPaymentFactor(yearIndex, startIndex, months));

    if (p1Alive && yearIndex >= r1StartOffsetYears) {
        rente1BruttoEigen = currentAnnualPension * pensionPaymentFactor(yearIndex, r1StartOffsetYears, inputs.renteStartMonate);
    }
    if (deathThisYear && !p1Alive && yearIndex >= r1StartOffsetYears) {
        const months = yearIndex === r1StartOffsetYears ? (inputs.renteStartMonate ?? 12) : 12;
        rente1BruttoEigen = currentAnnualPension * Math.max(0, months - 6) / 12;
    }
    if (p1Alive && widowBenefits.p1FromP2 && yearIndex >= partnerStartOffsetYears) {
        widowBaseP1 = widowPensionP1 > 0
            ? widowPensionP1
            : Math.max(0, currentAnnualPension2 * p1FromP2Percent);
        const fullOffset = Math.min(widowBaseP1, survivorIncomeOffset(
            yearIndex >= r1StartOffsetYears ? currentAnnualPension / 12 : 0, pensionValue) * 12);
        const overlap = offsetMonths(r1StartOffsetYears, inputs.renteStartMonate);
        widowIncomeOffsetP1 = fullOffset * (overlap / 12);
        widowBenefitP1ThisYear = overlap === (deathThisYear ? 3 : 12)
            ? (widowBaseP1 - fullOffset) * (deathThisYear ? 0.25 : 1)
            : widowBaseP1 * (deathThisYear ? 0.25 : 1) - widowIncomeOffsetP1;
        bereavementQuarterP1 = deathThisYear ? currentAnnualPension2 * 0.25 : 0;
    }

    const rente1_brutto = rente1BruttoEigen + widowBenefitP1ThisYear + bereavementQuarterP1;
    const rente1 = rente1_brutto;

    let rente2BruttoEigen = 0;
    let widowBenefitP2ThisYear = 0;
    let rente2 = 0;

    if (inputs.partner?.aktiv && p2Alive) {
        if (yearIndex >= partnerStartOffsetYears) {
            rente2BruttoEigen = currentAnnualPension2 * pensionPaymentFactor(yearIndex, partnerStartOffsetYears, inputs.partner.renteStartMonate);
            // FR-11: Beide Eingaben sind verfügbare Nettorenten. Alte Quoten bleiben wirkungslos.
            rente2 = rente2BruttoEigen;
            rente2 = Math.max(0, rente2);
        }
    }
    if (deathThisYear && !p2Alive && inputs.partner?.aktiv && yearIndex >= partnerStartOffsetYears) {
        const months = yearIndex === partnerStartOffsetYears ? (inputs.partner.renteStartMonate ?? 12) : 12;
        rente2BruttoEigen = currentAnnualPension2 * Math.max(0, months - 6) / 12;
        rente2 = rente2BruttoEigen;
    }

    if (p2Alive && widowBenefits.p2FromP1 && yearIndex >= r1StartOffsetYears) {
        widowBaseP2 = widowPensionP2 > 0
            ? widowPensionP2
            : Math.max(0, currentAnnualPension * p2FromP1Percent);
        const fullOffset = Math.min(widowBaseP2, survivorIncomeOffset(
            yearIndex >= partnerStartOffsetYears ? currentAnnualPension2 / 12 : 0, pensionValue) * 12);
        const overlap = offsetMonths(partnerStartOffsetYears, inputs.partner?.renteStartMonate);
        widowIncomeOffsetP2 = fullOffset * (overlap / 12);
        widowBenefitP2ThisYear = overlap === (deathThisYear ? 3 : 12)
            ? (widowBaseP2 - fullOffset) * (deathThisYear ? 0.25 : 1)
            : widowBaseP2 * (deathThisYear ? 0.25 : 1) - widowIncomeOffsetP2;
        bereavementQuarterP2 = deathThisYear ? currentAnnualPension * 0.25 : 0;
    }

    const rente2_brutto = rente2BruttoEigen + widowBenefitP2ThisYear + bereavementQuarterP2;
    if (widowBenefitP2ThisYear > 0) {
        rente2 += widowBenefitP2ThisYear;
    }
    rente2 += bereavementQuarterP2;

    const renteSum = rente1 + rente2;
    const pensionAnnual = renteSum;
    const pensionSurplus = Math.max(0, pensionAnnual - effectiveBaseFloor);
    const inflatedFloor = Math.max(0, effectiveBaseFloor - pensionAnnual);
    const inflatedFlex = Math.max(0, (baseFlex * temporaryFlexFactor) - pensionSurplus);
    const widowAdjFactor = 1 + (rentAdjPct / 100);

    return {
        rentAdjPct,
        currentAgeP1,
        rente1BruttoEigen,
        widowBenefitP1ThisYear,
        rente1_brutto,
        rente1,
        rente2BruttoEigen,
        widowBenefitP2ThisYear,
        rente2_brutto,
        rente2,
        renteSum,
        pensionAnnual,
        pensionSurplus,
        inflatedFloor,
        inflatedFlex,
        widowIncomeOffsetP1,
        widowIncomeOffsetP2,
        bereavementQuarterP1,
        bereavementQuarterP2,
        pensionValue,
        nextWidowPensionP1: widowBenefits.p1FromP2
            ? Math.max(0, widowBaseP1 * widowAdjFactor)
            : 0,
        nextWidowPensionP2: widowBenefits.p2FromP1
            ? Math.max(0, widowBaseP2 * widowAdjFactor)
            : 0,
        nextAnnualPension: currentAnnualPension * (1 + rentAdjPct / 100),
        nextAnnualPension2: currentAnnualPension2 * (1 + rentAdjPct / 100)
    };
}

/** Der Anteil kürzt nur die Auszahlung, niemals die nächste Jahresbasis.
 *
 * @param {number} yearIndex Nullbasierter Index des Simulationsjahrs.
 * @param {number} startIndex
 * @param {number} [months]
 * @returns {number} Ergebnis der Operation.
 */
export function pensionPaymentFactor(yearIndex, startIndex, months = 12) {
    if (!Number.isInteger(months) || months < 1 || months > 12) throw new Error('Ungültige Rentenmonate im Startjahr.');
    return yearIndex < startIndex ? 0 : yearIndex === startIndex ? months / 12 : 1;
}
