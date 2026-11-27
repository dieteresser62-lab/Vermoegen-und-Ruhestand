import { prepareEngineLastState } from './balance-update-pipeline.js';
import { prepareBalanceEngineAssets } from './balance-health-bucket.js';
import { evaluateBalanceMarketPreview } from './balance-market-preview-runtime.js';

/** @typedef {{profilverbundRuns: import('../../typcheck/balance-ui.js').ProfileRuns|null,
 * modelResult: import('../../typcheck/rechenkern.js').EngineSuccess,
 * marketPreview?: ReturnType<typeof import('./balance-market-preview.js').projectMarketPreview>|import('./balance-market-preview.js').UnavailableMarketPreview,
 * previewInputData?: import('../../typcheck/balance-ui.js').Input,
 * persistenceEvaluation?: BalanceEvaluation}} BalanceEvaluation */
/** @typedef {{inputData: import('../../typcheck/balance-ui.js').Input,
 * persistentState: import('../../typcheck/datenvertraege.js').BalanceState & {personInputEvidence?: Partial<import('../../typcheck/balance-ui.js').Input>},
 * profiles: import('../../typcheck/balance-ui.js').ProfileInput[], profileId: string|null,
 * profilverbundHandlers: {runProfilverbundProfileSimulations: (input: import('../../typcheck/balance-ui.js').Input,
 * profiles: import('../../typcheck/balance-ui.js').ProfileInput[], state: import('../../typcheck/rechenkern.js').EngineState|null,
 * options?: {publish: boolean})=>import('../../typcheck/balance-ui.js').ProfileRuns, publishCarrierMissing?: (profiles: import('../../typcheck/balance-ui.js').ProfileInput[]) => void},
 * engineApi: Pick<typeof import('../../engine/index.mjs').EngineAPI, 'simulateSingleYear'>,
 * publish?: boolean, planInputs?: object, profileSimulationOptions?: {publish: boolean}|null}} BalanceEvaluationOptions */

/** Der bestehende Rechenzugang aktiviert Tageskurse nur für die Balance-Anzeige.
 * @param {BalanceEvaluationOptions & {marketPreviewContext?: import('./balance-market-preview-runtime.js').MarketPreviewContext}} options
 * @returns {BalanceEvaluation} */
export function evaluateBalanceInputs(options) {
    return options.marketPreviewContext
        ? evaluateBalanceMarketPreview(options, options.marketPreviewContext, evaluateBalanceBaseInputs)
        : evaluateBalanceBaseInputs(options);
}

/** Rechenpfad ohne Tageskursvorschau.
 * @param {BalanceEvaluationOptions} options @returns {BalanceEvaluation} */
function evaluateBalanceBaseInputs({ inputData, persistentState, profiles, profileId, profilverbundHandlers, engineApi, publish = true, planInputs = inputData, profileSimulationOptions = /** @type {{publish: boolean}|null} */ (null) }) {
    const lastState = prepareEngineLastState({ ...persistentState, inputs: { ...persistentState.inputs, ...persistentState.personInputEvidence } }, inputData, planInputs);
    const multi = profiles.length > 1 || profiles.length === 1 && profiles[0].profileId !== profileId;
    const source = profiles.find(entry => entry?.balanceState?.profilverbundHouseholdLastState)?.balanceState || persistentState;
    const householdLastState = multi ? profiles.length === 1
        ? prepareEngineLastState(profiles[0].balanceState || {}, inputData, planInputs)
        : prepareEngineLastState({ inputs: source.profilverbundHouseholdInputs, lastState: source.profilverbundHouseholdLastState }, inputData, planInputs) : null;
    const profilverbundRuns = multi ? (profileSimulationOptions
        ? profilverbundHandlers.runProfilverbundProfileSimulations(inputData, profiles, householdLastState, profileSimulationOptions)
        : profilverbundHandlers.runProfilverbundProfileSimulations(inputData, profiles, householdLastState)) : null;
    if (publish && !profilverbundRuns && typeof window !== 'undefined') {
        window.__profilverbundActionResults = null;
        profilverbundHandlers.publishCarrierMissing?.(profiles);
    }
    const modelResult = profilverbundRuns?.householdResult || engineApi.simulateSingleYear(/** @type {import('../../typcheck/rechenkern.js').EngineInput} */ ({ ...prepareBalanceEngineAssets(inputData).input, finalizeThreeBucketAction: true }), lastState);
    if (!modelResult || typeof modelResult !== 'object') throw new Error('EngineAPI.simulateSingleYear() liefert kein Ergebnisobjekt.');
    if (modelResult.error) throw modelResult.error;
    return { profilverbundRuns, modelResult: /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (modelResult) };
}
