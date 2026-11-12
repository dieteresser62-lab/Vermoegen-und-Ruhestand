// @ts-check
/** @import {TechnicalInventory} from '../../../typcheck/rechenkern' */
import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT } from '../german-demography-care-survivor-contract.js';
import { buildMonteCarloOutcomeInventoryV1 } from '../monte-carlo-chunk-result.js';
import { findSimulatorEngineValidationError, formatSimulatorValidationError } from '../simulator-input-validation.js';
export const MAX_TECHNICAL_ERROR_SAMPLES = 20;

export const MONTE_CARLO_HOUSEHOLD_LIFE_CONTRACT_VERSION = 'MonteCarloHouseholdLifeContractV2';

/** @param {AbortSignal|null|undefined} signal */
export function throwIfMonteCarloAborted(signal) {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = /** @type {Error & {code:string}} */ (new Error('Monte Carlo run was cancelled.'));
    error.code = 'MC_RUN_CANCELLED';
    throw error;
}

export function createMonteCarloHouseholdLifeContractV2() {
    return {
        schemaVersion: MONTE_CARLO_HOUSEHOLD_LIFE_CONTRACT_VERSION,
        activePartnerSource: 'inputs.partner.aktiv',
        partnerMortalityPolicy: 'withdrawal-phase-independent-of-care-metadata',
        householdFlexProfilePolicy: 'partner-activation-independent-of-care-metadata',
        widowBenefitStartPolicy: 'not-before-deceased-pension-start-offset',
        deltaLedgerId: 'A08-2',
        deltaLedgerIds: ['A08-2', 'A08-8']
    };
}

export function createDemographyCareSurvivorDiagnosticsV1() {
    const contract = GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT;
    const target = contract.mortality.target;
    return {
        schemaVersion: 'DemographyCareSurvivorDiagnosticsV1',
        contractSchemaVersion: contract.schemaVersion,
        contractRevision: contract.revision,
        hashes: { ...contract.hashes },
        // FR-75: Todesziehungen folgen der Zieltafel (Kohorte V2); die Periodentafel dient nur der Pflegeabstimmung.
        mortality: {
            tableType: target.tableType,
            source: target.source,
            variant: target.variant,
            birthYearRange: { ...target.birthYearRange },
            cohortProjection: target.cohortProjection,
            futureMortalityImprovement: target.futureMortalityImprovement,
            officialAgeRange: { ...target.officialAgeRange },
            runtimeAgeRange: { ...contract.mortality.runtimeAgeRange },
            tailEvidenceClass: target.tailAssumption.evidenceClass,
            qxTableHash: target.qxTableHash,
            careCalibrationTable: { tableType: contract.mortality.tableType, period: contract.mortality.period }
        },
        care: {
            observedPrevalenceRuntimeRole: contract.care.officialObservation.runtimeRole,
            entryEvidenceClass: contract.care.entryModel.evidenceClass,
            progressionEvidenceClass: contract.care.progressionModel.evidenceClass,
            durationEvidenceClass: contract.care.durationModel.evidenceClass
        },
        survivor: {
            evidenceClass: contract.survivor.evidenceClass,
            defaultMode: contract.survivor.runtimeContract.defaultMode,
            defaultPercent: contract.survivor.runtimeContract.defaultPercent,
            interpretation: contract.survivor.modelBoundary.interpretation
        }
    };
}

/** @returns {TechnicalInventory} */
export function createMonteCarloTechnicalInventory(requested = 0) {
    return {
        requested: Math.max(0, Number(requested) || 0),
        financiallyEvaluable: 0,
        technicalError: 0,
        errors: []
    };
}

/** @param {TechnicalInventory} target
 * @param {TechnicalInventory} source */
export function mergeMonteCarloTechnicalInventory(target, source) {
    if (!target || !source) return target;
    target.financiallyEvaluable += Math.max(0, Number(source.financiallyEvaluable) || 0);
    target.technicalError += Math.max(0, Number(source.technicalError) || 0);
    const sourceErrors = Array.isArray(source.errors) ? source.errors : [];
    for (const error of sourceErrors) {
        if (target.errors.length >= MAX_TECHNICAL_ERROR_SAMPLES) break;
        target.errors.push(error);
    }
    return target;
}

/** @template {object} T
 * @param {T & {outcomeCounts?:Partial<Record<string,number>>;wealthFan?:unknown}} aggregatedResults
 * @param {TechnicalInventory} technicalInventory */
export function attachMonteCarloBatchOutcome(aggregatedResults, technicalInventory) {
    const inventory = technicalInventory || createMonteCarloTechnicalInventory(0);
    const batchStatus = inventory.technicalError > 0 ? 'technical_error' : 'completed';
    const outcomeCounts = aggregatedResults?.outcomeCounts || {};
    const outcomeInventory = buildMonteCarloOutcomeInventoryV1({
        requestedRuns: inventory.requested,
        ruin: Math.max(0, Number(outcomeCounts.ruin) || 0),
        all_dead: Math.max(0, Number(outcomeCounts.all_dead) || 0),
        horizon_exhausted: Math.max(0, Number(outcomeCounts.horizon_exhausted) || 0),
        technical_error: inventory.technicalError
    });
    if (batchStatus === 'technical_error' && inventory.errors?.[0]) {
        const firstError = inventory.errors[0];
        if (!String(firstError.message || '').includes('Terminale Outcomes:')) {
            firstError.message = `${firstError.message || 'Die Monte-Carlo-Simulation wurde technisch abgebrochen.'} `
                + `Floor-Deckung im gewaehlten Horizont: nicht ausgewiesen. Terminale Outcomes: `
                + `Ruin ${outcomeInventory.ruin}, Tod ${outcomeInventory.all_dead}, `
                + `Horizont ${outcomeInventory.horizon_exhausted}, Technik ${outcomeInventory.technical_error}.`;
        }
    }
    const { outcomeCounts: _outcomeCounts, ...financialResults } = aggregatedResults || {};
    return Object.defineProperty({
        ...financialResults,
        batchStatus,
        financialMetricsValid: batchStatus === 'completed',
        technicalInventory: inventory,
        outcomeInventory
    }, 'wealthFan', { value: aggregatedResults?.wealthFan || null, enumerable: false });
}

/** @param {{error?:import('../../../typcheck/rechenkern').TechnicalPathError}} result
 * @param {number} runIdx
 * @param {number} simulationsJahr */
export function normalizeTechnicalPathError(result, runIdx, simulationsJahr) {
    const fallbackCode = 'SIMULATOR_RESULT_SHAPE_INVALID';
    const sourceError = result?.error;
    const code = typeof sourceError?.code === 'string' && sourceError.code.trim()
        ? sourceError.code.trim()
        : fallbackCode;
    const validation = findSimulatorEngineValidationError(sourceError);
    const sourceMessage = validation ? `${formatSimulatorValidationError(validation)} (${code})`
        : typeof sourceError?.message === 'string' ? sourceError.message.trim() : '';
    return {
        runIndex: runIdx,
        simulationYearIndex: simulationsJahr,
        code,
        message: sourceMessage.includes(code)
            ? sourceMessage
            : `Ein Simulationspfad wurde technisch abgebrochen (${code}).`
    };
}
