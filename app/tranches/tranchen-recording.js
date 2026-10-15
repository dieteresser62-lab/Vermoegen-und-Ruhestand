import { captureWealthLots, PROFILE_WEALTH_LOTS_KEY } from '../profile/profile-wealth-history.js';
import { saveTranchesToStorage } from './tranchen-manager-state.js';

/** Gemeinsamer Erfassungsweg für Formular und erzeugte Spielkäufe. */
export function recordTrancheCollection(tranches, storage, { previousTranches, date } = {}) {
    const previous = captureWealthLots(storage.getItem(PROFILE_WEALTH_LOTS_KEY), previousTranches, date);
    const lots = captureWealthLots(JSON.stringify(previous), tranches, date);
    storage.setItem(PROFILE_WEALTH_LOTS_KEY, JSON.stringify(lots));
    return saveTranchesToStorage(tranches, storage);
}
