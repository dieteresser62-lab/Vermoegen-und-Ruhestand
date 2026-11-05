/** @import {Sampler,SamplingConfig,SamplingPublicContract,SamplingResolution,SamplingDiagnostics,HistoricalYear,SimulatorInputs,SimulationState,Random,StressContext} from '../../../typcheck/rechenkern' */

export const MIN_START_YEAR_INDEX = 4;

export const MONTE_CARLO_SAMPLING_CONTRACT_VERSION = 'MonteCarloSamplingContractV1';

export const MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION = 'MonteCarloSamplingDiagnosticsV1';

export const MONTE_CARLO_METHODS = new Set(['block', 'stationary', 'regime_markov', 'regime_iid']);

export const START_YEAR_MODES = new Set(['UNIFORM', 'FILTER', 'RECENCY']);

/** @param {string} code
 * @param {string} message */
export function samplingContractError(code, message) {
    const error = /** @type {RangeError & {code?:string}} */ (new RangeError(`${MONTE_CARLO_SAMPLING_CONTRACT_VERSION}: ${message}`));
    error.code = code;
    return error;
}
