/** @import * as D from "../../typcheck/datenvertraege.js" */
/** @import * as R from "../../typcheck/rechenkern.js" */
import { captureWealthLots, PROFILE_WEALTH_LOTS_KEY } from '../profile/profile-wealth-history.js';
import { saveTranchesToStorage } from './tranchen-manager-state.js';

/** Gemeinsamer Erfassungsweg für Formular und erzeugte Spielkäufe.
 * @param {R.CanonicalTranche[]} tranches
 * @param {D.RecordWriter} storage
 * @param {{previousTranches?: readonly R.CanonicalTranche[]; date?: string}} [options]
 * @returns Der gespeicherte kanonische Bestand. */
export function recordTrancheCollection(tranches, storage, { previousTranches, date } = {}) {
    const previous = captureWealthLots(storage.getItem(PROFILE_WEALTH_LOTS_KEY), previousTranches, date);
    const lots = captureWealthLots(JSON.stringify(previous), tranches, date);
    storage.setItem(PROFILE_WEALTH_LOTS_KEY, JSON.stringify(lots));
    return /** @type {(items: R.CanonicalTranche[], target: D.RecordWriter)=>R.CanonicalTranche[]} */ (saveTranchesToStorage)(tranches, storage);
}
