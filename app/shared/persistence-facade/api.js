/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { readRealRecords, activatePlayArea, discardPlayArea, adoptPlayArea } from './play-area.js';
import { createHousehold, switchHousehold, getHouseholds, renameHousehold, deleteHousehold, rebuildHousehold, createHouseholdFromRecords, readHouseholdRecords } from './households.js';
import { setProbelaufProtection, blockSyncWrites, blockDocumentWrites, holdWritesUntil, hasSyncWriteBlocks, hooks } from './state.js';
import { withProbelaufOperation, flush } from './writes.js';
import { readPersistedRecords, exportAllSync, importAll, replaceRecordsTransactional, replaceLiveRecords } from './exchange.js';
import { observeInputChanges, bindLifecycleFlush, bindTauriClose, unbindLifecycleFlush } from './lifecycle.js';
import { configurePersistence, init, isInitialized } from './initialization.js';
import { getItemSync, setItemSync, removeItemSync, clearAllowedSync, keysSync, keySync, clearSync } from './cache.js';
import { listSnapshots, readSnapshot, readSnapshots, writeSnapshot, deleteSnapshot } from './snapshots.js';
import { getDirtyState, getPersistenceStatus, getMetadata, setMetadata, updateMetadata, resetNewBeginningBrowserStorage, resetPersistenceForTests, resetPersistenceRuntimeForTests } from './maintenance.js';

export const PersistenceFacade = {
    readRealRecords,
    activatePlayArea,
    createHousehold,
    switchHousehold,
    getHouseholds,
    renameHousehold,
    deleteHousehold,
    rebuildHousehold,
    createHouseholdFromRecords,
    readHouseholdRecords,
    discardPlayArea,
    adoptPlayArea,
    setProbelaufProtection,
    withProbelaufOperation,
    readPersistedRecords,
    blockSyncWrites,
    blockDocumentWrites,
    holdWritesUntil,
    hasSyncWriteBlocks,
    observeInputChanges,
    configurePersistence,
    init,
    isInitialized,
    getItemSync,
    setItemSync,
    removeItemSync,
    clearAllowedSync,
    keysSync,
    keySync,
    clearSync,
    exportAllSync,
    importAll,
    replaceRecordsTransactional,
    listSnapshots,
    readSnapshot,
    readSnapshots,
    writeSnapshot,
    deleteSnapshot,
    replaceLiveRecords,
    flush,
    getDirtyState,
    getPersistenceStatus,
    getMetadata,
    setMetadata,
    updateMetadata,
    resetNewBeginningBrowserStorage,
    bindLifecycleFlush,
    bindTauriClose,
    unbindLifecycleFlush,
    resetPersistenceForTests,
    resetPersistenceRuntimeForTests
};

export const persistenceStorage = {
    getItem: getItemSync,
    setItem: setItemSync,
    removeItem: removeItemSync,
    clear: clearSync,
    key: keySync,
    get length() {
        return keysSync().length;
    }
};

export default PersistenceFacade;

Object.assign(hooks, { flush, bindLifecycleFlush, bindTauriClose, facade: PersistenceFacade });

