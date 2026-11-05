// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

import { SIMULATION_DATA_INVENTORY } from './inventory.js';
import { sha256Hex, canonicalizeHistoricalContractValue } from '../historical-backtest-contract.js';
import { inventoryError } from './validation.js';
import { EXTERNAL_GATE_FIELDS } from './schema.js';
import { deepFreeze } from './entry-builders.js';

/**
 * @param entryId - Kontext für entryId.
 * @param [inventory] - Kontext für inventory.
 * @returns Ergebnis der Operation.
 */
export function findSimulationDataInventoryEntry(entryId, inventory = SIMULATION_DATA_INVENTORY) {
    return inventory.historicalSeries?.[entryId] || inventory.staticData?.[entryId] || null;
}

/**
 * @param value - Zu prüfender oder darzustellender Wert.
 * @returns {string}
 */
export function computeSimulationDataValueHash(value) {
    return sha256Hex(canonicalizeHistoricalContractValue(value));
}

/**
 * @param entryId - Kontext für entryId.
 * @param value - Zu prüfender oder darzustellender Wert.
 * @param [inventory] - Kontext für inventory.
 * @returns {string}
 */
export function assertSimulationDataValueHash(entryId, value, inventory = SIMULATION_DATA_INVENTORY) {
    const entry = findSimulationDataInventoryEntry(entryId, inventory);
    if (!entry) {
        inventoryError('SIMULATION_DATA_ENTRY_UNKNOWN', `Unknown simulation data inventory entry ${entryId}`, { entryId });
    }
    if (entry.embeddedValueHash.status !== 'known') {
        inventoryError('SIMULATION_DATA_HASH_UNRESOLVED', `Inventory entry ${entryId} has no resolved value hash`, { entryId });
    }
    const actualHash = computeSimulationDataValueHash(value);
    if (actualHash !== entry.embeddedValueHash.value) {
        inventoryError('SIMULATION_DATA_HASH_MISMATCH', `Inventory hash mismatch for ${entryId}`, {
            entryId,
            expectedHash: entry.embeddedValueHash.value,
            actualHash
        });
    }
    return actualHash;
}

/**
 * @param entryId - Kontext für entryId.
 * @param [inventory] - Kontext für inventory.
 * @returns Ergebnis der Operation.
 */
export function evaluateSimulationDataSourceGate(entryId, inventory = SIMULATION_DATA_INVENTORY) {
    const entry = findSimulationDataInventoryEntry(entryId, inventory);
    if (!entry) {
        inventoryError('SIMULATION_DATA_ENTRY_UNKNOWN', `Unknown simulation data inventory entry ${entryId}`, { entryId });
    }
    const unresolvedFields = EXTERNAL_GATE_FIELDS.filter(fieldName => entry[fieldName].status !== 'known');
    const evidenceBlocksExternalUse = [
        'model_assumption',
        'user_input',
        'stress_parameter',
        'missing',
        'unresolved'
    ].includes(entry.evidenceClass);
    const externallyValidated = entry.externalValidationStatus === 'externally_validated'
        && unresolvedFields.length === 0
        && !evidenceBlocksExternalUse;
    return deepFreeze({
        entryId,
        technicallyReproducible: entry.embeddedValueHash.status === 'known',
        externallyValidated,
        replacementAllowed: externallyValidated,
        unresolvedFields,
        evidenceClass: entry.evidenceClass,
        externalValidationStatus: entry.externalValidationStatus
    });
}
