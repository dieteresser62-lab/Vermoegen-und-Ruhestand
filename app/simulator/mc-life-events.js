/** @import {SimulatorInputs,SimulationState,SimulationPortfolio,SimulationLog,HistoricalYear,Random,CareMeta,HouseholdContext,LifeLogContext,MonteCarloLifeState,WidowOptions,DeathLogContext,TailRiskOverlay,ReplayAnnualRecord,ReplayHouseholdEvent,YearOutcome,YearSuccess,YearRuin,TechnicalInventory,NumericBuffers,SamplingDiagnostics} from '../../typcheck/rechenkern' */
import {
    calcCareCost,
    computeCareMortalityMultiplier,
    computeHouseholdFlexFactor,
    endCareForDeceased,
    makeDefaultCareMeta,
    priceCareMeta,
    updateCareMeta
} from './simulator-engine-wrapper.js';
import { resolveSurvivorFloorFactor, resolveSurvivorFlexFactors } from './simulator-survivor.js';
import { MORTALITY_TABLE } from './simulator-data.js';
import { applyPartnerCareFallback } from '../shared/care-benefits.js';
import {
    computeMarriageYearsCompleted,
    normalizeWidowOptions
} from './simulator-sweep-utils.js';

export const MAX_SIMULATOR_COUNTER_VALUE = 0xFFFFFFFF;

/** @param {string} gender
 * @param {number} age */
export function resolveSimulatorMortalityProbability(gender, age) {
    const normalizedAge = Number(age);
    const table = MORTALITY_TABLE[gender];
    if (!table || !Number.isSafeInteger(normalizedAge) || normalizedAge < 0) return 1;
    const probability = Number(table[normalizedAge]);
    if (!Number.isFinite(probability)) return 1;
    return Math.min(1, Math.max(0, probability));
}

/** @param {SimulatorInputs} inputs
 * @param {number} maxDauer */
export function assertSimulatorHorizonAgeContract(inputs, maxDauer) {
    const duration = Number(maxDauer);
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAX_SIMULATOR_COUNTER_VALUE) {
        throw new RangeError(`Simulationsdauer muss eine ganze Zahl zwischen 1 und ${MAX_SIMULATOR_COUNTER_VALUE} sein.`);
    }

    const persons = [
        ['P1', inputs?.startAlter],
        ...(inputs?.partner?.aktiv === true ? [['P2', inputs.partner.startAlter]] : [])
    ];
    for (const [label, rawAge] of persons) {
        const startAge = Number(rawAge);
        if (!Number.isSafeInteger(startAge) || startAge < 0 || startAge > MAX_SIMULATOR_COUNTER_VALUE) {
            throw new RangeError(`${label}-Startalter muss eine nichtnegative ganze Zahl sein.`);
        }
        if (startAge + duration - 1 > MAX_SIMULATOR_COUNTER_VALUE) {
            throw new RangeError(`${label}-Alter am Horizont ueberschreitet den Simulator-Zaehlerbereich.`);
        }
    }
    return { duration, maxAge: MAX_SIMULATOR_COUNTER_VALUE };
}

/** @param {SimulatorInputs} inputs
 * @param {Random} rand
 * @param {unknown} widowOptions
 * @returns {MonteCarloLifeState} */
export function createMonteCarloLifeState(inputs, rand, widowOptions = null) {
    const careMetaP1 = /** @type {import('../../typcheck/rechenkern-integration').MakeDefaultCareMeta} */ (makeDefaultCareMeta)(inputs.pflegefallLogikAktivieren, inputs.geschlecht, inputs.careToday, inputs.startAlter, inputs);
    const partnerGenderFallback = inputs.geschlecht === 'm' ? 'w' : 'm';
    const hasPartner = inputs.partner?.aktiv === true;
    const careMetaP2 = hasPartner
        ? /** @type {import('../../typcheck/rechenkern-integration').MakeDefaultCareMeta} */ (makeDefaultCareMeta)(inputs.pflegefallLogikAktivieren, inputs.partner?.geschlecht || partnerGenderFallback, inputs.partner?.careToday, inputs.partner?.startAlter, inputs)
        : null;
    const normalizedWidowOptions = /** @type {import('../../typcheck/rechenkern-integration').NormalizeWidowOptions} */ (normalizeWidowOptions)(widowOptions ?? inputs?.widowOptions);
    const widowPercent = normalizedWidowOptions.mode === 'percent' && inputs.partnership?.status !== 'unmarried'
        ? normalizedWidowOptions.percent
        : 0;

    return {
        careMetaP1,
        careMetaP2,
        hasPartner,
        rngCareP1: rand.fork('CARE_P1'),
        rngCareP2: careMetaP2 ? rand.fork('CARE_P2') : null,
        singleNoCareFastPath: inputs.pflegefallLogikAktivieren !== true && !careMetaP1 && !hasPartner,
        p1Alive: true,
        p2Alive: hasPartner,
        p1CareYears: 0,
        p2CareYears: 0,
        bothCareYears: 0,
        triggeredAgeP2: null,
        runEndedBecauseAllDied: false,
        deathLogContext: null,
        p1ActiveThisYear: false,
        p2ActiveThisYear: false,
        widowBenefitActiveForP1: false,
        widowBenefitActiveForP2: false,
        householdContext: {
            p1Alive: true,
            p2Alive: hasPartner,
            widowBenefits: {
                p1FromP2: false,
                p2FromP1: false,
                p1FromP2Percent: widowPercent,
                p2FromP1Percent: widowPercent
            }
        },
        year: {
            ageP1: 0,
            ageP2: 0,
            effectiveTransitionYear: 0,
            triggeredAge: null,
            careEverActive: false,
            isAccumulation: false,
            totalCareFloor: 0,
            effectiveFlexFactor: 1,
            householdContext: null
        }
    };
}



/** @template T
 * @param {T} value
 * @returns {T|null} */
function cloneCareMeta(value) {
    return value == null ? null : JSON.parse(JSON.stringify(value));
}

/**
 * Rehydrates the exogenous household state after source ruin. Random streams
 * are derived from the separately seeded shadow generator, not forked from the
 * already consumed source-run generator.
 */
/** @param {SimulatorInputs} inputs
 * @param {Random} shadowRand
 * @param {{widowOptions?:unknown;p1Alive?:boolean;p2Alive?:boolean;careMetaP1?:CareMeta|null;careMetaP2?:CareMeta|null;p1CareYears?:number;p2CareYears?:number;bothCareYears?:number;triggeredAgeP2?:number|null;widowBenefitActiveForP1?:boolean;widowBenefitActiveForP2?:boolean}} options */
export function createMonteCarloPostRuinLifeState(inputs, shadowRand, {
    widowOptions = null,
    p1Alive = true,
    p2Alive = inputs?.partner?.aktiv === true,
    careMetaP1 = null,
    careMetaP2 = null,
    p1CareYears = 0,
    p2CareYears = 0,
    bothCareYears = 0,
    triggeredAgeP2 = null,
    widowBenefitActiveForP1 = false,
    widowBenefitActiveForP2 = false
} = {}) {
    const state = createMonteCarloLifeState(inputs, shadowRand, widowOptions);
    state.careMetaP1 = cloneCareMeta(careMetaP1) ?? state.careMetaP1;
    state.careMetaP2 = cloneCareMeta(careMetaP2) ?? state.careMetaP2;
    state.p1Alive = p1Alive === true;
    state.p2Alive = state.hasPartner && p2Alive === true;
    state.p1CareYears = Number(p1CareYears) || 0;
    state.p2CareYears = Number(p2CareYears) || 0;
    state.bothCareYears = Number(bothCareYears) || 0;
    state.triggeredAgeP2 = Number.isFinite(triggeredAgeP2) ? triggeredAgeP2 : null;
    state.widowBenefitActiveForP1 = widowBenefitActiveForP1 === true;
    state.widowBenefitActiveForP2 = widowBenefitActiveForP2 === true;
    state.householdContext.p1Alive = state.p1Alive;
    state.householdContext.p2Alive = state.p2Alive;
    return state;
}

/** Preisabschluss ohne weitere Zufallsziehungen; auch für den Schattenpfad nach Ruin. */
/** @param {SimulatorInputs} inputs
 * @param {CareMeta|null} careP1
 * @param {CareMeta|null} careP2
 * @param {Partial<SimulationState>|null} currentState
 * @param {number} yearIndex
 * @param {boolean} p1Alive
 * @param {boolean} p2Alive
 * @param {boolean} previouslyJointAlive */
export function priceMonteCarloCareForYear(inputs, careP1, careP2, currentState, yearIndex,
    p1Alive, p2Alive, previouslyJointAlive) {
    const household = { p1Alive, p2Alive, care: { p1: careP1, p2: careP2 } };
    applyPartnerCareFallback(inputs, household);
    const floorFactor = resolveSurvivorFloorFactor(inputs, household, previouslyJointAlive);
    /** @type {import('../../typcheck/rechenkern-integration').PriceCareMeta} */ (priceCareMeta)(careP1, inputs, currentState, yearIndex, floorFactor);
    /** @type {import('../../typcheck/rechenkern-integration').PriceCareMeta} */ (priceCareMeta)(careP2, inputs, currentState, yearIndex, floorFactor);
}

/** @param {MonteCarloLifeState} lifeState
 * @param {SimulatorInputs} inputs
 * @param {unknown} widowOptions
 * @param {number} simulationsJahr
 * @param {HistoricalYear} yearData
 * @param {number} effectiveTransitionYear
 * @param {number|null} triggeredAge
 * @param {boolean} careEverActive
 * @param {Random} rand
 * @param {Partial<SimulationState>} currentState
 * @returns {import('../../typcheck/rechenkern').LifeYear & {householdContext:HouseholdContext & {care:{p1:CareMeta|null;p2:CareMeta|null}}}} */
export function updateMonteCarloLifeEventsForYear(
    lifeState,
    inputs,
    widowOptions,
    simulationsJahr,
    yearData,
    effectiveTransitionYear,
    triggeredAge,
    careEverActive,
    rand,
    currentState = {}
) {
    const normalizedWidowOptions = /** @type {import('../../typcheck/rechenkern-integration').NormalizeWidowOptions} */ (normalizeWidowOptions)(widowOptions ?? inputs?.widowOptions);
    const ageP1 = inputs.startAlter + simulationsJahr;
    let isAccumulation = inputs.accumulationPhase?.enabled && simulationsJahr < effectiveTransitionYear;

    if (lifeState.singleNoCareFastPath) {
        if (!isAccumulation && lifeState.p1Alive) {
            const qx1 = resolveSimulatorMortalityProbability(inputs.geschlecht, ageP1);
            if (rand() < qx1) {
                lifeState.p1Alive = false;
            }
        }

        if (!lifeState.p1Alive) {
            lifeState.runEndedBecauseAllDied = true;
            lifeState.deathLogContext = {
                jahr: simulationsJahr + 1,
                histJahr: yearData.jahr,
                inflation: yearData.inflation
            };
        }

        const householdContext = lifeState.householdContext;
        householdContext.p1Alive = lifeState.p1Alive;
        householdContext.p2Alive = false;
        householdContext.widowBenefits.p1FromP2 = false;
        householdContext.widowBenefits.p2FromP1 = false;
        householdContext.widowBenefits.p1FromP2Percent = 0;
        householdContext.widowBenefits.p2FromP1Percent = 0;
        householdContext.care = {
            p1: lifeState.careMetaP1,
            p2: null
        };

        const year = lifeState.year;
        year.ageP1 = ageP1;
        year.ageP2 = ageP1;
        year.effectiveTransitionYear = effectiveTransitionYear;
        year.triggeredAge = triggeredAge;
        year.careEverActive = careEverActive;
        year.isAccumulation = isAccumulation;
        year.totalCareFloor = 0;
        year.effectiveFlexFactor = lifeState.p1Alive ? 1 : 0;
        year.householdContext = householdContext;
        return /** @type {import('../../typcheck/rechenkern').LifeYear & {householdContext:HouseholdContext & {care:{p1:CareMeta|null;p2:CareMeta|null}}}} */ (year);
    }

    const marriageYearsCompleted = computeMarriageYearsCompleted(simulationsJahr, normalizedWidowOptions);
    const widowModeEnabled = normalizedWidowOptions.mode === 'percent'
        && inputs.partnership?.status !== 'unmarried'
        && normalizedWidowOptions.percent > 0
        && lifeState.hasPartner;
    const widowEligibleThisYear = widowModeEnabled &&
        marriageYearsCompleted > 0 &&
        marriageYearsCompleted >= normalizedWidowOptions.minMarriageYears;
    const previouslyJointAlive = lifeState.p1Alive && lifeState.p2Alive;
    const careMetaP1 = lifeState.careMetaP1;
    const careMetaP2 = lifeState.careMetaP2;
    let ageP2 = ageP1;

    if (inputs.partner?.aktiv) {
        ageP2 = inputs.partner.startAlter + simulationsJahr;
    }

    if (lifeState.p1Alive) {
        updateCareMeta(careMetaP1, inputs, ageP1, yearData, lifeState.rngCareP1, currentState, simulationsJahr, true);
        if (careMetaP1 && careMetaP1.active) careEverActive = true;
        if (careMetaP1 && careMetaP1.triggered && triggeredAge === null) triggeredAge = ageP1;
    }

    if (lifeState.p2Alive && careMetaP2) {
        updateCareMeta(careMetaP2, inputs, ageP2, yearData, lifeState.rngCareP2, currentState, simulationsJahr, true);
        if (careMetaP2 && careMetaP2.triggered && lifeState.triggeredAgeP2 === null) {
            lifeState.triggeredAgeP2 = ageP2;
        }
        if (careMetaP2 && careMetaP2.active) careEverActive = true;
    }

    if (inputs.accumulationPhase?.enabled && simulationsJahr < effectiveTransitionYear) {
        if ((lifeState.p1Alive && careMetaP1?.active) || (lifeState.p2Alive && careMetaP2?.active)) {
            effectiveTransitionYear = simulationsJahr;
            isAccumulation = false;
        }
    }

    lifeState.p1ActiveThisYear = lifeState.p1Alive && careMetaP1?.active;
    lifeState.p2ActiveThisYear = lifeState.p2Alive && careMetaP2?.active;
    if (lifeState.p2ActiveThisYear) careEverActive = true;

    if (!isAccumulation && lifeState.p1Alive) {
        let qx1 = resolveSimulatorMortalityProbability(inputs.geschlecht, ageP1);
        const careFactorP1 = /** @type {import('../../typcheck/rechenkern-integration').ComputeCareMortalityMultiplier} */ (computeCareMortalityMultiplier)(careMetaP1, inputs);
        if (careFactorP1 > 1) {
            qx1 = Math.min(1.0, qx1 * careFactorP1);
        }
        if (rand() < qx1) {
            lifeState.p1Alive = false;
        }
    }

    if (!isAccumulation && lifeState.p2Alive) {
        const p2Gender = inputs.partner?.geschlecht || (inputs.geschlecht === 'm' ? 'w' : 'm');
        let qx2 = resolveSimulatorMortalityProbability(p2Gender, ageP2);
        const careFactorP2 = /** @type {import('../../typcheck/rechenkern-integration').ComputeCareMortalityMultiplier} */ (computeCareMortalityMultiplier)(careMetaP2, inputs);
        if (careFactorP2 > 1) {
            qx2 = Math.min(1.0, qx2 * careFactorP2);
        }
        if (rand() < qx2) {
            lifeState.p2Alive = false;
        }
    }

    priceMonteCarloCareForYear(inputs, careMetaP1, careMetaP2, currentState, simulationsJahr,
        lifeState.p1Alive, lifeState.p2Alive, previouslyJointAlive);

    // Diagnosejahre zählen im Sterbejahr jeweils ein halbes Jahr.
    if (lifeState.p1ActiveThisYear) lifeState.p1CareYears += lifeState.p1Alive ? 1 : .5;
    if (lifeState.p2ActiveThisYear) lifeState.p2CareYears += lifeState.p2Alive ? 1 : .5;
    if (lifeState.p1ActiveThisYear && lifeState.p2ActiveThisYear) lifeState.bothCareYears += lifeState.p1Alive && lifeState.p2Alive ? 1 : .5;

    if (widowEligibleThisYear && (!lifeState.p1Alive || !lifeState.p2Alive)) {
        if (!lifeState.p1Alive && lifeState.p2Alive) {
            lifeState.widowBenefitActiveForP2 = true;
        } else if (!lifeState.p2Alive && lifeState.p1Alive) {
            lifeState.widowBenefitActiveForP1 = true;
        }
    }

    if (!lifeState.p1Alive && !lifeState.p2Alive) {
        lifeState.runEndedBecauseAllDied = true;
        lifeState.deathLogContext = {
            jahr: simulationsJahr + 1,
            histJahr: yearData.jahr,
            inflation: yearData.inflation
        };
    }

    // Die Jahresrechnung und Replay behalten die Pflege vor dem Tod.
    // Der fortlaufende Lebenszustand wird dagegen sofort bereinigt.
    const yearCareP1 = !lifeState.p1Alive && careMetaP1?.active ? { ...careMetaP1 } : careMetaP1;
    const yearCareP2 = !lifeState.p2Alive && careMetaP2?.active ? { ...careMetaP2 } : careMetaP2;
    endCareForDeceased(careMetaP1, lifeState.p1Alive);
    endCareForDeceased(careMetaP2, lifeState.p2Alive);
    lifeState.p1ActiveThisYear = lifeState.p1Alive && careMetaP1?.active;
    lifeState.p2ActiveThisYear = lifeState.p2Alive && careMetaP2?.active;
    const careCostP1 = calcCareCost(yearCareP1, null);
    const careCostP2 = yearCareP2 ? calcCareCost(yearCareP2, null) : null;
    const totalCareFloor = careCostP1.zusatzFloor + (careCostP2 ? careCostP2.zusatzFloor : 0);
    // Ereignisfaktor nach dem Tod; die Halbjahresmischung übernimmt simulateOneYear.
    const effectiveFlexFactor = resolveSurvivorFlexFactors(inputs, {
        p1Alive: lifeState.p1Alive, p2Alive: lifeState.p2Alive,
        care: { p1: yearCareP1, p2: yearCareP2 }
    }, false)?.flexFactor ?? computeHouseholdFlexFactor({
        hasPartner: lifeState.hasPartner,
        p1Alive: lifeState.p1Alive,
        careMetaP1,
        p2Alive: lifeState.p2Alive,
        careMetaP2
    });
    const householdContext = lifeState.householdContext;
    householdContext.p1Alive = lifeState.p1Alive;
    householdContext.p2Alive = lifeState.hasPartner ? lifeState.p2Alive : false;
    householdContext.widowBenefits.p1FromP2 = lifeState.widowBenefitActiveForP1;
    householdContext.widowBenefits.p2FromP1 = lifeState.widowBenefitActiveForP2;
    householdContext.widowBenefits.p1FromP2Percent = widowModeEnabled
        ? normalizedWidowOptions.percent
        : 0;
    householdContext.widowBenefits.p2FromP1Percent = widowModeEnabled
        ? normalizedWidowOptions.percent
        : 0;
    householdContext.care = {
        p1: yearCareP1,
        p2: yearCareP2
    };

    const year = lifeState.year;
    year.ageP1 = ageP1;
    year.ageP2 = ageP2;
    year.effectiveTransitionYear = effectiveTransitionYear;
    year.triggeredAge = triggeredAge;
    year.careEverActive = careEverActive;
    year.isAccumulation = isAccumulation;
    year.totalCareFloor = totalCareFloor;
    year.effectiveFlexFactor = effectiveFlexFactor;
    year.householdContext = householdContext;
    return /** @type {import('../../typcheck/rechenkern').LifeYear & {householdContext:HouseholdContext & {care:{p1:CareMeta|null;p2:CareMeta|null}}}} */ (year);
}
