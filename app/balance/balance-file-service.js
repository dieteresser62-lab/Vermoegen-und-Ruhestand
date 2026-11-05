import { createBalanceExportDocument, normalizeBalanceImportDocument, BalanceImportError } from './balance-binder-imports.js';
import { StorageManager } from './balance-storage.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { HOUSEHOLD_PLAN_KEY, readBalanceHouseholdPlan } from '../profile/household-plan.js';
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
 * options?: {publish: boolean})=>import('../../typcheck/balance-ui.js').ProfileRuns},
 * engineApi: Pick<typeof import('../../engine/index.mjs').EngineAPI, 'simulateSingleYear'>,
 * publish?: boolean, planInputs?: object, profileSimulationOptions?: {publish: boolean}|null}} BalanceEvaluationOptions */

/** Der bestehende Rechenzugang aktiviert Tageskurse nur für die Balance-Anzeige.
 * @param {BalanceEvaluationOptions & {marketPreviewContext?: import('./balance-market-preview-runtime.js').MarketPreviewContext}} options
 * @returns {BalanceEvaluation} */
export function evaluateBalanceFileInputs(options) {
    return options.marketPreviewContext
        ? evaluateBalanceMarketPreview(options, options.marketPreviewContext, evaluateBalanceBaseInputs)
        : evaluateBalanceBaseInputs(options);
}

/** Gemeinsamer Rechenpfad der Balance-Maske und des Dateidienstes. */
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {BalanceEvaluationOptions} options @returns {BalanceEvaluation} */
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
    if (publish && !profilverbundRuns && typeof window !== 'undefined') window.__profilverbundActionResults = null;
    const modelResult = profilverbundRuns?.householdResult || engineApi.simulateSingleYear(/** @type {import('../../typcheck/rechenkern.js').EngineInput} */ ({ ...prepareBalanceEngineAssets(inputData).input, finalizeThreeBucketAction: true }), lastState);
    if (!modelResult || typeof modelResult !== 'object') throw new Error('EngineAPI.simulateSingleYear() liefert kein Ergebnisobjekt.');
    if (modelResult.error) throw modelResult.error;
    return { profilverbundRuns, modelResult: /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (modelResult) };
}
/**
 * @returns Ergebnis der bestehenden Operation.
 */
export function exportBalanceFile() { return createBalanceExportDocument(StorageManager.loadState()); }

/** Die beiden Aufrufer liefern denselben PREVIEW-/PERSIST_INPUTS-Vertrag.
 * Recovery, Replace, Nachprüfung und Rollback liegen ausschließlich hier. */
/**
 * @param json Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export async function importBalanceFile(json, { navigationOperation, applyInputs, update, replace = StorageManager.replaceStateFromImport.bind(StorageManager), rollback = StorageManager.rollbackImportReplace.bind(StorageManager) }) {
    const normalized = normalizeBalanceImportDocument(json);
    // Vor Vorschau/Replace streng lesen: beschädigte Pläne dürfen nicht überschrieben werden.
    const previousPlan = readBalanceHouseholdPlan().raw;
    applyInputs(normalized.payload.inputs);
    const dry = await update('preview');
    navigationOperation.check();
    if (!dry?.ok) throw new BalanceImportError('dry_run_failed', 'Die importierten Daten bestehen die Eingabe-/Engine-Prüfung nicht. Die Live-Daten wurden nicht verändert.');
    let receipt;
    try {
        receipt = await replace(normalized.payload, { navigationOperation });
        navigationOperation.check(); navigationOperation.commit();
        const final = await update('persist_inputs');
        if (!final?.ok) throw new BalanceImportError('final_update_failed', 'Die abschließende Engine-Prüfung ist fehlgeschlagen.');
        if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        return { ok: true, normalized, receipt };
    } catch (error) {
        if (receipt) {
            // Die Kündigung darf den notwendigen Rollback nicht erneut abbrechen.
            // Der äußere Besitzer bleibt bis zum bestätigten Rollback registriert.
            const rollbackOperation = error?.name === 'AbortError' ? {
                ...navigationOperation,
                check() {},
                commit() { navigationOperation.phase = 'commit'; }
            } : navigationOperation;
            try {
                await rollback(receipt, { navigationOperation: rollbackOperation });
                if (persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY) !== previousPlan) {
                    await PersistenceFacade.replaceRecordsTransactional({ [HOUSEHOLD_PLAN_KEY]: previousPlan }, {
                        navigationOperation: rollbackOperation, probelaufDomainWrite: true,
                        allowKey: key => key === HOUSEHOLD_PLAN_KEY,
                        postValidate: records => {
                            if ((records[HOUSEHOLD_PLAN_KEY] ?? null) !== previousPlan) throw new Error('PLAN_ROLLBACK_READBACK_FAILED');
                        }
                    });
                }
            }
            catch (rollbackError) {
                PersistenceFacade.blockSyncWrites([HOUSEHOLD_PLAN_KEY], 'Import-Rücknahme unbestätigt. Bitte den Wiederherstellungspunkt prüfen.');
                throw new BalanceImportError('rollback_failed', `Import und Rollback fehlgeschlagen. Punkt „${receipt.recoverySnapshotId}“ unter Daten & Sicherung zurückholen.`, { originalError: rollbackError });
            }
            if (error?.name === 'AbortError') throw error;
            throw new BalanceImportError('post_replace_validation_failed', 'Die abschließende Prüfung ist fehlgeschlagen. Der vorherige Zustand wurde automatisch wiederhergestellt.');
        }
        throw error;
    }
}
/**
 * @param win Eingabe für die bestehende Projektion.
 * @param navigationOperation Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export async function connectLegacySnapshotFolder(win = globalThis.window, navigationOperation = null) {
    if (!win?.showDirectoryPicker) throw new Error('Die Ordnerverbindung ist in diesem Browser nicht verfügbar.');
    const handle = await win.showDirectoryPicker();
    navigationOperation?.check();
    if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Zugriff auf den Ordner wurde nicht gewährt.');
    navigationOperation?.check(); navigationOperation?.commit();
    await StorageManager._idbHelper.set('snapshotDirHandle', handle);
    return handle;
}
