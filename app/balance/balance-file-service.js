import { createBalanceExportDocument, normalizeBalanceImportDocument, BalanceImportError } from './balance-binder-imports.js';
import { StorageManager } from './balance-storage.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { HOUSEHOLD_PLAN_KEY, readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { prepareEngineLastState } from './balance-update-pipeline.js';

/** Gemeinsamer Rechenpfad der Balance-Maske und des Dateidienstes. */
export function evaluateBalanceFileInputs({ inputData, persistentState, profiles, profileId, profilverbundHandlers, engineApi, publish = true }) {
    const lastState = prepareEngineLastState({ ...persistentState, inputs: { ...persistentState.inputs, ...persistentState.personInputEvidence } }, inputData);
    const multi = profiles.length > 1 || profiles.length === 1 && profiles[0].profileId !== profileId;
    const source = profiles.find(entry => entry?.balanceState?.profilverbundHouseholdLastState)?.balanceState || persistentState;
    const householdLastState = multi ? profiles.length === 1
        ? prepareEngineLastState(profiles[0].balanceState || {}, inputData)
        : prepareEngineLastState({ inputs: source.profilverbundHouseholdInputs, lastState: source.profilverbundHouseholdLastState }, inputData) : null;
    const profilverbundRuns = multi ? profilverbundHandlers.runProfilverbundProfileSimulations(inputData, profiles, householdLastState) : null;
    if (publish && !profilverbundRuns && typeof window !== 'undefined') window.__profilverbundActionResults = null;
    const modelResult = profilverbundRuns?.householdResult || engineApi.simulateSingleYear({ ...inputData, finalizeThreeBucketAction: true }, lastState);
    if (!modelResult || typeof modelResult !== 'object') throw new Error('EngineAPI.simulateSingleYear() liefert kein Ergebnisobjekt.');
    if (modelResult.error) throw modelResult.error;
    return { profilverbundRuns, modelResult };
}
export function exportBalanceFile() { return createBalanceExportDocument(StorageManager.loadState()); }

/** Die beiden Aufrufer liefern denselben PREVIEW-/PERSIST_INPUTS-Vertrag.
 * Recovery, Replace, Nachprüfung und Rollback liegen ausschließlich hier. */
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
export async function connectLegacySnapshotFolder(win = globalThis.window, navigationOperation = null) {
    if (!win?.showDirectoryPicker) throw new Error('Die Ordnerverbindung ist in diesem Browser nicht verfügbar.');
    const handle = await win.showDirectoryPicker();
    navigationOperation?.check();
    if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Zugriff auf den Ordner wurde nicht gewährt.');
    navigationOperation?.check(); navigationOperation?.commit();
    await StorageManager._idbHelper.set('snapshotDirHandle', handle);
    return handle;
}
