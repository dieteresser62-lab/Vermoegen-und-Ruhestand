import { projectCareLiquidityYear } from './simulator-care-projection.js';
/** @import {CareMeta} from '../../typcheck/rechenkern.js' */
/** Simulator-only household transition. The couple's inflation base stays intact. */
import { syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { resolveSimulatorCumulativeInflationFactor } from './simulator-engine-helpers.js';
import { calculateTargetLiquidityBalanceLike } from './simulator-engine-direct-utils.js';
import { simulatorPlannedExpenseYear } from '../profile/household-planned-expenses.js';
import { replacesHomeFloor } from './simulator-residential-care.js';
import { resolveHomeFloorFactor, resolveSurvivorFloorFactor } from '../shared/care-needs.js';
export { survivorFloorPercent, survivorFlexPercent, resolveSurvivorFlexFactors, resolveSurvivorFloorFactor,
    resolveHomeFloorFactor, composeYearNeed } from '../shared/care-needs.js';

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
    const projected = projectCareLiquidityYear({ inputs, state, portfolio, household, yearIndex,
        inflationFactor, pension, fixedIncomeWageFactor });
    const nextYearIndex = yearIndex + 1;
    // FR-43: Feste geplante Ausgaben stecken in projected.floor; nur einmalige kommen als Reserve dazu.
    const plannedExpense = simulatorPlannedExpenseYear(inputs, nextYearIndex, inflationFactor).once;
    // Dynamic Flex und Go-Go benötigen die spätere Budgetentscheidung des Folgejahrs.
    return calculateTargetLiquidityBalanceLike(inputs, marketData, projected.floor, projected.flex, projected.income) + plannedExpense;
}

/** Todesjahr des ersten Partners nach FR-23: getrennter Lebensstatus, noch kein oder genau dieser Übergang.
 *
 * @param {boolean} hasPartner Haushalt mit zwei Personen.
 * @param {{p1Alive?: boolean; p2Alive?: boolean}} household Lebensstatus des Jahres.
 * @param {{survivor?: {deathYearIndex?: number}|null}} state Zustand zu Jahresbeginn.
 * @param {number} yearIndex Nullbasierter Index des Simulationsjahrs.
 * @returns {boolean} Ergebnis der Prüfung.
 */
export function isFirstDeathYear(hasPartner, household, state, yearIndex) {
    return hasPartner && household.p1Alive !== household.p2Alive && (!state?.survivor || state.survivor.deathYearIndex === yearIndex);
}

/** FR-72 Punkt 18: Grundbedarf, den Personen im Heim gegenüber dem Haushalt ohne Heim einsparen
 * (Hinterbliebenenregel und Todesjahrmischung wie bisher). Die Ersparnis wird nach dem Gewicht ihrer
 * Heimposten verteilt: Lebende 1, Verstorbene im Todesjahr ½. Die Kennzahl „Pflege-Mehrbedarf“ zieht
 * sie von den Pflegeausgaben ab; Bestand (heute im Heim) spart nichts.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param {number} baseFloor Ursprünglicher Grundbedarf des Jahres (inflationiert).
 * @param {{p1Alive?: boolean; p2Alive?: boolean; care?: {p1?: CareMeta|null; p2?: CareMeta|null}}} household Haushalt mit dem Pflegezustand des Jahres, Verstorbene im Todesjahr vor dem Tod.
 * @param {boolean} deathThisYear Todesjahr nach FR-23.
 * @returns {[number, number]} Eingesparter Grundbedarf von P1 und P2.
 */
export function savedHomeFloorShares(inputs, baseFloor, household, deathThisYear) {
    const weights = /** @type {const} */ (['p1', 'p2']).map(key => !replacesHomeFloor(household.care?.[key]) ? 0
        : household[key === 'p1' ? 'p1Alive' : 'p2Alive'] !== false ? 1 : deathThisYear ? .5 : 0);
    const sum = weights[0] + weights[1];
    if (!(sum > 0)) return [0, 0];
    const saved = (Number(baseFloor) || 0) * Math.max(0, resolveSurvivorFloorFactor(inputs, household, deathThisYear)
        - resolveHomeFloorFactor(inputs, household, deathThisYear));
    return [saved * weights[0] / sum, saved * weights[1] / sum];
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
