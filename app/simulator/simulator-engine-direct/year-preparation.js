// @ts-check
/** @import {SimulatorInputs,SimulationState,HistoricalYear,CareMeta,HouseholdContext,ReplayCollector,YearOutcome} from '../../../typcheck/rechenkern' */
import { isUnmarriedSimulation, unmarriedYearShares } from '../simulator-unmarried.js';
import { sellHomesForExternalCare, sellHomesForEmergency, homeRentForYear, endResidenceRights } from '../simulator-home-sale.js';
import { applyPlannedInflows } from '../planned-inflows.js';
import { calculateFixedIncomeForYear } from '../simulator-fixed-income.js';
import { fixedCareTodayForYear } from '../simulator-care-today.js';
import { ensurePersonalAccounts } from '../simulator-personal-accounts.js';
import { prepareGuardrailPlanInputs } from '../../shared/guardrail-history.js';
import { normalizeHouseholdContext } from '../simulator-engine-direct-utils.js';
import { calculateHouseholdPensionForYear } from '../simulator-household-pension.js';
import { prepareSurvivorYear, resolveSurvivorFlexFactors } from '../simulator-survivor.js';
import { applyHealthBucketInterest } from '../simulator-health-bucket.js';
import { calcCareCost, computeHouseholdFlexFactor, endCareForDeceased, resolveSimulatorCumulativeInflationFactor } from '../simulator-engine-helpers.js';
import { SIMULATOR_TECHNICAL_ERROR_CODES, buildTechnicalErrorOutcome, validateRequiredYearReturns } from './outcomes.js';
import { captureEngineBoundaryPortfolio } from './engine-boundary.js';
/** @typedef {{currentState:SimulationState;inputs:SimulatorInputs;yearData:HistoricalYear;yearIndex:number;
 * pflegeMeta:CareMeta|null;careFloorAddition:number;householdContext:Partial<HouseholdContext>|null;temporaryFlexFactor:number;
 * engineAPI:Partial<typeof import("../../../engine/index.mjs").EngineAPI>|null;replayCollector:ReplayCollector|null;beforeRuin:number|boolean;
 * preparedGuardrailPlan:ReturnType<typeof prepareGuardrailPlanInputs>|null;preserveLogOrder:boolean}} YearParameters */
/** @typedef {YearParameters & NonNullable<ReturnType<typeof prepareYear>['state']>} YearContext */
/** @param {YearParameters} context */
export function prepareYear(context) {
    let {
        engineAPI, householdContext, yearData, replayCollector, currentState, yearIndex, inputs, pflegeMeta,
        careFloorAddition, temporaryFlexFactor, beforeRuin
    } = context;
    // EngineAPI muss übergeben werden oder global verfügbar sein
    const engine = engineAPI || (typeof window !== 'undefined' ? window.EngineAPI : null);

    if (!engine) {
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_API_UNAVAILABLE,
            `Die Simulations-Engine ist nicht verfügbar (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_API_UNAVAILABLE}).`
        )) };
    }

    if (typeof engine.simulateSingleYear !== 'function') {
        return { outcome: /** @type {YearOutcome} */ (buildTechnicalErrorOutcome(
            SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_METHOD_UNAVAILABLE,
            `Die Simulations-Engine besitzt keinen gültigen Jahreseinstieg (${SIMULATOR_TECHNICAL_ERROR_CODES.ENGINE_METHOD_UNAVAILABLE}).`
        )) };
    }

    const hasLifeEvents = householdContext !== null;
    const invalidYearReturns = validateRequiredYearReturns(yearData);
    if (invalidYearReturns) return { outcome: /** @type {YearOutcome} */ (invalidYearReturns) };

    // Ohne Collector weder Zustandskopien noch zusätzliche Logobjekte erzeugen.
    const replayYear = replayCollector ? replayCollector.beginYear(currentState, yearIndex, yearData) : null;

    let {
        portfolio,
        baseFloor,
        baseFlex,
        baseMinimumFlexAnnual = 0,
        baseFlexBudgetAnnual = 0,
        baseFlexBudgetRecharge = 0,
        lastState,
        currentAnnualPension,
        currentAnnualPension2,
        marketDataHist,
        widowPensionP1 = 0,
        widowPensionP2 = 0
    } = currentState;
    // Account balances and their scalar totals belong to this year. Retained year states
    // must not observe later payouts through shared account objects.
    portfolio = { ...portfolio, ...(Array.isArray(portfolio.personAccounts)
        ? { personAccounts: portfolio.personAccounts.map(person => ({ ...person })) } : {}),
        ...(Array.isArray(portfolio.healthBucketCashOwners)
            ? { healthBucketCashOwners: portfolio.healthBucketCashOwners.map(person => ({ ...person })) } : {}) };
    const engineBoundaryPortfolio = captureEngineBoundaryPortfolio(portfolio);
    const cumulativeInflationFactor = resolveSimulatorCumulativeInflationFactor(currentState);
    let healthBucketCoverage = /** @type {ReturnType<import('../../../typcheck/rechenkern-integration').ApplyHealthBucketCoverage>|null} */ (null), healthBucketInterest = /** @type {Pick<ReturnType<typeof applyHealthBucketInterest>,'startAmount'|'interest'>|null} */ (null);
    if (householdContext === null && pflegeMeta === null) {
        const fixedCare = fixedCareTodayForYear(inputs, currentState, yearIndex);
        if (fixedCare) ({ pflegeMeta, careFloorAddition, householdContext, temporaryFlexFactor } = fixedCare);
    }

    const sampledYear = Number(yearData?.jahr);
    const deterministicYear = Number.isInteger(sampledYear) && sampledYear >= 1 && sampledYear <= 9999
        ? sampledYear
        : Math.min(9999, Math.max(1, 2000 + (Number(yearIndex) || 0)));
    portfolio.simulationDate = `${String(deterministicYear).padStart(4, '0')}-12-31`;
    if (inputs.simulationSourceProfileId) {
        portfolio.simulationSourceProfileId = String(inputs.simulationSourceProfileId);
    }

    currentAnnualPension2 = currentAnnualPension2 || 0;
    widowPensionP1 = Math.max(0, widowPensionP1 || 0);
    widowPensionP2 = Math.max(0, widowPensionP2 || 0);
    const householdCtx = normalizeHouseholdContext(householdContext, pflegeMeta);
    const { p1Alive, p2Alive, widowBenefits } = householdCtx;
    ensurePersonalAccounts(portfolio, inputs);
    const unmarried = isUnmarriedSimulation(inputs);
    if (unmarried) {
        householdCtx.widowBenefits = { ...widowBenefits, p1FromP2: false, p2FromP1: false };
        inputs = { ...inputs, jointAssessment: false };
    }
    const homeHousehold = householdCtx;
    endResidenceRights(portfolio, inputs, currentState.survivor, homeHousehold);
    const homeSaleOptions = { portfolio, state: currentState, inputs, household: homeHousehold,
        yearIndex, inflationFactor: cumulativeInflationFactor };
    let homeSaleLog = !beforeRuin && hasLifeEvents ? sellHomesForExternalCare(homeSaleOptions) : null;
    const startAssets = unmarried ? structuredClone(portfolio) : null;
    const survivorYear = /** @type {import('../../../typcheck/rechenkern-integration').PrepareSurvivorYear} */ (prepareSurvivorYear)(currentState, inputs, householdCtx, portfolio, yearIndex);
    if (survivorYear) inputs = survivorYear.inputs;
    // Auch gespeicherte Replay-Ereignisse können noch aktive Pflege Verstorbener enthalten.
    const careP1 = householdCtx.care?.p1;
    const careP2 = householdCtx.care?.p2;
    // Die Reserve prüft im Sterbejahr den Zustand vor dem Tod. Ihr Bedarf
    // bleibt auf die tatsächlich angesetzten halben Jahreskosten begrenzt.
    const healthBucketHousehold = survivorYear?.deathThisYear
        ? { ...householdCtx, p1Alive: true, p2Alive: true, care: { p1: careP1, p2: careP2 } }
        : householdCtx;
    const deceasedCareFloor = (!p1Alive ? calcCareCost(careP1).zusatzFloor : 0)
        + (!p2Alive ? calcCareCost(careP2).zusatzFloor : 0);
    if ((!p1Alive && careP1?.active) || (!p2Alive && careP2?.active)) {
        const care = { p1: careP1 ? { ...careP1 } : null, p2: careP2 ? { ...careP2 } : null };
        endCareForDeceased(care.p1, p1Alive);
        endCareForDeceased(care.p2, p2Alive);
        householdCtx.care = care;
        pflegeMeta = care.p1;
        // FR-17/23: im Sterbejahr bleibt die halbe Pflege der verstorbenen Person.
        careFloorAddition = Math.max(0, careFloorAddition - deceasedCareFloor * (survivorYear?.deathThisYear ? .5 : 1));
        temporaryFlexFactor = computeHouseholdFlexFactor({ hasPartner: inputs.partner?.aktiv === true,
            p1Alive, p2Alive, careMetaP1: care.p1, careMetaP2: care.p2 });
    }
    const survivorFlex = survivorYear ? resolveSurvivorFlexFactors(inputs,
        { p1Alive, p2Alive, care: { p1: careP1, p2: careP2 } }, survivorYear.deathThisYear) : null;
    if (survivorFlex) temporaryFlexFactor = survivorFlex.flexFactor;
    const temporaryMinimumFlexFactor = survivorFlex?.minimumFlexFactor ?? temporaryFlexFactor;
    if (survivorYear?.deathThisYear && !p1Alive) lastState = { ...lastState, taxState: { lossCarry: 0 } };
    let homeRent = homeRentForYear(portfolio, inputs, homeHousehold, cumulativeInflationFactor, currentState, yearIndex);
    const floorWithoutRent = baseFloor * (survivorYear?.floorFactor ?? 1) + careFloorAddition;
    if (!homeSaleLog && inputs.home?.length) {
        const requiredFloorForPortfolio = () => {
            const currentRent = homeRentForYear(portfolio, inputs, homeHousehold, cumulativeInflationFactor, currentState, yearIndex);
            const thresholdPension = calculateHouseholdPensionForYear({ inputs, yearIndex, currentAnnualPension,
                currentAnnualPension2, widowPensionP1, widowPensionP2, p1Alive, p2Alive,
                widowBenefits: householdCtx.widowBenefits, deathThisYear: survivorYear?.deathThisYear === true,
                effectiveBaseFloor: floorWithoutRent + currentRent, baseFlex, temporaryFlexFactor });
            const thresholdIncome = calculateFixedIncomeForYear({ inputs, state: { ...currentState, portfolio }, yearIndex,
                inflationFactor: cumulativeInflationFactor, household: householdCtx, care: { p1: careP1, p2: careP2 },
                deathThisYear: survivorYear?.deathThisYear === true });
            return Math.max(0, floorWithoutRent + currentRent - thresholdPension.pensionAnnual - (thresholdIncome?.total || 0));
        };
        homeSaleLog = sellHomesForEmergency({ ...homeSaleOptions, beforeRuin: Boolean(beforeRuin), maxSales: beforeRuin || Infinity,
            requiredFloor: requiredFloorForPortfolio(), requiredFloorForPortfolio });
        homeRent = homeRentForYear(portfolio, inputs, homeHousehold, cumulativeInflationFactor, currentState, yearIndex);
    }
    const effectiveBaseFloor = floorWithoutRent + homeRent;
    const unmarriedShares = unmarried ? unmarriedYearShares(homeSaleLog?.immobilien_notverkauf ? portfolio : startAssets,
        inputs, { p1: careP1, p2: careP2 }, survivorYear?.deathThisYear, householdCtx, careFloorAddition) : null;
    const plannedInflowLog = applyPlannedInflows(portfolio, inputs, yearIndex, cumulativeInflationFactor);
    const rentLog = portfolio.homeRent ? { wohnmiete: homeRent, wohnmiete_startjahr: portfolio.homeRent.startYear,
        wohnmiete_aktiv: portfolio.homeRent.active } : null;
    let inflowLog = /** @type {Record<string,unknown>|null} */ (homeSaleLog || rentLog ? { ...plannedInflowLog, ...homeSaleLog, ...rentLog } : plannedInflowLog);
    return { state: {
        engine: /** @type {typeof engine & {simulateSingleYear:NonNullable<typeof engine.simulateSingleYear>}} */ (engine),
        hasLifeEvents, householdContext, yearData, replayYear, replayCollector, currentState, yearIndex,
        portfolio, baseFloor, baseFlex, baseMinimumFlexAnnual, baseFlexBudgetAnnual, baseFlexBudgetRecharge,
        lastState, currentAnnualPension, currentAnnualPension2, marketDataHist, widowPensionP1, widowPensionP2,
        engineBoundaryPortfolio, cumulativeInflationFactor, healthBucketCoverage, healthBucketInterest, inputs,
        pflegeMeta, careFloorAddition, temporaryFlexFactor, householdCtx, p1Alive, p2Alive, widowBenefits,
        unmarried, homeHousehold, homeSaleLog, survivorYear, careP1, careP2, healthBucketHousehold,
        temporaryMinimumFlexFactor, effectiveBaseFloor, unmarriedShares, inflowLog
    } };
}
