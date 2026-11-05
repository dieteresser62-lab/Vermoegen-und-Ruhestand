/** @import {CareMeta} from '../../typcheck/rechenkern.js' */
/** Simulator-only household transition. The couple's inflation base stays intact. */
import { syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { computeHouseholdFlexFactor, calcCareCost, resolveSimulatorCumulativeInflationFactor } from './simulator-engine-helpers.js';
import { calculateTargetLiquidityBalanceLike, euros } from './simulator-engine-direct-utils.js';
import { calculateHouseholdPensionForYear } from './simulator-household-pension.js';
import { calculateFixedIncomeForYear } from './simulator-fixed-income.js';
import { homeRentForYear } from './simulator-home-sale.js';
import { plannedExpensesForYear } from '../profile/household-planned-expenses.js';

/** FR-67: voller Resthaushalt statt Halbjahresmischung, zu Preisen des Folgejahrs.
 *
 * @param {object} options
 * @param options.state
 * @param options.portfolio
 * @param options.transition
 * @param options.inputs
 * @param options.household
 * @param options.yearIndex
 * @param options.inflationFactor
 * @param options.marketData
 * @param options.pension
 * @param [options.fixedIncomeWageFactor]
 * @returns {number} Ergebnis der Operation.
 */
export function survivorLiquidityTarget({ state, portfolio, transition, inputs, household, yearIndex,
    inflationFactor, marketData, pension, fixedIncomeWageFactor = state.fixedIncomeWageFactor }) {
    const factor = inflationFactor / resolveSimulatorCumulativeInflationFactor(state);
    const survivorState = { ...state, portfolio, survivor: transition.survivor, fixedIncomeWageFactor };
    const care = { p1: household.p1Alive ? household.care?.p1 : null,
        p2: household.p2Alive ? household.care?.p2 : null };
    const floor = (state.baseFloor * resolveSurvivorFloorFactor(inputs, household, false)
        + calcCareCost(care.p1, care.p2).zusatzFloor) * factor
        + homeRentForYear({ ...portfolio }, inputs, household, inflationFactor);
    const flexFactor = resolveSurvivorFlexFactors(inputs, { ...household, care }, false)?.flexFactor
        ?? computeHouseholdFlexFactor({ hasPartner: inputs.partner?.aktiv === true,
            p1Alive: household.p1Alive, p2Alive: household.p2Alive, careMetaP1: care.p1, careMetaP2: care.p2 });
    const flex = state.baseFlex * flexFactor * factor;
    const nextYearIndex = yearIndex + 1;
    const nextPension = calculateHouseholdPensionForYear({ inputs, yearIndex: nextYearIndex, ...household,
        currentAnnualPension: pension.nextAnnualPension, currentAnnualPension2: pension.nextAnnualPension2,
        widowPensionP1: pension.nextWidowPensionP1, widowPensionP2: pension.nextWidowPensionP2 });
    const income = calculateFixedIncomeForYear({ inputs, state: survivorState, household, care,
        yearIndex: nextYearIndex, inflationFactor, deathThisYear: false });
    const plannedExpense = inputs.plannedExpenses?.length ? euros(plannedExpensesForYear(inputs.plannedExpenses,
        inputs.plannedExpensesReferenceYear + nextYearIndex, inflationFactor)) : 0;
    // Dynamic Flex und Go-Go benötigen die spätere Budgetentscheidung des Folgejahrs.
    return calculateTargetLiquidityBalanceLike(inputs, marketData, floor, flex,
        nextPension.pensionAnnual + (income?.total || 0)) + plannedExpense;
}

/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @returns {number} Ergebnis der Operation.
 */
export function survivorFloorPercent(value) {
    if (value == null) return 75;
    const percent = Number(value);
    if (value === '' || !Number.isFinite(percent) || percent < 40 || percent > 200) {
        throw new RangeError('Grundbedarf nach dem Tod einer Person muss zwischen 40 und 200 % liegen.');
    }
    return percent;
}

/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @param {string} [label]
 * @returns {number} Ergebnis der Operation.
 */
export function survivorFlexPercent(value, label = 'Wunsch-Flex') {
    if (value == null) return 50;
    const percent = Number(value);
    if (value === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new RangeError(`${label} nach dem Tod einer Person muss zwischen 0 und 100 % liegen.`);
    }
    return percent;
}

/** FR-55: getrennte Paarbezüge, Pflege zusätzlich; FR-23 mittelt das Todesjahr.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param household
 * @param deathThisYear
 * @returns Ergebnis der Operation.
 */
export function resolveSurvivorFlexFactors(inputs, household, deathThisYear) {
    if (!inputs.partner?.aktiv || household.p1Alive === household.p2Alive) return null;
    const { p1Alive, p2Alive, care } = household;
    const careFactor = /** @type {(context: Omit<Parameters<typeof computeHouseholdFlexFactor>[0], "p2Alive" | "careMetaP2"> & {p2Alive?: boolean; careMetaP2?: CareMeta}) => number} */ (computeHouseholdFlexFactor)({ hasPartner: false, p1Alive: true,
        careMetaP1: p1Alive ? care?.p1 : care?.p2 });
    const coupleFactor = deathThisYear ? computeHouseholdFlexFactor({ hasPartner: true,
        p1Alive: true, p2Alive: true, careMetaP1: care?.p1, careMetaP2: care?.p2 }) : 0;
    const annualFactor = percent => deathThisYear
        ? (coupleFactor + percent / 100 * careFactor) / 2 : percent / 100 * careFactor;
    return {
        flexFactor: annualFactor(survivorFlexPercent(inputs.survivorFlexPercent)),
        minimumFlexFactor: annualFactor(survivorFlexPercent(inputs.survivorMinimumFlexPercent, 'Mindest-Flex'))
    };
}

/** Gemeinsamer Grundbedarfsfaktor für Jahresrechnung und Pflegedeckel.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param household
 * @param deathThisYear
 * @returns {number} Ergebnis der Operation.
 */
export function resolveSurvivorFloorFactor(inputs, household, deathThisYear) {
    if (!inputs.partner?.aktiv || household.p1Alive === household.p2Alive) return 1;
    const percent = survivorFloorPercent(inputs.survivorFloorPercent) / 100;
    return deathThisYear ? (1 + percent) / 2 : percent;
}

/**
 * @param state Zustand des Simulationspfads.
 * @param inputs Wirksame Simulationseingaben.
 * @param household
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param yearIndex Nullbasierter Index des Simulationsjahrs.
 * @returns Ergebnis der Operation.
 */
export function prepareSurvivorYear(state, inputs, household, portfolio, yearIndex) {
    if (!inputs.partner?.aktiv || household.p1Alive === household.p2Alive) return null;
    const previous = state.survivor;
    const people = inputs.simulationPeople || [];
    const primaryId = people[0]?.profileId || portfolio.simulationSourceProfileId || 'simulation';
    const secondaryId = people[1]?.profileId || portfolio.personAccounts.find(p => p.profileId !== primaryId)?.profileId || `${primaryId}:partner`;
    const survivor = previous || {
        deathYearIndex: yearIndex,
        deceasedProfileId: household.p1Alive ? secondaryId : primaryId,
        survivorProfileId: household.p1Alive ? primaryId : secondaryId
    };
    const deathThisYear = yearIndex === survivor.deathYearIndex;
    if (deathThisYear) {
        portfolio.simulationSourceProfileId ||= primaryId;
        for (const key of ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches']) {
            if (portfolio[key]) portfolio[key] = portfolio[key].map(lot => lot.sourceProfileId
                ? lot : { ...lot, sourceProfileId: primaryId });
        }
    }
    // Alte aggregierte Läufe besitzen nur das Hauptkonto. Seine vorhandene
    // Liquidität bleibt dort; das zweite Konto erhält keinen erfundenen Bestand.
    if (deathThisYear && !portfolio.personAccounts.some(p => p.profileId === secondaryId)) {
        const partnerAllowance = Math.max(0, Number(inputs.partner.sparerPauschbetrag) || 0);
        portfolio.personAccounts.push({ profileId: secondaryId, name: secondaryId, tagesgeld: 0, geldmarktEtf: 0,
            sparerPauschbetrag: partnerAllowance, taxState: { lossCarry: 0 },
            kirchensteuerSatz: (inputs.partner.kirchensteuerPct || 0) / 100 });
    }
    if (!deathThisYear) portfolio.simulationSourceProfileId = survivor.survivorProfileId;
    // Der Verlustvortrag des Verstorbenen gehört weder ins Sterbejahrbuch noch zum Erben.
    if (deathThisYear) {
        const deceased = portfolio.personAccounts.find(p => p.profileId === survivor.deceasedProfileId);
        if (deceased?.taxState) deceased.taxState = { ...deceased.taxState, lossCarry: 0 };
    }
    const account = portfolio.personAccounts.find(p => p.profileId === survivor.survivorProfileId);
    const adjustedInputs = deathThisYear ? inputs : {
        ...inputs,
        startSPB: account?.sparerPauschbetrag ?? Math.max(0, (inputs.startSPB || 0) - (inputs.partner.sparerPauschbetrag || 0)),
        kirchensteuerSatz: account?.kirchensteuerSatz ?? inputs.kirchensteuerSatz,
        ...(inputs.plannedInflows?.length ? { plannedInflows: inputs.plannedInflows.map(entry =>
            entry.profileId === survivor.deceasedProfileId ? { ...entry, profileId: survivor.survivorProfileId } : entry) } : {})
    };
    return { survivor, deathThisYear, inputs: adjustedInputs,
        floorFactor: resolveSurvivorFloorFactor(inputs, household, deathThisYear) };
}

/**
 * @param result Ergebnis des Simulationslaufs.
 * @param transition
 * @param pension
 * @returns Ergebnis der Operation.
 */
export function finishSurvivorYear(result, transition, pension) {
    if (!transition) return result;
    const { survivor, deathThisYear } = transition;
    const portfolio = result.newState.portfolio;
    if (deathThisYear && !transition.inheritanceLog && survivor.survivorProfileId && survivor.deceasedProfileId !== survivor.survivorProfileId) {
        const account = portfolio.personAccounts.find(p => p.profileId === survivor.survivorProfileId);
        const deceased = portfolio.personAccounts.find(p => p.profileId === survivor.deceasedProfileId);
        if (account && deceased) {
            portfolio.personAccounts = portfolio.personAccounts.filter(p => p !== deceased)
                .map(p => p === account ? { ...p, tagesgeld: p.tagesgeld + deceased.tagesgeld } : p);
            const lotGroups = ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches'];
            const ids = new Set(lotGroups.flatMap(key => portfolio[key] || [])
                .filter(lot => lot.sourceProfileId === survivor.survivorProfileId).map(lot => lot.trancheId));
            for (const key of lotGroups) {
                const lots = portfolio[key] || [];
                portfolio[key] = lots.map(lot => {
                    if ((lot.sourceProfileId || portfolio.simulationSourceProfileId) !== survivor.deceasedProfileId) return lot;
                    let trancheId = lot.trancheId;
                    while (trancheId && ids.has(trancheId)) trancheId = `inherited:${encodeURIComponent(survivor.deceasedProfileId)}:${trancheId}`;
                    ids.add(trancheId);
                    return { ...lot, trancheId, sourceProfileId: survivor.survivorProfileId };
                });
            }
            portfolio.healthBucketCashOwners = (portfolio.healthBucketCashOwners || []).map(row =>
                row.profileId === survivor.deceasedProfileId ? { ...row, profileId: survivor.survivorProfileId } : row);
            portfolio.simulationSourceProfileId = survivor.survivorProfileId;
            if (account.taxState) result.newState.lastState = { ...result.newState.lastState,
                taxState: { ...account.taxState } };
            syncPersonalLiquidity(portfolio);
        }
    }
    result.newState.survivor = { ...survivor };
    // Protokoll erst nach der endgültigen Kontenübertragung abbilden.
    if (deathThisYear) {
        result.logData.liqEnd = portfolio.liquiditaet;
        result.logData.personAccounts = portfolio.personAccounts?.map(person => ({ ...person }));
    }
    Object.assign(result.logData, {
        SurvivorDeathYear: deathThisYear,
        WidowIncomeOffsetP1: pension.widowIncomeOffsetP1,
        WidowIncomeOffsetP2: pension.widowIncomeOffsetP2,
        WidowIncomeOffset: pension.widowIncomeOffsetP1 + pension.widowIncomeOffsetP2,
        BereavementQuarterP1: pension.bereavementQuarterP1,
        BereavementQuarterP2: pension.bereavementQuarterP2,
        SurvivorPensionValue: pension.pensionValue
    });
    return result;
}
